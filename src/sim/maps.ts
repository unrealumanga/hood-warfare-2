import { HEALTH_PICKUP_POS } from "./data.ts"
import {
  ANOMALY_COURTYARD, BARREL_SPAWNS, CABLE_CAR_SPLINE, EXTRACTION_EXIT,
  EXTRACTION_VAULT, FOUNDRY_CENTER, FOUNDRY_SCRAP_SPAWNS, GRAPPLE_LEDGES,
  MAP_BOXES, MAP_SOLIDS, MAP_WAYPOINTS, MURAL_ZONES, SKETCH_ANCHORS, SPAWN_POINTS,
  type GrappleLedgeDef, type MapBox, type MapWaypoint, type MuralZoneDef,
  type SketchAnchorPair, type SpawnPoint
} from "./map.ts"

export type MapId = "bellYard" | "overprintHall"
interface Point { readonly x: number; readonly y: number; readonly z: number }
interface Bounds {
  readonly minX: number; readonly maxX: number
  readonly minY: number; readonly maxY: number
  readonly minZ: number; readonly maxZ: number
}
type HorizontalBounds = Pick<Bounds, "minX" | "maxX" | "minZ" | "maxZ">
export interface MapDef {
  readonly id: MapId
  readonly name: string
  readonly boxes: ReadonlyArray<MapBox>
  readonly solids: ReadonlyArray<MapBox>
  readonly muralZones: ReadonlyArray<MuralZoneDef>
  readonly spawnPoints: ReadonlyArray<SpawnPoint>
  readonly waypoints: ReadonlyArray<MapWaypoint>
  readonly sketchAnchors: ReadonlyArray<SketchAnchorPair>
  readonly grappleLedges: ReadonlyArray<GrappleLedgeDef>
  readonly barrelSpawns: ReadonlyArray<Point & { readonly id: number }>
  readonly extractionVault: Point & { readonly radius: number }
  readonly extractionExit: Point & { readonly radius: number }
  readonly foundryCenter: Point & { readonly radius: number }
  readonly foundryScrapSpawns: ReadonlyArray<Point & { readonly id: number }>
  readonly anomalyCourtyard: Bounds
  readonly cableCarSpline: {
    readonly startX: number; readonly endX: number; readonly z: number
    readonly baseY: number; readonly archY: number; readonly halfW: number
    readonly halfD: number; readonly thickness: number; readonly cycleTicks: number
  }
  readonly healthPickupPosition: Point
  readonly bossEntrance: Point & { readonly yaw: number }
  readonly movementBounds: HorizontalBounds
  readonly propBounds: HorizontalBounds
  readonly placementBounds: HorizontalBounds
  readonly smokeBounds: HorizontalBounds
  readonly foremanBounds: HorizontalBounds
}

export const UPPER_Y = 3.6

function box(
  id: string, minX: number, maxX: number, minY: number, maxY: number,
  minZ: number, maxZ: number, kind: MapBox["kind"],
  accent: MapBox["accent"] = "paper", signText?: string, signFace?: MapBox["signFace"]
): MapBox {
  return { id, minX, maxX, minY, maxY, minZ, maxZ, kind, accent, signText, signFace, solid: true }
}

const hallBoxes: ReadonlyArray<MapBox> = [
  box("hall_floor", -26, 26, -1, 0, -22, 22, "ground"),
  box("hall_west", -26, -25.5, 0, 9, -22, 22, "building", "paper", "PACKING", "+x"),
  box("hall_east", 25.5, 26, 0, 9, -22, 22, "building", "paper", "DISPATCH", "-x"),
  box("hall_south", -26, 26, 0, 9, 21.5, 22, "building", "paper", "OVERPRINT HALL", "-z"),
  box("hall_north_w", -26, 14, 0, 9, -22, -21.5, "building"),
  box("hall_north_e", 20, 26, 0, 9, -22, -21.5, "building"),
  box("dispatch_shutter", 14, 20, 0, 5, -22, -21.5, "cover", "shaded", "DISPATCH 02", "+z"),
  box("shutter_lintel", 14, 20, 5, 9, -22, -21.5, "building"),
  box("hall_roof", -26, 26, 9, 9.4, -22, 22, "canopy", "shaded"),
  box("centre_press", -3, 3, 0, 2.8, -6, 3, "cover", "dark", "PRESS 01", "+z"),
  box("packing_wall_n", -12, -11, 0, 3, -11, -2, "cover", "shaded"),
  box("packing_wall_s", -12, -11, 0, 3, 2, 9, "cover", "shaded"),
  box("packing_pallet", -21, -18, 0, 1.4, -6, 2, "cover", "ochre"),
  box("dispatch_pallet_n", 19, 21, 0, 1.4, -7, -3, "cover", "ochre"),
  box("dispatch_pallet_s", 19, 21, 0, 1.4, 4, 8, "cover", "ochre"),
  box("gallery_w", -10, -3, 3.2, UPPER_Y, -17, -10, "deck", "shaded"),
  box("gallery_e", 3, 10, 3.2, UPPER_Y, -17, -10, "deck", "shaded"),
  ...[-8, 8].flatMap((x) => Array.from({ length: 12 }, (_, i) =>
    box(`hall_stair_${x < 0 ? "w" : "e"}_step_${i}`, x - 1.4, x + 1.4,
      0, (i + 1) * UPPER_Y / 12, -2 - (i + 1) * 8 / 12, -2 - i * 8 / 12, "stair", "shaded")))
]

