import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

test.skip(loadAllTestAccounts().length < 2, 'Needs two existing synthetic accounts.')
test('daily plan application context, uniqueness, shared work, and focus navigation', async ({ users }) => {
  test.setTimeout(90000)
  const [alice, bob] = await users(2)
  const prefix = `__daily-${Date.now()}__`
  // Every AI request is intercepted; this synthetic test never spends credits.
  await alice.page.route('**/api/ai/prep-plan', (route) => route.fulfill({ status: 502, json: { error: 'Unexpected fixture generation' } }))
  await Promise.all([alice.page.goto('/home'), bob.page.goto('/home')])
  await expect(alice.page.getByText('Loading focus…', { exact: true })).toHaveCount(0)
  // Recover only an interval created by this spec after a failed prior run.
  await expect.poll(async () => await alice.page.locator('.focus-hero article').count() > 0 || await alice.page.locator('button.prep-area-object').first().isEnabled()).toBe(true)
  const leftover = alice.page.locator('.focus-hero article')
  if (await leftover.count() === 1 && (await leftover.getByRole('heading', { level: 3 }).textContent())?.startsWith('__daily-')) {
    await alice.page.getByRole('link', { name: 'Return to focus →', exact: true }).click()
    await alice.page.locator('.focus-attempt').getByRole('button', { name: 'Stop', exact: true }).click()
    await alice.page.getByRole('button', { name: 'Skip', exact: true }).click()
    await alice.page.goto('/home')
    await expect(alice.page.locator('.focus-hero article')).toHaveCount(0)
  }
  test.skip(await alice.page.locator('article').count() > 0, 'Preserve unrelated active focus.')
  await alice.page.goto('/prep')
  await alice.page.getByLabel('Area name', { exact: true }).fill(`${prefix} SQL`)
  await alice.page.getByRole('button', { name: 'Create Prep Area', exact: true }).click()
  await expect(alice.page.getByRole('heading', { name: `${prefix} SQL`, exact: true })).toBeVisible()
  await alice.page.goto('/home')
  await alice.page.locator('button.prep-area-object').first().click()
  const areaId = await alice.page.getByRole('combobox', { name: 'Prep Area', exact: true }).locator('option').filter({ hasText: `${prefix} SQL` }).getAttribute('value')
  await alice.page.getByRole('button', { name: 'Close', exact: true }).click()
  const token = (await (await alice.context.request.post('/api/auth/token', { data: {} })).json() as { token: string }).token
  const action = async (name: string, data: unknown) => {
    const response = await alice.context.request.post(`/api/actions/${name}`, { headers: { Authorization: `Bearer ${token}` }, data })
    return await response.json() as { success: boolean; data?: { recordId: string }; error?: string }
  }
  const item = await action('createPlanItem', { prepAreaId: areaId, intent: `${prefix} Existing work` })
  expect(item.success).toBe(true)
  const proposal = { title: `${prefix} Today`, rationale: 'One focused block', items: [{ kind: 'existing', existingPlanItemId: item.data!.recordId, estimatedMinutes: 30, reason: 'Existing work' }] }
  const day = await alice.page.evaluate(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
    return { timeZone, planDate: ['year', 'month', 'day'].map((type) => parts.find((p) => p.type === type)!.value).join('-') }
  })
  const today = alice.page.getByRole('region', { name: "Today's Plan", exact: true })
  await expect(today).toBeVisible()
  await expect(today.getByText('Loading today’s plan…')).toHaveCount(0)
  const build = alice.page.getByRole('link', { name: 'Build today’s plan', exact: true })
  if (await build.count()) {
    await alice.page.unroute('**/api/ai/prep-plan')
    await alice.page.route('**/api/ai/prep-plan', async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({ availableMinutes: 30, timeZone: day.timeZone })
      expect(route.request().postDataJSON()).not.toHaveProperty('planDate')
      await route.fulfill({ status: 200, json: { recommendation: proposal, availableMinutes: 30, totalMinutes: 30, generatedAt: new Date().toISOString(), readTools: ['get_prep_snapshot'], coverageNotices: [], display: [{ intent: `${prefix} Existing work`, prepAreaId: areaId, prepAreaName: 'SQL', previouslyStarted: false }] } })
    })
    await build.click()
    await expect(alice.page).toHaveURL(/\/plans\/suggest\?mode=daily$/)
    await alice.page.getByRole('button', { name: 'Build my plan', exact: true }).click()
    await expect(alice.page.getByRole('region', { name: 'Suggested plan' })).toBeVisible()
    const accepted = alice.page.waitForRequest('**/api/actions/acceptPrepPlan')
    await alice.page.getByRole('button', { name: 'Use this plan', exact: true }).click()
    expect((await accepted).postDataJSON()).toMatchObject({ daily: day, recommendation: proposal })
    await expect(alice.page).toHaveURL(/\/plans\/suggested-plan-/)
    await expect(alice.page.getByRole('heading', { name: 'Add New Intended Work', exact: true })).toHaveCount(0)
  }
  await alice.page.goto('/home')
  await expect(build).toHaveCount(0)
  const planLink = today.getByRole('link', { name: 'View plan details →', exact: true })
  await expect(planLink).toBeVisible()
  const planId = (await planLink.getAttribute('href'))!.split('/').pop()!
  expect(await action('acceptPrepPlan', { requestId: crypto.randomUUID(), availableMinutes: 30, daily: day, recommendation: proposal })).toMatchObject({ success: false })
  expect(await action('addPlanItem', { planId, planItemId: item.data!.recordId })).toMatchObject({ success: false })
  expect(await action('createPlanItem', { planId, prepAreaId: areaId, intent: 'Accidental addition' })).toMatchObject({ success: false })
  // A fresh unplanned interval must not join the daily snapshot.
  const before = await today.getByRole('heading').allTextContents()
  const writes: string[] = []
  alice.page.on('request', (request) => { if (request.url().includes('/api/actions/')) writes.push(request.url()) })
  await alice.page.locator('button.prep-area-object').first().click()
  await alice.page.getByRole('combobox', { name: 'Prep Area', exact: true }).selectOption(areaId!)
  await alice.page.getByLabel('What do you intend to work on?').fill(`${prefix} Unplanned`)
  const start = alice.page.waitForResponse('**/api/actions/startPrepSession')
  await alice.page.getByRole('button', { name: 'Start focus session', exact: true }).click()
  const started = await (await start).json() as { data: { recordId: string } }
  await expect(alice.page.locator('.focus-hero').getByRole('heading', { name: `${prefix} Unplanned`, exact: true })).toBeVisible()
  expect(await today.getByRole('heading').allTextContents()).toEqual(before)
  await alice.page.getByRole('link', { name: 'Return to focus →', exact: true }).click()
  await expect(alice.page.getByTestId('app-navigation')).toHaveCount(0)
  await expect(alice.page.getByRole('heading', { name: `${prefix} Unplanned`, exact: true })).toBeVisible()
  const timer = alice.page.getByLabel('Focus duration', { exact: true })
  const firstTimer = await timer.textContent()
  await expect.poll(() => timer.textContent()).not.toBe(firstTimer)
  const notebook = alice.page.getByRole('textbox', { name: 'Session notes — progress, difficulty, or where you stopped' })
  const workingNotes = Array.from({ length: 100 }, (_, index) => `Working line ${index + 1}: ` + 'long wrapped thoughts '.repeat(3)).join('\n')
  await notebook.fill(workingNotes)
  await expect(notebook).toHaveValue(workingNotes)
  await notebook.evaluate((node) => { node.scrollTop = node.scrollHeight; node.dispatchEvent(new Event('scroll')) })
  await expect.poll(async () => Number(await alice.page.locator('.notebook-gutter span').first().textContent())).toBeGreaterThan(1)
  await expect(notebook).toHaveValue(workingNotes)
  await notebook.fill('Actual user notes, without a notebook heading')
  await alice.page.screenshot({ path: '/tmp/prepflow-focus-section1.png', fullPage: true })
  const actionsBeforeNavigation = writes.length
  await alice.page.getByRole('link', { name: '← Home', exact: true }).click()
  await expect(alice.page.getByTestId('app-navigation')).toBeVisible()
  await alice.page.screenshot({ path: '/tmp/prepflow-home-section1.png', fullPage: true })
  await alice.page.setViewportSize({ width: 390, height: 844 })
  expect(await alice.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await alice.page.screenshot({ path: '/tmp/prepflow-home-mobile-section1.png', fullPage: true })
  await alice.page.setViewportSize({ width: 1280, height: 720 })
  // Day selection changes, while the active interval and dated plan do not.
  await alice.page.clock.install({ time: new Date() })
  await alice.page.clock.setSystemTime(new Date(Date.now() + 86400000))
  await alice.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(alice.page.getByRole('link', { name: 'Build today’s plan', exact: true })).toBeVisible()
  await expect(alice.page.locator('.focus-hero').getByRole('heading', { name: `${prefix} Unplanned`, exact: true })).toBeVisible()
  await alice.page.clock.setSystemTime(new Date())
  await alice.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(alice.page.getByRole('link', { name: 'Build today’s plan', exact: true })).toHaveCount(0)
  await alice.page.getByRole('link', { name: 'Return to focus →', exact: true }).click()
  expect(writes.length).toBe(actionsBeforeNavigation)
  const ended = alice.page.waitForRequest('**/api/actions/endPrepSession')
  await alice.page.getByRole('button', { name: 'Stop', exact: true }).click()
  expect((await ended).postDataJSON().sessionId).toBe(started.data.recordId)
  await alice.page.getByRole('button', { name: 'Skip', exact: true }).click()
  await expect(alice.page.getByText('No current focus.', { exact: false })).toBeVisible()
  await expect(alice.page.getByRole('link', { name: '← Home', exact: true })).toBeVisible()
  await alice.page.getByRole('link', { name: '← Home', exact: true }).click()
  await expect(alice.page.getByRole('region', { name: "Today's Plan", exact: true })).toBeVisible()
  await alice.page.clock.setSystemTime(new Date(Date.now() + 86400000))
  await alice.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(alice.page.getByRole('link', { name: 'Build today’s plan', exact: true })).toBeVisible()
  await expect(alice.page.getByRole('heading', { name: 'Current Focus', exact: true })).toHaveCount(0)
  await alice.page.screenshot({ path: '/tmp/prepflow-empty-home-1b.png', fullPage: true })
  await alice.page.setViewportSize({ width: 390, height: 844 })
  await alice.page.screenshot({ path: '/tmp/prepflow-empty-home-mobile-1b.png', fullPage: true })
  expect(await alice.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  alice.page.clock.setSystemTime(new Date())
  await alice.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  // Different users can persist the same local date through the real action.
  await bob.page.goto('/prep')
  await bob.page.getByLabel('Area name', { exact: true }).fill(`${prefix} Bob SQL`)
  await bob.page.getByRole('button', { name: 'Create Prep Area', exact: true }).click()
  await expect(bob.page.getByRole('heading', { name: `${prefix} Bob SQL`, exact: true })).toBeVisible()
  await bob.page.goto('/home')
  await bob.page.locator('button.prep-area-object').first().click()
  const bobArea = await bob.page.getByRole('combobox', { name: 'Prep Area', exact: true }).locator('option').filter({ hasText: `${prefix} Bob SQL` }).getAttribute('value')
  await bob.page.getByRole('button', { name: 'Close', exact: true }).click()
  const bobToken = (await (await bob.context.request.post('/api/auth/token', { data: {} })).json() as { token: string }).token
  const bobAction = async (name: string, data: unknown) => {
    const response = await bob.context.request.post(`/api/actions/${name}`, { headers: { Authorization: `Bearer ${bobToken}` }, data })
    return await response.json() as { success: boolean; data?: { recordId: string } }
  }
  const bobItem = await bobAction('createPlanItem', { prepAreaId: bobArea, intent: `${prefix} Bob work` })
  expect(bobItem.success).toBe(true)
  const bobProposal = { ...proposal, title: `${prefix} Bob today`, items: [{ ...proposal.items[0], existingPlanItemId: bobItem.data!.recordId }] }
  const bobBuild = bob.page.getByRole('link', { name: 'Build today’s plan', exact: true })
  await expect(bob.page.getByText('Loading today’s plan…')).toHaveCount(0)
  if (await bobBuild.count()) expect(await bobAction('acceptPrepPlan', { requestId: crypto.randomUUID(), availableMinutes: 30, daily: day, recommendation: bobProposal })).toMatchObject({ success: true })
  expect(await bobAction('acceptPrepPlan', { requestId: crypto.randomUUID(), availableMinutes: 30, daily: day, recommendation: bobProposal })).toMatchObject({ success: false })
  await expect(bob.page.getByRole('heading', { name: proposal.title, exact: true })).toHaveCount(0)
})
