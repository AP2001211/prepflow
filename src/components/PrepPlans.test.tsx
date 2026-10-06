import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PrepPlans } from './PrepPlans'
import { PrepPlanForm } from './PrepPlanForm'
import PrepPlanDetailPage from '../pages/(app)/(protected)/plans/prep/[prepPlanId]'
const state = vi.hoisted(() => ({ plans: [] as unknown[], interviews: [] as unknown[], areas: [] as unknown[] }))
vi.mock('deepspace', () => ({ useQuery: (collection: string) => ({ status: 'ready', records: collection === 'prep-plans' ? state.plans : collection === 'interviews' ? state.interviews : state.areas }), useMutations: () => ({ ready: true, createConfirmed: vi.fn() }), getAuthToken: vi.fn() }))
const data = { userId: 'alice', title: 'Google Prep', interviewId: 'interview', context: 'Prioritize clear explanations.', prepAreaIds: ['area'], creationFingerprint: 'fingerprint' }
beforeEach(() => {
  state.plans = [{ recordId: 'prep', data }]
  state.interviews = [{ recordId: 'interview', data: { company: 'Google', role: 'SWE', prepAreaIds: ['area'] } }]
  state.areas = [{ recordId: 'area', data: { name: 'DSA' } }]
})
describe('strategic Prep Plan presentation', () => {
  it('lists Interview and goal identities separately from executable plans', () => {
    state.plans.push({ recordId: 'goal', data: { ...data, interviewId: undefined, title: 'Design Confidence', goal: 'Improve design discussions' } })
    const html = renderToStaticMarkup(<MemoryRouter><PrepPlans /></MemoryRouter>)
    for (const text of ['Prep Plans', 'Google · SWE', 'Improve design discussions', 'DSA', '/plans/prep/prep', '/plans/prep/new']) expect(html).toContain(text)
    expect(html).not.toContain(data.context)
    expect(html.indexOf('Create Prep Plan')).toBeGreaterThan(html.indexOf('Design Confidence'))
    for (const text of ['Start<', 'Resume<', 'completed', 'min planned']) expect(html).not.toContain(text)
  })
  it('keeps the empty section intentional with creation below the empty message', () => {
    state.plans = []
    const html = renderToStaticMarkup(<MemoryRouter><PrepPlans /></MemoryRouter>)
    expect(html).toContain('What matters for your interview or preparation goal.')
    expect(html).toContain('Keep your preparation focus in one place.')
    expect(html).toContain('/plans/prep/new')
    expect(html.indexOf('Create Prep Plan')).toBeGreaterThan(html.indexOf('Keep your preparation focus'))
  })
  it('shows strategic detail without work execution or progress', () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/plans/prep/prep']}><Routes><Route path="/plans/prep/:prepPlanId" element={<PrepPlanDetailPage />} /></Routes></MemoryRouter>)
    for (const text of ['Google Prep', 'Google · SWE', 'Preparing for', 'DSA', 'Preparation focus', 'Prioritize clear explanations.', 'Edit prep plan']) expect(html).toContain(text)
    for (const text of ['Start<', 'Resume<', 'Intended Work', 'budget', 'completed']) expect(html).not.toContain(text)
  })
  it('fails safely for unavailable records and unresolved references', () => {
    state.plans = []
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/plans/prep/missing']}><Routes><Route path="/plans/prep/:prepPlanId" element={<PrepPlanDetailPage />} /></Routes></MemoryRouter>)
    expect(html).toContain('Prep plan unavailable.'); expect(html).toContain('Back to My Prep')
    state.plans = [{ recordId: 'prep', data }]; state.areas = []; state.interviews = []
    const list = renderToStaticMarkup(<MemoryRouter><PrepPlans /></MemoryRouter>)
    expect(list).toContain('Interview unavailable'); expect(list).toContain('Unavailable Prep Area')
  })
  it('creation starts with the anchor and offers generation plus manual fallback', () => {
    const html = renderToStaticMarkup(<MemoryRouter><PrepPlanForm /></MemoryRouter>)
    for (const text of ['What are you preparing for?', 'An interview', 'Another preparation goal', 'Preparation goal', 'Build my prep plan', 'Continue manually']) expect(html).toContain(text)
    expect(html).not.toContain('name="title"'); expect(html).not.toContain('name="context"'); expect(html).not.toContain('Create Prep Area'); expect(html).not.toContain('availableMinutes')
  })
  it('Interview edit cannot reanchor and goal edit retains its goal field', () => {
    const interview = renderToStaticMarkup(<MemoryRouter><PrepPlanForm plan={data} planId="prep" /></MemoryRouter>)
    expect(interview).not.toContain('What are you preparing for?'); expect(interview).not.toContain('name="goal"')
    const goal = renderToStaticMarkup(<MemoryRouter><PrepPlanForm plan={{ ...data, interviewId: undefined, goal: 'Design' }} planId="prep" /></MemoryRouter>)
    expect(goal).toContain('name="goal"'); expect(goal).toContain('Design')
  })
})

it('keeps historical long preparation context readable and editable', () => {
  const context = 'Historical strategic preparation context. '.repeat(40)
  state.plans = [{ recordId: 'prep', data: { ...data, context } }]
  const detail = renderToStaticMarkup(<MemoryRouter initialEntries={['/plans/prep/prep']}><Routes><Route path="/plans/prep/:prepPlanId" element={<PrepPlanDetailPage />} /></Routes></MemoryRouter>)
  expect(detail).toContain(context)
  expect(renderToStaticMarkup(<MemoryRouter><PrepPlanForm plan={{ ...data, context }} planId="prep" /></MemoryRouter>)).toContain(context)
})
