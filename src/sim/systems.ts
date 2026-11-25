import { Clock, Ops, Random } from "@typeonce/ritmo"
import {
  ANOMALY_CYCLE_TICKS,
  ANOMALY_DURATION_TICKS,
  ARMORS,
  ARM_LATERAL,
  BARREL_BLAST_DAMAGE,
  DIFFICULTY_DEFAULT,
  DIFFICULTY_MAX,
  DIFFICULTY_MIN,
  HEALTH_PICKUP_FIRST_SPAWN_TICKS,
  HEALTH_PICKUP_POS,
  botCosmetics,
  HEAD_BYPASSES_ARMOR,
  HEAD_MIN_Y,
  HIT_ZONE_MULT,
  LEG_MAX_Y,
  type HitZone,
  BARREL_BLAST_RADIUS,
  BOT_NAMES,
  DEFAULT_COSMETICS,
  DEFAULT_LOADOUT,
  FOUNDRY_TARGET_SCRAP,
  GRAPPLE_COOLDOWN_TICKS,
  GRAPPLE_MAX_TICKS,
  GRAPPLE_PULL_SPEED,
  GRAPPLE_RANGE,
  GUNS,
  MATCH_DURATION_TICKS,
  MURAL_ROTATE_TICKS,
  PARRY_COOLDOWN_TICKS,
  PARRY_WINDOW_TICKS,
  PLAYER_EYE_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_MAX_HP,
  PLAYER_RADIUS,
  RESPAWN_TICKS,
  SCORE_TO_WIN,
  SKETCH_BARRICADE_LIFETIME_TICKS,
  SKETCH_ERASE_RANGE,
  SKETCH_FREE_RANGE,
  SKETCH_MAX_CHARGES,
  SKETCH_PLANK_LIFETIME_TICKS,
  SLOTS_COUNT,
  SMOKE_CLEAR_TICKS,
  SMOKE_COOLDOWN_TICKS,
  SMOKE_LIFETIME_TICKS,
  TICK_HZ,
  sanitizeCosmetics,
  sanitizeLoadout,
  type CrewId,
  type GameModeId,
  type GunId,
  type PrimaryGunId
} from "./data.ts"
import {
  BARREL_SPAWNS,
  CABLE_CAR_SPLINE,
  EXTRACTION_EXIT,
  EXTRACTION_VAULT,
  FOUNDRY_CENTER,
  FOUNDRY_SCRAP_SPAWNS,
  GRAPPLE_LEDGES,
  MAP_WAYPOINTS,
  MURAL_ZONES,
  SKETCH_ANCHORS,
  SPAWN_POINTS,
  findNearestWaypoint,
  muralWaypointId,
  nextWaypointToward,
  type MapBox
} from "./map.ts"
import {
  hasLineOfSight,
  stepPlayerMovement,
  sweepSegmentVsCapsule,
  sweepSegmentVsWorld
} from "./physics.ts"
import {
  EMPTY_INPUT,
  EventFeed,
  Fighter,
  Game,
  InputQueue,
  Intent,
  MatchPhase,
  MatchState,
  Projectile,
  Rng,
  Time,
  type CableCarData,
  type ConstructData,
  type ExtractionData,
  type FighterData,
  type ForemanData,
  type FoundryData,
  type InitialHumanSpec,
  type MatchEventItem,
  type MatchStateData,
  type MovablePropData,
  type PlayerInput,
  type SmokeCloudData
} from "./schema.ts"

const DT = 1 / TICK_HZ
const MAX_PITCH = 1.42
const MAX_FEED_EVENTS = 64
const STANDARD_BOT_PRIMARIES: ReadonlyArray<PrimaryGunId> = ["rollerSmg", "broadside", "linecaster"]

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function getSpawnForSlot(slotId: number, totalSlots: number) {
  const half = Math.max(1, Math.ceil(totalSlots / 2))
  const crew: CrewId = slotId < half ? 0 : 1
  const localIdx = crew === 0 ? slotId : slotId - half
  const pool = SPAWN_POINTS.filter((s) => s.crew === crew)
  const base = pool[localIdx % pool.length]!
  // Slight offset when testing 12 or 20 bots so spawns never stack identically
  const ring = Math.floor(localIdx / pool.length)
  return {
    ...base,
    x: base.x + (crew === 0 ? ring * 1.1 : -ring * 1.1),
    z: base.z + (ring % 2 === 0 ? ring * 0.6 : -ring * 0.6)
  }
}

function initialCableCar(): CableCarData {
  return {
    x: CABLE_CAR_SPLINE.startX,
    y: CABLE_CAR_SPLINE.baseY,
    z: CABLE_CAR_SPLINE.z,
    vx: 0,
    vy: 0,
    vz: 0,
    t: 0,
    dir: 1
  }
}

function initialProps(): ReadonlyArray<MovablePropData> {
  return BARREL_SPAWNS.map((b) => ({
    id: b.id,
    x: b.x,
    y: b.y,
    z: b.z,
    vx: 0,
    vy: 0,
    vz: 0,
    hp: 40,
    exploded: false,
    respawnTicksLeft: 0
  }))
}

function initialForeman(mode: GameModeId): ForemanData | null {
  if (mode !== "eliteDuel") return null
  return {
    x: 0,
    y: 0,
    z: -3.2,
    yaw: 0,
    hp: 520,
    maxHp: 520,
    posture: 100,
    maxPosture: 100,
    state: "patrol",
    stateTicksLeft: 90,
    attackTargetSlot: null
  }
}

function initialExtraction(mode: GameModeId, equipmentStaked: boolean): ExtractionData | null {
  if (mode !== "extraction") return null
  return {
    vaultProgressTicks: 0,
    vaultTargetTicks: 180,
    vaultUnlocked: false,
    parcelCarriedBySlot: null,
    extracted: false,
    failed: false,
    carriedScrap: 0,
    equipmentStaked
  }
}

function initialFoundry(mode: GameModeId): FoundryData | null {
  if (mode !== "foundry") return null
  return {
    piles: FOUNDRY_SCRAP_SPAWNS.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      z: p.z,
      available: true,
      respawnTicksLeft: 0
    })),
    deposited: [0, 0],
    targetScrap: FOUNDRY_TARGET_SCRAP,
    contestedDeposit: false,
    siegeCompletedBy: null
  }
}

export function buildDynamicSolids(
  constructs: ReadonlyArray<ConstructData>,
  cableCar: CableCarData
): Array<MapBox> {
  const boxes: Array<MapBox> = []
  for (const c of constructs) {
    boxes.push({
      id: `construct_${c.id}`,
      minX: c.minX,
      maxX: c.maxX,
      minY: c.minY,
      maxY: c.maxY,
      minZ: c.minZ,
      maxZ: c.maxZ,
      kind: c.kind === "plank" ? "bridge" : "cover",
      solid: true
    })
  }
  boxes.push({
    id: "cable_car_deck",
    minX: cableCar.x - CABLE_CAR_SPLINE.halfW,
    maxX: cableCar.x + CABLE_CAR_SPLINE.halfW,
    minY: cableCar.y - CABLE_CAR_SPLINE.thickness,
    maxY: cableCar.y,
    minZ: cableCar.z - CABLE_CAR_SPLINE.halfD,
    maxZ: cableCar.z + CABLE_CAR_SPLINE.halfD,
    kind: "bridge",
    solid: true
  })
  return boxes
}

export function makeDefaultMatchState(
  initialHumans: ReadonlyArray<InitialHumanSpec> | null = null,
  options: {
    readonly mode?: GameModeId
    readonly anomalyEnabled?: boolean
    readonly totalSlots?: number
    readonly equipmentStaked?: boolean
    readonly difficulty?: number
  } = {}
): MatchStateData {
  const mode = options.mode ?? "mural"
  const totalSlots = clamp(options.totalSlots ?? SLOTS_COUNT, 2, 21)
  const anomalyEnabled = options.anomalyEnabled ?? false
  const equipmentStaked = options.equipmentStaked ?? false
  return {
    mode,
    totalSlots,
    anomalyEnabled,
    anomalyActive: false,
    anomalyTicksLeft: ANOMALY_CYCLE_TICKS,
    paused: false,
    tickCount: 0,
    remainingTicks: MATCH_DURATION_TICKS,
    activeMuralId: 0,
    muralRotateTicksLeft: MURAL_ROTATE_TICKS,
    scores: [0, 0],
    scoreAccum: [0, 0],
    zoneStatus: "idle",
    winner: null,
    nextProjectileId: 1,
    nextShotEventId: 1,
    nextEventSeq: 1,
    nextConstructId: 1,
    nextSmokeId: 1,
    constructs: [],
    smokeClouds: [],
    props: initialProps(),
    cableCar: initialCableCar(),
    foreman: initialForeman(mode),
    extraction: initialExtraction(mode, equipmentStaked),
    foundry: initialFoundry(mode),
    healthPickup: {
      x: HEALTH_PICKUP_POS.x,
      y: HEALTH_PICKUP_POS.y,
      z: HEALTH_PICKUP_POS.z,
      available: false,
      respawnTicksLeft: HEALTH_PICKUP_FIRST_SPAWN_TICKS
    },
    difficulty: clamp(Math.round(options.difficulty ?? DIFFICULTY_DEFAULT), DIFFICULTY_MIN, DIFFICULTY_MAX),
    bossSlot: -1,
    bossDefeated: false,
    pendingDifficulty: null,
    pendingBootSeed: null,
    pendingInitialHumans: initialHumans,
    pendingMode: mode,
    pendingAnomalyEnabled: anomalyEnabled,
    pendingTotalSlots: totalSlots,
    pendingEquipmentStake: equipmentStaked
  }
}

function makeFighterForSlot(
  slotId: number,
  totalSlots: number,
  humanSpec: InitialHumanSpec | undefined
): FighterData {
  const half = Math.max(1, Math.ceil(totalSlots / 2))
  const crew: CrewId = slotId < half ? 0 : 1
  const spawn = getSpawnForSlot(slotId, totalSlots)
  const isHuman = humanSpec !== undefined
  const loadout = isHuman
    ? sanitizeLoadout(humanSpec.loadout)
    : {
        primary: STANDARD_BOT_PRIMARIES[slotId % STANDARD_BOT_PRIMARIES.length]!,
        armor: slotId % 3 === 2 ? ("heavy" as const) : ("light" as const)
      }
  const cosmetics = isHuman
    ? sanitizeCosmetics(humanSpec.cosmetics)
    : botCosmetics(slotId, crew)
  const maxArmor = ARMORS[loadout.armor].maxArmor
  const primaryDef = GUNS[loadout.primary]
  const sidearmDef = GUNS.proofPistol

  return {
    slotId,
    crew,
    name: isHuman ? humanSpec.name : BOT_NAMES[slotId % BOT_NAMES.length]!,
    isBot: !isHuman,
    humanId: isHuman ? humanSpec.humanId : null,
    pendingHumanId: null,
    pendingHumanName: null,
    pendingLoadout: null,
    pendingCosmetics: null,
    x: spawn.x,
    y: spawn.y,
    z: spawn.z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: spawn.yaw,
    pitch: 0,
    grounded: true,
    alive: true,
    hp: PLAYER_MAX_HP,
    maxHp: PLAYER_MAX_HP,
    isBoss: false,
    armor: maxArmor,
    maxArmor,
    respawnTicksLeft: 0,
    kills: 0,
    deaths: 0,
    activeSlot: 1,
    primaryGun: loadout.primary,
    armorType: loadout.armor,
    nextPrimaryGun: loadout.primary,
    nextArmorType: loadout.armor,
    cosmetics,
    nextCosmetics: cosmetics,
    primaryAmmo: primaryDef.magSize,
    sidearmAmmo: sidearmDef.magSize,
    fireCooldownTicks: 0,
    reloadTicksLeft: 0,
    wasFireHeld: false,
    sketchCharges: SKETCH_MAX_CHARGES,
    parryTicksLeft: 0,
    parryCooldownTicks: 0,
    smokeCooldownTicks: 0,
    grappleCooldownTicks: 0,
    grapple: null,
    carryingScrap: 0,
    cursedRunBonusApplied: false,
    lastHandledSketchId: 0,
    lastHandledEraseId: 0,
    lastHandledParryId: 0,
    lastHandledSmokeId: 0,
    lastHandledGrappleId: 0,
    lastHandledGrappleReleaseId: 0,
    lastInputSeq: 0,
    botStrafeDir: slotId % 2 === 0 ? 1 : -1,
    botStrafeTicks: 40 + (slotId % 7) * 13
  }
}

