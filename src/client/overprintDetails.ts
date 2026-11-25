import * as THREE from "three"
import type { MapDef } from "../sim/maps.ts"
import { createInkMaterial } from "./inkShader.ts"

/**
 * Creates a canvas texture for wall-mounted mastheads, signs, and giant page numbers.
 */
function createWallBannerTexture(
  title: string,
  subtitle?: string,
  accentColor = "#b04a39",
  bgColor = "#f0f2ec"
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas")
  canvas.width = 512
  canvas.height = 256
  const ctx = canvas.getContext("2d")!

  ctx.fillStyle = bgColor
  ctx.fillRect(0, 0, 512, 256)

  // Outer border & inner accent border
  ctx.strokeStyle = "#222c27"
  ctx.lineWidth = 6
  ctx.strokeRect(8, 8, 496, 240)
  ctx.strokeStyle = accentColor
  ctx.lineWidth = 3
  ctx.strokeRect(18, 18, 476, 220)

  // Registration marks in corners
  ctx.fillStyle = accentColor
  for (const [cx, cy] of [
    [28, 28],
    [484, 28],
    [28, 228],
    [484, 228]
  ] as const) {
    ctx.beginPath()
    ctx.arc(cx, cy, 5, 0, Math.PI * 2)
    ctx.fill()
  }

  // Primary title text
  ctx.fillStyle = "#222c27"
  ctx.font = "bold 32px ui-monospace, 'Cascadia Mono', Consolas, monospace"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(title, 256, subtitle ? 100 : 128)

  if (subtitle) {
    ctx.fillStyle = accentColor
    ctx.font = "bold 18px ui-monospace, 'Cascadia Mono', Consolas, monospace"
    ctx.fillText(subtitle, 256, 160)
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * Overprint Hall eye-level industrial newspaper press hall detailing.
 * All repeated geometry is batched into InstancedMeshes; shallow trim inherits host collision.
 */
export function addOverprintDetails(scene: THREE.Group, map: MapDef): void {
  const steel = 0x47524d
  const darkIron = 0x2c3531
  const zinc = 0x849089
  const brass = 0xa48c61
  const timber = 0xb19b79
  const paper = 0xe1dfcd
  const paperDust = 0xd8dcd1
  const scuff = 0xbfc6bc
  const vermilion = 0xb04a39
  const cobalt = 0x2f5a9c
  const yellowHazard = 0xd4a017
  const darkHazard = 0x1f2421
  const redAlert = 0xc92a2a

  const block = new THREE.BoxGeometry()
  const round = new THREE.CylinderGeometry(0.5, 0.5, 1, 14)

  type Piece = { matrix: THREE.Matrix4; color: THREE.Color }
  const batches = new Map<THREE.BufferGeometry, Piece[]>()

  function part(
    geometry: THREE.BufferGeometry,
    color: number,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    rx = 0,
    ry = 0,
    rz = 0
  ): void {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(w, h, d)
    )
    const pieces = batches.get(geometry) ?? []
    pieces.push({ matrix, color: new THREE.Color(color) })
    batches.set(geometry, pieces)
  }

  // ── 1. Central Rotary Press Detailing ──────────────────────────────────────
  // Press box: -3..3, 0..2.8, -6..3 (center x=0, y=1.4, z=-1.5, w=6, h=2.8, d=9)

  // 1A. Heavy Side Frame Pillars & Upright Structural Columns
  for (const sideX of [-3.05, 3.05]) {
    for (const zPillar of [-5.5, -2.5, 0.5, 2.5]) {
      part(block, darkIron, sideX, 1.5, zPillar, 0.16, 3.0, 0.35)
      // Gear wheel hubs on outer frame
      part(round, steel, sideX + (sideX > 0 ? 0.1 : -0.1), 1.6, zPillar, 0.5, 0.12, 0.5, 0, 0, Math.PI / 2)
      part(round, brass, sideX + (sideX > 0 ? 0.15 : -0.15), 1.6, zPillar, 0.22, 0.08, 0.22, 0, 0, Math.PI / 2)
    }
    // Top tie beam
    part(block, steel, sideX, 2.95, -1.5, 0.16, 0.22, 8.6)
  }

  // 1B. Stacked Plate, Impression & Feed Rollers
  for (const zRoller of [-4.5, -3.0, -1.5, 0.0, 1.5]) {
    // Upper printing plate cylinders
    part(round, zinc, 0, 2.45, zRoller, 0.84, 5.8, 0.84, 0, 0, Math.PI / 2)
    part(round, steel, 0, 2.1, zRoller, 0.6, 5.8, 0.6, 0, 0, Math.PI / 2)
    // Lower impression cylinders
    part(round, darkIron, 0, 1.5, zRoller + 0.4, 0.52, 5.6, 0.52, 0, 0, Math.PI / 2)
    // Inking distributor rollers
    part(round, brass, 0, 1.1, zRoller - 0.3, 0.3, 5.6, 0.3, 0, 0, Math.PI / 2)
  }

  // 1C. Paper Web Feed Sheet
  part(block, paper, 0, 1.82, -1.5, 5.7, 0.02, 8.0)

  // 1D. Ink Fountains with Vermilion & Cobalt Streaks
  part(block, vermilion, -2.9, 1.8, -4.0, 0.24, 0.55, 1.8)
  part(block, cobalt, 2.9, 1.8, -1.0, 0.24, 0.55, 1.8)
  part(block, vermilion, 2.9, 1.8, 1.5, 0.24, 0.55, 1.2)
  part(block, cobalt, -2.9, 1.8, 0.5, 0.24, 0.55, 1.5)
  // Ink drip streaks down the press frame
  part(block, vermilion, -3.02, 1.1, -3.8, 0.02, 0.9, 0.3)
  part(block, cobalt, 3.02, 1.1, -0.8, 0.02, 0.9, 0.3)

  // 1E. Brass Pressure Gauges & Speed Dials
  for (const sideX of [-3.05, 3.05]) {
    for (const zGauge of [-3.5, -0.5, 1.8]) {
      part(round, brass, sideX + (sideX > 0 ? 0.09 : -0.09), 2.2, zGauge, 0.38, 0.08, 0.38, 0, 0, Math.PI / 2)
      part(round, paper, sideX + (sideX > 0 ? 0.12 : -0.12), 2.2, zGauge, 0.26, 0.04, 0.26, 0, 0, Math.PI / 2)
    }
  }

  // 1F. Catwalk Deck & Railing along Top of Press
  for (const sideX of [-2.85, 2.85]) {
    // Catwalk deck floor strip
    part(block, darkIron, sideX, 2.84, -1.5, 0.35, 0.06, 8.8)
    // Top handrail & mid rail
    part(block, steel, sideX, 3.45, -1.5, 0.06, 0.06, 8.8)
    part(block, steel, sideX, 3.15, -1.5, 0.04, 0.04, 8.8)
    // Vertical railing posts
    for (const zPost of [-5.8, -3.0, 0.0, 2.8]) {
      part(block, steel, sideX, 3.15, zPost, 0.06, 0.65, 0.06)
    }
  }

  // 1G. Press Base Warning Chevrons
  for (let i = 0; i < 9; i++) {
    const zStripe = -5.5 + i * 1.0
    const col = i % 2 === 0 ? yellowHazard : darkHazard
    part(block, col, -3.02, 0.2, zStripe, 0.02, 0.35, 0.8)
    part(block, col, 3.02, 0.2, zStripe, 0.02, 0.35, 0.8)
  }

  // ── 2. Pallets, Strapped Bundles & Newsprint Reels ─────────────────────────

  // 2A. Stacked Paper Pallets with Strapping & Timber Skids
  for (const b of map.boxes) {
    if (!b.id.includes("pallet")) continue
    const x = (b.minX + b.maxX) / 2
    const z = (b.minZ + b.maxZ) / 2
    const w = b.maxX - b.minX
    const d = b.maxZ - b.minZ

    // Timber forklift skids
    for (const dx of [-w * 0.33, w * 0.33]) {
      part(block, timber, x + dx, 0.08, z, 0.16, 0.16, d + 0.04)
    }
    // Printed newspaper stack layers
    for (let i = 0; i < 7; i++) {
      part(block, paper, x, 0.25 + i * 0.16, z, w + 0.02, 0.12, d + 0.02)
    }
    // Steel tension strapping
    for (const dx of [-w * 0.25, w * 0.25]) {
      part(block, darkIron, x + dx, 0.75, z, 0.05, 1.15, d + 0.04)
    }
    // Shipping slip label on side
    part(block, paper, x, 0.8, z + d / 2 + 0.02, 0.45, 0.28, 0.02)
  }

  // 2B. Newsprint Reels (Large Paper Rolls on Heavy Iron Stands)
  const reelPositions: Array<[number, number, number]> = [
    [-24.2, 0.8, -14], [-24.2, 0.8, -10], [-24.2, 0.8, 10], [-24.2, 0.8, 14],
    [24.2, 0.8, -14], [24.2, 0.8, -10], [24.2, 0.8, 10], [24.2, 0.8, 14]
  ]
  for (const [rx, ry, rz] of reelPositions) {
    // Stand frame base
    part(block, darkIron, rx, ry - 0.4, rz, 1.4, 0.8, 1.2)
    // Heavy newsprint roll cylinder
    part(round, paper, rx, ry, rz, 1.3, 1.8, 1.3, Math.PI / 2, 0, 0)
    // Brass central spindle hub
    part(round, brass, rx, ry, rz, 0.22, 2.0, 0.22, Math.PI / 2, 0, 0)
    // Paper dust drift around reel base
    part(block, paperDust, rx, 0.008, rz, 1.8, 0.01, 1.6)
  }

  // 2C. Wire-tied Scrap Bales in Packing Area
  const balePositions: Array<[number, number, number]> = [
    [-23.5, 0.4, -4], [-23.5, 0.4, 2], [-23.5, 1.1, -4]
  ]
  for (const [bx, by, bz] of balePositions) {
    part(block, paper, bx, by, bz, 1.2, 0.7, 1.0)
    // Wire ties wrapping bale
    part(block, darkIron, bx, by, bz, 1.24, 0.03, 0.03)
    part(block, darkIron, bx, by, bz, 0.03, 0.74, 0.03)
  }

  // ── 3. Gallery Railings, Stairs & Edge Hazards ──────────────────────────────

  // 3A. West & East Upper Gallery Edge Railings
  for (const g of [
    { xMin: -10, xMax: -3, zMin: -17, zMax: -10 },
    { xMin: 3, xMax: 10, zMin: -17, zMax: -10 }
  ]) {
    // Front edge top rail (z = -10, y = 4.1)
    part(block, steel, (g.xMin + g.xMax) / 2, 4.1, g.zMax, g.xMax - g.xMin, 0.06, 0.06)
    part(block, steel, (g.xMin + g.xMax) / 2, 3.65, g.zMax, g.xMax - g.xMin, 0.04, 0.04)
    for (let px = g.xMin; px <= g.xMax; px += 1.75) {
      part(block, steel, px, 3.65, g.zMax, 0.06, 0.9, 0.06)
    }

    // Outer edge top rail
    const outerX = g.xMin < 0 ? g.xMin : g.xMax
    part(block, steel, outerX, 4.1, (g.zMin + g.zMax) / 2, 0.06, 0.06, g.zMax - g.zMin)
    part(block, steel, outerX, 3.65, (g.zMin + g.zMax) / 2, 0.04, 0.04, g.zMax - g.zMin)
    for (let pz = g.zMin; pz <= g.zMax; pz += 1.75) {
      part(block, steel, outerX, 3.65, pz, 0.06, 0.9, 0.06)
    }

    // Gallery edge hazard stripe trim
    for (let x = g.xMin; x < g.xMax; x += 0.8) {
      const col = Math.floor((x - g.xMin) / 0.8) % 2 === 0 ? yellowHazard : darkHazard
      part(block, col, x + 0.4, 3.21, g.zMax - 0.08, 0.75, 0.02, 0.16)
    }
  }

  // 3B. Brass Stair Nosings & Step Edge Hazard Trim
  for (const x of [-8, 8]) {
    for (let i = 0; i < 12; i++) {
      const stepY = (i + 1) * 3.2 / 12
      const stepZ = -2 - i * 8 / 12
      // Brass nosing strip
      part(block, brass, x, stepY + 0.01, stepZ, 2.75, 0.02, 0.06)
      // Step edge hazard stripes
      part(block, yellowHazard, x - 1.3, stepY + 0.012, stepZ, 0.15, 0.02, 0.5)
      part(block, yellowHazard, x + 1.3, stepY + 0.012, stepZ, 0.15, 0.02, 0.5)
    }
  }

  // 3C. Wear & Dust Patches at Bottom of Staircases
  for (const [wx, wz] of [
    [-8, -1.6], [8, -1.6], [-8, -10.5], [8, -10.5]
  ] as const) {
    part(block, scuff, wx, 0.008, wz, 2.8, 0.01, 1.2)
    part(block, paperDust, wx + 0.5, 0.009, wz + 0.2, 1.2, 0.01, 0.6)
  }

  // ── 4. Overhead Trusses, Lighting & Pipes ──────────────────────────────────

  // 4A. Heavy Structural Roof Trusses at y = 8.6
  for (const zTruss of [-18, -10, 0, 10, 18]) {
    // Upper & lower horizontal chords
    part(block, steel, 0, 8.6, zTruss, 51, 0.25, 0.25)
    part(block, steel, 0, 8.0, zTruss, 51, 0.15, 0.15)
    // Diagonal webbing struts
    for (let tx = -22; tx <= 22; tx += 4) {
      part(block, steel, tx, 8.3, zTruss, 0.1, 0.65, 0.1, 0, 0, Math.PI / 4)
    }
  }

  // 4B. Hanging Industrial High-Bay Lamp Rails & Shades
  for (const x of [-18, -6, 6, 18]) {
    part(block, steel, x, 7.6, 0, 0.14, 0.18, 38)
    for (const z of [-15, -5, 5, 15]) {
      // Cable drop
      part(block, darkIron, x, 8.1, z, 0.04, 1.0, 0.04)
      // Lamp fixture bell body
      part(block, steel, x, 7.55, z, 0.4, 0.2, 0.4)
      // Cone shade translucent warm glow fixture
      part(round, 0xf5e4b5, x, 7.42, z, 0.8, 0.25, 0.8)
    }
  }

  // 4C. Overhead Industrial Ventilation Ducts & Pipe Runs
  part(block, zinc, -14, 8.2, 0, 1.2, 0.8, 42)
  part(block, zinc, 14, 8.2, 0, 1.2, 0.8, 42)
  // Duct mounting straps
  for (const zDuct of [-16, -8, 0, 8, 16]) {
    part(block, darkIron, -14, 8.2, zDuct, 1.3, 0.88, 0.1)
    part(block, darkIron, 14, 8.2, zDuct, 1.3, 0.88, 0.1)
  }

  // ── 5. Dispatch Shutter, Conveyors & Wall Fixtures ─────────────────────────

  // 5A. Dispatch Shutter Door (Corrugated Roller Door at 14..20, 0..5, z=-22)
  for (let sy = 0.2; sy < 4.8; sy += 0.25) {
    part(block, darkIron, 17, sy, -21.65, 5.8, 0.18, 0.08)
  }
  // Overhead roller drum housing
  part(block, steel, 17, 5.2, -21.6, 6.0, 0.5, 0.3)
  // Threshold kickplate & paper dust drift
  part(block, steel, 17, 0.02, -21.55, 5.8, 0.04, 0.15)
  part(block, paperDust, 17, 0.01, -21.0, 6.2, 0.01, 1.2)
  // Red warning beacon lamp on lintel
  part(block, darkIron, 17, 5.5, -21.4, 0.4, 0.4, 0.3)
  part(round, redAlert, 17, 5.5, -21.2, 0.3, 0.3, 0.3, Math.PI / 2, 0, 0)

  // 5B. Roller Conveyor Belts from Press to Packing/Dispatch
  for (const cx of [-5.0, 5.0]) {
    // Main frame legs & bed
    part(block, darkIron, cx, 0.4, -1.5, 1.0, 0.3, 7.0)
    for (const zLeg of [-4.5, -1.5, 1.5]) {
      part(block, steel, cx, 0.2, zLeg, 0.15, 0.4, 0.15)
    }
    // Rubber belt surface
    part(block, darkHazard, cx, 0.56, -1.5, 0.85, 0.05, 6.8)
    // Newspaper bundle packages on conveyor
    part(block, paper, cx, 0.72, -3.2, 0.7, 0.26, 0.65)
    part(block, paper, cx, 0.72, 0.2, 0.7, 0.26, 0.65)
  }

  // 5C. Wall Proofing Boards (Cork Boards with Pinned Newsprint)
  const wallBoards: Array<[number, number, number]> = [
    [-25.4, 2.2, -6], [-25.4, 2.2, 6],
    [25.4, 2.2, -6], [25.4, 2.2, 6]
  ]
  for (const [bx, by, bz] of wallBoards) {
    const isWest = bx < 0
    part(block, timber, bx, by, bz, 0.08, 1.8, 3.2)
    part(block, paper, bx + (isWest ? 0.05 : -0.05), by, bz, 0.02, 1.5, 2.8)
  }

  // 5D. Fire Extinguisher Box Stations & Notice Boards
  const extPositions: Array<[number, number]> = [[-11.8, -6], [11.8, -6], [-11.8, 5], [11.8, 5]]
  for (const [fx, fz] of extPositions) {
    part(block, redAlert, fx, 1.3, fz, 0.35, 0.6, 0.35)
    part(block, paper, fx, 1.7, fz, 0.04, 0.3, 0.25) // Notice sign
  }

  // ── 6. Floor Registration Marks, Ink Spills & Lane Stripes ─────────────────

  // 6A. Vibrant Ink Spill Puddles on Concrete Floor
  const inkSpills: Array<[number, number, number, number, number, number]> = [
    [-5.0, 0.012, 1.5, 1.8, 1.4, cobalt],
    [4.5, 0.012, -2.5, 1.4, 2.0, vermilion],
    [-4.0, 0.012, -5.0, 1.2, 1.2, darkHazard],
    [5.2, 0.012, 2.0, 1.6, 1.0, cobalt],
    [-22.0, 0.012, -2.0, 2.0, 1.5, vermilion],
    [22.0, 0.012, 1.0, 1.6, 2.2, cobalt]
  ]
  for (const [sx, sy, sz, sw, sd, col] of inkSpills) {
    part(block, col, sx, sy, sz, sw, 0.005, sd)
  }

  // 6B. CMYK Precision Floor Registration Marks
  const regMarks: Array<[number, number]> = [
    [-4.5, -7.0], [4.5, -7.0], [-4.5, 4.0], [4.5, 4.0]
  ]
  for (const [rx, rz] of regMarks) {
    part(block, vermilion, rx, 0.015, rz, 0.8, 0.005, 0.12)
    part(block, cobalt, rx, 0.015, rz, 0.12, 0.005, 0.8)
  }

  // 6C. Floor Painted Lane Boundary Stripes
  for (const laneX of [-13, -10, 10, 13]) {
    part(block, yellowHazard, laneX, 0.011, 0, 0.15, 0.005, 38.0)
  }

  // ── 7. Build InstancedMeshes ────────────────────────────────────────────────
  const defaultMaterial = createInkMaterial(0xffffff, { hatchStrength: 0.18 })

  for (const [geometry, pieces] of batches) {
    const mesh = new THREE.InstancedMesh(geometry, defaultMaterial, pieces.length)
    pieces.forEach((p, i) => {
      mesh.setMatrixAt(i, p.matrix)
      mesh.setColorAt(i, p.color)
    })
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
    scene.add(mesh)
  }

  // ── 8. Wall Masthead, Signs & Giant Page Numbers ───────────────────────────

  const wallSigns: Array<{
    title: string
    subtitle?: string
    accent: string
    pos: [number, number, number]
    rotY: number
    scale: [number, number]
  }> = [
    {
      title: "THE OVERPRINT GAZETTE",
      subtitle: "PRESS HALL 01 · EST. 1894",
      accent: "#b04a39",
      pos: [17, 6.2, -21.4],
      rotY: 0,
      scale: [5.2, 1.4]
    },
    {
      title: "PACKING & BUNDLING",
      subtitle: "PRESS AISLE A",
      accent: "#2f5a9c",
      pos: [-25.4, 4.5, 0],
      rotY: Math.PI / 2,
      scale: [4.2, 1.5]
    },
    {
      title: "DISPATCH BAY 02",
      subtitle: "HEAVY GOODS DECK",
      accent: "#b04a39",
      pos: [25.4, 4.5, 0],
      rotY: -Math.PI / 2,
      scale: [4.2, 1.5]
    },
    {
      title: "PAGE 01",
      subtitle: "FRONT PAGE DECK",
      accent: "#222c27",
      pos: [-6.5, 4.6, -16.9],
      rotY: 0,
      scale: [3.4, 1.2]
    },
    {
      title: "PAGE 02",
      subtitle: "EDITORIAL GALLERY",
      accent: "#222c27",
      pos: [6.5, 4.6, -16.9],
      rotY: 0,
      scale: [3.4, 1.2]
    }
  ]

  for (const s of wallSigns) {
    const tex = createWallBannerTexture(s.title, s.subtitle, s.accent)
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(s.scale[0], s.scale[1]), mat)
    plane.position.set(...s.pos)
    plane.rotation.y = s.rotY
    scene.add(plane)
  }
}
