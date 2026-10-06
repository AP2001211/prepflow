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
const lifecycleAcknowledgements = /^(Focus session started\.|Difficulty recorded\. Your session is still active\.|Focus stopped\. Work remains open\.|Work completed\.|Item completion confirmed\.|Resume context saved\.)$/
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
  await expect.poll(async () => await alice.page.locator('.focus-hero article').count() > 0 || await alice.page.getByRole('link', { name: 'Add area Create a custom prep area' }).isVisible() || await alice.page.locator('button.prep-area-object').first().isEnabled()).toBe(true)
  const leftover = alice.page.locator('.focus-hero article')
  if (await leftover.count() === 1 && (/^__test-\d+__ stopped attempt$/.test(await leftover.locator('h3').innerText()) || (await leftover.locator('h3').innerText()).startsWith('__test-switch-'))) {
    // Recover only known failed lifecycle-test fixtures, never unrelated work.
    await alice.page.getByRole('link', { name: 'Return to focus →', exact: true }).click()
    await alice.page.getByRole('button', { name: 'Stop', exact: true }).click()
    await alice.page.getByRole('button', { name: 'Skip', exact: true }).click()
    await expect(alice.page).toHaveURL(/\/home$/)
  }
  await expect(bob.page.getByText('Make room for focus.', { exact: true })).toBeVisible()
  await Promise.all([alice.page.goto('/prep'), bob.page.goto('/prep')])
  const areaName = `${prefix} SQL`
  if (!await alice.page.getByLabel('Area name', { exact: true }).isVisible()) await alice.page.getByText('Add Prep Area', { exact: true }).click()
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
  const startDialog = alice.page.getByRole('dialog', { name: 'Start something else', exact: true })
  expect(await startDialog.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgb(252, 248, 239)')
  expect(await startButton.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgb(35, 107, 101)')
  await alice.page.screenshot({ path: '/tmp/prepflow-start-dialog-desktop.png', fullPage: true })
  await alice.page.setViewportSize({ width: 390, height: 844 })
  expect(await alice.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await alice.page.screenshot({ path: '/tmp/prepflow-start-dialog-mobile.png', fullPage: true })
  await alice.page.setViewportSize({ width: 1280, height: 720 })
  const startItemIds: string[] = []
  await alice.page.route('**/api/actions/startPrepSession', async (route) => {
    startItemIds.push(route.request().postDataJSON().planItemId)
    if (startItemIds.length === 1) await route.fulfill({ status: 200, json: { success: false, error: 'Fixture start rejected' } })
    else await route.continue()
  })
  await startButton.click()
  await expect(startDialog.getByRole('alert')).toBeVisible()
  await expect(alice.page).toHaveURL(/\/home$/)
  await startButton.click()
  await expect(alice.page).toHaveURL(/\/focus$/)
  await alice.page.unroute('**/api/actions/startPrepSession')
  expect(startItemIds).toHaveLength(2)
  expect(startItemIds[1]).toBe(startItemIds[0])
  const focus = alice.page.locator('article').filter({ has: alice.page.getByRole('heading', { name: intent, exact: true }) })
  await expect(focus).toBeVisible()
  await expect(alice.page.getByText(lifecycleAcknowledgements)).toHaveCount(0)
  await expect(focus.getByText('General preparation', { exact: false })).toBeVisible()
  await expect(startButton).toHaveCount(0)
  await expect(bob.page.getByRole('heading', { name: intent, exact: true })).toHaveCount(0)
  await focus.getByLabel('Session notes — progress, difficulty, or where you stopped').fill('Unsure about partitioning; continued practicing.')
  await focus.getByRole('button', { name: 'Report difficulty (keep working)', exact: true }).click()
  await expect(focus.getByRole('status').filter({ hasText: 'Difficulty noted' })).toBeVisible()
  await alice.page.getByRole('link', { name: '← Home', exact: true }).click()
  await expect(alice.page.getByText(lifecycleAcknowledgements)).toHaveCount(0)
  const navigation = alice.page.getByTestId('app-navigation')
  for (const [label, path] of [['Home', '/home'], ['Plans', '/plans'], ['My Prep', '/prep'], ['Interviews', '/interviews']] as const) {
    await expect(navigation.getByRole('link', { name: label, exact: true })).toHaveAttribute('href', path)
  }
  await expect(navigation.getByRole('button', { name: 'Account menu' })).toBeVisible()
  await expect(navigation.getByTestId('nav-sign-in-button')).toHaveCount(0)
  await navigation.getByRole('link', { name: 'Plans', exact: true }).click()
  await expect(alice.page.getByText(lifecycleAcknowledgements)).toHaveCount(0)
  await expect(navigation.getByRole('link', { name: 'History', exact: true })).toHaveCount(0)
  await alice.page.goto('/history')
  await expect(alice.page.getByText(lifecycleAcknowledgements)).toHaveCount(0)
  await navigation.getByRole('link', { name: 'Home', exact: true }).click()
  await alice.page.getByRole('link', { name: 'Return to focus →', exact: true }).click()
  await expect(focus.getByRole('status').filter({ hasText: 'Difficulty noted' })).toBeVisible()
  await expect(alice.page.getByText(lifecycleAcknowledgements)).toHaveCount(0)
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
  await alice.page.goto('/interviews')
  if (!await alice.page.getByLabel('Company', { exact: true }).isVisible()) await alice.page.getByText('Add Interview', { exact: true }).click()
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
    await expect(alice.page).toHaveURL(/\/focus$/)
    const attempt = alice.page.locator('article').filter({ has: alice.page.getByRole('heading', { name: nextIntent, exact: true, includeHidden: true }) })
    await expect(attempt).toBeVisible()
    await expect(attempt.getByText(company, { exact: false })).toBeVisible()
    await attempt.getByRole('button', { name: button, exact: true }).click()
    if (outcome === 'switched') await expect(attempt).toHaveCount(0)
    else await expect(attempt).toBeVisible()
    await expect(alice.page.getByText(lifecycleAcknowledgements)).toHaveCount(0)
    if (outcome === 'switched') {
      await expect(alice.page).toHaveURL(/\/switch\//)
      await alice.page.getByRole('button', { name: "I'm done for now", exact: true }).click()
    } else {
      await alice.page.getByRole('dialog', { name: `Stopping ${nextIntent}`, exact: true }).getByRole('button', { name: 'Skip', exact: true }).click()
    }
    await alice.page.goto('/history')
    await expect(alice.page.getByText(lifecycleAcknowledgements)).toHaveCount(0)
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
  let releaseCatalog!: () => void
  const catalogReady = new Promise<void>((resolve) => { releaseCatalog = resolve })

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

    await catalogReady
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { integrations: { openai: {}, wikipedia: {} } } }),
    })
  })

  await user.page.goto('/api-status')
  await expect(user.page.getByText('Loading integration catalog...')).toBeVisible()
  releaseCatalog()
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
  const focusSection = alice.page.locator('section.focus-content, section.focus-hero')
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
  if (!await alice.page.getByLabel('Area name', { exact: true }).isVisible()) await alice.page.getByText('Add Prep Area', { exact: true }).click()
  await alice.page.getByLabel('Area name', { exact: true }).fill(`${prefix} SQL`)
  await alice.page.getByRole('button', { name: 'Create Prep Area', exact: true }).click()
  await expect(alice.page.getByRole('heading', { name: `${prefix} SQL`, exact: true })).toBeVisible()
  await alice.page.goto('/home')
  await alice.page.locator('button.prep-area-object').first().click()
  const areaId = await alice.page.getByRole('combobox', { name: 'Prep Area', exact: true }).locator('option').filter({ hasText: `${prefix} SQL` }).getAttribute('value')
  await alice.page.getByRole('button', { name: 'Close', exact: true }).click()
  await alice.page.goto('/plans')
  // Retired General UI: historical records are fixtures, not a creation path.
  await expect(alice.page.getByText('Create a general Plan', { exact: true })).toHaveCount(0)
  const firstPlan = await success('createPlan', { title: `${prefix} Original`, budgetMinutes: 240 })
  const laterPlan = await success('createPlan', { title: `${prefix} Later` })
  const intent = `${prefix} Window functions`
  const itemId = await success('createPlanItem', { prepAreaId: areaId, intent, planId: firstPlan })
  await alice.page.goto(`/plans/${firstPlan}`)
  await expect(alice.page.getByRole('heading', { name: intent, exact: true })).toBeVisible()
  await expect(alice.page.getByRole('button', { name: 'Add intended work', exact: true })).toHaveCount(0)
  await expect(alice.page.getByRole('button', { name: 'Include existing work', exact: true })).toHaveCount(0)
  await expect(alice.page.getByRole('button', { name: 'Close plan', exact: true })).toHaveCount(0)
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
  await expect(attempt.getByText('Difficulty noted', { exact: false })).toBeVisible()
  const [endResponse] = await Promise.all([
    alice.page.waitForResponse((response) => response.url().endsWith('/api/actions/endPrepSession') && response.request().method() === 'POST'),
    attempt.getByRole('button', { name: 'End to switch', exact: true }).click(),
  ])
  expect(await endResponse.json()).toMatchObject({ success: true })
  const endInput = endResponse.request().postDataJSON() as { sessionId: string; endedAt: string }
  expect(endInput.sessionId).toBe(firstSession)
  expect(Date.parse(endInput.endedAt)).toBeLessThanOrEqual(Date.now())
  await expect(attempt).toHaveCount(0)
  await expect(alice.page).toHaveURL(new RegExp(`/switch/${firstSession}$`))
  await alice.page.getByRole('button', { name: "Skip → choose what's next", exact: true }).click()
  await alice.page.getByRole('button', { name: 'Add context', exact: true }).click()
  let contextSection = alice.page.getByRole('region', { name: 'Switch context' })
  await expect(contextSection).toBeVisible()
  await alice.page.getByLabel('Where did you leave off? (optional)').fill('TEST CONTEXT 123')
  await alice.page.getByLabel('Next thing to try (optional)').fill('TEST NEXT STEP 456')
  const [contextResponse] = await Promise.all([
    alice.page.waitForResponse((response) => response.url().endsWith('/api/actions/saveResumeContext') && response.request().method() === 'POST'),
    alice.page.getByRole('button', { name: "I'm done for now", exact: true }).click(),
  ])
  expect(await contextResponse.json()).toMatchObject({ success: true })
  expect(contextResponse.request().postDataJSON()).toEqual({ sessionId: firstSession, leftOff: 'TEST CONTEXT 123', nextStep: 'TEST NEXT STEP 456' })
  // Context is confirmed before exiting; it never changes the stop time.
  await expect(alice.page).toHaveURL(/\/home$/)
  contextSection = alice.page.getByRole('dialog', { name: /^Stopping / })
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
  await expect(priorContext.getByText('TEST CONTEXT 123', { exact: true })).toBeVisible()
  await expect(priorContext.getByText('TEST NEXT STEP 456', { exact: true })).toBeVisible()
  await alice.page.reload()
  await expect(priorContext.getByText('TEST CONTEXT 123', { exact: true })).toBeVisible()
  await attempt.getByLabel('Session notes — progress, difficulty, or where you stopped').fill('Draft survives navigation')
  const nav = alice.page.getByTestId('app-navigation')
  await alice.page.getByRole('link', { name: '← Home', exact: true }).click()
  await nav.getByRole('link', { name: 'Plans', exact: true }).click()
  await alice.page.goto('/history')
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
  await contextSection.getByRole('button', { name: 'Skip', exact: true }).click()
  await expect(contextSection.getByRole('alert')).toHaveText('Temporary stop failure')
  await expect(attempt).toBeVisible()
  await expect(contextSection).toBeVisible()
  await contextSection.getByLabel('Where did you leave off / what was blocking you? (optional)').fill('Transient context draft')
  // Browser back/forward can navigate while a modal is open. The SDK
  // controller and draft survive those client-side route transitions.
  await alice.page.goBack()
  await expect(contextSection.getByLabel('Where did you leave off / what was blocking you? (optional)')).toHaveValue('Transient context draft')
  await alice.page.goForward()
  await expect(contextSection.getByLabel('Where did you leave off / what was blocking you? (optional)')).toHaveValue('Transient context draft')
  await contextSection.getByRole('button', { name: 'Skip', exact: true }).click()
  await expect.poll(() => stopRequests.length).toBe(2)
  expect(Date.parse(stopRequests[1]!.endedAt)).toBeGreaterThanOrEqual(Date.parse(stopRequests[0]!.endedAt))
  await alice.page.unrouteAll({ behavior: 'wait' })
  // Stop + Skip returns Home; newer context must not fall back.
  await expect(alice.page).toHaveURL(/\/home$/)
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
  await expect(alice.page.getByRole('status', { name: 'Work completed' })).toBeVisible()
  await expect(alice.page).toHaveURL(/\/home$/)
  const completedCard = alice.page.getByRole('status', { name: 'Work completed' })
  await expect(completedCard.getByRole('heading', { name: intent, exact: true })).toBeVisible()
  await expect(completedCard.getByText(/focused$/)).toBeVisible()
  expect(await completedCard.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgb(35, 107, 101)')
  await expect(completedCard.getByRole('link', { name: /Return to focus/ })).toHaveCount(0)
  // Readable hold, then the same primary slot returns to normal Home content.
  await alice.page.waitForTimeout(500)
  await expect(completedCard).toBeVisible()
  const primarySlot = alice.page.locator('.home-primary')
  await expect(primarySlot).toHaveClass(/is-completion-leaving/)
  expect(await completedCard.evaluate((node) => {
    const style = getComputedStyle(node)
    const frames = node.getAnimations().flatMap((animation) => animation.effect instanceof KeyframeEffect ? animation.effect.getKeyframes() : [])
    return { duration: style.animationDuration, opacity: style.opacity, turnOnly: frames.length > 0 && frames.every((frame) => (frame.opacity === undefined || Number(frame.opacity) === 1) && String(frame.transform).includes('rotateX')) }
  })).toEqual({ duration: '0.65s', opacity: '1', turnOnly: true })
  expect(await completedCard.evaluate((node) => node.getAnimations().some((animation) => animation.effect instanceof KeyframeEffect && animation.effect.getKeyframes().some((frame) => String(frame.transform).includes('rotateX(-90deg)'))))).toBe(true)
  await expect(completedCard).toHaveCount(0)
  await expect(primarySlot).toHaveClass(/is-completion-arriving/)
  const nextCard = primarySlot.locator('section').first()
  expect(await nextCard.evaluate((node) => {
    const style = getComputedStyle(node)
    const frames = node.getAnimations().flatMap((animation) => animation.effect instanceof KeyframeEffect ? animation.effect.getKeyframes() : [])
    return { duration: style.animationDuration, opacity: style.opacity, turnOnly: frames.length > 0 && frames.every((frame) => (frame.opacity === undefined || Number(frame.opacity) === 1) && String(frame.transform).includes('rotateX')) }
  })).toEqual({ duration: '0.65s', opacity: '1', turnOnly: true })
  expect(await nextCard.evaluate((node) => node.getAnimations().some((animation) => animation.effect instanceof KeyframeEffect && animation.effect.getKeyframes().some((frame) => String(frame.transform).includes('rotateX(90deg)'))))).toBe(true)
  await expect(alice.page.getByRole('region', { name: "Today's Plan", exact: true })).toBeVisible()
  await expect(alice.page.getByText(lifecycleAcknowledgements)).toHaveCount(0)
  expect(await action('startPrepSession', { planItemId: itemId })).toMatchObject({ success: false })
  // Both writes really execute; only their HTTP acknowledgement is lost.
  // Recovery must remain available while navigating away and back.
  const retryItem = await success('createPlanItem', { prepAreaId: areaId, intent: `${prefix} Completion retry` })
  await success('startPrepSession', { planItemId: retryItem })
  await alice.page.goto('/focus')
  await expect(attempt).toBeVisible()
  await alice.page.route('**/api/actions/endPrepSession', async (route) => {
    const response = await route.fetch()
    expect(await response.json()).toMatchObject({ success: true })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Completion acknowledgement lost' }) })
  })
  await attempt.getByRole('button', { name: 'Complete', exact: true }).click()
  await expect(alice.page.getByRole('button', { name: 'Retry completion', exact: true })).toBeVisible()
  await expect(alice.page.getByRole('status', { name: 'Work completed' })).toHaveCount(0)
  // Live sync can expose reconciliation before the intercepted HTTP
  // response finishes. Wait for its handler before removing the route.
  await alice.page.unrouteAll({ behavior: 'wait' })
  await alice.page.getByRole('link', { name: '← Home', exact: true }).click()
  await nav.getByRole('link', { name: 'Plans', exact: true }).click()
  await nav.getByRole('link', { name: 'Home', exact: true }).click()
  await alice.page.getByRole('link', { name: 'Return to focus →', exact: true }).click()
  await alice.page.emulateMedia({ reducedMotion: 'reduce' })
  await alice.page.getByRole('button', { name: 'Retry completion', exact: true }).click()
  await expect(alice.page.getByRole('status', { name: 'Work completed' })).toBeVisible()
  expect(await alice.page.getByRole('status', { name: 'Work completed' }).evaluate((node) => getComputedStyle(node).animationName)).toBe('none')
  await expect(alice.page).toHaveURL(/\/home$/)
  await expect(alice.page.getByRole('button', { name: 'Retry completion', exact: true })).toHaveCount(0)
  await expect(alice.page.getByText(lifecycleAcknowledgements)).toHaveCount(0)
  // Navigation is never blocked by the temporary card.
  expect(await action('startPrepSession', { planItemId: retryItem })).toMatchObject({ success: false })
  await alice.page.goto('/history')
  const history = alice.page.locator('section').filter({ has: alice.page.getByRole('heading', { name: 'Recent Focus History', exact: true }) })
  await expect(history.getByRole('heading', { name: intent, exact: true })).toHaveCount(3)
  await alice.page.reload()
  await expect(history.getByRole('heading', { name: intent, exact: true })).toHaveCount(3)
  await alice.page.goto('/home')
  await expect(alice.page.getByRole('status', { name: 'Work completed' })).toHaveCount(0)
  await expect(continueSection.getByRole('heading', { name: intent, exact: true })).toHaveCount(0)
})

