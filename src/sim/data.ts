// ── Closed Sets & Shared Game Balance (Bell Yard · Hood Warfare 2) ───────

export const TICK_HZ = 60 as const
export const MATCH_DURATION_TICKS = 5 * 60 * TICK_HZ // 5 minutes
export const MURAL_ROTATE_TICKS = 45 * TICK_HZ // 45 seconds
export const SCORE_TO_WIN = 100
export const RESPAWN_TICKS = 4 * TICK_HZ // 4 seconds
export const POINTS_PER_SEC = 1
export const SLOTS_COUNT = 6 // Default 3v3

export const PLAYER_MAX_HP = 100
export const PLAYER_RADIUS = 0.42

// Hit zones, measured from the fighter's feet. Eye level (1.56) is inside the head band.
export type HitZone = "head" | "torso" | "limb"
export const HEAD_MIN_Y = 1.4 // at/above: head
export const LEG_MAX_Y = 0.8 // below: legs (limb)
export const ARM_LATERAL = 0.22 // torso hit this far off the body axis (silhouette edge): arm (limb)
export const HIT_ZONE_MULT: Record<HitZone, number> = { head: 2.5, torso: 1, limb: 0.6 }
export const HEAD_BYPASSES_ARMOR = true
export const PLAYER_HEIGHT = 1.78
export const PLAYER_EYE_HEIGHT = 1.56
export const PLAYER_BASE_SPEED = 7.4 // m/s
export const PLAYER_JUMP_SPEED = 6.9 // m/s
export const PLAYER_GRAVITY = 18.5 // m/s^2
export const PLAYER_STEP_HEIGHT = 0.48 // smooth stair climbing

// ── Milestone Mechanics Constants (Integer Ticks for Determinism) ────────

export const SKETCH_PLANK_LIFETIME_TICKS = 20 * TICK_HZ // 20s tunable playtest lifetime
export const SKETCH_BARRICADE_LIFETIME_TICKS = 18 * TICK_HZ
export const SKETCH_MAX_CHARGES = 1
export const SKETCH_ERASE_RANGE = 3.5
export const SKETCH_FREE_RANGE = 6.5

export const PARRY_WINDOW_TICKS = 18 // 0.30s timed melee ink parry
export const PARRY_COOLDOWN_TICKS = 90 // 1.5s cooldown

export const SMOKE_LIFETIME_TICKS = 12 * TICK_HZ // 12s cloud duration
export const SMOKE_CLEAR_TICKS = 3 * TICK_HZ // 3s carved sightline channel
export const SMOKE_COOLDOWN_TICKS = 14 * TICK_HZ
export const SMOKE_DENSITY_THRESHOLD = 0.45

export const GRAPPLE_RANGE = 22
export const GRAPPLE_MAX_TICKS = 48
export const GRAPPLE_COOLDOWN_TICKS = 120
export const GRAPPLE_PULL_SPEED = 18.0
export const BARREL_BLAST_RADIUS = 4.6
export const BARREL_BLAST_DAMAGE = 55

export const ANOMALY_CYCLE_TICKS = 24 * TICK_HZ
export const ANOMALY_DURATION_TICKS = 14 * TICK_HZ
export const ANOMALY_GRAVITY_SCALE = 0.42

export const FOUNDRY_TARGET_SCRAP = 10

export const GAME_MODES = ["mural", "eliteDuel", "extraction", "foundry"] as const
export type GameModeId = (typeof GAME_MODES)[number]

export const CREW_IDS = [0, 1] as const
export type CrewId = (typeof CREW_IDS)[number]

export interface CrewDef {
  readonly id: CrewId
  readonly name: string
  readonly shortName: string
  readonly colorHex: string
  readonly washHex: string
  readonly shoulderPattern: "chevron" | "diamond"
}

