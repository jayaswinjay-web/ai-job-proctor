import type { VoiceCommand } from './enums.js';

/** Language codes we ship first-class phrase data for. Others fall back to English. */
export const PRIMARY_LANGUAGES = ['en', 'hi', 'mr', 'ta'] as const;
export type PrimaryLanguage = (typeof PRIMARY_LANGUAGES)[number];

/**
 * Phrase keys are stable identifiers. Every utterance the AI can say to a candidate
 * must exist here so that (a) it is translatable and (b) an admin can audit exactly
 * what a non-reading candidate will hear.
 */
export const PHRASE_KEYS = [
  'welcome',
  'consent_notice',
  'consent_ask_confirm',
  'consent_declined_end',
  'ask_language',
  'confirm_language_question',
  'language_confirmed',
  'language_not_available',
  'language_changed',
  'ask_job',
  'ask_name',
  'thanks_name',
  'ask_age',
  'ask_village',
  'ask_previous_work',
  'ask_years_experience',
  'ask_work_preference',
  'ask_can_travel',
  'eligibility_age',
  'eligibility_physical',
  'eligibility_documents',
  'intro_job_questions',
  'intro_follow_up',
  'intro_final_review',
  'listening_prompt',
  'still_listening',
  'did_not_understand',
  'will_repeat',
  'simplifying',
  'thanks_move_on',
  'take_your_time',
  'answer_recorded',
  'skip_recorded',
  'dont_know_recorded',
  'interview_complete',
  'application_submitted',
  'goodbye',
  'technical_problem',
  'connection_lost',
  'connection_restored',
  'saving_please_wait',
  'microphone_problem',
  'speaker_problem',
  'help_available',
  'permission_needed',
  'knockout_end',
  'score_not_disclosed',
] as const;
export type PhraseKey = (typeof PHRASE_KEYS)[number];

type PhraseTable = Partial<Record<string, string>> & Record<PhraseKey, string>;

/**
 * Candidate-facing copy. Deliberately short, simple, and free of technical terms.
 * `en` is the mandatory fallback key.
 */
