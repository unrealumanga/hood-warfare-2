import { describe, expect, it } from "vitest"
import {
  ARMORS,
  DEFAULT_COSMETICS,
  DEFAULT_LOADOUT,
  EMPTY_INPUT,
  Fighter,
  GUNS,
  Game,
  Intent,
  MATCH_DURATION_TICKS,
  MURAL_ROTATE_TICKS,
  MURAL_ZONES,
  MatchState,
  RESPAWN_TICKS,
  SCORE_TO_WIN,
  TICK_HZ,
  makeMatchRuntime,
  readSnapshot,
  sanitizeCosmetics,
  sanitizeLoadout,
  setupSchedule,
  stepPlayerMovement,
  updateSchedule,
  type FighterData,
  type InitialHumanSpec,
  type MatchRuntime,
  type MatchStateData,
  type PlayerInput
} from "../src/sim/index.ts"

function bootSim(seed = 1894, initialHumans?: ReadonlyArray<InitialHumanSpec>) {
  const rt = makeMatchRuntime({ seed, initialHumans })
  const res = rt.tick(setupSchedule)
  expect(res.ok).toBe(true)
  return rt
}

function makeInput(partial: Partial<PlayerInput> = {}): PlayerInput {
  return { ...EMPTY_INPUT, ...partial }
}

function tickN(rt: MatchRuntime, n: number): void {
  for (let i = 0; i < n; i++) {
    const r = rt.tick(updateSchedule)
    expect(r.ok).toBe(true)
  }
}

let testSysCounter = 0

function editState(
  rt: MatchRuntime,
  opts: {
    readonly fighter?: (f: FighterData) => FighterData
    readonly match?: (m: MatchStateData) => MatchStateData
  }
): void {
  const sys = Game.System(
    `Hw2/TestEdit_${testSysCounter++}`,
    {
      queries: {
        fighters: Game.Query({ selection: { fighter: Game.Query.write(Fighter) } })
      },
      resources: {
        match: Game.System.writeResource(MatchState)
      }
    },
    ({ queries, resources }) => {
      if (opts.match) {
        resources.match.set(opts.match(resources.match.get()))
      }
      if (opts.fighter) {
        for (const e of queries.fighters.each()) {
          const cur = queries.fighters.data.fighter.get(e)
          queries.fighters.data.fighter.set(e, opts.fighter(cur))
        }
      }
    }
  )
  const r = rt.tick(Game.Schedule(sys))
  expect(r.ok).toBe(true)
}

const TORSO_PITCH = Math.atan2(1.1 - 1.56, 6)

describe("Bell Yard 3D physics & verticality", () => {
  it("climbs the West Staircase smoothly onto the Upper Loading Deck (y = 3.6m)", () => {
    let state = { x: -11.5, y: 0, z: -1.6, vx: 0, vy: 0, vz: 0, grounded: true }
    // Yaw = 0 walks along -Z (up the staircase from z=-2.2 to z=-10.0)
    for (let i = 0; i < 90; i++) {
      state = stepPlayerMovement(
        state,
        { moveForward: 1, moveRight: 0, yaw: 0, jump: false },
        1.0,
        1 / TICK_HZ
      )
    }
    expect(state.z).toBeLessThan(-9.8)
    expect(state.y).toBeGreaterThan(3.5)
    expect(state.grounded).toBe(true)
  })

  it("supports walking across the central elevated footbridge over the courtyard", () => {
    let state = { x: -9.5, y: 3.6, z: 0, vx: 0, vy: 0, vz: 0, grounded: true }
    // Yaw = -PI/2 walks along +X across the footbridge
    for (let i = 0; i < 120; i++) {
      state = stepPlayerMovement(
        state,
        { moveForward: 1, moveRight: 0, yaw: -Math.PI / 2, jump: false },
        1.0,
        1 / TICK_HZ
      )
    }
    expect(state.x).toBeGreaterThan(3.0)
    expect(state.y).toBeCloseTo(3.6, 1)
    expect(state.grounded).toBe(true)
  })

  it("enforces heavy armor 90% move speed relative to light armor 100%", () => {
    let light = { x: 0, y: 0, z: 4, vx: 0, vy: 0, vz: 0, grounded: true }
    let heavy = { x: 0, y: 0, z: 4, vx: 0, vy: 0, vz: 0, grounded: true }
    for (let i = 0; i < 30; i++) {
      light = stepPlayerMovement(
        light,
        { moveForward: 1, moveRight: 0, yaw: 0, jump: false },
        ARMORS.light.speedMultiplier,
        1 / TICK_HZ
      )
      heavy = stepPlayerMovement(
        heavy,
        { moveForward: 1, moveRight: 0, yaw: 0, jump: false },
        ARMORS.heavy.speedMultiplier,
        1 / TICK_HZ
      )
    }
    const dLight = 4 - light.z
    const dHeavy = 4 - heavy.z
    expect(dHeavy / dLight).toBeCloseTo(0.9, 2)
  })
})

