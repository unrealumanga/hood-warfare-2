import { Ops } from "@typeonce/ritmo"
import {
  PLAYER_BASE_SPEED,
  PLAYER_GRAVITY,
  PLAYER_HEIGHT,
  PLAYER_JUMP_SPEED,
  PLAYER_RADIUS,
  PLAYER_STEP_HEIGHT,
  SMOKE_DENSITY_THRESHOLD
} from "./data.ts"
import { ANOMALY_COURTYARD, MAP_SOLIDS, type MapBox } from "./map.ts"

export interface KinematicState {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly vx: number
  readonly vy: number
  readonly vz: number
  readonly grounded: boolean
}

export interface MoveInput {
  readonly moveForward: number // -1..1
  readonly moveRight: number // -1..1
  readonly yaw: number
  readonly jump: boolean
}

export interface SmokeGridLike {
  readonly cx: number
  readonly cy: number
  readonly cz: number
  readonly cellSize: number
  readonly nx: number
  readonly ny: number
  readonly nz: number
  /** Per-cell clearedTicksLeft: 0 = dense smoke (1.0), >0 = cleared channel (0.0) */
  readonly clearedTicks: ReadonlyArray<number>
}

export interface MovementOptions {
  readonly extraSolids?: ReadonlyArray<MapBox>
  readonly gravityScale?: number
  readonly anomalyActive?: boolean
}

function overlapsCylinderXZ(x: number, z: number, r: number, box: MapBox): boolean {
  return x + r > box.minX && x - r < box.maxX && z + r > box.minZ && z - r < box.maxZ
}

function overlapsVertical(y: number, h: number, box: MapBox): boolean {
  return y + h > box.minY + 0.001 && y < box.maxY - 0.001
}

function isAreaFree(
  x: number,
  y: number,
  z: number,
  r: number,
  h: number,
  extraSolids: ReadonlyArray<MapBox>
): boolean {
  for (const box of MAP_SOLIDS) {
    if (overlapsCylinderXZ(x, z, r, box) && overlapsVertical(y, h, box)) {
      return false
    }
  }
  for (const box of extraSolids) {
    if (overlapsCylinderXZ(x, z, r, box) && overlapsVertical(y, h, box)) {
      return false
    }
  }
  return true
}

export function isPointInAnomalyCourtyard(x: number, y: number, z: number): boolean {
  return (
    x >= ANOMALY_COURTYARD.minX &&
    x <= ANOMALY_COURTYARD.maxX &&
    y >= ANOMALY_COURTYARD.minY &&
    y <= ANOMALY_COURTYARD.maxY &&
    z >= ANOMALY_COURTYARD.minZ &&
    z <= ANOMALY_COURTYARD.maxZ
  )
}

/**
 * Pure deterministic 3D FPS movement with wall sliding, jump, gravity, stair auto step-up,
 * dynamic Sketch Planks / Barricades / Cable Car deck, and Low-Gravity Courtyard Anomaly!
 */
