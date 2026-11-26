import * as THREE from "three"
import { INKLINE_PALETTE as ink, addInkEdges, createInkMaterial } from "./inkShader.ts"

const quarterTurn = Math.PI / 2
const fullTurn = Math.PI * 2
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
const tube = (radius: number, length: number) =>
  new THREE.CylinderGeometry(radius, radius, length, 12)

// Each prop owns its materials and outlines, like the avatar builder's gun meshes.
function prop(name: string) {
  const group = new THREE.Group()
  group.name = name
  const colors = new Map<number, THREE.MeshToonMaterial>()
  function part(geometry: THREE.BufferGeometry, color: number, x: number, y: number, z: number, tilt = 0) {
    let material = colors.get(color)
    if (!material) {
      material = createInkMaterial(color)
      colors.set(color, material)
    }
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(x, y, z)
    mesh.rotation.x = tilt
    mesh.castShadow = true
    addInkEdges(mesh, 24)
    group.add(mesh)
    return mesh
  }
  return { group, part }
}

export function createSniperMesh(): THREE.Group {
  const { group, part } = prop("Press Sniper")
  part(box(0.084, 0.086, 0.49), ink.paperBg, 0, 0.025, -0.14)
  part(box(0.072, 0.12, 0.22), ink.ink, 0, -0.025, 0.19, 0.16)
  part(box(0.063, 0.12, 0.068), ink.inkDark, 0, -0.066, 0.055, 0.29)
  // Alternating radii cut six longitudinal flutes into the barrel silhouette.
  const flute = new THREE.Shape()
  for (let i = 0; i < 24; i++) {
    const angle = i * fullTurn / 24
    const radius = i % 4 === 0 ? 0.019 : 0.024
    const x = radius * Math.cos(angle)
    const y = radius * Math.sin(angle)
    if (i === 0) flute.moveTo(x, y)
    else flute.lineTo(x, y)
  }
  flute.closePath()
  part(new THREE.ExtrudeGeometry(flute, { depth: 0.49, bevelEnabled: false }), ink.ink, 0, 0.049, -0.81)
  part(tube(0.027, 0.045), ink.inkDark, 0, 0.049, -0.81, quarterTurn)
  part(tube(0.023, 0.16), ink.ink, 0.032, 0.06, -0.02, quarterTurn)
  part(box(0.052, 0.016, 0.016), ink.inkDark, 0.065, 0.058, 0.043)
  part(new THREE.IcosahedronGeometry(0.021), ink.ochre, 0.089, 0.052, 0.043)
  part(tube(0.029, 0.25), ink.inkDark, 0, 0.145, -0.12, quarterTurn)
  part(new THREE.CylinderGeometry(0.03, 0.042, 0.055, 12), ink.ink, 0, 0.145, -0.267, quarterTurn)
  part(tube(0.037, 0.004), ink.cobalt, 0, 0.145, -0.296, quarterTurn)
  for (const z of [-0.20, -0.04]) {
    part(box(0.033, 0.054, 0.023), ink.ink, 0, 0.093, z)
    part(tube(0.033, 0.017), ink.ochre, 0, 0.145, z, quarterTurn)
  }
  for (const side of [-1, 1]) {
    part(tube(0.011, 0.21), ink.inkDark, side * 0.034, -0.027, -0.34, 1.40)
    part(new THREE.IcosahedronGeometry(0.018), ink.ochre, side * 0.034, -0.012, -0.24)
  }
  return group
}

export function createCommandoKnifeMesh(): THREE.Group {
  const { group, part } = prop("Press-Cutter")
  // Draw the blade in profile, then turn its long axis toward -Z.
  const blade = new THREE.Shape()
  blade.moveTo(0, -0.026)
  blade.lineTo(0.18, -0.024)
  blade.lineTo(0.29, 0.009)
  blade.lineTo(0.20, 0.027)
  for (let i = 6; i > 0; i--) {
    const x = i * 0.022
    blade.lineTo(x, 0.027)
    blade.lineTo(x - 0.007, 0.017)
    blade.lineTo(x - 0.014, 0.027)
  }
  blade.lineTo(0, 0.027)
  blade.closePath()
  const steel = new THREE.ExtrudeGeometry(blade, {
    depth: 0.006, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1
  })
  part(steel, ink.paperShadow, -0.003, 0, -0.052).rotation.y = quarterTurn
  part(box(0.055, 0.096, 0.018), ink.ochre, 0, 0, -0.05)
  part(tube(0.025, 0.145), ink.inkDark, 0, 0, 0.029, quarterTurn)
  for (let i = 0; i < 5; i++) {
    part(tube(0.027, 0.013), ink.ink, 0, 0, -0.026 + i * 0.026, quarterTurn - 0.13)
  }
  return group
}

