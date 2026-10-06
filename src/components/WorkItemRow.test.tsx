import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { RecordData } from 'deepspace'
import type { Plan, PlanItem } from '../schemas/prep-schema'
import { WorkItemRow } from './WorkItemRow'
const state = vi.hoisted(() => ({ sessions: [] as { data: { planItemId: string; state: string } }[] }))
vi.mock('deepspace', () => ({ useQuery: () => ({ records: [{ recordId: 'area', data: { name: 'DSA' } }] }) }))
vi.mock('./FocusController', () => ({ useFocus: () => ({ canStart: true, pendingIds: new Set(), sessions: { records: state.sessions } }) }))
const item: RecordData<PlanItem> = { recordId: 'item', createdBy: 'alice', createdAt: '', updatedAt: '', data: { intent: 'Heap mock', instructions: 'Explain all edge cases.', prepAreaId: 'area', status: 'open' } }
const plan: RecordData<Plan> = { recordId: 'daily', createdBy: 'alice', createdAt: '', updatedAt: '', data: { title: 'Historical long name '.repeat(8), planDate: '2026-10-05', planItemIds: ['item'], budgetMinutes: 30 } }
const other = { ...plan, recordId: 'other' }
function render(compact: boolean, completed = false) { return renderToStaticMarkup(<MemoryRouter><WorkItemRow compact={compact} item={completed ? { ...item, data: { ...item.data, status: 'completed' } } : item} plan={plan} plans={[plan, other]} /></MemoryRouter>) }
describe('calendar work overview', () => {
  it('keeps identity/category/state and execution while omitting detailed context', () => {
    state.sessions = []
    const html = render(true)
    for (const text of ['Heap mock', 'DSA', 'Not started', '>Start<']) expect(html).toContain(text)
    for (const text of ['Explain all edge cases', 'total focus', 'Also included in', 'open ·']) expect(html).not.toContain(text)
    expect(render(false)).toContain('Explain all edge cases')
    expect(render(false)).toContain('total focus')
    expect(render(false)).toContain('Also included in')
  })
  it('uses exact item history for Resume and retains completion presentation', () => {
    state.sessions = [{ data: { planItemId: 'another', state: 'ended' } }]
    expect(render(true)).toContain('Not started')
    state.sessions = [{ data: { planItemId: 'item', state: 'ended' } }]
    expect(render(true)).toContain('Previously started'); expect(render(true)).toContain('>Resume<')
    expect(render(true, true)).toContain('Completed'); expect(render(true, true)).not.toContain('<button')
  })
})
