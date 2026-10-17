import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  Select,
  TextInput,
  adminTokens as t,
  formatDateTime,
  recommendationLabel,
  recommendationTone,
} from '@proctor/ui';
import { api, downloadFile, query } from '../lib/api.js';
import { useAsync, useDebounced } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import type { CandidateListItemDto, JobSummaryDto, LanguageDto } from '@proctor/types';

/**
 * Candidate list.
 *
 * Every control here exists because a recruiter actually needs it: search by name or
 * session id, filter by job / language / recommendation / review state / proctoring, and
 * sort by date or score. The default view is *not* sorted by score, because a recruiter
 * looking for someone to review needs the oldest pending item first, not the best one.
 */

interface ListResponse {
  items: CandidateListItemDto[];
  total: number;
  page: number;
  pageSize: number;
}

export function CandidatesPage() {
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const [searchDraft, setSearchDraft] = useState(params.get('search') ?? '');
  const search = useDebounced(searchDraft, 320);

  const page = Number(params.get('page') ?? 1);
  const pageSize = Number(params.get('pageSize') ?? 25);

  const filters = {
    jobId: params.get('jobId') ?? undefined,
    languageCode: params.get('languageCode') ?? undefined,
    status: params.get('status') ?? undefined,
    recommendation: params.get('recommendation') ?? undefined,
    reviewState: params.get('reviewState') ?? undefined,
    proctorStatus: params.get('proctorStatus') ?? undefined,
    minScore: params.get('minScore') ?? undefined,
    maxScore: params.get('maxScore') ?? undefined,
    sort: params.get('sort') ?? 'date_desc',
  };

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const jobs = useAsync<{ items: JobSummaryDto[] }>(() => api('/admin/jobs?includeArchived=true'), []);
  const languages = useAsync<{ items: LanguageDto[] }>(() => api('/admin/languages'), []);

  const list = useAsync<ListResponse>(
    () =>
      api(
        `/admin/candidates${query({
          ...filters,
          search: search || undefined,
          page,
          pageSize,
        })}`,
      ),
    [params.toString(), search],
  );

  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / pageSize)) : 1;

  return (
    <div className="stack">
      {list.error && <Alert tone="danger">{list.error}</Alert>}

      <Card padded={false}>
        <div style={{ padding: 16, borderBottom: `1px solid ${t.color.border}` }}>
          <div className="row" style={{ gap: 12 }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
              <Icon
                name="search"
                size={17}
                color={t.color.textMuted}
                style={{ position: 'absolute', left: 12, top: 12, pointerEvents: 'none' }}
              />
              <TextInput
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder="Search by candidate name or session ID"
                aria-label="Search candidates"
                style={{ paddingLeft: 38 }}
              />
            </div>
            <Select value={filters.sort} onChange={(e) => update('sort', e.target.value)} aria-label="Sort" style={{ width: 190 }}>
              <option value="date_desc">Newest first</option>
              <option value="date_asc">Oldest first</option>
              <option value="score_desc">Highest score</option>
              <option value="score_asc">Lowest score</option>
              <option value="name_asc">Name A–Z</option>
            </Select>
            {can('report:export') && (
              <Button
                variant="secondary"
                icon={<Icon name="download" size={15} />}
                onClick={() =>
                  void downloadFile(
                    `/admin/exports/candidates${query({
                      ...filters,
                      search: search || undefined,
                      format: 'CSV',
                    })}`,
                    'candidates.csv',
                  ).catch((e: Error) => alert(e.message))
                }
              >
                Export CSV
              </Button>
            )}
          </div>

          <div className="row" style={{ gap: 10, marginTop: 12 }}>
            <FilterSelect
              label="Job"
              value={filters.jobId ?? ''}
              onChange={(v) => update('jobId', v)}
              options={(jobs.data?.items ?? []).map((j) => ({ value: j.id, label: j.title }))}
              allLabel="All jobs"
            />
            <FilterSelect
              label="Language"
              value={filters.languageCode ?? ''}
              onChange={(v) => update('languageCode', v)}
              options={(languages.data?.items ?? []).map((l) => ({ value: l.code, label: l.name }))}
              allLabel="Any language"
            />
            <FilterSelect
              label="Recommendation"
              value={filters.recommendation ?? ''}
              onChange={(v) => update('recommendation', v)}
              options={[
                { value: 'PENDING_REVIEW', label: 'Pending review' },
                { value: 'STRONG_MATCH', label: 'Strong match' },
                { value: 'GOOD_MATCH', label: 'Good match' },
                { value: 'CONSIDER', label: 'Consider' },
                { value: 'NOT_RECOMMENDED', label: 'Not recommended' },
              ]}
              allLabel="Any"
            />
            <FilterSelect
              label="Review state"
              value={filters.reviewState ?? ''}
              onChange={(v) => update('reviewState', v)}
              options={[
                { value: 'NOT_STARTED', label: 'Not reviewed' },
                { value: 'IN_PROGRESS', label: 'In progress' },
                { value: 'REVIEWED', label: 'Reviewed' },
              ]}
              allLabel="Any"
            />
            <FilterSelect
              label="Proctoring"
              value={filters.proctorStatus ?? ''}
              onChange={(v) => update('proctorStatus', v)}
              options={[
                { value: 'CLEAR', label: 'No events' },
                { value: 'EVENTS', label: 'Events recorded' },
                { value: 'REVIEW_REQUIRED', label: 'Needs review' },
              ]}
              allLabel="Any"
            />
            {(Object.keys(filters).some((k) => filters[k as keyof typeof filters]) || search) && (
              <Button size="sm" variant="ghost" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                Clear filters
              </Button>
            )}
          </div>
        </div>

        {list.loading && !list.data ? (
          <div style={{ padding: 32, textAlign: 'center', color: t.color.textMuted }}>Loading…</div>
        ) : !list.data?.items.length ? (
          <EmptyState
            title="No interviews match these filters"
            detail="Try clearing a filter, or run a test interview from the kiosk to see the flow end to end."
          />
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Job</th>
                  <th>Date</th>
                  <th>Language</th>
                  <th>Score</th>
                  <th>Recommendation</th>
                  <th>Review</th>
                  <th>Proctoring</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((row) => (
                  <tr key={row.sessionId}>
                    <td>
                      <Link className="a-link" to={`/candidates/${row.sessionId}`}>
                        {row.candidateName || 'Name not captured'}
                      </Link>
                      <div className="mono" style={{ color: t.color.textMuted, marginTop: 2 }}>
                        {row.publicId}
                      </div>
                      {row.isDemo && (
                        <div style={{ marginTop: 4 }}>
                          <Badge tone="warning">demo data</Badge>
                        </div>
                      )}
                    </td>
                    <td>{row.jobTitle}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(row.interviewDate)}</td>
                    <td>
                      <Badge tone="neutral">{row.languageCode.toUpperCase()}</Badge>
                    </td>
                    <td>
                      {row.overallScore === null ? (
                        <span style={{ color: t.color.textMuted }}>—</span>
                      ) : (
                        <strong>{row.overallScore.toFixed(0)}</strong>
                      )}
                    </td>
                    <td>
                      <Badge tone={recommendationTone(row.recommendation)}>
                        {recommendationLabel(row.recommendation)}
                      </Badge>
                    </td>
                    <td>
                      <Badge
                        tone={
                          row.reviewState === 'REVIEWED' ? 'success' : row.reviewState === 'IN_PROGRESS' ? 'warning' : 'neutral'
                        }
                      >
                        {row.reviewState.replace(/_/g, ' ').toLowerCase()}
                      </Badge>
                    </td>
                    <td>
                      {row.proctorStatus === 'CLEAR' ? (
                        <span style={{ color: t.color.textMuted }}>—</span>
                      ) : (
                        <Badge tone={row.proctorStatus === 'REVIEW_REQUIRED' ? 'warning' : 'neutral'}>
                          {row.proctorStatus === 'REVIEW_REQUIRED' ? 'needs review' : 'events'}
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {list.data && list.data.total > pageSize && (
          <div
            className="row"
            style={{ justifyContent: 'space-between', padding: 14, borderTop: `1px solid ${t.color.border}` }}
          >
            <span style={{ fontSize: '0.8rem', color: t.color.textMuted }}>
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, list.data.total)} of {list.data.total}
            </span>
            <div className="row" style={{ gap: 8 }}>
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => update('page', String(page - 1))}>
                Previous
              </Button>
              <span style={{ fontSize: '0.8rem' }}>
                Page {page} of {totalPages}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={page >= totalPages}
                onClick={() => update('page', String(page + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  allLabel: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: '0.7rem', fontWeight: 700, color: t.color.textMuted, textTransform: 'uppercase' }}>
        {label}
      </span>
      <Select value={value} onChange={(e) => onChange(e.target.value)} style={{ minWidth: 150, fontSize: '0.8rem' }}>
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </label>
  );
}
