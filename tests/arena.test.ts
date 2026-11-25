import { describe, expect, it } from "vitest"
import {
  ALLY_BOT_LEVEL,
  BOSS_HP,
  BOSS_KILL_SCORE,
  BOSS_NAME,
  BOSS_SPAWN_TICK,
  DEFAULT_COSMETICS,
  DEFAULT_LOADOUT,
  DIFFICULTY_KILLS_PER_STEP,
  DIFFICULTY_MAX,
  EMPTY_INPUT,
  Fighter,
  Game,
  HEALTH_PICKUP_FIRST_SPAWN_TICKS,
  HEALTH_PICKUP_HEAL,
  HEALTH_PICKUP_POS,
  HEALTH_PICKUP_RESPAWN_TICKS,
  Intent,
  MatchState,
  PLAYER_MAX_HP,
  RESPAWN_TICKS,
  botSkill,
  makeMatchRuntime,
  readSnapshot,
  setupSchedule,
  updateSchedule,
  type FighterData,
  type InitialHumanSpec,
  type MatchRuntime,
  type MatchStateData,
  type PlayerInput
} from "../src/sim/index.ts"

function human(slotId: number, primary: "linecaster" | "rollerSmg" = "rollerSmg"): InitialHumanSpec {
  return {
    slotId,
    humanId: `h${slotId}`,
    name: `P${slotId}`,
    loadout: { ...DEFAULT_LOADOUT, primary },
    cosmetics: DEFAULT_COSMETICS
  }
}

function boot(seed: number, humans: ReadonlyArray<InitialHumanSpec>, difficulty?: number): MatchRuntime {
  const rt = makeMatchRuntime({ seed, initialHumans: humans, difficulty })
  expect(rt.tick(setupSchedule).ok).toBe(true)
  return rt
}

function tickN(rt: MatchRuntime, n: number): void {
  for (let i = 0; i < n; i++) {
    const r = rt.tick(updateSchedule)
    if (!r.ok) throw new Error(`tick ${i} failed: ${String(r.error)}`)
  }
}

let editCounter = 0
function edit(
  rt: MatchRuntime,
  opts: { readonly fighter?: (f: FighterData) => FighterData; readonly match?: (m: MatchStateData) => MatchStateData }
): void {
  const sys = Game.System(
    `Hw2/ArenaTestEdit_${editCounter++}`,
    {
      queries: { fighters: Game.Query({ selection: { fighter: Game.Query.write(Fighter) } }) },
      resources: { match: Game.System.writeResource(MatchState) }
    },
    ({ queries, resources }) => {
      if (opts.match) resources.match.set(opts.match(resources.match.get()))
      if (opts.fighter) {
        for (const e of queries.fighters.each()) {
          queries.fighters.data.fighter.set(e, opts.fighter(queries.fighters.data.fighter.get(e)))
        }
      }
    }
  )
  expect(rt.tick(Game.Schedule(sys)).ok).toBe(true)
}

const allHumans = [0, 1, 2, 3, 4, 5].map((s) => human(s))
const input = (p: Partial<PlayerInput> = {}): PlayerInput => ({ ...EMPTY_INPUT, ...p })

/** Park everyone far from the booster except the listed slots. */
function park(rt: MatchRuntime, place: Record<number, { x: number; z: number; hp?: number; armor?: number }>): void {
  edit(rt, {
    fighter: (f) => {
      const p = place[f.slotId]
      if (p) return { ...f, x: p.x, y: 0, z: p.z, hp: p.hp ?? f.hp, armor: p.armor ?? f.armor }
      return { ...f, x: -24, y: 0, z: 14 + f.slotId * 0.01 }
    }
  })
}

