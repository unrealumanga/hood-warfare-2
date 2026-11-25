import * as THREE from "three"
import { CREWS, type CrewId } from "../sim/index.ts"

export const INKLINE_PALETTE = {
  paperBg: 0xf0f2ec,
  paperCard: 0xf7f8f4,
  paperShaded: 0xe2e6dc,
  paperShadow: 0xd0d6cb,
  ink: 0x3d4943,
  inkDark: 0x222c27,
  cobalt: 0x2f5a9c,
  vermilion: 0xb04a39,
  ochre: 0xc29b58,
  brick: 0x9c5a4c
} as const

let sharedGradientMap: THREE.DataTexture | null = null

function getToonGradientMap(): THREE.DataTexture {
  if (sharedGradientMap) return sharedGradientMap
  // High-key 3-band Inkline paper ramp so walls stay luminous paper-white!
  const data = new Uint8Array([
    182, 182, 182, 255,
    224, 224, 224, 255,
    255, 255, 255, 255
  ])
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  sharedGradientMap = tex
  return tex
}

export interface InkMaterialOptions {
  readonly hatchStrength?: number
  readonly halftone?: boolean
  readonly map?: THREE.Texture
  readonly transparent?: boolean
  readonly opacity?: number
  readonly side?: THREE.Side
}

/**
 * Inkline Town 3-band cel shader with screen-space diagonal pen hatching & subtle halftone dots.
 * Injects before `#include <colorspace_fragment>` using ascending smoothstep thresholds.
 */
export function createInkMaterial(
  colorHex: number | string,
  options: InkMaterialOptions = {}
): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({
    color: new THREE.Color(colorHex),
    gradientMap: getToonGradientMap(),
    map: options.map ?? null,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    side: options.side ?? THREE.FrontSide
  })

  const hatchStrength = options.hatchStrength ?? 0.24
  const useHalftone = options.halftone ?? true

  mat.onBeforeCompile = (shader) => {
    shader.uniforms["uInkColor"] = { value: new THREE.Color(INKLINE_PALETTE.ink) }
    shader.uniforms["uHatchStrength"] = { value: hatchStrength }
    shader.uniforms["uUseHalftone"] = { value: useHalftone ? 1.0 : 0.0 }

    shader.fragmentShader =
      `
      uniform vec3 uInkColor;
      uniform float uHatchStrength;
      uniform float uUseHalftone;
      ` + shader.fragmentShader

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <colorspace_fragment>",
      `
      {
        float lum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
        // Ascending smoothstep: stronger ink hatch in darker shadow bands
        float shadowBand = 1.0 - smoothstep(0.56, 0.88, lum);
        vec2 sc = gl_FragCoord.xy;
        float diagA = step(0.82, fract((sc.x + sc.y) * 0.165));
        float diagB = step(0.86, fract((sc.x - sc.y) * 0.165)) * (1.0 - smoothstep(0.32, 0.62, lum));
        vec2 cell = fract(sc * 0.125) - 0.5;
        float dotMask = (1.0 - smoothstep(0.18, 0.26, length(cell))) * uUseHalftone * 0.55;
        float inkPattern = clamp(max(diagA, max(diagB, dotMask)), 0.0, 1.0);
        float mixAmt = shadowBand * inkPattern * uHatchStrength;
        // Subtle warm paper grain
        float grain = (fract(sin(dot(floor(sc * 0.5), vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.018;
        gl_FragColor.rgb = mix(gl_FragColor.rgb + grain, uInkColor, mixAmt);
      }
      #include <colorspace_fragment>
      `
    )
  }
  mat.customProgramCacheKey = () => `inkline-${hatchStrength.toFixed(2)}-${useHalftone ? 1 : 0}`
  return mat
}

export function addInkEdges(
  mesh: THREE.Mesh,
  thresholdAngle = 22,
  colorHex: number = INKLINE_PALETTE.inkDark
): THREE.LineSegments {
  const edges = new THREE.EdgesGeometry(mesh.geometry, thresholdAngle)
  const lineMat = new THREE.LineBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.88
  })
  const lines = new THREE.LineSegments(edges, lineMat)
  lines.renderOrder = 2
  mesh.add(lines)
  return lines
}

export function addSilhouetteShell(
  mesh: THREE.Mesh,
  scale = 1.045,
  colorHex: number = INKLINE_PALETTE.inkDark
): THREE.Mesh {
  const outlineMat = new THREE.MeshBasicMaterial({
    color: colorHex,
    side: THREE.BackSide
  })
  const shell = new THREE.Mesh(mesh.geometry, outlineMat)
  shell.scale.setScalar(scale)
  mesh.add(shell)
  return shell
}

