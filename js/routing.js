// Routes between stops, straight from the phone (no server):
//  - walk / bike / car: OSRM on routing.openstreetmap.de (FOSSGIS), the per-profile
//    instances TREK uses in client/src/components/Map/RouteCalculator.ts (AGPL-3.0)
//  - transit: Transitous (api.transitous.org, MOTIS over public GTFS feeds), as TREK's
//    server/src/nest/transit/transit.service.ts does. Free, no key, non-commercial use.
import { decodePolyline, compactCoords, haversineM, pathLengthM, toISODate, parseISODate, todayISO, addDays } from './util.js';

const OSRM = {
  car: 'https://routing.openstreetmap.de/routed-car/route/v1/driving',
  walk: 'https://routing.openstreetmap.de/routed-foot/route/v1/foot',
  bike: 'https://routing.openstreetmap.de/routed-bike/route/v1/bike',
};
const TRANSITOUS = 'https://api.transitous.org/api/v6/plan';

// Fallback speeds (km/h) and detour factor for a straight-line estimate when a router fails.
const SPEED = { walk: 4.5, bike: 14, car: 30, transit: 16 };
const DETOUR = 1.3;
/** Below this, transit is never worth it: the leg is walked. */
const WALK_INSTEAD_M = 650;

export const legKey = (a, b, mode) => `${mode}|${a.lat.toFixed(5)},${a.lng.toFixed(5)}|${b.lat.toFixed(5)},${b.lng.toFixed(5)}`;

async function osrm(mode, a, b, signal) {
  const url = `${OSRM[mode]}/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson&steps=false`;
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`Routing ${r.status}`);
  const j = await r.json();
  const rt = j.routes?.[0];
  if (j.code !== 'Ok' || !rt) throw new Error('No route found');
  return {
    mode,
    duration: rt.duration,
    distance: rt.distance,
    coords: compactCoords(rt.geometry.coordinates.map(([x, y]) => [y, x])),
    segments: null,
    estimate: false,
  };
}

function estimate(mode, a, b) {
  const d = haversineM(a, b) * DETOUR;
  return {
    mode,
    duration: (d / 1000 / SPEED[mode || 'walk']) * 3600 + (mode === 'transit' ? 300 : 0),
    distance: d,
    coords: [[a.lat, a.lng], [b.lat, b.lng]],
    segments: null,
    estimate: true,
  };
}

/** Transit feeds only cover the coming weeks; plan a past or far-future day on the next same weekday. */
function transitQueryDate(iso) {
  const today = todayISO();
  if (iso && iso >= today && iso <= addDays(today, 60)) return iso;
  const wanted = iso ? parseISODate(iso).getDay() : new Date().getDay();
  for (let i = 1; i <= 7; i++) {
    const c = addDays(today, i);
    if (parseISODate(c).getDay() === wanted) return c;
  }
  return addDays(today, 1);
}

function itineraryToLeg(it, departMs, mode = 'transit') {
  const segments = (it.legs || []).map((l) => ({
    mode: (l.mode || 'WALK').toUpperCase(),
    line: l.displayName || l.routeShortName || '',
    color: /^[0-9a-f]{6}$/i.test(l.routeColor || '') ? `#${l.routeColor}` : null,
    textColor: /^[0-9a-f]{6}$/i.test(l.routeTextColor || '') ? `#${l.routeTextColor}` : null,
    headsign: l.headsign || '',
    from: l.from?.name || '',
    to: l.to?.name || '',
    depart: l.startTime || l.scheduledStartTime || null,
    arrive: l.endTime || l.scheduledEndTime || null,
    duration: l.duration || 0,
    distance: l.distance || null,
    coords: l.legGeometry?.points ? compactCoords(decodePolyline(l.legGeometry.points, l.legGeometry.precision ?? 6), 300) : [],
  }));
  const end = it.endTime ? new Date(it.endTime).getTime() : null;
  // Wall clock from when you leave (incl. waiting for the first vehicle), like TREK's timeline does.
  const wall = end && departMs ? Math.max(it.duration || 0, (end - departMs) / 1000) : it.duration || 0;
  const coords = segments.flatMap((s) => s.coords);
  // MOTIS gives distances for walking legs only; measure the drawn line instead.
  const distance = coords.length > 1 ? pathLengthM(coords) : segments.reduce((sum, s) => sum + (s.distance || 0), 0);
  return {
    mode,
    duration: wall,
    distance: distance || null,
    coords,
    segments: segments.length ? segments : null,
    estimate: false,
    transfers: it.transfers ?? null,
  };
}

async function transit(a, b, departDate, signal) {
  const p = new URLSearchParams({
    fromPlace: `${a.lat},${a.lng}`,
    toPlace: `${b.lat},${b.lng}`,
    time: departDate.toISOString(),
    numItineraries: '5',
    directModes: 'WALK',
  });
  const r = await fetch(`${TRANSITOUS}?${p}`, { signal });
  if (!r.ok) throw new Error(`Transit ${r.status}`);
  const j = await r.json();
  const departMs = departDate.getTime();
  // Earliest arrival, but each transfer "costs" 6 minutes so a simple ride beats a 3-change scramble.
  const score = (it) => new Date(it.endTime).getTime() + (it.transfers || 0) * 6 * 60000;
  const its = (j.itineraries || []).filter((it) => it.endTime);
  its.sort((x, y) => score(x) - score(y));
  const best = its[0];
  const walk = (j.direct || [])[0];
  if (!best && !walk) throw new Error('No transit connection found');
  if (!best || (walk && walk.duration <= (new Date(best.endTime).getTime() - departMs) / 1000)) {
    return { ...itineraryToLeg(walk, null, 'walk'), duration: walk.duration, autoWalk: true };
  }
  return itineraryToLeg(best, departMs);
}

/**
 * Route one leg. `departMin` (minutes after midnight) and `dateISO` set the departure time,
 * which matters only for transit. Never throws: on failure it returns a marked estimate.
 */
export async function routeLeg(a, b, mode, { dateISO, departMin = 540, signal } = {}) {
  const key = legKey(a, b, mode);
  try {
    let leg;
    if (mode === 'transit') {
      if (haversineM(a, b) < WALK_INSTEAD_M) {
        leg = { ...(await osrm('walk', a, b, signal)), autoWalk: true };
      } else {
        const d = parseISODate(transitQueryDate(dateISO));
        d.setHours(0, 0, 0, 0);
        d.setMinutes(Math.round(departMin));
        leg = await transit(a, b, d, signal);
      }
    } else {
      leg = await osrm(mode, a, b, signal);
    }
    return { ...leg, key, requestedMode: mode, at: Date.now() };
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    console.warn('Routing failed, using estimate', err);
    return { ...estimate(mode, a, b), key, requestedMode: mode, at: Date.now(), error: String(err.message || err) };
  }
}

export { toISODate };
