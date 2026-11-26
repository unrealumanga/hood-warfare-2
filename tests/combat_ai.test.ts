import { describe, expect, it } from "vitest"
import {
  BARREL_MAX_HP,
  DEFAULT_COSMETICS,
  EMPTY_INPUT,
  Fighter,
  GRENADE_FUSE_TICKS,
  GUNS,
  Game,
  Intent,
  KNIFE_DAMAGE_BACKSTAB,
  KNIFE_DAMAGE_FRONT,
  NO_BLOOM,
  PLAYER_EYE_HEIGHT,
  PLAYER_RADIUS,
  PRIMARY_GUN_IDS,
  currentSpreadRad,
  findNearestWaypoint,
  makeMatchRuntime,
  readSnapshot,
  setupSchedule,
  updateSchedule,
  type InitialHumanSpec,
  type MatchRuntime,
  type PlayerInput
} from "../src/sim/index.ts"

function makeAllHumanSpecs(
  primary0: InitialHumanSpec["loadout"]["primary"] = "rollerSmg",
  primary3: InitialHumanSpec["loadout"]["primary"] = "rollerSmg",
  armor3: InitialHumanSpec["loadout"]["armor"] = "light"
): Array<InitialHumanSpec> {
  return Array.from({ length: 6 }, (_, slotId) => ({
    slotId,
    humanId: `h_${slotId}`,
    name: `P${slotId}`,
    loadout: {
      primary: slotId === 0 ? primary0 : slotId === 3 ? primary3 : "rollerSmg",
      armor: slotId === 3 ? armor3 : "light"
    },
    cosmetics: DEFAULT_COSMETICS
  }))
}

function bootMatch(opts: Parameters<typeof makeMatchRuntime>[0] = {}): MatchRuntime {
  const rt = makeMatchRuntime({ seed: 4242, ...opts })
  const res = rt.tick(setupSchedule)
  expect(res.ok).toBe(true)
  return rt
}

let placeSysId = 0

function placeFighter(
  rt: MatchRuntime,
  slotId: number,
  patch: Partial<{ x: number; y: number; z: number; yaw: number; hp: number; armor: number }>
): void {
  const sys = Game.System(
    `Hw2/CombatTestPlace_${placeSysId++}`,
    {
      queries: {
        fighters: Game.Query({ selection: { fighter: Game.Query.write(Fighter) } })
      }
    },
    ({ queries }) => {
      for (const e of queries.fighters.each()) {
        const f = queries.fighters.data.fighter.get(e)
        if (f.slotId === slotId) {
          queries.fighters.data.fighter.set(e, { ...f, ...patch })
        }
      }
    }
  )
  const r = rt.tick(Game.Schedule(sys))
  expect(r.ok).toBe(true)
}

function submit(rt: MatchRuntime, slotId: number, patch: Partial<PlayerInput>): void {
  rt.send(Intent, {
    _tag: "SubmitInput",
    slotId,
    input: { ...EMPTY_INPUT, ...patch }
  })
}

describe("Press Sniper & ADS Scope", () => {
  it("registers Press Sniper with scope and >50x tighter scoped spread vs hipfire", () => {
    expect(PRIMARY_GUN_IDS).toContain("pressSniper")
    const sniper = GUNS.pressSniper
    expect(sniper.hasScope).toBe(true)
    expect(sniper.damage).toBe(95)
    const hip = currentSpreadRad(sniper, NO_BLOOM, 0, false, false, false)
    const scoped = currentSpreadRad(sniper, NO_BLOOM, 0, false, false, true)
    expect(scoped).toBeLessThan(hip / 50)
  })

  it("one-shot headshots even heavy armor when scoped via RMB ADS", () => {
    const rt = bootMatch({ initialHumans: makeAllHumanSpecs("pressSniper", "rollerSmg", "heavy") })
    placeFighter(rt, 0, { x: 0, y: 0, z: 6, yaw: 0 })
    placeFighter(rt, 3, { x: 0, y: 0, z: -6, yaw: Math.PI })

    // Aim directly at enemy head while holding ADS
    const eyeY = PLAYER_EYE_HEIGHT
    const headY = 1.62
    const pitch = Math.atan2(headY - eyeY, 12)
    submit(rt, 0, { seq: 1, yaw: 0, pitch, ads: true, fire: true })
    rt.tick(updateSchedule)
    submit(rt, 0, { seq: 2, yaw: 0, pitch, ads: true, fire: false })

    for (let t = 0; t < 25; t++) rt.tick(updateSchedule)
    const snap = readSnapshot(rt)
    const victim = snap.fighters.find((f) => f.slotId === 3)!
    expect(victim.alive).toBe(false)
    expect(snap.events.some((e) => e.kind === "elim" && e.gunId === "pressSniper" && e.zone === "head")).toBe(true)
  })
})

