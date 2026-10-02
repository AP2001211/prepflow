import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { useQuery } from 'deepspace'
import SuggestPlanPage from '../pages/(app)/(protected)/plans/suggest'
vi.mock('deepspace', () => ({ useQuery: vi.fn(), getAuthToken: vi.fn() }))
vi.mock('./FocusController', () => ({ useFocus: () => ({ ready: true }) }))

describe('planner prerequisites', () => {
  it('directs a user with no areas to My Prep instead of offering generation', () => {
    vi.mocked(useQuery).mockReturnValue({ records: [], status: 'ready' } as ReturnType<typeof useQuery>)
    const html = renderToStaticMarkup(<MemoryRouter><SuggestPlanPage /></MemoryRouter>)
    expect(html).toContain('href="/prep"')
    expect(html).toContain('An interview is optional')
    expect(html).not.toContain('Build my plan')
  })
})
