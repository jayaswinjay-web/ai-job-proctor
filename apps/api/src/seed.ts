import type { PrismaClient } from '@proctor/database';
import type { Logger } from '@proctor/database';
import { hashPassword } from './lib/crypto.js';

/**
 * Idempotent seed.
 *
 * Creates:
 *  * the four roles and their permission sets
 *  * languages (en / hi / mr / ta) with recogniser and voice hints
 *  * three realistic jobs — Factory Worker, Delivery Worker, Security Guard
 *  * per-job stages, eligibility requirements, weighted scoring, questions with
 *    rubric criteria, follow-up rules and Hindi, Marathi and Tamil translations
 *  * a bootstrap administrator (password printed once if not supplied)
 *  * an example completed session so the dashboard is not empty on first run
 *
 * Re-running is safe: every write is an upsert keyed on a natural identifier.
 */

export interface SeedResult {
  adminEmail: string;
  adminPassword: string | null;
  jobs: string[];
  questions: number;
  exampleSessionId: string | null;
}

/** Exported so the seed summary reports what was actually written, not a stale copy. */
export const LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English', sttLocale: 'en-IN', ttsVoiceHint: 'Google UK English Female', sortOrder: 0 },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', sttLocale: 'hi-IN', ttsVoiceHint: 'Google हिन्दी', sortOrder: 1 },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी', sttLocale: 'mr-IN', ttsVoiceHint: 'Google मराठी', sortOrder: 2 },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', sttLocale: 'ta-IN', ttsVoiceHint: 'Google தமிழ்', sortOrder: 3 },
];

const ROLE_PERMISSIONS: Array<{ role: string; description: string; permissions: string[] }> = [
  { role: 'SUPER_ADMIN', description: 'Full access including user management and system settings.', permissions: [] },
  {
    role: 'RECRUITER',
    description: 'Manages jobs, question banks and candidates. Cannot delete candidates or change system settings.',
    permissions: [],
  },
  { role: 'INTERVIEWER', description: 'Read-only access to jobs and candidates, plus review notes.', permissions: [] },
  {
    role: 'REVIEWER',
    description: 'Reviews interviews, adjusts scores, listens to recordings and overrides recommendations.',
    permissions: [],
  },
];

interface SeedQuestion {
  key: string;
  category: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  text: string;
  hi: string;
  mr: string;
  ta: string;
  keywords: string[];
  skillTags: string[];
  weight: number;
  scoreMax: number;
  guidance: string;
  instructions: string;
  criteria: Array<{ label: string; description: string; points: number; keywords: string[] }>;
  followUp?: { question: string; trigger: 'ALWAYS' | 'IF_POSITIVE' | 'IF_NEGATIVE' | 'IF_SHORT' | 'MANUAL' };
}

interface SeedJob {
  key: string;
  title: string;
  description: string;
  location: string;
  department: string;
  minExperienceYears: number;
  requiredSkills: string[];
  eligibilityCriteria: string[];
  durationMinutes: number;
  passingScore: number;
  languages: string[];
  weights: Record<string, number>;
  proctoring: Record<string, unknown>;
  requirements: Array<{ skillTag: string; description: string; isKnockout: boolean; knockoutMessage?: string }>;
  stages: Array<{ kind: string; title: string; instructions: string; maxQuestions: number; sortOrder: number }>;
  questions: SeedQuestion[];
}

