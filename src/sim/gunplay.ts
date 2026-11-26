import { HIT_ZONE_MULT, PLAYER_BASE_SPEED, type GunDef, type GunId, type HitZone } from "./data.ts"

// ── 2026 Gunplay Feel Module: Learnable Recoil, Spread Bloom & Range Falloff ─
// Pure deterministic integer-tick functions (shared by offline & authoritative server).

export interface RecoilState {
  readonly shotIndex: number
  readonly lastShotTick: number
  readonly yaw: number // radians added to shot & camera
  readonly pitch: number
}

export const NO_RECOIL: RecoilState = {
  shotIndex: 0,
  lastShotTick: -999,
  yaw: 0,
  pitch: 0
}

export interface BloomState {
  readonly bloom: number // 0..1
  readonly lastShotTick: number
}

export const NO_BLOOM: BloomState = {
  bloom: 0,
  lastShotTick: -999
}

interface RecoilDef {
  /** Deterministic [yaw, pitch] kick per shot in burst */
  readonly pattern: ReadonlyArray<readonly [number, number]>
  readonly recoverTicks: number
}

export const RECOIL_DEFS: Record<GunId, RecoilDef> = {
  proofPistol: { pattern: [[0, 0.014]], recoverTicks: 14 },
  rollerSmg: {
    pattern: [
      [0.0015, 0.009],
      [0.003, 0.010],
      [-0.0025, 0.011],
      [-0.005, 0.012],
      [0.002, 0.012],
      [0.006, 0.013],
      [-0.003, 0.013],
      [-0.0065, 0.014],
      [0.0025, 0.014],
      [0.007, 0.015]
    ],
    recoverTicks: 20
  },
  broadside: { pattern: [[0, 0.048]], recoverTicks: 28 },
  linecaster: { pattern: [[0, 0.032]], recoverTicks: 34 },
  pressSniper: { pattern: [[0, 0.068]], recoverTicks: 48 },
  cursedBlock: { pattern: [[0, 0.058]], recoverTicks: 40 }
}

export function recoilOnShot(
  s: RecoilState,
  gunId: GunId,
  tick: number,
  ads: boolean
): RecoilState {
  const def = RECOIL_DEFS[gunId]
  const [dy, dp] = def.pattern[s.shotIndex % def.pattern.length]!
  const scale = ads ? 0.78 : 1.0
  return {
    shotIndex: s.shotIndex + 1,
    lastShotTick: tick,
    yaw: Math.max(-0.18, Math.min(0.18, s.yaw + dy * scale)),
    pitch: Math.max(-0.25, Math.min(0.28, s.pitch + dp * scale))
  }
}

export function recoilStep(s: RecoilState, gunId: GunId, tick: number): RecoilState {
  if (s.shotIndex === 0 && s.yaw === 0 && s.pitch === 0) return NO_RECOIL
  const def = RECOIL_DEFS[gunId]
  if (tick - s.lastShotTick >= def.recoverTicks) return NO_RECOIL
  const k = 1 - 1 / def.recoverTicks
  return {
    shotIndex: s.shotIndex,
    lastShotTick: s.lastShotTick,
    yaw: s.yaw * k,
    pitch: s.pitch * k
  }
}

export function bloomOnShot(s: BloomState, gun: GunDef, tick: number): BloomState {
  return {
    bloom: Math.min(1, s.bloom + gun.bloomPerShot),
    lastShotTick: tick
  }
}

export function bloomStep(s: BloomState, gun: GunDef, tick: number): BloomState {
  if (s.bloom <= 0) return NO_BLOOM
  const since = tick - s.lastShotTick
  if (since <= gun.bloomHoldTicks) return s
  const decayed = s.bloom - gun.bloomDecayPerTick * (since - gun.bloomHoldTicks)
  return decayed <= 0 ? NO_BLOOM : { bloom: decayed, lastShotTick: s.lastShotTick }
}

export function currentSpreadRad(
  gun: GunDef,
  bloom: BloomState,
  horizSpeed: number,
  airborne: boolean,
  crouching: boolean,
  ads: boolean
): number {
  const move = Math.min(1, horizSpeed / PLAYER_BASE_SPEED)
  const base = gun.spreadRad * (1 + bloom.bloom * gun.bloomSpreadMult)
  const moveMult = 1 + move * (ads ? 0.45 : 0.85)
  const airMult = airborne ? 2.0 : 1.0
  const crouchMult = crouching ? 0.78 : 1.0
  const adsMult = ads ? gun.adsSpreadMult : 1.0
  return base * moveMult * airMult * crouchMult * adsMult
}

export function damageAtRange(gun: GunDef, distance: number): number {
  if (distance <= gun.falloffStart) return 1.0
  if (distance >= gun.falloffEnd) return gun.falloffMin
  const t = (distance - gun.falloffStart) / Math.max(0.01, gun.falloffEnd - gun.falloffStart)
  return 1 + (gun.falloffMin - 1) * t
}

export function resolveWeaponHitDamage(
  gun: GunDef,
  zone: HitZone,
  distance: number
): number {
  const zoneMult =
    zone === "head" ? gun.headMult : zone === "limb" ? HIT_ZONE_MULT.limb : 1.0
  const rangeMult = damageAtRange(gun, distance)
  return Math.max(1, Math.round(gun.damage * zoneMult * rangeMult))
}
