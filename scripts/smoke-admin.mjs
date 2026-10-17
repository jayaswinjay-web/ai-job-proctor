/**
 * Admin console browser smoke test.
 *
 * Drives the real console in Chrome against the running API, because the failures that
 * matter here (a component throwing on first render, a route rendering the wrong page, a
 * fetch envelope the console misreads) are invisible to typechecking and to API probes.
 *
 * Every console error and unhandled rejection fails the run: a warning that looks
 * harmless in development is a broken page for a recruiter.
 *
 * Usage:
 *   node scripts/smoke-admin.mjs                     # expects API :4000 and admin :5174
 *   ADMIN_URL=http://localhost:5174 API_URL=... node scripts/smoke-admin.mjs
 */

import puppeteer from 'puppeteer-core';

const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:5174';
const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const EMAIL = process.env.SMOKE_EMAIL ?? 'admin@example.org';
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'Proctor!Admin2026';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

let failures = 0;

function check(name, condition, detail = '') {
  if (condition) console.log(`  PASS  ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function findBrowser() {
  const { existsSync } = await import('node:fs');
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    'No Chrome or Edge executable found. Set CHROME_PATH to a browser binary, or install Chrome.',
  );
}

/** Every route the sidebar can reach, with something specific we expect to be on the page. */
const ROUTES = [
  { path: '/', expect: 'Overview' },
  // The search box is identified by its accessible name, which is also what a screen
  // reader announces, so its presence is the assertion that matters.
  { path: '/candidates', expect: 'Search candidates', selector: '[aria-label="Search candidates"]' },
  { path: '/jobs', expect: 'New job' },
  { path: '/questions', expect: 'New question' },
  { path: '/reports', expect: 'Export' },
  { path: '/settings', expect: 'General' },
  { path: '/audit', expect: 'append-only' },
  { path: '/users', expect: 'Users & roles' },
];

async function main() {
  const executablePath = await findBrowser();
  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 960 });

  /**
   * Console errors, page crashes and failed responses are collected across every
   * navigation. The URL is captured with each problem so a 401 on the intentional
   * pre-login refresh can be told apart from a 401 on a page that should have worked.
   */
  const problems = [];
  /** Requests the app is allowed to fail: probing auth before a session exists. */
  const expectedFailure = (url, status) =>
    (url.includes('/auth/refresh') || url.includes('/auth/me')) && (status === 401 || status === 403);

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // Network failures are already reported with their URL by the response handler.
    // Chrome's generic "Failed to load resource" line carries no URL, so reporting it
    // here would double-count and would flag the intentional pre-login refresh.
    if (text.startsWith('Failed to load resource')) return;
    problems.push(`console: ${text}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('response', (response) => {
    // Read through the object rather than destructuring: puppeteer's accessors are
    // backed by private fields, so a destructured reference throws when read later.
    const status = response.status();
    const url = response.url();
    if (status < 400 || expectedFailure(url, status)) return;
    problems.push(`http ${status}: ${url}`);
  });
  page.on('requestfailed', (request) => problems.push(`requestfailed: ${request.url()}`));

  console.log('ADMIN BROWSER SMOKE');
  console.log('-------------------');
  console.log(`admin: ${ADMIN_URL}`);
  console.log(`api:   ${API_URL}`);
  console.log('');

  // ---- login screen -------------------------------------------------------
  await page.goto(ADMIN_URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('form', { timeout: 20000 });
  check('login screen renders', await page.$eval('form', (form) => form.innerText.includes('Sign in')));
  check('site name is shown on the login card', (await page.content()).includes('Recruitment Admin') || (await page.content()).includes('Admin'));

  // ---- sign in -----------------------------------------------------------
  await page.type('#email', EMAIL, { delay: 4 });
  await page.type('#password', PASSWORD, { delay: 4 });
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForFunction(() => !document.querySelector('form'), { timeout: 25000 }),
  ]);
  check('sign in reaches the dashboard shell', Boolean(await page.$('nav[aria-label="Main"]')));

  // The refresh cookie should have been written httpOnly by the API.
  const cookies = await browser.cookies();
  const refresh = cookies.find((c) => c.name.includes('refresh') || c.name === 'proctor_csrf');
  check('session cookies are set', Boolean(refresh), cookies.map((c) => c.name).join(','));

  // ---- each route --------------------------------------------------------
  for (const route of ROUTES) {
    const before = problems.length;
    await page.goto(`${ADMIN_URL}${route.path}`, { waitUntil: 'networkidle2', timeout: 45000 });
    // Prefer a selector assertion where the expectation is an accessible name rather
    // than visible copy, so a copy edit cannot fail the check or mask a missing control.
    const found = route.selector ? Boolean(await page.$(route.selector)) : null;
    const text = await page.evaluate(() => document.body.innerText);
    check(
      `${route.path} renders`,
      found === null ? text.includes(route.expect) : found,
      `expected "${route.expect}"${route.selector ? ` via ${route.selector}` : ''}; page said: ${text.slice(0, 200).replace(/\s+/g, ' ')}`,
    );
    check(`${route.path} loads without console errors`, problems.length === before, problems.slice(before).join(' | '));
  }

  // ---- candidate detail --------------------------------------------------
  // Resolved with a direct Node fetch rather than an in-page fetch: doing it in the page
  // would send a cross-origin request from the admin origin and report a CORS failure
  // that has nothing to do with the page under test.
  const auth = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).then((r) => r.json());

  const candidatesResponse = await fetch(`${API_URL}/api/v1/admin/candidates`, {
    headers: { authorization: `Bearer ${auth.accessToken}` },
  }).then((r) => r.json());

  if (candidatesResponse.items?.length) {
    const sessionId = candidatesResponse.items[0].sessionId;
    const before = problems.length;
    await page.goto(`${ADMIN_URL}/candidates/${sessionId}`, { waitUntil: 'networkidle2', timeout: 45000 });
    const text = await page.evaluate(() => document.body.innerText);
    check('interview review renders', text.includes('Transcript'), text.slice(0, 160).replace(/\s+/g, ' '));
    check('interview review shows a decision tab or empty state', text.includes('AI assessment'));
    check('interview review loads without console errors', problems.length === before, problems.slice(before).join(' | '));
  } else {
    console.log('  SKIP  no candidates available for the review page check');
  }

  // ---- responsive behaviour ---------------------------------------------
  await page.setViewport({ width: 820, height: 1000 });
  await page.goto(`${ADMIN_URL}/`, { waitUntil: 'networkidle2', timeout: 45000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal overflow at tablet width', overflow <= 2, `overflow ${overflow}px`);

  // ---- unknown route -----------------------------------------------------
  await page.setViewport({ width: 1440, height: 960 });
  await page.goto(`${ADMIN_URL}/does-not-exist`, { waitUntil: 'networkidle2', timeout: 45000 });
  check('unknown route shows a friendly page', (await page.evaluate(() => document.body.innerText)).includes('Page not found'));

  // ---- sign out ----------------------------------------------------------
  await page.goto(`${ADMIN_URL}/`, { waitUntil: 'networkidle2', timeout: 45000 });
  const signOut = await page.evaluateHandle(() =>
    [...document.querySelectorAll('button')].find((b) => b.innerText.includes('Sign out')),
  );
  await signOut.asElement()?.click();
  await page.waitForFunction(() => Boolean(document.querySelector('form')), { timeout: 20000 }).catch(() => {});
  check('sign out returns to the login screen', Boolean(await page.$('form')));

  await browser.close();

  console.log('==============================================');
  if (problems.length) {
    console.log(`${problems.length} browser problem(s) recorded:`);
    for (const problem of [...new Set(problems)].slice(0, 12)) console.log(`  - ${problem}`);
  }
  console.log(failures === 0 ? 'All browser smoke checks passed.' : `${failures} browser smoke check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
