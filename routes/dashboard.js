const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../lib/security');
const { nowLocal, dateOnly, monthlyCents } = require('../lib/helpers');
const r = express.Router();

r.get('/dashboard', requireAuth, (req, res) => {
  const u = req.user, now = nowLocal();
  const data = { title: 'Dashboard', active: 'dashboard' };
  data.announcements = db.prepare('SELECT a.*, u.name author FROM announcements a LEFT JOIN users u ON u.id=a.author_id ORDER BY pinned DESC, created_at DESC LIMIT 3').all();
  data.myEvents = db.prepare(`SELECT e.*, r.status rsvp FROM rsvps r JOIN events e ON e.id=r.event_id WHERE r.user_id=? AND e.starts_at>=? ORDER BY e.starts_at LIMIT 4`).all(u.id, now);
  data.upcoming = db.prepare("SELECT e.*, (SELECT COUNT(*) FROM rsvps WHERE event_id=e.id AND status='going') going FROM events e WHERE starts_at>=? ORDER BY starts_at LIMIT 4").all(now);
  data.myCerts = db.prepare(`SELECT c.title, ce.expires_at FROM certifications ce JOIN courses c ON c.id=ce.course_id WHERE ce.user_id=? ORDER BY ce.expires_at`).all(u.id);
  data.myLoans = db.prepare('SELECT l.*, g.name FROM gear_loans l JOIN gear g ON g.id=l.gear_id WHERE l.user_id=? AND l.returned_at IS NULL').all(u.id);
  data.missingRequired = db.prepare(`SELECT title FROM courses c WHERE required=1 AND NOT EXISTS (SELECT 1 FROM certifications ce WHERE ce.user_id=? AND ce.course_id=c.id AND (ce.expires_at IS NULL OR ce.expires_at>=?))`).all(u.id, dateOnly());

  if (['admin', 'officer'].includes(u.role)) {
    const plans = db.prepare("SELECT u.id, p.price_cents, p.interval FROM users u JOIN plans p ON p.id=u.plan_id WHERE u.status='active'").all();
    data.stats = {
      members: db.prepare("SELECT COUNT(*) c FROM users WHERE status='active'").get().c,
      newMonth: db.prepare("SELECT COUNT(*) c FROM users WHERE joined_at >= datetime('now','-30 days')").get().c,
      mrr: plans.reduce((s, p) => s + monthlyCents(p), 0),
      upcoming: db.prepare('SELECT COUNT(*) c FROM events WHERE starts_at>=?').get(now).c,
      gearOut: db.prepare('SELECT COALESCE(SUM(qty),0) c FROM gear_loans WHERE returned_at IS NULL').get().c,
      overdueLoans: db.prepare('SELECT COUNT(*) c FROM gear_loans WHERE returned_at IS NULL AND due_at < ?').get(dateOnly()).c,
      expiring: db.prepare('SELECT COUNT(*) c FROM certifications WHERE expires_at BETWEEN ? AND ?').get(dateOnly(), dateOnly(30)).c,
      overdueDues: db.prepare("SELECT COUNT(*) c FROM users u JOIN plans p ON p.id=u.plan_id WHERE u.status='active' AND p.price_cents>0 AND u.plan_renews_at < ?").get(dateOnly()).c
    };
    // 6-month chart: signups & revenue
    const months = [];
    for (let i = 5; i >= 0; i--) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); months.push(d.toISOString().slice(0, 7)); }
    data.chart = months.map(m => ({
      label: new Date(m + '-01T00:00').toLocaleString('en', { month: 'short' }),
      signups: db.prepare("SELECT COUNT(*) c FROM users WHERE substr(joined_at,1,7)=?").get(m).c,
      revenue: db.prepare("SELECT COALESCE(SUM(amount_cents),0) c FROM payments WHERE status='paid' AND substr(created_at,1,7)=?").get(m).c
    }));
    data.recentPayments = db.prepare('SELECT p.*, u.name FROM payments p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC, p.id DESC LIMIT 5').all();
  }
  res.render('dashboard', data);
});
module.exports = r;
