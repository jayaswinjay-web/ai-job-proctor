import { describe, expect, it } from 'vitest';
import { detectVoiceCommand } from '@proctor/ai/browser';
import { LANGUAGE_NAMES, detectLanguage, detectScriptFamily, normaliseDigits } from '@proctor/ai/language';

/**
 * Tamil support tests.
 *
 * Tamil arrived after Hindi and Marathi, and every one of those places had a hard-coded
 * language list. These tests cover the places a candidate actually notices: the language
 * they are offered, the commands they can speak, and how their script is identified.
 */

const SUPPORTED = ['en', 'hi', 'mr', 'ta'];

describe('Tamil script detection', () => {
  it('identifies Tamil script before Latin', () => {
    // Tamil answers routinely contain ASCII digits and occasional English words; a Latin
    // check that ran first would misclassify the whole answer.
    expect(detectScriptFamily('நான் 3 ஆண்டுகள் பணியாறினேன்')).toBe('tamil');
    expect(detectScriptFamily('I worked as a delivery driver 2 years')).toBe('latin');
    expect(detectScriptFamily('मैंने कारखाने में काम किया')).toBe('devanagari');
  });

  it('still folds Devanagari and Tamil digits to ASCII', () => {
    expect(normaliseDigits('௫ ஆண்டுகள்')).toBe('5 ஆண்டுகள்');
    expect(normaliseDigits('५ साल')).toBe('5 साल');
  });
});

describe('Tamil language detection', () => {
  it('detects Tamil from the script even without a marker word', () => {
    const result = detectLanguage('இன்று காலை நான் வந்தேன்', { supported: SUPPORTED, fallback: 'en' });
    expect(result.language).toBe('ta');
    expect(result.confidence).toBeGreaterThan(0.6);
  });

  it('raises confidence when a Tamil marker is present', () => {
    const withMarker = detectLanguage('என் முந்தைய வேலை கடையில் இருந்தது', { supported: SUPPORTED, fallback: 'en' });
    expect(withMarker.language).toBe('ta');
    expect(withMarker.confidence).toBeGreaterThan(0.8);
  });

  it('trusts the language the recogniser declared', () => {
    const result = detectLanguage('நான் தமிழில் பதிலளிப்பேன்', {
      supported: SUPPORTED,
      fallback: 'en',
      declared: 'ta',
    });
    expect(result.language).toBe('ta');
  });

  it('does not report Tamil when it is not an enabled language', () => {
    // A site that has not enabled Tamil must not have its candidates answered in Tamil.
    const result = detectLanguage('நான் தமிழில் பதிலளிப்பேன்', { supported: ['en', 'hi', 'mr'], fallback: 'en' });
    expect(result.language).toBe('en');
  });

  it('leaves the Hindi and Marathi distinction intact', () => {
    expect(detectLanguage('मैं कारखाने में काम करता हूँ', { supported: SUPPORTED, fallback: 'en' }).language).toBe('hi');
    expect(detectLanguage('मी कारखान्यात काम केले', { supported: SUPPORTED, fallback: 'en' }).language).toBe('mr');
  });
});

describe('Tamil voice commands', () => {
  /** Every command a candidate can rely on without reading the screen. */
  const cases: Array<[string, string]> = [
    ['REPEAT', 'மீண்டும்'],
    ['REPEAT', 'தயவுசெய்து மீண்டும்'],
    ['REPEAT', 'மீண்டும் கேளுங்கவும்'],
    ['SPEAK_SLOWLY', 'மெதுவாக'],
    ['SPEAK_SLOWLY', 'மெதுவாக பேசுங்கள்'],
    ['DONT_UNDERSTAND', 'எனக்கு புரியவில்லை'],
    ['DONT_UNDERSTAND', 'என்ன'],
    ['NEXT', 'அடுத்து'],
    ['GO_BACK', 'பின்னால்'],
    ['DONT_KNOW', 'தெரியாது'],
    ['STOP', 'நிறுத்து'],
    ['START_AGAIN', 'மீண்டும் தொடங்கு'],
    ['HELP', 'உதவி'],
  ];

  for (const [expected, phrase] of cases) {
    it(`recognises "${phrase}" as ${expected}`, () => {
      const detection = detectVoiceCommand(phrase, 'ta');
      expect(detection.command).toBe(expected);
    });
  }

  it('does not fire a command on an ordinary Tamil answer', () => {
    // The dangerous failure is a false positive ending the interview or skipping a
    // question, so ordinary speech must produce nothing.
    for (const phrase of [
      'நான் மூன்று ஆண்டுகள் கடையில் பணியாறினேன்',
      'காலையில் ஆறு மணிக்கு எழுந்திருப்பேன்',
      'இயந்திரத்தை நான் சரியாக இயக்க முடியும்',
    ]) {
      expect(detectVoiceCommand(phrase, 'ta').command).toBeNull();
    }
  });

  it('keeps a command out of the middle of an answer', () => {
    // "repeat" mid-sentence is a loose command; the answer after it must survive.
    const detection = detectVoiceCommand('மீண்டும், நான் தொழிற்சாலையில் மூன்று ஆண்டுகள் பணியாறினேன்', 'ta');
    expect(detection.command).toBe('REPEAT');
    expect(detection.remainder.length).toBeGreaterThan(0);
  });

  it('still detects English and Hindi commands', () => {
    expect(detectVoiceCommand('repeat that', 'en').command).toBe('REPEAT');
    expect(detectVoiceCommand('दोहराइए', 'hi').command).toBe('REPEAT');
  });
});

describe('language presentation', () => {
  it('offers Tamil a native name and a spoken sample', () => {
    const tamil = LANGUAGE_NAMES.ta;
    expect(tamil).toBeDefined();
    expect(tamil.native).toBe('தமிழ்');
    // The sample is what the kiosk speaks aloud when asking which language to use.
    expect(tamil.sample.length).toBeGreaterThan(0);
  });
});
