const express = require('express');
const { db, audit } = require('../db');
const { requireAuth, requireOfficer } = require('../lib/security');
const r = express.Router();
r.use(requireAuth);

r.get('/', (req, res) => {
  const items = db.prepare('SELECT a.*, u.name author FROM announcements a LEFT JOIN users u ON u.id=a.author_id ORDER BY pinned DESC, created_at DESC').all();
  res.render('announcements', { title: 'Announcements', active: 'announcements', items });
});
r.post('/', requireOfficer, (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 120), body = String(req.body.body || '').trim().slice(0, 4000);
  if (!title || !body) { res.flash('error', 'Title and message are required.'); return res.redirect('/announcements'); }
  db.prepare('INSERT INTO announcements(title,body,pinned,author_id) VALUES(?,?,?,?)').run(title, body, req.body.pinned ? 1 : 0, req.user.id);
  audit(req.user.id, 'announcement_create', title);
  res.flash('success', 'Announcement posted.'); res.redirect('/announcements');
});
r.post('/:id/pin', requireOfficer, (req, res) => { db.prepare('UPDATE announcements SET pinned=1-pinned WHERE id=?').run(req.params.id); res.redirect('/announcements'); });
r.post('/:id/delete', requireOfficer, (req, res) => { db.prepare('DELETE FROM announcements WHERE id=?').run(req.params.id); res.flash('success', 'Announcement removed.'); res.redirect('/announcements'); });
module.exports = r;
