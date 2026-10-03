import { readFileSync } from 'node:fs'
import { test, expect } from 'deepspace/testing'

// Render real Home components from the deterministic unit fixtures, with the
// real compiled stylesheet. This supplements authenticated interaction tests.
test('Home composition desktop and mobile fixtures', async ({ page }) => {
  await page.route('**/api/ai/prep-plan', (route) => route.abort())
  const response = await page.request.get('/src/styles.css?direct')
  expect(response.ok()).toBe(true)
  const themeResponse = await page.request.get('/src/themes.css?direct')
  expect(themeResponse.ok()).toBe(true)
  const css = (await response.text()) + '\n' + (await themeResponse.text())
  for (const state of ['empty', 'populated', 'active', 'active-no-plan', 'minimal', 'completed', 'long-tied']) {
    const html = readFileSync(`/tmp/prepflow-home-${state}.html`, 'utf8')
    for (const width of [1920, 1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.setContent(`<html data-theme="prepflow"><head><style>${css}</style></head><body>${html}</body></html>`)
      expect(await page.locator('.home-layout').evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgb(250, 242, 223)')
      const primary = page.locator('.home-primary > .focus-hero, .home-primary > .today-plan:not(.today-plan-subordinate), .home-primary > .plan-invitation:not(.plan-invitation-subordinate)').first()
      if (await primary.count()) {
        const focusing = await primary.evaluate((node) => node.classList.contains('focus-hero'))
        expect(await primary.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(focusing ? 'rgb(35, 107, 101)' : 'rgb(253, 248, 234)')
        const title = primary.locator('.display-title').first()
        const typography = await title.evaluate((node) => ({ size: parseFloat(getComputedStyle(node).fontSize), weight: Number(getComputedStyle(node).fontWeight), color: getComputedStyle(node).color }))
        expect(typography.size >= 24 || (typography.size >= 18.667 && typography.weight >= 700)).toBe(true)
        expect(typography.color).toBe(focusing ? 'rgb(253, 248, 234)' : 'rgb(32, 40, 38)')
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${state} ${width} overflow`).toBe(true)
      const columns = await page.locator('.home-work-grid').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)
      expect(columns).toBe(width >= 1100 && await page.locator('.home-secondary-rail > *').count() ? 2 : 1)
      const frame = await page.locator('.home-layout').boundingBox()
      expect(frame!.width).toBe(Math.min(width, 1640))
      const lowerHeading = await page.locator('.home-start-other h2').evaluate((node) => ({ size: parseFloat(getComputedStyle(node).fontSize), weight: getComputedStyle(node).fontWeight }))
      expect(lowerHeading.size).toBe(width >= 1100 ? 34 : 28)
      expect(lowerHeading.weight).toBe('500')
      await expect(page.locator('.home-heading .home-interview')).toHaveCount(0)
      const upcoming = page.getByRole('region', { name: 'Upcoming', exact: true })
      const pickup = page.getByRole('region', { name: 'Pick Back Up' })
      if (await upcoming.count()) {
        await expect(page.locator('.home-secondary-rail .home-upcoming')).toHaveCount(1)
        if (await pickup.count()) {
          const pickupBox = await pickup.boundingBox()
          const upcomingBox = await upcoming.boundingBox()
          expect(upcomingBox!.y).toBeGreaterThanOrEqual(pickupBox!.y + pickupBox!.height)
        }
      }
      if (state === 'completed') await expect(page.getByText('3 of 3 complete', { exact: false })).toBeVisible()
      if (state === 'long-tied') await expect(page.getByText('2 interviews on Oct 6')).toBeVisible()
      if (state === 'minimal') { await expect(page.getByRole('region', { name: 'Pick Back Up' })).toHaveCount(0); await expect(page.getByLabel('Upcoming interview context')).toHaveCount(0) }
      await page.screenshot({ path: `/tmp/prepflow-home-${state}-${width}.png`, fullPage: true })
    }
  }
})

test('Focus composition desktop and mobile fixtures', async ({ page }) => {
  const stylesheet = await page.request.get('/src/styles.css?direct')
  const origin = new URL(stylesheet.url()).origin
  const css = await stylesheet.text() + '\n' + await (await page.request.get('/src/themes.css?direct')).text()
  expect((await page.request.get('/images/focus-landscape.png')).ok()).toBe(true)
  for (const state of ['normal', 'long']) {
    for (const width of [1920, 1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      const html = readFileSync(`/tmp/prepflow-focus-${state}.html`, 'utf8')
      await page.setContent(`<html data-theme="prepflow"><head><base href="${origin}/"><style>${css}</style></head><body><main>${html}</main></body></html>`)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await expect(page.getByRole('button', { name: 'Complete', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'End to switch', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Report difficulty (keep working)', exact: true })).toBeVisible()
      await expect(page.getByLabel('Focus duration', { exact: true })).toHaveCount(1)
      await expect(page.getByRole('complementary')).toHaveCount(1)
      const notes = page.getByRole('textbox')
      await notes.fill('Working notes remain editable')
      expect(await notes.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgb(252, 248, 239)')
      expect(await page.getByLabel('Focus duration').evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(48)
      await page.screenshot({ path: `/tmp/prepflow-focus-${state}-${width}.png`, fullPage: true })
    }
  }
})
