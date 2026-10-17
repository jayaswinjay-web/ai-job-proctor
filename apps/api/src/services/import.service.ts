import type { Logger, PrismaClient } from '@proctor/database';
import { reviewQuestionContent } from '@proctor/ai';
import type { ImportRowError, ImportResultDto } from '@proctor/types';
import { AppError } from '../lib/errors.js';
import { AuditService, type AuditActor } from '../lib/audit.js';
import { normaliseDigits } from '@proctor/ai';

/**
 * Question import/export.
 *
 * Supported shapes
 *   CSV   RFC 4180 (quoted fields, embedded commas and newlines, BOM tolerant)
 *   XLSX  first worksheet only
 *   JSON  array of objects, or `{ questions: [...] }`
 *
 * Import is always two-phase: validate first (dry run), show the administrator
 * exactly which rows failed and why, and only then apply. Row numbers in errors are
 * 1-based and include the header, matching what a spreadsheet shows.
 */

const COLUMNS = [
  'job_title',
  'category',
  'question',
  'weight',
  'score_max',
  'required',
  'difficulty',
  'keywords',
  'skill_tags',
  'expected_answer',
  'evaluation_instructions',
  'max_retries',
  'time_limit_seconds',
  'is_knockout',
  'criterion_label',
  'criterion_points',
  'criterion_keywords',
] as const;

type Column = (typeof COLUMNS)[number];

