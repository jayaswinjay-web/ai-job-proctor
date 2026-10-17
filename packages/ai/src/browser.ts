/**
 * Browser-safe surface of `@proctor/ai`.
 *
 * The full package reaches into `node:crypto` (for the untrusted-block nonce), which
 * must never enter a kiosk bundle. The browser only needs language normalisation and
 * voice-command detection, both of which are pure string functions, so they are exposed
 * here and re-exported from the main entry point for the server.
 *
 * If you add an export to this file, confirm it has no Node dependency — the kiosk build
 * fails loudly if it does, which is exactly the intended behaviour.
 */
export { normaliseDigits, detectScriptFamily, detectLanguage, LANGUAGE_NAMES } from './language.js';
export type { ScriptFamily, LanguageDetection } from './language.js';
export { detectVoiceCommand } from './voice-commands.js';
export type { CommandDetection } from './voice-commands.js';
