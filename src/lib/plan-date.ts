import type { RecordData } from 'deepspace'
import type { Plan } from '../schemas/prep-schema'

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
