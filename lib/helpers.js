function nowLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
function plusDays(days, hour = 18, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
function dateOnly(days = 0) { return plusDays(days).slice(0, 10); }
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s.length === 10 ? s + 'T00:00' : s);
  if (isNaN(d)) return s;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function fmtTime(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return s;
  let h = d.getHours(); const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}
function fmtDateTime(s) { return s ? `${fmtDate(s)}, ${fmtTime(s)}` : '—'; }
function money(cents) { return '$' + (cents / 100).toFixed(2).replace(/\.00$/, ''); }
function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}
function csvEscape(v) {
  v = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; // neutralise spreadsheet formula injection
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function toCsv(rows, cols) {
  return [cols.join(',')].concat(rows.map(r => cols.map(c => csvEscape(r[c])).join(','))).join('\n');
}
function safeNext(n) { return typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/dashboard'; }
function monthlyCents(plan) {
  if (!plan) return 0;
  return plan.interval === 'year' ? Math.round(plan.price_cents / 12) : plan.interval === 'month' ? plan.price_cents : 0;
}
function addInterval(interval) {
  const d = new Date();
  if (interval === 'year') d.setFullYear(d.getFullYear() + 1); else d.setMonth(d.getMonth() + 1);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
module.exports = { nowLocal, plusDays, dateOnly, fmtDate, fmtTime, fmtDateTime, money, initials, csvEscape, toCsv, safeNext, monthlyCents, addInterval };