const JOBS: SeedJob[] = [
  {
    key: 'factory-worker',
    title: 'Factory Worker',
    description:
      'You will pack and check goods on a production line, operate simple machines, and keep the work area clean and safe. ' +
      'You will work in shifts with other team members and follow the instructions of the shift supervisor.',
    location: 'Pune Industrial Area',
    department: 'Production',
    minExperienceYears: 0,
    requiredSkills: ['Machine operation', 'Packing', 'Safety rules', 'Teamwork'],
    eligibilityCriteria: ['Able to work in shifts', 'Physically able to stand and move for long periods'],
    durationMinutes: 12,
    passingScore: 55,
    languages: ['en', 'hi', 'mr', 'ta'],
    weights: {
      relevantExperience: 25,
      jobKnowledge: 20,
      practicalUnderstanding: 20,
      safetyAwareness: 20,
      communication: 5,
      reliability: 5,
      other: 5,
    },
    proctoring: {
      level: 'BASIC',
      cameraEnabled: false,
      detectMultiplePeople: true,
      detectFacingAway: false,
      facingAwaySeconds: 25,
      kioskFullscreenEnforced: true,
    },
    requirements: [
      {
        skillTag: 'AVAILABILITY',
        description: 'Can work the morning and evening shifts, including Saturdays.',
        isKnockout: false,
      },
      {
        skillTag: 'PHYSICAL_CONSIDERATION',
        description: 'Able to stand and move for long periods without assistance.',
        isKnockout: false,
      },
    ],
    stages: [
      { kind: 'JOB_QUESTIONS', title: 'Getting to know you', instructions: 'Start with simple questions about work the candidate already knows.', maxQuestions: 3, sortOrder: 0 },
      { kind: 'JOB_QUESTIONS', title: 'Doing the work', instructions: 'Ask about the actual tasks on the line.', maxQuestions: 3, sortOrder: 1 },
      { kind: 'JOB_QUESTIONS', title: 'Staying safe', instructions: 'Ask about safety habits and what to do when something goes wrong.', maxQuestions: 3, sortOrder: 2 },
    ],
    questions: [
      {
        key: 'fw-exp-1',
        category: 'Experience',
        difficulty: 'EASY',
        text: 'Have you worked in a factory before?',
        hi: 'क्या आपने पहले किसी फैक्ट्री में काम किया है?',
        mr: 'तुम्ही आधी कुणत्याही फॅक्टरीत काम केले आहे का?',
        ta: 'நீங்கள் முன்பு ஒரு தொழிற்சாலையில் பணியாறியிருந்தீர்களா?',
        keywords: ['factory', 'production', 'line', 'packing', 'machine', 'shift'],
        skillTags: ['RELEVANT_EXPERIENCE'],
        weight: 20,
        scoreMax: 10,
        guidance: 'Any real work on a production line, in packing, or in a similar industrial setting.',
        instructions: 'Award points for concrete experience only. Do not award points for intentions.',
        criteria: [
          { label: 'Has factory experience', description: 'Describes real work in a factory or similar production setting', points: 6, keywords: ['worked', 'factory', 'production', 'line', 'shift', 'packing'] },
          { label: 'Describes the tasks', description: 'Says what the work actually involved', points: 4, keywords: ['pack', 'check', 'machine', 'count', 'load', 'clean'] },
        ],
        followUp: { question: 'What kind of work did you do there?', trigger: 'ALWAYS' },
      },
      {
        key: 'fw-machines-1',
        category: 'Job knowledge',
        difficulty: 'EASY',
        text: 'Have you used any simple machines before?',
        hi: 'क्या आपने पहले कोई छोटी मशीन चलाई है?',
        mr: 'तुम्ही आधी काहीं लहान यंत्र चालवले आहे का?',
        ta: 'நீங்கள் முன்பு எளிய இயந்திரங்களைப் பயன்படுத்தியிருந்தீர்களா?',
        keywords: ['machine', 'press', 'packer', 'conveyor', 'tool', 'switch'],
        skillTags: ['JOB_KNOWLEDGE', 'TOOL_USE'],
        weight: 20,
        scoreMax: 10,
        guidance: 'Comfort with basic machinery, following instructions rather than independent repair.',
        instructions: 'Reward willingness to learn and safe operation. Do not reward technical jargon.',
        criteria: [
          { label: 'Machine familiarity', description: 'Has operated or been trained on simple equipment', points: 6, keywords: ['machine', 'press', 'conveyor', 'tool', 'operate', 'run'] },
          { label: 'Learns by instruction', description: 'Comfortable being told what to do rather than improvising', points: 4, keywords: ['teach', 'learn', 'told', 'instruction', 'practice'] },
        ],
      },
      {
        key: 'fw-sound-1',
        category: 'Safety',
        difficulty: 'MEDIUM',
        text: 'What do you do if a machine makes an unusual sound?',
        hi: 'अगर मशीन से असामान्य आवाज़ आए तो आप क्या करेंगे?',
        mr: 'यंत्र असामान्य आवाज करून आले तर तुम्ही काय कराल?',
        ta: 'ஒரு இயந்திரம் வழக்கத்திற்கு மாறான சத்தம் என்றால் நீங்கள் என்ன செய்கிறீர்கள்?',
        keywords: ['stop', 'switch off', 'report', 'supervisor', 'maintenance', 'danger', 'call'],
        skillTags: ['SAFETY_AWARENESS', 'PRACTICAL_UNDERSTANDING'],
        weight: 25,
        scoreMax: 10,
        guidance: 'Stops the machine, does not investigate alone, tells the supervisor.',
        instructions: 'This is a safety question. Full marks require stopping and reporting.',
        criteria: [
          { label: 'Stops the machine', description: 'Turns off or stops the machine immediately', points: 5, keywords: ['stop', 'off', 'switch', 'power', 'button'] },
          { label: 'Reports to a person', description: 'Tells the supervisor, manager or maintenance', points: 3, keywords: ['supervisor', 'manager', 'report', 'tell', 'maintenance', 'sir'] },
          { label: 'Does not investigate alone', description: 'Does not try to repair a running machine by themselves', points: 2, keywords: ['wait', 'safe', 'not touch', 'stay', 'distance'] },
        ],
      },
      {
        key: 'fw-safety-1',
        category: 'Safety',
        difficulty: 'MEDIUM',
        text: 'How do you stay safe while working?',
        hi: 'काम करते समय आप अपनी सुरक्षा कैसे रखते हैं?',
        mr: 'काम करताना तुम्ही तुमची सुरक्षा कशी राखता?',
        ta: 'பணியின்போது உங்களை பாதுகாப்பாக எப்படி வைத்திருக்கிறீர்கள்?',
        keywords: ['helmet', 'gloves', 'shoes', 'mask', 'equipment', 'careful', 'clean', 'tidy'],
        skillTags: ['SAFETY_AWARENESS'],
        weight: 25,
        scoreMax: 10,
        guidance: 'Uses protective equipment, keeps the area clean, follows safety signage.',
        instructions: 'Reward concrete safety habits. Do not reward general statements without examples.',
        criteria: [
          { label: 'Uses protective equipment', description: 'Mentions helmet, gloves, shoes or mask', points: 6, keywords: ['helmet', 'gloves', 'shoes', 'mask', 'goggles', 'equipment', 'ppes'] },
          { label: 'Keeps the area clean', description: 'Tidiness, correct placement of items, clear walkway', points: 4, keywords: ['clean', 'tidy', 'order', 'clear', 'place', 'neat'] },
        ],
      },
      {
        key: 'fw-shifts-1',
        category: 'Eligibility',
        difficulty: 'EASY',
        text: 'Can you work in the morning and evening shifts?',
        hi: 'क्या आप सुबह और शाम की शिफ्ट में काम कर सकते हैं?',
        mr: 'तुम्ही सकाळच्या आणि संध्याकाळच्या पाळीत काम करू शकता का?',
        ta: 'காலை மற்றும் மாலை ஷிப்டுகளில் பணியாறிய முடியுமா?',
        keywords: ['yes', 'no', 'shift', 'morning', 'evening', 'night'],
        skillTags: ['AVAILABILITY'],
        weight: 10,
        scoreMax: 5,
        guidance: 'Confirms availability for the roster offered.',
        instructions: 'Record the answer factually. Availability is handled separately as an eligibility criterion.',
        criteria: [{ label: 'Shift availability stated', description: 'States availability for the offered shifts', points: 5, keywords: ['yes', 'morning', 'evening', 'night', 'shift', 'available'] }],
      },
      {
        key: 'fw-team-1',
        category: 'Experience',
        difficulty: 'MEDIUM',
        text: 'If your team member is not doing their share of the work, what do you do?',
        hi: 'अगर आपके साथी का काम नहीं हो रहा है, तो आप क्या करेंगे?',
        mr: 'जर तुमच्या साथीचे काम होत नसेल, तर तुम्ही काय कराल?',
        ta: 'உங்கள் குழு உறுப்பினர் தம் பணியைச் செய்யவில்லை என்றால் நீங்கள் என்ன செய்கிறீர்கள்?',
        keywords: ['help', 'tell', 'supervisor', 'manager', 'talk', 'share', 'finish'],
        skillTags: ['TEAMWORK', 'RELIABILITY'],
        weight: 15,
        scoreMax: 10,
        guidance: 'Helps first, then informs the supervisor. Not gossip, not blame.',
        instructions: 'Reward collaborative answers. Do not reward confrontation or ignoring the problem.',
        criteria: [
          { label: 'Offers help', description: 'Helps rather than waiting', points: 5, keywords: ['help', 'support', 'together', 'share', 'finish'] },
          { label: 'Informs the supervisor', description: 'Tells the shift supervisor if it continues', points: 5, keywords: ['supervisor', 'manager', 'tell', 'report', 'sir'] },
        ],
      },
    ],
  },
  {
    key: 'delivery-worker',
    title: 'Delivery Worker',
    description:
      'You will deliver parcels to homes and shops across the city, collect signatures, and handle cash only where the route requires it. ' +
      'You will use a smartphone for the delivery app and work on your own for most of the day.',
    location: 'Nagpur City',
    department: 'Logistics',
    minExperienceYears: 0,
    requiredSkills: ['Smartphone use', 'Navigation', 'Customer handling', 'Driving'],
    eligibilityCriteria: ['Two-wheeler or bicycle licence', 'Can start early in the morning'],
    durationMinutes: 12,
    passingScore: 55,
    languages: ['en', 'hi', 'mr', 'ta'],
    weights: {
      relevantExperience: 20,
      jobKnowledge: 15,
      practicalUnderstanding: 25,
      safetyAwareness: 15,
      communication: 15,
      reliability: 5,
      other: 5,
    },
    proctoring: {
      level: 'BASIC',
      cameraEnabled: false,
      detectMultiplePeople: true,
      detectFacingAway: false,
      facingAwaySeconds: 25,
      kioskFullscreenEnforced: true,
    },
    requirements: [
      { skillTag: 'AVAILABILITY', description: 'Available to start work by 6am.', isKnockout: false },
      { skillTag: 'ELIGIBILITY', description: 'Holds a valid two-wheeler or bicycle licence.', isKnockout: false },
    ],
    stages: [
      { kind: 'JOB_QUESTIONS', title: 'Delivery experience', instructions: 'Ask about previous delivery or driving work.', maxQuestions: 3, sortOrder: 0 },
      { kind: 'JOB_QUESTIONS', title: 'Using the phone', instructions: 'Ask about comfort with the delivery app.', maxQuestions: 2, sortOrder: 1 },
      { kind: 'JOB_QUESTIONS', title: 'Customers and problems', instructions: 'Ask about difficult moments on a route.', maxQuestions: 3, sortOrder: 2 },
    ],
    questions: [
      {
        key: 'dw-exp-1',
        category: 'Experience',
        difficulty: 'EASY',
        text: 'Have you worked in delivery before?',
        hi: 'क्या आपने पहले डिलीवरी का काम किया है?',
        mr: 'तुम्ही आधी डिलिव्हरीचे काम केले आहे का?',
        ta: 'நீங்கள் முன்பு டெலிவரி பணியில் உழைத்திருந்தீர்களா?',
        keywords: ['delivery', 'courier', 'driver', 'parcel', 'package', 'bike', 'route'],
        skillTags: ['RELEVANT_EXPERIENCE'],
        weight: 20,
        scoreMax: 10,
        guidance: 'Any delivery, courier, or goods-carrying work, including informal work.',
        instructions: 'Accept informal and self-employed delivery work as valid experience.',
        criteria: [
          { label: 'Delivery experience', description: 'Has carried goods or parcels for others', points: 6, keywords: ['delivery', 'courier', 'parcel', 'package', 'goods', 'drop'] },
          { label: 'Understands the route work', description: 'Mentions routes, timings or customers', points: 4, keywords: ['route', 'area', 'customer', 'order', 'time', 'city'] },
        ],
        followUp: { question: 'How many deliveries did you do in a day?', trigger: 'ALWAYS' },
      },
      {
        key: 'dw-phone-1',
        category: 'Job knowledge',
        difficulty: 'EASY',
        text: 'Can you use a smartphone to open an app and enter information?',
        hi: 'क्या आप स्मार्टफोन में ऐप खोलकर जानकारी भर सकते हैं?',
        mr: 'तुम्ही स्मार्टफोनवर अॅप उघडून माहिती भरू शकता का?',
        ta: 'ஒரு செயலியைத் திறந்து தகவலை உள்ளிட உங்களால் ஸ்மார்ட்போன் பயன்படுத்த முடியுமா?',
        keywords: ['yes', 'whatsapp', 'youtube', 'app', 'phone', 'message', 'call', 'internet'],
        skillTags: ['JOB_KNOWLEDGE', 'TOOL_USE'],
        weight: 20,
        scoreMax: 10,
        guidance: 'Can open an app, read a screen and type a short entry.',
        instructions: 'Judge practical ability only. Do not judge spelling, grammar or typing speed.',
        criteria: [
          { label: 'Uses a smartphone', description: 'Uses a smartphone in daily life', points: 4, keywords: ['smartphone', 'phone', 'mobile', 'whatsapp', 'youtube', 'video'] },
          { label: 'Can follow an app screen', description: 'Can open an app and enter information', points: 6, keywords: ['app', 'open', 'click', 'enter', 'fill', 'install', 'type'] },
        ],
      },
      {
        key: 'dw-customer-1',
        category: 'Problem solving',
        difficulty: 'MEDIUM',
        text: 'What do you do if the customer is not at home when you arrive?',
        hi: 'अगर आपके पहुँचने पर ग्राहक घर पर नहीं मिले तो आप क्या करेंगे?',
        mr: 'तुम्ही पोहोचल्यावर ग्राहक घरात नसल्यास तुम्ही काय कराल?',
        ta: 'நீங்கள் வந்தபோது வாடிக்கையாளர் வீட்டில் இல்லை என்றால் என்ன செய்கிறீர்கள்?',
        keywords: ['call', 'wait', 'neighbour', 'again', 'return', 'office', 'message', 'try'],
        skillTags: ['CUSTOMER_HANDLING', 'PROBLEM_SOLVING'],
        weight: 25,
        scoreMax: 10,
        guidance: 'Tries a reasonable second attempt or calls, leaves the parcel safely, does not leave it exposed.',
        instructions: 'Reward a safe, practical answer. Penalise leaving a parcel unattended in plain view.',
        criteria: [
          { label: 'Tries to resolve', description: 'Waits, calls, or tries a neighbour before giving up', points: 5, keywords: ['call', 'wait', 'neighbour', 'neighbor', 'again', 'try', 'message'] },
          { label: 'Keeps the parcel safe', description: 'Does not leave the parcel somewhere it can be stolen or rained on', points: 3, keywords: ['safe', 'secure', 'inside', 'office', 'return', 'depot'] },
          { label: 'Records the attempt', description: 'Notes the failed attempt in the app as required', points: 2, keywords: ['app', 'note', 'mark', 'update', 'status', 'record'] },
        ],
      },
      {
        key: 'dw-road-1',
        category: 'Safety',
        difficulty: 'MEDIUM',
        text: 'How do you stay safe on the road while delivering?',
        hi: 'डिलीवरी करते समय सड़क पर आप अपनी सुरक्षा कैसे रखते हैं?',
        mr: 'डिलिव्हरी करताना रस्त्यावर तुम्ही सुरक्षा कशी राखता?',
        ta: 'டெலிவரி செய்யும்போது பாதையில் எப்படி பாதுகாப்பாக இருப்பீர்கள்?',
        keywords: ['helmet', 'slow', 'traffic', 'signal', 'careful', 'night', 'light', 'mirror'],
        skillTags: ['SAFETY_AWARENESS'],
        weight: 20,
        scoreMax: 10,
        guidance: 'Helmet, attention to traffic, caution in poor light.',
        instructions: 'Reward concrete road-safety habits.',
        criteria: [
          { label: 'Wears a helmet', description: 'Always wears a helmet', points: 5, keywords: ['helmet', 'cap'] },
          { label: 'Watches traffic', description: 'Mentions signals, mirrors, speed, or traffic rules', points: 5, keywords: ['signal', 'traffic', 'mirror', 'slow', 'speed', 'road', 'light', 'night'] },
        ],
      },
      {
        key: 'dw-money-1',
        category: 'Problem solving',
        difficulty: 'MEDIUM',
        text: 'A customer says they paid but you cannot find the record. What do you do?',
        hi: 'ग्राहक कहता है कि उसने भुगतान कर दिया है लेिन रिकॉर्ड नहीं मिलता। आप क्या करेंगे?',
        mr: 'ग्राहक सांगतो त्याने पैसे दिले पण नोंद सापत नाही. तुम्ही काय कराल?',
        ta: 'வாடிக்கையாளர் பணம் செலுத்தியதாகக் கூறுகிறார், ஆனால் பதிவைக் காண முடியவில்லை. நீங்கள் என்ன செய்கிறீர்கள்?',
        keywords: ['office', 'manager', 'record', 'check', 'call', 'system', 'receipt'],
        skillTags: ['RELIABILITY', 'ATTENTION_TO_DETAIL'],
        weight: 15,
        scoreMax: 10,
        guidance: 'Checks the record and escalates to the office rather than arguing with the customer.',
        instructions: 'Reward the escalation path. Penalise accusing the customer.',
        criteria: [
          { label: 'Checks the record', description: 'Verifies payment in the app or system', points: 5, keywords: ['app', 'record', 'check', 'system', 'online', 'number'] },
          { label: 'Escalates to the office', description: 'Calls the office or supervisor', points: 5, keywords: ['office', 'manager', 'supervisor', 'call', 'tell', 'report'] },
        ],
      },
    ],
  },
  {
    key: 'security-guard',
    title: 'Security Guard',
    description:
      'You will guard a gate or building entrance during the day or night shift, check who comes in, keep a register, and raise the alarm if something is wrong.',
    location: 'Mumbai Andheri',
    department: 'Facilities',
    minExperienceYears: 0,
    requiredSkills: ['Alertness', 'Record keeping', 'Communication', 'Physical fitness'],
    eligibilityCriteria: ['Able to work night shifts', 'No fear of working alone'],
    durationMinutes: 12,
    passingScore: 55,
    languages: ['en', 'hi', 'mr', 'ta'],
    weights: {
      relevantExperience: 20,
      jobKnowledge: 20,
      practicalUnderstanding: 25,
      safetyAwareness: 20,
      communication: 10,
      reliability: 5,
      other: 0,
    },
    proctoring: {
      level: 'STANDARD',
      cameraEnabled: false,
      detectMultiplePeople: true,
      detectFacingAway: true,
      facingAwaySeconds: 20,
      kioskFullscreenEnforced: true,
    },
    requirements: [
      { skillTag: 'AVAILABILITY', description: 'Can work night shifts on a rotating roster.', isKnockout: false },
      { skillTag: 'PHYSICAL_CONSIDERATION', description: 'Able to remain alert and on their feet for a full shift.', isKnockout: false },
    ],
    stages: [
      { kind: 'JOB_QUESTIONS', title: 'Guarding experience', instructions: 'Ask about previous security or watchman work.', maxQuestions: 3, sortOrder: 0 },
      { kind: 'JOB_QUESTIONS', title: 'Judgement on duty', instructions: 'Ask what they would do in a difficult situation.', maxQuestions: 3, sortOrder: 1 },
      { kind: 'JOB_QUESTIONS', title: 'Emergency', instructions: 'Ask about emergencies.', maxQuestions: 2, sortOrder: 2 },
    ],
    questions: [
      {
        key: 'sg-exp-1',
        category: 'Experience',
        difficulty: 'EASY',
        text: 'Have you worked as a guard or watchman before?',
        hi: 'क्या आपने पहले गार्ड या चौकीदार का काम किया है?',
        mr: 'तुम्ही आधी गार्ड किंवा चौकीदारचे काम केले आहे का?',
        ta: 'நீங்கள் முன்பு காவலன் அல்லது வார்த்தாக்காளராக பணியாறியிருந்தீர்களா?',
        keywords: ['guard', 'watchman', 'security', 'gate', 'patrol', 'shift', 'police'],
        skillTags: ['RELEVANT_EXPERIENCE'],
        weight: 20,
        scoreMax: 10,
        guidance: 'Any guarding, watchman, gate or security work, including informal work.',
        instructions: 'Accept informal security work, including village watchman duties.',
        criteria: [
          { label: 'Security experience', description: 'Has guarded a place, gate or building', points: 6, keywords: ['guard', 'watchman', 'security', 'gate', 'patrol', 'chowkidar'] },
          { label: 'Knows the routine', description: 'Mentions shifts, registers, or checking visitors', points: 4, keywords: ['shift', 'night', 'register', 'visitor', 'gate', 'entry', 'patrol'] },
        ],
        followUp: { question: 'Where did you work, and for how long?', trigger: 'ALWAYS' },
      },
      {
        key: 'sg-unknown-1',
        category: 'Problem solving',
        difficulty: 'MEDIUM',
        text: 'What would you do if you saw an unknown person entering the building?',
        hi: 'अगर कोई अजाना व्यक्ति इमारत में प्रवेश करे तो आप क्या करेंगे?',
        mr: 'कोणत्याही ओळखणारी व्यक्ती इमारतीत आली तर तुम्ही काय कराल?',
        ta: 'அறியாத ஒருவர் கட்டிடத்திற்குள் நுழைவதை நீங்கள் பார்த்தால் என்ன செய்வீர்கள்?',
        keywords: ['stop', 'ask', 'question', 'register', 'call', 'manager', 'police', 'deny', 'gate'],
        skillTags: ['PRACTICAL_UNDERSTANDING', 'COMMUNICATION'],
        weight: 25,
        scoreMax: 10,
        guidance: 'Stops the person, asks calmly, checks authorisation, records and escalates.',
        instructions: 'This is the core judgement question. Reward calm procedure over force.',
        criteria: [
          { label: 'Stops and questions', description: 'Stops the person and asks calmly who they are', points: 4, keywords: ['stop', 'ask', 'question', 'who', 'talk', 'polite', 'calm'] },
          { label: 'Checks authorisation', description: 'Asks for an id, entry pass or purpose', points: 3, keywords: ['id', 'card', 'pass', 'entry', 'purpose', 'call', 'office'] },
          { label: 'Records and escalates', description: 'Writes it in the register and informs the supervisor', points: 3, keywords: ['register', 'record', 'note', 'supervisor', 'manager', 'call', 'report'] },
        ],
        followUp: { question: 'What if the person refuses to give their name?', trigger: 'ALWAYS' },
      },
      {
        key: 'sg-emergency-1',
        category: 'Safety',
        difficulty: 'MEDIUM',
        text: 'What should you do during an emergency at the gate?',
        hi: 'गेट पर आपातकाल की स्थिति में आपको क्या करना चाहिए?',
        mr: 'गाटीवर आणीबाणीच्या वेळी तुम्हाला काय करायचे?',
        ta: 'வாயிலில் அவசர நிலை ஏற்பட்டால் நீங்கள் என்ன செய்ய வேண்டும்?',
        keywords: ['call', 'emergency', 'police', 'fire', 'ambulance', 'alarm', 'evacuate', 'manager', 'first aid'],
        skillTags: ['SAFETY_AWARENESS', 'PRACTICAL_UNDERSTANDING'],
        weight: 25,
        scoreMax: 10,
        guidance: 'Calls the emergency number, raises the alarm, keeps people away, sends for help.',
        instructions: 'Reward correct emergency escalation in the correct order.',
        criteria: [
          { label: 'Raises the alarm', description: 'Sounds the alarm or calls for help', points: 4, keywords: ['alarm', 'bell', 'shout', 'call', 'signal', 'radio'] },
          { label: 'Calls emergency services', description: 'Calls police, fire or ambulance', points: 4, keywords: ['police', 'fire', 'ambulance', 'emergency', '100', '101', '108'] },
          { label: 'Keeps people safe', description: 'Stops entry and guides people away from danger', points: 2, keywords: ['stop', 'guide', 'away', 'evacuate', 'open', 'safe'] },
        ],
      },
      {
        key: 'sg-night-1',
        category: 'Eligibility',
        difficulty: 'EASY',
        text: 'Can you work at night without sleeping?',
        hi: 'क्या आप रात को बिना सोए काम कर सकते हैं?',
        mr: 'तुम्ही रात्री झोपता नाहीत काम करू शकता का?',
        ta: 'தூக்காமல் இரவுப் பணியில் உழைக்க முடியுமா?',
        keywords: ['yes', 'no', 'night', 'sleep', 'shift', 'wake'],
        skillTags: ['AVAILABILITY', 'RELIABILITY'],
        weight: 10,
        scoreMax: 5,
        guidance: 'Confirms ability to stay alert through a night shift.',
        instructions: 'Record factually. Night-shift availability is also an eligibility criterion.',
        criteria: [{ label: 'Night shift availability', description: 'States ability to work through a night shift', points: 5, keywords: ['yes', 'night', 'shift', 'awake', 'sleep', 'ok'] }],
      },
      {
        key: 'sg-bored-1',
        category: 'Reliability',
        difficulty: 'MEDIUM',
        text: 'If nothing happens during your whole shift, how do you stay alert?',
        hi: 'अगर पूरी शिफ्ट में कुछ नहीं होता, तो आप कैसे जागरूक रहते हैं?',
        mr: 'संपूर्ण पाळी काहीही घडलं नाही, तर तुम्ही कसं जागतं राहता?',
        ta: 'உங்கள் முழு ஷிப்டிலும் எந்த செயலும் நடக்காவிட்டால் எப்படி விழித்திருக்கிறீர்கள்?',
        keywords: ['walk', 'check', 'round', 'rotate', 'write', 'watch', 'attention', 'phone'],
        skillTags: ['RELIABILITY', 'ATTENTION_TO_DETAIL'],
        weight: 15,
        scoreMax: 10,
        guidance: 'Active routine: rounds, register entries, changing position.',
        instructions: 'Reward an active, practical routine over sitting still.',
        criteria: [
          { label: 'Active routine', description: 'Walks rounds, checks periodically, changes position', points: 6, keywords: ['walk', 'round', 'patrol', 'check', 'move', 'rotate'] },
          { label: 'Keeps a record', description: 'Writes in the register throughout the shift', points: 4, keywords: ['write', 'register', 'note', 'diary', 'record', 'log'] },
        ],
      },
    ],
  },
];

