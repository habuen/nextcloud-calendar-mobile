import dayjs from 'dayjs';
import { createMonthPageCache } from '@/features/calendar/monthGrid/monthPageCache';
import { buildMonthGrid } from '@/features/calendar/monthGrid/monthLayout';

const inputs = {
  eventsByDay: new Map(),
  width: 350,
  height: 600,
  mode: 'bars' as const,
  today: dayjs('2026-06-10'),
  palette: { tile: '#eee', primary: '#00f', text: '#000', textTertiary: '#888' },
};

describe('createMonthPageCache', () => {
  it('builds a month once and hands back the same page for the same weeks', () => {
    const cache = createMonthPageCache(inputs);
    const june = buildMonthGrid(2026, 5, 0);
    const first = cache.get(june);
    expect(cache.get(june)).toBe(first);
    expect(first.layout.width).toBe(350);
    expect(first.layout.height).toBe(600);
  });

  it('keeps different months apart', () => {
    const cache = createMonthPageCache(inputs);
    expect(cache.get(buildMonthGrid(2026, 5, 0))).not.toBe(cache.get(buildMonthGrid(2026, 6, 0)));
  });

  it('starts empty when made again, which is how changed inputs invalidate it', () => {
    const june = buildMonthGrid(2026, 5, 0);
    const before = createMonthPageCache(inputs).get(june);
    const after = createMonthPageCache({ ...inputs, width: 400 }).get(june);
    expect(after).not.toBe(before);
    expect(after.layout.width).toBe(400);
  });

  it('drops the least recently used month once it holds more than it should', () => {
    const cache = createMonthPageCache(inputs);
    const months = Array.from({ length: 10 }, (_, i) => buildMonthGrid(2026, i, 0));
    const pages = months.map((m) => cache.get(m));
    // Ten asked for, nine kept: the first is gone and gets rebuilt; the rest are still there.
    expect(cache.get(months[9])).toBe(pages[9]);
    expect(cache.get(months[1])).toBe(pages[1]);
    expect(cache.get(months[0])).not.toBe(pages[0]);
  });

  it('counts a lookup as use, so a month being looked at is not the one dropped', () => {
    const cache = createMonthPageCache(inputs);
    const months = Array.from({ length: 10 }, (_, i) => buildMonthGrid(2026, i, 0));
    const pages = months.slice(0, 9).map((m) => cache.get(m));
    cache.get(months[0]); // touch the oldest
    cache.get(months[9]); // pushes one out: now the second-oldest
    expect(cache.get(months[0])).toBe(pages[0]);
    expect(cache.get(months[1])).not.toBe(pages[1]);
  });
});