describe("State-of-the-art NPC Bot AI (Anti-Stuck & Smart Navigation)", () => {
  for (const mapId of ["bellYard", "overprintHall"] as const) {
    for (const difficulty of [1, 6] as const) {
      it(`keeps all bots actively navigating without getting stuck on ${mapId} at difficulty ${difficulty}`, () => {
        const rt = bootMatch({
          seed: 777 + difficulty,
          mapId,
          difficulty,
          initialHumans: [] // all 6 slots are bots!
        })

        const traveled = new Map<number, number>()
        const lastPos = new Map<number, { x: number; z: number }>()
        const visitedWps = new Map<number, Set<number>>()
        const initSnap = readSnapshot(rt)
        for (const f of initSnap.fighters) {
          traveled.set(f.slotId, 0)
          lastPos.set(f.slotId, { x: f.x, z: f.z })
          visitedWps.set(f.slotId, new Set())
        }

        const mapWaypoints = mapId === "bellYard"
          ? readSnapshot(rt).mapId
          : "overprintHall"
        expect(mapWaypoints).toBe(mapId)

        let spreadSum = 0
        let spreadSamples = 0

        for (let t = 0; t < 600; t++) {
          const res = rt.tick(updateSchedule)
          expect(res.ok).toBe(true)
          if (t % 10 === 0) {
            const snap = readSnapshot(rt)
            for (const f of snap.fighters) {
              if (!f.alive) continue
              const prev = lastPos.get(f.slotId)!
              const step = Math.hypot(f.x - prev.x, f.z - prev.z)
              // Ignore respawn teleports
              if (step < 8) traveled.set(f.slotId, (traveled.get(f.slotId) ?? 0) + step)
              lastPos.set(f.slotId, { x: f.x, z: f.z })
              const wp = findNearestWaypoint(f.x, f.y, f.z)
              visitedWps.get(f.slotId)!.add(wp)
            }
            // Measure team spatial dispersion (bots should fan out, not clump on one spot)
            const c0 = snap.fighters.filter((f) => f.crew === 0 && f.alive)
            if (c0.length >= 2) {
              spreadSum += Math.hypot(c0[0]!.x - c0[1]!.x, c0[0]!.z - c0[1]!.z)
              spreadSamples += 1
            }
          }
        }

        for (let slot = 0; slot < 6; slot++) {
          expect(traveled.get(slot)!).toBeGreaterThan(10)
          expect(visitedWps.get(slot)!.size).toBeGreaterThanOrEqual(2)
        }
        expect(spreadSum / Math.max(1, spreadSamples)).toBeGreaterThan(1.5)
      })
    }
  }
})

describe("Frag Grenades [G] & Remote C4 Satchels [B]", () => {
  it("throws ballistic grenade on G, bounces, detonates on fuse, and damages nearby enemies", () => {
    const rt = bootMatch({ initialHumans: makeAllHumanSpecs() })
    placeFighter(rt, 0, { x: 0, y: 0, z: 6, yaw: 0 })
    placeFighter(rt, 3, { x: 0, y: 0, z: 1.5, yaw: Math.PI })

    // Pitch slightly downward so grenade lands right beside slot 3
    submit(rt, 0, { seq: 1, yaw: 0, pitch: -0.35, grenadeActionId: 1 })
    rt.tick(updateSchedule)
    submit(rt, 0, { seq: 2, yaw: 0, pitch: -0.35 })

    let sawThrow = false
    let sawBounce = false
    let sawBlast = false

    for (let t = 0; t < GRENADE_FUSE_TICKS + 5; t++) {
      const snap = readSnapshot(rt)
      if (snap.events.some((e) => e.kind === "grenadeThrow")) sawThrow = true
      if (snap.events.some((e) => e.kind === "grenadeBounce")) sawBounce = true
      if (snap.events.some((e) => e.kind === "grenadeBlast")) sawBlast = true
      if (t === 5) expect(snap.grenades.length).toBe(1)
      rt.tick(updateSchedule)
    }

    const finalSnap = readSnapshot(rt)
    expect(sawThrow).toBe(true)
    expect(sawBounce).toBe(true)
    expect(sawBlast || finalSnap.events.some((e) => e.kind === "grenadeBlast")).toBe(true)
    expect(finalSnap.grenades.length).toBe(0)

    const enemy = finalSnap.fighters.find((f) => f.slotId === 3)!
    expect(enemy.hp + enemy.armor).toBeLessThan(125)
  })

  it("plants sticky C4 Satchel on first B press and remote-detonates on second B press", () => {
    const rt = bootMatch({ initialHumans: makeAllHumanSpecs() })
    placeFighter(rt, 0, { x: 0, y: 0, z: 3, yaw: 0 })
    placeFighter(rt, 3, { x: 0, y: 0, z: 1.8, yaw: Math.PI })

    // 1st press: plant C4 satchel
    submit(rt, 0, { seq: 1, yaw: 0, pitch: -0.6, satchelActionId: 1 })
    rt.tick(updateSchedule)
    const afterPlant = readSnapshot(rt)
    expect(afterPlant.satchels.length).toBe(1)
    expect(afterPlant.events.some((e) => e.kind === "satchelPlant")).toBe(true)

    // Move planter safely back before remote-detonating
    placeFighter(rt, 0, { x: 0, y: 0, z: 12, yaw: 0 })
    submit(rt, 0, { seq: 2, yaw: 0, pitch: 0 })
    for (let t = 0; t < 15; t++) rt.tick(updateSchedule)
    expect(readSnapshot(rt).satchels.length).toBe(1)

    // 2nd press: remote detonate!
    submit(rt, 0, { seq: 3, yaw: 0, pitch: 0, satchelActionId: 2 })
    rt.tick(updateSchedule)

    const afterDet = readSnapshot(rt)
    expect(afterDet.satchels.length).toBe(0)
    expect(afterDet.events.some((e) => e.kind === "satchelBlast")).toBe(true)
    const enemy = afterDet.fighters.find((f) => f.slotId === 3)!
    expect(enemy.alive).toBe(false)
  })
})