export const CREWS: Record<CrewId, CrewDef> = {
  0: {
    id: 0,
    name: "Cobalt Press",
    shortName: "COBALT",
    colorHex: "#2f5a9c",
    washHex: "#dbe6f7",
    shoulderPattern: "chevron"
  },
  1: {
    id: 1,
    name: "Vermilion Bind",
    shortName: "VERMILION",
    colorHex: "#b04a39",
    washHex: "#f7e1dc",
    shoulderPattern: "diamond"
  }
} satisfies Record<CrewId, CrewDef>

// ── Weapons ──────────────────────────────────────────────────────────────

export const GUN_IDS = [
  "proofPistol",
  "rollerSmg",
  "broadside",
  "linecaster",
  "cursedBlock"
] as const
export type GunId = (typeof GUN_IDS)[number]

export const PRIMARY_GUN_IDS = ["rollerSmg", "broadside", "linecaster", "cursedBlock"] as const
export type PrimaryGunId = (typeof PRIMARY_GUN_IDS)[number]

export interface GunDef {
  readonly id: GunId
  readonly name: string
  readonly slot: "sidearm" | "primary"
  readonly automatic: boolean
  readonly damage: number
  readonly pellets: number
  readonly magSize: number
  readonly fireCooldownTicks: number
  readonly reloadTicks: number
  readonly spreadRad: number
  readonly verticalSpreadRad: number
  readonly projectileSpeed: number // m/s
  readonly projectileLifeTicks: number
  readonly projectileRadius: number
  readonly scoreMultiplier: number
  readonly isCursed?: boolean
  readonly description: string
}

export const GUNS: Record<GunId, GunDef> = {
  proofPistol: {
    id: "proofPistol",
    name: "Proof Pistol",
    slot: "sidearm",
    automatic: false,
    damage: 20,
    pellets: 1,
    magSize: 12,
    fireCooldownTicks: 13, // crisp semi-auto ~4.6/sec
    reloadTicks: 66, // 1.1s
    spreadRad: 0.01,
    verticalSpreadRad: 0.008,
    projectileSpeed: 54,
    projectileLifeTicks: 84, // 1.4s
    projectileRadius: 0.08,
    scoreMultiplier: 1,
    description: "Crisp single ink bolt per click · 20 dmg · 12 mag"
  },
  rollerSmg: {
    id: "rollerSmg",
    name: "Roller SMG",
    slot: "primary",
    automatic: true,
    damage: 10,
    pellets: 1,
    magSize: 30,
    fireCooldownTicks: 7, // ~8.6-9 shots/sec
    reloadTicks: 87, // 1.45s
    spreadRad: 0.032,
    verticalSpreadRad: 0.024,
    projectileSpeed: 48,
    projectileLifeTicks: 66, // 1.1s
    projectileRadius: 0.07,
    scoreMultiplier: 1,
    description: "Continuous ink stream · 10 dmg · 9/s · 30 mag"
  },
  broadside: {
    id: "broadside",
    name: "Broadside",
    slot: "primary",
    automatic: false,
    damage: 8,
    pellets: 5,
    magSize: 5,
    fireCooldownTicks: 60, // 1 shot/sec
    reloadTicks: 111, // 1.85s
    spreadRad: 0.11,
    verticalSpreadRad: 0.032,
    projectileSpeed: 38,
    projectileLifeTicks: 22, // short-lived ~14m reach
    projectileRadius: 0.085,
    scoreMultiplier: 1,
    description: "Wide 5-pellet ink fan · 8×5 dmg · 1/s · 5 volleys"
  },
  linecaster: {
    id: "linecaster",
    name: "Linecaster",
    slot: "primary",
    automatic: false,
    damage: 48,
    pellets: 1,
    magSize: 6,
    fireCooldownTicks: 50, // 1.2 shots/sec
    reloadTicks: 120, // 2.0s
    spreadRad: 0.002,
    verticalSpreadRad: 0.002,
    projectileSpeed: 30, // slow, bright, straight bolt
    projectileLifeTicks: 132, // 2.2s
    projectileRadius: 0.13,
    scoreMultiplier: 1,
    description: "Slow bright precision bolt · 48 dmg · 1.2/s · 6 mag"
  },
  cursedBlock: {
    id: "cursedBlock",
    name: "Cursed Proof-Block",
    slot: "primary",
    automatic: false,
    damage: 88,
    pellets: 1,
    magSize: 1, // Voluntary single-shot cursed primary!
    fireCooldownTicks: 30,
    reloadTicks: 110, // 1.83s chamber reload
    spreadRad: 0.001,
    verticalSpreadRad: 0.001,
    projectileSpeed: 42,
    projectileLifeTicks: 120,
    projectileRadius: 0.14,
    scoreMultiplier: 1.5,
    isCursed: true,
    description: "CURSED · Single-shot breech · 88 dmg · 1.5× match score · unlocks Gilded swatch"
  }
} satisfies Record<GunId, GunDef>

