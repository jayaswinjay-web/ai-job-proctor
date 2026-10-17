import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Icon,
  TextInput,
  adminTokens as t,
  formatDateTime,
  titleCase,
} from '@proctor/ui';
import { api } from '../lib/api.js';
import { describe, fieldErrors, useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import type { Permission } from '@proctor/types';

/**
 * User and role management.
 *
 * Roles are fixed by the API and shown with the permissions each one carries, because an
 * administrator granting access needs to see exactly what they are granting. Password
 * rules are enforced server-side and surfaced inline rather than only on submit.
 */

const ROLES: Array<{ role: string; blurb: string; permissions: Permission[] }> = [
  {
    role: 'SUPER_ADMIN',
    blurb: 'Full access, including user management and destructive operations.',
    permissions: [
      'job:read', 'job:write', 'job:archive', 'question:read', 'question:write', 'question:publish',
      'candidate:read', 'candidate:delete', 'review:write', 'recording:read', 'report:read', 'report:export',
      'settings:read', 'settings:write', 'audit:read', 'user:manage',
    ],
  },
  {
    role: 'RECRUITER',
    blurb: 'Runs interviews, reads candidates and records review decisions.',
    permissions: ['job:read', 'question:read', 'candidate:read', 'review:write', 'recording:read', 'report:read', 'report:export'],
  },
  {
    role: 'REVIEWER',
    blurb: 'Confirms or overrides AI assessments. Cannot change configuration.',
    permissions: ['candidate:read', 'review:write', 'report:read', 'recording:read'],
  },
  {
    role: 'VIEWER',
    blurb: 'Read-only access to dashboards and candidate records.',
    permissions: ['candidate:read', 'report:read'],
  },
];

interface UserRow {
  id: string;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
  isActive: boolean;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export function UsersPage() {
  const { can, user: me } = useAuth();
  const users = useAsync<{ items: UserRow[] }>(() => api('/admin/users'), []);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const toggleActive = async (row: UserRow) => {
    if (!confirm(row.isActive ? `Disable ${row.email}? They will be signed out immediately.` : `Re-enable ${row.email}?`)) return;
    setSavingId(row.id);
    try {
      await api(`/admin/users/${row.id}`, { method: 'PATCH', body: { isActive: !row.isActive } });
      setNotice({ tone: 'success', text: row.isActive ? 'Account disabled.' : 'Account enabled.' });
      users.reload();
    } catch (err) {
      setNotice({ tone: 'danger', text: describe(err) });
    } finally {
      setSavingId(null);
    }
  };

  const changeRoles = async (row: UserRow, roles: string[]) => {
    setSavingId(row.id);
    try {
      await api(`/admin/users/${row.id}`, { method: 'PATCH', body: { roles } });
      setNotice({ tone: 'success', text: `Roles updated for ${row.email}.` });
      users.reload();
    } catch (err) {
      setNotice({ tone: 'danger', text: describe(err) });
    } finally {
      setSavingId(null);
    }
  };

  if (!can('user:manage')) {
    return <Alert tone="warning">Only a Super Administrator can manage users.</Alert>;
  }

  return (
    <div className="stack">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>Users & roles</h2>
          <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: t.color.textMuted }}>
            Every account change is written to the audit log with the previous and new roles.
          </p>
        </div>
        <Button variant="primary" icon={<Icon name="plus" size={16} />} onClick={() => setCreating(true)}>
          Add user
        </Button>
      </div>

      {creating && (
        <CreateUserForm
          onCancel={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            users.reload();
            setNotice({ tone: 'success', text: 'Account created. Share the password out of band; it is never shown again.' });
          }}
        />
      )}

      {!users.data?.items.length ? (
        <Card>
          <EmptyState title="No accounts" />
        </Card>
      ) : (
        <div className="scroll-x">
          <Card padded={false}>
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Roles</th>
                  <th>Status</th>
                  <th>Two-factor</th>
                  <th>Last sign-in</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.data.items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.name}</strong>
                      <div style={{ color: t.color.textMuted, fontSize: '0.78rem' }}>{row.email}</div>
                      {row.id === me?.id && (
                        <div style={{ marginTop: 4 }}>
                          <Badge tone="accent">you</Badge>
                        </div>
                      )}
                    </td>
                    <td>
                      <RoleEditor
                        selected={row.roles}
                        disabled={savingId === row.id || row.id === me?.id}
                        onChange={(roles) => void changeRoles(row, roles)}
                      />
                    </td>
                    <td>{row.isActive ? <Badge tone="success">active</Badge> : <Badge tone="neutral">disabled</Badge>}</td>
                    <td>{row.totpEnabled ? <Badge tone="success">enabled</Badge> : <Badge tone="warning">not set up</Badge>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{row.lastLoginAt ? formatDateTime(row.lastLoginAt) : 'never'}</td>
                    <td>
                      {row.id !== me?.id && (
                        <Button size="sm" variant="ghost" busy={savingId === row.id} onClick={() => void toggleActive(row)}>
                          {row.isActive ? 'Disable' : 'Enable'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      <Card title="What each role can do" subtitle="Roles are fixed by the system; permissions are enforced on the server, not in this interface.">
        <div className="grid-2">
          {ROLES.map((definition) => (
            <div key={definition.role} style={{ padding: 12, border: `1px solid ${t.color.border}`, borderRadius: t.radius.md }}>
              <div style={{ fontWeight: 800, fontSize: '0.875rem' }}>{titleCase(definition.role)}</div>
              <p style={{ margin: '4px 0 8px', fontSize: '0.8rem', color: t.color.textMuted }}>{definition.blurb}</p>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {definition.permissions.map((permission) => (
                  <Badge key={permission} tone="neutral">
                    {permission}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function RoleEditor({
  selected,
  disabled,
  onChange,
}: {
  selected: string[];
  disabled?: boolean;
  onChange: (roles: string[]) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {ROLES.map((definition) => (
        <label key={definition.role} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.8rem' }}>
          <input
            type="checkbox"
            disabled={disabled}
            checked={selected.includes(definition.role)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...selected, definition.role]
                  : selected.filter((role) => role !== definition.role),
              )
            }
          />
          {titleCase(definition.role)}
        </label>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function CreateUserForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roles, setRoles] = useState<string[]>(['REVIEWER']);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      await api('/admin/users', { body: { name: name.trim(), email: email.trim(), password, roles, isActive: true } });
      onSaved();
    } catch (err) {
      setError(describe(err));
      setErrors(fieldErrors(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Add user" subtitle="Give the person the least access they need. Roles can be changed later.">
      {error && (
        <div style={{ marginBottom: 12 }}>
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      <div className="grid-2">
        <Field label="Name" htmlFor="new-name" required error={errors.name?.[0]}>
          <TextInput id="new-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="new-email" required error={errors.email?.[0]}>
          <TextInput id="new-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
      </div>
      <div style={{ marginTop: 14 }}>
        <Field
          label="Temporary password"
          htmlFor="new-password"
          required
          hint="At least 12 characters with an upper case letter, a number and a symbol. The person should change it after signing in."
          error={errors.password?.[0]}
        >
          <TextInput id="new-password" type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
      </div>
      <div style={{ marginTop: 14 }}>
        <Field label="Roles" required>
          <RoleEditor selected={roles} onChange={setRoles} />
        </Field>
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <Button variant="primary" busy={busy} onClick={() => void save()}>
          Create account
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
