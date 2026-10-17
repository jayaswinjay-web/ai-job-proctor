import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Icon,
  StatTile,
  adminTokens as t,
  formatDate,
  formatPercent,
  proctorEventLabel,
} from '@proctor/ui';
import { api, query } from '../lib/api.js';
import { useAsync, usePersistentState } from '../lib/hooks.js';
import type { DashboardStatsDto } from '@proctor/types';

/**
 * Dashboard overview.
 *
 * Aggregates only. Nothing here exposes a transcript or an answer — the dashboard is a
 * triage surface, and every route that shows candidate content requires `candidate:read`
 * and is itself audited.
 */
export function DashboardPage() {
  const [range, setRange] = usePersistentState<'7d' | '30d' | 'all'>('dashboard.range', '7d');

  /**
   * The range selector drives the query rather than filtering client-side, so the figures
   * always come from the database and match what an export of the same period produces.
   */
  const rangeQuery = useMemo(() => {
    if (range === 'all') return {};
    const days = range === '7d' ? 7 : 30;
    const now = new Date();
    return { dateFrom: new Date(now.getTime() - days * 86_400_000).toISOString(), dateTo: now.toISOString() };
  }, [range]);

  const stats = useAsync<DashboardStatsDto>(
    () => api(`/admin/analytics/dashboard${query(rangeQuery)}`),
    [range],
  );

  const data = stats.data;

  return (
    <div className="stack">
      {stats.error && <Alert tone="danger">{stats.error}</Alert>}

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800 }}>Overview</h2>
          <p style={{ margin: '4px 0 0', color: t.color.textMuted, fontSize: '0.85rem' }}>
            Screening activity across all active jobs.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {(['7d', '30d', 'all'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setRange(option)}
              style={{
                padding: '6px 12px',
                borderRadius: t.radius.md,
                border: `1px solid ${range === option ? t.color.primary : t.color.border}`,
                background: range === option ? t.color.primarySoft : t.color.surface,
                color: range === option ? t.color.primary : t.color.textMuted,
                fontWeight: 700,
                fontSize: '0.78rem',
                cursor: 'pointer',
              }}
            >
              {option === 'all' ? 'All time' : `Last ${option.replace('d', ' days')}`}
            </button>
          ))}
          <button type="button" onClick={stats.reload} style={ghostButton}>
            <Icon name="repeat" size={15} aria-hidden /> Refresh
          </button>
        </div>
      </div>

      <div className="grid-4">
        <StatTile label="Total candidates" value={data?.totalCandidates ?? '—'} />
        <StatTile label="Interviews today" value={data?.interviewsToday ?? '—'} />
        <StatTile
          label="Pending review"
          value={data?.pendingReviews ?? '—'}
          tone={data && data.pendingReviews > 0 ? 'warning' : 'neutral'}
          hint="AI output not yet confirmed by a human"
        />
        <StatTile label="Proctoring alerts" value={data?.proctoringAlerts ?? '—'} tone={data && data.proctoringAlerts > 0 ? 'warning' : 'neutral'} hint="Events awaiting a human decision" />
      </div>

      <div className="grid-4">
        <StatTile label="Average score" value={data ? `${formatPercent(data.averageScore, 1)}` : '—'} hint="Across completed interviews" />
        <StatTile label="Pass rate" value={data ? formatPercent(data.passRate, 1) : '—'} hint="Strong or good match" />
        <StatTile label="Completion rate" value={data ? formatPercent(data.completionRate, 1) : '—'} hint="Finished rather than abandoned" />
        <StatTile label="Active jobs" value={data?.activeJobs ?? '—'} />
      </div>

      <div className="grid-2">
        <Card title="Average score by job" subtitle="Only jobs with completed interviews">
          {!data?.scoresByJob?.length ? (
            <EmptyState title="No completed interviews yet" detail="Scores appear here once candidates finish an interview." />
          ) : (
            <div className="stack" style={{ gap: 12 }}>
              {data.scoresByJob.slice(0, 8).map((row) => (
                <div key={row.jobId}>
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                    <Link className="a-link" to={`/candidates?jobId=${row.jobId}`}>
                      {row.jobTitle}
                    </Link>
                    <span style={{ fontSize: '0.8rem', color: t.color.textMuted }}>
                      {formatPercent(row.averageScore, 1)} · {row.count} interview{row.count === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="bar">
                    <span style={{ width: `${Math.max(2, Math.min(100, row.averageScore))}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Interview language" subtitle="Which language each interview ran in">
          {!data?.languageDistribution?.length ? (
            <EmptyState title="No interviews recorded" />
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {data.languageDistribution.map((row) => {
                const total = data.languageDistribution.reduce((s, r) => s + r.count, 0) || 1;
                return (
                  <div key={row.languageCode} className="row" style={{ justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                      {row.languageCode.toUpperCase()}
                    </span>
                    <div className="row" style={{ gap: 10, flex: 1, justifyContent: 'flex-end' }}>
                      <div className="bar" style={{ maxWidth: 220, flex: 1 }}>
                        <span style={{ width: `${(row.count / total) * 100}%` }} />
                      </div>
                      <span style={{ fontSize: '0.8rem', color: t.color.textMuted, minWidth: 40, textAlign: 'right' }}>
                        {row.count}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Where candidates stop" subtitle="Abandoned sessions grouped by the last stage reached">
          {!data?.dropoffByStage?.length ? (
            <EmptyState title="No abandoned sessions" detail="Every candidate so far reached the end of their interview." />
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {data.dropoffByStage.map((row) => (
                <div key={row.stage} className="row" style={{ justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.85rem' }}>{row.stage.replace(/_/g, ' ').toLowerCase()}</span>
                  <Badge tone="warning">{row.count}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Proctoring events" subtitle="Automated observations, not findings of wrongdoing">
          {!data?.proctorEventStats?.length ? (
            <EmptyState title="No proctoring events recorded" />
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {data.proctorEventStats.map((row) => (
                <div key={row.type} className="row" style={{ justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.85rem' }}>{proctorEventLabel(row.type)}</span>
                  <Badge tone="neutral">{row.count}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card padded={false}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${t.color.border}` }}>
          <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>Next steps</h3>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: t.color.textMuted }}>
            The AI produces a screening output; a person confirms it. Review is the control that makes the
            recommendation usable.
          </p>
        </div>
        <div style={{ padding: 16, display: 'grid', gap: 10 }}>
          <NextStep
            to="/candidates?reviewState=NOT_STARTED"
            icon="clipboard-list"
            title="Review interviews awaiting a decision"
            detail="The AI has scored these; a human has not confirmed them."
            count={data?.pendingReviews}
          />
          <NextStep
            to="/candidates?proctorStatus=REVIEW_REQUIRED"
            icon="shield"
            title="Check proctoring events"
            detail="Events flagged for a human. Each needs context before it means anything."
          />
          <NextStep to="/candidates" icon="users" title="Browse all candidates" detail="Search by name or session ID, and filter by job, language, score and recommendation." />
          {data && data.activeJobs === 0 && (
            <Alert tone="info" title="No jobs are active">
              A kiosk cannot start an interview until a job is active with at least one question.
            </Alert>
          )}
        </div>
      </Card>

      <p style={{ fontSize: '0.75rem', color: t.color.textMuted, textAlign: 'center' }}>
        Figures cover {range === 'all' ? 'all recorded interviews' : `the last ${range === '7d' ? '7' : '30'} days`} and were
        loaded at {formatDate(new Date(), { timeStyle: 'short' })}.
      </p>
    </div>
  );
}

function NextStep({
  to,
  icon,
  title,
  detail,
  count,
}: {
  to: string;
  icon: Parameters<typeof Icon>[0]['name'];
  title: string;
  detail: string;
  count?: number;
}) {
  return (
    <Link
      to={to}
      className="row"
      style={{
        padding: '12px 14px',
        border: `1px solid ${t.color.border}`,
        borderRadius: t.radius.md,
        textDecoration: 'none',
        color: t.color.text,
        background: t.color.surfaceAlt,
        gap: 14,
      }}
    >
      <Icon name={icon} size={20} color={t.color.primary} aria-hidden />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: '0.875rem' }}>{title}</div>
        <div style={{ fontSize: '0.78rem', color: t.color.textMuted }}>{detail}</div>
      </div>
      {typeof count === 'number' && count > 0 && <Badge tone="warning">{count}</Badge>}
      <Icon name="chevron-right" size={18} color={t.color.textMuted} aria-hidden />
    </Link>
  );
}

const ghostButton: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: t.radius.md,
  border: `1px solid ${t.color.border}`,
  background: t.color.surface,
  color: t.color.textMuted,
  fontWeight: 600,
  fontSize: '0.78rem',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};
