import { afterEach, describe, expect, it } from "vitest"
import { WebSocket } from "ws"
import { createHoodWarfareServer, type RunningServer } from "../src/server/index.ts"
import type { ClientMessage, ServerMessage } from "../src/server/protocol.ts"
import { DEFAULT_COSMETICS, DEFAULT_LOADOUT, EMPTY_INPUT, SKETCH_ANCHORS } from "../src/sim/index.ts"

class TestWsClient {
  public readonly ws: WebSocket
  public readonly messages: Array<ServerMessage> = []
  private readonly waiters: Array<{
    readonly pred: (m: ServerMessage) => boolean
    readonly resolve: (m: ServerMessage) => void
  }> = []

  constructor(ws: WebSocket) {
    this.ws = ws
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString("utf8")) as ServerMessage
      this.messages.push(msg)
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        const w = this.waiters[i]!
        if (w.pred(msg)) {
          this.waiters.splice(i, 1)
          w.resolve(msg)
        }
      }
    })
  }

  public send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg))
  }

  public waitFor<T extends ServerMessage>(
    pred: (m: ServerMessage) => m is T,
    timeoutMs = 4000
  ): Promise<T> {
    const existing = this.messages.find(pred)
    if (existing) return Promise.resolve(existing)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for WS message")), timeoutMs)
      this.waiters.push({
        pred,
        resolve: (m) => {
          clearTimeout(timer)
          resolve(m as T)
        }
      })
    })
  }

  public nextMatching<T extends ServerMessage>(
    pred: (m: ServerMessage) => m is T,
    timeoutMs = 4000
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for next WS message")), timeoutMs)
      this.waiters.push({
        pred,
        resolve: (m) => {
          clearTimeout(timer)
          resolve(m as T)
        }
      })
    })
  }

  public close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.ws.readyState === WebSocket.CLOSED) {
        resolve()
        return
      }
      this.ws.once("close", () => resolve())
      this.ws.close()
    })
  }
}

async function connectClient(wsUrl: string): Promise<TestWsClient> {
  const ws = new WebSocket(wsUrl)
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve())
    ws.once("error", reject)
  })
  return new TestWsClient(ws)
}

const activeServers: Array<RunningServer> = []
const activeClients: Array<TestWsClient> = []

afterEach(async () => {
  while (activeClients.length > 0) {
    await activeClients.pop()!.close()
  }
  while (activeServers.length > 0) {
    await activeServers.pop()!.close()
  }
})

