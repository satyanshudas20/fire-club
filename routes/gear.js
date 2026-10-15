const express = require('express');
const { db, audit } = require('../db');
const { requireAuth, requireOfficer } = require('../lib/security');
const { dateOnly } = require('../lib/helpers');
const r = express.Router();
r.use(requireAuth);
const CONDS = ['new', 'good', 'fair', 'repair', 'retired'];

r.get('/', (req, res) => {
  const items = db.prepare(`SELECT g.*, g.total_qty - COALESCE((SELECT SUM(qty) FROM gear_loans WHERE gear_id=g.id AND returned_at IS NULL),0) available FROM gear g ORDER BY category, name`).all();
  const loans = db.prepare(`SELECT l.*, g.name gear_name, u.name user_name FROM gear_loans l JOIN gear g ON g.id=l.gear_id JOIN users u ON u.id=l.user_id
    WHERE l.returned_at IS NULL ${res.locals.isOfficer ? '' : 'AND l.user_id=' + Number(req.user.id)} ORDER BY l.due_at`).all();
  const members = res.locals.isOfficer ? db.prepare("SELECT id, name FROM users WHERE status='active' ORDER BY name").all() : [];
  res.render('gear/index', { title: 'Gear library', active: 'gear', items, loans, members, CONDS, today: dateOnly() });
});
r.post('/', requireOfficer, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 100);
  if (!name) { res.flash('error', 'Name is required.'); return res.redirect('/gear'); }
  db.prepare('INSERT INTO gear(name,category,total_qty,condition,notes) VALUES(?,?,?,?,?)')
    .run(name, String(req.body.category || 'General').slice(0, 40), Math.max(1, parseInt(req.body.total_qty) || 1), CONDS.includes(req.body.condition) ? req.body.condition : 'good', String(req.body.notes || '').slice(0, 300));
  audit(req.user.id, 'gear_add', name);
  res.flash('success', 'Gear added.'); res.redirect('/gear');
});
r.post('/:id/update', requireOfficer, (req, res) => {
  const g = db.prepare('SELECT * FROM gear WHERE id=?').get(req.params.id);
  if (!g) return res.redirect('/gear');
  const out = db.prepare('SELECT COALESCE(SUM(qty),0) c FROM gear_loans WHERE gear_id=? AND returned_at IS NULL').get(g.id).c;
  const qty = Math.max(out, parseInt(req.body.total_qty) || g.total_qty);
  db.prepare('UPDATE gear SET total_qty=?, condition=?, notes=? WHERE id=?').run(qty, CONDS.includes(req.body.condition) ? req.body.condition : g.condition, String(req.body.notes || '').slice(0, 300), g.id);
  res.flash('success', 'Gear updated.'); res.redirect('/gear');
});
r.post('/:id/delete', requireOfficer, (req, res) => { db.prepare('DELETE FROM gear WHERE id=?').run(req.params.id); res.flash('success', 'Gear removed.'); res.redirect('/gear'); });
r.post('/:id/checkout', requireOfficer, (req, res) => {
  const ok = db.transaction(() => {
    const g = db.prepare(`SELECT g.*, g.total_qty - COALESCE((SELECT SUM(qty) FROM gear_loans WHERE gear_id=g.id AND returned_at IS NULL),0) available FROM gear g WHERE id=?`).get(req.params.id);
    const qty = Math.max(1, parseInt(req.body.qty) || 1);
    if (!g || ['repair', 'retired'].includes(g.condition) || g.available < qty || !db.prepare('SELECT 1 FROM users WHERE id=?').get(req.body.user_id)) return false;
    db.prepare('INSERT INTO gear_loans(gear_id,user_id,qty,due_at) VALUES(?,?,?,?)').run(g.id, req.body.user_id, qty, req.body.due_at || dateOnly(7));
    audit(req.user.id, 'gear_checkout', `${g.name} x${qty} → user ${req.body.user_id}`);
    return true;
  })();
  res.flash(ok ? 'success' : 'error', ok ? 'Gear checked out.' : 'Not enough available (or item is under repair/retired).');
  res.redirect('/gear');
});
r.post('/loans/:id/return', requireOfficer, (req, res) => {
  db.prepare("UPDATE gear_loans SET returned_at=datetime('now') WHERE id=? AND returned_at IS NULL").run(req.params.id);
  res.flash('success', 'Marked as returned.'); res.redirect('/gear');
});
module.exports = r;
