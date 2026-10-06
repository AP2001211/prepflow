import { FocusAttempt } from './FocusAttempt'
import { PrepWorkspace } from './PrepWorkspace'
import { HomeUpcoming } from './HomeHeading'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { TodayPlan } from './TodayPlan'
import { FocusSummary } from './FocusSummary'
import { ContinueWork } from './ContinueWork'
const state = vi.hoisted(() => ({ plans: [] as unknown[], items: [] as unknown[], sessions: [] as unknown[], active: [] as unknown[], interviews: [] as unknown[], canStart: true, pendingIds: new Set<string>(), completion: null as { sessionId: string; title: string; startedAt: string; endedAt: string } | null }))
vi.mock('deepspace', () => ({ useQuery: (collection: string) => ({ records: collection === 'plans' ? state.plans : collection === 'interviews' ? state.interviews : collection === 'prep-areas' ? [{ recordId: 'area', data: { name: 'DSA', notes: 'Graphs, arrays, and dynamic programming' } }, { recordId: 'design', data: { name: 'System Design', notes: 'Architecture and scaling' } }, { recordId: 'behavioral', data: { name: 'Behavioral', notes: 'Practice interview stories' } }] : [], status: 'ready' }) }))
vi.mock('../lib/use-local-day', () => ({ useLocalDay: () => ({ planDate: '2026-10-02', timeZone: 'America/New_York' }) }))
vi.mock('./FocusController', () => ({ useFocus: () => ({ active: state.active, completion: state.completion, sessions: { records: state.sessions }, items: { records: state.items }, loaded: true, pending: [], pendingIds: state.pendingIds, canStart: state.canStart, draft: () => ({}) }) }))
const render = (node: React.ReactNode) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>)
beforeEach(() => { state.plans = []; state.items = []; state.sessions = []; state.active = []; state.interviews = []; state.completion = null; state.pendingIds = new Set(); state.canStart = true })
describe('Home state hierarchy', () => {
  it('omits the empty focus strip after loading', () => {
    expect(render(<FocusSummary />)).toBe('')
  })
  it('never promotes a general or historical plan', () => {
    state.plans = [{ recordId: 'general', data: { title: 'General', planItemIds: [] } }, { recordId: 'old', data: { title: 'Old', planDate: '2026-10-01', planItemIds: [] } }]
    const html = render(<TodayPlan planDate="2026-10-02" />)
    expect(html).toContain('mode=daily'); expect(html).not.toContain('>General<'); expect(html).not.toContain('>Old<')
  })
  it('keeps a fully complete daily plan visible with authoritative counts', () => {
    state.plans = [{ recordId: 'today', data: { title: 'A good day', planDate: '2026-10-02', planItemIds: ['item'], budgetMinutes: 30 } }]
    state.items = [{ recordId: 'item', data: { intent: 'SQL joins', status: 'completed' } }]
    const html = render(<TodayPlan planDate="2026-10-02" />)
    expect(html).toContain('1 of 1 complete'); expect(html).toContain('30 minute budget'); expect(html).toContain('You finished what you planned for today'); expect(html).toContain('Plan more for today')
  })
  it('foregrounds literal active focus with a real destination', () => {
    state.active = [{ recordId: 'session', data: { intent: 'Course Schedule II', startedAt: '2026-10-02T12:00:00Z' } }]
    const html = render(<FocusSummary />)
    expect(html).toContain('focus-hero'); expect(html).toContain('Course Schedule II'); expect(html).toContain('href="/focus"'); expect(html).toContain('Focus duration')
  })
  it('caps Pick Back Up at three and uses only the latest ended context', () => {
    state.items = [0, 1, 2, 3].map((i) => ({ recordId: `item${i}`, data: { status: 'open', intent: `Work ${i}` } }))
    state.sessions = [0, 1, 2, 3].map((i) => ({ recordId: `session${i}`, data: { planItemId: `item${i}`, state: 'ended', endedAt: `2026-10-02T12:0${i}:00Z`, leftOff: `New ${i}` } }))
    state.sessions.push({ recordId: 'older', data: { planItemId: 'item3', state: 'ended', endedAt: '2026-10-01T12:00:00Z', leftOff: 'STALE' } })
    const html = render(<ContinueWork />)
    expect((html.match(/<li /g) ?? []).length).toBe(3); expect(html).not.toContain('STALE'); expect(html).toContain('/plans#unfinished-work')
  })
  it('keeps other unfinished work visible during active focus', () => {
    state.items = ['active-work', 'other-work'].map((id) => ({ recordId: id, data: { status: 'open', intent: id } }))
    state.active = [{ recordId: 'current', data: { state: 'active', planItemId: 'active-work' } }]
    state.sessions = [...state.active, ...['active-work', 'other-work'].map((id) => ({ recordId: id, data: { state: 'ended', planItemId: id, endedAt: '2026-10-02T12:00:00Z' } }))]
    const html = render(<ContinueWork />)
    expect(html).toContain('other-work')
    expect(html).not.toContain('>active-work<')
    expect(html).toContain('Pick Back Up')
  })
})