function activeGunId(f: FighterData): GunId {
  return f.activeSlot === 1 ? f.primaryGun : "proofPistol"
}

function pushEvent(
  events: Array<MatchEventItem>,
  nextSeq: number,
  item: Omit<MatchEventItem, "seq">
): number {
  events.push({ ...item, seq: nextSeq })
  if (events.length > MAX_FEED_EVENTS) {
    events.shift()
  }
  return nextSeq + 1
}

function isInsideMuralZone(f: FighterData, muralId: 0 | 1 | 2): boolean {
  if (!f.alive) return false
  const zone = MURAL_ZONES[muralId]!
  const dx = f.x - zone.x
  const dz = f.z - zone.z
  if (dx * dx + dz * dz > zone.radius * zone.radius) return false
  return f.y >= zone.y - 0.6 && f.y <= zone.y + zone.height
}

function distPointToBox(
  px: number,
  py: number,
  pz: number,
  c: ConstructData
): number {
  const cx = clamp(px, c.minX, c.maxX)
  const cy = clamp(py, c.minY, c.maxY)
  const cz = clamp(pz, c.minZ, c.maxZ)
  return Ops.hypot(Ops.hypot(px - cx, pz - cz), py - cy)
}

function stepCableCar(prev: CableCarData): CableCarData {
  const stepT = 1 / CABLE_CAR_SPLINE.cycleTicks
  let nextT = prev.t + prev.dir * stepT
  let nextDir = prev.dir
  if (nextT >= 1) {
    nextT = 1
    nextDir = -1
  } else if (nextT <= 0) {
    nextT = 0
    nextDir = 1
  }
  const nx =
    CABLE_CAR_SPLINE.startX + (CABLE_CAR_SPLINE.endX - CABLE_CAR_SPLINE.startX) * nextT
  const ny = CABLE_CAR_SPLINE.baseY + Ops.sin(Math.PI * nextT) * CABLE_CAR_SPLINE.archY
  const nz = CABLE_CAR_SPLINE.z
  return {
    x: nx,
    y: ny,
    z: nz,
    vx: (nx - prev.x) * TICK_HZ,
    vy: (ny - prev.y) * TICK_HZ,
    vz: 0,
    t: nextT,
    dir: nextDir
  }
}

function clearSmokeAlongSegment(
  clouds: Array<SmokeCloudData>,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number
): void {
  if (clouds.length === 0) return
  const dist = Ops.hypot(Ops.hypot(bx - ax, bz - az), by - ay)
  const steps = Math.max(3, Math.min(20, Math.ceil(dist / 0.45)))
  for (let ci = 0; ci < clouds.length; ci++) {
    const cl = clouds[ci]!
    const halfX = cl.nx * cl.cellSize * 0.5
    const halfY = cl.ny * cl.cellSize * 0.5
    const halfZ = cl.nz * cl.cellSize * 0.5
    let mutated: Array<number> | null = null
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const px = ax + (bx - ax) * t
      const py = ay + (by - ay) * t
      const pz = az + (bz - az) * t
      const ix = Math.floor((px - (cl.cx - halfX)) / cl.cellSize)
      const iy = Math.floor((py - (cl.cy - halfY)) / cl.cellSize)
      const iz = Math.floor((pz - (cl.cz - halfZ)) / cl.cellSize)
      if (ix < 0 || ix >= cl.nx || iy < 0 || iy >= cl.ny || iz < 0 || iz >= cl.nz) continue
      const idx = (iy * cl.nz + iz) * cl.nx + ix
      if ((cl.clearedTicks[idx] ?? 0) < SMOKE_CLEAR_TICKS) {
        if (!mutated) mutated = [...cl.clearedTicks]
        mutated[idx] = SMOKE_CLEAR_TICKS
      }
    }
    if (mutated) {
      clouds[ci] = { ...cl, clearedTicks: mutated }
    }
  }
}

function clearSmokeInSphere(
  clouds: Array<SmokeCloudData>,
  bx: number,
  by: number,
  bz: number,
  radius: number
): void {
  const r2 = radius * radius
  for (let ci = 0; ci < clouds.length; ci++) {
    const cl = clouds[ci]!
    const halfX = cl.nx * cl.cellSize * 0.5
    const halfY = cl.ny * cl.cellSize * 0.5
    const halfZ = cl.nz * cl.cellSize * 0.5
    let mutated: Array<number> | null = null
    for (let iy = 0; iy < cl.ny; iy++) {
      for (let iz = 0; iz < cl.nz; iz++) {
        for (let ix = 0; ix < cl.nx; ix++) {
          const cx = cl.cx - halfX + (ix + 0.5) * cl.cellSize
          const cy = cl.cy - halfY + (iy + 0.5) * cl.cellSize
          const cz = cl.cz - halfZ + (iz + 0.5) * cl.cellSize
          const dx = cx - bx
          const dy = cy - by
          const dz = cz - bz
          if (dx * dx + dy * dy + dz * dz <= r2) {
            const idx = (iy * cl.nz + iz) * cl.nx + ix
            if (!mutated) mutated = [...cl.clearedTicks]
            mutated[idx] = SMOKE_CLEAR_TICKS
          }
        }
      }
    }
    if (mutated) {
      clouds[ci] = { ...cl, clearedTicks: mutated }
    }
  }
}

// ── 1. AdvanceClock ──────────────────────────────────────────────────────

export const AdvanceClock = Clock.system(Game, {
  name: "Hw2/AdvanceClock",
  resource: Time
})

// ── 2. BootstrapMatch (Boot -> Playing) ──────────────────────────────────

export const BootstrapMatch = Game.System(
  "Hw2/BootstrapMatch",
  {
    queries: {
      fighters: Game.Query({ selection: { fighter: Game.Query.read(Fighter) } }),
      projectiles: Game.Query({ selection: { projectile: Game.Query.read(Projectile) } })
    },
    resources: {
      rng: Game.System.writeResource(Rng),
      match: Game.System.writeResource(MatchState),
      feed: Game.System.writeResource(EventFeed),
      inputs: Game.System.writeResource(InputQueue)
    },
    nextMachines: {
      phase: Game.System.nextState(MatchPhase)
    },
    commands: Game.System.commands(
      Game.System.spawns(Fighter),
      Game.System.despawns(Fighter, Projectile)
    ),
    when: [Game.Condition.inState(MatchPhase, "Boot")]
  },
  ({ queries, resources, nextMachines, commands }) => {
    const prev = resources.match.get()
    if (prev.pendingBootSeed !== null) {
      resources.rng.set(Random.seed(prev.pendingBootSeed))
    }

    for (const entity of queries.fighters.each()) {
      commands.despawn(entity)
    }
    for (const entity of queries.projectiles.each()) {
      commands.despawn(entity)
    }

    const mode = prev.pendingMode ?? prev.mode
    const anomalyEnabled = prev.pendingAnomalyEnabled ?? prev.anomalyEnabled
    const totalSlots =
      mode === "eliteDuel"
        ? 2
        : mode === "extraction"
          ? 4
          : clamp(prev.pendingTotalSlots ?? prev.totalSlots, 2, 21)

    const humansBySlot = new Map<number, InitialHumanSpec>()
    if (prev.pendingInitialHumans !== null) {
      for (const spec of prev.pendingInitialHumans) {
        if (spec.slotId >= 0 && spec.slotId < totalSlots) {
          humansBySlot.set(spec.slotId, spec)
        }
      }
    } else {
      humansBySlot.set(0, {
        slotId: 0,
        humanId: "local",
        name: "You",
        loadout: DEFAULT_LOADOUT,
        cosmetics: DEFAULT_COSMETICS
      })
    }

    for (let slotId = 0; slotId < totalSlots; slotId++) {
      let fighter = makeFighterForSlot(slotId, totalSlots, humansBySlot.get(slotId))
      // In Elite Duel, slot 0 is the player; slot 1 is a distant ally spectator/helper
      if (mode === "eliteDuel" && slotId === 0) {
        fighter = { ...fighter, x: 0, y: 0, z: 7.5, yaw: 0 }
      } else if (mode === "extraction" && slotId === 0) {
        fighter = { ...fighter, x: -13.0, y: 0, z: 9.5, yaw: 0 }
      }
      commands.spawn(Game.Command.spawn([Fighter, fighter]))
    }

    resources.match.set({
      ...makeDefaultMatchState(null, {
        mode,
        anomalyEnabled,
        totalSlots,
        equipmentStaked: prev.pendingEquipmentStake,
        difficulty: prev.pendingDifficulty ?? prev.difficulty
      }),
      nextEventSeq: prev.nextEventSeq
    })
    resources.feed.set({ items: [] })
    resources.inputs.set({ bySlot: {} })
    nextMachines.phase.transition({ from: "Boot", to: "Playing" })
  }
)

// ── 3. HandleIntents ─────────────────────────────────────────────────────

