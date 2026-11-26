import type { MapId } from "./maps.ts"
import { Clock, Descriptor, Random, Schema } from "@typeonce/ritmo"
import type { BotBrainState } from "./botAi.ts"
import type { BloomState, RecoilState } from "./gunplay.ts"
import {
  TICK_HZ,
  type ArmorId,
  type CombatLoadout,
  type CosmeticLoadout,
  type CrewId,
  type GameModeId,
  type GunId,
  type PrimaryGunId
} from "./data.ts"

export const STEP = Clock.hz(TICK_HZ)
export type StepHz = typeof TICK_HZ

// ── Sequenced Input Command (Identical for Humans & Bots!) ───────────────

export interface SketchActionInput {
  readonly kind: "placeAnchor" | "placeFree" | "placeBarricade"
  readonly anchorId?: string
  readonly actionId: number
}

export interface PlayerInput {
  readonly seq: number
  readonly moveForward: number // -1..1
  readonly moveRight: number // -1..1
  readonly yaw: number
  readonly pitch: number
  readonly crouch?: boolean
  readonly ads?: boolean
  readonly jump: boolean
  readonly fire: boolean
  readonly reload: boolean
  readonly switchSlot: 0 | 1 | 2 | 3 // 0 = no change, 1 = primary, 2 = sidearm, 3 = commando knife
  // Discrete milestone action edges (deduplicated via actionId!)
  readonly sketchAction?: SketchActionInput | null
  readonly eraseActionId?: number
  readonly parryActionId?: number
  readonly smokeActionId?: number
  readonly grenadeActionId?: number
  readonly satchelActionId?: number
  readonly meleeActionId?: number
  readonly grappleActionId?: number
  readonly grappleReleaseId?: number
}

export const EMPTY_INPUT: PlayerInput = {
  seq: 0,
  moveForward: 0,
  moveRight: 0,
  yaw: 0,
  pitch: 0,
  crouch: false,
  ads: false,
  jump: false,
  fire: false,
  reload: false,
  switchSlot: 0,
  sketchAction: null,
  eraseActionId: 0,
  parryActionId: 0,
  smokeActionId: 0,
  grenadeActionId: 0,
  satchelActionId: 0,
  meleeActionId: 0,
  grappleActionId: 0,
  grappleReleaseId: 0
}

export interface GrenadeData {
  readonly id: number
  readonly ownerSlot: number
  readonly crew: CrewId
  readonly x: number
  readonly y: number
  readonly z: number
  readonly vx: number
  readonly vy: number
  readonly vz: number
  readonly fuseTicksLeft: number
}

export interface SatchelData {
  readonly id: number
  readonly ownerSlot: number
  readonly crew: CrewId
  readonly x: number
  readonly y: number
  readonly z: number
  readonly nx: number
  readonly ny: number
  readonly nz: number
  readonly armedTicks: number
}

// ── Dynamic World Constructs & Milestone Entities ────────────────────────

export interface ConstructData {
  readonly id: number
  readonly kind: "plank" | "barricade"
  readonly ownerSlot: number
  readonly crew: CrewId
  readonly anchorId: string | null
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
  readonly minZ: number
  readonly maxZ: number
  readonly createdTick: number
  readonly expiresTick: number
}

export interface SmokeCloudData {
  readonly id: number
  readonly ownerSlot: number
  readonly cx: number
  readonly cy: number
  readonly cz: number
  readonly cellSize: number
  readonly nx: number
  readonly ny: number
  readonly nz: number
  /** Per-cell clearedTicksLeft: 0 = dense smoke, >0 = cleared sight channel */
  readonly clearedTicks: ReadonlyArray<number>
  readonly createdTick: number
  readonly expiresTick: number
}

export interface MovablePropData {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly z: number
  readonly vx: number
  readonly vy: number
  readonly vz: number
  readonly hp: number
  readonly exploded: boolean
  readonly respawnTicksLeft: number
}

export interface CableCarData {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly vx: number
  readonly vy: number
  readonly vz: number
  readonly t: number
  readonly dir: 1 | -1
}

export type ForemanState = "patrol" | "windup" | "slam" | "recover" | "staggered" | "defeated"

export interface ForemanData {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly yaw: number
  readonly hp: number
  readonly maxHp: number
  readonly posture: number
  readonly maxPosture: number
  readonly state: ForemanState
  readonly stateTicksLeft: number
  readonly attackTargetSlot: number | null
}

export interface ExtractionData {
  readonly vaultProgressTicks: number
  readonly vaultTargetTicks: number
  readonly vaultUnlocked: boolean
  readonly parcelCarriedBySlot: number | null
  readonly extracted: boolean
  readonly failed: boolean
  readonly carriedScrap: number
  readonly equipmentStaked: boolean
}

export interface FoundryScrapPile {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly z: number
  readonly available: boolean
  readonly respawnTicksLeft: number
}

export interface FoundryData {
  readonly piles: ReadonlyArray<FoundryScrapPile>
  readonly deposited: readonly [number, number]
  readonly targetScrap: number
  readonly contestedDeposit: boolean
  readonly siegeCompletedBy: CrewId | null
}

