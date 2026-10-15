const express = require('express');
const { db, setSetting, audit } = require('../db');
const { requireAuth, requireAdmin } = require('../lib/security');
const r = express.Router();
r.use(requireAuth, requireAdmin);

r.get('/settings', (req, res) => res.render('admin/settings', { title: 'Club settings', active: 'settings' }));
r.post('/settings', (req, res) => {
  const keys = { club_name: 60, tagline: 140, contact_email: 120, location: 160, about: 800 };
  for (const [k, max] of Object.entries(keys)) {
    const v = String(req.body[k] || '').trim().slice(0, max);
    if (k === 'club_name' && !v) continue;
    setSetting.run(k, v);
  }
  audit(req.user.id, 'settings_update');
  res.flash('success', 'Settings saved.'); res.redirect('/admin/settings');
});
r.get('/audit', (req, res) => {
  const rows = db.prepare('SELECT a.*, u.name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 200').all();
  res.render('admin/audit', { title: 'Audit log', active: 'audit', rows });
});
module.exports = r;
