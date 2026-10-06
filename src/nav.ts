/**
 * Navigation Config
 *
 * Add one entry per nav item. Routes are handled by generouted
 * (file-based routing in src/pages/), this just controls what
 * appears in the navigation bar.
 */

import type { Role } from './constants'

export interface NavItem {
  path: string
  label: string
  roles?: Role[]
  devOnly?: boolean
}

export const nav: NavItem[] = [
  { path: '/home', label: 'Home' },
  { path: '/plans', label: 'Plans' },
  { path: '/prep', label: 'My Prep' },
  { path: '/interviews', label: 'Interviews' },
  // The /api-status debug page still exists — add
  // `{ path: '/api-status', label: 'API Status', devOnly: true }` to surface it.
  // ── Features add nav items below this line ──
]

/** Prep Plan URLs remain stable while their navigation home is My Prep. */
export function navigationPath(pathname: string) {
  return pathname.startsWith('/plans/prep/') ? '/prep' : pathname
}
