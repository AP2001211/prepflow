import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import PrepPage from '../pages/(app)/(protected)/prep'
import PrepPlanNew from '../pages/(app)/(protected)/plans/prep/new'
import { nav, navigationPath } from '../nav'
vi.mock('deepspace', () => ({ useQuery: () => ({ status: 'ready', records: [] }), useMutations: () => ({ ready: true }), getAuthToken: vi.fn() }))
vi.mock('./FocusController', () => ({ useFocus: () => ({ ready: true }) }))
describe('My Prep information architecture', () => {
  it('contains connected Prep Plans and Prep Areas without Interview management', () => {
    const html = renderToStaticMarkup(<MemoryRouter><PrepPage /></MemoryRouter>)
    expect(html.indexOf('aria-label="Prep Plans"')).toBeLessThan(html.indexOf('>Prep Areas</h2>'))
    expect(html).not.toContain('>Interviews</h2>')
    expect(html).toContain('Keep your preparation focus in one place.')
    expect(html).toContain('/plans/prep/new')
    expect(html).not.toContain('<summary>Add Interview</summary>'); expect(html).toContain('<summary>Add Prep Area</summary>')
    expect(html).not.toContain('Upcoming Interviews'); expect(html).not.toMatch(/<details[^>]* open/)
  })
  it('keeps URLs while directing creation back to My Prep', () => {
    const html = renderToStaticMarkup(<MemoryRouter><PrepPlanNew /></MemoryRouter>)
    expect(html).toContain('href="/prep"'); expect(html).toContain('Back to My Prep')
  })
  it('maps Prep Plan navigation to My Prep and retains Daily Plans navigation without History', () => {
    expect(navigationPath('/plans/prep/new')).toBe('/prep')
    expect(navigationPath('/plans/prep/owned')).toBe('/prep')
    expect(navigationPath('/plans/suggest')).toBe('/plans/suggest')
    expect(nav.map((item) => item.label)).toEqual(['Home', 'Plans', 'My Prep', 'Interviews'])
  })
})
