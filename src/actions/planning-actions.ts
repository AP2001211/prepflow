import { z } from 'zod/v4'
import type { ActionContext, ActionHandler, ActionResult } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { Plan, PlanItem, PrepSession } from '../schemas/prep-schema'
import { canWrite, owns } from './prep-actions'

const id = z.string().min(1).max(200)
const text = z.string().trim().max(10000)
const notesText = z.string().max(10000)
const datetime = z.iso.datetime({ offset: true })
const planInput = z.object({
  title: text.min(1).max(200), startsAt: datetime.optional(), endsAt: datetime.optional(),
  budgetMinutes: z.number().finite().positive().optional(),
}).strict().refine((data) => !data.startsAt || !data.endsAt || Date.parse(data.endsAt) > Date.parse(data.startsAt), 'The plan end must follow its start.')
const itemInput = z.object({ prepAreaId: id, interviewId: id.optional(), intent: text.min(1), instructions: z.string().trim().min(1).max(2000).optional(), planId: id.optional(), requestId: z.uuid().optional() }).strict()
const membershipInput = z.object({ planId: id, planItemId: id }).strict()
const startInput = z.object({ planItemId: id, planId: id.optional(), notes: notesText.optional() }).strict()
const endInput = z.object({
  sessionId: id, outcome: z.enum(['completed', 'stopped', 'switched']), endedAt: datetime,
  notes: notesText.optional(), leftOff: text.optional(), nextStep: text.optional(),
}).strict()
const contextInput = z.object({ sessionId: id, leftOff: text.optional(), nextStep: text.optional() }).strict()
const sessionIdInput = z.object({ sessionId: id }).strict()
const stuckInput = z.object({ sessionId: id, notes: notesText.optional() }).strict()
const planIdInput = z.object({ planId: id }).strict()

function failure(error: string, code?: string): ActionResult {
  return { success: false, error, ...(code ? { code } : {}) }
}
type Context = ActionContext<Env>
type Row<T> = { recordId: string; createdBy: string; data: T }

export async function owned<T>(ctx: Context, collection: string, recordId: string): Promise<Row<T> | null> {
  const result = await ctx.tools.get(collection, recordId)
  if (!result.success || result.data.record.createdBy !== ctx.userId) return null
  return result.data.record as unknown as Row<T>
}

/** All privileged actions explicitly enforce caller role before using tools. */
export function action<T>(schema: z.ZodType<T>, handler: (ctx: Context, data: T) => Promise<ActionResult>): ActionHandler<Env> {
  return async (ctx) => {
    try {
      if (!await canWrite(ctx.tools, ctx.userId, ctx.env)) return failure('You do not have permission to change preparation.')
      const parsed = schema.safeParse(ctx.params)
      if (!parsed.success) return failure(parsed.error.issues[0]?.message ?? 'Invalid input.')
      return await handler(ctx, parsed.data)
    } catch {
      // No sensitive error/record data is returned. Retry is safe for session
      // ending: an accepted end is read back, never reopened or retimestamped.
      return failure('The change could not be confirmed. Try again.')
    }
  }
}

export async function hasPendingCompletion(ctx: Context, planItemId: string): Promise<boolean> {
  const result = await ctx.tools.query('prep-sessions', {
    where: { createdBy: ctx.userId, planItemId, state: 'ended', outcome: 'completed' }, limit: 1,
  })
  if (!result.success) throw new Error('Could not check completion')
  return result.data.records.length > 0
}

export const createPlan = action(planInput, async (ctx, data) => ctx.tools.create('plans', { ...data, planItemIds: [] }))

export const addPlanItem = action(membershipInput, async (ctx, data) => {
  const plan = await owned<Plan>(ctx, 'plans', data.planId)
  const item = await owned<PlanItem>(ctx, 'plan-items', data.planItemId)
  if (!plan || !item) return failure('The selected plan or intended work is unavailable.')
  if (plan.data.planDate) return failure('Use a dedicated daily-plan action to revise daily membership; this action cannot change it.')
  if (plan.data.closedAt) return failure('Closed plan membership cannot change.')
  if (plan.data.planItemIds.includes(data.planItemId)) return { success: true, data: { recordId: plan.recordId } }
  if (item.data.status !== 'open') return failure('Only open work can be added to a plan.')
  if (await hasPendingCompletion(ctx, item.recordId)) return failure('Finish reconciling this item’s completion first.', 'completion_pending')
  return ctx.tools.update('plans', plan.recordId, { planItemIds: [...plan.data.planItemIds, item.recordId] })
})