export interface GrappleActiveState {
  readonly kind: "ledge" | "prop" | "bot"
  readonly targetId: string | number
  readonly tx: number
  readonly ty: number
  readonly tz: number
  readonly ticksLeft: number
}

// ── Components ───────────────────────────────────────────────────────────

export interface FighterData {
  readonly slotId: number
  readonly crew: CrewId
  readonly name: string
  readonly isBot: boolean
  readonly humanId: string | null
  readonly pendingHumanId: string | null
  readonly pendingHumanName: string | null
  readonly pendingLoadout: CombatLoadout | null
  readonly pendingCosmetics: CosmeticLoadout | null

  // Transform & Kinematics
  readonly x: number
  readonly y: number
  readonly z: number
  readonly vx: number
  readonly vy: number
  readonly vz: number
  readonly yaw: number
  readonly pitch: number
  readonly grounded: boolean
  readonly crouching: boolean
  readonly ads: boolean

  // Combat vitals & state
  readonly alive: boolean
  readonly hp: number
  readonly maxHp: number
  readonly isBoss: boolean
  readonly armor: number
  readonly maxArmor: number
  readonly respawnTicksLeft: number
  readonly kills: number
  readonly deaths: number

  // Active & next-spawn loadout + cosmetics
  readonly activeSlot: 1 | 2 | 3
  readonly primaryGun: PrimaryGunId
  readonly armorType: ArmorId
  readonly nextPrimaryGun: PrimaryGunId
  readonly nextArmorType: ArmorId
  readonly cosmetics: CosmeticLoadout
  readonly nextCosmetics: CosmeticLoadout

  // Ammo, recoil, bloom & weapon timers (integer ticks)
  readonly primaryAmmo: number
  readonly sidearmAmmo: number
  readonly fireCooldownTicks: number
  readonly reloadTicksLeft: number
  readonly wasFireHeld: boolean
  readonly recoil: RecoilState
  readonly bloom: BloomState
  readonly flinchTicksLeft: number

  // Milestone 1-9 + Tactical Combat abilities & deduplication
  readonly sketchCharges: number
  readonly parryTicksLeft: number
  readonly parryCooldownTicks: number
  readonly smokeCooldownTicks: number
  readonly grenadeCooldownTicks: number
  readonly satchelCooldownTicks: number
  readonly meleeTicksLeft: number
  readonly meleeCooldownTicks: number
  readonly grappleCooldownTicks: number
  readonly grapple: GrappleActiveState | null
  readonly carryingScrap: number
  readonly cursedRunBonusApplied: boolean
  readonly lastHandledSketchId: number
  readonly lastHandledEraseId: number
  readonly lastHandledParryId: number
  readonly lastHandledSmokeId: number
  readonly lastHandledGrenadeId: number
  readonly lastHandledSatchelId: number
  readonly lastHandledMeleeId: number
  readonly lastHandledGrappleId: number
  readonly lastHandledGrappleReleaseId: number

  // Sequenced client input reconciliation & tactical Bot AI brain
  readonly lastInputSeq: number
  readonly botStrafeDir: number
  readonly botStrafeTicks: number
  readonly botWp: number
  readonly botWpTicks: number
  readonly brain: BotBrainState
}

export interface ProjectileData {
  readonly projectileId: number
  readonly shotEventId: number
  readonly ownerSlot: number
  readonly crew: CrewId
  readonly gunId: GunId
  readonly x: number
  readonly y: number
  readonly z: number
  readonly vx: number
  readonly vy: number
  readonly vz: number
  readonly damage: number
  readonly radius: number
  readonly lifeTicksLeft: number
  readonly parried?: boolean
}

// ── Resources ────────────────────────────────────────────────────────────

export type MatchWinner = CrewId | "draw" | null

export interface InitialHumanSpec {
  readonly slotId: number
  readonly humanId: string
  readonly name: string
  readonly loadout: CombatLoadout
  readonly cosmetics: CosmeticLoadout
}

export interface HealthPickupData {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly available: boolean
  readonly respawnTicksLeft: number
}

export interface MatchStateData {
  readonly mapId: MapId
  readonly pendingMapId: MapId | null
  readonly mode: GameModeId
  readonly totalSlots: number
  readonly anomalyEnabled: boolean
  readonly anomalyActive: boolean
  readonly anomalyTicksLeft: number
  readonly paused: boolean
  readonly tickCount: number
  readonly remainingTicks: number
  readonly activeMuralId: 0 | 1 | 2
  readonly muralRotateTicksLeft: number
  readonly scores: readonly [number, number]
  readonly scoreAccum: readonly [number, number]
  readonly zoneStatus: "idle" | "cobalt" | "vermilion" | "contested"
  readonly winner: MatchWinner
  readonly nextProjectileId: number
  readonly nextShotEventId: number
  readonly nextEventSeq: number
  readonly nextConstructId: number
  readonly nextSmokeId: number
  readonly nextGrenadeId: number
  readonly nextSatchelId: number
  readonly constructs: ReadonlyArray<ConstructData>
  readonly smokeClouds: ReadonlyArray<SmokeCloudData>
  readonly grenades: ReadonlyArray<GrenadeData>
  readonly satchels: ReadonlyArray<SatchelData>
  readonly props: ReadonlyArray<MovablePropData>
  readonly cableCar: CableCarData
  readonly foreman: ForemanData | null
  readonly extraction: ExtractionData | null
  readonly foundry: FoundryData | null
  readonly healthPickup: HealthPickupData
  readonly difficulty: number
  readonly baseDifficulty: number // starting level; difficulty = base + 1 per DIFFICULTY_KILLS_PER_STEP cobalt kills
  readonly bossSlot: number // -1 = no boss has entered yet
  readonly bossDefeated: boolean
  readonly pendingDifficulty: number | null
  readonly pendingBootSeed: number | null
  readonly pendingInitialHumans: ReadonlyArray<InitialHumanSpec> | null
  readonly pendingMode: GameModeId | null
  readonly pendingAnomalyEnabled: boolean | null
  readonly pendingTotalSlots: number | null
  readonly pendingEquipmentStake: boolean
}

