import type { WebSocket } from "ws"
import {
  Intent,
  SLOTS_COUNT,
  TICK_HZ,
  makeMatchRuntime,
  readSnapshot,
  sanitizeCosmetics,
  sanitizeLoadout,
  setupSchedule,
  updateSchedule,
  type CombatLoadout,
  type CosmeticLoadout,
  type CrewId,
  type MatchRuntime,
  type MatchSnapshot,
  type PlayerInput
} from "../sim/index.ts"
import type { ClientMessage, RoomInfo, RoomMemberInfo, ServerMessage } from "./protocol.ts"

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"
const EMPTY_ROOM_GRACE_MS = 30_000

interface ConnectedClient {
  readonly humanId: string
  readonly ws: WebSocket
  roomCode: string | null
  slotId: number
  name: string
  loadout: CombatLoadout
  cosmetics: CosmeticLoadout
  pendingTakeover: boolean
}

interface RoomRecord {
  readonly code: string
  status: "lobby" | "playing" | "finished"
  hostHumanId: string | null
  readonly clients: Map<string, ConnectedClient>
  runtime: MatchRuntime | null
  tickTimer: ReturnType<typeof setInterval> | null
  tickSubCount: number
  emptySinceMs: number | null
  matchSeed: number
}

export interface RoomManagerOptions {
  readonly snapshotEveryTicks?: number
  readonly simulatedLatencyMs?: number
  readonly seedBase?: number
}

function sanitizeName(raw: unknown): string {
  if (typeof raw !== "string") return "Printer"
  const cleaned = raw.replace(/[\r\n\t<>]/g, "").trim().slice(0, 18)
  return cleaned.length > 0 ? cleaned : "Printer"
}

function sanitizeInput(raw: unknown): PlayerInput | null {
  if (typeof raw !== "object" || raw === null) return null
  const r = raw as Record<string, unknown>
  const num = (k: string, fallback = 0): number => {
    const v = r[k]
    return typeof v === "number" && Number.isFinite(v) ? v : fallback
  }
  const sw = r["switchSlot"]
  const switchSlot: 0 | 1 | 2 = sw === 1 || sw === 2 ? sw : 0

  let sketchAction: PlayerInput["sketchAction"] = null
  const rawSketch = r["sketchAction"]
  if (typeof rawSketch === "object" && rawSketch !== null) {
    const sr = rawSketch as Record<string, unknown>
    const kind = sr["kind"]
    const actionId = typeof sr["actionId"] === "number" && Number.isFinite(sr["actionId"]) ? Math.floor(sr["actionId"]) : 0
    if (
      actionId > 0 &&
      (kind === "placeAnchor" || kind === "placeFree" || kind === "placeBarricade")
    ) {
      sketchAction = {
        kind,
        anchorId: typeof sr["anchorId"] === "string" ? sr["anchorId"].slice(0, 32) : undefined,
        actionId
      }
    }
  }

  return {
    seq: Math.max(0, Math.floor(num("seq", 0))),
    moveForward: Math.max(-1, Math.min(1, num("moveForward", 0))),
    moveRight: Math.max(-1, Math.min(1, num("moveRight", 0))),
    yaw: num("yaw", 0),
    pitch: Math.max(-1.45, Math.min(1.45, num("pitch", 0))),
    jump: Boolean(r["jump"]),
    fire: Boolean(r["fire"]),
    reload: Boolean(r["reload"]),
    switchSlot,
    sketchAction,
    eraseActionId: Math.max(0, Math.floor(num("eraseActionId", 0))),
    parryActionId: Math.max(0, Math.floor(num("parryActionId", 0))),
    smokeActionId: Math.max(0, Math.floor(num("smokeActionId", 0))),
    grappleActionId: Math.max(0, Math.floor(num("grappleActionId", 0))),
    grappleReleaseId: Math.max(0, Math.floor(num("grappleReleaseId", 0)))
  }
}

export class RoomManager {
  private readonly rooms = new Map<string, RoomRecord>()
  private readonly clientsByWs = new Map<WebSocket, ConnectedClient>()
  private readonly snapshotEveryTicks: number
  private readonly simulatedLatencyMs: number
  private nextClientNum = 1
  private nextSeed: number
  private readonly cleanupTimer: ReturnType<typeof setInterval>

  constructor(options: RoomManagerOptions = {}) {
    this.snapshotEveryTicks = Math.max(1, options.snapshotEveryTicks ?? 2)
    this.simulatedLatencyMs = Math.max(0, options.simulatedLatencyMs ?? 0)
    this.nextSeed = options.seedBase ?? 1894
    this.cleanupTimer = setInterval(() => this.pruneEmptyRooms(), 5_000)
  }

