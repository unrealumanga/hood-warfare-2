import { HostClock } from "@typeonce/ritmo"
import { Intent, makeMatchRuntime, setupSchedule, updateSchedule } from "./sim/index.ts"

export const lintTarget = () => {
  const runtime = makeMatchRuntime({
    seed: 1894,
    debug: { hostClock: HostClock.test() }
  })
  return {
    runtime,
    schedules: {
      setup: setupSchedule,
      update: updateSchedule
    },
    hostEvents: [Intent]
  }
}
