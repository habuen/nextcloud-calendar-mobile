import dayjs from 'dayjs';
import {
  buildMonthGrid, buildWeekSegments, eventDayKeys, layoutMonthPage, weekCandidates,
} from '@/features/calendar/monthGrid/monthLayout';
import { dayNumberOfDate, keyOfDayNumber, lastDayNumberOf } from '@/features/calendar/monthGrid/dayMath';
import type { CalendarEvent } from '@/types';

// The original dayjs implementations, kept here as the reference the integer
// versions must agree with exactly.
function refLastDayOf(e: CalendarEvent): dayjs.Dayjs {
  const end = dayjs(e.dtend);
  if (e.allDay) return end.startOf('day');
  return (end.isSame(end.startOf('day')) ? end.subtract(1, 'millisecond') : end).startOf('day');
}
function refEventDayKeys(e: CalendarEvent): string[] {
  const start = dayjs(e.dtstart);
  const startKey = start.format('YYYY-MM-DD');
  const endDay = refLastDayOf(e);
  const keys: string[] = [];
  let cur = start.startOf('day');
  while (!cur.isAfter(endDay, 'day') && keys.length <= 366) {
    keys.push(cur.format('YYYY-MM-DD'));
    cur = cur.add(1, 'day');
  }
  return keys.length ? keys : [startKey];
}
function refBuildWeekSegments(week: (dayjs.Dayjs | null)[], events: CalendarEvent[]) {
  const segments: { event: CalendarEvent; startCol: number; endCol: number }[] = [];
  for (const e of events) {
    const startDay = dayjs(e.dtstart).startOf('day');
    const endDay = refLastDayOf(e);
    let startCol = -1;
    let endCol = -1;
    for (let i = 0; i < 7; i++) {
      const d = week[i];
      if (!d) continue;
      if (!d.isBefore(startDay, 'day') && !d.isAfter(endDay, 'day')) {
        if (startCol === -1) startCol = i;
        endCol = i;
      }
    }
    if (startCol !== -1) segments.push({ event: e, startCol, endCol });
  }
  return segments;
}
function refWeekCandidates(week: (dayjs.Dayjs | null)[], byDay: Map<string, CalendarEvent[]>) {
  const seen = new Map<string, CalendarEvent>();
  for (const d of week) {
    if (!d) continue;
    const list = byDay.get(d.format('YYYY-MM-DD'));
    if (!list) continue;
    for (const e of list) seen.set(e.uid, e);
  }
  return Array.from(seen.values());
}

// Small deterministic generator so a failure is reproducible.
let seed = 20260920;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

function randomEvent(i: number): CalendarEvent {
  // Days chosen around the European DST changes (Mar 29 and Oct 25, 2026), the
  // month boundaries, and a year boundary.
  const base = pick([
    new Date(2026, 2, 27), new Date(2026, 2, 28), new Date(2026, 2, 29), new Date(2026, 2, 30),
    new Date(2026, 9, 24), new Date(2026, 9, 25), new Date(2026, 9, 26),
    new Date(2026, 5, 1), new Date(2026, 5, 30), new Date(2026, 11, 31), new Date(2027, 0, 1),
    new Date(2026, 5, 15),
  ]);
  const allDay = rand() < 0.3;
  const startHour = allDay ? 0 : pick([0, 0, 1, 2, 3, 9, 12, 22, 23]);
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), startHour, pick([0, 0, 30]));
  const kind = rand();
  let end: Date;
  if (kind < 0.2) end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + Math.floor(rand() * 4) + 1); // exactly midnight
  else if (kind < 0.35) end = new Date(start.getTime()); // zero length
  else if (kind < 0.45) end = new Date(start.getTime() - 3600e3 * (1 + Math.floor(rand() * 30))); // ends before it starts
  else if (kind < 0.55) end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + Math.floor(rand() * 3), 23, 59, 59, 999);
  else end = new Date(start.getTime() + 3600e3 * (1 + Math.floor(rand() * 80)));
  if (allDay) end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + Math.floor(rand() * 4));
  return {
    uid: `e${i}`, href: `/e${i}.ics`, calendarId: 'c', accountId: 'a', summary: `e${i}`,
    dtstart: start, dtend: end, allDay, color: '#0082c9', attendees: [], isRecurring: false,
  };
}
const events = Array.from({ length: 4000 }, (_, i) => randomEvent(i));

