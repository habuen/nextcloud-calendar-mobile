import dayjs from 'dayjs';
import { eventsWindow, monthRange } from '@/features/calendar/utils/range';

const ymd = (d: Date) => dayjs(d).format('YYYY-MM-DD HH:mm:ss.SSS');

describe('eventsWindow', () => {
  it('covers two whole months either side of the month of the date', () => {
    const { start, end } = eventsWindow(new Date(2026, 5, 17)); // June 2026
    expect(ymd(start)).toBe('2026-04-01 00:00:00.000');
    expect(ymd(end)).toBe('2026-08-31 23:59:59.999');
  });

  it('is the same window for any day of the month', () => {
    const first = eventsWindow(new Date(2026, 5, 1));
    const last = eventsWindow(new Date(2026, 5, 30, 23, 59));
    expect(first.start.getTime()).toBe(last.start.getTime());
    expect(first.end.getTime()).toBe(last.end.getTime());
  });

  it('crosses year boundaries in both directions', () => {
    const jan = eventsWindow(new Date(2027, 0, 10));
    expect(ymd(jan.start)).toBe('2026-11-01 00:00:00.000');
    expect(ymd(jan.end)).toBe('2027-03-31 23:59:59.999');
    const dec = eventsWindow(new Date(2026, 11, 20));
    expect(ymd(dec.start)).toBe('2026-10-01 00:00:00.000');
    expect(ymd(dec.end)).toBe('2027-02-28 23:59:59.999');
  });

  it('is wider than the one-month-either-side window by exactly a month each way', () => {
    const date = new Date(2026, 5, 17);
    const narrow = monthRange(date);
    const wide = eventsWindow(date);
    expect(dayjs(narrow.start).diff(wide.start, 'month')).toBe(1);
    expect(dayjs(wide.end).diff(narrow.end, 'month')).toBe(1);
  });

  it('always contains the months the month view keeps mounted and warms', () => {
    // Mounted: the month either side. Warmed ahead: two either side. The window
    // trails the date by a swipe, so the month one ahead of the previous month
    // (two ahead of the one before it) must be inside it too.
    const settled = new Date(2026, 5, 1);
    const trailing = eventsWindow(new Date(2026, 4, 1)); // still centred on May
    expect(trailing.end.getTime()).toBeGreaterThanOrEqual(new Date(2026, 6, 31).getTime()); // July: one ahead of settled June
    expect(eventsWindow(settled).end.getTime()).toBeGreaterThanOrEqual(new Date(2026, 7, 31).getTime());
  });
});
