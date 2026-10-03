/**
 * Multi-user collaboration spec — verifies two users sign in into
 * separate browser contexts and the app distinguishes them.
 *
 * `users(2)` takes any two accounts from your pool, so this spec passes on a
 * fresh app with no setup beyond having two test accounts:
 *   npx deepspace test accounts list
 *   npx deepspace test accounts create --email a@deepspace.test --name "A" --password-stdin
 *
 * Ask for accounts *by name* (`users(['Alice', 'Bob'])`) only when the
 * behaviour under test depends on which identity acts — otherwise naming them
 * couples the spec to one machine's pool.
 *
 * The `users` fixture handles sign-in caching (per-account storageState
 * persisted to `~/.deepspace/playwright-states/`), context creation, and
 * cleanup. No need to manage browser contexts manually.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

// A machine that has never created test accounts is the normal state of a
// fresh checkout, and there `users()` throws — turning "you have no pool yet"
// into three red tests about the app, which it is not. Skip the file instead
// and say what creates the pool. The count is of accounts usable HERE: the
// pool is global per developer, but passwords live only on the machine that
// created the account.
const usableTestAccounts = loadAllTestAccounts().length
test.skip(
  usableTestAccounts < 2,
  `Needs 2 usable test accounts, found ${usableTestAccounts}. Create them with ` +
    '`npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" ' +
    '--password-stdin`, or fetch existing pool accounts with `npx deepspace test accounts recover --all`.',
)

test('PrepFlow general preparation, optional interviews, and two-user privacy', async ({ users }) => {
  const [alice, bob] = await users(2)
  const prefix = `__test-${Date.now()}__`
  await Promise.all([alice.page.goto('/home'), bob.page.goto('/home')])
  await expect(alice.page.getByText('Make room for focus.', { exact: true })).toBeVisible()
  await expect(bob.page.getByText('Make room for focus.', { exact: true })).toBeVisible()
  await Promise.all([alice.page.goto('/prep'), bob.page.goto('/prep')])
  const areaName = `${prefix} SQL`
  await alice.page.getByLabel('Area name', { exact: true }).fill(areaName)
  await alice.page.getByRole('button', { name: 'Create Prep Area', exact: true }).click()
  await expect(alice.page.getByRole('heading', { name: areaName, exact: true })).toBeVisible()
  await expect(bob.page.getByRole('heading', { name: areaName, exact: true })).toHaveCount(0)

  await Promise.all([alice.page.goto('/home'), bob.page.goto('/home')])
  await expect.poll(async () => await alice.page.locator('button.prep-area-object').first().isEnabled() || await alice.page.locator('article').count() > 0).toBe(true)
  test.skip(await alice.page.locator('article').count() > 0, 'Preserve the fixture user’s existing active focus.')
  await alice.page.locator('button.prep-area-object').first().click()
  // Never end a developer's pre-existing focus session for test setup.
  const startButton = alice.page.getByRole('button', { name: 'Start focus session', exact: true })
  test.skip(await startButton.count() === 0, 'The fixture user already has active preparation; preserve it and use a clean fixture account.')
  const areaId = await alice.page.getByRole('combobox', { name: 'Prep Area', exact: true }).locator('option').filter({ hasText: areaName }).getAttribute('value')
  expect(areaId).toBeTruthy()
  await alice.page.getByRole('combobox', { name: 'Prep Area', exact: true }).selectOption(areaId!)
  const intent = `${prefix} Practice window functions`
  await alice.page.getByLabel('What do you intend to work on?').fill(intent)
  await startButton.click()
  await alice.page.getByRole('link', { name: 'Return to focus →', exact: true }).click()
  const focus = alice.page.locator('article').filter({ has: alice.page.getByRole('heading', { name: intent, exact: true }) })
  await expect(focus).toBeVisible()
  await expect(focus.getByText('General preparation', { exact: false })).toBeVisible()
  await expect(startButton).toHaveCount(0)
  await expect(bob.page.getByRole('heading', { name: intent, exact: true })).toHaveCount(0)
  await focus.getByLabel('Session notes — progress, difficulty, or where you stopped').fill('Unsure about partitioning; continued practicing.')
  await focus.getByRole('button', { name: 'Report difficulty (keep working)', exact: true }).click()
  await expect(focus.getByText('Difficulty reported during this attempt.', { exact: false })).toBeVisible()
  await focus.getByRole('button', { name: 'Complete', exact: true }).click()
  await expect(focus).toHaveCount(0)
  await alice.page.goto('/history')
  const history = alice.page.locator('section').filter({ has: alice.page.getByRole('heading', { name: 'Recent Focus History', exact: true }) })
  await expect(history.getByRole('heading', { name: intent, exact: true })).toBeVisible()
  const completedEntry = history.locator('li').filter({ has: alice.page.getByRole('heading', { name: intent, exact: true }) })
  await expect(completedEntry.getByText('Encountered difficulty', { exact: false })).toBeVisible()
  await expect(completedEntry.getByText('Unsure about partitioning; continued practicing.', { exact: true })).toBeVisible()

  await Promise.all([alice.page.goto('/prep'), bob.page.goto('/prep')])
  const company = `${prefix} Example`
  await alice.page.getByLabel('Company', { exact: true }).fill(company)
  await alice.page.getByLabel(areaName, { exact: true }).check()
  await alice.page.getByRole('button', { name: 'Create Interview', exact: true }).click()
  await expect(alice.page.getByRole('heading', { name: company, exact: true })).toBeVisible()
  await expect(bob.page.getByRole('heading', { name: company, exact: true })).toHaveCount(0)

  await alice.page.goto('/home')
  await alice.page.locator('button.prep-area-object').first().click()
  const interviewId = await alice.page.getByRole('combobox', { name: 'Interview (optional)', exact: true }).locator('option').filter({ hasText: company }).getAttribute('value')
  expect(interviewId).toBeTruthy()
  for (const [button, outcome] of [['Stop', 'stopped'], ['End to switch', 'switched']] as const) {
    if (outcome === 'switched') {
      await alice.page.goto('/home')
      await alice.page.locator('button.prep-area-object').first().click()
    }
    const nextIntent = `${prefix} ${outcome} attempt`
    await alice.page.getByRole('combobox', { name: 'Prep Area', exact: true }).selectOption(areaId!)
    await alice.page.getByRole('combobox', { name: 'Interview (optional)', exact: true }).selectOption(interviewId!)
    await alice.page.getByLabel('What do you intend to work on?').fill(nextIntent)
    await alice.page.getByRole('button', { name: 'Start focus session', exact: true }).click()
    await alice.page.getByRole('link', { name: 'Return to focus →', exact: true }).click()
    const attempt = alice.page.locator('article').filter({ has: alice.page.getByRole('heading', { name: nextIntent, exact: true }) })
    await expect(attempt).toBeVisible()
    await expect(attempt.getByText(company, { exact: false })).toBeVisible()
    await attempt.getByRole('button', { name: button, exact: true }).click()
    await expect(attempt).toHaveCount(0)
    const stopDialog = alice.page.getByRole('dialog', { name: `${outcome === 'switched' ? 'Switching away from' : 'Stopping'} ${nextIntent}`, exact: true })
    await expect(stopDialog).toBeVisible()
    await stopDialog.getByRole('button', { name: 'Skip', exact: true }).click()
    await alice.page.goto('/history')
    const entry = history.locator('li').filter({ has: alice.page.getByRole('heading', { name: nextIntent, exact: true }) })
    await expect(entry.getByText(new RegExp(`^${outcome} ·`))).toBeVisible()
  }
  const tokenResponse = await bob.context.request.post('/api/auth/token', { data: {} })
  expect(tokenResponse.ok()).toBe(true)
  const { token } = await tokenResponse.json() as { token: string }
  const forbiddenLink = await bob.context.request.post('/api/actions/createInterview', {
    headers: { Authorization: `Bearer ${token}` }, data: { company: `${prefix} Forged`, prepAreaIds: [areaId] },
  })
  expect(await forbiddenLink.json()).toMatchObject({ success: false })
  const aliceTokenResponse = await alice.context.request.post('/api/auth/token', { data: {} })
  expect(aliceTokenResponse.ok()).toBe(true)
  const { token: aliceToken } = await aliceTokenResponse.json() as { token: string }
  const ownedItemResponse = await alice.context.request.post('/api/actions/createPlanItem', {
    headers: { Authorization: `Bearer ${aliceToken}` }, data: { prepAreaId: areaId, interviewId, intent: `${prefix} Owned work` },
  })
  const ownedItem = await ownedItemResponse.json() as { success: boolean; data: { recordId: string } }
  expect(ownedItem.success).toBe(true)
  const forbiddenSession = await bob.context.request.post('/api/actions/startPrepSession', {
    headers: { Authorization: `Bearer ${token}` }, data: { planItemId: ownedItem.data.recordId },
  })
  expect(await forbiddenSession.json()).toMatchObject({ success: false })
  // Deletion is unavailable by design. Named fixture records remain local;
  // the test leaves its session ended and never changes unrelated records.
})

test('each browser renders its own signed-in account', async ({ users }) => {
  const [a, b] = await users(2)

  // /home is dynamic (under src/pages/(app)/), so it mounts the nav shell;
  // '/' is the static landing and has no navigation.
  await Promise.all([a.page.goto('/home'), b.page.goto('/home')])

  // Email, not name. The page renders the *session's* `name || email`, while
  // `user.name` here comes from the LOCAL account registry — and the two are
  // not the same fact: a display name is optional, and an account recovered on
  // another machine has none stored locally at all. The email is the credential
  // the context signed in with, so it is the one identity both sides agree on,
  // and asserting it proves the page is showing THIS browser's account.
  // The two accounts are distinct, so two exact matches is also the proof that
  // the contexts are not sharing one session.
  for (const user of [a, b]) {
    await expect(user.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })

    // The identity chip shows `name || email`. Its text is not predictable, but
    // its presence is: something must be there once the profile has loaded.
    // (It is `hidden sm:inline` in some templates, so assert text, not
    // visibility.)
    await expect(user.page.getByTestId('nav-user-name')).toHaveText(/\S/, { timeout: 15_000 })

    await user.page.getByRole('button', { name: 'Account menu' }).click()
    await expect(user.page.getByTestId('nav-user-email')).toHaveText(user.email, {
      timeout: 15_000,
    })
  }
})

test('API status page renders loading success and error states', async ({ users }) => {
  const [user] = await users(1)
  let shouldFail = false
  let requestCount = 0

  await user.page.route('**/api/integrations', async (route) => {
    requestCount += 1
    if (shouldFail) {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Catalog unavailable' }),
      })
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { integrations: { openai: {}, wikipedia: {} } } }),
    })
  })

  await user.page.goto('/api-status')
  await expect(user.page.getByText('Loading integration catalog...')).toBeVisible()
  await expect(user.page.getByText('Integration catalog ready')).toBeVisible()
  await expect(user.page.getByText('2 integrations available.')).toBeVisible()

  shouldFail = true
  await user.page.getByRole('button', { name: 'Refresh' }).click()
  await expect(user.page.getByText('Catalog unavailable')).toBeVisible()
  await expect(user.page.getByText('Showing the last loaded catalog')).toBeVisible()
  await expect(user.page.getByText('Integration catalog ready')).toBeVisible()

  const urlAfterFailure = user.page.url()
  const requestsAfterFailure = requestCount
  await user.page.getByRole('button', { name: 'Refresh' }).click()
  await expect.poll(() => requestCount).toBeGreaterThan(requestsAfterFailure)
  expect(user.page.url()).toBe(urlAfterFailure)
})

