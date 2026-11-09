// First screen: choose a trip or create a new one.
import * as store from '../store.js';
import { TRANSPORT } from '../categories.js';
import { esc, fmtDate, downloadText, todayISO } from '../util.js';
import { ICON, LOGO } from '../icons.js';
import { actionSheet, toast } from '../ui.js';
import { showAbout } from './about.js';

function tripStatus(trip) {
  const first = trip.days[0]?.date, last = trip.days[trip.days.length - 1]?.date;
  const today = todayISO();
  if (first && last) {
    if (today >= first && today <= last) return { label: 'Happening now', cls: 'now' };
    if (today < first) return { label: 'Upcoming', cls: 'soon' };
    return { label: 'Past', cls: 'past' };
  }
  return { label: '', cls: '' };
}

function tripCard(t) {
  const stops = t.days.reduce((n, d) => n + d.stops.length, 0);
  const first = t.days[0]?.date, last = t.days[t.days.length - 1]?.date;
  const when = t.days.length > 1 ? `${fmtDate(first, { day: 'numeric', month: 'short' })} – ${fmtDate(last, { day: 'numeric', month: 'short', year: 'numeric' })}` : fmtDate(first, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const st = tripStatus(t);
  const tr = TRANSPORT[t.transport] || TRANSPORT.public;
  return `<li><a class="trip-card" href="#/trip/${esc(t.id)}">
    <div class="tc-top">
      <span class="tc-name">${esc(t.name)}</span>
      ${st.label ? `<span class="badge ${st.cls}">${st.label}</span>` : ''}
    </div>
    <div class="tc-dest">${esc(t.destination?.name || '')}${t.destination?.country && t.destination.country !== t.destination.name ? `, ${esc(t.destination.country)}` : ''}</div>
    <div class="tc-meta">
      <span>${ICON.calendar}${esc(when)}</span>
      <span>${t.days.length} ${t.days.length === 1 ? 'day' : 'days'}</span>
      <span>${stops} ${stops === 1 ? 'stop' : 'stops'}</span>
      <span title="${esc(tr.label)}">${tr.emoji}</span>
    </div>
  </a></li>`;
}

export function renderHome(root) {
  const trips = store.allTrips();
  root.innerHTML = `<div class="screen home">
    <header class="home-head">
      <div class="brand">${LOGO}<span>Triply</span></div>
      <button class="icon-btn" data-action="menu" aria-label="Menu">${ICON.more}</button>
    </header>
    <main class="home-main">
      <h1>Where to next?</h1>
      <p class="lede">Map, places, timeline and route — one screen per trip.</p>
      <a class="btn primary big block" href="#/new">${ICON.plus}<span>Create new trip</span></a>
      ${trips.length ? `<h2 class="section-label">Your trips</h2><ul class="trip-list">${trips.map(tripCard).join('')}</ul>`
        : `<div class="empty">
            <div class="empty-art">🗺️</div>
            <p>No trips yet. Create one to pick your transport, the kind of places you like, and start dropping stops on the map.</p>
          </div>`}
    </main>
    <input type="file" accept="application/json,.json" hidden data-import />
  </div>`;

  const fileInput = root.querySelector('[data-import]');
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      const n = store.importJSON(await f.text());
      toast(`Imported ${n} ${n === 1 ? 'trip' : 'trips'}`);
      renderHome(root);
    } catch (e) {
      toast(`Couldn't import: ${e.message}`);
    }
  });

  root.querySelector('[data-action="menu"]').addEventListener('click', async () => {
    const v = await actionSheet('Triply', [
      { label: 'Back up all trips', value: 'export', icon: ICON.download, hint: 'Saves a .json file you can import later' },
      { label: 'Restore from backup', value: 'import', icon: ICON.upload },
      { label: 'About & credits', value: 'about', icon: ICON.info },
    ]);
    if (v === 'export') {
      downloadText(`triply-backup-${todayISO()}.json`, store.exportJSON(), 'application/json');
      toast('Backup downloaded');
    } else if (v === 'import') fileInput.click();
    else if (v === 'about') showAbout();
  });

  return () => {};
}
