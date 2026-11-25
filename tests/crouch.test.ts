import { describe, expect, it } from "vitest"
import { sanitizeInput } from "../src/server/rooms.ts"
import {
  ARMORS, BOSS_SCALE, CROUCH_SPEED_MULT, DEFAULT_COSMETICS, DEFAULT_LOADOUT,
  EMPTY_INPUT, Fighter, Game, GRAPPLE_LEDGES, Intent, MAPS, MatchState,
  PLAYER_CROUCH_EYE_HEIGHT, PLAYER_HEIGHT, Projectile,
  RESPAWN_TICKS, TICK_HZ, makeMatchRuntime, readSnapshot, resolveCrouching,
  setupSchedule, stepPlayerMovement, updateSchedule,
  type FighterData, type KinematicState, type MapBox, type MapId, type MatchRuntime,
  type MatchStateData, type PlayerInput
} from "../src/sim/index.ts"

const humans = Array.from({ length: 6 }, (_, slotId) => ({
  slotId, humanId: `crouch-${slotId}`, name: `Player ${slotId}`,
  loadout: DEFAULT_LOADOUT, cosmetics: DEFAULT_COSMETICS
}))
const idle = { moveForward: 0, moveRight: 0, yaw: 0, jump: false }
const origin: KinematicState = { x: 0, y: 0, z: 5, vx: 0, vy: 0, vz: 0, grounded: true }
const ceiling: MapBox = {
  id: "low-ceiling", kind: "cover", solid: true,
  minX: -2, maxX: 2, minY: 1.2, maxY: 2, minZ: 3, maxZ: 7
}

function boot(mapId: MapId = "bellYard") {
  const rt = makeMatchRuntime({ seed: 723, mapId, totalSlots: 6, initialHumans: humans })
  expect(rt.tick(setupSchedule).ok).toBe(true)
  expect(readSnapshot(rt).fighters.every((f) => f.crouching === false)).toBe(true)
  return rt
}
function tick(rt: MatchRuntime, count = 1) {
  for (let i = 0; i < count; i++) expect(rt.tick(updateSchedule).ok).toBe(true)
}
function send(rt: MatchRuntime, slotId: number, input: Partial<PlayerInput>) {
  rt.send(Intent, { _tag: "SubmitInput", slotId, input: { ...EMPTY_INPUT, ...input } })
}
let editId = 0
function edit(rt: MatchRuntime, fighter: (f: FighterData) => FighterData,
  match?: (m: MatchStateData) => MatchStateData) {
  const sys = Game.System(`Hw2/CrouchEdit_${editId++}`, {
    queries: { fighters: Game.Query({ selection: { fighter: Game.Query.write(Fighter) } }) },
    resources: { match: Game.System.writeResource(MatchState) }
  }, ({ queries, resources }) => {
    for (const e of queries.fighters.each()) {
      queries.fighters.data.fighter.set(e, fighter(queries.fighters.data.fighter.get(e)))
    }
    if (match) resources.match.set(match(resources.match.get()))
  })
  expect(rt.tick(Game.Schedule(sys)).ok).toBe(true)
}

/** Inject an exact horizontal bullet to test combat height independently of weapon spread. */
function shootAt(height: number, crouching: boolean, isBoss = false, lateral = 0) {
  const rt = boot()
  edit(rt, (f) => f.slotId === 3
    ? { ...f, x: 0, y: 0, z: 5, crouching, isBoss, armor: 0 }
    : { ...f, x: -24, y: 0, z: 14 + f.slotId * 0.01 })
  send(rt, 3, { crouch: crouching })
  const sys = Game.System(`Hw2/CrouchBullet_${editId++}`, {
    commands: Game.System.commands(Game.System.spawns(Projectile))
  }, ({ commands }) => {
    commands.spawn(Game.Command.spawn([Projectile, {
      projectileId: 999, shotEventId: 999, ownerSlot: 0, crew: 0, gunId: "linecaster",
      x: lateral, y: height, z: 6, vx: 0, vy: 0, vz: -120, damage: 10,
      radius: 0.01, lifeTicksLeft: 10
    }]))
  })
  expect(rt.tick(Game.Schedule(sys, Game.Schedule.applyDeferred())).ok).toBe(true)
  tick(rt)
  return readSnapshot(rt)
}

