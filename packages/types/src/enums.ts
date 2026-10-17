/**
 * Canonical enumerations shared by database, API, kiosk and admin apps.
 * These are string unions (not TS enums) so they survive JSON transport cleanly.
 */

export const SESSION_STATES = [
  'CREATED',
  'AWAITING_CONSENT',
  'AWAITING_LANGUAGE',
  'BASIC_DETAILS',
  'ELIGIBILITY_CHECK',
  'JOB_QUESTIONS',
  'FOLLOW_UP',
  'FINAL_REVIEW',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export const STAGE_KINDS = [
  'GREETING',
  'CONSENT',
  'LANGUAGE_SELECTION',
  'BASIC_DETAILS',
  'ELIGIBILITY_CHECK',
  'JOB_QUESTIONS',
  'FOLLOW_UP',
  'FINAL_REVIEW',
  'CLOSING',
] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const RECOMMENDATIONS = [
  'STRONG_MATCH',
  'GOOD_MATCH',
  'CONSIDER',
  'NOT_RECOMMENDED',
  'PENDING_REVIEW',
] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

export const REVIEW_STATES = ['NOT_STARTED', 'IN_PROGRESS', 'REVIEWED'] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export const DECISION_SOURCE = ['AI', 'HUMAN_REVIEWED', 'HUMAN_OVERRIDDEN'] as const;
export type DecisionSource = (typeof DECISION_SOURCE)[number];

export const SESSION_STATUS = ['ACTIVE', 'COMPLETED', 'ABANDONED', 'EXPIRED'] as const;
export type SessionStatus = (typeof SESSION_STATUS)[number];

export const ROLES = ['SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER', 'REVIEWER'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'job:read',
  'job:write',
  'job:archive',
  'question:read',
  'question:write',
  'question:publish',
  'candidate:read',
  'candidate:export',
  'candidate:delete',
  'recording:read',
  'review:write',
  'report:read',
  'report:export',
  'settings:read',
  'settings:write',
  'audit:read',
  'user:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Server-side role → permission map. Administrators may narrow these, never widen protected scoring. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS,
  RECRUITER: [
    'job:read',
    'job:write',
    'question:read',
    'question:write',
    'question:publish',
    'candidate:read',
    'candidate:export',
    'review:write',
    'report:read',
    'report:export',
    'settings:read',
  ],
  INTERVIEWER: ['job:read', 'question:read', 'candidate:read', 'report:read', 'review:write'],
  REVIEWER: [
    'job:read',
    'question:read',
    'candidate:read',
    'recording:read',
    'review:write',
    'report:read',
    'report:export',
  ],
} as const;

export const PROCTOR_EVENT_TYPES = [
  'CANDIDATE_LEFT_KIOSK',
  'MULTIPLE_PEOPLE_DETECTED',
  'FACING_AWAY',
  'MIC_DISCONNECTED',
  'CAMERA_DISCONNECTED',
  'CAMERA_UNAVAILABLE',
  'TAB_CHANGED',
  'WINDOW_BLURRED',
  'NETWORK_INTERRUPTED',
  'UNUSUAL_INTERRUPTION',
  'FULLSCREEN_EXITED',
] as const;
export type ProctorEventType = (typeof PROCTOR_EVENT_TYPES)[number];

export const PROCTOR_LEVELS = ['DISABLED', 'BASIC', 'STANDARD', 'ENHANCED'] as const;
export type ProctorLevel = (typeof PROCTOR_LEVELS)[number];

export const FOLLOW_UP_MODES = ['DISABLED', 'LIMITED', 'ALLOWED'] as const;
export type FollowUpMode = (typeof FOLLOW_UP_MODES)[number];

export const CONFIDENCE_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const QUESTION_SOURCES = ['ADMIN', 'AI_SUGGESTED'] as const;
export type QuestionSource = (typeof QUESTION_SOURCES)[number];

export const IMPORT_STATUS = ['PENDING', 'VALIDATED', 'FAILED', 'APPLIED'] as const;
export type ImportStatus = (typeof IMPORT_STATUS)[number];

/** Canonical voice commands the candidate may utter at any time. */
export const VOICE_COMMANDS = [
  'REPEAT',
  'SPEAK_SLOWLY',
  'DONT_UNDERSTAND',
  'NEXT',
  'GO_BACK',
  'DONT_KNOW',
  'STOP',
  'START_AGAIN',
  'HELP',
] as const;
export type VoiceCommand = (typeof VOICE_COMMANDS)[number];

/** Skills that a job may assess. Deliberately excludes protected characteristics. */
export const SKILL_TAGS = [
  'RELEVANT_EXPERIENCE',
  'JOB_KNOWLEDGE',
  'PRACTICAL_UNDERSTANDING',
  'SAFETY_AWARENESS',
  'RELIABILITY',
  'COMMUNICATION',
  'PHYSICAL_CONSIDERATION',
  'TOOL_USE',
  'CUSTOMER_HANDLING',
  'PROBLEM_SOLVING',
  'TEAMWORK',
  'ATTENTION_TO_DETAIL',
  'AVAILABILITY',
  'ELIGIBILITY',
] as const;
export type SkillTag = (typeof SKILL_TAGS)[number];

/**
 * Hard deny-list for AI follow-ups and admin-authored question content.
 * Enforced server-side in @proctor/ai so no client can bypass it.
 */
export const PROHIBITED_TOPIC_MARKERS: readonly string[] = [
  'religion',
  'religious',
  'caste',
  'race',
  'racist',
  'ethnicity',
  'ethnic',
  'colour of your skin',
  'color of your skin',
  'skin colour',
  'skin color',
  'political',
  'party',
  'election',
  'sexual',
  'sex life',
  'marital status',
  'married',
  'unmarried',
  'pregnan',
  'family planning',
  'family planning',
  'how many children',
  'abortion',
  'disability',
  'disabled',
  'illness',
  'medical history',
  'mental health',
  'depression',
  'hiv',
  'blood group',
  'astrology',
  'horoscope',
  'caste',
  'jati',
  'gotra',
  'nationality',
  'national origin',
  'mother tongue is not',
  'accent',
  'fairness of your face',
  'weight',
  'height',
  'beautiful',
  'handsome',
  'young looking',
  'smartness',
  'intelligence',
  'honesty',
  'trustworthy',
  // Age, phrased the way a question actually asks about it. The bare word "age" is not
  // enough: it appears in legitimate job content ("minimum age requirement", "age of the
  // machinery") and blocking the word outright would make those questions unpublishable.
  'how old are',
  'how old were',
  'how old is',
  'what age',
  'your age',
  'years old',
  'year old',
  'date of birth',
  'age limit',
  'too old',
  'too young',
  'underage',
  'character',
] as const;

/** Attributes that must never influence a candidate's score. */
export const PROTECTED_ATTRIBUTES: readonly string[] = [
  'gender',
  'sex',
  'religion',
  'caste',
  'race',
  'ethnicity',
  'colour',
  'color',
  'skin',
  'accent',
  'native language',
  'mother tongue',
  'disability',
  'illness',
  'health condition',
  'socioeconomic',
  'income',
  'family background',
  'appearance',
  'dialect',
  'fluency',
  'grammar',
  'literacy',
  'age',
] as const;