describe('Home composition fixtures', () => {
  it('renders real prep-area entry cards and keeps navigation separate', () => {
    const html = render(<PrepWorkspace />)
    expect(html).toContain('Graphs, arrays, and dynamic programming')
    expect(html).toContain('prep-area-object-title')
    expect(html).toContain('Add area')
    expect(html).not.toContain('>Start something else</button>')
  })
  it('renders neutral tied interview context and omits an absent interview', () => {
    expect(render(<HomeUpcoming planDate="2026-10-02" />)).not.toContain('Upcoming interview context')
    state.interviews = ['Google', 'Amazon'].map((company) => ({ recordId: company, data: { company, scheduledDate: '2026-10-06' } }))
    const html = render(<HomeUpcoming planDate="2026-10-02" />)
    expect(html).toContain('Google'); expect(html).toContain('Amazon'); expect(html).toContain('Oct 6'); expect(html).toContain('href="/interviews"')
  })
  it('renders all composition states for isolated browser layout verification', async () => {
    const { writeFileSync } = await vi.importActual<{ writeFileSync: (path: string, contents: string) => void }>('node:fs')
    const work = (id: string, intent: string, status = 'open') => ({ recordId: id, data: { intent, prepAreaId: 'area', status } })
    state.items = [work('a', 'Course Schedule II'), work('b', 'Design a Rate Limiter'), work('c', 'Prepare behavioral stories')]
    state.sessions = [{ recordId: 'old', data: { planItemId: 'a', state: 'ended', endedAt: '2026-10-01T12:00:00Z', nextStep: 'Implement three-state visited tracking' } }]
    state.interviews = [{ recordId: 'google', data: { company: 'Google', role: 'Software Engineer', scheduledDate: '2026-10-06' } }]
    const save = (name: string) => writeFileSync(`/tmp/prepflow-home-${name}.html`, render(<PrepWorkspace />))
    const focusMarkup = (intent: string) => render(<div className="focus-workspace"><a href="/home" className="quiet-link">← Home</a><section className="focus-content"><h2 className="focus-eyebrow">Current Focus</h2><FocusAttempt record={{ recordId: 'visual', data: { planItemId: 'a', prepAreaId: 'area', intent, state: 'active', encounteredStuck: false, startedAt: new Date(Date.now() - 684000).toISOString() }, createdAt: '', updatedAt: '', createdBy: 'fixture-user' }} area="Behavioral" interview="General preparation" disabled={false} notes="" onNotes={() => {}} onStuck={async () => true} onEnd={async () => true} /></section></div>)
    writeFileSync('/tmp/prepflow-focus-normal.html', focusMarkup('Prepare stories'))
    writeFileSync('/tmp/prepflow-focus-long.html', focusMarkup('Practice a detailed interview story: ' + 'LeadershipPrinciples'.repeat(10)))
    save('empty')
    state.plans = [{ recordId: 'today', data: { title: 'Interview preparation', planDate: '2026-10-02', budgetMinutes: 60, planItemIds: ['a', 'b', 'c'] } }]
    save('populated')
    state.active = [{ recordId: 'active', data: { planItemId: 'b', prepAreaId: 'area', intent: 'Design a Rate Limiter', startedAt: new Date().toISOString() } }]
    save('active')
    state.plans = []; save('active-no-plan')
    state.active = []; state.sessions = []; state.interviews = []; save('minimal')
    state.plans = [{ recordId: 'today', data: { title: 'Completed preparation', planDate: '2026-10-02', planItemIds: ['a', 'b', 'c'] } }]
    state.items = [work('a', 'Course Schedule II', 'completed'), work('b', 'Design a Rate Limiter', 'completed'), work('c', 'Prepare behavioral stories', 'completed')]
    save('completed')
    state.interviews = ['Google', 'Amazon'].map((company) => ({ recordId: company, data: { company, scheduledDate: '2026-10-06' } }))
    state.items = [work('a', 'An intentionally long task title to check wrapping: ' + 'DynamicProgramming'.repeat(12))]
    state.plans = [{ recordId: 'today', data: { title: 'A plan with long intended work', planDate: '2026-10-02', planItemIds: ['a'] } }]
    save('long-tied')
    state.completion = { sessionId: 'accepted', title: 'Completed work with a long title: ' + 'DynamicProgramming'.repeat(10), startedAt: '2026-10-02T12:00:00Z', endedAt: '2026-10-02T12:11:24Z' }
    save('recent-completion')
    expect(render(<PrepWorkspace />)).toContain('home-work-grid')
  })
})