// ── Armor ────────────────────────────────────────────────────────────────

export const ARMOR_IDS = ["light", "heavy"] as const
export type ArmorId = (typeof ARMOR_IDS)[number]

export interface ArmorDef {
  readonly id: ArmorId
  readonly name: string
  readonly maxArmor: number
  readonly speedMultiplier: number
  readonly description: string
}

export const ARMORS: Record<ArmorId, ArmorDef> = {
  light: {
    id: "light",
    name: "Light Vest",
    maxArmor: 25,
    speedMultiplier: 1.0,
    description: "+25 Armor · 100% Move Speed"
  },
  heavy: {
    id: "heavy",
    name: "Heavy Press Plate",
    maxArmor: 50,
    speedMultiplier: 0.9,
    description: "+50 Armor · 90% Move Speed · Thick Vest"
  }
} satisfies Record<ArmorId, ArmorDef>

// ── Cosmetics (validated on client & server) ─────────────────────────────

export const TOP_IDS = [
  "hoodie",
  "workJacket",
  "windbreaker",
  "apron",
  "vest",
  "trench",
  "tracksuit"
] as const
export type TopId = (typeof TOP_IDS)[number]

export const HAT_IDS = ["cap", "beanie", "bucket", "headband", "hardHat", "bareHead"] as const
export type HatId = (typeof HAT_IDS)[number]

export const SWATCH_IDS = [
  "ivory",
  "slate",
  "pine",
  "ochre",
  "denim",
  "charcoal",
  "gilded",
  "brick",
  "rust",
  "teal",
  "plum"
] as const
export type SwatchId = (typeof SWATCH_IDS)[number]

export const TOPS: Record<TopId, { readonly id: TopId; readonly name: string }> = {
  hoodie: { id: "hoodie", name: "Printworks Hoodie" },
  workJacket: { id: "workJacket", name: "Canvas Work Jacket" },
  windbreaker: { id: "windbreaker", name: "Courier Windbreaker" },
  apron: { id: "apron", name: "Press Apron" },
  vest: { id: "vest", name: "Courier Vest" },
  trench: { id: "trench", name: "Foreman Trench Coat" },
  tracksuit: { id: "tracksuit", name: "Runner Tracksuit" }
} satisfies Record<TopId, { readonly id: TopId; readonly name: string }>

export const HATS: Record<HatId, { readonly id: HatId; readonly name: string }> = {
  cap: { id: "cap", name: "Ink Cap" },
  beanie: { id: "beanie", name: "Knit Beanie" },
  bucket: { id: "bucket", name: "Bucket Hat" },
  headband: { id: "headband", name: "Pressman Headband" },
  hardHat: { id: "hardHat", name: "Plant Hard Hat" },
  bareHead: { id: "bareHead", name: "Bare Head" }
} satisfies Record<HatId, { readonly id: HatId; readonly name: string }>

export const SWATCHES: Record<
  SwatchId,
  { readonly id: SwatchId; readonly name: string; readonly hex: string; readonly trimHex: string }
