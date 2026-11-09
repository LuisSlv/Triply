// Live location: the blue dot, and the GPS trail when recording.
// A web page only gets GPS while it is open and on screen, so recording also asks the
// browser to keep the screen awake (Screen Wake Lock) where supported.

let watchId = null;
let wakeLock = null;
let wantWake = false;
const subs = new Set();
let last = null;

export const lastFix = () => last;
export const isWatching = () => watchId !== null;

export function watch(cb) {
  subs.add(cb);
  if (last) cb(last);
  if (watchId === null && 'geolocation' in navigator) {
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy, heading } = pos.coords;
        last = { lat: latitude, lng: longitude, acc: accuracy, heading, t: pos.timestamp || Date.now() };
        subs.forEach((fn) => fn(last));
      },
      (err) => subs.forEach((fn) => fn(null, err)),
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 30000 },
    );
  }
  return () => {
    subs.delete(cb);
    if (!subs.size) stopAll();
  };
}

export function stopAll() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  releaseWake();
}

export async function keepAwake(on) {
  wantWake = on;
  if (on) await requestWake(); else releaseWake();
}

async function requestWake() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* not allowed (battery saver, iOS < 16.4): fine */ }
}
function releaseWake() {
  try { wakeLock?.release(); } catch { /* already released */ }
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wantWake) requestWake();
});

export function locationErrorText(err) {
  if (!err) return '';
  if (err.code === 1) return 'Location permission was denied. Allow it in your browser settings to see where you are.';
  if (err.code === 2) return 'Your location is unavailable right now.';
  if (err.code === 3) return 'Still looking for GPS…';
  return 'Location error.';
}