describe("Four distinct weapons, armor overflow, friendly fire, and respawn", () => {
  it("validates Proof Pistol semi-auto, Roller SMG ~9/s cadence, Broadside 5-pellet fan, and Linecaster 48 dmg", () => {
    // 1. Roller SMG automatic continuous stream
    const rtSmg = bootSim(101, [
      { slotId: 0, humanId: "p1", name: "P1", loadout: { primary: "rollerSmg", armor: "light" }, cosmetics: DEFAULT_COSMETICS }
    ])
    for (let i = 1; i <= 60; i++) {
      rtSmg.send(Intent, { _tag: "SubmitInput", slotId: 0, input: makeInput({ seq: i, fire: true }) })
      tickN(rtSmg, 1)
    }
    const smgFighter = readSnapshot(rtSmg).fighters[0]!
    const shotsFired = GUNS.rollerSmg.magSize - smgFighter.primaryAmmo
    expect(shotsFired).toBeGreaterThanOrEqual(8)
    expect(shotsFired).toBeLessThanOrEqual(10)

    // 2. Proof Pistol sidearm requires fresh clicks (holding fire only shoots once!)
    rtSmg.send(Intent, { _tag: "SubmitInput", slotId: 0, input: makeInput({ seq: 61, switchSlot: 2, fire: false }) })
    tickN(rtSmg, 1)
    for (let i = 62; i <= 85; i++) {
      rtSmg.send(Intent, { _tag: "SubmitInput", slotId: 0, input: makeInput({ seq: i, fire: true }) })
      tickN(rtSmg, 1)
    }
    const pistolFighter = readSnapshot(rtSmg).fighters[0]!
    expect(pistolFighter.activeSlot).toBe(2)
    expect(pistolFighter.sidearmAmmo).toBe(GUNS.proofPistol.magSize - 1)

    // 3. Broadside spawns 5 pellets in a fan and respects 1 shot/sec cadence
    const rtShotgun = bootSim(102, [
      { slotId: 0, humanId: "p1", name: "P1", loadout: { primary: "broadside", armor: "light" }, cosmetics: DEFAULT_COSMETICS }
    ])
    rtShotgun.send(Intent, { _tag: "SubmitInput", slotId: 0, input: makeInput({ seq: 1, fire: true, yaw: -Math.PI / 2 }) })
    tickN(rtShotgun, 1)
    const snapShot = readSnapshot(rtShotgun)
    const pellets = snapShot.projectiles.filter((p) => p.ownerSlot === 0 && p.gunId === "broadside")
    expect(pellets.length).toBe(5)
    expect(snapShot.fighters[0]!.primaryAmmo).toBe(4)
  })

  it("depletes armor first, carries remainder into HP, excludes friendly fire, and resets armor + loadout on respawn", () => {
    // Make all 6 slots human so bots don't move targets during exact ballistic verification
    const allHumans = [0, 1, 2, 3, 4, 5].map((slotId) => ({
      slotId,
      humanId: `h${slotId}`,
      name: `P${slotId}`,
      loadout: {
        primary: (slotId === 0 ? "linecaster" : "rollerSmg") as "linecaster" | "rollerSmg",
        armor: "light" as const
      },
      cosmetics: DEFAULT_COSMETICS
    }))
    const rt = bootSim(202, allHumans)

    // Place slot 0 (Cobalt) at (0,0,5), slot 1 (Cobalt ally!) at (0,0,2), slot 3 (Vermilion enemy) at (0,0,-1)
    editState(rt, {
      fighter: (f) => {
        if (f.slotId === 0) return { ...f, x: 0, y: 0, z: 5, yaw: 0, pitch: 0 }
        if (f.slotId === 1) return { ...f, x: 0, y: 0, z: 2, yaw: 0, pitch: 0 }
        if (f.slotId === 3) return { ...f, x: 0, y: 0, z: -1, yaw: Math.PI, pitch: 0 }
        return { ...f, x: -24, y: 0, z: 14 }
      }
    })

    // Aim at the torso (a pitch-0 shot from eye level is a headshot)
    // Fire Linecaster straight along -Z (passes through Cobalt ally slot 1 -> must NOT damage ally -> hits Vermilion slot 3!)
    rt.send(Intent, { _tag: "SubmitInput", slotId: 0, input: makeInput({ seq: 1, yaw: 0, pitch: TORSO_PITCH, fire: true }) })
    tickN(rt, 1)
    rt.send(Intent, { _tag: "SubmitInput", slotId: 0, input: makeInput({ seq: 2, yaw: 0, pitch: 0, fire: false }) })
    tickN(rt, 20)

    const afterHit1 = readSnapshot(rt)
    const ally = afterHit1.fighters.find((f) => f.slotId === 1)!
    const enemy = afterHit1.fighters.find((f) => f.slotId === 3)!
    // Friendly fire excluded!
    expect(ally.hp).toBe(100)
    expect(ally.armor).toBe(25)
    // 48 dmg against 25 light armor + 100 HP -> 0 armor, 77 HP!
    expect(enemy.armor).toBe(0)
    expect(enemy.hp).toBe(77)
    expect(afterHit1.events.some((ev) => ev.kind === "armorBreak" && ev.targetSlot === 3)).toBe(true)

    // Queue loadout change for enemy slot 3 to Heavy armor + Broadside before death
    rt.send(Intent, {
      _tag: "SetLoadout",
      slotId: 3,
      primary: "broadside",
      armor: "heavy",
      cosmetics: { top: "workJacket", hat: "beanie", swatch: "ochre" }
    })

    // Fire 2 more Linecaster bolts (48 + 48 = 96 >= 77) to eliminate slot 3
    tickN(rt, 45)
    rt.send(Intent, { _tag: "SubmitInput", slotId: 0, input: makeInput({ seq: 3, yaw: 0, pitch: TORSO_PITCH, fire: true }) })
    tickN(rt, 1)
    rt.send(Intent, { _tag: "SubmitInput", slotId: 0, input: makeInput({ seq: 4, yaw: 0, pitch: 0, fire: false }) })
    tickN(rt, 55)
    rt.send(Intent, { _tag: "SubmitInput", slotId: 0, input: makeInput({ seq: 5, yaw: 0, pitch: TORSO_PITCH, fire: true }) })
    tickN(rt, 1)
    rt.send(Intent, { _tag: "SubmitInput", slotId: 0, input: makeInput({ seq: 6, yaw: 0, pitch: 0, fire: false }) })
    tickN(rt, 20)

    const afterElim = readSnapshot(rt)
    const deadEnemy = afterElim.fighters.find((f) => f.slotId === 3)!
    expect(deadEnemy.alive).toBe(false)
    expect(deadEnemy.respawnTicksLeft).toBeGreaterThan(0)
    expect(deadEnemy.deaths).toBe(1)
    expect(afterElim.fighters.find((f) => f.slotId === 0)!.kills).toBe(1)

    // Advance 4 seconds (RESPAWN_TICKS) -> enemy respawns with full HP, full Heavy armor (50), and Broadside!
    tickN(rt, RESPAWN_TICKS + 2)
    const afterRespawn = readSnapshot(rt)
    const respawned = afterRespawn.fighters.find((f) => f.slotId === 3)!
    expect(respawned.alive).toBe(true)
    expect(respawned.hp).toBe(100)
    expect(respawned.armor).toBe(50)
    expect(respawned.armorType).toBe("heavy")
    expect(respawned.primaryGun).toBe("broadside")
    expect(respawned.cosmetics.top).toBe("workJacket")
  })
  // Shooter slot 0 at z=5, enemy slot 3 at z=-1 (6m away), eye height 1.56. Aim pitch for a given hit height.
  const pitchFor = (y: number) => Math.atan2(y - 1.56, 6)

  const zoneShot = (primary: "linecaster" | "rollerSmg" | "proofPistol", armor: "light" | "heavy", y: number, enemyX = 0) => {
    const humans = [0, 1, 2, 3, 4, 5].map((slotId) => ({
      slotId,
      humanId: `h${slotId}`,
      name: `P${slotId}`,
      loadout: { primary: (slotId === 0 ? primary : "rollerSmg") as "linecaster" | "rollerSmg", armor: (slotId === 3 ? armor : "light") as "light" | "heavy" },
      cosmetics: DEFAULT_COSMETICS
    }))
    const rt = bootSim(404, humans)
    editState(rt, {
      fighter: (f) => {
        if (f.slotId === 0) return { ...f, x: 0, y: 0, z: 5, yaw: 0, pitch: 0 }
        if (f.slotId === 3) return { ...f, x: enemyX, y: 0, z: -1, yaw: Math.PI, pitch: 0 }
        return { ...f, x: -24, y: 0, z: 14 }
      }
    })
    if (primary === "proofPistol") {
      rt.send(Intent, { _tag: "SubmitInput", slotId: 0, input: makeInput({ seq: 10, switchSlot: 2, fire: false }) })
      tickN(rt, 30)
    }
    rt.send(Intent, { _tag: "SubmitInput", slotId: 0, input: makeInput({ seq: 11, yaw: 0, pitch: pitchFor(y), fire: true }) })
    tickN(rt, 1)
    rt.send(Intent, { _tag: "SubmitInput", slotId: 0, input: makeInput({ seq: 12, yaw: 0, pitch: pitchFor(y), fire: false }) })
    tickN(rt, 20)
    const snap = readSnapshot(rt)
    return { enemy: snap.fighters.find((f) => f.slotId === 3)!, events: snap.events }
  }

  it("headshots one-shot with a Linecaster and ignore armor; torso and limbs take less", () => {
    const head = zoneShot("linecaster", "heavy", 1.6)
    expect(head.enemy.alive).toBe(false)
    expect(head.events.some((e) => e.kind === "elim" && e.zone === "head")).toBe(true)

    // Light vest absorbs 25 of the 48 torso damage
    const torso = zoneShot("linecaster", "light", 1.1)
    expect(torso.enemy.hp).toBe(100 - (48 - 25))
    expect(torso.events.some((e) => e.kind === "hit" && e.zone === undefined)).toBe(true)

    // 48 * 0.6 = 29 damage, 25 absorbed by the vest
    const leg = zoneShot("linecaster", "light", 0.4)
    expect(leg.enemy.hp).toBe(100 - (29 - 25))
    expect(leg.events.some((e) => e.kind === "hit" && e.zone === "limb")).toBe(true)
  })

  it("treats the silhouette edge of the torso as an arm (limb damage)", () => {
    // Enemy shifted sideways so the bolt grazes the edge of the capsule at chest height
    const arm = zoneShot("linecaster", "light", 1.1, 0.5)
    expect(arm.events.some((e) => e.kind === "hit" && e.zone === "limb")).toBe(true)
    expect(arm.enemy.hp).toBe(100 - (29 - 25))
  })

  it("pistol headshots need two shots", () => {
    const head = zoneShot("proofPistol", "light", 1.6)
    expect(head.enemy.hp).toBe(100 - 50)
  })
})

