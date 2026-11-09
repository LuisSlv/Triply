# Notice — code from TREK

Triply uses code from **TREK** — https://github.com/mauriceboe/TREK — © the TREK contributors,
licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).

The code was taken from TREK version 5.1.2 (commit `5cfc7a6`) and **modified** on 2026-11-09:
it was rewritten from TREK's TypeScript/React client and NestJS server into plain browser
JavaScript so that it runs entirely on the phone, without a server. Because of this, Triply as a
whole is also licensed under the AGPL-3.0 (see `LICENSE`, copied from TREK).

| Triply file | Adapted from TREK |
|---|---|
| `js/categories.js` | place categories and their OpenStreetMap tags — `server/src/nest/maps/maps.helpers.ts` (`CATEGORY_OSM_FILTERS`), `client/src/components/Map/poiCategories.ts` (colours) |
| `js/geo.js` | Overpass query building — `server/src/nest/maps/osm-filter.helpers.ts`, `server/src/nest/maps/providers/osm.client.ts` |
| `js/routing.js` | walking/cycling/driving routes via FOSSGIS OSRM — `client/src/components/Map/RouteCalculator.ts`; public transport via Transitous and its response mapping — `server/src/nest/transit/transit.service.ts` |
| `js/links.js` | "open in Google Maps" links for a place and a whole day — `client/src/components/Planner/dayRouteApps.ts`, `generateGoogleMapsUrl` in `RouteCalculator.ts` |

The overall idea — places on a map, organised into day plans with routes between them — also
comes from TREK. Everything else (screens, timeline, step-by-step mode, GPS trail, storage on the
phone) was written for Triply.

"TREK" is a trademark of the TREK project. Triply is a separate, personal project: it is not TREK,
is not distributed as TREK, and is not endorsed by the TREK project.

## Other third-party parts

- **Leaflet 1.9.4** (`vendor/leaflet/`) — © Vladimir Agafonkin, © CloudMade — BSD-2-Clause.
- **Map data** © OpenStreetMap contributors — ODbL — https://www.openstreetmap.org/copyright
- **Public transport routing** by Transitous — data sources: https://transitous.org/sources/
