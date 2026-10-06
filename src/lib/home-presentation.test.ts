import { describe, expect, it } from 'vitest'
import type { RecordData } from 'deepspace'
import type { Interview } from '../schemas/prep-schema'
import { localGreeting, nextInterviews } from './home-presentation'
const row = (id: string, date?: string): RecordData<Interview> => ({ recordId: id, data: { company: id, prepAreaIds: [], ...(date ? { scheduledDate: date } : {}) }, createdAt: '', updatedAt: '', createdBy: 'owner' })
describe('Home presentation selection', () => {
  it('selects upcoming dates chronologically including local today', () => {
    expect(nextInterviews([row('old', '2026-10-01'), row('later', '2026-10-06'), row('today', '2026-10-02'), row('undated'), row('invalid', '2026-02-30')], '2026-10-02').map((r) => r.recordId)).toEqual(['today', 'later'])
  })
  it('uses stable IDs for date ties and caps the list at three', () => {
    expect(nextInterviews([row('b', '2026-10-06'), row('a', '2026-10-06'), row('d', '2026-10-08'), row('c', '2026-10-07')], '2026-10-02').map((r) => r.recordId)).toEqual(['a', 'b', 'c'])
  })
  it('omits absent, past and undated context', () => { expect(nextInterviews([row('old', '2026-10-01'), row('undated')], '2026-10-02')).toEqual([]) })
  it('uses client-local hours for the greeting', () => {
    expect(localGreeting(new Date(2026, 9, 2, 9))).toBe('Good morning,')
    expect(localGreeting(new Date(2026, 9, 2, 15))).toBe('Good afternoon,')
    expect(localGreeting(new Date(2026, 9, 2, 20))).toBe('Good evening,')
  })
})
