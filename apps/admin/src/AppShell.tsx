import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Alert, Badge, Button, Icon, type IconName, globalStyles, adminTokens as t } from '@proctor/ui';
import { useAuth } from './lib/auth.js';
import { api } from './lib/api.js';
import { usePersistentState } from './lib/hooks.js';

/**
 * Admin shell: sidebar navigation, header, and the routed page area.
 *
 * Navigation is permission-filtered. A reviewer never sees a link they cannot use, which
 * removes most "why is this button greyed out" support questions — but the server still
 * enforces every route, so hiding a link is presentation, not protection.
 */

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  permission: Parameters<ReturnType<typeof useAuth>['can']>[0];
  end?: boolean;
}

const NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: 'trending-up', permission: 'report:read', end: true },
      { to: '/candidates', label: 'Candidates', icon: 'users', permission: 'candidate:read' },
    ],
  },
  {
    group: 'Requisition setup',
    items: [
      { to: '/jobs', label: 'Jobs', icon: 'briefcase', permission: 'job:read' },
      { to: '/questions', label: 'Question bank', icon: 'clipboard-list', permission: 'question:read' },
    ],
  },
  {
    group: 'Administration',
    items: [
      { to: '/reports', label: 'Reports', icon: 'download', permission: 'report:read' },
      { to: '/settings', label: 'Settings', icon: 'settings', permission: 'settings:read' },
      { to: '/audit', label: 'Audit log', icon: 'file-text', permission: 'audit:read' },
      { to: '/users', label: 'Users & roles', icon: 'user', permission: 'user:manage' },
    ],
  },
];

