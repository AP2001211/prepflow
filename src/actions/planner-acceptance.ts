import { z } from 'zod/v4'
import { recommendationSchema, validateRecommendation } from '../ai/planner-contract'
import { action, owned, hasPendingCompletion } from './planning-actions'
import { dailyContextSchema, validateDailyCreation } from './daily-plan'
import { owns } from './prep-actions'
import type { PlanItem } from '../schemas/prep-schema'

export const acceptanceSchema = z.object({
  requestId: z.uuid(), availableMinutes: z.number().int().positive().max(1440), recommendation: recommendationSchema, daily: dailyContextSchema.optional(),
}).strict()

/** No model call: materialize exactly the reviewed proposal, as the caller. */
export const acceptPrepPlan = action(acceptanceSchema, async (ctx, input) => {
  const proposal = validateRecommendation(input.recommendation, input.availableMinutes)
  const planId = `suggested-plan-${ctx.userId}-${input.requestId}`
  const itemIds = proposal.items.map((item, index) => item.kind === 'existing' ? item.existingPlanItemId : `${planId}-item-${index}`)
  const planValues = { ...(input.daily ? { planDate: input.daily.planDate } : {}), title: proposal.title, budgetMinutes: input.availableMinutes, planItemIds: itemIds }
  const previous = await ctx.tools.query('plans', { where: { recordId: planId }, limit: 1 })
  if (!previous.success) return { success: false, error: 'Could not check this submission. Try again.' }
  if (previous.data.records.length) {
    const plan = previous.data.records[0]!
    if ((plan.data.planDate ?? null) !== (input.daily?.planDate ?? null) || plan.createdBy !== ctx.userId || plan.data.title !== planValues.title || plan.data.budgetMinutes !== planValues.budgetMinutes || JSON.stringify(plan.data.planItemIds) !== JSON.stringify(itemIds)) {
      return { success: false, error: 'This submission already belongs to a different plan.' }
    }
    for (const [index, entry] of proposal.items.entries()) {
      if (entry.kind !== 'new') continue
      const item = await owned<PlanItem>(ctx, 'plan-items', itemIds[index]!)
      if (!item || item.data.intent !== entry.intent || item.data.prepAreaId !== entry.prepAreaId || (item.data.interviewId ?? null) !== (entry.interviewId ?? null)) {
        return { success: false, error: 'This submission already belongs to different intended work.' }
      }
    }
    return { success: true, data: { recordId: planId } }
  }
  if (input.daily) {
    const conflict = await validateDailyCreation(ctx, input.daily)
    if (conflict) return conflict
  }
  // Validate every reference before the first write. Privileged action tools
  // require explicit ownership checks even though record RBAC remains enabled.
  for (const entry of proposal.items) {
    const existing = entry.kind === 'existing' ? await owned<PlanItem>(ctx, 'plan-items', entry.existingPlanItemId) : null
    if (entry.kind === 'existing' && (!existing || existing.data.status !== 'open' || await hasPendingCompletion(ctx, entry.existingPlanItemId))) {
      return { success: false, error: 'Suggested work is unavailable or no longer eligible. Build a new suggestion.' }
    }
    const work = existing?.data ?? (entry.kind === 'new' ? entry : null)
    if (!work || !await owns(ctx.tools, 'prep-areas', work.prepAreaId, ctx.userId) || (work.interviewId && !await owns(ctx.tools, 'interviews', work.interviewId, ctx.userId))) {
      return { success: false, error: 'A suggested Prep Area or Interview is unavailable. Build a new suggestion.' }
    }
  }
  // Stable IDs reuse accepted writes after a partial failure or lost response.
  // There is deliberately no transaction across these records.
  for (const [index, entry] of proposal.items.entries()) {
    if (entry.kind !== 'new') continue
    const id = itemIds[index]!
    const prior = await ctx.tools.query('plan-items', { where: { recordId: id }, limit: 1 })
    if (!prior.success) return { success: false, error: 'Could not check intended work. Retry Use this plan.' }
    if (prior.data.records.length) {
      const item = prior.data.records[0]!
      if (item.createdBy !== ctx.userId || item.data.intent !== entry.intent || item.data.prepAreaId !== entry.prepAreaId || (item.data.interviewId ?? null) !== (entry.interviewId ?? null) || item.data.status !== 'open' || await hasPendingCompletion(ctx, id)) {
        return { success: false, error: 'This submission’s intended work changed. Build a new suggestion.' }
      }
    } else {
      const created = await ctx.tools.create('plan-items', { intent: entry.intent, prepAreaId: entry.prepAreaId, ...(entry.interviewId ? { interviewId: entry.interviewId } : {}), status: 'open' }, id)
      if (!created.success) return { success: false, error: 'Some intended work may have been saved. Retry Use this plan to finish without duplicating it.' }
    }
  }
  const result = await ctx.tools.create('plans', planValues, planId)
  return result.success ? result : { success: false, error: 'Intended work is saved, but the plan could not be confirmed. Retry Use this plan.' }
})
