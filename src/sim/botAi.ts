import { Ops, type Random } from "@typeonce/ritmo"
import {
  BOT_SEEK_HEALTH_HP,
  GUNS,
  PLAYER_CROUCH_HEIGHT,
  PLAYER_EYE_HEIGHT,
  botSkill,
  type CrewId,
  type GunId
} from "./data.ts"
import { findNearestWaypoint, muralWaypointId } from "./map.ts"
import type { MapBox } from "./map.ts"
import type { MapDef } from "./maps.ts"
import { hasLineOfSight, sweepSegmentVsWorld, type SmokeGridLike } from "./physics.ts"

export type BotRole = "breacher" | "flanker" | "anchor"

export interface BotBrainState {
  readonly role: BotRole
  readonly targetWp: number
  readonly wpPatienceTicks: number
  readonly recentWps: ReadonlyArray<number>
  readonly bannedWp: number
  readonly bannedWpTicks: number
  readonly checkX: number
  readonly checkZ: number
  readonly checkCountdown: number
  readonly stuckCount: number
  readonly unstuckTicks: number
  readonly unstuckDir: number
  readonly strafeDir: number
  readonly strafeTicks: number
  readonly alert: number
  readonly memoryTicks: number
  readonly lastSeenX: number
  readonly lastSeenY: number
  readonly lastSeenZ: number
  readonly reactionTicks: number
  readonly suppression: number
  readonly grenadeCooldownTicks: number
  readonly lastHp: number
}

export function makeInitialBotBrain(slotId: number, x: number, z: number): BotBrainState {
  const roles: ReadonlyArray<BotRole> = ["breacher", "flanker", "anchor"]
  return {
    role: roles[Math.abs(slotId) % roles.length]!,
    targetWp: -1,
    wpPatienceTicks: 0,
    recentWps: [],
    bannedWp: -1,
    bannedWpTicks: 0,
    checkX: x,
    checkZ: z,
    checkCountdown: 14,
    stuckCount: 0,
    unstuckTicks: 0,
    unstuckDir: slotId % 2 === 0 ? 1 : -1,
    strafeDir: slotId % 2 === 0 ? 1 : -1,
    strafeTicks: 38 + (slotId % 5) * 11,
    alert: 0,
    memoryTicks: 9999,
    lastSeenX: x,
    lastSeenY: 0,
    lastSeenZ: z,
    reactionTicks: 0,
    suppression: 0,
    grenadeCooldownTicks: 180 + (slotId % 4) * 60,
    lastHp: 100
  }
}

export interface BotHazard {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly radius: number
}

export interface BotCandidateFighter {
  readonly slotId: number
  readonly crew: CrewId
  readonly alive: boolean
  readonly x: number
  readonly y: number
  readonly z: number
  readonly vx: number
  readonly vz: number
  readonly yaw: number
  readonly hp: number
  readonly crouching: boolean
  readonly isBoss: boolean
  readonly activeSlot: 1 | 2 | 3
  readonly primaryGun: GunId
  readonly primaryAmmo: number
  readonly sidearmAmmo: number
  readonly reloadTicksLeft: number
  readonly wasFireHeld: boolean
  readonly grounded: boolean
  readonly carryingScrap: number
  readonly grenadeCooldownTicks: number
  readonly meleeCooldownTicks: number
  readonly brain: BotBrainState
}

export interface BotDecisionContext {
  readonly bot: BotCandidateFighter
  readonly allFighters: ReadonlyArray<BotCandidateFighter>
  readonly map: MapDef
  readonly mode: "mural" | "eliteDuel" | "extraction" | "foundry"
  readonly activeMuralId: 0 | 1 | 2
  readonly healthPickup: { readonly x: number; readonly y: number; readonly z: number; readonly available: boolean }
  readonly extractionUnlocked: boolean
  readonly foundryPiles: ReadonlyArray<{ readonly x: number; readonly y: number; readonly z: number; readonly available: boolean }>
  readonly dynamicSolids: ReadonlyArray<MapBox>
  readonly dynamicEdges: ReadonlyArray<readonly [number, number]>
  readonly smokeClouds: ReadonlyArray<SmokeGridLike>
  readonly hazards: ReadonlyArray<BotHazard>
  readonly skillLevel: number
  readonly random: Random.Random
}

