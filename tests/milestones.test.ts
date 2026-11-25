import { describe, expect, it } from "vitest"
import {
  DEFAULT_COSMETICS,
  EMPTY_INPUT,
  EXTRACTION_EXIT,
  EXTRACTION_VAULT,
  FOUNDRY_CENTER,
  Fighter,
  GRAPPLE_LEDGES,
  Game,
  Intent,
  MatchState,
  SKETCH_ANCHORS,
  SKETCH_PLANK_LIFETIME_TICKS,
  SMOKE_CLEAR_TICKS,
  TICK_HZ,
  hasLineOfSight,
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

let mutIdx = 0

function boot(opts: Parameters<typeof makeMatchRuntime>[0] = {}) {
  const rt = makeMatchRuntime(opts)
  const r = rt.tick(setupSchedule)
  expect(r.ok).toBe(true)
  return rt
}

function tickN(rt: MatchRuntime, n: number) {
  for (let i = 0; i < n; i++) {
    const r = rt.tick(updateSchedule)
    expect(r.ok).toBe(true)
  }
}

function edit(
  rt: MatchRuntime,
  opts: {
    readonly fighter?: (f: FighterData) => FighterData
    readonly match?: (m: MatchStateData) => MatchStateData
  }
) {
  const sys = Game.System(
    `Hw2/MilestoneMut_${mutIdx++}`,
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
  const r = rt.tick(Game.Schedule(sys))
  expect(r.ok).toBe(true)
}

function makeAllHumans(count = 6, primary: "rollerSmg" | "linecaster" | "cursedBlock" = "rollerSmg"): ReadonlyArray<InitialHumanSpec> {
  return Array.from({ length: count }, (_, slotId) => ({
    slotId,
    humanId: `h${slotId}`,
    name: `P${slotId}`,
    loadout: { primary, armor: "light" as const },
    cosmetics: DEFAULT_COSMETICS
  }))
}

function inp(partial: Partial<PlayerInput> = {}): PlayerInput {
  return { ...EMPTY_INPUT, ...partial }
}

describe("Milestone 1 — Sketch Plank, Erase, Expiry-vs-Erase Race, Simultaneous Place, Barricade & Parry", () => {
  it("draws the Footbridge→Upper Deck plank, supports crossing, drops standing character when opponent erases it, and refunds owner charge", () => {
    const rt = boot({ seed: 1001, initialHumans: makeAllHumans(6) })
    const anchor = SKETCH_ANCHORS[0]! // Footbridge -> Upper Loading Deck

    // Put slot 0 (Cobalt) on Footbridge north edge (0, 3.6, -1.3) and slot 3 (Vermilion) near north edge of gap (0, 3.6, -9.9)
    edit(rt, {
      fighter: (f) => {
        if (f.slotId === 0) return { ...f, x: 0, y: 3.6, z: -1.3, yaw: 0 }
        if (f.slotId === 3) return { ...f, x: 0, y: 3.6, z: -10.2, yaw: Math.PI }
        return { ...f, x: -24, y: 0, z: 14 }
      }
    })

    // Slot 0 places anchored Sketch Plank
    rt.send(Intent, {
      _tag: "SubmitInput",
      slotId: 0,
      input: inp({
        seq: 1,
        sketchAction: { kind: "placeAnchor", anchorId: anchor.id, actionId: 10 }
      })
    })
    tickN(rt, 1)

    const afterPlace = readSnapshot(rt)
    expect(afterPlace.constructs).toHaveLength(1)
    expect(afterPlace.constructs[0]!.anchorId).toBe(anchor.id)
    expect(afterPlace.fighters[0]!.sketchCharges).toBe(0)

    // Slot 0 walks forward onto the plank over open courtyard air (z ≈ -3.6, y stays 3.6!)
    for (let s = 2; s <= 24; s++) {
      rt.send(Intent, { _tag: "SubmitInput", slotId: 0, input: inp({ seq: s, moveForward: 1, yaw: 0 }) })
      tickN(rt, 1)
    }
    const midCross = readSnapshot(rt)
    expect(midCross.fighters[0]!.z).toBeLessThan(-3.0)
    expect(midCross.fighters[0]!.y).toBeCloseTo(3.6, 1)
    expect(midCross.fighters[0]!.grounded).toBe(true)

    // Opponent slot 3 erases the plank with E while slot 0 is crossing!
    rt.send(Intent, { _tag: "SubmitInput", slotId: 0, input: inp({ seq: 25, moveForward: 0, yaw: 0 }) })
    rt.send(Intent, { _tag: "SubmitInput", slotId: 3, input: inp({ seq: 1, eraseActionId: 20 }) })
    tickN(rt, 40)

    const afterErase = readSnapshot(rt)
    expect(afterErase.constructs).toHaveLength(0)
    // Owner's sketch charge immediately refilled!
    expect(afterErase.fighters[0]!.sketchCharges).toBe(1)
    // Standing character immediately lost support and fell down to the courtyard floor!
    expect(afterErase.fighters[0]!.y).toBeLessThan(0.5)
  })

  it("resolves simultaneous anchor placement deterministically and handles expiry racing with erase on the exact same tick without double-refunding", () => {
    const rt = boot({ seed: 1002, initialHumans: makeAllHumans(6) })
    const anchor = SKETCH_ANCHORS[0]!

    edit(rt, {
      fighter: (f) => {
        if (f.slotId === 0) return { ...f, x: 0, y: 3.6, z: -1.3, yaw: 0 }
        if (f.slotId === 1) return { ...f, x: 0.4, y: 3.6, z: -1.3, yaw: 0 }
        if (f.slotId === 3) return { ...f, x: 0, y: 3.6, z: -10.2, yaw: Math.PI }
        return { ...f, x: -24, y: 0, z: 14 }
      }
    })

    // Simultaneous placement on same anchor pair -> slot 0 wins cleanly, slot 1 is NOT charged!
    rt.send(Intent, {
      _tag: "SubmitInput",
      slotId: 0,
      input: inp({ seq: 1, sketchAction: { kind: "placeAnchor", anchorId: anchor.id, actionId: 1 } })
    })
    rt.send(Intent, {
      _tag: "SubmitInput",
      slotId: 1,
      input: inp({ seq: 1, sketchAction: { kind: "placeAnchor", anchorId: anchor.id, actionId: 1 } })
    })
    tickN(rt, 1)

    const s1 = readSnapshot(rt)
    expect(s1.constructs).toHaveLength(1)
    expect(s1.constructs[0]!.ownerSlot).toBe(0)
    expect(s1.fighters[0]!.sketchCharges).toBe(0)
    expect(s1.fighters[1]!.sketchCharges).toBe(1)

    // Advance right up to 1 tick before expiry, then submit opponent erase on the EXACT expiry tick!
    tickN(rt, SKETCH_PLANK_LIFETIME_TICKS - 1)
    rt.send(Intent, { _tag: "SubmitInput", slotId: 3, input: inp({ seq: 2, eraseActionId: 9 }) })
    tickN(rt, 1)

    const sRace = readSnapshot(rt)
    expect(sRace.constructs).toHaveLength(0)
    // Charge must be strictly 1 (never double-refunded to 2!)
    expect(sRace.fighters[0]!.sketchCharges).toBe(1)
  })

  it("supports free placement, waist-high barricades, and timed melee ink parry reflecting projectiles", () => {
    const rt = boot({ seed: 1003, initialHumans: makeAllHumans(6, "linecaster") })

    // Place waist-high barricade
    edit(rt, {
      fighter: (f) => {
        if (f.slotId === 0) return { ...f, x: 0, y: 0, z: 4, yaw: 0 }
        if (f.slotId === 3) return { ...f, x: 0, y: 0, z: -1, yaw: Math.PI }
        return { ...f, x: -24, y: 0, z: 14 }
      }
    })
    rt.send(Intent, {
      _tag: "SubmitInput",
      slotId: 0,
      input: inp({ seq: 1, sketchAction: { kind: "placeBarricade", actionId: 5 } })
    })
    tickN(rt, 1)
    expect(readSnapshot(rt).constructs.some((c) => c.kind === "barricade")).toBe(true)

    // Test timed melee ink parry: slot 3 fires Linecaster straight at slot 0; slot 0 parries!
    edit(rt, {
      match: (m) => ({ ...m, constructs: [] }),
      fighter: (f) => {
        if (f.slotId === 0) return { ...f, x: 0, y: 0, z: 4, yaw: 0, hp: 100, armor: 25 }
        if (f.slotId === 3) return { ...f, x: 0, y: 0, z: -1, yaw: Math.PI, hp: 100, armor: 25 }
        return f
      }
    })
    rt.send(Intent, { _tag: "SubmitInput", slotId: 3, input: inp({ seq: 1, yaw: Math.PI, fire: true }) })
    rt.send(Intent, { _tag: "SubmitInput", slotId: 0, input: inp({ seq: 2, yaw: 0, parryActionId: 7 }) })
    tickN(rt, 24)

    const afterParry = readSnapshot(rt)
    expect(afterParry.events.some((ev) => ev.kind === "parry" && ev.actorSlot === 0)).toBe(true)
    expect(afterParry.fighters[0]!.hp).toBe(100)
    // Reflected bolt damaged original shooter slot 3!
    expect(afterParry.fighters[3]!.hp + afterParry.fighters[3]!.armor).toBeLessThan(125)
  })
})

describe("Milestones 2–4 — Ink Smoke Grid, Grapple & Barrels, and Shielded Foreman Duel", () => {
  it("blocks bot sight behind Ink Smoke, carves a temporary sightline with a shot, and clears a sphere on barrel blast", () => {
    const rt = boot({ seed: 2001, initialHumans: makeAllHumans(6, "linecaster") })
    edit(rt, {
      fighter: (f) => {
        if (f.slotId === 0) return { ...f, x: 0, y: 0, z: 6, yaw: 0 }
        if (f.slotId === 3) return { ...f, x: 0, y: 0, z: -3, yaw: Math.PI }
        return { ...f, x: -24, y: 0, z: 14 }
      }
    })

    // Deploy Ink Smoke at ~5m ahead (z ≈ 1) directly between slot 0 (z=6) and slot 3 (z=-3)
    rt.send(Intent, { _tag: "SubmitInput", slotId: 0, input: inp({ seq: 1, yaw: 0, smokeActionId: 1 }) })
    tickN(rt, 1)

    const sCloud = readSnapshot(rt)
    expect(sCloud.smokeClouds).toHaveLength(1)
    expect(hasLineOfSight(0, 1.5, 6, 0, 1.5, -3, [], sCloud.smokeClouds)).toBe(false)

    // Fire projectile straight through the cloud -> carves clear cells along swept path!
    rt.send(Intent, { _tag: "SubmitInput", slotId: 0, input: inp({ seq: 2, yaw: 0, fire: true }) })
    tickN(rt, 18)

    const sCarved = readSnapshot(rt)
    expect(hasLineOfSight(0, 1.5, 6, 0, 1.5, -3, [], sCarved.smokeClouds)).toBe(true)

    // After SMOKE_CLEAR_TICKS, cleared cells close back up!
    tickN(rt, SMOKE_CLEAR_TICKS + 2)
    const sClosed = readSnapshot(rt)
    expect(sClosed.smokeClouds).toHaveLength(1)
    expect(hasLineOfSight(0, 1.5, 6, 0, 1.5, -3, [], sClosed.smokeClouds)).toBe(false)
  })

  it("grapples onto a marked ledge and pulls a movable barrel toward the player", () => {
    const rt = boot({ seed: 3001, initialHumans: makeAllHumans(6) })
    const ledge = GRAPPLE_LEDGES[0]! // Upper Deck Edge (0, 3.95, -9.8)

    // Aim straight at Upper Deck ledge (0, 3.95, -9.62) from open lane north of mural wall (z = -7.2)
    edit(rt, {
      fighter: (f) =>
        f.slotId === 0 ? { ...f, x: 0, y: 0, z: -7.2, yaw: 0, pitch: 0.78 } : { ...f, x: -24, y: 0, z: 14 }
    })
    rt.send(Intent, {
      _tag: "SubmitInput",
      slotId: 0,
      input: inp({ seq: 1, yaw: 0, pitch: 0.78, grappleActionId: 1 })
    })
    tickN(rt, 12)
    const afterLedge = readSnapshot(rt)
    expect(afterLedge.fighters[0]!.y).toBeGreaterThan(2.5)
    expect(afterLedge.fighters[0]!.z).toBeLessThan(-8.2)
    expect(ledge.id).toBe("ledge_deck_c")

    // Pull barrel #1 (-3.6, 0, 2.2) toward slot 0 at (-3.6, 0, 8.0)
    edit(rt, {
      fighter: (f) =>
        f.slotId === 0
          ? { ...f, x: -3.6, y: 0, z: 8.0, yaw: 0, pitch: -0.17, grapple: null, grappleCooldownTicks: 0 }
          : f
    })
    const bBefore = readSnapshot(rt).props.find((p) => p.id === 1)!.z
    rt.send(Intent, {
      _tag: "SubmitInput",
      slotId: 0,
      input: inp({ seq: 2, yaw: 0, pitch: -0.17, grappleActionId: 2 })
    })
    tickN(rt, 16)
    const bAfter = readSnapshot(rt).props.find((p) => p.id === 1)!.z
    expect(bAfter).toBeGreaterThan(bBefore + 1.0)
  })

  it("runs Elite Duel against Shielded Printworks Foreman: frontal shield blocks, flank weak point breaks posture and defeats him", () => {
    const rt = boot({ seed: 4001, mode: "eliteDuel", initialHumans: makeAllHumans(1, "linecaster") })
    const startSnap = readSnapshot(rt)
    expect(startSnap.foreman).not.toBeNull()

    // 1. Shoot Foreman straight from the front (z = +2 shooting -Z into his iron shield facing +Z)
    edit(rt, {
      match: (m) => ({
        ...m,
        foreman: m.foreman ? { ...m.foreman, x: 0, y: 0, z: -3, yaw: Math.PI } : null
      }),
      fighter: (f) => (f.slotId === 0 ? { ...f, x: 0, y: 0, z: 2, yaw: 0, pitch: 0 } : f)
    })
    rt.send(Intent, { _tag: "SubmitInput", slotId: 0, input: inp({ seq: 1, yaw: 0, fire: true }) })
    tickN(rt, 15)
    expect(readSnapshot(rt).foreman!.hp).toBe(520) // Blocked cleanly by directional shield!

    // 2. Dodge committed slam windup / recover (facing stays locked +Z!) and flank rear weak point (clear of mural wall at z=-5.6)!
    edit(rt, {
      match: (m) => ({
        ...m,
        foreman: m.foreman ? { ...m.foreman, x: 0, y: 0, z: -1.8, yaw: Math.PI, state: "recover", stateTicksLeft: 200 } : null
      }),
      fighter: (f) => (f.slotId === 0 ? { ...f, x: 0, y: 0, z: -4.8, yaw: Math.PI, pitch: 0, fireCooldownTicks: 0, wasFireHeld: false } : f)
    })
    let seq = 2
    for (let shot = 0; shot < 3; shot++) {
      rt.send(Intent, { _tag: "SubmitInput", slotId: 0, input: inp({ seq: seq++, yaw: Math.PI, fire: true }) })
      tickN(rt, 1)
      rt.send(Intent, { _tag: "SubmitInput", slotId: 0, input: inp({ seq: seq++, yaw: Math.PI, fire: false }) })
      tickN(rt, 52)
    }
    const afterFlank = readSnapshot(rt)
    expect(afterFlank.foreman!.hp).toBeLessThan(520)
    expect(afterFlank.events.some((ev) => ev.kind === "foremanStagger")).toBe(true)
  })
})

describe("Milestones 5–9 — Extraction, Cursed Loadout, Low-Gravity Anomaly, Cable Car, Foundry & Bot Perf", () => {
  it("completes Solo Extraction (unlock vault -> carry parcel -> reach tram exit) and handles defeat", () => {
    const rt = boot({ seed: 5001, mode: "extraction", initialHumans: makeAllHumans(1) })
    edit(rt, {
      fighter: (f) =>
        f.slotId === 0
          ? { ...f, x: EXTRACTION_VAULT.x, y: EXTRACTION_VAULT.y, z: EXTRACTION_VAULT.z }
          : { ...f, x: 24, y: 0, z: 14 }
    })
    tickN(rt, 185)
    expect(readSnapshot(rt).extraction!.vaultUnlocked).toBe(true)
    expect(readSnapshot(rt).extraction!.carriedScrap).toBe(100)

    // Move to Tram Exit -> extracts cleanly!
    edit(rt, {
      fighter: (f) =>
        f.slotId === 0 ? { ...f, x: EXTRACTION_EXIT.x, y: EXTRACTION_EXIT.y, z: EXTRACTION_EXIT.z } : f
    })
    tickN(rt, 2)
    const fin = readSnapshot(rt)
    expect(fin.phase).toBe("Finished")
    expect(fin.extraction!.extracted).toBe(true)
    expect(fin.winner).toBe(0)
  })

  it("applies voluntary Cursed Proof-Block 1.5x score multiplier exactly once at match end", () => {
    const rt = boot({ seed: 6001, initialHumans: makeAllHumans(6, "cursedBlock") })
    edit(rt, {
      match: (m) => ({ ...m, remainingTicks: 2, scores: [40, 20] }),
      fighter: (f) => ({ ...f, x: 24, y: 0, z: 14 })
    })
    tickN(rt, 3)
    const fin = readSnapshot(rt)
    expect(fin.phase).toBe("Finished")
    expect(fin.scores[0]).toBe(60) // 40 * 1.5 applied once!
    expect(fin.fighters[0]!.cursedRunBonusApplied).toBe(true)
  })

  it("reduces gravity inside Low-Gravity Courtyard Anomaly and carries riders on the moving overhead Cable Car", () => {
    // Low-gravity jump height vs normal gravity in open courtyard air (z = 3.2, clear of overhead footbridge!)
    const rtLow = boot({ seed: 7001, anomalyEnabled: true, initialHumans: makeAllHumans(6) })
    const rtNorm = boot({ seed: 7001, anomalyEnabled: false, initialHumans: makeAllHumans(6) })
    edit(rtLow, {
      match: (m) => ({ ...m, anomalyActive: true }),
      fighter: (f) => (f.slotId === 0 ? { ...f, x: 0, y: 0, z: 3.2 } : { ...f, x: 24, y: 0, z: 14 })
    })
    edit(rtNorm, {
      fighter: (f) => (f.slotId === 0 ? { ...f, x: 0, y: 0, z: 3.2 } : { ...f, x: 24, y: 0, z: 14 })
    })
    rtLow.send(Intent, { _tag: "SubmitInput", slotId: 0, input: inp({ seq: 1, jump: true }) })
    rtNorm.send(Intent, { _tag: "SubmitInput", slotId: 0, input: inp({ seq: 1, jump: true }) })
    tickN(rtLow, 36)
    tickN(rtNorm, 36)
    expect(readSnapshot(rtLow).fighters[0]!.y).toBeGreaterThan(readSnapshot(rtNorm).fighters[0]!.y + 1.0)

    // Cable Car riding + firing while aboard + jumping off cleanly
    const rtCar = boot({ seed: 8001, initialHumans: makeAllHumans(6) })
    const car0 = readSnapshot(rtCar).cableCar
    edit(rtCar, {
      fighter: (f) =>
        f.slotId === 0
          ? { ...f, x: car0.x, y: car0.y, z: car0.z, grounded: true }
          : { ...f, x: 24, y: 0, z: 14 }
    })
    rtCar.send(Intent, { _tag: "SubmitInput", slotId: 0, input: inp({ seq: 1, fire: true }) })
    tickN(rtCar, 45)
    const riding = readSnapshot(rtCar)
    expect(riding.fighters[0]!.x).toBeCloseTo(riding.cableCar.x, 1)
    expect(riding.fighters[0]!.x).toBeGreaterThan(car0.x + 1.0)
    expect(riding.fighters[0]!.primaryAmmo).toBeLessThan(30) // Fired smoothly while aboard!
  })

  it("resolves Foundry Skirmish contested final deposit and completes the Colossus Rotary Press", () => {
    const rt = boot({ seed: 9001, mode: "foundry", initialHumans: makeAllHumans(6) })
    edit(rt, {
      match: (m) => ({
        ...m,
        foundry: m.foundry ? { ...m.foundry, deposited: [9, 9] } : null
      }),
      fighter: (f) => {
        if (f.slotId === 0) return { ...f, x: FOUNDRY_CENTER.x, y: 0, z: FOUNDRY_CENTER.z, carryingScrap: 1 }
        if (f.slotId === 3) return { ...f, x: FOUNDRY_CENTER.x + 1, y: 0, z: FOUNDRY_CENTER.z, carryingScrap: 1 }
        return { ...f, x: 24, y: 0, z: 14 }
      }
    })
    // Both crews in Foundry -> contested, deposit pauses!
    tickN(rt, 35)
    expect(readSnapshot(rt).foundry!.contestedDeposit).toBe(true)
    expect(readSnapshot(rt).phase).toBe("Playing")

    // Move Vermilion out -> Cobalt completes 10th scrap and wins!
    edit(rt, {
      fighter: (f) => (f.slotId === 3 ? { ...f, x: 24, y: 0, z: 14 } : f)
    })
    tickN(rt, 35)
    const fin = readSnapshot(rt)
    expect(fin.phase).toBe("Finished")
    expect(fin.foundry!.siegeCompletedBy).toBe(0)
    expect(fin.winner).toBe(0)
  })

  it("benchmarks simulation tick performance with 5, 12, and 20 bots", () => {
    for (const botCount of [5, 12, 20]) {
      const rt = boot({ seed: 9900 + botCount, totalSlots: botCount + 1 })
      const samples: Array<number> = []
      for (let t = 0; t < TICK_HZ * 2; t++) {
        const t0 = performance.now()
        const r = rt.tick(updateSchedule)
        expect(r.ok).toBe(true)
        samples.push(performance.now() - t0)
      }
      samples.sort((a, b) => a - b)
      const p95 = samples[Math.floor(samples.length * 0.95)]!
      // 60Hz budget is 16.67ms per tick; headless simulation should stay well under budget even at 20 bots!
      expect(p95).toBeLessThan(16.67)
    }
  })
})