export const PHRASES: Record<PrimaryLanguage, PhraseTable> = {
  en: {
    welcome:
      'Welcome. I will ask you a few simple questions for the job application. You only need to speak your answers. There is no need to type.',
    consent_notice:
      'This interview uses your voice to understand your answers. Your interview information may be stored for recruitment purposes.',
    consent_ask_confirm: 'Do you agree to continue? Please say yes or no.',
    consent_declined_end:
      'Thank you. Without your agreement we cannot continue. Thank you for coming.',
    ask_language: 'Which language would you like to use?',
    confirm_language_question: 'You are speaking in {language}. Is that correct?',
    language_confirmed: 'Okay. We will use {language}.',
    language_not_available: 'Sorry, we cannot use that language yet. I will continue in {language}.',
    language_changed: 'Okay, we will use {language} from now on.',
    ask_job: 'Please say the name of the job, or choose from the screen.',
    ask_name: 'What is your name?',
    thanks_name: 'Thank you, {name}.',
    ask_age: 'How old are you?',
    ask_village: 'Which village or town do you live in?',
    ask_previous_work: 'What type of work have you done before?',
    ask_years_experience: 'How many years have you worked?',
    ask_work_preference: 'Do you want full time or part time work?',
    ask_can_travel: 'Can you travel to the workplace?',
    eligibility_age: 'Are you above eighteen years of age?',
    eligibility_physical: 'Can you do this kind of physical work?',
    eligibility_documents: 'Do you have the documents needed for this job?',
    intro_job_questions: 'Now I will ask a few questions about the job you selected.',
    intro_follow_up: 'I have one more small question.',
    intro_final_review: 'This is the last question.',
    listening_prompt: 'I am listening. Please speak your answer.',
    still_listening: 'I am still listening. You can answer when you are ready.',
    did_not_understand: 'I could not understand that clearly. Please try again.',
    will_repeat: 'I will ask that again.',
    simplifying: 'I will ask it in a simpler way. {question}',
    thanks_move_on: 'Thank you. Let us move to the next question.',
    take_your_time: 'That is okay. Take your time.',
    answer_recorded: 'Thank you. I have noted your answer.',
    skip_recorded: 'No problem. Let us continue.',
    dont_know_recorded: 'That is okay. It is not a problem to say you do not know.',
    interview_complete: 'Thank you. You have completed the interview.',
    application_submitted: 'Your application has been submitted successfully.',
    goodbye: 'Thank you for coming. Please give the desk your slip. Goodbye.',
    technical_problem: 'There is a small technical problem. Please wait.',
    connection_lost: 'The connection is temporarily lost. Please wait, we will continue.',
    connection_restored: 'Thank you. The connection is working again.',
    saving_please_wait: 'I am saving your answers. Please wait.',
    microphone_problem:
      'I cannot hear you. Please check the microphone, or call the person at the desk for help.',
    speaker_problem: 'I cannot play sound. Please call the person at the desk for help.',
    help_available: 'If you need help, please say help, or touch the help button.',
    permission_needed: 'I need permission to use the microphone and speaker. Please allow it.',
    knockout_end: 'Thank you for your time. This job is not a match today, but please come again.',
    score_not_disclosed: 'Your answers have been saved.',
  },
  hi: {
    welcome:
      'स्वागत है। मैं आपकी नौकरी के लिए कुछ आसान सवाल पूछूँगी। आपको केवल बोलकर जवाब देना है। लिखने की ज़रूरत नहीं है।',
    consent_notice:
      'इस साक्षात्कार में मैं आपकी आवाज़ का उपयोग करता हूँ। आपकी जानकारी भर्ती के लिए सहेजी जा सकती है।',
    consent_ask_confirm: 'क्या आप सहमत हैं? कृपया हाँ या ना बोलें।',
    consent_declined_end: 'धन्यवाद। आपकी सहमति के बिना हम आगे नहीं बढ़ सकते। धन्यवाद।',
    ask_language: 'आप कौन सी भाषा में बात करना चाहेंगे?',
    confirm_language_question: 'आप {language} में बोल रहे हैं। क्या यह सही है?',
    language_confirmed: 'ठीक है। हम {language} का उपयोग करेंगे।',
    language_not_available: 'माफ़ कीजिए, अभी यह भाषा उपलब्ध नहीं है। मैं {language} में जारी रखूँगी।',
    language_changed: 'ठीक है, अब से हम {language} का उपयोग करेंगे।',
    ask_job: 'कृपया नौकरी का नाम बोलें, या स्क्रीन से चुनें।',
    ask_name: 'आपका नाम क्या है?',
    thanks_name: 'धन्यवाद, {name}।',
    ask_age: 'आपकी उम्र कितनी है?',
    ask_village: 'आप किस गाँव या शहर में रहते हैं?',
    ask_previous_work: 'आपने पहले कौन सा काम किया है?',
    ask_years_experience: 'आपने कितने साल काम किया है?',
    ask_work_preference: 'आपको पूरा समय का काम चाहिए या अंश समय का?',
    ask_can_travel: 'क्या आप काम की जगह तक जा सकते हैं?',
    eligibility_age: 'क्या आप अठारह साल से ऊपर हैं?',
    eligibility_physical: 'क्या आप यह शारीरिक काम कर सकते हैं?',
    eligibility_documents: 'क्या आपके पास इस काम के लिए ज़रूरी कागज़ात हैं?',
    intro_job_questions: 'अब मैं आपकी चुनी हुई नौकरी के बारे में कुछ सवाल पूछूँगी।',
    intro_follow_up: 'मेरा एक छोटा सवाल और है।',
    intro_final_review: 'यह आखिरी सवाल है।',
    listening_prompt: 'मैं सुन रही हूँ। कृपया अपना जवाब बोलें।',
    still_listening: 'मैं अभी भी सुन रही हूँ। आप तैयार होने पर बोलें।',
    did_not_understand: 'मुझे ठीक से समझ नहीं आया। कृपया फिर से बोलें।',
    will_repeat: 'मैं फिर से पूछूँगी।',
    simplifying: 'मैं इसे आसान भाषा में पूछूँगी। {question}',
    thanks_move_on: 'धन्यवाद। अब अगला सवाल पूछती हूँ।',
    take_your_time: 'कोई बात नहीं। आराम से बोलिए।',
    answer_recorded: 'धन्यवाद। मैंने आपका जवाब नोट कर लिया है।',
    skip_recorded: 'कोई बात नहीं। आगे बढ़ते हैं।',
    dont_know_recorded: 'कोई बात नहीं। यह बताना कि आप नहीं जानते, यह ठीक है।',
    interview_complete: 'धन्यवाद। आपने साक्षात्कार पूरा कर लिया है।',
    application_submitted: 'आपका आवेदन सफलतापूर्वक जमा हो गया है।',
    goodbye: 'आने के लिए धन्यवाद। कृपया डेस्क पर अपनी पर्ची दें। अलविदा।',
    technical_problem: 'थोड़ी तकनीकी समस्या है। कृपया प्रतीक्षा करें।',
    connection_lost: 'इंटरनेट कनेक्शन अभी टूट गया है। कृपया प्रतीक्षा करें, हम जारी रखेंगे।',
    connection_restored: 'धन्यवाद। कनेक्शन फिर से चालू हो गया है।',
    saving_please_wait: 'मैं आपके जवाब सहेज रही हूँ। कृपया प्रतीक्षा करें।',
    microphone_problem:
      'मुझे आपकी आवाज़ सुनाई नहीं दे रही। कृपया माइक्रोफोन जाँचें, या डेस्क पर मौजूद व्यक्ति को बुलाएँ।',
    speaker_problem: 'ध्वनि नहीं चल रही है। कृपया डेस्क पर मौजूद व्यक्ति को बुलाएँ।',
    help_available: 'अगर मदद चाहिए तो कृपया "help" बोलें, या मदद बटन दबाएँ।',
    permission_needed: 'मुझे माइक्रोफोन और स्पीकर की अनुमति चाहिए। कृपया अनुमति दें।',
    knockout_end: 'आपके समय के लिए धन्यवाद। आज के लिए यह नौकरी उपयुक्त नहीं है, लेकिन आप फिर आ सकते हैं।',
    score_not_disclosed: 'आपके जवाब सहेज लिए गए हैं।',
  },
  mr: {
    welcome:
      'स्वागत आहे। मी तुमच्या नोकरीसाठी काही सोप्या प्रश्न विचारतो. तुम्हाला फक्त बोलून उत्तर द्यायचे आहे. लिहिण्याची गरज नाही.',
    consent_notice:
      'या मुलाखतीत मी तुमच्या आवाजाचा वापर करतो. तुमची माहिती नव्युकीसाठी जतन केली जाऊ शकते.',
    consent_ask_confirm: 'तुम्ही सहमत आहात का? कृपया हो किंवा नाही म्हणा.',
    consent_declined_end: 'धन्यवाद. तुमच्या संमतीशिवाय आम्ही पुढे जाऊ शकत नाही. धन्यवाद.',
    ask_language: 'तुम्ही कोणत्या भाषेत बोलायचे आहात?',
    confirm_language_question: 'तुम्ही {language} मध्ये बोलत आहात. हे बरोबर आहे का?',
    language_confirmed: 'ठीक आहे. आपण {language} वापरू. आता पुढे जाऊ.',
    language_not_available: 'क्षमस्व, अद्याप ही भाषा उपलब्ध नाही. मी {language} मध्ये पुढे जाईन.',
    language_changed: 'ठीक आहे, आता पासून आपण {language} वापरू.',
    ask_job: 'कृपया नोकरीचे नाव सांगा, किंवा स्क्रीनवरून निवडा.',
    ask_name: 'तुमचे नाव काय आहे?',
    thanks_name: 'धन्यवाद, {name}.',
    ask_age: 'तुमचे वय किती आहे?',
    ask_village: 'तुम्ही कोणत्या गावात किंवा शहरात राहता?',
    ask_previous_work: 'तुम्ही आधी कोणते काम केले आहे?',
    ask_years_experience: 'तुम्ही किती वर्षे काम केले आहे?',
    ask_work_preference: 'तुम्हाला पूर्ण वेळेचे काम हवे आहे की अर्ध वेळेचे?',
    ask_can_travel: 'तुम्ही कामाच्या ठिकाणी जाऊ शकता का?',
    eligibility_age: 'तुम्ही अठरा वर्षांच्या वर आहात का?',
    eligibility_physical: 'तुम्ही हे शारीरिक काम करू शकता का?',
    eligibility_documents: 'या कामासाठी लागणारी कागदपत्रे तुमच्याकडे आहेत का?',
    intro_job_questions: 'आता मी तुम्ही निवडलेल्या नोकरीबद्दल काही प्रश्न विचारतो.',
    intro_follow_up: 'माझा एक छोटा प्रश्न आणखी आहे.',
    intro_final_review: 'हा शेवटचा प्रश्न आहे.',
    listening_prompt: 'मी ऐकत आहे. कृपया तुमचे उत्तर सांगा.',
    still_listening: 'मी अजूनही ऐकत आहे. तुम्ही तयार झाल्यावर सांगा.',
    did_not_understand: 'मला नीट समजलं नाही. कृपया पुन्हा सांगा.',
    will_repeat: 'मी पुन्हा विचारतो.',
    simplifying: 'मी हे सोप्या भाषेत विचारतो. {question}',
    thanks_move_on: 'धन्यवाद. आता पुढचा प्रश्न विचारतो.',
    take_your_time: 'काहीच वाईट नाही. स्वस्थपणे सांगा.',
    answer_recorded: 'धन्यवाद. मी तुमचे उत्तर नोंदवले आहे.',
    skip_recorded: 'काहीच वाईट नाही. पुढे जाऊ.',
    dont_know_recorded: 'काहीच वाईट नाही. तुम्हाला माहीत नाही हे सांगणे चुकीचे नाही.',
    interview_complete: 'धन्यवाद. तुम्ही मुलाखत पूर्ण केली आहे.',
    application_submitted: 'तुमचा अर्ज यशस्वीरित्या जमा झाला आहे.',
    goodbye: 'आल्याबद्दल धन्यवाद. कृपया डेस्कवर तुमची पत्रिका द्या. नमस्कार.',
    technical_problem: 'थोडी तांत्रिक अडचण आहे. कृपया थांबा.',
    connection_lost: 'इंटरनेट जोडणी काही वेळ तुटली आहे. कृपया थांबा, आपण पुढे जाऊ.',
    connection_restored: 'धन्यवाद. जोडणी पुन्हा चालू झाली आहे.',
    saving_please_wait: 'मी तुमची उत्तरे जतन करत आहे. कृपया थांबा.',
    microphone_problem:
      'मला तुमचा आवाज ऐकू येत नाही. कृपया मायक्रोफोन तपासा, किंवा डेस्कवरील व्यक्तीला बोलावा.',
    speaker_problem: 'ध्वनी येत नाही. कृपया डेस्कवरील व्यक्तीला बोलावा.',
    help_available: 'मदत हवी असल्यास कृपया "help" म्हणा, किंवा मदत बटण दाबा.',
    permission_needed: 'मला मायक्रोफोन आणि स्पीकरची परवानगी हवी आहे. कृपया परवानगी द्या.',
    knockout_end:
      'तुमच्या वेळेसाठी धन्यवाद. आजसाठी ही नोकरी योग्य नाही, पण तुम्ही पुन्हा येऊ शकता.',
    score_not_disclosed: 'துங்கள் பதில்கள் சேமிக்கப்பட்டுள்ளன.',
  },
  ta: {
    welcome:
      'வரவேற்ப்பு. வேரணையின் பணிக்கு சில எளிய கேள்விகள் கேட்பேன். நீங்கள் பதில்களைச் சொல்ல வேண்டும். எழுதத் தேவையில்லை.',
    consent_notice:
      'இந்த நேர்காணலில் உங்கள் குரல் பயன்படுத்தப்படும். உங்கள் நேர்காணல் தகவல்கள் வேலையாளர் பயன்பாட்டிற்காக சேமிக்கப்படலாம்.',
    consent_ask_confirm: 'நீங்கள் ஒப்புக்கொள்கிறீர்களா? ஆம் அல்லது இல்லை என்று சொல்லுங்கள்.',
    consent_declined_end: 'நன்றி. உங்கள் ஒப்புதலின்றி நாங்கள் தொடர முடியாது. வந்ததற்கு நன்றி.',
    ask_language: 'எந்த மொழியில் பேச விரும்புகிறீர்கள்?',
    confirm_language_question: 'நீங்கள் {language} பேசுகிறீர்கள். அது சரியா?',
    language_confirmed: 'சரி. நாங்கள் {language} பயன்படுத்துவோம்.',
    language_not_available: 'மன்னிக்கவும், அந்த மொழி இன்னும் பயன்படுத்த முடியவில்லை. {language} தொடர்வேன்.',
    language_changed: 'சரி, இனிமேல் {language} பயன்படுத்துவோம்.',
    ask_job: 'வேலையின் பெயரைச் சொல்லுங்கள், அல்லது திரையிலிருந்து தேர்வு செய்யுங்கள்.',
    ask_name: 'உங்கள் பெயர் என்ன?',
    thanks_name: 'நன்றி, {name}.',
    ask_age: 'உங்கள் வயது எவ்வளவு?',
    ask_village: 'நீங்கள் எந்த கிராமம் அல்லது நகரத்தில் வாழ்கிறீர்கள்?',
    ask_previous_work: 'இதற்கு முன்பு என்ன வேலை செய்திருந்தீர்கள்?',
    ask_years_experience: 'எத்தனை ஆண்டுகள் பணியாறியுள்ளீர்கள்?',
    ask_work_preference: 'முழு நேர வேலையா, பகுதி நேர வேலையா வேண்டும்?',
    ask_can_travel: 'வேலை இடத்திற்குச் செல்ல முடியுமா?',
    eligibility_age: 'நீங்கள் பதினெட்டு வயதைக் கடந்திருங்களா?',
    eligibility_physical: 'இந்த வகையான உடல் உழைப்பைச் செய்ய முடியுமா?',
    eligibility_documents: 'இந்த வேலைக்குத் தேவையான சான்றுகள் உங்களிடம் உள்ளனா?',
    intro_job_questions: 'நீங்கள் தேர்ந்தெடுத்த வேலையைப் பற்றி சில கேள்விகள் கேட்பேன்.',
    intro_follow_up: 'இன்னும் ஒரு சிறிய கேள்வி உள்ளது.',
    intro_final_review: 'இது கடைசி கேள்வி.',
    listening_prompt: 'நான் கேட்டுக்கொண்டிருக்கிறேன். உங்கள் பதிலைச் சொல்லுங்கள்.',
    still_listening: 'நான் இன்னும் கேட்டுக்கொண்டிருக்கிறேன். நீங்கள் தயாராகும்போது பதிலளியுங்கள்.',
    did_not_understand: 'அது தெளிவாகப் புரியவில்லை. மீண்டும் சொல்லுங்கள்.',
    will_repeat: 'அதையை மீண்டும் கேட்பேன்.',
    simplifying: 'எளிய முறையில் கேட்பேன். {question}',
    thanks_move_on: 'நன்றி. அடுத்த கேள்விக்குச் செல்வோம்.',
    take_your_time: 'அது சரி. நேரம் எடுத்துக்கொள்ளுங்கள்.',
    answer_recorded: 'நன்றி. உங்கள் பதிலைப் பதிவு செய்துவிட்டேன்.',
    skip_recorded: 'பிரச்சினை இல்லை. தொடர்வோம்.',
    dont_know_recorded: 'அது சரி. தெரியாது என்று சொல்வது குற்றமல்ல.',
    interview_complete: 'நன்றி. உங்கள் நேர்காணல் முடிந்தது.',
    application_submitted: 'உங்கள் விண்ணப்பம் வெற்றிகரமாக சமர்ப்பிக்கப்பட்டுவிட்டது.',
    goodbye: 'வந்ததற்கு நன்றி. உங்கள் பையை மேசையில் கொடுங்கள். விடைவணக்கம்.',
    technical_problem: 'ஒரு சிறிய தொழில்நுட்பப் பிரச்சினை உள்ளது. காத்திருங்கள்.',
    connection_lost: 'இணைப்பு தற்காலிகமாக இழக்கப்பட்டுள்ளது. காத்திருங்கள், தொடர்வோம்.',
    connection_restored: 'நன்றி. இணைப்பு மீண்டும் செயல்படுகிறது.',
    saving_please_wait: 'உங்கள் பதில்களைச் சேமிக்கிறேன். காத்திருங்கள்.',
    microphone_problem: 'உங்களைப் புரிந்து கொள்ள முடியவில்லை. மைக்ரோபோனைச் சரிபார்க்கவும், அல்லது மேசையிலுள்ளவரை அழைக்கவும்.',
    speaker_problem: 'ஒலி வரவில்லை. மேசையிலுள்ளவரை அழைக்கவும்.',
    help_available: 'உதவி வேண்டுமென்றால் "help" என்று சொல்லுங்கள், அல்லது உதவி பொத்தானை அழுத்துங்கள்.',
    permission_needed: 'மைக்ரோபோன் மற்றும் ஒலியைப் பயன்படுத்த அனுமதி வேண்டும். தயவுசெய்து அனுமதியுங்கள்.',
    knockout_end:
      'உங்கள் நேரத்திற்கு நன்றி. இன்று இந்த வேலை பொருந்தவில்லை, ஆனால் நீங்கள் மீண்டும் வரலாம்.',
    score_not_disclosed: 'உங்கள் பதில்கள் சேமிக்கப்பட்டுள்ளன.',
  },
};

