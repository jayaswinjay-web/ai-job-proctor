/**
 * Interview conversation state machine (Tamil-first).
 *
 * This module is intentionally free of any LiveKit SDK import so the conversation logic
 * can be unit-tested and reasoned about on its own. It owns *what to say and what to ask
 * next*; the transport (LiveKit), the speech engines (Google STT/TTS) and the model
 * (OpenAI) are wired in `index.ts`, and the interview facts (jobs, questions, scoring)
 * come from the VoiceHire backend.
 */

export const CONVERSATION_STATES = [
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
] as const;

export type ConversationState = (typeof CONVERSATION_STATES)[number];

/** Tamil is the primary language; English is the fallback for the agent's own copy. */
const GREETING: Record<string, string> = {
  ta: 'வணக்கம்! ராஜபாளையம் மில்ஸ் (ராம்கோ குழுமம்) நேர்காணலுக்கு வரவேற்கிறோம். நான் உங்கள் நேர்காணலை குரல் மூலம் நடத்துவேன். திரையைத் தொட வேண்டிய அவசியம் இல்லை.',
  en: 'Welcome to Rajapalayam Mills (Ramco Group). I will conduct your interview by voice. There is no need to touch the screen.',
};

const JOB_PROMPT: Record<string, string> = {
  ta: 'தற்போது கிடைக்கும் வேலை வாய்ப்புகள்: {list}. நீங்கள் விண்ணப்பிக்க விரும்பும் வேலை பெயரைச் சொல்லுங்கள்.',
  en: 'The jobs available right now are: {list}. Please say the name of the job you want to apply for.',
};

const JOB_CONFIRM: Record<string, string> = {
  ta: 'நீங்கள் {job} வேலைக்கு விண்ணப்பிக்கிறீர்கள். சரியா?',
  en: 'You are applying for {job}. Is that correct?',
};

const LANGUAGE_PROMPT: Record<string, string> = {
  ta: 'உங்கள் நேர்காணல் மொழியைத் தேர்ந்தெடுக்கவும். கிடைக்கும் மொழிகள்: {list}. நீங்கள் விரும்பும் மொழியின் பெயரைச் சொல்லுங்கள்.',
  en: 'Choose the language for your interview. The available languages are: {list}. Please say the language you would like.',
};

const LANGUAGE_CONFIRM: Record<string, string> = {
  ta: 'நேர்காணல் {language} மொழியில் நடைபெறும். சரியா?',
  en: 'The interview will be in {language}. Is that correct?',
};

const SPEAKER_TEST: Record<string, string> = {
  ta: 'இப்போது ஸ்பீக்கர் சோதனை செய்யலாம். நான் சொல்வது தெளிவாகக் கேட்கிறதா? ஆம் என்று சொல்லுங்கள்.',
  en: 'Now let us test the speaker. Can you hear me clearly? Please say yes.',
};

const MIC_TEST: Record<string, string> = {
  ta: 'இப்போது மைக்ரோஃபோன் சோதனை. உங்கள் பெயரைச் சொல்லுங்கள்.',
  en: 'Now the microphone test. Please say your name.',
};

const CONSENT: Record<string, string> = {
  ta: 'உங்கள் நேர்காணல் குரல் மூலம் நடைபெறும். உங்கள் பதில்கள் நேர்காணல் மதிப்பீட்டிற்காக பதிவு செய்யப்பட்டு சேமிக்கப்படும். நேர்காணலைத் தொடங்க நீங்கள் சம்மதிக்கிறீர்களா?',
  en: 'Your interview is conducted by voice. Your answers will be recorded and stored for interview evaluation. Do you agree to continue?',
};

const READY: Record<string, string> = {
  ta: 'நன்றி. நேர்காணலைத் தொடங்குகிறோம்.',
  en: 'Thank you. We will begin the interview.',
};

const REPEAT_ACK: Record<string, string> = {
  ta: 'சரி, மீண்டும் சொல்கிறேன்.',
  en: 'Of course, I will say it again.',
};

