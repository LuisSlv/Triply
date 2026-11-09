// Create a trip: where & when → how you get around → what you like.
import * as store from '../store.js';
import { CATEGORIES, TRANSPORT } from '../categories.js';
import { searchPlaces } from '../geo.js';
import { esc, debounce, todayISO, addDays, daysBetween, fmtDate } from '../util.js';
import { ICON } from '../icons.js';
import { toast } from '../ui.js';

const STEPS = ['Where & when', 'Getting around', 'What you like'];

export function renderWizard(root) {
  const s = {
    step: 0,
    dest: null,
    results: [],
    searching: false,
    query: '',
    multi: false,
    start: todayISO(),
    end: addDays(todayISO(), 2),
    name: '',
    mode: 'public', // public | personal
    personal: 'car',
    interests: new Set(['nature', 'restaurant', 'museum']),
  };
  let ctrl = null;

  const stepWhere = () => `
    <div class="field">
      <span class="field-label" id="dest-label">Destination</span>
      ${s.dest ? `<div class="chosen">
          <div><b>${esc(s.dest.name)}</b><small>${esc([s.dest.kind, s.dest.country].filter(Boolean).join(' · '))}</small></div>
          <button type="button" class="btn ghost sm" data-act="change-dest">Change</button>
        </div>`
      : `<div class="search-field">${ICON.search}<input type="search" data-input="dest" aria-labelledby="dest-label" placeholder="City, town or region" autocomplete="off" enterkeyhint="search" value="${esc(s.query)}" autofocus /></div>
         <ul class="results" data-results>${resultsHtml()}</ul>`}
    </div>

    <div class="field">
      <span class="field-label">Trip length</span>
      <div class="seg" role="radiogroup">
        <button type="button" role="radio" aria-checked="${!s.multi}" class="${!s.multi ? 'on' : ''}" data-act="one">One day</button>
        <button type="button" role="radio" aria-checked="${s.multi}" class="${s.multi ? 'on' : ''}" data-act="multi">More than one day</button>
      </div>
    </div>

    <div class="row2">
      <label class="field"><span class="field-label">${s.multi ? 'First day' : 'Date'}</span>
        <input type="date" data-input="start" value="${s.start}" /></label>
      ${s.multi ? `<label class="field"><span class="field-label">Last day</span>
        <input type="date" data-input="end" value="${s.end}" min="${s.start}" /></label>` : ''}
    </div>
    ${s.multi ? `<p class="hint">${daysBetween(s.start, s.end) + 1} days · ${esc(fmtDate(s.start))} → ${esc(fmtDate(s.end))}</p>` : ''}

    <label class="field"><span class="field-label">Trip name <em>(optional)</em></span>
      <input type="text" data-input="name" maxlength="60" placeholder="${esc(s.dest ? `${s.dest.name} trip` : 'e.g. Summer in Lisbon')}" value="${esc(s.name)}" /></label>`;

  const resultsHtml = () => {
    if (s.searching) return '<li class="muted">Searching…</li>';
    if (s.query.length >= 2 && !s.results.length) return '<li class="muted">No places found</li>';
    return s.results.map((r, i) => `<li><button type="button" class="result" data-pick="${i}">
      <span class="r-name">${esc(r.name)}</span><span class="r-sub">${esc([r.kind, r.address].filter(Boolean).join(' · '))}</span>
    </button></li>`).join('');
  };

  const stepTransport = () => `
    <p class="step-q">How will you get around?</p>
    <div class="choice-grid">
      <button type="button" class="choice ${s.mode === 'public' ? 'on' : ''}" data-act="public" aria-pressed="${s.mode === 'public'}">
        <span class="choice-emoji">🚇</span><b>Public transport</b><small>Bus, metro, tram & train, plus walking. Real timetables where available.</small>
      </button>
      <button type="button" class="choice ${s.mode === 'personal' ? 'on' : ''}" data-act="personal" aria-pressed="${s.mode === 'personal'}">
        <span class="choice-emoji">🚗</span><b>Personal transport</b><small>Your own car, bike or on foot.</small>
      </button>
    </div>
    ${s.mode === 'personal' ? `<div class="field"><span class="field-label">Which one?</span>
      <div class="seg three">${['car', 'bike', 'walk'].map((k) => `<button type="button" class="${s.personal === k ? 'on' : ''}" data-personal="${k}" aria-pressed="${s.personal === k}">${TRANSPORT[k].emoji} ${TRANSPORT[k].label}</button>`).join('')}</div>
    </div>` : ''}
    <p class="hint">You can change the mode of any single leg later.</p>`;

  const stepInterests = () => `
    <p class="step-q">What kind of places do you want to find?</p>
    <div class="interest-grid">
      ${CATEGORIES.map((c) => `<button type="button" class="interest ${s.interests.has(c.key) ? 'on' : ''}" data-cat="${c.key}" aria-pressed="${s.interests.has(c.key)}" style="--c:${c.color}">
        <span class="i-emoji">${c.emoji}</span><span>${esc(c.label)}</span><span class="i-check">${ICON.check}</span>
      </button>`).join('')}
    </div>
    <p class="hint">These become quick filters on the trip map.</p>`;

  function render() {
    const body = [stepWhere, stepTransport, stepInterests][s.step]();
    const canNext = s.step !== 0 || !!s.dest;
    root.innerHTML = `<div class="screen wizard">
      <header class="bar">
        <button class="icon-btn" data-act="back" aria-label="${s.step ? 'Previous step' : 'Cancel'}">${s.step ? ICON.back : ICON.x}</button>
        <div class="bar-title">New trip<small>Step ${s.step + 1} of 3 · ${STEPS[s.step]}</small></div>
        <span class="icon-btn-spacer"></span>
      </header>
      <div class="progress"><span style="width:${((s.step + 1) / 3) * 100}%"></span></div>
      <main class="wizard-body">${body}</main>
      <footer class="wizard-foot">
        ${s.step < 2
          ? `<button class="btn primary big block" data-act="next" ${canNext ? '' : 'disabled'}>Next</button>`
          : `<button class="btn primary big block" data-act="create" ${s.interests.size ? '' : 'disabled'}>Create trip & open map</button>`}
        ${s.step === 0 && !s.dest ? '<p class="hint center">Pick a destination to continue</p>' : ''}
      </footer>
    </div>`;
    const input = root.querySelector('[data-input="dest"]');
    if (input && document.activeElement !== input && s.query) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  const runSearch = debounce(async () => {
    ctrl?.abort();
    if (s.query.trim().length < 2) { s.results = []; s.searching = false; updateResults(); return; }
    ctrl = new AbortController();
    s.searching = true; updateResults();
    try {
      s.results = await searchPlaces(s.query.trim(), { placesOnly: true, limit: 7, signal: ctrl.signal });
      if (!s.results.length) s.results = await searchPlaces(s.query.trim(), { limit: 7, signal: ctrl.signal });
    } catch (e) {
      if (e.name === 'AbortError') return;
      s.results = [];
      toast('Search is unavailable — check your connection');
    }
    s.searching = false;
    updateResults();
  }, 350);

  function updateResults() {
    const ul = root.querySelector('[data-results]');
    if (ul) ul.innerHTML = resultsHtml();
  }

  root.addEventListener('input', onInput);
  root.addEventListener('change', onInput);
  root.addEventListener('click', onClick);

  function onInput(e) {
    const k = e.target.dataset?.input;
    if (!k) return;
    if (k === 'dest') { s.query = e.target.value; runSearch(); return; }
    if (k === 'name') { s.name = e.target.value; return; }
    if (k === 'start' && e.type === 'change') {
      s.start = e.target.value || todayISO();
      if (s.end < s.start) s.end = addDays(s.start, 1);
      render();
    }
    if (k === 'end' && e.type === 'change') {
      s.end = e.target.value || s.start;
      if (s.end < s.start) s.end = s.start;
      if (daysBetween(s.start, s.end) > 29) { s.end = addDays(s.start, 29); toast('Trips can be up to 30 days'); }
      render();
    }
  }

  function onClick(e) {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.pick) {
      s.dest = s.results[Number(t.dataset.pick)];
      s.results = []; s.query = '';
      render();
      return;
    }
    if (t.dataset.cat) {
      const k = t.dataset.cat;
      if (s.interests.has(k)) s.interests.delete(k); else s.interests.add(k);
      render();
      return;
    }
    if (t.dataset.personal) { s.personal = t.dataset.personal; render(); return; }
    switch (t.dataset.act) {
      case 'back':
        if (s.step === 0) location.hash = '#/'; else { s.step--; render(); }
        break;
      case 'next':
        if (s.step === 0 && !s.dest) return;
        s.step++; render();
        root.querySelector('.wizard-body')?.scrollTo(0, 0);
        break;
      case 'change-dest': s.dest = null; render(); break;
      case 'one': s.multi = false; render(); break;
      case 'multi':
        s.multi = true;
        if (s.end <= s.start) s.end = addDays(s.start, 2);
        render();
        break;
      case 'public': s.mode = 'public'; render(); break;
      case 'personal': s.mode = 'personal'; render(); break;
      case 'create': {
        const d = s.dest;
        const trip = store.createTrip({
          name: s.name || `${d.name} trip`,
          destination: { name: d.name, lat: d.lat, lng: d.lng, bounds: d.bounds, country: d.country },
          startDate: s.start,
          endDate: s.multi ? s.end : s.start,
          transport: s.mode === 'public' ? 'public' : s.personal,
          interests: CATEGORIES.map((c) => c.key).filter((k) => s.interests.has(k)),
        });
        location.hash = `#/trip/${trip.id}`;
        break;
      }
      default:
    }
  }

  render();
  return () => {
    ctrl?.abort();
    runSearch.cancel();
    root.removeEventListener('input', onInput);
    root.removeEventListener('change', onInput);
    root.removeEventListener('click', onClick);
  };
}
