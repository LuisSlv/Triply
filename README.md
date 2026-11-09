# Triply — personal trip planner (phone web app)

One screen per trip: **map + place search + category filters + a toggleable timeline**, and a
step‑by‑step mode that draws the route you've actually taken. No server, no account, no API keys.
Trips are saved on the phone itself.

## What it does

- **Trips** – first screen lists your trips; *Create new trip* asks for:
  1. destination + one day / several days (dates)
  2. transport: **public** (bus/metro/tram/train + walking) or **personal** (car / bike / walking)
  3. what you like: scenery & nature, bars, restaurants, museums, carnivals & fun, sights, cafés
- **Trip screen**
  - full‑screen map, search bar (any place, biased to where the map is)
  - category chips → shows matching places on the map; tap one → *Add to Day N* or *★ Save* as an idea
  - opening hours, website, phone and a **Google Maps** button (reviews, photos) on every place
  - bottom sheet (tap/drag the handle): day tabs, **timeline** with arrival/leave times, stay length,
    fixed times (bookings), notes, and the travel leg between stops (real transit lines & departures)
  - per‑leg mode (walk / transit / drive / bike) and a **Go** button that opens Google Maps directions
  - *Ideas* tab (your "maybe" places, shown as ★ on the map) and *All days* overview
  - export the whole trip to your phone calendar (.ics)
- **Doing the trip** – press **Start**: the sheet shows the next stop with *Navigate* and *I'm here*.
  Each stop you reach turns the leg into a solid line on the map, and **Trail** records your real GPS
  path (cyan line). A web page only gets GPS while it's open on screen, so Triply asks the phone to keep
  the screen awake while recording.
- Works offline for what you've already loaded (app + map tiles you've seen); search/routes need data.
- Backup/restore all trips as a .json file (⋯ menu on the home screen).

## Put it on your phone

GPS and "Add to Home Screen" need **https**, so host the folder on a free static host:

- **Netlify Drop** – sign in at <https://app.netlify.com/drop> (free) and drag this whole `Triply`
  folder onto the page. You get an `https://….netlify.app` link.
- **GitHub Pages** – push this folder to a GitHub repo → *Settings → Pages → Deploy from branch*.
- **Cloudflare Pages** – *Workers & Pages → Create → Upload assets*, drop the folder.

Then open the link on your phone and **Add to Home Screen** (Safari: Share → Add to Home Screen;
Chrome: ⋮ → Install app). It opens full‑screen like a normal app.

Try it on this computer first:

```bash
node serve.js
```

then open <http://localhost:5173> (use the browser's phone view; GPS won't work over plain http on the phone).

## Where the data comes from (all free, no keys)

| What | Service |
|---|---|
| Map tiles & data | OpenStreetMap |
| Search + places by category | Photon (komoot), Overpass as fallback |
| Opening hours / website / phone | Nominatim |
| Walk / bike / car routes | OSRM on routing.openstreetmap.de (FOSSGIS) |
| Public transport (timetables) | Transitous — non‑commercial use; the app links its data sources in *About* |
| Reviews, photos, live navigation | Google Maps (opened via links) |

If you ever share your hosted link publicly, Transitous asks browser apps to show contact info on the
site — add an email or URL to `js/screens/about.js`.

## Credits & license

Parts of the routing, category and map‑link logic are adapted from
[TREK](https://github.com/mauriceboe/TREK) (AGPL‑3.0), so Triply is AGPL‑3.0 too (see `LICENSE`).
"TREK" is the TREK project's trademark; this app is not TREK and isn't endorsed by it.
Map library: [Leaflet](https://leafletjs.com) 1.9.4 (BSD‑2), in `vendor/leaflet`.

## Files

```
index.html  manifest.webmanifest  sw.js (offline)  serve.js (local test server)
css/app.css
js/app.js (router)  store.js (saving)  geo.js (search/places)  routing.js  schedule.js
   links.js (Google Maps + calendar)  mapview.js  tracker.js (GPS)  ui.js  icons.js  categories.js
js/screens/home.js  wizard.js  trip.js  about.js
```
