type Position = { x: number; y: number; z: number }

/** Layers of one cue share an output and a sample-clock origin. */
class Voice {
  private readonly time: number

  constructor(private readonly ctx: AudioContext, private readonly output: AudioNode,
    private readonly noise: AudioBuffer, private readonly pitch: number) {
    this.time = ctx.currentTime
  }

  private envelope(duration: number, peak: number, start: number, attack: number): GainNode {
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(peak, start + attack)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    gain.connect(this.output)
    return gain
  }

  tone(type: OscillatorType, from: number, to: number, duration: number, peak: number, delay = 0): void {
    const start = this.time + delay
    const osc = this.ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(from * this.pitch, start)
    osc.frequency.exponentialRampToValueAtTime(to * this.pitch, start + duration)
    osc.connect(this.envelope(duration, peak, start, 0.002))
    osc.start(start)
    osc.stop(start + duration)
  }

  hiss(duration: number, peak: number, frequency: number, q: number, delay = 0,
    endFrequency = frequency, attack = 0.001): void {
    const start = this.time + delay
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    const filter = this.ctx.createBiquadFilter()
    filter.type = "bandpass"
    filter.frequency.setValueAtTime(frequency * this.pitch, start)
    filter.frequency.exponentialRampToValueAtTime(endFrequency * this.pitch, start + duration)
    filter.Q.value = q
    src.connect(filter)
    filter.connect(this.envelope(duration, peak, start, attack))
    src.start(start, Math.random() * (this.noise.duration - duration), duration)
  }
}

/** Procedural Web Audio SFX engine (100% bundled offline, distinct timbre per weapon) */
export class SoundEngine {
  private ctx: AudioContext | null = null
  private listener?: Position & { yaw: number }
  private noise?: AudioBuffer
  private master?: GainNode
  private muted = false

  constructor(initialMuted = false) {
    this.muted = initialMuted
  }

