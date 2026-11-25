import type { MapId } from "./maps.ts"
import {
  EventFeed,
  Fighter,
  Game,
  MatchPhase,
  MatchState,
  Projectile,
  type CableCarData,
  type ConstructData,
  type ExtractionData,
  type FighterData,
  type ForemanData,
  type FoundryData,
  type HealthPickupData,
  type MatchEventItem,
  type MatchWinner,
  type MovablePropData,
  type ProjectileData,
  type SmokeCloudData
} from "./schema.ts"
import type { GameModeId } from "./data.ts"

export interface MatchSnapshot {
  readonly mapId: MapId
  readonly mode: GameModeId
  readonly anomalyEnabled: boolean
  readonly anomalyActive: boolean
  readonly anomalyTicksLeft: number
  readonly phase: "Boot" | "Playing" | "Finished"
  readonly paused: boolean
  readonly tickCount: number
  readonly remainingTicks: number
  readonly activeMuralId: 0 | 1 | 2
  readonly muralRotateTicksLeft: number
  readonly scores: readonly [number, number]
  readonly zoneStatus: "idle" | "cobalt" | "vermilion" | "contested"
  readonly winner: MatchWinner
  readonly fighters: ReadonlyArray<FighterData>
  readonly projectiles: ReadonlyArray<ProjectileData>
  readonly constructs: ReadonlyArray<ConstructData>
  readonly smokeClouds: ReadonlyArray<SmokeCloudData>
  readonly props: ReadonlyArray<MovablePropData>
  readonly cableCar: CableCarData
  readonly foreman: ForemanData | null
  readonly extraction: ExtractionData | null
  readonly foundry: FoundryData | null
  readonly healthPickup: HealthPickupData
  readonly difficulty: number
  readonly bossSlot: number
  readonly bossDefeated: boolean
  readonly events: ReadonlyArray<MatchEventItem>
}

export const ReadMatchSnapshot = Game.Inspector(
  "Hw2/ReadMatchSnapshot",
  {
    queries: {
      fighters: Game.Query({ selection: { fighter: Game.Query.read(Fighter) } }),
      projectiles: Game.Query({ selection: { projectile: Game.Query.read(Projectile) } })
    },
    resources: {
      match: Game.System.readResource(MatchState),
      feed: Game.System.readResource(EventFeed)
    },
    machines: {
      phase: Game.System.machine(MatchPhase)
    }
  },
  ({ queries, resources, machines }): MatchSnapshot => {
    const match = resources.match.get()
    const feed = resources.feed.get()

    const fighters = queries.fighters
      .each()
      .map((e) => queries.fighters.data.fighter.get(e))
      .sort((a, b) => a.slotId - b.slotId)

    const projectiles = queries.projectiles
      .each()
      .map((e) => queries.projectiles.data.projectile.get(e))
      .sort((a, b) => a.projectileId - b.projectileId)

    return {
      mapId: match.mapId,
      mode: match.mode,
      anomalyEnabled: match.anomalyEnabled,
      anomalyActive: match.anomalyActive,
      anomalyTicksLeft: match.anomalyTicksLeft,
      phase: machines.phase.get()._tag,
      paused: match.paused,
      tickCount: match.tickCount,
      remainingTicks: match.remainingTicks,
      activeMuralId: match.activeMuralId,
      muralRotateTicksLeft: match.muralRotateTicksLeft,
      scores: match.scores,
      zoneStatus: match.zoneStatus,
      winner: match.winner,
      fighters,
      projectiles,
      constructs: match.constructs,
      smokeClouds: match.smokeClouds,
      props: match.props,
      cableCar: match.cableCar,
      foreman: match.foreman,
      extraction: match.extraction,
      foundry: match.foundry,
      healthPickup: match.healthPickup,
      difficulty: match.difficulty,
      bossSlot: match.bossSlot,
      bossDefeated: match.bossDefeated,
      events: feed.items
    }
  }
)
