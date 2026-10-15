const express = require('express');
const { db, audit } = require('../db');
const { requireAuth, requireAdmin } = require('../lib/security');
const { addInterval, dateOnly, monthlyCents, toCsv } = require('../lib/helpers');
const r = express.Router();
r.use(requireAuth);

/*  PAYMENTS NOTE
    Checkout below is SIMULATED (no card is charged) so the app runs out-of-the-box.
    To go live, replace the body of `charge()` with a call to Stripe/Razorpay/etc. and
    only mark the payment 'paid' from the provider's webhook. */
function charge(user, plan) { return { ok: true, method: 'card (simulated)' }; }

r.get('/', (req, res) => {
  res.render('billing/index', {
    title: 'Billing', active: 'billing', today: dateOnly(),
    plans: db.prepare('SELECT * FROM plans WHERE active=1 ORDER BY price_cents').all(),
    payments: db.prepare('SELECT p.*, pl.name plan_name FROM payments p LEFT JOIN plans pl ON pl.id=p.plan_id WHERE p.user_id=? ORDER BY p.created_at DESC, p.id DESC').all(req.user.id)
  });
});
r.post('/subscribe/:planId', (req, res) => {
  const plan = db.prepare('SELECT * FROM plans WHERE id=? AND active=1').get(req.params.planId);
  if (!plan) { res.flash('error', 'Unknown plan.'); return res.redirect('/billing'); }
  if (plan.price_cents === 0) return cancelToFree(req, res);
  const c = charge(req.user, plan);
  db.prepare('INSERT INTO payments(user_id,plan_id,amount_cents,status,method,note) VALUES(?,?,?,?,?,?)')
    .run(req.user.id, plan.id, plan.price_cents, c.ok ? 'paid' : 'failed', c.method, plan.interval === 'year' ? 'Annual membership' : 'Monthly dues');
  if (!c.ok) { res.flash('error', 'Payment failed.'); return res.redirect('/billing'); }
  db.prepare('UPDATE users SET plan_id=?, plan_renews_at=? WHERE id=?').run(plan.id, addInterval(plan.interval), req.user.id);
  audit(req.user.id, 'subscribe', plan.name);
  res.flash('success', `You're now on ${plan.name}. Thank you! 🔥`); res.redirect('/billing');
});
function cancelToFree(req, res) {
  const free = db.prepare("SELECT id FROM plans WHERE interval='free' ORDER BY id LIMIT 1").get();
  db.prepare('UPDATE users SET plan_id=?, plan_renews_at=NULL WHERE id=?').run(free && free.id, req.user.id);
  audit(req.user.id, 'downgrade');
  res.flash('success', 'You are on the free plan. Paid perks have been removed.'); res.redirect('/billing');
}
r.post('/cancel', cancelToFree);

// ---- admin: financial overview & plans
r.get('/admin', requireAdmin, (req, res) => {
  const plans = db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM users WHERE plan_id=p.id AND status='active') subscribers FROM plans p ORDER BY price_cents`).all();
  const mrr = plans.reduce((s, p) => s + monthlyCents(p) * p.subscribers, 0);
  const paid = db.prepare("SELECT COALESCE(SUM(amount_cents),0) c FROM payments WHERE status='paid'").get().c;
  const payments = db.prepare('SELECT p.*, u.name, pl.name plan_name FROM payments p JOIN users u ON u.id=p.user_id LEFT JOIN plans pl ON pl.id=p.plan_id ORDER BY p.created_at DESC, p.id DESC LIMIT 50').all();
  const overdue = db.prepare("SELECT u.id, u.name, u.plan_renews_at, p.name plan_name, p.price_cents FROM users u JOIN plans p ON p.id=u.plan_id WHERE u.status='active' AND p.price_cents>0 AND u.plan_renews_at < ? ORDER BY u.plan_renews_at").all(dateOnly());
  res.render('billing/admin', { title: 'Finances', active: 'finance', plans, mrr, paid, payments, overdue,
    members: db.prepare("SELECT id, name FROM users ORDER BY name").all() });
});
r.get('/admin/payments.csv', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT p.id, u.name, u.email, pl.name plan, p.amount_cents/100.0 amount, p.status, p.method, p.note, p.created_at FROM payments p JOIN users u ON u.id=p.user_id LEFT JOIN plans pl ON pl.id=p.plan_id ORDER BY p.created_at DESC').all();
  res.type('text/csv').attachment('payments.csv').send(toCsv(rows, ['id', 'name', 'email', 'plan', 'amount', 'status', 'method', 'note', 'created_at']));
});
r.post('/admin/plans', requireAdmin, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  const interval = ['free', 'month', 'year'].includes(req.body.interval) ? req.body.interval : 'month';
  const price = interval === 'free' ? 0 : Math.round(parseFloat(req.body.price) * 100);
  if (!name || !(price >= 0)) { res.flash('error', 'Name and a valid price are required.'); return res.redirect('/billing/admin'); }
  db.prepare('INSERT INTO plans(name,price_cents,interval,description,perks) VALUES(?,?,?,?,?)').run(name, price, interval, String(req.body.description || '').slice(0, 200), String(req.body.perks || '').slice(0, 600));
  audit(req.user.id, 'plan_create', name);
  res.flash('success', 'Plan created.'); res.redirect('/billing/admin');
});
r.post('/admin/plans/:id/toggle', requireAdmin, (req, res) => { db.prepare('UPDATE plans SET active=1-active WHERE id=?').run(req.params.id); res.redirect('/billing/admin'); });
r.post('/admin/payments', requireAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.body.user_id);
  const amount = Math.round(parseFloat(req.body.amount) * 100);
  if (!u || !(amount > 0)) { res.flash('error', 'Pick a member and enter a positive amount.'); return res.redirect('/billing/admin'); }
  db.prepare('INSERT INTO payments(user_id,plan_id,amount_cents,status,method,note) VALUES(?,?,?,?,?,?)').run(u.id, u.plan_id, amount, 'paid', ['cash', 'bank', 'other'].includes(req.body.method) ? req.body.method : 'cash', String(req.body.note || 'Manual payment').slice(0, 200));
  if (req.body.extend && u.plan_id) {
    const p = db.prepare('SELECT interval FROM plans WHERE id=?').get(u.plan_id);
    if (p && p.interval !== 'free') db.prepare('UPDATE users SET plan_renews_at=? WHERE id=?').run(addInterval(p.interval), u.id);
  }
  audit(req.user.id, 'payment_manual', `${u.name} $${(amount / 100).toFixed(2)}`);
  res.flash('success', 'Payment recorded.'); res.redirect('/billing/admin');
});
module.exports = r;