  public setMuted(muted: boolean): void {
    this.muted = muted
    if (this.master) this.master.gain.value = muted ? 0 : 1
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

  public setListener(x: number, y: number, z: number, yaw: number): void {
    this.listener = { x, y, z, yaw }
  }

  private playSpatial(source: Position | undefined, synth: (voice: Voice) => void, level = 1, pitch = 1): void {
    if (this.muted || !(level > 0)) return
    let pan = 0
    if (source && this.listener) {
      const { x, y, z, yaw } = this.listener
      const dx = source.x - x
      const dz = source.z - z
      const distance = Math.hypot(dx, source.y - y, dz)
      if (distance >= 42) return
      const u = Math.max(0, (distance - 6) / 36)
      level *= 1 - u * u * (3 - 2 * u)
      if (distance > 0) pan = (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / distance
    }
    const ctx = this.ensureContext()
    if (!ctx) return
    if (!this.master) {
      this.master = ctx.createGain()
      this.master.connect(ctx.destination)
    }
    if (!this.noise) {
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
      const samples = this.noise.getChannelData(0)
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1
    }
    const gain = ctx.createGain()
    gain.gain.value = level
    if (source && this.listener) {
      const panner = ctx.createStereoPanner()
      panner.pan.value = Math.max(-1, Math.min(1, pan))
      gain.connect(panner)
      panner.connect(this.master)
    } else {
      gain.connect(this.master)
    }
    synth(new Voice(ctx, gain, this.noise, pitch))
  }

  public playGunshot(gunId: string, volumeScale = 1, pos?: Position): void {
    this.playSpatial(pos, v => {
      switch (gunId) {
        case "proofPistol":
          // Crisp punchy woodblock snap
          v.hiss(0.09, 0.24, 1750, 1.4)
          v.tone("triangle", 340, 110, 0.08, 0.2)
          break
        case "rollerSmg":
          // Tight high-cadence ink-roller pop
          v.hiss(0.06, 0.16, 2400, 1.8)
          v.tone("square", 260, 130, 0.05, 0.11)
          break
        case "broadside":
          // Chunky heavy wide scatter blast
          v.hiss(0.24, 0.36, 680, 0.7)
          v.tone("sawtooth", 155, 42, 0.2, 0.28)
          break
        case "linecaster":
          // Signature bright resonant bolt release!
          v.tone("sine", 860, 290, 0.22, 0.22)
          v.tone("triangle", 1320, 520, 0.16, 0.15)
          v.hiss(0.08, 0.12, 3200, 2.2)
          break
        case "cursedBlock":
          // Heavy gilded breech-block boom + bell overtone
          v.hiss(0.28, 0.38, 480, 0.65)
          v.tone("sawtooth", 210, 48, 0.26, 0.3)
          v.tone("sine", 1040, 620, 0.24, 0.14)
          break
        case "pressSniper":
          v.tone("sine", 112, 28, 0.48, 0.52)
          v.hiss(0.075, 0.55, 5200, 0.9)
          v.tone("triangle", 390, 96, 0.19, 0.26)
          v.hiss(0.042, 0.25, 3200, 1.4, 0.18)
          v.tone("square", 760, 380, 0.026, 0.09, 0.20)
          return
        default:
          return
      }
      v.tone("sine", 92, 39, gunId === "rollerSmg" ? 0.08 : 0.16, 0.22)
    }, Math.min(1, volumeScale), 0.96 + Math.random() * 0.08)
  }

  public playSketchPlace(): void {
    this.playSpatial(undefined, voice => {
      voice.hiss(0.11, 0.15, 2200, 1.8)
      voice.tone("triangle", 360, 580, 0.11, 0.14)
    })
  }

  public playSketchErase(): void {
    this.playSpatial(undefined, voice => {
      voice.hiss(0.14, 0.18, 1200, 1.2)
      voice.tone("sawtooth", 420, 180, 0.14, 0.13)
    })
  }

  public playParry(): void {
    this.playSpatial(undefined, voice => {
      voice.tone("triangle", 1120, 1680, 0.12, 0.22)
      voice.tone("sine", 1840, 1320, 0.16, 0.15)
    })
  }

  public playSmokeDeploy(): void {
    this.playSpatial(undefined, voice => {
      voice.hiss(0.32, 0.22, 950, 0.6)
    })
  }

  public playBarrelBlast(pos?: Position): void {
    this.playExplosion(1, pos)
  }

  public playGrapple(): void {
    this.playSpatial(undefined, voice => {
      voice.tone("sawtooth", 280, 740, 0.15, 0.14)
    })
  }

  public playForemanWindup(): void {
    this.playSpatial(undefined, voice => {
      voice.tone("sawtooth", 180, 95, 0.38, 0.24)
      voice.tone("triangle", 260, 140, 0.26, 0.18, 0.12)
    })
  }

  public playForemanStagger(): void {
    this.playSpatial(undefined, voice => {
      voice.tone("triangle", 620, 980, 0.18, 0.22)
      voice.hiss(0.18, 0.22, 1800, 1.0)
    })
  }

  public playReload(): void {
    this.playSpatial(undefined, voice => {
      voice.tone("square", 440, 620, 0.06, 0.09)
      voice.tone("triangle", 680, 880, 0.07, 0.09, 0.11)
    })
  }

  public playHit(): void {
    this.playSpatial(undefined, voice => {
      voice.tone("triangle", 1180, 760, 0.045, 0.14)
    })
  }

  /** Sharp high double-ping: distinct from the torso hit so a headshot is audible. */
  public playHeadshot(): void {
    this.playSpatial(undefined, voice => {
      voice.tone("square", 1900, 2400, 0.05, 0.16)
      voice.tone("triangle", 2600, 3200, 0.08, 0.14, 0.045)
    })
  }

  /** Dull low thud for limb hits. */
  public playLimbHit(): void {
    this.playSpatial(undefined, voice => {
      voice.tone("triangle", 380, 220, 0.06, 0.12)
    })
  }

  public playArmorBreak(): void {
    this.playSpatial(undefined, voice => {
      voice.hiss(0.16, 0.26, 2800, 1.1)
      voice.tone("sawtooth", 920, 240, 0.15, 0.18)
    })
  }

  public playElim(): void {
    this.playSpatial(undefined, voice => {
      voice.tone("triangle", 520, 780, 0.11, 0.18)
      voice.tone("triangle", 780, 1040, 0.14, 0.16, 0.085)
    })
  }

  /** Rising two-tone chime for health booster pickup */
  public playPickup(): void {
    this.playSpatial(undefined, voice => {
      voice.tone("sine", 540, 720, 0.12, 0.22)
      voice.tone("sine", 840, 1120, 0.16, 0.24, 0.07)
    })
  }

  public playMuralRotate(): void {
    this.playSpatial(undefined, voice => {
      voice.tone("sawtooth", 290, 390, 0.18, 0.12)
      voice.tone("sawtooth", 390, 440, 0.24, 0.11, 0.16)
    })
  }

  public playKnifeSlash(hit = false, backstab = false, pos?: Position): void {
    this.playSpatial(pos, v => {
      v.hiss(0.15, 0.32, 1100, 1.4, 0, 5600, 0.032)
      v.tone("triangle", 2100, 800, 0.065, 0.075, 0.035)
      if (hit || backstab) {
        v.hiss(0.095, 0.45, 680, 0.7, 0.06)
        v.tone("triangle", 165, 41, 0.16, 0.31, 0.06)
      }
      if (backstab) {
        for (const hz of [220, 262, 330]) v.tone("triangle", hz, hz / 2, 0.36, 0.12, 0.085)
      }
    })
  }

  public playGrenadeThrow(): void {
    this.playSpatial(undefined, v => {
      v.tone("triangle", 2500, 1820, 0.066, 0.13)
      v.hiss(0.14, 0.25, 1700, 0.8, 0.055, 850, 0.018)
    })
  }

  public playGrenadeBounce(pos?: Position): void {
    this.playSpatial(pos, v => {
      v.hiss(0.018, 0.23, 2800, 0.8)
      v.tone("triangle", 1460, 1350, 0.09, 0.19)
      v.tone("sine", 3370, 3210, 0.065, 0.09)
    }, 1, 0.94 + Math.random() * 0.12)
  }

  public playExplosion(scale = 1, pos?: Position): void {
    this.playSpatial(pos, v => {
      v.hiss(0.09, 0.46, 2600, 0.65)
      v.tone("sine", 128, 27, 0.72, 0.55)
      v.tone("triangle", 185, 48, 0.42, 0.24)
      v.hiss(0.64, 0.5, 650, 0.55, 0.018, 180)
      for (let i = 0; i < 7; i++) {
        v.hiss(0.045, 0.23 / (1 + i * 0.25), 1600 + Math.random() * 3200, 1.2,
          0.09 + i * 0.055 + Math.random() * 0.03)
      }
    }, Math.min(1.5, scale))
  }

  public playSatchelPlant(pos?: Position): void {
    this.playSpatial(pos, v => {
      v.tone("triangle", 185, 55, 0.13, 0.31)
      v.hiss(0.09, 0.36, 950, 0.8)
      v.tone("sine", 1740, 2410, 0.09, 0.14, 0.14)
    })
  }

  public playSatchelBeep(pos?: Position): void {
    this.playSpatial(pos, v => v.tone("sine", 2150, 2100, 0.085, 0.19))
  }

  public playSatchelDetonate(): void {
    this.playSpatial(undefined, v => {
      v.hiss(0.022, 0.3, 3100, 1.3)
      v.tone("square", 960, 560, 0.023, 0.12, 0.038)
    })
  }

  public playBarrelSpark(pos?: Position): void {
    this.playSpatial(pos, v => {
      v.hiss(0.027, 0.24, 4200, 1)
      v.tone("sine", 3750, 1470, 0.17, 0.18)
    })
  }

  public playHurt(damage: number): void {
    this.playSpatial(undefined, v => {
      v.tone("sine", 130, 37, 0.24, 0.46)
      v.hiss(0.20, 0.38, 800, 0.85, 0.025, 2900, 0.043)
    }, damage > 0 ? 0.5 + Math.min(1, damage / 60) * 0.5 : 0)
  }

  public playScopeToggle(entering: boolean): void {
    this.playSpatial(undefined, v => {
      v.hiss(0.022, 0.12, 2600, 1.2)
      v.tone("sine", entering ? 1620 : 2040, entering ? 2040 : 1620, 0.055, 0.08)
    })
  }

  public playBossSpawn(): void {
    this.playSpatial(undefined, v => {
      v.tone("sawtooth", 72, 108, 0.65, 0.22)
      v.tone("triangle", 108, 162, 0.52, 0.21, 0.16)
    })
  }

  public playBossDown(): void {
    this.playSpatial(undefined, v => {
      v.tone("triangle", 330, 165, 0.32, 0.24)
      v.tone("sine", 220, 55, 0.65, 0.32, 0.15)
    })
  }
}
