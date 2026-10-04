import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

// Every generation request in this file is intercepted, including accidental
// requests: synthetic accounts must never reach the paid model endpoint.
test.skip(loadAllTestAccounts().length < 2, 'Needs two existing synthetic test accounts.')

test('planner review, retry, canonical display, acceptance and focus (deterministic AI)', async ({ users }) => {
  test.setTimeout(90000)
  const [alice, bob] = await users(2)
  const prefix = `__planner-${Date.now()}__`
  await alice.page.route('**/api/ai/prep-plan', (route) => route.fulfill({ status: 502, json: { error: 'Fixture: please retry.' } }))
  await alice.page.goto('/home')
  await expect(alice.page.getByText('Make room for focus.', { exact: true })).toBeVisible()
  await expect(alice.page.getByText('Loading focus…', { exact: true })).toHaveCount(0)
  const section = alice.page.locator('section').filter({ has: alice.page.getByRole('heading', { name: 'Current Focus', exact: true }) })
  if (await alice.page.getByRole('link', { name: 'Return to focus →', exact: true }).count()) await alice.page.getByRole('link', { name: 'Return to focus →', exact: true }).click()
  // Only clean up an interval left by this spec's own failed prior run.
  const active = section.locator('article')
  if (await active.count() === 1 && (await active.getByRole('heading', { level: 3 }).textContent())?.startsWith('__planner-')) {
    await active.getByRole('button', { name: 'Stop', exact: true }).click()
    await alice.page.getByRole('button', { name: 'Skip', exact: true }).click()
    await expect(active).toHaveCount(0)
  }
  test.skip(await active.count() > 0, 'Preserve unrelated existing active focus.')
  await alice.page.goto('/prep')
  await alice.page.getByLabel('Area name', { exact: true }).fill(`${prefix} SQL`)
  await alice.page.getByRole('button', { name: 'Create Prep Area', exact: true }).click()
  await expect(alice.page.getByRole('heading', { name: `${prefix} SQL`, exact: true })).toBeVisible()
  await alice.page.goto('/home')
  await alice.page.locator('button.prep-area-object').first().click()
  const areaId = await alice.page.getByRole('combobox', { name: 'Prep Area', exact: true }).locator('option').filter({ hasText: `${prefix} SQL` }).getAttribute('value')
  expect(areaId).toBeTruthy()
  await alice.page.getByRole('button', { name: 'Close', exact: true }).click()
  const tokenResponse = await alice.context.request.post('/api/auth/token', { data: {} })
  const token = (await tokenResponse.json() as { token: string }).token
  async function action(name: string, data: unknown) {
    const response = await alice.context.request.post(`/api/actions/${name}`, { headers: { Authorization: `Bearer ${token}` }, data })
    const result = await response.json() as { success: boolean; data?: { recordId: string }; error?: string }
    expect(result, result.error).toMatchObject({ success: true })
    return result.data!.recordId
  }
  const resumedId = await action('createPlanItem', { prepAreaId: areaId, intent: `${prefix} Resume joins` })
  const first = await action('startPrepSession', { planItemId: resumedId })
  await action('endPrepSession', { sessionId: first, outcome: 'switched', endedAt: new Date().toISOString(), leftOff: 'Handle null keys', nextStep: 'Try a left join' })
  const unstartedId = await action('createPlanItem', { prepAreaId: areaId, intent: `${prefix} Start windows` })
  await alice.page.goto('/plans')
  await expect(alice.page.getByRole('button', { name: 'Create Plan', exact: true })).toHaveCSS('background-color', 'rgb(35, 107, 101)')
  await alice.page.screenshot({ path: '/tmp/prepflow-plans-teal-index-desktop.png', fullPage: true })
  await alice.page.setViewportSize({ width: 390, height: 844 })
  expect(await alice.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await alice.page.screenshot({ path: '/tmp/prepflow-plans-teal-index-mobile.png', fullPage: true })
  await alice.page.setViewportSize({ width: 1280, height: 720 })
  await alice.page.goto('/plans/suggest?mode=generic')
  await expect(alice.page).toHaveURL(/\/plans\/suggest\?mode=generic$/)
  await alice.page.keyboard.press('Tab')
  await alice.page.getByRole('button', { name: '60 min', exact: true }).focus()
  expect(await alice.page.getByRole('button', { name: '60 min', exact: true }).evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe('none')
  await alice.page.getByRole('button', { name: '60 min', exact: true }).click()
  await expect(alice.page.getByRole('button', { name: '60 min', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(alice.page.getByRole('button', { name: '60 min', exact: true })).toHaveCSS('background-color', 'rgb(25, 86, 80)')
  await alice.page.mouse.move(0, 0)
  await expect(alice.page.getByRole('button', { name: '60 min', exact: true })).toHaveCSS('background-color', 'rgb(35, 107, 101)')
  await expect(alice.page.getByRole('button', { name: 'Build my plan', exact: true })).toHaveCSS('background-color', 'rgb(35, 107, 101)')
  await alice.page.screenshot({ path: '/tmp/prepflow-plans-teal-form-desktop.png', fullPage: true })
  await expect(alice.page.getByLabel('Available minutes', { exact: true })).toHaveCount(0)
  await alice.page.getByLabel('Goal (optional)', { exact: true }).fill('Use SQL work')
  await alice.page.getByRole('button', { name: 'Build my plan', exact: true }).click()
  await expect(alice.page.getByRole('alert')).toHaveText('Fixture: please retry.')
  await alice.page.unroute('**/api/ai/prep-plan')
  let generationCount = 0
  const recommendation = { title: `${prefix} Suggested prep`, rationale: 'Existing work and one new exercise', items: [
    { kind: 'existing', existingPlanItemId: resumedId, estimatedMinutes: 20, reason: 'Continue the saved work' },
    { kind: 'existing', existingPlanItemId: unstartedId, estimatedMinutes: 20, reason: 'Start intended work' },
    { kind: 'new', prepAreaId: areaId, intent: `${prefix} New grouping`, instructions: 'Explain grouping edge cases', estimatedMinutes: 15, reason: 'Practice grouping' },
  ] }
  await alice.page.route('**/api/ai/prep-plan', async (route) => {
    generationCount++
    expect(route.request().postDataJSON()).toMatchObject({ availableMinutes: 60, goal: 'Use SQL work' })
    await route.fulfill({ status: 200, json: { recommendation, availableMinutes: 60, totalMinutes: 55, generatedAt: new Date().toISOString(), coverageNotices: [], readTools: ['get_prep_snapshot'], display: [
      { intent: `${prefix} Resume joins`, prepAreaId: areaId, prepAreaName: `${prefix} SQL`, previouslyStarted: true },
      { intent: `${prefix} Start windows`, prepAreaId: areaId, prepAreaName: `${prefix} SQL`, previouslyStarted: false },
      { intent: `${prefix} New grouping`, instructions: 'Explain grouping edge cases', prepAreaId: areaId, prepAreaName: `${prefix} SQL`, previouslyStarted: false },
    ] } })
  })
  const writes: string[] = []
  alice.page.on('request', (request) => { if (request.url().includes('/api/actions/')) writes.push(request.url()) })
  await alice.page.getByRole('button', { name: 'Build my plan', exact: true }).click()
  const suggestion = alice.page.getByRole('region', { name: 'Suggested plan' })
  await expect(suggestion).toBeVisible()
  await expect(suggestion.getByText('Instructions: Explain grouping edge cases', { exact: true })).toBeVisible()
  await expect(suggestion.getByText(`Resume · ${prefix} SQL`, { exact: true })).toBeVisible()
  await expect(suggestion.getByText(`Start · ${prefix} SQL`, { exact: true })).toBeVisible()
  await expect(suggestion.getByText(`New work · ${prefix} SQL`, { exact: true })).toBeVisible()
  await expect(suggestion.getByText('60 minutes available · 55 minutes allocated')).toBeVisible()
  expect(writes).toEqual([])
  await expect(alice.page.getByRole('button', { name: 'Use this plan', exact: true })).toHaveCSS('background-color', 'rgb(35, 107, 101)')
  await expect(suggestion.locator('.recommendation-allocation').first()).toHaveCSS('color', 'rgb(35, 107, 101)')
  await suggestion.screenshot({ path: '/tmp/prepflow-plan-review-desktop.png' })
  // Editing the request form cannot silently change the reviewed plan budget.
  await alice.page.getByRole('button', { name: 'Custom', exact: true }).click()
  await alice.page.getByLabel('Available minutes', { exact: true }).fill('91')
  await alice.page.screenshot({ path: '/tmp/prepflow-planner-1b.png', fullPage: true })
  await alice.page.setViewportSize({ width: 390, height: 844 })
  await suggestion.screenshot({ path: '/tmp/prepflow-plan-review-mobile.png' })
  await alice.page.screenshot({ path: '/tmp/prepflow-planner-mobile-1b.png', fullPage: true })
  expect(await alice.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await alice.page.setViewportSize({ width: 1280, height: 720 })
  const accepted = alice.page.waitForRequest('**/api/actions/acceptPrepPlan')
  await alice.page.getByRole('button', { name: 'Use this plan', exact: true }).click()
  expect((await accepted).postDataJSON()).toMatchObject({ availableMinutes: 60, recommendation })
  expect((await accepted).postDataJSON()).not.toHaveProperty('daily')
  await expect(alice.page).toHaveURL(/\/plans\/suggested-plan-/)
  await expect(alice.page.getByRole('heading', { name: recommendation.title, exact: true })).toBeVisible()
  await expect(alice.page.getByText(/Daily Plan ·/)).toHaveCount(0)
  await expect(alice.page.getByRole('button', { name: 'Resume', exact: true }).first()).toHaveCSS('background-color', 'rgb(216, 232, 226)')
  await alice.page.screenshot({ path: '/tmp/prepflow-plans-teal-detail-desktop.png', fullPage: true })
  await alice.page.setViewportSize({ width: 390, height: 844 })
  expect(await alice.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await alice.page.screenshot({ path: '/tmp/prepflow-plans-teal-detail-mobile.png', fullPage: true })
  await alice.page.setViewportSize({ width: 1280, height: 720 })
  expect(generationCount).toBe(1)
  const planId = new URL(alice.page.url()).pathname.split('/').pop()!
  const row = alice.page.locator('li').filter({ has: alice.page.getByRole('heading', { name: `${prefix} Resume joins`, exact: true }) })
  await row.getByRole('button', { name: 'Resume', exact: true }).click()
  await expect(alice.page).toHaveURL(/\/focus$/)
  await alice.page.goto('/home')
  await alice.page.getByRole('link', { name: 'Return to focus →', exact: true }).click()
  await expect(alice.page.getByText('Left off: Handle null keys', { exact: true })).toBeVisible()
  await alice.page.getByRole('button', { name: 'Stop', exact: true }).click()
  await alice.page.getByRole('button', { name: 'Skip', exact: true }).click()
  const bobTokenResponse = await bob.context.request.post('/api/auth/token', { data: {} })
  const bobToken = (await bobTokenResponse.json() as { token: string }).token
  const denied = await bob.context.request.post('/api/actions/acceptPrepPlan', { headers: { Authorization: `Bearer ${bobToken}` }, data: { requestId: crypto.randomUUID(), availableMinutes: 60, recommendation } })
  expect(await denied.json()).toMatchObject({ success: false })
  expect(planId).toContain('suggested-plan-')
})
