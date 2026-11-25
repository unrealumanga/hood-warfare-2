import { EventEmitter } from "node:events"
import type { WebSocket } from "ws"
import { RoomManager } from "../src/server/rooms.ts"
import type { ServerMessage } from "../src/server/protocol.ts"
import { describe, expect, it } from "vitest"
import {
  MAPS, MAP_BOXES, MAP_SOLIDS, MAP_WAYPOINTS, SPAWN_POINTS, HEALTH_PICKUP_POS,
  Intent, PLAYER_EYE_HEIGHT, PLAYER_HEIGHT, PLAYER_RADIUS, PLAYER_STEP_HEIGHT, TICK_HZ,
  findNearestWaypoint, getSpawnForSlot, hasLineOfSight, makeMatchRuntime,
  muralWaypointId, nextWaypointToward, readSnapshot, setupSchedule,
  stepPlayerMovement, sweepSegmentVsWorld, updateSchedule, type MapDef
} from "../src/sim/index.ts"

function boot(map: MapDef, seed = 1894) {
  const runtime = makeMatchRuntime({ mapId: map.id, seed, totalSlots: 6, initialHumans: [] })
  expect(runtime.tick(setupSchedule).ok).toBe(true)
  expect(readSnapshot(runtime).mapId).toBe(map.id)
  return runtime
}

// These eight obstructed links predate selectable maps. Preserve the Bell Yard
// graph exactly; assert the complete baseline so no NEW obstruction is hidden.
const bellYardBlockedLinks = ["0-3", "0-14", "2-4", "3-4", "9-10", "10-19", "15-19", "9-21"]

for (const map of Object.values(MAPS)) {
  describe(map.name, () => {
    it("has a connected graph and routes every spawn to every mural using real graph edges", () => {
      expect(map.waypoints.map((wp) => wp.id)).toEqual(map.waypoints.map((_, i) => i))
      const reached = new Set([0])
      const queue = [0]
      for (let i = 0; i < queue.length; i++) {
        const wp = map.waypoints[queue[i]!]!
        for (const id of wp.neighbors) {
          if (map.id === "overprintHall") expect(map.waypoints[id]!.neighbors).toContain(wp.id)
          if (!reached.has(id)) { reached.add(id); queue.push(id) }
        }
      }
      expect(reached.size).toBe(map.waypoints.length)
      for (const spawn of map.spawnPoints) {
        for (const mural of map.muralZones) {
          let current = findNearestWaypoint(spawn.x, spawn.y, spawn.z, map.waypoints)
          const goal = muralWaypointId(mural.id, map.waypoints)
          const visited = new Set<number>()
          while (current !== goal) {
            expect(visited.has(current)).toBe(false)
            visited.add(current)
            const next = nextWaypointToward(current, goal, [], map.waypoints)
            expect(map.waypoints[current]!.neighbors).toContain(next)
            current = next
          }
          expect(current).toBe(goal)
        }
      }
    })

    it("keeps all spawn cylinders clear of solid geometry", () => {
      // Also check slot offsets used by larger offline bot populations.
      const spawns = [...map.spawnPoints, ...Array.from({ length: 21 }, (_, slot) => getSpawnForSlot(slot, 21, map))]
      for (const spawn of spawns) {
        for (const b of map.solids) {
          const overlaps = spawn.x + PLAYER_RADIUS > b.minX && spawn.x - PLAYER_RADIUS < b.maxX &&
            spawn.z + PLAYER_RADIUS > b.minZ && spawn.z - PLAYER_RADIUS < b.maxZ &&
            spawn.y + PLAYER_HEIGHT > b.minY + 0.001 && spawn.y < b.maxY - 0.001
          expect(overlaps, `${map.id}: spawn (${spawn.x},${spawn.z}) in ${b.id}`).toBe(false)
        }
      }
    })

    it("checks every neighbouring waypoint sightline at walking eye height", () => {
      const blocked: string[] = []
      const checked = new Set<string>()
      for (const a of map.waypoints) {
        for (const id of a.neighbors) {
          const key = [a.id, id].sort((x, y) => x - y).join("-")
          if (checked.has(key)) continue
          checked.add(key)
          const b = map.waypoints[id]!
          if (!hasLineOfSight(a.x, a.y + PLAYER_EYE_HEIGHT, a.z,
            b.x, b.y + PLAYER_EYE_HEIGHT, b.z, [], [], map)) blocked.push(key)
        }
      }
      expect(blocked).toEqual(map.id === "bellYard" ? bellYardBlockedLinks : [])
    })

    it("boots six bots and runs 600 update ticks with shots fired", () => {
      const runtime = boot(map)
      let shots = 0
      let lastSeq = 0
      for (let i = 0; i < 600; i++) {
        expect(runtime.tick(updateSchedule).ok, `failed at tick ${i + 1}`).toBe(true)
        const snapshot = readSnapshot(runtime)
        for (const event of snapshot.events) {
          if (event.seq > lastSeq && event.kind === "shot") shots++
        }
        lastSeq = snapshot.events.at(-1)?.seq ?? lastSeq
        expect(snapshot.fighters.every((f) => f.isBot && Number.isFinite(f.x + f.y + f.z))).toBe(true)
      }
      const snapshot = readSnapshot(runtime)
      expect(snapshot.tickCount).toBe(600)
      expect(snapshot.fighters).toHaveLength(6)
      expect(shots).toBeGreaterThan(0)
      if (map.id === "overprintHall") {
        console.info(`Overprint Hall 600-tick soak: ${shots} shots, ${snapshot.fighters.reduce((sum, f) => sum + f.kills, 0)} kills (seed 1894, 6 bots)`)
      }
    })

    it("uses stair risers no higher than PLAYER_STEP_HEIGHT", () => {
      const flights = new Map<string, number[]>()
      for (const b of map.boxes.filter((b) => b.kind === "stair")) {
        const prefix = b.id.slice(0, b.id.lastIndexOf("_step_"))
        const levels = flights.get(prefix) ?? [0]
        levels.push(b.maxY)
        flights.set(prefix, levels)
      }
      expect(flights.size).toBeGreaterThan(0)
      for (const levels of flights.values()) {
        levels.sort((a, b) => a - b)
        for (let i = 1; i < levels.length; i++) {
          expect(levels[i]! - levels[i - 1]!).toBeGreaterThan(0)
          expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(PLAYER_STEP_HEIGHT + 1e-9)
        }
      }
    })
  })
}

