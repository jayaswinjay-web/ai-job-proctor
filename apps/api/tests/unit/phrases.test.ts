import { describe, expect, it } from 'vitest';
import { PHRASES, PHRASE_KEYS, PRIMARY_LANGUAGES, hasPhrase, phrase } from '@proctor/types';

/**
 * Phrase-table tests.
 *
 * These strings are the *only* thing a candidate who cannot read gets to hear. A missing
 * entry does not fail loudly at runtime — `phrase()` falls back to English — so a Tamil or
 * Marathi speaker would simply be addressed in a language they may not understand. The only
 * reliable defence is asserting full coverage.
 */

describe('phrase coverage', () => {
  for (const language of PRIMARY_LANGUAGES) {
    it(`${language} has a phrase for every key`, () => {
      const missing = PHRASE_KEYS.filter((key) => !PHRASES[language][key]);
      expect(missing).toEqual([]);
    });
  }

  it('has one phrase table per declared primary language', () => {
    // A language in PRIMARY_LANGUAGES without a table would fall back to English for the
    // whole interview; a table without a declared language is dead weight.
    expect(Object.keys(PHRASES).sort()).toEqual([...PRIMARY_LANGUAGES].sort());
    expect(PRIMARY_LANGUAGES).toContain('ta');
  });
});

describe('placeholder handling', () => {
  it('substitutes a variable', () => {
    expect(phrase('thanks_name', 'en', { name: 'Ravi' })).toContain('Ravi');
  });

  it('substitutes a language name', () => {
    expect(phrase('language_confirmed', 'ta', { language: 'தமிழ்' })).toContain('தமிழ்');
  });

  it('leaves an unrecognised placeholder visible rather than printing undefined', () => {
    // Printing the literal placeholder is recoverable; printing "undefined" aloud to a
    // candidate is not.
    expect(phrase('thanks_name', 'en')).toContain('{name}');
  });
});

describe('language fallback', () => {
  it('falls back to English for a language with no table', () => {
    expect(phrase('ask_name', 'xx')).toBe(PHRASES.en.ask_name);
  });

  it('reports whether a language has its own copy', () => {
    expect(hasPhrase('ta', 'ask_name')).toBe(true);
    expect(hasPhrase('xx', 'ask_name')).toBe(false);
  });
});

describe('copy is safe to speak aloud', () => {
  const banned = ['<', '>', '{', '}', 'undefined', 'null', '%s', '%d'];

  for (const language of PRIMARY_LANGUAGES) {
    it(`${language} contains no template or formatting leftovers`, () => {
      const offenders: string[] = [];
      for (const key of PHRASE_KEYS) {
        const value = PHRASES[language][key];
        if (!value) continue;
        // Braces are legitimate for {language}-style placeholders, so they are allowed here
        // and checked separately by the substitution tests.
        const withoutPlaceholders = value.replace(/\{[a-zA-Z_]+\}/g, '');
        for (const token of banned) {
          if (token === '{' || token === '}') continue;
          if (withoutPlaceholders.includes(token)) offenders.push(`${key}: ${token}`);
        }
      }
      expect(offenders).toEqual([]);
    });
  }

  it('keeps every phrase to a spoken sentence or two', () => {
    // Anything long enough to lose a low-literacy candidate mid-interview is a design bug,
    // so the length is asserted rather than left to review.
    const tooLong: string[] = [];
    for (const language of PRIMARY_LANGUAGES) {
      for (const key of PHRASE_KEYS) {
        const value = PHRASES[language][key]!;
        if (value.length > 220) tooLong.push(`${language}/${key} is ${value.length} characters`);
      }
    }
    expect(tooLong).toEqual([]);
  });
});