> = {
  ivory: { id: "ivory", name: "Paper Ivory", hex: "#eceee6", trimHex: "#3d4943" },
  slate: { id: "slate", name: "Press Slate", hex: "#8e9a95", trimHex: "#2a332f" },
  pine: { id: "pine", name: "Ink Pine", hex: "#6b8574", trimHex: "#2b3a32" },
  ochre: { id: "ochre", name: "Ochre Proof", hex: "#c7a974", trimHex: "#473b29" },
  denim: { id: "denim", name: "Blueprint Denim", hex: "#6f86a3", trimHex: "#26374d" },
  charcoal: { id: "charcoal", name: "Charcoal Galley", hex: "#4a534f", trimHex: "#e6e9e1" },
  gilded: { id: "gilded", name: "Gilded Folio", hex: "#d6b35c", trimHex: "#2d2619" },
  brick: { id: "brick", name: "Kiln Brick", hex: "#9c5a4c", trimHex: "#2e1b17" },
  rust: { id: "rust", name: "Oxide Rust", hex: "#b55d36", trimHex: "#381a0e" },
  teal: { id: "teal", name: "Ink Teal", hex: "#3b7d82", trimHex: "#162e2f" },
  plum: { id: "plum", name: "Plum Proof", hex: "#73425f", trimHex: "#281522" }
} satisfies Record<
  SwatchId,
  { readonly id: SwatchId; readonly name: string; readonly hex: string; readonly trimHex: string }
>

export interface CosmeticLoadout {
  readonly top: TopId
  readonly hat: HatId
  readonly swatch: SwatchId
}

export interface CombatLoadout {
  readonly primary: PrimaryGunId
  readonly armor: ArmorId
}

export const DEFAULT_COSMETICS: CosmeticLoadout = {
  top: "hoodie",
  hat: "cap",
  swatch: "ivory"
}

export const DEFAULT_LOADOUT: CombatLoadout = {
  primary: "rollerSmg",
  armor: "light"
}

export function sanitizeCosmetics(raw: unknown): CosmeticLoadout {
  if (typeof raw !== "object" || raw === null) return DEFAULT_COSMETICS
  const r = raw as Record<string, unknown>
  const top = TOP_IDS.includes(r["top"] as TopId) ? (r["top"] as TopId) : DEFAULT_COSMETICS.top
  const hat = HAT_IDS.includes(r["hat"] as HatId) ? (r["hat"] as HatId) : DEFAULT_COSMETICS.hat
  const swatch = SWATCH_IDS.includes(r["swatch"] as SwatchId)
    ? (r["swatch"] as SwatchId)
    : DEFAULT_COSMETICS.swatch
  return { top, hat, swatch }
}

export function sanitizeLoadout(raw: unknown): CombatLoadout {
  if (typeof raw !== "object" || raw === null) return DEFAULT_LOADOUT
  const r = raw as Record<string, unknown>
  const primary = PRIMARY_GUN_IDS.includes(r["primary"] as PrimaryGunId)
    ? (r["primary"] as PrimaryGunId)
    : DEFAULT_LOADOUT.primary
  const armor = ARMOR_IDS.includes(r["armor"] as ArmorId)
    ? (r["armor"] as ArmorId)
    : DEFAULT_LOADOUT.armor
  return { primary, armor }
}

export const COOL_BOT_SWATCHES = ["denim", "slate", "pine", "teal", "ivory"] as const
export const WARM_BOT_SWATCHES = ["brick", "rust", "ochre", "charcoal", "plum"] as const

/** Cosmetics for a bot. Deterministic pure function of (slotId, crew) with decorrelated picks and crew palettes. */
export function botCosmetics(slotId: number, crew: CrewId): CosmeticLoadout {
  const s = (slotId < 0 ? -slotId : slotId) | 0
  const c = crew === 1 ? 1 : 0
  const top = TOP_IDS[(s * 3 + c) % TOP_IDS.length]!
  const hat = HAT_IDS[(s * 5 + c * 2 + 1) % HAT_IDS.length]!
  const palette = c === 0 ? COOL_BOT_SWATCHES : WARM_BOT_SWATCHES
  const swatch = palette[(s * 2 + c) % palette.length]!
  return { top, hat, swatch }
}

