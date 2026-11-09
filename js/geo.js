// Place search and category explore, all OpenStreetMap data:
//  - Photon (komoot): free-text search, and "what's nearby" per category via /reverse + osm_tag filters
//  - Overpass: fallback for category explore (public instances are often overloaded)
//  - Nominatim lookup: opening hours / website / phone for a place when its card opens
// Overpass query shape adapted from TREK's osm-filter helpers (AGPL-3.0).
import { CATEGORIES, catOf, categorize } from './categories.js';

const PHOTON = 'https://photon.komoot.io/api/';
const PHOTON_REVERSE = 'https://photon.komoot.io/reverse';
const NOMINATIM_LOOKUP = 'https://nominatim.openstreetmap.org/lookup';
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

/** fetch with a timeout that also honours the caller's abort signal. */
async function fetchT(url, opts = {}, ms = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const outer = opts.signal;
  const onAbort = () => ctrl.abort();
  outer?.addEventListener('abort', onAbort);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (e) {
    if (outer?.aborted) throw e;
    if (e.name === 'AbortError') throw new Error('Timed out');
    throw e;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onAbort);
  }
}

const PHOTON_LANGS = ['en', 'de', 'fr', 'it'];

function joinAddress(p) {
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const parts = [street, p.city || p.town || p.village || p.district, p.country];
  return [...new Set(parts.filter(Boolean))].join(', ');
}

function photonKind(p) {
  const v = (p.osm_value || p.type || '').replace(/_/g, ' ');
  return v ? v[0].toUpperCase() + v.slice(1) : '';
}

/**
 * Free-text place search. `near` biases results toward the map centre; `placesOnly`
 * limits to cities/regions (used when choosing a trip destination).
 */
export async function searchPlaces(q, { near, limit = 8, placesOnly = false, signal } = {}) {
  const p = new URLSearchParams({ q, limit: String(limit) });
  const lang = (navigator.language || 'en').slice(0, 2).toLowerCase();
  if (PHOTON_LANGS.includes(lang)) p.set('lang', lang);
  if (near) {
    p.set('lat', near.lat.toFixed(4));
    p.set('lon', near.lng.toFixed(4));
  }
  if (placesOnly) {
    p.append('osm_tag', 'place');
    p.append('osm_tag', 'boundary:administrative');
  }
  const r = await fetchT(`${PHOTON}?${p}`, { signal }, 12000);
  if (!r.ok) throw new Error(`Search failed (${r.status})`);
  const j = await r.json();
  return photonPlaces(j);
}

function photonPlaces(j) {
  return (j.features || [])
    .map((f) => {
      const pr = f.properties || {};
      const [lng, lat] = f.geometry?.coordinates || [];
      const name = pr.name || [pr.street, pr.housenumber].filter(Boolean).join(' ') || pr.city;
      return {
        name,
        lat,
        lng,
        address: joinAddress(pr),
        kind: photonKind(pr),
        cat: categorize({ [pr.osm_key]: pr.osm_value }),
        osm: pr.osm_type && pr.osm_id ? `${pr.osm_type}${pr.osm_id}` : null,
        // Photon extent: [minLon, maxLat, maxLon, minLat]
        bounds: Array.isArray(pr.extent) ? [[pr.extent[3], pr.extent[0]], [pr.extent[1], pr.extent[2]]] : null,
        country: pr.country || '',
      };
    })
    .filter((x) => x.name && Number.isFinite(x.lat) && Number.isFinite(x.lng));
}

function overpassSelector(filter, box) {
  const conds = filter.split('&').map((c) => {
    const [k, v] = c.split('=');
    return `["${k}"="${v}"]`;
  }).join('');
  return `nwr${conds}["name"]${box};`;
}

function tagAddress(t) {
  const street = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
  return [street, t['addr:city']].filter(Boolean).join(', ');
}

/**
 * Named places of the given categories around the visible map, up to 50 per category
 * (nearest to the map centre first). Photon first — fast and rarely overloaded — then
 * Overpass if Photon fails.
 */
export async function explorePois(catKeys, bounds, { signal } = {}) {
  try {
    const pois = await photonExplore(catKeys, bounds, signal);
    if (pois.length || !catKeys.length) return pois;
  } catch (e) {
    if (signal?.aborted) throw e;
    console.warn('Photon explore failed, trying Overpass', e);
  }
  return overpassExplore(catKeys, bounds, { signal });
}