it('shows session instructions separately from checkpoint and editable notebook', () => {
  const html = render(<FocusAttempt record={{ recordId: 'instruction-session', data: { planItemId: 'item', prepAreaId: 'area', intent: 'Course Schedule II', instructions: 'Talk through edge cases', state: 'active', encounteredStuck: false, startedAt: '2026-10-02T12:00:00Z' }, createdAt: '', updatedAt: '', createdBy: 'alice' }} area="DSA" interview="General preparation" disabled={false} notes="User notebook only" onNotes={() => {}} onStuck={async () => true} onEnd={async () => true} />)
  expect(html).toContain('<summary>How to approach this</summary>'); expect(html).not.toMatch(/<details[^>]* open/); expect(html).not.toContain('No saved context')
  expect(html).toContain('Talk through edge cases')
  expect(html).toMatch(/<textarea[^>]*>User notebook only<\/textarea>/)
  expect(html).not.toContain('Left off: Talk through edge cases')
})

it('Home selects one incomplete Plan and fails closed on multiple incomplete Plans', () => {
  state.items = [{ recordId: 'open', data: { intent: 'Open work', status: 'open' } }, { recordId: 'done', data: { intent: 'Done work', status: 'completed' } }]
  state.plans = [{ recordId: 'done', data: { title: 'Completed plan', planDate: '2026-10-02', planItemIds: ['done'] } }, { recordId: 'current', data: { title: 'Current plan', planDate: '2026-10-02', planItemIds: ['open'] } }]
  let html = render(<TodayPlan planDate="2026-10-02" />)
  expect(html).toContain('Current plan'); expect(html).toContain('Completed earlier today'); expect(html).toContain('Completed plan'); expect(html).not.toContain('mode=daily')
  state.plans.push({ recordId: 'conflict', data: { title: 'Conflict plan', planDate: '2026-10-02', planItemIds: ['open'] } })
  html = render(<TodayPlan planDate="2026-10-02" />)
  expect(html).toContain('Multiple incomplete plans'); expect(html).not.toContain('mode=daily')
})

