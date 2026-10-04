import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { useQuery } from 'deepspace'
import { localPlanDate } from '../lib/plan-date'
import SuggestPlanPage from '../pages/(app)/(protected)/plans/suggest'
vi.mock('deepspace', () => ({ useQuery: vi.fn(), getAuthToken: vi.fn() }))
const focusState = vi.hoisted(() => ({ items: [] as unknown[] }))
vi.mock('./FocusController', () => ({ useFocus: () => ({ ready: true, loaded: true, items: { records: focusState.items } }) }))

describe('planner prerequisites', () => {
  it('directs a user with no areas to My Prep instead of offering generation', () => {
    vi.mocked(useQuery).mockReturnValue({ records: [], status: 'ready' } as ReturnType<typeof useQuery>)
    const html = renderToStaticMarkup(<MemoryRouter><SuggestPlanPage /></MemoryRouter>)
    expect(html).toContain('href="/prep"')
    expect(html).toContain('An interview is optional')
    expect(html).not.toContain('Build my plan')
  })
})

it('daily suggestion blocks incomplete Plans and allows completed same-day history', () => {
  focusState.items = [{ recordId: 'item', createdBy: 'alice', data: { status: 'open' } }]
  vi.mocked(useQuery).mockImplementation((collection) => ({ records: collection === 'plans' ? [{ recordId: 'today', createdBy: 'alice', createdAt: '', updatedAt: '', data: { title: 'Today', planItemIds: ['item'], planDate: localPlanDate(Intl.DateTimeFormat().resolvedOptions().timeZone) } }] : [{ recordId: 'area', createdBy: 'alice', createdAt: '', updatedAt: '', data: { name: 'DSA' } }], status: 'ready' }))
  const render = () => renderToStaticMarkup(<MemoryRouter initialEntries={['/plans/suggest?mode=daily']}><SuggestPlanPage /></MemoryRouter>)
  expect(render()).not.toContain('Build my plan')
  focusState.items = [{ recordId: 'item', createdBy: 'alice', data: { status: 'completed' } }]
  expect(render()).toContain('Build my plan')
})

it('defaults a bare planner URL to daily mode and requires explicit generic mode for undated planning', () => {
  focusState.items = []
  vi.mocked(useQuery).mockImplementation((collection) => ({ records: collection === 'plans' ? [] : [{ recordId: 'area', createdBy: 'alice', createdAt: '', updatedAt: '', data: { name: 'DSA' } }], status: 'ready' }))
  const render = (url: string) => renderToStaticMarkup(<MemoryRouter initialEntries={[url]}><SuggestPlanPage /></MemoryRouter>)
  for (const url of ['/plans/suggest', '/plans/suggest?mode=daily']) {
    expect(render(url)).toContain('Build today’s plan')
    expect(render(url)).toContain('Today ·')
  }
  expect(render('/plans/suggest?mode=generic')).toContain('Help me plan')
  expect(render('/plans/suggest?mode=generic')).not.toContain('Today ·')
})
