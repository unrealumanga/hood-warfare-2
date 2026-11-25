import type { CrewId } from "./data.ts"

// ── Bell Yard — Fictional Printworks District 3D Map ─────────────────────
// Shared exact AABB solid geometry for physics, swept raycasts, bot navigation, and Three.js rendering.

export type MapBoxKind =
  | "ground"
  | "building"
  | "bridge"
  | "deck"
  | "stair"
  | "cover"
  | "tram"
  | "canopy"
  | "tank"
  | "railing"
  | "muralWall"

export interface MapBox {
  readonly id: string
  readonly minX: number
  readonly minY: number
  readonly minZ: number
  readonly maxX: number
  readonly maxY: number
  readonly maxZ: number
  readonly kind: MapBoxKind
  readonly accent?: "paper" | "shaded" | "brick" | "cobalt" | "dark" | "ochre"
  readonly signText?: string
  readonly signFace?: "+z" | "-z" | "+x" | "-x"
  /** If true, blocks movement & projectiles; false for decorative trim/rooftops high overhead */
  readonly solid: boolean
}

export interface MuralZoneDef {
  readonly id: 0 | 1 | 2
  readonly name: string
  readonly shortName: string
  readonly x: number
  readonly y: number
  readonly z: number
  readonly radius: number
  readonly height: number
  readonly wallX: number
  readonly wallY: number
  readonly wallZ: number
  readonly wallFacing: "+z" | "-z" | "+x" | "-x"
}

export interface SpawnPoint {
  readonly crew: CrewId
  readonly x: number
  readonly y: number
  readonly z: number
  readonly yaw: number
}

export interface MapWaypoint {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly z: number
  readonly neighbors: ReadonlyArray<number>
  readonly muralId?: 0 | 1 | 2
}

// Helper to build stepped 3D staircase AABBs climbing smoothly from y0 to y1
function buildStaircase(
  prefix: string,
  centerX: number,
  widthX: number,
  startZ: number,
  endZ: number,
  y0: number,
  y1: number,
  steps: number
): Array<MapBox> {
  const out: Array<MapBox> = []
  const dz = (endZ - startZ) / steps
  const dy = (y1 - y0) / steps
  for (let i = 0; i < steps; i++) {
    const zA = startZ + i * dz
    const zB = startZ + (i + 1) * dz
    const topY = y0 + (i + 1) * dy
    out.push({
      id: `${prefix}_step_${i}`,
      minX: centerX - widthX / 2,
      maxX: centerX + widthX / 2,
      minY: y0,
      maxY: topY,
      minZ: Math.min(zA, zB),
      maxZ: Math.max(zA, zB),
      kind: "stair",
      accent: "shaded",
      solid: true
    })
  }
  return out
}

const UPPER_Y = 3.6

// Two climbable staircases: West Printworks Stair & East Bindery Stair (climbing north from z=-2.2 to z=-10.0)
const WEST_STAIRS = buildStaircase("stair_west", -11.5, 3.2, -2.2, -10.0, 0, UPPER_Y, 12)
const EAST_STAIRS = buildStaircase("stair_east", 11.5, 3.2, -2.2, -10.0, 0, UPPER_Y, 12)

// South Balcony stairs climbing onto the mid-level west/east overlooks (y = 3.6m) connected to the Footbridge!
const BRIDGE_WEST_STAIRS = buildStaircase("stair_bridge_w", -13.0, 2.8, 8.8, 2.6, 0, UPPER_Y, 12)
const BRIDGE_EAST_STAIRS = buildStaircase("stair_bridge_e", 13.0, 2.8, 8.8, 2.6, 0, UPPER_Y, 12)

