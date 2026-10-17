/**
 * Probes the endpoints that the acceptance suite could not diagnose on its own.
 * Run against a live API:  node scripts/probe.mjs [baseUrl]
 */
const BASE = process.argv[2] ?? 'http://127.0.0.1:4000';
const API = `${BASE}/api/v1`;

async function api(method, path, { body, token } = {}) {
  const headers = { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text.slice(0, 300); }
  return { status: res.status, body: json };
}

const login = await api('POST', '/auth/login', { body: { email: 'admin@example.org', password: 'Proctor!Admin2026' } });
const token = login.body?.accessToken;
console.log('admin login:', login.status);

const dash = await api('GET', '/admin/analytics/dashboard', { token });
console.log('\nDASHBOARD status', dash.status);
console.log(JSON.stringify(dash.body).slice(0, 900));

const revLogin = await api('POST', '/auth/login', { body: { email: 'reviewer@example.org', password: 'ReviewMe!Review2026#' } });
console.log('\nreviewer login:', revLogin.status);
const revToken = revLogin.body?.accessToken;
console.log('reviewer perms:', JSON.stringify(revLogin.body?.user?.permissions));

const users = await api('GET', '/admin/users', { token: revToken });
console.log('\nUSERS as reviewer status', users.status, JSON.stringify(users.body).slice(0, 300));

const audit = await api('GET', '/admin/users', { token });
console.log('USERS as admin status', audit.status);

const jobs = await api('GET', '/admin/jobs?includeArchived=true', { token });
const anyJob = jobs.body?.items?.[0];
if (anyJob) {
  const csv = await api('GET', `/admin/jobs/${anyJob.id}/questions.csv`, { token });
  console.log('\nQUESTIONS CSV status', csv.status, 'type', typeof csv.body);
  console.log(String(csv.body).slice(0, 300));
}

console.log('\n--- rate limit probe ---');
const statuses = [];
for (let i = 0; i < 16; i += 1) {
  const r = await api('POST', '/auth/login', { body: { email: 'nobody@example.org', password: 'wrongwrongwrong' } });
  statuses.push(r.status);
}
console.log('login statuses:', statuses.join(','));

console.log('\n--- candidate 404 probe ---');
const notFound = await api('GET', '/admin/candidates/00000000-0000-4000-8000-000000000000', { token });
console.log('unknown session:', notFound.status, JSON.stringify(notFound.body).slice(0, 200));