test('Still working check-in persists without resetting focus and reuses stop/switch', async ({ users }) => {
  test.setTimeout(90000)
  const [person] = await users(1)
  const page = person.page
  await page.goto('/home')
  await expect(page.getByText('Make room for focus.', { exact: true })).toBeVisible()
  await expect.poll(async () => await page.locator('.focus-hero article').count() > 0 || await page.locator('button.prep-area-object').first().isEnabled()).toBe(true)
  const leftover = page.locator('.focus-hero article')
  if (await leftover.count() === 1 && (await leftover.locator('h3').innerText()).startsWith('__test-checkin-')) {
    await page.getByRole('link', { name: 'Return to focus →', exact: true }).click()
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await page.getByRole('button', { name: 'Skip', exact: true }).click()
    await expect(page).toHaveURL(/\/home$/)
    await expect(leftover).toHaveCount(0)
  }
  test.skip(await page.locator('.focus-hero article').count() > 0, 'Preserve unrelated active focus.')
  const tokenResponse = await person.context.request.post('/api/auth/token', { data: {} })
  const { token } = await tokenResponse.json() as { token: string }
  const action = async (name: string, data: unknown) => {
    const response = await person.context.request.post(`/api/actions/${name}`, { headers: { Authorization: `Bearer ${token}` }, data })
    const result = await response.json() as { success: boolean; data: { recordId: string } }
    expect(result.success).toBe(true)
    return result.data.recordId
  }
  const title = `__test-checkin-${Date.now()}__ Long work title that wraps safely on narrow screens`
  await page.goto('/prep')
  if (!await page.getByLabel('Area name', { exact: true }).isVisible()) await page.getByText('Add Prep Area', { exact: true }).click()
  await page.getByLabel('Area name', { exact: true }).fill(title)
  await page.getByRole('button', { name: 'Create Prep Area', exact: true }).click()
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  await page.goto('/home')
  await page.locator('button.prep-area-object').filter({ hasText: title }).click()
  const areaId = await page.getByRole('combobox', { name: 'Prep Area', exact: true }).inputValue()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  const item = await action('createPlanItem', { prepAreaId: areaId, intent: title })
  const session = await action('startPrepSession', { planItemId: item })
  const observed = new Map<string, { startedAt: string; lastCheckInAt?: string; state: string; notes?: string }>()
  page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => {
    try {
      const message = JSON.parse(String(payload))
      for (const record of message.payload?.records ?? []) if (record.recordId === session) observed.set(session, record.data)
    } catch { /* Ignore unrelated frames. */ }
  }))
  await page.goto('/focus')
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  await expect.poll(() => observed.has(session)).toBe(true)
  const startedAt = observed.get(session)!.startedAt
  const start = Date.parse(startedAt)
  await page.clock.install({ time: new Date(start) })
  const check = page.getByRole('region', { name: 'Focus check-in' })
  await expect(check).toHaveCount(0)
  await page.clock.setFixedTime(new Date(start + 90 * 60000))
  await expect(check).toBeVisible()
  const notes = page.getByRole('textbox')
  await notes.fill('Preserve this notebook')
  await page.clock.runFor(1000)
  // Failed confirmation must not hide the overdue prompt permanently.
  await page.route('**/api/actions/acknowledgeFocusCheckIn', (route) => route.fulfill({ status: 503, json: { success: false, error: 'Check-in unavailable; retry.' } }))
  await check.getByRole('button', { name: 'Keep focusing' }).click()
  await expect(page.getByText('Check-in unavailable; retry.')).toBeVisible()
  await expect(check).toBeVisible()
  await page.unroute('**/api/actions/acknowledgeFocusCheckIn')
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/api/actions/acknowledgeFocusCheckIn', async (route) => { await held; await route.continue() })
  const saved = page.waitForResponse('**/api/actions/acknowledgeFocusCheckIn')
  await check.getByRole('button', { name: 'Keep focusing' }).click()
  await expect(check).toHaveCount(0)
  await expect(notes).toHaveValue('Preserve this notebook')
  release()
  expect((await saved).ok()).toBe(true)
  await page.unroute('**/api/actions/acknowledgeFocusCheckIn')
  // Server time remains real; restore browser time after the eligibility experiment.
  await page.clock.setFixedTime(new Date())
  await expect(check).toHaveCount(0)
  await page.reload()
  await expect(check).toHaveCount(0)
  await expect(notes).toHaveValue('Preserve this notebook')
  await expect.poll(() => !!observed.get(session)?.lastCheckInAt).toBe(true)
  expect(observed.get(session)!.startedAt).toBe(startedAt)
  expect(observed.get(session)!.state).toBe('active')
  const ack = Date.parse(observed.get(session)!.lastCheckInAt!)
  await page.clock.setFixedTime(new Date(ack + 90 * 60000))
  await expect(check).toBeVisible()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.getByLabel('Focus duration')).toBeVisible()
    await expect(notes).toBeVisible()
    await page.screenshot({ path: `/tmp/prepflow-check-in-${width}.png`, fullPage: true })
  }
  await check.getByRole('button', { name: 'I stopped' }).click()
  await expect(check).toHaveCount(0)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(check).toBeVisible()
  expect(observed.get(session)!.state).toBe('active')
  // End timestamps must use real time, not the test's future browser clock.
  await page.clock.setFixedTime(new Date())
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.getByRole('button', { name: 'Skip', exact: true }).click()
  await expect(page).toHaveURL(/\/home$/)
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  await action('startPrepSession', { planItemId: item })
  await page.goto('/focus')
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  const switchTime = Date.now() + 91 * 60000
  await page.clock.setFixedTime(new Date(switchTime))
  await expect(check).toBeVisible()
  await page.clock.pauseAt(new Date(switchTime + 2000))
  // Keep the rendered overdue state, but use real time for the confirmed end.
  await page.clock.setSystemTime(new Date())
  await check.getByRole('button', { name: 'I switched', exact: true }).click()
  await expect(page).toHaveURL(/\/switch\//)
  await page.getByRole('button', { name: "I'm done for now", exact: true }).click()
  await expect(check).toHaveCount(0)
})

