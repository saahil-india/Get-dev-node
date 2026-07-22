// Server-side mirror of the prototype's date-range filter. Week starts Monday.

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function mondayOf(d) {
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7; // Mon = 0
  x.setDate(x.getDate() - day);
  return x;
}

/** preset: all | today | thisweek | lastweek | thismonth | custom */
export function resolveDateRange(preset, from, to) {
  const now = new Date();
  switch (preset) {
    case 'today': return [startOfDay(now), now];
    case 'thisweek': return [mondayOf(now), now];
    case 'lastweek': {
      const thisMon = mondayOf(now);
      const lastMon = new Date(thisMon); lastMon.setDate(lastMon.getDate() - 7);
      const lastSunEnd = new Date(thisMon); lastSunEnd.setMilliseconds(-1);
      return [lastMon, lastSunEnd];
    }
    case 'thismonth': return [new Date(now.getFullYear(), now.getMonth(), 1), now];
    case 'custom': {
      const f = from ? startOfDay(new Date(from)) : null;
      const t = to ? new Date(new Date(to).setHours(23, 59, 59, 999)) : null;
      return [f, t];
    }
    default: return [null, null]; // all time
  }
}
