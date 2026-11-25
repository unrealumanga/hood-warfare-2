import type { GunId } from "../sim/index.ts"

/** Procedural Web Audio SFX engine (100% bundled offline, distinct timbre per weapon) */
export class SoundEngine {
  private ctx: AudioContext | null = null
  private muted = false

  constructor(initialMuted = false) {
    this.muted = initialMuted
  }

  public setMuted(muted: boolean): void {
    this.muted = muted
  }

  public isMuted(): boolean {
    return this.muted
  }

  private ensureContext(): AudioContext | null {
    if (this.muted) return null
    if (typeof window === "undefined") return null
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { readonly webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      if (!Ctor) return null
      this.ctx = new Ctor()
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume()
    }
    return this.ctx
  }

  private playNoise(duration: number, gainPeak: number, filterFreq: number, q = 1.0): void {
    const ctx = this.ensureContext()
    if (!ctx) return
    const sampleRate = ctx.sampleRate
    const len = Math.max(1, Math.floor(sampleRate * duration))
    const buf = ctx.createBuffer(1, len, sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp((-i / len) * 5.2)
    }
    const src = ctx.createBufferSource()
    src.buffer = buf

    const filter = ctx.createBiquadFilter()
    filter.type = "bandpass"
    filter.frequency.value = filterFreq
    filter.Q.value = q

    const gain = ctx.createGain()
    const t = ctx.currentTime
    gain.gain.setValueAtTime(gainPeak, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration)

    src.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)
    src.start(t)
  }

  private playTone(
    type: OscillatorType,
    startFreq: number,
    endFreq: number,
    duration: number,
    gainPeak: number
  ): void {
    const ctx = this.ensureContext()
    if (!ctx) return
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(startFreq, t)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + duration)

    gain.gain.setValueAtTime(gainPeak, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration)

    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(t)
    osc.stop(t + duration)
  }

  public playGunshot(gunId: GunId, volumeScale = 1): void {
    if (this.muted) return
    const v = Math.max(0.1, Math.min(1, volumeScale))
    switch (gunId) {
      case "proofPistol":
        // Crisp punchy woodblock snap
        this.playNoise(0.09, 0.24 * v, 1750, 1.4)
        this.playTone("triangle", 340, 110, 0.08, 0.2 * v)
        break
      case "rollerSmg":
        // Tight high-cadence ink-roller pop
        this.playNoise(0.06, 0.16 * v, 2400, 1.8)
        this.playTone("square", 260, 130, 0.05, 0.11 * v)
        break
      case "broadside":
        // Chunky heavy wide scatter blast
        this.playNoise(0.24, 0.36 * v, 680, 0.7)
        this.playTone("sawtooth", 155, 42, 0.2, 0.28 * v)
        break
      case "linecaster":
        // Signature bright resonant bolt release!
        this.playTone("sine", 860, 290, 0.22, 0.22 * v)
        this.playTone("triangle", 1320, 520, 0.16, 0.15 * v)
        this.playNoise(0.08, 0.12 * v, 3200, 2.2)
        break
      case "cursedBlock":
        // Heavy gilded breech-block boom + bell overtone
        this.playNoise(0.28, 0.38 * v, 480, 0.65)
        this.playTone("sawtooth", 210, 48, 0.26, 0.3 * v)
        this.playTone("sine", 1040, 620, 0.24, 0.14 * v)
        break
    }
  }

  public playSketchPlace(): void {
    this.playNoise(0.11, 0.15, 2200, 1.8)
    this.playTone("triangle", 360, 580, 0.11, 0.14)
  }

  public playSketchErase(): void {
    this.playNoise(0.14, 0.18, 1200, 1.2)
    this.playTone("sawtooth", 420, 180, 0.14, 0.13)
  }

  public playParry(): void {
    this.playTone("triangle", 1120, 1680, 0.12, 0.22)
    this.playTone("sine", 1840, 1320, 0.16, 0.15)
  }

  public playSmokeDeploy(): void {
    this.playNoise(0.32, 0.22, 950, 0.6)
  }

  public playBarrelBlast(): void {
    this.playNoise(0.36, 0.42, 340, 0.5)
    this.playTone("sawtooth", 120, 32, 0.34, 0.34)
  }

  public playGrapple(): void {
    this.playTone("sawtooth", 280, 740, 0.15, 0.14)
  }

  public playForemanWindup(): void {
    this.playTone("sawtooth", 180, 95, 0.38, 0.24)
    setTimeout(() => this.playTone("triangle", 260, 140, 0.26, 0.18), 120)
  }

  public playForemanStagger(): void {
    this.playTone("triangle", 620, 980, 0.18, 0.22)
    this.playNoise(0.18, 0.22, 1800, 1.0)
  }

  public playReload(): void {
    this.playTone("square", 440, 620, 0.06, 0.09)
    setTimeout(() => this.playTone("triangle", 680, 880, 0.07, 0.09), 110)
  }

  public playHit(): void {
    this.playTone("triangle", 1180, 760, 0.045, 0.14)
  }

  /** Sharp high double-ping: distinct from the torso hit so a headshot is audible. */
  public playHeadshot(): void {
    this.playTone("square", 1900, 2400, 0.05, 0.16)
    setTimeout(() => this.playTone("triangle", 2600, 3200, 0.08, 0.14), 45)
  }

  /** Dull low thud for limb hits. */
  public playLimbHit(): void {
    this.playTone("triangle", 380, 220, 0.06, 0.12)
  }

  public playArmorBreak(): void {
    this.playNoise(0.16, 0.26, 2800, 1.1)
    this.playTone("sawtooth", 920, 240, 0.15, 0.18)
  }

  public playElim(): void {
    this.playTone("triangle", 520, 780, 0.11, 0.18)
    setTimeout(() => this.playTone("triangle", 780, 1040, 0.14, 0.16), 85)
  }

  public playMuralRotate(): void {
    this.playTone("sawtooth", 290, 390, 0.18, 0.12)
    setTimeout(() => this.playTone("sawtooth", 390, 440, 0.24, 0.11), 160)
  }
}