test('Switch resolves persisted source, saves context before start, and handles refresh and failures', async ({ users }) => {
  const [person] = await users(1)
  const page = person.page
  await page.goto('/home')
  await expect(page.getByText('Make room for focus.', { exact: true })).toBeVisible()
  await expect.poll(async () => await page.locator('.focus-hero article').count() > 0 || await page.locator('button.prep-area-object').first().isEnabled()).toBe(true)
  const leftover = page.locator('.focus-hero article')
  if (await leftover.count() === 1 && (await leftover.locator('h3').innerText()).startsWith('__test-switch-')) {
    await page.getByRole('link', { name: 'Return to focus →', exact: true }).click()
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await page.getByRole('button', { name: 'Skip', exact: true }).click()
    await expect(page).toHaveURL(/\/home$/)
  }
  test.skip(await page.locator('.focus-hero article').count() > 0, 'Preserve unrelated active focus.')
  const { token } = await (await person.context.request.post('/api/auth/token', { data: {} })).json() as { token: string }
  const action = async (name: string, data: unknown) => {
    const result = await (await person.context.request.post(`/api/actions/${name}`, { headers: { Authorization: `Bearer ${token}` }, data })).json() as { success: boolean; data: { recordId: string } }
    expect(result.success).toBe(true); return result.data.recordId
  }
  const title = `__test-switch-${Date.now()}__ A long task identity that should wrap safely on mobile`
  await page.goto('/prep')
  if (!await page.getByLabel('Area name', { exact: true }).isVisible()) await page.getByText('Add Prep Area', { exact: true }).click()
  await page.getByLabel('Area name', { exact: true }).fill(title)
  await page.getByRole('button', { name: 'Create Prep Area', exact: true }).click()
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  await page.goto('/home')
  await page.locator('button.prep-area-object').filter({ hasText: title }).click()
  const area = await page.getByRole('combobox', { name: 'Prep Area', exact: true }).inputValue()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  const nextTitle = `${title} — Task B`
  const nextItem = await action('createPlanItem', { prepAreaId: area, intent: nextTitle })
  const earlier = await action('startPrepSession', { planItemId: nextItem })
  await action('endPrepSession', { sessionId: earlier, outcome: 'stopped', endedAt: new Date().toISOString() })
  const item = await action('createPlanItem', { prepAreaId: area, intent: title })
  const session = await action('startPrepSession', { planItemId: item })
  await page.goto('/focus')
  await page.getByRole('textbox').fill('Final notebook stays separate')
  await page.getByRole('button', { name: 'Report difficulty (keep working)', exact: true }).click()
  await expect(page.getByText('Difficulty noted', { exact: false })).toBeVisible()
  await page.route('**/api/actions/endPrepSession', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Switch end failed' }) }))
  await page.getByRole('button', { name: 'End to switch', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Switch end failed' })).toBeVisible()
  await expect(page).toHaveURL(/\/focus$/)
  await page.unroute('**/api/actions/endPrepSession')
  await page.getByRole('button', { name: 'Retry ending focus', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/switch/${session}$`))
  await page.reload()
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  await expect(page.getByTestId('app-navigation')).toHaveCount(0)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: '/tmp/prepflow-switch-desktop.png', fullPage: true })
  await expect(page.getByRole('region', { name: 'Next work' })).toHaveCount(0)
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save context', exact: true })).toHaveCount(0)
  await expect(page.getByText('< 1 min focused', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: "I'm stuck", exact: true }).click()
  await expect(page.getByRole('region', { name: 'Switch reason' })).toHaveCount(0)
  await page.getByLabel('Where did you get stuck? (optional)').fill('Return breadcrumb')
  await page.getByLabel('Next thing to try (optional)').fill('Next step')
  await page.getByRole('button', { name: "Choose what's next", exact: true }).click()
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await expect(page.getByRole('listitem').filter({ has: page.getByText(title, { exact: true }).and(page.locator('strong')) })).toHaveCount(0)
  const resume = page.getByRole('listitem').filter({ has: page.getByText(nextTitle, { exact: true }) }).getByRole('button', { name: 'Resume', exact: true })
  const writes: string[] = []
  page.on('request', (request) => { if (/\/api\/actions\/(saveResumeContext|startPrepSession)$/.test(request.url())) writes.push(request.url().split('/').at(-1)!) })
  await page.route('**/api/actions/saveResumeContext', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Context failed' }) }))
  await resume.click()
  await expect(page.getByRole('alert').filter({ hasText: 'Context failed' })).toBeVisible()
  expect(writes).toEqual(['saveResumeContext'])
  writes.length = 0
  await expect(page).toHaveURL(new RegExp(`/switch/${session}$`))
  await page.unroute('**/api/actions/saveResumeContext')
  await page.route('**/api/actions/startPrepSession', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Start failed' }) }))
  await resume.click()
  await expect(page.getByRole('alert').filter({ hasText: 'Start failed' })).toBeVisible()
  expect(writes).toEqual(['saveResumeContext', 'startPrepSession'])
  await expect(page.getByText('Left off: Return breadcrumb', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/switch/${session}$`))
  await page.unroute('**/api/actions/startPrepSession')
  await page.reload()
  await expect(page.getByText('Next: Next step', { exact: true })).toBeVisible()
  await expect(page.getByText("✓ Switching because: I'm stuck", { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Edit context', exact: true }).click()
  await expect(page.getByLabel('Where did you get stuck? (optional)')).toHaveValue('Return breadcrumb')
  await page.getByRole('button', { name: "Choose what's next", exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/prepflow-switch-mobile.png', fullPage: true })
  writes.length = 0
  const [started] = await Promise.all([page.waitForResponse((response) => response.url().endsWith('/api/actions/startPrepSession')), resume.click()])
  expect(writes).toEqual(['startPrepSession']) // Already persisted on the previous failed-start attempt.
  const result = await started.json() as { data: { recordId: string } }
  expect(result.data.recordId).not.toBe(session)
  await expect(page).toHaveURL(/\/focus$/)
  await expect(page.getByRole('textbox')).toHaveValue('')
  await expect(page.getByRole('heading', { name: nextTitle, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'End to switch', exact: true }).click()
  await expect(page).toHaveURL(/\/switch\//)
  await page.getByRole('button', { name: "Skip → choose what's next", exact: true }).click()
  await expect(page.getByRole('region', { name: 'Next work' })).toBeVisible()
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  await expect(page.getByRole('textbox')).toHaveCount(2)
  await page.getByRole('button', { name: "Choose what's next", exact: true }).click()
  const sourceResume = page.getByRole('listitem').filter({ has: page.getByText(title, { exact: true }).and(page.locator('strong')) }).getByRole('button', { name: 'Resume', exact: true })
  const [resumed] = await Promise.all([page.waitForResponse((response) => response.url().endsWith('/api/actions/startPrepSession')), sourceResume.click()])
  expect((await resumed.json()).data.recordId).not.toBe(session)
  await expect(page).toHaveURL(/\/focus$/)
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  await page.goto(`/switch/${session}`)
  await expect(page.getByRole('link', { name: 'Return to Focus', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toHaveCount(0)
  await page.getByRole('link', { name: 'Return to Focus', exact: true }).click()
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.getByRole('button', { name: 'Skip', exact: true }).click()
  await page.goto(`/switch/${session}`)
  await page.getByRole('button', { name: 'Change reason', exact: true }).click()
  await page.getByRole('button', { name: 'Need a break', exact: true }).click()
  await page.getByLabel('Where are you leaving off? (optional)').fill('Updated before Home')
  await page.route('**/api/actions/saveResumeContext', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Exit context failed' }) }))
  await page.getByRole('button', { name: "I'm done for now", exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Exit context failed' })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/switch/${session}$`))
  await expect(page.getByLabel('Where are you leaving off? (optional)')).toHaveValue('Updated before Home')
  await page.unroute('**/api/actions/saveResumeContext')
  const [exitSave] = await Promise.all([page.waitForResponse((response) => response.url().endsWith('/api/actions/saveResumeContext')), page.getByRole('button', { name: "I'm done for now", exact: true }).click()])
  expect(exitSave.request().postDataJSON()).toMatchObject({ sessionId: session, switchReason: 'break', leftOff: 'Updated before Home', nextStep: 'Next step' })
  await expect(page).toHaveURL(/\/home$/)
  await page.goto('/switch/does-not-exist')
  await expect(page.getByText('This switch session is unavailable.', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Back Home', exact: true }).click()
})
