// Place categories, transport and leg modes.
// The OSM tag lists are adapted from TREK's CATEGORY_OSM_FILTERS (server/src/nest/maps/maps.helpers.ts, AGPL-3.0),
// regrouped into the interests Triply asks for when a trip is created.

export const CATEGORIES = [
  {
    key: 'nature', label: 'Scenery & nature', short: 'Nature', emoji: '🌲', color: '#16a34a', duration: 90,
    osm: ['leisure=park', 'leisure=garden', 'leisure=nature_reserve', 'natural=beach', 'natural=peak', 'natural=waterfall', 'tourism=viewpoint'],
  },
  {
    key: 'bar', label: 'Bars & nightlife', short: 'Bars', emoji: '🍸', color: '#a855f7', duration: 90,
    osm: ['amenity=bar', 'amenity=pub', 'amenity=nightclub', 'amenity=biergarten'],
  },
  {
    key: 'restaurant', label: 'Restaurants', short: 'Food', emoji: '🍽️', color: '#ef4444', duration: 75,
    osm: ['amenity=restaurant'],
  },
  {
    key: 'museum', label: 'Museums & galleries', short: 'Museums', emoji: '🏛️', color: '#6366f1', duration: 120,
    osm: ['tourism=museum', 'tourism=gallery'],
  },
  {
    key: 'fun', label: 'Carnivals & fun activities', short: 'Fun', emoji: '🎡', color: '#f59e0b', duration: 120,
    osm: ['tourism=theme_park', 'tourism=zoo', 'tourism=aquarium', 'leisure=water_park', 'leisure=amusement_arcade',
      'leisure=bowling_alley', 'leisure=escape_game', 'leisure=miniature_golf', 'amenity=cinema', 'amenity=theatre'],
  },
  {
    key: 'sights', label: 'Sights & landmarks', short: 'Sights', emoji: '📸', color: '#ec4899', duration: 45,
    osm: ['tourism=attraction', 'historic=monument', 'historic=castle', 'historic=ruins'],
  },
  {
    key: 'cafe', label: 'Cafés', short: 'Cafés', emoji: '☕', color: '#b45309', duration: 45,
    osm: ['amenity=cafe'],
  },
];

export const OTHER = { key: 'other', label: 'Place', short: 'Place', emoji: '📍', color: '#64748b', duration: 60, osm: [] };
const BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));
export const catOf = (key) => BY_KEY.get(key) || OTHER;

/** Category of an OSM object from its tags (first match wins). */
export function categorize(tags) {
  if (!tags) return 'other';
  for (const c of CATEGORIES) {
    for (const f of c.osm) {
      const [k, v] = f.split('=');
      if (tags[k] === v) return c.key;
    }
  }
  return 'other';
}

/** How the traveller gets around, picked once per trip. */
export const TRANSPORT = {
  public: { label: 'Public transport', emoji: '🚇', leg: 'transit', hint: 'Bus, metro, tram & train, plus walking' },
  car: { label: 'Car', emoji: '🚗', leg: 'car', hint: 'Driving routes between stops' },
  bike: { label: 'Bike', emoji: '🚲', leg: 'bike', hint: 'Cycling routes between stops' },
  walk: { label: 'Walking', emoji: '🚶', leg: 'walk', hint: 'Footpaths between stops' },
};

/** How one leg between two stops is travelled. `gm` is Google Maps' travelmode. */
export const LEG_MODES = {
  walk: { label: 'Walk', emoji: '🚶', gm: 'walking' },
  transit: { label: 'Transit', emoji: '🚇', gm: 'transit' },
  car: { label: 'Drive', emoji: '🚗', gm: 'driving' },
  bike: { label: 'Bike', emoji: '🚲', gm: 'bicycling' },
};

/** Transit vehicle emoji for a MOTIS leg mode. */
export function transitEmoji(mode) {
  switch (mode) {
    case 'WALK': return '🚶';
    case 'BUS': case 'COACH': return '🚌';
    case 'TRAM': case 'CABLE_CAR': return '🚋';
    case 'SUBWAY': case 'METRO': return '🚇';
    case 'FERRY': return '⛴️';
    case 'AIRPLANE': return '✈️';
    case 'FUNICULAR': case 'AERIAL_LIFT': return '🚡';
    case 'BIKE': case 'RENTAL': return '🚲';
    case 'CAR': return '🚗';
    default: return '🚆';
  }
}

/** One colour per day, so days stay apart on the map. */
export const DAY_COLORS = ['#e11d48', '#7c3aed', '#059669', '#d97706', '#2563eb', '#db2777', '#65a30d', '#9333ea'];
export const dayColor = (i) => DAY_COLORS[i % DAY_COLORS.length];

export const DURATION_CHOICES = [15, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300, 360];
