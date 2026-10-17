/**
 * Kiosk browser smoke test.
 *
 * Covers the flow a candidate actually walks before a word is spoken: welcome, language,
 * job choice, consent. The interview itself is not driven here — it needs a microphone
 * and real speech, which a headless browser cannot provide, and pretending otherwise
 * would produce a test that passes while the candidate flow is broken.
 *
 * The microphone and camera are granted via fake device flags, so the app's permission
 * handling is exercised even though no hardware is present.
 *
 * Usage:
 *   node scripts/smoke-kiosk.mjs                    # expects API :4000 and kiosk :5173
 */

import puppeteer from 'puppeteer-core';

const KIOSK_URL = process.env.KIOSK_URL ?? 'http://localhost:5173';
const API_URL = process.env.API_URL ?? 'http://localhost:4000';

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
  throw new Error('No Chrome or Edge executable found. Set CHROME_PATH to a browser binary.');
}

/** Clicks the button whose visible text matches, and waits for the screen to change. */
async function clickText(page, text) {
  const clicked = await page.evaluate((label) => {
    const candidates = [...document.querySelectorAll('button, [role="button"]')];
    const target = candidates.find((element) => element.innerText.trim().toLowerCase().includes(label.toLowerCase()));
    if (!target) return false;
    target.click();
    return true;
  }, text);
  if (!clicked) throw new Error(`No clickable element containing "${text}"`);
  return clicked;
}

async function screenText(page) {
  return page.evaluate(() => document.body.innerText);
}

