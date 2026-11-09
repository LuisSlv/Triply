// Small shared helpers: escaping, ids, dates/times, formatting, geometry.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape any text that came from a user or a third-party API before it goes into markup. */
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ---------- dates (ISO 'YYYY-MM-DD', local time) ---------- */
export function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const todayISO = () => toISODate(new Date());
export function parseISODate(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export function addDays(iso, n) {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}
export const daysBetween = (a, b) => Math.round((parseISODate(b) - parseISODate(a)) / 86400000);
export function fmtDate(iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return iso ? parseISODate(iso).toLocaleDateString(undefined, opts) : '';
}

/* ---------- clock times (minutes from midnight) ---------- */
export function hmToMin(hm) {
  const [h, m] = String(hm || '09:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
export function minToHM(min) {
  const total = Math.round(min);
  const r = ((total % 1440) + 1440) % 1440;
  const extra = Math.floor(total / 1440);
  const hm = `${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`;
  return extra > 0 ? `${hm}<sup>+${extra}</sup>` : hm;
}
export const minToHMPlain = (min) => minToHM(min).replace(/<sup>.*<\/sup>/, '');

/* ---------- formatting ---------- */
export function fmtDuration(sec) {
  const m = Math.max(1, Math.round(sec / 60));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
export function fmtMinutes(min) { return fmtDuration(min * 60); }
export function fmtDistance(m) {
  if (m == null || Number.isNaN(m)) return '';
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}
export function fmtClockISO(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ---------- geometry ---------- */
export function haversineM(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
export function pathLengthM(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i++) {
    d += haversineM({ lat: coords[i - 1][0], lng: coords[i - 1][1] }, { lat: coords[i][0], lng: coords[i][1] });
  }
  return d;
}

/** Google encoded polyline; Transitous (MOTIS) sends precision 6, OSRM's polyline is 5. */
export function decodePolyline(str, precision = 5) {
  const factor = 10 ** precision;
  const out = [];
  let index = 0, lat = 0, lng = 0;
  while (index < str.length) {
    for (const which of [0, 1]) {
      let result = 0, shift = 0, b;
      do {
        b = str.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta; else lng += delta;
    }
    out.push([lat / factor, lng / factor]);
  }
  return out;
}

/** Keep stored route lines small: round to ~1 m and drop every other point on very long lines. */
export function compactCoords(coords, max = 600) {
  let pts = coords.map(([a, b]) => [Math.round(a * 1e5) / 1e5, Math.round(b * 1e5) / 1e5]);
  while (pts.length > max) pts = pts.filter((_, i) => i % 2 === 0 || i === pts.length - 1);
  return pts;
}

/** Download a text file (backup, calendar). */
export function downloadText(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