export function AppShell() {
  const { user, logout, can, siteName, demoMode } = useAuth();
  const [collapsed, setCollapsed] = usePersistentState('sidebar.collapsed', false);
  const [health, setHealth] = useState<{ ok: boolean; detail?: string } | null>(null);
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    api<{
      version: string;
      providers: Record<string, { ok: boolean; detail?: string }>;
      database: { ok: boolean; detail?: string };
    }>('/admin/system/health')
      .then((h) => {
        if (cancelled) return;
        // One badge for the whole dependency set: staff need to know the console may be
        // reading degraded data, not which single provider is unhappy.
        const broken = [...Object.entries(h.providers), ['database', h.database] as const].filter(([, p]) => !p.ok);
        setHealth(
          broken.length === 0
            ? { ok: true }
            : { ok: false, detail: broken.map(([name, p]) => `${name}: ${p.detail ?? 'unavailable'}`).join(' · ') },
        );
      })
      .catch(() => {
        if (!cancelled) setHealth({ ok: false, detail: 'System status unavailable' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const width = collapsed ? 68 : 232;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: t.color.bg }}>
      <style>{globalStyles}</style>
      <style>{ADMIN_CSS}</style>

      <nav
        aria-label="Main"
        style={{
          width,
          flexShrink: 0,
          background: '#16202c',
          color: '#e6edf5',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 160ms ease',
          position: 'sticky',
          top: 0,
          height: '100vh',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '18px 16px',
            borderBottom: '1px solid #26313f',
            minHeight: 64,
          }}
        >
          <Icon name="shield" size={26} color="#7db4ea" aria-hidden />
          {!collapsed && (
            <span style={{ fontWeight: 800, fontSize: '0.95rem', letterSpacing: '-0.01em' }}>{siteName}</span>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 8px' }}>
          {NAV.map((section) => {
            const visible = section.items.filter((item) => can(item.permission));
            if (visible.length === 0) return null;
            return (
              <div key={section.group} style={{ marginBottom: 18 }}>
                {!collapsed && (
                  <div
                    style={{
                      padding: '6px 10px',
                      fontSize: '0.68rem',
                      fontWeight: 800,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: '#7e8c9c',
                    }}
                  >
                    {section.group}
                  </div>
                )}
                {visible.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    title={collapsed ? item.label : undefined}
                    style={({ isActive }) => ({
                      display: 'flex',
                      alignItems: 'center',
                      gap: 11,
                      padding: collapsed ? '10px 0' : '9px 12px',
                      justifyContent: collapsed ? 'center' : 'flex-start',
                      borderRadius: t.radius.md,
                      color: isActive ? '#ffffff' : '#c3cedb',
                      background: isActive ? t.color.primary : 'transparent',
                      textDecoration: 'none',
                      fontSize: '0.875rem',
                      fontWeight: isActive ? 700 : 500,
                    })}
                  >
                    <Icon name={item.icon} size={19} aria-hidden />
                    {!collapsed && item.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </div>

        <div style={{ padding: 10, borderTop: '1px solid #26313f' }}>
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand the navigation' : 'Collapse the navigation'}
            style={{
              width: '100%',
              padding: '9px 12px',
              background: 'transparent',
              color: '#c3cedb',
              border: '1px solid #33404f',
              borderRadius: t.radius.md,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: collapsed ? 'center' : 'flex-start',
              gap: 10,
              fontSize: '0.8rem',
            }}
          >
            <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={17} aria-hidden />
            {!collapsed && 'Collapse'}
          </button>
        </div>
      </nav>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            padding: '12px 24px',
            background: t.color.surface,
            borderBottom: `1px solid ${t.color.border}`,
            position: 'sticky',
            top: 0,
            zIndex: 20,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{pageTitle(location.pathname)}</span>
            {demoMode && <Badge tone="warning">DEMO MODE</Badge>}
            {health && !health.ok && (
              <Badge tone="danger" title={health.detail}>
                degraded
              </Badge>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {user && (
              <div style={{ textAlign: 'right', lineHeight: 1.25 }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700 }}>{user.name}</div>
                <div style={{ fontSize: '0.72rem', color: t.color.textMuted }}>
                  {user.roles.map((r) => r.replace(/_/g, ' ').toLowerCase()).join(', ')}
                </div>
              </div>
            )}
            <Button size="sm" variant="secondary" onClick={() => void logout()} icon={<Icon name="lock" size={15} />}>
              Sign out
            </Button>
          </div>
        </header>

        <main style={{ padding: 24, flex: 1, maxWidth: 1560, width: '100%', marginInline: 'auto' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Blocks a route the user lacks permission for, with an explanation rather than a blank page. */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Parameters<ReturnType<typeof useAuth>['can']>[0];
  children: React.ReactNode;
}) {
  const { can, user } = useAuth();
  if (can(permission)) return <>{children}</>;
  return (
    <Alert tone="warning" title="You do not have access to this page">
      Your role ({user?.roles.join(', ') ?? 'none'}) does not include the <code>{permission}</code> permission. Ask a
      Super Administrator if you need it.
    </Alert>
  );
}

function pageTitle(pathname: string): string {
  if (pathname === '/') return 'Dashboard';
  if (pathname.startsWith('/candidates/')) return 'Interview review';
  if (pathname.startsWith('/candidates')) return 'Candidates';
  if (pathname.startsWith('/jobs/')) return 'Job configuration';
  if (pathname.startsWith('/jobs')) return 'Jobs';
  if (pathname.startsWith('/questions')) return 'Question bank';
  if (pathname.startsWith('/reports')) return 'Reports';
  if (pathname.startsWith('/settings')) return 'Settings';
  if (pathname.startsWith('/audit')) return 'Audit log';
  if (pathname.startsWith('/users')) return 'Users & roles';
  return 'Recruitment';
}

const ADMIN_CSS = `
  table { border-collapse: collapse; width: 100%; }
  th { text-align: left; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: #5b6b7d; padding: 10px 12px; border-bottom: 1px solid #dbe2ea; white-space: nowrap; }
  td { padding: 11px 12px; border-bottom: 1px solid #eef2f6; font-size: 0.85rem; vertical-align: top; }
  tbody tr:hover { background: #f6f8fb; }
  .a-link { color: #1c5fa8; text-decoration: none; font-weight: 600; }
  .a-link:hover { text-decoration: underline; }
  .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 0.8em; }
  .stack { display: flex; flex-direction: column; gap: 20px; }
  .row { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
  .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; }
  .grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 16px; }
  .bar { height: 8px; border-radius: 4px; background: #e6ecf2; overflow: hidden; }
  .bar > span { display: block; height: 100%; background: #1c5fa8; }
  .scroll-x { overflow-x: auto; }
`;

export { ADMIN_CSS, Link };
