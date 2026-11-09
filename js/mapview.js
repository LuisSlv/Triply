// Leaflet map wrapper: explore pins, ideas, the day plan (planned vs taken legs), GPS trail, blue dot.
/* global L */
import { catOf } from './categories.js';
import { esc } from './util.js';

// Standard OpenStreetMap tiles (TREK's default Leaflet basemap). Dark mode tints them with a CSS filter.
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

export const TRAIL_COLOR = '#06b6d4';

export class MapView {
  constructor(el, { center, zoom = 13, bounds = null }) {
    this.map = L.map(el, { zoomControl: false, attributionControl: true, worldCopyJump: true });
    this.map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    this.tiles = L.tileLayer(TILE_URL, {
      // crossOrigin so tiles come back as CORS (not opaque) responses the offline cache can store cheaply.
      maxZoom: 19, attribution: ATTR, crossOrigin: true,
    }).addTo(this.map);

    this.g = {};
    for (const k of ['routes', 'taken', 'trail', 'ideas', 'pois', 'plan', 'temp', 'me']) this.g[k] = L.layerGroup().addTo(this.map);
    this.padding = { top: 120, bottom: 160 };

    if (bounds) this.map.fitBounds(bounds, { maxZoom: 14 });
    else this.map.setView([center.lat, center.lng], zoom);
  }

  destroy() {
    this.map.remove();
  }

  on(ev, fn) { this.map.on(ev, fn); }
  bounds() { return this.map.getBounds(); }
  zoom() { return this.map.getZoom(); }
  center() { const c = this.map.getCenter(); return { lat: c.lat, lng: c.lng }; }
  invalidate() { this.map.invalidateSize(); }
  setPadding(p) { Object.assign(this.padding, p); }

  fit(points, maxZoom = 16, animate = true) {
    const pts = points.filter((p) => p && Number.isFinite(p.lat)).map((p) => [p.lat, p.lng]);
    if (!pts.length) return;
    const opts = { paddingTopLeft: [36, this.padding.top], paddingBottomRight: [36, this.padding.bottom], maxZoom };
    if (pts.length === 1) this.flyTo(pts[0][0], pts[0][1], Math.min(maxZoom, 16), animate);
    else if (animate) this.map.flyToBounds(L.latLngBounds(pts), { ...opts, duration: 0.6 });
    else this.map.fitBounds(L.latLngBounds(pts), { ...opts, animate: false });
  }

  /** Centre a point in the part of the map that the top bar and sheet don't cover. */
  flyTo(lat, lng, zoom = this.map.getZoom(), animate = true) {
    const z = Math.max(zoom, 3);
    const p = this.map.project([lat, lng], z);
    const shift = (this.padding.bottom - this.padding.top) / 2;
    const target = this.map.unproject(p.add([0, shift]), z);
    if (animate) this.map.flyTo(target, z, { duration: 0.6 });
    else this.map.setView(target, z, { animate: false });
  }

