import { normaliseDigits } from './language.js';
import { VOICE_COMMAND_SPECS, type VoiceCommand } from '@proctor/types';

/**
 * Voice-command detection.
 *
 * Browser-safe on purpose: the kiosk runs this locally, on every interim result, so a
 * candidate who says "repeat" gets an instant reaction rather than waiting for a server
 * round-trip. The command is *also* forwarded to the server as an ordinary turn, so the
 * engine remains the single authority on what happens next.
 *
 * Kept free of Node imports so it can live in both the kiosk bundle and the API.
 */

export interface CommandDetection {
  command: VoiceCommand | null;
  /** Transcript remainder after the command phrase, if any. */
  remainder: string;
  matched: boolean;
}

/**
 * Detects a voice command in a transcript.
 *
 * Strict commands (Stop, Go back, Help, Start again) require a near-exact match, which
 * stops "I want to stop working here" from ending an interview. Loose commands (Repeat,
 * Next, I don't know) also fire as a leading phrase, so "repeat, I worked in a factory
 * for three years" is handled as a repeat *and* keeps the answer.
 */
export function detectVoiceCommand(transcript: string, language: string): CommandDetection {
  const text = normaliseDigits(transcript).trim();
  if (!text) return { command: null, remainder: '', matched: false };

  for (const spec of VOICE_COMMAND_SPECS) {
    const patterns = spec.patterns[language] ?? spec.patterns.en ?? [];
    for (const pattern of patterns) {
      let re: RegExp;
      try {
        re = new RegExp(pattern, spec.strictMatch ? 'iu' : 'iu');
      } catch {
        // A malformed pattern must never take the microphone down.
        continue;
      }
      const match = text.match(re);
      if (!match) continue;
      const index = match.index ?? 0;
      const remainder = `${text.slice(0, index)} ${text.slice(index + match[0].length)}`.replace(/\s+/g, ' ').trim();
      return { command: spec.command, remainder: remainder || text, matched: true };
    }
  }
  return { command: null, remainder: text, matched: false };
}
