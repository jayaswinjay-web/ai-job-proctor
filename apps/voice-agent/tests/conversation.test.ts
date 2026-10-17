import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_STATES,
  copy,
  formatList,
  isAffirmative,
  isNegative,
  isOptionsRequest,
  isRepeatRequest,
  jobsAnnouncement,
  languagesAnnouncement,
  matchOption,
  PHRASES,
} from '../src/conversation.js';

describe('conversation states', () => {
  it('covers every state in the specification', () => {
    // Spec §5 lists the states the agent must handle. If this list drifts, the agent is
    // missing a step in the candidate journey.
    for (const state of [
      'WELCOME',
      'JOB_SELECTION',
      'JOB_CONFIRMATION',
      'LANGUAGE_SELECTION',
      'LANGUAGE_CONFIRMATION',
      'SPEAKER_TEST',
      'MIC_TEST',
      'CANDIDATE_ONBOARDING',
      'CONSENT',
      'INTERVIEW_READY',
      'QUESTION',
      'LISTENING',
      'EVALUATION',
      'FOLLOW_UP',
      'NEXT_QUESTION',
      'INTERVIEW_COMPLETE',
      'ERROR_RECOVERY',
    ]) {
      expect(CONVERSATION_STATES).toContain(state);
    }
  });
});

describe('Tamil-first copy', () => {
  it('greets in Tamil by default and falls back to Tamil then English', () => {
    expect(copy(PHRASES.GREETING, 'ta')).toMatch(/வணக்கம்/);
    expect(copy(PHRASES.GREETING, 'en')).toMatch(/Welcome/);
    // An unmapped language must still yield spoken text, never undefined.
    expect(copy(PHRASES.GREETING, 'zz').length).toBeGreaterThan(0);
  });

  it('every phase has Tamil copy (Tamil is the primary experience)', () => {
    const phases = [PHRASES.JOB_PROMPT, PHRASES.LANGUAGE_PROMPT, PHRASES.SPEAKER_TEST, PHRASES.MIC_TEST, PHRASES.CONSENT];
    for (const phase of phases) {
      // Tamil script present in the ta entry.
      expect(phase.ta).toMatch(/[\u0B80-\u0BFF]/);
    }
  });

  it('never leaves a placeholder in spoken Tamil', () => {
    const rendered = [
      jobsAnnouncement(['Factory Worker', 'Security Guard'], 'ta'),
      languagesAnnouncement(['தமிழ்', 'English'], 'ta'),
      copy(PHRASES.JOB_CONFIRM, 'ta').replace('{job}', 'Factory Worker'),
      copy(PHRASES.LANGUAGE_CONFIRM, 'ta').replace('{language}', 'தமிழ்'),
    ];
    for (const line of rendered) {
      expect(line).not.toMatch(/\{(list|job|language)\}/);
    }
  });
});

describe('job and language announcements', () => {
  it('speaks every job (spec §7)', () => {
    const line = jobsAnnouncement(['Factory Worker', 'Security Guard', 'Sales Assistant', 'Delivery Worker'], 'ta');
    for (const title of ['Factory Worker', 'Security Guard', 'Sales Assistant', 'Delivery Worker']) {
      expect(line).toContain(title);
    }
  });

  it('speaks every language (spec §8)', () => {
    const line = languagesAnnouncement(['தமிழ்', 'English', 'Hindi', 'Marathi'], 'ta');
    for (const name of ['தமிழ்', 'English', 'Hindi', 'Marathi']) {
      expect(line).toContain(name);
    }
  });

  it('formats a single item without a dangling conjunction', () => {
    expect(formatList(['Factory Worker'], 'ta')).toBe('Factory Worker');
  });

  it('uses the Tamil conjunction between many items', () => {
    expect(formatList(['a', 'b', 'c'], 'ta')).toContain('மற்றும்');
  });
});

describe('repeat handling (spec §9)', () => {
  it('recognises repeat requests in every supported language', () => {
    for (const phrase of [
      'repeat',
      'Please repeat that',
      'say that again',
      'மீண்டும்',
      'மீண்டும் சொல்லுங்கள்',
      'என்ன சொன்னீர்கள்?',
      'I did not understand',
    ]) {
      expect(isRepeatRequest(phrase)).toBe(true);
    }
  });

  it('does not treat an ordinary answer as a repeat request', () => {
    expect(isRepeatRequest('I have two years of experience')).toBe(false);
  });

  it('recognises a request for the options', () => {
    expect(isOptionsRequest('what are the options')).toBe(true);
    expect(isOptionsRequest('என்னென்ன மொழி இருக்கு')).toBe(true);
  });
});

