/** Display formatters shared by both apps. */

export function formatDate(iso: string | Date, opts: Intl.DateTimeFormatOptions = {}): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    ...opts,
  }).format(date);
}

export function formatDateTime(iso: string | Date): string {
  return formatDate(iso, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Human label for the internal recommendation enum. */
export const RECOMMENDATION_LABELS: Record<string, string> = {
  STRONG_MATCH: 'Strong Match',
  GOOD_MATCH: 'Good Match',
  CONSIDER: 'Consider',
  NOT_RECOMMENDED: 'Not Recommended',
  PENDING_REVIEW: 'Pending Review',
};

export function recommendationLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return RECOMMENDATION_LABELS[value] ?? titleCase(value);
}

/** Tones used consistently wherever a recommendation is shown. */
export function recommendationTone(value: string | null | undefined): 'success' | 'info' | 'warning' | 'danger' | 'accent' | 'neutral' {
  switch (value) {
    case 'STRONG_MATCH':
      return 'success';
    case 'GOOD_MATCH':
      return 'info';
    case 'CONSIDER':
      return 'warning';
    case 'NOT_RECOMMENDED':
      return 'danger';
    case 'PENDING_REVIEW':
      return 'accent';
    default:
      return 'neutral';
  }
}

export const PROCTOR_EVENT_LABELS: Record<string, string> = {
  CANDIDATE_LEFT_KIOSK: 'Nobody detected in front of the kiosk',
  MULTIPLE_PEOPLE_DETECTED: 'More than one person detected',
  FACING_AWAY: 'Candidate facing away',
  MIC_DISCONNECTED: 'Microphone stopped working',
  CAMERA_DISCONNECTED: 'Camera stopped working',
  CAMERA_UNAVAILABLE: 'Camera unavailable',
  TAB_CHANGED: 'Kiosk left the interview tab',
  WINDOW_BLURRED: 'Kiosk window lost focus',
  NETWORK_INTERRUPTED: 'Network connection dropped',
  UNUSUAL_INTERRUPTION: 'Unusual interruption pattern',
  FULLSCREEN_EXITED: 'Kiosk left fullscreen',
};

export function proctorEventLabel(type: string): string {
  return PROCTOR_EVENT_LABELS[type] ?? titleCase(type);
}

export const SKILL_LABELS: Record<string, string> = {
  relevantExperience: 'Relevant experience',
  jobKnowledge: 'Job knowledge',
  practicalUnderstanding: 'Practical understanding',
  safetyAwareness: 'Safety awareness',
  communication: 'Communication',
  reliability: 'Reliability',
  other: 'Other',
  AVOID: '—',
};

export function truncate(value: string, max = 80): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
