import { useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Icon,
  Select,
  TextArea,
  TextInput,
  adminTokens as t,
  formatDateTime,
  titleCase,
} from '@proctor/ui';
import { api, downloadFile, query } from '../lib/api.js';
import { describe, fieldErrors, useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import type { ImportResultDto, JobSummaryDto, QuestionDto, QuestionVersionDto, SuggestQuestionsResponse } from '@proctor/types';

/**
 * Question bank.
 *
 * Three things here are load-bearing for fairness and are surfaced rather than hidden:
 *
 *  * Translation coverage. A question without a translation in every language the job
 *    offers cannot be asked, so gaps are flagged loudly instead of silently skipping.
 *  * Validation status. The server runs a fairness check over question text; an invalid
 *    question is shown with its issues and cannot be published.
 *  * Versioning. Editing a published question creates a new version rather than editing
 *    history, so a score recorded against version 3 still means what it meant then.
 */

const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const;
const CATEGORIES = [
  'RELEVANT_EXPERIENCE',
  'JOB_KNOWLEDGE',
  'PRACTICAL_UNDERSTANDING',
  'SAFETY_AWARENESS',
  'COMMUNICATION',
  'RELIABILITY',
  'AVAILABILITY',
  'other',
] as const;

export function QuestionsPage() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [jobId, setJobId] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<QuestionDto | 'new' | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null);

  const jobs = useAsync<{ items: JobSummaryDto[] }>(() => api('/admin/jobs?includeArchived=true'), []);
  const list = useAsync<{ items: QuestionDto[]; total: number; page: number; pageSize: number }>(
    () =>
      api(
        `/admin/questions${query({
          search: search || undefined,
          jobId: jobId || undefined,
          category: category || undefined,
          page,
          pageSize: 25,
        })}`,
      ),
    [search, jobId, category, page],
  );

  const publish = async (question: QuestionDto) => {
    try {
      await api(`/admin/questions/${question.id}/publish`, { method: 'POST' });
      setNotice({ tone: 'success', text: `Published version ${question.version + 1}.` });
      list.reload();
    } catch (err) {
      setNotice({ tone: 'danger', text: describe(err) });
    }
  };

  const unpublish = async (question: QuestionDto) => {
    try {
      await api(`/admin/questions/${question.id}/unpublish`, { method: 'POST' });
      setNotice({ tone: 'success', text: 'Question withdrawn from future interviews.' });
      list.reload();
    } catch (err) {
      setNotice({ tone: 'danger', text: describe(err) });
    }
  };

  const remove = async (question: QuestionDto) => {
    if (!confirm('Delete this question? Interviews that already used it keep their stored copy.')) return;
    try {
      await api(`/admin/questions/${question.id}`, { method: 'DELETE' });
      setNotice({ tone: 'success', text: 'Question deleted.' });
      list.reload();
    } catch (err) {
      setNotice({ tone: 'danger', text: describe(err) });
    }
  };

  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / 25)) : 1;

  return (
    <div className="stack">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative' }}>
            <Icon
              name="search"
              size={17}
              color={t.color.textMuted}
              style={{ position: 'absolute', left: 12, top: 12, pointerEvents: 'none' }}
            />
            <TextInput
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search question text"
              aria-label="Search questions"
              style={{ paddingLeft: 38, width: 240 }}
            />
          </div>
          <Select
            value={jobId}
            onChange={(e) => {
              setJobId(e.target.value);
              setPage(1);
            }}
            style={{ width: 210 }}
            aria-label="Filter by job"
          >
            <option value="">All jobs and shared questions</option>
            {(jobs.data?.items ?? []).map((job) => (
              <option key={job.id} value={job.id}>
                {job.title}
              </option>
            ))}
          </Select>
          <Select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            style={{ width: 200 }}
            aria-label="Filter by category"
          >
            <option value="">Any category</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {titleCase(c)}
              </option>
            ))}
          </Select>
        </div>

        <div className="row" style={{ gap: 8 }}>
          {can('question:read') && (
            <Button
              variant="secondary"
              icon={<Icon name="download" size={15} />}
              onClick={() => void downloadFile('/admin/questions/import/template.csv', 'question-import-template.csv')}
            >
              Import template
            </Button>
          )}
          {can('question:write') && (
            <>
              <ImportPanel onDone={(result) => { setNotice(result); list.reload(); }} />
              <SuggestPanel
                jobs={jobs.data?.items ?? []}
                onDone={() => {
                  setNotice({ tone: 'success', text: 'Suggestions added to the list below as drafts. Review each one before publishing.' });
                  list.reload();
                }}
              />
              <Button variant="primary" icon={<Icon name="plus" size={16} />} onClick={() => setEditing('new')}>
                New question
              </Button>
            </>
          )}
        </div>
      </div>

      {list.error && <Alert tone="danger">{list.error}</Alert>}

      {editing === 'new' && (
        <QuestionForm
          jobs={jobs.data?.items ?? []}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
            setNotice({ tone: 'success', text: 'Question saved. Publish it when the translations are in place.' });
          }}
        />
      )}

      {!list.data?.items.length ? (
        <Card>
          <EmptyState
            title="No questions yet"
            detail="Questions can be written by hand, drafted by the AI, or imported from the CSV template. Each one needs a translation for every language the job offers."
          />
        </Card>
      ) : (
        <div className="scroll-x">
          <Card padded={false}>
            <table>
              <thead>
                <tr>
                  <th>Question</th>
                  <th>Job</th>
                  <th>Category</th>
                  <th>Weight</th>
                  <th>Translations</th>
                  <th>Validation</th>
                  <th>State</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((question) => {
                  const missing = missingTranslations(question);
                  return (
                    <tr key={question.id}>
                      <td style={{ maxWidth: 420 }}>
                        {question.text}
                        <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <Badge tone="neutral">v{question.version}</Badge>
                          {question.isRequired && <Badge tone="neutral">required</Badge>}
                          {question.isKnockout && <Badge tone="warning">knockout</Badge>}
                          {question.source === 'AI_SUGGESTED' && <Badge tone="accent">AI drafted</Badge>}
                          <Badge tone="neutral">{question.difficulty}</Badge>
                        </div>
                      </td>
                      <td>{question.jobId ? (jobs.data?.items.find((j) => j.id === question.jobId)?.title ?? 'Specific job') : 'Shared'}</td>
                      <td>{titleCase(question.category)}</td>
                      <td>{question.weight}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {question.translations.length === 0 ? (
                            <Badge tone="danger">none</Badge>
                          ) : (
                            question.translations.map((translation) => (
                              <Badge key={translation.id} tone="success">
                                {translation.languageCode.toUpperCase()}
                              </Badge>
                            ))
                          )}
                        </div>
                        {missing.length > 0 && (
                          <div style={{ marginTop: 4, fontSize: '0.72rem', color: t.color.warning }}>
                            Missing: {missing.join(', ')}
                          </div>
                        )}
                      </td>
                      <td>
                        <Badge
                          tone={
                            question.validationStatus === 'VALID'
                              ? 'success'
                              : question.validationStatus === 'INVALID'
                                ? 'danger'
                                : 'warning'
                          }
                        >
                          {titleCase(question.validationStatus)}
                        </Badge>
                        {question.validationIssues.length > 0 && (
                          <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>
                            {question.validationIssues.map((issue) => (
                              <li key={issue} style={{ fontSize: '0.75rem', color: t.color.danger }}>
                                {issue}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td>{question.isActive ? <Badge tone="success">active</Badge> : <Badge tone="neutral">inactive</Badge>}</td>
                      <td>
                        <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                          <Button size="sm" variant="secondary" onClick={() => setEditing(question)}>
                            Edit
                          </Button>
                          {can('question:publish') && question.isActive && (
                            <Button size="sm" variant="ghost" onClick={() => void publish(question)}>
                              Publish
                            </Button>
                          )}
                          {can('question:write') && !question.isActive && (
                            <Button size="sm" variant="ghost" onClick={() => void unpublish(question)}>
                              Withdraw
                            </Button>
                          )}
                          {can('question:write') && (
                            <Button size="sm" variant="ghost" onClick={() => void remove(question)}>
                              Delete
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {list.data && list.data.total > 25 && (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.8rem', color: t.color.textMuted }}>{list.data.total} questions</span>
          <div className="row" style={{ gap: 8 }}>
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span style={{ fontSize: '0.8rem' }}>
              Page {page} of {totalPages}
            </span>
            <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {editing && editing !== 'new' && (
        <QuestionForm
          question={editing}
          jobs={jobs.data?.items ?? []}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
            setNotice({ tone: 'success', text: 'Saved. Publishing creates a new version so historic scores stay meaningful.' });
          }}
        />
      )}
    </div>
  );
}

function missingTranslations(question: QuestionDto): string[] {
  const have = new Set(question.translations.map((tr) => tr.languageCode));
  return ['en', 'hi', 'mr'].filter((code) => !have.has(code) && code !== question.baseLanguage);
}

/* ------------------------------------------------------------------ */

function QuestionForm({
  question,
  jobs,
  onCancel,
  onSaved,
}: {
  question?: QuestionDto;
  jobs: JobSummaryDto[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [jobId, setJobId] = useState(question?.jobId ?? '');
  // Preserved on save so an edit does not silently detach a question from its stage.
  const [stageId] = useState(question?.stageId ?? '');
  const [category, setCategory] = useState(question?.category ?? 'RELEVANT_EXPERIENCE');
  const [difficulty, setDifficulty] = useState<string>(question?.difficulty ?? 'EASY');
  const [baseLanguage, setBaseLanguage] = useState(question?.baseLanguage ?? 'en');
  const [text, setText] = useState(question?.text ?? '');
  const [speakText, setSpeakText] = useState(question?.speakText ?? '');
  const [guidance, setGuidance] = useState(question?.expectedAnswerGuidance ?? '');
  const [keywords, setKeywords] = useState(question?.keywords.join(', ') ?? '');
  const [weight, setWeight] = useState(String(question?.weight ?? 10));
  const [scoreMax, setScoreMax] = useState(String(question?.scoreMax ?? 10));
  const [isRequired, setIsRequired] = useState(question?.isRequired ?? true);
  const [isKnockout, setIsKnockout] = useState(question?.isKnockout ?? false);
  const [knockoutMessage, setKnockoutMessage] = useState(question?.knockoutMessage ?? '');
  const [maxRetries, setMaxRetries] = useState(String(question?.maxRetries ?? 2));
  const [evaluationInstructions, setEvaluationInstructions] = useState(question?.evaluationInstructions ?? '');
  const [translations, setTranslations] = useState<Array<{ languageCode: string; text: string; speakText: string }>>(
    question?.translations.map((tr) => ({
      languageCode: tr.languageCode,
      text: tr.text,
      speakText: tr.speakText ?? '',
    })) ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [localNotice, setNoticeLocal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [validating, setValidating] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    setErrors({});
    const body = {
      jobId: jobId || null,
      stageId: stageId || null,
      category,
      difficulty,
      baseLanguage,
      text: text.trim(),
      speakText: speakText.trim() || undefined,
      expectedAnswerGuidance: guidance.trim(),
      keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean),
      skillTags: [category],
      weight: Number(weight) || 0,
      scoreMax: Number(scoreMax) || 10,
      scoreMin: 0,
      isRequired,
      isKnockout,
      knockoutMessage: isKnockout ? knockoutMessage.trim() : undefined,
      maxRetries: Number(maxRetries) || 0,
      evaluationInstructions: evaluationInstructions.trim(),
      translations: translations
        .filter((tr) => tr.text.trim())
        .map((tr) => ({ languageCode: tr.languageCode, text: tr.text.trim(), speakText: tr.speakText.trim() || undefined })),
      source: question?.source ?? 'ADMIN',
      isActive: question?.isActive ?? true,
    };
    try {
      if (question) await api(`/admin/questions/${question.id}`, { method: 'PATCH', body });
      else await api('/admin/questions', { body });
      onSaved();
    } catch (err) {
      setError(describe(err));
      setErrors(fieldErrors(err));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Runs the same policy gate the engine applies to follow-up wording, without saving.
   *
   * The author sees the verdict before a question is stored, so an out-of-scope or
   * protected-topic question is caught at authoring time rather than discovered during a
   * live interview.
   */
  const validate = async () => {
    setValidating(true);
    setError(null);
    try {
      const jobTitle = jobs.find((j) => j.id === jobId)?.title ?? '';
      const verdict = await api<{ ok: boolean; reason: string }>('/admin/questions/validate-followup', {
        method: 'POST',
        body: {
          question: text.trim(),
          jobTitle,
          category,
          keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean),
          skillTags: [category],
        },
      });
      if (verdict.ok) setNoticeLocal(`Fairness check passed: ${verdict.reason || 'no issues found'}`);
      else setNoticeLocal(`Fairness check flagged this wording: ${verdict.reason}`);
    } catch (err) {
      setError(describe(err));
    } finally {
      setValidating(false);
    }
  };

  return (
    <Card
      title={question ? `Edit question (v${question.version})` : 'New question'}
      subtitle="Saving a published question creates a new version. Candidates already interviewed keep the text they heard."
    >
      {error && (
        <div style={{ marginBottom: 14 }}>
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      {localNotice && (
        <div style={{ marginBottom: 14 }}>
          <Alert tone="info">{localNotice}</Alert>
        </div>
      )}

      <div className="grid-2">
        <Field label="Applies to" htmlFor="jobId" hint="Leave blank to share across all jobs.">
          <Select id="jobId" value={jobId} onChange={(e) => setJobId(e.target.value)}>
            <option value="">Shared question bank</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Category" htmlFor="category" required error={errors.category?.[0]}>
          <Select id="category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {titleCase(c)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Difficulty" htmlFor="difficulty" hint="Easier questions are asked first and retried when a candidate struggles.">
          <Select id="difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {titleCase(d)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Base language" htmlFor="baseLanguage" hint="The language this question is written in; translations cover the rest.">
          <Select id="baseLanguage" value={baseLanguage} onChange={(e) => setBaseLanguage(e.target.value)}>
            <option value="en">English</option>
            <option value="hi">Hindi</option>
            <option value="mr">Marathi</option>
          </Select>
        </Field>
      </div>

      <div style={{ marginTop: 14 }}>
        <Field
          label="Question text"
          htmlFor="text"
          required
          hint="Short and concrete. Avoid anything about age, gender, caste, religion, health, pregnancy, family plans or appearance."
          error={errors.text?.[0]}
        >
          <TextArea id="text" value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 70 }} />
        </Field>
      </div>

      <div style={{ marginTop: 14 }}>
        <Field label="Spoken version" htmlFor="speakText" hint="Optional. Read aloud instead of the text — useful for numbers and names.">
          <TextInput id="speakText" value={speakText} onChange={(e) => setSpeakText(e.target.value)} />
        </Field>
      </div>

      <div style={{ marginTop: 14 }}>
        <Field label="What a good answer contains" htmlFor="guidance" hint="Guidance for the AI and for reviewers. Never a list of protected characteristics.">
          <TextArea id="guidance" value={guidance} onChange={(e) => setGuidance(e.target.value)} />
        </Field>
      </div>

      <div className="grid-2" style={{ marginTop: 14 }}>
        <Field label="Keywords" htmlFor="keywords" hint="Comma separated. Matched against the transcript to support scoring.">
          <TextInput id="keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
        </Field>
        <Field label="Evaluation instructions" htmlFor="eval" hint="Extra rules for scoring this answer.">
          <TextInput id="eval" value={evaluationInstructions} onChange={(e) => setEvaluationInstructions(e.target.value)} />
        </Field>
      </div>

      <div className="grid-4" style={{ marginTop: 14 }}>
        <Field label="Weight" htmlFor="weight">
          <TextInput id="weight" type="number" min={0} max={100} value={weight} onChange={(e) => setWeight(e.target.value)} />
        </Field>
        <Field label="Max score" htmlFor="scoreMax">
          <TextInput id="scoreMax" type="number" min={0} max={100} value={scoreMax} onChange={(e) => setScoreMax(e.target.value)} />
        </Field>
        <Field label="Retries" htmlFor="maxRetries" hint="Times the kiosk rephrases before moving on.">
          <TextInput id="maxRetries" type="number" min={0} max={5} value={maxRetries} onChange={(e) => setMaxRetries(e.target.value)} />
        </Field>
        <Field label="Required" htmlFor="isRequired">
          <Select id="isRequired" value={isRequired ? 'yes' : 'no'} onChange={(e) => setIsRequired(e.target.value === 'yes')}>
            <option value="yes">Required</option>
            <option value="no">Optional</option>
          </Select>
        </Field>
      </div>

      <div className="row" style={{ marginTop: 14, alignItems: 'flex-start' }}>
        <label className="row" style={{ gap: 8, fontSize: '0.85rem' }}>
          <input type="checkbox" checked={isKnockout} onChange={(e) => setIsKnockout(e.target.checked)} />
          This is a knockout requirement
        </label>
      </div>
      {isKnockout && (
        <div style={{ marginTop: 10 }}>
          <Field label="Knockout message" htmlFor="knockout" hint="Shown to the candidate when the requirement is not met.">
            <TextInput id="knockout" value={knockoutMessage} onChange={(e) => setKnockoutMessage(e.target.value)} />
          </Field>
        </div>
      )}

      <h4 style={{ margin: '20px 0 8px', fontSize: '0.9rem' }}>Translations</h4>
      {(['en', 'hi', 'mr'] as const)
        .filter((code) => code !== baseLanguage)
        .map((code) => {
          const existing = translations.find((tr) => tr.languageCode === code);
          return (
            <div key={code} style={{ marginBottom: 12 }}>
              <Field label={code.toUpperCase()} htmlFor={`tr-${code}`}>
                <TextArea
                  id={`tr-${code}`}
                  value={existing?.text ?? ''}
                  onChange={(e) =>
                    setTranslations((current) => {
                      const rest = current.filter((tr) => tr.languageCode !== code);
                      return e.target.value
                        ? [...rest, { languageCode: code, text: e.target.value, speakText: existing?.speakText ?? '' }]
                        : rest;
                    })
                  }
                />
              </Field>
            </div>
          );
        })}

      <div className="row" style={{ marginTop: 16 }}>
        <Button variant="primary" busy={busy} onClick={() => void save()}>
          {question ? 'Save new version' : 'Create question'}
        </Button>
        <Button variant="secondary" busy={validating} onClick={() => void validate()}>
          Run policy check
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {question && <VersionHistory questionId={question.id} />}
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function SuggestPanel({ jobs, onDone }: { jobs: JobSummaryDto[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [jobId, setJobId] = useState('');
  const [count, setCount] = useState('6');
  const [language, setLanguage] = useState('en');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SuggestQuestionsResponse['suggestions']>([]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await api<SuggestQuestionsResponse>('/admin/questions/suggest', {
        body: { jobId, count: Number(count) || 6, language, categories: [], difficulty: 'MEDIUM' },
      });
      setResults(response.suggestions);
      onDone();
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button variant="secondary" icon={<Icon name="sparkles" size={16} />} onClick={() => setOpen(true)}>
        Draft with AI
      </Button>
    );
  }

  return (
    <Card title="Draft questions with AI" subtitle="Suggestions are saved as inactive drafts for a person to review.">
      {error && (
        <div style={{ marginBottom: 12 }}>
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      <div className="grid-2">
        <Field label="Job" htmlFor="suggest-job" required error={fieldErrors(error).jobId?.[0]}>
          <Select id="suggest-job" value={jobId} onChange={(e) => setJobId(e.target.value)}>
            <option value="">Choose a job</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="How many" htmlFor="suggest-count">
          <TextInput id="suggest-count" type="number" min={1} max={20} value={count} onChange={(e) => setCount(e.target.value)} />
        </Field>
        <Field label="Write in" htmlFor="suggest-language">
          <Select id="suggest-language" value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="en">English</option>
            <option value="hi">Hindi</option>
            <option value="mr">Marathi</option>
          </Select>
        </Field>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <Button variant="primary" busy={busy} disabled={!jobId} onClick={() => void run()}>
          Generate
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
      {results.length > 0 && (
        <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
          {results.map((suggestion) => (
            <div key={suggestion.text} style={{ padding: 12, border: `1px solid ${t.color.border}`, borderRadius: t.radius.md }}>
              <div style={{ fontWeight: 700, fontSize: '0.875rem' }}>{suggestion.text}</div>
              <div style={{ fontSize: '0.78rem', color: t.color.textMuted, marginTop: 4 }}>
                {titleCase(suggestion.category)} · {suggestion.difficulty} · keywords: {suggestion.keywords.join(', ') || 'none'}
              </div>
              <p style={{ margin: '6px 0 0', fontSize: '0.8rem' }}>{suggestion.expectedAnswerGuidance}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Bulk import.
 *
 * The file is read in the browser and sent as a string payload: CSV and JSON go as text,
 * XLSX as base64. Import runs as a dry run by default, because a bulk load that silently
 * creates hundreds of unusable questions is far worse than one extra confirmation step.
 */
function ImportPanel({ onDone }: { onDone: (notice: { tone: 'success' | 'danger' | 'warning'; text: string }) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [jobId, setJobId] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResultDto | null>(null);
  const jobs = useAsync<{ items: JobSummaryDto[] }>(() => api('/admin/jobs?includeArchived=true'), []);

  const upload = async (file: File) => {
    setBusy(true);
    setResult(null);
    try {
      const extension = file.name.split('.').pop()?.toLowerCase() ?? 'csv';
      const format = extension === 'json' ? 'JSON' : extension === 'xlsx' ? 'XLSX' : 'CSV';
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let payload = '';
      if (format === 'XLSX') {
        // Base64 without a stack overflow: chunked through String.fromCharCode.
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        payload = btoa(binary);
      } else {
        payload = new TextDecoder().decode(bytes);
      }

      const response = await api<ImportResultDto>('/admin/questions/import', {
        body: { jobId, format, payload, dryRun },
      });
      setResult(response);
      onDone({
        tone: response.errorRows > 0 ? 'warning' : 'success',
        text: dryRun
          ? `Dry run: ${response.validRows} of ${response.totalRows} rows would import, ${response.errorRows} would be rejected.`
          : `Imported ${response.validRows} questions; ${response.errorRows} rows were rejected.`,
      });
    } catch (err) {
      onDone({ tone: 'danger', text: describe(err) });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="row" style={{ gap: 8 }}>
      <Select value={jobId} onChange={(e) => setJobId(e.target.value)} style={{ width: 190 }} aria-label="Import into job">
        <option value="">Choose a job…</option>
        {(jobs.data?.items ?? []).map((job) => (
          <option key={job.id} value={job.id}>
            {job.title}
          </option>
        ))}
      </Select>
      <Select
        value={dryRun ? 'check' : 'apply'}
        onChange={(e) => setDryRun(e.target.value === 'check')}
        style={{ width: 130 }}
        aria-label="Import mode"
      >
        <option value="check">Check only</option>
        <option value="apply">Import rows</option>
      </Select>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <Button variant="secondary" busy={busy} disabled={!jobId} onClick={() => inputRef.current?.click()}>
        Import file
      </Button>
      {result && (
        <span style={{ fontSize: '0.78rem', color: result.errorRows > 0 ? t.color.warning : t.color.success }}>
          {result.validRows}/{result.totalRows} valid
          {result.errorRows > 0 && `, ${result.errorRows} rejected`}
        </span>
      )}
    </div>
  );
}

function VersionHistory({ questionId }: { questionId: string }) {
  const history = useAsync<{ items: QuestionVersionDto[] }>(() => api(`/admin/questions/${questionId}/versions`), [questionId]);
  if (!history.data?.items.length) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <Label>Version history</Label>
      {history.data.items.map((version) => (
        <div key={`${version.version}-${version.createdAt}`} style={{ fontSize: '0.78rem', color: t.color.textMuted }}>
          v{version.version} · {formatDateTime(version.createdAt)} · {version.changeNote ?? 'no note'} · by{' '}
          {version.createdBy ?? 'unknown'}
        </div>
      ))}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', color: t.color.textMuted, letterSpacing: '0.05em' }}>
      {children}
    </div>
  );
}