export const createPlanItem = action(itemInput, async (ctx, data) => {
  if (!await owns(ctx.tools, 'prep-areas', data.prepAreaId, ctx.userId)) return failure('The selected Prep Area is unavailable.')
  if (data.interviewId && !await owns(ctx.tools, 'interviews', data.interviewId, ctx.userId)) return failure('The selected Interview is unavailable.')
  if (data.planId) {
    const plan = await owned<Plan>(ctx, 'plans', data.planId)
    if (!plan) return failure('The selected plan is unavailable.')
    if (plan.data.planDate) return failure('This action cannot add work to a daily plan.')
    if (plan.data.closedAt) return failure('Closed plan membership cannot change.')
  }
  const values = { prepAreaId: data.prepAreaId, ...(data.interviewId ? { interviewId: data.interviewId } : {}), intent: data.intent, ...(data.instructions ? { instructions: data.instructions } : {}), status: 'open' }
  // One form submission uses a UUID across retries. A partial membership write
  // leaves valid open work, and retry cannot create a duplicate or reset status.
  const recordId = data.requestId ? `item-${ctx.userId}-${data.requestId}` : undefined
  let itemId = recordId
  const existing = recordId ? await ctx.tools.query('plan-items', { where: { recordId }, limit: 1 }) : null
  if (existing && !existing.success) return failure('Could not check this submission. Try again.')
  if (existing?.success && existing.data.records.length) {
    const item = existing.data.records[0]!
    if (item.createdBy !== ctx.userId || item.data.prepAreaId !== data.prepAreaId || item.data.intent !== data.intent || (item.data.instructions ?? null) !== (data.instructions ?? null) || (item.data.interviewId ?? '') !== (data.interviewId ?? '')) {
      return failure('This submission was already used for different intended work. Reload and try again.')
    }
  } else {
    const result = await ctx.tools.create('plan-items', values, recordId)
    if (!result.success) return result
    itemId = result.data.recordId
  }
  if (!itemId) return failure('Could not create intended work.')
  if (data.planId) {
    const membership = await addPlanItem({ ...ctx, params: { planId: data.planId, planItemId: itemId } })
    if (!membership.success) return membership
  }
  return { success: true, data: { recordId: itemId } }
})

export const closePlan = action(planIdInput, async (ctx, data) => {
  const plan = await owned<Plan>(ctx, 'plans', data.planId)
  if (!plan) return failure('The selected plan is unavailable.')
  if (plan.data.closedAt) return { success: true, data: { recordId: plan.recordId } }
  return ctx.tools.update('plans', plan.recordId, { closedAt: new Date().toISOString() })
})

export const startPrepSession = action(startInput, async (ctx, data) => {
  const item = await owned<PlanItem>(ctx, 'plan-items', data.planItemId)
  if (!item) return failure('The selected intended work is unavailable.')
  if (item.data.status !== 'open') return failure('Completed work cannot be resumed.')
  if (!await owns(ctx.tools, 'prep-areas', item.data.prepAreaId, ctx.userId)) return failure('The selected Prep Area is unavailable.')
  if (item.data.interviewId && !await owns(ctx.tools, 'interviews', item.data.interviewId, ctx.userId)) return failure('The selected Interview is unavailable.')
  if (await hasPendingCompletion(ctx, item.recordId)) return failure('Finish reconciling this item’s completion before resuming.', 'completion_pending')
  if (data.planId) {
    const plan = await owned<Plan>(ctx, 'plans', data.planId)
    if (!plan || !plan.data.planItemIds.includes(item.recordId)) return failure('The selected plan does not contain this work.')
    if (plan.data.closedAt) return failure('This plan is closed. Resume without a plan or from another open plan.')
  }
  // Normal-flow guard, intentionally not a cross-tab lock.
  const active = await ctx.tools.query('prep-sessions', { where: { createdBy: ctx.userId, state: 'active' }, limit: 1 })
  if (!active.success) return failure('Could not check your current focus. Try again.')
  if (active.data.records.length) return failure('End your current focus before starting another session.')
  return ctx.tools.create('prep-sessions', {
    planItemId: item.recordId, ...(data.planId ? { planId: data.planId } : {}),
    prepAreaId: item.data.prepAreaId, ...(item.data.interviewId ? { interviewId: item.data.interviewId } : {}),
    intent: item.data.intent, ...(item.data.instructions ? { instructions: item.data.instructions } : {}), ...(data.notes !== undefined ? { notes: data.notes } : {}),
    startedAt: new Date().toISOString(), state: 'active', encounteredStuck: false,
  })
})

