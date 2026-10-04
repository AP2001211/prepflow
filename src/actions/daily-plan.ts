import { z } from 'zod/v4'
import type { ActionContext } from 'deepspace/worker'
import type { RecordData } from 'deepspace'
import type { Plan, PlanItem } from '../schemas/prep-schema'
import { owned } from './planning-actions'
import type { Env } from '../../worker'
import { localPlanDate, validPlanDate, dailyPlanState } from '../lib/plan-date'

export const dailyContextSchema = z.object({
  planDate: z.string().refine(validPlanDate, 'Enter a valid calendar date.'),
  timeZone: z.string().min(1).max(100).refine((zone) => { try { localPlanDate(zone); return true } catch { return false } }, 'Invalid timezone.'),
}).strict()
export type DailyContext = z.infer<typeof dailyContextSchema>

/** Shared daily rules; future explicit manual creation can reuse these. */
export async function validateDailyCreation(ctx: ActionContext<Env>, daily: DailyContext) {
  if (daily.planDate !== localPlanDate(daily.timeZone)) return { success: false as const, code: 'day_changed', error: 'Your local date changed. Review the suggestion for the new date before saving.' }
  // Explicit cap: fail closed rather than accepting against a partial Plan list.
  const existing = await ctx.tools.query('plans', { where: { createdBy: ctx.userId, planDate: daily.planDate }, limit: 500 })
  if (!existing.success || existing.data.records.length >= 500 || existing.data.count > existing.data.records.length) return { success: false as const, error: 'Could not fully check today’s plans. Try again.' }
  const plans: RecordData<Plan>[] = existing.data.records.map((row) => ({ ...row, data: { title: z.string().parse(row.data.title), planItemIds: z.array(z.string()).parse(row.data.planItemIds), planDate: daily.planDate } }))
  const items = await Promise.all([...new Set(plans.flatMap((plan) => plan.data.planItemIds))].map((id) => owned<PlanItem>(ctx, 'plan-items', id)))
  if (items.some((item) => !item)) return { success: false as const, error: 'Could not resolve today’s intended work. Planning remains blocked until it is available.' }
  const state = dailyPlanState(plans, items.filter((item): item is RecordData<PlanItem> => !!item), daily.planDate)
  if (state.conflict) return { success: false as const, code: 'daily_plan_conflict', error: 'Multiple incomplete plans exist for today. Open Plans to inspect them.' }
  if (state.currentPlan) return { success: false as const, code: 'daily_plan_exists', error: 'Today’s plan still has unfinished work. Open it from Home.' }
  return null
}
