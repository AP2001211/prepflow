import { test, expect } from '@playwright/test'
import { captureConsoleErrors } from './helpers/errors'

/**
 * Smoke tests covering both page kinds this template ships:
 *   - '/'      → the static landing (top level of src/pages/): no providers,
 *                so no auth fetch and no records WebSocket on load.
 *   - '/home'  → a dynamic page (under src/pages/(app)/): the providers mount,
 *                the nav shell renders, and the records WebSocket connects.
 *
 * The "static contract" test is the guardrail for the per-page opt-out: if
 * someone moves the providers back up into _app.tsx, it fails.
 */

/** Wait for the React app shell (present on every page). */
async function waitForApp(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 })
}

test.describe('Smoke tests', () => {
  test('static landing loads without JS errors', async ({ page }) => {
    const errors = captureConsoleErrors(page)
    await page.goto('/')
    await waitForApp(page)
    await expect(page.getByTestId('static-landing')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('landing carries one title, one description, one canonical', async ({ page }) => {
    // <Seo> (src/pages/index.tsx, values from src/seo.ts) hoists these into
    // <head>. Exactly one of each: index.html ships no static description or
    // canonical, because React 19 would not dedupe against them on mount.
    await page.goto('/')
    await expect(page.getByTestId('static-landing')).toBeVisible()
    await expect(page).toHaveTitle(/\S/)
    expect(await page.locator('head meta[name="description"]').count()).toBe(1)
    expect(await page.locator('head link[rel="canonical"]').count()).toBe(1)
  })

  test('static contract: landing fires no auth request, opens no websocket', async ({ page }) => {
    const offenders: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('/api/auth/')) offenders.push(req.url())
    })
    // Only the DO room route counts — vite's own HMR socket is a dev artifact.
    page.on('websocket', (ws) => {
      if (new URL(ws.url()).pathname.startsWith('/ws/')) offenders.push(`ws: ${ws.url()}`)
    })
    await page.goto('/')
    await expect(page.getByTestId('static-landing')).toBeVisible()
    await page.waitForTimeout(1500)
    expect(offenders).toEqual([])
  })

  test('dynamic app boundary mounts on /home', async ({ page }) => {
    await page.goto('/home')
    await expect(page.getByTestId('app-navigation')).toBeVisible({ timeout: 15000 })
  })

  test('signed-out navbar leaves authentication to the gateway', async ({ page }) => {
    await page.goto('/home')
    const nav = page.getByTestId('app-navigation')
    await expect(nav.getByRole('link', { name: 'prepflow', exact: true })).toBeVisible({ timeout: 15000 })
    await expect(nav.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0)
    await expect(page.locator('.signed-out-gateway').getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
    await expect(page.getByTestId('nav-user-name')).toHaveCount(0)
  })

  test('unknown route shows 404', async ({ page }) => {
    await page.goto('/nonexistent-page-xyz')
    await waitForApp(page)
    await expect(page.locator('text=404')).toBeVisible()
  })

  test('PrepFlow workspace stays private while signed out', async ({ page }) => {
    await page.goto('/home')
    await expect(page.getByRole('heading', { name: 'Keep your interview preparation moving.' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Current Focus' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Create Prep Area', exact: true })).toHaveCount(0)
  })
})

test('public entry uses product copy and enters the app', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading')).toContainText('Prepare with intention.')
  await expect(page.getByText('A DeepSpace app with a static front door')).toHaveCount(0)
  await page.getByRole('link', { name: 'Start preparing' }).click()
  await expect(page).toHaveURL(/\/home$/)
})

for (const width of [1440, 390]) {
  test(`signed-out gateway and auth overlay at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    for (const path of ['/home', '/plans', '/plans/suggest', '/plans/unknown-plan', '/prep', '/history', '/settings', '/focus']) {
      await page.goto(path)
      await expect(page).toHaveURL(new RegExp(`${path}$`))
      await expect(page.getByRole('heading', { name: 'Keep your interview preparation moving.' })).toBeVisible()
      const nav = page.getByTestId('app-navigation')
      if (path !== '/focus') {
        await expect(nav.getByRole('link', { name: 'prepflow', exact: true })).toBeVisible()
      }
      await expect(nav.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0)
      await expect(page.locator('.signed-out-gateway').getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
      for (const label of ['Home', 'Plans', 'My Prep', 'History']) {
        await expect(nav.getByRole('link', { name: label, exact: true })).toHaveCount(0)
      }
      await expect(page.getByRole('button', { name: 'Toggle menu' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Create Prep Area', exact: true })).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    const overlay = page.getByTestId('auth-overlay')
    await expect(overlay.getByRole('heading', { name: 'Sign in to PrepFlow' })).toBeVisible()
    await expect(overlay.getByText('Continue your interview preparation where you left off.')).toBeVisible()
    await expect(overlay.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible()
    await expect(overlay.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
    await overlay.getByRole('button', { name: 'Sign in with email' }).click()
    expect(await overlay.getByRole('button', { name: 'Sign in', exact: true }).evaluate(n => getComputedStyle(n).backgroundColor)).toBe('rgb(35, 107, 101)')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await overlay.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(overlay).toHaveCount(0)
  })
}
