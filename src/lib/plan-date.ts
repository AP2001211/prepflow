import type { RecordData } from 'deepspace'
import type { Plan, PlanItem } from '../schemas/prep-schema'

export function validPlanDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}
export function localPlanDate(timeZone: string, now = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  return ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type)!.value).join('-')
}
export function browserDay() {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return { timeZone, planDate: localPlanDate(timeZone) }
}
export function todayPlans(plans: RecordData<Plan>[], date: string) {
  return plans.filter((plan) => plan.data.planDate === date)
}

/** Unresolved or foreign membership can never prove completion. */
export function planFullyCompleted(plan: RecordData<Plan>, items: RecordData<PlanItem>[]) {
  const byId = new Map(items.map((item) => [item.recordId, item]))
  return plan.data.planItemIds.every((id) => {
    const item = byId.get(id)
    return !!item && item.createdBy === plan.createdBy && item.data.status === 'completed'
  })
}

export function dailyPlanState(plans: RecordData<Plan>[], items: RecordData<PlanItem>[], date: string, ready = true) {
  const matches = todayPlans(plans, date).sort((a, b) =>
    (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || b.recordId.localeCompare(a.recordId))
  const incomplete = matches.filter((plan) => !planFullyCompleted(plan, items))
  const conflict = ready && incomplete.length > 1
  const displayPlan = ready && !conflict ? incomplete[0] ?? matches[0] : undefined
  const completedPlans = ready ? matches.filter((plan) => planFullyCompleted(plan, items)) : []
  const completedEarlierPlans = completedPlans.filter((plan) => plan.recordId !== displayPlan?.recordId)
  return { matches, incomplete, conflict, planningAllowed: ready && incomplete.length === 0,
    currentPlan: ready && incomplete.length === 1 ? incomplete[0] : undefined,
    displayPlan, completedPlans, completedEarlierPlans }
}

/** Planning access is separate from Home's historical current/completed display. */
export function dailyPlanningAccess(plans: RecordData<Plan>[], items: RecordData<PlanItem>[], date: string, ready = true) {
  const matches = todayPlans(plans, date)
  const conflict = ready && matches.length > 1
  const plan = ready && matches.length === 1 ? matches[0] : undefined
  const unresolved = !!plan && plan.data.planItemIds.some((id) => !items.some((item) => item.recordId === id && item.createdBy === plan.createdBy))
  return { plan, conflict, closed: !!plan?.data.closedAt, planningAllowed: ready && !conflict && !unresolved && !plan?.data.closedAt }
}
