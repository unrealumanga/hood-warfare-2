import * as THREE from "three"
import {
  CREWS,
  SWATCHES,
  type ArmorId,
  type CosmeticLoadout,
  type CrewId,
  type GunId
} from "../sim/index.ts"
import {
  INKLINE_PALETTE,
  addInkEdges,
  addSilhouetteShell,
  createInkMaterial
} from "./inkShader.ts"

/** Builds one of the 4 unmistakable Inkline weapon 3D models pointing along -Z */
export function createGunMesh(gunId: GunId): THREE.Group {
  const g = new THREE.Group()
  const metal = createInkMaterial(0x4b5650, { hatchStrength: 0.3 })
  const darkMetal = createInkMaterial(0x2d3631, { hatchStrength: 0.2 })
  const paperBody = createInkMaterial(0xe9ede3, { hatchStrength: 0.22 })
  const brass = createInkMaterial(INKLINE_PALETTE.ochre, { hatchStrength: 0.25 })

  const addPart = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    rx = 0
  ) => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    m.rotation.x = rx
    m.castShadow = true
    addInkEdges(m, 24)
    g.add(m)
    return m
  }

  switch (gunId) {
    case "proofPistol": {
      // Crisp compact sidearm with brass ink-well breech cap
      addPart(new THREE.BoxGeometry(0.068, 0.085, 0.29), paperBody, 0, 0.04, -0.07)
      addPart(new THREE.BoxGeometry(0.056, 0.036, 0.26), darkMetal, 0, -0.01, -0.06)
      addPart(new THREE.BoxGeometry(0.052, 0.14, 0.078), darkMetal, 0, -0.075, 0.04, 0.24)
      addPart(new THREE.CylinderGeometry(0.02, 0.02, 0.07, 8), brass, 0, 0.09, -0.04)
      addPart(new THREE.BoxGeometry(0.022, 0.026, 0.03), darkMetal, 0, 0.092, -0.19)
      break
    }
    case "rollerSmg": {
      // Cylindrical ink-roller drum magazine + perforated print-barrel + wire stock
      addPart(new THREE.BoxGeometry(0.088, 0.11, 0.42), paperBody, 0, 0.03, -0.12)
      addPart(new THREE.CylinderGeometry(0.024, 0.024, 0.22, 8), darkMetal, 0, 0.045, -0.41, Math.PI / 2)
      // Signature under-slung roller drum!
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.16, 12), brass)
      drum.position.set(0, -0.065, -0.18)
      drum.rotation.z = Math.PI / 2
      addInkEdges(drum, 22)
      g.add(drum)
      // Pistol grip & folding wire stock
      addPart(new THREE.BoxGeometry(0.056, 0.145, 0.075), darkMetal, 0, -0.08, 0.02, 0.2)
      addPart(new THREE.BoxGeometry(0.055, 0.065, 0.17), metal, 0, 0.015, 0.16)
      break
    }
    case "broadside": {
      // Wide twin-barrel press scattergun with flared ink nozzles + heavy forend
      addPart(new THREE.BoxGeometry(0.12, 0.11, 0.34), paperBody, 0, 0.02, -0.06)
      // Twin side-by-side flared barrels
      addPart(new THREE.CylinderGeometry(0.036, 0.028, 0.42, 8), darkMetal, -0.036, 0.05, -0.34, Math.PI / 2)
      addPart(new THREE.CylinderGeometry(0.036, 0.028, 0.42, 8), darkMetal, 0.036, 0.05, -0.34, Math.PI / 2)
      // Chunky ochre press-timber pump forend & heavy stock
      addPart(new THREE.BoxGeometry(0.115, 0.085, 0.24), brass, 0, -0.015, -0.32)
      addPart(new THREE.BoxGeometry(0.082, 0.125, 0.24), brass, 0, -0.04, 0.18, 0.16)
      break
    }
    case "linecaster": {
      // Long drafting-rail bolt rifle with luminous glowing ink condenser coil!
      addPart(new THREE.BoxGeometry(0.082, 0.105, 0.62), paperBody, 0, 0.03, -0.22)
      // Twin parallel drafting rails
      addPart(new THREE.BoxGeometry(0.022, 0.026, 0.56), darkMetal, -0.036, 0.082, -0.42)
      addPart(new THREE.BoxGeometry(0.022, 0.026, 0.56), darkMetal, 0.036, 0.082, -0.42)
      // Glowing luminous bolt rail core
      const glowMat = new THREE.MeshBasicMaterial({ color: 0x3b72c4 })
      const coil = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.032, 0.46), glowMat)
      coil.position.set(0, 0.082, -0.38)
      g.add(coil)
      // Precision aperture scope + ergonomic stock
      addPart(new THREE.CylinderGeometry(0.026, 0.03, 0.19, 10), metal, 0, 0.125, -0.1, Math.PI / 2)
      addPart(new THREE.BoxGeometry(0.068, 0.12, 0.25), darkMetal, 0, -0.035, 0.18, 0.12)
      break
    }
    case "cursedBlock": {
      // Voluntary Cursed Proof-Block: heavy gilded brass single-shot breech cannon!
      addPart(new THREE.BoxGeometry(0.11, 0.125, 0.44), brass, 0, 0.03, -0.14)
      addPart(new THREE.CylinderGeometry(0.048, 0.042, 0.42, 8), darkMetal, 0, 0.04, -0.46, Math.PI / 2)
      const sealMat = new THREE.MeshBasicMaterial({ color: 0xb04a39 })
      const seal = new THREE.Mesh(new THREE.OctahedronGeometry(0.048, 0), sealMat)
      seal.position.set(0, 0.115, -0.14)
      g.add(seal)
      addPart(new THREE.BoxGeometry(0.075, 0.13, 0.24), darkMetal, 0, -0.04, 0.16, 0.15)
      break
    }
  }

  return g
}

