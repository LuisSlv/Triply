// Trips live on this device only (localStorage), with JSON export/import as the backup.
import { uid, addDays, daysBetween, todayISO } from './util.js';
import { catOf } from './categories.js';

const KEY = 'triply.v1';
let state = { trips: [] };
let saveTimer = null;
const listeners = new Set();

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = JSON.parse(raw);
  } catch (e) {
    console.warn('Could not read saved trips', e);
  }
  if (!state || !Array.isArray(state.trips)) state = { trips: [] };
}

function writeNow() {
  saveTimer = null;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Save failed', e);
    listeners.forEach((fn) => fn({ type: 'save-error', error: e }));
  }
}

/** Debounced save; pass true to write immediately (e.g. before leaving a page). */
export function save(now = false) {
  if (saveTimer) clearTimeout(saveTimer);
  if (now) writeNow();
  else saveTimer = setTimeout(writeNow, 250);
}
window.addEventListener('pagehide', () => { if (saveTimer) writeNow(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && saveTimer) writeNow(); });

export const onStoreEvent = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export const allTrips = () => [...state.trips].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
export const getTrip = (id) => state.trips.find((t) => t.id === id) || null;

function newDay(date) {
  return { id: uid(), date, startTime: '09:00', stops: [], trail: [], startedAt: null, finishedAt: null };
}

export function createTrip({ name, destination, startDate, endDate, transport, interests }) {
  const start = startDate || todayISO();
  const end = endDate && endDate >= start ? endDate : start;
  const n = Math.min(30, daysBetween(start, end) + 1);
  const trip = {
    id: uid(),
    name: (name || '').trim() || destination?.name || 'My trip',
    destination,
    transport: transport || 'public',
    interests: interests?.length ? interests : ['nature', 'restaurant', 'museum'],
    days: Array.from({ length: n }, (_, i) => newDay(addDays(start, i))),
    ideas: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  state.trips.push(trip);
  save(true);
  return trip;
}

export function touch(trip) {
  trip.updatedAt = Date.now();
  save();
}

export function deleteTrip(id) {
  state.trips = state.trips.filter((t) => t.id !== id);
  save(true);
}

/** Change a trip's dates; stops on days that disappear move to the ideas list rather than vanishing. */
export function setTripDates(trip, start, end) {
  if (!end || end < start) end = start;
  const n = Math.min(30, daysBetween(start, end) + 1);
  const old = trip.days;
  const days = [];
  for (let i = 0; i < n; i++) {
    const d = old[i] || newDay(null);
    d.date = addDays(start, i);
    days.push(d);
  }
  for (const d of old.slice(n)) {
    for (const s of d.stops) trip.ideas.push(toIdea(s));
  }
  trip.days = days;
  touch(trip);
}

/** A place picked from the map/search becomes a stop. */
export function makeStop(place) {
  return {
    id: uid(),
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    cat: place.cat || 'other',
    address: place.address || '',
    hours: place.hours || '',
    website: place.website || '',
    phone: place.phone || '',
    osm: place.osm || null,
    duration: catOf(place.cat).duration,
    fixedTime: null,
    notes: '',
    legMode: null,
    leg: null,
    visited: false,
    visitedAt: null,
  };
}

export function toIdea(stop) {
  const { id, name, lat, lng, cat, address, hours, website, phone, osm, notes } = stop;
  return { id: id || uid(), name, lat, lng, cat, address, hours, website, phone, osm, notes: notes || '' };
}

export function findStop(trip, stopId) {
  for (const day of trip.days) {
    const i = day.stops.findIndex((s) => s.id === stopId);
    if (i >= 0) return { day, index: i, stop: day.stops[i] };
  }
  return null;
}

export function exportJSON() {
  return JSON.stringify({ app: 'triply', version: 1, exportedAt: new Date().toISOString(), trips: state.trips }, null, 2);
}

/** Merge trips from a backup; a trip with the same id is replaced by the backup's copy. */
export function importJSON(text) {
  const data = JSON.parse(text);
  const incoming = Array.isArray(data) ? data : data.trips;
  if (!Array.isArray(incoming)) throw new Error('This file has no trips in it.');
  let count = 0;
  for (const t of incoming) {
    if (!t || !t.id || !Array.isArray(t.days)) continue;
    t.ideas = Array.isArray(t.ideas) ? t.ideas : [];
    const i = state.trips.findIndex((x) => x.id === t.id);
    if (i >= 0) state.trips[i] = t; else state.trips.push(t);
    count++;
  }
  save(true);
  return count;
}