export const MAP_BOXES: ReadonlyArray<MapBox> = [
  // Main cobbled courtyard & street ground slab
  {
    id: "ground_main",
    minX: -32,
    maxX: 32,
    minY: -1.0,
    maxY: 0,
    minZ: -24,
    maxZ: 24,
    kind: "ground",
    accent: "paper",
    solid: true
  },

  // ── Outer Perimeter Printworks Buildings (tall Inkline facades + shop signs) ──
  // North Printworks Main Hall (behind Upper Loading Deck)
  {
    id: "bldg_north_hall",
    minX: -32,
    maxX: 32,
    minY: 0,
    maxY: 12.5,
    minZ: -25.5,
    maxZ: -17.5,
    kind: "building",
    accent: "paper",
    signText: "BELL YARD PRESS · EST. 1894",
    signFace: "+z",
    solid: true
  },
  // South Paper Mill & Tramway Wall
  {
    id: "bldg_south_mill",
    minX: -32,
    maxX: 32,
    minY: 0,
    maxY: 10.5,
    minZ: 21.0,
    maxZ: 26.0,
    kind: "building",
    accent: "paper",
    signText: "BELL YARD TRAMWAY DEPOT",
    signFace: "-z",
    solid: true
  },
  // West Cobalt Spawn Facade
  {
    id: "bldg_west_wall",
    minX: -34,
    maxX: -27.5,
    minY: 0,
    maxY: 11.5,
    minZ: -24,
    maxZ: 24,
    kind: "building",
    accent: "paper",
    signText: "LINOTYPE & FOUNDRY",
    signFace: "+x",
    solid: true
  },
  // East Vermilion Spawn Facade
  {
    id: "bldg_east_wall",
    minX: 27.5,
    maxX: 34,
    minY: 0,
    maxY: 11.5,
    minZ: -24,
    maxZ: 24,
    kind: "building",
    accent: "paper",
    signText: "BINDERY & PROOF WORKS",
    signFace: "-x",
    solid: true
  },

  // ── Rooftop Water Tanks & Chimneys (unmistakable vertical skyline!) ──
  {
    id: "tank_nw",
    minX: -22,
    maxX: -18,
    minY: 12.5,
    maxY: 17.0,
    minZ: -22.5,
    maxZ: -18.5,
    kind: "tank",
    accent: "shaded",
    solid: false
  },
  {
    id: "tank_ne",
    minX: 16,
    maxX: 20,
    minY: 12.5,
    maxY: 16.4,
    minZ: -22.5,
    maxZ: -18.5,
    kind: "tank",
    accent: "brick",
    solid: false
  },
  {
    id: "tank_sw",
    minX: -24,
    maxX: -20.5,
    minY: 10.5,
    maxY: 14.5,
    minZ: 21.5,
    maxZ: 25.0,
    kind: "tank",
    accent: "cobalt",
    solid: false
  },

  // ── Upper Loading Deck (y = 3.6m, Mural Zone #2) ──
  {
    id: "upper_loading_deck",
    minX: -15.5,
    maxX: 15.5,
    minY: UPPER_Y - 0.55,
    maxY: UPPER_Y,
    minZ: -17.5,
    maxZ: -9.8,
    kind: "deck",
    accent: "shaded",
    solid: true
  },
  // Support pillars under Upper Loading Deck (open underpass below!)
  {
    id: "deck_pillar_w",
    minX: -9.6,
    maxX: -8.6,
    minY: 0,
    maxY: UPPER_Y - 0.55,
    minZ: -10.8,
    maxZ: -9.8,
    kind: "cover",
    accent: "dark",
    solid: true
  },
  {
    id: "deck_pillar_c",
    minX: -0.5,
    maxX: 0.5,
    minY: 0,
    maxY: UPPER_Y - 0.55,
    minZ: -10.8,
    maxZ: -9.8,
    kind: "cover",
    accent: "dark",
    solid: true
  },
  {
    id: "deck_pillar_e",
    minX: 8.6,
    maxX: 9.6,
    minY: 0,
    maxY: UPPER_Y - 0.55,
    minZ: -10.8,
    maxZ: -9.8,
    kind: "cover",
    accent: "dark",
    solid: true
  },
  // Low parapet cover along Upper Loading Deck front (crouch/peek height 1.05m)
  {
    id: "deck_rail_w",
    minX: -8.2,
    maxX: -2.2,
    minY: UPPER_Y,
    maxY: UPPER_Y + 1.05,
    minZ: -10.1,
    maxZ: -9.8,
    kind: "railing",
    accent: "paper",
    solid: true
  },
  {
    id: "deck_rail_e",
    minX: 2.2,
    maxX: 8.2,
    minY: UPPER_Y,
    maxY: UPPER_Y + 1.05,
    minZ: -10.1,
    maxZ: -9.8,
    kind: "railing",
    accent: "paper",
    solid: true
  },
  // Loading Deck Paper Roll Cover
  {
    id: "deck_cover_w",
    minX: -5.4,
    maxX: -3.8,
    minY: UPPER_Y,
    maxY: UPPER_Y + 1.35,
    minZ: -14.2,
    maxZ: -12.6,
    kind: "cover",
    accent: "ochre",
    solid: true
  },
  {
    id: "deck_cover_e",
    minX: 3.8,
    maxX: 5.4,
    minY: UPPER_Y,
    maxY: UPPER_Y + 1.35,
    minZ: -14.2,
    maxZ: -12.6,
    kind: "cover",
    accent: "ochre",
    solid: true
  },

  // ── Elevated Steel Footbridge + Balconies (look up from courtyard, climb stairs, cross!) ──
  // West Balcony landing connecting bridge & stairs
  {
    id: "balcony_west",
    minX: -15.5,
    maxX: -9.8,
    minY: UPPER_Y - 0.45,
    maxY: UPPER_Y,
    minZ: -2.4,
    maxZ: 2.8,
    kind: "bridge",
    accent: "shaded",
    solid: true
  },
  // East Balcony landing
  {
    id: "balcony_east",
    minX: 9.8,
    maxX: 15.5,
    minY: UPPER_Y - 0.45,
    maxY: UPPER_Y,
    minZ: -2.4,
    maxZ: 2.8,
    kind: "bridge",
    accent: "shaded",
    solid: true
  },
  // Central Footbridge spanning right over the Print Shop Courtyard (y = 3.6m)
  {
    id: "footbridge_span",
    minX: -9.8,
    maxX: 9.8,
    minY: UPPER_Y - 0.42,
    maxY: UPPER_Y,
    minZ: -1.4,
    maxZ: 1.4,
    kind: "bridge",
    accent: "shaded",
    solid: true
  },
  // Bridge side parapets (north rail split cleanly at x = -1.6..1.6 for the Sketch Plank shortcut!)
  {
    id: "bridge_rail_nw",
    minX: -9.0,
    maxX: -1.6,
    minY: UPPER_Y,
    maxY: UPPER_Y + 0.92,
    minZ: -1.4,
    maxZ: -1.2,
    kind: "railing",
    accent: "dark",
    solid: true
  },
  {
    id: "bridge_rail_ne",
    minX: 1.6,
    maxX: 9.0,
    minY: UPPER_Y,
    maxY: UPPER_Y + 0.92,
    minZ: -1.4,
    maxZ: -1.2,
    kind: "railing",
    accent: "dark",
    solid: true
  },
  {
    id: "bridge_rail_s",
    minX: -9.0,
    maxX: 9.0,
    minY: UPPER_Y,
    maxY: UPPER_Y + 0.92,
    minZ: 1.2,
    maxZ: 1.4,
    kind: "railing",
    accent: "dark",
    solid: true
  },

  // ── Four Climbable Staircases ──
  ...WEST_STAIRS,
  ...EAST_STAIRS,
  ...BRIDGE_WEST_STAIRS,
  ...BRIDGE_EAST_STAIRS,

  // ── Courtyard Printworks Structures & Cover (Mural Zone #0 at x=0, z=0) ──
  // Courtyard mural monument wall (north edge of courtyard)
  {
    id: "courtyard_mural_wall",
    minX: -3.2,
    maxX: 3.2,
    minY: 0,
    maxY: 2.65,
    minZ: -6.4,
    maxZ: -5.6,
    kind: "muralWall",
    accent: "paper",
    solid: true
  },
  // Courtyard printing-press crates (flank cover)
  {
    id: "court_crate_nw",
    minX: -7.0,
    maxX: -5.2,
    minY: 0,
    maxY: 1.45,
    minZ: -4.4,
    maxZ: -2.6,
    kind: "cover",
    accent: "ochre",
    solid: true
  },
  {
    id: "court_crate_ne",
    minX: 5.2,
    maxX: 7.0,
    minY: 0,
    maxY: 1.45,
    minZ: -4.4,
    maxZ: -2.6,
    kind: "cover",
    accent: "ochre",
    solid: true
  },
  {
    id: "court_crate_sw",
    minX: -6.6,
    maxX: -4.8,
    minY: 0,
    maxY: 1.35,
    minZ: 3.8,
    maxZ: 5.4,
    kind: "cover",
    accent: "shaded",
    solid: true
  },
  {
    id: "court_crate_se",
    minX: 4.8,
    maxX: 6.6,
    minY: 0,
    maxY: 1.35,
    minZ: 3.8,
    maxZ: 5.4,
    kind: "cover",
    accent: "shaded",
    solid: true
  },

  // ── Side Print Shop Buildings separating Spawns from Center (creates flanking lanes!) ──
  {
    id: "shop_west_mid",
    minX: -22.5,
    maxX: -16.2,
    minY: 0,
    maxY: 6.2,
    minZ: -8.5,
    maxZ: 1.5,
    kind: "building",
    accent: "paper",
    signText: "INK & PAPER SHOP",
    signFace: "+x",
    solid: true
  },
  {
    id: "shop_east_mid",
    minX: 16.2,
    maxX: 22.5,
    minY: 0,
    maxY: 6.2,
    minZ: -8.5,
    maxZ: 1.5,
    kind: "building",
    accent: "paper",
    signText: "TYPEFACE & LITHO",
    signFace: "-x",
    solid: true
  },
  // Spawn protection walls (prevent cross-map spawn camping)
  {
    id: "spawn_cover_w",
    minX: -22.0,
    maxX: -20.5,
    minY: 0,
    maxY: 2.5,
    minZ: 7.0,
    maxZ: 13.5,
    kind: "cover",
    accent: "cobalt",
    solid: true
  },
  {
    id: "spawn_cover_e",
    minX: 20.5,
    maxX: 22.0,
    minY: 0,
    maxY: 2.5,
    minZ: 7.0,
    maxZ: 13.5,
    kind: "cover",
    accent: "brick",
    solid: true
  },

  // ── Tram Shelter & Vintage Bell Yard Tram Car (Mural Zone #1 at x=0, z=14.5) ──
  // Canopy roof overhead
  {
    id: "tram_canopy_roof",
    minX: -7.5,
    maxX: 7.5,
    minY: 3.6,
    maxY: 3.95,
    minZ: 11.2,
    maxZ: 17.4,
    kind: "canopy",
    accent: "shaded",
    signText: "BELL YARD TRAM STOP",
    signFace: "-z",
    solid: true
  },
  // Four slender canopy columns
  {
    id: "tram_col_nw",
    minX: -7.2,
    maxX: -6.7,
    minY: 0,
    maxY: 3.6,
    minZ: 11.5,
    maxZ: 12.0,
    kind: "cover",
    accent: "dark",
    solid: true
  },
  {
    id: "tram_col_ne",
    minX: 6.7,
    maxX: 7.2,
    minY: 0,
    maxY: 3.6,
    minZ: 11.5,
    maxZ: 12.0,
    kind: "cover",
    accent: "dark",
    solid: true
  },
  {
    id: "tram_col_sw",
    minX: -7.2,
    maxX: -6.7,
    minY: 0,
    maxY: 3.6,
    minZ: 16.8,
    maxZ: 17.3,
    kind: "cover",
    accent: "dark",
    solid: true
  },
  {
    id: "tram_col_se",
    minX: 6.7,
    maxX: 7.2,
    minY: 0,
    maxY: 3.6,
    minZ: 16.8,
    maxZ: 17.3,
    kind: "cover",
    accent: "dark",
    solid: true
  },
  // Vintage Bell Yard Tram Car parked beside the shelter (solid tactical cover!)
  {
    id: "tram_car_body",
    minX: -5.6,
    maxX: 5.6,
    minY: 0.25,
    maxY: 2.95,
    minZ: 18.0,
    maxZ: 20.1,
    kind: "tram",
    accent: "ochre",
    signText: "LINE 04 · BELL YARD",
    signFace: "-z",
    solid: true
  },
  // Tram shelter bench / kiosk cover
  {
    id: "tram_kiosk",
    minX: -1.4,
    maxX: 1.4,
    minY: 0,
    maxY: 1.35,
    minZ: 12.0,
    maxZ: 13.0,
    kind: "cover",
    accent: "paper",
    solid: true
  }
]

