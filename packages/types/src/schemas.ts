import { z } from 'zod';
import {
  DIFFICULTIES,
  FOLLOW_UP_MODES,
  IMPORT_STATUS,
  PERMISSIONS,
  PROCTOR_EVENT_TYPES,
  PROCTOR_LEVELS,
  RECOMMENDATIONS,
  REVIEW_STATES,
  ROLES,
  SESSION_STATES,
  SKILL_TAGS,
  STAGE_KINDS,
  VOICE_COMMANDS,
} from './enums.js';

const uuid = z.string().uuid();
const isoDate = z.string().datetime({ offset: true }).or(z.string().datetime());
const nonEmpty = z.string().trim().min(1);
const langCode = z
  .string()
  .trim()
  .min(2)
  .max(12)
  .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/, 'Must be a BCP-47 style language code, e.g. en, hi, mr');

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(200),
  totpCode: z.string().trim().regex(/^[0-9]{6}$/).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(200),
  newPassword: z.string().min(12).max(200),
});

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: nonEmpty.max(120),
  password: z.string().min(12).max(200),
  roles: z.array(z.enum(ROLES)).min(1),
  isActive: z.boolean().default(true),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = createUserSchema.partial().omit({ password: true });

export const userSchema = z.object({
  id: uuid,
  email: z.string().email(),
  name: z.string(),
  roles: z.array(z.enum(ROLES)),
  permissions: z.array(z.enum(PERMISSIONS)),
  isActive: z.boolean(),
  totpEnabled: z.boolean(),
  lastLoginAt: isoDate.nullable(),
  createdAt: isoDate,
});
export type UserDto = z.infer<typeof userSchema>;

/* ------------------------------------------------------------------ */
/* Languages & settings                                                */
/* ------------------------------------------------------------------ */

export const upsertLanguageSchema = z.object({
  code: langCode,
  name: nonEmpty.max(60),
  nativeName: nonEmpty.max(60),
  enabled: z.boolean().default(true),
  ttsVoiceHint: z.string().max(120).optional(),
  sttLocale: z.string().max(24).optional(),
  sortOrder: z.number().int().min(0).max(999).default(0),
});
export type UpsertLanguageInput = z.infer<typeof upsertLanguageSchema>;

export const languageSchema = z.object({
  id: uuid,
  code: langCode,
  name: z.string(),
  nativeName: z.string(),
  enabled: z.boolean(),
  ttsVoiceHint: z.string().nullable(),
  sttLocale: z.string().nullable(),
  sortOrder: z.number().int(),
});
export type LanguageDto = z.infer<typeof languageSchema>;

export const systemSettingsSchema = z.object({
  general: z.object({
    siteName: z.string().max(80),
    defaultLanguage: langCode,
    fallbackLanguage: langCode,
    supportedLanguages: z.array(langCode).min(1),
    timezone: z.string().max(64),
    privacyNoticeRequired: z.boolean(),
    jurisdictionNote: z.string().max(2000),
  }),
  voice: z.object({
    provider: z.string(),
    ttsProvider: z.string(),
    sttProvider: z.string(),
    rate: z.number().min(0.4).max(1.8),
    pitch: z.number().min(0.4).max(1.6),
    volume: z.number().min(0).max(1),
    slowRate: z.number().min(0.4).max(1.2),
    interruptible: z.boolean(),
    maxAnswerSeconds: z.number().int().min(15).max(900),
    silenceTimeoutSeconds: z.number().int().min(3).max(60),
    bargeInEnabled: z.boolean(),
  }),
  interview: z.object({
    maxDurationMinutes: z.number().int().min(1).max(240),
    retryLimit: z.number().int().min(0).max(5),
    simplifyAfterAttempts: z.number().int().min(1).max(5),
    followUpMode: z.enum(FOLLOW_UP_MODES),
    maxFollowUpsPerQuestion: z.number().int().min(0).max(5),
    repeatWelcome: z.boolean(),
    sessionIdleResetMinutes: z.number().int().min(1).max(120),
    kioskResetDelaySeconds: z.number().int().min(0).max(600),
    interviewerPromptOverride: z.string().max(4000),
    discloseScoreToCandidate: z.boolean(),
  }),
  scoring: z.object({
    strictness: z.enum(['LENIENT', 'BALANCED', 'STRICT']),
    passingScore: z.number().min(0).max(100),
    confidenceFloor: z.number().min(0).max(1),
    requireHumanReviewBelowConfidence: z.number().min(0).max(1),
    autoRecommend: z.boolean(),
  }),
  proctoring: z.object({
    level: z.enum(PROCTOR_LEVELS),
    cameraEnabled: z.boolean(),
    detectMultiplePeople: z.boolean(),
    detectFacingAway: z.boolean(),
    facingAwaySeconds: z.number().int().min(5).max(600),
    kioskFullscreenEnforced: z.boolean(),
    snapshotOnEvent: z.boolean(),
  }),
  recording: z.object({
    storeAudio: z.boolean(),
    storeTranscript: z.boolean(),
    recordingRetentionDays: z.number().int().min(1).max(3650),
    transcriptRetentionDays: z.number().int().min(1).max(3650),
    candidateDataRetentionDays: z.number().int().min(1).max(3650),
    signedUrlTtlSeconds: z.number().int().min(30).max(86400),
    anonymizeTranscriptsAfterDays: z.number().int().min(1).max(3650).nullable(),
  }),
  ai: z.object({
    llmProvider: z.string(),
    evaluationProvider: z.string(),
    model: z.string(),
    evaluationModel: z.string(),
    temperature: z.number().min(0).max(1),
    maxTokens: z.number().int().min(128).max(8192),
    demoMode: z.boolean(),
  }),
  kiosk: z.object({
    kioskId: z.string().max(64),
    sessionTimeoutMinutes: z.number().int().min(1).max(480),
    preventRefresh: z.boolean(),
    clearLocalDataOnReset: z.boolean(),
    autoStartAudio: z.boolean(),
    requireWakeWord: z.boolean(),
    accessibility: z.object({
      reducedMotion: z.boolean(),
      highContrast: z.boolean(),
      largeText: z.boolean(),
    }),
  }),
});
export type SystemSettings = z.infer<typeof systemSettingsSchema>;

