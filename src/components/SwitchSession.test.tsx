import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { SwitchSession } from './SwitchSession'
import { browserDay } from '../lib/plan-date'
const state = vi.hoisted(() => ({ source: null as unknown, status: 'ready', active: [] as unknown[], plans: [] as unknown[], items: [] as unknown[], sessions: [] as unknown[] }))
vi.mock('deepspace', () => ({ useAuthStatus: () => ({ userId: 'alice' }), useQuery: (collection: string, options?: { where?: { recordId?: string } }) => ({ status: state.status, records: collection === 'prep-sessions' && options?.where?.recordId === 'source' && state.source ? [state.source] : collection === 'plans' ? state.plans : [] }) }))
vi.mock('./FocusController', () => ({ useFocus: () => ({ ready: true, loaded: true, canStart: !state.active.length, active: state.active, items: { records: state.items }, sessions: { records: state.sessions } }) }))
vi.mock('./WorkItemForm', () => ({ WorkItemForm: () => null }))
const row = (extra = {}, owner = 'alice') => ({ recordId: 'source', createdBy: owner, data: { intent: 'Source task', planItemId: 'source-item', state: 'ended', outcome: 'switched', startedAt: '2026-10-04T12:00:00Z', endedAt: '2026-10-04T12:30:00Z', leftOff: 'Saved breadcrumb', nextStep: 'Saved next', switchReason: 'stuck', ...extra } })
const render = () => renderToStaticMarkup(<MemoryRouter><SwitchSession sessionId="source" /></MemoryRouter>)
describe('persisted Switch surface', () => {
  it('resolves persisted identity and saved context without transient drafts', () => {
    state.status = 'ready'; state.active = []; state.source = row()
    const html = render()
    expect(html).toContain('Source task'); expect(html).toContain('30 min focused')
    expect(html).toContain('Saved breadcrumb'); expect(html).toContain('Saved next')
    expect(html).toContain("I&#x27;m done for now")
    expect(html).not.toContain('focus-landscape')
  })
  it.each([null, row({ state: 'active' }), row({ outcome: 'stopped' }), row({}, 'bob')])('fails safely for missing, active, non-switched and foreign sources', (source) => {
    state.status = 'ready'; state.source = source
    expect(render()).toContain('This switch session is unavailable.')
    expect(render()).toContain('href="/home"')
  })
  it('offers Return to Focus instead of competing start controls', () => {
    state.source = row(); state.active = [{}]
    const html = render()
    expect(html).toContain('Return to Focus'); expect(html).not.toContain('What pulled you away?')
    expect(html).not.toContain('Start something else')
    state.active = []
  })
  it('does not mistake loading for an invalid session', () => {
    state.source = null; state.status = 'loading'
    expect(render()).toContain('Loading your session'); expect(render()).not.toContain('unavailable')
    state.status = 'ready'
  })
})

it('uses the shared current daily plan selection and shows only its open work', () => {
  state.source = row(); state.active = []; state.status = 'ready'
  state.plans = [{ recordId: 'today', createdBy: 'alice', data: { planDate: browserDay().planDate, planItemIds: ['open', 'done'] } }]
  state.items = [{ recordId: 'open', createdBy: 'alice', data: { intent: 'Next planned work', status: 'open' } }, { recordId: 'done', createdBy: 'alice', data: { intent: 'Completed planned work', status: 'completed' } }]
  const html = render()
  expect(html).toContain("Today&#x27;s Plan"); expect(html).toContain('Next planned work'); expect(html).not.toContain('Completed planned work')
  state.plans = [...state.plans, { recordId: 'conflict', createdBy: 'alice', data: { planDate: browserDay().planDate, planItemIds: ['open'] } }]
  expect(render()).toContain('Multiple incomplete plans exist today')
  expect(render()).not.toContain('Next planned work')
  state.plans = []; state.items = []
})

it('initially presents only the reason interaction and optional exits', () => {
  state.source = row({ switchReason: undefined, leftOff: undefined, nextStep: undefined }); state.active = []; state.status = 'ready'
  const html = render()
  expect(html).toContain('Before you move on'); expect(html).toContain('Skip → choose what')
  expect(html).toContain("I&#x27;m done for now")
  expect(html).not.toContain('<textarea'); expect(html).not.toContain('aria-label="Next work"'); expect(html).not.toContain('Save context')
})

it('renders each destination once and never offers the switched source work', () => {
  state.source = row(); state.active = []; state.status = 'ready'
  state.plans = [{ recordId: 'today', createdBy: 'alice', data: { planDate: browserDay().planDate, planItemIds: ['source-item', 'resume', 'new'] } }]
  state.items = ['source-item', 'resume', 'new'].map((id) => ({ recordId: id, createdBy: 'alice', data: { intent: `${id} destination`, status: 'open' } }))
  state.sessions = ['source-item', 'resume'].map((id) => ({ recordId: `${id}-session`, data: { planItemId: id, state: 'ended', outcome: 'switched', endedAt: '2026-10-04T12:30:00Z' } }))
  const html = render()
  expect(html).not.toContain('source-item destination')
  expect(html.match(/resume destination/g)).toHaveLength(1)
  expect(html).toContain('new destination')
  state.plans = []; state.items = []; state.sessions = []
})


it('keeps empty context quiet, retains Add context, and offers a secondary Home exit', () => {
  state.source = row({ leftOff: undefined, nextStep: undefined }); state.active = []; state.status = 'ready'
  state.plans = []; state.items = []; state.sessions = []
  const html = render()
  expect(html).not.toContain('View all work')
  expect(html).not.toContain('/plans#unfinished-work')
  expect(html).not.toContain('No return context added.')
  expect(html).toContain('Add context')
  expect(html).toMatch(/<button[^>]*data-slot="button"[^>]*class="[^"]*bg-secondary[^"]*switch-done[^"]*"[^>]*>I&#x27;m done for now<\/button>/)
})