/** Procedural Inkline paper cobble & printworks drafting lines for Bell Yard ground */
export function createGroundTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas")
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext("2d")!

  ctx.fillStyle = "#f0f2ec"
  ctx.fillRect(0, 0, 512, 512)

  // Subtle paper fibers
  ctx.fillStyle = "rgba(61, 73, 67, 0.035)"
  for (let i = 0; i < 900; i++) {
    const x = (i * 73) % 512
    const y = (i * 197) % 512
    ctx.fillRect(x, y, 2, 1)
  }

  // Hand-drafted courtyard stone grid & tramway groove hints
  ctx.strokeStyle = "rgba(61, 73, 67, 0.16)"
  ctx.lineWidth = 1.5
  const step = 64
  for (let x = 0; x <= 512; x += step) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, 512)
    ctx.stroke()
  }
  for (let y = 0; y <= 512; y += step) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(512, y)
    ctx.stroke()
  }

  // Diagonal hatch accents in alternate pavers
  ctx.strokeStyle = "rgba(61, 73, 67, 0.08)"
  ctx.lineWidth = 1
  for (let gx = 0; gx < 8; gx++) {
    for (let gy = 0; gy < 8; gy++) {
      if ((gx + gy) % 3 !== 0) continue
      const ox = gx * step
      const oy = gy * step
      for (let d = 12; d < step; d += 14) {
        ctx.beginPath()
        ctx.moveTo(ox + d, oy + 6)
        ctx.lineTo(ox + 6, oy + d)
        ctx.stroke()
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(14, 11)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Original woodblock printworks shop signboard texture */
export function createShopSignTexture(
  title: string,
  accentHex = "#3d4943"
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas")
  canvas.width = 512
  canvas.height = 128
  const ctx = canvas.getContext("2d")!

  ctx.fillStyle = "#f7f8f4"
  ctx.fillRect(0, 0, 512, 128)

  // Double ink drafting border
  ctx.strokeStyle = "#222c27"
  ctx.lineWidth = 6
  ctx.strokeRect(8, 8, 496, 112)
  ctx.strokeStyle = accentHex
  ctx.lineWidth = 2.5
  ctx.strokeRect(18, 18, 476, 92)

  // Corner ink registration marks
  ctx.fillStyle = accentHex
  for (const [cx, cy] of [
    [28, 28],
    [484, 28],
    [28, 100],
    [484, 100]
  ] as const) {
    ctx.beginPath()
    ctx.arc(cx, cy, 4, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.fillStyle = "#222c27"
  ctx.font = "bold 30px ui-monospace, 'Cascadia Mono', Consolas, monospace"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(title, 256, 66)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Screen-printed Inkline Mural Wall art (neutral / Cobalt Press / Vermilion Bind) */
export function createMuralTexture(
  muralName: string,
  owner: "neutral" | CrewId
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas")
  canvas.width = 512
  canvas.height = 320
  const ctx = canvas.getContext("2d")!

  const bg =
    owner === "neutral"
      ? "#f2f3ed"
      : owner === 0
        ? CREWS[0].washHex
        : CREWS[1].washHex
  const accent =
    owner === "neutral"
      ? "#3d4943"
      : owner === 0
        ? CREWS[0].colorHex
        : CREWS[1].colorHex

  ctx.fillStyle = bg
  ctx.fillRect(0, 0, 512, 320)

  // Halftone dot backdrop
  ctx.fillStyle = accent
  ctx.globalAlpha = 0.14
  for (let y = 16; y < 304; y += 16) {
    for (let x = 16; x < 496; x += 16) {
      ctx.beginPath()
      ctx.arc(x, y, 2.6, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.globalAlpha = 1

  // Bold screen-printed border
  ctx.strokeStyle = "#222c27"
  ctx.lineWidth = 8
  ctx.strokeRect(10, 10, 492, 300)

  // Center emblem
  ctx.save()
  ctx.translate(256, 145)
  ctx.strokeStyle = accent
  ctx.fillStyle = accent
  ctx.lineWidth = 10

  if (owner === 0) {
    // Cobalt Press: Stacked Printing Chevrons
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath()
      ctx.moveTo(-88, i * 36 + 20)
      ctx.lineTo(0, i * 36 - 30)
      ctx.lineTo(88, i * 36 + 20)
      ctx.stroke()
    }
  } else if (owner === 1) {
    // Vermilion Bind: Bold Inked Diamond Stamp
    ctx.beginPath()
    ctx.moveTo(0, -76)
    ctx.lineTo(96, 0)
    ctx.lineTo(0, 76)
    ctx.lineTo(-96, 0)
    ctx.closePath()
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, -40)
    ctx.lineTo(52, 0)
    ctx.lineTo(0, 40)
    ctx.lineTo(-52, 0)
    ctx.closePath()
    ctx.fill()
  } else {
    // Neutral Bell Yard Woodcut Press Wheel
    ctx.beginPath()
    ctx.arc(0, 0, 62, 0, Math.PI * 2)
    ctx.stroke()
    for (let a = 0; a < 6; a++) {
      const ang = (a * Math.PI) / 3
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(Math.cos(ang) * 62, Math.sin(ang) * 62)
      ctx.stroke()
    }
  }
  ctx.restore()

  // Banner title
  ctx.fillStyle = "#222c27"
  ctx.fillRect(34, 248, 444, 44)
  ctx.fillStyle = "#f7f8f4"
  ctx.font = "bold 22px ui-monospace, 'Cascadia Mono', Consolas, monospace"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  const ownerTag =
    owner === "neutral"
      ? muralName.toUpperCase()
      : `${CREWS[owner].shortName} · ${muralName.toUpperCase()}`
  ctx.fillText(ownerTag, 256, 271)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Dispose all meshes/geometries/materials inside a Three.js Object3D subtree */
export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
      obj.geometry.dispose()
      if (Array.isArray(obj.material)) {
        for (const m of obj.material) m.dispose()
      } else {
        obj.material.dispose()
      }
    }
  })
}