test('API status page shows local retry after first-load API failure', async ({ users }) => {
  const [user] = await users(1)
  let requestCount = 0

  await user.page.route('**/api/integrations', async (route) => {
    requestCount += 1
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'Catalog unavailable' }),
    })
  })

  await user.page.goto('/api-status')
  await expect(user.page.getByText('Loading integration catalog...')).toBeVisible()
  await expect(user.page.getByText('Could not load API data')).toBeVisible()
  await expect(user.page.getByText('Retried 1 time automatically.')).toBeVisible()

  const retryButton = user.page.getByRole('button', { name: 'Retry' })
  await expect(retryButton).toBeVisible()

  const urlAfterFailure = user.page.url()
  const requestsAfterFailure = requestCount
  await retryButton.click()
  await expect.poll(() => requestCount).toBeGreaterThan(requestsAfterFailure)
  expect(user.page.url()).toBe(urlAfterFailure)
})

test('reusable planned work, optional checkpoints, new resume intervals, and historical membership', async ({ users }) => {
  test.setTimeout(90_000)
  const [alice, bob] = await users(2)
  const prefix = `__test-phase2-${Date.now()}__`
  await Promise.all([alice.page.goto('/home'), bob.page.goto('/home')])
  await expect(alice.page.getByText('Make room for focus.', { exact: true })).toBeVisible()
  const focusSection = alice.page.locator('section').filter({ has: alice.page.getByRole('heading', { name: 'Current Focus', exact: true }) })
  test.skip(await focusSection.locator('article').count() > 0, 'Preserve the fixture user’s existing active focus.')
  const tokenFor = async (person: typeof alice) => {
    const response = await person.context.request.post('/api/auth/token', { data: {} })
    expect(response.ok()).toBe(true)
    return (await response.json() as { token: string }).token
  }
  const aliceToken = await tokenFor(alice); const bobToken = await tokenFor(bob)
  const action = async (name: string, input: unknown, person = alice, token = aliceToken) => {
    const response = await person.context.request.post(`/api/actions/${name}`, { headers: { Authorization: `Bearer ${token}` }, data: input })
    return await response.json() as { success: boolean; data?: { recordId: string }; error?: string }
  }
  const success = async (name: string, input: unknown) => {
    const result = await action(name, input)
    expect(result, result.error).toMatchObject({ success: true, data: { recordId: expect.any(String) } })
    return result.data!.recordId
  }
  await alice.page.goto('/prep')
  await alice.page.getByLabel('Area name', { exact: true }).fill(`${prefix} SQL`)
  await alice.page.getByRole('button', { name: 'Create Prep Area', exact: true }).click()
  await expect(alice.page.getByRole('heading', { name: `${prefix} SQL`, exact: true })).toBeVisible()
  await alice.page.goto('/home')
  await alice.page.locator('button.prep-area-object').first().click()
  const areaId = await alice.page.getByRole('combobox', { name: 'Prep Area', exact: true }).locator('option').filter({ hasText: `${prefix} SQL` }).getAttribute('value')
  await alice.page.getByRole('button', { name: 'Close', exact: true }).click()
  await alice.page.goto('/plans')
  await alice.page.getByLabel('Plan title', { exact: true }).fill(`${prefix} Original`)
  await alice.page.getByLabel('Time budget in minutes (optional)', { exact: true }).fill('240')
  const [planResponse] = await Promise.all([
    alice.page.waitForResponse((response) => response.url().endsWith('/api/actions/createPlan') && response.request().method() === 'POST'),
    alice.page.getByRole('button', { name: 'Create Plan', exact: true }).click(),
  ])
  const createdPlan = await planResponse.json() as { success: boolean; data: { recordId: string } }
  expect(createdPlan.success).toBe(true)
  const firstPlan = createdPlan.data.recordId
  const laterPlan = await success('createPlan', { title: `${prefix} Later` })
  const intent = `${prefix} Window functions`
  await alice.page.getByRole('combobox', { name: 'Prep Area', exact: true }).selectOption(areaId!)
  await alice.page.getByLabel('What do you intend to work on?').fill(intent)
  const [itemResponse] = await Promise.all([
    alice.page.waitForResponse((response) => response.url().endsWith('/api/actions/createPlanItem') && response.request().method() === 'POST'),
    alice.page.getByRole('button', { name: 'Add intended work', exact: true }).click(),
  ])
  const createdItem = await itemResponse.json() as { success: boolean; data: { recordId: string } }
  expect(createdItem.success).toBe(true)
  const itemId = createdItem.data.recordId
  const neverStarted = await success('createPlanItem', { prepAreaId: areaId, intent: `${prefix} Never started`, planId: firstPlan })
  await alice.page.goto('/home')
  await expect(alice.page.getByRole('heading', { name: 'Relevant Plan', exact: true })).toHaveCount(0)
  await expect(alice.page.getByRole('region', { name: "Today's Plan", exact: true }).getByRole('heading', { name: `${prefix} Original`, exact: true })).toHaveCount(0)
  const continueSection = alice.page.locator('section').filter({ has: alice.page.getByRole('heading', { name: 'Pick Back Up', exact: true }) })
  await expect(continueSection.getByRole('heading', { name: intent, exact: true })).toHaveCount(0)
  await expect(continueSection.getByRole('heading', { name: `${prefix} Never started`, exact: true })).toHaveCount(0)
  const firstSession = await success('startPrepSession', { planItemId: itemId, planId: firstPlan })
  await alice.page.getByRole('link', { name: 'Return to focus →', exact: true }).click()
  const attempt = focusSection.locator('article')
  await expect(attempt.getByRole('heading', { name: intent, exact: true })).toBeVisible()
  expect(await action('startPrepSession', { planItemId: neverStarted })).toMatchObject({ success: false })
  await attempt.getByRole('button', { name: 'Report difficulty (keep working)', exact: true }).click()
  await expect(attempt.getByText('Difficulty reported during this attempt.', { exact: false })).toBeVisible()
  const [endResponse] = await Promise.all([
    alice.page.waitForResponse((response) => response.url().endsWith('/api/actions/endPrepSession') && response.request().method() === 'POST'),
    attempt.getByRole('button', { name: 'End to switch', exact: true }).click(),
  ])
  expect(await endResponse.json()).toMatchObject({ success: true })
  const endInput = endResponse.request().postDataJSON() as { sessionId: string; endedAt: string }
  expect(endInput.sessionId).toBe(firstSession)
  expect(Date.parse(endInput.endedAt)).toBeLessThanOrEqual(Date.now())
  await expect(attempt).toHaveCount(0)
  const contextSection = alice.page.getByRole('dialog', { name: /^(Switching away from|Stopping) / })
  await expect(contextSection).toHaveAccessibleName(`Switching away from ${intent}`)
  await expect(contextSection).toBeVisible()
  await alice.page.getByLabel('Where did you leave off / what was blocking you? (optional)').fill('TEST CONTEXT 123')
  await alice.page.getByLabel('What should you try next? (optional)').fill('TEST NEXT STEP 456')
  const [contextResponse] = await Promise.all([
    alice.page.waitForResponse((response) => response.url().endsWith('/api/actions/saveResumeContext') && response.request().method() === 'POST'),
    contextSection.getByRole('button', { name: 'Save', exact: true }).click(),
  ])
  expect(await contextResponse.json()).toMatchObject({ success: true })
  expect(contextResponse.request().postDataJSON()).toEqual({ sessionId: firstSession, leftOff: 'TEST CONTEXT 123', nextStep: 'TEST NEXT STEP 456' })
  // Context is a separate confirmed write; it never changes the stop time.
  await expect(contextSection).toHaveCount(0)
  await alice.page.getByRole('link', { name: '← Home', exact: true }).click()
  const resumeRow = continueSection.locator('li').filter({ has: alice.page.getByRole('heading', { name: intent, exact: true }) })
  await expect(resumeRow.getByText('Left off: TEST CONTEXT 123', { exact: true })).toBeVisible()
  await success('closePlan', { planId: firstPlan })
  await success('addPlanItem', { planId: laterPlan, planItemId: itemId })
  await alice.page.getByRole('link', { name: 'View all unfinished work', exact: true }).click()
  await expect(alice.page).toHaveURL(/\/plans#unfinished-work$/)
  const unfinished = alice.page.locator('#unfinished-work')
  await expect(unfinished.getByRole('heading', { name: 'Unfinished Work', exact: true })).toBeInViewport()
  await expect(unfinished.getByRole('heading', { name: intent, exact: true })).toHaveCount(1)
  await expect(unfinished.getByRole('heading', { name: `${prefix} Never started`, exact: true })).toHaveCount(1)
  const sharedWork = unfinished.locator('li').filter({ has: alice.page.getByRole('heading', { name: intent, exact: true }) })
  await expect(sharedWork.getByRole('link', { name: `${prefix} Original`, exact: true })).toBeVisible()
  await expect(sharedWork.getByRole('link', { name: `${prefix} Later`, exact: true })).toBeVisible()
  for (const [id, name] of [[firstPlan, `${prefix} Original`], [laterPlan, `${prefix} Later`]]) {
    await alice.page.goto(`/plans/${id}`)
    await expect(alice.page.getByRole('heading', { name, exact: true })).toBeVisible()
    await expect(alice.page.getByRole('heading', { name: intent, exact: true })).toBeVisible()
    if (id === firstPlan) await expect(alice.page.getByRole('button', { name: 'Resume outside plan', exact: true })).toBeVisible()
  }
  await expect(alice.page.getByRole('link', { name: `${prefix} Original`, exact: true })).toBeVisible()
  await alice.page.goto('/home')
  expect(await action('addPlanItem', { planId: firstPlan, planItemId: itemId })).toMatchObject({ success: false })
  // Every cross-user attempt uses a valid shape, so rejection exercises ownership.
  for (const [name, input] of [
    ['createPlanItem', { prepAreaId: areaId, intent: 'Foreign area' }],
    ['addPlanItem', { planId: laterPlan, planItemId: itemId }],
    ['startPrepSession', { planItemId: itemId, planId: laterPlan }],
    ['saveResumeContext', { sessionId: firstSession, leftOff: 'Foreign edit' }],
    ['closePlan', { planId: laterPlan }],
  ] as const) expect(await action(name, input, bob, bobToken)).toMatchObject({ success: false })
  await expect(bob.page.getByRole('heading', { name: intent, exact: true })).toHaveCount(0)
  const [resumeResponse] = await Promise.all([
    alice.page.waitForResponse((response) => response.url().endsWith('/api/actions/startPrepSession') && response.request().method() === 'POST'),
    resumeRow.getByRole('button', { name: 'Resume', exact: true }).click(),
  ])
  const resumed = await resumeResponse.json() as { success: boolean; data: { recordId: string } }
  expect(resumed.success).toBe(true)
  expect(resumeResponse.request().postDataJSON()).toMatchObject({ planItemId: itemId })
  const secondSession = resumed.data.recordId
  expect(secondSession).not.toBe(firstSession)
  await expect(alice.page).toHaveURL(/\/focus$/)
  await expect(attempt).toBeVisible()
  await expect(resumeRow).toHaveCount(0)
  const priorContext = attempt.getByRole('complementary', { name: 'Context from your previous attempt', exact: true })
  await expect(priorContext.getByText('Left off: TEST CONTEXT 123', { exact: true })).toBeVisible()
  await expect(priorContext.getByText('Next: TEST NEXT STEP 456', { exact: true })).toBeVisible()
  await alice.page.reload()
  await expect(priorContext.getByText('Left off: TEST CONTEXT 123', { exact: true })).toBeVisible()
  await attempt.getByLabel('Session notes — progress, difficulty, or where you stopped').fill('Draft survives navigation')
  const nav = alice.page.getByTestId('app-navigation')
  await alice.page.getByRole('link', { name: '← Home', exact: true }).click()
  await nav.getByRole('link', { name: 'Plans', exact: true }).click()
  await nav.getByRole('link', { name: 'History', exact: true }).click()
  await nav.getByRole('link', { name: 'Home', exact: true }).click()
  await alice.page.getByRole('link', { name: 'Return to focus →', exact: true }).click()
  await expect(attempt.getByLabel('Session notes — progress, difficulty, or where you stopped')).toHaveValue('Draft survives navigation')
  const stopRequests: { endedAt: string }[] = []
  await alice.page.route('**/api/actions/endPrepSession', async (route) => {
    stopRequests.push(route.request().postDataJSON() as { endedAt: string })
    if (stopRequests.length === 1) await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Temporary stop failure' }) })
    else await route.continue()
  })
  await attempt.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(alice.page.getByText('Temporary stop failure', { exact: true })).toBeVisible()
  const frozenDuration = await attempt.getByLabel('Focus duration', { exact: true }).textContent()
  await alice.page.getByRole('link', { name: '← Home', exact: true }).click()
  await nav.getByRole('link', { name: 'Plans', exact: true }).click()
  await nav.getByRole('link', { name: 'Home', exact: true }).click()
  await alice.page.getByRole('link', { name: 'Return to focus →', exact: true }).click()
  await expect(attempt.getByLabel('Focus duration', { exact: true })).toHaveText(frozenDuration!)
  await attempt.getByRole('button', { name: 'Retry ending focus', exact: true }).click()
  await expect.poll(() => stopRequests.length).toBe(2)
  expect(stopRequests[1]!.endedAt).toBe(stopRequests[0]!.endedAt)
  await alice.page.unrouteAll({ behavior: 'wait' })
  await expect(attempt).toHaveCount(0)
  await expect(contextSection).toBeVisible()
  await contextSection.getByLabel('Where did you leave off / what was blocking you? (optional)').fill('Transient context draft')
  // Browser back/forward can navigate while a modal is open. The SDK
  // controller and draft survive those client-side route transitions.
  await alice.page.goBack()
  await expect(contextSection.getByLabel('Where did you leave off / what was blocking you? (optional)')).toHaveValue('Transient context draft')
  await alice.page.goForward()
  await expect(contextSection.getByLabel('Where did you leave off / what was blocking you? (optional)')).toHaveValue('Transient context draft')
  await contextSection.getByRole('button', { name: 'Skip', exact: true }).click()
  // A newer interval without context must not display the older checkpoint.
  await alice.page.getByRole('link', { name: '← Home', exact: true }).click()
  await expect(resumeRow).toBeVisible()
  await expect(resumeRow.getByText('Left off: TEST CONTEXT 123', { exact: true })).toHaveCount(0)
  await expect(resumeRow.getByText('Next: TEST NEXT STEP 456', { exact: true })).toHaveCount(0)
  await resumeRow.getByRole('button', { name: 'Resume', exact: true }).click()
  await expect(alice.page).toHaveURL(/\/focus$/)
  await expect(attempt).toBeVisible()
  await expect(priorContext).toHaveCount(0)
  await alice.page.reload()
  await expect(attempt).toBeVisible()
  await expect(priorContext).toHaveCount(0)
  await attempt.getByRole('button', { name: 'Complete', exact: true }).click()
  await expect(attempt).toHaveCount(0)
  await expect(resumeRow).toHaveCount(0)
  await expect(alice.page.getByText('Work completed.', { exact: true })).toBeVisible()
  expect(await action('startPrepSession', { planItemId: itemId })).toMatchObject({ success: false })
  // Both writes really execute; only their HTTP acknowledgement is lost.
  // Recovery must remain available while navigating away and back.
  const retryItem = await success('createPlanItem', { prepAreaId: areaId, intent: `${prefix} Completion retry` })
  await success('startPrepSession', { planItemId: retryItem })
  await expect(attempt).toBeVisible()
  await alice.page.route('**/api/actions/endPrepSession', async (route) => {
    const response = await route.fetch()
    expect(await response.json()).toMatchObject({ success: true })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Completion acknowledgement lost' }) })
  })
  await attempt.getByRole('button', { name: 'Complete', exact: true }).click()
  await expect(alice.page.getByRole('button', { name: 'Retry completion', exact: true })).toBeVisible()
  // Live sync can expose reconciliation before the intercepted HTTP
  // response finishes. Wait for its handler before removing the route.
  await alice.page.unrouteAll({ behavior: 'wait' })
  await alice.page.getByRole('link', { name: '← Home', exact: true }).click()
  await nav.getByRole('link', { name: 'Plans', exact: true }).click()
  await nav.getByRole('link', { name: 'Home', exact: true }).click()
  await alice.page.getByRole('link', { name: 'Return to focus →', exact: true }).click()
  await alice.page.getByRole('button', { name: 'Retry completion', exact: true }).click()
  await expect(alice.page.getByText('Item completion confirmed.', { exact: true })).toBeVisible()
  await expect(alice.page.getByRole('button', { name: 'Retry completion', exact: true })).toHaveCount(0)
  expect(await action('startPrepSession', { planItemId: retryItem })).toMatchObject({ success: false })
  await alice.page.goto('/history')
  const history = alice.page.locator('section').filter({ has: alice.page.getByRole('heading', { name: 'Recent Focus History', exact: true }) })
  await expect(history.getByRole('heading', { name: intent, exact: true })).toHaveCount(3)
  await alice.page.reload()
  await expect(history.getByRole('heading', { name: intent, exact: true })).toHaveCount(3)
  await alice.page.goto('/home')
  await expect(continueSection.getByRole('heading', { name: intent, exact: true })).toHaveCount(0)
})