export function stepPlayerMovement(
  prev: KinematicState,
  input: MoveInput,
  speedMult: number,
  dt: number,
  opts: MovementOptions = {}
): KinematicState {
  const extraSolids = opts.extraSolids ?? []
  const fwd = Math.max(-1, Math.min(1, input.moveForward))
  const right = Math.max(-1, Math.min(1, input.moveRight))
  const mag = Ops.hypot(fwd, right)
  const nf = mag > 1 ? fwd / mag : fwd
  const nr = mag > 1 ? right / mag : right

  const sinY = Ops.sin(input.yaw)
  const cosY = Ops.cos(input.yaw)
  const dirX = -sinY * nf + cosY * nr
  const dirZ = -cosY * nf - sinY * nr

  const speed = PLAYER_BASE_SPEED * speedMult
  const vx = dirX * speed
  const vz = dirZ * speed

  let vy = prev.vy
  if (prev.grounded && input.jump) {
    vy = PLAYER_JUMP_SPEED
  }
  const inAnomaly = opts.anomalyActive === true && isPointInAnomalyCourtyard(prev.x, prev.y, prev.z)
  const gravScale = opts.gravityScale ?? (inAnomaly ? 0.42 : 1.0)
  vy -= PLAYER_GRAVITY * gravScale * dt

  let x = prev.x
  let y = prev.y
  let z = prev.z

  // 1. Horizontal move X with stair auto step-up
  const tryX = x + vx * dt
  if (isAreaFree(tryX, y, z, PLAYER_RADIUS, PLAYER_HEIGHT, extraSolids)) {
    x = tryX
  } else {
    let stepped = false
    for (let stepY = 0.16; stepY <= PLAYER_STEP_HEIGHT + 0.01; stepY += 0.16) {
      if (isAreaFree(tryX, y + stepY, z, PLAYER_RADIUS, PLAYER_HEIGHT, extraSolids)) {
        x = tryX
        y += stepY
        stepped = true
        break
      }
    }
    if (!stepped) {
      for (const list of [MAP_SOLIDS, extraSolids] as const) {
        for (const box of list) {
          if (overlapsCylinderXZ(tryX, z, PLAYER_RADIUS, box) && overlapsVertical(y, PLAYER_HEIGHT, box)) {
            if (vx > 0) x = Math.min(x, box.minX - PLAYER_RADIUS - 0.001)
            else if (vx < 0) x = Math.max(x, box.maxX + PLAYER_RADIUS + 0.001)
          }
        }
      }
    }
  }

  // 2. Horizontal move Z with stair auto step-up
  const tryZ = z + vz * dt
  if (isAreaFree(x, y, tryZ, PLAYER_RADIUS, PLAYER_HEIGHT, extraSolids)) {
    z = tryZ
  } else {
    let stepped = false
    for (let stepY = 0.16; stepY <= PLAYER_STEP_HEIGHT + 0.01; stepY += 0.16) {
      if (isAreaFree(x, y + stepY, tryZ, PLAYER_RADIUS, PLAYER_HEIGHT, extraSolids)) {
        z = tryZ
        y += stepY
        stepped = true
        break
      }
    }
    if (!stepped) {
      for (const list of [MAP_SOLIDS, extraSolids] as const) {
        for (const box of list) {
          if (overlapsCylinderXZ(x, tryZ, PLAYER_RADIUS, box) && overlapsVertical(y, PLAYER_HEIGHT, box)) {
            if (vz > 0) z = Math.min(z, box.minZ - PLAYER_RADIUS - 0.001)
            else if (vz < 0) z = Math.max(z, box.maxZ + PLAYER_RADIUS + 0.001)
          }
        }
      }
    }
  }

  // 3. Vertical move & ground snapping (checks permanent geometry + active planks/barricades/cable car!)
  let grounded = false
  const nextY = y + vy * dt
  if (vy <= 0) {
    let bestFloor = -1000
    for (const list of [MAP_SOLIDS, extraSolids] as const) {
      for (const box of list) {
        if (!overlapsCylinderXZ(x, z, PLAYER_RADIUS, box)) continue
        if (box.maxY <= y + 0.12 && box.maxY >= nextY - 0.06) {
          if (box.maxY > bestFloor) bestFloor = box.maxY
        }
      }
    }
    if (bestFloor > -999) {
      y = bestFloor
      vy = 0
      grounded = true
    } else {
      y = nextY
    }
  } else {
    let hitCeiling = 1000
    for (const list of [MAP_SOLIDS, extraSolids] as const) {
      for (const box of list) {
        if (!overlapsCylinderXZ(x, z, PLAYER_RADIUS, box)) continue
        if (box.minY >= y + PLAYER_HEIGHT - 0.08 && box.minY <= nextY + PLAYER_HEIGHT) {
          if (box.minY < hitCeiling) hitCeiling = box.minY
        }
      }
    }
    if (hitCeiling < 999) {
      y = hitCeiling - PLAYER_HEIGHT - 0.002
      vy = 0
    } else {
      y = nextY
    }
  }

  x = Math.max(-27.0, Math.min(27.0, x))
  z = Math.max(-17.0, Math.min(20.5, z))
  if (y < 0) {
    y = 0
    vy = 0
    grounded = true
  }

  return { x, y, z, vx, vy, vz, grounded }
}

