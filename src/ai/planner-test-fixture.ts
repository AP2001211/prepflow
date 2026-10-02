import { vi } from 'vitest'

export type FixtureRow = { recordId: string; createdBy: string; createdAt: string; data: Record<string, unknown> }
/** Deterministic record boundary with caller-owned visibility; never calls a provider. */
export function contextFixture(userId = 'alice') {
  const tables = new Map<string, FixtureRow[]>()
  function add(collection: string, id: string, data: Record<string, unknown>, owner = 'alice', createdAt = '2026-10-01T12:00:00Z') {
    const rows = tables.get(collection) ?? []
    rows.push({ recordId: id, createdBy: owner, createdAt, data }); tables.set(collection, rows)
  }
  function field(row: FixtureRow, key: string) { return key === 'recordId' ? row.recordId : key === 'createdBy' ? row.createdBy : key === 'createdAt' ? row.createdAt : row.data[key] }
  const executor = vi.fn(async (name: string, params: Record<string, unknown>): Promise<unknown> => {
    const rows = (tables.get(String(params.collection)) ?? []).filter((row) => row.createdBy === userId)
    if (name === 'records.get') {
      const record = rows.find((row) => row.recordId === params.recordId)
      return record ? { success: true, data: { record: structuredClone(record) } } : { success: false, error: 'Unavailable' }
    }
    if (name !== 'records.query') throw new Error('Mutation attempted during generation')
    const where = params.where && typeof params.where === 'object' ? Object.entries(params.where) : []
    const filtered = rows.filter((row) => where.every(([key, value]) => field(row, key) === value))
    const orderBy = String(params.orderBy ?? 'createdAt')
    filtered.sort((a, b) => String(field(a, orderBy) ?? '').localeCompare(String(field(b, orderBy) ?? '')) * (params.orderDir === 'asc' ? 1 : -1))
    return { success: true, data: { records: structuredClone(filtered.slice(0, Number(params.limit ?? 50))), count: filtered.length } }
  })
  add('prep-areas', 'area', { name: 'SQL', notes: 'Practice relational queries.' })
  add('plan-items', 'item', { prepAreaId: 'area', intent: 'Window functions', status: 'open' })
  add('plans', 'original', { title: 'Original', planItemIds: ['item'], closedAt: '2026-10-01T12:00:00Z' })
  add('plans', 'later', { title: 'Later', planItemIds: ['item'], budgetMinutes: 90 })
  add('prep-areas', 'foreign-area', { name: 'Private foreign area' }, 'bob')
  add('plan-items', 'foreign-item', { prepAreaId: 'foreign-area', intent: 'Private work', status: 'open' }, 'bob')
  return { tables, add, executor }
}

export const existingProposal = {
  title: 'A focused SQL block', rationale: 'Continue existing preparation.',
  items: [{ kind: 'existing' as const, existingPlanItemId: 'item', estimatedMinutes: 30, reason: 'Existing unfinished work.' }],
}
