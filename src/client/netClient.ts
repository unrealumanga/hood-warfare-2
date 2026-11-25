import type { MapId } from "../sim/maps.ts"
import type { CombatLoadout, CosmeticLoadout, MatchSnapshot, PlayerInput } from "../sim/index.ts"
import type { ClientMessage, RoomInfo, ServerMessage } from "../server/protocol.ts"

export interface NetClientHandlers {
  readonly onOpen?: () => void
  readonly onClose?: (reason: string) => void
  readonly onError?: (code: string, message: string) => void
  readonly onRoomState?: (room: RoomInfo, humanId: string, slotId: number) => void
  readonly onSnapshot?: (snapshot: MatchSnapshot, serverTimeMs: number) => void
  readonly onLatency?: (rttMs: number) => void
}

export function resolveDefaultWsUrl(): string {
  const params = new URLSearchParams(window.location.search)
  const fromQuery = params.get("ws")
  if (fromQuery && fromQuery.trim().length > 0) return fromQuery.trim()

  const envUrl = (import.meta as unknown as { readonly env?: Record<string, string | undefined> })
    .env?.["VITE_WS_URL"]
  if (envUrl && envUrl.trim().length > 0) return envUrl.trim()

  const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
  // In Vite dev (port 5173), default WS server runs on port 8787; when hosted via Node server, use same host:port!
  if (window.location.port === "5173" || window.location.port === "4173") {
    return `${proto}//${window.location.hostname}:8787`
  }
  return `${proto}//${window.location.host}`
}

export class OnlineNetClient {
  private ws: WebSocket | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private readonly handlers: NetClientHandlers

  constructor(handlers: NetClientHandlers) {
    this.handlers = handlers
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  public connect(wsUrl: string): Promise<void> {
    this.disconnect()
    return new Promise((resolve, reject) => {
      let settled = false
      let ws: WebSocket
      try {
        ws = new WebSocket(wsUrl)
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Invalid WebSocket URL."
        this.handlers.onError?.("CONNECT_FAILED", msg)
        reject(new Error(msg))
        return
      }
      this.ws = ws

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true
          ws.close()
          const msg = `Could not reach server at ${wsUrl}. Make sure the server is running.`
          this.handlers.onError?.("CONNECT_TIMEOUT", msg)
          reject(new Error(msg))
        }
      }, 4500)

      ws.addEventListener("open", () => {
        clearTimeout(timeout)
        settled = true
        this.handlers.onOpen?.()
        this.pingTimer = setInterval(() => {
          this.send({ type: "ping", t: performance.now() })
        }, 2500)
        resolve()
      })

      ws.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return
        let msg: ServerMessage
        try {
          msg = JSON.parse(event.data) as ServerMessage
        } catch {
          return
        }
        switch (msg.type) {
          case "roomState":
            this.handlers.onRoomState?.(msg.room, msg.yourHumanId, msg.yourSlotId)
            break
          case "snapshot":
            this.handlers.onSnapshot?.(msg.snapshot, msg.serverTimeMs)
            break
          case "error":
            this.handlers.onError?.(msg.code, msg.message)
            break
          case "pong":
            this.handlers.onLatency?.(Math.max(0, Math.round(performance.now() - msg.t)))
            break
        }
      })

      ws.addEventListener("error", () => {
        if (!settled) {
          clearTimeout(timeout)
          settled = true
          const msg = `Connection failed to ${wsUrl}. Check that the server is running.`
          this.handlers.onError?.("CONNECT_ERROR", msg)
          reject(new Error(msg))
        }
      })

      ws.addEventListener("close", () => {
        clearTimeout(timeout)
        if (this.pingTimer !== null) {
          clearInterval(this.pingTimer)
          this.pingTimer = null
        }
        if (this.ws === ws) {
          this.ws = null
          this.handlers.onClose?.("Disconnected from room server.")
        }
      })
    })
  }

  public disconnect(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
    if (this.ws) {
      const ws = this.ws
      this.ws = null
      try {
        ws.close()
      } catch {
        // ignore close errors
      }
    }
  }

  public send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  public createRoom(name: string, loadout: CombatLoadout, cosmetics: CosmeticLoadout, mapId?: MapId): void {
    this.send({ type: "createRoom", name, loadout, cosmetics, mapId })
  }

  public joinRoom(
    code: string,
    name: string,
    loadout: CombatLoadout,
    cosmetics: CosmeticLoadout
  ): void {
    this.send({ type: "joinRoom", code, name, loadout, cosmetics })
  }

  public startMatch(): void {
    this.send({ type: "startMatch" })
  }

  public setLoadout(loadout: CombatLoadout, cosmetics: CosmeticLoadout): void {
    this.send({ type: "setLoadout", loadout, cosmetics })
  }

  public sendInput(input: PlayerInput): void {
    this.send({ type: "input", input })
  }

  public leaveRoom(): void {
    this.send({ type: "leaveRoom" })
  }
}