export interface AvatarRig {
  readonly root: THREE.Group
  readonly headGroup: THREE.Group
  readonly leftArm: THREE.Group
  readonly rightArm: THREE.Group
  readonly leftLeg: THREE.Group
  readonly rightLeg: THREE.Group
  readonly gunAnchor: THREE.Group
  readonly key: string
}

/**
 * Full 3D Inkline crew avatar with top silhouette (hoodie/workJacket/windbreaker),
 * hat (cap/beanie), swatch color, crew shoulder pattern (chevron vs diamond),
 * light vs heavy armor vest silhouette, and equipped gun!
 */
export function createAvatarRig(
  crew: CrewId,
  cosmetics: CosmeticLoadout,
  armor: ArmorId,
  gunId: GunId
): AvatarRig {
  const root = new THREE.Group()
  const crewDef = CREWS[crew]
  const swatch = SWATCHES[cosmetics.swatch]

  const topMat = createInkMaterial(swatch.hex, { hatchStrength: 0.28 })
  const trimMat = createInkMaterial(swatch.trimHex, { hatchStrength: 0.2 })
  const crewMat = createInkMaterial(crewDef.colorHex, { hatchStrength: 0.2 })
  const pantsMat = createInkMaterial(0x404945, { hatchStrength: 0.3 })
  const skinMat = createInkMaterial(0xe7dfd2, { hatchStrength: 0.16 })
  const vestMat = createInkMaterial(armor === "heavy" ? 0x2f3834 : 0x56615b, { hatchStrength: 0.34 })
  const whiteMat = new THREE.MeshBasicMaterial({ color: 0xf7f8f4 })

  const addBox = (
    parent: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    outline = false
  ) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    m.position.set(x, y, z)
    m.castShadow = true
    m.receiveShadow = true
    addInkEdges(m, 24)
    if (outline) addSilhouetteShell(m, 1.05)
    parent.add(m)
    return m
  }

  // Legs (articulated at hip y = 0.78)
  const leftLeg = new THREE.Group()
  leftLeg.position.set(-0.14, 0.78, 0)
  addBox(leftLeg, 0.2, 0.74, 0.22, pantsMat, 0, -0.38, 0)
  addBox(leftLeg, 0.22, 0.12, 0.28, trimMat, 0, -0.72, -0.03)
  root.add(leftLeg)

  const rightLeg = new THREE.Group()
  rightLeg.position.set(0.14, 0.78, 0)
  addBox(rightLeg, 0.2, 0.74, 0.22, pantsMat, 0, -0.38, 0)
  addBox(rightLeg, 0.22, 0.12, 0.28, trimMat, 0, -0.72, -0.03)
  root.add(rightLeg)

  // Torso (y = 0.78 .. 1.40) shaped by chosen Top!
  const torsoWidth = cosmetics.top === "workJacket" ? 0.56 : cosmetics.top === "hoodie" ? 0.54 : 0.50
  addBox(root, torsoWidth, 0.62, 0.30, topMat, 0, 1.09, 0, true)

  if (cosmetics.top === "hoodie") {
    // Draped hood collar + kangaroo front pocket
    addBox(root, 0.34, 0.16, 0.22, topMat, 0, 1.38, 0.12)
    addBox(root, 0.34, 0.18, 0.04, trimMat, 0, 0.94, -0.16)
  } else if (cosmetics.top === "workJacket") {
    // Structured collar lapels + twin canvas chest pockets
    addBox(root, 0.42, 0.10, 0.26, trimMat, 0, 1.38, 0.02)
    addBox(root, 0.14, 0.14, 0.04, trimMat, -0.14, 1.18, -0.16)
    addBox(root, 0.14, 0.14, 0.04, trimMat, 0.14, 1.18, -0.16)
  } else {
    // Windbreaker: high funnel collar + diagonal team-tone chest stripe
    addBox(root, 0.28, 0.13, 0.24, trimMat, 0, 1.40, 0)
    addBox(root, torsoWidth + 0.01, 0.11, 0.31, crewMat, 0, 1.13, 0)
  }

  // Armor Vest silhouette (Light = slim strap; Heavy = unmistakable thick press-plate vest!)
  if (armor === "heavy") {
    addBox(root, torsoWidth + 0.10, 0.46, 0.40, vestMat, 0, 1.12, 0)
    // Heavy bolted collar guard & front armor plates
    addBox(root, 0.44, 0.12, 0.42, trimMat, 0, 1.36, 0)
    addBox(root, 0.34, 0.26, 0.05, crewMat, 0, 1.14, -0.21)
  } else {
    // Light vest: slim harness chest panel
    addBox(root, 0.34, 0.30, 0.33, vestMat, 0, 1.14, 0)
  }

  // Crew Shoulder Badges (unmistakable silhouettes & colors!)
  for (const side of [-1, 1] as const) {
    const sx = side * (torsoWidth * 0.5 + (armor === "heavy" ? 0.09 : 0.05))
    addBox(root, 0.13, 0.18, 0.28, crewMat, sx, 1.30, 0)
    // Screen-printed shoulder pattern: chevron bar vs diamond emblem
    const emblem = new THREE.Mesh(
      crewDef.shoulderPattern === "chevron"
        ? new THREE.BoxGeometry(0.02, 0.045, 0.16)
        : new THREE.BoxGeometry(0.02, 0.095, 0.095),
      whiteMat
    )
    emblem.position.set(sx + side * 0.068, 1.30, 0)
    if (crewDef.shoulderPattern === "diamond") {
      emblem.rotation.x = Math.PI / 4
    } else {
      emblem.rotation.x = 0.26
    }
    root.add(emblem)
  }

  // Head + Hat (articulated at neck y = 1.44)
  const headGroup = new THREE.Group()
  headGroup.position.set(0, 1.44, 0)
  addBox(headGroup, 0.30, 0.30, 0.30, skinMat, 0, 0.16, 0, true)
  // Ink visor / eyes
  addBox(headGroup, 0.22, 0.05, 0.03, trimMat, 0, 0.19, -0.155)

  if (cosmetics.hat === "cap") {
    addBox(headGroup, 0.33, 0.12, 0.33, crewMat, 0, 0.32, 0)
    // Forward bill brim
    addBox(headGroup, 0.31, 0.035, 0.22, trimMat, 0, 0.27, -0.22)
  } else {
    // Knit beanie dome + ribbed fold cuff
    addBox(headGroup, 0.34, 0.10, 0.34, crewMat, 0, 0.30, 0)
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.165, 10, 8), crewMat)
    dome.position.set(0, 0.35, 0)
    addInkEdges(dome, 26)
    headGroup.add(dome)
  }
  root.add(headGroup)

  // Left & Right Arms (articulated at shoulder y = 1.32)
  const leftArm = new THREE.Group()
  leftArm.position.set(-(torsoWidth * 0.5 + 0.10), 1.32, 0)
  addBox(leftArm, 0.16, 0.54, 0.16, topMat, 0, -0.22, -0.08)
  addBox(leftArm, 0.14, 0.13, 0.14, trimMat, 0, -0.49, -0.14)
  root.add(leftArm)

  const rightArm = new THREE.Group()
  rightArm.position.set(torsoWidth * 0.5 + 0.10, 1.32, 0)
  addBox(rightArm, 0.16, 0.52, 0.16, topMat, 0, -0.16, -0.14)
  addBox(rightArm, 0.14, 0.13, 0.14, trimMat, 0, -0.24, -0.34)

  const gunAnchor = new THREE.Group()
  gunAnchor.position.set(-0.04, -0.22, -0.42)
  gunAnchor.add(createGunMesh(gunId))
  rightArm.add(gunAnchor)
  root.add(rightArm)

  const key = `${crew}:${cosmetics.top}:${cosmetics.hat}:${cosmetics.swatch}:${armor}:${gunId}`
  return { root, headGroup, leftArm, rightArm, leftLeg, rightLeg, gunAnchor, key }
}

