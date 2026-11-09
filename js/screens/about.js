// Credits and data attributions (required by the free services this app uses).
import { actionSheet } from '../ui.js';

export function showAbout() {
  const open = (url) => window.open(url, '_blank', 'noopener');
  return actionSheet('About Triply — personal, non-commercial trip planner', [
    { label: 'Built on code from TREK (AGPL-3.0)', value: 'trek', hint: 'Routing, place categories & map links adapted from github.com/mauriceboe/TREK — Triply is AGPL-3.0 too' },
    { label: 'Map data & tiles © OpenStreetMap contributors', value: 'osm', hint: 'ODbL · openstreetmap.org/copyright' },
    { label: 'Public transport routing: Transitous', value: 'transitous', hint: 'Data sources: transitous.org/sources' },
    { label: 'Walking, cycling & driving routes: OSRM / FOSSGIS', value: 'osrm', hint: 'routing.openstreetmap.de' },
    { label: 'Place search: Photon by komoot · Places: Overpass API', value: 'photon', hint: 'photon.komoot.io · overpass-api.de' },
  ]).then((v) => {
    const urls = {
      osm: 'https://www.openstreetmap.org/copyright',
      transitous: 'https://transitous.org/sources/',
      osrm: 'https://routing.openstreetmap.de/about.html',
      photon: 'https://photon.komoot.io/',
      trek: 'https://github.com/mauriceboe/TREK',
    };
    if (urls[v]) open(urls[v]);
  });
}
