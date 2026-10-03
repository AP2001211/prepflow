import { FocusAttempt } from './FocusAttempt'
import { PrepWorkspace } from './PrepWorkspace'
import { HomeUpcoming } from './HomeHeading'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { TodayPlan } from './TodayPlan'
import { FocusSummary } from './FocusSummary'
import { ContinueWork } from './ContinueWork'
const state = vi.hoisted(() => ({ plans: [] as unknown[], items: [] as unknown[], sessions: [] as unknown[], active: [] as unknown[], interviews: [] as unknown[] }))
vi.mock('deepspace', () => ({ useQuery: (collection: string) => ({ records: collection === 'plans' ? state.plans : collection === 'interviews' ? state.interviews : collection === 'prep-areas' ? [{ recordId: 'area', data: { name: 'DSA', notes: 'Graphs, arrays, and dynamic programming' } }, { recordId: 'design', data: { name: 'System Design', notes: 'Architecture and scaling' } }, { recordId: 'behavioral', data: { name: 'Behavioral', notes: 'Practice interview stories' } }] : [], status: 'ready' }) }))
vi.mock('../lib/use-local-day', () => ({ useLocalDay: () => ({ planDate: '2026-10-02', timeZone: 'America/New_York' }) }))
vi.mock('./FocusController', () => ({ useFocus: () => ({ active: state.active, sessions: { records: state.sessions }, items: { records: state.items }, loaded: true, pending: [], pendingIds: new Set(), canStart: true, draft: () => ({}) }) }))
const render = (node: React.ReactNode) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>)
beforeEach(() => { state.plans = []; state.items = []; state.sessions = []; state.active = []; state.interviews = [] })
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
    expect(html).toContain('1 of 1 complete'); expect(html).toContain('30 minute budget'); expect(html).toContain('Your plan stays here for today'); expect(html).not.toContain('mode=daily')
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
    expect(html).toContain('2 interviews on Oct 6'); expect(html).not.toContain('Google'); expect(html).toContain('href="/prep"')
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
    expect(render(<PrepWorkspace />)).toContain('home-work-grid')
  })
})