export const MAP_SOLIDS: ReadonlyArray<MapBox> = MAP_BOXES.filter((b) => b.solid)

export const MURAL_ZONES: ReadonlyArray<MuralZoneDef> = [
  {
    id: 0,
    name: "Print Shop Courtyard",
    shortName: "COURTYARD",
    x: 0,
    y: 0,
    z: 0,
    radius: 4.8,
    height: 3.0,
    wallX: 0,
    wallY: 1.4,
    wallZ: -5.56,
    wallFacing: "+z"
  },
  {
    id: 1,
    name: "Tram Shelter",
    shortName: "TRAM SHELTER",
    x: 0,
    y: 0,
    z: 14.5,
    radius: 4.6,
    height: 3.4,
    wallX: 0,
    wallY: 1.7,
    wallZ: 17.95,
    wallFacing: "-z"
  },
  {
    id: 2,
    name: "Upper Loading Deck",
    shortName: "LOADING DECK",
    x: 0,
    y: UPPER_Y,
    z: -13.2,
    radius: 4.5,
    height: 3.2,
    wallX: 0,
    wallY: UPPER_Y + 1.8,
    wallZ: -17.44,
    wallFacing: "+z"
  }
]

export const SPAWN_POINTS: ReadonlyArray<SpawnPoint> = [
  // Cobalt Press (West Yard)
  { crew: 0, x: -24.5, y: 0, z: -12.0, yaw: -Math.PI / 2 },
  { crew: 0, x: -24.5, y: 0, z: 4.5, yaw: -Math.PI / 2 },
  { crew: 0, x: -24.5, y: 0, z: 14.5, yaw: -Math.PI / 2 },
  // Vermilion Bind (East Yard)
  { crew: 1, x: 24.5, y: 0, z: -12.0, yaw: Math.PI / 2 },
  { crew: 1, x: 24.5, y: 0, z: 4.5, yaw: Math.PI / 2 },
  { crew: 1, x: 24.5, y: 0, z: 14.5, yaw: Math.PI / 2 }
]

