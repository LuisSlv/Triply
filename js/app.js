// Triply — hash router + service worker registration.
import * as store from './store.js';
import { renderHome } from './screens/home.js';
import { renderWizard } from './screens/wizard.js';
import { renderTrip } from './screens/trip.js';

const root = document.getElementById('app');
let cleanup = null;

function route() {
  try { cleanup?.(); } catch (e) { console.error(e); }
  cleanup = null;
  document.getElementById('overlay-root').innerHTML = '';
  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean);
  if (parts[0] === 'new') cleanup = renderWizard(root);
  else if (parts[0] === 'trip') {
    const trip = store.getTrip(parts[1]);
    if (!trip) { location.replace('#/'); return; }
    cleanup = renderTrip(root, trip);
  } else cleanup = renderHome(root);
  window.scrollTo(0, 0);
}

store.load();
window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Offline mode unavailable', e));
  });
}