  public dispose(): void {
    clearInterval(this.cleanupTimer)
    for (const room of this.rooms.values()) {
      if (room.tickTimer !== null) {
        clearInterval(room.tickTimer)
        room.tickTimer = null
      }
    }
    this.rooms.clear()
    this.clientsByWs.clear()
  }

  public attachSocket(ws: WebSocket): void {
    const humanId = `h${this.nextClientNum++}`
    const client: ConnectedClient = {
      humanId,
      ws,
      roomCode: null,
      slotId: -1,
      name: `Printer ${this.nextClientNum - 1}`,
      loadout: sanitizeLoadout(null),
      cosmetics: sanitizeCosmetics(null),
      pendingTakeover: false
    }
    this.clientsByWs.set(ws, client)

    ws.on("message", (raw) => {
      const text = typeof raw === "string" ? raw : raw.toString("utf8")
      const dispatch = () => this.handleRawMessage(client, text)
      if (this.simulatedLatencyMs > 0) {
        setTimeout(dispatch, this.simulatedLatencyMs)
      } else {
        dispatch()
      }
    })

    ws.on("close", () => {
      this.detachClient(client)
      this.clientsByWs.delete(ws)
    })

    ws.on("error", () => {
      this.detachClient(client)
      this.clientsByWs.delete(ws)
    })
  }

  public getRoomSnapshot(code: string): MatchSnapshot | null {
    const room = this.rooms.get(code.toUpperCase())
    if (!room || !room.runtime) return null
    return readSnapshot(room.runtime)
  }

  public getRoomCount(): number {
    return this.rooms.size
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    const payload = JSON.stringify(msg)
    const deliver = () => {
      if (ws.readyState === 1) {
        ws.send(payload)
      }
    }
    if (this.simulatedLatencyMs > 0) {
      setTimeout(deliver, this.simulatedLatencyMs)
    } else {
      deliver()
    }
  }

