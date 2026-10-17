-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER', 'REVIEWER');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "StageKind" AS ENUM ('GREETING', 'CONSENT', 'LANGUAGE_SELECTION', 'BASIC_DETAILS', 'ELIGIBILITY_CHECK', 'JOB_QUESTIONS', 'FOLLOW_UP', 'FINAL_REVIEW', 'CLOSING');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "QuestionSource" AS ENUM ('ADMIN', 'AI_SUGGESTED');

-- CreateEnum
CREATE TYPE "ValidationStatus" AS ENUM ('UNVALIDATED', 'VALID', 'INVALID', 'NEEDS_TRANSLATION');

-- CreateEnum
CREATE TYPE "SessionState" AS ENUM ('CREATED', 'AWAITING_CONSENT', 'AWAITING_LANGUAGE', 'BASIC_DETAILS', 'ELIGIBILITY_CHECK', 'JOB_QUESTIONS', 'FOLLOW_UP', 'FINAL_REVIEW', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "Recommendation" AS ENUM ('STRONG_MATCH', 'GOOD_MATCH', 'CONSIDER', 'NOT_RECOMMENDED', 'PENDING_REVIEW');

-- CreateEnum
CREATE TYPE "ReviewState" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'REVIEWED');

-- CreateEnum
CREATE TYPE "DecisionSource" AS ENUM ('AI', 'HUMAN_REVIEWED', 'HUMAN_OVERRIDDEN');

-- CreateEnum
CREATE TYPE "ProctorEventType" AS ENUM ('CANDIDATE_LEFT_KIOSK', 'MULTIPLE_PEOPLE_DETECTED', 'FACING_AWAY', 'MIC_DISCONNECTED', 'CAMERA_DISCONNECTED', 'CAMERA_UNAVAILABLE', 'TAB_CHANGED', 'WINDOW_BLURRED', 'NETWORK_INTERRUPTED', 'UNUSUAL_INTERRUPTION', 'FULLSCREEN_EXITED');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "FollowUpTrigger" AS ENUM ('ALWAYS', 'IF_POSITIVE', 'IF_NEGATIVE', 'IF_SHORT', 'MANUAL');

-- CreateEnum
CREATE TYPE "FollowUpMode" AS ENUM ('DISABLED', 'LIMITED', 'ALLOWED');

-- CreateEnum
CREATE TYPE "RecordingKind" AS ENUM ('ANSWER', 'FULL_SESSION');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'VALIDATED', 'FAILED', 'APPLIED');