export const BOT_NAMES: ReadonlyArray<string> = [
  "Milo Press",
  "Sora Ink",
  "Bram Type",
  "Tessa Quoin",
  "Niko Folio",
  "Kira Galley",
  "Orin Lead",
  "Veda Proof",
  "Dax Roller",
  "Juno Serif",
  "Cale Bind",
  "Pia Ream",
  "Rafe Plate",
  "Wren Margin",
  "Lark Chase",
  "Sable Platen",
  "Otis Kerning",
  "Nora Block",
  "Toby Galley",
  "Faye Etch"
]

// ── Health booster, difficulty ramp and boss tunables ────────────────────
// One booster in the middle of the Courtyard (the contested mural point): you have to fight for it.
export const HEALTH_PICKUP_POS = { x: 0, y: 0, z: 0 } as const
export const HEALTH_PICKUP_RADIUS = 1.1
export const HEALTH_PICKUP_HEAL = 60
export const HEALTH_PICKUP_ARMOR = 25
export const HEALTH_PICKUP_FIRST_SPAWN_TICKS = 8 * TICK_HZ
export const HEALTH_PICKUP_RESPAWN_TICKS = 25 * TICK_HZ

// Difficulty level 0..10 drives the vermilion (red) bots. Starts from the player's campaign level and rises
// during a match by one step per DIFFICULTY_KILLS_PER_STEP cobalt kills.
export const DIFFICULTY_MIN = 0
export const DIFFICULTY_MAX = 10
export const DIFFICULTY_DEFAULT = 2
export const DIFFICULTY_KILLS_PER_STEP = 4

// The boss: one tougher red bot that enters mid-match.
export const BOSS_SPAWN_TICK = 75 * TICK_HZ
export const BOSS_HP = 350
export const BOSS_ARMOR: ArmorId = "heavy"
export const BOSS_GUN: PrimaryGunId = "broadside"
export const BOSS_SCALE = 1.35
export const BOSS_NAME = "Chief Compositor"
export const BOSS_KILL_SCORE = 10

export const HEALTH_PICKUP_MODES: ReadonlyArray<GameModeId> = ["mural", "foundry"]
export const BOSS_MODES: ReadonlyArray<GameModeId> = ["mural", "foundry"]
/** Cobalt bots (the player's allies) always play at this fixed level; the red team follows the match difficulty. */
export const ALLY_BOT_LEVEL = 6
/** A bot with hp below this walks to the health booster when it is available. */
export const BOT_SEEK_HEALTH_HP = 45
/** The boss plays this many levels above the current difficulty. */
export const BOSS_SKILL_BONUS = 3

export interface BotSkill {
  readonly jitterYaw: number // total width of the aim error band (radians)
  readonly jitterPitch: number
  readonly fireChance: number // chance per tick to pull the trigger while a target is in range
  readonly rangeScale: number // multiplier on the gun's engagement range
}

/** Difficulty level 0..10 -> aim error, trigger discipline and engagement range. Plain +,-,* only (deterministic). */
export function sanitizeDifficulty(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN
  if (!Number.isFinite(n)) return DIFFICULTY_DEFAULT
  return Math.min(DIFFICULTY_MAX, Math.max(DIFFICULTY_MIN, Math.round(n)))
}

export function botSkill(level: number): BotSkill {
  const t = Math.min(DIFFICULTY_MAX, Math.max(DIFFICULTY_MIN, Number.isFinite(level) ? level : DIFFICULTY_DEFAULT)) / DIFFICULTY_MAX
  return {
    jitterYaw: 0.32 - 0.285 * t, // level 0: 0.32 rad, 10: 0.035 (the old fixed value was 0.085)
    jitterPitch: 0.22 - 0.195 * t,
    fireChance: 0.45 + 0.55 * t,
    rangeScale: 0.6 + 0.4 * t
  }
}