describe("Explosive Barrels (Middle Courtyard Fix)", () => {
  it("emits barrelHit sparks on partial hit and detonates at 25 HP damaging nearby fighters", () => {
    const rt = bootMatch({ initialHumans: makeAllHumanSpecs("rollerSmg") })
    const initSnap = readSnapshot(rt)
    const barrel = initSnap.props[0]!
    expect(barrel.hp).toBe(BARREL_MAX_HP)

    // Place shooter 4m south of the middle barrel, and an enemy right next to the barrel
    placeFighter(rt, 0, { x: barrel.x, y: barrel.y, z: barrel.z + 4.0, yaw: 0 })
    placeFighter(rt, 3, { x: barrel.x + 1.4, y: barrel.y, z: barrel.z, yaw: Math.PI })

    // Switch to Proof Pistol (20 dmg < 25 HP -> triggers barrelHit first, then explodes on 2nd shot!)
    submit(rt, 0, { seq: 1, switchSlot: 2, yaw: 0, pitch: -0.25 })
    rt.tick(updateSchedule)

    // Shot 1
    submit(rt, 0, { seq: 2, yaw: 0, pitch: -0.25, fire: true })
    rt.tick(updateSchedule)
    submit(rt, 0, { seq: 3, yaw: 0, pitch: -0.25, fire: false })
    for (let t = 0; t < 15; t++) rt.tick(updateSchedule)

    const midSnap = readSnapshot(rt)
    expect(midSnap.events.some((e) => e.kind === "barrelHit")).toBe(true)
    expect(midSnap.props.find((p) => p.id === barrel.id)!.exploded).toBe(false)

    // Shot 2 -> BOOM!
    submit(rt, 0, { seq: 4, yaw: 0, pitch: -0.25, fire: true })
    rt.tick(updateSchedule)
    submit(rt, 0, { seq: 5, yaw: 0, pitch: -0.25, fire: false })
    for (let t = 0; t < 15; t++) rt.tick(updateSchedule)

    const boomSnap = readSnapshot(rt)
    expect(boomSnap.props.find((p) => p.id === barrel.id)!.exploded).toBe(true)
    expect(boomSnap.events.some((e) => e.kind === "barrelBlast")).toBe(true)
    const victim = boomSnap.fighters.find((f) => f.slotId === 3)!
    expect(victim.hp + victim.armor).toBeLessThan(125)
  })
})

