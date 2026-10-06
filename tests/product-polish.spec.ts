import { test, expect } from 'deepspace/testing'

test('Interviews navigation, connected My Prep, density, Focus disclosures and reduced-motion completion', async ({ users }) => {
  test.setTimeout(60000)
  const [alice, bob] = await users(2)
  const page = alice.page
  await page.route('**/api/ai/**', (route) => route.abort())
  const prefix = `__polish-${Date.now()}__`
  await page.goto('/prep')
  const navigation = page.getByTestId('app-navigation')
  await expect(navigation.getByRole('link', { name: 'Interviews', exact: true })).toHaveAttribute('href', '/interviews')
  await expect(navigation.getByRole('link', { name: 'History', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Prep Plans', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Interviews', exact: true })).toHaveCount(0)
  await page.getByText('Add Prep Area', { exact: true }).click()
  await page.getByLabel('Area name', { exact: true }).fill(`${prefix} Design`)
  await page.getByRole('button', { name: 'Create Prep Area', exact: true }).click()
  await expect(page.getByRole('heading', { name: `${prefix} Design`, exact: true })).toBeVisible()
  await navigation.getByRole('link', { name: 'Interviews', exact: true }).click()
  await expect(navigation.getByRole('link', { name: 'Interviews', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.getByText('Add Interview', { exact: true }).click()
  await page.getByLabel('Company', { exact: true }).fill(`${prefix} Company`)
  await page.getByLabel('Role (optional)', { exact: true }).fill('Engineer')
  const today = await page.evaluate(() => {
    const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  })
  await page.getByLabel('Date (optional)', { exact: true }).fill(today)
  await page.getByRole('checkbox', { name: `${prefix} Design`, exact: true }).check()
  const areaId = (await page.getByRole('checkbox', { name: `${prefix} Design`, exact: true }).getAttribute('value'))!
  await page.getByRole('button', { name: 'Create Interview', exact: true }).click()
  await expect(page.getByRole('heading', { name: `${prefix} Company`, exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: `${prefix} Company`, exact: true })).toBeVisible()
  await bob.page.goto('/interviews')
  await expect(bob.page.getByRole('heading', { name: `${prefix} Company`, exact: true })).toHaveCount(0)
  for (const route of ['/interviews', '/prep', '/plans']) {
    await page.goto(route)
    await expect(page.getByRole('button', { name: 'Account menu', exact: true })).toBeVisible()
    if (route === '/interviews') await expect(page.getByRole('heading', { name: `${prefix} Company`, exact: true })).toBeVisible()
    if (route === '/prep') {
      await expect(page.getByText('Loading prep plans…', { exact: true })).toHaveCount(0)
      await expect(page.getByRole('heading', { name: `${prefix} Design`, exact: true })).toBeVisible()
    }
    if (route === '/plans') await expect(page.getByText('Loading plans…', { exact: true })).toHaveCount(0)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const shell = page.locator('.authenticated-app')
      expect(await shell.evaluate((node) => getComputedStyle(node).fontSize)).toBe('14px')
      if (route === '/interviews') {
        const card = page.locator('.interview-cards > li').first()
        expect(await card.evaluate((node) => getComputedStyle(node).paddingTop)).toBe('10px')
        expect(await card.evaluate((node) => getComputedStyle(node).cursor)).not.toBe('pointer')
        expect(await card.locator('.interview-date').evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgb(216, 232, 226)')
      }
      if (route === '/prep') {
        expect(await page.locator('.prep-area-cards > li').first().evaluate((node) => getComputedStyle(node).paddingTop)).toBe('16px')
      }
      if (route === '/plans') {
        const workspace = page.locator('.plans-index-workspace')
        expect(await workspace.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBe(width === 1440 ? 2 : 1)
        expect((await page.locator('.plans-index').boundingBox())!.width).toBeLessThanOrEqual(1320)
      }
      await page.screenshot({ path: `/tmp/prepflow-polish-${route.slice(1)}-${width}.png`, fullPage: true })
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/home')
  await expect(page.getByRole('link', { name: `Upcoming interview: ${prefix} Company`, exact: true })).toHaveAttribute('href', '/interviews')
  const token = (await (await alice.context.request.post('/api/auth/token', { data: {} })).json()).token as string
  const action = async (name: string, data: unknown) => {
    const result = await (await alice.context.request.post(`/api/actions/${name}`, { headers: { Authorization: `Bearer ${token}` }, data })).json()
    expect(result).toMatchObject({ success: true }); return result.data.recordId as string
  }
  const item = await action('createPlanItem', { prepAreaId: areaId, intent: `${prefix} Work`, instructions: 'Explain design tradeoffs clearly.' })
  await action('startPrepSession', { planItemId: item })
  await page.goto('/focus')
  await expect(page.getByText('Explain design tradeoffs clearly.', { exact: true })).not.toBeVisible()
  await page.getByText('How to approach this', { exact: true }).click()
  await expect(page.getByText('Explain design tradeoffs clearly.', { exact: true })).toBeVisible()
  const difficulty = page.getByRole('button', { name: 'Report difficulty (keep working)', exact: true })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await difficulty.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgb(216, 232, 226)')
    expect(await difficulty.evaluate((node) => getComputedStyle(node).borderTopColor)).toBe('rgb(141, 188, 176)')
    expect((await difficulty.boundingBox())!.height).toBeGreaterThanOrEqual(36)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await difficulty.click()
  await expect(page.getByRole('status').filter({ hasText: 'Difficulty noted' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('status').filter({ hasText: 'Difficulty noted' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Report difficulty (keep working)', exact: true })).toHaveCount(0)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.install()
  await page.clock.pauseAt(new Date())
  await page.getByRole('button', { name: 'Complete', exact: true }).click()
  await expect(page).toHaveURL(/\/home$/)
  const acknowledgement = page.getByRole('status', { name: 'Work completed' })
  await expect(acknowledgement).toBeVisible()
  await page.clock.runFor(1199)
  await expect(acknowledgement).toBeVisible()
  await page.clock.runFor(1)
  await expect(acknowledgement).toHaveCount(0)
  await expect(page.locator('.is-completion-leaving, .is-completion-arriving')).toHaveCount(0)
})