export const HandleIntents = Game.System(
  "Hw2/HandleIntents",
  {
    queries: {
      fighters: Game.Query({ selection: { fighter: Game.Query.write(Fighter) } })
    },
    resources: {
      match: Game.System.writeResource(MatchState),
      inputs: Game.System.writeResource(InputQueue)
    },
    events: {
      intents: Game.System.readEvent(Intent)
    },
    machines: {
      phase: Game.System.machine(MatchPhase)
    },
    nextMachines: {
      phase: Game.System.nextState(MatchPhase)
    }
  },
  ({ queries, resources, events, machines, nextMachines }) => {
    const all = events.intents.all()
    if (all.length === 0) return

    const bySlot: Record<number, PlayerInput> = { ...resources.inputs.get().bySlot }
    let match = resources.match.get()

    for (const intent of all) {
      switch (intent._tag) {
        case "SubmitInput": {
          if (intent.slotId >= 0 && intent.slotId < match.totalSlots) {
            bySlot[intent.slotId] = {
              seq: intent.input.seq,
              moveForward: clamp(intent.input.moveForward, -1, 1),
              moveRight: clamp(intent.input.moveRight, -1, 1),
              yaw: intent.input.yaw,
              pitch: clamp(intent.input.pitch, -MAX_PITCH, MAX_PITCH),
              jump: intent.input.jump,
              fire: intent.input.fire,
              reload: intent.input.reload,
              switchSlot: intent.input.switchSlot,
              sketchAction: intent.input.sketchAction ?? null,
              eraseActionId: intent.input.eraseActionId ?? 0,
              parryActionId: intent.input.parryActionId ?? 0,
              smokeActionId: intent.input.smokeActionId ?? 0,
              grappleActionId: intent.input.grappleActionId ?? 0,
              grappleReleaseId: intent.input.grappleReleaseId ?? 0
            }
          }
          break
        }
        case "SetPaused": {
          match = { ...match, paused: intent.paused }
          break
        }
        case "SetLoadout": {
          const loadout = sanitizeLoadout({ primary: intent.primary, armor: intent.armor })
          const cosmetics = sanitizeCosmetics(intent.cosmetics)
          for (const e of queries.fighters.each()) {
            const fighter = queries.fighters.data.fighter.get(e)
            if (fighter.slotId !== intent.slotId) continue
            const applyNow = intent.immediate === true
            const maxArmor = ARMORS[loadout.armor].maxArmor
            queries.fighters.data.fighter.set(e, {
              ...fighter,
              nextPrimaryGun: loadout.primary,
              nextArmorType: loadout.armor,
              nextCosmetics: cosmetics,
              ...(applyNow
                ? {
                    primaryGun: loadout.primary,
                    armorType: loadout.armor,
                    armor: maxArmor,
                    maxArmor,
                    primaryAmmo: GUNS[loadout.primary].magSize,
                    cosmetics,
                    reloadTicksLeft: 0
                  }
                : {})
            })
          }
          break
        }
        case "AssignHuman": {
          const loadout = sanitizeLoadout(intent.loadout)
          const cosmetics = sanitizeCosmetics(intent.cosmetics)
          for (const e of queries.fighters.each()) {
            const fighter = queries.fighters.data.fighter.get(e)
            if (fighter.slotId !== intent.slotId) continue
            if (intent.immediate) {
              const maxArmor = ARMORS[loadout.armor].maxArmor
              queries.fighters.data.fighter.set(e, {
                ...fighter,
                isBot: false,
                humanId: intent.humanId,
                name: intent.name,
                pendingHumanId: null,
                pendingHumanName: null,
                pendingLoadout: null,
                pendingCosmetics: null,
                primaryGun: loadout.primary,
                armorType: loadout.armor,
                nextPrimaryGun: loadout.primary,
                nextArmorType: loadout.armor,
                armor: maxArmor,
                maxArmor,
                primaryAmmo: GUNS[loadout.primary].magSize,
                sidearmAmmo: GUNS.proofPistol.magSize,
                cosmetics,
                nextCosmetics: cosmetics,
                reloadTicksLeft: 0
              })
            } else {
              queries.fighters.data.fighter.set(e, {
                ...fighter,
                pendingHumanId: intent.humanId,
                pendingHumanName: intent.name,
                pendingLoadout: loadout,
                pendingCosmetics: cosmetics
              })
            }
          }
          break
        }
        case "ReleaseHuman": {
          for (const e of queries.fighters.each()) {
            const fighter = queries.fighters.data.fighter.get(e)
            if (fighter.humanId === intent.humanId) {
              queries.fighters.data.fighter.set(e, {
                ...fighter,
                isBot: true,
                humanId: null,
                name: BOT_NAMES[fighter.slotId % BOT_NAMES.length]!
              })
            } else if (fighter.pendingHumanId === intent.humanId) {
              queries.fighters.data.fighter.set(e, {
                ...fighter,
                pendingHumanId: null,
                pendingHumanName: null,
                pendingLoadout: null,
                pendingCosmetics: null
              })
            }
          }
          break
        }
        case "StartMatch": {
          match = {
            ...match,
            paused: false,
            pendingBootSeed: intent.seed,
            pendingInitialHumans: intent.initialHumans ?? null,
            pendingMode: intent.mode ?? match.mode,
            pendingAnomalyEnabled: intent.anomalyEnabled ?? match.anomalyEnabled,
            pendingTotalSlots: intent.totalSlots ?? match.totalSlots,
            pendingEquipmentStake: intent.equipmentStaked ?? false,
            pendingDifficulty: intent.difficulty ?? null
          }
          const cur = machines.phase.get()._tag
          if (cur === "Playing") {
            nextMachines.phase.transition({ from: "Playing", to: "Boot" })
          } else if (cur === "Finished") {
            nextMachines.phase.transition({ from: "Finished", to: "Boot" })
          }
          break
        }
      }
    }

    resources.match.set(match)
    resources.inputs.set({ bySlot })
  }
)

// ── 4. RunBotAI (Playing, unpaused) ──────────────────────────────────────

export const RunBotAI = Game.System(
  "Hw2/RunBotAI",
  {
    queries: {
      fighters: Game.Query({ selection: { fighter: Game.Query.write(Fighter) } })
    },
    resources: {
      rng: Game.System.writeResource(Rng),
      match: Game.System.readResource(MatchState),
      inputs: Game.System.writeResource(InputQueue)
    },
    when: [Game.Condition.inState(MatchPhase, "Playing")]
  },
  ({ queries, resources }) => {
    const match = resources.match.get()
    if (match.paused) return

    const random = Random.draw(resources.rng)
    const entities = queries.fighters.each()
    const fighters = entities.map((e) => ({
      entity: e,
      data: queries.fighters.data.fighter.get(e)
    }))
    fighters.sort((a, b) => a.data.slotId - b.data.slotId)

    const bySlot: Record<number, PlayerInput> = { ...resources.inputs.get().bySlot }
    const dynamicSolids = buildDynamicSolids(match.constructs, match.cableCar)

    // Dynamic waypoint links unlocked by active Sketch Planks!
    const dynamicEdges: Array<readonly [number, number]> = []
    for (const c of match.constructs) {
      if (c.kind === "plank" && c.anchorId) {
        const anchor = SKETCH_ANCHORS.find((a) => a.id === c.anchorId)
        if (anchor) dynamicEdges.push([anchor.wpA, anchor.wpB])
      }
    }

    const defaultGoalWpId = muralWaypointId(match.activeMuralId)
    const activeZone = MURAL_ZONES[match.activeMuralId]!

    for (const entry of fighters) {
      const bot = entry.data
      if (!bot.isBot || !bot.alive) continue

      // In Elite Duel, bot stays back as a quiet observer so player duels the Foreman cleanly
      if (match.mode === "eliteDuel") {
        bySlot[bot.slotId] = { ...EMPTY_INPUT, yaw: bot.yaw }
        continue
      }

      let strafeDir = bot.botStrafeDir
      let strafeTicks = bot.botStrafeTicks - 1
      if (strafeTicks <= 0) {
        strafeDir = random.next() < 0.5 ? -1 : 1
        strafeTicks = 45 + Math.floor(random.next() * 55)
        queries.fighters.data.fighter.set(entry.entity, {
          ...bot,
          botStrafeDir: strafeDir,
          botStrafeTicks: strafeTicks
        })
      }

      // 1. Find closest visible opposing fighter (respecting constructs AND Ink Smoke density grid!)
      let target: FighterData | null = null
      let bestTargetDist = 28
      const eyeY = bot.y + PLAYER_EYE_HEIGHT
      for (const otherEntry of fighters) {
        const other = otherEntry.data
        if (!other.alive || other.crew === bot.crew) continue
        const dx = other.x - bot.x
        const dy = other.y + 1.1 - eyeY
        const dz = other.z - bot.z
        const dist = Ops.hypot(Ops.hypot(dx, dz), dy)
        if (dist < bestTargetDist) {
          if (
            hasLineOfSight(
              bot.x,
              eyeY,
              bot.z,
              other.x,
              other.y + 1.15,
              other.z,
              dynamicSolids,
              match.smokeClouds
            )
          ) {
            bestTargetDist = dist
            target = other
          }
        }
      }

      // 2. Mode-aware objective waypoint (Mural / Extraction guard / Foundry scrap & deposit)
      let goalWpId = defaultGoalWpId
      if (match.mode === "extraction") {
        goalWpId = match.extraction?.vaultUnlocked ? 20 : 12
      } else if (match.mode === "foundry" && match.foundry) {
        if (bot.carryingScrap > 0) {
          goalWpId = 7 // Central Foundry Press
        } else {
          const openPile = match.foundry.piles.find((p) => p.available)
          goalWpId = openPile ? findNearestWaypoint(openPile.x, openPile.y, openPile.z) : 7
        }
      }

      const curWpId = findNearestWaypoint(bot.x, bot.y, bot.z)
      const nextWpId = nextWaypointToward(curWpId, goalWpId, dynamicEdges)
      const nextWp = MAP_WAYPOINTS[nextWpId]!
      const insideZone = match.mode === "mural" && isInsideMuralZone(bot, match.activeMuralId)

      let navX = nextWp.x
      let navZ = nextWp.z
      if (insideZone) {
        navX = activeZone.x + strafeDir * 1.8
        navZ = activeZone.z + (bot.slotId % 2 === 0 ? 1.2 : -1.2)
      }

      const moveDx = navX - bot.x
      const moveDz = navZ - bot.z
      const moveDist = Ops.hypot(moveDx, moveDz)
      const navYaw = moveDist > 0.25 ? Ops.atan2(-moveDx, -moveDz) : bot.yaw

      let aimYaw = navYaw
      let aimPitch = 0
      let fire = false
      let moveForward = moveDist > 0.65 ? 1 : 0
      let moveRight = 0
      let reload = false
      let switchSlot: 0 | 1 | 2 = 0

      if (target !== null) {
        const dx = target.x - bot.x
        const dy = target.y + 1.15 - eyeY
        const dz = target.z - bot.z
        const horiz = Math.max(0.01, Ops.hypot(dx, dz))
        const jitterYaw = (random.next() - 0.5) * 0.085
        const jitterPitch = (random.next() - 0.5) * 0.055
        aimYaw = Ops.atan2(-dx, -dz) + jitterYaw
        aimPitch = clamp(Ops.atan2(dy, horiz) + jitterPitch, -0.9, 0.9)

        const gun = GUNS[activeGunId(bot)]
        const maxRange = gun.id === "broadside" ? 13 : 26
        if (bestTargetDist <= maxRange) {
          fire = gun.automatic ? true : !bot.wasFireHeld
        }

        const sinY = Ops.sin(aimYaw)
        const cosY = Ops.cos(aimYaw)
        const fwdX = -sinY
        const fwdZ = -cosY
        const rightX = cosY
        const rightZ = -sinY

        if (insideZone) {
          moveForward = bestTargetDist > 12 ? 0.5 : bestTargetDist < 4 ? -0.5 : 0
          moveRight = strafeDir * 0.85
        } else if (moveDist > 0.4) {
          const ux = moveDx / moveDist
          const uz = moveDz / moveDist
          moveForward = clamp(ux * fwdX + uz * fwdZ, -1, 1)
          moveRight = clamp(ux * rightX + uz * rightZ + strafeDir * 0.35, -1, 1)
        }
      }

      const ammo = bot.activeSlot === 1 ? bot.primaryAmmo : bot.sidearmAmmo
      if (ammo <= 0 && bot.reloadTicksLeft === 0) {
        reload = true
      } else if (bot.activeSlot === 2 && bot.primaryAmmo > 0 && target === null) {
        switchSlot = 1
      }

      const jump = bot.grounded && nextWp.y > bot.y + 0.35 && random.next() < 0.04

      bySlot[bot.slotId] = {
        ...EMPTY_INPUT,
        moveForward,
        moveRight,
        yaw: aimYaw,
        pitch: aimPitch,
        jump,
        fire,
        reload,
        switchSlot
      }
    }

    resources.inputs.set({ bySlot })
  }
)

