import type { PlanItem } from '../schemas/prep-schema'
import { validPlanDate } from './plan-date'

/** Automatic recommendation eligibility only; never a session-start restriction. */
export function isAutomaticallyAvailable(item: Pick<PlanItem, 'availableFrom'>, targetPlanDate: string): boolean {
  return item.availableFrom == null || (validPlanDate(item.availableFrom) && validPlanDate(targetPlanDate) && item.availableFrom <= targetPlanDate)
}
