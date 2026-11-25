import * as THREE from "three"
import type { MapDef } from "../sim/maps.ts"
import { createInkMaterial } from "./inkShader.ts"

/** Static batches only: all dressing stays within cover or above player clearance. */
export function addOverprintDetails(scene: THREE.Group, map: MapDef): void {
  const pieces: Array<readonly [number, number, number, number, number, number, number]> = []
  for (const b of map.boxes) {
    if (!b.id.includes("pallet")) continue
    const x = (b.minX + b.maxX) / 2
    const z = (b.minZ + b.maxZ) / 2
    const w = b.maxX - b.minX
    const d = b.maxZ - b.minZ
    // Printed paper layers and wooden forklift skids inherit their solid host.
    for (let i = 0; i < 7; i++) {
      pieces.push([x, 0.3 + i * 0.16, z, w + 0.025, 0.11, d + 0.025, 0xe5dfc9])
    }
    for (const dx of [-w * 0.33, w * 0.33]) {
      pieces.push([x + dx, 0.1, z, 0.16, 0.2, d + 0.04, 0xa18a63])
      pieces.push([x + dx, 0.8, z, 0.08, 1.25, d + 0.05, 0x47524d])
    }
  }
  // Hanging steel lamp rails and warm fixtures, well above galleries.
  for (const x of [-18, -6, 6, 18]) {
    pieces.push([x, 7.6, 0, 0.14, 0.18, 38, 0x47524d])
    for (const z of [-15, -5, 5, 15]) {
      pieces.push([x, 8.3, z, 0.06, 1.4, 0.06, 0x47524d])
      pieces.push([x, 7.42, z, 2.6, 0.12, 0.65, 0xf5e4b5])
    }
  }
  const material = createInkMaterial(0xffffff, { hatchStrength: 0.18 })
  const batch = new THREE.InstancedMesh(new THREE.BoxGeometry(), material, pieces.length)
  const dummy = new THREE.Object3D()
  const color = new THREE.Color()
  pieces.forEach(([x, y, z, w, h, d, hex], i) => {
    dummy.position.set(x, y, z)
    dummy.scale.set(w, h, d)
    dummy.updateMatrix()
    batch.setMatrixAt(i, dummy.matrix)
    batch.setColorAt(i, color.setHex(hex))
  })
  batch.castShadow = true
  batch.receiveShadow = true
  batch.computeBoundingSphere()
  scene.add(batch)

  // Stationary exposed press rollers, inset into the central collision body.
  const rollers = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.42, 0.42, 5.8, 12),
    createInkMaterial(0x849089, { hatchStrength: 0.2 }), 5
  )
  dummy.scale.set(1, 1, 1)
  dummy.rotation.z = Math.PI / 2
  for (let i = 0; i < 5; i++) {
    dummy.position.set(0, 2.45, -5 + i * 1.7)
    dummy.updateMatrix()
    rollers.setMatrixAt(i, dummy.matrix)
  }
  rollers.castShadow = true
  rollers.computeBoundingSphere()
  scene.add(rollers)
}