describe('Completed earlier today presentation', () => {
  const date = '2026-10-02'
  const item = (recordId: string, status = 'completed') => ({ recordId, createdBy: 'alice', data: { intent: `Private work ${recordId}`, status } })
  const plan = (recordId: string, planItemIds: string[], budgetMinutes?: number, createdAt = '2026-10-02T12:00:00Z', planDate: string | undefined = date) => ({ recordId, createdAt, createdBy: 'alice', data: { title: `Plan ${recordId}`, planDate, planItemIds, budgetMinutes } })
  const markup = () => render(<div className="home-layout"><TodayPlan planDate={date} /></div>)
  const disclosure = (html: string) => html.match(/<details class="today-completed-earlier">([\s\S]*?)<\/details>/)?.[1] ?? ''

  it('preserves the exact 2/2 completed + 0/3 current fixture, with collapsed plan-level summaries', async () => {
    state.items = [item('a'), item('b'), item('c', 'open'), item('d', 'open'), item('e', 'open')]
    state.plans = [plan('1', ['a', 'b'], 60), plan('2', ['c', 'd', 'e'], 60, '2026-10-02T14:00:00Z')]
    const html = markup()
    expect(html).toContain('<h2 class="display-title break-words">Plan 2</h2>')
    expect(html).toContain('0 of 3 complete')
    expect(disclosure(html)).toContain('Completed earlier today · 1 plan · 60 min planned')
    expect(disclosure(html)).toContain('2 of 2 completed · 60 min planned')
    expect(disclosure(html)).toContain('href="/plans/1"')
    expect(disclosure(html)).not.toContain('Private work')
    expect(disclosure(html)).not.toContain('Plan 2')
    expect(html).not.toMatch(/<details[^>]*\sopen/)
    expect(html).not.toContain('Multiple incomplete plans')
    expect(html).not.toContain('Plan more for today')
    const { writeFileSync } = await vi.importActual<{ writeFileSync: (path: string, contents: string) => void }>('node:fs')
    writeFileSync('/tmp/prepflow-completed-earlier.html', html)
  })

  it('lists all completed Plans beneath a current Plan and totals only their planned budgets', () => {
    state.items = [item('a'), item('b'), item('open', 'open')]
    state.plans = [plan('first', ['a'], 60), plan('second', ['b'], 30, '2026-10-02T14:00:00Z'), plan('current', ['open'], 90)]
    const html = markup()
    expect(disclosure(html)).toContain('2 plans · 90 min planned')
    expect(disclosure(html).indexOf('Plan second')).toBeLessThan(disclosure(html).indexOf('Plan first'))
    expect(disclosure(html)).not.toContain('Plan current')
  })

  it('keeps the newest completed Plan primary and discloses older Plans in creation/ID order', () => {
    state.items = [item('done')]
    state.plans = [plan('a', ['done'], 10), plan('c', ['done'], 30), plan('b', ['done'], 20), plan('newest', ['done'], 60, '2026-10-02T14:00:00Z')]
    const html = markup()
    expect(html).toContain('<h2 class="display-title break-words">Plan newest</h2>')
    const earlier = disclosure(html)
    expect(earlier).toContain('3 plans · 60 min planned')
    expect(earlier.indexOf('Plan c')).toBeLessThan(earlier.indexOf('Plan b'))
    expect(earlier.indexOf('Plan b')).toBeLessThan(earlier.indexOf('Plan a'))
    expect(earlier).not.toContain('Plan newest')
    expect(html).not.toContain('Plan more for today')
  })

  it('omits redundant disclosure for a single completed Plan', () => {
    state.items = [item('done')]; state.plans = [plan('only', ['done'], 60)]
    expect(markup()).not.toContain('today-completed-earlier')
    expect(markup()).toContain('Plan more for today')
  })

  it('keeps conflict primary while allowing subordinate completed summaries', () => {
    state.items = [item('done'), item('open', 'open')]
    state.plans = [plan('done', ['done'], 60), plan('open-one', ['open']), plan('open-two', ['open'])]
    const html = markup()
    expect(html).toContain('Multiple incomplete plans')
    expect(html).not.toContain('display-title')
    expect(html).not.toContain('mode=daily')
    expect(disclosure(html)).toContain('Plan done')
    expect(html.indexOf('Multiple incomplete plans')).toBeLessThan(html.indexOf('Completed earlier today'))
  })

  it('omits absent budgets, excludes past/general Plans, and never fabricates completion for missing work', () => {
    state.items = [item('done'), item('open', 'open')]
    state.plans = [plan('no-budget', ['done']), plan('current', ['open']), plan('past', ['done'], 100, undefined, '2026-10-01'), { ...plan('general', ['done'], 100), data: { title: 'General', planItemIds: ['done'] } }]
    let html = markup()
    expect(disclosure(html)).toContain('1 plan</summary>')
    expect(disclosure(html)).not.toContain('min planned')
    expect(html).not.toContain('Plan past')
    expect(html).not.toContain('>General<')
    state.plans = [plan('unresolved', ['missing']), plan('done', ['done'])]
    html = markup()
    expect(html).toContain('<h2 class="display-title break-words">Plan unresolved</h2>')
    expect(disclosure(html)).not.toContain('Plan unresolved')
    expect(html).not.toContain('Plan more for today')
  })
})