export const settingsPatchSchema = systemSettingsSchema.deepPartial();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

export const jobRequirementSchema = z.object({
  id: uuid.optional(),
  skillTag: z.enum(SKILL_TAGS),
  description: z.string().max(500),
  minimumLevel: z.number().min(0).max(5).default(0),
  isKnockout: z.boolean().default(false),
  knockoutMessage: z.string().max(300).optional(),
});
export type JobRequirementInput = z.infer<typeof jobRequirementSchema>;

export const upsertJobSchema = z.object({
  title: nonEmpty.max(120),
  description: z.string().max(5000).default(''),
  location: z.string().max(200).default(''),
  department: z.string().max(120).default(''),
  minExperienceYears: z.number().min(0).max(60).default(0),
  requiredSkills: z.array(z.string().max(60)).max(50).default([]),
  preferredLanguages: z.array(langCode).min(1),
  eligibilityCriteria: z.array(z.string().max(300)).max(30).default([]),
  interviewDurationMinutes: z.number().int().min(1).max(240).default(15),
  passingScore: z.number().min(0).max(100).default(60),
  weights: z
    .object({
      relevantExperience: z.number().min(0).max(100).default(20),
      jobKnowledge: z.number().min(0).max(100).default(20),
      practicalUnderstanding: z.number().min(0).max(100).default(20),
      safetyAwareness: z.number().min(0).max(100).default(15),
      communication: z.number().min(0).max(100).default(10),
      reliability: z.number().min(0).max(100).default(10),
      other: z.number().min(0).max(100).default(5),
    })
    .default({}),
  stages: z
    .array(
      z.object({
        id: uuid.optional(),
        kind: z.enum(STAGE_KINDS),
        title: z.string().max(120),
        instructions: z.string().max(2000).default(''),
        maxQuestions: z.number().int().min(0).max(50).default(3),
        weight: z.number().min(0).max(100).default(0),
        sortOrder: z.number().int().min(0).max(100).default(0),
      }),
    )
    .min(1)
    .max(20),
  requirements: z.array(jobRequirementSchema).max(50).default([]),
  proctoring: z
    .object({
      level: z.enum(PROCTOR_LEVELS).default('BASIC'),
      cameraEnabled: z.boolean().default(false),
      detectMultiplePeople: z.boolean().default(true),
      detectFacingAway: z.boolean().default(false),
      facingAwaySeconds: z.number().int().min(5).max(600).default(20),
      kioskFullscreenEnforced: z.boolean().default(true),
    })
    .default({}),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).default('DRAFT'),
});
export type UpsertJobInput = z.infer<typeof upsertJobSchema>;

