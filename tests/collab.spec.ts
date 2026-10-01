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
  await expect(alice.page.getByRole('heading', { name: 'Current Focus' })).toBeVisible()
  await expect(bob.page.getByRole('heading', { name: 'Current Focus' })).toBeVisible()
  const areaName = `${prefix} SQL`
  await alice.page.getByLabel('Area name', { exact: true }).fill(areaName)
  await alice.page.getByRole('button', { name: 'Create Prep Area', exact: true }).click()
  await expect(alice.page.getByRole('heading', { name: areaName, exact: true })).toBeVisible()
  await expect(bob.page.getByRole('heading', { name: areaName, exact: true })).toHaveCount(0)

  // Never end a developer's pre-existing focus session for test setup.
  const startButton = alice.page.getByRole('button', { name: 'Start focus session', exact: true })
  test.skip(await startButton.count() === 0, 'The fixture user already has active preparation; preserve it and use a clean fixture account.')
  const areaId = await alice.page.getByLabel('Prep Area', { exact: true }).locator('option').filter({ hasText: areaName }).getAttribute('value')
  expect(areaId).toBeTruthy()
  await alice.page.getByLabel('Prep Area', { exact: true }).selectOption(areaId!)
  const intent = `${prefix} Practice window functions`
  await alice.page.getByLabel('What do you intend to work on?').fill(intent)
  await startButton.click()
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
  const history = alice.page.locator('section').filter({ has: alice.page.getByRole('heading', { name: 'Recent Sessions', exact: true }) })
  await expect(history.getByRole('heading', { name: intent, exact: true })).toBeVisible()
  await expect(history.getByText('Encountered difficulty', { exact: false })).toBeVisible()

  const company = `${prefix} Example`
  await alice.page.getByLabel('Company', { exact: true }).fill(company)
  await alice.page.getByLabel(areaName, { exact: true }).check()
  await alice.page.getByRole('button', { name: 'Create Interview', exact: true }).click()
  await expect(alice.page.getByRole('heading', { name: company, exact: true })).toBeVisible()
  await expect(bob.page.getByRole('heading', { name: company, exact: true })).toHaveCount(0)

  const interviewId = await alice.page.getByLabel('Interview (optional)', { exact: true }).locator('option').filter({ hasText: company }).getAttribute('value')
  expect(interviewId).toBeTruthy()
  for (const [button, outcome] of [['Stop', 'stopped'], ['End to switch', 'switched']] as const) {
    const nextIntent = `${prefix} ${outcome} attempt`
    await alice.page.getByLabel('Prep Area', { exact: true }).selectOption(areaId!)
    await alice.page.getByLabel('Interview (optional)', { exact: true }).selectOption(interviewId!)
    await alice.page.getByLabel('What do you intend to work on?').fill(nextIntent)
    await alice.page.getByRole('button', { name: 'Start focus session', exact: true }).click()
    const attempt = alice.page.locator('article').filter({ has: alice.page.getByRole('heading', { name: nextIntent, exact: true }) })
    await expect(attempt).toBeVisible()
    await expect(attempt.getByText(company, { exact: false })).toBeVisible()
    await attempt.getByRole('button', { name: button, exact: true }).click()
    await expect(attempt).toHaveCount(0)
    const entry = history.locator('li').filter({ has: alice.page.getByRole('heading', { name: nextIntent, exact: true }) })
    await expect(entry.getByText(outcome, { exact: false })).toBeVisible()
  }
  const tokenResponse = await bob.context.request.post('/api/auth/token', { data: {} })
  expect(tokenResponse.ok()).toBe(true)
  const { token } = await tokenResponse.json() as { token: string }
  const forbiddenLink = await bob.context.request.post('/api/actions/createInterview', {
    headers: { Authorization: `Bearer ${token}` }, data: { company: `${prefix} Forged`, prepAreaIds: [areaId] },
  })
  expect(await forbiddenLink.json()).toMatchObject({ success: false })
  const forbiddenSession = await bob.context.request.post('/api/actions/startPrepSession', {
    headers: { Authorization: `Bearer ${token}` }, data: { prepAreaId: areaId, interviewId, intent: `${prefix} Forged` },
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
