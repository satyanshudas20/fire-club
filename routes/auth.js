const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { db, audit } = require('../db');
const { signToken, requireAuth, secureCookie } = require('../lib/security');
const { safeNext } = require('../lib/helpers');
const r = express.Router();

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => res.status(429).render('error', { title: 'Slow down', code: 429, message: 'Too many attempts. Try again in a few minutes.' }) });

function login(res, id) {
  res.cookie('token', signToken(id), { httpOnly: true, sameSite: 'lax', secure: secureCookie, maxAge: 7 * 864e5 });
}

r.get('/', (req, res) => {
  const plans = db.prepare('SELECT * FROM plans WHERE active=1 ORDER BY price_cents').all();
  const events = db.prepare("SELECT e.*, (SELECT COUNT(*) FROM rsvps WHERE event_id=e.id AND status='going') going FROM events e WHERE starts_at >= ? AND members_only=0 ORDER BY starts_at LIMIT 3").all(require('../lib/helpers').nowLocal());
  const stats = {
    members: db.prepare("SELECT COUNT(*) c FROM users WHERE status='active'").get().c,
    events: db.prepare('SELECT COUNT(*) c FROM events').get().c,
    certs: db.prepare('SELECT COUNT(*) c FROM certifications').get().c
  };
  res.render('landing', { title: '', plans, events, stats });
});

r.get('/login', (req, res) => req.user ? res.redirect('/dashboard') : res.render('auth/login', { title: 'Sign in', next: req.query.next || '', demo: !!db.prepare("SELECT 1 FROM users WHERE email='admin@fireclub.test'").get() }));
r.post('/login', limiter, (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  const ok = u && bcrypt.compareSync(String(req.body.password || ''), u.password_hash);
  if (!ok) { res.flash('error', 'Incorrect email or password.'); return res.redirect('/login'); }
  if (u.status !== 'active') { res.flash('error', 'This account is suspended. Contact a club officer.'); return res.redirect('/login'); }
  login(res, u.id); audit(u.id, 'login');
  res.redirect(safeNext(req.body.next));
});

r.get('/signup', (req, res) => req.user ? res.redirect('/dashboard') : res.render('auth/signup', { title: 'Join the club', form: {} }));
r.post('/signup', limiter, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80);
  const email = String(req.body.email || '').toLowerCase().trim().slice(0, 120);
  const pw = String(req.body.password || '');
  const form = { name, email };
  const fail = msg => res.status(400).render('auth/signup', { title: 'Join the club', form, error: msg });
  if (!name) return fail('Please enter your name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('Please enter a valid email.');
  if (pw.length < 8) return fail('Password must be at least 8 characters.');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return fail('An account with that email already exists.');
  const first = db.prepare('SELECT COUNT(*) c FROM users').get().c === 0;
  const free = db.prepare("SELECT id FROM plans WHERE interval='free' ORDER BY id LIMIT 1").get();
  const id = db.prepare('INSERT INTO users(name,email,password_hash,role,plan_id,emergency_contact) VALUES(?,?,?,?,?,?)')
    .run(name, email, bcrypt.hashSync(pw, 10), first ? 'admin' : 'member', free && free.id, String(req.body.emergency_contact || '').slice(0, 200)).lastInsertRowid;
  audit(id, 'signup', first ? 'first user → admin' : '');
  login(res, id);
  res.flash('success', first ? 'Welcome! You are the club admin.' : 'Welcome to the club! 🔥');
  res.redirect('/dashboard');
});

r.post('/logout', (req, res) => { res.clearCookie('token'); res.redirect('/'); });

r.get('/profile', requireAuth, (req, res) => res.render('auth/profile', { title: 'My profile', active: 'profile' }));
r.post('/profile', requireAuth, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80);
  if (!name) { res.flash('error', 'Name is required.'); return res.redirect('/profile'); }
  db.prepare('UPDATE users SET name=?, phone=?, bio=?, emergency_contact=? WHERE id=?')
    .run(name, String(req.body.phone || '').slice(0, 40), String(req.body.bio || '').slice(0, 500), String(req.body.emergency_contact || '').slice(0, 200), req.user.id);
  res.flash('success', 'Profile updated.'); res.redirect('/profile');
});
r.post('/profile/password', requireAuth, limiter, (req, res) => {
  const { current, password } = req.body;
  if (!bcrypt.compareSync(String(current || ''), req.user.password_hash)) { res.flash('error', 'Current password is wrong.'); return res.redirect('/profile'); }
  if (String(password || '').length < 8) { res.flash('error', 'New password must be at least 8 characters.'); return res.redirect('/profile'); }
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password, 10), req.user.id);
  audit(req.user.id, 'password_change');
  res.flash('success', 'Password changed.'); res.redirect('/profile');
});

module.exports = r;