describe("Commando Knife [F / 3] & Unified Ink Parry", () => {
  it("deals 55 front damage, 110 backstab damage, and equips on slot 3", () => {
    const rt = bootMatch({ initialHumans: makeAllHumanSpecs() })
    // Frontal duel: slot 0 faces north (yaw=0), slot 3 faces south (yaw=PI)
    placeFighter(rt, 0, { x: 0, y: 0, z: 2.0, yaw: 0 })
    placeFighter(rt, 3, { x: 0, y: 0, z: 0.4, yaw: Math.PI })

    submit(rt, 0, { seq: 1, yaw: 0, pitch: 0, meleeActionId: 1 })
    rt.tick(updateSchedule)

    const afterFront = readSnapshot(rt)
    expect(afterFront.events.some((e) => e.kind === "knifeSlash")).toBe(true)
    const v1 = afterFront.fighters.find((f) => f.slotId === 3)!
    expect(125 - (v1.hp + v1.armor)).toBe(KNIFE_DAMAGE_FRONT)

    // Backstab test using equipped slot 3 + LMB: slot 3 now faces north (same yaw as attacker!)
    const rt2 = bootMatch({ initialHumans: makeAllHumanSpecs() })
    placeFighter(rt2, 0, { x: 0, y: 0, z: 2.0, yaw: 0 })
    placeFighter(rt2, 3, { x: 0, y: 0, z: 0.4, yaw: 0 })

    submit(rt2, 0, { seq: 1, yaw: 0, pitch: 0, switchSlot: 3 })
    rt2.tick(updateSchedule)
    submit(rt2, 0, { seq: 2, yaw: 0, pitch: 0, fire: true })
    rt2.tick(updateSchedule)

    const afterBack = readSnapshot(rt2)
    expect(afterBack.fighters.find((f) => f.slotId === 0)!.activeSlot).toBe(3)
    const v2 = afterBack.fighters.find((f) => f.slotId === 3)!
    expect(125 - (v2.hp + v2.armor)).toBe(KNIFE_DAMAGE_BACKSTAB)
  })

  it("activates Ink Parry reflection window during Commando Knife slash", () => {
    const rt = bootMatch({ initialHumans: makeAllHumanSpecs("rollerSmg", "linecaster") })
    placeFighter(rt, 0, { x: 0, y: 0, z: 4.0, yaw: 0 })
    placeFighter(rt, 3, { x: 0, y: 0, z: -2.0, yaw: Math.PI })

    submit(rt, 3, { seq: 1, yaw: Math.PI, pitch: 0, fire: true })
    submit(rt, 0, { seq: 1, yaw: 0, pitch: 0, meleeActionId: 1 })
    rt.tick(updateSchedule)
    submit(rt, 3, { seq: 2, yaw: Math.PI, pitch: 0, fire: false })
    submit(rt, 0, { seq: 2, yaw: 0, pitch: 0 })

    let parried = false
    for (let t = 0; t < 20; t++) {
      rt.tick(updateSchedule)
      if (readSnapshot(rt).events.some((e) => e.kind === "parry")) {
        parried = true
        break
      }
    }
    expect(parried).toBe(true)
  })
})

describe("Solid Fighter Body Collision (No Ghost Pass-Through)", () => {
  it("prevents enemies from walking through each other like ghosts", () => {
    const rt = bootMatch({ initialHumans: makeAllHumanSpecs() })
    placeFighter(rt, 0, { x: 0, y: 0, z: 2.0, yaw: 0 })
    placeFighter(rt, 3, { x: 0, y: 0, z: 0.9, yaw: Math.PI })

    // Both sprint head-on into each other for 35 ticks
    for (let t = 1; t <= 35; t++) {
      submit(rt, 0, { seq: t, yaw: 0, moveForward: 1 })
      submit(rt, 3, { seq: t, yaw: Math.PI, moveForward: 1 })
      rt.tick(updateSchedule)
      const snap = readSnapshot(rt)
      const a = snap.fighters.find((f) => f.slotId === 0)!
      const b = snap.fighters.find((f) => f.slotId === 3)!
      const dist = Math.hypot(a.x - b.x, a.z - b.z)
      expect(dist).toBeGreaterThanOrEqual(PLAYER_RADIUS * 2 - 0.06)
    }
  })

  it("gently separates overlapping teammates without locking them together", () => {
    const rt = bootMatch({ initialHumans: makeAllHumanSpecs() })
    placeFighter(rt, 0, { x: 0, y: 0, z: 4.0, yaw: 0 })
    placeFighter(rt, 1, { x: 0.1, y: 0, z: 4.0, yaw: 0 })

    for (let t = 1; t <= 10; t++) {
      submit(rt, 0, { seq: t, yaw: 0 })
      submit(rt, 1, { seq: t, yaw: 0 })
      rt.tick(updateSchedule)
    }
    const snap = readSnapshot(rt)
    const a = snap.fighters.find((f) => f.slotId === 0)!
    const b = snap.fighters.find((f) => f.slotId === 1)!
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(PLAYER_RADIUS * 1.6)
  })
})