/* -------------------------------------------------------------------------- */

export async function seed(
  prisma: PrismaClient,
  logger: Logger,
  options: {
    adminEmail: string;
    adminPassword: string | null;
    createExampleSession?: boolean;
    /** Reset the bootstrap administrator's password. Off by default. */
    resetAdminPassword?: boolean;
  },
): Promise<SeedResult> {
  let adminPassword = options.adminPassword;

  /* -- roles ------------------------------------------------------------- */
  for (const role of ROLE_PERMISSIONS) {
    const existing = await prisma.adminRole.findUnique({ where: { role: role.role as never } });
    if (existing) {
      await prisma.adminRole.update({
        where: { role: role.role as never },
        data: { description: role.description, ...(role.permissions.length > 0 ? { permissions: role.permissions } : {}) },
      });
    } else {
      await prisma.adminRole.create({
        data: { role: role.role as never, description: role.description, permissions: role.permissions },
      });
    }
  }
  logger.info('seed_roles_ready');

  /* -- languages --------------------------------------------------------- */
  for (const language of LANGUAGES) {
    await prisma.language.upsert({
      where: { code: language.code },
      create: { ...language, enabled: true },
      update: { name: language.name, nativeName: language.nativeName, sttLocale: language.sttLocale, ttsVoiceHint: language.ttsVoiceHint, sortOrder: language.sortOrder },
    });
  }
  const languages = await prisma.language.findMany({ where: { code: { in: LANGUAGES.map((l) => l.code) } } });
  const languageIdByCode = new Map(languages.map((l) => [l.code, l.id]));
  logger.info('seed_languages_ready', { count: languages.length });

  /* -- admin ------------------------------------------------------------- */
  const superAdminRoleId = (await prisma.adminRole.findUniqueOrThrow({ where: { role: 'SUPER_ADMIN' } })).id;

  // The upsert key is the email, but roles live in a join table, so the role set is
  // reconciled separately. This keeps re-running the seed safe.
  const admin = await prisma.user.upsert({
    where: { email: options.adminEmail.toLowerCase() },
    update: {},
    create: {
      email: options.adminEmail.toLowerCase(),
      name: 'Bootstrap Administrator',
      passwordHash: await hashPassword(options.adminPassword ?? 'ChangeMe!Admin2026#'),
      status: 'ACTIVE',
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: superAdminRoleId } },
    update: {},
    create: { userId: admin.id, roleId: superAdminRoleId },
  });

  // Deliberately opt-in: a deploy must never silently change a working administrator's
  // password. Operators who genuinely need to reset it pass --reset-admin-password.
  if (options.resetAdminPassword && options.adminPassword) {
    await prisma.user.update({
      where: { id: admin.id },
      data: { passwordHash: await hashPassword(options.adminPassword), status: 'ACTIVE' },
    });
    adminPassword = options.adminPassword;
    logger.info('seed_admin_password_reset', { email: admin.email });
  }

  // A reviewer account is created too, so the review flow is demonstrable immediately.
  const reviewerRoleId = (await prisma.adminRole.findUniqueOrThrow({ where: { role: 'REVIEWER' } })).id;
  const reviewer = await prisma.user.upsert({
    where: { email: 'reviewer@example.org' },
    update: {},
    create: {
      email: 'reviewer@example.org',
      name: 'Demo Reviewer',
      passwordHash: await hashPassword('ReviewMe!Review2026#'),
      status: 'ACTIVE',
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: reviewer.id, roleId: reviewerRoleId } },
    update: {},
    create: { userId: reviewer.id, roleId: reviewerRoleId },
  });
  logger.info('seed_admin_ready', { email: admin.email });

  /* -- question categories ------------------------------------------------ */
  const categories = ['Experience', 'Job knowledge', 'Safety', 'Problem solving', 'Eligibility', 'Reliability'];
  for (const [index, name] of categories.entries()) {
    await prisma.questionCategory.upsert({
      where: { name },
      update: {},
      create: { name, sortOrder: index, description: `${name} questions for this role.` },
    });
  }

  /* -- jobs --------------------------------------------------------------- */
  const jobIds: string[] = [];
  let questionCount = 0;

  for (const seedJob of JOBS) {
    // Prisma's upsert needs a unique key, and title is not one. Resolve the id first.
    const existingJobId = await findJobIdByTitle(prisma, seedJob.title);
    const job = existingJobId
      ? await prisma.job.update({ where: { id: existingJobId }, data: jobSeedData(seedJob, admin.id) })
      : await prisma.job.create({ data: { ...jobSeedData(seedJob, admin.id), stages: undefined, requirements: undefined } });
    jobIds.push(job.id);

    // Stages and requirements are rebuilt so the seed is authoritative.
    await prisma.interviewStage.deleteMany({ where: { jobId: job.id } });
    const stageIds: string[] = [];
    for (const stage of seedJob.stages) {
      const created = await prisma.interviewStage.create({
        data: {
          jobId: job.id,
          kind: stage.kind as never,
          title: stage.title,
          instructions: stage.instructions,
          maxQuestions: stage.maxQuestions,
          sortOrder: stage.sortOrder,
        },
      });
      stageIds.push(created.id);
    }

    await prisma.jobRequirement.deleteMany({ where: { jobId: job.id } });
    for (const [index, req] of seedJob.requirements.entries()) {
      await prisma.jobRequirement.create({
        data: {
          jobId: job.id,
          skillTag: req.skillTag,
          description: req.description,
          isKnockout: req.isKnockout,
          ...(req.knockoutMessage ? { knockoutMessage: req.knockoutMessage } : {}),
          sortOrder: index,
        },
      });
    }

    await prisma.jobPreferredLanguage.deleteMany({ where: { jobId: job.id } });
    await prisma.jobPreferredLanguage.createMany({
      data: seedJob.languages
        .map((code) => languageIdByCode.get(code))
        .filter((id): id is string => Boolean(id))
        .map((languageId) => ({ jobId: job.id, languageId })),
      skipDuplicates: true,
    });

    // Questions are keyed by their English text so re-seeding updates rather than duplicates.
    for (const [index, seedQuestion] of seedJob.questions.entries()) {
      const stageId = stageIds[Math.min(index, stageIds.length - 1)] ?? null;
      const existing = await prisma.question.findFirst({
        where: { jobId: job.id, text: seedQuestion.text },
        include: { scoringCriteria: true, followUpRules: true, translations: true },
      });

      if (existing) {
        await prisma.question.update({
          where: { id: existing.id },
          data: {
            stageId,
            categoryName: seedQuestion.category,
            difficulty: seedQuestion.difficulty,
            keywords: seedQuestion.keywords,
            skillTags: seedQuestion.skillTags,
            weight: seedQuestion.weight,
            scoreMax: seedQuestion.scoreMax,
            expectedAnswerGuidance: seedQuestion.guidance,
            evaluationInstructions: seedQuestion.instructions,
            sortOrder: index,
            isActive: true,
            validationStatus: 'VALID',
          },
        });
        await replaceChildren(prisma, existing.id, seedQuestion);
        continue;
      }

      const created = await prisma.question.create({
        data: {
          jobId: job.id,
          stageId,
          categoryName: seedQuestion.category,
          difficulty: seedQuestion.difficulty,
          baseLanguage: 'en',
          text: seedQuestion.text,
          expectedAnswerGuidance: seedQuestion.guidance,
          evaluationInstructions: seedQuestion.instructions,
          keywords: seedQuestion.keywords,
          skillTags: seedQuestion.skillTags,
          weight: seedQuestion.weight,
          scoreMax: seedQuestion.scoreMax,
          scoreMin: 0,
          isRequired: true,
          maxRetries: 2,
          sortOrder: index,
          source: 'ADMIN',
          isActive: true,
          validationStatus: 'VALID',
          approvedAt: new Date(),
          approvedById: admin.id,
          createdById: admin.id,
        },
      });
      await prisma.questionVersion.create({
        data: {
          questionId: created.id,
          version: 1,
          snapshot: { text: seedQuestion.text, scoreMax: seedQuestion.scoreMax, weight: seedQuestion.weight, source: 'seed' } as never,
          changeNote: 'Seeded version',
          createdById: admin.id,
        },
      });
      await replaceChildren(prisma, created.id, seedQuestion);
      questionCount += 1;
    }

    logger.info('seed_job_ready', { job: seedJob.title, questions: seedJob.questions.length, stages: stageIds.length });
  }

  let exampleSessionId: string | null = null;
  if (options.createExampleSession !== false && jobIds[0]) {
    exampleSessionId = await seedExampleSession(prisma, logger, jobIds[0]!, jobIds[1]!, languages);
  }

  return {
    adminEmail: admin.email,
    adminPassword: adminPassword ?? (options.adminPassword ? null : 'ChangeMe!Admin2026#'),
    jobs: jobIds,
    questions: questionCount,
    exampleSessionId,
  };
}

