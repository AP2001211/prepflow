import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import PlansPage from '../pages/(app)/(protected)/plans/index'
import { PlansCalendar } from './PlansCalendar'
const state = vi.hoisted(() => ({ plans: [] as unknown[], items: [] as unknown[] }))
vi.mock('deepspace', () => ({ useQuery: () => ({ status: 'ready', records: state.plans }) }))
vi.mock('../lib/use-local-day', () => ({ useLocalDay: () => ({ planDate: '2026-10-05' }) }))
vi.mock('./FocusController', () => ({ useFocus: () => ({ loaded: true, ready: true, items: { records: state.items } }) }))
vi.mock('./WorkItemRow', () => ({ WorkItemRow: ({ item }: { item: { data: { intent: string } } }) => <div>{item.data.intent}</div> }))
vi.mock('./PrepPlans', () => ({ PrepPlans: () => <section>Prep Plans</section> }))
const plan = (recordId: string, planDate?: string, closedAt?: string) => ({ recordId, data: { title: recordId, planDate, closedAt, planItemIds: [] } })
const render = () => renderToStaticMarkup(<MemoryRouter><PlansPage /></MemoryRouter>)
beforeEach(() => { state.plans = []; state.items = [] })
describe('Plans daily overview', () => {
  it('defaults to today and preserves daily planning access in its empty state', () => {
    const html = render()
    expect(html).toContain('Today · October 5')
    expect(html).toContain('Nothing planned for today yet.')
    expect(html).toContain('/plans/suggest?mode=daily')
  })
  it('shows distinct exact-date daily plans with quiet legacy compatibility', () => {
    state.plans = [plan('daily-one', '2026-10-05'), plan('daily-two', '2026-10-05'), plan('general', undefined, '2026-10-01T00:00:00Z'), plan('past', '2026-10-04')]
    const html = render()
    const primary = html.split('aria-label="Selected day"')[1]!.split('</section>')[0]!
    expect(primary).toContain('daily-one'); expect(primary).toContain('daily-two')
    expect(primary).not.toContain('general'); expect(primary).not.toContain('past')
    expect(html).toContain('/plans/general'); expect(html).not.toContain('Daily Plan archive')
    expect(html).toContain('has daily plans')
    expect(html).not.toContain('<details open')
    expect(html).toContain('All unfinished work'); expect(html).not.toContain('Prep Plans'); expect(html).not.toContain('Create a general Plan'); expect(html).toContain('Earlier plan records')
  })
  it('calendar distinguishes selected date, today, and plan indicators', () => {
    const html = renderToStaticMarkup(<PlansCalendar month="2026-10" selected="2026-10-04" today="2026-10-05" dates={new Set(['2026-10-04'])} onMonth={() => {}} onSelect={() => {}} />)
    expect(html).toContain('aria-pressed="true"'); expect(html).toContain('aria-current="date"')
    expect(html.match(/plans-calendar-dot/g)).toHaveLength(1)
    expect(html).toContain('Previous month'); expect(html).toContain('Next month')
  })
})

it('selects a future URL date and links exactly to daily planning, with invalid URL fallback', () => {
  const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/plans?date=2099-01-01']}><PlansPage /></MemoryRouter>)
  expect(html).toContain('Nothing planned for this day yet.')
  expect(html).toContain('/plans/suggest?mode=daily&amp;planDate=2099-01-01')
  expect(html).toContain('January 2099')
  const invalid = renderToStaticMarkup(<MemoryRouter initialEntries={['/plans?date=invalid']}><PlansPage /></MemoryRouter>)
  expect(invalid).toContain('Today · October 5')
})

it('offers intentional extension access and omits the obsolete generic entry without hiding legacy plans', () => {
  state.plans = [plan('daily', '2026-10-05'), plan('legacy-general')]
  const html = render()
  expect(html).toContain('Add to today&#x27;s plan')
  expect(html).toContain('/plans/suggest?mode=daily&amp;planDate=2026-10-05')
  expect(html).not.toContain('Help me plan')
  expect(html).toContain('/plans/legacy-general')
  const future = renderToStaticMarkup(<MemoryRouter initialEntries={['/plans?date=2099-01-01']}><PlansPage /></MemoryRouter>)
  expect(future).toContain('Plan this day')
})

it('omits the legacy compatibility disclosure when no undated records exist', () => {
  state.plans = [plan('daily', '2026-10-05')]
  expect(render()).not.toContain('Earlier plan records')
  expect(render()).not.toContain('Daily Plan archive')
})

it('keeps calendar navigation and cross-cutting utilities without a duplicate archive', () => {
  state.plans = [plan('daily', '2026-10-05'), plan('legacy')]
  const html = render()
  expect(html).toContain('aria-label="Daily Plans"')
  expect(html).not.toContain('Daily Plan archive')
  expect(html).toContain('Previous month'); expect(html).toContain('Next month')
  expect(html.indexOf('All unfinished work')).toBeGreaterThan(html.indexOf('aria-label="Daily Plans"'))
  expect(html.indexOf('Earlier plan records')).toBeGreaterThan(html.indexOf('aria-label="Daily Plans"'))
})

it('keeps historical Daily Plans accessible through exact-date selection', () => {
  state.plans = [plan('historical', '2026-10-04')]
  const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/plans?date=2026-10-04']}><PlansPage /></MemoryRouter>)
  expect(html).toContain('historical')
  expect(html).toContain('/plans/historical')
  expect(html).not.toContain('Daily Plan archive')
})

it('keeps unfinished work global when changing calendar dates', () => {
  state.items = [{ recordId: 'open', data: { intent: 'Global open work', status: 'open' } }]
  for (const date of ['2026-10-04', '2026-10-05', '2026-10-08']) {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={[`/plans?date=${date}`]}><PlansPage /></MemoryRouter>)
    expect(html).toContain('Global open work')
    expect(html).toContain('Open work across dates')
    expect(html).not.toContain('Prep Plans')
  }
})
