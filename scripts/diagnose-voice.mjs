import puppeteer from 'puppeteer-core';

/**
 * Speech synthesis diagnostic.
 *
 * Reports what the browser will actually do, which is the only reliable way to tell
 * "the kiosk never asked for speech" from "the browser has no voice for this language".
 * Run against the kiosk origin so the CSP and the real voice list apply.
 *
 *   node scripts/diagnose-voice.mjs
 */

const URL = process.env.KIOSK_URL ?? 'http://localhost:5173';

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  protocolTimeout: 60000,
  args: [
    '--no-sandbox',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });

const report = await page.evaluate(async () => {
  const out = {
    hasSpeechSynthesis: 'speechSynthesis' in window,
    hasUtterance: typeof SpeechSynthesisUtterance !== 'undefined',
    voices: [],
    initialVoiceCount: 0,
    paused: null,
    tests: [],
  };

  if (!out.hasSpeechSynthesis) return out;

  // Chrome populates getVoices() asynchronously; give it the documented chance.
  let voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) {
    await new Promise((resolve) => {
      const done = () => resolve();
      window.speechSynthesis.addEventListener('voiceschanged', done, { once: true });
      setTimeout(done, 2000);
    });
    voices = window.speechSynthesis.getVoices();
  }

  out.initialVoiceCount = voices.length;
  out.paused = window.speechSynthesis.paused;
  out.voices = voices.map((v) => ({ name: v.name, lang: v.lang, local: v.localService, default: v.default }));

  /** Speaks one phrase and reports what actually happened to the utterance. */
  const speak = (text, lang) =>
    new Promise((resolve) => {
      const result = { lang, text, started: false, ended: false, error: null, elapsedMs: 0 };
      const startedAt = performance.now();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = 0.92;
      const finish = () => {
        if (result.ended || result.error) return;
        result.ended = true;
        result.elapsedMs = Math.round(performance.now() - startedAt);
        resolve(result);
      };
      u.onstart = () => {
        result.started = true;
      };
      u.onend = finish;
      u.onerror = (event) => {
        result.error = event.error ?? 'unknown';
        result.elapsedMs = Math.round(performance.now() - startedAt);
        resolve(result);
      };
      try {
        window.speechSynthesis.speak(u);
      } catch (err) {
        result.error = `threw: ${err.message}`;
        resolve(result);
        return;
      }
      // Watchdog: an utterance that neither starts nor errors would hang the kiosk queue
      // forever, which is indistinguishable from "no sound" to a candidate.
      setTimeout(() => {
        if (!result.started && !result.error && !result.ended) {
          result.error = 'no start event within 5s';
          result.elapsedMs = Math.round(performance.now() - startedAt);
          resolve(result);
        }
      }, 5000);
    });

  for (const lang of ['en-IN', 'en-US', 'hi-IN', 'mr-IN', 'ta-IN', 'ta']) {
    out.tests.push(await speak('வணக்கம், இது ஒரு சோதனை', lang));
  }

  return out;
});

console.log('SPEECH DIAGNOSTIC');
console.log('-----------------');
console.log('speechSynthesis present :', report.hasSpeechSynthesis);
console.log('SpeechSynthesisUtterance:', report.hasUtterance);
console.log('voices available        :', report.initialVoiceCount);
console.log('synth paused            :', report.paused);

if (report.voices.length) {
  const byLang = new Map();
  for (const v of report.voices) {
    const key = v.lang.toLowerCase();
    byLang.set(key, (byLang.get(key) ?? 0) + 1);
  }
  console.log('languages covered       :', [...byLang.entries()].map(([l, n]) => `${l}(${n})`).join(', '));
  const wanted = ['en-in', 'hi-in', 'mr-in', 'ta-in'];
  const missing = wanted.filter((l) => !byLang.has(l));
  console.log('missing for our locales :', missing.length ? missing.join(', ') : 'none');
  console.log('sample voices           :', report.voices.slice(0, 6).map((v) => `${v.name} [${v.lang}]`).join(' | '));
} else {
  console.log('voices                  : NONE — the platform has no speech voices installed');
}

console.log('');
console.log('utterance tests:');
for (const test of report.tests) {
  console.log(
    `  ${test.lang.padEnd(6)} started=${String(test.started).padEnd(5)} ended=${String(test.ended).padEnd(5)} ` +
      `error=${test.error ?? 'none'} ${test.elapsedMs}ms`,
  );
}

await browser.close();