const NOT_UNDERSTOOD: Record<string, string> = {
  ta: 'மன்னிக்கவும், எனக்கு புரியவில்லை. மீண்டும் சொல்லுங்கள்.',
  en: 'Sorry, I did not understand. Please say that again.',
};

export function copy(map: Record<string, string>, language: string): string {
  return map[language] ?? map.ta ?? map.en ?? '';
}

export function formatList(names: string[], language: string): string {
  const cleaned = names.filter(Boolean);
  if (cleaned.length === 0) return '';
  if (cleaned.length === 1) return cleaned[0]!;
  const conjunction = language === 'en' ? ' and ' : ' மற்றும் ';
  return `${cleaned.slice(0, -1).join(', ')}${conjunction}${cleaned[cleaned.length - 1]}`;
}

/** Phrases that mean "say that again", across the supported languages and mixed speech. */
const REPEAT_PATTERNS = [
  /\brepeat\b/i,
  /say (that|it) again/i,
  /come again/i,
  // Recognisers emit both the contracted and expanded forms ("didn't" / "did not").
  /did(n[’']t| not) (understand|catch|hear)/i,
  /what (are the )?(options|choices)/i,
  /மீண்டும்/,
  /என்ன சொன்னீர்கள்/,
  /पुनः|दोबारा|फिर से/i,
  /पुन्हा|परत/i,
];

export function isRepeatRequest(utterance: string): boolean {
  return REPEAT_PATTERNS.some((re) => re.test(utterance));
}

/** Asks specifically for the list of options rather than a literal repeat. */
export function isOptionsRequest(utterance: string): boolean {
  return /(options|choices|list|என்னென்ன|என்ன வழிகள்|விருப்பங்கள்)/i.test(utterance);
}

/**
 * Affirmative / negative detection across the three scripts plus romanised ("Tanglish"/"Hinglish")
 * output — which is what the multilingual recogniser usually returns for spoken Tamil and Hindi
 * ("seri", "aama", "illa", "haan", "nahi"). Matching only the native script meant a spoken "சரி"
 * transcribed as "seri" fell through, so the agent kept re-asking instead of moving on.
 */
const AFFIRMATIVE = [
  /^\s*(yes|yeah|yep|yup|correct|right|ok|okay|sure|fine|good)\b/i,
  /\b(that'?s right|thats right|very good)\b/i,
  // Agree/consent phrasings — the candidate answers the consent question with "I agree"
  // ("சம்மதிக்கிறேன்", "ஒப்புக்கொள்கிறேன்"), not a bare "yes", so match those directly. Kept
  // explicit (no bare "சம்மத"/"sammath") so the negative "சம்மதிக்கவில்லை" cannot be read as yes.
  /\b(i agree|agree|agreed|i accept|accept|consent|i consent|continue|proceed|go ahead)\b/i,
  /\b(sammathikir\w*|sammathikkir\w*|oththukol\w*|oppukol\w*|thodaral\w*|thodangal\w*)\b/i,
  // Tamil, script + romanised: ஆம் / சரி / ஆமா and aama, aamaa, aamam, seri, sari, saree…
  // Speechmatics' `en_ta` pack is English-biased for a lone Tamil word and usually renders a
  // spoken "சரி" as an English homophone ("Siri", "SCRI", "sari") — those mis-hearings count too,
  // otherwise CONFIRM_JOB never advances and the agent re-asks the question forever.
  /ஆம்|ஆமாம்|ஆமா|சரி|சரிதான்|ஓகே|சம்மதிக்கிறேன்|சம்மதிக்கிறார்|சம்மதம்|ஏற்றுக்கொள்கிறேன்|ஒப்புக்கொள்கிறேன்|ஒத்துக்கொள்கிறேன்|தொடரலாம்|தொடங்கலாம்|தொடர்கிறேன்|ஆமோதி/,
  /\b(aama|aamaa|aamam|aam|seri|sari|saree|sare|sheri|shari|sree|srii|siri|scri|seari|sarry)\b/i,
  // Hindi, script + romanised: हाँ / ठीक / जी and haan, theek, thik, acha…
  /हाँ|हां|ठीक|जी|अच्छा/,
  /\b(haan|han|haa|theek|thik|teek|ji|jii|acha|achha)\b/i,
  // Marathi: हो / बरं / बरोबर and ho, hoy, bar, barobar…
  /हो|बरं|बरोबर/,
  /\b(hoy|bar|barobar)\b/i,
];

const NEGATIVE = [
  /^\s*(no|nope|wrong|incorrect)\b/i,
  /\b(i (do not|don't) agree|not agree|disagree|decline|refuse|reject)\b/i,
  /\b(sammathikal\w*|sammathikkal\w*|oppukkal\w*)\b/i,
  // Tamil, script + romanised: இல்லை / வேண்டாம் and illa, illai, vendam…
  /இல்லை|இல்ல|வேண்டாம்|வேணாம்|வேண்டா|முடியாது|இயலாது|சம்மதிக்கவில்லை|ஒப்புக்கொள்ளவில்லை/,
  /\b(illa|illai|ille|ila|illanga|vendam|vendaam|venda)\b/i,
  // Hindi, script + romanised: नहीं / गलत and nahi, nahin, galat…
  /नहीं|नही|गलत|मत/,
  /\b(nahi|nahin|nhi|galat|galath)\b/i,
];

export function isAffirmative(utterance: string): boolean {
  return AFFIRMATIVE.some((re) => re.test(utterance));
}

export function isNegative(utterance: string): boolean {
  return NEGATIVE.some((re) => re.test(utterance));
}

/**
 * Romanised spellings the recogniser may produce for each language, keyed by ISO code. The
 * model hears the spoken native name ("தமிழ்") but often renders it in Latin letters
 * ("tamizh", "thamizh"), and may use a Devanagari variant for Hindi — none of which the plain
 * `name`/`nativeName` comparison would catch, so the agent kept re-reading the list.
 */
const LANGUAGE_ALIASES: Record<string, string[]> = {
  en: ['english', 'inglish', 'angrezi', 'anglam', 'aangilam'],
  hi: ['hindi', 'hindhi', 'हिन्दी', 'हिंदी'],
  mr: ['marathi', 'marati', 'maratthi', 'मराठी'],
  ta: ['tamil', 'tamizh', 'thamizh', 'tamiz', 'thamiz', 'tamilar', 'tamiḻ', 'தமிழ்'],
};

/**
 * Synonyms for the words that appear in job titles, in the languages a candidate may speak.
 * The job list is rendered from English titles ("Factory Worker") but the recogniser returns
 * what the candidate actually said — often the Tamil or Hindi word ("தொழிற்சாலை", "चौकीदार")
 * or a romanised/transliterated form ("factory", "gaar"). Matching only the English title meant
 * "I want factory worker" fell through to "புரியவில்லை". Keyed by a lower-case English keyword
 * found in the title; values are additional needles to match against.
 */
const OPTION_SYNONYMS: Record<string, string[]> = {
  factory: ['factory', 'தொழிற்சாலை', 'தொழிற்சாலை', 'கார்ச்சாலை', 'பாக்டரி', 'ஃபாக்டரி', 'कारखाना', 'फैक्ट्री', 'कामगार'],
  worker: ['worker', 'தொழிலாளி', 'கூலி', 'कामगार', 'वर्कर', 'मजदूर', 'मज़दूर'],
  delivery: ['delivery', 'டெலிவரி', 'விநியோகம்', 'பார்சல்', 'डिलीवरी', 'पार्सल', 'वितरण'],
  security: ['security', 'காவல்', 'காவலர்', 'காவலாளி', 'சிச்சுவரிட்டி', 'செக்யூரிட்டி', 'सिक्योरिटी', 'चौकीदार', 'गार्ड'],
  guard: ['guard', 'காவலர்', 'காவலாளி', 'சிச்சுவரிட்டி', 'காவல்', 'गार्ड', 'चौकीदार', 'पहरेदार'],
  sales: ['sales', 'விற்பனை', 'விற்பனையாளர்', 'सेल्स', 'बिक्री'],
  assistant: ['assistant', 'உதவியாளர்', 'सहायक', 'असिस्टेंट'],
  driver: ['driver', 'ஓட்டுநர்', 'டிரைவர்', 'चालक', 'ड्राइवर'],
  cleaner: ['cleaner', 'சுத்தம்', 'क्लीनर', 'सफाई'],
  cook: ['cook', 'சமையல்', 'कुक', 'रसोइया'],
  helper: ['helper', 'உதவியாளர்', 'हेल्पर', 'मददगार'],
  packing: ['packing', 'பேக்கிங்', 'पैकिंग'],
  machine: ['machine', 'இயந்திரம்', 'मशीन'],
};

/** Spoken ordinals/cardinals used to pick an option by position ("one", "first", "ஒன்று"). */
const ORDINALS: Record<string, number> = {
  '1': 1, one: 1, first: 1, 'ஒன்று': 1, 'முதல்': 1, 'एक': 1, 'पहला': 1,
  '2': 2, two: 2, second: 2, 'இரண்டு': 2, 'இரண்டாவது': 2, 'दो': 2, 'दूसरा': 2,
  '3': 3, three: 3, third: 3, 'மூன்று': 3, 'மூன்றாவது': 3, 'तीन': 3, 'तीसरा': 3,
  '4': 4, four: 4, fourth: 4, 'நான்கு': 4, 'चार': 4, 'चौथा': 4,
  '5': 5, five: 5, fifth: 5, 'ஐந்து': 5, 'पांच': 5, 'पाँच': 5,
};

/** Lower-case, strip Latin diacritics and punctuation so "Tamiḻ," and "tamizh" compare equal. */
function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.,!?;:।॥]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Loose, accent- and code-switching-tolerant match of an utterance to one of the options. */
export function matchOption<
  T extends { title?: string; name?: string; nativeName?: string | null; code?: string },
>(utterance: string, options: T[]): T | null {
  const text = normalize(utterance);

  // A bare ordinal ("one", "first", "ஒன்று") picks by position in the list as read aloud.
  const ordinal = ORDINALS[text];
  if (ordinal && ordinal <= options.length) return options[ordinal - 1]!;

  let best: { option: T; score: number } | null = null;
  for (const option of options) {
    const base = [
      option.title,
      option.name,
      option.nativeName,
      ...(option.code ? (LANGUAGE_ALIASES[option.code] ?? []) : []),
    ].filter(Boolean) as string[];

    // Expand each English keyword in the title with its spoken-language synonyms.
    const candidates = [...base];
    for (const value of base) {
      for (const word of normalize(value).split(/\s+/)) {
        for (const syn of OPTION_SYNONYMS[word] ?? []) candidates.push(syn);
      }
    }

    for (const candidate of candidates) {
      const needle = normalize(candidate);
      if (!needle) continue;
      const score = text.includes(needle)
        ? needle.length
        : needle.split(/\s+/).some((w) => w.length > 3 && text.includes(w))
          ? 3
          : 0;
      if (score > 0 && (!best || score > best.score)) best = { option, score };
    }
  }
  return best?.option ?? null;
}

export const PHRASES = {
  GREETING,
  JOB_PROMPT,
  JOB_CONFIRM,
  LANGUAGE_PROMPT,
  LANGUAGE_CONFIRM,
  SPEAKER_TEST,
  MIC_TEST,
  CONSENT,
  READY,
  REPEAT_ACK,
  NOT_UNDERSTOOD,
};

/** Renders the full job list the agent must read out (spec §7). */
export function jobsAnnouncement(titles: string[], language: string): string {
  return copy(JOB_PROMPT, language).replace('{list}', formatList(titles, language));
}

/** Renders the full language list (spec §8). */
export function languagesAnnouncement(names: string[], language: string): string {
  return copy(LANGUAGE_PROMPT, language).replace('{list}', formatList(names, language));
}
