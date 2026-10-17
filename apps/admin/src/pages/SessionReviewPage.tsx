import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
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
  formatDuration,
  proctorEventLabel,
  recommendationLabel,
  recommendationTone,
  titleCase,
} from '@proctor/ui';
import { api, downloadFile } from '../lib/api.js';
import { describe, fieldErrors, useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import type { ProctorEventDto, SessionDetailDto } from '@proctor/types';

/**
 * Single interview review.
 *
 * Design intent: the AI output is shown as a *draft* and the human decision is a separate,
 * explicit act. The reviewer sees the transcript and the per-answer reasoning before
 * agreeing, and any override records who changed what and why. Nothing on this page
 * presents a proctoring event as proof of misconduct — events are observations from a
 * unreliable camera, and the page is worded to keep that clear.
 */

type Tab = 'transcript' | 'report' | 'proctoring' | 'notes' | 'timeline';

export function SessionReviewPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('transcript');
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const detail = useAsync<SessionDetailDto>(() => api(`/admin/candidates/${id}`), [id]);

  if (detail.loading && !detail.data) {
    return (
      <Card>
        <div style={{ padding: 24, textAlign: 'center', color: t.color.textMuted }}>Loading interview…</div>
      </Card>
    );
  }
  if (detail.error || !detail.data) {
    return (
      <div className="stack">
        <Alert tone="danger" title="Could not load this interview">
          {detail.error ?? 'The interview was not found.'}
        </Alert>
        <Link className="a-link" to="/candidates">
          Back to candidates
        </Link>
      </div>
    );
  }

  const data = detail.data;
  const report = data.report;
  const proctorEvents = data.proctorEvents ?? [];

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row" style={{ gap: 10 }}>
          <Link className="a-link" to="/candidates">
            ← Candidates
          </Link>
          <span style={{ color: t.color.textMuted }}>/</span>
          <strong>{data.candidate.name || 'Name not captured'}</strong>
          <Badge tone="neutral" title="Public identifier">
            {data.session.publicId}
          </Badge>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {can('report:export') && (
            <>
              <Button
                size="sm"
                variant="secondary"
                icon={<Icon name="download" size={15} />}
                onClick={() =>
                  void downloadFile(`/admin/exports/interview/${id}?format=PDF`, 'interview-report.pdf').catch((e: Error) =>
                    setNotice({ tone: 'danger', text: e.message }),
                  )
                }
              >
                PDF
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  void downloadFile(`/admin/exports/interview/${id}?format=CSV`, 'interview-report.csv').catch((e: Error) =>
                    setNotice({ tone: 'danger', text: e.message }),
                  )
                }
              >
                CSV
              </Button>
            </>
          )}
          {can('recording:read') && (
            <RecordingsPanel sessionId={id} recordings={data.recordings} onError={(text) => setNotice({ tone: 'danger', text })} />
          )}
        </div>
      </div>

      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <SummaryHeader detail={data} />

      <div className="row" style={{ gap: 6, borderBottom: `1px solid ${t.color.border}` }}>
        {(
          [
            ['transcript', 'Transcript', data.answers.length],
            ['report', 'AI assessment', report ? 1 : 0],
            ['proctoring', 'Proctoring', proctorEvents.length],
            ['notes', 'Reviewer notes', data.reviewerNotes.length],
            ['timeline', 'Timeline', data.timeline.length],
          ] as Array<[Tab, string, number]>
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            style={{
              padding: '9px 14px',
              border: 0,
              borderBottom: `2px solid ${tab === key ? t.color.primary : 'transparent'}`,
              background: 'transparent',
              fontWeight: tab === key ? 700 : 600,
              fontSize: '0.85rem',
              color: tab === key ? t.color.primary : t.color.textMuted,
              cursor: 'pointer',
            }}
          >
            {label}
            {count > 0 && <span style={{ marginLeft: 6, fontSize: '0.72rem', opacity: 0.75 }}>{count}</span>}
          </button>
        ))}
      </div>

      {tab === 'transcript' && <TranscriptTab detail={data} />}
      {tab === 'report' && <ReportTab detail={data} onSaved={() => detail.reload()} />}
      {tab === 'proctoring' && <ProctoringTab events={proctorEvents} onChanged={detail.reload} />}
      {tab === 'notes' && <NotesTab sessionId={id} notes={data.reviewerNotes} onChanged={detail.reload} />}
      {tab === 'timeline' && (
        <Card title="Session timeline" subtitle="State transitions recorded during the interview">
          {!data.timeline.length ? (
            <EmptyState title="No timeline entries" />
          ) : (
            <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8 }}>
              {data.timeline.map((entry, index) => (
                <li key={index} style={{ fontSize: '0.85rem' }}>
                  <span style={{ color: t.color.textMuted, marginRight: 8 }}>{formatDateTime(entry.at)}</span>
                  <Badge tone="neutral">{titleCase(entry.kind)}</Badge>{' '}
                  {entry.detail}
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SummaryHeader({ detail }: { detail: SessionDetailDto }) {
  const { session, candidate, report } = detail;
  return (
    <Card padded={false}>
      <div className="grid-4" style={{ padding: 18, gap: 18 }}>
        <div>
          <Label>Candidate</Label>
          <div style={{ fontWeight: 700 }}>{candidate.name || 'Not captured'}</div>
          <Muted>{candidate.age ? `${candidate.age} years` : 'Age not captured'}</Muted>
        </div>
        <div>
          <Label>Job</Label>
          <div style={{ fontWeight: 700 }}>{session.jobTitle}</div>
          <Muted>{session.languageCode.toUpperCase()}</Muted>
        </div>
        <div>
          <Label>Interview</Label>
          <div style={{ fontWeight: 700 }}>{formatDateTime(session.startedAt)}</div>
          <Muted>
            {formatDuration(
              session.completedAt ? new Date(session.completedAt).getTime() - new Date(session.startedAt).getTime() : null,
            )}{' '}
            · {session.totalQuestions} questions
          </Muted>
        </div>
        <div>
          <Label>AI recommendation</Label>
          <div className="row" style={{ gap: 8 }}>
            <strong style={{ fontSize: '1.05rem' }}>
              {report ? `${report.overallScore}/${report.maxScore}` : '—'}
            </strong>
            {report && <Badge tone={recommendationTone(report.recommendation)}>{recommendationLabel(report.recommendation)}</Badge>}
          </div>
          <Muted>
            {report ? `Decision: ${titleCase(report.decisionSource)}` : 'No report generated'} ·{' '}
            {titleCase(detail.reviewState)}
          </Muted>
        </div>
      </div>
      {!candidate.consentRecorded && (
        <div style={{ padding: '0 18px 18px' }}>
          <Alert tone="warning" title="Consent was not recorded">
            This interview has no stored consent record. Confirm the candidate agreed before acting on the result.
          </Alert>
        </div>
      )}
    </Card>
  );
}

function TranscriptTab({ detail }: { detail: SessionDetailDto }) {
  // Scores are keyed by answer id, so build the map once instead of scanning per row.
  const byQuestion = useMemo(() => {
    const map = new Map<string, NonNullable<typeof detail.scores>[number]>();
    for (const score of detail.scores) map.set(score.id, score);
    return map;
  }, [detail.scores]);

  if (!detail.answers.length) {
    return (
      <Card>
        <EmptyState
          title="No answers recorded"
          detail="This session has no stored transcript. It may have been abandoned before the first question."
        />
      </Card>
    );
  }

  return (
    <div className="stack">
      {detail.answers.map((answer, index) => {
        const score = byQuestion.get(answer.id);
        return (
          <Card key={answer.id}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
              <div>
                <Badge tone="neutral">Q{index + 1}</Badge>{' '}
                <strong style={{ fontSize: '0.9rem' }}>{answer.questionCategory ? titleCase(answer.questionCategory) : 'Question'}</strong>
              </div>
              <div className="row" style={{ gap: 8 }}>
                {answer.isSkipped && <Badge tone="neutral">skipped</Badge>}
                {answer.isCommand && <Badge tone="accent">voice command: {titleCase(answer.command ?? '')}</Badge>}
                {answer.spokenLanguage && <Badge tone="neutral">spoken: {answer.spokenLanguage.toUpperCase()}</Badge>}
                <Muted>{formatDuration(answer.durationMs)}</Muted>
              </div>
            </div>

            <p style={{ margin: '0 0 10px', fontSize: '0.85rem', color: t.color.textMuted }}>{answer.questionText}</p>

            <blockquote
              style={{
                margin: 0,
                padding: '12px 14px',
                background: t.color.surfaceAlt,
                borderLeft: `3px solid ${t.color.primary}`,
                borderRadius: t.radius.md,
                fontSize: '0.9rem',
              }}
            >
              “{answer.transcript || 'No speech recognised.'}”
            </blockquote>

            {answer.interpretation && (
              <p style={{ margin: '10px 0 0', fontSize: '0.82rem', color: t.color.textMuted }}>
                <strong>Interpretation:</strong> {answer.interpretation}
              </p>
            )}

            {score && (
              <div
                style={{
                  marginTop: 14,
                  paddingTop: 14,
                  borderTop: `1px solid ${t.color.border}`,
                  display: 'grid',
                  gap: 8,
                }}
              >
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 700 }}>
                    AI score {score.rawScore} / {score.maxScore}{' '}
                    <span style={{ color: t.color.textMuted, fontWeight: 500 }}>
                      (normalised {score.normalizedScore.toFixed(0)}, confidence {(score.confidence * 100).toFixed(0)}%)
                    </span>
                  </span>
                  <Badge tone={score.source === 'AI' ? 'neutral' : 'success'}>{titleCase(score.source)}</Badge>
                </div>
                {score.evaluationReason && (
                  <p style={{ margin: 0, fontSize: '0.82rem' }}>{score.evaluationReason}</p>
                )}
                {score.criterionScores.length > 0 && (
                  <table>
                    <thead>
                      <tr>
                        <th>Criterion</th>
                        <th>Score</th>
                        <th>Evidence matched</th>
                      </tr>
                    </thead>
                    <tbody>
                      {score.criterionScores.map((criterion) => (
                        <tr key={criterion.label}>
                          <td>{criterion.label}</td>
                          <td>
                            {criterion.points} / {criterion.max}
                          </td>
                          <td style={{ color: t.color.textMuted }}>{criterion.hitKeywords.join(', ') || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {(score.strengths.length > 0 || score.concerns.length > 0) && (
                  <div className="row" style={{ gap: 18, alignItems: 'flex-start' }}>
                    {score.strengths.length > 0 && (
                      <div style={{ flex: 1 }}>
                        <Label>Strengths</Label>
                        <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: '0.82rem' }}>
                          {score.strengths.map((s) => (
                            <li key={s}>{s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {score.concerns.length > 0 && (
                      <div style={{ flex: 1 }}>
                        <Label>Concerns</Label>
                        <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: '0.82rem' }}>
                          {score.concerns.map((s) => (
                            <li key={s}>{s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                {score.biasFlags.length > 0 && (
                  <Alert tone="warning" title="Bias guard flagged this evaluation">
                    {score.biasFlags.join(' · ')}
                  </Alert>
                )}
                {score.reviewerComment && (
                  <p style={{ margin: 0, fontSize: '0.82rem' }}>
                    <strong>Reviewer:</strong> {score.reviewerComment}
                  </p>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ReportTab({ detail, onSaved }: { detail: SessionDetailDto; onSaved: () => void }) {
  const { can } = useAuth();
  const report = detail.report;
  const [notes, setNotes] = useState('');
  const [scoreOverride, setScoreOverride] = useState<string>('');
  const [recommendation, setRecommendation] = useState<string>('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  if (!report) {
    return (
      <Card>
        <EmptyState
          title="No AI assessment"
          detail="Reports are generated when an interview completes. This session has not produced one."
        />
      </Card>
    );
  }

  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      const response = await api<{ report: { overallScore: number; recommendation: string; decisionSource: string } }>(
        `/admin/candidates/${detail.session.sessionId}/review`,
        {
          method: 'POST',
          body: {
            markReviewed: true,
            ...(scoreOverride.trim() ? { overallScoreOverride: Number(scoreOverride) } : {}),
            ...(recommendation ? { recommendationOverride: recommendation } : {}),
            ...(notes.trim() ? { notes: notes.trim() } : {}),
          },
        },
      );
      setResult(
        `Saved. Overall score is now ${response.report.overallScore} with recommendation ${recommendationLabel(
          response.report.recommendation,
        )} (${titleCase(response.report.decisionSource)}).`,
      );
      setScoreOverride('');
      setRecommendation('');
      setNotes('');
      onSaved();
    } catch (err) {
      setErrors(fieldErrors(err));
      setResult(describe(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="grid-2">
        <Card title="AI summary">
          <p style={{ marginTop: 0 }}>{report.summary}</p>
          <Label>Experience summary</Label>
          <p style={{ marginTop: 4 }}>{report.experienceSummary || '—'}</p>
          <Label>Eligibility</Label>
          <p style={{ marginTop: 4 }}>
            {report.eligibilityStatus}
            {report.knockoutTriggered && (
              <>
                {' '}
                <Badge tone="warning">knockout criterion triggered</Badge>
              </>
            )}
          </p>
          <Label>Recommended next action</Label>
          <p style={{ marginTop: 4 }}>{report.recommendedNextAction}</p>
        </Card>

        <Card title="Score breakdown" subtitle="Skill scores with the evidence behind each">
          {report.skillScores.length === 0 ? (
            <EmptyState title="No skill breakdown recorded" />
          ) : (
            <div className="stack" style={{ gap: 12 }}>
              {report.skillScores.map((skill) => (
                <div key={skill.skill}>
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>{titleCase(skill.skill)}</span>
                    <span style={{ fontSize: '0.8rem', color: t.color.textMuted }}>
                      {skill.score} / {skill.max}
                    </span>
                  </div>
                  <div className="bar">
                    <span style={{ width: `${skill.max ? (skill.score / skill.max) * 100 : 0}%` }} />
                  </div>
                  {skill.evidence && (
                    <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: t.color.textMuted }}>{skill.evidence}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Strengths">
          {!report.strengths.length ? <EmptyState title="None recorded" /> : <BulletList items={report.strengths} tone="success" />}
        </Card>
        <Card title="Concerns">
          {!report.concerns.length ? <EmptyState title="None recorded" /> : <BulletList items={report.concerns} tone="warning" />}
        </Card>
      </div>

      <Card title="How this score was produced" subtitle="Read this before overriding">
        <pre
          className="mono"
          style={{
            margin: 0,
            padding: 12,
            background: t.color.surfaceAlt,
            borderRadius: t.radius.md,
            whiteSpace: 'pre-wrap',
            maxHeight: 260,
            overflow: 'auto',
          }}
        >
          {report.methodology || 'No methodology text was stored for this report.'}
        </pre>
        <p style={{ marginBottom: 0, fontSize: '0.75rem', color: t.color.textMuted }}>{report.disclaimer}</p>
      </Card>

      {can('review:write') ? (
        <Card
          title="Human decision"
          subtitle="Leave blank to confirm the AI assessment as-is. Any change is recorded as an override with your name."
        >
          {result && (
            <div style={{ marginBottom: 14 }}>
              <Alert tone={result.startsWith('Saved') ? 'success' : 'danger'}>{result}</Alert>
            </div>
          )}
          <div className="grid-2">
            <Field
              label="Override overall score"
              htmlFor="override"
              hint={`Current: ${report.overallScore} out of ${report.maxScore}`}
              error={errors.overallScoreOverride?.[0]}
            >
              <TextInput
                id="override"
                type="number"
                min={0}
                max={100}
                value={scoreOverride}
                onChange={(e) => setScoreOverride(e.target.value)}
                placeholder="Leave blank to keep"
              />
            </Field>
            <Field label="Override recommendation" htmlFor="recommendation" error={errors.recommendationOverride?.[0]}>
              <Select id="recommendation" value={recommendation} onChange={(e) => setRecommendation(e.target.value)}>
                <option value="">Confirm {recommendationLabel(report.recommendation)}</option>
                <option value="STRONG_MATCH">Strong match</option>
                <option value="GOOD_MATCH">Good match</option>
                <option value="CONSIDER">Consider</option>
                <option value="NOT_RECOMMENDED">Not recommended</option>
              </Select>
            </Field>
          </div>
          <div style={{ marginTop: 14 }}>
            <Field label="Reason for the decision" htmlFor="notes" hint="Required in practice: this is the audit trail." error={errors.notes?.[0]}>
              <TextArea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Transcript was clear and the candidate described two years of relevant work; AI under-scored the practical question."
              />
            </Field>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <Button variant="primary" busy={busy} onClick={() => void submit()}>
              Record decision and mark reviewed
            </Button>
          </div>
        </Card>
      ) : (
        <Alert tone="info" title="Read-only">
          Your role can view this assessment but cannot record a decision. A reviewer must confirm it.
        </Alert>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ProctoringTab({ events, onChanged }: { events: ProctorEventDto[]; onChanged: () => void }) {
  const { can } = useAuth();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const acknowledge = async (eventId: string) => {
    setBusyId(eventId);
    try {
      await api(`/admin/proctoring/${eventId}/acknowledge`, { method: 'POST', body: { note: note.trim() || undefined } });
      setNote('');
      onChanged();
    } finally {
      setBusyId(null);
    }
  };

  const openSnapshot = async (eventId: string) => {
    try {
      const signed = await api<{ url: string; expiresAt: string }>(`/admin/proctoring/events/${eventId}/snapshot`);
      window.open(signed.url, '_blank', 'noopener');
    } catch {
      /* the reviewer can still decide from the event description */
    }
  };

  if (!events.length) {
    return (
      <Card>
        <EmptyState
          title="No proctoring events"
          detail="Nothing unusual was detected during this interview. Absence of events is not proof of anything either way."
        />
      </Card>
    );
  }

  return (
    <div className="stack">
      <Alert tone="info" title="These are observations, not findings">
        Camera and presence detection produce automated signals. They can be triggered by a genuine problem — a visitor,
        poor lighting, a power cut — so they are shown here for context only. A recorded event never decides an
        application on its own, and acknowledging one records that you read it.
      </Alert>

      {can('review:write') && (
        <Card title="Note to attach to the next event you review">
          <div className="row">
            <TextInput
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Candidate was called away for a medical reason at this point"
              aria-label="Acknowledgement note"
            />
          </div>
        </Card>
      )}

      {events.map((event) => (
        <Card key={event.id}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <strong style={{ fontSize: '0.9rem' }}>{proctorEventLabel(event.type)}</strong>
              <div style={{ fontSize: '0.78rem', color: t.color.textMuted }}>
                {formatDateTime(event.occurredAt)}
                {event.stageKind && ` · ${titleCase(event.stageKind)}`} · confidence {(event.confidence * 100).toFixed(0)}%
              </div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <Badge
                tone={event.severity === 'HIGH' ? 'danger' : event.severity === 'MEDIUM' ? 'warning' : 'neutral'}
              >
                {event.severity}
              </Badge>
              {event.acknowledged ? <Badge tone="success">reviewed</Badge> : <Badge tone="accent">not reviewed</Badge>}
            </div>
          </div>
          {event.description && <p style={{ marginBottom: 0, fontSize: '0.85rem' }}>{event.description}</p>}
          {event.reference && (
            <p style={{ margin: '6px 0 0', fontSize: '0.75rem', color: t.color.textMuted }}>
              Reference: <span className="mono">{event.reference}</span>
            </p>
          )}
          <div className="row" style={{ marginTop: 12, gap: 8 }}>
            {can('recording:read') && event.snapshotUrl && (
              <Button size="sm" variant="secondary" onClick={() => void openSnapshot(event.id)}>
                View snapshot
              </Button>
            )}
            {can('review:write') && !event.acknowledged && (
              <Button size="sm" variant="primary" busy={busyId === event.id} onClick={() => void acknowledge(event.id)}>
                Mark as reviewed
              </Button>
            )}
          </div>
        </Card>
      ))}

      <Link to="/candidates?proctorStatus=REVIEW_REQUIRED" className="a-link">
        See all interviews with proctoring events
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function NotesTab({
  sessionId,
  notes,
  onChanged,
}: {
  sessionId: string;
  notes: Array<{ id: string; author: string; note: string; createdAt: string; decision: string | null }>;
  onChanged: () => void;
}) {
  const { can } = useAuth();
  const [note, setNote] = useState('');
  const [decision, setDecision] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!note.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/candidates/${sessionId}/notes`, {
        method: 'POST',
        body: { note: note.trim(), decision: decision.trim() || null },
      });
      setNote('');
      setDecision('');
      onChanged();
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      {can('review:write') && (
        <Card title="Add a note" subtitle="Notes are visible to other staff and cannot be edited once saved.">
          {error && (
            <div style={{ marginBottom: 12 }}>
              <Alert tone="danger">{error}</Alert>
            </div>
          )}
          <Field label="Note" htmlFor="note">
            <TextArea id="note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div style={{ marginTop: 12 }}>
            <Field label="Decision label (optional)" htmlFor="decision" hint="For example: phone interview recommended">
              <TextInput id="decision" value={decision} onChange={(e) => setDecision(e.target.value)} />
            </Field>
          </div>
          <div style={{ marginTop: 14 }}>
            <Button variant="primary" busy={busy} onClick={() => void add()}>
              Save note
            </Button>
          </div>
        </Card>
      )}

      {!notes.length ? (
        <Card>
          <EmptyState title="No notes yet" detail="Notes record the human reasoning behind a decision." />
        </Card>
      ) : (
        notes.map((entry) => (
          <Card key={entry.id}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong style={{ fontSize: '0.85rem' }}>{entry.author}</strong>
              <span style={{ fontSize: '0.75rem', color: t.color.textMuted }}>{formatDateTime(entry.createdAt)}</span>
            </div>
            {entry.decision && (
              <div style={{ margin: '6px 0' }}>
                <Badge tone="accent">{entry.decision}</Badge>
              </div>
            )}
            <p style={{ margin: 0, fontSize: '0.875rem', whiteSpace: 'pre-wrap' }}>{entry.note}</p>
          </Card>
        ))
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function RecordingsPanel({
  sessionId,
  recordings,
  onError,
}: {
  sessionId: string;
  recordings: Array<{ id: string; kind: string; durationMs: number | null; createdAt: string }>;
  onError: (message: string) => void;
}) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!can('recording:read') || !recordings.length) return null;

  const play = async (recordingId: string) => {
    try {
      const signed = await api<{ url: string }>(`/admin/recordings/${recordingId}/url`);
      window.open(signed.url, '_blank', 'noopener');
    } catch (err) {
      onError(describe(err));
    }
  };

  const remove = async (recordingId: string) => {
    if (!confirm('Delete this recording? The deletion is permanent and recorded in the audit log.')) return;
    setBusyId(recordingId);
    try {
      await api(`/admin/recordings/${recordingId}`, { method: 'DELETE' });
      onError('');
      window.location.reload();
    } catch (err) {
      onError(describe(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <Button size="sm" variant="secondary" icon={<Icon name="mic" size={15} />} onClick={() => setOpen(!open)}>
        Audio ({recordings.length})
      </Button>
      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: '110%',
            zIndex: 30,
            width: 300,
            background: t.color.surface,
            border: `1px solid ${t.color.border}`,
            borderRadius: t.radius.md,
            boxShadow: t.shadow.lg,
            padding: 12,
            display: 'grid',
            gap: 8,
          }}
        >
          <p style={{ margin: 0, fontSize: '0.75rem', color: t.color.textMuted }}>
            Recordings open through a short-lived signed link, and every access is logged. Session {sessionId.slice(0, 8)}.
          </p>
          {recordings.map((recording) => (
            <div key={recording.id} className="row" style={{ justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.78rem' }}>
                {titleCase(recording.kind)} · {formatDuration(recording.durationMs)}
              </span>
              <span className="row" style={{ gap: 6 }}>
                <Button size="sm" variant="ghost" onClick={() => void play(recording.id)}>
                  Play
                </Button>
                {can('candidate:delete') && (
                  <Button size="sm" variant="ghost" busy={busyId === recording.id} onClick={() => void remove(recording.id)}>
                    Delete
                  </Button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function BulletList({ items, tone }: { items: string[]; tone: 'success' | 'warning' }) {
  return (
    <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
      {items.map((item) => (
        <li key={item}>
          <Icon name={tone === 'success' ? 'check' : 'alert'} size={14} color={tone === 'success' ? t.color.success : t.color.warning} />{' '}
          <span style={{ fontSize: '0.85rem' }}>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: '0.7rem',
        fontWeight: 800,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: t.color.textMuted,
        marginTop: 12,
      }}
    >
      {children}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: '0.78rem', color: t.color.textMuted }}>{children}</div>;
}