describe('integer day math agrees with the dayjs implementation it replaced', () => {
  it('finds the same last day for every event', () => {
    for (const e of events) {
      const ref = refLastDayOf(e);
      expect(keyOfDayNumber(lastDayNumberOf(e))).toBe(ref.format('YYYY-MM-DD'));
    }
  });

  it('gives the same day keys for every event', () => {
    for (const e of events) expect(eventDayKeys(e)).toEqual(refEventDayKeys(e));
  });

  it('caps a very long event the same way', () => {
    const long: CalendarEvent = { ...events[0], allDay: false, dtstart: new Date(2020, 0, 1, 9), dtend: new Date(2026, 0, 1, 9) };
    expect(eventDayKeys(long)).toEqual(refEventDayKeys(long));
    expect(eventDayKeys(long)).toHaveLength(367);
  });

  it('agrees on a day number and its key across daylight-saving changes', () => {
    for (let n = dayNumberOfDate(new Date(2026, 0, 1)); n < dayNumberOfDate(new Date(2027, 0, 1)); n++) {
      const d = dayjs(new Date(2026, 0, 1)).add(n - dayNumberOfDate(new Date(2026, 0, 1)), 'day');
      expect(keyOfDayNumber(n)).toBe(d.format('YYYY-MM-DD'));
    }
  });

  it('clips events to the same columns in every week of several months', () => {
    for (const [y, m] of [[2026, 2], [2026, 5], [2026, 9], [2026, 11], [2027, 0]]) {
      for (const weekStartsOn of [0, 1] as const) {
        for (const week of buildMonthGrid(y, m, weekStartsOn)) {
          expect(buildWeekSegments(week, events.slice(0, 800))).toEqual(refBuildWeekSegments(week, events.slice(0, 800)));
        }
      }
    }
  });

  it('picks the same candidate events for every week', () => {
    const byDay = new Map<string, CalendarEvent[]>();
    for (const e of events) for (const k of refEventDayKeys(e)) byDay.set(k, [...(byDay.get(k) ?? []), e]);
    for (const [y, m] of [[2026, 2], [2026, 9], [2026, 11]]) {
      for (const week of buildMonthGrid(y, m, 1)) {
        expect(weekCandidates(week, byDay)).toEqual(refWeekCandidates(week, byDay));
      }
    }
  });

  it('lays a whole month out from events it would have laid out identically before', () => {
    const byDay = new Map<string, CalendarEvent[]>();
    for (const e of events.slice(0, 400)) for (const k of refEventDayKeys(e)) byDay.set(k, [...(byDay.get(k) ?? []), e]);
    const weeks = buildMonthGrid(2026, 9, 1);
    const layout = layoutMonthPage({ weeks, eventsByDay: byDay, width: 700, height: 600, mode: 'bars', today: dayjs(new Date(2026, 9, 25)) });
    // Every bar sits on days that really have that event.
    for (const b of layout.bars) {
      const week = Math.floor(b.y / layout.rowHeight);
      const firstCol = Math.round((b.x - 3) / (700 / 7));
      const day = weeks[week][firstCol];
      expect(day).not.toBeNull();
      const covering = byDay.get(day!.format('YYYY-MM-DD')) ?? [];
      expect(covering.some((e) => e.uid === b.label)).toBe(true);
    }
    expect(layout.numbers.filter((n) => n.today).map((n) => n.text)).toEqual(['25']);
  });
});
