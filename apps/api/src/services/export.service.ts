import type { Logger, PrismaClient } from '@proctor/database';
import type { AuditActor } from '../lib/audit.js';
import { AuditService } from '../lib/audit.js';
import { writeWorkbook } from './xlsx.js';
import { asString } from '../lib/merge.js';

/**
 * Report exports in CSV, Excel and PDF.
 *
 * Two deliberate choices:
 *  * Exports contain candidate content but never audio URLs or storage keys.
 *  * Every export is written to the audit log with the filter used, because a bulk
 *    candidate download is exactly the kind of action a privacy review looks for.
 */

export type ExportFormat = 'CSV' | 'XLSX' | 'PDF';

export interface ExportColumn {
  header: string;
  value: string | number | null;
}

export class ExportService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: Logger,
    private readonly audit: AuditService,
  ) {}

  /** Candidate list export, matching the dashboard's current filter. */
  async candidates(
    rows: Array<Record<string, unknown>>,
    format: ExportFormat,
    actor: AuditActor,
    meta: Record<string, unknown>,
  ): Promise<{ filename: string; contentType: string; body: Buffer }> {
    const headers = [
      'Session ID',
      'Candidate',
      'Job',
      'Interview date',
      'Language',
      'Status',
      'Score',
      'Recommendation',
      'Review state',
      'Proctoring',
      'Demo data',
    ];
    const table: ExportColumn[][] = rows.map((row) => [
      { header: headers[0]!, value: asString(row.publicId) },
      { header: headers[1]!, value: (row.candidateName as string | null) ?? '' },
      { header: headers[2]!, value: asString(row.jobTitle) },
      { header: headers[3]!, value: asString(row.interviewDate) },
      { header: headers[4]!, value: asString(row.languageCode) },
      { header: headers[5]!, value: asString(row.status) },
      { header: headers[6]!, value: typeof row.overallScore === 'number' ? row.overallScore : '' },
      { header: headers[7]!, value: (row.recommendation as string | null) ?? '' },
      { header: headers[8]!, value: asString(row.reviewState) },
      { header: headers[9]!, value: asString(row.proctorStatus) },
      { header: headers[10]!, value: row.isDemo === true ? 'yes' : 'no' },
    ]);

    await this.audit.record({
      action: 'candidate.exported',
      entityType: 'interview_session',
      entityId: null,
      next: { format, rows: rows.length, ...meta },
      actor,
    });
    this.logger.info('candidates_exported', { format, rows: rows.length, actor: actor.id, ...meta });

    return this.render('candidates', headers, table, format);
  }

  /** Full single-interview report including answers and AI reasoning. */
  async interviewReport(sessionId: string, format: ExportFormat, actor: AuditActor): Promise<{ filename: string; contentType: string; body: Buffer }> {
    const session = await this.prisma.interviewSession.findUnique({
      where: { id: sessionId },
      include: {
        job: true,
        candidate: true,
        answers: { orderBy: { answeredAt: 'asc' }, include: { question: true, score: { include: { criterionScores: true } } } },
        proctorEvents: { orderBy: { occurredAt: 'asc' } },
        eligibilityResults: true,
        report: true,
        reviewerNotes: { include: { author: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!session) throw new Error('Session not found');

    await this.audit.record({
      action: 'report.exported',
      entityType: 'interview_session',
      entityId: sessionId,
      next: { format },
      actor,
    });

    const report = session.report;
    const headers = [
      'Question',
      'Category',
      'Transcript (speech to text)',
      'AI interpretation',
      'Score',
      'Max',
      'Confidence',
      'AI reasoning',
      'Concerns',
      'Reviewer note',
    ];
    const table: ExportColumn[][] = session.answers.map((a) => [
      { header: headers[0]!, value: a.question?.text ?? 'Introduction detail' },
      { header: headers[1]!, value: a.question?.categoryName ?? '' },
      { header: headers[2]!, value: a.transcript },
      { header: headers[3]!, value: a.interpretation ?? '' },
      { header: headers[4]!, value: a.score?.rawScore ?? '' },
      { header: headers[5]!, value: a.score?.maxScore ?? '' },
      { header: headers[6]!, value: a.score?.confidence ?? '' },
      { header: headers[7]!, value: a.score?.evaluationReason ?? '' },
      { header: headers[8]!, value: (a.score?.concerns ?? []).join('; ') },
      { header: headers[9]!, value: a.score?.reviewerComment ?? '' },
    ]);

    const summaryLines: ExportColumn[] = [
      { header: 'Candidate', value: session.candidate.name ?? '(not stated)' },
      { header: 'Job', value: session.job.title },
      { header: 'Language', value: session.languageCode },
      { header: 'Interview date', value: session.startedAt.toISOString() },
      { header: 'Overall score', value: report?.overallScore ?? '' },
      { header: 'Passing score', value: session.job.passingScore },
      { header: 'Recommendation', value: report?.recommendation ?? '' },
      { header: 'Decision source', value: report?.decisionSource ?? '' },
      { header: 'Summary', value: report?.summary ?? '' },
      { header: 'Strengths', value: (report?.strengths ?? []).join('; ') },
      { header: 'Weaknesses', value: (report?.weaknesses ?? []).join('; ') },
      { header: 'Concerns', value: (report?.concerns ?? []).join('; ') },
      { header: 'Recommended next action', value: report?.recommendedNextAction ?? '' },
      { header: 'Proctoring events', value: session.proctorEvents.map((e) => `${e.type} (${e.severity}, confidence ${e.confidence})`).join('; ') },
      { header: 'Reviewer notes', value: session.reviewerNotes.map((n) => `${n.author.email}: ${n.note}`).join('; ') },
    ];

    return this.render(`interview-${session.publicId}`, headers, table, format, summaryLines);
  }

  /* ------------------------------------------------------------------ */

  private render(
    baseName: string,
    headers: string[],
    rows: ExportColumn[][],
    format: ExportFormat,
    summary?: ExportColumn[],
  ): { filename: string; contentType: string; body: Buffer } {
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'CSV') {
      const lines: string[] = [];
      if (summary && summary.length > 0) {
        lines.push('# Summary');
        for (const s of summary) lines.push(`${csvEscape(s.header)},${csvEscape(s.value ?? '')}`);
        lines.push('');
      }
      lines.push(headers.map(csvEscape).join(','));
      for (const row of rows) lines.push(row.map((c) => csvEscape(c.value ?? '')).join(','));
      return {
        filename: `${baseName}-${stamp}.csv`,
        contentType: 'text/csv; charset=utf-8',
        body: Buffer.from(`\uFEFF${lines.join('\n')}`, 'utf8'),
      };
    }

    if (format === 'XLSX') {
      const data = rows.map((row) => row.map((c) => (c.value === null ? '' : c.value)));
      const sheets = [];
      if (summary && summary.length > 0) {
        sheets.push({
          sheetName: 'Summary',
          rows: [['Field', 'Value'], ...summary.map((s) => [s.header, s.value === null ? '' : String(s.value)])],
        });
      }
      sheets.push({ sheetName: 'Data', rows: [headers, ...data] });
      return {
        filename: `${baseName}-${stamp}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        body: writeWorkbook(sheets),
      };
    }

    const lines: string[] = [];
    lines.push(baseName.replace(/-/g, ' ').toUpperCase());
    lines.push(`Generated ${new Date().toISOString()}`);
    lines.push('');
    if (summary && summary.length > 0) {
      for (const s of summary) lines.push(`${s.header}: ${s.value ?? ''}`);
      lines.push('');
    }
    headers.forEach((header, index) => {
      lines.push('');
      lines.push(header);
      lines.push('-'.repeat(Math.min(60, header.length)));
      for (const row of rows) lines.push(`  ${String(row[index]?.value ?? '')}`);
    });
    return {
      filename: `${baseName}-${stamp}.pdf`,
      contentType: 'application/pdf',
      body: buildPdf(lines),
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Minimal PDF writer                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Produces a valid single-stream, Helvetica PDF without a dependency.
 *
 * Deliberately plain: recruitment reports need to print and be archived legibly, not
 * be beautifully typeset. Text wrapping is done here; anything longer than a page is
 * truncated with a marker rather than silently dropped.
 */
function buildPdf(lines: string[]): Buffer {
  const pageWidth = 595; // A4 at 72dpi
  const pageHeight = 842;
  const margin = 40;
  const fontSize = 9;
  const leading = 12;
  const maxCharsPerLine = Math.floor((pageWidth - margin * 2) / (fontSize * 0.5));

  const wrapped: string[] = [];
  for (const line of lines) {
    if (line.length <= maxCharsPerLine) {
      wrapped.push(line);
      continue;
    }
    let remaining = line;
    while (remaining.length > maxCharsPerLine) {
      wrapped.push(remaining.slice(0, maxCharsPerLine));
      remaining = remaining.slice(maxCharsPerLine);
    }
    if (remaining) wrapped.push(remaining);
  }

  const linesPerPage = Math.floor((pageHeight - margin * 2) / leading);
  const pages: string[][] = [];
  for (let i = 0; i < wrapped.length; i += linesPerPage) {
    pages.push(wrapped.slice(i, i + linesPerPage));
  }
  if (pages.length === 0) pages.push(['']);

  const objects: string[] = [];
  const pageObjectIds: number[] = [];
  const fontId = 3 + pages.length * 2;
  // 1 = Catalog, 2 = Pages, then per page: page object + content stream.
  let nextId = 3;
  for (let i = 0; i < pages.length; i += 1) {
    pageObjectIds.push(nextId);
    nextId += 2;
  }

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

  pages.forEach((pageLines, index) => {
    const pageId = pageObjectIds[index]!;
    const contentId = pageId + 1;
    let y = pageHeight - margin;
    const stream: string[] = ['BT', '/F1 9 Tf', `${leading} TL`, `1 0 0 1 ${margin} ${y} Tm`];
    for (const line of pageLines) {
      stream.push(`(${escapePdfText(line)}) Tj`, 'T*');
      y -= leading;
    }
    stream.push('ET');
    const content = stream.join('\n');

    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`;
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    if (!objects[id]) continue;
    offsets[id] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    pdf += `${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

/**
 * Escapes a string for a PDF literal and maps characters WinAnsi cannot represent.
 *
 * WinAnsi has no Devanagari coverage, so Indic text becomes "?" rather than corrupting
 * the file. That is a deliberate trade-off: a valid, printable PDF an administrator can
 * still read and archive, with the full text available in the CSV/Excel exports and in
 * the dashboard itself.
 */
function escapePdfText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022]/g, (c) =>
      /[\u0900-\u097F]/.test(c) ? '?' : c,
    )
    .replace(/[\u0000-\u001F\u007F]/g, ' ');
}

function csvEscape(value: unknown): string {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}