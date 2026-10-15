const { DatabaseSync } = require('node:sqlite'); // built into Node 22.13+ — no native modules to compile
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { plusDays, dateOnly } = require('./lib/helpers');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const raw = new DatabaseSync(path.join(DATA_DIR, 'fireclub.db'));
raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

// Tiny compatibility layer: prepare().run/get/all(...args) + transaction(fn)
const clean = a => a.map(v => (v === undefined ? null : v));
const db = {
  exec: sql => raw.exec(sql),
  prepare(sql) {
    const st = raw.prepare(sql);
    return { run: (...a) => st.run(...clean(a)), get: (...a) => st.get(...clean(a)), all: (...a) => st.all(...clean(a)) };
  },
  transaction: fn => (...args) => {
    raw.exec('BEGIN IMMEDIATE');
    try { const r = fn(...args); raw.exec('COMMIT'); return r; } catch (e) { raw.exec('ROLLBACK'); throw e; }
  }
};

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, price_cents INTEGER NOT NULL DEFAULT 0,
  interval TEXT NOT NULL DEFAULT 'free' CHECK (interval IN ('free','month','year')),
  description TEXT DEFAULT '', perks TEXT DEFAULT '', active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','officer','member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  phone TEXT DEFAULT '', bio TEXT DEFAULT '', emergency_contact TEXT DEFAULT '',
  plan_id INTEGER REFERENCES plans(id), plan_renews_at TEXT,
  joined_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id INTEGER REFERENCES plans(id), amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'paid', method TEXT DEFAULT 'card', note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '', location TEXT DEFAULT '',
  category TEXT DEFAULT 'Gathering', starts_at TEXT NOT NULL, ends_at TEXT, capacity INTEGER NOT NULL DEFAULT 0,
  members_only INTEGER NOT NULL DEFAULT 0, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS rsvps (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'going' CHECK (status IN ('going','waitlist')),
  checked_in INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (event_id, user_id)
);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS gear (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT DEFAULT 'General', total_qty INTEGER NOT NULL DEFAULT 1,
  condition TEXT NOT NULL DEFAULT 'good' CHECK (condition IN ('new','good','fair','repair','retired')), notes TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS gear_loans (
  id INTEGER PRIMARY KEY, gear_id INTEGER NOT NULL REFERENCES gear(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, qty INTEGER NOT NULL DEFAULT 1,
  out_at TEXT NOT NULL DEFAULT (datetime('now')), due_at TEXT, returned_at TEXT
);
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '',
  level TEXT NOT NULL DEFAULT 'Beginner', valid_months INTEGER NOT NULL DEFAULT 12, required INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS certifications (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  awarded_at TEXT NOT NULL, expires_at TEXT, awarded_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT NOT NULL, detail TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_start ON events(starts_at);
CREATE INDEX IF NOT EXISTS idx_loans_active ON gear_loans(gear_id, returned_at);
CREATE INDEX IF NOT EXISTS idx_certs_user ON certifications(user_id);
`);

const getSettings = () => Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value]));
const setSetting = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
const audit = (userId, action, detail = '') => db.prepare('INSERT INTO audit_log(user_id,action,detail) VALUES(?,?,?)').run(userId || null, action, detail);

function seedDefaults() {
  const defaults = {
    club_name: 'Fire Club', tagline: 'Where the community burns bright — safely.',
    contact_email: 'hello@fireclub.example', location: 'The Aqua Yard, 12 Tidewater Lane',
    about: 'We are a community of fire-spinners, fire-safety volunteers, and flame-curious people. We train, perform, and look out for each other.'
  };
  const s = getSettings();
  for (const [k, v] of Object.entries(defaults)) if (!(k in s)) setSetting.run(k, v);

  if (db.prepare('SELECT COUNT(*) c FROM plans').get().c === 0) {
    const ins = db.prepare('INSERT INTO plans(name,price_cents,interval,description,perks) VALUES(?,?,?,?,?)');
    ins.run('Spark', 0, 'free', 'Try us out — no commitment.', 'Attend open events\nAnnouncements & community\nSafety basics workshop');
    ins.run('Flame', 900, 'month', 'For regular members.', 'Everything in Spark\nMembers-only events\nBorrow club gear\nPriority RSVP');
    ins.run('Blaze', 2400, 'month', 'For performers and trainers.', 'Everything in Flame\nAdvanced workshops\nPerformance slots\nGuest passes (2/mo)');
    ins.run('Inferno Annual', 24000, 'year', 'Best value — two months free.', 'Everything in Blaze\nAnnual gala ticket\nFounder badge');
  }
  if (db.prepare('SELECT COUNT(*) c FROM courses').get().c === 0) {
    const ins = db.prepare('INSERT INTO courses(title,description,level,valid_months,required) VALUES(?,?,?,?,?)');
    ins.run('Fire Safety Fundamentals', 'Extinguishers, fuel handling, safety spotters and emergency response.', 'Beginner', 12, 1);
    ins.run('Fuel & Wick Handling', 'Safe storage, fueling and dousing procedures for props.', 'Beginner', 12, 1);
    ins.run('Spotter Certification', 'Become a certified safety spotter for performances.', 'Intermediate', 24, 0);
    ins.run('Performance Lead', 'Plan, risk-assess and run a public fire performance.', 'Advanced', 24, 0);
  }
}

function seedDemo() {
  if (process.env.SEED_DEMO === 'false') return;
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) return;
  const plans = db.prepare('SELECT * FROM plans ORDER BY id').all();
  const hash = pw => bcrypt.hashSync(pw, 10);
  const addUser = db.prepare('INSERT INTO users(name,email,password_hash,role,plan_id,plan_renews_at,phone,joined_at) VALUES(?,?,?,?,?,?,?,?)');
  const mk = (n, e, pw, role, plan, renewDays, joinDays) =>
    addUser.run(n, e, hash(pw), role, plan?.id, plan && plan.interval !== 'free' ? dateOnly(renewDays) : null, '', new Date(Date.now() - joinDays * 864e5).toISOString().slice(0, 19).replace('T', ' ')).lastInsertRowid;
  const admin = mk('Marina Reef', 'admin@fireclub.test', 'Admin@1234', 'admin', plans[3], 200, 400);
  const officer = mk('Coral Vance', 'officer@fireclub.test', 'Officer@1234', 'officer', plans[2], 12, 300);
  const member = mk('Jade Tidewell', 'member@fireclub.test', 'Member@1234', 'member', plans[1], 9, 120);
  const others = [
    ['Kai Lagoon', plans[1], -3, 90], ['Nerida Sol', plans[2], 20, 75], ['Finn Brine', plans[0], 0, 60],
    ['Opal Marsh', plans[1], 15, 45], ['Zephyr Cove', plans[0], 0, 30], ['Lyra Shoal', plans[3], 300, 20], ['Tarn Ember', plans[1], 5, 8]
  ].map(([n, p, r, j]) => mk(n, n.toLowerCase().replace(/\s+/g, '.') + '@example.com', 'Welcome@123', 'member', p, r, j));

  const course = db.prepare('SELECT id, valid_months FROM courses ORDER BY id').all();
  const cert = db.prepare('INSERT INTO certifications(user_id,course_id,awarded_at,expires_at,awarded_by) VALUES(?,?,?,?,?)');
  const addMonths = (m, base = 0) => { const d = new Date(Date.now() + base * 864e5); d.setMonth(d.getMonth() + m); return d.toISOString().slice(0, 10); };
  [admin, officer, member, ...others.slice(0, 4)].forEach(u => cert.run(u, course[0].id, dateOnly(-60), addMonths(12, -60), officer));
  [admin, officer, member].forEach(u => cert.run(u, course[1].id, dateOnly(-60), addMonths(12, -60), officer));
  cert.run(officer, course[2].id, dateOnly(-100), addMonths(24, -100), admin);
  cert.run(member, course[2].id, dateOnly(-400), dateOnly(-35), officer);           // expired
  cert.run(others[0], course[1].id, dateOnly(-340), dateOnly(25), officer);          // expiring soon

  const ev = db.prepare('INSERT INTO events(title,description,location,category,starts_at,ends_at,capacity,members_only,created_by) VALUES(?,?,?,?,?,?,?,?,?)');
  const e1 = ev.run('Safety Fundamentals Workshop', 'Our mandatory intro: extinguishers, fuel handling, spotter roles. Bring closed-toe shoes and natural-fibre clothing.', 'The Aqua Yard', 'Training', plusDays(3, 18), plusDays(3, 20), 12, 0, officer).lastInsertRowid;
  const e2 = ev.run('Moonlit Flow Jam', 'Open practice session under the stars. All skill levels welcome; certified spotters on site.', 'Tidewater Beach', 'Practice', plusDays(7, 19), plusDays(7, 22), 30, 1, officer).lastInsertRowid;
  const e3 = ev.run('Harbour Festival Performance', 'Public performance for the harbour festival. Performers must hold a Spotter or Lead cert.', 'Harbour Stage', 'Performance', plusDays(18, 20), plusDays(18, 22), 6, 1, admin).lastInsertRowid;
  const e4 = ev.run('Gear Maintenance Night', 'Re-wick, repair and inventory the club gear library. Pizza provided.', 'The Aqua Yard', 'Gathering', plusDays(11, 17, 30), plusDays(11, 20), 0, 0, officer).lastInsertRowid;
  const e5 = ev.run('Summer Solstice Burn', 'Our biggest annual gathering — it was glorious.', 'Tidewater Beach', 'Performance', plusDays(-45, 20), plusDays(-45, 23), 40, 0, admin).lastInsertRowid;
  const rs = db.prepare('INSERT OR IGNORE INTO rsvps(event_id,user_id,status,checked_in) VALUES(?,?,?,?)');
  [member, ...others.slice(0, 3)].forEach(u => rs.run(e1, u, 'going', 0));
  [member, officer, ...others.slice(1, 5)].forEach(u => rs.run(e2, u, 'going', 0));
  [officer, others[1], others[5]].forEach(u => rs.run(e3, u, 'going', 0));
  [admin, officer, member, ...others].forEach((u, i) => rs.run(e5, u, 'going', i % 4 === 0 ? 0 : 1));

  const an = db.prepare('INSERT INTO announcements(title,body,pinned,author_id,created_at) VALUES(?,?,?,?,?)');
  an.run('Welcome to the new Fire Club hub', 'Manage your membership, RSVP to events, borrow gear and track safety certifications — all in one place. Say hello to the aquamarine era! 🌊🔥', 1, admin, new Date().toISOString().slice(0, 19).replace('T', ' '));
  an.run('Reminder: fuel storage rules', 'All fuel must be stored in the red cabinet. Never refuel near an open flame or within 5 metres of the practice circle.', 0, officer, new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 19).replace('T', ' '));

  const gr = db.prepare('INSERT INTO gear(name,category,total_qty,condition,notes) VALUES(?,?,?,?,?)');
  const g = [
    gr.run('Fire Poi (pair)', 'Props', 8, 'good', 'Kevlar wicks, 2-inch').lastInsertRowid,
    gr.run('Fire Staff', 'Props', 4, 'good', '6ft aluminium').lastInsertRowid,
    gr.run('Fire Hoop', 'Props', 3, 'fair', 'Re-wick due').lastInsertRowid,
    gr.run('Fire Blanket', 'Safety', 6, 'new', 'Wet-down kit included').lastInsertRowid,
    gr.run('CO2 Extinguisher', 'Safety', 4, 'good', 'Serviced this quarter').lastInsertRowid,
    gr.run('Fuel Can (5L)', 'Fuel', 3, 'repair', 'Replace seal').lastInsertRowid
  ];
  const loan = db.prepare('INSERT INTO gear_loans(gear_id,user_id,qty,out_at,due_at,returned_at) VALUES(?,?,?,?,?,?)');
  loan.run(g[0], member, 1, new Date(Date.now() - 4 * 864e5).toISOString().slice(0, 19).replace('T', ' '), dateOnly(3), null);
  loan.run(g[1], others[1], 1, new Date(Date.now() - 12 * 864e5).toISOString().slice(0, 19).replace('T', ' '), dateOnly(-2), null);
  loan.run(g[2], others[0], 1, '2025-01-05 10:00:00', '2025-01-12', '2025-01-11 17:00:00');

  const pay = db.prepare('INSERT INTO payments(user_id,plan_id,amount_cents,status,method,note,created_at) VALUES(?,?,?,?,?,?,?)');
  const when = d => new Date(Date.now() - d * 864e5).toISOString().slice(0, 19).replace('T', ' ');
  for (let m = 0; m < 6; m++) {
    pay.run(member, plans[1].id, 900, 'paid', 'card', 'Monthly dues', when(m * 30 + 5));
    pay.run(officer, plans[2].id, 2400, 'paid', 'card', 'Monthly dues', when(m * 30 + 11));
    if (m < 4) pay.run(others[1], plans[2].id, 2400, 'paid', 'card', 'Monthly dues', when(m * 30 + 17));
    if (m < 3) pay.run(others[0], plans[1].id, 900, m === 0 ? 'failed' : 'paid', 'card', m === 0 ? 'Card declined' : 'Monthly dues', when(m * 30 + 3));
  }
  pay.run(admin, plans[3].id, 24000, 'paid', 'card', 'Annual membership', when(165));
  audit(admin, 'seed', 'Demo data created');
}

seedDefaults();
seedDemo();

module.exports = { db, getSettings, setSetting, audit, DATA_DIR };