// ── Bot Waypoint Navigation Graph (includes stairs & footbridge!) ────────

export const MAP_WAYPOINTS: ReadonlyArray<MapWaypoint> = [
  // 0..2 West spawn & lanes
  { id: 0, x: -24.0, y: 0, z: 12.0, neighbors: [1, 3, 14] },
  { id: 1, x: -24.0, y: 0, z: -11.5, neighbors: [0, 2, 16] },
  { id: 2, x: -13.5, y: 0, z: -12.5, neighbors: [1, 4, 16] },
  // 3..5 West courtyard & stairs
  { id: 3, x: -13.0, y: 0, z: 9.8, neighbors: [0, 4, 6, 14] },
  { id: 4, x: -11.5, y: 0, z: -1.4, neighbors: [2, 3, 5, 7] },
  { id: 5, x: -11.5, y: UPPER_Y, z: -10.8, neighbors: [4, 12, 17] }, // top of west deck stairs
  // 6..7 Courtyard & Bridge West
  { id: 6, x: -13.0, y: UPPER_Y, z: 1.5, neighbors: [3, 8, 17] }, // west balcony (top of bridge stair)
  { id: 7, x: 0.0, y: 0, z: 0.0, neighbors: [4, 9, 10, 14, 15], muralId: 0 }, // Mural 0: Courtyard
  { id: 8, x: 0.0, y: UPPER_Y, z: 0.0, neighbors: [6, 11] }, // Center of Footbridge!
  // 9..11 East courtyard & Bridge East
  { id: 9, x: 11.5, y: 0, z: -1.4, neighbors: [7, 10, 13, 18] },
  { id: 10, x: 13.0, y: 0, z: 9.8, neighbors: [7, 9, 11, 15, 19] },
  { id: 11, x: 13.0, y: UPPER_Y, z: 1.5, neighbors: [8, 10, 18] }, // east balcony
  // 12..13 Upper Loading Deck (Mural 2)
  { id: 12, x: 0.0, y: UPPER_Y, z: -13.2, neighbors: [5, 13], muralId: 2 },
  { id: 13, x: 11.5, y: UPPER_Y, z: -10.8, neighbors: [9, 12, 18] }, // top of east deck stairs
  // 14..15 Tram Shelter (Mural 1)
  { id: 14, x: -6.5, y: 0, z: 14.5, neighbors: [0, 3, 7, 20] },
  { id: 15, x: 6.5, y: 0, z: 14.5, neighbors: [7, 10, 19, 20] },
  // 16..19 Flanking connectors & East Spawn
  { id: 16, x: -17.0, y: 0, z: -13.0, neighbors: [1, 2] },
  { id: 17, x: -11.5, y: UPPER_Y, z: -6.0, neighbors: [5, 6] }, // west upper catwalk / stair link
  { id: 18, x: 11.5, y: UPPER_Y, z: -6.0, neighbors: [11, 13] }, // east upper catwalk / stair link
  { id: 19, x: 24.0, y: 0, z: 12.0, neighbors: [10, 15, 21] },
  { id: 20, x: 0.0, y: 0, z: 14.5, neighbors: [14, 15], muralId: 1 }, // Mural 1: Tram Shelter
  { id: 21, x: 24.0, y: 0, z: -11.5, neighbors: [19, 9] }
]

