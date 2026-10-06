import { z } from 'zod/v4'
import { isAutomaticallyAvailable } from '../lib/work-availability'
import { localPlanDate } from '../lib/plan-date'
import { legacyRecommendationSchema as recommendationSchema, validateLegacyRecommendation as validateRecommendation } from '../ai/planner-contract'
import { action, owned, hasPendingCompletion } from './planning-actions'
import { dailyContextSchema, validateDailyCreation } from './daily-plan'
import { owns } from './prep-actions'
import type { Plan, PlanItem } from '../schemas/prep-schema'

export const acceptanceSchema = z.object({
  selectedIndices: z.array(z.number().int().nonnegative()).min(1).max(5).optional(), requestId: z.uuid(), availableMinutes: z.number().int().positive().max(1440), recommendation: recommendationSchema, daily: dailyContextSchema.optional(),
}).strict()

/** No model call: reserve one immutable submission, materialize its selection, then finalize.
 * Applied receipts recover independently of subsequent Plan membership/budget changes.
 * These writes are deterministic and retryable, not a multi-record transaction. */
export const acceptPrepPlan = action(acceptanceSchema, async (ctx, input) => {
  const proposal = validateRecommendation(input.recommendation, input.availableMinutes)
  const namespaceId = `suggested-plan-${ctx.userId}-${input.requestId}`
  let planId = namespaceId
  const indices = input.selectedIndices ?? proposal.items.map((_, index) => index)
  if (new Set(indices).size !== indices.length || indices.some((index) => index >= proposal.items.length)) return { success: false, error: 'Choose unique activities from this recommendation.' }
  const selected = [...indices].sort((a, b) => a - b)
  const entries = selected.map((index) => [index, proposal.items[index]!] as const)
  const acceptedMinutes = entries.reduce((sum, [, entry]) => sum + entry.estimatedMinutes, 0)
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ proposal, selected, availableMinutes: input.availableMinutes, daily: input.daily ?? null })))
  const fingerprint = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
  const receiptId = `acceptance-${ctx.userId}-${input.requestId}`
  const receipts = await ctx.tools.query('plan-acceptances', { where: { recordId: receiptId }, limit: 1 })
  if (!receipts.success) return { success: false, error: 'Could not check acceptance. Retry.' }
  const receipt = receipts.data.records[0]
  if (receipt && (receipt.createdBy !== ctx.userId || receipt.data.fingerprint !== fingerprint)) return { success: false, error: 'This recommendation already has a different acceptance. Generate a fresh recommendation.' }
  async function verifyAcceptedNewWork() {
    for (const [index, entry] of proposal.items.entries()) {
      if (!selected.includes(index) || entry.kind !== 'new') continue
      const item = await owned<PlanItem>(ctx, 'plan-items', `${namespaceId}-item-${index}`)
      if (!item || item.data.intent !== entry.intent || (item.data.instructions ?? null) !== (entry.instructions ?? null) || (item.data.availableFrom != null && item.data.availableFrom !== input.daily?.planDate) || item.data.prepAreaId !== entry.prepAreaId || (item.data.interviewId ?? null) !== (entry.interviewId ?? null)) return { success: false as const, error: 'Accepted intended work is unavailable or changed.' }
    }
    return null
  }
  if (receipt?.data.state === 'applied') {
    const invalid = await verifyAcceptedNewWork()
    if (invalid) return invalid
    const acceptedPlanId = z.string().min(1).max(200).parse(receipt.data.planId)
    const plan = await owned(ctx, 'plans', acceptedPlanId)
    return plan ? { success: true, data: { recordId: acceptedPlanId } } : { success: false, error: 'Accepted plan is unavailable.' }
  }
  const itemIds = entries.map(([index, item]) => item.kind === 'existing' ? item.existingPlanItemId : `${namespaceId}-item-${index}`)
  const planValues = { ...(input.daily ? { planDate: input.daily.planDate } : {}), title: proposal.title, budgetMinutes: acceptedMinutes, planItemIds: itemIds }
  if (receipt) planId = z.string().min(1).max(200).parse(receipt.data.planId)
  let rebindPendingReceipt = false
  let targetPlan: Awaited<ReturnType<typeof owned<Plan>>> = null
  if (input.daily) {
    const resolved = await ctx.tools.query('plans', { where: { createdBy: ctx.userId, planDate: input.daily.planDate }, limit: 501 })
    if (!resolved.success || resolved.data.records.length >= 500 || resolved.data.count > resolved.data.records.length) return { success: false, error: 'Could not fully resolve this date’s plan.' }
    if (resolved.data.records.length > 1) return { success: false, code: 'daily_plan_conflict', error: 'Multiple daily plans exist for this date. Open Plans to inspect them.' }
    if (resolved.data.records.length) {
      targetPlan = await owned<Plan>(ctx, 'plans', resolved.data.records[0]!.recordId)
      if (!targetPlan) return { success: false, error: 'Accepted target plan is unavailable.' }
      if (receipt && targetPlan.recordId !== planId) {
        // Another submission may create the canonical Plan while this one has
        // only materialized items. Rebind only an unapplied creation reservation
        // whose original deterministic Plan is authoritatively absent.
        const reservedPlan = await ctx.tools.query('plans', { where: { recordId: planId }, limit: 1 })
        if (planId !== namespaceId || !reservedPlan.success || reservedPlan.data.records.length) return { success: false, error: 'Accepted target plan is unavailable.' }
        rebindPendingReceipt = true
      }
      planId = targetPlan.recordId
      if ((targetPlan.data.appliedAcceptanceIds ?? []).includes(receiptId)) {
        if (!receipt) return { success: false, error: 'Acceptance identity is unavailable.' }
        const invalid = await verifyAcceptedNewWork()
        if (invalid) return invalid
        const saved = await ctx.tools.update('plan-acceptances', receiptId, { state: 'applied' })
        return saved.success ? { success: true, data: { recordId: planId } } : { success: false, error: 'Plan updated; retry to confirm acceptance.' }
      }
      if (targetPlan.data.closedAt) return { success: false, code: 'daily_plan_closed', error: 'This date’s plan is explicitly closed and cannot be extended.' }
      if (targetPlan.data.budgetMinutes != null && (!Number.isFinite(targetPlan.data.budgetMinutes) || targetPlan.data.budgetMinutes < 0)) return { success: false, error: 'This plan’s budget is invalid.' }
      const members = await Promise.all(targetPlan.data.planItemIds.map((id) => owned<PlanItem>(ctx, 'plan-items', id)))
      if (members.some((item) => !item)) return { success: false, error: 'Could not resolve this date’s intended work.' }
      // A pre-marker accepted Plan is recovered by the legacy exact comparison below.
      const legacyRecovery = planId === namespaceId
      if (!legacyRecovery && itemIds.some((id) => targetPlan!.data.planItemIds.includes(id))) return { success: false, error: 'Selected work is already represented in this plan. Choose different activities.' }
      if ((targetPlan.data.appliedAcceptanceIds?.length ?? 0) >= 100) return { success: false, error: 'This plan has reached its acceptance limit.' }
    }
  }
  const receiptValues = { requestId: input.requestId, fingerprint, selectedIndices: selected, planId, planItemIds: itemIds, acceptedMinutes, ...(input.daily ? { planDate: input.daily.planDate } : {}), mode: input.daily ? 'daily' : 'generic', state: 'pending' }
  async function finalize() {
    const existingReceipt = await owned(ctx, 'plan-acceptances', receiptId)
    if (!existingReceipt) {
      const created = await ctx.tools.create('plan-acceptances', receiptValues, receiptId)
      if (!created.success) return { success: false as const, error: 'Plan saved; retry to confirm acceptance.' }
    }
    const saved = await ctx.tools.update('plan-acceptances', receiptId, { state: 'applied' })
    return saved.success ? { success: true as const, data: { recordId: planId } } : { success: false as const, error: 'Plan saved; retry to confirm acceptance.' }
  }
  const previous = await ctx.tools.query('plans', { where: { recordId: planId }, limit: 1 })
  if (!previous.success) return { success: false, error: 'Could not check this submission. Try again.' }
  if (previous.data.records.length && (!input.daily || planId === namespaceId)) {
    const plan = previous.data.records[0]!
    if ((plan.data.planDate ?? null) !== (input.daily?.planDate ?? null) || plan.createdBy !== ctx.userId || plan.data.title !== planValues.title || (plan.data.budgetMinutes !== planValues.budgetMinutes && !(!receipt && input.selectedIndices === undefined && plan.data.budgetMinutes === input.availableMinutes)) || JSON.stringify(plan.data.planItemIds) !== JSON.stringify(itemIds)) {
      return { success: false, error: 'This submission already belongs to a different plan.' }
    }
    for (const [index, entry] of entries) {
      if (entry.kind !== 'new') continue
      const item = await owned<PlanItem>(ctx, 'plan-items', `${namespaceId}-item-${index}`)
      // Already accepted pre-field records remain valid; never backfill them.
      // If availability exists, recovery must match the original daily date.
      if (!item || item.data.intent !== entry.intent || (item.data.instructions ?? null) !== (entry.instructions ?? null) || (item.data.availableFrom != null && item.data.availableFrom !== input.daily?.planDate) || item.data.prepAreaId !== entry.prepAreaId || (item.data.interviewId ?? null) !== (entry.interviewId ?? null)) {
        return { success: false, error: 'This submission already belongs to different intended work.' }
      }
    }
    return finalize()
  }
  if (input.daily) {
    if (input.daily.planDate < localPlanDate(input.daily.timeZone)) return { success: false, code: 'day_changed', error: 'This planning date has passed. Choose today or a future date.' }
    const conflict = await validateDailyCreation(ctx, input.daily)
    if (conflict) return conflict
  }
  // Validate every reference before the first write. Privileged action tools
  // require explicit ownership checks even though record RBAC remains enabled.
  for (const [, entry] of entries) {
    const existing = entry.kind === 'existing' ? await owned<PlanItem>(ctx, 'plan-items', entry.existingPlanItemId) : null
    if (entry.kind === 'existing' && (!existing || existing.data.status !== 'open' || !isAutomaticallyAvailable(existing.data, input.daily?.planDate ?? localPlanDate('UTC')) || await hasPendingCompletion(ctx, entry.existingPlanItemId))) {
      return { success: false, error: 'Suggested work is unavailable or no longer eligible. Build a new suggestion.' }
    }
    const work = existing?.data ?? (entry.kind === 'new' ? entry : null)
    if (!work || !await owns(ctx.tools, 'prep-areas', work.prepAreaId, ctx.userId) || (work.interviewId && !await owns(ctx.tools, 'interviews', work.interviewId, ctx.userId))) {
      return { success: false, error: 'A suggested Prep Area or Interview is unavailable. Build a new suggestion.' }
    }
  }
  if (!receipt) {
    const reserved = await ctx.tools.create('plan-acceptances', receiptValues, receiptId)
    if (!reserved.success) return { success: false, error: 'Could not reserve acceptance. Retry.' }
  } else if (rebindPendingReceipt) {
    const rebound = await ctx.tools.update('plan-acceptances', receiptId, { planId })
    if (!rebound.success) return { success: false, error: 'Could not resolve acceptance target. Retry.' }
  }
  // Stable IDs reuse accepted writes after a partial failure or lost response.
  // There is deliberately no transaction across these records.
  for (const [index, entry] of entries) {
    if (entry.kind !== 'new') continue
    const id = `${namespaceId}-item-${index}`
    const prior = await ctx.tools.query('plan-items', { where: { recordId: id }, limit: 1 })
    if (!prior.success) return { success: false, error: 'Could not check intended work. Retry Use this plan.' }
    if (prior.data.records.length) {
      const item = prior.data.records[0]!
      if (item.createdBy !== ctx.userId || item.data.intent !== entry.intent || (item.data.instructions ?? null) !== (entry.instructions ?? null) || (item.data.availableFrom ?? null) !== (input.daily?.planDate ?? null) || item.data.prepAreaId !== entry.prepAreaId || (item.data.interviewId ?? null) !== (entry.interviewId ?? null) || item.data.status !== 'open' || await hasPendingCompletion(ctx, id)) {
        return { success: false, error: 'This submission’s intended work changed. Build a new suggestion.' }
      }
    } else {
      const created = await ctx.tools.create('plan-items', { ...(input.daily ? { availableFrom: input.daily.planDate } : {}), intent: entry.intent, ...(entry.instructions ? { instructions: entry.instructions } : {}), prepAreaId: entry.prepAreaId, ...(entry.interviewId ? { interviewId: entry.interviewId } : {}), status: 'open' }, id)
      if (!created.success) return { success: false, error: 'Some intended work may have been saved. Retry Use this plan to finish without duplicating it.' }
    }
  }
  const result = targetPlan
    ? await ctx.tools.update('plans', planId, { planItemIds: [...targetPlan.data.planItemIds, ...itemIds], budgetMinutes: (targetPlan.data.budgetMinutes ?? 0) + acceptedMinutes, appliedAcceptanceIds: [...(targetPlan.data.appliedAcceptanceIds ?? []), receiptId] })
    : await ctx.tools.create('plans', { ...planValues, ...(input.daily ? { appliedAcceptanceIds: [receiptId] } : {}) }, planId)
  return result.success ? finalize() : { success: false, error: 'Intended work is saved, but the plan could not be confirmed. Retry Use this plan.' }
})
