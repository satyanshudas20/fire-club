const express = require('express');
const { db, audit } = require('../db');
const { requireAuth, requireOfficer } = require('../lib/security');
const { nowLocal, toCsv } = require('../lib/helpers');
const r = express.Router();
r.use(requireAuth);

const CATS = ['Gathering', 'Training', 'Practice', 'Performance', 'Social'];
const LIST = `SELECT e.*, (SELECT COUNT(*) FROM rsvps WHERE event_id=e.id AND status='going') going,
  (SELECT status FROM rsvps WHERE event_id=e.id AND user_id=?) my_rsvp FROM events e`;

r.get('/', (req, res) => {
  const past = req.query.view === 'past', now = nowLocal();
  const cat = CATS.includes(req.query.cat) ? req.query.cat : null;
  const events = db.prepare(`${LIST} WHERE starts_at ${past ? '<' : '>='} ? ${cat ? 'AND category=?' : ''} ORDER BY starts_at ${past ? 'DESC' : ''}`)
    .all(...[req.user.id, now].concat(cat ? [cat] : []));
  res.render('events/index', { title: 'Events', active: 'events', events, past, cat, CATS });
});

r.get('/new', requireOfficer, (req, res) => res.render('events/form', { title: 'New event', active: 'events', e: { category: 'Gathering', capacity: 0 }, CATS, action: '/events' }));
function parse(b) {
  const e = { title: String(b.title || '').trim().slice(0, 120), description: String(b.description || '').slice(0, 2000), location: String(b.location || '').slice(0, 160),
    category: CATS.includes(b.category) ? b.category : 'Gathering', starts_at: String(b.starts_at || ''), ends_at: String(b.ends_at || '') || null,
    capacity: Math.max(0, parseInt(b.capacity) || 0), members_only: b.members_only ? 1 : 0 };
  const ok = e.title && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(e.starts_at) && (!e.ends_at || e.ends_at >= e.starts_at);
  return { e, ok };
}
r.post('/', requireOfficer, (req, res) => {
  const { e, ok } = parse(req.body);
  if (!ok) return res.status(400).render('events/form', { title: 'New event', active: 'events', e, CATS, action: '/events', error: 'Title and a valid start (end must be after start) are required.' });
  const id = db.prepare('INSERT INTO events(title,description,location,category,starts_at,ends_at,capacity,members_only,created_by) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(e.title, e.description, e.location, e.category, e.starts_at, e.ends_at, e.capacity, e.members_only, req.user.id).lastInsertRowid;
  audit(req.user.id, 'event_create', e.title);
  res.flash('success', 'Event created.'); res.redirect('/events/' + id);
});

r.get('/:id', (req, res, next) => {
  const e = db.prepare(`${LIST} WHERE e.id=?`).get(req.user.id, req.params.id);
  if (!e) return next();
  const attendees = db.prepare(`SELECT u.id, u.name, u.email, r.status, r.checked_in FROM rsvps r JOIN users u ON u.id=r.user_id WHERE r.event_id=? ORDER BY r.status, r.created_at`).all(e.id);
  const addable = res.locals.isOfficer ? db.prepare("SELECT id, name FROM users WHERE status='active' AND id NOT IN (SELECT user_id FROM rsvps WHERE event_id=?) ORDER BY name").all(e.id) : [];
  res.render('events/show', { title: e.title, active: 'events', e, attendees, addable, past: e.starts_at < nowLocal() });
});

r.get('/:id/edit', requireOfficer, (req, res, next) => {
  const e = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
  if (!e) return next();
  res.render('events/form', { title: 'Edit event', active: 'events', e, CATS, action: `/events/${e.id}/edit` });
});
r.post('/:id/edit', requireOfficer, (req, res, next) => {
  const old = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
  if (!old) return next();
  const { e, ok } = parse(req.body);
  if (!ok) return res.status(400).render('events/form', { title: 'Edit event', active: 'events', e: { ...e, id: old.id }, CATS, action: `/events/${old.id}/edit`, error: 'Title and valid dates are required.' });
  db.prepare('UPDATE events SET title=?,description=?,location=?,category=?,starts_at=?,ends_at=?,capacity=?,members_only=? WHERE id=?')
    .run(e.title, e.description, e.location, e.category, e.starts_at, e.ends_at, e.capacity, e.members_only, old.id);
  promote(old.id);
  audit(req.user.id, 'event_update', e.title);
  res.flash('success', 'Event updated.'); res.redirect('/events/' + old.id);
});
r.post('/:id/delete', requireOfficer, (req, res) => {
  const e = db.prepare('SELECT title FROM events WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM events WHERE id=?').run(req.params.id);
  if (e) audit(req.user.id, 'event_delete', e.title);
  res.flash('success', 'Event deleted.'); res.redirect('/events');
});

// Promote waitlisted people into any free spots
function promote(eventId) {
  const e = db.prepare('SELECT capacity FROM events WHERE id=?').get(eventId);
  if (!e) return;
  const tx = db.transaction(() => {
    for (;;) {
      const going = db.prepare("SELECT COUNT(*) c FROM rsvps WHERE event_id=? AND status='going'").get(eventId).c;
      if (e.capacity && going >= e.capacity) break;
      const next = db.prepare("SELECT user_id FROM rsvps WHERE event_id=? AND status='waitlist' ORDER BY created_at, rowid LIMIT 1").get(eventId);
      if (!next) break;
      db.prepare("UPDATE rsvps SET status='going' WHERE event_id=? AND user_id=?").run(eventId, next.user_id);
    }
  });
  tx();
}
function addRsvp(eventId, userId) {
  return db.transaction(() => {
    const e = db.prepare('SELECT capacity FROM events WHERE id=?').get(eventId);
    if (db.prepare('SELECT 1 FROM rsvps WHERE event_id=? AND user_id=?').get(eventId, userId)) return null;
    const going = db.prepare("SELECT COUNT(*) c FROM rsvps WHERE event_id=? AND status='going'").get(eventId).c;
    const status = e.capacity && going >= e.capacity ? 'waitlist' : 'going';
    db.prepare('INSERT INTO rsvps(event_id,user_id,status) VALUES(?,?,?)').run(eventId, userId, status);
    return status;
  })();
}

r.post('/:id/rsvp', (req, res, next) => {
  const e = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
  if (!e) return next();
  if (e.starts_at < nowLocal()) { res.flash('error', 'This event has already happened.'); return res.redirect('/events/' + e.id); }
  if (e.members_only && req.user.price_cents === 0 && !res.locals.isOfficer) {
    res.flash('error', 'This event is for paid members. Upgrade your plan to join.'); return res.redirect('/billing');
  }
  const s = addRsvp(e.id, req.user.id);
  res.flash(s ? 'success' : 'error', s === 'going' ? "You're in! See you there. 🔥" : s === 'waitlist' ? "Event is full — you're on the waitlist." : 'You already RSVPed.');
  res.redirect('/events/' + e.id);
});
r.post('/:id/cancel', (req, res) => {
  db.prepare('DELETE FROM rsvps WHERE event_id=? AND user_id=?').run(req.params.id, req.user.id);
  promote(+req.params.id);
  res.flash('success', 'RSVP cancelled.'); res.redirect('/events/' + req.params.id);
});
r.post('/:id/add', requireOfficer, (req, res) => {
  if (db.prepare('SELECT 1 FROM users WHERE id=?').get(req.body.user_id)) addRsvp(+req.params.id, +req.body.user_id);
  res.redirect('/events/' + req.params.id);
});
r.post('/:id/checkin/:uid', requireOfficer, (req, res) => {
  db.prepare("UPDATE rsvps SET checked_in = 1 - checked_in WHERE event_id=? AND user_id=? AND status='going'").run(req.params.id, req.params.uid);
  res.redirect('/events/' + req.params.id + '#attendees');
});
r.post('/:id/remove/:uid', requireOfficer, (req, res) => {
  db.prepare('DELETE FROM rsvps WHERE event_id=? AND user_id=?').run(req.params.id, req.params.uid);
  promote(+req.params.id);
  res.redirect('/events/' + req.params.id + '#attendees');
});
r.get('/:id/attendance.csv', requireOfficer, (req, res) => {
  const rows = db.prepare(`SELECT u.name, u.email, r.status, CASE r.checked_in WHEN 1 THEN 'yes' ELSE 'no' END checked_in FROM rsvps r JOIN users u ON u.id=r.user_id WHERE r.event_id=? ORDER BY u.name`).all(req.params.id);
  res.type('text/csv').attachment(`event-${req.params.id}-attendance.csv`).send(toCsv(rows, ['name', 'email', 'status', 'checked_in']));
});
module.exports = r;