export function phrase(key: PhraseKey, lang: string, vars: Record<string, string | number> = {}): string {
  const table = PHRASES[(lang as PrimaryLanguage) as keyof typeof PHRASES] ?? PHRASES.en;
  const template = table[key] ?? PHRASES.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}

export function hasPhrase(lang: string, key: PhraseKey): boolean {
  const table = PHRASES[(lang as PrimaryLanguage) as keyof typeof PHRASES];
  return Boolean(table && table[key]);
}

export interface VoiceCommandSpec {
  command: VoiceCommand;
  /** English canonical phrasing — also what the STT hint text contains. */
  canonical: string;
  /** Regex sources per language, evaluated case-insensitively against the transcript. */
  patterns: Record<string, readonly string[]>;
  /** Spoken confirmation (or null when no confirmation is spoken). */
  confirmation: PhraseKey | null;
  /** Whether the command must be a near-exact match to avoid false positives. */
  strictMatch: boolean;
}

/**
 * Voice commands with per-language phrasing. A command only fires when the
 * utterance is essentially just that command (strict) or contains it (loose),
 * which prevents "no, I repeat this every day" from being read as "Repeat".
 *
 * Patterns are plain strings compiled with `new RegExp(source, 'iu')` at match
 * time, so backslashes are double-escaped here by design.
 */
