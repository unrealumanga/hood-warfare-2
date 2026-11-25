import { FixedLoop } from "@typeonce/ritmo"
import {
  ARMORS,
  ARMOR_IDS,
  CREWS,
  DEFAULT_COSMETICS,
  DEFAULT_LOADOUT,
  GRAPPLE_LEDGES,
  GRAPPLE_RANGE,
  GUNS,
  HATS,
  HAT_IDS,
  Intent,
  MURAL_ZONES,
  PLAYER_EYE_HEIGHT,
  PRIMARY_GUN_IDS,
  SKETCH_ANCHORS,
  SKETCH_ERASE_RANGE,
  STEP,
  SWATCHES,
  SWATCH_IDS,
  TICK_HZ,
  TOPS,
  TOP_IDS,
  makeMatchRuntime,
  readSnapshot,
  sanitizeCosmetics,
  sanitizeLoadout,
  setupSchedule,
  updateSchedule,
  type ArmorId,
  type CombatLoadout,
  type CosmeticLoadout,
  type CrewId,
  type GameModeId,
  type GunId,
  type MatchEventItem,
  type MatchRuntime,
  type MatchSnapshot,
  type PlayerInput,
  type PrimaryGunId,
  type SketchActionInput
} from "../sim/index.ts"
import type { RoomInfo } from "../server/protocol.ts"
import { SoundEngine } from "./audio.ts"
import { LockerPreviewScene } from "./lockerScene.ts"
import { OnlineNetClient, resolveDefaultWsUrl } from "./netClient.ts"
import { BellYardScene, type SketchPreviewVisual } from "./worldScene.ts"
import "./styles.css"

const STORAGE_KEY = "hw2_profile_v2"

interface SavedProfile {
  version: 2
  name: string
  loadout: CombatLoadout
  cosmetics: CosmeticLoadout
  sensitivity: number
  muted: boolean
  bankedScrap: number
  extractionsCompleted: number
  gildedUnlocked: boolean
}

function loadProfile(): SavedProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem("hw2_profile_v1")
    if (raw) {
      const p = JSON.parse(raw) as Record<string, unknown>
      return {
        version: 2,
        name:
          typeof p["name"] === "string" && p["name"].trim().length > 0
            ? p["name"].trim().slice(0, 18)
            : "Printer",
        loadout: sanitizeLoadout(p["loadout"]),
        cosmetics: sanitizeCosmetics(p["cosmetics"]),
        sensitivity:
          typeof p["sensitivity"] === "number" && p["sensitivity"] >= 0.2 && p["sensitivity"] <= 3
            ? p["sensitivity"]
            : 1.0,
        muted: Boolean(p["muted"]),
        bankedScrap:
          typeof p["bankedScrap"] === "number" && p["bankedScrap"] >= 0
            ? Math.floor(p["bankedScrap"])
            : 0,
        extractionsCompleted:
          typeof p["extractionsCompleted"] === "number" && p["extractionsCompleted"] >= 0
            ? Math.floor(p["extractionsCompleted"])
            : 0,
        gildedUnlocked: Boolean(p["gildedUnlocked"])
      }
    }
  } catch {
    // ignore storage errors
  }
  return {
    version: 2,
    name: "Printer",
    loadout: DEFAULT_LOADOUT,
    cosmetics: DEFAULT_COSMETICS,
    sensitivity: 1.0,
    muted: false,
    bankedScrap: 0,
    extractionsCompleted: 0,
    gildedUnlocked: false
  }
}

function saveProfile(profile: SavedProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
  } catch {
    // ignore storage errors
  }
}

