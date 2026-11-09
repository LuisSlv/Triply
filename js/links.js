// Hand-offs to Google Maps (place pages with reviews/photos, turn-by-turn directions incl. transit)
// and a calendar (.ics) export. URL shapes follow Google's Maps URLs API; the multi-stop builder
// is adapted from TREK's dayRouteApps / generateGoogleMapsUrl (AGPL-3.0).
import { LEG_MODES } from './categories.js';
import { hmToMin, parseISODate } from './util.js';
import { computeSchedule } from './schedule.js';

const pt = (p) => `${p.lat},${p.lng}`;

/** Google Maps place page — searched by name + address so it opens the real listing (reviews, hours, photos). */
export function gmPlace(p, context = '') {
  const q = [p.name, p.address || context].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q || pt(p))}`;
}

/** Directions for one leg. Without `from`, Google starts from the phone's current location. */
export function gmDirections(from, to, mode) {
  const travelmode = LEG_MODES[mode]?.gm || 'transit';
  const origin = from ? `&origin=${pt(from)}` : '';
  return `https://www.google.com/maps/dir/?api=1${origin}&destination=${pt(to)}&travelmode=${travelmode}`;
}

/** A whole day in Google Maps (Google ignores waypoints for transit, so transit days open as driving overview). */
export function gmDay(stops, mode) {
  const v = stops.filter((s) => Number.isFinite(s.lat));
  if (!v.length) return null;
  if (v.length === 1) return gmPlace(v[0]);
  const first = v[0], last = v[v.length - 1];
  const between = v.slice(1, -1).map(pt).join('|');
  const travelmode = mode === 'transit' ? 'transit' : LEG_MODES[mode]?.gm || 'walking';
  const wp = between && travelmode !== 'transit' ? `&waypoints=${encodeURIComponent(between)}` : '';
  return `https://www.google.com/maps/dir/?api=1&origin=${pt(first)}&destination=${pt(last)}${wp}&travelmode=${travelmode}`;
}

/** Google search for events (carnivals, festivals) — not something map data knows about. */
export function eventsSearch(trip) {
  const d = trip.days[0]?.date ? parseISODate(trip.days[0].date).toLocaleDateString('en', { month: 'long', year: 'numeric' }) : '';
  const q = `carnivals festivals events in ${trip.destination?.name || trip.name} ${d}`;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

/* ---------- calendar ---------- */
const icsText = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
function icsLocal(dateISO, min) {
  const d = parseISODate(dateISO);
  d.setMinutes(min);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
}
function fold(line) {
  const out = [];
  while (line.length > 74) { out.push(line.slice(0, 74)); line = ' ' + line.slice(74); }
  out.push(line);
  return out.join('\r\n');
}

/** Every stop of every dated day as a calendar event, at the times the timeline shows. */
export function tripToICS(trip) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Triply//Trip planner//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsText(trip.name)}`];
  for (const day of trip.days) {
    if (!day.date) continue;
    const sched = computeSchedule(day);
    day.stops.forEach((s, i) => {
      const r = sched.rows[i];
      lines.push(
        'BEGIN:VEVENT',
        `UID:${s.id}@triply.local`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${icsLocal(day.date, r.arrive)}`,
        `DTEND:${icsLocal(day.date, r.depart)}`,
        fold(`SUMMARY:${icsText(s.name)}`),
        fold(`LOCATION:${icsText(s.address || `${s.lat}, ${s.lng}`)}`),
        `GEO:${s.lat};${s.lng}`,
        fold(`DESCRIPTION:${icsText([s.notes, gmPlace(s, trip.destination?.name)].filter(Boolean).join('\n'))}`),
        'END:VEVENT',
      );
    });
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export { hmToMin };
