import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { PlanBuildButton, PlanBuildLink } from './PlanBuildAction'
import { InterviewContext } from './PreparationContext'
import { FocusAttempt } from './FocusAttempt'
import type { RecordData } from 'deepspace'
import type { Interview, PrepSession } from '../schemas/prep-schema'
import { PREP_STRATEGY_PROMPT, validatePrepStrategy } from '../ai/prep-strategy-contract'
const record = { recordId: 'session', data: { state: 'active', startedAt: new Date().toISOString(), intent: 'Work identity', instructions: 'Explain tradeoffs', encounteredStuck: false } } as RecordData<PrepSession>
const props = { record, area: 'DSA', interview: 'General preparation', disabled: false, notes: 'Notebook draft', onNotes: vi.fn(), onStuck: vi.fn(async () => true), onEnd: vi.fn(async () => true) }
describe('product presentation boundaries', () => {
  it('uses conventional links/buttons preserving submission and disabled state', () => {
    const html = renderToStaticMarkup(<MemoryRouter><PlanBuildLink to="/plans/suggest?mode=daily">Plan more</PlanBuildLink><PlanBuildButton type="submit" disabled>Building…</PlanBuildButton></MemoryRouter>)
    expect(html).toContain('href="/plans/suggest?mode=daily"'); expect(html).toContain('type="submit"'); expect(html).toContain('disabled')
    expect(html).not.toContain('<svg'); expect(html).not.toContain('build-action-inset')
  })
  it('keeps Focus continuity visible, instructions disclosed, and notebook distinct', () => {
    const predecessor = { ...record, data: { ...record.data, leftOff: 'At partitioning', nextStep: 'Try a smaller input' } }
    const html = renderToStaticMarkup(<FocusAttempt {...props} predecessor={predecessor} />)
    expect(html).toContain('<summary>How to approach this</summary>'); expect(html).not.toMatch(/<details[^>]* open/)
    expect(html).toContain('Explain tradeoffs'); expect(html).toContain('<h5>Last time</h5>'); expect(html).toContain('<h5>Next step</h5>')
    expect(html).toContain('At partitioning'); expect(html).toContain('Try a smaller input'); expect(html).not.toContain('Left off:'); expect(html).not.toContain('Next:')
    expect(html).toMatch(/<textarea[^>]*>Notebook draft<\/textarea>/)
    expect(renderToStaticMarkup(<FocusAttempt {...props} />)).not.toContain('No saved context')
    expect(renderToStaticMarkup(<FocusAttempt {...props} record={{ ...record, data: { ...record.data, instructions: undefined } }} />)).not.toContain('focus-session-context')
  })
  it('uses persisted difficulty for confirmation and preserves the unreported action', () => {
    const unreported = renderToStaticMarkup(<FocusAttempt {...props} />)
    expect(unreported).toMatch(/<button[^>]*class="[^"]*focus-report-difficulty[^"]*"[^>]*>Report difficulty \(keep working\)<\/button>/)
    const html = renderToStaticMarkup(<FocusAttempt {...props} record={{ ...record, data: { ...record.data, encounteredStuck: true } }} />)
    expect(html).toContain('role="status"'); expect(html).toContain('Difficulty noted'); expect(html).not.toContain('Report difficulty (keep working)')
    expect(html).not.toContain('focus-report-difficulty')
    for (const action of ['Complete', 'Stop', 'End to switch']) expect(html).toContain(action)
  })
  it('orders dated upcoming interviews before past/undated records, preserving linked areas', () => {
    const rows = [['past', '2026-10-04'], ['later', '2026-10-12'], ['undated', undefined], ['today', '2026-10-05']].map(([company, scheduledDate]) => ({ recordId: company, data: { company, scheduledDate, prepAreaIds: ['area'], role: 'Engineer' } })) as RecordData<Interview>[]
    const html = renderToStaticMarkup(<InterviewContext today="2026-10-05" areas={[]} interviews={rows} ready areaName={() => 'DSA'} onCreateInterview={async () => {}} />)
    expect(html.indexOf('>today</h3>')).toBeLessThan(html.indexOf('>later</h3>'))
    expect(html.indexOf('>later</h3>')).toBeLessThan(html.indexOf('>past</h3>'))
    expect(html.indexOf('>past</h3>')).toBeLessThan(html.indexOf('>undated</h3>'))
    expect(html).toContain('Past ·'); expect(html).toContain('Date not set'); expect(html).toContain('DSA'); expect(html).toContain('<summary>Add Interview</summary>')
  })
  it('requests compact strategic prose without changing the safety contract', () => {
    for (const text of ['one compact paragraph', '1–3 short sentences', '30–60 words', 'generic encouragement', 'task lists', 'minute allocations', 'Never invent IDs']) expect(PREP_STRATEGY_PROMPT).toContain(text)
    expect(validatePrepStrategy({ title: 'Strategy', context: 'x'.repeat(2000), existingPrepAreaIds: [], suggestedPrepAreas: [] }, []).context.length).toBe(2000)
  })
})