describe("Health booster", () => {
  it("appears after the first-spawn delay in the middle of the map, then heals once and respawns", () => {
    const rt = boot(1, allHumans)
    park(rt, { 0: { x: 6, z: 6, hp: 30, armor: 0 } })
    expect(readSnapshot(rt).healthPickup.available).toBe(false)
    expect(readSnapshot(rt).healthPickup.x).toBe(HEALTH_PICKUP_POS.x)
    tickN(rt, HEALTH_PICKUP_FIRST_SPAWN_TICKS + 2)
    expect(readSnapshot(rt).healthPickup.available).toBe(true)

    // walk the wounded fighter onto it
    edit(rt, { fighter: (f) => (f.slotId === 0 ? { ...f, x: HEALTH_PICKUP_POS.x + 0.3, z: HEALTH_PICKUP_POS.z } : f) })
    tickN(rt, 2)
    const snap = readSnapshot(rt)
    const me = snap.fighters.find((f) => f.slotId === 0)!
    expect(me.hp).toBe(30 + HEALTH_PICKUP_HEAL)
    expect(me.armor).toBeGreaterThan(0)
    expect(snap.healthPickup.available).toBe(false)
    expect(snap.events.some((e) => e.kind === "pickup" && e.actorSlot === 0 && e.damage === HEALTH_PICKUP_HEAL)).toBe(true)

    // step off (still wounded, so it would be taken again the moment it respawns), then wait for the respawn
    edit(rt, { fighter: (f) => (f.slotId === 0 ? { ...f, x: 8, z: 8 } : f) })
    tickN(rt, HEALTH_PICKUP_RESPAWN_TICKS + 2)
    expect(readSnapshot(rt).healthPickup.available).toBe(true)
  })

  it("is not consumed by a fighter who is already at full health and armor", () => {
    const rt = boot(2, allHumans)
    park(rt, { 0: { x: HEALTH_PICKUP_POS.x, z: HEALTH_PICKUP_POS.z } })
    tickN(rt, HEALTH_PICKUP_FIRST_SPAWN_TICKS + 5)
    expect(readSnapshot(rt).healthPickup.available).toBe(true)
  })

  it("goes to the closest wounded fighter when two reach it together", () => {
    const rt = boot(3, allHumans)
    park(rt, {
      0: { x: 0.9, z: 0, hp: 40, armor: 0 },
      3: { x: 0.2, z: 0, hp: 40, armor: 0 }
    })
    tickN(rt, HEALTH_PICKUP_FIRST_SPAWN_TICKS + 3)
    const snap = readSnapshot(rt)
    expect(snap.fighters.find((f) => f.slotId === 3)!.hp).toBe(40 + HEALTH_PICKUP_HEAL)
    expect(snap.fighters.find((f) => f.slotId === 0)!.hp).toBe(40)
  })

  it("is absent in modes without a central arena", () => {
    const rt = makeMatchRuntime({ seed: 4, mode: "eliteDuel", initialHumans: [human(0)] })
    rt.tick(setupSchedule)
    tickN(rt, HEALTH_PICKUP_FIRST_SPAWN_TICKS + 10)
    expect(readSnapshot(rt).healthPickup.available).toBe(false)
  })
})

describe("Difficulty ramp", () => {
  it("starts from the campaign level given to the match and is clamped", () => {
    expect(readSnapshot(boot(5, [human(0)], 7)).difficulty).toBe(7)
    expect(readSnapshot(boot(5, [human(0)], 99)).difficulty).toBe(DIFFICULTY_MAX)
    expect(readSnapshot(boot(5, [human(0)], -4)).difficulty).toBe(0)
  })

  it("rises by one step per DIFFICULTY_KILLS_PER_STEP cobalt kills and never past the max", () => {
    const rt = boot(6, allHumans, 3)
    edit(rt, { fighter: (f) => (f.slotId === 0 ? { ...f, kills: DIFFICULTY_KILLS_PER_STEP * 2 } : f) })
    tickN(rt, 2)
    expect(readSnapshot(rt).difficulty).toBe(5)
    edit(rt, { fighter: (f) => (f.slotId === 0 ? { ...f, kills: 999 } : f) })
    tickN(rt, 2)
    expect(readSnapshot(rt).difficulty).toBe(DIFFICULTY_MAX)
  })

  it("makes bots more accurate and trigger-happy as the level rises", () => {
    for (let l = 1; l <= DIFFICULTY_MAX; l++) {
      const a = botSkill(l - 1)
      const b = botSkill(l)
      expect(b.jitterYaw).toBeLessThan(a.jitterYaw)
      expect(b.jitterPitch).toBeLessThan(a.jitterPitch)
      expect(b.fireChance).toBeGreaterThan(a.fireChance)
      expect(b.rangeScale).toBeGreaterThan(a.rangeScale)
    }
    expect(botSkill(-5)).toEqual(botSkill(0))
    expect(botSkill(50)).toEqual(botSkill(DIFFICULTY_MAX))
    expect(ALLY_BOT_LEVEL).toBeGreaterThan(0)
  })
})