export function createGrenadeMesh(crew: 0 | 1): THREE.Group {
  const { group, part } = prop("Ink Frag")
  part(new THREE.SphereGeometry(0.09, 8, 6), ink.ink, 0, 0, 0).scale.y = 1.18
  part(new THREE.CylinderGeometry(0.091, 0.091, 0.027, 8), crew === 0 ? ink.cobalt : ink.vermilion, 0, 0, 0)
  part(box(0.059, 0.044, 0.057), ink.paperShadow, 0, 0.107, 0)
  part(box(0.031, 0.022, 0.095), ink.inkDark, 0, 0.133, 0.022)
  part(box(0.031, 0.091, 0.018), ink.inkDark, 0, 0.086, 0.079, -0.25)
  part(new THREE.TorusGeometry(0.032, 0.005, 6, 16), ink.ochre, 0.052, 0.109, 0)
  return group
}

export function createSatchelMesh(crew: 0 | 1): { group: THREE.Group; led: THREE.Mesh } {
  const { group, part } = prop("Ink Satchel")
  part(box(0.25, 0.108, 0.18), ink.paperBg, 0, 0, 0)
  part(box(0.24, 0.018, 0.17), ink.inkDark, 0, -0.061, 0)
  for (const x of [-0.084, 0.084]) {
    part(box(0.028, 0.118, 0.187), crew === 0 ? ink.cobalt : ink.vermilion, x, 0, 0)
  }
  part(box(0.097, 0.026, 0.083), ink.ink, 0, 0.067, 0)
  part(tube(0.006, 0.084), ink.inkDark, -0.032, 0.116, -0.03, -0.15)
  const led = part(new THREE.OctahedronGeometry(0.016), ink.vermilion, 0.025, 0.083, 0.016)
  led.material.emissive.setHex(ink.vermilion)
  led.onBeforeRender = () => {
    led.material.emissiveIntensity = 0.65 + 0.55 * Math.cos(performance.now() * 0.007)
  }
  return { group, led }
}

type Surface = "flesh" | "armor" | "metal" | "stone" | "wood"
type Hex = number | string
type ParticleMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
interface Particle {
  mesh: ParticleMesh
  velocity: THREE.Vector3
  age: number
  life: number
  gravity: number
  growth: number
  opacity: number
  spin: number
}

const impacts = {
  flesh: { color: ink.ink, size: [0.052, 0.023, 0.043], speed: 1.4 },
  armor: { color: ink.cobalt, size: [0.036, 0.064, 0.019], speed: 2.1 },
  metal: { color: ink.ochre, size: [0.012, 0.091, 0.012], speed: 3.5 },
  stone: { color: ink.paperShadow, size: [0.068, 0.054, 0.062], speed: 0.65 },
  wood: { color: ink.ochre, size: [0.016, 0.061, 0.021], speed: 1.6 }
} as const

export class CombatFxManager {
  private readonly scene: THREE.Scene
  private readonly geometry = {
    shard: new THREE.OctahedronGeometry(1),
    puff: new THREE.IcosahedronGeometry(1),
    dome: new THREE.SphereGeometry(1, 24, 8, 0, fullTurn, 0, quarterTurn),
    ring: new THREE.RingGeometry(0.94, 1, 48).rotateX(-quarterTurn),
    slash: new THREE.RingGeometry(0.85, 1, 32, 1, -0.25, 2.35)
  }
  private readonly active: Particle[] = []
  private readonly free: Particle[] = []
  private disposed = false

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  private emit(kind: keyof CombatFxManager["geometry"], x: number, y: number, z: number,
    color: Hex, life: number, opacity = 1) {
    const geometry = this.geometry[kind]
    const particle = this.free.pop() ?? this.newParticle(geometry)
    const mesh = particle.mesh
    mesh.geometry = geometry
    mesh.material.color.set(color)
    mesh.material.opacity = opacity
    mesh.position.set(x, y, z)
    mesh.rotation.set(0, 0, 0, "XYZ")
    mesh.scale.setScalar(1)
    particle.velocity.set(0, 0, 0)
    particle.age = particle.gravity = particle.growth = particle.spin = 0
    particle.life = life
    particle.opacity = opacity
    this.scene.add(mesh)
    this.active.push(particle)
    return particle
  }

