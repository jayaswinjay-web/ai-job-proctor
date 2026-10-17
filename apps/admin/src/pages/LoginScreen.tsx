import { useState } from 'react';
import { Alert, Button, Field, Icon, TextInput, adminTokens as t } from '@proctor/ui';
import { useAuth } from '../lib/auth.js';
import { describe, fieldErrors } from '../lib/hooks.js';

/**
 * Sign-in screen.
 *
 * Kept intentionally plain: this is a staff-facing tool, so the screen does the minimum
 * that lets someone get to work, and nothing more. There is no "remember me", no
 * password reset link on screen (it is an operational tool with accounts issued by an
 * administrator), and no social sign-in — fewer credential paths, fewer ways to leak
 * an access token.
 */
export function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      await login(email.trim(), password, totpCode.trim() || undefined);
    } catch (err) {
      setError(describe(err));
      setErrors(fieldErrors(err));
      if (err instanceof Error && err.message.toLowerCase().includes('verification code')) setNeedsTotp(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: `linear-gradient(160deg, #16202c 0%, #1c3350 55%, #1c5fa8 140%)`,
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: '100%',
          maxWidth: 400,
          background: t.color.surface,
          borderRadius: t.radius.lg,
          boxShadow: t.shadow.lg,
          padding: 32,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: t.color.primary,
              color: '#fff',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <Icon name="shield" size={24} aria-hidden />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>Recruitment Admin</h1>
            <p style={{ margin: 0, fontSize: '0.78rem', color: t.color.textMuted }}>Voice screening platform</p>
          </div>
        </div>

        <div style={{ height: 20 }} />

        {error && (
          <div style={{ marginBottom: 16 }}>
            <Alert tone="danger" title="Could not sign in">
              {error}
            </Alert>
          </div>
        )}

        <div className="stack" style={{ gap: 16 }}>
          <Field label="Email" htmlFor="email" required error={errors.email?.[0]}>
            <TextInput
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </Field>

          <Field label="Password" htmlFor="password" required error={errors.password?.[0]}>
            <TextInput
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>

          {needsTotp && (
            <Field
              label="Verification code"
              htmlFor="totp"
              hint="Six digits from your authenticator app."
              error={errors.totpCode?.[0]}
            >
              <TextInput
                id="totp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
              />
            </Field>
          )}

          <Button type="submit" variant="primary" size="lg" busy={busy} style={{ width: '100%' }}>
            Sign in
          </Button>
        </div>

        <p style={{ margin: '20px 0 0', fontSize: '0.75rem', color: t.color.textMuted, lineHeight: 1.5 }}>
          Access is granted by a Super Administrator. All sign-ins, exports and record access are written to the
          audit log.
        </p>
      </form>
    </div>
  );
}
