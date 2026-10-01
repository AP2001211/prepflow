import { z } from 'zod/v4'
import type { ActionHandler, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'

const text = z.string().trim().max(10000)
const id = z.string().min(1).max(200)
const interviewInput = z.object({
  company: text.min(1).max(200),
  role: text.max(200).optional(),
  scheduledDate: z.string().optional().refine((value) => !value || (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  ), 'Enter a valid date'),
  stage: text.max(200).optional(),
  prepAreaIds: z.array(id).max(100).default([]),
  notes: text.optional(),
}).strict()
const sessionInput = z.object({
  prepAreaId: id,
  interviewId: id.optional(),
  intent: text.min(1),
  notes: text.optional(),
}).strict()

async function owns(tools: ActionTools, collection: string, recordId: string, userId: string) {
  const result = await tools.get(collection, recordId)
  return result.success && result.data.record.createdBy === userId
}

// Actions bypass record RBAC: explicitly enforce both the caller's role and
// ownership of every referenced row before creating records as that caller.
async function canWrite(tools: ActionTools, userId: string, env: Env) {
  if (userId === env.OWNER_USER_ID) return true
  const user = await tools.get('users', userId)
  return user.success && ['member', 'admin'].includes(String(user.data.record.data.role))
}

export const createInterview: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  if (!await canWrite(tools, userId, env)) return { success: false, error: 'You do not have permission to create interviews.' }
  const parsed = interviewInput.safeParse(params)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid interview.' }
  const data = { ...parsed.data, prepAreaIds: [...new Set(parsed.data.prepAreaIds)] }
  for (const areaId of data.prepAreaIds) {
    if (!await owns(tools, 'prep-areas', areaId, userId)) {
      return { success: false, error: 'A selected Prep Area is unavailable.' }
    }
  }
  return tools.create('interviews', data)
}

export const startPrepSession: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  if (!await canWrite(tools, userId, env)) return { success: false, error: 'You do not have permission to start sessions.' }
  const parsed = sessionInput.safeParse(params)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid session.' }
  const data = parsed.data
  if (!await owns(tools, 'prep-areas', data.prepAreaId, userId)) {
    return { success: false, error: 'The selected Prep Area is unavailable.' }
  }
  if (data.interviewId && !await owns(tools, 'interviews', data.interviewId, userId)) {
    return { success: false, error: 'The selected Interview is unavailable.' }
  }
  // A useful server-side guard, not a cross-request lock. Simultaneous starts
  // can still race; the workspace explicitly displays every conflicting row.
  const active = await tools.query('prep-sessions', {
    where: { createdBy: userId, state: 'active' }, limit: 1,
  })
  if (!active.success) return { success: false, error: 'Could not check your current focus. Try again.' }
  if (active.data.records.length) return { success: false, error: 'End your current focus before starting another session.' }
  return tools.create('prep-sessions', {
    ...data, startedAt: new Date().toISOString(), state: 'active', encounteredStuck: false,
  })
}
