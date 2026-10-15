const express = require('express');
const bcrypt = require('bcryptjs');
const { db, audit } = require('../db');
const { requireAuth, requireOfficer, requireAdmin } = require('../lib/security');
const { toCsv, dateOnly } = require('../lib/helpers');
const r = express.Router();
r.use(requireAuth);

function filters(q) {
  const where = [], args = [];
  if (q.q) { where.push('(u.name LIKE ? OR u.email LIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`); }
  if (['admin', 'officer', 'member'].includes(q.role)) { where.push('u.role=?'); args.push(q.role); }
  if (['active', 'suspended'].includes(q.status)) { where.push('u.status=?'); args.push(q.status); }
  if (/^\d+$/.test(q.plan || '')) { where.push('u.plan_id=?'); args.push(+q.plan); }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', args };
}
const BASE = 'SELECT u.*, p.name plan_name, p.price_cents FROM users u LEFT JOIN plans p ON p.id=u.plan_id';

r.get('/', (req, res) => {
  // Members see a friendly directory (no emails); officers see management table
  const f = filters(req.query), page = Math.max(1, parseInt(req.query.page) || 1), per = 20;
  const total = db.prepare(`SELECT COUNT(*) c FROM users u ${f.sql}`).get(...f.args).c;
  const members = db.prepare(`${BASE} ${f.sql} ORDER BY u.name LIMIT ? OFFSET ?`).all(...f.args, per, (page - 1) * per);
  res.render('members/index', { title: 'Members', active: 'members', members, total, page, pages: Math.ceil(total / per), q: req.query,
    plans: db.prepare('SELECT * FROM plans ORDER BY price_cents').all(), today: dateOnly() });
});

r.get('/export.csv', requireOfficer, (req, res) => {
  const rows = db.prepare(`${BASE} ORDER BY u.name`).all();
  audit(req.user.id, 'export_members', `${rows.length} rows`);
  res.type('text/csv').attachment('members.csv').send(toCsv(rows, ['id', 'name', 'email', 'role', 'status', 'plan_name', 'plan_renews_at', 'phone', 'emergency_contact', 'joined_at']));
});

r.post('/new', requireAdmin, (req, res) => {
  const { name, email, password, role, plan_id } = req.body;
  const em = String(email || '').toLowerCase().trim();
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em) || String(password || '').length < 8) { res.flash('error', 'Name, valid email and 8+ char password required.'); return res.redirect('/members'); }
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(em)) { res.flash('error', 'Email already registered.'); return res.redirect('/members'); }
  const id = db.prepare('INSERT INTO users(name,email,password_hash,role,plan_id) VALUES(?,?,?,?,?)')
    .run(String(name).trim(), em, bcrypt.hashSync(password, 10), ['admin', 'officer', 'member'].includes(role) ? role : 'member', +plan_id || null).lastInsertRowid;
  audit(req.user.id, 'member_create', em);
  res.flash('success', 'Member created.'); res.redirect('/members/' + id);
});

r.get('/:id', requireOfficer, (req, res, next) => {
  const m = db.prepare(`${BASE} WHERE u.id=?`).get(req.params.id);
  if (!m) return next();
  res.render('members/show', {
    title: m.name, active: 'members', m,
    plans: db.prepare('SELECT * FROM plans ORDER BY price_cents').all(),
    certs: db.prepare('SELECT ce.*, c.title FROM certifications ce JOIN courses c ON c.id=ce.course_id WHERE ce.user_id=? ORDER BY ce.expires_at').all(m.id),
    events: db.prepare("SELECT e.title, e.starts_at, r.status, r.checked_in FROM rsvps r JOIN events e ON e.id=r.event_id WHERE r.user_id=? ORDER BY e.starts_at DESC LIMIT 10").all(m.id),
    payments: db.prepare('SELECT * FROM payments WHERE user_id=? ORDER BY created_at DESC LIMIT 10').all(m.id),
    loans: db.prepare('SELECT l.*, g.name FROM gear_loans l JOIN gear g ON g.id=l.gear_id WHERE l.user_id=? AND l.returned_at IS NULL').all(m.id),
    today: dateOnly()
  });
});

r.post('/:id/update', requireAdmin, (req, res) => {
  const m = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!m) return res.redirect('/members');
  const role = ['admin', 'officer', 'member'].includes(req.body.role) ? req.body.role : m.role;
  const status = ['active', 'suspended'].includes(req.body.status) ? req.body.status : m.status;
  if (m.id === req.user.id && (role !== 'admin' || status !== 'active')) { res.flash('error', "You can't demote or suspend yourself."); return res.redirect('/members/' + m.id); }
  const admins = db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin' AND status='active'").get().c;
  if (m.role === 'admin' && m.status === 'active' && admins <= 1 && (role !== 'admin' || status !== 'active')) { res.flash('error', 'The club needs at least one active admin.'); return res.redirect('/members/' + m.id); }
  db.prepare('UPDATE users SET role=?, status=?, plan_id=?, plan_renews_at=? WHERE id=?')
    .run(role, status, +req.body.plan_id || null, req.body.plan_renews_at || null, m.id);
  audit(req.user.id, 'member_update', `${m.email}: role=${role} status=${status}`);
  res.flash('success', 'Member updated.'); res.redirect('/members/' + m.id);
});

r.post('/:id/reset-password', requireAdmin, (req, res) => {
  const pw = String(req.body.password || '');
  if (pw.length < 8) { res.flash('error', 'Password must be 8+ characters.'); return res.redirect('/members/' + req.params.id); }
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(pw, 10), req.params.id);
  audit(req.user.id, 'password_reset', 'user ' + req.params.id);
  res.flash('success', 'Password reset. Share it with the member securely.'); res.redirect('/members/' + req.params.id);
});

r.post('/:id/delete', requireAdmin, (req, res) => {
  const m = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!m || m.id === req.user.id) { res.flash('error', "You can't delete that account."); return res.redirect('/members'); }
  db.prepare('DELETE FROM users WHERE id=?').run(m.id);
  audit(req.user.id, 'member_delete', m.email);
  res.flash('success', 'Member deleted.'); res.redirect('/members');
});
module.exports = r;
