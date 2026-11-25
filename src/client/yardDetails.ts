import * as THREE from "three"
import { MAP_BOXES } from "../sim/map.ts"
import { createInkMaterial, createShopSignTexture } from "./inkShader.ts"

/**
 * Bell Yard eye-level print district detailing.
 * All repeated geometry is batched into InstancedMeshes; shallow trim inherits host collision.
 */
export function addYardDetails(scene: THREE.Scene | THREE.Group): void {
  const steel = 0x47524d
  const darkIron = 0x2c3531
  const zinc = 0x849089
  const brass = 0xa48c61
  const timber = 0xb19b79
  const paper = 0xe1dfcd
  const dust = 0xd8dcd1
  const scuff = 0xbfc6bc

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

  for (const b of MAP_BOXES) {
    const x = (b.minX + b.maxX) / 2
    const z = (b.minZ + b.maxZ) / 2
    const w = b.maxX - b.minX
    const h = b.maxY - b.minY
    const d = b.maxZ - b.minZ

    // ── 1. Print Courtyard & Loading Deck Freight Crates ──────────────────
    if (b.id.startsWith("court_crate") || b.id.startsWith("deck_cover")) {
      // Steel tension straps wrapping top + front/back + side bands
      for (const sign of [-1, 1]) {
        const strapX = x + sign * w * 0.33
        part(block, steel, strapX, b.maxY + 0.012, z, 0.065, 0.022, d + 0.03)
        for (const face of [-1, 1]) {
          part(block, steel, strapX, (b.maxY + b.minY) / 2, z + face * (d / 2 + 0.012), 0.065, h, 0.022)
          // Timber forklift skids along bottom edge
          part(block, timber, x, b.minY + 0.11, z + face * (d / 2 + 0.022), w + 0.04, 0.16, 0.044)
        }
        // Restrained steel corner wear brackets on all 4 vertical edges
        for (const zSign of [-1, 1]) {
          part(
            block,
            darkIron,
            x + sign * (w / 2 + 0.008),
            b.maxY - 0.14,
            z + zSign * (d / 2 + 0.008),
            0.09,
            0.22,
            0.09
          )
        }
      }
      // East/West side tie straps
      for (const side of [-1, 1]) {
        part(block, steel, x + side * (w / 2 + 0.012), b.minY + h * 0.55, z, 0.02, 0.06, d + 0.02)
      }
      // Paper shipping slip + ink handling marks
      const labelZ = b.maxZ + 0.024
      part(block, paper, x, b.maxY - 0.36, labelZ, 0.42, 0.26, 0.016)
      for (let i = 0; i < 3; i++) {
        part(
          block,
          darkIron,
          x - 0.03 - i * 0.01,
          b.maxY - 0.30 - i * 0.052,
          labelZ + 0.012,
          0.24 - i * 0.035,
          0.016,
          0.01
        )
      }
      // Up-arrow handling stencil mark on top-right of slip
      part(block, steel, x + 0.13, b.maxY - 0.33, labelZ + 0.012, 0.022, 0.09, 0.01)
      part(block, steel, x + 0.13, b.maxY - 0.28, labelZ + 0.012, 0.06, 0.022, 0.01)
    }

    // ── 2. North Press Hall Shuttered Goods Doors, Pipes, Vents & Threshold Dust ─
    if (b.id === "bldg_north_hall") {
      for (const bay of [-7.4, 7.4]) {
        // Shutter door frame aligned cleanly to Upper Loading Deck (y = 3.6)
        part(block, steel, bay, 5.12, b.maxZ + 0.08, 3.3, 3.04, 0.16)
        for (let i = 0; i < 16; i++) {
          part(block, zinc, bay, 3.72 + i * 0.18, b.maxZ + 0.18, 3.04, 0.13, 0.05)
        }
        // Brass pull handle + overhead roller housing
        part(block, brass, bay, 3.98, b.maxZ + 0.23, 0.52, 0.055, 0.08)
        part(block, steel, bay, 6.74, b.maxZ + 0.20, 3.58, 0.25, 0.44)
        // Threshold steel kickplate + scuffs & paper-dust drift on the raised deck (y = 3.6)
        part(block, darkIron, bay, 3.61, b.maxZ + 0.18, 3.32, 0.018, 0.26)
        part(block, scuff, bay - 0.35, 3.608, b.maxZ + 0.85, 2.6, 0.01, 1.05)
        part(block, dust, bay + 0.95, 3.612, b.maxZ + 0.55, 0.9, 0.012, 0.52)
        part(block, dust, bay - 1.15, 3.612, b.maxZ + 0.42, 0.72, 0.012, 0.38)
      }
      // Downpipes clear of windows (-18.9..-2.1, 2.1..18.9) and central sign (-4.2..4.2)
      for (const pipe of [-22, -12, 12, 22]) {
        part(round, zinc, pipe, b.maxY / 2, b.maxZ + 0.16, 0.15, b.maxY, 0.15)
        for (let y = 1.0; y < b.maxY; y += 2.4) {
          part(round, steel, pipe, y, b.maxZ + 0.16, 0.20, 0.08, 0.20)
        }
        // Capped press-hall roof vents
        part(round, steel, pipe, b.maxY + 0.54, z, 0.82, 1.08, 0.82)
        part(round, zinc, pipe, b.maxY + 1.11, z, 1.16, 0.12, 1.16)
      }
    }

    // ── 3. Vintage Line 04 Tram Car Seated on Rails (z = 18.5 & 19.6, rail top y = 0.04) ─
    if (b.id === "tram_car_body") {
      // Wheel bogies seated directly onto the steel rails at z = 18.5 and 19.6
      for (const axle of [-4.2, -3.1, 3.1, 4.2]) {
        for (const railZ of [18.5, 19.6]) {
          const outSign = railZ < z ? -1 : 1
          part(round, steel, axle, 0.37, railZ, 0.66, 0.14, 0.66, Math.PI / 2)
          part(round, zinc, axle, 0.37, railZ + outSign * 0.09, 0.24, 0.07, 0.24, Math.PI / 2)
        }
        // Transverse steel axle bar
        part(round, darkIron, axle, 0.37, z, 0.11, 1.25, 0.11, Math.PI / 2)
      }
      // Bogie side frames
      for (const bx of [-3.65, 3.65]) {
        for (const railZ of [18.5, 19.6]) {
          part(block, darkIron, bx, 0.34, railZ, 1.65, 0.14, 0.12)
        }
      }
      // Worn boarding step edge along waiting-area side (north face z = 18.0)
      part(block, brass, x, 0.22, b.minZ - 0.09, 3.4, 0.05, 0.22)
      part(block, scuff, x, 0.008, b.minZ - 0.42, 4.6, 0.01, 0.72)

      // End bumpers & brass-rimmed headlamps
      for (const end of [-1, 1]) {
        const nose = x + end * (w / 2 + 0.04)
        part(block, steel, nose, 0.60, z, 0.16, 0.18, d * 0.86)
        for (const offset of [-0.52, 0.52]) {
          part(round, brass, nose, 1.25, z + offset, 0.31, 0.13, 0.31, 0, 0, Math.PI / 2)
          part(round, paper, nose + end * 0.08, 1.25, z + offset, 0.22, 0.05, 0.22, 0, 0, Math.PI / 2)
        }
      }
    }

    // ── 4. Elevated Footbridge Steel Splice Plates, Rivets & Truss Ribs ──
    if (b.id === "footbridge_span") {
      for (const side of [-1, 1]) {
        const edge = z + side * (d / 2 + 0.02)
        part(block, steel, x, b.minY + 0.04, edge, w, 0.08, 0.08)
        for (let seam = b.minX + 0.6; seam < b.maxX; seam += 2.3) {
          part(block, zinc, seam, b.minY + 0.22, edge, 0.24, 0.32, 0.045)
          for (const y of [0.12, 0.31]) {
            part(round, steel, seam, b.minY + y, edge + side * 0.035, 0.075, 0.035, 0.075, Math.PI / 2)
          }
        }
      }
      // Localized deck approach wear strips at West & East bridge entries
      for (const entryX of [b.minX + 0.55, b.maxX - 0.55]) {
        part(block, scuff, entryX, b.maxY + 0.008, z, 1.05, 0.01, 1.85)
      }
    }

    // ── 5. Brass Stair Nosings ───────────────────────────────────────────
    if (b.kind === "stair") {
      part(block, brass, x, b.maxY + 0.009, b.maxZ - 0.045, w - 0.14, 0.016, 0.07)
    }
  }

  // Localized approach wear patches at the bottom of the 4 staircases
  for (const [wx, wz] of [
    [-11.5, -1.6],
    [11.5, -1.6],
    [-13.0, 9.4],
    [13.0, 9.4]
  ] as const) {
    part(block, scuff, wx, 0.008, wz, 2.7, 0.01, 1.15)
  }

  // Cast-iron street drains flush with the paving
  for (const x of [-9, 9]) {
    for (const z of [-7, 7, 15]) {
      part(block, steel, x, 0.011, z, 0.65, 0.018, 1.05)
      for (let i = 0; i < 8; i++) {
        part(block, zinc, x, 0.023, z - 0.43 + i * 0.12, 0.55, 0.01, 0.04)
      }
    }
  }

  const material = createInkMaterial(0xffffff, { hatchStrength: 0.18 })
  for (const [geometry, pieces] of batches) {
    const mesh = new THREE.InstancedMesh(geometry, material, pieces.length)
    pieces.forEach((piece, i) => {
      mesh.setMatrixAt(i, piece.matrix)
      mesh.setColorAt(i, piece.color)
    })
    mesh.receiveShadow = true
    mesh.computeBoundingSphere()
    scene.add(mesh)
  }

  // Route 04 Timetable / Route Plate mounted cleanly on Tram Kiosk facing waiting area (+z)
  const plateTex = createShopSignTexture("LINE 04 · EVERY 6 MIN · COURTYARD / MILL", "#2f5a9c")
  const plateMat = new THREE.MeshBasicMaterial({ map: plateTex })
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.85, 0.48), plateMat)
  plate.position.set(0, 0.92, 13.03)
  scene.add(plate)
}