export const VOICE_COMMAND_SPECS: readonly VoiceCommandSpec[] = [
  {
    command: 'REPEAT',
    canonical: 'Repeat',
    strictMatch: false,
    confirmation: 'will_repeat',
    patterns: {
      en: [
        '^\\s*(please\\s+)?repeat(\\s+(that|the question|it))?\\s*$',
        '^\\s*again\\s*$',
        '^\\s*(come again)\\s*$',
        '^\\s*repeat(\\s+(that|it|the question))\\b',
      ],
      hi: ['^\\s*(कृपया\\s*)?(दोहराइए|दोहराइये|फिर से|दोबारा)\\s*$', '^\\s*(दोहराओ|फिर पूछो)\\s*$'],
      mr: ['^\\s*(कृपया\\s*)?(पुन्हा सांगा|पुन्हा विचारा|पुन्हा)\\s*$', '^\\s*पुन्हा म्हणा\\s*$'],
      // `மீண்டும்` means both "repeat" and "again", so "மீண்டும் தொடங்கு" (start again)
      // would otherwise be swallowed by REPEAT, which is checked first. The lookahead keeps
      // the two apart instead of reordering the whole priority list.
      ta: ['^\\s*(தயவுசெய்து\\s*)?(மீண்டும்|மறுபடி|மீண்டும்\\s*கேளுங்கவும்|மீண்டும்\\s*சொல்லுங்கள்)\\s*$', '^\\s*(தயவுசெய்து\\s*)?மீண்டும்(?!\\s*(தொடங்கு|ஆரம்பி))(?![\\p{L}])'],
    },
  },
  {
    command: 'SPEAK_SLOWLY',
    canonical: 'Speak slowly',
    strictMatch: false,
    confirmation: null,
    patterns: {
      en: [
        '^\\s*(speak|talk)\\s+(slowly|slower)\\s*$',
        '^\\s*(slow(er|ly)|too fast|too quickly)\\s*$',
        '^\\s*(speak|talk)\\s+slower\\b',
      ],
      hi: ['^\\s*(धीरे|धीरे बोल|धीरे बोलो|धीरे बोलिए)\\s*$', '^\\s*(बहुत तेज़|जल्दी बोल)\\s*$'],
      mr: ['^\\s*(हळू|हळू बोल|हळू सांग|सावकाश)\\s*$'],
      ta: ['^\\s*(மெதுவாக|மெதுவாக\\s*பேசுங்கள்|மெதுவாக\\s*சொல்லுங்கள்|மெதுவாக\\s*விளக்குங்கள்)\\s*$', '^\\s*(மிக\\s*வேகமாக|வேகமாக\\s*பேசாதீர்கள்)\\s*$'],
    },
  },
  {
    command: 'DONT_UNDERSTAND',
    canonical: 'I don\'t understand',
    strictMatch: false,
    confirmation: 'simplifying',
    patterns: {
      en: [
        '^\\s*i\\s*(don.t|do not|didn.t|did not)\\s*(understand|get it|know)\\s*$',
        '^\\s*(it\\s+does\\s*n.t\\s+make\\s+sense)\\s*$',
        '^\\s*(what|kaunsa|kyun)\\s*$',
        '^\\s*(samajh|samaj)\\s*(a)?\\s*nahi\\s*$',
        '^\\s*i\\s*don.t\\s+get\\s+it\\s*$',
      ],
      hi: [
        '^\\s*(मुझे)?\\s*(समझ)?\\s*(नहीं|नही)\\s*(आया|आई)?\\s*$',
        '^\\s*(क्या|कैसे|क्यों)\\s*$',
        '^\\s*(मुझे समझ नहीं आया)\\s*$',
      ],
      mr: [
        '^\\s*मला\\s*(नीट)?\\s*समजलं?\\s*(नाही)?\\s*$',
        '^\\s*(काय|कसे)?\\?\\s*$',
        '^\\s*मला\\s*काय\\s+म्हणता\\s+येत\\s+नाही\\s*$',
      ],
      ta: ['^\\s*(எனக்கு)?\\s*(புரியவில்லை|புரியவில்லை\\s*செய்கிறது|பொருள்\\s*கிடைத்தில்லை)\\s*$', '^\\s*(என்ன|எப்படி|ஏன்)\\s*$', '^\\s*எனக்கு\\s*புரியவில்லை\\s*$'],
    },
  },
  {
    command: 'NEXT',
    canonical: 'Next',
    strictMatch: false,
    confirmation: null,
    patterns: {
      en: ['^\\s*next(\\s+(question|please))?\\s*$', '^\\s*(move on|go to the next)\\s*$'],
      hi: ['^\\s*(अगला|अगला सवाल|आगे बढ़ो|आगे)\\s*$'],
      mr: ['^\\s*(पुढचा|पुढील प्रश्न|पुढे)\\s*$'],
      ta: ['^\\s*(அடுத்து|அடுத்த\\s*கேள்வி|இடத்துக்கு|மேலும்)\\s*$'],
    },
  },
  {
    command: 'GO_BACK',
    canonical: 'Go back',
    strictMatch: true,
    confirmation: null,
    patterns: {
      en: ['^\\s*(go back|previous question|one question back|back)\\s*$'],
      hi: ['^\\s*(पिछला|पिछला सवाल|वापस)\\s*$'],
      mr: ['^\\s*(मागील|मागील प्रश्न|मागे)\\s*$'],
      ta: ['^\\s*(பின்னால்|முந்தைய\\s*கேள்வி|மீண்டும்\\s*கேள்வி)\\s*$'],
    },
  },
  {
    command: 'DONT_KNOW',
    canonical: 'I don\'t know',
    strictMatch: false,
    confirmation: 'dont_know_recorded',
    patterns: {
      en: [
        '^\\s*i\\s*(don.t|do not|didn.t|did not)\\s*know\\s*$',
        '^\\s*(no idea|not sure|pata nahi|mahat nahi)\\s*$',
        '^\\s*(i am not|i.m not)\\s+sure\\s*$',
        '^\\s*don.t\\s*know\\b',
      ],
      hi: ['^\\s*(मुझे)?\\s*(नहीं|नही)\\s*(पता|मालूम)\\s*$', '^\\s*(पता नहीं|पता नही)\\s*$', '^\\s*कुछ नहीं\\s*$'],
      mr: ['^\\s*मला\\s*(माहीत नाही|ठाऊक नाही)\\s*$', '^\\s*काही माहीत नाही\\s*$'],
      ta: ['^\\s*(எனக்கு)?\\s*(தெரியாது|தெரியவில்லை|சரி\\s*தெரியவில்லை)\\s*$', '^\\s*தெரியாது\\s*$'],
    },
  },
  {
    command: 'STOP',
    canonical: 'Stop',
    strictMatch: true,
    confirmation: null,
    patterns: {
      en: ['^\\s*(stop|end the interview|finish|i am done)\\s*$'],
      hi: ['^\\s*(रोको|बंद करो|बस|रोकिए)\\s*$'],
      mr: ['^\\s*(थांबा|बंद करा|पुरे)\\s*$'],
      ta: ['^\\s*(நிறுத்து|நிறுத்துங்கள்|நிறுத்திவிடு|போதும்|முடிந்தது)\\s*$'],
    },
  },
  {
    command: 'START_AGAIN',
    canonical: 'Start again',
    strictMatch: true,
    confirmation: null,
    patterns: {
      en: ['^\\s*(start again|restart|begin again|start over)\\s*$'],
      hi: ['^\\s*(फिर से शुरू|दोबारा शुरू|शुरू से)\\s*$'],
      mr: ['^\\s*(पुन्हा सुरू|पुन्हा सुरू करा)\\s*$'],
      ta: ['^\\s*(மீண்டும்\\s*தொடங்கு|மீண்டும்\\s*ஆரம்பி|தொடங்கு)\\s*$'],
    },
  },
  {
    command: 'HELP',
    canonical: 'Help',
    strictMatch: true,
    confirmation: 'help_available',
    patterns: {
      en: ['^\\s*(help|help me|i need help)\\s*$'],
      hi: ['^\\s*(मदद|मदद करो|मदद चाहिए)\\s*$'],
      mr: ['^\\s*(मदत|मदत करा)\\s*$'],
      ta: ['^\\s*(உதவி|உதவி\\s*முடியும்|உதவி\\s*தேவை|உதவும்)\\s*$'],
    },
  },
] as const;