it("preserves Bell Yard exports and the exact default slot-0 spawn", () => {
  expect(MAPS.bellYard.boxes).toBe(MAP_BOXES)
  expect(MAPS.bellYard.solids).toBe(MAP_SOLIDS)
  expect(MAPS.bellYard.waypoints).toBe(MAP_WAYPOINTS)
  expect(MAPS.bellYard.spawnPoints).toBe(SPAWN_POINTS)
  expect(MAPS.bellYard.healthPickupPosition).toBe(HEALTH_PICKUP_POS)
  const runtime = makeMatchRuntime()
  expect(runtime.tick(setupSchedule).ok).toBe(true)
  const snapshot = readSnapshot(runtime)
  expect(snapshot.mapId).toBe("bellYard")
  expect(snapshot.fighters[0]).toMatchObject({ x: -24.5, y: 0, z: -12, yaw: -Math.PI / 2 })
})

it("uses the selected map's collision, bounds, and both climbable gallery stairs", () => {
  const map = MAPS.overprintHall
  expect(sweepSegmentVsWorld(-5, 1.56, 0, 5, 1.56, 0, 0, [], map)).not.toBeNull()
  expect(sweepSegmentVsWorld(-5, 1.56, 0, 5, 1.56, 0)).toBeNull()
  for (const x of [-8, 8]) {
    let state = { x, y: 0, z: -1.4, vx: 0, vy: 0, vz: 0, grounded: true }
    for (let i = 0; i < 100; i++) {
      state = stepPlayerMovement(state, { moveForward: 1, moveRight: 0, yaw: 0, jump: false }, 1, 1 / TICK_HZ, { map })
    }
    expect(state.z).toBeLessThan(-10)
    expect(state.y).toBeCloseTo(3.6, 6)
    expect(state.grounded).toBe(true)
  }
  let state = { x: 23, y: 0, z: -19, vx: 0, vy: 0, vz: 0, grounded: true }
  for (let i = 0; i < 30; i++) {
    state = stepPlayerMovement(state, { moveForward: 1, moveRight: 0, yaw: 0, jump: false }, 1, 1 / TICK_HZ, { map })
  }
  expect(state.z).toBeLessThan(-19)
  expect(state.z).toBeGreaterThanOrEqual(-21)
})

