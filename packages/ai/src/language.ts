/**
 * Deterministic language utilities.
 *
 * Used by the demo/mock engine and by the kiosk as a fast local pre-check before
 * a server round-trip. Detection is script-and-marker based, never acoustic, and
 * never used for anything except choosing which language to speak and to write in.
 */

/**
 * Folds non-ASCII digits to ASCII.
 *
 * The offsets differ per script: Devanagari starts at U+0966, Arabic-Indic at U+0660,
 * and Tamil at U+0BE6. Tamil's block is adjacent to Telugu's (U+0C66), which is a trap —
 * using the Telugu offset silently fails to fold Tamil digits at all.
 */
export function normaliseDigits(input: string): string {
  return input
    .replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[௦-௯]/g, (d) => String(d.charCodeAt(0) - 0x0be6));
}

export type ScriptFamily = 'devanagari' | 'tamil' | 'latin' | 'arabic' | 'unknown';

export function detectScriptFamily(text: string): ScriptFamily {
  // Tamil is checked before Latin because Tamil text often contains ASCII digits and
  // stray Latin words, and a Latin match would otherwise win on the wrong character.
  if (/[\u0B80-\u0BFF]/.test(text)) return 'tamil';
  if (/[\u0900-\u097F]/.test(text)) return 'devanagari';
  if (/[\u0600-\u06FF]/.test(text)) return 'arabic';
  if (/[A-Za-z]/.test(text)) return 'latin';
  return 'unknown';
}

const MARATHI_MARKERS = [
  'आहे', 'आहेत', 'मी', 'तुम्ही', 'काय', 'कुछ', 'नाही', 'मला', 'तुमचे', 'सांगा', 'सांग',
  'काम', 'नोकरी', 'मित्र', 'पण', 'सुद्धा', 'जास्त', 'थोडं', 'आता', 'नंतर', 'पहिल्यांदा',
];
const HINDI_MARKERS = [
  'है', 'हैं', 'मैं', 'आप', 'क्या', 'क्यों', 'कृपया', 'नहीं', 'नही', 'मुझे', 'आपका',
  'आपकी', 'और', 'लिए', 'साथ', 'बहुत', 'अब', 'बाद', 'पहले', 'काम', 'नौकरी',
];

/**
 * Tamil markers.
 *
 * Mostly function words and the agglutinating endings that make Tamil text long, since a
 * bare vowel check would match every Tamil sentence. `ம்`, `ேன்` and `து` are common
 * endings rather than words, which is what makes them useful here.
 */
const TAMIL_MARKERS = [
  'என்', 'எனது', 'நான்', 'நாம்', 'நீ', 'நீங்கள்', 'ஆம்', 'அவர்', 'அவள்', 'அவர்கள்',
  'என்ன', 'ஏன்', 'எப்படி', 'எங்கே', 'எப்போது', 'ஆம்', 'இல்லை', 'உள்ளது', 'இருந்தது',
  'செய்த', 'செய்ய', 'பணி', 'வேலை', 'தமிழ்', 'நன்றி', 'மிகு', 'பிறகு', 'இப்போது',
];

export interface LanguageDetection {
  language: string;
  confidence: number;
  script: ScriptFamily;
  method: 'marker' | 'script' | 'fallback';
}

/**
 * Best-effort detection for transcripts. When the recogniser already supplied a
 * language code, that value wins.
 */
export function detectLanguage(
  text: string,
  options: { supported: string[]; fallback: string; declared?: string | null },
): LanguageDetection {
  const declared = options.declared && options.supported.includes(options.declared) ? options.declared : null;
  const script = detectScriptFamily(text);
  if (!text.trim()) {
    return { language: declared ?? options.fallback, confidence: declared ? 0.9 : 0.2, script, method: 'fallback' };
  }
  if (declared && declared !== 'en') {
    return { language: declared, confidence: 0.95, script, method: 'marker' };
  }

  if (script === 'tamil') {
    const markers = TAMIL_MARKERS.filter((m) => text.includes(m)).length;
    // Tamil is a separate script, so script alone is strong evidence. Markers only refine
    // the confidence; they can never override the declared language.
    if (declared) return { language: declared, confidence: 0.95, script, method: 'marker' };
    if (!options.supported.includes('ta')) {
      return { language: options.fallback, confidence: 0.4, script, method: 'fallback' };
    }
    return {
      language: 'ta',
      confidence: markers > 0 ? 0.85 : 0.7,
      script,
      method: markers > 0 ? 'marker' : 'script',
    };
  }

  if (script === 'devanagari') {
    const lower = text;
    const mr = MARATHI_MARKERS.filter((m) => lower.includes(m)).length;
    const hi = HINDI_MARKERS.filter((m) => lower.includes(m)).length;
    const total = mr + hi;
    if (total > 0) {
      const language = mr > hi ? 'mr' : 'hi';
      if (!options.supported.includes(language)) {
        return { language: options.fallback, confidence: 0.4, script, method: 'fallback' };
      }
      const confidence = Math.min(0.9, 0.5 + Math.abs(mr - hi) / (total * 2) + 0.1);
      return { language, confidence, script, method: 'marker' };
    }
    // Devanagari with no decisive marker: prefer the declared language, else English.
    const fallbackDevanagari = options.supported.find((l) => l === 'hi' || l === 'mr') ?? options.fallback;
    return { language: fallbackDevanagari, confidence: 0.35, script, method: 'script' };
  }

  if (script === 'latin') {
    return {
      language: declared ?? options.fallback,
      confidence: declared ? 0.85 : 0.5,
      script,
      method: 'fallback',
    };
  }
  return { language: options.fallback, confidence: 0.2, script, method: 'fallback' };
}

/** Spoken-language phrases used to ask "which language do you want?" candidates to reply. */
export const LANGUAGE_NAMES: Record<string, { name: string; native: string; sample: string }> = {
  en: { name: 'English', native: 'English', sample: 'English' },
  hi: { name: 'Hindi', native: 'हिन्दी', sample: 'हिंदी' },
  mr: { name: 'Marathi', native: 'मराठी', sample: 'मराठी' },
  ta: { name: 'Tamil', native: 'தமிழ்', sample: 'தமிழ்' },
};
