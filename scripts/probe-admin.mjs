/**
 * Admin API contract probe.
 *
 * Asserts that the response shapes the admin console reads actually exist, so a change
 * to a route's envelope surfaces here rather than as an undefined access in the browser.
 *
 * Run with the API already listening: `node scripts/probe-admin.mjs`
 */

const BASE = process.argv[2] ?? process.env.API_URL ?? 'http://localhost:4000';
const EMAIL = process.env.PROBE_EMAIL ?? 'admin@example.org';
const PASSWORD = process.env.PROBE_PASSWORD ?? 'Proctor!Admin2026';

let token = '';
let failures = 0;

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(path, options = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: res.status, body: payload, headers: res.headers };
}

const keys = (value) => (value && typeof value === 'object' ? Object.keys(value) : []);

async function main() {
  const login = await call('/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
  if (login.status !== 200) throw new Error(`Could not sign in as ${EMAIL} (status ${login.status}).`);
  token = login.body.accessToken;
  console.log('ADMIN API CONTRACT');
  console.log('------------------');

  const status = await call('/auth/status');
  check('auth status exposes demoMode and siteName', 'demoMode' in status.body && 'siteName' in status.body);

  const settings = await call('/admin/settings');
  check('settings are wrapped, not bare', 'settings' in settings.body && 'envDefaults' in settings.body);
  check(
    'settings expose every section the console edits',
    ['general', 'voice', 'interview', 'scoring', 'proctoring', 'recording', 'ai', 'kiosk'].every((s) => s in settings.body.settings),
    keys(settings.body.settings).join(','),
  );

  const dashboard = await call('/admin/analytics/dashboard');
  check(
    'dashboard exposes the fields the tiles read',
    ['totalCandidates', 'interviewsToday', 'completedInterviews', 'pendingReviews', 'averageScore', 'passRate', 'activeJobs', 'proctoringAlerts', 'dropoffByStage', 'scoresByJob', 'languageDistribution', 'proctorEventStats', 'completionRate'].every(
      (k) => k in dashboard.body,
    ),
    keys(dashboard.body).join(','),
  );

  const candidates = await call('/admin/candidates');
  check('candidate list is paginated', Array.isArray(candidates.body.items) && 'total' in candidates.body);
  check(
    'candidate rows carry the list columns',
    candidates.body.items.length === 0 ||
      ['sessionId', 'publicId', 'candidateName', 'jobTitle', 'interviewDate', 'status', 'overallScore', 'recommendation', 'reviewState', 'proctorStatus', 'languageCode', 'isDemo'].every(
        (k) => k in candidates.body.items[0],
      ),
    candidates.body.items.length ? keys(candidates.body.items[0]).join(',') : 'no rows to check',
  );

  const jobs = await call('/admin/jobs?includeArchived=true');
  check('job list is wrapped in items', Array.isArray(jobs.body.items));
  check('at least one job is seeded', jobs.body.items.length > 0);
  const job = jobs.body.items[0];
  check(
    'job summary carries the list columns',
    ['id', 'title', 'status', 'preferredLanguages', 'questionCount', 'interviewDurationMinutes', 'passingScore', 'candidateCount'].every((k) => k in job),
    keys(job).join(','),
  );

  const jobDetail = await call(`/admin/jobs/${job.id}`);
  check(
    'job detail carries stages, weights and requirements',
    ['stages', 'weights', 'requirements', 'proctoring'].every((k) => k in jobDetail.body),
    keys(jobDetail.body).join(','),
  );

  const languages = await call('/admin/languages');
  check('language list is wrapped in items', Array.isArray(languages.body.items));
  check('language rows include translationCount', languages.body.items.length === 0 || 'translationCount' in languages.body.items[0]);

  const questions = await call('/admin/questions');
  check('question list is paginated', Array.isArray(questions.body.items) && 'total' in questions.body);
  check(
    'question rows carry translations and validation',
    questions.body.items.length === 0 ||
      ['translations', 'validationStatus', 'validationIssues', 'version', 'isActive', 'source'].every((k) => k in questions.body.items[0]),
    questions.body.items.length ? keys(questions.body.items[0]).join(',') : 'no rows to check',
  );
  const question = questions.body.items[0];
  if (question) {
    const versions = await call(`/admin/questions/${question.id}/versions`);
    check('question versions return an array', Array.isArray(versions.body.items));
  }

  const template = await call('/admin/questions/import/template.csv');
  check('import template downloads as CSV', template.status === 200 && String(template.body).includes(','));

  const users = await call('/admin/users');
  check(
    'user list exposes role and permission arrays',
    users.body.items.length === 0 || (Array.isArray(users.body.items[0].roles) && Array.isArray(users.body.items[0].permissions)),
  );

  const audit = await call('/admin/audit-logs');
  check(
    'audit log rows carry actor, action and before/after',
    audit.body.items.length === 0 ||
      ['actor', 'action', 'entityType', 'entityId', 'previous', 'next', 'ipHash', 'createdAt'].every((k) => k in audit.body.items[0]),
    audit.body.items.length ? keys(audit.body.items[0]).join(',') : 'no rows to check',
  );

  const health = await call('/admin/system/health');
  check(
    'health exposes provider status for the header badge',
    ['llm', 'stt', 'tts'].every((p) => p in health.body.providers) && 'database' in health.body,
    keys(health.body).join(','),
  );

  const completed = candidates.body.items.find((c) => c.reviewState !== 'NOT_STARTED' || c.overallScore !== null);
  if (completed) {
    const detail = await call(`/admin/candidates/${completed.sessionId}`);
    check(
      'session detail exposes answers, scores, events, report and timeline',
      ['answers', 'scores', 'proctorEvents', 'report', 'recordings', 'reviewerNotes', 'timeline', 'reviewState'].every((k) => k in detail.body),
      keys(detail.body).join(','),
    );
    const report = await call(`/admin/exports/interview/${completed.sessionId}?format=PDF`);
    check('interview report exports', report.status === 200);
  } else {
    console.log('  SKIP  no completed session available for detail checks');
  }

  console.log('==============================================');
  console.log(failures === 0 ? 'All contract checks passed.' : `${failures} contract check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
