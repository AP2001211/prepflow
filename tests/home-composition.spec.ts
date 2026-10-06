import { readFileSync } from 'node:fs'
import { test, expect } from 'deepspace/testing'

test('Completed earlier today disclosure desktop and mobile', async ({ page }) => {
  await page.route('**/api/ai/prep-plan', (route) => route.abort())
  const stylesheet = await page.request.get('/src/styles.css?direct')
  const origin = new URL(stylesheet.url()).origin
  const css = await stylesheet.text() + '\n' + await (await page.request.get('/src/themes.css?direct')).text()
  const html = readFileSync('/tmp/prepflow-completed-earlier.html', 'utf8')
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.setContent(`<html data-theme="prepflow"><head><base href="${origin}/"><style>${css}</style></head><body><div class="authenticated-app">${html}</div></body></html>`)
    await expect(page.getByRole('heading', { name: 'Plan 2', exact: true })).toBeVisible()
    const earlier = page.locator('.today-completed-earlier')
    await expect(earlier).not.toHaveAttribute('open', '')
    await expect(earlier.getByRole('heading', { name: 'Plan 1', exact: true })).not.toBeVisible()
    await earlier.locator('summary').focus()
    await page.keyboard.press('Enter')
    await expect(earlier).toHaveAttribute('open', '')
    await expect(earlier.getByRole('heading', { name: 'Plan 1', exact: true })).toBeVisible()
    await expect(earlier.getByText('2 of 2 completed · 60 min planned')).toBeVisible()
    await expect(earlier.getByRole('link')).toHaveAttribute('href', '/plans/1')
    await expect(page.getByRole('link', { name: 'Plan more for today' })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `/tmp/prepflow-completed-earlier-${width}.png`, fullPage: true })
  }
})

// Render real Home components from the deterministic unit fixtures, with the
// real compiled stylesheet. This supplements authenticated interaction tests.
test('Home composition desktop and mobile fixtures', async ({ page }) => {
  await page.route('**/api/ai/prep-plan', (route) => route.abort())
  const response = await page.request.get('/src/styles.css?direct')
  expect(response.ok()).toBe(true)
  const themeResponse = await page.request.get('/src/themes.css?direct')
  expect(themeResponse.ok()).toBe(true)
  const css = (await response.text()) + '\n' + (await themeResponse.text())
  const assetBase = new URL(response.url()).origin
  expect((await page.request.get('/images/illustrations/planner.png')).ok()).toBe(true)
  expect((await page.request.get('/images/illustrations/focus-target.png')).ok()).toBe(true)
  for (const state of ['empty', 'populated', 'active', 'active-no-plan', 'minimal', 'completed', 'long-tied', 'recent-completion']) {
    const html = readFileSync(`/tmp/prepflow-home-${state}.html`, 'utf8')
    for (const width of [1920, 1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1)
      await page.setContent(`<html data-theme="prepflow"><head><base href="${assetBase}/"><style>${css}</style></head><body><div class="authenticated-app">${html}</div></body></html>`)
      if (state === 'recent-completion') {
        // Static layout fixture: freeze the timed acknowledgement for screenshots.
        await page.addStyleTag({ content: '.home-completion { animation: none !important; }' })
        await expect(page.getByRole('status', { name: 'Work completed' })).toBeVisible()
        await expect(page.getByRole('link', { name: /Return to focus/ })).toHaveCount(0)
      }
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
      const target = page.locator('.home-focus-artwork')
      if (await target.count()) {
        expect(await target.evaluate((node) => getComputedStyle(node).display)).toBe(width >= 1100 ? 'block' : 'none')
      }
      const artwork = page.locator('.today-planner-illustration')
      if (await artwork.count()) expect(await artwork.evaluate((node) => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0)).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${state} ${width} overflow`).toBe(true)
      const columns = await page.locator('.home-work-grid').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)
      expect(columns).toBe(width >= 1100 && await page.locator('.home-secondary-rail > *').count() ? 2 : 1)
      const frame = await page.locator('.home-layout').boundingBox()
      expect(frame!.width).toBe(Math.min(width, 1640))
      for (const card of await page.locator('.today-plan').all()) {
        expect(await card.evaluate((node) => getComputedStyle(node).paddingTop)).toBe('14px')
        expect(await card.locator('.today-work-row').evaluateAll((nodes) => nodes.every((node) => getComputedStyle(node).paddingTop === '8px'))).toBe(true)
      }
      const lowerHeading = await page.locator('.home-start-other h2').evaluate((node) => ({ size: parseFloat(getComputedStyle(node).fontSize), weight: getComputedStyle(node).fontWeight }))
      expect(lowerHeading.size).toBe(24)
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
      if (state === 'long-tied') { await expect(page.getByText('Google', { exact: true })).toBeVisible(); await expect(page.getByText('Amazon', { exact: true })).toBeVisible() }
      if (state === 'minimal') { await expect(page.getByRole('region', { name: 'Pick Back Up' })).toHaveCount(0); await expect(page.getByLabel('Upcoming interview context')).toHaveCount(0) }
      await page.screenshot({ path: `/tmp/prepflow-home-${state}-${width}.png`, fullPage: true })
      if (state === 'empty' && width === 1440) {
        await page.setViewportSize({ width, height: 768 })
        // Fixture omits the shell; reserve its unchanged 64px navbar height.
        await page.evaluate(() => { const shell = document.createElement('div'); shell.style.height = '64px'; document.body.prepend(shell) })
        const introduction = page.locator('.home-start-other > div').first()
        const box = await introduction.boundingBox()
        expect(box!.y + box!.height).toBeLessThan(768)
        await page.screenshot({ path: '/tmp/prepflow-home-fold-1440-768.png', fullPage: true })
        await page.setViewportSize({ width, height: 600 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      }
    }
  }
})

test('Focus composition desktop and mobile fixtures', async ({ page }) => {
  const stylesheet = await page.request.get('/src/styles.css?direct')
  const origin = new URL(stylesheet.url()).origin
  const css = await stylesheet.text() + '\n' + await (await page.request.get('/src/themes.css?direct')).text()
  expect((await page.request.get('/images/focus-forest.jpg')).ok()).toBe(true)
  for (const state of ['normal', 'long']) {
    for (const width of [1920, 1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1)
      const html = readFileSync(`/tmp/prepflow-focus-${state}.html`, 'utf8')
      await page.setContent(`<html data-theme="prepflow"><head><base href="${origin}/"><style>${css}</style></head><body><div class="authenticated-app"><main>${html}</main></div></body></html>`)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await expect(page.getByRole('button', { name: 'Complete', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'End to switch', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Report difficulty (keep working)', exact: true })).toBeVisible()
      await expect(page.getByLabel('Focus duration', { exact: true })).toHaveCount(1)
      await expect(page.getByRole('complementary')).toHaveCount(0)
      const notes = page.getByRole('textbox')
      await notes.fill('Working notes remain editable')
      expect(await notes.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgb(252, 248, 239)')
      expect(await page.getByLabel('Focus duration').evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(48)
      await page.screenshot({ path: `/tmp/prepflow-focus-${state}-${width}.png`, fullPage: true })
    }
  }
})