describe("Crouch combat", () => {
  it("lets a shot at 1.6 m hit standing fighters and pass over crouched fighters", () => {
    expect(shootAt(1.6, false).fighters[3]!.hp).toBeLessThan(100)
    expect(shootAt(1.6, true).fighters[3]!.hp).toBe(100)
  })
  it("scales head and leg zones while keeping arm lateral thresholds", () => {
    for (const [height, zone] of [[0.9, "head"], [0.65, "torso"], [0.4, "limb"]] as const) {
      const hit = shootAt(height, true).events.find((e) => e.kind === "hit")
      expect(hit).toBeDefined()
      expect(hit!.zone ?? "torso").toBe(zone)
    }
    expect(shootAt(0.65, true, false, 0.35).events.find((e) => e.kind === "hit")?.zone).toBe("limb")
  })
  it("keeps the boss standing and applies boss capsule scaling", () => {
    const snap = shootAt(PLAYER_HEIGHT * BOSS_SCALE - 0.1, true, true)
    expect(snap.fighters[3]!.crouching).toBe(false)
    expect(snap.fighters[3]!.hp).toBeLessThan(100)
  })
  it("fires from crouched eye height on the same tick crouch is pressed", () => {
    const rt = boot()
    edit(rt, (f) => f.slotId === 0 ? { ...f, ...origin } : f)
    send(rt, 0, { crouch: true, fire: true, seq: 1 })
    tick(rt)
    const snap = readSnapshot(rt)
    expect(snap.fighters[0]!.crouching).toBe(true)
    expect(snap.events.find((e) => e.kind === "shot" && e.actorSlot === 0)?.y)
      .toBeCloseTo(PLAYER_CROUCH_EYE_HEIGHT - 0.08)
  })
})

describe("Shared crouch movement", () => {
  it("blocks standing under static and dynamic ceilings and allows standing in the open", () => {
    const prev = { ...origin, crouching: true }
    const opts = { extraSolids: [ceiling] }
    expect(resolveCrouching(prev, false, opts)).toBe(true)
    expect(stepPlayerMovement(prev, idle, 1, 1 / TICK_HZ, opts).crouching).toBe(true)
    expect(resolveCrouching(prev, false, { map: { ...MAPS.bellYard, solids: [ceiling] } })).toBe(true)
    expect(resolveCrouching(prev, false)).toBe(false)
    expect(stepPlayerMovement(prev, idle, 1, 1 / TICK_HZ).crouching).toBe(false)
  })
  it("walks through low headroom only while crouched", () => {
    const start = { ...origin, x: -2.6 }
    const move = { ...idle, moveRight: 1 }
    let stand: KinematicState = start
    let duck: KinematicState = start
    for (let i = 0; i < 30; i++) {
      stand = stepPlayerMovement(stand, move, 1, 1 / TICK_HZ, { extraSolids: [ceiling] })
      duck = stepPlayerMovement(duck, move, 1, 1 / TICK_HZ, { extraSolids: [ceiling], crouch: true })
    }
    expect(stand.x).toBeLessThan(-2.4)
    expect(duck.x).toBeGreaterThan(-1)
    expect(duck.y).toBe(0)
  })
  it("moves at 0.55x standing speed with either armor weight", () => {
    for (const armor of Object.values(ARMORS)) {
      const stand = stepPlayerMovement(origin, { ...idle, moveRight: 1 }, armor.speedMultiplier, 1 / TICK_HZ)
      const duck = stepPlayerMovement(origin, { ...idle, moveRight: 1 }, armor.speedMultiplier, 1 / TICK_HZ, { crouch: true })
      expect(duck.vx / stand.vx).toBeCloseTo(CROUCH_SPEED_MULT, 12)
      expect((duck.x - origin.x) / (stand.x - origin.x)).toBeCloseTo(0.55, 12)
    }
  })
  it("ignores jump both when crouch starts and when headroom forces crouch", () => {
    const jump = { ...idle, jump: true }
    expect(stepPlayerMovement(origin, jump, 1, 1 / TICK_HZ).vy).toBeGreaterThan(0)
    for (const [prev, opts] of [[origin, { crouch: true }], [{ ...origin, crouching: true }, { extraSolids: [ceiling] }]] as const) {
      const next = stepPlayerMovement(prev, jump, 1, 1 / TICK_HZ, opts)
      expect(next.y).toBe(0)
      expect(next.vy).toBe(0)
      expect(next.grounded).toBe(true)
    }
  })
  it("uses the same headroom decision in authoritative movement and prediction", () => {
    const rt = boot()
    edit(rt, (f) => f.slotId === 0 ? { ...f, ...origin, crouching: true } : f, (m) => ({
      ...m, constructs: [{ ...ceiling, id: 99, kind: "plank", ownerSlot: 0, crew: 0,
        anchorId: null, createdTick: 0, expiresTick: 1000 }]
    }))
    send(rt, 0, { crouch: false, jump: true })
    tick(rt)
    const me = readSnapshot(rt).fighters[0]!
    const predicted = stepPlayerMovement({ ...origin, crouching: true }, { ...idle, jump: true },
      ARMORS[me.armorType].speedMultiplier, 1 / TICK_HZ, { extraSolids: [ceiling] })
    expect(me.crouching).toBe(predicted.crouching)
    expect(me.y).toBe(predicted.y)
    edit(rt, (f) => f, (m) => ({ ...m, constructs: [] }))
    tick(rt)
    expect(readSnapshot(rt).fighters[0]!.crouching).toBe(false)
  })
  it("cannot start a grapple while crouched, including the first crouch tick", () => {
    const run = (crouch: boolean) => {
      const rt = boot()
      const ledge = GRAPPLE_LEDGES[0]!
      edit(rt, (f) => f.slotId === 0 ? { ...f, x: ledge.x, y: 0, z: ledge.z + 2.42 } : f)
      send(rt, 0, { crouch, grappleActionId: 1, pitch: Math.atan2(ledge.y - 1.56, 2.42) })
      tick(rt)
      return readSnapshot(rt).fighters[0]!
    }
    expect(run(false).grapple).not.toBeNull()
    expect(run(true).grapple).toBeNull()
  })
  it("resets crouching on respawn", () => {
    const rt = boot()
    edit(rt, (f) => f.slotId === 0 ? { ...f, alive: false, crouching: true, respawnTicksLeft: RESPAWN_TICKS } : f)
    tick(rt, RESPAWN_TICKS)
    expect(readSnapshot(rt).fighters[0]!.crouching).toBe(false)
    expect(readSnapshot(rt).fighters[0]!.alive).toBe(true)
  })
})