export interface BotDecisionOutput {
  readonly moveForward: number
  readonly moveRight: number
  readonly yaw: number
  readonly pitch: number
  readonly jump: boolean
  readonly crouch: boolean
  readonly ads: boolean
  readonly fire: boolean
  readonly reload: boolean
  readonly switchSlot: 0 | 1 | 2 | 3
  readonly triggerGrenade: boolean
  readonly triggerMelee: boolean
  readonly nextBrain: BotBrainState
}

const FOV_COS = Ops.cos((135 * Math.PI) / 180 / 2)
const MEMORY_MAX_TICKS = 210 // 3.5 seconds of target persistence
const STUCK_CHECK_INTERVAL = 12
const STUCK_MIN_MOVE = 0.32
const WP_PATIENCE = 140

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function activeGunOf(bot: BotCandidateFighter): GunId {
  return bot.activeSlot === 2 ? "proofPistol" : bot.primaryGun
}

function pushRecentWp(list: ReadonlyArray<number>, wpId: number): ReadonlyArray<number> {
  if (list[list.length - 1] === wpId) return list
  const next = [...list, wpId]
  return next.length > 5 ? next.slice(next.length - 5) : next
}

/**
 * Deterministic weighted Dijkstra path step.
 * Adds role bias, recency visit penalties, hazard avoidance, and per-slot lane diversity
 * so bots NEVER march in predictable single-file circles!
 */
function chooseNextWeightedWaypoint(
  startId: number,
  goalId: number,
  bot: BotCandidateFighter,
  brain: BotBrainState,
  map: MapDef,
  dynamicEdges: ReadonlyArray<readonly [number, number]>,
  hazards: ReadonlyArray<BotHazard>
): number {
  if (startId === goalId) return goalId
  const wps = map.waypoints
  const n = wps.length
  if (startId < 0 || startId >= n || goalId < 0 || goalId >= n) return goalId

  const dist = Array.from({ length: n }, () => 1e9)
  const firstStep = Array.from({ length: n }, () => -1)
  const used = Array.from({ length: n }, () => false)
  dist[startId] = 0

  const getNeighbors = (id: number): Array<number> => {
    const wp = wps[id]
    const out = wp ? [...wp.neighbors] : []
    for (const [a, b] of dynamicEdges) {
      if (a === id) out.push(b)
      else if (b === id) out.push(a)
    }
    return out
  }

  for (let iter = 0; iter < n; iter++) {
    let u = -1
    let bestD = 1e9
    for (let i = 0; i < n; i++) {
      if (!used[i] && dist[i]! < bestD) {
        bestD = dist[i]!
        u = i
      }
    }
    if (u < 0 || u === goalId) break
    used[u] = true
    const wu = wps[u]!

    for (const v of getNeighbors(u)) {
      if (v < 0 || v >= n || used[v]) continue
      const wv = wps[v]!
      const dx = wv.x - wu.x
      const dy = (wv.y - wu.y) * 1.4
      const dz = wv.z - wu.z
      let cost = Math.max(0.5, Ops.hypot(Ops.hypot(dx, dz), dy))

      // 1. Anti-loop recency penalty (strongest on immediately visited nodes)
      const recIdx = brain.recentWps.indexOf(v)
      if (recIdx >= 0 && v !== goalId) {
        cost += 5.5 + recIdx * 2.5
      }

      // 2. Banned waypoint penalty after getting stuck
      if (v === brain.bannedWp && brain.bannedWpTicks > 0 && v !== goalId) {
        cost += 38.0
      }

      // 3. Squad role lane preferences
      if (brain.role === "flanker") {
        // Prefer outer lanes & upper decks/bridges
        if (Math.abs(wv.x) > 9 || wv.y > 1.5) cost *= 0.78
      } else if (brain.role === "anchor") {
        if (wv.y > 1.5) cost *= 0.82
      }

      // 4. Deterministic per-slot lane variation so 3 teammates split lanes cleanly
      cost += (((bot.slotId * 7 + v * 13 + brain.stuckCount * 5) % 5) * 0.85)

      // 5. Avoid active explosions / grenades / C4
      for (const hz of hazards) {
        const hd = Ops.hypot(wv.x - hz.x, wv.z - hz.z)
        if (hd < hz.radius + 1.5) cost += 22.0
      }

      const nd = dist[u]! + cost
      if (nd < dist[v]!) {
        dist[v] = nd
        firstStep[v] = u === startId ? v : firstStep[u]!
      }
    }
  }

  return firstStep[goalId] !== undefined && firstStep[goalId]! >= 0 ? firstStep[goalId]! : goalId
}

