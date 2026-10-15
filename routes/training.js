const express = require('express');
const { db, audit } = require('../db');
const { requireAuth, requireOfficer } = require('../lib/security');
const { dateOnly } = require('../lib/helpers');
const r = express.Router();
r.use(requireAuth);

r.get('/', (req, res) => {
  const courses = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM certifications WHERE course_id=c.id AND (expires_at IS NULL OR expires_at>=?)) holders FROM courses c ORDER BY required DESC, id`).all(dateOnly());
  const mine = db.prepare('SELECT course_id, expires_at, awarded_at FROM certifications WHERE user_id=? ORDER BY awarded_at').all(req.user.id);
  const status = Object.fromEntries(mine.map(m => [m.course_id, m]));
  let roster = [], members = [];
  if (res.locals.isOfficer) {
    roster = db.prepare(`SELECT ce.*, u.name user_name, c.title FROM certifications ce JOIN users u ON u.id=ce.user_id JOIN courses c ON c.id=ce.course_id ORDER BY ce.expires_at LIMIT 100`).all();
    members = db.prepare("SELECT id, name FROM users WHERE status='active' ORDER BY name").all();
  }
  res.render('training/index', { title: 'Safety & training', active: 'training', courses, status, roster, members, today: dateOnly(), soon: dateOnly(30) });
});
r.post('/courses', requireOfficer, (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 100);
  if (!title) { res.flash('error', 'Title required.'); return res.redirect('/training'); }
  db.prepare('INSERT INTO courses(title,description,level,valid_months,required) VALUES(?,?,?,?,?)')
    .run(title, String(req.body.description || '').slice(0, 400), ['Beginner', 'Intermediate', 'Advanced'].includes(req.body.level) ? req.body.level : 'Beginner', Math.max(0, parseInt(req.body.valid_months) || 12), req.body.required ? 1 : 0);
  audit(req.user.id, 'course_create', title);
  res.flash('success', 'Course created.'); res.redirect('/training');
});
r.post('/courses/:id/delete', requireOfficer, (req, res) => { db.prepare('DELETE FROM courses WHERE id=?').run(req.params.id); res.flash('success', 'Course deleted.'); res.redirect('/training'); });
r.post('/award', requireOfficer, (req, res) => {
  const c = db.prepare('SELECT * FROM courses WHERE id=?').get(req.body.course_id);
  const u = db.prepare('SELECT id,name FROM users WHERE id=?').get(req.body.user_id);
  if (!c || !u) { res.flash('error', 'Pick a member and a course.'); return res.redirect('/training'); }
  const d = new Date(); d.setMonth(d.getMonth() + c.valid_months);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  db.prepare('INSERT INTO certifications(user_id,course_id,awarded_at,expires_at,awarded_by) VALUES(?,?,?,?,?)')
    .run(u.id, c.id, dateOnly(), c.valid_months ? d.toISOString().slice(0, 10) : null, req.user.id);
  audit(req.user.id, 'cert_award', `${c.title} → ${u.name}`);
  res.flash('success', `Awarded ${c.title} to ${u.name}.`); res.redirect('/training');
});
r.post('/certs/:id/revoke', requireOfficer, (req, res) => { db.prepare('DELETE FROM certifications WHERE id=?').run(req.params.id); res.flash('success', 'Certification revoked.'); res.redirect('/training'); });
module.exports = r;