export class ImportService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: Logger,
    private readonly audit: AuditService,
  ) {}

  /** Parses, validates and (optionally) persists an uploaded question set. */
  async importQuestions(
    input: { jobId: string; format: 'CSV' | 'XLSX' | 'JSON'; payload: string | Buffer; dryRun: boolean },
    actor: AuditActor,
  ): Promise<ImportResultDto> {
    const job = await this.prisma.job.findFirst({ where: { id: input.jobId, deletedAt: null } });
    if (!job) throw AppError.notFound('That job could not be found.');

    const parsed = await this.parse(input.format, input.payload);
    const errors: ImportRowError[] = [];
    const valid: NormalisedRow[] = [];
    const seen = new Set<string>();

    parsed.forEach((row, index) => {
      const rowNumber = index + 2; // +1 for 0-based, +1 for the header row
      const normalised = this.normaliseRow(row, rowNumber, errors);
      if (!normalised) return;

      const key = `${normalised.category.toLowerCase()}|${normalised.text.toLowerCase().replace(/\s+/g, ' ')}`;
      if (seen.has(key)) {
        errors.push({ row: rowNumber, column: 'question', message: 'Duplicate of an earlier row in this file.' });
        return;
      }
      seen.add(key);
      valid.push(normalised);
    });

    const importRow = await this.prisma.questionImport.create({
      data: {
        jobId: job.id,
        format: input.format,
        status: errors.length === 0 ? 'VALIDATED' : 'FAILED',
        totalRows: parsed.length,
        validRows: valid.length,
        errorRows: new Set(errors.map((e) => e.row)).size,
        errors: errors as never,
        createdById: actor.id ?? null,
      },
    });

    await this.audit.record({
      action: 'question.import_validated',
      entityType: 'question_import',
      entityId: importRow.id,
      next: { jobId: job.id, format: input.format, totalRows: parsed.length, validRows: valid.length, errorRows: errors.length, dryRun: input.dryRun },
      actor,
    });

    let createdIds: string[] = [];
    if (!input.dryRun && valid.length > 0) {
      createdIds = await this.apply(valid, job.id, actor);
      await this.prisma.questionImport.update({
        where: { id: importRow.id },
        data: { status: 'APPLIED', appliedAt: new Date(), createdQuestionIds: createdIds },
      });
      await this.audit.record({
        action: 'question.import_applied',
        entityType: 'question_import',
        entityId: importRow.id,
        next: { created: createdIds.length },
        actor,
      });
    }

    this.logger.info('question_import_processed', {
      importId: importRow.id,
      jobId: job.id,
      format: input.format,
      total: parsed.length,
      valid: valid.length,
      errors: errors.length,
      dryRun: input.dryRun,
      actor: actor.id,
    });

    return {
      importId: importRow.id,
      status: errors.length === 0 ? (input.dryRun ? 'VALIDATED' : 'APPLIED') : 'FAILED',
      totalRows: parsed.length,
      validRows: valid.length,
      errorRows: new Set(errors.map((e) => e.row)).size,
      errors: errors.slice(0, 200),
      createdQuestionIds: createdIds,
    };
  }

  /* ------------------------------------------------------------------ */

  private async apply(rows: NormalisedRow[], jobId: string, actor: AuditActor): Promise<string[]> {
    const created: string[] = [];
    const job = await this.prisma.job.findFirstOrThrow({
      where: { id: jobId },
      include: { stages: { orderBy: { sortOrder: 'asc' } } },
    });
    // Imported questions land in the JOB_QUESTIONS stage; if the job has none yet we
    // create one so an import alone is enough to make the job usable.
    let stageId = job.stages.find((s) => s.kind === 'JOB_QUESTIONS')?.id ?? null;
    if (!stageId) {
      const created_stage = await this.prisma.interviewStage.create({
        data: {
          jobId,
          kind: 'JOB_QUESTIONS',
          title: 'Job questions',
          instructions: 'Questions about the role applied for.',
          maxQuestions: Math.min(50, rows.length + 5),
          sortOrder: job.stages.length,
        },
      });
      stageId = created_stage.id;
    }

    for (const [index, row] of rows.entries()) {
      const question = await this.prisma.question.create({
        data: {
          jobId,
          stageId,
          categoryName: row.category,
          difficulty: row.difficulty,
          baseLanguage: 'en',
          text: row.text,
          expectedAnswerGuidance: row.expectedAnswer,
          evaluationInstructions: row.evaluationInstructions,
          keywords: row.keywords,
          skillTags: row.skillTags,
          weight: row.weight,
          scoreMax: row.scoreMax,
          scoreMin: 0,
          isRequired: row.required,
          isKnockout: row.isKnockout,
          maxRetries: row.maxRetries,
          timeLimitSeconds: row.timeLimitSeconds,
          sortOrder: index,
          source: 'ADMIN',
          isActive: true,
          validationStatus: 'VALID',
          validationIssues: [],
          approvedAt: new Date(),
          approvedById: actor.id ?? null,
          createdById: actor.id ?? null,
          ...(row.criterion
            ? {
                scoringCriteria: {
                  create: [
                    {
                      label: row.criterion.label,
                      description: row.criterion.description ?? '',
                      points: row.criterion.points,
                      keywords: row.criterion.keywords,
                      isKnockout: row.isKnockout,
                      sortOrder: 0,
                    },
                  ],
                },
              }
            : {}),
        },
      });
      await this.prisma.questionVersion.create({
        data: {
          questionId: question.id,
          version: 1,
          snapshot: { text: row.text, scoreMax: row.scoreMax, weight: row.weight, source: 'import' } as never,
          changeNote: 'Created by import',
          createdById: actor.id ?? null,
        },
      });
      created.push(question.id);
    }
    return created;
  }

  /* ------------------------------------------------------------------ */

  private async parse(format: string, payload: string | Buffer): Promise<Array<Record<string, unknown>>> {
    const text = typeof payload === 'string' ? payload : payload.toString('utf8');
    const clean = text.replace(/^\uFEFF/, '');

    if (format === 'JSON') {
      let data: unknown;
      try {
        data = JSON.parse(clean);
      } catch (err) {
        throw AppError.validation(`The JSON file could not be parsed: ${(err as Error).message}`);
      }
      const rows = Array.isArray(data) ? data : (data as { questions?: unknown[] })?.questions;
      if (!Array.isArray(rows)) {
        throw AppError.validation('The JSON file must contain an array of question objects.');
      }
      return rows.map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>) : {}));
    }

    if (format === 'XLSX') {
      const { readWorkbook } = await import('./xlsx.js');
      return readWorkbook(typeof payload === 'string' ? Buffer.from(payload, 'base64') : payload);
    }

    return parseCsv(clean);
  }

  private normaliseRow(
    row: Record<string, unknown>,
    rowNumber: number,
    errors: ImportRowError[],
  ): NormalisedRow | null {
    const cell = (key: Column): string => {
      const value = row[key] ?? row[key.toUpperCase()] ?? row[key.replace(/_/g, '')];
      return typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value).trim();
    };

    const text = cell('question');
    if (!text) {
      errors.push({ row: rowNumber, column: 'question', message: 'Question text is required.' });
      return null;
    }

    const category = cell('category') || 'Experience';

    const review = reviewQuestionContent({
      text,
      expectedAnswerGuidance: cell('expected_answer'),
      evaluationInstructions: cell('evaluation_instructions'),
      scoringCriteriaLabels: cell('criterion_label') ? [cell('criterion_label')] : [],
    });
    if (!review.safe) {
      for (const issue of review.issues) errors.push({ row: rowNumber, column: 'question', message: issue, value: text.slice(0, 80) });
      return null;
    }

    const weight = parseNumber(cell('weight'), rowNumber, 'weight', errors, 10);
    const scoreMax = parseNumber(cell('score_max'), rowNumber, 'score_max', errors, 10);
    if (weight !== null && weight < 0) {
      errors.push({ row: rowNumber, column: 'weight', message: 'Weight cannot be negative.', value: cell('weight') });
    }
    if (scoreMax !== null && scoreMax <= 0) {
      errors.push({ row: rowNumber, column: 'score_max', message: 'Maximum score must be greater than zero.', value: cell('score_max') });
    }
    if (scoreMax !== null && scoreMax > 100) {
      errors.push({ row: rowNumber, column: 'score_max', message: 'Maximum score cannot exceed 100.', value: cell('score_max') });
    }

    const difficultyRaw = cell('difficulty').toUpperCase();
    const difficulty = difficultyRaw === '' ? 'EASY' : difficultyRaw;
    if (!['EASY', 'MEDIUM', 'HARD'].includes(difficulty)) {
      errors.push({ row: rowNumber, column: 'difficulty', message: 'Difficulty must be EASY, MEDIUM or HARD.', value: difficultyRaw });
    }

    const maxRetries = cell('max_retries') === '' ? 2 : parseNumber(cell('max_retries'), rowNumber, 'max_retries', errors, 2);
    const timeLimitRaw = cell('time_limit_seconds');
    const timeLimitSeconds = timeLimitRaw === '' ? null : parseNumber(timeLimitRaw, rowNumber, 'time_limit_seconds', errors, 0);

    const criterionLabel = cell('criterion_label');
    const criterionPoints = criterionLabel ? parseNumber(cell('criterion_points'), rowNumber, 'criterion_points', errors, scoreMax ?? 10) : null;
    if (criterionLabel && criterionPoints !== null && criterionPoints > (scoreMax ?? 10)) {
      errors.push({
        row: rowNumber,
        column: 'criterion_points',
        message: `Criterion points (${criterionPoints}) cannot exceed the question maximum score (${scoreMax}).`,
      });
    }

    const isKnockout = parseBool(cell('is_knockout'));
    if (isKnockout && criterionLabel === '') {
      errors.push({ row: rowNumber, column: 'is_knockout', message: 'A knockout question needs a scoring criterion so the decision is explainable.' });
    }

    if (errors.some((e) => e.row === rowNumber)) return null;

    return {
      text,
      category,
      weight: weight ?? 10,
      scoreMax: scoreMax ?? 10,
      required: cell('required') === '' ? true : parseBool(cell('required')),
      difficulty: difficulty as 'EASY' | 'MEDIUM' | 'HARD',
      keywords: splitList(cell('keywords')),
      skillTags: splitList(cell('skill_tags')).map((t) => t.toUpperCase().replace(/\s+/g, '_')),
      expectedAnswer: cell('expected_answer'),
      evaluationInstructions: cell('evaluation_instructions'),
      maxRetries: maxRetries ?? 2,
      timeLimitSeconds,
      isKnockout,
      ...(criterionLabel
        ? {
            criterion: {
              label: criterionLabel,
              description: cell('expected_answer'),
              points: criterionPoints ?? scoreMax ?? 10,
              keywords: splitList(cell('criterion_keywords')),
            },
          }
        : {}),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Export                                                              */
  /* ------------------------------------------------------------------ */

  async exportCsv(jobId: string): Promise<string> {
    const questions = await this.prisma.question.findMany({
      where: { jobId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { scoringCriteria: { orderBy: { sortOrder: 'asc' } } },
    });
    const rows: string[] = [COLUMNS.join(',')];
    for (const q of questions) {
      const criterion = q.scoringCriteria[0];
      rows.push(
        [
          '',
          q.categoryName,
          q.text,
          q.weight,
          q.scoreMax,
          String(q.isRequired),
          q.difficulty,
          q.keywords.join('|'),
          q.skillTags.join('|'),
          q.expectedAnswerGuidance,
          q.evaluationInstructions,
          q.maxRetries,
          q.timeLimitSeconds ?? '',
          String(q.isKnockout),
          criterion?.label ?? '',
          criterion?.points ?? '',
          (criterion?.keywords ?? []).join('|'),
        ]
          .map(csvEscape)
          .join(','),
      );
    }
    return rows.join('\n');
  }

  /** Exports a bilingual CSV so an administrator can review wording before translating. */
  async exportTranslationsCsv(jobId: string, languages: string[]): Promise<string> {
    const questions = await this.prisma.question.findMany({
      where: { jobId, deletedAt: null },
      include: { translations: { include: { language: true } } },
      orderBy: [{ sortOrder: 'asc' }],
    });
    const header = ['question_id', 'language', 'text', 'speak_text', 'reviewed'].join(',');
    const rows = [header];
    for (const q of questions) {
      for (const lang of languages) {
        const t = q.translations.find((x) => x.language.code === lang);
        rows.push([q.id, lang, t?.text ?? '', t?.speakText ?? '', String(Boolean(t?.reviewedAt))].map(csvEscape).join(','));
      }
    }
    return rows.join('\n');
  }

  async templateCsv(): Promise<string> {
    return [
      COLUMNS.join(','),
      [
        '',
        'Experience',
        'Have you worked in a factory before?',
        '20',
        '10',
        'true',
        'EASY',
        'factory|machine|shift',
        'RELEVANT_EXPERIENCE',
        'Describe real work in a comparable role',
        'Award points only for stated experience',
        '2',
        '',
        'false',
        'Relevant experience',
        '10',
        'worked|factory|machine',
      ]
        .map(csvEscape)
        .join(','),
    ].join('\n');
  }
}

interface NormalisedRow {
  text: string;
  category: string;
  weight: number;
  scoreMax: number;
  required: boolean;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  keywords: string[];
  skillTags: string[];
  expectedAnswer: string;
  evaluationInstructions: string;
  maxRetries: number;
  timeLimitSeconds: number | null;
  isKnockout: boolean;
  criterion?: { label: string; description: string; points: number; keywords: string[] };
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                        */
/* -------------------------------------------------------------------------- */

/** RFC 4180 parser: handles quoted fields, escaped quotes, embedded newlines and commas. */
export function parseCsv(input: string): Array<Record<string, unknown>> {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((cell) => cell.trim() !== ''));
  if (nonEmpty.length === 0) return [];
  const header = nonEmpty[0]!.map((h) => h.trim());
  return nonEmpty.slice(1).map((cells) => {
    const record: Record<string, unknown> = {};
    header.forEach((h, idx) => {
      record[h] = cells[idx] ?? '';
    });
    return record;
  });
}

export function csvEscape(value: unknown): string {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function splitList(value: string): string[] {
  if (!value) return [];
  return value
    .split(/[|;]/)
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 40);
}

function parseNumber(value: string, row: number, column: string, errors: ImportRowError[], fallback: number): number | null {
  if (value === '') return fallback;
  const normalised = normaliseDigits(value).replace(/[^\d.\-]/g, '');
  const n = Number(normalised);
  if (!Number.isFinite(n)) {
    errors.push({ row, column, message: 'Must be a number.', value });
    return null;
  }
  return n;
}

function parseBool(value: string): boolean {
  return ['true', '1', 'yes', 'y'].includes(value.trim().toLowerCase());
}