async function replaceChildren(prisma: PrismaClient, questionId: string, seedQuestion: SeedQuestion): Promise<void> {
  await prisma.scoringCriterion.deleteMany({ where: { questionId } });
  for (const [index, criterion] of seedQuestion.criteria.entries()) {
    await prisma.scoringCriterion.create({
      data: {
        questionId,
        label: criterion.label,
        description: criterion.description,
        points: criterion.points,
        keywords: criterion.keywords,
        sortOrder: index,
      },
    });
  }
  if (seedQuestion.followUp) {
    await prisma.followUpRule.create({
      data: {
        questionId,
        questionText: seedQuestion.followUp.question,
        trigger: seedQuestion.followUp.trigger,
        maxUses: 1,
        sortOrder: 0,
      },
    });
  }
  await prisma.questionTranslation.deleteMany({ where: { questionId } });
  const translations = await prisma.language.findMany({ where: { code: { in: ['hi', 'mr', 'ta'] } } });
  const textByCode: Record<string, string> = { hi: seedQuestion.hi, mr: seedQuestion.mr, ta: seedQuestion.ta };
  for (const language of translations) {
    const text = textByCode[language.code];
    if (!text) continue;
    await prisma.questionTranslation.create({
      data: { questionId, languageId: language.id, text, speakText: text },
    });
  }
}