// ── 5. StepCombatAndMatch (Playing, unpaused) ────────────────────────────

export const StepCombatAndMatch = Game.System(
  "Hw2/StepCombatAndMatch",
  {
    queries: {
      fighters: Game.Query({ selection: { fighter: Game.Query.write(Fighter) } }),
      projectiles: Game.Query({ selection: { projectile: Game.Query.write(Projectile) } })
    },
    resources: {
      rng: Game.System.writeResource(Rng),
      match: Game.System.writeResource(MatchState),
      feed: Game.System.writeResource(EventFeed),
      inputs: Game.System.writeResource(InputQueue)
    },
    nextMachines: {
      phase: Game.System.nextState(MatchPhase)
    },
    commands: Game.System.commands(
      Game.System.spawns(Projectile),
      Game.System.despawns(Projectile)
    ),
    when: [Game.Condition.inState(MatchPhase, "Playing")]
  },
  ({ queries, resources, nextMachines, commands }) => {
    const matchPrev = resources.match.get()
    if (matchPrev.paused) return

    const nextTick = matchPrev.tickCount + 1
    const random = Random.draw(resources.rng)
    const feedItems: Array<MatchEventItem> = [...resources.feed.get().items]
    let nextEventSeq = matchPrev.nextEventSeq
    let nextProjectileId = matchPrev.nextProjectileId
    let nextShotEventId = matchPrev.nextShotEventId
    let nextConstructId = matchPrev.nextConstructId
    let nextSmokeId = matchPrev.nextSmokeId

    const inputsBySlot = resources.inputs.get().bySlot
    const fighterEntries = queries.fighters.each().map((entity) => ({
      entity,
      data: queries.fighters.data.fighter.get(entity)
    }))
    fighterEntries.sort((a, b) => a.data.slotId - b.data.slotId)

    // 0. Step Overhead Cable Car, Anomaly Cycle, Construct Expiry, Smoke Decay & Props
    const prevCar = matchPrev.cableCar
    const cableCar = stepCableCar(prevCar)

    let anomalyActive = matchPrev.anomalyActive
    let anomalyTicksLeft = matchPrev.anomalyTicksLeft
    if (matchPrev.anomalyEnabled) {
      anomalyTicksLeft -= 1
      if (anomalyTicksLeft <= 0) {
        anomalyActive = !anomalyActive
        anomalyTicksLeft = anomalyActive ? ANOMALY_DURATION_TICKS : ANOMALY_CYCLE_TICKS
        nextEventSeq = pushEvent(feedItems, nextEventSeq, {
          kind: "anomalyShift",
          shotEventId: 0,
          actorSlot: -1,
          targetSlot: anomalyActive ? 1 : 0,
          gunId: null,
          x: 0,
          y: 2,
          z: 0,
          damage: 0
        })
      }
    }

    // Expire Sketch Planks / Barricades FIRST and refill owner charge cleanly once!
    const constructs: Array<ConstructData> = []
    for (const c of matchPrev.constructs) {
      if (c.expiresTick <= nextTick) {
        const ownerEntry = fighterEntries.find((e) => e.data.slotId === c.ownerSlot)
        if (ownerEntry) {
          ownerEntry.data = {
            ...ownerEntry.data,
            sketchCharges: Math.min(SKETCH_MAX_CHARGES, ownerEntry.data.sketchCharges + 1)
          }
        }
        nextEventSeq = pushEvent(feedItems, nextEventSeq, {
          kind: "sketchExpire",
          shotEventId: 0,
          actorSlot: c.ownerSlot,
          targetSlot: c.id,
          gunId: null,
          x: (c.minX + c.maxX) * 0.5,
          y: c.maxY,
          z: (c.minZ + c.maxZ) * 0.5,
          damage: 0
        })
      } else {
        constructs.push(c)
      }
    }

    // Decay Ink Smoke clouds & re-close cleared channels
    const smokeClouds: Array<SmokeCloudData> = []
    for (const cl of matchPrev.smokeClouds) {
      if (cl.expiresTick <= nextTick) continue
      let anyCleared = false
      const nextCells = cl.clearedTicks.map((t) => {
        if (t > 0) {
          anyCleared = true
          return t - 1
        }
        return 0
      })
      smokeClouds.push(anyCleared ? { ...cl, clearedTicks: nextCells } : cl)
    }

    // Step movable explosive ink barrels
    const props: Array<MovablePropData> = matchPrev.props.map((p) => {
      if (p.exploded) {
        const left = p.respawnTicksLeft - 1
        if (left <= 0) {
          const spawn = BARREL_SPAWNS.find((b) => b.id === p.id) ?? { id: p.id, x: 0, y: 0, z: 2 }
          return {
            id: p.id,
            x: spawn.x,
            y: spawn.y,
            z: spawn.z,
            vx: 0,
            vy: 0,
            vz: 0,
            hp: 40,
            exploded: false,
            respawnTicksLeft: 0
          }
        }
        return { ...p, respawnTicksLeft: left }
      }
      if (Math.abs(p.vx) > 0.05 || Math.abs(p.vz) > 0.05) {
        const nx = clamp(p.x + p.vx * DT, -25.5, 25.5)
        const nz = clamp(p.z + p.vz * DT, -16.0, 19.5)
        const blocked = sweepSegmentVsWorld(p.x, p.y + 0.5, p.z, nx, p.y + 0.5, nz, 0.45)
        if (blocked) {
          return { ...p, vx: 0, vz: 0 }
        }
        return { ...p, x: nx, z: nz, vx: p.vx * 0.88, vz: p.vz * 0.88 }
      }
      return p
    })

    // 1. Process Sketch Placement & Erase actions in deterministic slot order (simultaneous conflict safe!)
    for (let idx = 0; idx < fighterEntries.length; idx++) {
      const entry = fighterEntries[idx]!
      let f = entry.data
      if (!f.alive) continue
      const input = inputsBySlot[f.slotId] ?? EMPTY_INPUT

      // A. Sketch Placement (Anchor / Free / Waist-High Barricade)
      if (
        input.sketchAction &&
        input.sketchAction.actionId > f.lastHandledSketchId &&
        f.sketchCharges > 0
      ) {
        const act = input.sketchAction
        let created: ConstructData | null = null
        if (act.kind === "placeAnchor") {
          const anchor = SKETCH_ANCHORS.find((a) => a.id === act.anchorId)
          const alreadyOccupied =
            anchor !== undefined && constructs.some((c) => c.anchorId === anchor.id)
          if (anchor && !alreadyOccupied) {
            const distA = Ops.hypot(Ops.hypot(f.x - anchor.ax, f.z - anchor.az), f.y - anchor.ay)
            const distB = Ops.hypot(Ops.hypot(f.x - anchor.bx, f.z - anchor.bz), f.y - anchor.by)
            if (Math.min(distA, distB) <= 14.5) {
              created = {
                id: nextConstructId++,
                kind: "plank",
                ownerSlot: f.slotId,
                crew: f.crew,
                anchorId: anchor.id,
                minX: anchor.minX,
                maxX: anchor.maxX,
                minY: anchor.minY,
                maxY: anchor.maxY,
                minZ: anchor.minZ,
                maxZ: anchor.maxZ,
                createdTick: nextTick,
                expiresTick: nextTick + SKETCH_PLANK_LIFETIME_TICKS
              }
            }
          }
        } else if (act.kind === "placeFree") {
          const sinY = Ops.sin(input.yaw)
          const cosY = Ops.cos(input.yaw)
          const cx = clamp(f.x - sinY * 2.8, -24, 24)
          const cz = clamp(f.z - cosY * 2.8, -15.5, 18.5)
          const topY = f.y
          if (Ops.hypot(cx - f.x, cz - f.z) <= SKETCH_FREE_RANGE) {
            const overlaps = constructs.some(
              (c) =>
                cx + 1.1 > c.minX &&
                cx - 1.1 < c.maxX &&
                cz + 1.4 > c.minZ &&
                cz - 1.4 < c.maxZ &&
                Math.abs(topY - c.maxY) < 0.8
            )
            if (!overlaps) {
              created = {
                id: nextConstructId++,
                kind: "plank",
                ownerSlot: f.slotId,
                crew: f.crew,
                anchorId: null,
                minX: cx - 1.2,
                maxX: cx + 1.2,
                minY: topY - 0.24,
                maxY: topY,
                minZ: cz - 1.6,
                maxZ: cz + 1.6,
                createdTick: nextTick,
                expiresTick: nextTick + SKETCH_PLANK_LIFETIME_TICKS
              }
            }
          }
        } else if (act.kind === "placeBarricade") {
          const sinY = Ops.sin(input.yaw)
          const cosY = Ops.cos(input.yaw)
          const cx = clamp(f.x - sinY * 2.1, -24, 24)
          const cz = clamp(f.z - cosY * 2.1, -15.5, 18.5)
          const wideAlongX = Math.abs(cosY) >= Math.abs(sinY)
          const halfX = wideAlongX ? 1.15 : 0.22
          const halfZ = wideAlongX ? 0.22 : 1.15
          created = {
            id: nextConstructId++,
            kind: "barricade",
            ownerSlot: f.slotId,
            crew: f.crew,
            anchorId: null,
            minX: cx - halfX,
            maxX: cx + halfX,
            minY: f.y,
            maxY: f.y + 1.12,
            minZ: cz - halfZ,
            maxZ: cz + halfZ,
            createdTick: nextTick,
            expiresTick: nextTick + SKETCH_BARRICADE_LIFETIME_TICKS
          }
        }

        f = { ...f, lastHandledSketchId: act.actionId }
        if (created) {
          constructs.push(created)
          f = { ...f, sketchCharges: Math.max(0, f.sketchCharges - 1) }
          nextEventSeq = pushEvent(feedItems, nextEventSeq, {
            kind: "sketchPlace",
            shotEventId: 0,
            actorSlot: f.slotId,
            targetSlot: created.id,
            gunId: null,
            x: (created.minX + created.maxX) * 0.5,
            y: created.maxY,
            z: (created.minZ + created.maxZ) * 0.5,
            damage: 0
          })
        }
        entry.data = f
      }

      // B. Erase opposing construct within melee reach (expiry already ran above -> race safe!)
      if (input.eraseActionId && input.eraseActionId > f.lastHandledEraseId) {
        f = { ...f, lastHandledEraseId: input.eraseActionId }
        let eraseIdx = -1
        let bestDist = SKETCH_ERASE_RANGE
        for (let ci = 0; ci < constructs.length; ci++) {
          const c = constructs[ci]!
          if (c.crew === f.crew) continue
          const d = distPointToBox(f.x, f.y + 0.9, f.z, c)
          if (d <= bestDist) {
            bestDist = d
            eraseIdx = ci
          }
        }
        if (eraseIdx >= 0) {
          const removed = constructs.splice(eraseIdx, 1)[0]!
          const ownerEntry = fighterEntries.find((e) => e.data.slotId === removed.ownerSlot)
          if (ownerEntry) {
            ownerEntry.data = {
              ...ownerEntry.data,
              sketchCharges: Math.min(SKETCH_MAX_CHARGES, ownerEntry.data.sketchCharges + 1)
            }
          }
          nextEventSeq = pushEvent(feedItems, nextEventSeq, {
            kind: "sketchErase",
            shotEventId: 0,
            actorSlot: f.slotId,
            targetSlot: removed.id,
            gunId: null,
            x: (removed.minX + removed.maxX) * 0.5,
            y: removed.maxY,
            z: (removed.minZ + removed.maxZ) * 0.5,
            damage: 0
          })
        }
        entry.data = f
      }

      // C. Timed Melee Ink Parry (reflects incoming projectiles!)
      if (
        input.parryActionId &&
        input.parryActionId > f.lastHandledParryId &&
        f.parryCooldownTicks === 0
      ) {
        f = {
          ...f,
          lastHandledParryId: input.parryActionId,
          parryTicksLeft: PARRY_WINDOW_TICKS,
          parryCooldownTicks: PARRY_COOLDOWN_TICKS
        }
        entry.data = f
      }

      // D. Deploy Ink Smoke (bounded 5x3x5 voxel density grid)
      if (
        input.smokeActionId &&
        input.smokeActionId > f.lastHandledSmokeId &&
        f.smokeCooldownTicks === 0
      ) {
        const sinY = Ops.sin(input.yaw)
        const cosY = Ops.cos(input.yaw)
        const targetX = clamp(f.x - sinY * 5.0, -24, 24)
        const targetZ = clamp(f.z - cosY * 5.0, -15, 18)
        const wall = sweepSegmentVsWorld(
          f.x,
          f.y + PLAYER_EYE_HEIGHT,
          f.z,
          targetX,
          f.y + 1.4,
          targetZ,
          0.35
        )
        const frac = wall ? Math.max(0.2, wall.t - 0.1) : 1
        const cx = f.x + (targetX - f.x) * frac
        const cz = f.z + (targetZ - f.z) * frac
        const cy = f.y + 1.65
        const nx = 5
        const ny = 3
        const nz = 5
        const cloud: SmokeCloudData = {
          id: nextSmokeId++,
          ownerSlot: f.slotId,
          cx,
          cy,
          cz,
          cellSize: 1.1,
          nx,
          ny,
          nz,
          clearedTicks: Array.from({ length: nx * ny * nz }, () => 0),
          createdTick: nextTick,
          expiresTick: nextTick + SMOKE_LIFETIME_TICKS
        }
        smokeClouds.push(cloud)
        f = {
          ...f,
          lastHandledSmokeId: input.smokeActionId,
          smokeCooldownTicks: SMOKE_COOLDOWN_TICKS
        }
        nextEventSeq = pushEvent(feedItems, nextEventSeq, {
          kind: "smokeDeploy",
          shotEventId: 0,
          actorSlot: f.slotId,
          targetSlot: cloud.id,
          gunId: null,
          x: cx,
          y: cy,
          z: cz,
          damage: 0
        })
        entry.data = f
      }

      // E. Target-Sensitive Grapple (Marked Ledge -> pull self; Movable Barrel or Light Bot -> pull toward self!)
      if (input.grappleReleaseId && input.grappleReleaseId > f.lastHandledGrappleReleaseId) {
        f = { ...f, lastHandledGrappleReleaseId: input.grappleReleaseId, grapple: null }
        entry.data = f
      } else if (
        input.grappleActionId &&
        input.grappleActionId > f.lastHandledGrappleId &&
        f.grappleCooldownTicks === 0
      ) {
        f = { ...f, lastHandledGrappleId: input.grappleActionId }
        const sinY = Ops.sin(input.yaw)
        const cosY = Ops.cos(input.yaw)
        const cosP = Ops.cos(input.pitch)
        const sinP = Ops.sin(input.pitch)
        const aimX = -sinY * cosP
        const aimY = sinP
        const aimZ = -cosY * cosP
        const eyeY = f.y + PLAYER_EYE_HEIGHT

        let bestDot = 0.86
        let chosen: FighterData["grapple"] = null

        for (const ledge of GRAPPLE_LEDGES) {
          const dx = ledge.x - f.x
          const dy = ledge.y - eyeY
          const dz = ledge.z - f.z
          const dist = Ops.hypot(Ops.hypot(dx, dz), dy)
          if (dist < 1.5 || dist > GRAPPLE_RANGE) continue
          const dot = (dx * aimX + dy * aimY + dz * aimZ) / dist
          if (dot > bestDot && hasLineOfSight(f.x, eyeY, f.z, ledge.x, ledge.y, ledge.z)) {
            bestDot = dot
            chosen = {
              kind: "ledge",
              targetId: ledge.id,
              tx: ledge.x,
              ty: ledge.y,
              tz: ledge.z,
              ticksLeft: GRAPPLE_MAX_TICKS
            }
          }
        }

        for (const prop of props) {
          if (prop.exploded) continue
          const dx = prop.x - f.x
          const dy = prop.y + 0.55 - eyeY
          const dz = prop.z - f.z
          const dist = Ops.hypot(Ops.hypot(dx, dz), dy)
          if (dist < 1.8 || dist > GRAPPLE_RANGE) continue
          const dot = (dx * aimX + dy * aimY + dz * aimZ) / dist
          if (dot > bestDot && hasLineOfSight(f.x, eyeY, f.z, prop.x, prop.y + 0.55, prop.z)) {
            bestDot = dot
            chosen = {
              kind: "prop",
              targetId: prop.id,
              tx: prop.x,
              ty: prop.y + 0.55,
              tz: prop.z,
              ticksLeft: 24
            }
          }
        }

        for (const other of fighterEntries) {
          const o = other.data
          if (!o.alive || o.crew === f.crew || o.armorType !== "light") continue
          const dx = o.x - f.x
          const dy = o.y + 1.0 - eyeY
          const dz = o.z - f.z
          const dist = Ops.hypot(Ops.hypot(dx, dz), dy)
          if (dist < 2.2 || dist > GRAPPLE_RANGE) continue
          const dot = (dx * aimX + dy * aimY + dz * aimZ) / dist
          if (dot > bestDot && hasLineOfSight(f.x, eyeY, f.z, o.x, o.y + 1.0, o.z)) {
            bestDot = dot
            chosen = {
              kind: "bot",
              targetId: o.slotId,
              tx: o.x,
              ty: o.y + 1.0,
              tz: o.z,
              ticksLeft: 20
            }
          }
        }

        if (chosen) {
          f = { ...f, grapple: chosen, grappleCooldownTicks: GRAPPLE_COOLDOWN_TICKS }
          nextEventSeq = pushEvent(feedItems, nextEventSeq, {
            kind: "grapple",
            shotEventId: 0,
            actorSlot: f.slotId,
            targetSlot: typeof chosen.targetId === "number" ? chosen.targetId : null,
            gunId: null,
            x: chosen.tx,
            y: chosen.ty,
            z: chosen.tz,
            damage: 0
          })
        }
        entry.data = f
      }
    }

    const dynamicSolids = buildDynamicSolids(constructs, cableCar)

    // 2. Step respawn, cable-car riding, grapple travel, movement, reloading, and firing
    for (let idx = 0; idx < fighterEntries.length; idx++) {
      const entry = fighterEntries[idx]!
      let f = entry.data
      const input = inputsBySlot[f.slotId] ?? EMPTY_INPUT

      if (!f.alive) {
        const nextRespawn = f.respawnTicksLeft - 1
        if (nextRespawn <= 0) {
          const spawn = getSpawnForSlot(f.slotId, matchPrev.totalSlots)
          const promotedHuman = f.pendingHumanId !== null
          const primaryGun: PrimaryGunId = promotedHuman
            ? (f.pendingLoadout?.primary ?? f.nextPrimaryGun)
            : f.nextPrimaryGun
          const armorType = promotedHuman
            ? (f.pendingLoadout?.armor ?? f.nextArmorType)
            : f.nextArmorType
          const cosmetics = promotedHuman
            ? (f.pendingCosmetics ?? f.nextCosmetics)
            : f.nextCosmetics
          const maxArmor = ARMORS[armorType].maxArmor

          f = {
            ...f,
            isBot: promotedHuman ? false : f.isBot,
            humanId: promotedHuman ? f.pendingHumanId : f.humanId,
            name: promotedHuman ? (f.pendingHumanName ?? f.name) : f.name,
            pendingHumanId: null,
            pendingHumanName: null,
            pendingLoadout: null,
            pendingCosmetics: null,
            x: spawn.x,
            y: spawn.y,
            z: spawn.z,
            vx: 0,
            vy: 0,
            vz: 0,
            yaw: spawn.yaw,
            pitch: 0,
            grounded: true,
            alive: true,
            hp: PLAYER_MAX_HP,
            maxHp: PLAYER_MAX_HP,
            isBoss: false,
            armor: maxArmor,
            maxArmor,
            respawnTicksLeft: 0,
            activeSlot: 1,
            primaryGun,
            armorType,
            nextPrimaryGun: primaryGun,
            nextArmorType: armorType,
            cosmetics,
            nextCosmetics: cosmetics,
            primaryAmmo: GUNS[primaryGun].magSize,
            sidearmAmmo: GUNS.proofPistol.magSize,
            fireCooldownTicks: 0,
            reloadTicksLeft: 0,
            wasFireHeld: false,
            grapple: null,
            carryingScrap: 0,
            lastInputSeq: input.seq > 0 ? input.seq : f.lastInputSeq
          }
          nextEventSeq = pushEvent(feedItems, nextEventSeq, {
            kind: "spawn",
            shotEventId: 0,
            actorSlot: f.slotId,
            targetSlot: null,
            gunId: null,
            x: f.x,
            y: f.y,
            z: f.z,
            damage: 0
          })
        } else {
          f = {
            ...f,
            respawnTicksLeft: nextRespawn,
            lastInputSeq: input.seq > 0 ? input.seq : f.lastInputSeq
          }
        }
        entry.data = f
        continue
      }

      // Weapon slot switch (1 = primary, 2 = sidearm)
      let activeSlot = f.activeSlot
      let reloadTicksLeft = f.reloadTicksLeft
      let switchedWeapon = false
      if (input.switchSlot === 1 && activeSlot !== 1) {
        activeSlot = 1
        reloadTicksLeft = 0
        switchedWeapon = true
      } else if (input.switchSlot === 2 && activeSlot !== 2) {
        activeSlot = 2
        reloadTicksLeft = 0
        switchedWeapon = true
      }

      // Carry riders standing on the moving overhead Cable Car (preserving 360° aim/fire/jump-off!)
      let startX = f.x
      let startY = f.y
      let startZ = f.z
      const onCableCar =
        f.grounded &&
        Math.abs(f.x - prevCar.x) <= CABLE_CAR_SPLINE.halfW + PLAYER_RADIUS &&
        Math.abs(f.z - prevCar.z) <= CABLE_CAR_SPLINE.halfD + PLAYER_RADIUS &&
        Math.abs(f.y - prevCar.y) <= 0.22
      if (onCableCar) {
        startX += cableCar.x - prevCar.x
        startY += cableCar.y - prevCar.y
      }

      // Step active Grapple tether (pull self to ledge, or pull barrel/bot toward self)
      let grapple = f.grapple
      let kin: {
        x: number
        y: number
        z: number
        vx: number
        vy: number
        vz: number
        grounded: boolean
      }

      if (grapple && input.jump) {
        // Jump releases grapple cleanly mid-flight!
        grapple = null
      }

      if (grapple && grapple.kind === "ledge") {
        const dx = grapple.tx - startX
        const dy = grapple.ty - startY
        const dz = grapple.tz - startZ
        const dist = Ops.hypot(Ops.hypot(dx, dz), dy)
        const stepDist = GRAPPLE_PULL_SPEED * DT
        if (dist <= 1.2 || grapple.ticksLeft <= 1) {
          kin = {
            x: startX,
            y: startY,
            z: startZ,
            vx: 0,
            vy: 2.2,
            vz: 0,
            grounded: false
          }
          grapple = null
        } else {
          const nx = startX + (dx / dist) * stepDist
          const ny = startY + (dy / dist) * stepDist
          const nz = startZ + (dz / dist) * stepDist
          const blocked = sweepSegmentVsWorld(
            startX,
            startY + 0.9,
            startZ,
            nx,
            ny + 0.9,
            nz,
            PLAYER_RADIUS,
            dynamicSolids
          )
          if (blocked) {
            kin = { x: startX, y: startY, z: startZ, vx: 0, vy: 0, vz: 0, grounded: false }
            grapple = null
          } else {
            kin = {
              x: nx,
              y: ny,
              z: nz,
              vx: (dx / dist) * GRAPPLE_PULL_SPEED,
              vy: (dy / dist) * GRAPPLE_PULL_SPEED,
              vz: (dz / dist) * GRAPPLE_PULL_SPEED,
              grounded: false
            }
            grapple = { ...grapple, ticksLeft: grapple.ticksLeft - 1 }
          }
        }
      } else {
        if (grapple && grapple.kind === "prop") {
          const pIdx = props.findIndex((p) => p.id === grapple!.targetId && !p.exploded)
          if (pIdx >= 0 && grapple.ticksLeft > 1) {
            const p = props[pIdx]!
            const dx = startX - p.x
            const dz = startZ - p.z
            const d = Math.max(0.1, Ops.hypot(dx, dz))
            if (d <= 2.2) {
              grapple = null
            } else {
              props[pIdx] = { ...p, vx: (dx / d) * 14, vz: (dz / d) * 14 }
              grapple = { ...grapple, tx: p.x, ty: p.y + 0.55, tz: p.z, ticksLeft: grapple.ticksLeft - 1 }
            }
          } else {
            grapple = null
          }
        } else if (grapple && grapple.kind === "bot") {
          const tEntry = fighterEntries.find((e) => e.data.slotId === grapple!.targetId)
          if (tEntry && tEntry.data.alive && grapple.ticksLeft > 1) {
            const t = tEntry.data
            const dx = startX - t.x
            const dz = startZ - t.z
            const d = Math.max(0.1, Ops.hypot(dx, dz))
            if (d <= 2.4) {
              grapple = null
            } else {
              const pullX = t.x + (dx / d) * 11 * DT
              const pullZ = t.z + (dz / d) * 11 * DT
              const wall = sweepSegmentVsWorld(t.x, t.y + 0.9, t.z, pullX, t.y + 0.9, pullZ, PLAYER_RADIUS)
              if (!wall) {
                tEntry.data = { ...t, x: pullX, z: pullZ }
              }
              grapple = { ...grapple, tx: t.x, ty: t.y + 1.0, tz: t.z, ticksLeft: grapple.ticksLeft - 1 }
            }
          } else {
            grapple = null
          }
        }

        const speedMult = ARMORS[f.armorType].speedMultiplier
        kin = stepPlayerMovement(
          {
            x: startX,
            y: startY,
            z: startZ,
            vx: f.vx,
            vy: f.vy,
            vz: f.vz,
            grounded: f.grounded
          },
          {
            moveForward: input.moveForward,
            moveRight: input.moveRight,
            yaw: input.yaw,
            jump: input.jump
          },
          speedMult,
          DT,
          { extraSolids: dynamicSolids, anomalyActive }
        )
      }

      const gunId: GunId = activeSlot === 1 ? f.primaryGun : "proofPistol"
      const gun = GUNS[gunId]
      let primaryAmmo = f.primaryAmmo
      let sidearmAmmo = f.sidearmAmmo
      let fireCooldownTicks = switchedWeapon ? 0 : Math.max(0, f.fireCooldownTicks - 1)

      if (reloadTicksLeft > 0) {
        reloadTicksLeft -= 1
        if (reloadTicksLeft === 0) {
          if (activeSlot === 1) primaryAmmo = gun.magSize
          else sidearmAmmo = gun.magSize
        }
      }

      const curAmmo = activeSlot === 1 ? primaryAmmo : sidearmAmmo
      const wantsReload =
        (input.reload && curAmmo < gun.magSize) ||
        (input.fire && curAmmo === 0 && fireCooldownTicks === 0)
      if (wantsReload && reloadTicksLeft === 0) {
        reloadTicksLeft = gun.reloadTicks
        nextEventSeq = pushEvent(feedItems, nextEventSeq, {
          kind: "reload",
          shotEventId: 0,
          actorSlot: f.slotId,
          targetSlot: null,
          gunId,
          x: kin.x,
          y: kin.y + PLAYER_EYE_HEIGHT,
          z: kin.z,
          damage: 0
        })
      }

      const canTrigger = gun.automatic ? input.fire : input.fire && !f.wasFireHeld
      if (canTrigger && reloadTicksLeft === 0 && fireCooldownTicks === 0 && curAmmo > 0) {
        if (activeSlot === 1) primaryAmmo -= 1
        else sidearmAmmo -= 1
        fireCooldownTicks = gun.fireCooldownTicks

        const shotEventId =
          !f.isBot && input.seq > 0
            ? (f.slotId + 1) * 1_000_000 + (input.seq % 999_999)
            : nextShotEventId++

        const sinY = Ops.sin(input.yaw)
        const cosY = Ops.cos(input.yaw)
        const cosP = Ops.cos(input.pitch)
        const sinP = Ops.sin(input.pitch)

        const fwdX = -sinY * cosP
        const fwdY = sinP
        const fwdZ = -cosY * cosP
        const rightX = cosY
        const rightZ = -sinY

        const muzzleX = kin.x + fwdX * 0.45 + rightX * 0.12
        const muzzleY = kin.y + PLAYER_EYE_HEIGHT - 0.08 + fwdY * 0.45
        const muzzleZ = kin.z + fwdZ * 0.45 + rightZ * 0.12

        for (let p = 0; p < gun.pellets; p++) {
          let spreadH: number
          if (gun.pellets > 1) {
            const norm = (p / (gun.pellets - 1)) * 2 - 1
            spreadH = norm * gun.spreadRad + (random.next() - 0.5) * 0.014
          } else {
            spreadH = (random.next() - 0.5) * 2 * gun.spreadRad
          }
          const spreadV = (random.next() - 0.5) * 2 * gun.verticalSpreadRad

          const pYaw = input.yaw + spreadH
          const pPitch = clamp(input.pitch + spreadV, -MAX_PITCH, MAX_PITCH)
          const pCosP = Ops.cos(pPitch)
          const vx = -Ops.sin(pYaw) * pCosP * gun.projectileSpeed
          const vy = Ops.sin(pPitch) * gun.projectileSpeed
          const vz = -Ops.cos(pYaw) * pCosP * gun.projectileSpeed

          commands.spawn(
            Game.Command.spawn([
              Projectile,
              {
                projectileId: nextProjectileId++,
                shotEventId,
                ownerSlot: f.slotId,
                crew: f.crew,
                gunId,
                x: muzzleX,
                y: muzzleY,
                z: muzzleZ,
                vx,
                vy,
                vz,
                damage: gun.damage,
                radius: gun.projectileRadius,
                lifeTicksLeft: gun.projectileLifeTicks
              }
            ])
          )
        }

        nextEventSeq = pushEvent(feedItems, nextEventSeq, {
          kind: "shot",
          shotEventId,
          actorSlot: f.slotId,
          targetSlot: null,
          gunId,
          x: muzzleX,
          y: muzzleY,
          z: muzzleZ,
          damage: 0
        })
      }

      entry.data = {
        ...f,
        x: kin.x,
        y: kin.y,
        z: kin.z,
        vx: kin.vx,
        vy: kin.vy,
        vz: kin.vz,
        yaw: input.yaw,
        pitch: input.pitch,
        grounded: kin.grounded,
        activeSlot,
        primaryAmmo,
        sidearmAmmo,
        fireCooldownTicks,
        reloadTicksLeft,
        wasFireHeld: input.fire,
        parryTicksLeft: Math.max(0, f.parryTicksLeft - 1),
        parryCooldownTicks: Math.max(0, f.parryCooldownTicks - 1),
        smokeCooldownTicks: Math.max(0, f.smokeCooldownTicks - 1),
        grappleCooldownTicks: Math.max(0, f.grappleCooldownTicks - 1),
        grapple,
        lastInputSeq: input.seq > 0 ? input.seq : f.lastInputSeq
      }
    }

    // Helper for applying damage cleanly (used by projectiles, blasts & Foreman slam)
    const applyDamageToFighter = (
      targetIdx: number,
      damage: number,
      actorSlot: number,
      gunId: GunId | null,
      shotEventId: number,
      hitX: number,
      hitY: number,
      hitZ: number,
      zone: HitZone = "torso"
    ) => {
      const targetEntry = fighterEntries[targetIdx]!
      const victim = targetEntry.data
      if (!victim.alive) return
      damage = Math.max(1, Math.round(damage * HIT_ZONE_MULT[zone]))
      const eventZone = zone === "torso" ? undefined : zone
      const prevArmor = zone === "head" && HEAD_BYPASSES_ARMOR ? 0 : victim.armor
      const absorbed = Math.min(prevArmor, damage)
      const nextArmor = victim.armor - absorbed
      const overflow = damage - absorbed
      const nextHp = Math.max(0, victim.hp - overflow)
      const brokeArmor = prevArmor > 0 && nextArmor === 0

      if (brokeArmor) {
        nextEventSeq = pushEvent(feedItems, nextEventSeq, {
          kind: "armorBreak",
          shotEventId,
          actorSlot,
          targetSlot: victim.slotId,
          gunId,
          x: hitX,
          y: hitY,
          z: hitZ,
          damage,
          zone: eventZone
        })
      }

      if (nextHp <= 0) {
        targetEntry.data = {
          ...victim,
          hp: 0,
          armor: 0,
          alive: false,
          respawnTicksLeft: RESPAWN_TICKS,
          deaths: victim.deaths + 1,
          reloadTicksLeft: 0,
          grapple: null,
          carryingScrap: 0
        }
        const killerEntry = fighterEntries.find((e) => e.data.slotId === actorSlot)
        if (killerEntry && killerEntry.data.slotId !== victim.slotId) {
          killerEntry.data = { ...killerEntry.data, kills: killerEntry.data.kills + 1 }
        }
        nextEventSeq = pushEvent(feedItems, nextEventSeq, {
          kind: "elim",
          shotEventId,
          actorSlot,
          targetSlot: victim.slotId,
          gunId,
          x: hitX,
          y: hitY,
          z: hitZ,
          damage,
          zone: eventZone
        })
      } else {
        targetEntry.data = { ...victim, hp: nextHp, armor: nextArmor }
        nextEventSeq = pushEvent(feedItems, nextEventSeq, {
          kind: "hit",
          shotEventId,
          actorSlot,
          targetSlot: victim.slotId,
          gunId,
          x: hitX,
          y: hitY,
          z: hitZ,
          damage,
          zone: eventZone
        })
      }
    }

    // 3. Step projectiles with swept collision against world, constructs, smoke, barrels, Foreman & avatars
    let foreman = matchPrev.foreman
    for (const pEntity of queries.projectiles.each()) {
      const proj = queries.projectiles.data.projectile.get(pEntity)
      const nx = proj.x + proj.vx * DT
      const ny = proj.y + proj.vy * DT
      const nz = proj.z + proj.vz * DT

      // Carve temporary clear channels through any Ink Smoke clouds along swept path!
      clearSmokeAlongSegment(smokeClouds, proj.x, proj.y, proj.z, nx, ny, nz)

      const worldHit = sweepSegmentVsWorld(
        proj.x,
        proj.y,
        proj.z,
        nx,
        ny,
        nz,
        proj.radius * 0.5,
        dynamicSolids
      )
      let bestT = worldHit !== null ? worldHit.t : 2
      let hitKind: "none" | "fighter" | "prop" | "foreman" = "none"
      let hitIdx = -1

      // Opposing fighters (friendly fire excluded!)
      for (let idx = 0; idx < fighterEntries.length; idx++) {
        const target = fighterEntries[idx]!.data
        if (!target.alive || target.crew === proj.crew) continue
        const t = sweepSegmentVsCapsule(
          proj.x,
          proj.y,
          proj.z,
          nx,
          ny,
          nz,
          target.x,
          target.y,
          target.z,
          PLAYER_RADIUS + proj.radius,
          PLAYER_HEIGHT
        )
        if (t !== null && t < bestT) {
          bestT = t
          hitKind = "fighter"
          hitIdx = idx
        }
      }

      // Movable explosive barrels
      for (let pi = 0; pi < props.length; pi++) {
        const prop = props[pi]!
        if (prop.exploded) continue
        const t = sweepSegmentVsCapsule(
          proj.x,
          proj.y,
          proj.z,
          nx,
          ny,
          nz,
          prop.x,
          prop.y,
          prop.z,
          0.48 + proj.radius,
          1.05
        )
        if (t !== null && t < bestT) {
          bestT = t
          hitKind = "prop"
          hitIdx = pi
        }
      }

      // Elite Duel Foreman boss
      if (foreman && foreman.state !== "defeated") {
        const t = sweepSegmentVsCapsule(
          proj.x,
          proj.y,
          proj.z,
          nx,
          ny,
          nz,
          foreman.x,
          foreman.y,
          foreman.z,
          0.72 + proj.radius,
          2.25
        )
        if (t !== null && t < bestT) {
          bestT = t
          hitKind = "foreman"
          hitIdx = 0
        }
      }

      if (hitKind === "fighter" && hitIdx >= 0) {
        const hitX = proj.x + (nx - proj.x) * bestT
        const hitY = proj.y + (ny - proj.y) * bestT
        const hitZ = proj.z + (nz - proj.z) * bestT
        const victim = fighterEntries[hitIdx]!.data
        const relY = hitY - victim.y
        let zone: HitZone = relY >= HEAD_MIN_Y ? "head" : relY < LEG_MAX_Y ? "limb" : "torso"
        if (zone === "torso") {
          // Distance of the bullet's line from the body axis: silhouette edges are arms.
          const ddx = nx - proj.x
          const ddz = nz - proj.z
          const dlen = Ops.hypot(ddx, ddz)
          if (dlen > 1e-6) {
            const lateral = Math.abs((victim.x - proj.x) * ddz - (victim.z - proj.z) * ddx) / dlen
            if (lateral > ARM_LATERAL) zone = "limb"
          }
        }

        // Timed Melee Ink Parry reflects opposing projectiles!
        if (victim.parryTicksLeft > 0) {
          queries.projectiles.data.projectile.set(pEntity, {
            ...proj,
            ownerSlot: victim.slotId,
            crew: victim.crew,
            x: hitX,
            y: hitY,
            z: hitZ,
            vx: -proj.vx * 1.15,
            vy: -proj.vy * 1.15,
            vz: -proj.vz * 1.15,
            lifeTicksLeft: Math.max(proj.lifeTicksLeft, 45),
            parried: true
          })
          nextEventSeq = pushEvent(feedItems, nextEventSeq, {
            kind: "parry",
            shotEventId: proj.shotEventId,
            actorSlot: victim.slotId,
            targetSlot: proj.ownerSlot,
            gunId: proj.gunId,
            x: hitX,
            y: hitY,
            z: hitZ,
            damage: 0
          })
        } else {
          applyDamageToFighter(
            hitIdx,
            proj.damage,
            proj.ownerSlot,
            proj.gunId,
            proj.shotEventId,
            hitX,
            hitY,
            hitZ,
            zone
          )
          commands.despawn(pEntity)
        }
      } else if (hitKind === "prop" && hitIdx >= 0) {
        const p = props[hitIdx]!
        const nextHp = p.hp - proj.damage
        if (nextHp <= 0) {
          props[hitIdx] = { ...p, hp: 0, exploded: true, respawnTicksLeft: 900, vx: 0, vz: 0 }
          // Blast clears Ink Smoke in a 3D sphere + deals splash damage!
          clearSmokeInSphere(smokeClouds, p.x, p.y + 0.6, p.z, BARREL_BLAST_RADIUS)
          nextEventSeq = pushEvent(feedItems, nextEventSeq, {
            kind: "barrelBlast",
            shotEventId: proj.shotEventId,
            actorSlot: proj.ownerSlot,
            targetSlot: p.id,
            gunId: proj.gunId,
            x: p.x,
            y: p.y + 0.6,
            z: p.z,
            damage: BARREL_BLAST_DAMAGE
          })
          for (let fi = 0; fi < fighterEntries.length; fi++) {
            const ft = fighterEntries[fi]!.data
            if (!ft.alive) continue
            const dist = Ops.hypot(Ops.hypot(ft.x - p.x, ft.z - p.z), ft.y - p.y)
            if (dist <= BARREL_BLAST_RADIUS) {
              const splash = Math.round(BARREL_BLAST_DAMAGE * (1 - dist / (BARREL_BLAST_RADIUS + 0.5)))
              if (splash > 0) {
                applyDamageToFighter(fi, splash, proj.ownerSlot, proj.gunId, proj.shotEventId, ft.x, ft.y + 1, ft.z)
              }
            }
          }
        } else {
          props[hitIdx] = { ...p, hp: nextHp }
        }
        commands.despawn(pEntity)
      } else if (hitKind === "foreman" && foreman) {
        const hitX = proj.x + (nx - proj.x) * bestT
        const hitY = proj.y + (ny - proj.y) * bestT
        const hitZ = proj.z + (nz - proj.z) * bestT

        const fFwdX = -Ops.sin(foreman.yaw)
        const fFwdZ = -Ops.cos(foreman.yaw)
        const pLen = Math.max(0.01, Ops.hypot(proj.vx, proj.vz))
        // Negative dot means projectile travels directly into the Foreman's frontal iron shield
        const frontDot = (proj.vx / pLen) * fFwdX + (proj.vz / pLen) * fFwdZ
        const blockedByShield = foreman.state !== "staggered" && frontDot < -0.35

        let dmg = proj.damage
        let postureDmg = 8
        if (blockedByShield) {
          dmg = 0
          postureDmg = 4
        } else if (foreman.state === "staggered") {
          dmg = Math.round(proj.damage * 2.0)
          postureDmg = 0
        } else if (foreman.state === "recover" || frontDot > 0.25) {
          // Exposed rear/flank weak point!
          dmg = Math.round(proj.damage * 1.5)
          postureDmg = 34
        }

        const nextPosture = Math.max(0, foreman.posture - postureDmg)
        const nextHp = Math.max(0, foreman.hp - dmg)
        let nextState = foreman.state
        let nextStateTicks = foreman.stateTicksLeft

        if (nextHp <= 0) {
          nextState = "defeated"
          nextStateTicks = 0
        } else if (foreman.state !== "staggered" && nextPosture === 0) {
          nextState = "staggered"
          nextStateTicks = 150
          nextEventSeq = pushEvent(feedItems, nextEventSeq, {
            kind: "foremanStagger",
            shotEventId: proj.shotEventId,
            actorSlot: proj.ownerSlot,
            targetSlot: -1,
            gunId: proj.gunId,
            x: hitX,
            y: hitY,
            z: hitZ,
            damage: dmg
          })
        }

        foreman = {
          ...foreman,
          hp: nextHp,
          posture: nextState === "staggered" ? foreman.maxPosture : nextPosture,
          state: nextState,
          stateTicksLeft: nextStateTicks
        }
        nextEventSeq = pushEvent(feedItems, nextEventSeq, {
          kind: "hit",
          shotEventId: proj.shotEventId,
          actorSlot: proj.ownerSlot,
          targetSlot: -1,
          gunId: proj.gunId,
          x: hitX,
          y: hitY,
          z: hitZ,
          damage: dmg
        })
        commands.despawn(pEntity)
      } else if (worldHit !== null || proj.lifeTicksLeft <= 1) {
        commands.despawn(pEntity)
      } else {
        queries.projectiles.data.projectile.set(pEntity, {
          ...proj,
          x: nx,
          y: ny,
          z: nz,
          lifeTicksLeft: proj.lifeTicksLeft - 1
        })
      }
    }

    // 4. Step Mode-Specific Objectives (Mural / Elite Duel / Extraction / Foundry)
    let score0 = matchPrev.scores[0]
    let score1 = matchPrev.scores[1]
    let accum0 = matchPrev.scoreAccum[0]
    let accum1 = matchPrev.scoreAccum[1]
    let zoneStatus: MatchStateData["zoneStatus"] = "idle"
    let activeMuralId = matchPrev.activeMuralId
    let muralRotateTicksLeft = matchPrev.muralRotateTicksLeft
    let extraction = matchPrev.extraction
    let foundry = matchPrev.foundry
    let winner = matchPrev.winner
    let finishNow = false

    if (matchPrev.mode === "mural") {
      let cobaltInZone = false
      let vermilionInZone = false
      for (const entry of fighterEntries) {
        if (isInsideMuralZone(entry.data, activeMuralId)) {
          if (entry.data.crew === 0) cobaltInZone = true
          else vermilionInZone = true
        }
      }
      if (cobaltInZone && vermilionInZone) {
        zoneStatus = "contested"
      } else if (cobaltInZone) {
        zoneStatus = "cobalt"
        accum0 += 1
        if (accum0 >= TICK_HZ) {
          accum0 -= TICK_HZ
          score0 += 1
        }
      } else if (vermilionInZone) {
        zoneStatus = "vermilion"
        accum1 += 1
        if (accum1 >= TICK_HZ) {
          accum1 -= TICK_HZ
          score1 += 1
        }
      }

      muralRotateTicksLeft -= 1
      if (muralRotateTicksLeft <= 0) {
        activeMuralId = ((activeMuralId + 1) % 3) as 0 | 1 | 2
        muralRotateTicksLeft = MURAL_ROTATE_TICKS
        const nextZone = MURAL_ZONES[activeMuralId]!
        nextEventSeq = pushEvent(feedItems, nextEventSeq, {
          kind: "muralRotate",
          shotEventId: 0,
          actorSlot: -1,
          targetSlot: activeMuralId,
          gunId: null,
          x: nextZone.x,
          y: nextZone.y,
          z: nextZone.z,
          damage: 0
        })
      }

      if (score0 >= SCORE_TO_WIN || score1 >= SCORE_TO_WIN) {
        winner = score0 >= SCORE_TO_WIN ? 0 : 1
        finishNow = true
      }
    } else if (matchPrev.mode === "eliteDuel" && foreman) {
      const playerEntry = fighterEntries[0]
      if (foreman.state === "defeated") {
        score0 = SCORE_TO_WIN
        winner = 0
        finishNow = true
      } else if (playerEntry && playerEntry.data.alive) {
        const p = playerEntry.data
        const dx = p.x - foreman.x
        const dz = p.z - foreman.z
        const dist = Math.max(0.01, Ops.hypot(dx, dz))
        let fState = foreman.state
        let ticksLeft = foreman.stateTicksLeft - 1
        let fx = foreman.x
        let fz = foreman.z
        let fyaw = foreman.yaw

        if (fState === "patrol") {
          fyaw = Ops.atan2(-dx, -dz)
          if (dist > 2.6) {
            fx = clamp(fx + (dx / dist) * 3.1 * DT, -10, 10)
            fz = clamp(fz + (dz / dist) * 3.1 * DT, -8, 8)
          }
          if (dist <= 3.8 && ticksLeft <= 0) {
            fState = "windup"
            ticksLeft = 45
            nextEventSeq = pushEvent(feedItems, nextEventSeq, {
              kind: "foremanWindup",
              shotEventId: 0,
              actorSlot: -1,
              targetSlot: 0,
              gunId: null,
              x: fx,
              y: 1.5,
              z: fz,
              damage: 0
            })
          }
        } else if (fState === "windup") {
          // Locks facing during committed windup so player can flank behind!
          if (ticksLeft <= 0) {
            fState = "slam"
            ticksLeft = 10
            if (dist <= 3.7) {
              applyDamageToFighter(0, 35, -1, null, 0, p.x, p.y + 1, p.z)
            }
          }
        } else if (fState === "slam") {
          if (ticksLeft <= 0) {
            fState = "recover"
            ticksLeft = 52
          }
        } else if (fState === "recover" || fState === "staggered") {
          if (ticksLeft <= 0) {
            fState = "patrol"
            ticksLeft = 55
          }
        }

        foreman = { ...foreman, x: fx, z: fz, yaw: fyaw, state: fState, stateTicksLeft: ticksLeft }
        score0 = Math.round(((foreman.maxHp - foreman.hp) / foreman.maxHp) * 100)
      }
    } else if (matchPrev.mode === "extraction" && extraction) {
      const pEntry = fighterEntries[0]
      if (pEntry) {
        const p = pEntry.data
        if (!p.alive) {
          extraction = { ...extraction, failed: true, carriedScrap: 0, parcelCarriedBySlot: null }
          winner = 1
          finishNow = true
        } else if (!extraction.vaultUnlocked) {
          const distV = Ops.hypot(
            Ops.hypot(p.x - EXTRACTION_VAULT.x, p.z - EXTRACTION_VAULT.z),
            p.y - EXTRACTION_VAULT.y
          )
          if (distV <= EXTRACTION_VAULT.radius) {
            const prog = extraction.vaultProgressTicks + 1
            if (prog >= extraction.vaultTargetTicks) {
              extraction = {
                ...extraction,
                vaultProgressTicks: extraction.vaultTargetTicks,
                vaultUnlocked: true,
                parcelCarriedBySlot: 0,
                carriedScrap: extraction.carriedScrap + 100
              }
              score0 = 50
            } else {
              extraction = { ...extraction, vaultProgressTicks: prog }
              score0 = Math.round((prog / extraction.vaultTargetTicks) * 50)
            }
          }
        } else {
          // Escort/carry proof parcel to Tram Extraction Exit!
          const distExit = Ops.hypot(p.x - EXTRACTION_EXIT.x, p.z - EXTRACTION_EXIT.z)
          if (distExit <= EXTRACTION_EXIT.radius && p.y < 1.2) {
            extraction = {
              ...extraction,
              extracted: true,
              carriedScrap: extraction.carriedScrap + p.kills * 25
            }
            score0 = SCORE_TO_WIN
            winner = 0
            finishNow = true
            nextEventSeq = pushEvent(feedItems, nextEventSeq, {
              kind: "extractComplete",
              shotEventId: 0,
              actorSlot: 0,
              targetSlot: null,
              gunId: null,
              x: p.x,
              y: p.y,
              z: p.z,
              damage: extraction.carriedScrap
            })
          }
        }
      }
    } else if (matchPrev.mode === "foundry" && foundry) {
      const piles = foundry.piles.map((pile) => {
        if (!pile.available) {
          const left = pile.respawnTicksLeft - 1
          return left <= 0 ? { ...pile, available: true, respawnTicksLeft: 0 } : { ...pile, respawnTicksLeft: left }
        }
        for (const e of fighterEntries) {
          const f = e.data
          if (!f.alive || f.carryingScrap >= 3) continue
          const d = Ops.hypot(Ops.hypot(f.x - pile.x, f.z - pile.z), f.y - pile.y)
          if (d <= 1.8) {
            e.data = { ...f, carryingScrap: f.carryingScrap + 1 }
            return { ...pile, available: false, respawnTicksLeft: 420 }
          }
        }
        return pile
      })

      let cCarrier = -1
      let vCarrier = -1
      let cPresent = false
      let vPresent = false
      for (let i = 0; i < fighterEntries.length; i++) {
        const f = fighterEntries[i]!.data
        if (!f.alive) continue
        const d = Ops.hypot(f.x - FOUNDRY_CENTER.x, f.z - FOUNDRY_CENTER.z)
        if (d <= FOUNDRY_CENTER.radius && f.y < 2.2) {
          if (f.crew === 0) {
            cPresent = true
            if (f.carryingScrap > 0 && cCarrier < 0) cCarrier = i
          } else {
            vPresent = true
            if (f.carryingScrap > 0 && vCarrier < 0) vCarrier = i
          }
        }
      }

      const contested = cPresent && vPresent
      let dep0 = foundry.deposited[0]
      let dep1 = foundry.deposited[1]
      let siegeWinner = foundry.siegeCompletedBy

      if (!contested) {
        if (cCarrier >= 0 && nextTick % 30 === 0) {
          const f = fighterEntries[cCarrier]!.data
          fighterEntries[cCarrier]!.data = { ...f, carryingScrap: f.carryingScrap - 1 }
          dep0 += 1
          score0 = Math.min(SCORE_TO_WIN, dep0 * 10)
          nextEventSeq = pushEvent(feedItems, nextEventSeq, {
            kind: "foundryDeposit",
            shotEventId: 0,
            actorSlot: f.slotId,
            targetSlot: 0,
            gunId: null,
            x: FOUNDRY_CENTER.x,
            y: 1,
            z: FOUNDRY_CENTER.z,
            damage: dep0
          })
        } else if (vCarrier >= 0 && nextTick % 30 === 0) {
          const f = fighterEntries[vCarrier]!.data
          fighterEntries[vCarrier]!.data = { ...f, carryingScrap: f.carryingScrap - 1 }
          dep1 += 1
          score1 = Math.min(SCORE_TO_WIN, dep1 * 10)
          nextEventSeq = pushEvent(feedItems, nextEventSeq, {
            kind: "foundryDeposit",
            shotEventId: 0,
            actorSlot: f.slotId,
            targetSlot: 1,
            gunId: null,
            x: FOUNDRY_CENTER.x,
            y: 1,
            z: FOUNDRY_CENTER.z,
            damage: dep1
          })
        }
      }

      if (dep0 >= foundry.targetScrap || dep1 >= foundry.targetScrap) {
        siegeWinner = dep0 >= foundry.targetScrap ? 0 : 1
        winner = siegeWinner
        finishNow = true
      }

      zoneStatus = contested ? "contested" : cPresent ? "cobalt" : vPresent ? "vermilion" : "idle"
      foundry = {
        ...foundry,
        piles,
        deposited: [dep0, dep1],
        contestedDeposit: contested,
        siegeCompletedBy: siegeWinner
      }
    }

    const remainingTicks = Math.max(0, matchPrev.remainingTicks - 1)
    if (!finishNow && remainingTicks === 0) {
      winner = score0 > score1 ? 0 : score1 > score0 ? 1 : "draw"
      finishNow = true
    }

    // Milestone 6: Apply voluntary Cursed Proof-Block 1.5× score multiplier STRICTLY ONCE per crew on finish!
    if (finishNow) {
      let crew0Multiplied = false
      let crew1Multiplied = false
      for (const entry of fighterEntries) {
        const f = entry.data
        if (f.primaryGun === "cursedBlock" && !f.cursedRunBonusApplied) {
          entry.data = { ...f, cursedRunBonusApplied: true }
          if (f.crew === 0 && !crew0Multiplied) {
            crew0Multiplied = true
            score0 = Math.round(score0 * GUNS.cursedBlock.scoreMultiplier)
          } else if (f.crew === 1 && !crew1Multiplied) {
            crew1Multiplied = true
            score1 = Math.round(score1 * GUNS.cursedBlock.scoreMultiplier)
          }
        }
      }
      nextMachines.phase.transition({ from: "Playing", to: "Finished" })
    }

    // Commit all updated fighters back to Ritmo ECS
    for (const entry of fighterEntries) {
      queries.fighters.data.fighter.set(entry.entity, entry.data)
    }

    resources.match.set({
      ...matchPrev,
      anomalyActive,
      anomalyTicksLeft,
      tickCount: nextTick,
      remainingTicks,
      activeMuralId,
      muralRotateTicksLeft,
      scores: [score0, score1],
      scoreAccum: [accum0, accum1],
      zoneStatus,
      winner,
      nextProjectileId,
      nextShotEventId,
      nextEventSeq,
      nextConstructId,
      nextSmokeId,
      constructs,
      smokeClouds,
      props,
      cableCar,
      foreman,
      extraction,
      foundry
    })
    resources.feed.set({ items: feedItems })
  }
)
