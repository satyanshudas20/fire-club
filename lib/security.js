const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { db, DATA_DIR } = require('../db');

function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const f = path.join(DATA_DIR, 'secret.txt');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8').trim();
}
const SECRET = loadSecret();
const secureCookie = process.env.COOKIE_SECURE === 'true';

const signToken = id => jwt.sign({ id }, SECRET, { expiresIn: '7d' });

function attachUser(req, res, next) {
  req.user = null;
  const t = req.cookies.token;
  if (t) {
    try {
      const { id } = jwt.verify(t, SECRET);
      const u = db.prepare('SELECT u.*, p.name AS plan_name, p.price_cents, p.interval FROM users u LEFT JOIN plans p ON p.id=u.plan_id WHERE u.id=?').get(id);
      if (u && u.status === 'active') req.user = u;
    } catch { /* invalid token */ }
  }
  res.locals.user = req.user;
  res.locals.isOfficer = !!req.user && ['admin', 'officer'].includes(req.user.role);
  res.locals.isAdmin = !!req.user && req.user.role === 'admin';
  next();
}
const requireAuth = (req, res, next) =>
  req.user ? next() : res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
const requireOfficer = (req, res, next) =>
  req.user && ['admin', 'officer'].includes(req.user.role) ? next() : forbidden(req, res);
const requireAdmin = (req, res, next) => (req.user && req.user.role === 'admin' ? next() : forbidden(req, res));
function forbidden(req, res) {
  res.status(403).render('error', { title: 'Not allowed', code: 403, message: "You don't have permission to do that." });
}

// Double-submit CSRF protection
function csrf(req, res, next) {
  let token = req.cookies.csrf;
  if (!token) {
    token = crypto.randomBytes(24).toString('hex');
    res.cookie('csrf', token, { httpOnly: true, sameSite: 'lax', secure: secureCookie });
  }
  res.locals.csrfToken = token;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const sent = (req.body && req.body._csrf) || req.get('x-csrf-token');
    if (!sent || sent.length !== token.length || !crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(token))) {
      return res.status(403).render('error', { title: 'Session expired', code: 403, message: 'Your form expired. Go back, refresh the page and try again.' });
    }
  }
  next();
}

// Flash messages via short-lived cookie
function flash(req, res, next) {
  res.locals.flash = null;
  if (req.cookies.flash) {
    try { res.locals.flash = JSON.parse(req.cookies.flash); } catch { /* ignore */ }
    res.clearCookie('flash');
  }
  res.flash = (type, msg) => res.cookie('flash', JSON.stringify({ type, msg }), { httpOnly: true, sameSite: 'lax', maxAge: 15000 });
  next();
}

module.exports = { signToken, attachUser, requireAuth, requireOfficer, requireAdmin, csrf, flash, secureCookie };