export function findNearestWaypoint(x: number, y: number, z: number, waypoints = MAP_WAYPOINTS): number {
  let bestId = 0
  let bestDist = 1e9
  for (const wp of waypoints) {
    const dx = wp.x - x
    const dy = (wp.y - y) * 2.5 // prefer same vertical floor
    const dz = wp.z - z
    const d = dx * dx + dy * dy + dz * dz
    if (d < bestDist) {
      bestDist = d
      bestId = wp.id
    }
  }
  return bestId
}

/** Deterministic BFS next waypoint ID from `fromId` toward `goalId`, supporting dynamic Sketch Plank edges */
export function nextWaypointToward(
  fromId: number,
  goalId: number,
  extraEdges: ReadonlyArray<readonly [number, number]> = [],
  waypoints = MAP_WAYPOINTS
): number {
  if (fromId === goalId) return goalId
  const visited = new Set<number>([fromId])
  const queue: Array<{ readonly id: number; readonly firstStep: number }> = []

  const neighborsOf = (id: number): Array<number> => {
    const wp = waypoints[id]
    const out = wp ? [...wp.neighbors] : []
    for (const [a, b] of extraEdges) {
      if (a === id) out.push(b)
      else if (b === id) out.push(a)
    }
    return out
  }

  for (const nb of neighborsOf(fromId)) {
    if (nb === goalId) return nb
    if (!visited.has(nb)) {
      visited.add(nb)
      queue.push({ id: nb, firstStep: nb })
    }
  }
  let head = 0
  while (head < queue.length) {
    const cur = queue[head++]!
    for (const nb of neighborsOf(cur.id)) {
      if (nb === goalId) return cur.firstStep
      if (!visited.has(nb)) {
        visited.add(nb)
        queue.push({ id: nb, firstStep: cur.firstStep })
      }
    }
  }
  return goalId
}

