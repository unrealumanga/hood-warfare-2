import { addYardDetails } from "./yardDetails.ts"
import * as THREE from "three"
import {
  ANOMALY_COURTYARD,
  ARMORS,
  CABLE_CAR_SPLINE,
  CREWS,
  EXTRACTION_EXIT,
  EXTRACTION_VAULT,
  FOUNDRY_CENTER,
  GRAPPLE_LEDGES,
  GUNS,
  MAP_BOXES,
  MURAL_ZONES,
  PLAYER_EYE_HEIGHT,
  SKETCH_ANCHORS,
  TICK_HZ,
  buildDynamicSolids,
  stepPlayerMovement,
  type FighterData,
  type GunId,
  type KinematicState,
  type MatchEventItem,
  type MatchSnapshot,
  type PlayerInput
} from "../sim/index.ts"
import {
  createAvatarRig,
  createViewmodelRig,
  type AvatarRig,
  type ViewmodelRig
} from "./avatarBuilder.ts"
import {
  INKLINE_PALETTE,
  addInkEdges,
  createGroundTexture,
  createInkMaterial,
  createMuralTexture,
  createShopSignTexture,
  disposeObject3D
} from "./inkShader.ts"

interface RemoteVisual {
  rig: AvatarRig
  displayX: number
  displayY: number
  displayZ: number
  displayYaw: number
  stridePhase: number
}

interface BurstFx {
  readonly mesh: THREE.Mesh
  life: number
  readonly maxLife: number
  readonly expandSpeed: number
}

export interface SketchPreviewVisual {
  readonly kind: "plank" | "barricade"
  readonly valid: boolean
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
  readonly minZ: number
  readonly maxZ: number
}

export interface WorldSceneCallbacks {
  readonly onEvent?: (ev: MatchEventItem, isLocalActor: boolean, isLocalTarget: boolean) => void
}

export class BellYardScene {
  private readonly container: HTMLElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly worldScene = new THREE.Scene()
  private readonly vmScene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly vmCamera: THREE.PerspectiveCamera

  private readonly remoteVisuals = new Map<number, RemoteVisual>()
  private readonly projectileMeshes = new Map<number, THREE.Mesh>()
  private readonly constructMeshes = new Map<number, THREE.Group>()
  private readonly propMeshes = new Map<number, THREE.Group>()
  private readonly scrapMeshes = new Map<number, THREE.Mesh>()
  private readonly burstFx: Array<BurstFx> = []
  private readonly muralMeshes: Array<{
    readonly mesh: THREE.Mesh
    owner: "neutral" | 0 | 1
  }> = []
  private readonly zoneRing: THREE.Group
  private readonly zoneRingMat: THREE.MeshBasicMaterial
  private readonly zoneBeaconMat: THREE.MeshBasicMaterial

  // Milestone 1-9 visual actors
  private readonly ghostGroup = new THREE.Group()
  private readonly smokeInstanced: THREE.InstancedMesh
  private readonly cableCarGroup = new THREE.Group()
  private readonly grappleLine: THREE.Line
  private readonly anomalyBorder: THREE.LineSegments
  private readonly foremanGroup = new THREE.Group()
  private readonly foremanShield: THREE.Mesh
  private readonly foremanWeakCore: THREE.Mesh
  private readonly extractionMarkers = new THREE.Group()
  private readonly foundrySiegeGroup = new THREE.Group()
  private readonly dummyObj = new THREE.Object3D()

  private viewmodel: ViewmodelRig | null = null
  private vmRecoil = 0
  private vmMuzzleTimer = 0
  private vmWalkPhase = 0
  private vmReloadProgress = 0

  // Local client prediction & server reconciliation state
  private predictedKin: KinematicState | null = null
  private pendingInputs: Array<PlayerInput> = []
  private lastAckedSeq = 0
  private smoothOffsetX = 0
  private smoothOffsetY = 0
  private smoothOffsetZ = 0

  // Shot event deduplication so predicted local muzzle/SFX never double-play
  private readonly playedShotEventIds = new Set<number>()
  private lastProcessedEventSeq = 0
  private lastRenderMs = 0
  private readonly abortCtrl = new AbortController()
  private readonly callbacks: WorldSceneCallbacks

