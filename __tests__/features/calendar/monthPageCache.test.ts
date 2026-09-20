import dayjs from 'dayjs';
import { createMonthPageCache, monthDigest } from '@/features/calendar/monthGrid/monthPageCache';
import { buildMonthGrid, eventDayKeys } from '@/features/calendar/monthGrid/monthLayout';
import type { CalendarEvent } from '@/types';

const config = {
  width: 350,
  height: 600,
  mode: 'bars' as const,
  today: dayjs('2026-06-10'),
  palette: { tile: '#eee', primary: '#00f', text: '#000', textTertiary: '#888' },
};

const ev = (uid: string, y: number, m: number, d: number, span = 0): CalendarEvent => ({
  uid, href: `/${uid}.ics`, calendarId: 'c', accountId: 'a', summary: `Title ${uid}`,
  dtstart: new Date(y, m, d, 9), dtend: new Date(y, m, d + span, 10),
  allDay: false, color: '#0082c9', attendees: [], isRecurring: false,
});
function byDay(events: CalendarEvent[]) {
  const map = new Map<string, CalendarEvent[]>();
  for (const e of events) for (const k of eventDayKeys(e)) map.set(k, [...(map.get(k) ?? []), e]);
  return map;
}
const none = new Map<string, CalendarEvent[]>();

describe('createMonthPageCache', () => {
  it('builds a month once and hands back the same page for the same weeks', () => {
    const cache = createMonthPageCache(config);
    const june = buildMonthGrid(2026, 5, 0);
    const first = cache.get(june, none);
    expect(cache.get(june, none)).toBe(first);
    expect(first.layout.width).toBe(350);
    expect(first.layout.height).toBe(600);
  });

  it('keeps different months apart', () => {
    const cache = createMonthPageCache(config);
    expect(cache.get(buildMonthGrid(2026, 5, 0), none)).not.toBe(cache.get(buildMonthGrid(2026, 6, 0), none));
  });

  it('starts empty when made again, which is how changed display settings invalidate it', () => {
    const june = buildMonthGrid(2026, 5, 0);
    const before = createMonthPageCache(config).get(june, none);
    const after = createMonthPageCache({ ...config, width: 400 }).get(june, none);
    expect(after).not.toBe(before);
    expect(after.layout.width).toBe(400);
  });

  it('drops the least recently used month once it holds more than it should', () => {
    const cache = createMonthPageCache(config);
    const months = Array.from({ length: 10 }, (_, i) => buildMonthGrid(2026, i, 0));
    const pages = months.map((m) => cache.get(m, none));
    expect(cache.get(months[9], none)).toBe(pages[9]);
    expect(cache.get(months[1], none)).toBe(pages[1]);
    expect(cache.get(months[0], none)).not.toBe(pages[0]);
  });

  it('counts a lookup as use, so a month being looked at is not the one dropped', () => {
    const cache = createMonthPageCache(config);
    const months = Array.from({ length: 10 }, (_, i) => buildMonthGrid(2026, i, 0));
    const pages = months.slice(0, 9).map((m) => cache.get(m, none));
    cache.get(months[0], none);
    cache.get(months[9], none);
    expect(cache.get(months[0], none)).toBe(pages[0]);
    expect(cache.get(months[1], none)).not.toBe(pages[1]);
  });
});