describe('intent matching (spec §19, §20)', () => {
  const jobs = [
    { title: 'Factory Worker' },
    { title: 'Security Guard' },
    { title: 'Delivery Worker' },
  ];

  it('understands a partial job name', () => {
    expect(matchOption('I want the factory job', jobs)?.title).toBe('Factory Worker');
  });

  it('understands code-switched speech', () => {
    expect(matchOption('Factory வேலை', jobs)?.title).toBe('Factory Worker');
    expect(matchOption('security please', jobs)?.title).toBe('Security Guard');
  });

  it('understands a job named in Tamil or Hindi', () => {
    expect(matchOption('எனக்கு தொழிற்சாலை வேலை வேண்டும்', jobs)?.title).toBe('Factory Worker');
    expect(matchOption('நான் காவலாளியாக வேலை செய்ய விரும்புகிறேன்', jobs)?.title).toBe('Security Guard');
    expect(matchOption('मुझे चौकीदार की नौकरी चाहिए', jobs)?.title).toBe('Security Guard');
  });

  it('understands a job named in romanised/transliterated form', () => {
    expect(matchOption('factory worker', jobs)?.title).toBe('Factory Worker');
    expect(matchOption('delivery', jobs)?.title).toBe('Delivery Worker');
  });

  it('selects an option by spoken ordinal', () => {
    expect(matchOption('one', jobs)?.title).toBe('Factory Worker');
    expect(matchOption('second', jobs)?.title).toBe('Security Guard');
    expect(matchOption('மூன்று', jobs)?.title).toBe('Delivery Worker');
  });

  it('returns null when nothing matches', () => {
    expect(matchOption('completely unrelated words here', jobs)).toBeNull();
  });

  it('matches language by native name (spec §6, §8)', () => {
    const languages = [
      { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்' },
      { code: 'en', name: 'English', nativeName: 'English' },
      { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
    ];
    expect(matchOption('எனக்கு தமிழ் வேண்டும்', languages)?.code).toBe('ta');
    expect(matchOption('தமிழ்ல பேசுங்க', languages)?.code).toBe('ta');
  });

  it('matches a language spoken in Tamil but transcribed in Latin script', () => {
    const languages = [
      { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்' },
      { code: 'en', name: 'English', nativeName: 'English' },
      { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
      { code: 'mr', name: 'Marathi', nativeName: 'मराठी' },
    ];
    for (const phrase of ['tamil', 'tamizh', 'thamizh', 'Tamiḻ', 'tamil please']) {
      expect(matchOption(phrase, languages)?.code).toBe('ta');
    }
    expect(matchOption('marati', languages)?.code).toBe('mr');
    expect(matchOption('हिंदी', languages)?.code).toBe('hi');
  });

  it('recognises affirmation and denial across languages', () => {
    expect(isAffirmative('ஆம்')).toBe(true);
    expect(isAffirmative('yes')).toBe(true);
    expect(isNegative('இல்லை')).toBe(true);
    expect(isNegative('no')).toBe(true);
  });

  it('recognises romanised ("Tanglish"/"Hinglish") affirmation and denial', () => {
    // The multilingual recogniser returns spoken Tamil/Hindi in Latin script, so a spoken
    // "சரி" arrives as "seri" — matching only the native script broke the confirmation step.
    for (const phrase of ['seri', 'sari', 'saree', 'aama', 'aamaa', 'ok', 'okay', 'haan', 'theek hai']) {
      expect(isAffirmative(phrase)).toBe(true);
    }
    for (const phrase of ['illa', 'illai', 'vendam', 'vendaam', 'nahi', 'galat']) {
      expect(isNegative(phrase)).toBe(true);
    }
    // Speechmatics' `en_ta` pack renders a lone spoken "சரி" as an English homophone; the
    // confirmation step must still advance instead of re-asking forever.
    for (const phrase of ['Siri.', 'SCRI.', 'siri', 'sree', 'srii']) {
      expect(isAffirmative(phrase)).toBe(true);
    }
  });

  it('recognises agree/consent phrasing but not the refusal', () => {
    for (const phrase of ['சம்மதிக்கிறேன்', 'நான் சம்மதிக்கிறேன்.', 'ஒப்புக்கொள்கிறேன்', 'I agree', 'agree', 'consent']) {
      expect(isAffirmative(phrase)).toBe(true);
    }
    // "I do NOT agree" must never be read as agreement (the affirmative pattern must not match
    // the bare stem "சம்மத").
    expect(isAffirmative('சம்மதிக்கவில்லை')).toBe(false);
    expect(isNegative('சம்மதிக்கவில்லை')).toBe(true);
    expect(isNegative('I do not agree')).toBe(true);
    // An ordinary answer must not be mistaken for a confirmation.
    expect(isAffirmative('I have two years of experience')).toBe(false);
    expect(isNegative('I have two years of experience')).toBe(false);
  });
});