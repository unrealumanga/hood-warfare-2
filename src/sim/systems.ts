import { Clock, Ops, Random } from "@typeonce/ritmo"
import {
  ADS_SPEED_MULT,
  ALLY_BOT_LEVEL,
  ANOMALY_CYCLE_TICKS,
  ANOMALY_DURATION_TICKS,
  ARMORS,
  ARM_LATERAL,
  BARREL_BLAST_DAMAGE,
  BARREL_BLAST_RADIUS,
  BARREL_MAX_HP,
  BOSS_ARMOR,
  BOSS_GUN,
  BOSS_HP,
  BOSS_KILL_SCORE,
  BOSS_MODES,
  BOSS_NAME,
  BOSS_SCALE,
  BOSS_SCORE_MODES,
  BOSS_SKILL_BONUS,
  BOSS_SPAWN_TICK,
  BOT_NAMES,
  DEFAULT_COSMETICS,
  DEFAULT_LOADOUT,
  DIFFICULTY_KILLS_PER_STEP,
  DIFFICULTY_MAX,
  DIFFICULTY_MIN,
  FOUNDRY_TARGET_SCRAP,
  GRAPPLE_COOLDOWN_TICKS,
  GRAPPLE_MAX_TICKS,
  GRAPPLE_PULL_SPEED,
  GRAPPLE_RANGE,
  GRENADE_BLAST_DAMAGE,
  GRENADE_BLAST_RADIUS,
  GRENADE_COOLDOWN_TICKS,
  GRENADE_FUSE_TICKS,
  GRENADE_THROW_SPEED,
  GUNS,
  HEAD_BYPASSES_ARMOR,
  HEAD_MIN_Y,
  HEALTH_PICKUP_ARMOR,
  HEALTH_PICKUP_FIRST_SPAWN_TICKS,
  HEALTH_PICKUP_HEAL,
  HEALTH_PICKUP_MODES,
  HEALTH_PICKUP_RADIUS,
  HEALTH_PICKUP_RESPAWN_TICKS,
  HIT_ZONE_MULT,
  KNIFE_COOLDOWN_TICKS,
  KNIFE_DAMAGE_BACKSTAB,
  KNIFE_DAMAGE_FRONT,
  KNIFE_RANGE,
  KNIFE_SWING_TICKS,
  LEG_MAX_Y,
  MATCH_DURATION_TICKS,
  MULTI_MAP_MODES,
  MURAL_ROTATE_TICKS,
  PARRY_COOLDOWN_TICKS,
  PARRY_WINDOW_TICKS,
  PLAYER_CROUCH_EYE_HEIGHT,
  PLAYER_CROUCH_HEIGHT,
  PLAYER_EYE_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_MAX_HP,
  PLAYER_RADIUS,
  RESPAWN_TICKS,
  SATCHEL_BLAST_DAMAGE,
  SATCHEL_BLAST_RADIUS,
  SATCHEL_COOLDOWN_TICKS,
  SATCHEL_PLANT_RANGE,
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
  SNIPER_ADS_SPEED_MULT,
  TICK_HZ,
  botCosmetics,
  sanitizeCosmetics,
  sanitizeDifficulty,
  sanitizeLoadout,
  type CrewId,
  type GameModeId,
  type GunId,
  type HitZone,
  type PrimaryGunId
} from "./data.ts"
import { computeBotDecision, makeInitialBotBrain, type BotHazard } from "./botAi.ts"
import {
  NO_BLOOM,
  NO_RECOIL,
  bloomOnShot,
  bloomStep,
  currentSpreadRad,
  recoilOnShot,
  recoilStep,
  resolveWeaponHitDamage
} from "./gunplay.ts"
import { type MapBox } from "./map.ts"
import { MAPS, sanitizeMapId, type MapDef, type MapId } from "./maps.ts"
import {
  hasLineOfSight,
  resolveCrouching,
  resolveFighterBodyCollisions,
  stepGrenadeMotion,
  stepPlayerMovement,
  sweepSegmentVsCapsule,
  sweepSegmentVsWorld,
  type BodyCollider
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
  type GrenadeData,
  type InitialHumanSpec,
  type MatchEventItem,
  type MatchStateData,
  type MovablePropData,
  type PlayerInput,
  type SatchelData,
  type SmokeCloudData
} from "./schema.ts"

const DT = 1 / TICK_HZ
const MAX_PITCH = 1.42
const MAX_FEED_EVENTS = 64
const STANDARD_BOT_PRIMARIES: ReadonlyArray<PrimaryGunId> = [
  "rollerSmg",
  "broadside",
  "linecaster",
  "pressSniper"
]

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function getSpawnForSlot(slotId: number, totalSlots: number, map = MAPS.bellYard) {
  const half = Math.max(1, Math.ceil(totalSlots / 2))
  const crew: CrewId = slotId < half ? 0 : 1
  const localIdx = crew === 0 ? slotId : slotId - half
  const pool = map.spawnPoints.filter((s) => s.crew === crew)
  const base = pool[localIdx % pool.length]!
  // Slight offset when testing 12 or 20 bots so spawns never stack identically
  const ring = Math.floor(localIdx / pool.length)
  return {
    ...base,
    x: base.x + (crew === 0 ? 1 : -1) * (map.id === "bellYard" ? ring * 1.1 : Math.min(ring, 1) * 0.8),
    z: base.z + (ring % 2 === 0 ? ring * 0.6 : -ring * 0.6)
  }
}

function initialCableCar(map: MapDef): CableCarData {
  return {
    x: map.cableCarSpline.startX,
    y: map.cableCarSpline.baseY,
    z: map.cableCarSpline.z,
    vx: 0,
    vy: 0,
    vz: 0,
    t: 0,
    dir: 1
  }
}

function initialProps(map: MapDef): ReadonlyArray<MovablePropData> {
  return map.barrelSpawns.map((b) => ({
    id: b.id,
    x: b.x,
    y: b.y,
    z: b.z,
    vx: 0,
    vy: 0,
    vz: 0,
    hp: BARREL_MAX_HP,
    exploded: false,
    respawnTicksLeft: 0
  }))
}