  private newParticle(geometry: THREE.BufferGeometry): Particle {
    const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide })
    material.forceSinglePass = true
    return { mesh: new THREE.Mesh(geometry, material), velocity: new THREE.Vector3(),
      age: 0, life: 0, gravity: 0, growth: 0, opacity: 1, spin: 0 }
  }

  private scatter(p: Particle, angle: number, speed: number, gravity: number) {
    p.velocity.set(Math.cos(angle) * speed, (0.5 + Math.random()) * speed, Math.sin(angle) * speed)
    p.gravity = gravity
    p.mesh.rotation.set(angle, 0, angle * 2)
    p.spin = 3 + Math.random() * 5
  }

  spawnExplosion(x: number, y: number, z: number, radius: number, accentHex: Hex = ink.vermilion): void {
    if (this.disposed || !Number.isFinite(radius) || radius <= 0) return
    const dome = this.emit("dome", x, y, z, accentHex, 0.42, 0.30)
    dome.mesh.scale.setScalar(radius * 0.12)
    dome.growth = radius * 0.88
    const ring = this.emit("ring", x, y + 0.018, z, ink.ochre, 0.54, 0.9)
    ring.mesh.scale.setScalar(radius * 0.16)
    ring.growth = radius * 0.96
    const flash = this.emit("shard", x, y + radius * 0.09, z, ink.paperCard, 0.13)
    flash.mesh.scale.set(radius * 0.32, radius * 0.49, radius * 0.32)
    for (let i = 0; i < 8; i++) {
      const shard = this.emit("shard", x, y + radius * 0.12, z, i % 2 ? ink.ink : ink.ochre, 0.65 + Math.random() * 0.22)
      shard.mesh.scale.set(radius * 0.027, radius * 0.087, radius * 0.036)
      this.scatter(shard, (i + Math.random() * 0.5) * fullTurn / 8, radius * 1.3, radius * 4.2)
    }
  }

  spawnBarrelSpark(x: number, y: number, z: number): void {
    if (this.disposed) return
    this.spawnImpact(x, y, z, "metal")
    const smoke = this.emit("puff", x, y, z, ink.ink, 0.48, 0.32)
    smoke.mesh.scale.setScalar(0.055)
    smoke.growth = 0.12
    smoke.velocity.y = 0.36
  }

  spawnKnifeSlash(originX: number, originY: number, originZ: number, yaw: number, pitch: number, colorHex: Hex): void {
    if (this.disposed) return
    const arc = this.emit("slash", originX, originY, originZ, colorHex, 0.18, 0.83)
    arc.mesh.rotation.set(pitch, yaw, -0.68, "YXZ")
    arc.mesh.translateZ(-0.79)
    arc.mesh.translateY(-0.18)
    arc.mesh.scale.set(0.54, 0.32, 1)
    arc.spin = -2.8
  }

  spawnImpact(x: number, y: number, z: number, surface: Surface, headshot = false): void {
    if (this.disposed) return
    const style = impacts[surface]
    const count = headshot ? 9 : 5
    for (let i = 0; i < count; i++) {
      const dust = surface === "stone"
      const color = surface === "metal" && i % 2 ? ink.paperShadow : style.color
      const p = this.emit(dust ? "puff" : "shard", x, y, z, color, dust ? 0.46 : 0.3, dust ? 0.5 : 1)
      p.mesh.scale.set(...style.size as readonly [number, number, number])
      this.scatter(p, (i + Math.random()) * fullTurn / count, style.speed, dust ? 0.4 : 5.8)
      if (dust) p.growth = 0.06
    }
  }

  /** Advance by elapsed seconds. Expired meshes leave the scene immediately. */
  step(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i]!
      p.age += dt
      if (p.age >= p.life) {
        p.mesh.removeFromParent()
        this.active.splice(i, 1)
        if (this.free.length < 192) this.free.push(p)
        else p.mesh.material.dispose()
        continue
      }
      p.mesh.position.addScaledVector(p.velocity, dt)
      p.mesh.position.y -= 0.5 * p.gravity * dt * dt
      p.velocity.y -= p.gravity * dt
      p.mesh.rotation.z += p.spin * dt
      p.mesh.scale.addScalar(p.growth * dt / p.life)
      p.mesh.material.opacity = p.opacity * (1 - p.age / p.life)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const p of [...this.active, ...this.free]) {
      p.mesh.removeFromParent()
      p.mesh.material.dispose()
    }
    this.active.length = this.free.length = 0
    for (const geometry of Object.values(this.geometry)) geometry.dispose()
  }
}

export const SNIPER_SCOPE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" aria-hidden="true" pointer-events="none">
  <defs><radialGradient id="press-scope-glass">
    <stop offset="60%" stop-color="#222c27" stop-opacity="0"/>
    <stop offset="97%" stop-color="#222c27" stop-opacity=".19"/>
    <stop offset="100%" stop-color="#222c27" stop-opacity=".45"/>
  </radialGradient></defs>
  <svg width="100%" height="100%" viewBox="-250 -250 500 500" fill="none">
    <path d="M-10000 -10000H10000V10000H-10000Z M0 -236a236 236 0 1 0 0 472a236 236 0 1 0 0 -472Z" fill="#222c27" fill-opacity=".92" fill-rule="evenodd"/>
    <circle r="236" fill="url(#press-scope-glass)" stroke="#3d4943" stroke-width="3"/>
    <g stroke="#3d4943">
      <path d="M-235 0h230m10 0h230M0 -235v230m0 10v230"/>
      <path d="M-235 0h82m306 0h82M0 -235v82m0 306v82" stroke-width="3"/>
      <path d="M-90 -5v10m30 -9v8m30 -7v6M30 -3v6m30 -7v8m30 -9v10M-6 30h12m-16 20h20m-25 20h30m-36 20h42"/>
    </g>
    <circle r="1.7" fill="#b04a39"/>
    <path d="M-165 -143v-22h22m286 0h22v22m0 286v22h-22m-286 0h-22v-22" stroke="#c29b58" stroke-width="2"/>
  </svg>
</svg>`