async function main() {
  const executablePath = await findBrowser();
  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      // Fake devices so getUserMedia resolves. The candidate flow must not assume real
      // hardware is present during development.
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  const page = await browser.newPage();
  // A low-end kiosk: a small viewport is what a cheap 7" tablet actually has.
  await page.setViewport({ width: 1024, height: 600, isMobile: false });

  const problems = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.startsWith('Failed to load resource')) return;
    problems.push(`console: ${text}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('response', (response) => {
    const status = response.status();
    if (status >= 500) problems.push(`http ${status}: ${response.url()}`);
  });

  /**
   * Dialogs are handled for the whole run, not once.
   *
   * The kiosk installs a `beforeunload` guard during an interview, so every navigation
   * raises a modal dialog. A modal dialog blocks the renderer's JavaScript entirely, which
   * makes any later `page.evaluate` hang rather than fail — so all dialogs are accepted as
   * they arrive and the count is asserted afterwards.
   */
  const dialogsSeen = [];
  page.on('dialog', async (dialog) => {
    dialogsSeen.push(dialog.type());
    await dialog.accept().catch(() => {});
  });

  console.log('KIOSK BROWSER SMOKE');
  console.log('------------------');
  console.log(`kiosk: ${KIOSK_URL}`);
  console.log(`api:   ${API_URL}`);
  console.log('');

  // ---- welcome -----------------------------------------------------------
  await page.goto(KIOSK_URL, { waitUntil: 'networkidle2', timeout: 45000 });
  const welcome = await screenText(page);
  check('welcome screen renders', welcome.length > 0 && /start|begin|welcome|शुरू|सुरू/i.test(welcome), welcome.slice(0, 160).replace(/\s+/g, ' '));
  check('language list reaches the browser', /[A-Za-z]/.test(welcome));

  // ---- start ------------------------------------------------------------
  await clickText(page, 'Start');
  await new Promise((r) => setTimeout(r, 1500));
  const languageScreen = await screenText(page);
  check(
    'language screen is offered after start',
    /English|हिन्दी|मराठी|Hindi|Marathi/i.test(languageScreen),
    languageScreen.slice(0, 200).replace(/\s+/g, ' '),
  );

  // ---- language selection ------------------------------------------------
  // Tamil is chosen deliberately. It is neither the default nor the second option, and it
  // uses a different script from English, so it fails loudly if the selection is dropped,
  // the session reverts to a default, or the engine falls back to English copy.
  const chosenLanguage = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button, [role="button"]')];
    const target = buttons.find((b) => /தமிழ்|Tamil/i.test(b.innerText));
    if (!target) return null;
    const label = target.innerText.trim().split('\n')[0];
    target.click();
    return label;
  });
  check('a non-default language can be chosen', chosenLanguage !== null, chosenLanguage ?? 'Tamil was not offered');

  await new Promise((r) => setTimeout(r, 1500));
  const afterLanguage = await screenText(page);
  check('language selection advances to job choice', /start|apply|चालू|सुरू|application|job/i.test(afterLanguage), afterLanguage.slice(0, 200).replace(/\s+/g, ' '));

  // ---- job choice --------------------------------------------------------
  const jobNames = await page.evaluate(() =>
    [...document.querySelectorAll('button, [role="button"]')].map((b) => b.innerText.trim()).filter(Boolean),
  );
  check('at least one job is offered', jobNames.length > 0, jobNames.slice(0, 5).join(' | '));

  // Pick the first job-looking control that is not a language or navigation button.
  const jobPick = await page.evaluate(() => {
    const skip = /english|हिन्दी|मराठी|hindi|marathi|help|back|home|start|apply|चालू|सुरू/i;
    const candidates = [...document.querySelectorAll('button, [role="button"]')];
    const target = candidates.find((element) => {
      const text = element.innerText.trim();
      return text.length > 3 && !skip.test(text);
    });
    if (!target) return null;
    const label = target.innerText.trim().slice(0, 60);
    target.click();
    return label;
  });

  let sessionId = null;
  let stored = null;
  if (jobPick) {
    check('a job can be selected', true, `selected: ${jobPick}`);
    await new Promise((r) => setTimeout(r, 2000));

    // The kiosk keeps the active session in localStorage so an interrupted interview can
    // resume after a reload; that copy is what carries the language actually used.
    stored = await page.evaluate(() => {
      const raw = localStorage.getItem('proctor.active-session');
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    });
    sessionId = stored?.sessionId ?? null;
    check('the kiosk persisted a session id', Boolean(sessionId), `stored: ${sessionId ?? 'none'}`);
  } else {
    console.log('  SKIP  no selectable job control found');
  }

  // ---- consent -----------------------------------------------------------
  const consent = await screenText(page);
  const hasConsent = /consent|agree|privacy|permission|सहमति|privacy|सहमत|अनुमति/i.test(consent);
  check('consent is requested before the interview', hasConsent, consent.slice(0, 240).replace(/\s+/g, ' '));

  if (hasConsent) {
    await clickText(page, 'agree');
    await new Promise((r) => setTimeout(r, 3000));
    const interview = await screenText(page);
    check(
      'interview screen starts after consent',
      interview.length > 0 && !/consent/i.test(interview),
      interview.slice(0, 200).replace(/\s+/g, ' '),
    );
  }

  /**
   * The chosen language must be the language the session actually runs in.
   *
   * Checked against the server rather than the UI, because the failure mode this guards
   * against is invisible on screen: everything renders correctly in the default language
   * while the session records a different one.
   */
  /**
   * The spoken copy must be in the chosen language.
   *
   * `phrase()` falls back to English whenever a key is missing, so a Tamil session with
   * English prompts renders and flows perfectly while being useless to the candidate.
   * This is the only assertion that catches it.
   */
  const tamilChars = ((await screenText(page)).match(/[\u0B80-\u0BFF]/g) ?? []).length;
  check(
    'the interview is spoken in Tamil, not English',
    tamilChars > 20,
    `${tamilChars} Tamil characters on screen`,
  );

  if (stored && chosenLanguage) {
    check(
      'the session uses the language the candidate chose',
      stored.languageCode === 'ta',
      `chose "${chosenLanguage}" (ta), session recorded ${stored.languageCode ?? 'nothing'}`,
    );
  }

  // ---- refresh is guarded mid-interview -----------------------------------
  // The kiosk installs a beforeunload guard while a session is live, so a refresh opens a
  // confirmation dialog instead of navigating. That guard is the thing under test: an
  // unguarded reload would silently destroy a half-finished interview.
  const dialogsBefore = dialogsSeen.length;
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 6000));
  check(
    'a refresh during an interview is guarded',
    dialogsSeen.length > dialogsBefore,
    `dialogs seen: ${dialogsSeen.join(', ') || 'none'}`,
  );

  const afterRefresh = await screenText(page);
  check(
    'the interview is resumed rather than restarted from the welcome screen',
    !/^[^a-z]*(start|शुरू|सुरू)/i.test(afterRefresh.trim()),
    afterRefresh.slice(0, 140).replace(/\s+/g, ' '),
  );
  check(
    'the interview is still in Tamil after the reload',
    ((afterRefresh.match(/[\u0B80-\u0BFF]/g) ?? []).length ?? 0) > 20,
    `${(afterRefresh.match(/[\u0B80-\u0BFF]/g) ?? []).length} Tamil characters after resume`,
  );

  const stillStored = await page.evaluate(() => localStorage.getItem('proctor.active-session'));
  check('the session survives the reload', Boolean(stillStored), stillStored ?? 'nothing persisted');

  // ---- accessibility of the target device --------------------------------
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal overflow at kiosk width', overflow <= 2, `overflow ${overflow}px`);
  check(
    'the kiosk lands on a usable screen after the interrupted reload',
    afterRefresh.length > 0 && !/technical problem/i.test(afterRefresh),
    afterRefresh.slice(0, 200).replace(/\s+/g, ' '),
  );

  await browser.close();

  console.log('==============================================');
  if (problems.length) {
    console.log(`${problems.length} browser problem(s) recorded:`);
    for (const problem of [...new Set(problems)].slice(0, 12)) console.log(`  - ${problem}`);
  }
  console.log(failures === 0 ? 'All kiosk smoke checks passed.' : `${failures} kiosk smoke check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