export type MatchEventKind =
  | "shot"
  | "hit"
  | "armorBreak"
  | "elim"
  | "reload"
  | "muralRotate"
  | "spawn"
  | "sketchPlace"
  | "sketchErase"
  | "sketchExpire"
  | "parry"
  | "smokeDeploy"
  | "grenadeThrow"
  | "grenadeBounce"
  | "grenadeBlast"
  | "satchelPlant"
  | "satchelBlast"
  | "barrelHit"
  | "barrelBlast"
  | "knifeSlash"
  | "grapple"
  | "foremanWindup"
  | "foremanStagger"
  | "anomalyShift"
  | "foundryDeposit"
  | "extractComplete"
  | "pickup"
  | "bossSpawn"
  | "bossDown"

export interface MatchEventItem {
  readonly seq: number
  readonly kind: MatchEventKind
  readonly shotEventId: number
  readonly actorSlot: number
  readonly targetSlot: number | null
  readonly gunId: GunId | null
  readonly x: number
  readonly y: number
  readonly z: number
  readonly damage: number
  readonly zone?: "head" | "torso" | "limb"
}

export interface EventFeedData {
  readonly items: ReadonlyArray<MatchEventItem>
}

export interface InputQueueData {
  readonly bySlot: Readonly<Record<number, PlayerInput>>
}

// ── Intents ──────────────────────────────────────────────────────────────

export type MatchIntent =
  | { readonly _tag: "SubmitInput"; readonly slotId: number; readonly input: PlayerInput }
  | { readonly _tag: "SetPaused"; readonly paused: boolean }
  | {
      readonly _tag: "SetLoadout"
      readonly slotId: number
      readonly primary: PrimaryGunId
      readonly armor: ArmorId
      readonly cosmetics: CosmeticLoadout
      readonly immediate?: boolean
    }
  | {
      readonly _tag: "AssignHuman"
      readonly slotId: number
      readonly humanId: string
      readonly name: string
      readonly loadout: CombatLoadout
      readonly cosmetics: CosmeticLoadout
      readonly immediate: boolean
    }
  | { readonly _tag: "ReleaseHuman"; readonly humanId: string }
  | {
      readonly _tag: "StartMatch"
      readonly seed: number
      readonly mode?: GameModeId
      readonly anomalyEnabled?: boolean
      readonly totalSlots?: number
      readonly equipmentStaked?: boolean
      readonly mapId?: MapId
      readonly difficulty?: number
      readonly initialHumans?: ReadonlyArray<InitialHumanSpec>
    }

// ── Descriptors & Schema ─────────────────────────────────────────────────

export const Time = Clock.resource("Hw2/Time", STEP)
export const Rng = Descriptor.ConstructedResource(Random.codec)("Hw2/Rng")

export const Fighter = Descriptor.Component<FighterData>()("Hw2/Fighter")
export const Projectile = Descriptor.Component<ProjectileData>()("Hw2/Projectile")

export const MatchState = Descriptor.Resource<MatchStateData>()("Hw2/MatchState")
export const EventFeed = Descriptor.Resource<EventFeedData>()("Hw2/EventFeed")
export const InputQueue = Descriptor.Resource<InputQueueData>()("Hw2/InputQueue")

export const Intent = Descriptor.Event<MatchIntent>()("Hw2/Intent")

const Hw2Fragment = Schema.fragment({
  components: { Fighter, Projectile },
  resources: { Time, Rng, MatchState, EventFeed, InputQueue },
  events: { Intent }
})

type Hw2SchemaOf = typeof Hw2Fragment
export interface Hw2Schema extends Hw2SchemaOf {}

const namedSchema: Hw2Schema = Hw2Fragment
const Root = Schema.defineRoot("Hw2")
export const Game = Schema.bind(namedSchema, Root)

export const MatchPhase = Game.StateMachine(
  "Hw2/MatchPhase",
  {
    Boot: {},
    Playing: {},
    Finished: {}
  },
  {
    transitions: {
      Boot: ["Playing"],
      Playing: ["Finished", "Boot"],
      Finished: ["Boot"]
    }
  }
)
