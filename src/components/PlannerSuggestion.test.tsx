import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PlannerSuggestion } from './PlannerSuggestion'
import type { PlannerResponse } from '../ai/planner-contract'

describe('structured planner preview', () => {
  it('renders canonical existing identities, Resume/Start, new work and suggested allocations', () => {
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
    for (const text of ['Canonical execution guidance', 'Canonical resumed', 'Canonical unstarted', 'Resume · SQL', 'Start · SQL', 'New work · SQL · Example', '60 minutes available · 45 minutes allocated', 'not predicted completion times']) expect(html).toContain(text)
    expect(html.match(/class="recommendation-card"/g)).toHaveLength(3)
    expect(html.match(/>Why this<\/h4>/g)).toHaveLength(3)
    expect(html).toContain('aria-label="15 minutes suggested allocation"')
    expect(html).toContain('>15 min</span>')
    expect(html).toContain('Bounded history only.')
    expect(html).toContain('<details class="planner-review-coverage">')
    expect(html).not.toContain('<details open')
  })
})