-- CreateEnum
CREATE TYPE "ProctorLevel" AS ENUM ('DISABLED', 'BASIC', 'STANDARD', 'ENHANCED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "AdminRole" (
    "id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "permissions" TEXT[],
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AdminRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "languages" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nativeName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "ttsVoiceHint" TEXT,
    "sttLocale" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "languages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_preferred_languages" (
    "jobId" UUID NOT NULL,
    "languageId" UUID NOT NULL,

    CONSTRAINT "job_preferred_languages_pkey" PRIMARY KEY ("jobId","languageId")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "department" TEXT NOT NULL DEFAULT '',
    "minExperienceYears" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "requiredSkills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "eligibilityCriteria" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "interviewDurationMinutes" INTEGER NOT NULL DEFAULT 15,
    "passingScore" DOUBLE PRECISION NOT NULL DEFAULT 60,
    "weights" JSONB NOT NULL DEFAULT '{}',
    "proctoring" JSONB NOT NULL DEFAULT '{}',
    "status" "JobStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interview_stages" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "kind" "StageKind" NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL DEFAULT '',
    "maxQuestions" INTEGER NOT NULL DEFAULT 3,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "categoryPool" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "interview_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_requirements" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "skillTag" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "minimumLevel" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isKnockout" BOOLEAN NOT NULL DEFAULT false,
    "knockoutMessage" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "job_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "question_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "jobId" UUID,
    "stageId" UUID,
    "categoryId" UUID,
    "categoryName" TEXT NOT NULL,
    "difficulty" "Difficulty" NOT NULL DEFAULT 'EASY',
    "baseLanguage" TEXT NOT NULL DEFAULT 'en',
    "text" TEXT NOT NULL,
    "speakText" TEXT,
    "expectedAnswerGuidance" TEXT NOT NULL DEFAULT '',
    "evaluationInstructions" TEXT NOT NULL DEFAULT '',
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skillTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "scoreMax" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "scoreMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "isKnockout" BOOLEAN NOT NULL DEFAULT false,
    "knockoutMessage" TEXT,
    "maxRetries" INTEGER NOT NULL DEFAULT 2,
    "timeLimitSeconds" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "source" "QuestionSource" NOT NULL DEFAULT 'ADMIN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "validationStatus" "ValidationStatus" NOT NULL DEFAULT 'UNVALIDATED',
    "validationIssues" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "approvedAt" TIMESTAMP(3),
    "approvedById" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_translations" (
    "id" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "languageId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "speakText" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_versions" (
    "id" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changeNote" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scoring_criteria" (
    "id" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "points" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isKnockout" BOOLEAN NOT NULL DEFAULT false,
    "knockoutMessage" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scoring_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_up_rules" (
    "id" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "questionText" TEXT NOT NULL,
    "trigger" "FollowUpTrigger" NOT NULL DEFAULT 'MANUAL',
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "follow_up_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidates" (
    "id" UUID NOT NULL,
    "publicId" TEXT NOT NULL,
    "name" TEXT,
    "age" INTEGER,
    "village" TEXT,
    "previousWork" TEXT,
    "yearsExperience" DOUBLE PRECISION,
    "workPreference" TEXT,
    "canTravel" BOOLEAN,
    "phone" TEXT,
    "extraDetails" JSONB NOT NULL DEFAULT '{}',
    "languageCode" TEXT NOT NULL DEFAULT 'en',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interview_sessions" (
    "id" UUID NOT NULL,
    "publicId" TEXT NOT NULL,
    "candidateId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "kioskId" TEXT NOT NULL DEFAULT 'default',
    "state" "StageKind" NOT NULL DEFAULT 'BASIC_DETAILS',
    "sessionState" "SessionState" NOT NULL DEFAULT 'CREATED',
    "sessionStatus" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "languageCode" TEXT NOT NULL DEFAULT 'en',
    "languageId" UUID,
    "consentRecorded" BOOLEAN NOT NULL DEFAULT false,
    "consentText" TEXT,
    "consentAt" TIMESTAMP(3),
    "settingsSnapshot" JSONB NOT NULL DEFAULT '{}',
    "engineState" JSONB NOT NULL DEFAULT '{}',
    "timeline" JSONB NOT NULL DEFAULT '[]',
    "questionIndex" INTEGER NOT NULL DEFAULT 0,
    "totalQuestions" INTEGER NOT NULL DEFAULT 0,
    "stageKind" "StageKind" NOT NULL DEFAULT 'BASIC_DETAILS',
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "knockoutTriggered" BOOLEAN NOT NULL DEFAULT false,
    "knockoutReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interview_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eligibility_results" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "requirement" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "isKnockout" BOOLEAN NOT NULL DEFAULT false,
    "message" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eligibility_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_answers" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "questionId" UUID,
    "questionVersionId" UUID,
    "stageKind" "StageKind" NOT NULL,
    "transcript" TEXT NOT NULL DEFAULT '',
    "interpretation" TEXT,
    "normalizedText" TEXT NOT NULL DEFAULT '',
    "spokenLanguage" TEXT,
    "sttConfidence" DOUBLE PRECISION,
    "isCommand" BOOLEAN NOT NULL DEFAULT false,
    "command" TEXT,
    "isSkipped" BOOLEAN NOT NULL DEFAULT false,
    "isDontKnow" BOOLEAN NOT NULL DEFAULT false,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "durationMs" INTEGER,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidate_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answer_scores" (
    "id" UUID NOT NULL,
    "answerId" UUID NOT NULL,
    "questionId" UUID,
    "rawScore" DOUBLE PRECISION NOT NULL,
    "normalizedScore" DOUBLE PRECISION NOT NULL,
    "maxScore" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evaluationReason" TEXT NOT NULL DEFAULT '',
    "strengths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "concerns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "aiNotes" TEXT NOT NULL DEFAULT '',
    "biasFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" "DecisionSource" NOT NULL DEFAULT 'AI',
    "reviewerId" UUID,
    "reviewerComment" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "answer_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answer_criterion_scores" (
    "id" UUID NOT NULL,
    "answerScoreId" UUID NOT NULL,
    "criterionId" UUID,
    "label" TEXT NOT NULL,
    "points" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxPoints" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hitKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reasoning" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "answer_criterion_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_up_questions" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "answerId" UUID NOT NULL,
    "ruleId" UUID,
    "question" TEXT NOT NULL,
    "spokenText" TEXT,
    "generatedBy" TEXT NOT NULL DEFAULT 'ADMIN',
    "isAiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_up_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcripts" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "answerId" UUID,
    "kind" TEXT NOT NULL DEFAULT 'ANSWER',
    "languageCode" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'STT',
    "content" TEXT NOT NULL,
    "isRedacted" BOOLEAN NOT NULL DEFAULT false,
    "redactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transcripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audio_recordings" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "answerId" UUID,
    "kind" "RecordingKind" NOT NULL DEFAULT 'ANSWER',
    "objectKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'audio/webm',
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "encrypted" BOOLEAN NOT NULL DEFAULT true,
    "consentBasis" TEXT NOT NULL DEFAULT 'JOB_APPLICATION',
    "purgeAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "audio_recordings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proctoring_events" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "type" "ProctorEventType" NOT NULL,
    "severity" "Severity" NOT NULL DEFAULT 'INFO',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL DEFAULT '',
    "reference" TEXT,
    "snapshotKey" TEXT,
    "stageKind" "StageKind",
    "requiresHumanReview" BOOLEAN NOT NULL DEFAULT false,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgedById" UUID,
    "acknowledgedAt" TIMESTAMP(3),
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proctoring_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proctoring_snapshots" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "objectKey" TEXT NOT NULL,
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "proctoring_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_reports" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "maxScore" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "recommendation" "Recommendation" NOT NULL DEFAULT 'PENDING_REVIEW',
    "decisionSource" "DecisionSource" NOT NULL DEFAULT 'AI',
    "summary" TEXT NOT NULL DEFAULT '',
    "experienceSummary" TEXT NOT NULL DEFAULT '',
    "eligibilityStatus" TEXT NOT NULL DEFAULT '',
    "skillScores" JSONB NOT NULL DEFAULT '[]',
    "strengths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "weaknesses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "concerns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recommendedNextAction" TEXT NOT NULL DEFAULT '',
    "methodology" TEXT NOT NULL DEFAULT '',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evaluation_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviewer_notes" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "decision" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviewer_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "payload" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "changedById" UUID,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_imports" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "format" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "createdQuestionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "question_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "previous" JSONB,
    "next" JSONB,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminRole_role_key" ON "AdminRole"("role");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_expiresAt_idx" ON "refresh_tokens"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "languages_code_key" ON "languages"("code");

-- CreateIndex
CREATE INDEX "jobs_status_deletedAt_idx" ON "jobs"("status", "deletedAt");

-- CreateIndex
CREATE INDEX "jobs_title_idx" ON "jobs"("title");

-- CreateIndex
CREATE INDEX "interview_stages_jobId_sortOrder_idx" ON "interview_stages"("jobId", "sortOrder");

-- CreateIndex
CREATE INDEX "job_requirements_jobId_sortOrder_idx" ON "job_requirements"("jobId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "question_categories_name_key" ON "question_categories"("name");

-- CreateIndex
CREATE INDEX "questions_jobId_stageId_sortOrder_idx" ON "questions"("jobId", "stageId", "sortOrder");

-- CreateIndex
CREATE INDEX "questions_jobId_isActive_idx" ON "questions"("jobId", "isActive");

-- CreateIndex
CREATE INDEX "questions_validationStatus_idx" ON "questions"("validationStatus");

-- CreateIndex
CREATE INDEX "question_translations_languageId_idx" ON "question_translations"("languageId");

-- CreateIndex
CREATE UNIQUE INDEX "question_translations_questionId_languageId_key" ON "question_translations"("questionId", "languageId");

-- CreateIndex
CREATE INDEX "question_versions_questionId_idx" ON "question_versions"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "question_versions_questionId_version_key" ON "question_versions"("questionId", "version");

-- CreateIndex
CREATE INDEX "scoring_criteria_questionId_sortOrder_idx" ON "scoring_criteria"("questionId", "sortOrder");

-- CreateIndex
CREATE INDEX "follow_up_rules_questionId_sortOrder_idx" ON "follow_up_rules"("questionId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "candidates_publicId_key" ON "candidates"("publicId");

-- CreateIndex
CREATE INDEX "candidates_name_idx" ON "candidates"("name");

-- CreateIndex
CREATE INDEX "candidates_createdAt_idx" ON "candidates"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "interview_sessions_publicId_key" ON "interview_sessions"("publicId");

-- CreateIndex
CREATE INDEX "interview_sessions_jobId_sessionStatus_idx" ON "interview_sessions"("jobId", "sessionStatus");

-- CreateIndex
CREATE INDEX "interview_sessions_sessionStatus_lastActivityAt_idx" ON "interview_sessions"("sessionStatus", "lastActivityAt");

-- CreateIndex
CREATE INDEX "interview_sessions_createdAt_idx" ON "interview_sessions"("createdAt");

-- CreateIndex
CREATE INDEX "interview_sessions_candidateId_idx" ON "interview_sessions"("candidateId");

-- CreateIndex
CREATE INDEX "eligibility_results_sessionId_idx" ON "eligibility_results"("sessionId");

-- CreateIndex
CREATE INDEX "candidate_answers_sessionId_answeredAt_idx" ON "candidate_answers"("sessionId", "answeredAt");

-- CreateIndex
CREATE INDEX "candidate_answers_questionId_idx" ON "candidate_answers"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "answer_scores_answerId_key" ON "answer_scores"("answerId");

-- CreateIndex
CREATE INDEX "answer_scores_questionId_idx" ON "answer_scores"("questionId");

-- CreateIndex
CREATE INDEX "answer_criterion_scores_answerScoreId_idx" ON "answer_criterion_scores"("answerScoreId");

-- CreateIndex
CREATE INDEX "follow_up_questions_sessionId_idx" ON "follow_up_questions"("sessionId");

-- CreateIndex
CREATE INDEX "transcripts_sessionId_createdAt_idx" ON "transcripts"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "audio_recordings_answerId_key" ON "audio_recordings"("answerId");

-- CreateIndex
CREATE UNIQUE INDEX "audio_recordings_objectKey_key" ON "audio_recordings"("objectKey");

-- CreateIndex
CREATE INDEX "audio_recordings_sessionId_idx" ON "audio_recordings"("sessionId");

-- CreateIndex
CREATE INDEX "audio_recordings_purgeAfter_idx" ON "audio_recordings"("purgeAfter");

-- CreateIndex
CREATE INDEX "proctoring_events_sessionId_occurredAt_idx" ON "proctoring_events"("sessionId", "occurredAt");

-- CreateIndex
CREATE INDEX "proctoring_events_type_occurredAt_idx" ON "proctoring_events"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "proctoring_events_requiresHumanReview_idx" ON "proctoring_events"("requiresHumanReview");

-- CreateIndex
CREATE UNIQUE INDEX "proctoring_snapshots_eventId_key" ON "proctoring_snapshots"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_reports_sessionId_key" ON "evaluation_reports"("sessionId");

-- CreateIndex
CREATE INDEX "evaluation_reports_recommendation_idx" ON "evaluation_reports"("recommendation");

-- CreateIndex
CREATE INDEX "reviewer_notes_sessionId_createdAt_idx" ON "reviewer_notes"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_scope_key" ON "system_settings"("scope");

-- CreateIndex
CREATE INDEX "question_imports_jobId_createdAt_idx" ON "question_imports"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "AdminRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_preferred_languages" ADD CONSTRAINT "job_preferred_languages_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_preferred_languages" ADD CONSTRAINT "job_preferred_languages_languageId_fkey" FOREIGN KEY ("languageId") REFERENCES "languages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_stages" ADD CONSTRAINT "interview_stages_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_requirements" ADD CONSTRAINT "job_requirements_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "interview_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "question_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_translations" ADD CONSTRAINT "question_translations_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_translations" ADD CONSTRAINT "question_translations_languageId_fkey" FOREIGN KEY ("languageId") REFERENCES "languages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoring_criteria" ADD CONSTRAINT "scoring_criteria_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_rules" ADD CONSTRAINT "follow_up_rules_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_languageId_fkey" FOREIGN KEY ("languageId") REFERENCES "languages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_results" ADD CONSTRAINT "eligibility_results_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "interview_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_answers" ADD CONSTRAINT "candidate_answers_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "interview_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_answers" ADD CONSTRAINT "candidate_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_answers" ADD CONSTRAINT "candidate_answers_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "question_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_scores" ADD CONSTRAINT "answer_scores_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "candidate_answers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_scores" ADD CONSTRAINT "answer_scores_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_scores" ADD CONSTRAINT "answer_scores_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_criterion_scores" ADD CONSTRAINT "answer_criterion_scores_answerScoreId_fkey" FOREIGN KEY ("answerScoreId") REFERENCES "answer_scores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_criterion_scores" ADD CONSTRAINT "answer_criterion_scores_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "scoring_criteria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_questions" ADD CONSTRAINT "follow_up_questions_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "interview_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_questions" ADD CONSTRAINT "follow_up_questions_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "candidate_answers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_questions" ADD CONSTRAINT "follow_up_questions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "follow_up_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "interview_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audio_recordings" ADD CONSTRAINT "audio_recordings_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "interview_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audio_recordings" ADD CONSTRAINT "audio_recordings_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "candidate_answers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proctoring_events" ADD CONSTRAINT "proctoring_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "interview_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proctoring_snapshots" ADD CONSTRAINT "proctoring_snapshots_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "proctoring_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_reports" ADD CONSTRAINT "evaluation_reports_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "interview_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviewer_notes" ADD CONSTRAINT "reviewer_notes_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "interview_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviewer_notes" ADD CONSTRAINT "reviewer_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_imports" ADD CONSTRAINT "question_imports_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