/** Column data for a seeded job. Nested stages/requirements are written separately. */
function jobSeedData(seedJob: SeedJob, adminId: string) {
  return {
    title: seedJob.title,
    description: seedJob.description,
    location: seedJob.location,
    department: seedJob.department,
    minExperienceYears: seedJob.minExperienceYears,
    requiredSkills: seedJob.requiredSkills,
    eligibilityCriteria: seedJob.eligibilityCriteria,
    interviewDurationMinutes: seedJob.durationMinutes,
    passingScore: seedJob.passingScore,
    weights: seedJob.weights as never,
    proctoring: seedJob.proctoring as never,
    status: 'ACTIVE' as const,
    createdById: adminId,
  };
}

async function findJobIdByTitle(prisma: PrismaClient, title: string): Promise<string | null> {
  const job = await prisma.job.findFirst({ where: { title, deletedAt: null }, select: { id: true } });
  return job?.id ?? null;
}

/**
 * Creates one finished demo interview so the dashboard, candidate detail view and
 * report export all have real data on a fresh install.
 */
async function seedExampleSession(
  prisma: PrismaClient,
  logger: Logger,
  factoryJobId: string,
  deliveryJobId: string,
  languages: Array<{ id: string; code: string }>,
): Promise<string> {
  const existing = await prisma.interviewSession.findFirst({
    where: { isDemo: true, jobId: factoryJobId },
    select: { id: true },
  });
  if (existing) {
    logger.info('seed_example_session_exists', { sessionId: existing.id });
    return existing.id;
  }

  const questions = await prisma.question.findMany({
    where: { jobId: factoryJobId, isActive: true },
    include: { scoringCriteria: true },
    orderBy: { sortOrder: 'asc' },
  });
  const languageId = languages.find((l) => l.code === 'en')?.id ?? null;

  const startedAt = new Date(Date.now() - 86_400_000 * 2);
  const candidate = await prisma.candidate.create({
    data: {
      publicId: `cand_seed_${Math.random().toString(36).slice(2, 8)}`,
      name: 'Demo Candidate',
      age: 34,
      village: 'Sample Village',
      previousWork: 'Packing work in a food factory',
      yearsExperience: 4,
      workPreference: 'FULL_TIME',
      canTravel: true,
      languageCode: 'en',
    },
  });

  const session = await prisma.interviewSession.create({
    data: {
      publicId: `sess_seed_${Math.random().toString(36).slice(2, 8)}`,
      candidateId: candidate.id,
      jobId: factoryJobId,
      kioskId: 'seed-kiosk',
      stageKind: 'CLOSING',
      sessionState: 'COMPLETED',
      sessionStatus: 'COMPLETED',
      languageCode: 'en',
      languageId,
      consentRecorded: true,
      consentText: 'This interview uses your voice to understand your answers.',
      consentAt: startedAt,
      settingsSnapshot: { seeded: true, note: 'Demo session created by the seed script.' } as never,
      engineState: { seeded: true } as never,
      timeline: [
        { at: startedAt.toISOString(), kind: 'session_created', detail: 'Seeded demo session' },
        { at: new Date(startedAt.getTime() + 600_000).toISOString(), kind: 'session_completed', detail: 'Recommendation: GOOD_MATCH' },
      ] as never,
      questionIndex: questions.length,
      totalQuestions: questions.length,
      startedAt,
      completedAt: new Date(startedAt.getTime() + 600_000),
      durationSeconds: 600,
      isDemo: true,
      isLocked: true,
    },
  });

  const demoAnswers: Array<{ transcript: string; score: number; reason: string }> = [
    {
      transcript: 'I worked in a food packing factory for four years, on the packing line.',
      score: 8,
      reason: 'Described four years of comparable production-line packing work.',
    },
    {
      transcript: 'I used a sealing machine and a weighing machine. I learned by watching the senior person.',
      score: 7.5,
      reason: 'Named specific equipment and a supervised learning method.',
    },
    {
      transcript: 'I switch off the machine first, then I tell the supervisor. I do not touch it myself.',
      score: 9.5,
      reason: 'Stopped the machine, escalated to the supervisor, and did not investigate alone.',
    },
    {
      transcript: 'I wear helmet and gloves, and I keep the floor clear so nobody trips.',
      score: 9,
      reason: 'Named protective equipment and a clear-walkway habit.',
    },
    {
      transcript: 'Yes, I can do morning and evening shift, and also Saturday.',
      score: 5,
      reason: 'Confirmed availability for the offered shifts.',
    },
    {
      transcript: 'First I help him to finish. If it happens again I tell the supervisor.',
      score: 8.5,
      reason: 'Helped first, then escalated. No blame or gossip.',
    },
  ];

  for (const [index, question] of questions.entries()) {
    const demo = demoAnswers[index % demoAnswers.length]!;
    const ratio = question.scoreMax > 0 ? demo.score / 10 : 0;
    const rawScore = Math.min(question.scoreMax, question.scoreMax * ratio);

    const answer = await prisma.candidateAnswer.create({
      data: {
        sessionId: session.id,
        questionId: question.id,
        stageKind: 'JOB_QUESTIONS',
        transcript: demo.transcript,
        interpretation: `Candidate described their experience in relation to "${question.categoryName}".`,
        normalizedText: demo.transcript,
        spokenLanguage: 'en',
        sttConfidence: 0.82,
        attemptNumber: 1,
        answeredAt: new Date(startedAt.getTime() + (index + 1) * 45_000),
      },
    });

    await prisma.transcript.create({
      data: {
        sessionId: session.id,
        answerId: answer.id,
        kind: 'ANSWER',
        languageCode: 'en',
        source: 'STT',
        content: demo.transcript,
      },
    });

    await prisma.answerScore.create({
      data: {
        answerId: answer.id,
        questionId: question.id,
        rawScore,
        normalizedScore: Math.round((rawScore / Math.max(1, question.scoreMax)) * 100),
        maxScore: question.scoreMax,
        confidence: 0.78,
        evaluationReason: demo.reason,
        strengths: [demo.reason],
        concerns: [],
        aiNotes: 'Seeded demo evaluation produced by the deterministic rubric evaluator.',
        biasFlags: [],
        source: 'AI',
        criterionScores: {
          create: question.scoringCriteria.map((c) => ({
            criterionId: c.id,
            label: c.label,
            points: Math.min(c.points, c.points * ratio),
            maxPoints: c.points,
            hitKeywords: c.keywords.slice(0, 3),
            reasoning: demo.reason,
          })),
        },
      },
    });
  }

  const overallScore = 78;
  await prisma.evaluationReport.create({
    data: {
      sessionId: session.id,
      overallScore,
      maxScore: 100,
      recommendation: 'GOOD_MATCH',
      decisionSource: 'AI',
      summary:
        'Demo Candidate completed the Factory Worker screening with an overall score of 78 out of 100 against a passing score of 55.',
      experienceSummary: 'Four years of production-line packing work, with specific machine experience and supervised training.',
      eligibilityStatus: '2 of 2 eligibility criteria were confirmed.',
      skillScores: [
        { skill: 'relevantExperience', score: 32, max: 40, evidence: 'Four years comparable production work' },
        { skill: 'safetyAwareness', score: 17, max: 20, evidence: 'Stops machine and escalates; names protective equipment' },
        { skill: 'practicalUnderstanding', score: 16, max: 20, evidence: 'Describes specific tasks and equipment' },
        { skill: 'jobKnowledge', score: 13, max: 20, evidence: 'Machine familiarity demonstrated' },
      ] as never,
      strengths: ['Relevant Experience (80%)', 'Safety Awareness (85%)', 'Practical Understanding (80%)'],
      weaknesses: ['Job Knowledge (65%)'],
      concerns: ['Produced with demo AI providers. Not suitable for a real hiring decision.'],
      recommendedNextAction: 'Proceed to a human review of the recording before deciding.',
      methodology:
        'Weighted sum of per-question rubric scores, each decomposed into administrator-defined criteria. Accent, dialect, grammar, literacy, disability, health, age, religion, caste, gender, race and socioeconomic background were explicitly excluded.',
    },
  });

  // One proctoring event so the review queue is not empty.
  await prisma.proctoringEvent.create({
    data: {
      sessionId: session.id,
      type: 'WINDOW_BLURRED',
      severity: 'LOW',
      confidence: 0.61,
      description:
        'The kiosk window lost focus. This can happen when the operating system shows a notification, and is not itself a finding.',
      reference: 'detector:window-focus/blur-3',
      stageKind: 'JOB_QUESTIONS',
      requiresHumanReview: false,
      occurredAt: new Date(startedAt.getTime() + 240_000),
    },
  });

  logger.info('seed_example_session_ready', { sessionId: session.id, jobId: factoryJobId, answers: questions.length, deliveryJobId });
  return session.id;
}