const hallPositions: ReadonlyArray<readonly [number, number, number]> = [
  [-23, 0, 16], [-23, 0, 0], [-23, 0, -16], [-16, 0, 16], [-16, 0, 0],
  [-16, 0, -16], [-8, 0, 16], [0, 0, 6], [8, 0, 16], [16, 0, 16],
  [23, 0, 16], [23, 0, 0], [23, 0, -16], [16, 0, -16], [8, 0, -19],
  [-8, 0, -19], [-8, 0, 0], [8, 0, 0], [-8, UPPER_Y, -11], [-4, UPPER_Y, -14],
  [8, UPPER_Y, -11], [4, UPPER_Y, -14], [16, 0, 0], [-6, 0, 6], [6, 0, 6],
  [-6, 0, -8], [6, 0, -8], [0, 0, -8], [-23, 0, 8], [-16, 0, 8]
]
const hallEdges: ReadonlyArray<readonly [number, number]> = [
  [0, 3], [0, 28], [1, 2], [1, 28], [2, 5], [3, 6], [3, 29], [4, 5],
  [4, 16], [4, 29], [5, 15], [6, 8], [6, 23], [7, 9], [7, 23], [7, 24],
  [8, 9], [8, 24], [9, 10], [9, 22], [10, 11], [11, 12], [11, 22],
  [12, 13], [13, 14], [13, 22], [14, 15], [14, 26], [15, 25], [16, 18],
  [16, 23], [17, 20], [17, 22], [17, 24], [18, 19], [20, 21], [23, 25],
  [24, 26], [25, 27], [26, 27], [28, 29]
]
const hallWaypoints: ReadonlyArray<MapWaypoint> = hallPositions.map(([x, y, z], id) => ({
  id, x, y, z,
  neighbors: hallEdges.flatMap(([a, b]) => a === id ? [b] : b === id ? [a] : []),
  muralId: id === 7 ? 0 : id === 9 ? 1 : id === 19 ? 2 : undefined
}))