describe('a page across changes to the events', () => {
  const june = buildMonthGrid(2026, 5, 0);
  const july = buildMonthGrid(2026, 6, 0);
  const inJune = ev('june-1', 2026, 5, 12);
  const inJuly = ev('july-1', 2026, 6, 8);

  it('is reused when the events map is rebuilt from the very same event objects', () => {
    const cache = createMonthPageCache(config);
    const page = cache.get(june, byDay([inJune, inJuly]));
    expect(cache.get(june, byDay([inJune, inJuly]))).toBe(page);
  });

  it('is reused when the only events that changed are in a different month', () => {
    const cache = createMonthPageCache(config);
    const page = cache.get(june, byDay([inJune]));
    expect(cache.get(june, byDay([inJune, inJuly, ev('july-2', 2026, 6, 20)]))).toBe(page);
  });

  it('is rebuilt when an event is added on one of its days', () => {
    const cache = createMonthPageCache(config);
    const page = cache.get(june, byDay([inJune]));
    const after = cache.get(june, byDay([inJune, ev('june-2', 2026, 5, 20)]));
    expect(after).not.toBe(page);
    expect(after.layout.bars).toHaveLength(2);
  });

  it('is rebuilt when an event on it is removed', () => {
    const cache = createMonthPageCache(config);
    const page = cache.get(june, byDay([inJune, ev('june-2', 2026, 5, 20)]));
    expect(cache.get(june, byDay([inJune]))).not.toBe(page);
  });

  it('is rebuilt when an event on it is replaced by an edited copy', () => {
    const cache = createMonthPageCache(config);
    const page = cache.get(june, byDay([inJune]));
    const edited = { ...inJune, summary: 'Renamed' };
    const after = cache.get(june, byDay([edited]));
    expect(after).not.toBe(page);
    expect(after.layout.bars[0].label).toBe('Renamed');
  });

  it('is rebuilt when the events on a day come in a different order', () => {
    const cache = createMonthPageCache(config);
    const a = ev('a', 2026, 5, 12);
    const b = ev('b', 2026, 5, 12);
    const page = cache.get(june, byDay([a, b]));
    expect(cache.get(june, byDay([b, a]))).not.toBe(page);
  });

  it('keeps each month\'s page when only one month\'s events change', () => {
    const cache = createMonthPageCache(config);
    const juneBefore = cache.get(june, byDay([inJune, inJuly]));
    const julyBefore = cache.get(july, byDay([inJune, inJuly]));
    const next = byDay([inJune, { ...inJuly, summary: 'edited' }]);
    expect(cache.get(june, next)).toBe(juneBefore);
    expect(cache.get(july, next)).not.toBe(julyBefore);
  });

  it('shows an event that runs into a month from the one before it', () => {
    const cache = createMonthPageCache(config);
    const spans = ev('span', 2026, 4, 30, 3); // May 30 - Jun 2
    const page = cache.get(june, byDay([spans]));
    expect(page.layout.bars).toHaveLength(1);
    expect(cache.get(june, byDay([spans]))).toBe(page);
    expect(cache.get(june, byDay([{ ...spans, summary: 'x' }]))).not.toBe(page);
  });
});

describe('MonthPage.titlesFor', () => {
  it('lists the titles of the events on a day, and none for an empty day', () => {
    const june = buildMonthGrid(2026, 5, 0);
    const page = createMonthPageCache(config).get(june, byDay([ev('a', 2026, 5, 12), ev('b', 2026, 5, 12)]));
    expect(page.titlesFor('2026-06-12')).toEqual(['Title a', 'Title b']);
    expect(page.titlesFor('2026-06-13')).toEqual([]);
  });
});

describe('monthDigest', () => {
  const june = buildMonthGrid(2026, 5, 0);
  it('is the same for the same events and different for different ones', () => {
    const a = ev('a', 2026, 5, 12);
    expect(monthDigest(june, byDay([a]))).toBe(monthDigest(june, byDay([a])));
    expect(monthDigest(june, byDay([a]))).not.toBe(monthDigest(june, byDay([ev('a', 2026, 5, 12)])));
    expect(monthDigest(june, byDay([a]))).not.toBe(monthDigest(june, none));
  });

  it('separates days, so the same event on another day is a different digest', () => {
    const a = ev('a', 2026, 5, 12);
    const moved = { ...a, dtstart: new Date(2026, 5, 13, 9), dtend: new Date(2026, 5, 13, 10) };
    expect(monthDigest(june, byDay([a]))).not.toBe(monthDigest(june, byDay([moved])));
  });
});
