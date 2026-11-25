import type { CombatLoadout, CosmeticLoadout, CrewId, MatchSnapshot, PlayerInput } from "../sim/index.ts"

export interface RoomMemberInfo {
  readonly humanId: string
  readonly slotId: number
  readonly crew: CrewId
  readonly name: string
  readonly loadout: CombatLoadout
  readonly cosmetics: CosmeticLoadout
  readonly pendingTakeover: boolean
}

export interface RoomInfo {
  readonly code: string
  readonly status: "lobby" | "playing" | "finished"
  readonly hostHumanId: string | null
  readonly members: ReadonlyArray<RoomMemberInfo>
}

export type ClientMessage =
  | {
      readonly type: "createRoom"
      readonly name: string
      readonly loadout: CombatLoadout
      readonly cosmetics: CosmeticLoadout
    }
  | {
      readonly type: "joinRoom"
      readonly code: string
      readonly name: string
      readonly loadout: CombatLoadout
      readonly cosmetics: CosmeticLoadout
    }
  | { readonly type: "startMatch" }
  | {
      readonly type: "setLoadout"
      readonly loadout: CombatLoadout
      readonly cosmetics: CosmeticLoadout
    }
  | { readonly type: "input"; readonly input: PlayerInput }
  | { readonly type: "leaveRoom" }
  | { readonly type: "ping"; readonly t: number }

export type ServerMessage =
  | {
      readonly type: "roomState"
      readonly room: RoomInfo
      readonly yourHumanId: string
      readonly yourSlotId: number
    }
  | {
      readonly type: "snapshot"
      readonly code: string
      readonly serverTimeMs: number
      readonly snapshot: MatchSnapshot
    }
  | {
      readonly type: "error"
      readonly code: string
      readonly message: string
    }
  | {
      readonly type: "pong"
      readonly t: number
      readonly serverTimeMs: number
    }
