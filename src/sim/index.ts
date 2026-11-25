import { Clock, type Debug, Random } from "@typeonce/ritmo"
import type { GameModeId } from "./data.ts"
import { ReadMatchSnapshot, type MatchSnapshot } from "./inspectors.ts"
import { Game, MatchPhase, STEP, type InitialHumanSpec } from "./schema.ts"
import {
  AdvanceClock,
  BootstrapMatch,
  HandleIntents,
  RunBotAI,
  StepCombatAndMatch,
  makeDefaultMatchState
} from "./systems.ts"

export const setupSchedule = Game.Schedule(
  BootstrapMatch,
  Game.Schedule.applyDeferred(),
  Game.Schedule.applyStateTransitions()
)

export const updateSchedule = Game.Schedule(
  AdvanceClock,
  HandleIntents,
  Game.Schedule.applyDeferred(),
  Game.Schedule.applyStateTransitions(),
  BootstrapMatch,
  Game.Schedule.applyDeferred(),
  Game.Schedule.applyStateTransitions(),
  RunBotAI,
  StepCombatAndMatch,
  Game.Schedule.applyDeferred(),
  Game.Schedule.applyStateTransitions()
)

export interface MakeMatchOptions {
  readonly seed?: number
  readonly mode?: GameModeId
  readonly anomalyEnabled?: boolean
  readonly totalSlots?: number
  readonly equipmentStaked?: boolean
  readonly difficulty?: number
  readonly initialHumans?: ReadonlyArray<InitialHumanSpec> | null
  readonly debug?: Debug.Option
}

export function makeMatchRuntime(options: MakeMatchOptions = {}) {
  const seed = options.seed ?? 1894
  const made = Game.Runtime.make({
    services: Game.Runtime.services(),
    resources: {
      Time: Clock.start(STEP),
      Rng: Random.seed(seed),
      MatchState: makeDefaultMatchState(options.initialHumans ?? null, {
        mode: options.mode,
        anomalyEnabled: options.anomalyEnabled,
        totalSlots: options.totalSlots,
        equipmentStaked: options.equipmentStaked,
        difficulty: options.difficulty
      }),
      EventFeed: { items: [] },
      InputQueue: { bySlot: {} }
    },
    machines: Game.Runtime.machines(
      Game.Runtime.machine(MatchPhase, { _tag: "Boot" })
    ),
    debug: options.debug
  })
  if (!made.ok) {
    throw new Error(`Failed to initialize Hood Warfare 2 runtime: ${String(made.error)}`)
  }
  return made.value
}

export type MatchRuntime = ReturnType<typeof makeMatchRuntime>

export function readSnapshot(runtime: MatchRuntime): MatchSnapshot {
  return runtime.inspect(ReadMatchSnapshot)
}

export * from "./data.ts"
export * from "./map.ts"
export * from "./physics.ts"
export * from "./schema.ts"
export * from "./systems.ts"
export * from "./inspectors.ts"