  /* ---------- explore results ---------- */
  setPois(pois, onClick) {
    this.g.pois.clearLayers();
    for (const p of pois) {
      const c = catOf(p.cat);
      const m = L.marker([p.lat, p.lng], {
        icon: L.divIcon({ className: 'mk', html: `<div class="mk-poi" style="--c:${c.color}">${c.emoji}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
        title: p.name, alt: p.name, riseOnHover: true,
      });
      m.on('click', () => onClick(p));
      m.addTo(this.g.pois);
    }
  }

  setIdeas(ideas, onClick) {
    this.g.ideas.clearLayers();
    for (const p of ideas) {
      const c = catOf(p.cat);
      const m = L.marker([p.lat, p.lng], {
        icon: L.divIcon({ className: 'mk', html: `<div class="mk-idea" style="--c:${c.color}"><span>${c.emoji}</span></div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
        title: `Idea: ${p.name}`, alt: p.name, zIndexOffset: 200,
      });
      m.on('click', () => onClick(p));
      m.addTo(this.g.ideas);
    }
  }

  /**
   * Draw days. Each view: { day, color, dim }. Legs into a stop are "taken" once the stop and
   * the one before it are both visited — drawn solid; the rest are dashed (still planned).
   */
  setPlan(views, onStopClick, currentId = null) {
    this.g.plan.clearLayers();
    this.g.routes.clearLayers();
    this.g.taken.clearLayers();
    for (const { day, color, dim } of views) {
      day.stops.forEach((s, i) => {
        const prev = day.stops[i - 1];
        if (prev && s.leg) this._drawLeg(s.leg, color, s.visited && prev.visited, dim);
        const state = s.visited ? 'visited' : s.id === currentId ? 'current' : '';
        const m = L.marker([s.lat, s.lng], {
          icon: L.divIcon({
            className: 'mk',
            html: `<div class="mk-stop ${state}${dim ? ' dim' : ''}" style="--c:${color}"><span>${s.visited ? '✓' : i + 1}</span></div>`,
            iconSize: [32, 40], iconAnchor: [16, 38],
          }),
          title: `${i + 1}. ${s.name}`, alt: s.name, zIndexOffset: dim ? 300 : 1000 + (state === 'current' ? 500 : 0),
        });
        m.on('click', () => onStopClick(s, day));
        m.addTo(this.g.plan);
      });
    }
  }

  _drawLeg(leg, color, taken, dim) {
    const parts = leg.segments?.length
      ? leg.segments.filter((sg) => sg.coords?.length > 1).map((sg) => ({ coords: sg.coords, walk: sg.mode === 'WALK', line: sg.color }))
      : [{ coords: leg.coords || [], walk: leg.mode === 'walk', line: null }];
    for (const part of parts) {
      if (part.coords.length < 2) continue;
      if (taken) {
        L.polyline(part.coords, { color: '#fff', weight: 10, opacity: 0.9, interactive: false }).addTo(this.g.taken);
        L.polyline(part.coords, { color, weight: 6, opacity: 1, interactive: false, lineCap: 'round' }).addTo(this.g.taken);
      } else {
        const c = part.line && !part.walk ? part.line : color;
        L.polyline(part.coords, {
          color: c,
          weight: part.walk ? 3.5 : 4.5,
          opacity: dim ? 0.35 : 0.8,
          dashArray: part.walk ? '2 7' : leg.estimate ? '1 9' : '8 8',
          lineCap: 'round',
          interactive: false,
        }).addTo(this.g.routes);
      }
    }
  }

  setTrail(lines) {
    this.g.trail.clearLayers();
    for (const coords of lines) {
      if (coords.length < 2) continue;
      const ll = coords.map((p) => [p[0], p[1]]);
      L.polyline(ll, { color: '#0e7490', weight: 8, opacity: 0.25, interactive: false }).addTo(this.g.trail);
      L.polyline(ll, { color: TRAIL_COLOR, weight: 4, opacity: 0.95, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(this.g.trail);
    }
  }

  setMe(fix) {
    this.g.me.clearLayers();
    if (!fix) return;
    if (fix.acc && fix.acc < 500) {
      L.circle([fix.lat, fix.lng], { radius: fix.acc, color: '#2563eb', weight: 1, opacity: 0.4, fillOpacity: 0.08, interactive: false }).addTo(this.g.me);
    }
    L.marker([fix.lat, fix.lng], {
      icon: L.divIcon({ className: 'mk', html: '<div class="mk-me"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
      interactive: false, keyboard: false, zIndexOffset: 3000,
    }).addTo(this.g.me);
  }

  showTemp(p) {
    this.g.temp.clearLayers();
    if (!p) return;
    L.marker([p.lat, p.lng], {
      icon: L.divIcon({ className: 'mk', html: `<div class="mk-temp"><span>${esc(catOf(p.cat).emoji)}</span></div>`, iconSize: [36, 44], iconAnchor: [18, 42] }),
      interactive: false, keyboard: false, zIndexOffset: 4000,
    }).addTo(this.g.temp);
  }
}