export const MAPS: Readonly<Record<MapId, MapDef>> = {
  bellYard: {
    id: "bellYard", name: "Bell Yard", boxes: MAP_BOXES, solids: MAP_SOLIDS,
    muralZones: MURAL_ZONES, spawnPoints: SPAWN_POINTS, waypoints: MAP_WAYPOINTS,
    sketchAnchors: SKETCH_ANCHORS, grappleLedges: GRAPPLE_LEDGES, barrelSpawns: BARREL_SPAWNS,
    extractionVault: EXTRACTION_VAULT, extractionExit: EXTRACTION_EXIT,
    foundryCenter: FOUNDRY_CENTER, foundryScrapSpawns: FOUNDRY_SCRAP_SPAWNS,
    anomalyCourtyard: ANOMALY_COURTYARD, cableCarSpline: CABLE_CAR_SPLINE,
    healthPickupPosition: HEALTH_PICKUP_POS,
    bossEntrance: { x: 0, y: 0, z: -16, yaw: 0 },
    movementBounds: { minX: -27, maxX: 27, minZ: -17, maxZ: 20.5 },
    propBounds: { minX: -25.5, maxX: 25.5, minZ: -16, maxZ: 19.5 },
    placementBounds: { minX: -24, maxX: 24, minZ: -15.5, maxZ: 18.5 },
    smokeBounds: { minX: -24, maxX: 24, minZ: -15, maxZ: 18 },
    foremanBounds: { minX: -10, maxX: 10, minZ: -8, maxZ: 8 }
  },
  overprintHall: {
    id: "overprintHall", name: "Overprint Hall", boxes: hallBoxes,
    solids: hallBoxes.filter((b) => b.solid), waypoints: hallWaypoints,
    spawnPoints: [
      { crew: 0, x: -23, y: 0, z: -16, yaw: -Math.PI / 2 },
      { crew: 0, x: -23, y: 0, z: 0, yaw: -Math.PI / 2 },
      { crew: 0, x: -23, y: 0, z: 16, yaw: -Math.PI / 2 },
      { crew: 1, x: 23, y: 0, z: -16, yaw: Math.PI / 2 },
      { crew: 1, x: 23, y: 0, z: 0, yaw: Math.PI / 2 },
      { crew: 1, x: 23, y: 0, z: 16, yaw: Math.PI / 2 }
    ],
    muralZones: [
      { id: 0, name: "Printing Aisle", shortName: "PRINTING AISLE", x: 0, y: 0, z: 6,
        radius: 4, height: 3, wallX: 0, wallY: 1.4, wallZ: 3.04, wallFacing: "+z" },
      { id: 1, name: "Dispatch", shortName: "DISPATCH", x: 16, y: 0, z: 16,
        radius: 4, height: 3, wallX: 16, wallY: 1.7, wallZ: 21.44, wallFacing: "-z" },
      { id: 2, name: "Maintenance Gallery", shortName: "MAINTENANCE", x: -4, y: UPPER_Y, z: -14,
        radius: 3, height: 3, wallX: -6, wallY: 5.3, wallZ: -21.44, wallFacing: "+z" }
    ],
    sketchAnchors: [{
      id: "anchor_gallery_gap", label: "West → East Maintenance Gallery",
      ax: -3, ay: UPPER_Y, az: -14, bx: 3, by: UPPER_Y, bz: -14,
      minX: -3, maxX: 3, minY: 3.36, maxY: UPPER_Y, minZ: -15.2, maxZ: -12.8,
      wpA: 19, wpB: 21
    }],
    grappleLedges: [
      { id: "ledge_gallery_w", label: "West Maintenance", x: -8, y: 3.95, z: -9.82 },
      { id: "ledge_gallery_e", label: "East Maintenance", x: 8, y: 3.95, z: -9.82 },
      { id: "ledge_press", label: "Press Rollers", x: 0, y: 3.15, z: 3.18 }
    ],
    barrelSpawns: [
      { id: 1, x: -16, y: 0, z: 4 }, { id: 2, x: 20, y: 0, z: 10 },
      { id: 3, x: 20, y: 0, z: -11 }
    ],
    extractionVault: { x: -6, y: UPPER_Y, z: -15.5, radius: 2.4 },
    extractionExit: { x: 16, y: 0, z: 18, radius: 3.2 },
    foundryCenter: { x: 0, y: 0, z: 6, radius: 3.6 },
    foundryScrapSpawns: [
      { id: 1, x: -16, y: 0, z: 12 }, { id: 2, x: 16, y: 0, z: 12 },
      { id: 3, x: -6, y: UPPER_Y, z: -15 }, { id: 4, x: 6, y: UPPER_Y, z: -15 }
    ],
    anomalyCourtyard: { minX: -10, maxX: 10, minY: -0.5, maxY: 8.5, minZ: -8, maxZ: 10 },
    cableCarSpline: {
      startX: -8, endX: 8, z: 12, baseY: 4.2, archY: 1, halfW: 1.45,
      halfD: 1.15, thickness: 0.28, cycleTicks: 720
    },
    healthPickupPosition: { x: 0, y: 0, z: 5 },
    bossEntrance: { x: 17, y: 0, z: -20, yaw: 0 },
    movementBounds: { minX: -25, maxX: 25, minZ: -21, maxZ: 21 },
    propBounds: { minX: -25, maxX: 25, minZ: -21, maxZ: 21 },
    placementBounds: { minX: -24, maxX: 24, minZ: -19.5, maxZ: 19.5 },
    smokeBounds: { minX: -24, maxX: 24, minZ: -20, maxZ: 20 },
    foremanBounds: { minX: -24, maxX: 24, minZ: -20, maxZ: 20 }
  }
}

/** Validate persisted/network input and keep old clients on the default map. */
export function sanitizeMapId(value: unknown): MapId {
  return value === "overprintHall" ? "overprintHall" : "bellYard"
}

/** Map definition for any id (unknown or missing ids, e.g. from an older server snapshot, get Bell Yard). */
export function mapForId(value: unknown): MapDef {
  return MAPS[sanitizeMapId(value)]
}