function formatClock(ticks: number): string {
  const secs = Math.max(0, Math.ceil(ticks / TICK_HZ))
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s < 10 ? "0" : ""}${s}`
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
}

class HoodWarfareApp {
  private readonly root: HTMLElement
  private readonly viewportEl: HTMLElement
  private readonly scene: BellYardScene
  private readonly audio: SoundEngine
  private readonly net: OnlineNetClient

  private profile: SavedProfile = loadProfile()
  private mode: "title" | "offline" | "onlineLobby" | "onlineMatch" = "title"
  private wsUrl = resolveDefaultWsUrl()

  // Offline Ritmo runtime + fixed loop
  private offlineRuntime: MatchRuntime | null = null
  private stopOfflineLoop: (() => void) | null = null
  private onlineTickTimer: ReturnType<typeof setInterval> | null = null
  private titleRafId: number | null = null

  // Match & Network state
  private currentSnapshot: MatchSnapshot | null = null
  private currentRoom: RoomInfo | null = null
  private localHumanId = "local"
  private localSlotId = 0
  private rttMs: number | null = null
  private menuOpen = false
  private lockerOpen = false
  private lockerReturnTo: "title" | "menu" = "title"
  private lockerPreview: LockerPreviewScene | null = null

  // Input state (keys + mouse look + sequenced commands)
  private readonly pressedKeys = new Set<string>()
  private pointerLocked = false
  private pointerLockErrorText: string | null = null
  private mouseDown = false
  private pendingSwitchSlot: 0 | 1 | 2 = 0
  private pendingReload = false
  private sketchPreviewMode: "off" | "plank" | "barricade" = "off"
  private actionCounter = 1
  private pendingSketchAction: SketchActionInput | null = null
  private pendingEraseId = 0
  private pendingParryId = 0
  private pendingSmokeId = 0
  private pendingGrappleId = 0
  private pendingGrappleReleaseId = 0
  private selectedOfflineMode: GameModeId = "mural"
  private selectedAnomaly = false
  private selectedStakeEquip = false
  private matchRewardSettled = false
  private preCursedPrimary: PrimaryGunId = "rollerSmg"
  private localYaw = -Math.PI / 2
  private localPitch = 0
  private inputSeq = 0
  private predictedFireCooldown = 0
  private predictedWasFireHeld = false

  private readonly killfeed: Array<{
    readonly killer: string
    readonly victim: string
    readonly killerCrew: string
    readonly victimCrew: string
    readonly gun: string
    readonly zone: string | undefined
    readonly mine: boolean
    readonly expiresAt: number
  }> = []
  private hitmarkerTimeout: ReturnType<typeof setTimeout> | null = null

  // DOM References
  private readonly titleOverlay: HTMLElement
  private readonly onlineLobbyOverlay: HTMLElement
  private readonly lockerOverlay: HTMLElement
  private readonly pauseOverlay: HTMLElement
  private readonly resultOverlay: HTMLElement
  private readonly hudEl: HTMLElement
  private readonly titleErrorEl: HTMLElement
  private readonly clickLockEl: HTMLElement
  private readonly respawnBannerEl: HTMLElement

  constructor(root: HTMLElement) {
    this.root = root
    this.audio = new SoundEngine(this.profile.muted)

    this.root.innerHTML = this.buildMarkup()
    this.viewportEl = this.q("#viewport")
    this.titleOverlay = this.q("#title-overlay")
    this.onlineLobbyOverlay = this.q("#online-lobby-overlay")
    this.lockerOverlay = this.q("#locker-overlay")
    this.pauseOverlay = this.q("#pause-overlay")
    this.resultOverlay = this.q("#result-overlay")
    this.hudEl = this.q("#hud")
    this.titleErrorEl = this.q("#title-error")
    this.clickLockEl = this.q("#click-lock-hint")
    this.respawnBannerEl = this.q("#respawn-banner")

    this.scene = new BellYardScene(this.viewportEl, {
      onEvent: (ev, isLocalActor, isLocalTarget) => this.handleSimEvent(ev, isLocalActor, isLocalTarget)
    })

    this.net = new OnlineNetClient({
      onError: (_code, msg) => this.showError(msg),
      onClose: (reason) => {
        if (this.mode === "onlineLobby" || this.mode === "onlineMatch") {
          this.stopAllLoops()
          this.mode = "title"
          this.currentRoom = null
          this.currentSnapshot = null
          this.syncOverlays()
          this.showError(reason)
          this.startTitleLoop()
        }
      },
      onRoomState: (room, humanId, slotId) => {
        this.currentRoom = room
        this.localHumanId = humanId
        this.localSlotId = slotId
        this.clearError()
        if (room.status === "playing") {
          if (this.mode !== "onlineMatch") {
            this.enterOnlineMatch()
          }
        } else if (room.status === "lobby") {
          this.mode = "onlineLobby"
          this.renderOnlineLobby()
          this.syncOverlays()
        }
      },
      onSnapshot: (snap) => {
        const isFirst = this.currentSnapshot === null
        this.currentSnapshot = snap
        this.scene.reconcileSnapshot(snap, this.localSlotId, true)
        if (isFirst) {
          const me = snap.fighters.find((f) => f.slotId === this.localSlotId)
          if (me) {
            this.localYaw = me.yaw
            this.localPitch = me.pitch
          }
        }
        this.updateHud(snap)
        if (snap.phase === "Finished") {
          this.onMatchFinished(snap)
        }
      },
      onLatency: (rtt) => {
        this.rttMs = rtt
      }
    })

    this.bindUiHandlers()
    this.bindInputHandlers()
    this.syncOverlays()

    const inspectView = new URLSearchParams(window.location.search).get("inspect")
    if (inspectView === "courtyard" || inspectView === "deck" || inspectView === "tram") {
      this.startInspectView(inspectView)
    } else {
      this.startTitleLoop()
    }
  }

  /** Deterministic eye-level visual inspection preset for Bell Yard screenshots & metrics */
  private startInspectView(view: "courtyard" | "deck" | "tram"): void {
    this.startOfflineMatch()
    if (!this.offlineRuntime) return
    // Stop live stepping so the matched inspection pose stays rock-steady while RAF renders it
    this.stopAllLoops()
    const poses = {
      courtyard: { x: 0, y: 0, z: 7.8, yaw: 0, pitch: 0.04 },
      deck: { x: -11.5, y: 3.6, z: -9.6, yaw: -1.18, pitch: -0.04 },
      tram: { x: -5.4, y: 0, z: 14.0, yaw: -2.28, pitch: 0.02 }
    } as const
    const p = poses[view]
    this.localYaw = p.yaw
    this.localPitch = p.pitch
    this.pointerLockErrorText = null
    if (this.currentSnapshot) {
      const fighters = this.currentSnapshot.fighters.map((f) => {
        if (f.slotId === 0) return { ...f, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch }
        if (f.slotId === 1) return { ...f, x: -2.2, y: 0, z: 0.6, yaw: -0.8 }
        if (f.slotId === 3) return { ...f, x: 2.0, y: 0, z: -0.8, yaw: 1.9 }
        if (f.slotId === 4) return { ...f, x: 0.8, y: 3.6, z: 0.0, yaw: 1.5 }
        return f
      })
      const posed = {
        ...this.currentSnapshot,
        zoneStatus: "contested" as const,
        scores: [38, 34] as readonly [number, number],
        fighters
      }
      this.currentSnapshot = posed
      this.updateHud(posed)
      this.clickLockEl.classList.add("hidden")

      const renderInspect = () => {
        this.scene.renderFrame(posed, 0, p.yaw, p.pitch)
        const stats = this.scene.getRenderStats()
        this.viewportEl.dataset["stats"] = JSON.stringify(stats)
        this.titleRafId = requestAnimationFrame(renderInspect)
      }
      renderInspect()
    }
  }

  private q<T extends HTMLElement = HTMLElement>(selector: string): T {
    const el = this.root.querySelector<T>(selector)
    if (!el) throw new Error(`Missing DOM element ${selector}`)
    return el
  }

  private buildMarkup(): string {
    return `
      <div id="viewport"></div>

      <!-- In-Match FPS HUD -->
      <div id="hud" class="hidden">
        <div class="hud-top">
          <div class="hud-scorebar">
            <div class="score-pill cobalt"><span>COBALT</span><span id="hud-score-0" class="score-num">0</span></div>
            <div id="hud-clock" class="hud-clock">5:00</div>
            <div class="score-pill vermilion"><span id="hud-score-1" class="score-num">0</span><span>VERMILION</span></div>
          </div>
          <div id="hud-mural-pill" class="hud-mural-pill">
            <span id="hud-mural-name">PRINT SHOP COURTYARD</span>
            <span id="hud-mural-timer">0:45</span>
            <span id="hud-mural-state">NEUTRAL</span>
          </div>
        </div>

        <div class="hud-right-top">
          <div id="hud-mode-badge" class="hud-badge">OFFLINE · 1P + 5 BOTS</div>
          <div id="hud-killfeed"></div>
        </div>

        <div class="crosshair"></div>
        <div id="hitmarker" class="hitmarker"></div>
        <div id="hit-floaters" class="hit-floaters"></div>
        <div id="hud-reticle-tag" class="hud-reticle-tag hidden"></div>

        <div class="hud-abilities">
          <div id="chip-sketch" class="ability-chip">[Q] SKETCH 1/1</div>
          <div id="chip-parry" class="ability-chip">[F] PARRY</div>
          <div id="chip-smoke" class="ability-chip">[G] SMOKE</div>
          <div id="chip-grapple" class="ability-chip">[C/RMB] GRAPPLE</div>
        </div>

        <div class="hud-vitals">
          <div class="vital-row"><span>HEALTH</span><span id="hud-hp-val">100</span></div>
          <div class="bar-track"><div id="hud-hp-bar" class="bar-fill hp" style="width:100%"></div></div>
          <div class="vital-row"><span id="hud-armor-label">LIGHT ARMOR</span><span id="hud-armor-val">25</span></div>
          <div class="bar-track" style="margin-bottom:0"><div id="hud-armor-bar" class="bar-fill armor" style="width:100%"></div></div>
        </div>

        <div class="hud-weapon">
          <div id="hud-weapon-name" class="weapon-name">ROLLER SMG</div>
          <div id="hud-ammo-val" class="ammo-big">30 / 30</div>
          <div id="hud-reload-hint" class="slot-hint">[1] PRIMARY · [2] PROOF PISTOL · [R] RELOAD</div>
        </div>

        <div id="respawn-banner" class="hud-banner hidden"></div>
        <div id="click-lock-hint" class="click-lock-hint hidden">CLICK VIEWPORT TO AIM · [ESC] MENU</div>
      </div>

      <!-- Title Screen -->
      <div id="title-overlay" class="ink-overlay">
        <div class="ink-card">
          <h1 class="ink-title">Hood Warfare 2</h1>
          <p class="ink-subtitle">Bell Yard Printworks · 3v3 Mural Control · Inkline 3D FPS</p>

          <div class="ink-row" style="margin-bottom:12px">
            <label style="font-size:12px;font-weight:700">CALLSIGN</label>
            <input id="player-name-input" class="ink-input" maxlength="18" value="${this.profile.name}" style="width:180px" />
            <button id="btn-open-locker" class="ink-btn">Locker &amp; Loadout</button>
          </div>

          <div class="title-grid">
            <div class="mode-box">
              <div class="ink-section-label" style="margin-top:0">Local Arcade &amp; Solo Modes</div>
              <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
                <select id="offline-mode-select" class="ink-input" style="flex:1;font-size:12px;padding:6px 8px">
                  <option value="mural">3v3 Mural Control (Bell Yard)</option>
                  <option value="eliteDuel">Elite Duel · Shielded Foreman</option>
                  <option value="extraction">Solo Extraction · Press Vault</option>
                  <option value="foundry">3v3 Foundry Skirmish · Siege Press</option>
                </select>
              </div>
              <div style="display:flex;gap:12px;font-size:11px;margin-bottom:8px;flex-wrap:wrap">
                <label><input id="opt-anomaly" type="checkbox" /> Low-Gravity Courtyard</label>
                <label id="stake-wrap" style="display:none"><input id="opt-stake" type="checkbox" /> Stake Loadout</label>
                <span id="banked-scrap-label" style="color:var(--cobalt);font-weight:700">Banked Scrap: ${this.profile.bankedScrap}</span>
              </div>
              <button id="btn-play-offline" class="ink-btn primary" style="width:100%">Play Offline</button>
            </div>

            <div class="mode-box">
              <div class="ink-section-label" style="margin-top:0">Authoritative Online Room (1–6 Players)</div>
              <div id="conn-status-row" class="conn-status-row">
                <span id="conn-status-text">Checking server…</span>
                <button id="btn-retry-server" class="ink-btn small" type="button">Retry</button>
              </div>
              <div style="display:flex;gap:6px;margin-bottom:8px">
                <button id="btn-create-room" class="ink-btn accent" style="flex:1">Create Room</button>
              </div>
              <div style="display:flex;gap:6px;margin-bottom:4px">
                <input id="room-code-input" class="ink-input" maxlength="6" placeholder="ROOM CODE" style="flex:1;text-transform:uppercase" />
                <button id="btn-join-room" class="ink-btn">Join Room</button>
              </div>
              <details class="ink-advanced">
                <summary>Advanced connection settings</summary>
                <input id="ws-url-input" class="ink-input" value="${this.wsUrl}" placeholder="ws://localhost:8787" style="width:100%;font-size:11px;padding:6px 8px" />
              </details>
            </div>
          </div>

          <div id="title-error" class="ink-error hidden"></div>

          <div class="ink-divider"></div>
          <div style="font-size:11px;color:var(--ink);display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">
            <span>WASD Move · LMB Fire · R Reload · Space Jump · 1/2 Guns · Q Sketch · E Erase · F Parry · G Smoke · C/RMB Grapple</span>
            <span>First to 100 pts or 5:00 · 45s Mural Rotation</span>
          </div>
        </div>
      </div>

      <!-- Online Room Lobby -->
      <div id="online-lobby-overlay" class="ink-overlay hidden">
        <div class="ink-card" style="max-width:620px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px">
            <h2 class="ink-title" style="font-size:22px">Room <span id="lobby-code">----</span></h2>
            <span style="font-size:12px;color:var(--ink)">Bots fill all remaining slots up to 3v3</span>
          </div>
          <div id="lobby-roster" class="roster-grid"></div>
          <div class="ink-row" style="justify-content:space-between;margin-top:12px">
            <div class="ink-row">
              <button id="btn-lobby-locker" class="ink-btn">Locker &amp; Loadout</button>
              <button id="btn-lobby-leave" class="ink-btn">Leave Room</button>
            </div>
            <button id="btn-lobby-start" class="ink-btn primary">Start Match</button>
          </div>
        </div>
      </div>

      <!-- Locker & Loadout Drawer (Rotating 3D Preview) -->
      <div id="locker-overlay" class="ink-overlay hidden">
        <div class="ink-card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <h2 class="ink-title" style="font-size:22px">Locker &amp; Loadout</h2>
              <p class="ink-subtitle" style="margin-bottom:8px">All weapons, armor &amp; outfits unlocked · Changes apply on next spawn</p>
            </div>
            <button id="btn-close-locker" class="ink-btn primary">Done</button>
          </div>
          <div class="locker-grid">
            <div>
              <div id="locker-preview-wrap" class="locker-canvas-wrap"></div>
              <div id="locker-summary" style="font-size:11px;margin-top:8px;line-height:1.45;color:var(--ink)"></div>
            </div>
            <div id="locker-controls"></div>
          </div>
        </div>
      </div>

      <!-- Escape Pause / In-Match Menu -->
      <div id="pause-overlay" class="ink-overlay hidden">
        <div class="ink-card" style="max-width:440px">
          <h2 id="pause-heading" class="ink-title" style="font-size:22px">Match Paused</h2>
          <p id="pause-note" class="ink-subtitle" style="margin-bottom:14px">Clock paused in offline mode</p>

          <div class="ink-section-label">Mouse Sensitivity: <span id="sens-val">${this.profile.sensitivity.toFixed(2)}</span></div>
          <input id="sens-slider" type="range" min="0.25" max="2.5" step="0.05" value="${this.profile.sensitivity}" style="width:100%;margin-bottom:12px" />

          <div class="ink-row" style="margin-bottom:14px">
            <button id="btn-toggle-mute" class="ink-btn">${this.profile.muted ? "Unmute Audio" : "Mute Audio"}</button>
            <button id="btn-pause-locker" class="ink-btn">Loadout &amp; Locker</button>
          </div>

          <div class="ink-divider"></div>
          <div class="ink-row" style="justify-content:space-between">
            <button id="btn-leave-match" class="ink-btn accent">Leave Match</button>
            <button id="btn-resume-match" class="ink-btn primary">Resume</button>
          </div>
        </div>
      </div>

      <!-- Match Results -->
      <div id="result-overlay" class="ink-overlay hidden">
        <div class="ink-card" style="max-width:600px">
          <h2 id="result-heading" class="ink-title">Match Complete</h2>
          <p id="result-sub" class="ink-subtitle"></p>
          <div id="result-board" class="roster-grid"></div>
          <div class="ink-row" style="justify-content:space-between;margin-top:14px">
            <button id="btn-result-title" class="ink-btn">Title Screen</button>
            <button id="btn-result-again" class="ink-btn primary">Play Again</button>
          </div>
        </div>
      </div>
    `
  }

  private bindUiHandlers(): void {
    const nameInput = this.q<HTMLInputElement>("#player-name-input")
    nameInput.addEventListener("change", () => {
      const cleaned = nameInput.value.trim().slice(0, 18) || "Printer"
      nameInput.value = cleaned
      this.profile.name = cleaned
      saveProfile(this.profile)
    })

    const wsInput = this.q<HTMLInputElement>("#ws-url-input")
    wsInput.addEventListener("change", () => {
      this.wsUrl = wsInput.value.trim() || resolveDefaultWsUrl()
      void this.probeOnlineServer()
    })

    this.q("#btn-retry-server").addEventListener("click", () => {
      this.wsUrl = wsInput.value.trim() || resolveDefaultWsUrl()
      void this.probeOnlineServer()
    })
    void this.probeOnlineServer()

    const modeSelect = this.q<HTMLSelectElement>("#offline-mode-select")
    const stakeWrap = this.q("#stake-wrap")
    modeSelect.addEventListener("change", () => {
      this.selectedOfflineMode = modeSelect.value as GameModeId
      stakeWrap.style.display = this.selectedOfflineMode === "extraction" ? "inline" : "none"
    })
    const optAnomaly = this.q<HTMLInputElement>("#opt-anomaly")
    optAnomaly.addEventListener("change", () => {
      this.selectedAnomaly = optAnomaly.checked
    })
    const optStake = this.q<HTMLInputElement>("#opt-stake")
    optStake.addEventListener("change", () => {
      this.selectedStakeEquip = optStake.checked
    })

    this.q("#btn-play-offline").addEventListener("click", () => {
      this.clearError()
      this.startOfflineMatch()
    })

    this.q("#btn-create-room").addEventListener("click", async () => {
      this.clearError()
      this.wsUrl = wsInput.value.trim() || resolveDefaultWsUrl()
      try {
        await this.net.connect(this.wsUrl)
        this.net.createRoom(this.profile.name, this.profile.loadout, this.profile.cosmetics)
      } catch {
        // onError displays recoverable message
      }
    })

    this.q("#btn-join-room").addEventListener("click", async () => {
      this.clearError()
      const code = this.q<HTMLInputElement>("#room-code-input").value.trim().toUpperCase()
      if (!code) {
        this.showError("Enter a room code to join.")
        return
      }
      this.wsUrl = wsInput.value.trim() || resolveDefaultWsUrl()
      try {
        await this.net.connect(this.wsUrl)
        this.net.joinRoom(code, this.profile.name, this.profile.loadout, this.profile.cosmetics)
      } catch {
        // onError displays recoverable message
      }
    })

    this.q("#btn-open-locker").addEventListener("click", () => this.openLocker("title"))
    this.q("#btn-lobby-locker").addEventListener("click", () => this.openLocker("title"))
    this.q("#btn-pause-locker").addEventListener("click", () => this.openLocker("menu"))
    this.q("#btn-close-locker").addEventListener("click", () => this.closeLocker())

    this.q("#btn-lobby-start").addEventListener("click", () => this.net.startMatch())
    this.q("#btn-lobby-leave").addEventListener("click", () => {
      this.net.leaveRoom()
      this.net.disconnect()
      this.currentRoom = null
      this.mode = "title"
      this.syncOverlays()
    })

    const sensSlider = this.q<HTMLInputElement>("#sens-slider")
    sensSlider.addEventListener("input", () => {
      this.profile.sensitivity = Number(sensSlider.value)
      this.q("#sens-val").textContent = this.profile.sensitivity.toFixed(2)
      saveProfile(this.profile)
    })

    this.q("#btn-toggle-mute").addEventListener("click", () => {
      this.profile.muted = !this.profile.muted
      this.audio.setMuted(this.profile.muted)
      this.q("#btn-toggle-mute").textContent = this.profile.muted ? "Unmute Audio" : "Mute Audio"
      saveProfile(this.profile)
    })

    this.q("#btn-resume-match").addEventListener("click", () => {
      this.setMenuOpen(false)
      this.requestPointerLock()
    })

    this.q("#btn-leave-match").addEventListener("click", () => this.leaveToTitle())
    this.q("#btn-result-title").addEventListener("click", () => this.leaveToTitle())
    this.q("#btn-result-again").addEventListener("click", () => {
      if (this.mode === "offline") {
        this.startOfflineMatch()
      } else if (this.mode === "onlineMatch") {
        this.net.startMatch()
      }
    })

    this.clickLockEl.addEventListener("click", () => this.requestPointerLock())
  }

  private bindInputHandlers(): void {
    // Note: Do NOT call e.preventDefault() on window keydown to satisfy ritmo/use-keyboard-for-game-keys!
    window.addEventListener("keydown", (e) => {
      if (document.activeElement instanceof HTMLInputElement) return
      const code = e.code
      this.pressedKeys.add(code)

      if (this.mode === "offline" || this.mode === "onlineMatch") {
        if (code === "Digit1") this.pendingSwitchSlot = 1
        else if (code === "Digit2") this.pendingSwitchSlot = 2
        else if (code === "KeyR") this.pendingReload = true
        else if (code === "KeyQ") {
          // Cycle Sketch preview: off -> plank (anchor or free) -> barricade -> off
          this.sketchPreviewMode =
            this.sketchPreviewMode === "off"
              ? "plank"
              : this.sketchPreviewMode === "plank"
                ? "barricade"
                : "off"
          this.updateSketchPreviewVisual()
        } else if (code === "KeyE") {
          this.pendingEraseId = ++this.actionCounter
        } else if (code === "KeyF") {
          this.pendingParryId = ++this.actionCounter
        } else if (code === "KeyG") {
          this.pendingSmokeId = ++this.actionCounter
        } else if (code === "KeyC") {
          const me = this.currentSnapshot?.fighters.find((f) => f.slotId === this.localSlotId)
          if (me?.grapple) this.pendingGrappleReleaseId = ++this.actionCounter
          else this.pendingGrappleId = ++this.actionCounter
        } else if (code === "Escape") {
          if (this.sketchPreviewMode !== "off") {
            this.sketchPreviewMode = "off"
            this.scene.setSketchPreview(null)
          } else if (this.lockerOpen) {
            this.closeLocker()
          } else if (!this.pointerLocked) {
            this.setMenuOpen(!this.menuOpen)
          }
        }
      }
    })

    window.addEventListener("keyup", (e) => {
      this.pressedKeys.delete(e.code)
    })

    window.addEventListener("blur", () => {
      this.pressedKeys.clear()
      this.mouseDown = false
    })

    this.viewportEl.addEventListener("contextmenu", (e) => {
      if (this.mode === "offline" || this.mode === "onlineMatch") e.preventDefault()
    })

    this.viewportEl.addEventListener("mousedown", (e) => {
      if (this.mode !== "offline" && this.mode !== "onlineMatch") return
      if (this.menuOpen || this.lockerOpen) return
      // Initial click only captures pointer lock — never fires or consumes ammo/sketch charges!
      if (!this.pointerLocked) {
        this.requestPointerLock()
        return
      }
      if (e.button === 2) {
        const me = this.currentSnapshot?.fighters.find((f) => f.slotId === this.localSlotId)
        if (me?.grapple) this.pendingGrappleReleaseId = ++this.actionCounter
        else this.pendingGrappleId = ++this.actionCounter
        return
      }
      if (e.button === 0) {
        if (this.sketchPreviewMode !== "off") {
          const preview = this.computeSketchPreview()
          if (preview && preview.valid) {
            this.pendingSketchAction = {
              kind: preview.actionKind,
              anchorId: preview.anchorId,
              actionId: ++this.actionCounter
            }
            this.sketchPreviewMode = "off"
            this.scene.setSketchPreview(null)
          }
          return
        }
        this.mouseDown = true
      }
    })

    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouseDown = false
    })

    window.addEventListener("mousemove", (e) => {
      if (!this.pointerLocked || this.menuOpen || this.lockerOpen) return
      const sens = 0.0022 * this.profile.sensitivity
      this.localYaw -= e.movementX * sens
      this.localPitch = Math.max(-1.4, Math.min(1.4, this.localPitch - e.movementY * sens))
    })

    document.addEventListener("pointerlockerror", () => {
      this.pointerLockErrorText = "Pointer lock blocked — click viewport again or press Esc"
      this.updatePointerLockHint()
    })

    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === this.viewportEl
      if (!this.pointerLocked) {
        this.mouseDown = false
        if (
          (this.mode === "offline" || this.mode === "onlineMatch") &&
          this.currentSnapshot?.phase === "Playing" &&
          !this.lockerOpen
        ) {
          this.setMenuOpen(true)
        }
      } else {
        this.pointerLockErrorText = null
        this.setMenuOpen(false)
      }
      this.updatePointerLockHint()
    })
  }

  private async probeOnlineServer(): Promise<void> {
    const row = this.root.querySelector<HTMLElement>("#conn-status-row")
    const text = this.root.querySelector<HTMLElement>("#conn-status-text")
    if (!row || !text) return
    row.className = "conn-status-row"
    text.textContent = "Checking online server…"
    const healthUrl = this.wsUrl
      .replace(/^wss:/i, "https:")
      .replace(/^ws:/i, "http:")
      .replace(/\/$/, "") + "/health"
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2200)
    try {
      const res = await fetch(healthUrl, { signal: controller.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      row.className = "conn-status-row ok"
      text.textContent = "Online server ready"
    } catch {
      row.className = "conn-status-row offline"
      text.textContent = "Server unavailable (Offline Play ready)"
    } finally {
      clearTimeout(timer)
    }
  }

  private requestPointerLock(): void {
    if (!this.viewportEl.requestPointerLock) {
      this.pointerLockErrorText = "Pointer lock unsupported in this browser"
      this.updatePointerLockHint()
      return
    }
    try {
      const maybePromise = this.viewportEl.requestPointerLock() as unknown
      if (maybePromise && typeof (maybePromise as Promise<unknown>).catch === "function") {
        ;(maybePromise as Promise<unknown>).catch(() => {
          this.pointerLockErrorText = "Pointer lock rejected — click viewport again to aim"
          this.updatePointerLockHint()
        })
      }
    } catch {
      this.pointerLockErrorText = "Pointer lock rejected — click viewport again to aim"
      this.updatePointerLockHint()
    }
  }

  private setMenuOpen(open: boolean): void {
    this.menuOpen = open
    if (this.mode === "offline" && this.offlineRuntime) {
      // Offline mode pauses simulation clock on Escape!
      this.offlineRuntime.send(Intent, { _tag: "SetPaused", paused: open })
    }
    this.q("#pause-heading").textContent =
      this.mode === "offline" ? "Match Paused" : "Online Menu"
    this.q("#pause-note").textContent =
      this.mode === "offline"
        ? "Simulation clock paused while menu is open"
        : "Server clock continues running while menu is open"
    this.syncOverlays()
  }

  private showError(msg: string): void {
    this.titleErrorEl.textContent = msg
    this.titleErrorEl.classList.remove("hidden")
  }

  private clearError(): void {
    this.titleErrorEl.textContent = ""
    this.titleErrorEl.classList.add("hidden")
  }

  private stopAllLoops(): void {
    if (this.titleRafId !== null) {
      cancelAnimationFrame(this.titleRafId)
      this.titleRafId = null
    }
    if (this.stopOfflineLoop !== null) {
      this.stopOfflineLoop()
      this.stopOfflineLoop = null
    }
    if (this.onlineTickTimer !== null) {
      clearInterval(this.onlineTickTimer)
      this.onlineTickTimer = null
    }
  }

  private startTitleLoop(): void {
    this.stopAllLoops()
    const loop = () => {
      this.scene.renderFrame(null, 0, 0, 0)
      this.titleRafId = requestAnimationFrame(loop)
    }
    this.titleRafId = requestAnimationFrame(loop)
  }

  private sampleLocalInput(): PlayerInput {
    const canControl = !this.menuOpen && !this.lockerOpen && this.currentSnapshot?.phase === "Playing"
    const fwd = canControl
      ? (this.pressedKeys.has("KeyW") || this.pressedKeys.has("ArrowUp") ? 1 : 0) -
        (this.pressedKeys.has("KeyS") || this.pressedKeys.has("ArrowDown") ? 1 : 0)
      : 0
    const right = canControl
      ? (this.pressedKeys.has("KeyD") || this.pressedKeys.has("ArrowRight") ? 1 : 0) -
        (this.pressedKeys.has("KeyA") || this.pressedKeys.has("ArrowLeft") ? 1 : 0)
      : 0
    const jump = canControl && this.pressedKeys.has("Space")
    const fire = canControl && this.mouseDown
    const reload = canControl && this.pendingReload
    const switchSlot = canControl ? this.pendingSwitchSlot : 0

    const sketchAction = canControl ? this.pendingSketchAction : null
    const eraseActionId = canControl ? this.pendingEraseId : 0
    const parryActionId = canControl ? this.pendingParryId : 0
    const smokeActionId = canControl ? this.pendingSmokeId : 0
    const grappleActionId = canControl ? this.pendingGrappleId : 0
    const grappleReleaseId = canControl ? this.pendingGrappleReleaseId : 0

    this.pendingReload = false
    this.pendingSwitchSlot = 0
    this.pendingSketchAction = null
    this.pendingEraseId = 0
    this.pendingParryId = 0
    this.pendingSmokeId = 0
    this.pendingGrappleId = 0
    this.pendingGrappleReleaseId = 0
    this.inputSeq += 1

    return {
      seq: this.inputSeq,
      moveForward: fwd,
      moveRight: right,
      yaw: this.localYaw,
      pitch: this.localPitch,
      jump,
      fire,
      reload,
      switchSlot,
      sketchAction,
      eraseActionId,
      parryActionId,
      smokeActionId,
      grappleActionId,
      grappleReleaseId
    }
  }

  private computeSketchPreview(): (SketchPreviewVisual & {
    readonly actionKind: SketchActionInput["kind"]
    readonly anchorId?: string
    readonly label: string
  }) | null {
    if (this.sketchPreviewMode === "off" || !this.currentSnapshot) return null
    const me = this.currentSnapshot.fighters.find((f) => f.slotId === this.localSlotId)
    if (!me || !me.alive) return null

    const sinY = Math.sin(this.localYaw)
    const cosY = Math.cos(this.localYaw)
    const cosP = Math.cos(this.localPitch)
    const sinP = Math.sin(this.localPitch)
    const aimX = -sinY * cosP
    const aimY = sinP
    const aimZ = -cosY * cosP
    const eyeY = me.y + PLAYER_EYE_HEIGHT

    if (this.sketchPreviewMode === "plank") {
      // Prefer aimed Sketch Anchor pair if within range & view cone
      let bestAnchor: (typeof SKETCH_ANCHORS)[number] | null = null
      let bestDot = 0.72
      for (const a of SKETCH_ANCHORS) {
        for (const [ax, ay, az] of [
          [a.ax, a.ay, a.az],
          [a.bx, a.by, a.bz]
        ] as const) {
          const dx = ax - me.x
          const dy = ay - eyeY
          const dz = az - me.z
          const dist = Math.hypot(dx, dy, dz)
          if (dist > 14.5 || dist < 0.5) continue
          const dot = (dx * aimX + dy * aimY + dz * aimZ) / dist
          if (dot > bestDot) {
            bestDot = dot
            bestAnchor = a
          }
        }
      }
      if (bestAnchor) {
        const occupied = this.currentSnapshot.constructs.some((c) => c.anchorId === bestAnchor!.id)
        const valid = me.sketchCharges > 0 && !occupied
        return {
          kind: "plank",
          actionKind: "placeAnchor",
          anchorId: bestAnchor.id,
          valid,
          minX: bestAnchor.minX,
          maxX: bestAnchor.maxX,
          minY: bestAnchor.minY,
          maxY: bestAnchor.maxY,
          minZ: bestAnchor.minZ,
          maxZ: bestAnchor.maxZ,
          label: valid
            ? `LMB PLACE PLANK · ${bestAnchor.label} (COST 1)`
            : occupied
              ? "ANCHOR OCCUPIED · [Q] BARRICADE / [ESC] CANCEL"
              : "NO SKETCH CHARGE (0/1)"
        }
      }
      // Increment 1: Free ink plank placement ahead
      const cx = Math.max(-24, Math.min(24, me.x - sinY * 2.8))
      const cz = Math.max(-15.5, Math.min(18.5, me.z - cosY * 2.8))
      const overlaps = this.currentSnapshot.constructs.some(
        (c) => cx + 1.1 > c.minX && cx - 1.1 < c.maxX && cz + 1.4 > c.minZ && cz - 1.4 < c.maxZ && Math.abs(me.y - c.maxY) < 0.8
      )
      const valid = me.sketchCharges > 0 && !overlaps
      return {
        kind: "plank",
        actionKind: "placeFree",
        valid,
        minX: cx - 1.2,
        maxX: cx + 1.2,
        minY: me.y - 0.24,
        maxY: me.y,
        minZ: cz - 1.6,
        maxZ: cz + 1.6,
        label: valid
          ? "LMB FREE INK PLANK (COST 1) · [Q] BARRICADE"
          : "BLOCKED / NO CHARGE · [ESC] CANCEL"
      }
    }

    // Increment 2: Waist-high temporary barricade sharing sketch ink budget
    const cx = Math.max(-24, Math.min(24, me.x - sinY * 2.1))
    const cz = Math.max(-15.5, Math.min(18.5, me.z - cosY * 2.1))
    const wideAlongX = Math.abs(cosY) >= Math.abs(sinY)
    const halfX = wideAlongX ? 1.15 : 0.22
    const halfZ = wideAlongX ? 0.22 : 1.15
    const valid = me.sketchCharges > 0
    return {
      kind: "barricade",
      actionKind: "placeBarricade",
      valid,
      minX: cx - halfX,
      maxX: cx + halfX,
      minY: me.y,
      maxY: me.y + 1.12,
      minZ: cz - halfZ,
      maxZ: cz + halfZ,
      label: valid
        ? "LMB PLACE BARRICADE (COST 1) · [ESC] CANCEL"
        : "NO SKETCH CHARGE (0/1)"
    }
  }

  private updateSketchPreviewVisual(): void {
    const p = this.computeSketchPreview()
    this.scene.setSketchPreview(p)
  }

  private predictLocalShotFx(input: PlayerInput): void {
    const me = this.currentSnapshot?.fighters.find((f) => f.slotId === this.localSlotId)
    if (!me || !me.alive || me.reloadTicksLeft > 0) {
      this.predictedWasFireHeld = input.fire
      return
    }
    this.predictedFireCooldown = Math.max(0, this.predictedFireCooldown - 1)
    const gunId: GunId = me.activeSlot === 1 ? me.primaryGun : "proofPistol"
    const gun = GUNS[gunId]
    const ammo = me.activeSlot === 1 ? me.primaryAmmo : me.sidearmAmmo
    const trigger = gun.automatic ? input.fire : input.fire && !this.predictedWasFireHeld
    if (trigger && this.predictedFireCooldown === 0 && ammo > 0) {
      this.predictedFireCooldown = gun.fireCooldownTicks
      const shotEventId = (this.localSlotId + 1) * 1_000_000 + (input.seq % 999_999)
      this.scene.triggerPredictedShot(shotEventId, gunId)
      this.audio.playGunshot(gunId, 1.0)
    }
    this.predictedWasFireHeld = input.fire
  }

  private startOfflineMatch(): void {
    this.stopAllLoops()
    this.scene.resetMatchState()
    this.killfeed.length = 0
    this.mode = "offline"
    this.localSlotId = 0
    this.localHumanId = "local"
    this.menuOpen = false
    this.sketchPreviewMode = "off"
    this.scene.setSketchPreview(null)
    this.matchRewardSettled = false
    this.inputSeq = 0
    this.predictedFireCooldown = 0
    if (this.profile.loadout.primary !== "cursedBlock") {
      this.preCursedPrimary = this.profile.loadout.primary
    }

    const runtime = makeMatchRuntime({
      seed: Math.floor(Math.random() * 900_000) + 1000,
      mode: this.selectedOfflineMode,
      anomalyEnabled: this.selectedAnomaly,
      equipmentStaked: this.selectedOfflineMode === "extraction" && this.selectedStakeEquip,
      initialHumans: [
        {
          slotId: 0,
          humanId: "local",
          name: this.profile.name,
          loadout: this.profile.loadout,
          cosmetics: this.profile.cosmetics
        }
      ]
    })
    const bootRes = runtime.tick(setupSchedule)
    if (!bootRes.ok) {
      this.showError(`Offline match failed to initialize: ${String(bootRes.error)}`)
      this.mode = "title"
      this.syncOverlays()
      this.startTitleLoop()
      return
    }
    this.offlineRuntime = runtime

    const snap0 = readSnapshot(runtime)
    this.currentSnapshot = snap0
    const me = snap0.fighters.find((f) => f.slotId === 0)
    if (me) {
      this.localYaw = me.yaw
      this.localPitch = me.pitch
    }

    this.syncOverlays()
    this.updateHud(snap0)

    const source = FixedLoop.source((onTick) => {
      // rAF timestamps are the frame start time and can be EARLIER than a performance.now() read
      // taken mid-frame (e.g. when Play Again is clicked). A negative delta makes FixedLoop fail with
      // InvalidTickDelta and stop for good (frozen game), so the first frame only seeds the clock.
      let last = -1
      let stopped = false
      let rafId = 0
      const frame = (now: number) => {
        if (stopped) return
        onTick({ deltaMS: last < 0 ? 0 : Math.max(0, now - last) })
        last = now
        rafId = requestAnimationFrame(frame)
      }
      rafId = requestAnimationFrame(frame)
      return {
        stop: () => {
          stopped = true
          cancelAnimationFrame(rafId)
        }
      }
    })

    const started = FixedLoop.start({
      source,
      step: STEP,
      maxFrameSeconds: 0.1,
      maxStepsPerFrame: 4,
      update: () => {
        const input = this.sampleLocalInput()
        runtime.send(Intent, { _tag: "SubmitInput", slotId: 0, input })
        const res = runtime.tick(updateSchedule)
        if (res.ok) {
          const snap = readSnapshot(runtime)
          this.currentSnapshot = snap
          this.updateHud(snap)
          if (snap.phase === "Finished") {
            this.onMatchFinished(snap)
          }
        }
        return res
      },
      render: () => {
        this.scene.renderFrame(this.currentSnapshot, 0, this.localYaw, this.localPitch)
      },
      onFailure: (failure) => {
        console.error("[hood-warfare-2] offline loop stopped:", failure)
        ;(window as unknown as { __hwFail?: unknown }).__hwFail = failure
      }
    })
    if (started.ok) {
      this.stopOfflineLoop = () => started.value.stop()
    }
    this.requestPointerLock()
  }

  private enterOnlineMatch(): void {
    this.stopAllLoops()
    this.scene.resetMatchState()
    this.killfeed.length = 0
    this.mode = "onlineMatch"
    this.menuOpen = false
    this.inputSeq = 0
    this.predictedFireCooldown = 0
    this.syncOverlays()

    // 60Hz input sampler + local prediction + server transmit
    this.onlineTickTimer = setInterval(() => {
      if (this.mode !== "onlineMatch") return
      if (this.currentSnapshot?.phase !== "Playing") return
      const input = this.sampleLocalInput()
      const me = this.currentSnapshot.fighters.find((f) => f.slotId === this.localSlotId)
      this.scene.predictLocalInput(input, me, true, this.currentSnapshot)
      this.predictLocalShotFx(input)
      this.net.sendInput(input)
    }, 1000 / TICK_HZ)

    // Smooth RAF render loop for Bell Yard 3D
    const renderLoop = () => {
      this.scene.renderFrame(
        this.currentSnapshot,
        this.localSlotId,
        this.localYaw,
        this.localPitch
      )
      this.titleRafId = requestAnimationFrame(renderLoop)
    }
    this.titleRafId = requestAnimationFrame(renderLoop)
    this.requestPointerLock()
  }

  private leaveToTitle(): void {
    if (document.pointerLockElement) {
      document.exitPointerLock()
    }
    this.stopAllLoops()
    if (this.mode === "onlineMatch" || this.mode === "onlineLobby") {
      this.net.leaveRoom()
      this.net.disconnect()
    }
    this.offlineRuntime = null
    this.currentRoom = null
    this.currentSnapshot = null
    this.mode = "title"
    this.menuOpen = false
    this.scene.resetMatchState()
    this.syncOverlays()
    this.startTitleLoop()
  }

  private onMatchFinished(snap: MatchSnapshot): void {
    if (document.pointerLockElement) {
      document.exitPointerLock()
    }
    this.menuOpen = false
    this.sketchPreviewMode = "off"
    this.scene.setSketchPreview(null)

    // Milestone 5 & 6: Settle Extraction banked scrap & Cursed Proof-Block unlock ONCE per finished match!
    if (!this.matchRewardSettled) {
      this.matchRewardSettled = true
      if (snap.mode === "extraction" && snap.extraction) {
        if (snap.extraction.extracted) {
          this.profile.bankedScrap += snap.extraction.carriedScrap
          this.profile.extractionsCompleted += 1
        } else if (snap.extraction.failed && snap.extraction.equipmentStaked) {
          // Staked non-starter gear resets to starter Roller SMG + Light Vest while starter remains available
          this.profile.loadout = { primary: "rollerSmg", armor: "light" }
        }
      }
      const me = snap.fighters.find((f) => f.slotId === this.localSlotId)
      if (me?.primaryGun === "cursedBlock") {
        this.profile.gildedUnlocked = true
        // Return to normal loadout next run automatically!
        this.profile.loadout = { ...this.profile.loadout, primary: this.preCursedPrimary }
      }
      saveProfile(this.profile)
      const scrapEl = this.root.querySelector<HTMLElement>("#banked-scrap-label")
      if (scrapEl) scrapEl.textContent = `Banked Scrap: ${this.profile.bankedScrap}`
    }

    const heading = this.q("#result-heading")
    const sub = this.q("#result-sub")
    if (snap.mode === "extraction" && snap.extraction) {
      heading.textContent = snap.extraction.extracted ? "Extraction Complete!" : "Extraction Failed"
      sub.textContent = snap.extraction.extracted
        ? `Banked +${snap.extraction.carriedScrap} Scrap (Total Banked: ${this.profile.bankedScrap})`
        : `Carried stake lost · Banked Scrap preserved: ${this.profile.bankedScrap}`
    } else if (snap.mode === "eliteDuel") {
      heading.textContent = snap.winner === 0 ? "Foreman Defeated!" : "Elite Duel Ended"
      sub.textContent = `Final Score · Cobalt ${snap.scores[0]} — ${snap.scores[1]} Vermilion`
    } else if (snap.mode === "foundry" && snap.foundry) {
      heading.textContent =
        snap.winner === 0 ? "Cobalt Colossus Press Complete!" : snap.winner === 1 ? "Vermilion Colossus Press Complete!" : "Foundry Drawn"
      sub.textContent = `Scrap Deposited · Cobalt ${snap.foundry.deposited[0]}/${snap.foundry.targetScrap} — ${snap.foundry.deposited[1]}/${snap.foundry.targetScrap} Vermilion`
    } else if (snap.winner === 0) {
      heading.textContent = "Cobalt Press Wins!"
      sub.textContent = `Final Score · Cobalt ${snap.scores[0]} — ${snap.scores[1]} Vermilion`
    } else if (snap.winner === 1) {
      heading.textContent = "Vermilion Bind Wins!"
      sub.textContent = `Final Score · Cobalt ${snap.scores[0]} — ${snap.scores[1]} Vermilion`
    } else {
      heading.textContent = "Match Drawn"
      sub.textContent = `Final Score · Cobalt ${snap.scores[0]} — ${snap.scores[1]} Vermilion`
    }

    const renderCrew = (crew: CrewId) =>
      snap.fighters
        .filter((f) => f.crew === crew)
        .map(
          (f) =>
            `<div class="roster-slot"><span>${f.name}${f.isBot ? " [BOT]" : ""}</span><span>${f.kills}K / ${f.deaths}D</span></div>`
        )
        .join("")

    this.q("#result-board").innerHTML = `
      <div class="crew-col cobalt">
        <div class="ink-section-label" style="margin-top:0;color:var(--cobalt)">Cobalt Press (${snap.scores[0]})</div>
        ${renderCrew(0)}
      </div>
      <div class="crew-col vermilion">
        <div class="ink-section-label" style="margin-top:0;color:var(--vermilion)">Vermilion Bind (${snap.scores[1]})</div>
        ${renderCrew(1)}
      </div>
    `
    this.syncOverlays()
  }

  private handleSimEvent(
    ev: MatchEventItem,
    isLocalActor: boolean,
    isLocalTarget: boolean
  ): void {
    switch (ev.kind) {
      case "shot":
        if (ev.gunId) {
          this.audio.playGunshot(ev.gunId, isLocalActor ? 1.0 : 0.35)
        }
        break
      case "reload":
        if (isLocalActor) this.audio.playReload()
        break
      case "hit":
        if (isLocalActor) {
          if (ev.zone === "head") this.audio.playHeadshot()
          else if (ev.zone === "limb") this.audio.playLimbHit()
          else this.audio.playHit()
          this.flashHitmarker(ev.zone)
          this.spawnHitFloater(ev)
        }
        break
      case "armorBreak":
        if (isLocalActor || isLocalTarget) {
          this.audio.playArmorBreak()
          if (isLocalActor) this.flashHitmarker(ev.zone)
        }
        break
      case "elim": {
        if (isLocalActor) {
          this.audio.playElim()
          if (ev.zone === "head") this.audio.playHeadshot()
          this.flashHitmarker(ev.zone)
          this.spawnHitFloater(ev)
        }
        const actor = this.currentSnapshot?.fighters.find((f) => f.slotId === ev.actorSlot)
        const target = this.currentSnapshot?.fighters.find((f) => f.slotId === ev.targetSlot)
        if (actor && target) {
          const gunName = ev.gunId ? GUNS[ev.gunId].name : "Ink"
          this.killfeed.push({
            killer: actor.name,
            victim: target.name,
            killerCrew: actor.crew === 0 ? "cobalt" : "vermilion",
            victimCrew: target.crew === 0 ? "cobalt" : "vermilion",
            gun: gunName,
            zone: ev.zone,
            mine: isLocalActor || isLocalTarget,
            expiresAt: performance.now() + 6000
          })
          if (this.killfeed.length > 6) this.killfeed.shift()
        }
        break
      }
      case "muralRotate":
        this.audio.playMuralRotate()
        break
      case "sketchPlace":
        this.audio.playSketchPlace()
        break
      case "sketchErase":
        this.audio.playSketchErase()
        break
      case "parry":
        this.audio.playParry()
        break
      case "smokeDeploy":
        this.audio.playSmokeDeploy()
        break
      case "barrelBlast":
        this.audio.playBarrelBlast()
        break
      case "grapple":
        if (isLocalActor) this.audio.playGrapple()
        break
      case "foremanWindup":
        this.audio.playForemanWindup()
        break
      case "foremanStagger":
        this.audio.playForemanStagger()
        break
      case "extractComplete":
      case "foundryDeposit":
      case "anomalyShift":
        this.audio.playMuralRotate()
        break
    }
  }

  /** Floating damage number at the point of impact: HEADSHOT (big, ochre) / torso / limb (small, grey). */
  private spawnHitFloater(ev: { readonly kind: string; readonly zone?: string; readonly damage: number; readonly x: number; readonly y: number; readonly z: number }): void {
    const host = this.q("#hit-floaters")
    const p = this.scene.projectToScreen(ev.x, ev.y, ev.z)
    if (!p.visible) return
    const el = document.createElement("div")
    const zone = ev.zone === "head" || ev.zone === "limb" ? ev.zone : "torso"
    el.className = `hit-floater ${zone}${ev.kind === "elim" ? " kill" : ""}`
    el.textContent = `${zone === "head" ? "HEADSHOT " : ""}${ev.damage}`
    el.style.left = `${Math.round(p.x)}px`
    el.style.top = `${Math.round(p.y)}px`
    host.appendChild(el)
    while (host.childElementCount > 8) host.firstElementChild?.remove()
    setTimeout(() => el.remove(), 900)
  }

  private flashHitmarker(zone?: string): void {
    const hm = this.q("#hitmarker")
    hm.classList.remove("head", "limb")
    if (zone === "head" || zone === "limb") hm.classList.add(zone)
    hm.classList.add("show")
    if (this.hitmarkerTimeout !== null) clearTimeout(this.hitmarkerTimeout)
    this.hitmarkerTimeout = setTimeout(() => hm.classList.remove("show"), 120)
  }

  private updateHud(snap: MatchSnapshot): void {
    this.q("#hud-score-0").textContent = String(snap.scores[0])
    this.q("#hud-score-1").textContent = String(snap.scores[1])
    this.q("#hud-clock").textContent = formatClock(snap.remainingTicks)

    const pill = this.q("#hud-mural-pill")
    if (snap.mode === "eliteDuel" && snap.foreman) {
      this.q("#hud-mural-name").textContent = `FOREMAN HP ${snap.foreman.hp}/${snap.foreman.maxHp}`
      this.q("#hud-mural-timer").textContent = `POSTURE ${snap.foreman.posture}/${snap.foreman.maxPosture}`
      pill.className = `hud-mural-pill ${snap.foreman.state === "windup" ? "contested" : snap.foreman.state === "staggered" ? "cobalt" : ""}`
      this.q("#hud-mural-state").textContent = snap.foreman.state.toUpperCase()
    } else if (snap.mode === "extraction" && snap.extraction) {
      this.q("#hud-mural-name").textContent = snap.extraction.vaultUnlocked
        ? "REACH TRAM EXIT"
        : `UNLOCK PRESS VAULT (${Math.round((snap.extraction.vaultProgressTicks / snap.extraction.vaultTargetTicks) * 100)}%)`
      this.q("#hud-mural-timer").textContent = `CARRIED ${snap.extraction.carriedScrap}`
      pill.className = `hud-mural-pill ${snap.extraction.vaultUnlocked ? "cobalt" : ""}`
      this.q("#hud-mural-state").textContent = `BANKED ${this.profile.bankedScrap}`
    } else if (snap.mode === "foundry" && snap.foundry) {
      this.q("#hud-mural-name").textContent = `FOUNDRY SCRAP ${snap.foundry.deposited[0]}–${snap.foundry.deposited[1]} / ${snap.foundry.targetScrap}`
      this.q("#hud-mural-timer").textContent = snap.foundry.contestedDeposit ? "CONTESTED" : "OPEN"
      pill.className = `hud-mural-pill ${snap.zoneStatus}`
      this.q("#hud-mural-state").textContent = "COLOSSUS PRESS"
    } else {
      const zone = MURAL_ZONES[snap.activeMuralId]!
      this.q("#hud-mural-name").textContent = zone.name.toUpperCase()
      this.q("#hud-mural-timer").textContent = formatClock(snap.muralRotateTicksLeft)
      pill.className = `hud-mural-pill ${snap.zoneStatus}`
      const anomalySuffix = snap.anomalyEnabled
        ? snap.anomalyActive
          ? " · LOW-G ACTIVE"
          : ` · LOW-G IN ${formatClock(snap.anomalyTicksLeft)}`
        : ""
      this.q("#hud-mural-state").textContent =
        (snap.zoneStatus === "contested"
          ? "CONTESTED · PAUSED"
          : snap.zoneStatus === "cobalt"
            ? "COBALT +1/S"
            : snap.zoneStatus === "vermilion"
              ? "VERMILION +1/S"
              : "OPEN") + anomalySuffix
    }

    const badge = this.q("#hud-mode-badge")
    if (this.mode === "offline") {
      badge.textContent = "OFFLINE · 1P + 5 BOTS"
    } else if (this.currentRoom) {
      const pingTxt = this.rttMs !== null ? ` · ${this.rttMs}ms` : ""
      badge.textContent = `ONLINE ROOM ${this.currentRoom.code} · ${this.currentRoom.members.length}P${pingTxt}`
    }

    const now = performance.now()
    const activeFeed = this.killfeed.filter((k) => k.expiresAt > now)
    this.q("#hud-killfeed").innerHTML = activeFeed
      .map((k) => {
        const fade = k.expiresAt - now < 800 ? " fade" : ""
        const hs = k.zone === "head" ? `<span class="kf-hs" title="Headshot">&#9678;</span>` : ""
        return (
          `<div class="killfeed-item${k.mine ? " mine" : ""}${fade}">` +
          `<span class="kf-name ${escapeHtml(k.killerCrew)}">${escapeHtml(k.killer)}</span>` +
          `<span class="kf-gun">${escapeHtml(k.gun)}</span>${hs}` +
          `<span class="kf-name ${escapeHtml(k.victimCrew)}">${escapeHtml(k.victim)}</span></div>`
        )
      })
      .join("")

    const me = snap.fighters.find((f) => f.slotId === this.localSlotId)
    if (!me) return

    this.q("#hud-hp-val").textContent = String(me.hp)
    this.q("#hud-hp-bar").style.width = `${Math.max(0, Math.min(100, me.hp))}%`
    this.q("#hud-armor-label").textContent = `${me.armorType.toUpperCase()} ARMOR`
    this.q("#hud-armor-val").textContent = `${me.armor} / ${me.maxArmor}`
    const armorPct = me.maxArmor > 0 ? (me.armor / me.maxArmor) * 100 : 0
    this.q("#hud-armor-bar").style.width = `${Math.max(0, Math.min(100, armorPct))}%`

    const gunId: GunId = me.activeSlot === 1 ? me.primaryGun : "proofPistol"
    const gun = GUNS[gunId]
    const ammo = me.activeSlot === 1 ? me.primaryAmmo : me.sidearmAmmo
    this.q("#hud-weapon-name").textContent =
      `${gun.name}${me.activeSlot === 1 ? " [1]" : " [2]"}`
    this.q("#hud-ammo-val").textContent =
      me.reloadTicksLeft > 0 ? "RELOADING..." : `${ammo} / ${gun.magSize}`
    this.q("#hud-reload-hint").textContent = `[1] ${GUNS[me.primaryGun].name} · [2] Proof Pistol · [R] Reload`

    // Update Sketch preview ghost & Ability / Reticle chips
    this.updateSketchPreviewVisual()
    const sketchPreview = this.computeSketchPreview()
    const chipSketch = this.q("#chip-sketch")
    chipSketch.textContent = `[Q] SKETCH ${me.sketchCharges}/1`
    chipSketch.className = `ability-chip ${this.sketchPreviewMode !== "off" ? "active" : ""}`

    const chipParry = this.q("#chip-parry")
    chipParry.textContent =
      me.parryTicksLeft > 0
        ? "PARRYING!"
        : me.parryCooldownTicks > 0
          ? `[F] PARRY ${(me.parryCooldownTicks / TICK_HZ).toFixed(1)}s`
          : "[F] PARRY READY"
    chipParry.className = `ability-chip ${me.parryTicksLeft > 0 ? "active" : ""}`

    const chipSmoke = this.q("#chip-smoke")
    chipSmoke.textContent =
      me.smokeCooldownTicks > 0
        ? `[G] SMOKE ${(me.smokeCooldownTicks / TICK_HZ).toFixed(0)}s`
        : "[G] INK SMOKE"

    const chipGrapple = this.q("#chip-grapple")
    chipGrapple.textContent = me.grapple
      ? "GRAPPLING (SPACE RELEASE)"
      : me.grappleCooldownTicks > 0
        ? `[C] GRAPPLE ${(me.grappleCooldownTicks / TICK_HZ).toFixed(1)}s`
        : "[C/RMB] GRAPPLE"
    chipGrapple.className = `ability-chip ${me.grapple ? "active" : ""}`

    // Context-sensitive reticle prompt (Sketch preview -> Erase opposing plank -> Grapple target)
    const reticleTag = this.q("#hud-reticle-tag")
    let tagText = ""
    if (sketchPreview) {
      tagText = sketchPreview.label
    } else {
      const canErase = snap.constructs.some((c) => {
        if (c.crew === me.crew) return false
        const cx = Math.max(c.minX, Math.min(c.maxX, me.x))
        const cy = Math.max(c.minY, Math.min(c.maxY, me.y + 0.9))
        const cz = Math.max(c.minZ, Math.min(c.maxZ, me.z))
        return Math.hypot(me.x - cx, me.y + 0.9 - cy, me.z - cz) <= SKETCH_ERASE_RANGE
      })
      if (canErase) {
        tagText = "[E] ERASE RIVAL CONSTRUCT"
      } else if (me.grappleCooldownTicks === 0 && !me.grapple) {
        const sinY = Math.sin(this.localYaw)
        const cosY = Math.cos(this.localYaw)
        const cosP = Math.cos(this.localPitch)
        const aimX = -sinY * cosP
        const aimY = Math.sin(this.localPitch)
        const aimZ = -cosY * cosP
        const eyeY = me.y + PLAYER_EYE_HEIGHT
        for (const l of GRAPPLE_LEDGES) {
          const dx = l.x - me.x
          const dy = l.y - eyeY
          const dz = l.z - me.z
          const dist = Math.hypot(dx, dy, dz)
          if (dist >= 1.5 && dist <= GRAPPLE_RANGE && (dx * aimX + dy * aimY + dz * aimZ) / dist > 0.88) {
            tagText = `[C/RMB] GRAPPLE LEDGE · ${l.label}`
            break
          }
        }
        if (!tagText) {
          for (const p of snap.props) {
            if (p.exploded) continue
            const dx = p.x - me.x
            const dy = p.y + 0.55 - eyeY
            const dz = p.z - me.z
            const dist = Math.hypot(dx, dy, dz)
            if (dist >= 1.8 && dist <= GRAPPLE_RANGE && (dx * aimX + dy * aimY + dz * aimZ) / dist > 0.88) {
              tagText = "[C/RMB] PULL PRESS BARREL"
              break
            }
          }
        }
      }
    }
    reticleTag.textContent = tagText
    reticleTag.classList.toggle("hidden", tagText.length === 0)

    // Respawn / Mid-Match Pending Takeover Banner + Spawn Loadout Switcher
    const waitingTakeover = me.pendingHumanId === this.localHumanId && me.isBot
    if (waitingTakeover) {
      this.respawnBannerEl.classList.remove("hidden")
      this.respawnBannerEl.innerHTML = `
        <div style="font-weight:800;margin-bottom:4px">JOINED ${CREWS[me.crew].name.toUpperCase()}</div>
        <div style="font-size:12px">Replacing bot ${me.name} on its next spawn...</div>
      `
    } else if (!me.alive && snap.phase === "Playing") {
      const secs = (me.respawnTicksLeft / TICK_HZ).toFixed(1)
      this.respawnBannerEl.classList.remove("hidden")
      const gunBtns = PRIMARY_GUN_IDS.map((g) => {
        const sel = this.profile.loadout.primary === g ? "selected" : ""
        return `<button class="ink-btn small ${sel}" data-spawn-gun="${g}">${GUNS[g].name}</button>`
      }).join("")
      const armorBtns = ARMOR_IDS.map((a) => {
        const sel = this.profile.loadout.armor === a ? "selected" : ""
        return `<button class="ink-btn small ${sel}" data-spawn-armor="${a}">${ARMORS[a].name}</button>`
      }).join("")
      this.respawnBannerEl.innerHTML = `
        <div style="font-weight:800;margin-bottom:6px">ELIMINATED · RESPAWNING IN ${secs}s</div>
        <div class="ink-row" style="justify-content:center;margin-bottom:6px">${gunBtns}</div>
        <div class="ink-row" style="justify-content:center">${armorBtns}</div>
      `
      for (const btn of this.respawnBannerEl.querySelectorAll<HTMLButtonElement>("[data-spawn-gun]")) {
        btn.onclick = () => {
          this.profile.loadout = {
            ...this.profile.loadout,
            primary: btn.dataset["spawnGun"] as PrimaryGunId
          }
          this.pushLoadoutUpdate()
        }
      }
      for (const btn of this.respawnBannerEl.querySelectorAll<HTMLButtonElement>("[data-spawn-armor]")) {
        btn.onclick = () => {
          this.profile.loadout = {
            ...this.profile.loadout,
            armor: btn.dataset["spawnArmor"] as ArmorId
          }
          this.pushLoadoutUpdate()
        }
      }
    } else {
      this.respawnBannerEl.classList.add("hidden")
    }

    this.updatePointerLockHint()
  }

  private updatePointerLockHint(): void {
    const show =
      (this.mode === "offline" || this.mode === "onlineMatch") &&
      !this.pointerLocked &&
      !this.menuOpen &&
      !this.lockerOpen &&
      this.currentSnapshot?.phase === "Playing"
    this.clickLockEl.textContent =
      this.pointerLockErrorText ?? "CLICK VIEWPORT TO AIM · [ESC] MENU"
    this.clickLockEl.classList.toggle("hidden", !show)
  }

  private renderOnlineLobby(): void {
    const room = this.currentRoom
    if (!room) return
    this.q("#lobby-code").textContent = room.code

    const renderCrew = (crew: CrewId) => {
      const start = crew === 0 ? 0 : 3
      let html = ""
      for (let s = start; s < start + 3; s++) {
        const m = room.members.find((x) => x.slotId === s)
        if (m) {
          const tag = m.humanId === room.hostHumanId ? " [HOST]" : ""
          html += `<div class="roster-slot"><strong>${m.name}${tag}</strong><span>${GUNS[m.loadout.primary].name}</span></div>`
        } else {
          html += `<div class="roster-slot" style="color:var(--ink)"><span>Bot Slot</span><span>Auto-Fill</span></div>`
        }
      }
      return html
    }

    this.q("#lobby-roster").innerHTML = `
      <div class="crew-col cobalt">
        <div class="ink-section-label" style="margin-top:0;color:var(--cobalt)">Cobalt Press</div>
        ${renderCrew(0)}
      </div>
      <div class="crew-col vermilion">
        <div class="ink-section-label" style="margin-top:0;color:var(--vermilion)">Vermilion Bind</div>
        ${renderCrew(1)}
      </div>
    `
  }

  private openLocker(returnTo: "title" | "menu"): void {
    this.lockerReturnTo = returnTo
    this.lockerOpen = true
    this.syncOverlays()
    this.renderLockerControls()

    const wrap = this.q("#locker-preview-wrap")
    if (!this.lockerPreview) {
      this.lockerPreview = new LockerPreviewScene(wrap)
    }
    const crew: CrewId = this.localSlotId >= 3 ? 1 : 0
    this.lockerPreview.setOutfit(
      crew,
      this.profile.cosmetics,
      this.profile.loadout.armor,
      this.profile.loadout.primary
    )
    this.lockerPreview.start()
  }

  private closeLocker(): void {
    this.lockerOpen = false
    this.lockerPreview?.stop()
    if (this.lockerReturnTo === "menu") {
      this.menuOpen = true
    }
    this.syncOverlays()
  }

  private pushLoadoutUpdate(): void {
    saveProfile(this.profile)
    if (this.mode === "offline" && this.offlineRuntime) {
      this.offlineRuntime.send(Intent, {
        _tag: "SetLoadout",
        slotId: 0,
        primary: this.profile.loadout.primary,
        armor: this.profile.loadout.armor,
        cosmetics: this.profile.cosmetics,
        immediate: false
      })
    } else if (this.mode === "onlineLobby" || this.mode === "onlineMatch") {
      this.net.setLoadout(this.profile.loadout, this.profile.cosmetics)
    }
    if (this.lockerPreview && this.lockerOpen) {
      const crew: CrewId = this.localSlotId >= 3 ? 1 : 0
      this.lockerPreview.setOutfit(
        crew,
        this.profile.cosmetics,
        this.profile.loadout.armor,
        this.profile.loadout.primary
      )
    }
  }

  private renderLockerControls(): void {
    const controls = this.q("#locker-controls")
    const primaryBtns = PRIMARY_GUN_IDS.map((id) => {
      const g = GUNS[id]
      const sel = this.profile.loadout.primary === id ? "selected" : ""
      return `<button class="ink-btn small ${sel}" data-primary="${id}">${g.name}</button>`
    }).join("")

    const armorBtns = ARMOR_IDS.map((id) => {
      const a = ARMORS[id]
      const sel = this.profile.loadout.armor === id ? "selected" : ""
      return `<button class="ink-btn small ${sel}" data-armor="${id}">${a.name}</button>`
    }).join("")

    const topBtns = TOP_IDS.map((id) => {
      const sel = this.profile.cosmetics.top === id ? "selected" : ""
      return `<button class="ink-btn small ${sel}" data-top="${id}">${TOPS[id].name}</button>`
    }).join("")

    const hatBtns = HAT_IDS.map((id) => {
      const sel = this.profile.cosmetics.hat === id ? "selected" : ""
      return `<button class="ink-btn small ${sel}" data-hat="${id}">${HATS[id].name}</button>`
    }).join("")

    const swatchBtns = SWATCH_IDS.map((id) => {
      const sw = SWATCHES[id]
      const sel = this.profile.cosmetics.swatch === id ? "selected" : ""
      return `<button class="ink-btn small ${sel}" data-swatch="${id}"><span class="swatch-dot" style="background:${sw.hex}"></span>${sw.name}</button>`
    }).join("")

    controls.innerHTML = `
      <div class="ink-section-label" style="margin-top:0">Primary Weapon (+ Proof Pistol Sidearm)</div>
      <div class="ink-row">${primaryBtns}</div>

      <div class="ink-section-label">Armor Vest</div>
      <div class="ink-row">${armorBtns}</div>

      <div class="ink-section-label">Top Garment</div>
      <div class="ink-row">${topBtns}</div>

      <div class="ink-section-label">Headwear</div>
      <div class="ink-row">${hatBtns}</div>

      <div class="ink-section-label">Inkline Fabric Swatch</div>
      <div class="ink-row">${swatchBtns}</div>
    `

    const gDef = GUNS[this.profile.loadout.primary]
    const aDef = ARMORS[this.profile.loadout.armor]
    this.q("#locker-summary").innerHTML = `
      <strong>${gDef.name}</strong>: ${gDef.description}<br/>
      <strong>${aDef.name}</strong>: ${aDef.description}<br/>
      <strong>Sidearm</strong>: ${GUNS.proofPistol.description}
    `

    for (const btn of controls.querySelectorAll<HTMLButtonElement>("[data-primary]")) {
      btn.onclick = () => {
        this.profile.loadout = {
          ...this.profile.loadout,
          primary: btn.dataset["primary"] as PrimaryGunId
        }
        this.pushLoadoutUpdate()
        this.renderLockerControls()
      }
    }
    for (const btn of controls.querySelectorAll<HTMLButtonElement>("[data-armor]")) {
      btn.onclick = () => {
        this.profile.loadout = {
          ...this.profile.loadout,
          armor: btn.dataset["armor"] as ArmorId
        }
        this.pushLoadoutUpdate()
        this.renderLockerControls()
      }
    }
    for (const btn of controls.querySelectorAll<HTMLButtonElement>("[data-top]")) {
      btn.onclick = () => {
        this.profile.cosmetics = {
          ...this.profile.cosmetics,
          top: btn.dataset["top"] as CosmeticLoadout["top"]
        }
        this.pushLoadoutUpdate()
        this.renderLockerControls()
      }
    }
    for (const btn of controls.querySelectorAll<HTMLButtonElement>("[data-hat]")) {
      btn.onclick = () => {
        this.profile.cosmetics = {
          ...this.profile.cosmetics,
          hat: btn.dataset["hat"] as CosmeticLoadout["hat"]
        }
        this.pushLoadoutUpdate()
        this.renderLockerControls()
      }
    }
    for (const btn of controls.querySelectorAll<HTMLButtonElement>("[data-swatch]")) {
      btn.onclick = () => {
        this.profile.cosmetics = {
          ...this.profile.cosmetics,
          swatch: btn.dataset["swatch"] as CosmeticLoadout["swatch"]
        }
        this.pushLoadoutUpdate()
        this.renderLockerControls()
      }
    }
  }

  private syncOverlays(): void {
    const inMatch = this.mode === "offline" || this.mode === "onlineMatch"
    const finished = inMatch && this.currentSnapshot?.phase === "Finished"

    this.titleOverlay.classList.toggle("hidden", this.mode !== "title" || this.lockerOpen)
    this.onlineLobbyOverlay.classList.toggle("hidden", this.mode !== "onlineLobby" || this.lockerOpen)
    this.lockerOverlay.classList.toggle("hidden", !this.lockerOpen)
    this.pauseOverlay.classList.toggle(
      "hidden",
      !inMatch || !this.menuOpen || this.lockerOpen || finished
    )
    this.resultOverlay.classList.toggle("hidden", !finished)
    this.hudEl.classList.toggle("hidden", !inMatch || finished)
    this.updatePointerLockHint()
  }
}

const appRoot = document.getElementById("app")
const loadingEl = document.getElementById("loading")

if (appRoot) {
  try {
    new HoodWarfareApp(appRoot)
    if (loadingEl) {
      loadingEl.classList.add("done")
      setTimeout(() => loadingEl.remove(), 350)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[hood-warfare-2] startup error:", err)
    if (loadingEl) {
      loadingEl.innerHTML = `<b>HOOD WARFARE 2 · STARTUP ERROR</b><span style="max-width:480px;text-align:center;color:#b04a39">${msg}</span>`
    }
  }
}