it('offers secondary incomplete extension while keeping exact-item Start/Resume actions', () => {
  state.plans = [{ recordId: 'today', createdBy: 'alice', data: { title: 'Practice', planDate: '2026-10-02', planItemIds: ['new', 'attempted'] } }]
  state.items = ['new', 'attempted'].map((recordId) => ({ recordId, createdBy: 'alice', data: { intent: recordId, prepAreaId: 'area', status: 'open' } }))
  state.sessions = [{ data: { planItemId: 'attempted', state: 'ended' } }]
  const html = render(<TodayPlan planDate="2026-10-02" />)
  expect(html).toContain('class="today-extend-action"')
  expect(html).toContain('Add to today&#x27;s plan')
  expect(html).toContain('href="/plans/suggest?mode=daily"')
  expect(html).toContain('>Start</button>'); expect(html).not.toContain('>Resume</button>')
  expect(html).not.toContain('Build another plan')
})

it('Home shows only the first open actionable item, retaining exact Resume and full-plan access', () => {
  state.items = ['done', 'first', 'second'].map((id) => ({ recordId: id, data: { intent: `Intent ${id}`, status: id === 'done' ? 'completed' : 'open', prepAreaId: 'area' } }))
  state.plans = [{ recordId: 'today', data: { title: 'Today mix', planDate: '2026-10-02', planItemIds: ['done', 'first', 'second'], budgetMinutes: 60 } }]
  state.sessions = [{ recordId: 'attempt', data: { planItemId: 'first', state: 'ended' } }]
  const html = render(<TodayPlan planDate="2026-10-02" />)
  expect(html).toContain('1 of 3 complete'); expect(html).toContain('60 minute budget')
  expect(html).toContain('Intent first'); expect(html).not.toContain('Intent second'); expect(html).not.toContain('Intent done')
  expect(html).toContain('Resume'); expect(html).toContain('/plans/today'); expect(html).toContain('Add to today')
})

it('Home omits pending and active work from the next action and keeps start controls guarded', () => {
  state.items = ['pending', 'active', 'next'].map((id) => ({ recordId: id, data: { intent: `Item ${id}`, status: 'open' } }))
  state.plans = [{ recordId: 'today', data: { title: 'Guarded plan', planDate: '2026-10-02', planItemIds: ['pending', 'active', 'next'] } }]
  state.pendingIds.add('pending'); state.active = [{ recordId: 'active-session', data: { planItemId: 'active' } }]; state.canStart = false
  let html = render(<TodayPlan planDate="2026-10-02" />)
  expect(html).toContain('Item next'); expect(html).not.toContain('Item pending'); expect(html).not.toContain('Item active')
  expect(html).toMatch(/<button[^>]*disabled/)
  state.plans = [{ recordId: 'today', data: { title: 'Closed plan', planDate: '2026-10-02', planItemIds: ['next'], closedAt: '2026-10-02T13:00:00Z' } }]
  html = render(<TodayPlan planDate="2026-10-02" />)
  expect(html).not.toContain('>Start</button>'); expect(html).not.toContain('Add to today')
  expect(html).toContain('/plans/today')
})

it('renders up to three upcoming interview identities in calendar order with My Prep links', () => {
  state.interviews = [
    ['late', 'Late', '2026-10-12'], ['tie-b', 'Tie B', '2026-10-06'], ['past', 'Past', '2026-10-01'],
    ['today', 'Today interview', '2026-10-02'], ['tie-a', 'Tie A', '2026-10-06'], ['invalid', 'Invalid', '2026-02-30'],
  ].map(([recordId, company, scheduledDate]) => ({ recordId, data: { company, role: 'Engineer', scheduledDate } }))
  const html = render(<HomeUpcoming planDate="2026-10-02" />)
  expect(html.indexOf('Today interview')).toBeLessThan(html.indexOf('Tie A'))
  expect(html.indexOf('Tie A')).toBeLessThan(html.indexOf('Tie B'))
  expect((html.match(/href="\/interviews"/g) ?? []).length).toBe(3)
  for (const company of ['Late', 'Past', 'Invalid']) expect(html).not.toContain(`>${company}<`)
})