// ── Swept Segment Collision (Slab Ray-AABB + Ray-Capsule + Ink Smoke Grid) ─

export function sweepSegmentVsBoxes(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  boxes: ReadonlyArray<MapBox>,
  inflate = 0
): { readonly t: number; readonly nx: number; readonly ny: number; readonly nz: number } | null {
  const dx = bx - ax
  const dy = by - ay
  const dz = bz - az

  let bestT = 2
  let bestNx = 0
  let bestNy = 1
  let bestNz = 0

  for (const box of boxes) {
    const minX = box.minX - inflate
    const maxX = box.maxX + inflate
    const minY = box.minY - inflate
    const maxY = box.maxY + inflate
    const minZ = box.minZ - inflate
    const maxZ = box.maxZ + inflate

    let tmin = 0
    let tmax = 1
    let hitAxis = -1
    let hitSign = 1

    if (Math.abs(dx) < 1e-8) {
      if (ax < minX || ax > maxX) continue
    } else {
      const inv = 1 / dx
      let t1 = (minX - ax) * inv
      let t2 = (maxX - ax) * inv
      let sign = -1
      if (t1 > t2) {
        const tmp = t1
        t1 = t2
        t2 = tmp
        sign = 1
      }
      if (t1 > tmin) {
        tmin = t1
        hitAxis = 0
        hitSign = sign
      }
      tmax = Math.min(tmax, t2)
      if (tmin > tmax) continue
    }

    if (Math.abs(dy) < 1e-8) {
      if (ay < minY || ay > maxY) continue
    } else {
      const inv = 1 / dy
      let t1 = (minY - ay) * inv
      let t2 = (maxY - ay) * inv
      let sign = -1
      if (t1 > t2) {
        const tmp = t1
        t1 = t2
        t2 = tmp
        sign = 1
      }
      if (t1 > tmin) {
        tmin = t1
        hitAxis = 1
        hitSign = sign
      }
      tmax = Math.min(tmax, t2)
      if (tmin > tmax) continue
    }

    if (Math.abs(dz) < 1e-8) {
      if (az < minZ || az > maxZ) continue
    } else {
      const inv = 1 / dz
      let t1 = (minZ - az) * inv
      let t2 = (maxZ - az) * inv
      let sign = -1
      if (t1 > t2) {
        const tmp = t1
        t1 = t2
        t2 = tmp
        sign = 1
      }
      if (t1 > tmin) {
        tmin = t1
        hitAxis = 2
        hitSign = sign
      }
      tmax = Math.min(tmax, t2)
      if (tmin > tmax) continue
    }

    if (tmin >= 0 && tmin <= 1 && tmin < bestT) {
      bestT = tmin
      bestNx = hitAxis === 0 ? hitSign : 0
      bestNy = hitAxis === 1 ? hitSign : 0
      bestNz = hitAxis === 2 ? hitSign : 0
    }
  }

  return bestT <= 1 ? { t: bestT, nx: bestNx, ny: bestNy, nz: bestNz } : null
}

export function sweepSegmentVsWorld(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  inflate = 0,
  extraSolids: ReadonlyArray<MapBox> = []
): { readonly t: number; readonly nx: number; readonly ny: number; readonly nz: number } | null {
  const staticHit = sweepSegmentVsBoxes(ax, ay, az, bx, by, bz, MAP_SOLIDS, inflate)
  if (extraSolids.length === 0) return staticHit
  const dynHit = sweepSegmentVsBoxes(ax, ay, az, bx, by, bz, extraSolids, inflate)
  if (!staticHit) return dynHit
  if (!dynHit) return staticHit
  return dynHit.t < staticHit.t ? dynHit : staticHit
}

