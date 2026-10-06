import { z } from 'zod/v4'
import { action, owned } from './planning-actions'
import { owns } from './prep-actions'
import type { PrepPlan } from '../schemas/prep-schema'

const id = z.string().min(1).max(200)
const fields = {
  title: z.string().trim().min(1).max(80),
  context: z.string().trim().min(1).max(2000),
  prepAreaIds: z.array(id).max(30).default([]).transform((ids) => [...new Set(ids)]),
}
export const prepPlanCreateInput = z.object({ ...fields, requestId: z.uuid(), interviewId: id.optional(), goal: z.string().trim().min(1).max(500).optional() }).strict()
  .refine((data) => !!data.interviewId !== !!data.goal, 'Choose an interview or a preparation goal, not both.')
export const prepPlanUpdateInput = z.object({ ...fields, prepPlanId: id, goal: z.string().trim().min(1).max(500).optional() }).strict()

export const createPrepPlan = action(prepPlanCreateInput, async (ctx, input) => {
  const { requestId, ...data } = input
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(data)))
  const creationFingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  const recordId = `prep-plan-${ctx.userId}-${requestId}`
  const prior = await ctx.tools.query('prep-plans', { where: { recordId }, limit: 1 })
  if (!prior.success) return { success: false, error: 'Could not check this submission. Try again.' }
  if (prior.data.records.length) {
    const record = prior.data.records[0]!
    return record.createdBy === ctx.userId && record.data.creationFingerprint === creationFingerprint
      ? { success: true, data: { recordId } }
      : { success: false, error: 'This submission was already used for different preparation context. Start a new submission.' }
  }
  if (data.interviewId && !await owns(ctx.tools, 'interviews', data.interviewId, ctx.userId)) return { success: false, error: 'The selected Interview is unavailable.' }
  for (const areaId of data.prepAreaIds) {
    if (!await owns(ctx.tools, 'prep-areas', areaId, ctx.userId)) return { success: false, error: 'A selected Prep Area is unavailable.' }
  }
  if (data.interviewId) {
    const existing = await ctx.tools.query('prep-plans', { where: { userId: ctx.userId, interviewId: data.interviewId }, limit: 1 })
    if (!existing.success) return { success: false, error: 'Could not check this interview’s prep plan. Try again.' }
    if (existing.data.records.length) return { success: false, error: 'This interview already has a prep plan. Open it from Plans to edit it.' }
  }
  // One record write. Storage-backed uniqueness also protects concurrent requests.
  // The immutable creation fingerprint permits recovery even after later edits.
  return ctx.tools.create('prep-plans', { ...data, userId: ctx.userId, creationFingerprint }, recordId)
})

export const updatePrepPlan = action(prepPlanUpdateInput, async (ctx, input) => {
  const { prepPlanId, ...data } = input
  const plan = await owned<PrepPlan>(ctx, 'prep-plans', prepPlanId)
  if (!plan) return { success: false, error: 'This prep plan is unavailable.' }
  if (plan.data.interviewId && data.goal !== undefined) return { success: false, error: 'An interview prep plan cannot change its preparation anchor.' }
  if (!plan.data.interviewId && data.goal === undefined) return { success: false, error: 'Keep a preparation goal for this prep plan.' }
  if (plan.data.interviewId && !await owns(ctx.tools, 'interviews', plan.data.interviewId, ctx.userId)) return { success: false, error: 'The associated Interview is unavailable.' }
  for (const areaId of data.prepAreaIds) {
    if (!await owns(ctx.tools, 'prep-areas', areaId, ctx.userId)) return { success: false, error: 'A selected Prep Area is unavailable.' }
  }
  return ctx.tools.update('prep-plans', prepPlanId, data)
})
