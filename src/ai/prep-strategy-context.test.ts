import { describe, expect, it } from 'vitest'
import { prepReader } from './prep-context'
import { buildSystemPrompt, buildTools } from './tools'
import { contextFixture, existingProposal } from './planner-test-fixture'

const now = Date.parse('2026-10-05T12:00:00Z')
function fixture() {
  const f = contextFixture()
  const strategy = (id: string, anchor: { interviewId?: string; goal?: string }, prepAreaIds = ['area'], owner = 'alice') => f.add('prep-plans', id, { title: id, context: 'Strategic direction', prepAreaIds, userId: owner, creationFingerprint: 'private', ...anchor }, owner)
  const interview = (id: string, scheduledDate: string, owner = 'alice') => f.add('interviews', id, { company: id, scheduledDate, prepAreaIds: ['area'] }, owner)
  return { ...f, strategy, interview }
}

describe('bounded relevant Prep Plan strategy', () => {
  it('includes owned explicit Interview even before target; omits foreign and unrelated anchors', async () => {
    const f = fixture()
    f.interview('past', '2026-10-01'); f.strategy('explicit', { interviewId: 'past' })
    f.strategy('unrelated', { interviewId: 'unavailable' }); f.strategy('foreign', { goal: 'Coding' }, ['area'], 'bob')
    expect((await prepReader(f.executor).snapshot({}, now)).prepPlans).toEqual([])
    const snapshot = await prepReader(f.executor).snapshot({ interviewId: 'past' }, now)
    expect(snapshot.prepPlans.map((row) => row.id)).toEqual(['explicit'])
    expect(Object.keys(snapshot.prepPlans[0]!).sort()).toEqual(['context', 'id', 'interviewId', 'prepAreaIds', 'title'])
    await expect(prepReader(f.executor).snapshot({ interviewId: 'foreign-interview' }, now)).rejects.toThrow()
  })
  it('uses only next three dated candidates and stable date/ID order', async () => {
    const f = fixture()
    for (const [id, date] of [['b', '2026-10-06'], ['a', '2026-10-06'], ['c', '2026-10-07'], ['d', '2026-10-08'], ['past', '2026-10-04'], ['invalid', '2026-99-99']]) {
      f.interview(id!, date!); f.strategy(`strategy-${id}`, { interviewId: id! })
    }
    expect((await prepReader(f.executor).snapshot({}, now)).prepPlans.map((row) => row.id)).toEqual(['strategy-a', 'strategy-b', 'strategy-c'])
  })
  it('explicit area scope constrains non-explicit Interview strategy', async () => {
    const f = fixture(); f.add('prep-areas', 'other', { name: 'Other' })
    f.interview('a', '2026-10-06'); f.strategy('a', { interviewId: 'a' }, ['other'])
    f.interview('b', '2026-10-07'); f.strategy('b', { interviewId: 'b' })
    expect((await prepReader(f.executor).snapshot({ prepAreaIds: ['area'] }, now)).prepPlans.map((row) => row.id)).toEqual(['b'])
    expect((await prepReader(f.executor).snapshot({ prepAreaIds: ['area'], interviewId: 'a' }, now)).prepPlans.map((row) => row.id)).toEqual(['a', 'b'])
  })
  it('goal matching is exact normalized or explicit area overlap, never inventory/open-work overlap alone', async () => {
    const f = fixture(); f.strategy('exact', { goal: 'Improve   SQL' }); f.strategy('overlap', { goal: 'Other goal' }); f.strategy('unrelated', { goal: 'Design' }, [])
    expect((await prepReader(f.executor).snapshot({}, now)).prepPlans).toEqual([])
    expect((await prepReader(f.executor, 'UTC', undefined, ' improve SQL ').snapshot({}, now)).prepPlans.map((row) => row.id)).toEqual(['exact'])
    expect((await prepReader(f.executor, 'UTC', undefined, 'Improve SQL interviews').snapshot({}, now)).prepPlans).toEqual([])
    expect((await prepReader(f.executor).snapshot({ prepAreaIds: ['area'] }, now)).prepPlans.map((row) => row.id)).toEqual(['exact', 'overlap'])
  })
  it('ranks explicit Interview, upcoming Interview, exact goal then area match with maximum three', async () => {
    const f = fixture()
    f.interview('old', '2026-10-01'); f.strategy('z-explicit', { interviewId: 'old' })
    f.interview('next', '2026-10-06'); f.strategy('z-upcoming', { interviewId: 'next' })
    f.strategy('z-exact', { goal: 'SQL' }); f.strategy('a-overlap', { goal: 'Other' })
    const result = await prepReader(f.executor, 'UTC', undefined, 'sql').snapshot({ interviewId: 'old', prepAreaIds: ['area'] }, now)
    expect(result.prepPlans.map((row) => row.id)).toEqual(['z-explicit', 'z-upcoming', 'z-exact'])
    expect(result.coverage.prepPlans.truncated).toBe(true)
  })
  it('caps text and references, excludes foreign references, and exposes truncation without writes', async () => {
    const f = fixture()
    for (let i = 0; i < 31; i++) f.add('prep-areas', `extra-${i}`, { name: `${i}` })
    f.strategy('bounded', { goal: 'g'.repeat(600) }, ['foreign-area', 'missing', ...Array.from({ length: 31 }, (_, i) => `extra-${i}`)])
    const data = f.tables.get('prep-plans')![0]!.data
    data.title = 't'.repeat(100); data.context = 'c'.repeat(2000)
    const before = structuredClone(f.tables)
    const snapshot = await prepReader(f.executor, 'UTC', undefined, 'g'.repeat(600)).snapshot({}, now)
    expect(snapshot.prepPlans[0]).toMatchObject({ title: 't'.repeat(80), goal: 'g'.repeat(500), context: 'c'.repeat(1000) })
    expect(snapshot.prepPlans[0]!.prepAreaIds.length).toBeLessThanOrEqual(30)
    expect(snapshot.prepPlans[0]!.prepAreaIds).not.toContain('foreign-area')
    expect(snapshot.coverage.prepPlans).toMatchObject({ textTruncated: 1, unavailableAreaReferences: 2, areaReferencesTruncated: true })
    expect(f.tables).toEqual(before)
    expect(f.executor.mock.calls.every(([name]) => ['records.get', 'records.query'].includes(name))).toBe(true)
  })
  it('never includes foreign strategy or an owned strategy pointing at a foreign Interview', async () => {
    const f = fixture()
    f.strategy('foreign-goal', { goal: 'SQL' }, ['area'], 'bob')
    f.interview('foreign-interview', '2026-10-10', 'bob')
    f.strategy('bad-anchor', { interviewId: 'foreign-interview' })
    const result = await prepReader(f.executor, 'UTC', undefined, 'SQL').snapshot({}, now)
    expect(result.prepPlans).toEqual([])
    await expect(prepReader(f.executor).snapshot({ interviewId: 'foreign-interview' }, now)).rejects.toThrow()
  })
  it('bounds strategy candidates by updated time rather than creation time', async () => {
    const f = fixture()
    for (let i = 0; i < 21; i++) f.strategy(`old-${i}`, { goal: 'Unrelated' })
    f.strategy('edited-goal', { goal: 'SQL' })
    f.tables.get('prep-plans')!.at(-1)!.updatedAt = '2026-10-05T11:00:00Z'
    expect((await prepReader(f.executor, 'UTC', undefined, 'SQL').snapshot({}, now)).prepPlans.map((row) => row.id)).toEqual(['edited-goal'])
  })
  it('keeps goal candidates bounded and reports partial coverage', async () => {
    const f = fixture()
    for (let i = 0; i < 25; i++) f.strategy(`goal-${i}`, { goal: 'SQL' })
    const result = await prepReader(f.executor, 'UTC', undefined, 'SQL').snapshot({}, now)
    expect(result.prepPlans).toHaveLength(3)
    expect(result.coverage.prepPlans.goalCandidates).toMatchObject({ returned: 20, limit: 20, truncated: true })
  })
  it('future strategy uses target Interview timing while difficulty stays actual-asOf and availability remains authoritative', async () => {
    const f = fixture(); f.interview('before', '2026-10-06'); f.strategy('before', { interviewId: 'before' })
    f.interview('future', '2026-10-20'); f.strategy('future', { interviewId: 'future' })
    f.add('prep-sessions', 'active', { planItemId: 'item', intent: 'SQL', startedAt: '2026-10-05T11:00:00Z', state: 'active', encounteredStuck: true })
    for (const [id, endedAt] of [['recent', '2026-10-04T12:10:00Z'], ['not-observed-yet', '2026-10-10T12:10:00Z']]) f.add('prep-sessions', id!, { planItemId: 'item', prepAreaId: 'area', startedAt: '2026-10-04T12:00:00Z', endedAt, state: 'ended', outcome: 'stopped', encounteredStuck: true })
    f.add('plan-items', 'deferred', { intent: 'Later', prepAreaId: 'area', status: 'open', availableFrom: '2026-10-21' })
    const result = await prepReader(f.executor, 'UTC', '2026-10-20').snapshot({}, now)
    expect(result.prepPlans.map((row) => row.id)).toEqual(['future'])
    expect(result.asOf).toBe('2026-10-05T12:00:00.000Z'); expect(result.targetPlanDate).toBe('2026-10-20')
    expect(result.recentFocus).toHaveLength(1)
    expect(result.currentFocus[0]).toMatchObject({ encounteredDifficulty: true })
    expect(result.openWork.map((row) => row.id)).not.toContain('deferred')
  })
  it('completed difficult work remains completed and cannot be enriched as existing recommendation', async () => {
    const f = fixture(); f.tables.get('plan-items')![0]!.data.status = 'completed'; f.tables.get('plan-items')![0]!.data.completedAt = '2026-10-04T12:10:00Z'
    for (let i = 0; i < 2; i++) f.add('prep-sessions', `attempt-${i}`, { planItemId: 'item', prepAreaId: 'area', startedAt: '2026-10-04T12:00:00Z', endedAt: '2026-10-04T12:10:00Z', state: 'ended', outcome: i ? 'completed' : 'stopped', encounteredStuck: true })
    const reader = prepReader(f.executor); const result = await reader.snapshot({}, now)
    expect(result.recentFocus.filter((row) => row.encounteredDifficulty)).toHaveLength(2)
    expect(result.recentlyCompleted[0]!.status).toBe('completed')
    expect(result.openWork).toEqual([])
    await expect(reader.enrich(existingProposal)).rejects.toThrow('no longer open')
  })
  it('prompt treats strategy and friction as untrusted evidence rather than scheduling or diagnosis', () => {
    const prompt = buildSystemPrompt('PrepFlow')
    for (const text of ['durable preparation direction', 'Explicit current Daily priority', 'not guaranteed future state', 'no final outcome yet', 'not failure, severity, proof of weakness', 'DISTINCT related reinforcement', 'never automatically repeat or recreate', 'not causality', 'not failed attempts', 'untrusted USER DATA']) expect(prompt).toContain(text)
    expect(Object.keys(buildTools(fixture().executor))).toEqual(['get_prep_snapshot', 'get_work_context'])
  })
})