describe("Authoritative Online Room Server (WebSocket integration)", () => {
  it("handles room create/join, recoverable bad-code error, cosmetic validation, creator disconnect resilience, and mid-match rejoin", async () => {
    const srv = await createHoodWarfareServer({
      port: 0,
      host: "127.0.0.1",
      snapshotEveryTicks: 2
    })
    activeServers.push(srv)

    const clientA = await connectClient(srv.wsUrl)
    const clientB = await connectClient(srv.wsUrl)
    activeClients.push(clientA, clientB)

    // 1. Client A creates a room with intentionally invalid cosmetics (server must sanitize!)
    clientA.send({
      type: "createRoom",
      name: "Alice",
      loadout: { primary: "linecaster", armor: "heavy" },
      cosmetics: { top: "hoodie", hat: "beanie", swatch: "ochre" }
    })
    const stateA = await clientA.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> => m.type === "roomState"
    )
    const roomCode = stateA.room.code
    expect(roomCode).toHaveLength(4)
    expect(stateA.yourSlotId).toBe(0)

    // 2. Client B attempts an invalid room code -> recoverable error, socket stays open!
    clientB.send({
      type: "joinRoom",
      code: "ZZZZ",
      name: "Bob",
      loadout: DEFAULT_LOADOUT,
      cosmetics: DEFAULT_COSMETICS
    })
    const errMsg = await clientB.waitFor(
      (m): m is Extract<ServerMessage, { type: "error" }> => m.type === "error"
    )
    expect(errMsg.code).toBe("ROOM_NOT_FOUND")
    expect(clientB.ws.readyState).toBe(WebSocket.OPEN)

    // 3. Client B immediately recovers and joins the real room (balanced onto Vermilion slot 3!)
    clientB.send({
      type: "joinRoom",
      code: roomCode,
      name: "Bob",
      loadout: { primary: "broadside", armor: "light" },
      cosmetics: { top: "workJacket", hat: "cap", swatch: "denim" }
    })
    const stateB = await clientB.nextMatching(
      (m): m is Extract<ServerMessage, { type: "roomState" }> =>
        m.type === "roomState" && m.room.members.length === 2
    )
    expect(stateB.yourSlotId).toBe(3)

    // 4. Start authoritative match; both clients receive synchronized snapshots with 6 fighters (2 humans + 4 bots)
    clientA.send({ type: "startMatch" })
    const [snapA, snapB] = await Promise.all([
      clientA.nextMatching(
        (m): m is Extract<ServerMessage, { type: "snapshot" }> =>
          m.type === "snapshot" && m.snapshot.tickCount >= 4
      ),
      clientB.nextMatching(
        (m): m is Extract<ServerMessage, { type: "snapshot" }> =>
          m.type === "snapshot" && m.snapshot.tickCount >= 4
      )
    ])

    expect(snapA.snapshot.fighters).toHaveLength(6)
    expect(snapB.snapshot.fighters).toHaveLength(6)
    expect(snapA.snapshot.fighters.filter((f) => !f.isBot)).toHaveLength(2)
    expect(snapA.snapshot.fighters.filter((f) => f.isBot)).toHaveLength(4)
    expect(snapB.snapshot.fighters[0]!.cosmetics.top).toBe("hoodie")
    expect(snapB.snapshot.fighters[3]!.cosmetics.top).toBe("workJacket")

    // 5. Room Creator (Client A) disconnects mid-match!
    // Server must hand Client A's slot back to a bot and KEEP Client B playing cleanly!
    const tickBeforeLeave = snapB.snapshot.tickCount
    await clientA.close()

    const snapAfterCreatorLeft = await clientB.nextMatching(
      (m): m is Extract<ServerMessage, { type: "snapshot" }> =>
        m.type === "snapshot" &&
        m.snapshot.tickCount > tickBeforeLeave + 5 &&
        m.snapshot.fighters[0]!.isBot === true
    )
    expect(snapAfterCreatorLeft.snapshot.phase).toBe("Playing")
    expect(snapAfterCreatorLeft.snapshot.fighters[0]!.isBot).toBe(true)
    expect(snapAfterCreatorLeft.snapshot.fighters[3]!.isBot).toBe(false)

    // 6. Client C joins mid-match -> assigned to replace a bot slot on next spawn (pendingTakeover)!
    const clientC = await connectClient(srv.wsUrl)
    activeClients.push(clientC)
    clientC.send({
      type: "joinRoom",
      code: roomCode,
      name: "Charlie",
      loadout: { primary: "rollerSmg", armor: "light" },
      cosmetics: { top: "windbreaker", hat: "cap", swatch: "pine" }
    })
    const stateC = await clientC.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> => m.type === "roomState"
    )
    expect(stateC.room.status).toBe("playing")
    const charlieMember = stateC.room.members.find((m) => m.name === "Charlie")!
    expect(charlieMember.pendingTakeover).toBe(true)
  })

  it("stays responsive and acknowledges sequenced inputs under 100ms simulated RTT", async () => {
    const srv = await createHoodWarfareServer({
      port: 0,
      host: "127.0.0.1",
      simulatedLatencyMs: 50, // 50ms each way = 100ms RTT!
      snapshotEveryTicks: 2
    })
    activeServers.push(srv)

    const c1 = await connectClient(srv.wsUrl)
    const c2 = await connectClient(srv.wsUrl)
    activeClients.push(c1, c2)

    c1.send({
      type: "createRoom",
      name: "LagTester1",
      loadout: DEFAULT_LOADOUT,
      cosmetics: DEFAULT_COSMETICS
    })
    const rs1 = await c1.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> => m.type === "roomState"
    )

    c2.send({
      type: "joinRoom",
      code: rs1.room.code,
      name: "LagTester2",
      loadout: DEFAULT_LOADOUT,
      cosmetics: DEFAULT_COSMETICS
    })
    await c2.waitFor(
      (m): m is Extract<ServerMessage, { type: "roomState" }> => m.type === "roomState"
    )

    c1.send({ type: "startMatch" })
    await c1.nextMatching(
      (m): m is Extract<ServerMessage, { type: "snapshot" }> => m.type === "snapshot"
    )

    // Send sequenced inputs under 100ms RTT and verify authoritative acknowledgement & movement
    for (let seq = 1; seq <= 6; seq++) {
      c1.send({
        type: "input",
        input: { ...EMPTY_INPUT, seq, moveForward: 1, yaw: -Math.PI / 2 }
      })
    }

    const ackSnap = await c1.nextMatching(
      (m): m is Extract<ServerMessage, { type: "snapshot" }> =>
        m.type === "snapshot" && m.snapshot.fighters[0]!.lastInputSeq >= 6
    )
    expect(ackSnap.snapshot.fighters[0]!.lastInputSeq).toBe(6)
    expect(ackSnap.snapshot.fighters[0]!.x).toBeGreaterThan(-24.4)
  })

  it("synchronizes Milestone 1 Sketch Plank & Cable Car across two clients and shows active constructs to a late joiner", async () => {
    const srv = await createHoodWarfareServer({
      port: 0,
      host: "127.0.0.1",
      snapshotEveryTicks: 2
    })
    activeServers.push(srv)

    const c1 = await connectClient(srv.wsUrl)
    const c2 = await connectClient(srv.wsUrl)
    activeClients.push(c1, c2)

    c1.send({ type: "createRoom", name: "Sketcher", loadout: DEFAULT_LOADOUT, cosmetics: DEFAULT_COSMETICS })
    const r1 = await c1.waitFor((m): m is Extract<ServerMessage, { type: "roomState" }> => m.type === "roomState")
    c2.send({ type: "joinRoom", code: r1.room.code, name: "Rival", loadout: DEFAULT_LOADOUT, cosmetics: DEFAULT_COSMETICS })
    await c2.waitFor((m): m is Extract<ServerMessage, { type: "roomState" }> => m.type === "roomState")

    c1.send({ type: "startMatch" })
    await c1.nextMatching((m): m is Extract<ServerMessage, { type: "snapshot" }> => m.type === "snapshot")

    // Client 1 places a free Sketch Plank -> both clients see the exact same construct ID + Cable Car movement!
    c1.send({
      type: "input",
      input: {
        ...EMPTY_INPUT,
        seq: 1,
        sketchAction: { kind: "placeFree", actionId: 1 }
      }
    })
    const [s1, s2] = await Promise.all([
      c1.nextMatching(
        (m): m is Extract<ServerMessage, { type: "snapshot" }> =>
          m.type === "snapshot" && m.snapshot.constructs.length === 1
      ),
      c2.nextMatching(
        (m): m is Extract<ServerMessage, { type: "snapshot" }> =>
          m.type === "snapshot" && m.snapshot.constructs.length === 1
      )
    ])
    expect(s1.snapshot.constructs[0]!.id).toBe(s2.snapshot.constructs[0]!.id)
    expect(s1.snapshot.fighters[0]!.sketchCharges).toBe(0)
    expect(s2.snapshot.cableCar.t).toBeGreaterThan(0)
    expect(SKETCH_ANCHORS.length).toBeGreaterThanOrEqual(1)

    // Late joiner connects mid-match and immediately receives the active construct in its first snapshot!
    const late = await connectClient(srv.wsUrl)
    activeClients.push(late)
    late.send({ type: "joinRoom", code: r1.room.code, name: "LateJoin", loadout: DEFAULT_LOADOUT, cosmetics: DEFAULT_COSMETICS })
    const lateSnap = await late.waitFor(
      (m): m is Extract<ServerMessage, { type: "snapshot" }> => m.type === "snapshot"
    )
    expect(lateSnap.snapshot.constructs).toHaveLength(1)
    expect(lateSnap.snapshot.constructs[0]!.id).toBe(s1.snapshot.constructs[0]!.id)
  })
})
