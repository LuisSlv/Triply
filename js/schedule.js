// The day's timeline: arrival/departure for every stop from the day's start time,
// each stop's stay, travel time of the leg before it, and optional fixed arrival times.
import { hmToMin } from './util.js';

export function computeSchedule(day) {
  let t = hmToMin(day.startTime);
  let travelTotal = 0, distTotal = 0;
  const rows = day.stops.map((s, i) => {
    let travel = 0;
    if (i > 0) {
      travel = s.leg ? Math.ceil(s.leg.duration / 60) : 0;
      travelTotal += travel;
      distTotal += s.leg?.distance || 0;
      t += travel;
    }
    let wait = 0, late = false;
    if (s.fixedTime) {
      const f = hmToMin(s.fixedTime);
      if (f > t) { wait = f - t; t = f; } else if (f < t) late = true;
    }
    const arrive = t;
    const depart = t + (Number(s.duration) || 60);
    t = depart;
    return { arrive, depart, travel, wait, late, pending: i > 0 && !s.leg };
  });
  return {
    rows,
    start: rows.length ? rows[0].arrive : hmToMin(day.startTime),
    end: rows.length ? rows[rows.length - 1].depart : hmToMin(day.startTime),
    travelTotal,
    distTotal,
  };
}

/** The leg mode to use for a stop's incoming leg. */
export const legModeFor = (trip, stop) => stop.legMode || ({ public: 'transit', car: 'car', bike: 'bike', walk: 'walk' }[trip.transport] || 'walk');