export interface ViewmodelRig {
  readonly root: THREE.Group
  readonly gunPivot: THREE.Group
  readonly muzzleLight: THREE.Mesh
  readonly key: string
}

/** First-person gloved hands, selected outfit sleeves, and active gun silhouette! */
export function createViewmodelRig(
  crew: CrewId,
  cosmetics: CosmeticLoadout,
  gunId: GunId
): ViewmodelRig {
  const root = new THREE.Group()
  const gunPivot = new THREE.Group()
  gunPivot.position.set(0.28, -0.25, -0.48)
  root.add(gunPivot)

  const swatch = SWATCHES[cosmetics.swatch]
  const crewDef = CREWS[crew]
  const sleeveMat = createInkMaterial(swatch.hex, { hatchStrength: 0.25 })
  const cuffMat = createInkMaterial(
    cosmetics.top === "windbreaker" ? crewDef.colorHex : swatch.trimHex,
    { hatchStrength: 0.2 }
  )
  const gloveMat = createInkMaterial(0x28312d, { hatchStrength: 0.22 })

  // Right arm sleeve + cuff + gloved trigger hand
  const rSleeve = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.42), sleeveMat)
  rSleeve.position.set(0.06, -0.12, 0.26)
  rSleeve.rotation.set(0.22, -0.18, 0)
  addInkEdges(rSleeve, 24)
  gunPivot.add(rSleeve)

  const rCuff = new THREE.Mesh(new THREE.BoxGeometry(0.118, 0.118, 0.06), cuffMat)
  rCuff.position.set(0.025, -0.075, 0.07)
  rCuff.rotation.set(0.22, -0.18, 0)
  addInkEdges(rCuff, 24)
  gunPivot.add(rCuff)

  const rGlove = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.085, 0.11), gloveMat)
  rGlove.position.set(0.0, -0.07, 0.01)
  addInkEdges(rGlove, 24)
  gunPivot.add(rGlove)

  // Left support hand & sleeve for 2-handed primaries
  if (gunId !== "proofPistol") {
    const lSleeve = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.105, 0.44), sleeveMat)
    lSleeve.position.set(-0.24, -0.14, 0.08)
    lSleeve.rotation.set(0.2, 0.56, 0)
    addInkEdges(lSleeve, 24)
    gunPivot.add(lSleeve)

    const lCuff = new THREE.Mesh(new THREE.BoxGeometry(0.112, 0.112, 0.055), cuffMat)
    lCuff.position.set(-0.13, -0.09, -0.10)
    lCuff.rotation.set(0.2, 0.56, 0)
    addInkEdges(lCuff, 24)
    gunPivot.add(lCuff)

    const lGlove = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.082, 0.10), gloveMat)
    lGlove.position.set(-0.055, -0.05, -0.22)
    addInkEdges(lGlove, 24)
    gunPivot.add(lGlove)
  }

  // Active 3D gun mesh
  const gunMesh = createGunMesh(gunId)
  gunPivot.add(gunMesh)

  // Translucent Inkline muzzle burst star (hidden when idle)
  const muzzleMat = new THREE.MeshBasicMaterial({
    color: gunId === "linecaster" ? 0x3b72c4 : crew === 0 ? 0x4f7ec7 : 0xd96b56,
    transparent: true,
    opacity: 0.85,
    depthTest: false
  })
  const muzzleLight = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), muzzleMat)
  const muzzleZ = gunId === "linecaster" ? -0.78 : gunId === "broadside" ? -0.62 : gunId === "rollerSmg" ? -0.56 : -0.26
  muzzleLight.position.set(0, 0.05, muzzleZ)
  muzzleLight.visible = false
  gunPivot.add(muzzleLight)

  const key = `${crew}:${cosmetics.top}:${cosmetics.swatch}:${gunId}`
  return { root, gunPivot, muzzleLight, key }
}
