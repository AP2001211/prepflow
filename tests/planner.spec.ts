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
  if (!await alice.page.getByLabel('Area name', { exact: true }).isVisible()) await alice.page.getByText('Add Prep Area', { exact: true }).click()
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
  await expect(alice.page.getByText('Create a general Plan', { exact: true })).toHaveCount(0)
  await alice.page.screenshot({ path: '/tmp/prepflow-plans-teal-index-desktop.png', fullPage: true })
  await alice.page.setViewportSize({ width: 390, height: 844 })
  expect(await alice.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await alice.page.screenshot({ path: '/tmp/prepflow-plans-teal-index-mobile.png', fullPage: true })
  await alice.page.setViewportSize({ width: 1280, height: 720 })
  await alice.page.goto('/plans/suggest?mode=daily&planDate=2099-11-20')
  await expect(alice.page).toHaveURL(/\/plans\/suggest\?mode=daily&planDate=2099-11-20$/)
  await alice.page.keyboard.press('Tab')
  await alice.page.getByRole('button', { name: '60 min', exact: true }).focus()
  expect(await alice.page.getByRole('button', { name: '60 min', exact: true }).evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe('none')
  await alice.page.getByRole('button', { name: '60 min', exact: true }).click()
  await expect(alice.page.getByRole('button', { name: '60 min', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(alice.page.getByRole('button', { name: '60 min', exact: true })).toHaveCSS('background-color', 'rgb(25, 86, 80)')
  await alice.page.mouse.move(0, 0)
  await expect(alice.page.getByRole('button', { name: '60 min', exact: true })).toHaveCSS('background-color', 'rgb(35, 107, 101)')
  await expect(alice.page.getByRole('button', { name: 'Get suggestions', exact: true })).toHaveCSS('background-color', 'rgb(35, 107, 101)')
  await alice.page.screenshot({ path: '/tmp/prepflow-plans-teal-form-desktop.png', fullPage: true })
  await expect(alice.page.getByLabel('Available minutes', { exact: true })).toHaveCount(0)
  await alice.page.getByLabel('Priority or goal (optional)', { exact: true }).fill('Use SQL work')
  await alice.page.getByRole('button', { name: 'Get suggestions', exact: true }).click()
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
  await alice.page.getByRole('button', { name: 'Get suggestions', exact: true }).click()
  const suggestion = alice.page.getByRole('region', { name: 'Suggested plan' })
  await expect(suggestion).toBeVisible()
  await expect(alice.page.getByRole('button', { name: 'Get suggestions', exact: true })).toHaveCount(0)
  await expect(suggestion.locator('details[open]')).toHaveCount(0)
  await expect(suggestion.getByText('Existing work and one new exercise', { exact: true })).not.toBeVisible()
  await suggestion.getByText('Why these suggestions?', { exact: true }).click()
  await expect(suggestion.getByText('Existing work and one new exercise', { exact: true })).toBeVisible()
  await suggestion.getByText('Why these suggestions?', { exact: true }).click()
  await expect(suggestion.getByText('Explain grouping edge cases', { exact: true })).toBeVisible()
  await expect(suggestion.getByText(`Previously started · ${prefix} SQL`, { exact: true })).toBeVisible()
  await expect(suggestion.getByText(`Not started · ${prefix} SQL`, { exact: true })).toBeVisible()
  await expect(suggestion.getByText(`New activity · ${prefix} SQL`, { exact: true })).toBeVisible()
  await expect(suggestion.getByText('55 of 60 min selected')).toBeVisible()
  expect(writes).toEqual([])
  const choices = suggestion.getByRole('checkbox')
  await expect(choices).toHaveCount(3)
  for (const choice of await choices.all()) await expect(choice).toBeChecked()
  await choices.nth(2).uncheck()
  await expect(alice.page.getByRole('button', { name: 'Create plan with 2 activities', exact: true })).toBeEnabled()
  await expect(alice.page.getByText('40 min selected', { exact: true })).toBeVisible()
  await choices.nth(0).uncheck(); await choices.nth(1).uncheck()
  await expect(alice.page.getByRole('button', { name: 'Create plan with 0 activities', exact: true })).toBeDisabled()
  await choices.nth(0).check(); await choices.nth(1).check()
  await expect(alice.page.getByRole('button', { name: /^Create plan with \d+ activit/  })).toHaveCSS('background-color', 'rgb(35, 107, 101)')
  await expect(suggestion.locator('.recommendation-allocation').first()).toHaveCSS('color', 'rgb(35, 107, 101)')
  await suggestion.screenshot({ path: '/tmp/prepflow-plan-review-desktop.png' })
  // Editing the request form cannot silently change the reviewed plan budget.
  await alice.page.getByRole('button', { name: 'Change time or priority', exact: true }).click()
  await alice.page.getByRole('button', { name: 'Custom', exact: true }).click()
  await alice.page.getByLabel('Available minutes', { exact: true }).fill('91')
  await alice.page.getByRole('button', { name: 'Back to suggestions', exact: true }).click()
  await alice.page.screenshot({ path: '/tmp/prepflow-planner-1b.png', fullPage: true })
  await alice.page.setViewportSize({ width: 390, height: 844 })
  await suggestion.screenshot({ path: '/tmp/prepflow-plan-review-mobile.png' })
  await alice.page.screenshot({ path: '/tmp/prepflow-planner-mobile-1b.png', fullPage: true })
  expect(await alice.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await alice.page.setViewportSize({ width: 1280, height: 720 })
  const accepted = alice.page.waitForRequest('**/api/actions/acceptPrepPlan')
  const acceptanceResponse = alice.page.waitForResponse((response) => response.url().endsWith('/api/actions/acceptPrepPlan'))
  await alice.page.getByRole('button', { name: /^Create plan with \d+ activit/  }).click()
  expect((await accepted).postDataJSON()).toMatchObject({ availableMinutes: 60, recommendation, selectedIndices: [0, 1] })
  expect((await accepted).postDataJSON().daily).toMatchObject({ planDate: '2099-11-20' })
  const saved = await (await acceptanceResponse).json() as { data: { recordId: string } }
  await expect(alice.page).toHaveURL(/\/plans\?date=2099-11-20$/)
  await alice.page.goto(`/plans/${saved.data.recordId}`)
  await expect(alice.page.getByRole('heading', { name: recommendation.title, exact: true })).toBeVisible()
  await expect(alice.page.getByText('Daily Plan · 2099-11-20', { exact: true })).toBeVisible()
  await expect(alice.page.getByText('Open plan · 40 minute budget', { exact: true })).toBeVisible()
  await expect(alice.page.getByRole('heading', { name: `${prefix} New grouping`, exact: true })).toHaveCount(0)
  await alice.page.reload()
  await expect(alice.page.getByRole('heading', { name: recommendation.title, exact: true })).toBeVisible()
  await expect(alice.page.getByText('Open plan · 40 minute budget', { exact: true })).toBeVisible()
  await expect(alice.page.getByRole('heading', { name: `${prefix} New grouping`, exact: true })).toHaveCount(0)

  await expect(alice.page.getByRole('button', { name: 'Resume', exact: true }).first()).toHaveCSS('background-color', 'rgb(216, 232, 226)')
  await alice.page.screenshot({ path: '/tmp/prepflow-plans-teal-detail-desktop.png', fullPage: true })
  await alice.page.setViewportSize({ width: 390, height: 844 })
  expect(await alice.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await alice.page.screenshot({ path: '/tmp/prepflow-plans-teal-detail-mobile.png', fullPage: true })
  await alice.page.setViewportSize({ width: 1280, height: 720 })
  expect(generationCount).toBe(1)
  const planId = new URL(alice.page.url()).pathname.split('/').pop()!
  await alice.page.goto('/plans#unfinished-work')
  const unfinished = alice.page.locator('#unfinished-work')
  await expect(unfinished.getByRole('heading', { name: `${prefix} Resume joins`, exact: true })).toBeVisible()
  await expect(unfinished.getByRole('heading', { name: `${prefix} Start windows`, exact: true })).toBeVisible()
  await expect(unfinished.getByRole('heading', { name: `${prefix} New grouping`, exact: true })).toHaveCount(0)
  await alice.page.goto(`/plans/${planId}`)
  const row = alice.page.locator('li').filter({ has: alice.page.getByRole('heading', { name: `${prefix} Resume joins`, exact: true }) })
  await row.getByRole('button', { name: 'Resume', exact: true }).click()
  await expect(alice.page).toHaveURL(/\/focus$/)
  await alice.page.goto('/home')
  await alice.page.getByRole('link', { name: 'Return to focus →', exact: true }).click()
  await expect(alice.page.getByText('Handle null keys', { exact: true })).toBeVisible()
  await alice.page.getByRole('button', { name: 'Stop', exact: true }).click()
  await alice.page.getByRole('button', { name: 'Skip', exact: true }).click()
  const bobTokenResponse = await bob.context.request.post('/api/auth/token', { data: {} })
  const bobToken = (await bobTokenResponse.json() as { token: string }).token
  const denied = await bob.context.request.post('/api/actions/acceptPrepPlan', { headers: { Authorization: `Bearer ${bobToken}` }, data: { requestId: crypto.randomUUID(), availableMinutes: 60, recommendation } })
  expect(await denied.json()).toMatchObject({ success: false })
  expect(planId).toContain('suggested-plan-')
})

test('Plans calendar selects dates and preserves secondary work access', async ({ users }) => {
  const [alice] = await users(1)
  await alice.page.goto('/plans')
  const page = alice.page
  const panel = page.getByRole('region', { name: 'Selected day' })
  await expect(panel.locator('.eyebrow')).toContainText('Today')
  await expect(page.locator('#unfinished-work')).not.toHaveAttribute('open')
  const calendar = page.getByRole('complementary', { name: 'Plan calendar' })
  await calendar.getByRole('button', { name: 'Next month' }).click()
  await calendar.locator('.plans-calendar-grid button').first().click()
  await expect(panel).toContainText('Nothing planned for this day yet.')
  await expect(panel.getByRole('link', { name: 'Plan this day →' })).toBeVisible()
  await expect(panel.getByRole('link', { name: /Build/ })).toHaveCount(0)
  await calendar.getByRole('button', { name: 'Previous month' }).click()
  await calendar.getByRole('button', { name: 'Previous month' }).click()
  await calendar.locator('.plans-calendar-grid button').first().click()
  await expect(panel).toContainText('Nothing was planned for this day.')
  await expect(panel.getByRole('link', { name: /Build/ })).toHaveCount(0)
  await calendar.getByRole('button', { name: 'Today', exact: true }).click()
  await expect(panel.locator('.eyebrow')).toContainText('Today')
  await expect(page.getByText('Daily Plan archive', { exact: true })).toHaveCount(0)
  await page.goto('/plans#unfinished-work')
  await expect(page.locator('#unfinished-work')).toHaveAttribute('open')
  await expect(page.getByRole('heading', { name: 'Unfinished Work', exact: true })).toBeVisible()
  await page.goto('/plans')
  await expect(panel.locator('.eyebrow')).toContainText('Today')
  await expect(panel.getByText('Loading plans…', { exact: true })).toHaveCount(0)
  await expect(panel.getByText('Loading intended work…', { exact: true })).toHaveCount(0)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: '/tmp/prepflow-plans-calendar-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/prepflow-plans-calendar-mobile.png', fullPage: true })
})

test('future calendar planning persists the exact date and returns to its calendar selection', async ({ users }) => {
  const [alice] = await users(1)
  const page = alice.page
  const prefix = `__future-${Date.now()}__`
  const availability = new Map<string, string | undefined>()
  page.on('websocket', (socket) => socket.on('framereceived', (event) => {
    if (typeof event.payload !== 'string') return
    try {
      const message = JSON.parse(event.payload) as { type?: string; payload?: { records?: { recordId: string; data: { availableFrom?: string } }[] } }
      if (message.type === 'core.query_result') for (const row of message.payload?.records ?? []) availability.set(row.recordId, row.data.availableFrom)
    } catch { /* Other SDK frames are irrelevant to this structural assertion. */ }
  }))
  await page.goto('/prep')
  if (!await page.getByLabel('Area name', { exact: true }).isVisible()) await page.getByText('Add Prep Area', { exact: true }).click()
  await page.getByLabel('Area name', { exact: true }).fill(prefix)
  await page.getByRole('button', { name: 'Create Prep Area', exact: true }).click()
  await expect(page.getByRole('heading', { name: prefix, exact: true })).toBeVisible()
  await page.goto('/home')
  await page.locator('button.prep-area-object').filter({ hasText: prefix }).click()
  const areaId = await page.getByRole('combobox', { name: 'Prep Area', exact: true }).inputValue()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  let target = await page.evaluate(() => {
    const d = new Date(); d.setFullYear(d.getFullYear() + 2); d.setMonth(0, 7)
    return `${d.getFullYear()}-01-07`
  })
  await page.route('**/api/ai/prep-plan', async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ planDate: target, timeZone: await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone) })
    await route.fulfill({ json: { recommendation: { title: prefix, rationale: 'Future block', items: [{ kind: 'new', prepAreaId: areaId, intent: `${prefix} Work`, instructions: 'Keep tradeoffs explicit.', estimatedMinutes: 30, reason: 'Practice' }] }, availableMinutes: 30, totalMinutes: 30, generatedAt: new Date().toISOString(), coverageNotices: [], readTools: ['get_prep_snapshot'], display: [{ intent: `${prefix} Work`, instructions: 'Keep tradeoffs explicit.', prepAreaId: areaId, prepAreaName: prefix, previouslyStarted: false }] } })
  })
  // Keep reruns independent of prior synthetic accepted Plans.
  for (let attempt = 0; attempt < 30; attempt++) {
    await page.goto(`/plans?date=${target}`)
    await expect(page.getByRole('region', { name: 'Selected day' }).locator('.plans-day-plan, .plans-day-empty').first()).toBeVisible()
    if (await page.getByText('Nothing planned for this day yet.', { exact: true }).isVisible()) break
    target = new Date(Date.parse(`${target}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
  }
  await expect(page.getByRole('region', { name: 'Selected day' })).toContainText('Nothing planned for this day yet.')
  const cta = page.getByRole('link', { name: 'Plan this day →' })
  await expect(cta).toHaveAttribute('href', `/plans/suggest?mode=daily&planDate=${target}`)
  await cta.click()
  await expect(page).toHaveURL(new RegExp(`/plans/suggest\\?mode=daily&planDate=${target}$`))
  await page.reload()
  await expect(page.getByText('Planning for ·', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Get suggestions', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Suggested plan' })).toBeVisible()
  // Simulate a browser timezone change: explicit review acknowledgement must
  // retain the target calendar day rather than retargeting to today.
  await page.evaluate(() => {
    const original = Intl.DateTimeFormat.prototype.resolvedOptions
    Intl.DateTimeFormat.prototype.resolvedOptions = function () { return { ...original.call(this), timeZone: 'Pacific/Honolulu' } }
    window.dispatchEvent(new Event('focus'))
  })
  await expect(page.getByText('Your local day or timezone changed. This suggestion has not been rescheduled.')).toBeVisible()
  await page.getByRole('button', { name: /^Review this suggestion for/ }).click()
  await expect(page.getByText('Your local day or timezone changed. This suggestion has not been rescheduled.')).toHaveCount(0)
  const accepted = page.waitForResponse((r) => r.url().endsWith('/api/actions/acceptPrepPlan'))
  await page.getByRole('button', { name: /^Create plan with \d+ activit/ }).click()
  const response = await accepted
  expect(response.request().postDataJSON()).toMatchObject({ daily: { planDate: target } })
  const result = await response.json()
  expect(result.success).toBe(true)
  await expect(page).toHaveURL(new RegExp(`/plans\\?date=${target}$`))
  await expect(page.getByRole('region', { name: 'Selected day' }).getByRole('heading', { name: prefix, exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('region', { name: 'Selected day' }).getByRole('heading', { name: prefix, exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Selected day' })).not.toContainText('Keep tradeoffs explicit.')
  await expect(page.getByRole('region', { name: 'Selected day' })).not.toContainText('total focus')
  await expect(page.getByRole('region', { name: 'Selected day' })).not.toContainText('Also included in')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/prepflow-calendar-compact-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: '/tmp/prepflow-calendar-compact-desktop.png', fullPage: true })
  await page.goto(`/plans/${result.data.recordId}`)
  await expect(page.getByText('Keep tradeoffs explicit.', { exact: true })).toBeVisible()
  await expect(page.getByText(`Daily Plan · ${target}`, { exact: true })).toBeVisible()
  await expect.poll(() => availability.get(`${result.data.recordId}-item-0`)).toBe(target)
  // Explicit future-date access remains a normal Start/Stop/Resume lifecycle.
  const started = page.waitForResponse((r) => r.url().endsWith('/api/actions/startPrepSession'))
  await page.getByRole('button', { name: 'Start planned work', exact: true }).click()
  const firstSession = (await (await started).json()).data.recordId
  await expect(page).toHaveURL(/\/focus$/)
  await expect(page.getByRole('heading', { name: `${prefix} Work`, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.getByRole('button', { name: 'Skip', exact: true }).click()
  await expect(page).toHaveURL(/\/home$/)
  const resumed = page.waitForResponse((r) => r.url().endsWith('/api/actions/startPrepSession'))
  await page.getByRole('region', { name: 'Pick Back Up' }).locator('li').filter({ hasText: `${prefix} Work` }).getByRole('button', { name: 'Resume', exact: true }).click()
  expect((await (await resumed).json()).data.recordId).not.toBe(firstSession)
  await expect(page).toHaveURL(/\/focus$/)
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.getByRole('button', { name: 'Skip', exact: true }).click()
  await expect(page).toHaveURL(/\/home$/)
})
