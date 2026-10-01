import { describe, expect, it, vi } from 'vitest'
import type { ActionContext, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { createInterview, startPrepSession } from './prep-actions'

function context(params: Record<string, unknown>, options: { foreign?: string; active?: boolean; role?: string; failedQuery?: boolean; failedCreate?: boolean } = {}) {
  const get = vi.fn(async (collection: string, recordId: string) => ({
    success: true,
    data: { record: { recordId, createdBy: recordId === options.foreign ? 'bob' : 'alice', data: collection === 'users' ? { role: options.role ?? 'member' } : {} } },
  }))
  const query = vi.fn(async () => options.failedQuery ? { success: false, error: 'Offline' } : { success: true, data: { records: options.active ? [{ recordId: 'current' }] : [], count: options.active ? 1 : 0 } })
  const create = vi.fn(async (_collection: string, _data: Record<string, unknown>) => options.failedCreate ? { success: false, error: 'Write rejected' } : { success: true, data: { recordId: 'new' } })
  const ctx = { userId: 'alice', params, tools: { get, query, create } as unknown as ActionTools, env: { OWNER_USER_ID: 'owner' } as Env, callerJwt: 'test-token' } satisfies ActionContext<Env>
  return { ctx, get, query, create }
}

describe('PrepFlow relationship actions', () => {
  it('creates an interview without areas or a known date', async () => {
    const { ctx, create } = context({ company: ' Example ', prepAreaIds: [] })
    expect(await createInterview(ctx)).toEqual({ success: true, data: { recordId: 'new' } })
    expect(create).toHaveBeenCalledWith('interviews', { company: 'Example', prepAreaIds: [] })
  })
  it('deduplicates owned interview area references', async () => {
    const { ctx, create } = context({ company: 'Example', prepAreaIds: ['a', 'a', 'b'] })
    expect((await createInterview(ctx)).success).toBe(true)
    expect(create).toHaveBeenCalledWith('interviews', { company: 'Example', prepAreaIds: ['a', 'b'] })
  })
  it('rejects another user’s area in an interview', async () => {
    const { ctx, create } = context({ company: 'Example', prepAreaIds: ['b'] }, { foreign: 'b' })
    expect((await createInterview(ctx)).success).toBe(false)
    expect(create).not.toHaveBeenCalled()
  })
  it.each(['2026-02-30', 'invalid', '2026-13-01'])('rejects invalid interview date %s without writing', async (scheduledDate) => {
    const { ctx, create } = context({ company: 'Example', scheduledDate })
    expect((await createInterview(ctx)).success).toBe(false)
    expect(create).not.toHaveBeenCalled()
  })
  it('starts general preparation with no interview', async () => {
    const { ctx, create, query } = context({ prepAreaId: 'a', intent: ' Practice SQL ' })
    expect((await startPrepSession(ctx)).success).toBe(true)
    expect(query).toHaveBeenCalledWith('prep-sessions', { where: { createdBy: 'alice', state: 'active' }, limit: 1 })
    expect(create).toHaveBeenCalledWith('prep-sessions', expect.objectContaining({ prepAreaId: 'a', intent: 'Practice SQL', state: 'active', encounteredStuck: false, startedAt: expect.any(String) }))
    expect(create.mock.calls[0]?.[1]).not.toHaveProperty('interviewId')
  })
  it.each(['area', 'interview'])('rejects a foreign %s when starting a session', async (kind) => {
    const { ctx, create } = context({ prepAreaId: 'a', interviewId: 'i', intent: 'Practice' }, { foreign: kind === 'area' ? 'a' : 'i' })
    expect((await startPrepSession(ctx)).success).toBe(false)
    expect(create).not.toHaveBeenCalled()
  })
  it('fails closed when a referenced row cannot be read', async () => {
    const { ctx, get, create } = context({ prepAreaId: 'a', intent: 'Practice' })
    get.mockImplementation(async (collection) => collection === 'users' ? { success: true, data: { record: { recordId: 'alice', createdBy: 'alice', data: { role: 'member' } } } } : { success: false, error: 'Not found' } as never)
    expect((await startPrepSession(ctx)).success).toBe(false)
    expect(create).not.toHaveBeenCalled()
  })
  it('rejects starting when a current attempt exists', async () => {
    const { ctx, create } = context({ prepAreaId: 'a', intent: 'Practice' }, { active: true })
    expect((await startPrepSession(ctx)).success).toBe(false)
    expect(create).not.toHaveBeenCalled()
  })
  it('does not start if the active-session lookup fails', async () => {
    const { ctx, create } = context({ prepAreaId: 'a', intent: 'Practice' }, { failedQuery: true })
    expect((await startPrepSession(ctx)).success).toBe(false)
    expect(create).not.toHaveBeenCalled()
  })
  it('propagates rejected writes rather than reporting success', async () => {
    const { ctx } = context({ prepAreaId: 'a', intent: 'Practice' }, { failedCreate: true })
    expect(await startPrepSession(ctx)).toEqual({ success: false, error: 'Write rejected' })
  })
  it.each(['viewer', 'unknown'])('does not let role %s bypass RBAC through actions', async (role) => {
    const { ctx, create } = context({ company: 'Example' }, { role })
    expect((await createInterview(ctx)).success).toBe(false)
    expect(create).not.toHaveBeenCalled()
  })
  it('rejects client-supplied owner or state fields', async () => {
    const { ctx, create } = context({ prepAreaId: 'a', intent: 'Practice', createdBy: 'bob', state: 'ended' })
    expect((await startPrepSession(ctx)).success).toBe(false)
    expect(create).not.toHaveBeenCalled()
  })
})
