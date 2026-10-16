const path = require('path');
try { process.loadEnvFile && require('fs').existsSync('.env') && process.loadEnvFile('.env'); } catch { /* optional */ }
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { db, getSettings } = require('./db');
const H = require('./lib/helpers');
const icon = require('./lib/icons');
const { attachUser, csrf, flash } = require('./lib/security');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], formAction: ["'self'"], upgradeInsecureRequests: null } },
  hsts: process.env.COOKIE_SECURE === 'true'
}));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(cookieParser());
app.use(flash);
app.use(attachUser);
app.use((req, res, next) => {
  Object.assign(res.locals, H, { icon, club: getSettings(), path: req.path, title: '', active: '' });
  next();
});
app.use(csrf);

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/dashboard'));
app.use('/members', require('./routes/members'));
app.use('/events', require('./routes/events'));
app.use('/announcements', require('./routes/announcements'));
app.use('/gear', require('./routes/gear'));
app.use('/training', require('./routes/training'));
app.use('/billing', require('./routes/billing'));
app.use('/admin', require('./routes/admin'));

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use((req, res) => res.status(404).render('error', { title: 'Not found', code: 404, message: "That page doesn't exist — it may have burned down." }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).render('error', { title: 'Error', code: 500, message: 'Something went wrong on our side.' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🔥 Fire Club running at http://localhost:${PORT}`);
    if (db.prepare("SELECT 1 FROM users WHERE email='admin@fireclub.test'").get())
      console.log('   Demo admin: admin@fireclub.test / Admin@1234  (change this before going live!)\n');
  });
}
module.exports = app;
