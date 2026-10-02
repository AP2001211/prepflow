import type { RecordData } from 'deepspace'
import type { Plan, PlanItem, PrepSession } from '../schemas/prep-schema'

export function relevantPlan(plans: RecordData<Plan>[], active: RecordData<PrepSession>[], now = Date.now()) {
  const focusPlans = [...new Set(active.map((row) => row.data.planId).filter(Boolean))]
  if (focusPlans.length === 1) {
    const current = plans.find((plan) => plan.recordId === focusPlans[0])
    if (current) return current
  }
  const open = plans.filter((plan) => !plan.data.closedAt)
  const newest = (rows: typeof plans) => [...rows].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
  const covering = open.filter(({ data }) => (data.startsAt || data.endsAt) &&
    (!data.startsAt || Date.parse(data.startsAt) <= now) && (!data.endsAt || now < Date.parse(data.endsAt)))
  return newest(covering) ?? [...open].filter((plan) => plan.data.startsAt && Date.parse(plan.data.startsAt) > now)
    .sort((a, b) => Date.parse(a.data.startsAt!) - Date.parse(b.data.startsAt!))[0] ?? newest(open)
}
export function itemMemberships(plans: RecordData<Plan>[], itemId: string) {
  return plans.filter((plan) => plan.data.planItemIds.includes(itemId))
}

/** One row per open work identity, regardless of how many plans include it. */
export function unfinishedWork(items: RecordData<PlanItem>[]) {
  return [...new Map(items.filter((item) => item.data.status === 'open').map((item) => [item.recordId, item])).values()]
}
