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

export async function owns(tools: ActionTools, collection: string, recordId: string, userId: string) {
  const result = await tools.get(collection, recordId)
  return result.success && result.data.record.createdBy === userId
}

// Actions bypass record RBAC: explicitly enforce both the caller's role and
// ownership of every referenced row before creating records as that caller.
export async function canWrite(tools: ActionTools, userId: string, env: Env) {
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