async function photonExplore(catKeys, bounds, signal) {
  const c = bounds.getCenter();
  const ne = bounds.getNorthEast();
  const radiusKm = Math.min(12, Math.max(0.4, c.distanceTo(ne) / 1000));
  const lists = await Promise.all(catKeys.map(async (key) => {
    const p = new URLSearchParams({ lon: c.lng.toFixed(5), lat: c.lat.toFixed(5), radius: radiusKm.toFixed(2), limit: '50' });
    const lang = (navigator.language || 'en').slice(0, 2).toLowerCase();
    if (PHOTON_LANGS.includes(lang)) p.set('lang', lang);
    for (const f of catOf(key).osm) p.append('osm_tag', f.replace('=', ':'));
    const r = await fetchT(`${PHOTON_REVERSE}?${p}`, { signal }, 12000);
    if (!r.ok) throw new Error(`Photon ${r.status}`);
    return photonPlaces(await r.json()).map((x) => ({ ...x, cat: x.cat === 'other' ? key : x.cat }));
  }));
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const x of list) {
      const id = x.osm || `${x.lat},${x.lng}`;
      if (seen.has(id) || !bounds.contains([x.lat, x.lng])) continue;
      seen.add(id);
      out.push({ ...x, id });
    }
  }
  return out;
}

const detailCache = new Map();
/** Opening hours, website, phone for an OSM object ("N123", "W45" or "node/123"). Cached; never throws. */
export async function placeDetails(osm) {
  if (!osm) return null;
  const m = /^(node|way|relation)\/(\d+)$/.exec(osm);
  const id = m ? `${m[1][0].toUpperCase()}${m[2]}` : osm;
  if (!/^[NWR]\d+$/.test(id)) return null;
  if (detailCache.has(id)) return detailCache.get(id);
  const job = (async () => {
    try {
      const r = await fetchT(`${NOMINATIM_LOOKUP}?osm_ids=${id}&format=json&extratags=1&addressdetails=1`, {}, 8000);
      if (!r.ok) return null;
      const [x] = await r.json();
      if (!x) return null;
      const t = x.extratags || {};
      const a = x.address || {};
      const street = [a.road || a.pedestrian, a.house_number].filter(Boolean).join(' ');
      return {
        hours: t.opening_hours || '',
        website: t.website || t['contact:website'] || '',
        phone: t.phone || t['contact:phone'] || '',
        cuisine: t.cuisine ? t.cuisine.replace(/_/g, ' ').replace(/;/g, ', ') : '',
        address: [street, a.city || a.town || a.village].filter(Boolean).join(', '),
      };
    } catch {
      return null;
    }
  })();
  detailCache.set(id, job);
  const res = await job;
  if (!res) detailCache.delete(id);
  return res;
}

async function overpassExplore(catKeys, bounds, { perCat = 60, signal } = {}) {
  const s = bounds.getSouth().toFixed(5), w = bounds.getWest().toFixed(5);
  const n = bounds.getNorth().toFixed(5), e = bounds.getEast().toFixed(5);
  const box = `(${s},${w},${n},${e})`;
  const blocks = catKeys.map((k, i) => {
    const sels = catOf(k).osm.map((f) => overpassSelector(f, box)).join('');
    return `(${sels})->.c${i};.c${i} out center tags ${perCat};`;
  });
  const query = `[out:json][timeout:25];${blocks.join('')}`;

  let lastErr = null;
  for (const url of OVERPASS) {
    try {
      const r = await fetchT(url, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        signal,
      }, 9000);
      if (!r.ok) { lastErr = new Error(`Overpass ${r.status}`); continue; }
      const j = await r.json();
      const seen = new Set();
      const wanted = new Set(catKeys);
      const out = [];
      for (const el of j.elements || []) {
        const id = `${el.type}/${el.id}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
        const t = el.tags || {};
        if (!Number.isFinite(lat) || !t.name) continue;
        let cat = categorize(t);
        if (!wanted.has(cat)) cat = catKeys.find((k) => catOf(k).osm.some((f) => f.split('&').every((c) => { const [a, b] = c.split('='); return t[a] === b; }))) || cat;
        out.push({
          id,
          osm: id,
          name: t['name:en'] && !/^[\x00-\x7F]*$/.test(t.name) ? `${t.name} (${t['name:en']})` : t.name,
          lat,
          lng,
          cat,
          address: tagAddress(t),
          hours: t.opening_hours || '',
          website: t.website || t['contact:website'] || '',
          phone: t.phone || t['contact:phone'] || '',
          cuisine: t.cuisine ? t.cuisine.replace(/_/g, ' ').replace(/;/g, ', ') : '',
          kind: (t.tourism || t.amenity || t.leisure || t.natural || t.historic || '').replace(/_/g, ' '),
        });
      }
      return out;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      lastErr = err;
    }
  }
  throw lastErr || new Error('Place data is unavailable right now.');
}

export const ALL_CATEGORY_KEYS = CATEGORIES.map((c) => c.key);