async function completeItem(ctx: Context, session: Row<PrepSession>): Promise<ActionResult> {
  const pending = (): ActionResult => ({
    success: false, code: 'completion_pending', error: 'Focus has stopped, but item completion could not be confirmed. Retry completion.',
    details: { sessionId: session.recordId },
  })
  try {
    const item = await owned<PlanItem>(ctx, 'plan-items', session.data.planItemId)
    if (!item) return pending()
    if (item.data.status === 'completed') return { success: true, data: { recordId: session.recordId } }
    const result = await ctx.tools.update('plan-items', item.recordId, { status: 'completed', completedAt: session.data.endedAt })
    if (!result.success) return pending()
    return { success: true, data: { recordId: session.recordId } }
  } catch { return pending() }
}

export const endPrepSession = action(endInput, async (ctx, data) => {
  const session = await owned<PrepSession>(ctx, 'prep-sessions', data.sessionId)
  if (!session) return failure('The selected focus interval is unavailable.')
  if (session.data.state === 'ended') {
    if (session.data.outcome !== data.outcome) return failure('This interval has already ended with a different outcome.')
    return data.outcome === 'completed' ? completeItem(ctx, session) : { success: true, data: { recordId: session.recordId } }
  }
  const end = Date.parse(data.endedAt)
  if (end < Date.parse(session.data.startedAt) || end > Date.now() + 300000) return failure('The stop timestamp must follow the start and cannot be in the future.')
  const patch = {
    state: 'ended', outcome: data.outcome, endedAt: new Date(end).toISOString(),
    ...(data.notes !== undefined ? { notes: data.notes } : {}),
    ...(data.leftOff !== undefined ? { leftOff: data.leftOff } : {}),
    ...(data.nextStep !== undefined ? { nextStep: data.nextStep } : {}),
  }
  const result = await ctx.tools.update('prep-sessions', session.recordId, patch)
  if (!result.success) return result
  // The interval is authoritative and permanently stopped before item update.
  return data.outcome === 'completed'
    ? completeItem(ctx, { ...session, data: { ...session.data, ...patch } as PrepSession })
    : result
})

export const reconcileCompletion = action(sessionIdInput, async (ctx, data) => {
  const session = await owned<PrepSession>(ctx, 'prep-sessions', data.sessionId)
  if (!session || session.data.state !== 'ended' || session.data.outcome !== 'completed' || !session.data.endedAt) return failure('This interval is not awaiting completion.')
  return completeItem(ctx, session)
})

export const reportStuck = action(stuckInput, async (ctx, data) => {
  const session = await owned<PrepSession>(ctx, 'prep-sessions', data.sessionId)
  if (!session || session.data.state !== 'active') return failure('Difficulty can only be reported during active focus.')
  return ctx.tools.update('prep-sessions', session.recordId, { encounteredStuck: true, ...(data.notes !== undefined ? { notes: data.notes } : {}) })
})

export const saveSessionNotes = action(z.object({ sessionId: id, notes: notesText }).strict(), async (ctx, data) => {
  const session = await owned<PrepSession>(ctx, 'prep-sessions', data.sessionId)
  if (!session || session.data.state !== 'active') return failure('Notes can only autosave on your active session.')
  return ctx.tools.update('prep-sessions', session.recordId, { notes: data.notes })
})

export const saveResumeContext = action(contextInput, async (ctx, data) => {
  const session = await owned<PrepSession>(ctx, 'prep-sessions', data.sessionId)
  if (!session || session.data.state !== 'ended' || !['stopped', 'switched'].includes(session.data.outcome ?? '')) return failure('Resume context belongs to a stopped or switched interval.')
  return ctx.tools.update('prep-sessions', session.recordId, {
    ...(data.leftOff !== undefined ? { leftOff: data.leftOff } : {}),
    ...(data.nextStep !== undefined ? { nextStep: data.nextStep } : {}),
  })
})

export const planningActions = { createPlan, createPlanItem, addPlanItem, closePlan, startPrepSession, endPrepSession, reconcileCompletion, reportStuck, saveResumeContext, saveSessionNotes }
