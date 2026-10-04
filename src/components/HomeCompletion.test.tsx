import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { HomeCompletion } from './HomeCompletion'

describe('Home completion acknowledgement', () => {
  it('uses the Home focus card and accepted final duration without active-session controls', () => {
    const html = renderToStaticMarkup(<HomeCompletion completion={{ sessionId: 'accepted', title: 'Course Schedule II', startedAt: '2026-10-03T12:00:00Z', endedAt: '2026-10-03T12:11:24Z' }} />)
    expect(html).toContain('Completed')
    expect(html).toContain('Course Schedule II')
    expect(html).toContain('11m 24s')
    expect(html).toContain('focused')
    expect(html).toContain('focus-hero')
    expect(html).toContain('focus-target.png')
    expect(html).not.toContain('Return to focus')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('focus-workspace')
  })
})
