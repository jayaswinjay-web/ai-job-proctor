import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { adminTokens as t } from './tokens.js';

/**
 * Admin-facing primitives.
 *
 * Every interactive element carries a visible focus ring. Keyboard navigation is not
 * an extra here — it is the primary input method for the staff who use this dashboard,
 * and an invisible focus state makes a data table unusable without a mouse.
 */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  busy?: boolean;
  icon?: ReactNode;
}

const BUTTON_VARIANTS: Record<ButtonVariant, { background: string; color: string; border: string; hover: string }> = {
  primary: { background: t.color.primary, color: '#fff', border: t.color.primary, hover: t.color.primaryHover },
  secondary: { background: t.color.surface, color: t.color.text, border: t.color.borderStrong, hover: t.color.surfaceAlt },
  ghost: { background: 'transparent', color: t.color.primary, border: 'transparent', hover: t.color.primarySoft },
  subtle: { background: t.color.surfaceAlt, color: t.color.text, border: 'transparent', hover: t.color.border },
  danger: { background: t.color.danger, color: '#fff', border: t.color.danger, hover: '#8f1c16' },
};

const BUTTON_SIZES: Record<ButtonSize, { padding: string; font: string }> = {
  sm: { padding: '6px 12px', font: '0.8125rem' },
  md: { padding: '9px 16px', font: '0.875rem' },
  lg: { padding: '13px 22px', font: '0.9375rem' },
};

export function Button({
  variant = 'secondary',
  size = 'md',
  busy = false,
  icon,
  children,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const v = BUTTON_VARIANTS[variant];
  const s = BUTTON_SIZES[size];
  return (
    <button
      type="button"
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: s.padding,
        fontSize: s.font,
        fontWeight: 600,
        fontFamily: t.font.sans,
        lineHeight: 1.2,
        color: v.color,
        background: busy ? `${v.background}88` : v.background,
        border: `1px solid ${v.border}`,
        borderRadius: t.radius.md,
        cursor: disabled || busy ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        transition: 'background 140ms ease, box-shadow 140ms ease',
        boxShadow: variant === 'primary' ? t.shadow.sm : 'none',
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!disabled && !busy) e.currentTarget.style.background = v.hover;
      }}
      onMouseLeave={(e) => {
        if (!disabled && !busy) e.currentTarget.style.background = v.background;
      }}
      {...rest}
    >
      {busy ? <Spinner /> : icon}
      {children}
    </button>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        border: `2px solid currentColor`,
        borderTopColor: 'transparent',
        borderRadius: '50%',
        display: 'inline-block',
        animation: 'proctor-spin 700ms linear infinite',
      }}
    />
  );
}

export function Card({
  children,
  title,
  subtitle,
  actions,
  padded = true,
}: {
  children: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  padded?: boolean;
}) {
  return (
    <section
      style={{
        background: t.color.surface,
        border: `1px solid ${t.color.border}`,
        borderRadius: t.radius.lg,
        boxShadow: t.shadow.sm,
        overflow: 'hidden',
      }}
    >
      {(title || actions) && (
        <header
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
            padding: '16px 20px',
            borderBottom: `1px solid ${t.color.border}`,
            background: t.color.surfaceAlt,
          }}
        >
          <div>
            {title && <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: t.color.text }}>{title}</h2>}
            {subtitle && <p style={{ margin: '4px 0 0', fontSize: '0.8125rem', color: t.color.textMuted }}>{subtitle}</p>}
          </div>
          {actions && <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>{actions}</div>}
        </header>
      )}
      <div style={{ padding: padded ? 20 : 0 }}>{children}</div>
    </section>
  );
}

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';

const BADGE_TONES: Record<BadgeTone, { background: string; color: string }> = {
  neutral: { background: t.color.surfaceAlt, color: t.color.textMuted },
  info: { background: t.color.infoSoft, color: t.color.info },
  success: { background: t.color.successSoft, color: t.color.success },
  warning: { background: t.color.warningSoft, color: t.color.warning },
  danger: { background: t.color.dangerSoft, color: t.color.danger },
  accent: { background: t.color.primarySoft, color: t.color.primary },
};

