import { useState } from 'react';
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
  formatDate,
  titleCase,
} from '@proctor/ui';
import { api, downloadFile, query } from '../lib/api.js';
import { describe, fieldErrors, useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import type { JobDetailDto, JobSummaryDto, LanguageDto } from '@proctor/types';

/**
 * Job management.
 *
 * A job is the unit of configuration the kiosk reads at interview time: its stages,
 * weighting, questions and languages. Editing is therefore split into two tabs — the
 * screening definition here, and the question bank under /questions — so a recruiter
 * never has to scroll a single enormous form.
 *
 * Weight normalisation happens on the server; the percentages shown here are raw inputs
 * and are validated as a set, not individually.
 */

const STATUS_TONE = { DRAFT: 'neutral', ACTIVE: 'success', ARCHIVED: 'warning' } as const;

export function JobsPage() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'DRAFT' | 'ACTIVE' | 'ARCHIVED' | ''>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const jobs = useAsync<{ items: JobSummaryDto[] }>(
    () => api(`/admin/jobs${query({ search: search || undefined, status: status || undefined, includeArchived: true })}`),
    [search, status],
  );

  const languages = useAsync<{ items: LanguageDto[] }>(() => api('/admin/languages'), []);

  const act = async (jobId: string, action: 'activate' | 'deactivate' | 'duplicate') => {
    try {
      await api(`/admin/jobs/${jobId}/${action}`, { method: 'POST' });
      setNotice({ tone: 'success', text: `Job ${action}d.` });
      jobs.reload();
    } catch (err) {
      setNotice({ tone: 'danger', text: describe(err) });
    }
  };

  const archive = async (job: JobSummaryDto) => {
    if (
      !confirm(
        `Archive "${job.title}"?\n\nThe job disappears from the kiosk but interviews, transcripts and reports are kept. This does not delete candidate data.`,
      )
    )
      return;
    try {
      await api(`/admin/jobs/${job.id}`, { method: 'DELETE' });
      setNotice({ tone: 'success', text: 'Job archived.' });
      jobs.reload();
    } catch (err) {
      setNotice({ tone: 'danger', text: describe(err) });
    }
  };

  return (
    <div className="stack">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row" style={{ gap: 10 }}>
          <div style={{ position: 'relative' }}>
            <Icon
              name="search"
              size={17}
              color={t.color.textMuted}
              style={{ position: 'absolute', left: 12, top: 12, pointerEvents: 'none' }}
            />
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search jobs"
              aria-label="Search jobs"
              style={{ paddingLeft: 38, width: 260 }}
            />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} style={{ width: 160 }}>
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="DRAFT">Draft</option>
            <option value="ARCHIVED">Archived</option>
          </Select>
        </div>
        {can('job:write') && (
          <Button variant="primary" icon={<Icon name="plus" size={16} />} onClick={() => setCreating(true)}>
            New job
          </Button>
        )}
      </div>

      {jobs.error && <Alert tone="danger">{jobs.error}</Alert>}

      {creating && can('job:write') && (
        <JobForm
          languages={languages.data?.items ?? []}
          onCancel={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            jobs.reload();
            setNotice({ tone: 'success', text: 'Job created as a draft. Add questions, then activate it.' });
          }}
        />
      )}

      {!jobs.data?.items.length ? (
        <Card>
          <EmptyState
            title="No jobs configured"
            detail="A job defines the stages, weighting and questions the kiosk will run. Create one before testing the kiosk."
          />
        </Card>
      ) : (
        <div className="scroll-x">
          <Card padded={false}>
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Status</th>
                  <th>Languages</th>
                  <th>Questions</th>
                  <th>Pass mark</th>
                  <th>Duration</th>
                  <th>Interviews</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {jobs.data.items.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <strong>{job.title}</strong>
                      <div style={{ color: t.color.textMuted, fontSize: '0.78rem' }}>
                        {[job.department, job.location].filter(Boolean).join(' · ') || 'No location set'}
                      </div>
                    </td>
                    <td>
                      <Badge tone={STATUS_TONE[job.status]}>{titleCase(job.status)}</Badge>
                    </td>
                    <td>{job.preferredLanguages.map((l) => l.toUpperCase()).join(', ')}</td>
                    <td>{job.questionCount}</td>
                    <td>{job.passingScore}</td>
                    <td>{job.interviewDurationMinutes} min</td>
                    <td>{job.candidateCount}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(job.updatedAt)}</td>
                    <td>
                      <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        <Button size="sm" variant="secondary" onClick={() => setSelectedId(job.id)}>
                          {selectedId === job.id ? 'Close' : 'Open'}
                        </Button>
                        {can('job:write') && (
                          <>
                            {job.status === 'ACTIVE' ? (
                              <Button size="sm" variant="ghost" onClick={() => void act(job.id, 'deactivate')}>
                                Deactivate
                              </Button>
                            ) : job.status !== 'ARCHIVED' ? (
                              <Button size="sm" variant="ghost" onClick={() => void act(job.id, 'activate')}>
                                Activate
                              </Button>
                            ) : null}
                            <Button size="sm" variant="ghost" onClick={() => void act(job.id, 'duplicate')}>
                              Duplicate
                            </Button>
                          </>
                        )}
                        {can('job:archive') && job.status !== 'ARCHIVED' && (
                          <Button size="sm" variant="ghost" onClick={() => void archive(job)}>
                            Archive
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {selectedId && (
        <JobDetailPanel
          jobId={selectedId}
          languages={languages.data?.items ?? []}
          onClose={() => setSelectedId(null)}
          onChanged={() => {
            jobs.reload();
            setNotice({ tone: 'success', text: 'Job updated.' });
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function JobDetailPanel({
  jobId,
  languages,
  onClose,
  onChanged,
}: {
  jobId: string;
  languages: LanguageDto[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { can } = useAuth();
  const detail = useAsync<JobDetailDto>(() => api(`/admin/jobs/${jobId}`), [jobId]);

  return (
    <Card
      title={detail.data?.title ?? 'Job'}
      subtitle={detail.data ? `${detail.data.questionCount} questions · pass mark ${detail.data.passingScore}` : undefined}
      actions={
        <div className="row" style={{ gap: 8 }}>
          {can('question:read') && (
            <Button
              size="sm"
              variant="secondary"
              icon={<Icon name="download" size={15} />}
              onClick={() => void downloadFile(`/admin/jobs/${jobId}/questions.csv`, 'questions.csv').catch((e: Error) => alert(e.message))}
            >
              Questions CSV
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      {detail.error && <Alert tone="danger">{detail.error}</Alert>}
      {detail.loading && !detail.data && <Muted>Loading…</Muted>}

      {detail.data && can('job:write') && (
        <JobForm
          job={detail.data}
          languages={languages}
          onCancel={onClose}
          onSaved={() => {
            detail.reload();
            onChanged();
          }}
        />
      )}

      {detail.data && (
        <div style={{ marginTop: 18, display: 'grid', gap: 12 }}>
          <h4 style={{ margin: 0, fontSize: '0.9rem' }}>Interview stages</h4>
          <table>
            <thead>
              <tr>
                <th>Stage</th>
                <th>Kind</th>
                <th>Max questions</th>
                <th>Weight</th>
              </tr>
            </thead>
            <tbody>
              {detail.data.stages.map((stage) => (
                <tr key={stage.id}>
                  <td>{stage.title}</td>
                  <td>{titleCase(stage.kind)}</td>
                  <td>{stage.maxQuestions}</td>
                  <td>{stage.weight}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4 style={{ margin: '8px 0 0', fontSize: '0.9rem' }}>Scoring weights</h4>
          <div className="row">
            {Object.entries(detail.data.weights).map(([key, value]) => (
              <Badge key={key} tone="neutral">
                {titleCase(key)}: {String(value)}
              </Badge>
            ))}
          </div>
          <p style={{ margin: 0, fontSize: '0.75rem', color: t.color.textMuted }}>
            Weights are normalised to 100% by the server when the report is generated.
          </p>

          {detail.data.eligibilityCriteria.length > 0 && (
            <>
              <h4 style={{ margin: '8px 0 0', fontSize: '0.9rem' }}>Eligibility criteria</h4>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {detail.data.eligibilityCriteria.map((criterion) => (
                  <li key={criterion} style={{ fontSize: '0.85rem' }}>
                    {criterion}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */

const DEFAULT_WEIGHTS = {
  relevantExperience: 20,
  jobKnowledge: 20,
  practicalUnderstanding: 20,
  safetyAwareness: 15,
  communication: 10,
  reliability: 10,
  other: 5,
};

function JobForm({
  job,
  languages,
  onCancel,
  onSaved,
}: {
  job?: JobDetailDto;
  languages: LanguageDto[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(job?.title ?? '');
  const [description, setDescription] = useState(job?.description ?? '');
  const [location, setLocation] = useState(job?.location ?? '');
  const [department, setDepartment] = useState(job?.department ?? '');
  const [passingScore, setPassingScore] = useState(String(job?.passingScore ?? 60));
  const [duration, setDuration] = useState(String(job?.interviewDurationMinutes ?? 15));
  const [minExperience, setMinExperience] = useState(String(job?.minExperienceYears ?? 0));
  const [selected, setSelected] = useState<string[]>(job?.preferredLanguages ?? languages.map((l) => l.code));
  const [skills, setSkills] = useState((job?.requiredSkills ?? []).join(', '));
  const [criteria, setCriteria] = useState((job?.eligibilityCriteria ?? []).join('\n'));
  const [weights, setWeights] = useState<Record<string, number>>({
    ...DEFAULT_WEIGHTS,
    ...(job?.weights as Record<string, number> | undefined),
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    setErrors({});
    const body = {
      title: title.trim(),
      description: description.trim(),
      location: location.trim(),
      department: department.trim(),
      minExperienceYears: Number(minExperience) || 0,
      requiredSkills: skills.split(',').map((s) => s.trim()).filter(Boolean),
      preferredLanguages: selected,
      eligibilityCriteria: criteria.split('\n').map((s) => s.trim()).filter(Boolean),
      interviewDurationMinutes: Number(duration) || 15,
      passingScore: Number(passingScore) || 60,
      weights,
      stages:
        job?.stages.map((s) => ({
          id: s.id,
          kind: s.kind,
          title: s.title,
          instructions: s.instructions,
          maxQuestions: s.maxQuestions,
          weight: s.weight,
          sortOrder: s.sortOrder,
        })) ?? DEFAULT_STAGES.map((stage) => ({ ...stage })),
      proctoring: job?.proctoring ?? {},
    };
    try {
      if (job) await api(`/admin/jobs/${job.id}`, { method: 'PATCH', body });
      else await api('/admin/jobs', { body });
      onSaved();
    } catch (err) {
      setError(describe(err));
      setErrors(fieldErrors(err));
    } finally {
      setBusy(false);
    }
  };

  const weightTotal = Object.values(weights).reduce((a, b) => a + Number(b || 0), 0);

  return (
    <Card title={job ? `Edit “${job.title}”` : 'New job'} subtitle="Stages and weights are used to build the interview and the score.">
      {error && (
        <div style={{ marginBottom: 14 }}>
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      <div className="grid-2">
        <Field label="Job title" htmlFor="title" required error={errors.title?.[0]}>
          <TextInput id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Department" htmlFor="department">
          <TextInput id="department" value={department} onChange={(e) => setDepartment(e.target.value)} />
        </Field>
        <Field label="Location" htmlFor="location">
          <TextInput id="location" value={location} onChange={(e) => setLocation(e.target.value)} />
        </Field>
        <Field label="Minimum experience (years)" htmlFor="minExp">
          <TextInput id="minExp" type="number" min={0} max={60} value={minExperience} onChange={(e) => setMinExperience(e.target.value)} />
        </Field>
        <Field label="Passing score" htmlFor="pass" hint="Used to separate strong matches from the rest.">
          <TextInput id="pass" type="number" min={0} max={100} value={passingScore} onChange={(e) => setPassingScore(e.target.value)} />
        </Field>
        <Field label="Interview duration (minutes)" htmlFor="duration">
          <TextInput id="duration" type="number" min={1} max={240} value={duration} onChange={(e) => setDuration(e.target.value)} />
        </Field>
      </div>

      <div style={{ marginTop: 14 }}>
        <Field label="Job description" htmlFor="description" hint="Shown to recruiters, not to candidates.">
          <TextArea id="description" value={description} onChange={(e) => setDescription(e.target.value)} style={{ minHeight: 70 }} />
        </Field>
      </div>

      <div style={{ marginTop: 14 }}>
        <Field label="Required skills" htmlFor="skills" hint="Comma separated.">
          <TextInput id="skills" value={skills} onChange={(e) => setSkills(e.target.value)} />
        </Field>
      </div>

      <div style={{ marginTop: 14 }}>
        <Field
          label="Interview languages"
          required
          hint="The kiosk shows only these. Each question needs a translation in each language."
          error={errors.preferredLanguages?.[0]}
        >
          <div className="row">
            {languages.map((language) => (
              <label key={language.code} className="row" style={{ gap: 6, fontSize: '0.85rem' }}>
                <input
                  type="checkbox"
                  checked={selected.includes(language.code)}
                  onChange={(e) =>
                    setSelected((current) =>
                      e.target.checked ? [...current, language.code] : current.filter((c) => c !== language.code),
                    )
                  }
                />
                {language.name} ({language.code.toUpperCase()})
              </label>
            ))}
          </div>
        </Field>
      </div>

      <div style={{ marginTop: 14 }}>
        <Field label="Eligibility criteria" htmlFor="criteria" hint="One per line. Stated as requirements, never as exclusions.">
          <TextArea id="criteria" value={criteria} onChange={(e) => setCriteria(e.target.value)} />
        </Field>
      </div>

      <div style={{ marginTop: 14 }}>
        <Field label="Scoring weights" hint={`Total ${weightTotal}. Normalised automatically, so any total works.`}>
          <div className="grid-4">
            {Object.entries(weights).map(([key, value]) => (
              <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: t.color.textMuted }}>{titleCase(key)}</span>
                <TextInput
                  type="number"
                  min={0}
                  max={100}
                  value={value}
                  onChange={(e) => setWeights((current) => ({ ...current, [key]: Number(e.target.value) }))}
                />
              </label>
            ))}
          </div>
        </Field>
      </div>

      {!job && (
        <Alert tone="info">
          A new job starts as a draft with a default stage structure. Add questions on the question bank page, then
          activate it to make it visible on the kiosk.
        </Alert>
      )}

      <div className="row" style={{ marginTop: 16 }}>
        <Button variant="primary" busy={busy} onClick={() => void save()}>
          {job ? 'Save changes' : 'Create draft job'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

/**
 * Default voice-first stage structure.
 *
 * Stage kinds are the fixed lifecycle the interview engine understands, so a stage's
 * `kind` is chosen from that list while its `title` is free text a recruiter can edit.
 */
const DEFAULT_STAGES = [
  { kind: 'GREETING', title: 'Welcome', instructions: '', maxQuestions: 1, weight: 0, sortOrder: 0 },
  { kind: 'BASIC_DETAILS', title: 'About you', instructions: '', maxQuestions: 3, weight: 15, sortOrder: 1 },
  { kind: 'JOB_QUESTIONS', title: 'Work experience', instructions: '', maxQuestions: 3, weight: 25, sortOrder: 2 },
  { kind: 'JOB_QUESTIONS', title: 'Skills', instructions: '', maxQuestions: 3, weight: 20, sortOrder: 3 },
  { kind: 'JOB_QUESTIONS', title: 'Practical understanding', instructions: '', maxQuestions: 2, weight: 20, sortOrder: 4 },
  { kind: 'ELIGIBILITY_CHECK', title: 'Requirements', instructions: '', maxQuestions: 2, weight: 15, sortOrder: 5 },
  { kind: 'CLOSING', title: 'Closing', instructions: '', maxQuestions: 1, weight: 0, sortOrder: 6 },
] as const;

function Muted({ children }: { children: React.ReactNode }) {
  return <span style={{ color: t.color.textMuted, fontSize: '0.85rem' }}>{children}</span>;
}
