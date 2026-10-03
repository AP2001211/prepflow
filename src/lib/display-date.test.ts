import { describe, expect, it } from 'vitest'
import { displayDate } from './display-date'
describe('calendar date presentation', () => {
  it('formats the intended calendar day without exposing storage syntax', () => {
    expect(displayDate('2026-10-02')).toContain('October 2')
    expect(displayDate('2026-10-02', true)).toContain('Oct 2')
    expect(displayDate('2026-10-02')).not.toContain('2026-10-02')
  })
})
