import { z } from 'zod/v4'
import type { ActionContext } from 'deepspace/worker'
import type { Env } from '../../worker'
import { localPlanDate, validPlanDate } from '../lib/plan-date'

export const dailyContextSchema = z.object({
  planDate: z.string().refine(validPlanDate, 'Enter a valid calendar date.'),
  timeZone: z.string().min(1).max(100).refine((zone) => { try { localPlanDate(zone); return true } catch { return false } }, 'Invalid timezone.'),
}).strict()
export type DailyContext = z.infer<typeof dailyContextSchema>

/** Shared daily rules; future explicit manual creation can reuse these. */
export async function validateDailyCreation(ctx: ActionContext<Env>, daily: DailyContext) {
  if (daily.planDate !== localPlanDate(daily.timeZone)) return { success: false as const, code: 'day_changed', error: 'Your local date changed. Review the suggestion for the new date before saving.' }
  const existing = await ctx.tools.query('plans', { where: { createdBy: ctx.userId, planDate: daily.planDate }, limit: 1 })
  if (!existing.success) return { success: false as const, error: 'Could not check today’s plan. Try again.' }
  if (existing.data.records.length) return { success: false as const, code: 'daily_plan_exists', error: 'You already have a plan for this date. Open it from Home.' }
  return null
}