export function sweepSegmentVsCapsule(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  height: number
): number | null {
  const dx = bx - ax
  const dy = by - ay
  const dz = bz - az
  const ox = ax - cx
  const oz = az - cz

  const a = dx * dx + dz * dz
  const b = 2 * (ox * dx + oz * dz)
  const c = ox * ox + oz * oz - radius * radius

  let tEnter = 0
  let tExit = 1

  if (a < 1e-8) {
    if (c > 0) return null
  } else {
    const disc = b * b - 4 * a * c
    if (disc < 0) return null
    const sq = Math.sqrt(disc)
    const t1 = (-b - sq) / (2 * a)
    const t2 = (-b + sq) / (2 * a)
    tEnter = Math.max(0, t1)
    tExit = Math.min(1, t2)
    if (tEnter > tExit) return null
  }

  const y0 = ay + dy * tEnter
  const y1 = ay + dy * tExit
  const minY = Math.min(y0, y1)
  const maxY = Math.max(y0, y1)
  if (maxY < cy || minY > cy + height) return null
  return tEnter
}

/** Sample bounded 3D Ink Smoke voxel density at point (x, y, z) across all overlapping clouds */
export function sampleSmokeDensityAt(
  x: number,
  y: number,
  z: number,
  clouds: ReadonlyArray<SmokeGridLike>
): number {
  let maxDensity = 0
  for (const cl of clouds) {
    const halfX = (cl.nx * cl.cellSize) * 0.5
    const halfY = (cl.ny * cl.cellSize) * 0.5
    const halfZ = (cl.nz * cl.cellSize) * 0.5
    const ix = Math.floor((x - (cl.cx - halfX)) / cl.cellSize)
    const iy = Math.floor((y - (cl.cy - halfY)) / cl.cellSize)
    const iz = Math.floor((z - (cl.cz - halfZ)) / cl.cellSize)
    if (ix < 0 || ix >= cl.nx || iy < 0 || iy >= cl.ny || iz < 0 || iz >= cl.nz) continue
    const idx = (iy * cl.nz + iz) * cl.nx + ix
    const cleared = cl.clearedTicks[idx] ?? 0
    const d = cleared > 0 ? 0 : 1
    if (d > maxDensity) maxDensity = d
  }
  return maxDensity
}

/** Returns true if segment A->B is occluded by any dense Ink Smoke voxel cell */
export function isSegmentBlockedBySmoke(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  clouds: ReadonlyArray<SmokeGridLike>
): boolean {
  if (clouds.length === 0) return false
  const dist = Ops.hypot(Ops.hypot(bx - ax, bz - az), by - ay)
  const steps = Math.max(4, Math.min(36, Math.ceil(dist / 0.55)))
  for (let i = 1; i < steps; i++) {
    const t = i / steps
    const px = ax + (bx - ax) * t
    const py = ay + (by - ay) * t
    const pz = az + (bz - az) * t
    if (sampleSmokeDensityAt(px, py, pz, clouds) >= SMOKE_DENSITY_THRESHOLD) {
      return true
    }
  }
  return false
}

export function hasLineOfSight(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  extraSolids: ReadonlyArray<MapBox> = [],
  smokeClouds: ReadonlyArray<SmokeGridLike> = []
): boolean {
  if (sweepSegmentVsWorld(ax, ay, az, bx, by, bz, 0, extraSolids) !== null) return false
  if (smokeClouds.length > 0 && isSegmentBlockedBySmoke(ax, ay, az, bx, by, bz, smokeClouds)) {
    return false
  }
  return true
}
