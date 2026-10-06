import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PlannerSuggestion, PlannerCoverage } from './PlannerSuggestion'
import type { PlannerResponse } from '../ai/planner-contract'

describe('structured planner preview', () => {
  it('renders canonical existing identities, attempt history, new activities and suggested allocations', () => {
    const result: PlannerResponse = { availableMinutes: 60, totalMinutes: 45, generatedAt: '', readTools: ['get_prep_snapshot'], coverageNotices: ['Bounded history only.'], recommendation: {
      title: 'Tonight', rationale: 'Continue preparation', items: [
        { kind: 'existing', existingPlanItemId: 'resumed', estimatedMinutes: 15, reason: 'Saved context' },
        { kind: 'existing', existingPlanItemId: 'unstarted', estimatedMinutes: 15, reason: 'Planned work' },
        { kind: 'new', prepAreaId: 'area', interviewId: 'interview', intent: 'New SQL', estimatedMinutes: 15, reason: 'Interview context' },
      ],
    }, display: [
      { intent: 'Canonical resumed', instructions: 'Canonical execution guidance', prepAreaId: 'area', prepAreaName: 'SQL', previouslyStarted: true },
      { intent: 'Canonical unstarted', prepAreaId: 'area', prepAreaName: 'SQL', previouslyStarted: false },
      { intent: 'New SQL', prepAreaId: 'area', prepAreaName: 'SQL', interviewId: 'interview', interviewCompany: 'Example', previouslyStarted: false },
    ] }
    const html = renderToStaticMarkup(<PlannerSuggestion result={result} />)
    for (const text of ['Canonical execution guidance', 'Canonical resumed', 'Canonical unstarted', 'Previously started · SQL', 'Not started · SQL', 'New activity · SQL · Example', '45 of 60 min selected', 'not predicted completion times']) expect(html).toContain(text)
    expect(html.match(/class="recommendation-card"/g)).toHaveLength(3)
    expect(html.match(/<summary>Why this\?<\/summary>/g)).toHaveLength(3)
    expect(html).toContain('<summary>Why these suggestions?</summary>')
    expect(html).not.toContain('Resume ·')
    expect(html).not.toContain('Start ·')
    expect(html).toContain('aria-label="15 minutes suggested allocation"')
    expect(html).toContain('>15 min</span>')
    const coverage = renderToStaticMarkup(<PlannerCoverage notices={result.coverageNotices} />)
    expect(coverage).toContain('Bounded history only.')
    expect(coverage).toContain('<details class="planner-review-coverage">')
    expect(html).not.toContain('<details open')
    const selective = renderToStaticMarkup(<PlannerSuggestion result={result} selectedIndices={[0, 2]} disabled onSelection={() => {}} />)
    expect(selective.match(/type="checkbox"/g)).toHaveLength(3)
    expect(selective.match(/checked=""/g)).toHaveLength(2)
    expect(selective.match(/disabled=""/g)).toHaveLength(3)
    expect(selective).toContain('data-selected="false"')
    expect(selective).toContain('Canonical unstarted')
    expect(selective).toContain('30 of 60 min selected')
    expect(renderToStaticMarkup(<PlannerSuggestion result={result} heading="Suggestions for today’s plan" />)).not.toContain('>Tonight<')
  })
})
