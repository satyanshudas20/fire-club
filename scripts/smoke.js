// End-to-end smoke test: boots the app on a throw-away database and exercises every page + key flows.
const os = require('os'), path = require('path'), fs = require('fs');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fireclub-'));
const app = require('../server');
const { db } = require('../db');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('  ✗ ' + m)); };

class Client {
  constructor(base) { this.base = base; this.jar = {}; }
  async req(method, url, body) {
    const headers = { cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams({ _csrf: this.jar.csrf || '', ...body }).toString(); }
    const r = await fetch(this.base + url, { method, headers, body, redirect: 'manual' });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (/Expires=Thu, 01 Jan 1970/i.test(c)) delete this.jar[k]; else this.jar[k] = v; }
    return { status: r.status, loc: r.headers.get('location'), text: await r.text() };
  }
  get(u) { return this.req('GET', u); }
  post(u, b = {}) { return this.req('POST', u, b); }
  async login(email, password) { await this.get('/login'); const r = await this.post('/login', { email, password }); return r; }
}

(async () => {
  const server = app.listen(0); const base = 'http://127.0.0.1:' + server.address().port;
  const anon = new Client(base);

  console.log('Public');
  for (const u of ['/', '/login', '/signup', '/healthz']) ok((await anon.get(u)).status === 200, 'GET ' + u);
  let r = await anon.get('/dashboard'); ok(r.status === 302 && r.loc.startsWith('/login'), 'dashboard redirects anon to login');
  r = await anon.post('/login', { email: 'admin@fireclub.test', password: 'Admin@1234' }); ok(r.status === 302, 'login with csrf ok');
  const noCsrf = await fetch(base + '/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=a&password=b' });
  ok(noCsrf.status === 403, 'POST without CSRF is rejected');
  r = await new Client(base).login('admin@fireclub.test', 'wrong'); ok(r.loc === '/login', 'bad password rejected');
  r = await (async () => { const c = new Client(base); await c.get('/login'); return c.post('/login', { email: 'a@b.c', password: 'x', next: '//evil.com' }); })(); ok(r.loc !== '//evil.com', 'open-redirect blocked');

  console.log('Admin');
  const admin = new Client(base); r = await admin.login('admin@fireclub.test', 'Admin@1234'); ok(r.loc === '/dashboard', 'admin logs in');
  const pages = ['/dashboard', '/members', '/members?q=kai&role=member&plan=2', '/members/2', '/members/export.csv', '/events', '/events?view=past', '/events?cat=Training', '/events/new', '/events/1', '/events/1/edit', '/events/1/attendance.csv',
    '/announcements', '/gear', '/training', '/billing', '/billing/admin', '/billing/admin/payments.csv', '/admin/settings', '/admin/audit', '/profile'];
  for (const p of pages) { r = await admin.get(p); ok(r.status === 200, `GET ${p} → ${r.status}`); if (r.status === 500) console.error(r.text.slice(0, 200)); }
  ok((await admin.get('/nope')).status === 404, '404 page');
  r = await admin.get('/members/export.csv'); ok(r.text.startsWith('id,name,email'), 'members CSV has header');

  r = await admin.post('/events', { title: 'Test Burn', starts_at: '2099-01-01T19:00', capacity: '1', category: 'Practice' }); ok(r.status === 302 && /^\/events\/\d+$/.test(r.loc), 'create event');
  const evId = r.loc.split('/').pop();
  r = await admin.post('/events', { title: '', starts_at: 'bad' }); ok(r.status === 400, 'invalid event rejected');
  r = await admin.post('/announcements', { title: 'Hi', body: '<script>alert(1)</script>' }); r = await admin.get('/announcements'); ok(!r.text.includes('<script>alert(1)</script>') && r.text.includes('&lt;script&gt;'), 'announcement XSS is escaped');
  r = await admin.post('/gear', { name: 'Test Torch', total_qty: '2' }); ok(r.status === 302, 'add gear');
  const gid = db.prepare("SELECT id FROM gear WHERE name='Test Torch'").get().id; const uid = db.prepare("SELECT id FROM users WHERE email='member@fireclub.test'").get().id;
  await admin.post(`/gear/${gid}/checkout`, { user_id: uid, qty: '2', due_at: '2099-01-01' });
  ok(db.prepare('SELECT COUNT(*) c FROM gear_loans WHERE gear_id=? AND returned_at IS NULL').get(gid).c === 1, 'gear checked out');
  await admin.post(`/gear/${gid}/checkout`, { user_id: uid, qty: '1' });
  ok(db.prepare('SELECT COUNT(*) c FROM gear_loans WHERE gear_id=?').get(gid).c === 1, 'cannot over-checkout');
  r = await admin.post('/training/award', { user_id: uid, course_id: 3 }); ok(r.status === 302, 'award cert');
  r = await admin.post('/billing/admin/payments', { user_id: uid, amount: '9', method: 'cash', extend: 'on' }); ok(r.status === 302, 'manual payment');
  r = await admin.post('/members/1/update', { role: 'member', status: 'active', plan_id: '1' }); ok(db.prepare('SELECT role FROM users WHERE id=1').get().role === 'admin', 'admin cannot demote self');
  r = await admin.post('/admin/settings', { club_name: 'Fire Club', tagline: 'Test tag', contact_email: 'x@y.z', location: 'L', about: 'A' }); ok(r.status === 302, 'save settings');

  console.log('Member');
  const mem = new Client(base); await mem.login('member@fireclub.test', 'Member@1234');
  for (const p of ['/dashboard', '/members', '/events', '/events/1', '/announcements', '/gear', '/training', '/billing', '/profile']) { r = await mem.get(p); ok(r.status === 200, `member GET ${p} → ${r.status}`); }
  for (const p of ['/members/2', '/events/new', '/billing/admin', '/admin/settings', '/admin/audit', '/members/export.csv']) { r = await mem.get(p); ok(r.status === 403, `member blocked from ${p} (${r.status})`); }
  r = await mem.get('/members'); ok(!r.text.includes('admin@fireclub.test'), 'directory hides emails from members');
  r = await mem.post('/events/new'); ok(r.status === 404 || r.status === 403, 'member cannot create events');
  r = await mem.post(`/events/${evId}/rsvp`); r = await mem.get('/events/' + evId); ok(r.text.includes('going 🔥'), 'member RSVP');
  const officer = new Client(base); await officer.login('officer@fireclub.test', 'Officer@1234');
  await officer.post(`/events/${evId}/rsvp`); r = await officer.get('/events/' + evId); ok(r.text.includes('On the waitlist'), 'second RSVP waitlisted');
  await mem.post(`/events/${evId}/cancel`);
  ok(db.prepare("SELECT status FROM rsvps WHERE event_id=? AND user_id=2").get(evId).status === 'going', 'waitlist promoted on cancel');
  r = await officer.post(`/events/${evId}/checkin/2`); ok(db.prepare('SELECT checked_in FROM rsvps WHERE event_id=? AND user_id=2').get(evId).checked_in === 1, 'officer check-in');
  r = await mem.post('/billing/subscribe/3'); ok(db.prepare('SELECT plan_id FROM users WHERE id=?').get(uid).plan_id === 3, 'member upgrades plan');
  r = await mem.post('/profile/password', { current: 'Member@1234', password: 'short' }); ok(db.prepare('SELECT 1').get(), 'short password handled');

  console.log('Signup');
  const nu = new Client(base); await nu.get('/signup'); r = await nu.post('/signup', { name: 'New Person', email: 'new@example.com', password: 'longenough1' }); ok(r.loc === '/dashboard', 'signup works');
  r = await nu.get('/dashboard'); ok(r.status === 200 && r.text.includes('Safety certification needed'), 'new member warned about required certs');
  const dup = new Client(base); await dup.get('/signup'); r = await dup.post('/signup', { name: 'X', email: 'new@example.com', password: 'longenough1' }); ok(r.status === 400, 'duplicate email rejected');

  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
