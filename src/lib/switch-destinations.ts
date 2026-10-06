import type { RecordData } from 'deepspace'
import type { Plan, PlanItem, PrepSession } from '../schemas/prep-schema'
import { continueItems, intervalFocusMs } from './focus'

/** Switch-only presentation: Home's eligibility and membership stay untouched. */
export function switchDestinations(sourceItemId: string, items: RecordData<PlanItem>[], sessions: RecordData<PrepSession>[], currentPlan?: RecordData<Plan>) {
  const resume = continueItems(items, sessions).filter(({ item }) => item.recordId !== sourceItemId).slice(0, 3)
  const shown = new Set(resume.map(({ item }) => item.recordId))
  const planned = (currentPlan?.data.planItemIds ?? []).flatMap((id) => {
    const item = items.find((row) => row.recordId === id)
    if (!item || item.data.status !== 'open' || id === sourceItemId || shown.has(id)) return []
    shown.add(id)
    return [item]
  }).slice(0, 3)
  return { resume, planned }
}
export function switchFocusDuration(session: PrepSession) {
  const ms = intervalFocusMs(session)
  return ms > 0 && ms < 60000 ? '< 1 min focused' : `${Math.round(ms / 60000)} min focused`
}
