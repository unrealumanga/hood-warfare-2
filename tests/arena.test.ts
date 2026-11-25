import { describe, expect, it } from "vitest"
import {
  ALLY_BOT_LEVEL,
  BOSS_HP,
  BOSS_KILL_SCORE,
  BOSS_NAME,
  BOSS_SCALE,
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
  MAPS,
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

  it("survives garbage difficulty values without NaN positions (found by fuzzing)", () => {
    for (const bad of [Number.NaN, Infinity, -Infinity, "9" as unknown as number, undefined as unknown as number]) {
      const rt = boot(31, [human(0)], bad)
      tickN(rt, 200)
      const snap = readSnapshot(rt)
      expect(Number.isFinite(snap.difficulty)).toBe(true)
      expect(snap.difficulty).toBeGreaterThanOrEqual(0)
      expect(snap.difficulty).toBeLessThanOrEqual(DIFFICULTY_MAX)
      for (const f of snap.fighters) expect(Number.isFinite(f.x) && Number.isFinite(f.z)).toBe(true)
    }
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

describe("Boss hit capsule", () => {
  it("matches the boss's drawn size: a shot at 2.2 m hits the boss but would sail over a normal fighter", () => {
    const place = (isBoss: boolean) => {
      const rt = boot(21, [human(0, "linecaster")])
      edit(rt, {
        fighter: (f) => {
          if (f.slotId === 0) return { ...f, x: 0, y: 0, z: 5, yaw: 0, pitch: 0 }
          if (f.slotId === 3) return { ...f, x: 0, y: 0, z: -1, yaw: Math.PI, hp: 100, armor: 0, isBoss, maxHp: isBoss ? BOSS_HP : 100 }
          return { ...f, x: -24, y: 0, z: 14 + f.slotId * 0.01 }
        }
      })
      const aim = Math.atan2(2.2 - 1.56, 6) // above a normal 1.78 m fighter's head
      rt.send(Intent, { _tag: "SubmitInput", slotId: 0, input: input({ seq: 1, yaw: 0, pitch: aim, fire: true }) })
      tickN(rt, 1)
      rt.send(Intent, { _tag: "SubmitInput", slotId: 0, input: input({ seq: 2, yaw: 0, pitch: aim, fire: false }) })
      for (let i = 0; i < 25; i++) {
        edit(rt, { fighter: (f) => (f.slotId === 3 && f.alive ? { ...f, x: 0, y: 0, z: -1 } : f) })
        tickN(rt, 1)
      }
      return readSnapshot(rt).fighters.find((f) => f.slotId === 3)!
    }
    expect(place(false).hp).toBe(100) // missed: over the head
    expect(place(true).hp).toBeLessThan(BOSS_HP) // boss: 2.2 m is inside its 2.4 m body
  })
})

describe("Review findings (Codex bug hunt)", () => {
  const withMap = (seed: number, mapId: "bellYard" | "overprintHall", difficulty?: number, humans = [human(0)], mode?: "mural" | "foundry" | "eliteDuel") => {
    const rt = makeMatchRuntime({ seed, mapId, difficulty, mode, initialHumans: humans })
    expect(rt.tick(setupSchedule).ok).toBe(true)
    return rt
  }

  it("boss enters at the active map's boss entrance, not Bell Yard's red spawn", () => {
    for (const mapId of ["bellYard", "overprintHall"] as const) {
      const rt = withMap(41, mapId)
      edit(rt, { match: (m) => ({ ...m, tickCount: BOSS_SPAWN_TICK - 2 }) })
      tickN(rt, 4)
      const ev = readSnapshot(rt).events.find((e) => e.kind === "bossSpawn")!
      expect(ev).toBeDefined()
      const entrance = MAPS[mapId].bossEntrance
      expect(Math.abs(ev.x - entrance.x)).toBeLessThan(0.01)
      expect(Math.abs(ev.z - entrance.z)).toBeLessThan(0.01)
      // and that entrance is not inside any solid box (boss capsule, scaled)
      const r = 0.42 * BOSS_SCALE
      for (const b of MAPS[mapId].solids) {
        const inside = entrance.x > b.minX - r && entrance.x < b.maxX + r && entrance.z > b.minZ - r && entrance.z < b.maxZ + r && entrance.y + 2.4 > b.minY && entrance.y < b.maxY
        expect(inside, `${mapId} boss entrance inside box ${b.id}`).toBe(false)
      }
    }
  })

  it("StartMatch without a difficulty restarts at the BASE level, not the ramped one", () => {
    const rt = withMap(42, "bellYard", 2, allHumans)
    edit(rt, { fighter: (f) => (f.slotId === 0 ? { ...f, kills: DIFFICULTY_KILLS_PER_STEP * 2 } : f) })
    tickN(rt, 2)
    expect(readSnapshot(rt).difficulty).toBe(4)
    rt.send(Intent, { _tag: "StartMatch", seed: 77 })
    tickN(rt, 3)
    expect(readSnapshot(rt).difficulty).toBe(2)
  })

  it("boss promotion skips a red bot that has a human waiting for its slot", () => {
    const rt = withMap(43, "bellYard", 2)
    edit(rt, { fighter: (f) => (f.slotId === 3 ? { ...f, pendingHumanId: "waiting" } : f), match: (m) => ({ ...m, tickCount: BOSS_SPAWN_TICK - 2 }) })
    tickN(rt, 4)
    const snap = readSnapshot(rt)
    expect(snap.fighters.find((f) => f.slotId === 3)!.isBoss).toBe(false)
    expect(snap.bossSlot).toBe(4)
  })

  it("a human taking over the boss slot keeps their own name after the boss dies", () => {
    const rt = withMap(44, "bellYard", 2)
    edit(rt, { match: (m) => ({ ...m, tickCount: BOSS_SPAWN_TICK - 2 }) })
    tickN(rt, 4)
    edit(rt, { fighter: (f) => (f.slotId === 3 ? { ...f, alive: false, hp: 0, respawnTicksLeft: 2, pendingHumanId: "joiner", pendingHumanName: "Joiner" } : f) })
    tickN(rt, 6)
    const f = readSnapshot(rt).fighters.find((x) => x.slotId === 3)!
    expect(f.name).toBe("Joiner")
    expect(f.isBoss).toBe(false)
  })

  it("a boss kill in foundry does not touch the deposit-driven score", () => {
    const rt = withMap(45, "bellYard", 2, [human(0, "linecaster")], "foundry")
    edit(rt, { match: (m) => ({ ...m, tickCount: BOSS_SPAWN_TICK - 2 }) })
    tickN(rt, 4)
    const bossSlot = readSnapshot(rt).bossSlot
    expect(bossSlot).toBeGreaterThanOrEqual(0)
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
    for (let i = 0; i < 25; i++) {
      edit(rt, { fighter: (f) => (f.slotId === bossSlot && f.alive ? { ...f, x: 0, y: 0, z: -1 } : f) })
      tickN(rt, 1)
    }
    const snap = readSnapshot(rt)
    expect(snap.bossDefeated).toBe(true) // the kill really happened...
    expect(snap.scores[0]).toBeLessThan(BOSS_KILL_SCORE) // ...and gave no flat bonus the next deposit would erase
  })

  it("a wounded bot standing in the mural zone leaves it for the booster instead of patrolling", () => {
    const rt = withMap(46, "bellYard", 2)
    edit(rt, { match: (m) => ({ ...m, healthPickup: { ...m.healthPickup, available: true, respawnTicksLeft: 0 } }) })
    edit(rt, {
      fighter: (f) => {
        // pin the patrol point at (-1.8, -1.2): 2.2 m from the booster, so only a deliberate trip can reach it
        if (f.slotId === 1) return { ...f, x: -3.5, y: 0, z: 0, hp: 20, armor: 0, botStrafeDir: -1, botStrafeTicks: 100000 }
        // everyone else stays dead (no respawn) so nothing can shoot or heal the test bot
        return { ...f, x: -24, y: 0, z: 14 + f.slotId * 0.01, alive: f.slotId === 0, hp: f.slotId === 0 ? f.hp : 0, respawnTicksLeft: 1_000_000 }
      }
    })
    tickN(rt, 400)
    const bot = readSnapshot(rt).fighters.find((f) => f.slotId === 1)!
    expect(bot.alive).toBe(true)
    expect(bot.hp).toBe(20 + HEALTH_PICKUP_HEAL)
  })

  it("bots keep their waypoint instead of flip-flopping: they reach the upper mural on Overprint Hall", () => {
    const rt = withMap(47, "overprintHall", 2)
    const upper = MAPS.overprintHall.muralZones.findIndex((z) => z.y > 1)
    expect(upper).toBeGreaterThanOrEqual(0)
    edit(rt, { match: (m) => ({ ...m, activeMuralId: upper as 0 | 1 | 2 }) })
    edit(rt, { fighter: (f) => (f.slotId === 1 ? { ...f, x: -8, y: 0, z: 0 } : { ...f, x: -24, y: 0, z: 14 + f.slotId * 0.01, alive: f.slotId === 1 }) })
    let maxY = 0
    for (let i = 0; i < 1500; i++) {
      tickN(rt, 1)
      const b = readSnapshot(rt).fighters.find((f) => f.slotId === 1)!
      maxY = Math.max(maxY, b.y)
    }
    expect(maxY).toBeGreaterThan(MAPS.overprintHall.muralZones[upper]!.y - 0.8)
  })

  it("Elite Duel and Extraction always run on Bell Yard, whatever map was requested", () => {
    for (const mode of ["eliteDuel", "extraction"] as const) {
      const rt = withMap(48, "overprintHall", 2, [human(0)], mode as "eliteDuel")
      expect(readSnapshot(rt).mapId).toBe("bellYard")
    }
    expect(readSnapshot(withMap(49, "overprintHall", 2, [human(0)], "foundry")).mapId).toBe("overprintHall")
  })
})