export function computeBotDecision(ctx: BotDecisionContext): BotDecisionOutput {
  const { bot, allFighters, map, mode, dynamicSolids, dynamicEdges, smokeClouds, hazards, random } = ctx
  let brain = bot.brain

  // Elite Duel quiet observer
  if (mode === "eliteDuel") {
    return {
      moveForward: 0,
      moveRight: 0,
      yaw: bot.yaw,
      pitch: 0,
      jump: false,
      crouch: false,
      ads: false,
      fire: false,
      reload: false,
      switchSlot: 0,
      triggerGrenade: false,
      triggerMelee: false,
      nextBrain: brain
    }
  }

  const tookDamage = bot.hp < brain.lastHp
  let suppression = Math.max(0, brain.suppression * 0.985 + (tookDamage ? 0.35 : 0))
  if (suppression > 1) suppression = 1

  let strafeDir = brain.strafeDir
  let strafeTicks = brain.strafeTicks - 1
  if (strafeTicks <= 0) {
    strafeDir = random.next() < 0.5 ? -1 : 1
    strafeTicks = 32 + Math.floor(random.next() * 44)
  }

  let bannedWp = brain.bannedWp
  let bannedWpTicks = Math.max(0, brain.bannedWpTicks - 1)
  if (bannedWpTicks === 0) bannedWp = -1

  let unstuckTicks = Math.max(0, brain.unstuckTicks - 1)
  let unstuckDir = brain.unstuckDir
  let stuckCount = brain.stuckCount
  let checkCountdown = brain.checkCountdown - 1
  let checkX = brain.checkX
  let checkZ = brain.checkZ

  const grenadeCooldownTicks = Math.max(0, brain.grenadeCooldownTicks - 1)
  const skill = botSkill(ctx.skillLevel)
  // Reaction delay scales smoothly with difficulty (Lv 0: 18 ticks / 0.30s -> Lv 10: 3 ticks / 0.05s)
  const reactionTarget = Math.max(3, Math.round(18 - (ctx.skillLevel / 10) * 15))

  // ── 1. Perception: Vision Cone + Proximity Hearing + Target Memory ─────
  let target: BotCandidateFighter | null = null
  let bestScore = -1e9
  let bestDist = 999
  const eyeY = bot.y + (bot.crouching && !bot.isBoss ? 0.92 : PLAYER_EYE_HEIGHT)
  const botFwdX = -Ops.sin(bot.yaw)
  const botFwdZ = -Ops.cos(bot.yaw)

  for (const other of allFighters) {
    if (!other.alive || other.crew === bot.crew) continue
    const dx = other.x - bot.x
    const ty = other.y + (other.crouching && !other.isBoss ? 0.65 * PLAYER_CROUCH_HEIGHT : 1.15)
    const dy = ty - eyeY
    const dz = other.z - bot.z
    const dist = Ops.hypot(Ops.hypot(dx, dz), dy)
    if (dist > 36) continue

    const hDist = Math.max(0.01, Ops.hypot(dx, dz))
    const dot = (dx / hDist) * botFwdX + (dz / hDist) * botFwdZ
    // 135-deg vision cone, OR 360-deg close awareness (< 7.5m) / alert / tookDamage!
    const inVision = dot >= FOV_COS || dist < 7.5 || tookDamage || brain.alert > 0.65
    if (!inVision) continue

    if (!hasLineOfSight(bot.x, eyeY, bot.z, other.x, ty, other.z, dynamicSolids, smokeClouds, map)) {
      continue
    }

    // Score target: prefer closer + wounded + active threats
    const score = 40 - dist + (100 - other.hp) * 0.12 + (other.isBoss ? 8 : 0)
    if (score > bestScore) {
      bestScore = score
      bestDist = dist
      target = other
    }
  }

  let alert = brain.alert
  let memoryTicks = Math.min(9999, brain.memoryTicks + 1)
  let lastSeenX = brain.lastSeenX
  let lastSeenY = brain.lastSeenY
  let lastSeenZ = brain.lastSeenZ
  let reactionTicks = brain.reactionTicks

  if (target !== null) {
    if (memoryTicks > 45) {
      // Fresh acquisition: brief human-like reaction window
      reactionTicks = reactionTarget
    } else if (reactionTicks > 0) {
      reactionTicks -= 1
    }
    alert = 1
    memoryTicks = 0
    lastSeenX = target.x
    lastSeenY = target.y
    lastSeenZ = target.z
  } else {
    alert = Math.max(0, alert - 0.008)
    reactionTicks = 0
  }

  // ── 2. Immediate Hazard Avoidance (Live Grenades & Planted C4) ─────────
  let fleeX = 0
  let fleeZ = 0
  let fleeingHazard = false
  for (const hz of hazards) {
    const dx = bot.x - hz.x
    const dz = bot.z - hz.z
    const d = Ops.hypot(dx, dz)
    if (d < hz.radius + 1.2 && Math.abs(bot.y - hz.y) < 3.0) {
      const inv = d > 0.05 ? 1 / d : 1
      fleeX += dx * inv
      fleeZ += dz * inv
      fleeingHazard = true
    }
  }

  // ── 3. Goal Selection (Objective / Health / Boss Hunt / Search Last Seen / Cover) ─
  let goalWpId = muralWaypointId(ctx.activeMuralId, map.waypoints)
  const activeZone = map.muralZones[ctx.activeMuralId]!

  if (mode === "extraction") {
    goalWpId = ctx.extractionUnlocked
      ? findNearestWaypoint(map.extractionExit.x, map.extractionExit.y, map.extractionExit.z, map.waypoints)
      : findNearestWaypoint(map.extractionVault.x, map.extractionVault.y, map.extractionVault.z, map.waypoints)
  } else if (mode === "foundry") {
    if (bot.carryingScrap > 0) {
      goalWpId = findNearestWaypoint(map.foundryCenter.x, map.foundryCenter.y, map.foundryCenter.z, map.waypoints)
    } else {
      let bestPileDist = 1e9
      for (const pile of ctx.foundryPiles) {
        if (!pile.available) continue
        const pd = Ops.hypot(pile.x - bot.x, pile.z - bot.z)
        if (pd < bestPileDist) {
          bestPileDist = pd
          goalWpId = findNearestWaypoint(pile.x, pile.y, pile.z, map.waypoints)
        }
      }
    }
  }

  const needsHealth = ctx.healthPickup.available && bot.hp < BOT_SEEK_HEALTH_HP
  if (bot.isBoss) {
    let huntDist = 1e9
    for (const other of allFighters) {
      if (!other.alive || other.crew === bot.crew) continue
      const d = Ops.hypot(other.x - bot.x, other.z - bot.z)
      if (d < huntDist) {
        huntDist = d
        goalWpId = findNearestWaypoint(other.x, other.y, other.z, map.waypoints)
      }
    }
  } else if (needsHealth) {
    goalWpId = findNearestWaypoint(ctx.healthPickup.x, ctx.healthPickup.y, ctx.healthPickup.z, map.waypoints)
  } else if (target === null && memoryTicks < MEMORY_MAX_TICKS && brain.role !== "anchor") {
    // Pursue enemy's last-known position instead of instantly forgetting!
    goalWpId = findNearestWaypoint(lastSeenX, lastSeenY, lastSeenZ, map.waypoints)
  } else if (mode === "mural" && brain.role === "flanker" && target === null) {
    // Flankers prefer elevated overlook waypoints near the active mural when approaching
    const curDistToGoal = Ops.hypot(activeZone.x - bot.x, activeZone.z - bot.z)
    if (curDistToGoal > 9) {
      const elevated = map.waypoints.find(
        (w) => w.y > 2.5 && Ops.hypot(w.x - activeZone.x, w.z - activeZone.z) < 16 && !brain.recentWps.includes(w.id)
      )
      if (elevated) goalWpId = elevated.id
    }
  }

  // ── 4. Waypoint Progress + Anti-Stuck Watchdog ─────────────────────────
  let targetWp = brain.targetWp
  let wpPatienceTicks = brain.wpPatienceTicks
  let recentWps = brain.recentWps

  if (targetWp >= 0 && targetWp < map.waypoints.length && wpPatienceTicks > 0) {
    const hw = map.waypoints[targetWp]!
    const hd = Ops.hypot(Ops.hypot(hw.x - bot.x, hw.z - bot.z), hw.y - bot.y)
    if (hd <= 1.05) {
      recentWps = pushRecentWp(recentWps, targetWp)
      targetWp = -1
      stuckCount = 0
    } else {
      wpPatienceTicks -= 1
    }
  } else {
    targetWp = -1
  }

  // Check if bot is physically stuck every STUCK_CHECK_INTERVAL ticks
  let triggerUnstuckJump = false
  if (checkCountdown <= 0) {
    const moved = Ops.hypot(bot.x - checkX, bot.z - checkZ)
    checkX = bot.x
    checkZ = bot.z
    checkCountdown = STUCK_CHECK_INTERVAL

    const inGoalZone =
      mode === "mural" &&
      Ops.hypot(bot.x - activeZone.x, bot.z - activeZone.z) <= activeZone.radius * 0.85 &&
      Math.abs(bot.y - activeZone.y) < 1.5

    if (!inGoalZone && moved < STUCK_MIN_MOVE) {
      stuckCount += 1
      unstuckTicks = 26
      unstuckDir = stuckCount % 2 === 0 ? 1 : -1
      triggerUnstuckJump = bot.grounded
      if (targetWp >= 0) {
        bannedWp = targetWp
        bannedWpTicks = 180
        targetWp = -1
      }
    } else {
      stuckCount = 0
    }
  }

  if (targetWp < 0) {
    const curWpId = findNearestWaypoint(bot.x, bot.y, bot.z, map.waypoints)
    targetWp = chooseNextWeightedWaypoint(curWpId, goalWpId, bot, { ...brain, recentWps, bannedWp, bannedWpTicks, stuckCount }, map, dynamicEdges, hazards)
    wpPatienceTicks = WP_PATIENCE
  }

  const nextWp = map.waypoints[targetWp] ?? map.waypoints[0]!
  const insideZone =
    mode === "mural" &&
    !bot.isBoss &&
    !needsHealth &&
    Ops.hypot(bot.x - activeZone.x, bot.z - activeZone.z) <= activeZone.radius &&
    bot.y >= activeZone.y - 0.6 &&
    bot.y <= activeZone.y + activeZone.height

  // ── 5. Movement Vector + Dual Wall-Feeler Obstacle Avoidance ───────────
  let desiredX = nextWp.x - bot.x
  let desiredZ = nextWp.z - bot.z

  if (fleeingHazard) {
    desiredX = fleeX
    desiredZ = fleeZ
  } else if (insideZone) {
    // Dynamic zone patrol with non-repetitive angle offsets
    const patrolAngle = (bot.slotId * 2.1 + (strafeDir > 0 ? 0.6 : -0.6))
    const px = activeZone.x + Ops.cos(patrolAngle) * Math.min(2.6, activeZone.radius * 0.58)
    const pz = activeZone.z + Ops.sin(patrolAngle) * Math.min(2.6, activeZone.radius * 0.58)
    desiredX = px - bot.x
    desiredZ = pz - bot.z
  }

  const desiredDist = Ops.hypot(desiredX, desiredZ)
  let moveDirX = desiredDist > 0.35 ? desiredX / desiredDist : 0
  let moveDirZ = desiredDist > 0.35 ? desiredZ / desiredDist : 0

  // Dual feeler rays (+32° / -32°) to steer smoothly around crates, pillars, and walls!
  if (desiredDist > 0.5 && unstuckTicks === 0) {
    const travelYaw = Ops.atan2(-moveDirX, -moveDirZ)
    const probeLen = 1.25
    const probeY = bot.y + 0.85
    const lYaw = travelYaw + 0.56
    const rYaw = travelYaw - 0.56
    const hitLeft =
      sweepSegmentVsWorld(
        bot.x,
        probeY,
        bot.z,
        bot.x - Ops.sin(lYaw) * probeLen,
        probeY,
        bot.z - Ops.cos(lYaw) * probeLen,
        0.25,
        dynamicSolids,
        map
      ) !== null
    const hitRight =
      sweepSegmentVsWorld(
        bot.x,
        probeY,
        bot.z,
        bot.x - Ops.sin(rYaw) * probeLen,
        probeY,
        bot.z - Ops.cos(rYaw) * probeLen,
        0.25,
        dynamicSolids,
        map
      ) !== null

    if (hitLeft && !hitRight) {
      const steerYaw = travelYaw - 0.65
      moveDirX = -Ops.sin(steerYaw)
      moveDirZ = -Ops.cos(steerYaw)
    } else if (hitRight && !hitLeft) {
      const steerYaw = travelYaw + 0.65
      moveDirX = -Ops.sin(steerYaw)
      moveDirZ = -Ops.cos(steerYaw)
    }
  } else if (unstuckTicks > 0) {
    // Active unstuck sidestep + slight backoff to break free from any corner
    const baseYaw = desiredDist > 0.2 ? Ops.atan2(-desiredX, -desiredZ) : bot.yaw
    const escapeYaw = baseYaw + unstuckDir * 1.45
    moveDirX = -Ops.sin(escapeYaw)
    moveDirZ = -Ops.cos(escapeYaw)
  }

  // ── 6. Aiming, Lead Prediction, Firing, Knife & Grenades ───────────────
  const navYaw = Ops.hypot(moveDirX, moveDirZ) > 0.15 ? Ops.atan2(-moveDirX, -moveDirZ) : bot.yaw
  let aimYaw = navYaw
  let aimPitch = 0
  let fire = false
  let ads = false
  let crouch = false
  let triggerGrenade = false
  let triggerMelee = false
  let reload = false
  let switchSlot: 0 | 1 | 2 | 3 = 0

  const gunId = activeGunOf(bot)
  const gun = GUNS[gunId]

  if (target !== null) {
    // Simple target velocity lead for projectile travel time (scaled by skill)
    const leadFactor = clamp(bestDist / Math.max(20, gun.projectileSpeed), 0, 0.35) * (0.35 + (ctx.skillLevel / 10) * 0.65)
    const predX = target.x + target.vx * leadFactor
    const predZ = target.z + target.vz * leadFactor
    const predY = target.y + (target.crouching && !target.isBoss ? 0.65 * PLAYER_CROUCH_HEIGHT : 1.18)

    const dx = predX - bot.x
    const dy = predY - eyeY
    const dz = predZ - bot.z
    const horiz = Math.max(0.01, Ops.hypot(dx, dz))

    // Suppression widens jitter slightly so laying down fire matters!
    const errMult = 1 + suppression * 0.85
    const jitterYaw = (random.next() - 0.5) * skill.jitterYaw * errMult
    const jitterPitch = (random.next() - 0.5) * skill.jitterPitch * errMult
    aimYaw = Ops.atan2(-dx, -dz) + jitterYaw
    aimPitch = clamp(Ops.atan2(dy, horiz) + jitterPitch, -0.95, 0.95)

    // Close-quarters Commando Knife jab!
    if (bestDist <= 2.35 && bot.meleeCooldownTicks === 0 && !bot.isBoss) {
      triggerMelee = true
    } else {
      const idealRange =
        gun.id === "broadside" ? 13 : gun.id === "pressSniper" || gun.id === "linecaster" ? 34 : 26
      const maxRange = idealRange * skill.rangeScale
      if (bestDist > 11 && (gun.id === "pressSniper" || gun.id === "linecaster" || gun.id === "cursedBlock")) {
        ads = true
        if (brain.role === "anchor" || bestDist > 16) crouch = true
      }
      if (reactionTicks <= 0 && bestDist <= maxRange && random.next() < skill.fireChance) {
        fire = gun.automatic ? true : !bot.wasFireHeld
      }
    }

    // Tactical grenade throw against enemies at mid-range (7..18m)
    if (
      !bot.isBoss &&
      bot.grenadeCooldownTicks === 0 &&
      grenadeCooldownTicks === 0 &&
      bestDist >= 7.0 &&
      bestDist <= 17.5 &&
      random.next() < 0.015 + (ctx.skillLevel / 10) * 0.02
    ) {
      triggerGrenade = true
    }

    // Crouch / duck when suppressed or low HP in a duel
    if ((suppression > 0.5 || bot.hp < 40) && !bot.isBoss && !fleeingHazard) {
      crouch = true
    }
  } else if (memoryTicks < 110) {
    // Pre-aim toward enemy's last-known position while closing in!
    const dx = lastSeenX - bot.x
    const dz = lastSeenZ - bot.z
    const dist = Ops.hypot(dx, dz)
    if (dist > 0.5) {
      aimYaw = Ops.atan2(-dx, -dz)
    }
    // Toss a smart grenade around the corner where target just hid!
    if (
      !bot.isBoss &&
      bot.grenadeCooldownTicks === 0 &&
      grenadeCooldownTicks === 0 &&
      memoryTicks > 20 &&
      memoryTicks < 75 &&
      dist >= 6.5 &&
      dist <= 16.0 &&
      random.next() < 0.025
    ) {
      triggerGrenade = true
    }
  }

  // Project desired world movement into aimYaw frame + add combat strafing
  const sinY = Ops.sin(aimYaw)
  const cosY = Ops.cos(aimYaw)
  const fwdX = -sinY
  const fwdZ = -cosY
  const rightX = cosY
  const rightZ = -sinY

  let moveForward = clamp(moveDirX * fwdX + moveDirZ * fwdZ, -1, 1)
  let moveRight = clamp(moveDirX * rightX + moveDirZ * rightZ, -1, 1)

  if (target !== null && !fleeingHazard && unstuckTicks === 0) {
    if (insideZone) {
      moveForward = bestDist > 12 ? 0.55 : bestDist < 4.5 ? -0.55 : 0
      moveRight = strafeDir * 0.85
    } else {
      // Weave laterally while advancing so bots are lively targets!
      moveRight = clamp(moveRight + strafeDir * 0.42, -1, 1)
    }
  }

  // Reload / sidearm finisher discipline
  const ammo = bot.activeSlot === 2 ? bot.sidearmAmmo : bot.primaryAmmo
  if (ammo <= 0 && bot.reloadTicksLeft === 0) {
    if (bot.activeSlot === 1 && target !== null && bestDist < 12 && bot.sidearmAmmo > 0) {
      switchSlot = 2 // Smart pistol swap finisher when primary runs dry mid-duel!
    } else {
      reload = true
      if (!bot.isBoss && target !== null) crouch = true
    }
  } else if (bot.activeSlot === 2 && bot.primaryAmmo > 0 && target === null) {
    switchSlot = 1
  }

  const jump =
    triggerUnstuckJump ||
    (bot.grounded && nextWp.y > bot.y + 0.35 && random.next() < 0.04)

  const nextBrain: BotBrainState = {
    role: brain.role,
    targetWp,
    wpPatienceTicks,
    recentWps,
    bannedWp,
    bannedWpTicks,
    checkX,
    checkZ,
    checkCountdown,
    stuckCount,
    unstuckTicks,
    unstuckDir,
    strafeDir,
    strafeTicks,
    alert,
    memoryTicks,
    lastSeenX,
    lastSeenY,
    lastSeenZ,
    reactionTicks,
    suppression,
    grenadeCooldownTicks: triggerGrenade ? 300 : grenadeCooldownTicks,
    lastHp: bot.hp
  }

  return {
    moveForward,
    moveRight,
    yaw: aimYaw,
    pitch: aimPitch,
    jump,
    crouch,
    ads,
    fire,
    reload,
    switchSlot,
    triggerGrenade,
    triggerMelee,
    nextBrain
  }
}
