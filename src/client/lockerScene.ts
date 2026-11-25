import * as THREE from "three"
import type { ArmorId, CosmeticLoadout, CrewId, PrimaryGunId } from "../sim/index.ts"
import { createAvatarRig, type AvatarRig } from "./avatarBuilder.ts"
import { INKLINE_PALETTE, addInkEdges, createInkMaterial, disposeObject3D } from "./inkShader.ts"

/** Rotating 3D Inkline avatar preview inside the Locker & Loadout drawer */
export class LockerPreviewScene {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly pedestal: THREE.Mesh
  private rig: AvatarRig | null = null
  private rafId: number | null = null
  private angle = 0.55

  constructor(container: HTMLElement) {
    const w = Math.max(240, container.clientWidth || 300)
    const h = Math.max(260, container.clientHeight || 340)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(w, h)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    container.appendChild(this.renderer.domElement)

    this.scene.background = new THREE.Color(INKLINE_PALETTE.paperBg)
    this.camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 30)
    this.camera.position.set(0, 1.38, 3.35)
    this.camera.lookAt(0, 0.98, 0)

    this.scene.add(new THREE.HemisphereLight(0xfcfdf9, 0xd8ded3, 1.2))
    const sun = new THREE.DirectionalLight(0xffffff, 1.1)
    sun.position.set(3, 5, 4)
    this.scene.add(sun)

    this.pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.74, 0.82, 0.14, 18),
      createInkMaterial(INKLINE_PALETTE.paperShaded, { hatchStrength: 0.25 })
    )
    this.pedestal.position.y = -0.07
    addInkEdges(this.pedestal, 22)
    this.scene.add(this.pedestal)
  }

  public setOutfit(
    crew: CrewId,
    cosmetics: CosmeticLoadout,
    armor: ArmorId,
    primary: PrimaryGunId
  ): void {
    if (this.rig) {
      this.scene.remove(this.rig.root)
      disposeObject3D(this.rig.root)
      this.rig = null
    }
    this.rig = createAvatarRig(crew, cosmetics, armor, primary)
    this.rig.root.rotation.y = this.angle
    this.scene.add(this.rig.root)
  }

  public start(): void {
    if (this.rafId !== null) return
    let last = performance.now()
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      this.angle += dt * 0.72
      if (this.rig) {
        this.rig.root.rotation.y = this.angle
      }
      this.renderer.render(this.scene, this.camera)
      this.rafId = requestAnimationFrame(loop)
    }
    this.rafId = requestAnimationFrame(loop)
  }

  public stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  public dispose(): void {
    this.stop()
    if (this.rig) {
      this.scene.remove(this.rig.root)
      disposeObject3D(this.rig.root)
      this.rig = null
    }
    disposeObject3D(this.scene)
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