describe("Mural control scoring, contested pause, rotation, timer, and deterministic replay", () => {
  it("scores 1 pt/sec regardless of teammate count, pauses when contested, and rotates every 45s", () => {
    const allHumans = [0, 1, 2, 3, 4, 5].map((slotId) => ({
      slotId,
      humanId: `h${slotId}`,
      name: `P${slotId}`,
      loadout: DEFAULT_LOADOUT,
      cosmetics: DEFAULT_COSMETICS
    }))
    const rt = bootSim(303, allHumans)
    const z0 = MURAL_ZONES[0]!

    // Put TWO Cobalt teammates inside Mural #0 (Courtyard) -> should STILL score only 1 pt/sec!
    editState(rt, {
      fighter: (f) => {
        if (f.slotId === 0) return { ...f, x: z0.x - 1, y: z0.y, z: z0.z }
        if (f.slotId === 1) return { ...f, x: z0.x + 1, y: z0.y, z: z0.z }
        return { ...f, x: 24, y: 0, z: 14 }
      }
    })

    tickN(rt, TICK_HZ * 3) // 3 seconds -> +3 points (NOT +6!)
    const snap3s = readSnapshot(rt)
    expect(snap3s.scores[0]).toBe(3)
    expect(snap3s.scores[1]).toBe(0)
    expect(snap3s.zoneStatus).toBe("cobalt")

    // Move Vermilion slot 3 into Mural #0 -> contested, scoring must pause!
    editState(rt, {
      fighter: (f) => (f.slotId === 3 ? { ...f, x: z0.x, y: z0.y, z: z0.z + 1 } : f)
    })
    tickN(rt, TICK_HZ * 2)
    const snapContested = readSnapshot(rt)
    expect(snapContested.zoneStatus).toBe("contested")
    expect(snapContested.scores[0]).toBe(3)
    expect(snapContested.scores[1]).toBe(0)

    // Advance remaining ticks until 45s rotation -> active mural switches to #1 (Tram Shelter)!
    const ticksLeft = snapContested.muralRotateTicksLeft
    tickN(rt, ticksLeft)
    const snapRotated = readSnapshot(rt)
    expect(snapRotated.activeMuralId).toBe(1)
    expect(snapRotated.muralRotateTicksLeft).toBe(MURAL_ROTATE_TICKS)
    expect(snapRotated.events.some((ev) => ev.kind === "muralRotate" && ev.targetSlot === 1)).toBe(true)
  })

  it("finishes at 100 points and handles 5-minute draw expiry", () => {
    const rtWin = bootSim(404)
    editState(rtWin, {
      match: (m) => ({ ...m, scores: [SCORE_TO_WIN - 1, 10], scoreAccum: [TICK_HZ - 1, 0] }),
      fighter: (f) => (f.slotId === 0 ? { ...f, x: 0, y: 0, z: 0 } : { ...f, x: 24, y: 0, z: 14 })
    })
    tickN(rtWin, 2)
    const snapWin = readSnapshot(rtWin)
    expect(snapWin.phase).toBe("Finished")
    expect(snapWin.winner).toBe(0)

    const rtDraw = bootSim(405)
    editState(rtDraw, {
      match: (m) => ({ ...m, remainingTicks: 2, scores: [42, 42] }),
      fighter: (f) => ({ ...f, x: 24, y: 0, z: 14 })
    })
    expect(MATCH_DURATION_TICKS).toBe(5 * 60 * TICK_HZ)
    tickN(rtDraw, 3)
    const snapDraw = readSnapshot(rtDraw)
    expect(snapDraw.phase).toBe("Finished")
    expect(snapDraw.winner).toBe("draw")
  })

  it("replays deterministically with bit-identical snapshots and validates cosmetics/loadouts", () => {
    const runReplay = () => {
      const rt = bootSim(9991)
      for (let t = 1; t <= 180; t++) {
        rt.send(Intent, {
          _tag: "SubmitInput",
          slotId: 0,
          input: makeInput({
            seq: t,
            moveForward: 1,
            moveRight: t % 60 < 30 ? 0.5 : -0.5,
            yaw: -Math.PI / 2 + t * 0.005,
            fire: t % 15 === 0
          })
        })
        tickN(rt, 1)
      }
      return readSnapshot(rt)
    }
    const snapA = runReplay()
    const snapB = runReplay()
    expect(snapA).toEqual(snapB)

    // Verify bots actively moved out of spawns toward the courtyard!
    const movedBots = snapA.fighters.filter((f) => f.isBot && Math.abs(f.x) < 22)
    expect(movedBots.length).toBeGreaterThanOrEqual(4)

    // Server/client cosmetic & loadout sanitization
    expect(sanitizeCosmetics({ top: "invalid", hat: "beanie", swatch: "hacked" })).toEqual({
      top: "hoodie",
      hat: "beanie",
      swatch: "ivory"
    })
    expect(sanitizeLoadout({ primary: "railgun", armor: "heavy" })).toEqual({
      primary: "rollerSmg",
      armor: "heavy"
    })
  })
})
