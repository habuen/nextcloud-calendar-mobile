// Calendar-day arithmetic on plain numbers. A "day number" is the count of days
// since 1970-01-01 of a *local calendar date*, so comparing and stepping days is
// integer math, and DST can't move a day (it is built from the local year, month
// and date, never from a time of day).
//
// The month view used to do all of this with dayjs, creating several objects per
// event and per day on every layout. The JS engine on a phone has no JIT, so
// that was the bulk of the time spent laying a month out; the numbers below
// cost a small fraction of it.

const MS_PER_DAY = 86_400_000;

export function dayNumber(year: number, month: number, date: number): number {
  return Date.UTC(year, month, date) / MS_PER_DAY;
}

export function dayNumberOfDate(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / MS_PER_DAY;
}

export function dayNumberOfDayjs(d: { year(): number; month(): number; date(): number }): number {
  return Date.UTC(d.year(), d.month(), d.date()) / MS_PER_DAY;
}

const keyCache = new Map<number, string>();

// 'YYYY-MM-DD' for a day number: the key eventsByDay is indexed by.
export function keyOfDayNumber(n: number): string {
  let key = keyCache.get(n);
  if (key === undefined) {
    if (keyCache.size > 4000) keyCache.clear();
    const d = new Date(n * MS_PER_DAY);
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    key = `${String(d.getUTCFullYear()).padStart(4, '0')}-${m < 10 ? '0' : ''}${m}-${day < 10 ? '0' : ''}${day}`;
    keyCache.set(n, key);
  }
  return key;
}

// The last day an event occupies. An all-day event's end is already that day.
// A timed event ending exactly at the first instant of a day belongs to the day
// before (a meeting until midnight doesn't spill onto the next day). Compared
// against the day's real first instant rather than 00:00, so a zone whose DST
// change lands at midnight (where the day begins at 01:00) still counts.
export function lastDayNumberOf(e: { dtend: Date; allDay: boolean }): number {
  const end = e.dtend;
  const n = dayNumberOfDate(end);
  if (e.allDay) return n;
  const firstInstant = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  return end.getTime() === firstInstant ? n - 1 : n;
}