export const jobSummarySchema = z.object({
  id: uuid,
  title: z.string(),
  location: z.string(),
  department: z.string(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
  preferredLanguages: z.array(z.string()),
  questionCount: z.number().int(),
  interviewDurationMinutes: z.number().int(),
  passingScore: z.number(),
  candidateCount: z.number().int(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type JobSummaryDto = z.infer<typeof jobSummarySchema>;

export const jobDetailSchema = jobSummarySchema.extend({
  description: z.string(),
  minExperienceYears: z.number(),
  requiredSkills: z.array(z.string()),
  eligibilityCriteria: z.array(z.string()),
  weights: z.record(z.string(), z.number()),
  proctoring: z.record(z.string(), z.unknown()),
  stages: z.array(
    z.object({
      id: uuid,
      kind: z.enum(STAGE_KINDS),
      title: z.string(),
      instructions: z.string(),
      maxQuestions: z.number().int(),
      weight: z.number(),
      sortOrder: z.number().int(),
    }),
  ),
  requirements: z.array(jobRequirementSchema.extend({ id: uuid })),
});
export type JobDetailDto = z.infer<typeof jobDetailSchema>;

/* ------------------------------------------------------------------ */
/* Questions                                                           */
/* ------------------------------------------------------------------ */

export const scoringCriterionSchema = z.object({
  id: uuid.optional(),
  label: nonEmpty.max(120),
  description: z.string().max(600).default(''),
  points: z.number().min(0).max(100).default(0),
  keywords: z.array(z.string().max(60)).max(30).default([]),
  isKnockout: z.boolean().default(false),
  knockoutMessage: z.string().max(300).optional(),
  /** Display order within the question; matters because criteria are read aloud in order. */
  sortOrder: z.number().int().min(0).max(50).default(0),
});
export type ScoringCriterionInput = z.infer<typeof scoringCriterionSchema>;

export const followUpRuleSchema = z.object({
  id: uuid.optional(),
  question: nonEmpty.max(400),
  trigger: z.enum(['ALWAYS', 'IF_POSITIVE', 'IF_NEGATIVE', 'IF_SHORT', 'MANUAL']).default('MANUAL'),
  maxUses: z.number().int().min(1).max(3).default(1),
  weight: z.number().min(0).max(100).default(0),
  sortOrder: z.number().int().min(0).max(50).default(0),
});
export type FollowUpRuleInput = z.infer<typeof followUpRuleSchema>;

export const questionTranslationSchema = z.object({
  languageCode: langCode,
  text: nonEmpty.max(1000),
  speakText: z.string().max(1000).optional(),
});
export type QuestionTranslationInput = z.infer<typeof questionTranslationSchema>;

export const upsertQuestionSchema = z.object({
  jobId: uuid.nullable().default(null),
  stageId: uuid.nullable().default(null),
  category: nonEmpty.max(80),
  difficulty: z.enum(DIFFICULTIES).default('EASY'),
  baseLanguage: langCode.default('en'),
  text: nonEmpty.max(1000),
  speakText: z.string().max(1000).optional(),
  expectedAnswerGuidance: z.string().max(2000).default(''),
  keywords: z.array(z.string().max(60)).max(40).default([]),
  skillTags: z.array(z.enum(SKILL_TAGS)).max(10).default([]),
  weight: z.number().min(0).max(100).default(10),
  scoreMax: z.number().min(0).max(100).default(10),
  scoreMin: z.number().min(0).max(100).default(0),
  isRequired: z.boolean().default(true),
  isKnockout: z.boolean().default(false),
  knockoutMessage: z.string().max(300).optional(),
  maxRetries: z.number().int().min(0).max(5).default(2),
  timeLimitSeconds: z.number().int().min(15).max(1800).nullable().default(null),
  evaluationInstructions: z.string().max(2000).default(''),
  scoringCriteria: z.array(scoringCriterionSchema).max(20).default([]),
  followUpRules: z.array(followUpRuleSchema).max(6).default([]),
  translations: z.array(questionTranslationSchema).max(30).default([]),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  source: z.enum(['ADMIN', 'AI_SUGGESTED']).default('ADMIN'),
  isActive: z.boolean().default(true),
});
export type UpsertQuestionInput = z.infer<typeof upsertQuestionSchema>;
export type QuestionUpdateInput = Partial<UpsertQuestionInput>;

export const questionSchema = z.object({
  id: uuid,
  jobId: uuid.nullable(),
  stageId: uuid.nullable(),
  category: z.string(),
  difficulty: z.enum(DIFFICULTIES),
  baseLanguage: z.string(),
  text: z.string(),
  speakText: z.string().nullable(),
  expectedAnswerGuidance: z.string(),
  keywords: z.array(z.string()),
  skillTags: z.array(z.enum(SKILL_TAGS)),
  weight: z.number(),
  scoreMax: z.number(),
  scoreMin: z.number(),
  isRequired: z.boolean(),
  isKnockout: z.boolean(),
  knockoutMessage: z.string().nullable(),
  maxRetries: z.number().int(),
  timeLimitSeconds: z.number().int().nullable(),
  evaluationInstructions: z.string(),
  scoringCriteria: z.array(scoringCriterionSchema),
  followUpRules: z.array(followUpRuleSchema),
  translations: z.array(z.object({ id: uuid, languageCode: z.string(), text: z.string(), speakText: z.string().nullable() })),
  sortOrder: z.number().int(),
  source: z.enum(['ADMIN', 'AI_SUGGESTED']),
  isActive: z.boolean(),
  version: z.number().int(),
  validationStatus: z.enum(['UNVALIDATED', 'VALID', 'INVALID', 'NEEDS_TRANSLATION']),
  validationIssues: z.array(z.string()),
  approvedAt: isoDate.nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type QuestionDto = z.infer<typeof questionSchema>;

export const questionVersionSchema = z.object({
  version: z.number().int(),
  snapshot: z.record(z.string(), z.unknown()),
  createdAt: isoDate,
  createdBy: z.string().nullable(),
  changeNote: z.string().nullable(),
});
export type QuestionVersionDto = z.infer<typeof questionVersionSchema>;

/* ------------------------------------------------------------------ */
/* AI question suggestion                                              */
/* ------------------------------------------------------------------ */

export const suggestQuestionsSchema = z.object({
  jobId: uuid,
  count: z.number().int().min(1).max(20).default(6),
  language: langCode.default('en'),
  categories: z.array(z.enum(SKILL_TAGS)).max(10).default([]),
  difficulty: z.enum(DIFFICULTIES).default('MEDIUM'),
});
export type SuggestQuestionsInput = z.infer<typeof suggestQuestionsSchema>;

export const suggestQuestionsResponseSchema = z.object({
  suggestions: z.array(
    z.object({
      text: z.string(),
      category: z.string(),
      difficulty: z.enum(DIFFICULTIES),
      expectedAnswerGuidance: z.string(),
      keywords: z.array(z.string()),
      skillTags: z.array(z.enum(SKILL_TAGS)),
      weight: z.number(),
      scoreMax: z.number(),
      scoringCriteria: z.array(scoringCriterionSchema),
      followUpRules: z.array(followUpRuleSchema),
      translations: z.array(questionTranslationSchema),
      safetyNotes: z.string(),
    }),
  ),
});
export type SuggestQuestionsResponse = z.infer<typeof suggestQuestionsResponseSchema>;

/* ------------------------------------------------------------------ */
/* Question import / export                                            */
/* ------------------------------------------------------------------ */

export const questionImportSchema = z.object({
  jobId: uuid,
  format: z.enum(['CSV', 'JSON']),
  payload: z.string().min(1).max(5_000_000),
  dryRun: z.boolean().default(true),
});
export type QuestionImportInput = z.infer<typeof questionImportSchema>;

export const importRowErrorSchema = z.object({
  row: z.number().int(),
  column: z.string(),
  message: z.string(),
  value: z.string().optional(),
});
export type ImportRowError = z.infer<typeof importRowErrorSchema>;

export const importResultSchema = z.object({
  importId: uuid,
  status: z.enum(IMPORT_STATUS),
  totalRows: z.number().int(),
  validRows: z.number().int(),
  errorRows: z.number().int(),
  errors: z.array(importRowErrorSchema),
  createdQuestionIds: z.array(uuid).default([]),
});
export type ImportResultDto = z.infer<typeof importResultSchema>;

/* ------------------------------------------------------------------ */
/* Candidates & sessions                                               */
/* ------------------------------------------------------------------ */

export const startSessionSchema = z.object({
  jobId: uuid,
  kioskId: z.string().max(64).default('default'),
  languageCode: langCode.optional(),
  consentGiven: z.boolean().optional(),
  demoMode: z.boolean().default(false),
});
export type StartSessionInput = z.infer<typeof startSessionSchema>;

export const sessionSchema = z.object({
  sessionId: uuid,
  publicId: z.string(),
  state: z.enum(SESSION_STATES),
  stage: z.string().nullable(),
  jobId: uuid,
  jobTitle: z.string(),
  languageCode: z.string(),
  consentRecorded: z.boolean(),
  consentText: z.string().nullable(),
  questionIndex: z.number().int(),
  totalQuestions: z.number().int(),
  startedAt: isoDate,
  completedAt: isoDate.nullable(),
  settingsSnapshot: z.record(z.string(), z.unknown()),
  /** Which pipeline carried the audio: "livekit" (cloud agent) or "browser". */
  voiceTransport: z.string().optional(),
  /** LiveKit Cloud room for the interview, when the cloud agent is in use. */
  livekitRoomName: z.string().nullable().optional(),
  /** Running cloud voice-agent instance, for live admin status. */
  voiceAgentSessionId: z.string().nullable().optional(),
  voiceConnectedAt: isoDate.nullable().optional(),
});
export type SessionDto = z.infer<typeof sessionSchema>;

export const sessionSnapshotSchema = z.object({
  sessionId: uuid,
  publicId: z.string(),
  state: z.enum(SESSION_STATES),
  stageKind: z.enum(STAGE_KINDS),
  languageCode: z.string(),
  jobId: uuid,
  answers: z.array(
    z.object({
      questionId: uuid.nullable(),
      promptKey: z.string(),
      transcript: z.string(),
      isSkipped: z.boolean().default(false),
      spokenLanguage: z.string().nullable().default(null),
    }),
  ),
  candidateProfile: z.record(z.string(), z.unknown()).default({}),
  questionIndex: z.number().int().default(0),
  totalQuestions: z.number().int().default(0),
  retryCount: z.number().int().default(0),
  simplifyCount: z.number().int().default(0),
  history: z.array(z.record(z.string(), z.unknown())).default([]),
  lastSpokenAt: isoDate.nullable().default(null),
});
export type SessionSnapshotDto = z.infer<typeof sessionSnapshotSchema>;

export const candidateSchema = z.object({
  id: uuid,
  publicId: z.string(),
  name: z.string().nullable(),
  age: z.number().int().nullable(),
  village: z.string().nullable(),
  previousWork: z.string().nullable(),
  yearsExperience: z.number().nullable(),
  workPreference: z.string().nullable(),
  canTravel: z.boolean().nullable(),
  phone: z.string().nullable(),
  languageCode: z.string(),
  consentRecorded: z.boolean(),
});
export type CandidateDto = z.infer<typeof candidateSchema>;

export const candidateAnswerSchema = z.object({
  id: uuid,
  questionId: uuid.nullable(),
  questionText: z.string(),
  questionCategory: z.string().nullable(),
  questionVersion: z.number().int().nullable(),
  stageKind: z.string().nullable(),
  /** Raw speech-to-text output, unmodified. */
  transcript: z.string(),
  /** Structured intent/meaning extraction performed by the AI. */
  interpretation: z.string().nullable(),
  isCommand: z.boolean(),
  command: z.enum(VOICE_COMMANDS).nullable(),
  isSkipped: z.boolean(),
  spokenLanguage: z.string().nullable(),
  answeredAt: isoDate,
  durationMs: z.number().int().nullable(),
  audioRecordingId: uuid.nullable(),
});
export type CandidateAnswerDto = z.infer<typeof candidateAnswerSchema>;

export const answerScoreSchema = z.object({
  id: uuid,
  questionId: uuid.nullable(),
  rawScore: z.number(),
  normalizedScore: z.number(),
  maxScore: z.number(),
  confidence: z.number(),
  evaluationReason: z.string(),
  strengths: z.array(z.string()),
  concerns: z.array(z.string()),
  aiNotes: z.string(),
  criterionScores: z.array(
    z.object({
      label: z.string(),
      points: z.number(),
      max: z.number(),
      hitKeywords: z.array(z.string()),
    }),
  ),
  biasFlags: z.array(z.string()),
  source: z.enum(['AI', 'HUMAN_REVIEWED', 'HUMAN_OVERRIDDEN']),
  reviewerId: z.string().nullable(),
  reviewerComment: z.string().nullable(),
  reviewedAt: isoDate.nullable(),
});
export type AnswerScoreDto = z.infer<typeof answerScoreSchema>;

export const proctorEventSchema = z.object({
  id: uuid,
  type: z.enum(PROCTOR_EVENT_TYPES),
  occurredAt: isoDate,
  confidence: z.number(),
  severity: z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH']),
  description: z.string(),
  reference: z.string().nullable(),
  snapshotUrl: z.string().nullable(),
  stageKind: z.string().nullable(),
  acknowledged: z.boolean(),
});
export type ProctorEventDto = z.infer<typeof proctorEventSchema>;

export const reportSchema = z.object({
  id: uuid,
  sessionId: uuid,
  overallScore: z.number(),
  maxScore: z.number(),
  recommendation: z.enum(RECOMMENDATIONS),
  decisionSource: z.enum(['AI', 'HUMAN_REVIEWED', 'HUMAN_OVERRIDDEN']),
  summary: z.string(),
  experienceSummary: z.string(),
  eligibilityStatus: z.string(),
  skillScores: z.array(z.object({ skill: z.string(), score: z.number(), max: z.number(), evidence: z.string() })),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  concerns: z.array(z.string()),
  recommendedNextAction: z.string(),
  /** Machine-readable explanation of how the score was reached. */
  methodology: z.string().default(''),
  isAiAssisted: z.literal(true),
  disclaimer: z.string(),
  proctorEventCount: z.number().int(),
  knockoutTriggered: z.boolean(),
  generatedAt: isoDate,
});
export type ReportDto = z.infer<typeof reportSchema>;

export const sessionDetailSchema = z.object({
  session: sessionSchema,
  candidate: candidateSchema,
  answers: z.array(candidateAnswerSchema),
  scores: z.array(answerScoreSchema),
  proctorEvents: z.array(proctorEventSchema),
  report: reportSchema.nullable(),
  recordings: z.array(z.object({ id: uuid, kind: z.string(), durationMs: z.number().int().nullable(), createdAt: isoDate })),
  reviewState: z.enum(REVIEW_STATES),
  reviewerNotes: z.array(
    z.object({ id: uuid, author: z.string(), note: z.string(), createdAt: isoDate, decision: z.string().nullable() }),
  ),
  timeline: z.array(z.object({ at: isoDate, kind: z.string(), detail: z.string() })),
});
export type SessionDetailDto = z.infer<typeof sessionDetailSchema>;

export const candidateListItemSchema = z.object({
  sessionId: uuid,
  publicId: z.string(),
  candidateName: z.string().nullable(),
  jobTitle: z.string(),
  interviewDate: isoDate,
  status: z.enum(SESSION_STATES),
  overallScore: z.number().nullable(),
  recommendation: z.enum(RECOMMENDATIONS).nullable(),
  reviewState: z.enum(REVIEW_STATES),
  proctorStatus: z.enum(['CLEAR', 'EVENTS', 'REVIEW_REQUIRED']),
  languageCode: z.string(),
  isDemo: z.boolean(),
});
export type CandidateListItemDto = z.infer<typeof candidateListItemSchema>;

export const candidateListQuerySchema = z.object({
  jobId: uuid.optional(),
  languageCode: langCode.optional(),
  status: z.enum(SESSION_STATES).optional(),
  recommendation: z.enum(RECOMMENDATIONS).optional(),
  reviewState: z.enum(REVIEW_STATES).optional(),
  proctorStatus: z.enum(['CLEAR', 'EVENTS', 'REVIEW_REQUIRED']).optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  maxScore: z.coerce.number().min(0).max(100).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  search: z.string().max(120).optional(),
  isDemo: z.coerce.boolean().optional(),
  sort: z.enum(['date_desc', 'date_asc', 'score_desc', 'score_asc', 'name_asc']).default('date_desc'),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type CandidateListQuery = z.infer<typeof candidateListQuerySchema>;

export const paginatedSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  });

export const reviewSubmissionSchema = z.object({
  answerScores: z
    .array(
      z.object({
        answerScoreId: uuid,
        rawScore: z.number().min(0).max(100).optional(),
        reviewerComment: z.string().max(2000).optional(),
      }),
    )
    .default([]),
  overallScoreOverride: z.number().min(0).max(100).optional(),
  recommendationOverride: z.enum(RECOMMENDATIONS).optional(),
  notes: z.string().max(4000).optional(),
  markReviewed: z.boolean().default(true),
});
export type ReviewSubmissionInput = z.infer<typeof reviewSubmissionSchema>;

/* ------------------------------------------------------------------ */
/* Proctoring (kiosk → API)                                            */
/* ------------------------------------------------------------------ */

export const proctorEventReportSchema = z.object({
  type: z.enum(PROCTOR_EVENT_TYPES),
  confidence: z.number().min(0).max(1),
  occurredAt: isoDate.optional(),
  stageKind: z.enum(STAGE_KINDS).optional(),
  description: z.string().max(500).optional(),
  reference: z.string().max(300).optional(),
  snapshotBase64: z.string().max(2_000_000).optional(),
});
export type ProctorEventReportInput = z.infer<typeof proctorEventReportSchema>;

/* ------------------------------------------------------------------ */
/* Audio / uploads                                                     */
/* ------------------------------------------------------------------ */

export const audioUploadTicketSchema = z.object({
  answerId: uuid.nullable().default(null),
  kind: z.enum(['ANSWER', 'FULL_SESSION']).default('ANSWER'),
  contentType: z.enum(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav']).default('audio/webm'),
  durationMs: z.number().int().min(0).max(3_600_000).default(0),
});
export type AudioUploadTicketInput = z.infer<typeof audioUploadTicketSchema>;

export const audioUploadTicketDtoSchema = z.object({
  uploadUrl: z.string(),
  objectKey: z.string(),
  expiresAt: isoDate,
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
});

/* ------------------------------------------------------------------ */
/* Voice turn / websocket payloads                                     */
/* ------------------------------------------------------------------ */

/**
 * One recognised utterance, as sent over the WebSocket.
 * `type` is the protocol discriminator.
 */
export const voiceTurnSchema = z.object({
  type: z.literal('voice_turn'),
  transcript: z.string().max(4000),
  spokenLanguage: langCode.nullable().default(null),
  confidence: z.number().min(0).max(1).default(0.7),
  durationMs: z.number().int().min(0).max(3_600_000).default(0),
  isFinal: z.boolean().default(true),
  detectedAt: isoDate.optional(),
});
export type VoiceTurnInput = z.infer<typeof voiceTurnSchema>;

export const sessionEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session_started'), sessionId: uuid, publicId: z.string(), state: z.string(), languageCode: z.string().nullable() }),
  z.object({ type: z.literal('speak'), text: z.string(), emotion: z.enum(['neutral', 'encouraging', 'listening', 'gentle_retry']).default('neutral'), rate: z.number().optional(), displayText: z.string().nullable().default(null), sequence: z.number().int().optional() }),
  z.object({ type: z.literal('listen'), hint: z.string().nullable().default(null), timeoutSeconds: z.number().int().optional(), retriesRemaining: z.number().int().optional(), sequence: z.number().int().optional() }),
  z.object({ type: z.literal('progress'), index: z.number().int(), total: z.number().int(), stage: z.string(), label: z.string().nullable().default(null) }),
  z.object({ type: z.literal('question'), questionId: uuid.nullable(), promptKey: z.string(), displayText: z.string().nullable().default(null) }),
  z.object({ type: z.literal('transcript'), answerId: uuid, text: z.string(), isFinal: z.boolean().default(true) }),
  z.object({ type: z.literal('understood'), answerId: uuid, interpretation: z.string(), confidence: z.number() }),
  z.object({ type: z.literal('command'), command: z.enum(VOICE_COMMANDS) }),
  z.object({ type: z.literal('state'), state: z.enum(SESSION_STATES), stageKind: z.enum(STAGE_KINDS) }),
  z.object({ type: z.literal('eligibility'), requirement: z.string(), passed: z.boolean(), message: z.string() }),
  z.object({ type: z.literal('knockout'), requirement: z.string(), message: z.string() }),
  z.object({ type: z.literal('completed'), sessionId: uuid, message: z.string() }),
  z.object({ type: z.literal('failed'), reason: z.string(), userMessage: z.string(), errorId: z.string().nullable().default(null) }),
  z.object({ type: z.literal('retry'), attempt: z.number().int(), maxRetries: z.number().int(), kind: z.enum(['UNINTELLIGIBLE', 'SILENCE', 'CONFIDENCE']) }),
  z.object({ type: z.literal('proctor_event'), eventId: uuid, proctorType: z.enum(PROCTOR_EVENT_TYPES), severity: z.string(), requiresReview: z.boolean() }),
  z.object({ type: z.literal('network'), online: z.boolean(), queued: z.number().int().default(0) }),
  z.object({ type: z.literal('system_say'), text: z.string(), kind: z.enum(['error', 'recovery', 'offline', 'info', 'consent']) }),
]);

export type SessionEvent = z.infer<typeof sessionEventSchema>;

/**
 * One recognised utterance, as sent over REST.
 *
 * Deliberately separate from `voiceTurnSchema`: the REST endpoint has no envelope, so
 * requiring the WebSocket's `type` discriminator here would reject every valid request.
 */
export const restVoiceTurnSchema = voiceTurnSchema
  .omit({ type: true })
  .extend({ sessionSecret: z.string().min(8).max(128) });

/** A session id as it appears in a kiosk URL. */
export const sessionIdParamSchema = z.object({ id: z.string().uuid('Malformed session id') });

export const clientWsMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), sessionId: uuid, publicId: z.string(), resume: z.boolean().default(false) }),
  voiceTurnSchema,
  z.object({ type: z.literal('advance') }),
  z.object({ type: z.literal('skip') }),
  z.object({ type: z.literal('consent'), given: z.boolean() }),
  z.object({ type: z.literal('select_language'), languageCode: langCode }),
  z.object({ type: z.literal('select_job'), jobId: uuid }),
  z.object({ type: z.literal('set_detail'), key: z.string().max(60), value: z.string().max(400) }),
  z.object({ type: z.literal('finish') }),
  z.object({ type: z.literal('ping'), at: z.number() }),
]);