export function muralWaypointId(muralId: 0 | 1 | 2, waypoints = MAP_WAYPOINTS): number {
  return waypoints.find((wp) => wp.muralId === muralId)!.id
}

// ── Milestone 1: Sketch Anchor Pairs (Distinct from Permanent Footbridge!) ──

export interface SketchAnchorPair {
  readonly id: string
  readonly label: string
  readonly ax: number
  readonly ay: number
  readonly az: number
  readonly bx: number
  readonly by: number
  readonly bz: number
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
  readonly minZ: number
  readonly maxZ: number
  readonly wpA: number
  readonly wpB: number
}

export const SKETCH_ANCHORS: ReadonlyArray<SketchAnchorPair> = [
  {
    id: "anchor_bridge_deck",
    label: "Footbridge → Upper Loading Deck",
    ax: 0,
    ay: UPPER_Y,
    az: -1.4,
    bx: 0,
    by: UPPER_Y,
    bz: -9.8,
    minX: -1.35,
    maxX: 1.35,
    minY: UPPER_Y - 0.24,
    maxY: UPPER_Y,
    minZ: -9.8,
    maxZ: -1.4,
    wpA: 8,
    wpB: 12
  },
  {
    id: "anchor_west_alley",
    label: "West Balcony → Upper Deck",
    ax: -14.2,
    ay: UPPER_Y,
    az: -2.4,
    bx: -14.2,
    by: UPPER_Y,
    bz: -9.8,
    minX: -15.4,
    maxX: -13.0,
    minY: UPPER_Y - 0.24,
    maxY: UPPER_Y,
    minZ: -9.8,
    maxZ: -2.4,
    wpA: 6,
    wpB: 5
  },
  {
    id: "anchor_east_alley",
    label: "East Balcony → Upper Deck",
    ax: 14.2,
    ay: UPPER_Y,
    az: -2.4,
    bx: 14.2,
    by: UPPER_Y,
    bz: -9.8,
    minX: 13.0,
    maxX: 15.4,
    minY: UPPER_Y - 0.24,
    maxY: UPPER_Y,
    minZ: -9.8,
    maxZ: -2.4,
    wpA: 11,
    wpB: 13
  }
]

