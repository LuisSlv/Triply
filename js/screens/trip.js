// The trip screen: map + search + category chips + toggleable timeline sheet + step-by-step mode.
import * as store from '../store.js';
import { CATEGORIES, catOf, TRANSPORT, LEG_MODES, transitEmoji, dayColor, DURATION_CHOICES } from '../categories.js';
import { searchPlaces, explorePois, placeDetails } from '../geo.js';
import { routeLeg, legKey } from '../routing.js';
import { computeSchedule, legModeFor } from '../schedule.js';
import { gmPlace, gmDirections, gmDay, eventsSearch, tripToICS } from '../links.js';
import { MapView } from '../mapview.js';
import * as tracker from '../tracker.js';
import {
  esc, debounce, fmtDate, fmtDuration, fmtMinutes, fmtDistance, minToHM, minToHMPlain, hmToMin,
  haversineM, pathLengthM, downloadText, todayISO, clamp, fmtClockISO,
} from '../util.js';
import { ICON } from '../icons.js';
import { toast, actionSheet, formDialog, confirmDialog } from '../ui.js';

const MIN_EXPLORE_ZOOM = 12;

export function renderTrip(root, trip) {
  const today = todayISO();
  const todayIdx = trip.days.findIndex((d) => d.date === today);
  const activeIdx = trip.days.findIndex((d) => d.startedAt && !d.finishedAt);
  const ui = {
    tab: `d${activeIdx >= 0 ? activeIdx : todayIdx >= 0 ? todayIdx : 0}`,
    lastDay: Math.max(0, activeIdx >= 0 ? activeIdx : todayIdx),
    sheet: 'peek',
    explore: new Set(),
    moreCats: false,
    pois: [],
    exploring: false,
    exploreMsg: '',
    exploredBounds: null,
    selected: null,
    searchQ: '',
    results: [],
    searchOpen: false,
    searching: false,
    recording: false,
    recordDayId: null,
    fix: null,
    centerOnFix: false,
  };
  let destroyed = false;
  let searchCtrl = null, exploreCtrl = null;
  const legCtrl = new AbortController();
  let unwatch = null;

  /* ---------- skeleton ---------- */
  root.innerHTML = `<div class="screen trip">
    <div class="map" data-map></div>
    <div class="top">
      <div class="topbar">
        <a class="round-btn" href="#/" aria-label="All trips">${ICON.back}</a>
        <div class="searchbox">
          ${ICON.search}
          <input type="search" data-search placeholder="Search places in ${esc(trip.destination?.name || trip.name)}" autocomplete="off" enterkeyhint="search" aria-label="Search places" />
          <button class="clear-btn" data-a="clear-search" aria-label="Clear search" hidden>${ICON.x}</button>
        </div>
        <button class="round-btn" data-a="trip-menu" aria-label="Trip options">${ICON.more}</button>
      </div>
      <ul class="search-results" data-results hidden></ul>
      <div class="chips" data-chips></div>
      <div class="hintbar" data-hint hidden></div>
    </div>
    <div class="fabs" data-fabs></div>
    <div class="place-card" data-card hidden></div>
    <section class="sheet" data-sheet aria-label="Trip timeline">
      <div class="sheet-drag" data-drag>
        <button class="grab" data-a="toggle-sheet" aria-label="Show or hide timeline"><span></span></button>
        <div class="sheet-head" data-head></div>
      </div>
      <div class="tabs" data-tabs role="tablist"></div>
      <div class="sheet-body" data-body></div>
    </section>
  </div>`;

  const $ = (sel) => root.querySelector(sel);
  const el = {
    map: $('[data-map]'), search: $('[data-search]'), results: $('[data-results]'), chips: $('[data-chips]'),
    hint: $('[data-hint]'), fabs: $('[data-fabs]'), card: $('[data-card]'), sheet: $('[data-sheet]'),
    drag: $('[data-drag]'), head: $('[data-head]'), tabs: $('[data-tabs]'), body: $('[data-body]'),
    clear: $('[data-a="clear-search"]'), top: $('.top'),
  };

  const d0 = trip.destination || { lat: 48.8566, lng: 2.3522 };
  const map = new MapView(el.map, { center: d0, zoom: 13, bounds: d0.bounds || null });

  /* ---------- helpers ---------- */
  const dayIdx = () => (ui.tab.startsWith('d') ? clamp(Number(ui.tab.slice(1)), 0, trip.days.length - 1) : null);
  const curDay = () => (dayIdx() == null ? null : trip.days[dayIdx()]);
  const addIdx = () => (dayIdx() ?? clamp(ui.lastDay, 0, trip.days.length - 1));
  const nextStop = (day) => day.stops.find((s) => !s.visited) || null;
  const isActive = (day) => !!(day && day.startedAt && !day.finishedAt);
  const dayLabel = (i) => `Day ${i + 1}`;
  const placeCtx = trip.destination?.name || '';
  const save = () => store.touch(trip);

  function findInPlan(p) {
    for (let di = 0; di < trip.days.length; di++) {
      const s = trip.days[di].stops.find((x) => (p.osm && x.osm === p.osm) || (haversineM(x, p) < 15 && x.name === p.name));
      if (s) return { di, stop: s };
    }
    return null;
  }
  const findIdea = (p) => trip.ideas.find((x) => (p.osm && x.osm === p.osm) || (haversineM(x, p) < 15 && x.name === p.name));

  /* ---------- sheet layout & drag ---------- */
  function sheetMetrics() {
    const H = root.clientHeight;
    const sheetH = el.sheet.offsetHeight;
    const peek = el.drag.offsetHeight;
    const peekY = Math.max(0, sheetH - peek);
    return { H, sheetH, peekY, halfY: clamp(sheetH - Math.round(H * 0.55), 0, peekY), fullY: 0, peek };
  }
  function layoutSheet(animate = true) {
    const m = sheetMetrics();
    const y = ui.sheet === 'full' ? m.fullY : ui.sheet === 'half' ? m.halfY : m.peekY;
    el.sheet.style.transition = animate ? '' : 'none';
    el.sheet.style.transform = `translateY(${y}px)`;
    el.sheet.dataset.state = ui.sheet;
    const visible = m.sheetH - y;
    root.style.setProperty('--sheet-visible', `${visible}px`);
    map.setPadding({ top: el.top.offsetHeight + 12, bottom: visible + 12 });
  }
  function setSheet(state) {
    ui.sheet = state;
    layoutSheet();
  }

  let drag = null;
  el.drag.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button:not(.grab), a, input, select')) return;
    const m = sheetMetrics();
    const cur = ui.sheet === 'full' ? m.fullY : ui.sheet === 'half' ? m.halfY : m.peekY;
    drag = { y0: e.clientY, cur, t0: performance.now(), moved: false, m, id: e.pointerId };
    el.drag.setPointerCapture?.(e.pointerId);
  });
  el.drag.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y0;
    if (Math.abs(dy) > 5) drag.moved = true;
    if (!drag.moved) return;
    const y = clamp(drag.cur + dy, 0, drag.m.peekY);
    el.sheet.style.transition = 'none';
    el.sheet.style.transform = `translateY(${y}px)`;
  });
  const endDrag = (e) => {
    if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.id)) return;
    const d = drag; drag = null;
    if (!d.moved) {
      if (e.target.closest('.grab') || e.type === 'pointerup') setSheet(ui.sheet === 'peek' ? 'half' : 'peek');
      return;
    }
    const dy = e.clientY - d.y0;
    const v = dy / Math.max(1, performance.now() - d.t0); // px per ms, + is down
    const y = clamp(d.cur + dy, 0, d.m.peekY);
    let state;
    if (v > 0.6) state = ui.sheet === 'full' && y < d.m.halfY ? 'half' : 'peek';
    else if (v < -0.6) state = ui.sheet === 'peek' && y > d.m.halfY ? 'half' : 'full';
    else {
      const opts = [['full', d.m.fullY], ['half', d.m.halfY], ['peek', d.m.peekY]];
      state = opts.sort((a, b) => Math.abs(a[1] - y) - Math.abs(b[1] - y))[0][0];
    }
    setSheet(state);
  };
  el.drag.addEventListener('pointerup', endDrag);
  el.drag.addEventListener('pointercancel', (e) => { if (drag) { drag = null; layoutSheet(); } });

  /* ---------- chips & explore ---------- */
  function renderChips() {
    const mine = CATEGORIES.filter((c) => trip.interests.includes(c.key));
    const rest = CATEGORIES.filter((c) => !trip.interests.includes(c.key));
    const chip = (c) => `<button class="chip ${ui.explore.has(c.key) ? 'on' : ''} ${ui.exploring && ui.explore.has(c.key) ? 'loading' : ''}" data-a="chip" data-cat="${c.key}" aria-pressed="${ui.explore.has(c.key)}" style="--c:${c.color}"><span>${c.emoji}</span>${esc(c.short)}</button>`;
    el.chips.innerHTML = mine.map(chip).join('')
      + (ui.moreCats ? rest.map(chip).join('') : '')
      + (rest.length ? `<button class="chip ghost" data-a="more-cats">${ui.moreCats ? 'Less' : '+ More'}</button>` : '');
    el.chips.hidden = ui.searchOpen;
    renderHint();
  }

  function renderHint() {
    const parts = [];
    if (ui.exploreMsg) parts.push(`<span>${esc(ui.exploreMsg)}</span>`);
    if (ui.explore.has('fun')) parts.push(`<a href="${eventsSearch(trip)}" target="_blank" rel="noopener">🎪 Carnivals & events aren't on the map — search events ${ICON.ext}</a>`);
    el.hint.innerHTML = parts.join('');
    el.hint.hidden = !parts.length || ui.searchOpen;
  }

  async function loadPois(force = false) {
    exploreCtrl?.abort();
    if (!ui.explore.size) {
      ui.pois = []; ui.exploreMsg = ''; ui.exploredBounds = null;
      map.setPois([], onPoiClick); renderChips();
      return;
    }
    if (map.zoom() < MIN_EXPLORE_ZOOM) {
      ui.exploreMsg = 'Zoom in to see places here';
      ui.pois = []; map.setPois([], onPoiClick); renderChips();
      return;
    }
    const b = map.bounds();
    if (!force && ui.exploredBounds && ui.exploredBounds.contains(b)) return;
    const padded = b.pad(0.25);
    exploreCtrl = new AbortController();
    ui.exploring = true; ui.exploreMsg = 'Finding places…'; renderChips();
    try {
      const pois = await explorePois([...ui.explore], padded, { signal: exploreCtrl.signal });
      if (destroyed) return;
      ui.pois = pois;
      ui.exploredBounds = padded;
      ui.exploreMsg = pois.length ? `${pois.length} places · tap one to add it` : 'Nothing found here — try moving the map';
      map.setPois(pois, onPoiClick);
    } catch (e) {
      if (e.name === 'AbortError') return;
      ui.exploreMsg = 'Place data is busy — try again in a moment';
    } finally {
      if (!destroyed) { ui.exploring = false; renderChips(); }
    }
  }
  const onMoveEnd = debounce(() => { if (ui.explore.size) loadPois(); }, 700);
  map.on('moveend', onMoveEnd);
  map.on('click', () => {
    if (ui.searchOpen) closeSearch();
    else if (ui.selected) select(null);
  });

  function onPoiClick(p) { select({ kind: 'poi', place: p }); }

  /* ---------- search ---------- */
  const runSearch = debounce(async () => {
    const q = ui.searchQ.trim();
    searchCtrl?.abort();
    if (q.length < 2) { ui.results = []; ui.searching = false; renderResults(); return; }
    searchCtrl = new AbortController();
    ui.searching = true; renderResults();
    try {
      ui.results = await searchPlaces(q, { near: map.center(), limit: 8, signal: searchCtrl.signal });
    } catch (e) {
      if (e.name === 'AbortError') return;
      ui.results = [];
      toast('Search is unavailable — check your connection');
    }
    ui.searching = false;
    renderResults();
  }, 300);

  function renderResults() {
    el.clear.hidden = !ui.searchQ;
    el.results.hidden = !ui.searchOpen || ui.searchQ.trim().length < 2;
    el.chips.hidden = ui.searchOpen;
    renderHint();
    if (el.results.hidden) return;
    if (ui.searching && !ui.results.length) { el.results.innerHTML = '<li class="muted">Searching…</li>'; return; }
    if (!ui.results.length) { el.results.innerHTML = '<li class="muted">No places found</li>'; return; }
    el.results.innerHTML = ui.results.map((r, i) => {
      const c = catOf(r.cat);
      return `<li><button class="result" data-a="pick-result" data-i="${i}">
        <span class="r-emoji">${c.emoji}</span>
        <span class="r-text"><span class="r-name">${esc(r.name)}</span><span class="r-sub">${esc([r.kind, r.address].filter(Boolean).join(' · '))}</span></span>
      </button></li>`;
    }).join('');
  }
  function closeSearch() {
    ui.searchOpen = false;
    el.search.blur();
    renderResults();
  }
  el.search.addEventListener('focus', () => { ui.searchOpen = true; renderResults(); });
  el.search.addEventListener('input', () => { ui.searchQ = el.search.value; ui.searchOpen = true; runSearch(); renderResults(); });
  el.search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && ui.results[0]) { e.preventDefault(); pickResult(0); }
    if (e.key === 'Escape') closeSearch();
  });
  function pickResult(i) {
    const r = ui.results[i];
    if (!r) return;
    el.search.value = r.name;
    ui.searchQ = r.name;
    closeSearch();
    select({ kind: 'search', place: r });
    map.flyTo(r.lat, r.lng, 16);
  }

  /* ---------- selection & place card ---------- */
  function select(sel) {
    ui.selected = sel;
    if (sel && sel.kind !== 'stop' && sel.kind !== 'idea') map.showTemp(sel.place);
    else map.showTemp(null);
    if (sel && ui.sheet !== 'peek') setSheet('peek');
    renderCard();
  }

  function cardLinks(p) {
    const links = [`<a class="pill-link" href="${gmPlace(p, placeCtx)}" target="_blank" rel="noopener">${ICON.map}Google Maps</a>`];
    if (p.website && /^https?:\/\//i.test(p.website)) links.push(`<a class="pill-link" href="${esc(p.website)}" target="_blank" rel="noopener">${ICON.ext}Website</a>`);
    if (p.phone) links.push(`<a class="pill-link" href="tel:${esc(p.phone.replace(/[^\d+]/g, ''))}">📞 Call</a>`);
    return `<div class="pc-links">${links.join('')}</div>`;
  }

  function renderCard() {
    const sel = ui.selected;
    if (!sel) { el.card.hidden = true; el.card.innerHTML = ''; return; }
    let p = sel.place, actions = '', sub = '', extra = '';
    if (sel.kind === 'stop') {
      const f = store.findStop(trip, sel.stopId);
      if (!f) { select(null); return; }
      p = f.stop;
      const di = trip.days.indexOf(f.day);
      const r = computeSchedule(f.day).rows[f.index];
      const prev = f.day.stops[f.index - 1];
      const mode = legModeFor(trip, p);
      sub = `${dayLabel(di)} · stop ${f.index + 1} · ${minToHMPlain(r.arrive)}–${minToHMPlain(r.depart)}`;
      actions = `
        <a class="btn primary" href="${gmDirections(isActive(f.day) ? null : prev, p, mode)}" target="_blank" rel="noopener">${ICON.nav}Directions</a>
        <button class="btn ${p.visited ? 'ghost' : 'soft'}" data-a="toggle-visited" data-id="${p.id}">${ICON.check}${p.visited ? 'Not visited' : 'Visited'}</button>
        <button class="btn ghost" data-a="stop-menu" data-id="${p.id}" aria-label="More options">${ICON.more}</button>`;
    } else {
      const inPlan = findInPlan(p);
      const idea = sel.kind === 'idea' ? p : findIdea(p);
      sub = [p.kind, p.cuisine].filter(Boolean).join(' · ');
      const di = addIdx();
      if (inPlan) {
        actions = `<button class="btn soft" data-a="show-stop" data-id="${inPlan.stop.id}">${ICON.check}In ${dayLabel(inPlan.di)} — show</button>`;
      } else {
        actions = `<button class="btn primary" data-a="add-to-day" data-day="${di}">${ICON.plus}Add to ${dayLabel(di)}</button>
          ${trip.days.length > 1 ? `<button class="btn ghost" data-a="add-pick-day" aria-label="Choose a day">${ICON.calendar}Day…</button>` : ''}
          ${idea ? `<button class="btn ghost" data-a="remove-idea" data-id="${idea.id}">${ICON.trash}Unsave</button>`
            : `<button class="btn ghost" data-a="save-idea">${ICON.star}Save</button>`}`;
      }
    }
    loadDetails(p, sel);
    const c = catOf(p.cat);
    if (p.hours) extra += `<div class="pc-row">${ICON.clock}<span>${esc(p.hours)}</span></div>`;
    if (p.notes) extra += `<div class="pc-row">📝<span>${esc(p.notes)}</span></div>`;
    el.card.innerHTML = `
      <button class="pc-close icon-btn" data-a="close-card" aria-label="Close">${ICON.x}</button>
      <div class="pc-head">
        <span class="pc-emoji" style="--c:${c.color}">${c.emoji}</span>
        <div class="pc-title"><b>${esc(p.name)}</b><small>${esc([sub || c.label, p.address].filter(Boolean).join(' · '))}</small></div>
      </div>
      ${extra}
      ${cardLinks(p)}
      <div class="pc-actions">${actions}</div>`;
    el.card.hidden = false;
  }

  // Opening hours / website / phone arrive lazily (Nominatim) the first time a place's card opens.
  const detailsTried = new WeakSet();
  function loadDetails(p, sel) {
    if (!p?.osm || detailsTried.has(p) || (p.hours && p.website)) return;
    detailsTried.add(p);
    placeDetails(p.osm).then((d) => {
      if (!d || destroyed) return;
      let changed = false;
      for (const k of ['hours', 'website', 'phone', 'cuisine', 'address']) {
        if (d[k] && !p[k]) { p[k] = d[k]; changed = true; }
      }
      if (!changed) return;
      if (sel.kind === 'stop') save();
      if (ui.selected === sel) renderCard();
    });
  }

  /* ---------- planning actions ---------- */
  function addToDay(place, di) {
    const day = trip.days[di];
    const stop = store.makeStop(place);
    if (place.notes) stop.notes = place.notes;
    day.stops.push(stop);
    trip.ideas = trip.ideas.filter((x) => !((place.osm && x.osm === place.osm) || x.id === place.id));
    save();
    ui.tab = `d${di}`; ui.lastDay = di;
    const r = computeSchedule(day).rows[day.stops.length - 1];
    toast(`Added to ${dayLabel(di)} · around ${minToHMPlain(r.arrive)}`);
    select({ kind: 'stop', stopId: stop.id });
    renderAll();
    ensureLegs();
  }

  function saveIdea(place) {
    if (findIdea(place)) return;
    trip.ideas.push(store.toIdea({ ...place, id: undefined }));
    save();
    toast('Saved to Ideas ★');
    renderAll();
  }

  function moveStop(stopId, delta) {
    const f = store.findStop(trip, stopId);
    if (!f) return;
    const j = f.index + delta;
    if (j < 0 || j >= f.day.stops.length) return;
    const [s] = f.day.stops.splice(f.index, 1);
    f.day.stops.splice(j, 0, s);
    save(); renderAll(); ensureLegs();
  }

  function removeStop(stopId, toIdeas = false) {
    const f = store.findStop(trip, stopId);
    if (!f) return;
    f.day.stops.splice(f.index, 1);
    if (toIdeas) trip.ideas.push(store.toIdea(f.stop));
    if (ui.selected?.stopId === stopId) ui.selected = null;
    save(); renderAll(); ensureLegs();
    toast(toIdeas ? 'Moved to Ideas' : 'Stop removed');
  }

  function setVisited(stopId, visited) {
    const f = store.findStop(trip, stopId);
    if (!f) return;
    f.stop.visited = visited;
    f.stop.visitedAt = visited ? Date.now() : null;
    save(); renderAll();
  }

  async function editStop(stopId) {
    const f = store.findStop(trip, stopId);
    if (!f) return;
    const s = f.stop;
    const durs = [...new Set([...DURATION_CHOICES, Number(s.duration) || 60])].sort((a, b) => a - b);
    const v = await formDialog(`Edit ${s.name}`, `
      <label class="field"><span class="field-label">How long will you stay?</span>
        <select name="duration">${durs.map((m) => `<option value="${m}" ${m === Number(s.duration) ? 'selected' : ''}>${fmtMinutes(m)}</option>`).join('')}</select></label>
      <label class="field"><span class="field-label">Arrive at a fixed time <em>(optional — e.g. a booking)</em></span>
        <input type="time" name="fixedTime" value="${esc(s.fixedTime || '')}" /></label>
      <label class="field"><span class="field-label">Notes</span>
        <textarea name="notes" rows="3" maxlength="500" placeholder="Tickets, booking number, what to order…">${esc(s.notes || '')}</textarea></label>`);
    if (!v) return;
    s.duration = Number(v.duration) || 60;
    s.fixedTime = v.fixedTime || null;
    s.notes = (v.notes || '').trim();
    save(); renderAll();
  }

  async function pickLegMode(stopId) {
    const f = store.findStop(trip, stopId);
    if (!f || f.index === 0) return;
    const cur = legModeFor(trip, f.stop);
    const v = await actionSheet(`Getting to ${f.stop.name}`, Object.entries(LEG_MODES).map(([k, m]) => ({
      label: `${m.emoji}  ${m.label}${k === cur ? '  ✓' : ''}`, value: k,
    })));
    if (!v) return;
    f.stop.legMode = v;
    save(); renderAll(); ensureLegs();
  }

  async function pickDay(title) {
    const v = await actionSheet(title, trip.days.map((d, i) => ({
      label: `${dayLabel(i)} · ${fmtDate(d.date)}`, value: String(i), hint: `${d.stops.length} stops`,
    })));
    return v == null ? null : Number(v);
  }

  async function stopMenu(stopId) {
    const f = store.findStop(trip, stopId);
    if (!f) return;
    const s = f.stop;
    const items = [];
    if (f.index > 0) items.push({ label: 'Move earlier', value: 'up', icon: ICON.up });
    if (f.index < f.day.stops.length - 1) items.push({ label: 'Move later', value: 'down', icon: ICON.down });
    if (trip.days.length > 1) items.push({ label: 'Move to another day…', value: 'day', icon: ICON.calendar });
    items.push({ label: 'Edit stay, time & notes', value: 'edit', icon: ICON.edit });
    if (f.index > 0) items.push({ label: 'How to get here…', value: 'mode', icon: ICON.nav, hint: `${LEG_MODES[legModeFor(trip, s)].label} now` });
    items.push({ label: s.visited ? 'Mark as not visited' : 'Mark as visited', value: 'visited', icon: ICON.check });
    items.push({ label: 'Open in Google Maps', value: 'gm', icon: ICON.map, hint: 'Reviews, photos, opening hours' });
    items.push({ label: 'Move to Ideas', value: 'idea', icon: ICON.star });
    items.push({ label: 'Remove stop', value: 'remove', icon: ICON.trash, danger: true });
    const v = await actionSheet(s.name, items);
    switch (v) {
      case 'up': moveStop(stopId, -1); break;
      case 'down': moveStop(stopId, 1); break;
      case 'edit': editStop(stopId); break;
      case 'mode': pickLegMode(stopId); break;
      case 'visited': setVisited(stopId, !s.visited); break;
      case 'gm': window.open(gmPlace(s, placeCtx), '_blank', 'noopener'); break;
      case 'idea': removeStop(stopId, true); break;
      case 'remove': removeStop(stopId); break;
      case 'day': {
        const di = await pickDay(`Move ${s.name} to…`);
        if (di == null || trip.days[di] === f.day) return;
        f.day.stops.splice(f.index, 1);
        s.leg = null; s.visited = false; s.visitedAt = null;
        trip.days[di].stops.push(s);
        ui.tab = `d${di}`;
        save(); renderAll(); ensureLegs();
        toast(`Moved to ${dayLabel(di)}`);
        break;
      }
      default:
    }
  }

  async function ideaMenu(id) {
    const idea = trip.ideas.find((x) => x.id === id);
    if (!idea) return;
    const items = [];
    for (let i = 0; i < Math.min(trip.days.length, 8); i++) items.push({ label: `Add to ${dayLabel(i)}`, value: `d${i}`, icon: ICON.plus, hint: fmtDate(trip.days[i].date) });
    items.push({ label: 'Open in Google Maps', value: 'gm', icon: ICON.map });
    items.push({ label: 'Remove idea', value: 'remove', icon: ICON.trash, danger: true });
    const v = await actionSheet(idea.name, items);
    if (!v) return;
    if (v.startsWith('d')) addToDay(idea, Number(v.slice(1)));
    else if (v === 'gm') window.open(gmPlace(idea, placeCtx), '_blank', 'noopener');
    else if (v === 'remove') { trip.ideas = trip.ideas.filter((x) => x.id !== id); save(); renderAll(); }
  }

  /* ---------- step-by-step trip mode ---------- */
  function startDay(di) {
    const day = trip.days[di];
    if (!day.stops.length) { toast('Add a stop first'); return; }
    trip.days.forEach((d) => { if (d !== day && isActive(d)) d.finishedAt = Date.now(); });
    day.startedAt = Date.now();
    day.finishedAt = null;
    ui.tab = `d${di}`;
    save();
    startRecording(day);
    setSheet('peek');
    renderAll();
    const n = nextStop(day);
    if (n) map.flyTo(n.lat, n.lng, 15);
  }

  function arrived(day) {
    const n = nextStop(day);
    if (!n) return;
    n.visited = true;
    n.visitedAt = Date.now();
    save();
    const after = nextStop(day);
    toast(after ? `✓ ${n.name} — next: ${after.name}` : '🎉 That was the last stop of the day');
    renderAll();
    if (after) map.fit([n, after]);
  }

  function endDay(day) {
    day.finishedAt = Date.now();
    if (ui.recording && ui.recordDayId === day.id) stopRecording();
    save(); renderAll();
    toast('Day finished');
  }

  async function resetDay(day) {
    const v = await actionSheet('Reset progress for this day?', [
      { label: 'Reset visited stops', value: 'stops', hint: 'Keeps the recorded GPS path' },
      { label: 'Reset stops and delete recorded path', value: 'all', danger: true },
    ]);
    if (!v) return;
    day.stops.forEach((s) => { s.visited = false; s.visitedAt = null; });
    day.startedAt = null; day.finishedAt = null;
    if (v === 'all') day.trail = [];
    if (ui.recording && ui.recordDayId === day.id) stopRecording();
    save(); renderAll();
  }

  /* ---------- location & recording ---------- */
  function onFix(fix, err) {
    if (destroyed) return;
    if (!fix) {
      if (err && err.code !== 3) toast(tracker.locationErrorText(err));
      if (err?.code === 1 && ui.recording) stopRecording();
      return;
    }
    ui.fix = fix;
    map.setMe(fix);
    if (ui.centerOnFix) { ui.centerOnFix = false; map.flyTo(fix.lat, fix.lng, Math.max(map.zoom(), 16)); }
    if (ui.recording && fix.acc <= 60) {
      const day = trip.days.find((d) => d.id === ui.recordDayId);
      if (!day) return;
      day.trail = day.trail || [];
      const last = day.trail[day.trail.length - 1];
      if (!last || haversineM({ lat: last[0], lng: last[1] }, fix) >= 12) {
        day.trail.push([Math.round(fix.lat * 1e5) / 1e5, Math.round(fix.lng * 1e5) / 1e5, Math.round(fix.t / 1000)]);
        save();
        drawTrail();
      }
    }
  }
  function ensureWatching() { if (!unwatch) unwatch = tracker.watch(onFix); }

  function startRecording(day) {
    if (!('geolocation' in navigator)) { toast('This browser has no GPS access'); return; }
    ui.recording = true;
    ui.recordDayId = day.id;
    trip.days.forEach((d) => { d.recording = d === day; });
    save();
    day.trail = day.trail || [];
    if (day.trail.length && day.trail[day.trail.length - 1] !== null) day.trail.push(null);
    ensureWatching();
    tracker.keepAwake(true);
    renderFabs();
    toast('Recording your path — keep Triply open on screen');
  }
  function stopRecording() {
    ui.recording = false;
    trip.days.forEach((d) => { d.recording = false; });
    save();
    tracker.keepAwake(false);
    renderFabs();
  }

  function trailLines(days) {
    const lines = [];
    for (const d of days) {
      let cur = [];
      for (const p of d.trail || []) {
        if (p === null) { if (cur.length) lines.push(cur); cur = []; } else cur.push(p);
      }
      if (cur.length) lines.push(cur);
    }
    return lines;
  }
  const trailKm = (day) => trailLines([day]).reduce((s, l) => s + pathLengthM(l), 0);

  /* ---------- routing between stops ---------- */
  let legBusy = false, legAgain = false;
  async function ensureLegs() {
    if (legBusy) { legAgain = true; return; }
    legBusy = true;
    try {
      do {
        legAgain = false;
        for (const day of trip.days) {
          if (day.stops[0]) day.stops[0].leg = null;
          for (let i = 1; i < day.stops.length; i++) {
            if (destroyed) return;
            const prev = day.stops[i - 1], s = day.stops[i];
            const mode = legModeFor(trip, s);
            const key = legKey(prev, s, mode);
            const stale = s.leg?.error && Date.now() - (s.leg.at || 0) > 60000;
            if (s.leg?.key === key && !stale) continue;
            const sch = computeSchedule(day);
            let leg;
            try {
              leg = await routeLeg(prev, s, mode, { dateISO: day.date, departMin: sch.rows[i - 1].depart, signal: legCtrl.signal });
            } catch (e) { if (e.name === 'AbortError') return; throw e; }
            if (destroyed) return;
            const idx = day.stops.indexOf(s);
            if (idx > 0 && legKey(day.stops[idx - 1], s, legModeFor(trip, s)) === leg.key) { s.leg = leg; save(); }
            else legAgain = true;
            softRender();
          }
        }
      } while (legAgain && !destroyed);
    } finally { legBusy = false; }
  }
  let softQueued = false;
  function softRender() {
    if (softQueued) return;
    softQueued = true;
    requestAnimationFrame(() => { softQueued = false; if (!destroyed) { renderSheet(); renderMap(); if (ui.selected) renderCard(); } });
  }

  /* ---------- sheet content ---------- */
  function legSummary(prev, s, short = false) {
    const mode = legModeFor(trip, s);
    const leg = s.leg && s.leg.key === legKey(prev, s, mode) ? s.leg : null;
    if (!leg) return { mode, leg: null, html: '<span class="muted">Finding route…</span>' };
    const bits = [`<b>${fmtDuration(leg.duration)}</b>`];
    if (leg.distance) bits.push(fmtDistance(leg.distance));
    let lines = '';
    if (leg.segments) {
      const rides = leg.segments.filter((sg) => sg.mode !== 'WALK');
      lines = rides.map((sg) => `<span class="line" style="${sg.color ? `background:${sg.color};color:${sg.textColor || '#fff'}` : ''}">${transitEmoji(sg.mode)} ${esc(sg.line || sg.mode.toLowerCase())}</span>`).join('<span class="arrow">›</span>');
      if (!short && rides[0]?.depart) bits.push(`dep ${fmtClockISO(rides[0].depart)} from ${esc(rides[0].from)}`);
    }
    if (mode === 'transit' && leg.autoWalk) bits.push('walking is quicker');
    if (leg.estimate) bits.push('<span class="warn">rough estimate</span>');
    return { mode, leg, html: `${bits.join(' · ')}${lines ? `<span class="lines">${lines}</span>` : ''}` };
  }

  function headHtml() {
    const di = dayIdx();
    if (di != null) {
      const day = trip.days[di];
      const sch = computeSchedule(day);
      const color = dayColor(di);
      if (isActive(day)) {
        const n = nextStop(day);
        const done = day.stops.filter((s) => s.visited).length;
        if (!n) {
          return `<div class="head-row"><div class="head-text"><span class="eyebrow live">● ${dayLabel(di)} in progress</span>
            <b>Day complete 🎉</b><small>${done} stops visited${trailKm(day) > 50 ? ` · ${fmtDistance(trailKm(day))} recorded` : ''}</small></div>
            <button class="btn primary" data-a="end-day">Finish day</button></div>`;
        }
        const i = day.stops.indexOf(n);
        const prev = day.stops[i - 1];
        const ls = prev ? legSummary(prev, n, true) : null;
        const c = catOf(n.cat);
        return `<div class="head-live">
          <div class="head-text"><span class="eyebrow live">● Next stop · ${i + 1} of ${day.stops.length}</span>
            <b>${c.emoji} ${esc(n.name)}</b>
            <small>${ls ? `${LEG_MODES[ls.leg?.mode || ls.mode]?.emoji || ''} ${ls.html} · ` : ''}planned ${minToHMPlain(sch.rows[i].arrive)}</small></div>
          <div class="head-actions">
            <a class="btn soft" href="${gmDirections(null, n, ls ? ls.mode : legModeFor(trip, n))}" target="_blank" rel="noopener">${ICON.nav}Navigate</a>
            <button class="btn primary" data-a="arrived">${ICON.check}I'm here</button>
          </div></div>`;
      }
      const sum = day.stops.length
        ? `${day.stops.length} ${day.stops.length === 1 ? 'stop' : 'stops'} · ${minToHMPlain(sch.start)}–${minToHMPlain(sch.end)}${sch.travelTotal ? ` · ${fmtMinutes(sch.travelTotal)} travel` : ''}`
        : 'No stops yet — tap places on the map to add them';
      const visitedAll = day.stops.length && day.stops.every((s) => s.visited);
      return `<div class="head-row">
        <span class="day-dot" style="--c:${color}">${di + 1}</span>
        <div class="head-text"><b>${dayLabel(di)}${day.date ? ` · ${esc(fmtDate(day.date))}` : ''}</b><small>${sum}</small></div>
        ${day.stops.length && !visitedAll ? `<button class="btn primary sm" data-a="start-day">${ICON.play}${day.startedAt ? 'Resume' : 'Start'}</button>` : ''}
      </div>`;
    }
    if (ui.tab === 'ideas') {
      return `<div class="head-row"><span class="day-dot idea">★</span><div class="head-text"><b>Ideas</b><small>${trip.ideas.length} saved ${trip.ideas.length === 1 ? 'place' : 'places'} to maybe visit</small></div></div>`;
    }
    const stops = trip.days.reduce((n, d) => n + d.stops.length, 0);
    return `<div class="head-row"><span class="day-dot all">${ICON.list}</span><div class="head-text"><b>Whole trip</b><small>${trip.days.length} ${trip.days.length === 1 ? 'day' : 'days'} · ${stops} stops · ${esc(TRANSPORT[trip.transport]?.label || '')}</small></div></div>`;
  }

  function tabsHtml() {
    const days = trip.days.map((d, i) => {
      const on = ui.tab === `d${i}`;
      return `<button role="tab" aria-selected="${on}" class="tab ${on ? 'on' : ''}" data-a="tab" data-tab="d${i}" style="--c:${dayColor(i)}">
        ${isActive(d) ? '<span class="live-dot"></span>' : ''}${dayLabel(i)}<small>${esc(fmtDate(d.date, { weekday: 'short', day: 'numeric' }))}</small></button>`;
    }).join('');
    return `${days}
      <button role="tab" aria-selected="${ui.tab === 'ideas'}" class="tab ${ui.tab === 'ideas' ? 'on' : ''}" data-a="tab" data-tab="ideas">★ Ideas<small>${trip.ideas.length}</small></button>
      ${trip.days.length > 1 ? `<button role="tab" aria-selected="${ui.tab === 'overview'}" class="tab ${ui.tab === 'overview' ? 'on' : ''}" data-a="tab" data-tab="overview">All days<small>overview</small></button>` : ''}`;
  }

  function dayBody(day, di) {
    const sch = computeSchedule(day);
    const color = dayColor(di);
    const active = isActive(day);
    const cur = active ? nextStop(day) : null;
    const gm = gmDay(day.stops, legModeFor(trip, day.stops[1] || {}));
    const toolbar = `<div class="day-tools">
      <label class="start-time">${ICON.clock}<span>Start</span><input type="time" value="${esc(day.startTime)}" data-start-time="${di}" aria-label="Day start time" /></label>
      ${gm ? `<a class="pill-link" href="${gm}" target="_blank" rel="noopener" aria-label="Open this day in Google Maps">${ICON.map}Google Maps</a>` : ''}
      <button class="icon-btn" data-a="day-menu" aria-label="Day options">${ICON.more}</button>
    </div>`;
    if (!day.stops.length) {
      return `${toolbar}<div class="empty small">
        <p><b>Plan ${dayLabel(di)}</b></p>
        <p>Search above, or tap a category chip (${trip.interests.slice(0, 3).map((k) => catOf(k).emoji).join(' ')}) to see places on the map. Tap one, then <b>Add to ${dayLabel(di)}</b>.</p>
        ${trip.ideas.length ? `<button class="btn soft" data-a="tab" data-tab="ideas">${ICON.star}Pick from your ${trip.ideas.length} ideas</button>` : ''}
      </div>`;
    }
    const rows = day.stops.map((s, i) => {
      const r = sch.rows[i];
      let leg = '';
      if (i > 0) {
        const prev = day.stops[i - 1];
        const ls = legSummary(prev, s);
        const taken = s.visited && prev.visited;
        leg = `<li class="tl-leg ${taken ? 'taken' : ''}" style="--c:${color}">
          <button class="leg-mode" data-a="leg-mode" data-id="${s.id}" aria-label="Change how you get to ${esc(s.name)}">${LEG_MODES[ls.mode].emoji}</button>
          <div class="leg-info">${ls.html}${r.wait > 4 ? ` <span class="free">· ${fmtMinutes(r.wait)} free</span>` : ''}</div>
          <a class="leg-go" href="${gmDirections(active ? null : prev, s, ls.mode)}" target="_blank" rel="noopener" aria-label="Directions in Google Maps">${ICON.nav}</a>
        </li>`;
      }
      const c = catOf(s.cat);
      const state = s.visited ? 'visited' : cur && s.id === cur.id ? 'current' : '';
      const sel = ui.selected?.stopId === s.id ? 'selected' : '';
      return `${leg}<li class="tl-stop ${state} ${sel}" style="--c:${color}">
        <div class="tl-time"><b>${minToHM(r.arrive)}</b><span>${minToHM(r.depart)}</span></div>
        <div class="tl-rail"><span class="tl-dot">${s.visited ? ICON.check : i + 1}</span></div>
        <button class="tl-main" data-a="focus-stop" data-id="${s.id}">
          <span class="tl-name">${c.emoji} ${esc(s.name)}</span>
          <span class="tl-meta">${fmtMinutes(Number(s.duration) || 60)}${s.fixedTime ? ` · ⏰ ${esc(s.fixedTime)}` : ''}${r.late ? ' · <b class="warn">running late</b>' : ''}${s.visitedAt ? ` · visited ${fmtClockISO(new Date(s.visitedAt).toISOString())}` : ''}</span>
          ${s.notes ? `<span class="tl-notes">${esc(s.notes)}</span>` : ''}
        </button>
        <button class="icon-btn" data-a="stop-menu" data-id="${s.id}" aria-label="Options for ${esc(s.name)}">${ICON.more}</button>
      </li>`;
    }).join('');
    const km = sch.distTotal ? ` · ${fmtDistance(sch.distTotal)}` : '';
    const rec = trailKm(day);
    return `${toolbar}<ol class="timeline">${rows}</ol>
      <p class="tl-foot">Ends around ${minToHMPlain(sch.end)} · ${fmtMinutes(sch.travelTotal || 0)} travel${km}${rec > 50 ? ` · <span style="color:var(--trail)">${fmtDistance(rec)} recorded</span>` : ''}</p>`;
  }

  function ideasBody() {
    if (!trip.ideas.length) {
      return `<div class="empty small"><p><b>Your “maybe” list</b></p><p>Tap <b>★ Save</b> on any place to collect it here. Ideas show on the map as small stars, so you can see what's close together before planning a day.</p></div>`;
    }
    const di = addIdx();
    return `<ul class="idea-list">${trip.ideas.map((p) => {
      const c = catOf(p.cat);
      return `<li class="idea">
        <button class="idea-main" data-a="focus-idea" data-id="${p.id}"><span class="idea-emoji" style="--c:${c.color}">${c.emoji}</span>
          <span class="r-text"><span class="r-name">${esc(p.name)}</span><span class="r-sub">${esc(p.address || c.label)}</span></span></button>
        <button class="btn soft sm" data-a="idea-add" data-id="${p.id}" data-day="${di}">${ICON.plus}${dayLabel(di)}</button>
        <button class="icon-btn" data-a="idea-menu" data-id="${p.id}" aria-label="Options for ${esc(p.name)}">${ICON.more}</button>
      </li>`;
    }).join('')}</ul>`;
  }

  function overviewBody() {
    return `<ul class="ov-days">${trip.days.map((d, i) => {
      const sch = computeSchedule(d);
      const done = d.stops.filter((s) => s.visited).length;
      return `<li><button class="ov-day" data-a="tab" data-tab="d${i}" style="--c:${dayColor(i)}">
        <span class="day-dot">${i + 1}</span>
        <span class="ov-text">
          <b>${esc(fmtDate(d.date, { weekday: 'long', day: 'numeric', month: 'long' }))}</b>
          <small>${d.stops.length ? `${d.stops.length} stops · ${minToHMPlain(sch.start)}–${minToHMPlain(sch.end)}${done ? ` · ${done} visited` : ''}` : 'Nothing planned yet'}</small>
          ${d.stops.length ? `<span class="ov-stops">${d.stops.map((s) => `${catOf(s.cat).emoji} ${esc(s.name)}`).join(' <i>→</i> ')}</span>` : ''}
        </span></button></li>`;
    }).join('')}</ul>
    <button class="btn ghost block" data-a="ics">${ICON.calendar}Add whole trip to my calendar (.ics)</button>`;
  }

  function renderSheet() {
    el.head.innerHTML = headHtml();
    el.tabs.innerHTML = tabsHtml();
    const scroll = el.body.scrollTop;
    const di = dayIdx();
    el.body.innerHTML = di != null ? dayBody(trip.days[di], di) : ui.tab === 'ideas' ? ideasBody() : overviewBody();
    el.body.scrollTop = scroll;
    layoutSheet(false);
    requestAnimationFrame(() => { el.sheet.style.transition = ''; });
  }

  function renderFabs() {
    el.fabs.innerHTML = `
      <button class="round-btn ${unwatch ? 'on' : ''}" data-a="locate" aria-label="Show my location">${ICON.locate}</button>
      <button class="round-btn rec ${ui.recording ? 'on' : ''}" data-a="record" aria-pressed="${ui.recording}" aria-label="${ui.recording ? 'Stop recording path' : 'Record my path'}">${ICON.rec}<span>${ui.recording ? 'REC' : 'Trail'}</span></button>`;
  }

  function drawTrail() {
    const di = dayIdx();
    map.setTrail(trailLines(di != null ? [trip.days[di]] : ui.tab === 'overview' ? trip.days : []));
  }

  function renderMap() {
    const di = dayIdx();
    let views = [];
    if (di != null) views = [{ day: trip.days[di], color: dayColor(di), dim: false }];
    else if (ui.tab === 'overview') views = trip.days.map((d, i) => ({ day: d, color: dayColor(i), dim: false }));
    const cur = di != null && isActive(trip.days[di]) ? nextStop(trip.days[di])?.id : null;
    map.setPlan(views, (s) => select({ kind: 'stop', stopId: s.id }), cur);
    map.setIdeas(trip.ideas, (p) => select({ kind: 'idea', place: p }));
    drawTrail();
  }

  function renderAll() {
    renderChips();
    renderSheet();
    renderFabs();
    renderMap();
    renderCard();
  }

  function fitCurrent(animate = true) {
    const di = dayIdx();
    if (di != null && trip.days[di].stops.length) map.fit(trip.days[di].stops, 16, animate);
    else if (ui.tab === 'overview') map.fit(trip.days.flatMap((d) => d.stops), 16, animate);
    else if (ui.tab === 'ideas' && trip.ideas.length) map.fit(trip.ideas, 16, animate);
  }

  /* ---------- trip menu & edit ---------- */
  async function tripMenu() {
    const di = addIdx();
    const day = trip.days[di];
    const v = await actionSheet(trip.name, [
      { label: 'Edit trip', value: 'edit', icon: ICON.edit, hint: 'Name, dates, transport, interests' },
      { label: `Open ${dayLabel(di)} in Google Maps`, value: 'gm', icon: ICON.map },
      { label: 'Add trip to calendar (.ics)', value: 'ics', icon: ICON.calendar },
      { label: 'Delete trip', value: 'delete', icon: ICON.trash, danger: true },
    ]);
    if (v === 'edit') editTrip();
    else if (v === 'gm') {
      const url = gmDay(day.stops, legModeFor(trip, day.stops[1] || {}));
      if (url) window.open(url, '_blank', 'noopener'); else toast('No stops on this day yet');
    } else if (v === 'ics') exportIcs();
    else if (v === 'delete') {
      if (await confirmDialog('Delete this trip?', `“${trip.name}” and all its stops will be removed from this phone.`, { ok: 'Delete trip', danger: true })) {
        store.deleteTrip(trip.id);
        location.hash = '#/';
      }
    }
  }

  function exportIcs() {
    if (!trip.days.some((d) => d.stops.length)) { toast('Add some stops first'); return; }
    downloadText(`${trip.name.replace(/[^\w\- ]+/g, '').trim() || 'trip'}.ics`, tripToICS(trip), 'text/calendar');
    toast('Calendar file downloaded — open it to add the events');
  }

  async function editTrip() {
    const start = trip.days[0].date, end = trip.days[trip.days.length - 1].date;
    const v = await formDialog('Edit trip', `
      <label class="field"><span class="field-label">Name</span><input type="text" name="name" maxlength="60" value="${esc(trip.name)}" required /></label>
      <div class="row2">
        <label class="field"><span class="field-label">First day</span><input type="date" name="start" value="${start}" required /></label>
        <label class="field"><span class="field-label">Last day</span><input type="date" name="end" value="${end}" required /></label>
      </div>
      <label class="field"><span class="field-label">Getting around</span>
        <select name="transport">${Object.entries(TRANSPORT).map(([k, t]) => `<option value="${k}" ${k === trip.transport ? 'selected' : ''}>${t.emoji} ${t.label}</option>`).join('')}</select></label>
      <fieldset class="field"><legend class="field-label">Interests (map chips)</legend>
        <div class="check-grid">${CATEGORIES.map((c) => `<label class="check"><input type="checkbox" name="interests" value="${c.key}" ${trip.interests.includes(c.key) ? 'checked' : ''} /> ${c.emoji} ${esc(c.label)}</label>`).join('')}</div>
      </fieldset>`);
    if (!v) return;
    trip.name = (v.name || '').trim() || trip.name;
    const ints = [].concat(v.interests || []);
    if (ints.length) trip.interests = ints;
    if (v.transport && v.transport !== trip.transport) trip.transport = v.transport;
    if (v.start && (v.start !== start || v.end !== end)) {
      const before = trip.ideas.length;
      store.setTripDates(trip, v.start, v.end < v.start ? v.start : v.end);
      if (trip.ideas.length > before) toast('Stops from removed days were moved to Ideas');
    }
    if (dayIdx() == null && ui.tab.startsWith('d')) ui.tab = 'd0';
    if (ui.tab.startsWith('d') && Number(ui.tab.slice(1)) >= trip.days.length) ui.tab = 'd0';
    save(); renderAll(); ensureLegs();
  }

  async function dayMenu() {
    const di = dayIdx();
    if (di == null) return;
    const day = trip.days[di];
    const items = [];
    if (day.stops.length) items.push({ label: 'Recalculate routes', value: 'refresh', icon: ICON.refresh, hint: 'Fresh timetables and travel times' });
    if (day.startedAt || day.stops.some((s) => s.visited) || (day.trail || []).length) items.push({ label: 'Reset progress…', value: 'reset', icon: ICON.refresh });
    if (isActive(day)) items.push({ label: 'Finish day', value: 'end', icon: ICON.stop });
    if (day.stops.length) items.push({ label: 'Move all stops to Ideas', value: 'clear', icon: ICON.star });
    if (!items.length) { toast('Nothing to change yet'); return; }
    const v = await actionSheet(`${dayLabel(di)} · ${fmtDate(day.date)}`, items);
    if (v === 'refresh') { day.stops.forEach((s) => { s.leg = null; }); save(); renderAll(); ensureLegs(); }
    else if (v === 'reset') resetDay(day);
    else if (v === 'end') endDay(day);
    else if (v === 'clear') {
      day.stops.forEach((s) => trip.ideas.push(store.toIdea(s)));
      day.stops = [];
      save(); renderAll();
    }
  }

  /* ---------- events ---------- */
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  async function onClick(e) {
    const t = e.target.closest('[data-a]');
    if (!t) return;
    const a = t.dataset.a, id = t.dataset.id;
    switch (a) {
      case 'toggle-sheet': // pointer taps are handled by the drag code; this is the keyboard path
        if (e.detail === 0) setSheet(ui.sheet === 'peek' ? 'half' : 'peek');
        break;
      case 'trip-menu': tripMenu(); break;
      case 'clear-search':
        el.search.value = ''; ui.searchQ = ''; ui.results = [];
        if (ui.selected?.kind === 'search') select(null);
        el.search.focus(); renderResults();
        break;
      case 'pick-result': pickResult(Number(t.dataset.i)); break;
      case 'chip': {
        const k = t.dataset.cat;
        if (ui.explore.has(k)) ui.explore.delete(k); else ui.explore.add(k);
        renderChips();
        loadPois(true);
        break;
      }
      case 'more-cats': ui.moreCats = !ui.moreCats; renderChips(); break;
      case 'close-card': select(null); break;
      case 'add-to-day': if (ui.selected?.place) addToDay(ui.selected.place, Number(t.dataset.day)); break;
      case 'add-pick-day': {
        const p = ui.selected?.place;
        const di = await pickDay(`Add ${p?.name || 'place'} to…`);
        if (p && di != null) addToDay(p, di);
        break;
      }
      case 'save-idea': if (ui.selected?.place) { saveIdea(ui.selected.place); renderCard(); } break;
      case 'remove-idea':
        trip.ideas = trip.ideas.filter((x) => x.id !== id);
        save();
        if (ui.selected?.kind === 'idea') select(null); else renderCard();
        renderAll();
        break;
      case 'show-stop': {
        const f = store.findStop(trip, id);
        if (f) { ui.tab = `d${trip.days.indexOf(f.day)}`; select({ kind: 'stop', stopId: id }); renderAll(); map.flyTo(f.stop.lat, f.stop.lng, 16); }
        break;
      }
      case 'toggle-visited': {
        const f = store.findStop(trip, id);
        if (f) setVisited(id, !f.stop.visited);
        break;
      }
      case 'stop-menu': stopMenu(id); break;
      case 'leg-mode': pickLegMode(id); break;
      case 'focus-stop': {
        const f = store.findStop(trip, id);
        if (!f) return;
        select({ kind: 'stop', stopId: id });
        renderSheet();
        map.flyTo(f.stop.lat, f.stop.lng, Math.max(map.zoom(), 15));
        break;
      }
      case 'focus-idea': {
        const p = trip.ideas.find((x) => x.id === id);
        if (p) { select({ kind: 'idea', place: p }); map.flyTo(p.lat, p.lng, Math.max(map.zoom(), 15)); }
        break;
      }
      case 'idea-add': {
        const p = trip.ideas.find((x) => x.id === id);
        if (p) addToDay(p, Number(t.dataset.day));
        break;
      }
      case 'idea-menu': ideaMenu(id); break;
      case 'tab':
        ui.tab = t.dataset.tab;
        if (dayIdx() != null) ui.lastDay = dayIdx();
        if (ui.selected?.kind === 'stop') ui.selected = null;
        renderAll();
        fitCurrent();
        break;
      case 'start-day': startDay(dayIdx()); break;
      case 'arrived': arrived(curDay()); break;
      case 'end-day': endDay(curDay()); break;
      case 'day-menu': dayMenu(); break;
      case 'ics': exportIcs(); break;
      case 'locate':
        ui.centerOnFix = true;
        ensureWatching();
        renderFabs();
        if (ui.fix) { ui.centerOnFix = false; map.flyTo(ui.fix.lat, ui.fix.lng, Math.max(map.zoom(), 16)); }
        break;
      case 'record':
        if (ui.recording) { stopRecording(); toast('Stopped recording'); }
        else {
          const day = trip.days.find(isActive) || trip.days[addIdx()];
          startRecording(day);
          if (dayIdx() == null) { ui.tab = `d${trip.days.indexOf(day)}`; renderAll(); }
        }
        break;
      default:
    }
  }

  function onChange(e) {
    const di = e.target.dataset?.startTime;
    if (di != null && e.target.value) {
      trip.days[Number(di)].startTime = e.target.value;
      save(); renderSheet(); renderCard();
    }
  }

  const unStore = store.onStoreEvent((ev) => {
    if (ev.type === 'save-error') toast('Could not save — your phone storage may be full');
  });
  const onResize = debounce(() => { map.invalidate(); layoutSheet(false); }, 120);
  window.addEventListener('resize', onResize);
  // The sheet lives partly below the screen; never let focus/scrollIntoView scroll the screen itself.
  const screenEl = root.querySelector('.screen');
  screenEl.addEventListener('scroll', () => { if (screenEl.scrollTop || screenEl.scrollLeft) screenEl.scrollTo(0, 0); });

  /* ---------- go ---------- */
  renderAll();
  requestAnimationFrame(() => {
    map.invalidate();
    layoutSheet(false);
    fitCurrent(false);
  });
  const resumeDay = trip.days.find((d) => d.recording);
  if (resumeDay) {
    // Pick up where you left off (app reopened mid-day): keep recording into the same day.
    ui.recording = true;
    ui.recordDayId = resumeDay.id;
    if (resumeDay.trail?.length && resumeDay.trail[resumeDay.trail.length - 1] !== null) resumeDay.trail.push(null);
    ensureWatching();
    tracker.keepAwake(true);
    renderFabs();
  }
  ensureLegs();

  return () => {
    destroyed = true;
    store.save(true);
    legCtrl.abort(); searchCtrl?.abort(); exploreCtrl?.abort();
    runSearch.cancel(); onMoveEnd.cancel(); onResize.cancel();
    unwatch?.(); unwatch = null;
    tracker.keepAwake(false);
    unStore();
    window.removeEventListener('resize', onResize);
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
    map.destroy();
  };
}
