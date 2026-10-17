import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Alert, Card, Icon } from '@proctor/ui';
import { AuthProvider, useAuth } from './lib/auth.js';
import { AppShell, RequirePermission } from './AppShell.js';
import { LoginScreen } from './pages/LoginScreen.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { CandidatesPage } from './pages/CandidatesPage.js';
import { SessionReviewPage } from './pages/SessionReviewPage.js';
import { JobsPage } from './pages/JobsPage.js';
import { QuestionsPage } from './pages/QuestionsPage.js';
import { ReportsPage } from './pages/ReportsPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { AuditLogPage } from './pages/AuditLogPage.js';
import { UsersPage } from './pages/UsersPage.js';
/**
 * Routing and the authentication gate.
 *
 * The gate waits for the silent refresh attempt to finish before deciding what to render,
 * so a user with a valid cookie does not see the login screen flash on every reload.
 */

function Root() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center', color: '#5b6b7d' }}>
          <Icon name="shield" size={34} color="#1c5fa8" />
          <p style={{ marginTop: 10, fontSize: '0.875rem' }}>Checking your session…</p>
        </div>
      </div>
    );
  }

  if (status === 'anonymous') return <LoginScreen />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route
          index
          element={
            <RequirePermission permission="report:read">
              <DashboardPage />
            </RequirePermission>
          }
        />
        <Route
          path="candidates"
          element={
            <RequirePermission permission="candidate:read">
              <CandidatesPage />
            </RequirePermission>
          }
        />
        <Route
          path="candidates/:id"
          element={
            <RequirePermission permission="candidate:read">
              <SessionReviewPage />
            </RequirePermission>
          }
        />
        <Route
          path="jobs"
          element={
            <RequirePermission permission="job:read">
              <JobsPage />
            </RequirePermission>
          }
        />
        <Route
          path="questions"
          element={
            <RequirePermission permission="question:read">
              <QuestionsPage />
            </RequirePermission>
          }
        />
        <Route
          path="reports"
          element={
            <RequirePermission permission="report:read">
              <ReportsPage />
            </RequirePermission>
          }
        />
        <Route
          path="settings"
          element={
            <RequirePermission permission="settings:read">
              <SettingsPage />
            </RequirePermission>
          }
        />
        <Route
          path="audit"
          element={
            <RequirePermission permission="audit:read">
              <AuditLogPage />
            </RequirePermission>
          }
        />
        <Route path="users" element={<UsersPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function NotFound() {
  return (
    <Card title="Page not found">
      <Alert tone="warning">
        That address does not match anything in this console. Use the navigation on the left, or go back to the
        dashboard.
      </Alert>
    </Card>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </BrowserRouter>
  );
}