it("changes maps through StartMatch, carries difficulty, and resets map fixtures", () => {
  const runtime = boot(MAPS.bellYard)
  for (const mapId of ["overprintHall", "bellYard"] as const) {
    runtime.send(Intent, { _tag: "StartMatch", seed: 42, mapId, difficulty: 3, initialHumans: [] })
    expect(runtime.tick(updateSchedule).ok).toBe(true)
    const snapshot = readSnapshot(runtime)
    const map = MAPS[mapId]
    expect(snapshot.mapId).toBe(mapId)
    expect(snapshot.difficulty).toBe(3)
    expect(snapshot.healthPickup).toMatchObject(map.healthPickupPosition)
    expect(snapshot.props.map(({ id, x, y, z }) => ({ id, x, y, z }))).toEqual(map.barrelSpawns)
  }
  runtime.send(Intent, { _tag: "StartMatch", seed: 43, initialHumans: [] })
  expect(runtime.tick(updateSchedule).ok).toBe(true)
  expect(readSnapshot(runtime).mapId).toBe("bellYard")
})

it("keeps interleaved matches isolated without a mutable global active map", () => {
  const bell = boot(MAPS.bellYard, 41)
  const hall = boot(MAPS.overprintHall, 42)
  const reference = boot(MAPS.bellYard, 41)
  for (let i = 0; i < 120; i++) {
    expect(bell.tick(updateSchedule).ok).toBe(true)
    expect(hall.tick(updateSchedule).ok).toBe(true)
    expect(reference.tick(updateSchedule).ok).toBe(true)
  }
  expect(readSnapshot(bell)).toEqual(readSnapshot(reference))
  expect(readSnapshot(hall).healthPickup).toMatchObject(MAPS.overprintHall.healthPickupPosition)
})


it("keeps creator-selected and legacy online rooms on their own maps, including joiners", () => {
  class Socket extends EventEmitter {
    readonly readyState = 1
    readonly messages: ServerMessage[] = []
    send(payload: string) { this.messages.push(JSON.parse(payload) as ServerMessage) }
    receive(payload: object) { this.emit("message", JSON.stringify(payload)) }
  }
  const manager = new RoomManager()
  try {
    for (const requested of ["overprintHall", undefined, "invalid-map"] as const) {
      const creator = new Socket()
      const joiner = new Socket()
      manager.attachSocket(creator as unknown as WebSocket)
      manager.attachSocket(joiner as unknown as WebSocket)
      creator.receive({ type: "createRoom", name: "Creator", mapId: requested })
      const roomMessage = creator.messages.find((m) => m.type === "roomState")!
      expect(roomMessage.type).toBe("roomState")
      if (roomMessage.type !== "roomState") throw new Error("Missing room")
      const code = roomMessage.room.code
      // A joining client cannot override the creator's choice.
      joiner.receive({ type: "joinRoom", code, name: "Joiner", mapId: "bellYard" })
      creator.receive({ type: "startMatch" })
      const expected = requested === "overprintHall" ? "overprintHall" : "bellYard"
      expect(manager.getRoomSnapshot(code)?.mapId).toBe(expected)
      for (const socket of [creator, joiner]) {
        const message = socket.messages.find((m) => m.type === "snapshot")
        expect(message?.type).toBe("snapshot")
        if (message?.type === "snapshot") {
          expect(message.snapshot.mapId).toBe(expected)
          expect(message.snapshot.healthPickup).toMatchObject(MAPS[expected].healthPickupPosition)
        }
      }
    }
    expect(manager.getRoomCount()).toBe(3)
  } finally {
    manager.dispose()
  }
})