// ── Milestone 3: Marked Grapple Ledges & Movable Press Barrels ───────────

export interface GrappleLedgeDef {
  readonly id: string
  readonly label: string
  readonly x: number
  readonly y: number
  readonly z: number
}

export const GRAPPLE_LEDGES: ReadonlyArray<GrappleLedgeDef> = [
  { id: "ledge_deck_c", label: "Upper Deck Edge", x: 0, y: UPPER_Y + 0.35, z: -9.62 },
  { id: "ledge_west_balc", label: "West Balcony", x: -12.4, y: UPPER_Y + 0.35, z: 2.95 },
  { id: "ledge_east_balc", label: "East Balcony", x: 12.4, y: UPPER_Y + 0.35, z: 2.95 },
  { id: "ledge_tram_roof", label: "Tram Canopy Roof", x: 0, y: 4.15, z: 11.05 },
  { id: "ledge_west_shop", label: "West Print Shop Roof", x: -16.05, y: 6.35, z: -3.5 },
  { id: "ledge_east_shop", label: "East Litho Roof", x: 16.05, y: 6.35, z: -3.5 }
]

export const BARREL_SPAWNS: ReadonlyArray<{ readonly id: number; readonly x: number; readonly y: number; readonly z: number }> = [
  { id: 1, x: -3.6, y: 0, z: 2.2 },
  { id: 2, x: 3.6, y: 0, z: 2.2 },
  { id: 3, x: 0.0, y: 0, z: 9.2 }
]

// ── Milestones 5, 7, 8, 9: Extraction, Anomaly, Cable Car & Foundry ──────

export const EXTRACTION_VAULT = { x: 0, y: UPPER_Y, z: -15.6, radius: 2.4 } as const
export const EXTRACTION_EXIT = { x: 0, y: 0, z: 15.6, radius: 3.2 } as const

export const ANOMALY_COURTYARD = {
  minX: -8.5,
  maxX: 8.5,
  minY: -0.5,
  maxY: 11.0,
  minZ: -6.5,
  maxZ: 6.5
} as const

export const CABLE_CAR_SPLINE = {
  startX: -13.6,
  endX: 13.6,
  z: 5.8,
  baseY: 4.2,
  archY: 1.0,
  halfW: 1.45,
  halfD: 1.15,
  thickness: 0.28,
  cycleTicks: 720 // 12s one-way traversal
} as const

export const FOUNDRY_CENTER = { x: 0, y: 0, z: 0, radius: 3.6 } as const

export const FOUNDRY_SCRAP_SPAWNS: ReadonlyArray<{ readonly id: number; readonly x: number; readonly y: number; readonly z: number }> = [
  { id: 1, x: -12.0, y: 0, z: 9.5 },
  { id: 2, x: 12.0, y: 0, z: 9.5 },
  { id: 3, x: -7.5, y: UPPER_Y, z: -13.5 },
  { id: 4, x: 7.5, y: UPPER_Y, z: -13.5 }
]
