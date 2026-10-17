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
  StatTile,
  TextInput,
  adminTokens as t,
  formatPercent,
  proctorEventLabel,
  titleCase,
} from '@proctor/ui';
import { api, downloadFile, query } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import type { DashboardStatsDto, JobSummaryDto } from '@proctor/types';

/**
 * Reports.
 *
 * Aggregated, period-scoped figures plus export buttons. Exports carry the same
 * date range and job filter as the figures on screen, because a report that disagrees
 * with the dashboard it was generated from is how wrong decisions get made.
 */
export function ReportsPage() {
  const { can } = useAuth();
  const today = new Date();
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 86_400_000);

  const [jobId, setJobId] = useState('');
  const [from, setFrom] = useState(thirtyDaysAgo.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const [format, setFormat] = useState<'CSV' | 'XLSX' | 'PDF'>('CSV');
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const jobs = useAsync<{ items: JobSummaryDto[] }>(() => api('/admin/jobs?includeArchived=true'), []);

  const range = {
    jobId: jobId || undefined,
    dateFrom: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    dateTo: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
  };

  const stats = useAsync<DashboardStatsDto>(
    () => api(`/admin/analytics/dashboard${query(range)}`),
    [jobId, from, to],
  );

  const exportReport = async () => {
    setExporting(true);
    setError(null);
    try {
      await downloadFile(`/admin/exports/candidates${query({ ...range, format })}`, `candidates.${format.toLowerCase()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The export failed.');
    } finally {
      setExporting(false);
    }
  };

  const data = stats.data;
  const totalInterviews = data ? data.completedInterviews + (data.totalCandidates - data.completedInterviews) : 0;

  return (
    <div className="stack">
      {error && <Alert tone="danger">{error}</Alert>}
      {stats.error && <Alert tone="danger">{stats.error}</Alert>}

      <Card>
        <div className="row" style={{ gap: 14, alignItems: 'flex-end' }}>
          <Field label="Job" htmlFor="job">
            <Select id="job" value={jobId} onChange={(e) => setJobId(e.target.value)} style={{ minWidth: 210 }}>
              <option value="">All jobs</option>
              {(jobs.data?.items ?? []).map((job) => (
                <option key={job.id} value={job.id}>
                  {job.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From" htmlFor="from">
            <TextInput id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 165 }} />
          </Field>
          <Field label="To" htmlFor="to">
            <TextInput id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 165 }} />
          </Field>
          {can('report:export') && (
            <>
              <Field label="Format" htmlFor="format">
                <Select id="format" value={format} onChange={(e) => setFormat(e.target.value as typeof format)} style={{ width: 120 }}>
                  <option value="CSV">CSV</option>
                  <option value="XLSX">Excel</option>
                  <option value="PDF">PDF</option>
                </Select>
              </Field>
              <Button variant="primary" busy={exporting} icon={<Icon name="download" size={15} />} onClick={() => void exportReport()}>
                Export
              </Button>
            </>
          )}
        </div>
        <p style={{ margin: '12px 0 0', fontSize: '0.75rem', color: t.color.textMuted }}>
          Every export is written to the audit log with the range, the filters and who requested it.
        </p>
      </Card>

      <div className="grid-4">
        <StatTile label="Interviews started" value={data?.totalCandidates ?? '—'} />
        <StatTile label="Completed" value={data?.completedInterviews ?? '—'} hint={`${formatPercent(data?.completionRate ?? null, 0)} of those started`} />
        <StatTile label="Average score" value={data?.averageScore !== null && data?.averageScore !== undefined ? formatPercent(data.averageScore, 1) : '—'} />
        <StatTile label="Pass rate" value={formatPercent(data?.passRate ?? null, 1)} hint="Strong or good match" />
      </div>

      <div className="grid-2">
        <Card title="Score by job" subtitle="Average overall score for the selected period">
          {!data?.scoresByJob.length ? (
            <EmptyState title="No completed interviews in this period" />
          ) : (
            <div className="scroll-x">
              <table>
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Interviews</th>
                    <th>Average score</th>
                  </tr>
                </thead>
                <tbody>
                  {data.scoresByJob.map((row) => (
                    <tr key={row.jobId}>
                      <td>{row.jobTitle}</td>
                      <td>{row.count}</td>
                      <td>{row.averageScore.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Interview mix" subtitle="Languages used and where candidates stopped">
          <div className="stack" style={{ gap: 14 }}>
            <div>
              <Label>By language</Label>
              {!data?.languageDistribution.length ? (
                <EmptyState title="No interviews recorded" />
              ) : (
                <div className="row" style={{ marginTop: 8 }}>
                  {data.languageDistribution.map((row) => (
                    <Badge key={row.languageCode} tone="accent">
                      {row.languageCode.toUpperCase()}: {row.count}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <div>
              <Label>Not completed</Label>
              {!data?.dropoffByStage.length ? (
                <span style={{ fontSize: '0.82rem', color: t.color.textMuted }}>No abandoned interviews in this period.</span>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Last stage reached</th>
                      <th>Candidates</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.dropoffByStage.map((row) => (
                      <tr key={row.stage}>
                        <td>{titleCase(row.stage)}</td>
                        <td>{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </Card>
      </div>

      <Card title="Proctoring signals" subtitle="How often each automated observation fired">
        {!data?.proctorEventStats.length ? (
          <EmptyState title="No proctoring events in this period" />
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Observation</th>
                  <th>Count</th>
                  <th>Share of interviews</th>
                </tr>
              </thead>
              <tbody>
                {data.proctorEventStats.map((row) => (
                  <tr key={row.type}>
                    <td>{proctorEventLabel(row.type)}</td>
                    <td>{row.count}</td>
                    <td>{totalInterviews ? formatPercent((row.count / totalInterviews) * 100, 1) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ margin: '14px 0 0', fontSize: '0.75rem', color: t.color.textMuted }}>
          These counts describe what the kiosk observed. They are not findings about any candidate, and they are not a
          measure of candidate quality.
        </p>
      </Card>
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