  constructor(container: HTMLElement, callbacks: WorldSceneCallbacks = {}) {
    this.container = container
    this.callbacks = callbacks

    const w = Math.max(320, container.clientWidth || window.innerWidth)
    const h = Math.max(200, container.clientHeight || window.innerHeight)

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(w, h)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.autoClear = false
    container.appendChild(this.renderer.domElement)

    // Inkline high-key atmospheric sky paper backdrop
    this.worldScene.background = new THREE.Color(INKLINE_PALETTE.paperBg)
    this.worldScene.fog = new THREE.Fog(INKLINE_PALETTE.paperBg, 44, 118)

    this.camera = new THREE.PerspectiveCamera(78, w / h, 0.08, 160)
    this.camera.rotation.order = "YXZ"

    this.vmCamera = new THREE.PerspectiveCamera(62, w / h, 0.02, 12)

    this.setupLighting(this.worldScene)
    this.setupLighting(this.vmScene)
    this.buildBellYardGeometry()
    addYardDetails(this.worldScene)

    // Translucent active mural capture zone boundary ring & corner beacons
    this.zoneRing = new THREE.Group()
    this.zoneRingMat = new THREE.MeshBasicMaterial({
      color: INKLINE_PALETTE.cobalt,
      transparent: true,
      opacity: 0.38,
      side: THREE.DoubleSide
    })
    const ringMesh = new THREE.Mesh(new THREE.RingGeometry(4.35, 4.75, 48), this.zoneRingMat)
    ringMesh.rotation.x = -Math.PI / 2
    ringMesh.position.y = 0.06
    this.zoneRing.add(ringMesh)

    // Translucent vertical ink veil around active zone
    this.zoneBeaconMat = new THREE.MeshBasicMaterial({
      color: INKLINE_PALETTE.cobalt,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false
    })
    const veil = new THREE.Mesh(
      new THREE.CylinderGeometry(4.62, 4.62, 1.4, 36, 1, true),
      this.zoneBeaconMat
    )
    veil.position.y = 0.72
    this.zoneRing.add(veil)
    this.worldScene.add(this.zoneRing)

    // Milestone 1: Visible Sketch Anchor brackets + Ghost preview container
    this.buildMilestoneFixtures()
    this.ghostGroup.visible = false
    this.worldScene.add(this.ghostGroup)

    // Milestone 2: Pooled translucent Ink Smoke instanced puffs (up to 300 active voxels)
    const smokeGeo = new THREE.IcosahedronGeometry(0.62, 1)
    const smokeMat = new THREE.MeshBasicMaterial({
      color: 0x35403b,
      transparent: true,
      opacity: 0.56,
      depthWrite: false
    })
    this.smokeInstanced = new THREE.InstancedMesh(smokeGeo, smokeMat, 300)
    this.smokeInstanced.count = 0
    this.smokeInstanced.frustumCulled = false
    this.worldScene.add(this.smokeInstanced)

    // Milestone 3: Active Grapple Tether line
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(0, 1, 0)
    ])
    this.grappleLine = new THREE.Line(
      lineGeo,
      new THREE.LineBasicMaterial({ color: INKLINE_PALETTE.ochre })
    )
    this.grappleLine.visible = false
    this.grappleLine.frustumCulled = false
    this.worldScene.add(this.grappleLine)

    // Milestone 4: Shielded Printworks Foreman boss rig
    const fBody = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 2.1, 0.78),
      createInkMaterial(0x3a433f, { hatchStrength: 0.35 })
    )
    fBody.position.y = 1.05
    fBody.castShadow = true
    addInkEdges(fBody, 22)
    this.foremanGroup.add(fBody)

    this.foremanShield = new THREE.Mesh(
      new THREE.BoxGeometry(1.38, 1.75, 0.16),
      createInkMaterial(INKLINE_PALETTE.ochre, { hatchStrength: 0.25 })
    )
    this.foremanShield.position.set(0, 1.15, -0.56)
    addInkEdges(this.foremanShield, 20)
    this.foremanGroup.add(this.foremanShield)

    this.foremanWeakCore = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.32, 0),
      new THREE.MeshBasicMaterial({ color: INKLINE_PALETTE.vermilion })
    )
    this.foremanWeakCore.position.set(0, 1.32, 0.52)
    this.foremanGroup.add(this.foremanWeakCore)
    this.foremanGroup.visible = false
    this.worldScene.add(this.foremanGroup)

    // Milestone 7: Low-Gravity Courtyard Anomaly glowing perimeter frame
    const aW = ANOMALY_COURTYARD.maxX - ANOMALY_COURTYARD.minX
    const aD = ANOMALY_COURTYARD.maxZ - ANOMALY_COURTYARD.minZ
    this.anomalyBorder = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(aW, 0.3, aD)),
      new THREE.LineBasicMaterial({ color: 0x3b72c4, transparent: true, opacity: 0.85 })
    )
    this.anomalyBorder.position.set(0, 0.18, 0)
    this.anomalyBorder.visible = false
    this.worldScene.add(this.anomalyBorder)

    // Milestone 8: Overhead Cable Car platform + steel rail cable
    const cableGeo = new THREE.BufferGeometry()
    const cablePts: Array<THREE.Vector3> = []
    for (let i = 0; i <= 24; i++) {
      const t = i / 24
      const cx = CABLE_CAR_SPLINE.startX + (CABLE_CAR_SPLINE.endX - CABLE_CAR_SPLINE.startX) * t
      const cy = CABLE_CAR_SPLINE.baseY + Math.sin(Math.PI * t) * CABLE_CAR_SPLINE.archY + 2.35
      cablePts.push(new THREE.Vector3(cx, cy, CABLE_CAR_SPLINE.z))
    }
    cableGeo.setFromPoints(cablePts)
    this.worldScene.add(
      new THREE.Line(cableGeo, new THREE.LineBasicMaterial({ color: INKLINE_PALETTE.inkDark }))
    )

    const carDeck = new THREE.Mesh(
      new THREE.BoxGeometry(
        CABLE_CAR_SPLINE.halfW * 2,
        CABLE_CAR_SPLINE.thickness,
        CABLE_CAR_SPLINE.halfD * 2
      ),
      createInkMaterial(INKLINE_PALETTE.ochre, { hatchStrength: 0.26 })
    )
    carDeck.position.y = -CABLE_CAR_SPLINE.thickness * 0.5
    carDeck.castShadow = true
    addInkEdges(carDeck, 22)
    this.cableCarGroup.add(carDeck)

    const hangerMat = createInkMaterial(0x3a443f, { hatchStrength: 0.2 })
    for (const sx of [-1.25, 1.25]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.35, 0.12), hangerMat)
      strut.position.set(sx, 1.15, 0)
      addInkEdges(strut, 24)
      this.cableCarGroup.add(strut)
    }
    const carTopBar = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.18, 0.22), hangerMat)
    carTopBar.position.set(0, 2.32, 0)
    addInkEdges(carTopBar, 24)
    this.cableCarGroup.add(carTopBar)
    this.worldScene.add(this.cableCarGroup)

    // Milestone 5 & 9: Extraction Vault/Exit beacons & Foundry Colossus Press frame
    const vaultBeacon = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.1, 0.14, 16),
      new THREE.MeshBasicMaterial({ color: INKLINE_PALETTE.ochre, transparent: true, opacity: 0.55 })
    )
    vaultBeacon.position.set(EXTRACTION_VAULT.x, EXTRACTION_VAULT.y + 0.08, EXTRACTION_VAULT.z)
    this.extractionMarkers.add(vaultBeacon)
    const exitBeacon = new THREE.Mesh(
      new THREE.CylinderGeometry(1.8, 1.8, 0.14, 20),
      new THREE.MeshBasicMaterial({ color: INKLINE_PALETTE.cobalt, transparent: true, opacity: 0.5 })
    )
    exitBeacon.position.set(EXTRACTION_EXIT.x, EXTRACTION_EXIT.y + 0.08, EXTRACTION_EXIT.z)
    this.extractionMarkers.add(exitBeacon)
    this.extractionMarkers.visible = false
    this.worldScene.add(this.extractionMarkers)

    const pressBase = new THREE.Mesh(
      new THREE.BoxGeometry(2.1, 1.6, 2.1),
      createInkMaterial(0x4b5650, { hatchStrength: 0.3 })
    )
    pressBase.position.set(FOUNDRY_CENTER.x, 0.8, FOUNDRY_CENTER.z)
    addInkEdges(pressBase, 22)
    this.foundrySiegeGroup.add(pressBase)
    this.foundrySiegeGroup.visible = false
    this.worldScene.add(this.foundrySiegeGroup)

    window.addEventListener("resize", this.handleResize, { signal: this.abortCtrl.signal })
    this.lastRenderMs = performance.now()
  }

  private buildMilestoneFixtures(): void {
    // Sketch anchor posts (distinct ink-blue brass eyelets at alley gap ends)
    const postMat = createInkMaterial(INKLINE_PALETTE.cobalt, { hatchStrength: 0.22 })
    const capMat = createInkMaterial(INKLINE_PALETTE.ochre, { hatchStrength: 0.2 })
    for (const anchor of SKETCH_ANCHORS) {
      for (const [x, y, z] of [
        [anchor.ax, anchor.ay, anchor.az],
        [anchor.bx, anchor.by, anchor.bz]
      ] as const) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.62, 0.32), postMat)
        post.position.set(x, y + 0.31, z)
        addInkEdges(post, 22)
        this.worldScene.add(post)
        const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), capMat)
        cap.position.set(x, y + 0.76, z)
        this.worldScene.add(cap)
      }
    }

    // Marked grapple ledge brackets (aged brass rings along ledges)
    const hookMat = createInkMaterial(INKLINE_PALETTE.ochre, { hatchStrength: 0.2 })
    for (const ledge of GRAPPLE_LEDGES) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.06, 6, 12), hookMat)
      ring.position.set(ledge.x, ledge.y, ledge.z)
      this.worldScene.add(ring)
    }
  }

  public setSketchPreview(preview: SketchPreviewVisual | null): void {
    while (this.ghostGroup.children.length > 0) {
      const child = this.ghostGroup.children[0]!
      this.ghostGroup.remove(child)
      disposeObject3D(child)
    }
    if (!preview) {
      this.ghostGroup.visible = false
      return
    }
    const sx = preview.maxX - preview.minX
    const sy = preview.maxY - preview.minY
    const sz = preview.maxZ - preview.minZ
    const cx = (preview.minX + preview.maxX) * 0.5
    const cy = (preview.minY + preview.maxY) * 0.5
    const cz = (preview.minZ + preview.maxZ) * 0.5

    // Distinguish valid placement by BOTH shape (filled plank + solid rails vs X-cross wireframe) AND color!
    const color = preview.valid ? INKLINE_PALETTE.cobalt : INKLINE_PALETTE.vermilion
    const boxGeo = new THREE.BoxGeometry(sx, sy, sz)
    const fillMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: preview.valid ? 0.34 : 0.14,
      wireframe: !preview.valid
    })
    const mesh = new THREE.Mesh(boxGeo, fillMat)
    mesh.position.set(cx, cy, cz)
    addInkEdges(mesh, 15, color)
    this.ghostGroup.add(mesh)
    this.ghostGroup.visible = true
  }

  private setupLighting(scene: THREE.Scene): void {
    // High-key drafting illumination so #f0f2ec paper stays bright and crisp
    const hemi = new THREE.HemisphereLight(0xfcfdf9, 0xd8ded3, 1.15)
    scene.add(hemi)

    const sun = new THREE.DirectionalLight(0xffffff, 1.1)
    sun.position.set(22, 36, 18)
    if (scene === this.worldScene) {
      sun.castShadow = true
      sun.shadow.mapSize.set(2048, 2048)
      sun.shadow.camera.left = -36
      sun.shadow.camera.right = 36
      sun.shadow.camera.top = 30
      sun.shadow.camera.bottom = -30
      sun.shadow.camera.near = 6
      sun.shadow.camera.far = 90
      sun.shadow.bias = -0.0008
    }
    scene.add(sun)

    const fill = new THREE.DirectionalLight(0xeef3f8, 0.35)
    fill.position.set(-18, 16, -20)
    scene.add(fill)
  }

  private buildBellYardGeometry(): void {
    const groundTex = createGroundTexture()
    const accentColors: Record<string, number> = {
      paper: INKLINE_PALETTE.paperCard,
      shaded: INKLINE_PALETTE.paperShaded,
      brick: INKLINE_PALETTE.brick,
      cobalt: INKLINE_PALETTE.cobalt,
      dark: 0x56625c,
      ochre: INKLINE_PALETTE.ochre
    }

    for (const box of MAP_BOXES) {
      const sx = box.maxX - box.minX
      const sy = box.maxY - box.minY
      const sz = box.maxZ - box.minZ
      const cx = (box.minX + box.maxX) * 0.5
      const cy = (box.minY + box.maxY) * 0.5
      const cz = (box.minZ + box.maxZ) * 0.5

      const baseColor = accentColors[box.accent ?? "paper"] ?? INKLINE_PALETTE.paperCard
      const mat =
        box.kind === "ground"
          ? createInkMaterial(0xffffff, { map: groundTex, hatchStrength: 0.14, halftone: false })
          : createInkMaterial(baseColor, {
              hatchStrength: box.kind === "building" ? 0.24 : 0.28,
              halftone: box.kind === "building" || box.kind === "tram"
            })

      let mesh: THREE.Mesh
      if (box.kind === "tank") {
        // Cylindrical rooftop water tank on ink-drawn stilts
        const radius = Math.min(sx, sz) * 0.48
        const cyl = new THREE.CylinderGeometry(radius, radius, sy * 0.72, 14)
        mesh = new THREE.Mesh(cyl, mat)
        mesh.position.set(cx, box.minY + sy * 0.64, cz)
        mesh.castShadow = true
        addInkEdges(mesh, 26)
        this.worldScene.add(mesh)

        // Conical cap + 4 legs
        const cap = new THREE.Mesh(
          new THREE.ConeGeometry(radius * 1.05, sy * 0.24, 14),
          createInkMaterial(INKLINE_PALETTE.ink, { hatchStrength: 0.2 })
        )
        cap.position.set(cx, box.maxY + sy * 0.08, cz)
        addInkEdges(cap, 26)
        this.worldScene.add(cap)

        const legMat = createInkMaterial(0x404b46, { hatchStrength: 0.2 })
        for (const [lx, lz] of [
          [-radius * 0.6, -radius * 0.6],
          [radius * 0.6, -radius * 0.6],
          [-radius * 0.6, radius * 0.6],
          [radius * 0.6, radius * 0.6]
        ] as const) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, sy * 0.34, 0.22), legMat)
          leg.position.set(cx + lx, box.minY + sy * 0.17, cz + lz)
          addInkEdges(leg, 24)
          this.worldScene.add(leg)
        }
        continue
      }

      mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat)
      mesh.position.set(cx, cy, cz)
      mesh.receiveShadow = true
      if (box.kind !== "ground") {
        mesh.castShadow = true
        addInkEdges(mesh, 20)
      }
      this.worldScene.add(mesh)

      // Architectural windows on printworks buildings
      if (box.kind === "building") {
        this.addBuildingWindows(box, cx, cz, sx, sy, sz)
      }

      // Vintage Bell Yard Tram Car details (windows, headlamp, roof rails)
      if (box.kind === "tram") {
        const winMat = createInkMaterial(0xdbe6f0, { hatchStrength: 0.12 })
        for (let wx = box.minX + 1.1; wx <= box.maxX - 1.1; wx += 1.8) {
          const win = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.82, sz + 0.06), winMat)
          win.position.set(wx, cy + 0.32, cz)
          addInkEdges(win, 24)
          this.worldScene.add(win)
        }
        // Steel tram tracks embedded in Bell Yard south street
        const railMat = new THREE.MeshBasicMaterial({ color: INKLINE_PALETTE.inkDark })
        for (const rz of [18.5, 19.6]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(52, 0.04, 0.09), railMat)
          rail.position.set(0, 0.02, rz)
          this.worldScene.add(rail)
        }
      }

      // Original Inkline Printworks Shop Signboards (placed cleanly clear of windows & murals!)
      if (box.signText && box.signFace) {
        const signTex = createShopSignTexture(
          box.signText,
          box.accent === "ochre" ? "#b04a39" : "#2f5a9c"
        )
        const signMat = new THREE.MeshBasicMaterial({ map: signTex })
        const isTram = box.kind === "tram"
        const isTallHall = box.kind === "building" && sy >= 10
        const signW = isTram
          ? 4.4
          : Math.min(8.4, (box.signFace === "+z" || box.signFace === "-z" ? sx : sz) * 0.72)
        const signH = isTram ? 0.48 : signW * 0.24
        const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(signW, signH), signMat)
        const signY = isTram
          ? box.maxY - 0.26
          : isTallHall
            ? box.maxY - 1.35
            : Math.min(box.maxY - signH * 0.65, 5.0)

        if (box.signFace === "+z") {
          signMesh.position.set(cx, signY, box.maxZ + 0.14)
        } else if (box.signFace === "-z") {
          signMesh.position.set(cx, signY, box.minZ - 0.14)
          signMesh.rotation.y = Math.PI
        } else if (box.signFace === "+x") {
          signMesh.position.set(box.maxX + 0.14, signY, cz)
          signMesh.rotation.y = Math.PI / 2
        } else {
          signMesh.position.set(box.minX - 0.14, signY, cz)
          signMesh.rotation.y = -Math.PI / 2
        }
        this.worldScene.add(signMesh)
      }
    }

    // Build the 3 Screen-Printed Mural Walls (Courtyard, Tram Shelter, Upper Loading Deck)
    for (const z of MURAL_ZONES) {
      const tex = createMuralTexture(z.shortName, "neutral")
      const mat = new THREE.MeshBasicMaterial({ map: tex })
      const isTramMural = z.id === 1
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(isTramMural ? 4.4 : 5.6, isTramMural ? 1.75 : 2.2),
        mat
      )
      mesh.position.set(z.wallX, isTramMural ? 1.38 : z.wallY, isTramMural ? z.wallZ - 0.08 : z.wallZ)
      if (z.wallFacing === "-z") mesh.rotation.y = Math.PI
      else if (z.wallFacing === "+x") mesh.rotation.y = Math.PI / 2
      else if (z.wallFacing === "-x") mesh.rotation.y = -Math.PI / 2
      this.worldScene.add(mesh)
      this.muralMeshes.push({ mesh, owner: "neutral" })
    }
  }

  private addBuildingWindows(
    box: (typeof MAP_BOXES)[number],
    cx: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number
  ): void {
    const winMat = createInkMaterial(0xdde4e8, { hatchStrength: 0.15 })
    const rows = Math.min(2, Math.floor((sy - 2.5) / 2.8))
    if (rows <= 0) return

    // Put inked window rows facing toward the courtyard
    const faceZ = Math.abs(box.maxZ) < Math.abs(box.minZ) ? box.maxZ + 0.04 : box.minZ - 0.04
    const faceX = Math.abs(box.maxX) < Math.abs(box.minX) ? box.maxX + 0.04 : box.minX - 0.04

    if (sx >= sz) {
      const cols = Math.min(10, Math.floor((sx - 4) / 4.2))
      for (let r = 0; r < rows; r++) {
        const wy = 2.6 + r * 2.8
        if (wy > sy - 1.4) continue
        for (let c = 0; c < cols; c++) {
          const wx = cx - ((cols - 1) * 4.2) * 0.5 + c * 4.2
          const pane = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 0.08), winMat)
          pane.position.set(wx, wy, faceZ)
          addInkEdges(pane, 24)
          this.worldScene.add(pane)
        }
      }
    } else {
      const cols = Math.min(8, Math.floor((sz - 4) / 4.2))
      for (let r = 0; r < rows; r++) {
        const wy = 2.6 + r * 2.8
        if (wy > sy - 1.4) continue
        for (let c = 0; c < cols; c++) {
          const wz = cz - ((cols - 1) * 4.2) * 0.5 + c * 4.2
          const pane = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.5, 1.5), winMat)
          pane.position.set(faceX, wy, wz)
          addInkEdges(pane, 24)
          this.worldScene.add(pane)
        }
      }
    }
  }

  /** Project a world point to canvas pixel coordinates (for DOM overlays such as damage numbers). */
  public projectToScreen(x: number, y: number, z: number): { readonly x: number; readonly y: number; readonly visible: boolean } {
    const v = new THREE.Vector3(x, y, z).project(this.camera)
    const el = this.renderer.domElement
    return {
      x: ((v.x + 1) / 2) * el.clientWidth,
      y: ((1 - v.y) / 2) * el.clientHeight,
      visible: v.z > -1 && v.z < 1
    }
  }

  public resetMatchState(): void {
    this.predictedKin = null
    this.pendingInputs = []
    this.lastAckedSeq = 0
    this.smoothOffsetX = 0
    this.smoothOffsetY = 0
    this.smoothOffsetZ = 0
    this.playedShotEventIds.clear()
    this.lastProcessedEventSeq = 0

    for (const rv of this.remoteVisuals.values()) {
      this.worldScene.remove(rv.rig.root)
      disposeObject3D(rv.rig.root)
    }
    this.remoteVisuals.clear()

    for (const m of this.projectileMeshes.values()) {
      this.worldScene.remove(m)
      disposeObject3D(m)
    }
    this.projectileMeshes.clear()
  }

  /** Step local client movement prediction immediately upon sampling input */
  public predictLocalInput(
    input: PlayerInput,
    localFighter: FighterData | undefined,
    isOnline: boolean,
    snapshot: MatchSnapshot | null = null
  ): void {
    if (!localFighter || !localFighter.alive) {
      this.predictedKin = null
      this.pendingInputs = []
      return
    }
    if (!isOnline) {
      this.predictedKin = null
      return
    }

    if (this.predictedKin === null) {
      this.predictedKin = {
        x: localFighter.x,
        y: localFighter.y,
        z: localFighter.z,
        vx: localFighter.vx,
        vy: localFighter.vy,
        vz: localFighter.vz,
        grounded: localFighter.grounded
      }
    }

    const speedMult = ARMORS[localFighter.armorType].speedMultiplier
    const extraSolids = snapshot ? buildDynamicSolids(snapshot.constructs, snapshot.cableCar) : []
    this.predictedKin = stepPlayerMovement(
      this.predictedKin,
      {
        moveForward: input.moveForward,
        moveRight: input.moveRight,
        yaw: input.yaw,
        jump: input.jump
      },
      speedMult,
      1 / TICK_HZ,
      { extraSolids, anomalyActive: snapshot?.anomalyActive ?? false }
    )
    this.pendingInputs.push(input)
    if (this.pendingInputs.length > 90) {
      this.pendingInputs.shift()
    }
  }

  /** Reconcile local predicted kinematics when an authoritative server snapshot arrives */
  public reconcileSnapshot(snapshot: MatchSnapshot, localSlotId: number, isOnline: boolean): void {
    const local = snapshot.fighters.find((f) => f.slotId === localSlotId)
    if (!local || !local.alive) {
      this.predictedKin = null
      this.pendingInputs = []
      this.lastAckedSeq = local?.lastInputSeq ?? 0
      return
    }
    if (!isOnline) {
      this.predictedKin = null
      return
    }

    const prevPred = this.predictedKin
    this.lastAckedSeq = Math.max(this.lastAckedSeq, local.lastInputSeq)
    this.pendingInputs = this.pendingInputs.filter((inp) => inp.seq > this.lastAckedSeq)

    let state: KinematicState = {
      x: local.x,
      y: local.y,
      z: local.z,
      vx: local.vx,
      vy: local.vy,
      vz: local.vz,
      grounded: local.grounded
    }
    const speedMult = ARMORS[local.armorType].speedMultiplier
    const extraSolids = buildDynamicSolids(snapshot.constructs, snapshot.cableCar)
    for (const inp of this.pendingInputs) {
      state = stepPlayerMovement(
        state,
        {
          moveForward: inp.moveForward,
          moveRight: inp.moveRight,
          yaw: inp.yaw,
          jump: inp.jump
        },
        speedMult,
        1 / TICK_HZ,
        { extraSolids, anomalyActive: snapshot.anomalyActive }
      )
    }

    if (prevPred !== null) {
      const dx = prevPred.x - state.x
      const dy = prevPred.y - state.y
      const dz = prevPred.z - state.z
      const errSq = dx * dx + dy * dy + dz * dz
      if (errSq < 3.2) {
        this.smoothOffsetX = dx
        this.smoothOffsetY = dy
        this.smoothOffsetZ = dz
      } else {
        this.smoothOffsetX = 0
        this.smoothOffsetY = 0
        this.smoothOffsetZ = 0
      }
    }
    this.predictedKin = state
  }

  /** Trigger predicted local weapon recoil + muzzle flash once and register its shotEventId */
  public triggerPredictedShot(shotEventId: number, gunId: GunId): void {
    this.playedShotEventIds.add(shotEventId)
    if (this.playedShotEventIds.size > 256) {
      const first = this.playedShotEventIds.values().next().value
      if (first !== undefined) this.playedShotEventIds.delete(first)
    }
    this.vmRecoil = gunId === "broadside" ? 1.0 : gunId === "linecaster" ? 0.9 : gunId === "proofPistol" ? 0.58 : 0.36
    this.vmMuzzleTimer = gunId === "linecaster" ? 0.09 : 0.055
  }

  /** Update & render Bell Yard 3D FPS frame */
  public getRenderStats(): { readonly drawCalls: number; readonly triangles: number } {
    return {
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles
    }
  }

  public renderFrame(
    snapshot: MatchSnapshot | null,
    localSlotId: number,
    localYaw: number,
    localPitch: number
  ): void {
    const now = performance.now()
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastRenderMs) / 1000))
    this.lastRenderMs = now

    if (snapshot) {
      this.processEvents(snapshot, localSlotId)
      this.syncActiveMural(snapshot, now)
      this.syncMilestoneActors(snapshot, localSlotId, now)
      this.syncFighters(snapshot, localSlotId, localYaw, localPitch, dt)
      this.syncProjectiles(snapshot)
    } else {
      // Title-screen atmospheric courtyard overview orbit
      const t = now * 0.00018
      this.camera.position.set(Math.sin(t) * 18, 9.2, Math.cos(t) * 17)
      this.camera.lookAt(0, 2.2, -2)
      if (this.viewmodel) this.viewmodel.root.visible = false
    }

    this.stepBurstFx(dt)

    this.renderer.clear()
    this.renderer.render(this.worldScene, this.camera)
    if (this.viewmodel && this.viewmodel.root.visible) {
      this.renderer.clearDepth()
      this.renderer.render(this.vmScene, this.vmCamera)
    }
  }

  private processEvents(snapshot: MatchSnapshot, localSlotId: number): void {
    for (const ev of snapshot.events) {
      if (ev.seq <= this.lastProcessedEventSeq) continue
      this.lastProcessedEventSeq = ev.seq

      const isLocalActor = ev.actorSlot === localSlotId
      const isLocalTarget = ev.targetSlot === localSlotId

      if (ev.kind === "shot") {
        // Deduplicate predicted shots using shotEventId!
        if (ev.shotEventId > 0 && this.playedShotEventIds.has(ev.shotEventId)) {
          continue
        }
        if (ev.shotEventId > 0) this.playedShotEventIds.add(ev.shotEventId)
        if (isLocalActor && ev.gunId) {
          this.vmRecoil =
            ev.gunId === "broadside" ? 1.0 : ev.gunId === "linecaster" ? 0.9 : ev.gunId === "proofPistol" ? 0.55 : 0.34
          this.vmMuzzleTimer = 0.06
        }
      } else if (ev.kind === "hit") {
        this.spawnBurst(ev.x, ev.y, ev.z, INKLINE_PALETTE.inkDark, 0.24, 0.22)
      } else if (ev.kind === "armorBreak") {
        this.spawnBurst(ev.x, ev.y, ev.z, 0x3b72c4, 0.55, 0.36)
      } else if (ev.kind === "elim") {
        this.spawnBurst(ev.x, ev.y, ev.z, INKLINE_PALETTE.vermilion, 0.72, 0.48)
      }

      this.callbacks.onEvent?.(ev, isLocalActor, isLocalTarget)
    }
  }

  private spawnBurst(
    x: number,
    y: number,
    z: number,
    color: number,
    size: number,
    duration: number
  ): void {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.78,
      depthWrite: false
    })
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(size, 0), mat)
    mesh.position.set(x, y, z)
    this.worldScene.add(mesh)
    this.burstFx.push({
      mesh,
      life: duration,
      maxLife: duration,
      expandSpeed: 2.8
    })
  }

  private stepBurstFx(dt: number): void {
    for (let i = this.burstFx.length - 1; i >= 0; i--) {
      const fx = this.burstFx[i]!
      fx.life -= dt
      if (fx.life <= 0) {
        this.worldScene.remove(fx.mesh)
        fx.mesh.geometry.dispose()
        ;(fx.mesh.material as THREE.Material).dispose()
        this.burstFx.splice(i, 1)
      } else {
        const p = 1 - fx.life / fx.maxLife
        fx.mesh.scale.setScalar(1 + p * fx.expandSpeed)
        fx.mesh.rotation.y += dt * 4
        ;(fx.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - p) * 0.72
      }
    }
  }

  private syncMilestoneActors(snapshot: MatchSnapshot, localSlotId: number, nowMs: number): void {
    // 1. Sketch Planks & Waist-High Barricades (distinct inked paper-and-crew-trim style)
    const activeConstructIds = new Set<number>()
    for (const c of snapshot.constructs) {
      activeConstructIds.add(c.id)
      if (!this.constructMeshes.has(c.id)) {
        const grp = new THREE.Group()
        const sx = c.maxX - c.minX
        const sy = c.maxY - c.minY
        const sz = c.maxZ - c.minZ
        const cx = (c.minX + c.maxX) * 0.5
        const cy = (c.minY + c.maxY) * 0.5
        const cz = (c.minZ + c.maxZ) * 0.5
        const mat = createInkMaterial(c.crew === 0 ? CREWS[0].washHex : CREWS[1].washHex, {
          hatchStrength: 0.34
        })
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat)
        mesh.position.set(cx, cy, cz)
        mesh.castShadow = true
        mesh.receiveShadow = true
        addInkEdges(mesh, 18, c.crew === 0 ? INKLINE_PALETTE.cobalt : INKLINE_PALETTE.vermilion)
        grp.add(mesh)
        this.worldScene.add(grp)
        this.constructMeshes.set(c.id, grp)
      }
    }
    for (const [id, grp] of this.constructMeshes.entries()) {
      if (!activeConstructIds.has(id)) {
        this.worldScene.remove(grp)
        disposeObject3D(grp)
        this.constructMeshes.delete(id)
      }
    }

    // 2. Pooled Ink Smoke Voxel Grid (only dense cells with clearedTicks === 0 render!)
    let smokeCount = 0
    for (const cl of snapshot.smokeClouds) {
      const halfX = cl.nx * cl.cellSize * 0.5
      const halfY = cl.ny * cl.cellSize * 0.5
      const halfZ = cl.nz * cl.cellSize * 0.5
      for (let iy = 0; iy < cl.ny; iy++) {
        for (let iz = 0; iz < cl.nz; iz++) {
          for (let ix = 0; ix < cl.nx; ix++) {
            if (smokeCount >= 300) break
            const idx = (iy * cl.nz + iz) * cl.nx + ix
            if ((cl.clearedTicks[idx] ?? 0) > 0) continue
            const px = cl.cx - halfX + (ix + 0.5) * cl.cellSize
            const py = cl.cy - halfY + (iy + 0.5) * cl.cellSize
            const pz = cl.cz - halfZ + (iz + 0.5) * cl.cellSize
            this.dummyObj.position.set(px, py + Math.sin(nowMs * 0.002 + idx) * 0.06, pz)
            this.dummyObj.rotation.set(0, nowMs * 0.0004 + idx, 0)
            this.dummyObj.scale.setScalar(1.0)
            this.dummyObj.updateMatrix()
            this.smokeInstanced.setMatrixAt(smokeCount++, this.dummyObj.matrix)
          }
        }
      }
    }
    this.smokeInstanced.count = smokeCount
    this.smokeInstanced.instanceMatrix.needsUpdate = true

    // 3. Movable Explosive Press Barrels + Active Grapple Tether
    for (const prop of snapshot.props) {
      let grp = this.propMeshes.get(prop.id)
      if (!grp) {
        grp = new THREE.Group()
        const body = new THREE.Mesh(
          new THREE.CylinderGeometry(0.42, 0.42, 1.0, 12),
          createInkMaterial(INKLINE_PALETTE.vermilion, { hatchStrength: 0.28 })
        )
        body.position.y = 0.5
        body.castShadow = true
        addInkEdges(body, 22)
        grp.add(body)
        const band = new THREE.Mesh(
          new THREE.CylinderGeometry(0.44, 0.44, 0.14, 12),
          createInkMaterial(INKLINE_PALETTE.ochre, { hatchStrength: 0.2 })
        )
        band.position.y = 0.5
        grp.add(band)
        this.worldScene.add(grp)
        this.propMeshes.set(prop.id, grp)
      }
      grp.visible = !prop.exploded
      grp.position.set(prop.x, prop.y, prop.z)
    }

    const me = snapshot.fighters.find((f) => f.slotId === localSlotId)
    if (me && me.alive && me.grapple) {
      const posAttr = this.grappleLine.geometry.getAttribute("position") as THREE.BufferAttribute
      posAttr.setXYZ(0, me.x, me.y + 1.25, me.z)
      posAttr.setXYZ(1, me.grapple.tx, me.grapple.ty, me.grapple.tz)
      posAttr.needsUpdate = true
      this.grappleLine.visible = true
    } else {
      this.grappleLine.visible = false
    }

    // 4. Overhead Cable Car
    this.cableCarGroup.position.set(snapshot.cableCar.x, snapshot.cableCar.y, snapshot.cableCar.z)

    // 5. Low-Gravity Courtyard Anomaly
    this.anomalyBorder.visible = snapshot.anomalyEnabled
    if (snapshot.anomalyEnabled) {
      const mat = this.anomalyBorder.material as THREE.LineBasicMaterial
      mat.color.setHex(snapshot.anomalyActive ? 0x2f5a9c : 0xb38436)
      this.anomalyBorder.position.y = snapshot.anomalyActive ? 0.22 + Math.sin(nowMs * 0.006) * 0.1 : 0.16
    }

    // 6. Shielded Printworks Foreman (Elite Duel)
    if (snapshot.foreman && snapshot.foreman.state !== "defeated") {
      this.foremanGroup.visible = true
      this.foremanGroup.position.set(snapshot.foreman.x, snapshot.foreman.y, snapshot.foreman.z)
      this.foremanGroup.rotation.y = snapshot.foreman.yaw
      // Telegraph windup (shield raised high!), stagger (shield dropped wide!)
      if (snapshot.foreman.state === "windup") {
        this.foremanShield.position.set(0, 1.85, -0.56)
        this.foremanShield.rotation.x = -0.45
      } else if (snapshot.foreman.state === "staggered") {
        this.foremanShield.position.set(0.75, 0.9, -0.35)
        this.foremanShield.rotation.x = 0.25
      } else {
        this.foremanShield.position.set(0, 1.15, -0.56)
        this.foremanShield.rotation.x = 0
      }
      this.foremanWeakCore.rotation.y = nowMs * 0.005
    } else {
      this.foremanGroup.visible = false
    }

    // 7. Extraction & Foundry markers
    this.extractionMarkers.visible = snapshot.mode === "extraction"
    this.foundrySiegeGroup.visible = snapshot.mode === "foundry"
    if (snapshot.foundry) {
      const totalDep = Math.max(snapshot.foundry.deposited[0], snapshot.foundry.deposited[1])
      this.foundrySiegeGroup.scale.set(1, 0.6 + (totalDep / snapshot.foundry.targetScrap) * 1.4, 1)
      for (const pile of snapshot.foundry.piles) {
        let m = this.scrapMeshes.get(pile.id)
        if (!m) {
          m = new THREE.Mesh(
            new THREE.OctahedronGeometry(0.42, 0),
            createInkMaterial(INKLINE_PALETTE.ochre, { hatchStrength: 0.22 })
          )
          addInkEdges(m, 20)
          this.worldScene.add(m)
          this.scrapMeshes.set(pile.id, m)
        }
        m.visible = pile.available
        m.position.set(pile.x, pile.y + 0.45 + Math.sin(nowMs * 0.004 + pile.id) * 0.08, pile.z)
        m.rotation.y = nowMs * 0.002 + pile.id
      }
    } else {
      for (const m of this.scrapMeshes.values()) m.visible = false
    }
  }

  private syncActiveMural(snapshot: MatchSnapshot, nowMs: number): void {
    this.zoneRing.visible = snapshot.mode === "mural"
    const zone = MURAL_ZONES[snapshot.activeMuralId]!
    this.zoneRing.position.set(zone.x, zone.y, zone.z)
    this.zoneRing.rotation.y = nowMs * 0.0005

    let ringHex: number = INKLINE_PALETTE.ink
    let owner: "neutral" | 0 | 1 = "neutral"
    if (snapshot.zoneStatus === "cobalt") {
      ringHex = INKLINE_PALETTE.cobalt
      owner = 0
    } else if (snapshot.zoneStatus === "vermilion") {
      ringHex = INKLINE_PALETTE.vermilion
      owner = 1
    } else if (snapshot.zoneStatus === "contested") {
      ringHex = INKLINE_PALETTE.ochre
    }
    this.zoneRingMat.color.setHex(ringHex)
    this.zoneBeaconMat.color.setHex(ringHex)

    // Update active mural wall print emblem dynamically when crew holds it
    const entry = this.muralMeshes[snapshot.activeMuralId]
    if (entry && entry.owner !== owner) {
      entry.owner = owner
      const mat = entry.mesh.material as THREE.MeshBasicMaterial
      mat.map?.dispose()
      mat.map = createMuralTexture(zone.shortName, owner)
      mat.needsUpdate = true
    }
  }

  private syncFighters(
    snapshot: MatchSnapshot,
    localSlotId: number,
    localYaw: number,
    localPitch: number,
    dt: number
  ): void {
    const activeSlots = new Set<number>()

    for (const f of snapshot.fighters) {
      activeSlots.add(f.slotId)
      const gunId: GunId = f.activeSlot === 1 ? f.primaryGun : "proofPistol"

      if (f.slotId === localSlotId) {
        // Decay reconciliation smoothing offset
        const decay = Math.exp(-16 * dt)
        this.smoothOffsetX *= decay
        this.smoothOffsetY *= decay
        this.smoothOffsetZ *= decay

        if (f.alive) {
          const base = this.predictedKin ?? f
          this.camera.position.set(
            base.x + this.smoothOffsetX,
            base.y + this.smoothOffsetY + PLAYER_EYE_HEIGHT,
            base.z + this.smoothOffsetZ
          )
          this.camera.rotation.y = localYaw
          this.camera.rotation.x = localPitch

          // Sync 1st-person viewmodel (gloved hands, outfit sleeves, active gun)
          const vmKey = `${f.crew}:${f.cosmetics.top}:${f.cosmetics.swatch}:${gunId}`
          if (!this.viewmodel || this.viewmodel.key !== vmKey) {
            if (this.viewmodel) {
              this.vmScene.remove(this.viewmodel.root)
              disposeObject3D(this.viewmodel.root)
            }
            this.viewmodel = createViewmodelRig(f.crew, f.cosmetics, gunId)
            this.vmScene.add(this.viewmodel.root)
          }
          this.viewmodel.root.visible = true

          // Walk bob + recoil kick + reload dip animation!
          const horizSpeed = Math.hypot(base.vx, base.vz)
          if (horizSpeed > 0.3 && base.grounded) {
            this.vmWalkPhase += dt * 10.5
          }
          this.vmRecoil = Math.max(0, this.vmRecoil - dt * 6.5)
          this.vmMuzzleTimer = Math.max(0, this.vmMuzzleTimer - dt)
          this.viewmodel.muzzleLight.visible = this.vmMuzzleTimer > 0
          if (this.vmMuzzleTimer > 0) {
            this.viewmodel.muzzleLight.rotation.z += dt * 28
          }

          const reloadDef = GUNS[gunId].reloadTicks
          this.vmReloadProgress =
            f.reloadTicksLeft > 0 ? 1 - f.reloadTicksLeft / Math.max(1, reloadDef) : 0
          const reloadDip = Math.sin(this.vmReloadProgress * Math.PI) * 0.24

          const bobX = Math.cos(this.vmWalkPhase) * 0.012
          const bobY = Math.abs(Math.sin(this.vmWalkPhase)) * 0.014
          this.viewmodel.gunPivot.position.set(
            0.28 + bobX,
            -0.25 - bobY - reloadDip,
            -0.48 + this.vmRecoil * 0.09
          )
          this.viewmodel.gunPivot.rotation.set(
            this.vmRecoil * 0.22 - reloadDip * 1.9,
            0,
            reloadDip * 1.1
          )
        } else {
          // Elevated tactical spectator angle over Bell Yard during 4s respawn
          this.camera.position.set(f.x * 0.45, 11.5, f.z * 0.45 + 9.0)
          this.camera.lookAt(0, 1.8, 0)
          if (this.viewmodel) this.viewmodel.root.visible = false
        }
        continue
      }

      // Remote fighter (other human or bot): 3rd-person Inkline avatar with interpolation
      const wantKey = `${f.crew}:${f.cosmetics.top}:${f.cosmetics.hat}:${f.cosmetics.swatch}:${f.armorType}:${gunId}`
      let rv = this.remoteVisuals.get(f.slotId)
      if (!rv || rv.rig.key !== wantKey) {
        if (rv) {
          this.worldScene.remove(rv.rig.root)
          disposeObject3D(rv.rig.root)
        }
        const rig = createAvatarRig(f.crew, f.cosmetics, f.armorType, gunId)
        this.worldScene.add(rig.root)
        rv = {
          rig,
          displayX: f.x,
          displayY: f.y,
          displayZ: f.z,
          displayYaw: f.yaw,
          stridePhase: f.slotId * 1.3
        }
        this.remoteVisuals.set(f.slotId, rv)
      }

      rv.rig.root.visible = f.alive
      if (!f.alive) continue

      // Smooth remote interpolation (snap on respawn teleports > 5m)
      const dx = f.x - rv.displayX
      const dy = f.y - rv.displayY
      const dz = f.z - rv.displayZ
      if (dx * dx + dy * dy + dz * dz > 25) {
        rv.displayX = f.x
        rv.displayY = f.y
        rv.displayZ = f.z
      } else {
        const lerp = 1 - Math.exp(-18 * dt)
        rv.displayX += dx * lerp
        rv.displayY += dy * lerp
        rv.displayZ += dz * lerp
      }

      // Shortest-angle yaw lerp
      let dYaw = f.yaw - rv.displayYaw
      while (dYaw > Math.PI) dYaw -= Math.PI * 2
      while (dYaw < -Math.PI) dYaw += Math.PI * 2
      rv.displayYaw += dYaw * (1 - Math.exp(-18 * dt))

      rv.rig.root.position.set(rv.displayX, rv.displayY, rv.displayZ)
      rv.rig.root.rotation.y = rv.displayYaw
      rv.rig.headGroup.rotation.x = f.pitch * 0.7
      rv.rig.rightArm.rotation.x = f.pitch * 0.7

      const speed = Math.hypot(f.vx, f.vz)
      if (speed > 0.35) {
        rv.stridePhase += dt * 11
        const swing = Math.sin(rv.stridePhase) * 0.55
        rv.rig.leftLeg.rotation.x = swing
        rv.rig.rightLeg.rotation.x = -swing
        rv.rig.leftArm.rotation.x = -swing * 0.5
      } else {
        rv.rig.leftLeg.rotation.x *= 0.85
        rv.rig.rightLeg.rotation.x *= 0.85
        rv.rig.leftArm.rotation.x *= 0.85
      }
    }

    for (const [slotId, rv] of this.remoteVisuals.entries()) {
      if (!activeSlots.has(slotId) || slotId === localSlotId) {
        this.worldScene.remove(rv.rig.root)
        disposeObject3D(rv.rig.root)
        this.remoteVisuals.delete(slotId)
      }
    }
  }

  private syncProjectiles(snapshot: MatchSnapshot): void {
    const aliveIds = new Set<number>()
    for (const p of snapshot.projectiles) {
      aliveIds.add(p.projectileId)
      let mesh = this.projectileMeshes.get(p.projectileId)
      if (!mesh) {
        const colorHex =
          p.gunId === "linecaster"
            ? 0x2c6ce0
            : p.crew === 0
              ? CREWS[0].colorHex
              : CREWS[1].colorHex
        const len = p.gunId === "linecaster" ? 0.95 : p.gunId === "broadside" ? 0.34 : 0.56
        const rad = p.gunId === "linecaster" ? 0.075 : 0.045
        const geo = new THREE.BoxGeometry(rad * 2, rad * 2, len)
        const mat = new THREE.MeshBasicMaterial({
          color: colorHex,
          transparent: true,
          opacity: p.gunId === "linecaster" ? 0.96 : 0.86
        })
        mesh = new THREE.Mesh(geo, mat)
        this.worldScene.add(mesh)
        this.projectileMeshes.set(p.projectileId, mesh)
      }
      mesh.position.set(p.x, p.y, p.z)
      mesh.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz)
    }

    for (const [id, mesh] of this.projectileMeshes.entries()) {
      if (!aliveIds.has(id)) {
        this.worldScene.remove(mesh)
        disposeObject3D(mesh)
        this.projectileMeshes.delete(id)
      }
    }
  }

  private readonly handleResize = (): void => {
    const w = Math.max(320, this.container.clientWidth || window.innerWidth)
    const h = Math.max(200, this.container.clientHeight || window.innerHeight)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.vmCamera.aspect = w / h
    this.vmCamera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  public dispose(): void {
    this.abortCtrl.abort()
    this.resetMatchState()
    if (this.viewmodel) {
      this.vmScene.remove(this.viewmodel.root)
      disposeObject3D(this.viewmodel.root)
      this.viewmodel = null
    }
    disposeObject3D(this.worldScene)
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