  private handleRawMessage(client: ConnectedClient, text: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      this.send(client.ws, {
        type: "error",
        code: "BAD_MESSAGE",
        message: "Malformed JSON payload."
      })
      return
    }
    if (typeof parsed !== "object" || parsed === null) {
      this.send(client.ws, {
        type: "error",
        code: "BAD_MESSAGE",
        message: "Message must be a JSON object."
      })
      return
    }
    const msg = parsed as ClientMessage
    switch (msg.type) {
      case "ping": {
        this.send(client.ws, {
          type: "pong",
          t: typeof msg.t === "number" ? msg.t : 0,
          serverTimeMs: Date.now()
        })
        break
      }
      case "createRoom": {
        this.handleCreateRoom(client, msg)
        break
      }
      case "joinRoom": {
        this.handleJoinRoom(client, msg)
        break
      }
      case "startMatch": {
        this.handleStartMatch(client)
        break
      }
      case "setLoadout": {
        this.handleSetLoadout(client, msg)
        break
      }
      case "input": {
        this.handleInput(client, msg)
        break
      }
      case "leaveRoom": {
        this.detachClient(client)
        break
      }
      default: {
        this.send(client.ws, {
          type: "error",
          code: "UNKNOWN_TYPE",
          message: "Unsupported message type."
        })
      }
    }
  }

  private generateRoomCode(): string {
    for (let attempt = 0; attempt < 64; attempt++) {
      let code = ""
      for (let i = 0; i < 4; i++) {
        code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)]!
      }
      if (!this.rooms.has(code)) return code
    }
    return `R${(Date.now() % 8999) + 1000}`
  }

  private pickBalancedFreeSlot(room: RoomRecord): number {
    const taken = new Set<number>()
    let cobaltCount = 0
    let vermilionCount = 0
    for (const c of room.clients.values()) {
      taken.add(c.slotId)
      if (c.slotId < 3) cobaltCount++
      else vermilionCount++
    }
    const preferredOrder =
      cobaltCount <= vermilionCount ? [0, 1, 2, 3, 4, 5] : [3, 4, 5, 0, 1, 2]
    for (const slot of preferredOrder) {
      if (!taken.has(slot)) return slot
    }
    return -1
  }

  private buildRoomInfo(room: RoomRecord): RoomInfo {
    const members: Array<RoomMemberInfo> = []
    for (const c of room.clients.values()) {
      members.push({
        humanId: c.humanId,
        slotId: c.slotId,
        crew: (c.slotId < 3 ? 0 : 1) as CrewId,
        name: c.name,
        loadout: c.loadout,
        cosmetics: c.cosmetics,
        pendingTakeover: c.pendingTakeover
      })
    }
    members.sort((a, b) => a.slotId - b.slotId)
    return {
      code: room.code,
      status: room.status,
      hostHumanId: room.hostHumanId,
      members
    }
  }

  private broadcastRoomState(room: RoomRecord): void {
    const info = this.buildRoomInfo(room)
    for (const c of room.clients.values()) {
      this.send(c.ws, {
        type: "roomState",
        room: info,
        yourHumanId: c.humanId,
        yourSlotId: c.slotId
      })
    }
  }

  private broadcastSnapshot(room: RoomRecord, snapshot: MatchSnapshot): void {
    const serverTimeMs = Date.now()
    for (const c of room.clients.values()) {
      this.send(c.ws, {
        type: "snapshot",
        code: room.code,
        serverTimeMs,
        snapshot
      })
    }
  }

  private handleCreateRoom(
    client: ConnectedClient,
    msg: Extract<ClientMessage, { readonly type: "createRoom" }>
  ): void {
    this.detachClient(client)
    const code = this.generateRoomCode()
    const room: RoomRecord = {
      code,
      status: "lobby",
      hostHumanId: client.humanId,
      clients: new Map(),
      runtime: null,
      tickTimer: null,
      tickSubCount: 0,
      emptySinceMs: null,
      matchSeed: this.nextSeed++
    }
    client.roomCode = code
    client.slotId = 0
    client.name = sanitizeName(msg.name)
    client.loadout = sanitizeLoadout(msg.loadout)
    client.cosmetics = sanitizeCosmetics(msg.cosmetics)
    client.pendingTakeover = false
    room.clients.set(client.humanId, client)
    this.rooms.set(code, room)
    this.broadcastRoomState(room)
  }

  private handleJoinRoom(
    client: ConnectedClient,
    msg: Extract<ClientMessage, { readonly type: "joinRoom" }>
  ): void {
    const rawCode = typeof msg.code === "string" ? msg.code.trim().toUpperCase() : ""
    if (rawCode.length === 0) {
      this.send(client.ws, {
        type: "error",
        code: "INVALID_CODE",
        message: "Enter a 4-letter room code to join."
      })
      return
    }
    const room = this.rooms.get(rawCode)
    if (!room) {
      this.send(client.ws, {
        type: "error",
        code: "ROOM_NOT_FOUND",
        message: `Room "${rawCode}" was not found. Check the code or create a new room.`
      })
      return
    }
    if (room.clients.size >= SLOTS_COUNT) {
      this.send(client.ws, {
        type: "error",
        code: "ROOM_FULL",
        message: `Room "${rawCode}" is full (${SLOTS_COUNT}/${SLOTS_COUNT} players).`
      })
      return
    }

    this.detachClient(client)
    const slotId = this.pickBalancedFreeSlot(room)
    if (slotId < 0) {
      this.send(client.ws, {
        type: "error",
        code: "ROOM_FULL",
        message: `Room "${rawCode}" has no open slots.`
      })
      return
    }

    client.roomCode = room.code
    client.slotId = slotId
    client.name = sanitizeName(msg.name)
    client.loadout = sanitizeLoadout(msg.loadout)
    client.cosmetics = sanitizeCosmetics(msg.cosmetics)
    client.pendingTakeover = room.status === "playing"
    room.clients.set(client.humanId, client)
    room.emptySinceMs = null
    if (room.hostHumanId === null) {
      room.hostHumanId = client.humanId
    }

    // Mid-match join: assign human to replace bot on that bot's NEXT spawn!
    if (room.status === "playing" && room.runtime !== null) {
      room.runtime.send(Intent, {
        _tag: "AssignHuman",
        slotId,
        humanId: client.humanId,
        name: client.name,
        loadout: client.loadout,
        cosmetics: client.cosmetics,
        immediate: false
      })
      this.broadcastRoomState(room)
      this.send(client.ws, {
        type: "snapshot",
        code: room.code,
        serverTimeMs: Date.now(),
        snapshot: readSnapshot(room.runtime)
      })
    } else {
      this.broadcastRoomState(room)
    }
  }

  private handleStartMatch(client: ConnectedClient): void {
    if (client.roomCode === null) {
      this.send(client.ws, {
        type: "error",
        code: "NOT_IN_ROOM",
        message: "Join or create a room before starting a match."
      })
      return
    }
    const room = this.rooms.get(client.roomCode)
    if (!room) return

    if (room.tickTimer !== null) {
      clearInterval(room.tickTimer)
      room.tickTimer = null
    }

    const initialHumans = Array.from(room.clients.values()).map((c) => {
      c.pendingTakeover = false
      return {
        slotId: c.slotId,
        humanId: c.humanId,
        name: c.name,
        loadout: c.loadout,
        cosmetics: c.cosmetics
      }
    })

    const runtime = makeMatchRuntime({
      seed: room.matchSeed++,
      initialHumans
    })
    const bootRes = runtime.tick(setupSchedule)
    if (!bootRes.ok) {
      this.send(client.ws, {
        type: "error",
        code: "SIM_BOOT_FAILED",
        message: "Failed to initialize authoritative match."
      })
      return
    }

    room.runtime = runtime
    room.status = "playing"
    room.tickSubCount = 0
    this.broadcastRoomState(room)
    this.broadcastSnapshot(room, readSnapshot(runtime))

    const stepMs = 1000 / TICK_HZ
    room.tickTimer = setInterval(() => {
      this.stepRoom(room)
    }, stepMs)
  }

  private stepRoom(room: RoomRecord): void {
    if (!room.runtime) return
    const res = room.runtime.tick(updateSchedule)
    if (!res.ok) return

    room.tickSubCount += 1
    const snap = readSnapshot(room.runtime)

    // Sync pendingTakeover flags once a mid-match joiner spawns in
    let roomStateChanged = false
    for (const c of room.clients.values()) {
      const f = snap.fighters.find((x) => x.slotId === c.slotId)
      if (c.pendingTakeover && f && f.humanId === c.humanId && !f.isBot) {
        c.pendingTakeover = false
        roomStateChanged = true
      }
    }

    if (snap.phase === "Finished" && room.status !== "finished") {
      room.status = "finished"
      if (room.tickTimer !== null) {
        clearInterval(room.tickTimer)
        room.tickTimer = null
      }
      this.broadcastSnapshot(room, snap)
      this.broadcastRoomState(room)
      return
    }

    if (roomStateChanged) {
      this.broadcastRoomState(room)
    }

    if (room.tickSubCount % this.snapshotEveryTicks === 0) {
      this.broadcastSnapshot(room, snap)
    }
  }

  private handleSetLoadout(
    client: ConnectedClient,
    msg: Extract<ClientMessage, { readonly type: "setLoadout" }>
  ): void {
    client.loadout = sanitizeLoadout(msg.loadout)
    client.cosmetics = sanitizeCosmetics(msg.cosmetics)
    if (client.roomCode === null) return
    const room = this.rooms.get(client.roomCode)
    if (!room) return

    if (room.runtime && room.status === "playing") {
      room.runtime.send(Intent, {
        _tag: "SetLoadout",
        slotId: client.slotId,
        primary: client.loadout.primary,
        armor: client.loadout.armor,
        cosmetics: client.cosmetics,
        immediate: false
      })
    }
    this.broadcastRoomState(room)
  }

  private handleInput(
    client: ConnectedClient,
    msg: Extract<ClientMessage, { readonly type: "input" }>
  ): void {
    if (client.roomCode === null) return
    const room = this.rooms.get(client.roomCode)
    if (!room || !room.runtime || room.status !== "playing") return
    const input = sanitizeInput(msg.input)
    if (!input) return
    room.runtime.send(Intent, {
      _tag: "SubmitInput",
      slotId: client.slotId,
      input
    })
  }

  private detachClient(client: ConnectedClient): void {
    if (client.roomCode === null) return
    const room = this.rooms.get(client.roomCode)
    client.roomCode = null
    client.slotId = -1
    client.pendingTakeover = false
    if (!room) return

    room.clients.delete(client.humanId)
    if (room.runtime) {
      room.runtime.send(Intent, {
        _tag: "ReleaseHuman",
        humanId: client.humanId
      })
    }

    // Room creator disconnect resilience: hand host role to next remaining human and keep match running!
    if (room.hostHumanId === client.humanId) {
      const nextHost = room.clients.values().next().value as ConnectedClient | undefined
      room.hostHumanId = nextHost ? nextHost.humanId : null
    }

    if (room.clients.size === 0) {
      room.emptySinceMs = Date.now()
    } else {
      this.broadcastRoomState(room)
    }
  }

  private pruneEmptyRooms(): void {
    const now = Date.now()
    for (const [code, room] of this.rooms.entries()) {
      if (room.clients.size === 0 && room.emptySinceMs !== null) {
        if (now - room.emptySinceMs >= EMPTY_ROOM_GRACE_MS) {
          if (room.tickTimer !== null) {
            clearInterval(room.tickTimer)
            room.tickTimer = null
          }
          this.rooms.delete(code)
        }
      }
    }
  }
}
