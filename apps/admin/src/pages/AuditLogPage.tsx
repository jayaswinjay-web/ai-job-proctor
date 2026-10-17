import { Fragment, useState } from 'react';
import { Alert, Badge, Button, Card, EmptyState, Field, Select, TextInput, adminTokens as t, formatDateTime } from '@proctor/ui';
import { api, query } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';

/**
 * Audit log.
 *
 * Read-only by design: there is no way to edit or delete an entry from this application,
 * and filtering is by exact action or entity so an investigation can be reproduced
 * exactly. Previous and next values are shown as JSON because the point of an audit trail
 * is to show the change, not to summarise it.
 */

interface AuditRow {
  id: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string | null;
  previous: unknown;
  next: unknown;
  ipHash: string | null;
  createdAt: string;
}

export function AuditLogPage() {
  const { can } = useAuth();
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [entityId, setEntityId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const logs = useAsync<{ items: AuditRow[]; total: number; page: number; pageSize: number }>(
    () =>
      api(
        `/admin/audit-logs${query({
          actorId: actor.trim() || undefined,
          action: action.trim() || undefined,
          entityType: entityType || undefined,
          entityId: entityId.trim() || undefined,
          from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
          to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
          page,
          pageSize: 50,
        })}`,
      ),
    [actor, action, entityType, entityId, from, to, page],
  );

  const reset = () => {
    setActor('');
    setAction('');
    setEntityType('');
    setEntityId('');
    setFrom('');
    setTo('');
    setPage(1);
  };

  const totalPages = logs.data ? Math.max(1, Math.ceil(logs.data.total / 50)) : 1;

  if (!can('audit:read')) {
    return <Alert tone="warning">Your role cannot read the audit log.</Alert>;
  }

  return (
    <div className="stack">
      <Alert tone="info">
        Entries are append-only and cannot be changed from this application. Record access, exports, deletions, role
        changes and every review decision are captured here.
      </Alert>

      <Card>
        <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
          <Field label="Action" hint="Exact match, e.g. review.submitted">
            <TextInput value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} style={{ width: 210 }} />
          </Field>
          <Field label="Entity type">
            <Select value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }} style={{ width: 180 }}>
              <option value="">Any</option>
              <option value="interview_session">Interview session</option>
              <option value="user">User</option>
              <option value="job">Job</option>
              <option value="question">Question</option>
              <option value="settings">Settings</option>
              <option value="audio_recording">Audio recording</option>
              <option value="proctoring_event">Proctoring event</option>
            </Select>
          </Field>
          <Field label="Entity ID">
            <TextInput value={entityId} onChange={(e) => { setEntityId(e.target.value); setPage(1); }} style={{ width: 200 }} />
          </Field>
          <Field label="Actor ID" hint="User UUID">
            <TextInput value={actor} onChange={(e) => { setActor(e.target.value); setPage(1); }} style={{ width: 200 }} />
          </Field>
          <Field label="From">
            <TextInput type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} style={{ width: 160 }} />
          </Field>
          <Field label="To">
            <TextInput type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} style={{ width: 160 }} />
          </Field>
          <Button variant="ghost" onClick={reset}>
            Clear
          </Button>
        </div>
      </Card>

      {logs.error && <Alert tone="danger">{logs.error}</Alert>}

      {!logs.data?.items.length ? (
        <Card>
          <EmptyState title="No audit entries match" detail="Adjust the filters, or wait for activity." />
        </Card>
      ) : (
        <div className="scroll-x">
          <Card padded={false}>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Change</th>
                </tr>
              </thead>
              <tbody>
                {logs.data.items.map((entry) => (
                  <Fragment key={entry.id}>
                    <tr>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(entry.createdAt)}</td>
                      <td>{entry.actor}</td>
                      <td>
                        <Badge tone="neutral">{entry.action}</Badge>
                      </td>
                      <td>
                        {entry.entityType}
                        {entry.entityId && (
                          <div className="mono" style={{ color: t.color.textMuted }}>
                            {entry.entityId}
                          </div>
                        )}
                      </td>
                      <td>
                        <Button size="sm" variant="ghost" onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}>
                          {expanded === entry.id ? 'Hide' : 'Show'}
                        </Button>
                      </td>
                    </tr>
                    {expanded === entry.id && (
                      <tr>
                        <td colSpan={5} style={{ background: t.color.surfaceAlt }}>
                          <div className="grid-2">
                            <div>
                              <div style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', color: t.color.textMuted }}>
                                Before
                              </div>
                              <pre className="mono" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', fontSize: '0.75rem' }}>
                                {entry.previous ? JSON.stringify(entry.previous, null, 2) : '—'}
                              </pre>
                            </div>
                            <div>
                              <div style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', color: t.color.textMuted }}>
                                After
                              </div>
                              <pre className="mono" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', fontSize: '0.75rem' }}>
                                {entry.next ? JSON.stringify(entry.next, null, 2) : '—'}
                              </pre>
                            </div>
                          </div>
                          {entry.ipHash && (
                            <p style={{ margin: '10px 0 0', fontSize: '0.72rem', color: t.color.textMuted }}>
                              Network address hash: <span className="mono">{entry.ipHash}</span> (stored hashed, never in
                              the clear)
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {logs.data && logs.data.total > 50 && (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.8rem', color: t.color.textMuted }}>{logs.data.total} entries</span>
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
    </div>
  );
}