describe("Boss", () => {
  const bots = [human(0, "linecaster")] // slot 0 human, slots 1-5 bots

  it("enters once, as the lowest red bot, with boss stats and a hunt order", () => {
    const rt = boot(7, bots, 2)
    edit(rt, { match: (m) => ({ ...m, tickCount: BOSS_SPAWN_TICK - 3 }) })
    expect(readSnapshot(rt).bossSlot).toBe(-1)
    tickN(rt, 6)
    const snap = readSnapshot(rt)
    const boss = snap.fighters.find((f) => f.isBoss)!
    expect(boss).toBeDefined()
    expect(boss.crew).toBe(1)
    expect(boss.slotId).toBe(snap.bossSlot)
    expect(boss.name).toBe(BOSS_NAME)
    expect(boss.maxHp).toBe(BOSS_HP)
    expect(boss.hp).toBeLessThanOrEqual(BOSS_HP)
    expect(boss.armorType).toBe("heavy")
    expect(snap.fighters.filter((f) => f.isBoss).length).toBe(1)
    expect(snap.events.some((e) => e.kind === "bossSpawn" && e.actorSlot === boss.slotId)).toBe(true)
    // lowest red bot: slots 0-2 are cobalt (half = 3), so slot 3
    expect(boss.slotId).toBe(3)

    // it never re-triggers
    tickN(rt, 120)
    expect(readSnapshot(rt).fighters.filter((f) => f.isBoss).length).toBeLessThanOrEqual(1)
    expect(readSnapshot(rt).events.filter((e) => e.kind === "bossSpawn").length).toBeLessThanOrEqual(1)
  })

  it("dying awards a score bonus, flags the boss defeated, and respawns as a normal bot", () => {
    const rt = boot(8, bots, 2)
    edit(rt, { match: (m) => ({ ...m, tickCount: BOSS_SPAWN_TICK - 2 }) })
    tickN(rt, 4)
    const bossSlot = readSnapshot(rt).bossSlot
    expect(bossSlot).toBe(3)
    const before = readSnapshot(rt).scores[0]

    // Line the player up on the boss at 6 m, one hit point left on the boss, torso height aim
    edit(rt, {
      fighter: (f) => {
        if (f.slotId === 0) return { ...f, x: 0, y: 0, z: 5, yaw: 0, pitch: 0, hp: PLAYER_MAX_HP }
        if (f.slotId === bossSlot) return { ...f, x: 0, y: 0, z: -1, hp: 1, armor: 0, yaw: Math.PI }
        return { ...f, x: -24, y: 0, z: 14 + f.slotId * 0.01 }
      }
    })
    const aim = Math.atan2(1.1 - 1.56, 6)
    rt.send(Intent, { _tag: "SubmitInput", slotId: 0, input: input({ seq: 1, yaw: 0, pitch: aim, fire: true }) })
    tickN(rt, 1)
    rt.send(Intent, { _tag: "SubmitInput", slotId: 0, input: input({ seq: 2, yaw: 0, pitch: aim, fire: false }) })
    // the boss bot would walk out of the line of fire: pin it in place while the bolt flies
    for (let i = 0; i < 25; i++) {
      edit(rt, { fighter: (f) => (f.slotId === bossSlot && f.alive ? { ...f, x: 0, y: 0, z: -1 } : f) })
      tickN(rt, 1)
    }

    const snap = readSnapshot(rt)
    const boss = snap.fighters.find((f) => f.slotId === bossSlot)!
    expect(boss.alive).toBe(false)
    expect(snap.bossDefeated).toBe(true)
    expect(snap.events.some((e) => e.kind === "bossDown" && e.targetSlot === bossSlot)).toBe(true)
    expect(snap.scores[0]).toBeGreaterThanOrEqual(before + BOSS_KILL_SCORE)

    tickN(rt, RESPAWN_TICKS + 4)
    const back = readSnapshot(rt).fighters.find((f) => f.slotId === bossSlot)!
    expect(back.alive).toBe(true)
    expect(back.isBoss).toBe(false)
    expect(back.maxHp).toBe(PLAYER_MAX_HP)
    expect(back.name).not.toBe(BOSS_NAME)
    expect(readSnapshot(rt).fighters.filter((f) => f.isBoss).length).toBe(0)
  })

  it("only appears in modes that allow it", () => {
    const rt = makeMatchRuntime({ seed: 9, mode: "extraction", initialHumans: [human(0)] })
    rt.tick(setupSchedule)
    edit(rt, { match: (m) => ({ ...m, tickCount: BOSS_SPAWN_TICK - 2 }) })
    tickN(rt, 6)
    expect(readSnapshot(rt).bossSlot).toBe(-1)
  })
})

describe("Determinism with the new systems", () => {
  it("two identical runs through boss entry produce identical snapshots", () => {
    const run = () => {
      const rt = boot(11, bots2, 4)
      edit(rt, { match: (m) => ({ ...m, tickCount: BOSS_SPAWN_TICK - 60 }) })
      tickN(rt, 400)
      const s = readSnapshot(rt)
      return JSON.stringify({ f: s.fighters.map((x) => [x.slotId, x.hp, x.x, x.z, x.isBoss]), d: s.difficulty, p: s.healthPickup, sc: s.scores })
    }
    const bots2 = [human(0)]
    expect(run()).toBe(run())
  })
})
