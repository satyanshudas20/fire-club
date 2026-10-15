# 🔥 Fire Club — membership platform (Aquamarine edition)

A full-stack club-management SaaS: public landing page, accounts, roles, events with RSVP/waitlist/check-in,
announcements, member management, gear library, fire-safety certifications, membership plans with billing,
finance dashboard, audit log and CSV exports. Server-rendered (Express + EJS) with built-in SQLite — no external services needed.

## Run it
Requires **Node.js 22.13 or newer** (uses Node's built-in SQLite — nothing native to compile). You may see a one-line "SQLite is an experimental feature" notice; it is harmless.

```bash
npm install
npm start
# → http://localhost:3000
```

The database (`data/fireclub.db`) is created and seeded with demo data on first start.

| Role    | Email                  | Password       |
|---------|------------------------|----------------|
| Admin   | admin@fireclub.test    | Admin@1234     |
| Officer | officer@fireclub.test  | Officer@1234   |
| Member  | member@fireclub.test   | Member@1234    |

**Starting clean for real use:** `SEED_DEMO=false npm start` on a fresh `data/` folder — the **first person to sign up becomes the admin**.
`npm run seed:reset` deletes the database so it re-seeds. `npm test` runs an end-to-end smoke test (70 checks) on a throw-away database.

## Features
| Area | What it does |
|------|--------------|
| Auth | Sign up / sign in, bcrypt passwords, JWT in httpOnly cookie, profile + password change, login rate limiting |
| Roles | **admin** (everything), **officer** (events, announcements, gear, training, members read), **member** |
| Events | Create/edit/delete, categories, capacity + automatic **waitlist** promotion, paid-members-only events, check-in, attendee CSV |
| Announcements | Post, pin, delete |
| Members | Search/filter/paginate, profile with certs/gear/RSVPs/payments, role/status/plan editing, admin password reset, CSV export; members see a privacy-friendly directory |
| Gear library | Inventory with condition, availability, check-out / return, due dates, overdue flags |
| Safety & training | Courses (required/optional, validity period), award/revoke certifications, expiry warnings, dashboard alerts |
| Billing | Plans (free/monthly/yearly), upgrade/downgrade, payment history, manual cash/bank payments, overdue dues, MRR, CSV export |
| Admin | Club branding settings, audit log |
| UX | Aquamarine theme, dark mode toggle, responsive/mobile sidebar, accessible forms |

## Security notes
CSRF tokens on every POST, Helmet + strict CSP, parameterised SQL, auto-escaped output, CSV formula-injection guard, safe redirects,
suspended users are locked out immediately, last-admin protection. For production set `COOKIE_SECURE=true` (HTTPS) and `TRUST_PROXY=1` behind a proxy.
The JWT secret is generated into `data/secret.txt` unless you set `JWT_SECRET`.

## Payments
Checkout is **simulated** (nobody is charged) so the app works out of the box. To take real money, implement `charge()` in
`routes/billing.js` with Stripe/Razorpay and confirm payments via the provider's webhook.

## Project layout
```
server.js        app wiring          db.js        schema + seed data
routes/          one file per area   views/       EJS templates
lib/             security, helpers   public/       CSS + JS
scripts/         smoke test, reset   Dockerfile    container build
```

## Docker
```bash
docker build -t fire-club . && docker run -p 3000:3000 -v fireclub-data:/data -e COOKIE_SECURE=false fire-club
```
