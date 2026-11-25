import { describe, expect, it } from "vitest"
import {
  botCosmetics,
  DEFAULT_COSMETICS,
  HAT_IDS,
  SWATCH_IDS,
  TOP_IDS,
  sanitizeCosmetics,
  type CrewId,
  type HatId,
  type SwatchId,
  type TopId
} from "../src/sim/index.ts"

const CREWS: readonly CrewId[] = [0, 1]

describe("cosmetics system", () => {
  it("botCosmetics is deterministic", () => {
    for (let slot = 0; slot <= 20; slot++) {
      for (const crew of CREWS) {
        const first = botCosmetics(slot, crew)
        const second = botCosmetics(slot, crew)
        expect(first).toEqual(second)
      }
    }
  })

  it("all outputs for slots 0..20 and both crews use valid ids", () => {
    for (let slot = 0; slot <= 20; slot++) {
      for (const crew of CREWS) {
        const cos = botCosmetics(slot, crew)
        expect(TOP_IDS).toContain(cos.top)
        expect(HAT_IDS).toContain(cos.hat)
        expect(SWATCH_IDS).toContain(cos.swatch)
        expect(cos.swatch).not.toBe("gilded")
      }
    }
  })

  it("among slots 0..5 for crew 1 there are at least 4 distinct (top,hat,swatch) combinations", () => {
    const combos = new Set<string>()
    for (let slot = 0; slot <= 5; slot++) {
      const cos = botCosmetics(slot, 1)
      const key = `${cos.top}:${cos.hat}:${cos.swatch}`
      combos.add(key)
    }
    expect(combos.size).toBeGreaterThanOrEqual(4)
  })

  it("crew 0 palette never uses brick/rust/plum and crew 1 never uses denim/teal", () => {
    const forbiddenCrew0: readonly SwatchId[] = ["brick", "rust", "plum"]
    const forbiddenCrew1: readonly SwatchId[] = ["denim", "teal"]

    for (let slot = 0; slot <= 50; slot++) {
      const c0 = botCosmetics(slot, 0)
      expect(forbiddenCrew0).not.toContain(c0.swatch)

      const c1 = botCosmetics(slot, 1)
      expect(forbiddenCrew1).not.toContain(c1.swatch)
    }
  })

  it("sanitizeCosmetics accepts every new id and still falls back to defaults for unknown strings", () => {
    // New tops: apron, vest, trench, tracksuit
    const newTops: readonly TopId[] = ["apron", "vest", "trench", "tracksuit"]
    for (const top of newTops) {
      const sanitized = sanitizeCosmetics({ top })
      expect(sanitized.top).toBe(top)
      expect(sanitized.hat).toBe(DEFAULT_COSMETICS.hat)
      expect(sanitized.swatch).toBe(DEFAULT_COSMETICS.swatch)
    }

    // New hats: bucket, headband, hardHat, bareHead
    const newHats: readonly HatId[] = ["bucket", "headband", "hardHat", "bareHead"]
    for (const hat of newHats) {
      const sanitized = sanitizeCosmetics({ hat })
      expect(sanitized.hat).toBe(hat)
      expect(sanitized.top).toBe(DEFAULT_COSMETICS.top)
      expect(sanitized.swatch).toBe(DEFAULT_COSMETICS.swatch)
    }

    // New swatches: brick, rust, teal, plum
    const newSwatches: readonly SwatchId[] = ["brick", "rust", "teal", "plum"]
    for (const swatch of newSwatches) {
      const sanitized = sanitizeCosmetics({ swatch })
      expect(sanitized.swatch).toBe(swatch)
      expect(sanitized.top).toBe(DEFAULT_COSMETICS.top)
      expect(sanitized.hat).toBe(DEFAULT_COSMETICS.hat)
    }

    // Existing ids still work
    expect(sanitizeCosmetics({ top: "hoodie", hat: "cap", swatch: "ivory" })).toEqual({
      top: "hoodie",
      hat: "cap",
      swatch: "ivory"
    })
    expect(sanitizeCosmetics({ top: "workJacket", hat: "beanie", swatch: "slate" })).toEqual({
      top: "workJacket",
      hat: "beanie",
      swatch: "slate"
    })

    // Unknown strings fall back to defaults
    expect(
      sanitizeCosmetics({
        top: "unknownTop123",
        hat: "unknownHat456",
        swatch: "unknownSwatch789"
      })
    ).toEqual(DEFAULT_COSMETICS)

    // Non-object or missing values fall back to defaults
    expect(sanitizeCosmetics(null)).toEqual(DEFAULT_COSMETICS)
    expect(sanitizeCosmetics(undefined)).toEqual(DEFAULT_COSMETICS)
    expect(sanitizeCosmetics("notAnObject")).toEqual(DEFAULT_COSMETICS)
    expect(sanitizeCosmetics(123)).toEqual(DEFAULT_COSMETICS)
    expect(sanitizeCosmetics({})).toEqual(DEFAULT_COSMETICS)
  })
})