export function Badge({
  children,
  tone = 'neutral',
  title,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  title?: string;
}) {
  const c = BADGE_TONES[tone];
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: t.radius.pill,
        background: c.background,
        color: c.color,
        fontSize: '0.75rem',
        fontWeight: 700,
        letterSpacing: '0.01em',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  htmlFor?: string;
}

export function Field({ label, hint, error, required, children, htmlFor }: FieldProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label
        htmlFor={htmlFor}
        style={{ fontSize: '0.8125rem', fontWeight: 600, color: t.color.text, display: 'flex', gap: 4 }}
      >
        {label}
        {required && <span style={{ color: t.color.danger }} aria-hidden="true">*</span>}
      </label>
      {hint && <p style={{ margin: 0, fontSize: '0.75rem', color: t.color.textMuted }}>{hint}</p>}
      {children}
      {error && (
        <p role="alert" style={{ margin: 0, fontSize: '0.75rem', color: t.color.danger, fontWeight: 600 }}>
          {error}
        </p>
      )}
    </div>
  );
}

const CONTROL_BASE: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  fontSize: '0.875rem',
  fontFamily: t.font.sans,
  color: t.color.text,
  background: t.color.surface,
  border: `1px solid ${t.color.borderStrong}`,
  borderRadius: t.radius.md,
  transition: 'border-color 140ms ease, box-shadow 140ms ease',
};

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { style, ...rest } = props;
  return <input {...rest} style={{ ...CONTROL_BASE, ...style }} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { style, ...rest } = props;
  return <textarea {...rest} style={{ ...CONTROL_BASE, minHeight: 88, resize: 'vertical', ...style }} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { style, children, ...rest } = props;
  return (
    <select {...rest} style={{ ...CONTROL_BASE, ...style }}>
      {children}
    </select>
  );
}

export function EmptyState({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return (
    <div style={{ padding: '48px 24px', textAlign: 'center', color: t.color.textMuted }}>
      <p style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: t.color.text }}>{title}</p>
      {detail && <p style={{ margin: '6px 0 0', fontSize: '0.8125rem', maxWidth: 460, marginInline: 'auto' }}>{detail}</p>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: string;
  children: ReactNode;
}) {
  const c = BADGE_TONES[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      style={{
        padding: '12px 14px',
        borderRadius: t.radius.md,
        background: c.background,
        color: c.color,
        border: `1px solid ${c.color}22`,
        fontSize: '0.8125rem',
        lineHeight: 1.5,
      }}
    >
      {title && <strong style={{ display: 'block', marginBottom: 4 }}>{title}</strong>}
      {children}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: BadgeTone;
}) {
  const c = BADGE_TONES[tone];
  return (
    <div
      style={{
        padding: 16,
        borderRadius: t.radius.lg,
        border: `1px solid ${t.color.border}`,
        background: t.color.surface,
        boxShadow: t.shadow.sm,
      }}
    >
      <p style={{ margin: 0, fontSize: '0.75rem', fontWeight: 600, color: t.color.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </p>
      <p style={{ margin: '6px 0 0', fontSize: '1.75rem', fontWeight: 800, color: c.color, lineHeight: 1.1 }}>{value}</p>
      {hint && <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: t.color.textMuted }}>{hint}</p>}
    </div>
  );
}

export function Divider() {
  return <hr style={{ border: 0, borderTop: `1px solid ${t.color.border}`, margin: 0 }} />;
}

/** Globally injected once so `Spinner` works without per-component plumbing. */
export const globalStyles = `
@keyframes proctor-spin { to { transform: rotate(360deg); } }
@keyframes proctor-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes proctor-pulse-ring { 0% { transform: scale(0.85); opacity: 0.7; } 70% { transform: scale(1.35); opacity: 0; } 100% { transform: scale(1.35); opacity: 0; } }
@keyframes proctor-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; }
}
:focus-visible { outline: 3px solid ${t.color.focus}; outline-offset: 2px; border-radius: 4px; }
`;