describe("Crouch input and determinism", () => {
  it("coerces hostile server input to actual booleans", () => {
    for (const [value, expected] of [["false", true], ["", false], [1, true], [0, false], [NaN, false], [null, false], [undefined, false], [true, true], [false, false]] as const) {
      const sanitized = sanitizeInput({ ...EMPTY_INPUT, crouch: value })!
      expect(sanitized.crouch).toBe(expected)
      expect(typeof sanitized.crouch).toBe("boolean")
    }
    expect(sanitizeInput(null)).toBeNull()
  })
  it("produces identical complete snapshots for identical crouch toggles", () => {
    const run = () => {
      const rt = boot()
      for (let seq = 1; seq <= 180; seq++) {
        send(rt, 0, { seq, crouch: seq % 40 < 20, moveForward: 1, jump: seq % 17 === 0, yaw: seq * 0.01, fire: seq % 7 === 0 })
        tick(rt)
      }
      return readSnapshot(rt)
    }
    expect(run()).toEqual(run())
  })
  for (const mapId of ["bellYard", "overprintHall"] as const) {
    it(`runs all six slots in ${mapId} for 600 ticks with random crouch inputs and finite snapshots`, () => {
      const rt = boot(mapId)
      let seed = 89
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        return seed / 4294967296
      }
      const sawCrouch = new Set<number>()
      const sawStand = new Set<number>()
      for (let seq = 1; seq <= 600; seq++) {
        for (let slot = 0; slot < 6; slot++) {
          send(rt, slot, { seq, crouch: random() < 0.5, moveForward: random() * 2 - 1,
            moveRight: random() * 2 - 1, yaw: random() * Math.PI * 2, jump: random() < 0.1, fire: random() < 0.2 })
        }
        tick(rt)
        const snapshot = readSnapshot(rt)
        expect(snapshot.fighters).toHaveLength(6)
        for (const f of snapshot.fighters) {
          for (const n of [f.x, f.y, f.z, f.vx, f.vy, f.vz, f.yaw, f.pitch, f.hp]) expect(Number.isFinite(n)).toBe(true)
          expect(typeof f.crouching).toBe("boolean")
          if (f.crouching) sawCrouch.add(f.slotId)
          else sawStand.add(f.slotId)
        }
        for (const p of snapshot.projectiles) {
          expect([p.x, p.y, p.z, p.vx, p.vy, p.vz].every(Number.isFinite)).toBe(true)
        }
      }
      expect(sawCrouch.size).toBe(6)
      expect(sawStand.size).toBe(6)
      expect(readSnapshot(rt).tickCount).toBe(600)
    })
  }
})