function initialForeman(mode: GameModeId, map: MapDef): ForemanData | null {
  if (mode !== "eliteDuel") return null
  return {
    x: map.id === "bellYard" ? 0 : map.bossEntrance.x,
    y: map.id === "bellYard" ? 0 : map.bossEntrance.y,
    z: map.id === "bellYard" ? -3.2 : map.bossEntrance.z,
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

function initialFoundry(mode: GameModeId, map: MapDef): FoundryData | null {
  if (mode !== "foundry") return null
  return {
    piles: map.foundryScrapSpawns.map((p) => ({
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
  cableCar: CableCarData,
  map = MAPS.bellYard
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
    minX: cableCar.x - map.cableCarSpline.halfW,
    maxX: cableCar.x + map.cableCarSpline.halfW,
    minY: cableCar.y - map.cableCarSpline.thickness,
    maxY: cableCar.y,
    minZ: cableCar.z - map.cableCarSpline.halfD,
    maxZ: cableCar.z + map.cableCarSpline.halfD,
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
    readonly mapId?: MapId
    readonly difficulty?: number
  } = {}
): MatchStateData {
  const mapId = sanitizeMapId(options.mapId)
  const map = MAPS[mapId]
  const mode = options.mode ?? "mural"
  const totalSlots = clamp(options.totalSlots ?? SLOTS_COUNT, 2, 21)
  const anomalyEnabled = options.anomalyEnabled ?? false
  const equipmentStaked = options.equipmentStaked ?? false
  return {
    mapId,
    pendingMapId: null,
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
    nextGrenadeId: 1,
    nextSatchelId: 1,
    constructs: [],
    smokeClouds: [],
    grenades: [],
    satchels: [],
    props: initialProps(map),
    cableCar: initialCableCar(map),
    foreman: initialForeman(mode, map),
    extraction: initialExtraction(mode, equipmentStaked),
    foundry: initialFoundry(mode, map),
    healthPickup: {
      x: map.healthPickupPosition.x,
      y: map.healthPickupPosition.y,
      z: map.healthPickupPosition.z,
      available: false,
      respawnTicksLeft: HEALTH_PICKUP_FIRST_SPAWN_TICKS
    },
    difficulty: sanitizeDifficulty(options.difficulty),
    baseDifficulty: sanitizeDifficulty(options.difficulty),
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
  humanSpec: InitialHumanSpec | undefined,
  map: MapDef
): FighterData {
  const half = Math.max(1, Math.ceil(totalSlots / 2))
  const crew: CrewId = slotId < half ? 0 : 1
  const spawn = getSpawnForSlot(slotId, totalSlots, map)
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
    crouching: false,
    ads: false,
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
    recoil: NO_RECOIL,
    bloom: NO_BLOOM,
    flinchTicksLeft: 0,
    sketchCharges: SKETCH_MAX_CHARGES,
    parryTicksLeft: 0,
    parryCooldownTicks: 0,
    smokeCooldownTicks: 0,
    grenadeCooldownTicks: 0,
    satchelCooldownTicks: 0,
    meleeTicksLeft: 0,
    meleeCooldownTicks: 0,
    grappleCooldownTicks: 0,
    grapple: null,
    carryingScrap: 0,
    cursedRunBonusApplied: false,
    lastHandledSketchId: 0,
    lastHandledEraseId: 0,
    lastHandledParryId: 0,
    lastHandledSmokeId: 0,
    lastHandledGrenadeId: 0,
    lastHandledSatchelId: 0,
    lastHandledMeleeId: 0,
    lastHandledGrappleId: 0,
    lastHandledGrappleReleaseId: 0,
    lastInputSeq: 0,
    botStrafeDir: slotId % 2 === 0 ? 1 : -1,
    botStrafeTicks: 40 + (slotId % 7) * 13,
    botWp: -1,
    botWpTicks: 0,
    brain: makeInitialBotBrain(slotId, spawn.x, spawn.z)
  }
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

function isInsideMuralZone(f: FighterData, muralId: 0 | 1 | 2, map: MapDef): boolean {
  if (!f.alive) return false
  const zone = map.muralZones[muralId]!
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

function stepCableCar(prev: CableCarData, map: MapDef): CableCarData {
  const stepT = 1 / map.cableCarSpline.cycleTicks
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
    map.cableCarSpline.startX + (map.cableCarSpline.endX - map.cableCarSpline.startX) * nextT
  const ny = map.cableCarSpline.baseY + Ops.sin(Math.PI * nextT) * map.cableCarSpline.archY
  const nz = map.cableCarSpline.z
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
    // Elite Duel / Extraction layouts exist on Bell Yard only
    const mapId = MULTI_MAP_MODES.includes(mode) ? (prev.pendingMapId ?? prev.mapId) : "bellYard"
    const map = MAPS[mapId]
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
      let fighter = makeFighterForSlot(slotId, totalSlots, humansBySlot.get(slotId), map)
      // In Elite Duel, slot 0 is the player; slot 1 is a distant ally spectator/helper
      if (mapId === "bellYard" && mode === "eliteDuel" && slotId === 0) {
        fighter = { ...fighter, x: 0, y: 0, z: 7.5, yaw: 0 }
      } else if (mapId === "bellYard" && mode === "extraction" && slotId === 0) {
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
        mapId,
        difficulty: prev.pendingDifficulty ?? prev.baseDifficulty
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
              crouch: Boolean(intent.input.crouch),
              ads: Boolean(intent.input.ads),
              jump: intent.input.jump,
              fire: intent.input.fire,
              reload: intent.input.reload,
              switchSlot: intent.input.switchSlot,
              sketchAction: intent.input.sketchAction ?? null,
              eraseActionId: intent.input.eraseActionId ?? 0,
              parryActionId: intent.input.parryActionId ?? 0,
              smokeActionId: intent.input.smokeActionId ?? 0,
              grenadeActionId: intent.input.grenadeActionId ?? 0,
              satchelActionId: intent.input.satchelActionId ?? 0,
              meleeActionId: intent.input.meleeActionId ?? 0,
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
            pendingMapId: intent.mapId === undefined ? match.mapId : sanitizeMapId(intent.mapId),
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
    const map = MAPS[match.mapId]
    if (match.paused) return

    const random = Random.draw(resources.rng)
    const entities = queries.fighters.each()
    const fighters = entities.map((e) => ({
      entity: e,
      data: queries.fighters.data.fighter.get(e)
    }))
    fighters.sort((a, b) => a.data.slotId - b.data.slotId)

    const bySlot: Record<number, PlayerInput> = { ...resources.inputs.get().bySlot }
    const dynamicSolids = buildDynamicSolids(match.constructs, match.cableCar, map)

    // Dynamic waypoint links unlocked by active Sketch Planks!
    const dynamicEdges: Array<readonly [number, number]> = []
    for (const c of match.constructs) {
      if (c.kind === "plank" && c.anchorId) {
        const anchor = map.sketchAnchors.find((a) => a.id === c.anchorId)
        if (anchor) dynamicEdges.push([anchor.wpA, anchor.wpB])
      }
    }

    const allFighterData = fighters.map((e) => e.data)
    const liveHazards: Array<BotHazard> = [
      ...match.grenades.map((g) => ({
        x: g.x,
        y: g.y,
        z: g.z,
        radius: GRENADE_BLAST_RADIUS + 0.8
      })),
      ...match.satchels.map((s) => ({
        x: s.x,
        y: s.y,
        z: s.z,
        radius: SATCHEL_BLAST_RADIUS + 0.4
      }))
    ]

    for (const entry of fighters) {
      const bot = entry.data
      if (!bot.isBot || !bot.alive) continue

      // In Elite Duel, bot stays back as a quiet observer so player duels the Foreman cleanly
      if (match.mode === "eliteDuel") {
        bySlot[bot.slotId] = { ...EMPTY_INPUT, yaw: bot.yaw }
        continue
      }

      const skillLevel = bot.isBoss
        ? match.difficulty + BOSS_SKILL_BONUS
        : bot.crew === 1
          ? match.difficulty
          : ALLY_BOT_LEVEL

      const decision = computeBotDecision({
        bot,
        allFighters: allFighterData,
        map,
        mode: match.mode,
        activeMuralId: match.activeMuralId,
        healthPickup: match.healthPickup,
        extractionUnlocked: Boolean(match.extraction?.vaultUnlocked),
        foundryPiles: match.foundry?.piles ?? [],
        dynamicSolids,
        dynamicEdges,
        smokeClouds: match.smokeClouds,
        hazards: liveHazards,
        skillLevel,
        random
      })

      queries.fighters.data.fighter.set(entry.entity, {
        ...bot,
        botStrafeDir: decision.nextBrain.strafeDir,
        botStrafeTicks: decision.nextBrain.strafeTicks,
        botWp: decision.nextBrain.targetWp,
        botWpTicks: decision.nextBrain.wpPatienceTicks,
        brain: decision.nextBrain
      })

      bySlot[bot.slotId] = {
        ...EMPTY_INPUT,
        moveForward: decision.moveForward,
        moveRight: decision.moveRight,
        yaw: decision.yaw,
        pitch: decision.pitch,
        crouch: decision.crouch,
        ads: decision.ads,
        jump: decision.jump,
        fire: decision.fire,
        reload: decision.reload,
        switchSlot: decision.switchSlot,
        grenadeActionId: decision.triggerGrenade ? bot.lastHandledGrenadeId + 1 : 0,
        meleeActionId: decision.triggerMelee ? bot.lastHandledMeleeId + 1 : 0
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
    const map = MAPS[matchPrev.mapId]
    if (matchPrev.paused) return

    const nextTick = matchPrev.tickCount + 1
    const random = Random.draw(resources.rng)
    const feedItems: Array<MatchEventItem> = [...resources.feed.get().items]
    let nextEventSeq = matchPrev.nextEventSeq
    let nextProjectileId = matchPrev.nextProjectileId
    let nextShotEventId = matchPrev.nextShotEventId
    let nextConstructId = matchPrev.nextConstructId
    let nextSmokeId = matchPrev.nextSmokeId
    let nextGrenadeId = matchPrev.nextGrenadeId
    let nextSatchelId = matchPrev.nextSatchelId
    let healthPickup = matchPrev.healthPickup
    let bossSlot = matchPrev.bossSlot
    let bossDefeated = matchPrev.bossDefeated
    let bossDownCrew: CrewId | null = null
    let foreman = matchPrev.foreman
    const grenades: Array<GrenadeData> = [...matchPrev.grenades]
    const satchels: Array<SatchelData> = [...matchPrev.satchels]

    const inputsBySlot = resources.inputs.get().bySlot
    const fighterEntries = queries.fighters.each().map((entity) => ({
      entity,
      data: queries.fighters.data.fighter.get(entity)
    }))
    fighterEntries.sort((a, b) => a.data.slotId - b.data.slotId)

    // 0. Step Overhead Cable Car, Anomaly Cycle, Construct Expiry, Smoke Decay & Props
    const prevCar = matchPrev.cableCar
    const cableCar = stepCableCar(prevCar, map)

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
          const spawn = map.barrelSpawns.find((b) => b.id === p.id) ?? { id: p.id, x: 0, y: 0, z: 2 }
          return {
            id: p.id,
            x: spawn.x,
            y: spawn.y,
            z: spawn.z,
            vx: 0,
            vy: 0,
            vz: 0,
            hp: BARREL_MAX_HP,
            exploded: false,
            respawnTicksLeft: 0
          }
        }
        return { ...p, respawnTicksLeft: left }
      }
      if (Math.abs(p.vx) > 0.05 || Math.abs(p.vz) > 0.05) {
        const nx = clamp(p.x + p.vx * DT, map.propBounds.minX, map.propBounds.maxX)
        const nz = clamp(p.z + p.vz * DT, map.propBounds.minZ, map.propBounds.maxZ)
        const blocked = sweepSegmentVsWorld(p.x, p.y + 0.5, p.z, nx, p.y + 0.5, nz, 0.45, [], map)
        if (blocked) {
          return { ...p, vx: 0, vz: 0 }
        }
        return { ...p, x: nx, z: nz, vx: p.vx * 0.88, vz: p.vz * 0.88 }
      }
      return p
    })

    // Shared combat helpers (used by projectiles, melee knife, grenades, C4 satchels, barrels & Foreman)
    const applyDamageToFighter = (
      targetIdx: number,
      rawDamage: number,
      actorSlot: number,
      gunId: GunId | null,
      shotEventId: number,
      hitX: number,
      hitY: number,
      hitZ: number,
      zone: HitZone = "torso",
      preScaled = false
    ) => {
      const targetEntry = fighterEntries[targetIdx]!
      const victim = targetEntry.data
      if (!victim.alive) return
      const damage = preScaled
        ? Math.max(1, Math.round(rawDamage))
        : Math.max(1, Math.round(rawDamage * HIT_ZONE_MULT[zone]))
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
          ads: false,
          recoil: NO_RECOIL,
          bloom: NO_BLOOM,
          flinchTicksLeft: 0,
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
        if (victim.isBoss) {
          bossDefeated = true
          const killerCrew =
            killerEntry && killerEntry.data.slotId !== victim.slotId ? killerEntry.data.crew : null
          bossDownCrew = killerCrew
          nextEventSeq = pushEvent(feedItems, nextEventSeq, {
            kind: "bossDown",
            shotEventId,
            actorSlot,
            targetSlot: victim.slotId,
            gunId,
            x: hitX,
            y: hitY,
            z: hitZ,
            damage: BOSS_KILL_SCORE
          })
        }
      } else {
        targetEntry.data = {
          ...victim,
          hp: nextHp,
          armor: nextArmor,
          flinchTicksLeft: 10
        }
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

    const detonateArea = (
      cx: number,
      cy: number,
      cz: number,
      radius: number,
      maxDamage: number,
      actorSlot: number,
      gunId: GunId | null,
      shotEventId: number,
      blastKind: "barrelBlast" | "grenadeBlast" | "satchelBlast",
      targetId: number | null,
      destroyConstructs: boolean
    ) => {
      clearSmokeInSphere(smokeClouds, cx, cy, cz, radius)
      nextEventSeq = pushEvent(feedItems, nextEventSeq, {
        kind: blastKind,
        shotEventId,
        actorSlot,
        targetSlot: targetId,
        gunId,
        x: cx,
        y: cy,
        z: cz,
        damage: maxDamage
      })

      for (let fi = 0; fi < fighterEntries.length; fi++) {
        const ft = fighterEntries[fi]!.data
        if (!ft.alive) continue
        const dist = Ops.hypot(Ops.hypot(ft.x - cx, ft.z - cz), ft.y + 0.85 - cy)
        if (dist <= radius) {
          const splash = Math.round(maxDamage * (1 - dist / (radius + 0.5)))
          if (splash > 0) {
            applyDamageToFighter(fi, splash, actorSlot, gunId, shotEventId, ft.x, ft.y + 1, ft.z)
          }
        }
      }

      if (destroyConstructs) {
        const actorEntry = fighterEntries.find((e) => e.data.slotId === actorSlot)
        for (let ci = constructs.length - 1; ci >= 0; ci--) {
          const c = constructs[ci]!
          if (actorEntry && c.crew === actorEntry.data.crew) continue
          const d = distPointToBox(cx, cy, cz, c)
          if (d <= radius * 0.9) {
            const removed = constructs.splice(ci, 1)[0]!
            const ownerEntry = fighterEntries.find((e) => e.data.slotId === removed.ownerSlot)
            if (ownerEntry) {
              ownerEntry.data = {
                ...ownerEntry.data,
                sketchCharges: Math.min(SKETCH_MAX_CHARGES, ownerEntry.data.sketchCharges + 1)
              }
            }
            nextEventSeq = pushEvent(feedItems, nextEventSeq, {
              kind: "sketchExpire",
              shotEventId: 0,
              actorSlot,
              targetSlot: removed.id,
              gunId: null,
              x: (removed.minX + removed.maxX) * 0.5,
              y: removed.maxY,
              z: (removed.minZ + removed.maxZ) * 0.5,
              damage: 0
            })
          }
        }
      }

      // Chain-detonate any live explosive barrels caught inside the blast wave!
      for (let pi = 0; pi < props.length; pi++) {
        const p = props[pi]!
        if (p.exploded) continue
        const d = Ops.hypot(Ops.hypot(p.x - cx, p.z - cz), p.y + 0.5 - cy)
        if (d <= radius + 0.55) {
          props[pi] = { ...p, hp: 0, exploded: true, respawnTicksLeft: 900, vx: 0, vz: 0 }
          detonateArea(
            p.x,
            p.y + 0.6,
            p.z,
            BARREL_BLAST_RADIUS,
            BARREL_BLAST_DAMAGE,
            actorSlot,
            gunId,
            shotEventId,
            "barrelBlast",
            p.id,
            false
          )
        }
      }
    }

    const performKnifeSlash = (attackerIdx: number, aimYaw: number, aimPitch: number) => {
      const attackerEntry = fighterEntries[attackerIdx]!
      let attacker = attackerEntry.data
      if (!attacker.alive || attacker.meleeCooldownTicks > 0) return

      attacker = {
        ...attacker,
        meleeTicksLeft: KNIFE_SWING_TICKS,
        meleeCooldownTicks: KNIFE_COOLDOWN_TICKS,
        parryTicksLeft: Math.max(attacker.parryTicksLeft, PARRY_WINDOW_TICKS)
      }
      attackerEntry.data = attacker

      const sinY = Ops.sin(aimYaw)
      const cosY = Ops.cos(aimYaw)
      const cosP = Ops.cos(aimPitch)
      const sinP = Ops.sin(aimPitch)
      const fwdX = -sinY * cosP
      const fwdY = sinP
      const fwdZ = -cosY * cosP
      const eyeY = attacker.y + (attacker.crouching ? PLAYER_CROUCH_EYE_HEIGHT : PLAYER_EYE_HEIGHT)

      nextEventSeq = pushEvent(feedItems, nextEventSeq, {
        kind: "knifeSlash",
        shotEventId: 0,
        actorSlot: attacker.slotId,
        targetSlot: null,
        gunId: null,
        x: attacker.x + fwdX * 0.72,
        y: eyeY + fwdY * 0.5 - 0.12,
        z: attacker.z + fwdZ * 0.72,
        damage: 0
      })

      const curSolids = buildDynamicSolids(constructs, cableCar, map)

      // 1. Closest opposing fighter inside forward melee cone (front 55 / backstab 110!)
      let bestIdx = -1
      let bestDist = KNIFE_RANGE
      for (let ti = 0; ti < fighterEntries.length; ti++) {
        const target = fighterEntries[ti]!.data
        if (!target.alive || target.crew === attacker.crew) continue
        const dx = target.x - attacker.x
        const ty = target.y + (target.crouching && !target.isBoss ? 0.65 : 1.05)
        const dy = ty - eyeY
        const dz = target.z - attacker.z
        const dist = Ops.hypot(Ops.hypot(dx, dz), dy)
        const reach = KNIFE_RANGE + (target.isBoss ? 0.55 : 0)
        if (dist > reach || dist > bestDist) continue
        const dot = dist > 0.05 ? (dx * fwdX + dy * fwdY + dz * fwdZ) / dist : 1
        if (dot < 0.45) continue
        if (
          dist > 0.75 &&
          sweepSegmentVsWorld(attacker.x, eyeY, attacker.z, target.x, ty, target.z, 0, curSolids, map) !== null
        ) {
          continue
        }
        bestDist = dist
        bestIdx = ti
      }

      if (bestIdx >= 0) {
        const victim = fighterEntries[bestIdx]!.data
        const atkHorizX = -sinY
        const atkHorizZ = -cosY
        const vicHorizX = -Ops.sin(victim.yaw)
        const vicHorizZ = -Ops.cos(victim.yaw)
        const facingSameWay = atkHorizX * vicHorizX + atkHorizZ * vicHorizZ
        const isBackstab = facingSameWay > 0.35 && !victim.isBoss
        const dmg = isBackstab ? KNIFE_DAMAGE_BACKSTAB : KNIFE_DAMAGE_FRONT
        applyDamageToFighter(
          bestIdx,
          dmg,
          attacker.slotId,
          null,
          0,
          victim.x,
          victim.y + 1.05,
          victim.z,
          "torso",
          true
        )
      }

      // 2. Also slice explosive barrels within knife reach!
      for (let pi = 0; pi < props.length; pi++) {
        const p = props[pi]!
        if (p.exploded) continue
        const dx = p.x - attacker.x
        const dy = p.y + 0.55 - eyeY
        const dz = p.z - attacker.z
        const dist = Ops.hypot(Ops.hypot(dx, dz), dy)
        if (dist > KNIFE_RANGE + 0.3) continue
        const dot = dist > 0.05 ? (dx * fwdX + dy * fwdY + dz * fwdZ) / dist : 1
        if (dot < 0.45) continue
        const nextHp = p.hp - BARREL_MAX_HP
        if (nextHp <= 0) {
          props[pi] = { ...p, hp: 0, exploded: true, respawnTicksLeft: 900, vx: 0, vz: 0 }
          detonateArea(
            p.x,
            p.y + 0.6,
            p.z,
            BARREL_BLAST_RADIUS,
            BARREL_BLAST_DAMAGE,
            attacker.slotId,
            null,
            0,
            "barrelBlast",
            p.id,
            false
          )
        }
      }

      // 3. Also slash Elite Duel Foreman if in reach
      if (foreman && foreman.state !== "defeated") {
        const dx = foreman.x - attacker.x
        const dz = foreman.z - attacker.z
        const dist = Ops.hypot(dx, dz)
        if (dist <= KNIFE_RANGE + 0.65) {
          const dmg = foreman.state === "staggered" ? 95 : 55
          const nextPosture = Math.max(0, foreman.posture - 28)
          const nextHp = Math.max(0, foreman.hp - dmg)
          let nextState: ForemanData["state"] = foreman.state
          let nextStateTicks = foreman.stateTicksLeft
          if (nextHp <= 0) {
            nextState = "defeated"
            nextStateTicks = 0
          } else if (foreman.state !== "staggered" && nextPosture === 0) {
            nextState = "staggered"
            nextStateTicks = 150
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
            shotEventId: 0,
            actorSlot: attacker.slotId,
            targetSlot: -1,
            gunId: null,
            x: foreman.x,
            y: foreman.y + 1.2,
            z: foreman.z,
            damage: dmg
          })
        }
      }
    }

    // 1. Process Sketch Placement & Erase actions in deterministic slot order (simultaneous conflict safe!)
    for (let idx = 0; idx < fighterEntries.length; idx++) {
      const entry = fighterEntries[idx]!
      let f = entry.data
      if (!f.alive) continue
      const input = inputsBySlot[f.slotId] ?? EMPTY_INPUT

      f = { ...f, crouching: !f.isBoss && resolveCrouching(f, input.crouch === true, {
        map, extraSolids: buildDynamicSolids(constructs, cableCar, map)
      }) }
      entry.data = f

      // A. Sketch Placement (Anchor / Free / Waist-High Barricade)
      if (
        input.sketchAction &&
        input.sketchAction.actionId > f.lastHandledSketchId &&
        f.sketchCharges > 0
      ) {
        const act = input.sketchAction
        let created: ConstructData | null = null
        if (act.kind === "placeAnchor") {
          const anchor = map.sketchAnchors.find((a) => a.id === act.anchorId)
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
          const cx = clamp(f.x - sinY * 2.8, map.placementBounds.minX, map.placementBounds.maxX)
          const cz = clamp(f.z - cosY * 2.8, map.placementBounds.minZ, map.placementBounds.maxZ)
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
          const cx = clamp(f.x - sinY * 2.1, map.placementBounds.minX, map.placementBounds.maxX)
          const cz = clamp(f.z - cosY * 2.1, map.placementBounds.minZ, map.placementBounds.maxZ)
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
        const targetX = clamp(f.x - sinY * 5.0, map.smokeBounds.minX, map.smokeBounds.maxX)
        const targetZ = clamp(f.z - cosY * 5.0, map.smokeBounds.minZ, map.smokeBounds.maxZ)
        const wall = sweepSegmentVsWorld(
          f.x,
          f.y + (f.crouching ? PLAYER_CROUCH_EYE_HEIGHT : PLAYER_EYE_HEIGHT),
          f.z,
          targetX,
          f.y + 1.4,
          targetZ,
          0.35,
          [], map
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

      // D2. Frag Grenade Throw [G] — 3D ballistic throw with bounce & radial blast!
      if (
        input.grenadeActionId &&
        input.grenadeActionId > f.lastHandledGrenadeId &&
        f.grenadeCooldownTicks === 0
      ) {
        const sinY = Ops.sin(input.yaw)
        const cosY = Ops.cos(input.yaw)
        const cosP = Ops.cos(input.pitch)
        const sinP = Ops.sin(input.pitch)
        const fwdX = -sinY * cosP
        const fwdY = sinP
        const fwdZ = -cosY * cosP
        const eyeY = f.y + (f.crouching ? PLAYER_CROUCH_EYE_HEIGHT : PLAYER_EYE_HEIGHT)
        const gx = f.x + fwdX * 0.5
        const gy = Math.max(0.35, eyeY - 0.1 + fwdY * 0.35)
        const gz = f.z + fwdZ * 0.5
        const gId = nextGrenadeId++
        grenades.push({
          id: gId,
          ownerSlot: f.slotId,
          crew: f.crew,
          x: gx,
          y: gy,
          z: gz,
          vx: fwdX * GRENADE_THROW_SPEED + f.vx * 0.25,
          vy: fwdY * GRENADE_THROW_SPEED + 2.6,
          vz: fwdZ * GRENADE_THROW_SPEED + f.vz * 0.25,
          fuseTicksLeft: GRENADE_FUSE_TICKS
        })
        f = {
          ...f,
          lastHandledGrenadeId: input.grenadeActionId,
          grenadeCooldownTicks: GRENADE_COOLDOWN_TICKS
        }
        nextEventSeq = pushEvent(feedItems, nextEventSeq, {
          kind: "grenadeThrow",
          shotEventId: 0,
          actorSlot: f.slotId,
          targetSlot: gId,
          gunId: null,
          x: gx,
          y: gy,
          z: gz,
          damage: 0
        })
        entry.data = f
      }

      // D3. Remote C4 Ink Satchel [B] — 1st press plants sticky C4; 2nd press remote-detonates!
      if (input.satchelActionId && input.satchelActionId > f.lastHandledSatchelId) {
        f = { ...f, lastHandledSatchelId: input.satchelActionId }
        const existingIdx = satchels.findIndex((s) => s.ownerSlot === f.slotId)
        if (existingIdx >= 0) {
          const s = satchels.splice(existingIdx, 1)[0]!
          f = { ...f, satchelCooldownTicks: SATCHEL_COOLDOWN_TICKS }
          entry.data = f
          detonateArea(
            s.x,
            s.y,
            s.z,
            SATCHEL_BLAST_RADIUS,
            SATCHEL_BLAST_DAMAGE,
            f.slotId,
            null,
            0,
            "satchelBlast",
            s.id,
            true
          )
          f = entry.data
        } else if (f.satchelCooldownTicks === 0) {
          const sinY = Ops.sin(input.yaw)
          const cosY = Ops.cos(input.yaw)
          const cosP = Ops.cos(input.pitch)
          const sinP = Ops.sin(input.pitch)
          const fwdX = -sinY * cosP
          const fwdY = sinP
          const fwdZ = -cosY * cosP
          const eyeY = f.y + (f.crouching ? PLAYER_CROUCH_EYE_HEIGHT : PLAYER_EYE_HEIGHT)
          const endX = f.x + fwdX * SATCHEL_PLANT_RANGE
          const endY = eyeY + fwdY * SATCHEL_PLANT_RANGE
          const endZ = f.z + fwdZ * SATCHEL_PLANT_RANGE
          const dynNow = buildDynamicSolids(constructs, cableCar, map)
          const wallHit = sweepSegmentVsWorld(f.x, eyeY, f.z, endX, endY, endZ, 0.08, dynNow, map)

          let sx: number
          let sy: number
          let sz: number
          let snx = 0
          let sny = 1
          let snz = 0
          if (wallHit !== null) {
            sx = f.x + (endX - f.x) * wallHit.t + wallHit.nx * 0.08
            sy = Math.max(0.08, eyeY + (endY - eyeY) * wallHit.t + wallHit.ny * 0.08)
            sz = f.z + (endZ - f.z) * wallHit.t + wallHit.nz * 0.08
            snx = wallHit.nx
            sny = wallHit.ny
            snz = wallHit.nz
          } else {
            sx = clamp(f.x - sinY * 1.15, map.propBounds.minX, map.propBounds.maxX)
            sy = f.y + 0.08
            sz = clamp(f.z - cosY * 1.15, map.propBounds.minZ, map.propBounds.maxZ)
          }
          const sId = nextSatchelId++
          satchels.push({
            id: sId,
            ownerSlot: f.slotId,
            crew: f.crew,
            x: sx,
            y: sy,
            z: sz,
            nx: snx,
            ny: sny,
            nz: snz,
            armedTicks: 0
          })
          nextEventSeq = pushEvent(feedItems, nextEventSeq, {
            kind: "satchelPlant",
            shotEventId: 0,
            actorSlot: f.slotId,
            targetSlot: sId,
            gunId: null,
            x: sx,
            y: sy,
            z: sz,
            damage: 0
          })
          entry.data = f
        } else {
          entry.data = f
        }
      }

      // D4. Quick Commando Knife Jab [F] — close melee slash + unified Ink Parry window!
      if (
        input.meleeActionId &&
        input.meleeActionId > f.lastHandledMeleeId &&
        f.meleeCooldownTicks === 0
      ) {
        f = { ...f, lastHandledMeleeId: input.meleeActionId }
        entry.data = f
        performKnifeSlash(idx, input.yaw, input.pitch)
        f = entry.data
      }

      // E. Target-Sensitive Grapple (Marked Ledge -> pull self; Movable Barrel or Light Bot -> pull toward self!)
      if (input.grappleReleaseId && input.grappleReleaseId > f.lastHandledGrappleReleaseId) {
        f = { ...f, lastHandledGrappleReleaseId: input.grappleReleaseId, grapple: null }
        entry.data = f
      } else if (
        input.grappleActionId &&
        input.grappleActionId > f.lastHandledGrappleId &&
        f.grappleCooldownTicks === 0 &&
        !f.crouching
      ) {
        f = { ...f, lastHandledGrappleId: input.grappleActionId }
        const sinY = Ops.sin(input.yaw)
        const cosY = Ops.cos(input.yaw)
        const cosP = Ops.cos(input.pitch)
        const sinP = Ops.sin(input.pitch)
        const aimX = -sinY * cosP
        const aimY = sinP
        const aimZ = -cosY * cosP
        const eyeY = f.y + (f.crouching ? PLAYER_CROUCH_EYE_HEIGHT : PLAYER_EYE_HEIGHT)

        let bestDot = 0.86
        let chosen: FighterData["grapple"] = null

        for (const ledge of map.grappleLedges) {
          const dx = ledge.x - f.x
          const dy = ledge.y - eyeY
          const dz = ledge.z - f.z
          const dist = Ops.hypot(Ops.hypot(dx, dz), dy)
          if (dist < 1.5 || dist > GRAPPLE_RANGE) continue
          const dot = (dx * aimX + dy * aimY + dz * aimZ) / dist
          if (dot > bestDot && hasLineOfSight(f.x, eyeY, f.z, ledge.x, ledge.y, ledge.z, [], [], map)) {
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
          if (dot > bestDot && hasLineOfSight(f.x, eyeY, f.z, prop.x, prop.y + 0.55, prop.z, [], [], map)) {
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
          const dy = o.y + (o.crouching && !o.isBoss ? 0.65 * PLAYER_CROUCH_HEIGHT : 1.0) - eyeY
          const dz = o.z - f.z
          const dist = Ops.hypot(Ops.hypot(dx, dz), dy)
          if (dist < 2.2 || dist > GRAPPLE_RANGE) continue
          const dot = (dx * aimX + dy * aimY + dz * aimZ) / dist
          if (dot > bestDot && hasLineOfSight(f.x, eyeY, f.z, o.x, o.y + (o.crouching && !o.isBoss ? 0.65 * PLAYER_CROUCH_HEIGHT : 1.0), o.z, [], [], map)) {
            bestDot = dot
            chosen = {
              kind: "bot",
              targetId: o.slotId,
              tx: o.x,
              ty: o.y + (o.crouching && !o.isBoss ? 0.65 * PLAYER_CROUCH_HEIGHT : 1.0),
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

    const dynamicSolids = buildDynamicSolids(constructs, cableCar, map)

    // 1b. The boss enters: the lowest red bot is promoted once per match
    if (nextTick === BOSS_SPAWN_TICK && bossSlot < 0 && BOSS_MODES.includes(matchPrev.mode)) {
      let pick: (typeof fighterEntries)[number] | null = null
      for (const e of fighterEntries) {
        if (e.data.crew !== 1 || !e.data.isBot || e.data.pendingHumanId !== null) continue
        if (pick === null || e.data.slotId < pick.data.slotId) pick = e
      }
      if (pick !== null) {
        const bf = pick.data
        const bspawn = map.bossEntrance
        const bArmor = ARMORS[BOSS_ARMOR].maxArmor
        pick.data = {
          ...bf,
          name: BOSS_NAME,
          isBoss: true,
          maxHp: BOSS_HP,
          hp: BOSS_HP,
          armor: bArmor,
          maxArmor: bArmor,
          armorType: BOSS_ARMOR,
          primaryGun: BOSS_GUN,
          activeSlot: 1,
          primaryAmmo: GUNS[BOSS_GUN].magSize,
          sidearmAmmo: GUNS.proofPistol.magSize,
          reloadTicksLeft: 0,
          fireCooldownTicks: 0,
          alive: true,
          respawnTicksLeft: 0,
          x: bspawn.x,
          y: bspawn.y,
          z: bspawn.z,
          vx: 0,
          vy: 0,
          vz: 0,
          yaw: bspawn.yaw,
          grounded: true,
          ads: false,
          recoil: NO_RECOIL,
          bloom: NO_BLOOM,
          flinchTicksLeft: 0,
          grapple: null,
          carryingScrap: 0,
          cosmetics: { top: "workJacket", hat: "cap", swatch: "charcoal" },
          brain: makeInitialBotBrain(bf.slotId, bspawn.x, bspawn.z)
        }
        bossSlot = bf.slotId
        nextEventSeq = pushEvent(feedItems, nextEventSeq, {
          kind: "bossSpawn",
          shotEventId: 0,
          actorSlot: bf.slotId,
          targetSlot: null,
          gunId: BOSS_GUN,
          x: bspawn.x,
          y: bspawn.y + 1,
          z: bspawn.z,
          damage: BOSS_HP
        })
      }
    }

    // 2. Step respawn, cable-car riding, grapple travel, movement, reloading, and firing
    for (let idx = 0; idx < fighterEntries.length; idx++) {
      const entry = fighterEntries[idx]!
      let f = entry.data
      const input = inputsBySlot[f.slotId] ?? EMPTY_INPUT

      if (!f.alive) {
        const nextRespawn = f.respawnTicksLeft - 1
        if (nextRespawn <= 0) {
          const spawn = getSpawnForSlot(f.slotId, matchPrev.totalSlots, map)
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
            name: promotedHuman
              ? (f.pendingHumanName ?? f.name)
              : f.isBoss
                ? BOT_NAMES[f.slotId % BOT_NAMES.length]!
                : f.name,
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
            crouching: false,
            ads: false,
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
            recoil: NO_RECOIL,
            bloom: NO_BLOOM,
            flinchTicksLeft: 0,
            grenadeCooldownTicks: 0,
            satchelCooldownTicks: 0,
            meleeTicksLeft: 0,
            meleeCooldownTicks: 0,
            grapple: null,
            carryingScrap: 0,
            lastInputSeq: input.seq > 0 ? input.seq : f.lastInputSeq,
            brain: makeInitialBotBrain(f.slotId, spawn.x, spawn.z)
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

      // Weapon slot switch (1 = primary, 2 = sidearm, 3 = commando knife)
      let activeSlot: 1 | 2 | 3 = f.activeSlot
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
      } else if (input.switchSlot === 3 && activeSlot !== 3) {
        activeSlot = 3
        reloadTicksLeft = 0
        switchedWeapon = true
      }
      const ads = Boolean(input.ads) && activeSlot !== 3 && reloadTicksLeft === 0

      // Carry riders standing on the moving overhead Cable Car (preserving 360° aim/fire/jump-off!)
      let startX = f.x
      let startY = f.y
      let startZ = f.z
      const onCableCar =
        f.grounded &&
        Math.abs(f.x - prevCar.x) <= map.cableCarSpline.halfW + PLAYER_RADIUS &&
        Math.abs(f.z - prevCar.z) <= map.cableCarSpline.halfD + PLAYER_RADIUS &&
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
        crouching?: boolean
      }

      if (grapple && input.jump && !f.crouching) {
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
            dynamicSolids,
            map
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
              const wall = sweepSegmentVsWorld(t.x, t.y + 0.9, t.z, pullX, t.y + 0.9, pullZ, PLAYER_RADIUS, [], map)
              if (!wall) {
                tEntry.data = { ...t, x: pullX, z: pullZ }
              }
              grapple = { ...grapple, tx: t.x, ty: t.y + 1.0, tz: t.z, ticksLeft: grapple.ticksLeft - 1 }
            }
          } else {
            grapple = null
          }
        }

        const adsMult = ads
          ? activeSlot === 1 && GUNS[f.primaryGun].hasScope
            ? SNIPER_ADS_SPEED_MULT
            : ADS_SPEED_MULT
          : 1.0
        const speedMult = ARMORS[f.armorType].speedMultiplier * adsMult
        kin = stepPlayerMovement(
          {
            x: startX,
            y: startY,
            z: startZ,
            vx: f.vx,
            vy: f.vy,
            vz: f.vz,
            grounded: f.grounded,
            crouching: f.crouching
          },
          {
            moveForward: input.moveForward,
            moveRight: input.moveRight,
            yaw: input.yaw,
            jump: input.jump
          },
          speedMult,
          DT,
          { map, extraSolids: dynamicSolids, anomalyActive, crouch: !f.isBoss && input.crouch === true }
        )
      }

      if (kin.crouching !== undefined) f = { ...f, crouching: kin.crouching }

      let primaryAmmo = f.primaryAmmo
      let sidearmAmmo = f.sidearmAmmo
      let fireCooldownTicks = switchedWeapon ? 0 : Math.max(0, f.fireCooldownTicks - 1)
      let recoil = switchedWeapon ? NO_RECOIL : f.recoil
      let bloom = switchedWeapon ? NO_BLOOM : f.bloom

      if (activeSlot === 3) {
        recoil = NO_RECOIL
        bloom = NO_BLOOM
        // Equipped Commando Knife: LMB performs a crisp melee hack/jab + parry!
        entry.data = { ...f, x: kin.x, y: kin.y, z: kin.z, activeSlot }
        if (input.fire && !f.wasFireHeld && f.meleeCooldownTicks === 0) {
          performKnifeSlash(idx, input.yaw, input.pitch)
          f = entry.data
        }
      } else {
        const gunId: GunId = activeSlot === 1 ? f.primaryGun : "proofPistol"
        const gun = GUNS[gunId]
        recoil = recoilStep(recoil, gunId, nextTick)
        bloom = bloomStep(bloom, gun, nextTick)

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
            y: kin.y + (f.crouching ? PLAYER_CROUCH_EYE_HEIGHT : PLAYER_EYE_HEIGHT),
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

          const baseYaw = input.yaw + recoil.yaw
          const basePitch = clamp(input.pitch + recoil.pitch, -MAX_PITCH, MAX_PITCH)
          const sinY = Ops.sin(baseYaw)
          const cosY = Ops.cos(baseYaw)
          const cosP = Ops.cos(basePitch)
          const sinP = Ops.sin(basePitch)

          const fwdX = -sinY * cosP
          const fwdY = sinP
          const fwdZ = -cosY * cosP
          const rightX = cosY
          const rightZ = -sinY

          const muzzleX = kin.x + fwdX * 0.45 + rightX * 0.12
          const muzzleY =
            kin.y + (f.crouching ? PLAYER_CROUCH_EYE_HEIGHT : PLAYER_EYE_HEIGHT) - 0.08 + fwdY * 0.45
          const muzzleZ = kin.z + fwdZ * 0.45 + rightZ * 0.12

          const horizSpeed = Ops.hypot(kin.vx, kin.vz)
          const effSpreadH = currentSpreadRad(
            gun,
            bloom,
            horizSpeed,
            !kin.grounded,
            f.crouching,
            ads
          )
          const spreadRatio = gun.spreadRad > 1e-5 ? effSpreadH / gun.spreadRad : 1
          const effSpreadV = gun.verticalSpreadRad * spreadRatio

          for (let p = 0; p < gun.pellets; p++) {
            let spreadH: number
            if (gun.pellets > 1) {
              const norm = (p / (gun.pellets - 1)) * 2 - 1
              spreadH = norm * effSpreadH + (random.next() - 0.5) * 0.014
            } else {
              spreadH = (random.next() - 0.5) * 2 * effSpreadH
            }
            const spreadV = (random.next() - 0.5) * 2 * effSpreadV

            const pYaw = baseYaw + spreadH
            const pPitch = clamp(basePitch + spreadV, -MAX_PITCH, MAX_PITCH)
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

          recoil = recoilOnShot(recoil, gunId, nextTick, ads)
          bloom = bloomOnShot(bloom, gun, nextTick)

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
        ads,
        activeSlot,
        primaryAmmo,
        sidearmAmmo,
        fireCooldownTicks,
        reloadTicksLeft,
        wasFireHeld: input.fire,
        recoil,
        bloom,
        flinchTicksLeft: Math.max(0, f.flinchTicksLeft - 1),
        parryTicksLeft: Math.max(0, f.parryTicksLeft - 1),
        parryCooldownTicks: Math.max(0, f.parryCooldownTicks - 1),
        smokeCooldownTicks: Math.max(0, f.smokeCooldownTicks - 1),
        grenadeCooldownTicks: Math.max(0, f.grenadeCooldownTicks - 1),
        satchelCooldownTicks: Math.max(0, f.satchelCooldownTicks - 1),
        meleeTicksLeft: Math.max(0, f.meleeTicksLeft - 1),
        meleeCooldownTicks: Math.max(0, f.meleeCooldownTicks - 1),
        grappleCooldownTicks: Math.max(0, f.grappleCooldownTicks - 1),
        grapple,
        lastInputSeq: input.seq > 0 ? input.seq : f.lastInputSeq
      }
    }

    // 2b. Solid Fighter Body Collisions (firm enemy separation + gentle ally separation, wall-clamped)
    const bodyColliders: Array<BodyCollider> = fighterEntries.map((e) => {
      const f = e.data
      const scale = f.isBoss ? BOSS_SCALE : 1
      return {
        slotId: f.slotId,
        crew: f.crew,
        alive: f.alive,
        x: f.x,
        y: f.y,
        z: f.z,
        height: (f.crouching && !f.isBoss ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT) * scale,
        radius: PLAYER_RADIUS * scale
      }
    })
    resolveFighterBodyCollisions(bodyColliders, dynamicSolids, map)
    for (let i = 0; i < fighterEntries.length; i++) {
      const b = bodyColliders[i]!
      const f = fighterEntries[i]!.data
      if (f.alive && (b.x !== f.x || b.z !== f.z)) {
        fighterEntries[i]!.data = { ...f, x: b.x, z: b.z }
      }
    }

    // 2c. Step Live Frag Grenades (ballistic arc, wall/floor bounce, fuse blast) & C4 Satchels
    const nextGrenades: Array<GrenadeData> = []
    for (const g of grenades) {
      const { next, bounced } = stepGrenadeMotion(g, DT, dynamicSolids, map)
      if (bounced) {
        nextEventSeq = pushEvent(feedItems, nextEventSeq, {
          kind: "grenadeBounce",
          shotEventId: 0,
          actorSlot: g.ownerSlot,
          targetSlot: g.id,
          gunId: null,
          x: next.x,
          y: next.y,
          z: next.z,
          damage: 0
        })
      }
      const nextFuse = g.fuseTicksLeft - 1
      if (nextFuse <= 0) {
        detonateArea(
          next.x,
          next.y + 0.15,
          next.z,
          GRENADE_BLAST_RADIUS,
          GRENADE_BLAST_DAMAGE,
          g.ownerSlot,
          null,
          0,
          "grenadeBlast",
          g.id,
          true
        )
      } else {
        nextGrenades.push({
          ...g,
          x: next.x,
          y: next.y,
          z: next.z,
          vx: next.vx,
          vy: next.vy,
          vz: next.vz,
          fuseTicksLeft: nextFuse
        })
      }
    }
    const nextSatchels: Array<SatchelData> = satchels.map((s) => ({
      ...s,
      armedTicks: s.armedTicks + 1
    }))

    // 3. Step projectiles with swept collision against world, constructs, smoke, barrels, Foreman & avatars
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
        dynamicSolids,
        map
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
          // The boss is drawn BOSS_SCALE times bigger: its hit capsule must match what the player sees
          PLAYER_RADIUS * (target.isBoss ? BOSS_SCALE : 1) + proj.radius,
          (target.crouching && !target.isBoss ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT) * (target.isBoss ? BOSS_SCALE : 1)
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
        const bodyScale = victim.isBoss ? BOSS_SCALE : 1
        const relY = (hitY - victim.y) / bodyScale
        const heightRatio = victim.crouching && !victim.isBoss ? PLAYER_CROUCH_HEIGHT / PLAYER_HEIGHT : 1
        let zone: HitZone = relY >= HEAD_MIN_Y * heightRatio ? "head" : relY < LEG_MAX_Y * heightRatio ? "limb" : "torso"
        if (zone === "torso") {
          // Distance of the bullet's line from the body axis: silhouette edges are arms.
          const ddx = nx - proj.x
          const ddz = nz - proj.z
          const dlen = Ops.hypot(ddx, ddz)
          if (dlen > 1e-6) {
            const lateral = Math.abs((victim.x - proj.x) * ddz - (victim.z - proj.z) * ddx) / dlen
            if (lateral > ARM_LATERAL * bodyScale) zone = "limb"
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
          const pGun = GUNS[proj.gunId]
          const distTraveled = Math.max(
            0,
            (pGun.projectileLifeTicks - proj.lifeTicksLeft) * DT * pGun.projectileSpeed
          )
          const hitDmg = resolveWeaponHitDamage(pGun, zone, distTraveled)
          applyDamageToFighter(
            hitIdx,
            hitDmg,
            proj.ownerSlot,
            proj.gunId,
            proj.shotEventId,
            hitX,
            hitY,
            hitZ,
            zone,
            true
          )
          commands.despawn(pEntity)
        }
      } else if (hitKind === "prop" && hitIdx >= 0) {
        const hitX = proj.x + (nx - proj.x) * bestT
        const hitY = proj.y + (ny - proj.y) * bestT
        const hitZ = proj.z + (nz - proj.z) * bestT
        const p = props[hitIdx]!
        const nextHp = p.hp - proj.damage
        if (nextHp <= 0) {
          props[hitIdx] = { ...p, hp: 0, exploded: true, respawnTicksLeft: 900, vx: 0, vz: 0 }
          detonateArea(
            p.x,
            p.y + 0.6,
            p.z,
            BARREL_BLAST_RADIUS,
            BARREL_BLAST_DAMAGE,
            proj.ownerSlot,
            proj.gunId,
            proj.shotEventId,
            "barrelBlast",
            p.id,
            false
          )
        } else {
          props[hitIdx] = { ...p, hp: nextHp }
          nextEventSeq = pushEvent(feedItems, nextEventSeq, {
            kind: "barrelHit",
            shotEventId: proj.shotEventId,
            actorSlot: proj.ownerSlot,
            targetSlot: p.id,
            gunId: proj.gunId,
            x: hitX,
            y: hitY,
            z: hitZ,
            damage: proj.damage
          })
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
    if (BOSS_SCORE_MODES.includes(matchPrev.mode)) {
      if (bossDownCrew === 0) score0 += BOSS_KILL_SCORE
      else if (bossDownCrew === 1) score1 += BOSS_KILL_SCORE
    }

    if (matchPrev.mode === "mural") {
      let cobaltInZone = false
      let vermilionInZone = false
      for (const entry of fighterEntries) {
        if (isInsideMuralZone(entry.data, activeMuralId, map)) {
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
        const nextZone = map.muralZones[activeMuralId]!
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
            fx = clamp(fx + (dx / dist) * 3.1 * DT, map.foremanBounds.minX, map.foremanBounds.maxX)
            fz = clamp(fz + (dz / dist) * 3.1 * DT, map.foremanBounds.minZ, map.foremanBounds.maxZ)
            if (map.id === "overprintHall" && sweepSegmentVsWorld(foreman.x, foreman.y + 0.9, foreman.z, fx, foreman.y + 0.9, fz, 0.55, [], map)) {
              fx = foreman.x
              fz = foreman.z
            }
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
            Ops.hypot(p.x - map.extractionVault.x, p.z - map.extractionVault.z),
            p.y - map.extractionVault.y
          )
          if (distV <= map.extractionVault.radius) {
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
          const distExit = Ops.hypot(p.x - map.extractionExit.x, p.z - map.extractionExit.z)
          if (distExit <= map.extractionExit.radius && p.y < 1.2) {
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
        const d = Ops.hypot(f.x - map.foundryCenter.x, f.z - map.foundryCenter.z)
        if (d <= map.foundryCenter.radius && f.y < 2.2) {
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
            x: map.foundryCenter.x,
            y: 1,
            z: map.foundryCenter.z,
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
            x: map.foundryCenter.x,
            y: 1,
            z: map.foundryCenter.z,
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

    // Health booster: one pickup in the middle of the map. Whoever reaches it first (closest, then lowest slot)
    // and actually needs it takes it; it then respawns after HEALTH_PICKUP_RESPAWN_TICKS.
    if (HEALTH_PICKUP_MODES.includes(matchPrev.mode)) {
      if (!healthPickup.available) {
        const left = healthPickup.respawnTicksLeft - 1
        healthPickup = left <= 0 ? { ...healthPickup, available: true, respawnTicksLeft: 0 } : { ...healthPickup, respawnTicksLeft: left }
      } else {
        let bestIdx = -1
        let bestDist = HEALTH_PICKUP_RADIUS
        for (let i = 0; i < fighterEntries.length; i++) {
          const f = fighterEntries[i]!.data
          if (!f.alive || (f.hp >= f.maxHp && f.armor >= f.maxArmor)) continue
          if (Math.abs(f.y - healthPickup.y) > 1.6) continue
          const d = Ops.hypot(f.x - healthPickup.x, f.z - healthPickup.z)
          const better = d < bestDist || (d === bestDist && bestIdx >= 0 && f.slotId < fighterEntries[bestIdx]!.data.slotId)
          if (better) {
            bestDist = d
            bestIdx = i
          }
        }
        if (bestIdx >= 0) {
          const entry = fighterEntries[bestIdx]!
          const f = entry.data
          const healed = Math.min(f.maxHp, f.hp + HEALTH_PICKUP_HEAL) - f.hp
          entry.data = {
            ...f,
            hp: f.hp + healed,
            armor: Math.min(f.maxArmor, f.armor + HEALTH_PICKUP_ARMOR)
          }
          healthPickup = { ...healthPickup, available: false, respawnTicksLeft: HEALTH_PICKUP_RESPAWN_TICKS }
          nextEventSeq = pushEvent(feedItems, nextEventSeq, {
            kind: "pickup",
            shotEventId: 0,
            actorSlot: f.slotId,
            targetSlot: null,
            gunId: null,
            x: healthPickup.x,
            y: healthPickup.y + 1,
            z: healthPickup.z,
            damage: healed
          })
        }
      }
    }

    // Difficulty ramp: +1 level per DIFFICULTY_KILLS_PER_STEP kills made by the cobalt team (the player's side)
    let cobaltKills = 0
    for (const entry of fighterEntries) {
      if (entry.data.crew === 0) cobaltKills += entry.data.kills
    }
    const difficulty = clamp(
      matchPrev.baseDifficulty + Math.floor(cobaltKills / DIFFICULTY_KILLS_PER_STEP),
      DIFFICULTY_MIN,
      DIFFICULTY_MAX
    )

    // Commit all updated fighters back to Ritmo ECS
    for (const entry of fighterEntries) {
      queries.fighters.data.fighter.set(entry.entity, entry.data)
    }

    resources.match.set({
      ...matchPrev,
      healthPickup,
      difficulty,
      bossSlot,
      bossDefeated,
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
      nextGrenadeId,
      nextSatchelId,
      constructs,
      smokeClouds,
      grenades: nextGrenades,
      satchels: nextSatchels,
      props,
      cableCar,
      foreman,
      extraction,
      foundry
    })
    resources.feed.set({ items: feedItems })
  }
)