export type ClientWsMessage = z.infer<typeof clientWsMessageSchema>;
export type ServerWsMessage = z.infer<typeof sessionEventSchema> | { type: 'pong'; at: number };

/* ------------------------------------------------------------------ */
/* Analytics                                                           */
/* ------------------------------------------------------------------ */

export const dashboardStatsSchema = z.object({
  totalCandidates: z.number().int(),
  interviewsToday: z.number().int(),
  completedInterviews: z.number().int(),
  pendingReviews: z.number().int(),
  averageScore: z.number().nullable(),
  passRate: z.number().nullable(),
  activeJobs: z.number().int(),
  proctoringAlerts: z.number().int(),
  dropoffByStage: z.array(z.object({ stage: z.string(), count: z.number().int() })),
  scoresByJob: z.array(z.object({ jobId: z.string(), jobTitle: z.string(), averageScore: z.number(), count: z.number().int() })),
  languageDistribution: z.array(z.object({ languageCode: z.string(), count: z.number().int() })),
  proctorEventStats: z.array(z.object({ type: z.string(), count: z.number().int() })),
  completionRate: z.number().nullable(),
});
export type DashboardStatsDto = z.infer<typeof dashboardStatsSchema>;

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  SESSION_LOCKED: 'SESSION_LOCKED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  NETWORK: 'NETWORK',
  MIC_UNAVAILABLE: 'MIC_UNAVAILABLE',
  SPEAKER_UNAVAILABLE: 'SPEAKER_UNAVAILABLE',
  STORAGE_ERROR: 'STORAGE_ERROR',
  DISCRIMINATORY_CONTENT: 'DISCRIMINATORY_CONTENT',
  IMMUTABLE_RECORD: 'IMMUTABLE_RECORD',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  /** The LiveKit Cloud voice agent or its credentials are not configured (spec §29). */
  VOICE_AI_NOT_CONFIGURED: 'VOICE_AI_NOT_CONFIGURED',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    userMessage: z.string().nullable().default(null),
    errorId: z.string().nullable().default(null),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorDto = z.infer<typeof apiErrorSchema>;

/** Safe, human-facing message shown to candidates. Never contains technical detail. */
export const CANDIDATE_SAFE_MESSAGES: Record<string, string> = {
  [ERROR_CODES.INTERNAL_ERROR]: 'There is a small technical problem. Please wait a moment.',
  [ERROR_CODES.PROVIDER_ERROR]: 'There is a small technical problem. Please wait a moment.',
  [ERROR_CODES.NETWORK]: 'The connection is temporarily lost. Please wait, we will continue.',
  [ERROR_CODES.MIC_UNAVAILABLE]: 'I cannot use the microphone. Please call the person at the desk for help.',
  [ERROR_CODES.SPEAKER_UNAVAILABLE]: 'I cannot play sound. Please call the person at the desk for help.',
  [ERROR_CODES.SESSION_EXPIRED]: 'This session has ended. Please start again from the beginning.',
  [ERROR_CODES.STORAGE_ERROR]: 'I could not save your answers. Please do not leave, help is on the way.',
  [ERROR_CODES.VOICE_AI_NOT_CONFIGURED]:
    'Voice AI service is not configured. Please configure LiveKit Cloud and the required AI provider credentials.',
};