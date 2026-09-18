import dayjs from 'dayjs';
import {
  BAR_INSET, COLS, DAY_NUMBER_ROW_HEIGHT, DOT_RADIUS, DOTS_TOP, LANE_HEIGHT, LANE_STRIDE, MAX_DOTS,
  NUMBER_CY, TILE_MARGIN, buildMonthGrid, layoutMonthPage, maxLanesFor, resolvePageTouch,
} from '@/features/calendar/monthGrid/monthLayout';
import type { CalendarEvent } from '@/types';

const W = 700;
const H = 600;
const weeks = buildMonthGrid(2026, 5, 0); // June 2026, Sunday first: 5 rows
const rowH = H / weeks.length;
const colW = W / COLS;
const today = dayjs(new Date(2026, 5, 17));

const ev = (uid: string, y: number, m: number, d: number, span = 0, color = '#0082c9'): CalendarEvent => ({
  uid, href: `/${uid}.ics`, calendarId: 'c', accountId: 'a', summary: uid,
  dtstart: new Date(y, m, d, 9), dtend: new Date(y, m, d + span, 10),
  allDay: false, color, attendees: [], isRecurring: false,
});

function byDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    for (let d = dayjs(e.dtstart).startOf('day'); !d.isAfter(dayjs(e.dtend), 'day'); d = d.add(1, 'day')) {
      const k = d.format('YYYY-MM-DD');
      map.set(k, [...(map.get(k) ?? []), e]);
    }
  }
  return map;
}

const lay = (events: CalendarEvent[], mode: 'bars' | 'dots' = 'bars', width = W, height = H) =>
  layoutMonthPage({ weeks, eventsByDay: byDay(events), width, height, mode, today });

describe('layoutMonthPage tiles and numbers', () => {
  it('lays out one tile and one number per real day of the month', () => {
    const l = lay([]);
    expect(l.tiles).toHaveLength(30);
    expect(l.numbers.map((n) => n.text)).toEqual(Array.from({ length: 30 }, (_, i) => String(i + 1)));
  });

  it('keeps every tile inside the page, with the gap between neighbours the margins add up to', () => {
    const l = lay([]);
    for (const t of l.tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.x + t.w).toBeLessThanOrEqual(W + 1e-9);
      expect(t.y + t.h).toBeLessThanOrEqual(H + 1e-9);
    }
    // Jun 8 and Jun 9 are neighbours on the same row.
    const [a, b] = [l.tiles[7], l.tiles[8]];
    expect(b.x - (a.x + a.w)).toBeCloseTo(2 * TILE_MARGIN, 9);
  });

  it('centres each number on its own column, at the top of its tile', () => {
    const l = lay([]);
    const jun10 = l.numbers.find((n) => n.text === '10')!; // Wednesday, column 3, row 1
    expect(jun10.cx).toBeCloseTo(3.5 * colW, 9);
    expect(jun10.cy).toBeCloseTo(rowH + NUMBER_CY, 9);
  });

  it('marks only today', () => {
    const l = lay([]);
    expect(l.numbers.filter((n) => n.today).map((n) => n.text)).toEqual(['17']);
  });
});

describe('layoutMonthPage bars', () => {
  it('puts a single-day event on its own day, inset inside that day\'s tile', () => {
    const l = lay([ev('a', 2026, 5, 15)]); // Monday Jun 15: row 2, column 1
    expect(l.bars).toHaveLength(1);
    const [b] = l.bars;
    expect(b.x).toBeCloseTo(1 * colW + BAR_INSET, 9);
    expect(b.w).toBeCloseTo(colW - 2 * BAR_INSET, 9);
    expect(b.y).toBeCloseTo(2 * rowH + DAY_NUMBER_ROW_HEIGHT + 1, 9);
    expect(b.h).toBe(LANE_HEIGHT - 2);
    const tile = l.tiles.find((t) => Math.abs(t.x - (1 * colW + TILE_MARGIN)) < 1e-9 && Math.abs(t.y - (2 * rowH + TILE_MARGIN)) < 1e-9)!;
    expect(b.x).toBeGreaterThanOrEqual(tile.x);
    expect(b.x + b.w).toBeLessThanOrEqual(tile.x + tile.w);
    expect(b.y + b.h).toBeLessThanOrEqual(tile.y + tile.h);
  });

  it('spans a multi-day event across the columns it covers and no further', () => {
    const l = lay([ev('trip', 2026, 5, 16, 2)]); // Tue-Thu: columns 2-4
    const [b] = l.bars;
    expect(b.x).toBeCloseTo(2 * colW + BAR_INSET, 9);
    expect(b.x + b.w).toBeCloseTo(5 * colW - BAR_INSET, 9);
  });

  it('never lets two bars in the same lane overlap', () => {
    const l = lay([
      ev('a', 2026, 5, 15, 2), ev('b', 2026, 5, 16, 2), ev('c', 2026, 5, 18, 1), ev('d', 2026, 5, 15),
    ]);
    const rows = new Map<number, typeof l.bars>();
    for (const b of l.bars) rows.set(b.y, [...(rows.get(b.y) ?? []), b]);
    for (const list of rows.values()) {
      const sorted = [...list].sort((p, q) => p.x - q.x);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i].x).toBeGreaterThanOrEqual(sorted[i - 1].x + sorted[i - 1].w);
    }
  });

  it('keeps every bar inside its week row and off the next one, however many events there are', () => {
    const many = Array.from({ length: 12 }, (_, i) => ev(`e${i}`, 2026, 5, 15, i % 3));
    const l = lay(many);
    for (const b of l.bars) {
      const week = Math.floor(b.y / rowH);
      expect(b.y + b.h).toBeLessThanOrEqual((week + 1) * rowH - TILE_MARGIN + 1e-9);
    }
  });

  it('shows no more lanes than fit, and reports the rest as +N on the days they cover', () => {
    const many = Array.from({ length: 12 }, (_, i) => ev(`e${i}`, 2026, 5, 15));
    const l = lay(many);
    const lanes = new Set(l.bars.map((b) => b.y));
    expect(lanes.size).toBe(maxLanesFor(rowH) - 1);
    expect(l.overflows).toHaveLength(1);
    expect(l.overflows[0].text).toBe(`+${12 - (maxLanesFor(rowH) - 1)}`);
    expect(l.overflows[0].x).toBeCloseTo(1 * colW, 9);
    expect(l.overflows[0].y).toBeCloseTo(2 * rowH + DAY_NUMBER_ROW_HEIGHT + (maxLanesFor(rowH) - 1) * LANE_STRIDE + 1, 9);
  });

  it('shows all events and no +N when they fit', () => {
    const l = lay([ev('a', 2026, 5, 15), ev('b', 2026, 5, 15)]);
    expect(l.bars).toHaveLength(2);
    expect(l.overflows).toHaveLength(0);
  });

  it('carries the event colour, a readable text colour, and its title', () => {
    const [dark] = lay([ev('dark', 2026, 5, 15, 0, '#102030')]).bars;
    const [light] = lay([ev('light', 2026, 5, 15, 0, '#f0f0c0')]).bars;
    expect(dark.color).toBe('#102030');
    expect(dark.label).toBe('dark');
    expect(dark.textColor).toBe('#fff');
    expect(light.textColor).toBe('#1a1a1a');
  });

  it('uses the whole page height, so a taller page fits more lanes', () => {
    const many = Array.from({ length: 12 }, (_, i) => ev(`e${i}`, 2026, 5, 15));
    expect(lay(many, 'bars', W, 900).bars.length).toBeGreaterThan(lay(many, 'bars', W, 400).bars.length);
  });
});

describe('layoutMonthPage dots', () => {
  it('draws no bars, only up to three dots per day, one per distinct colour', () => {
    const l = lay([
      ev('a', 2026, 5, 15, 0, '#111111'), ev('b', 2026, 5, 15, 0, '#222222'), ev('c', 2026, 5, 15, 0, '#333333'),
      ev('d', 2026, 5, 15, 0, '#444444'), ev('e', 2026, 5, 16, 0, '#111111'), ev('f', 2026, 5, 16, 0, '#111111'),
    ], 'dots');
    expect(l.bars).toHaveLength(0);
    expect(l.dots.filter((d) => Math.abs(d.cx - 1.5 * colW) < colW / 2)).toHaveLength(MAX_DOTS);
    expect(l.dots.filter((d) => Math.abs(d.cx - 2.5 * colW) < colW / 2)).toHaveLength(1);
  });

  it('centres a day\'s dots under its number and below the number\'s circle', () => {
    const l = lay([ev('a', 2026, 5, 15, 0, '#111111'), ev('b', 2026, 5, 15, 0, '#222222')], 'dots');
    const mine = l.dots.filter((d) => Math.abs(d.cx - 1.5 * colW) < colW / 2);
    expect((mine[0].cx + mine[1].cx) / 2).toBeCloseTo(1.5 * colW, 9);
    expect(mine[0].cy).toBeCloseTo(2 * rowH + DOTS_TOP + DOT_RADIUS, 9);
  });

  it('has no lane grids to touch, only days', () => {
    expect(lay([ev('a', 2026, 5, 15)], 'dots').laneGrids.every((g) => g.length === 0)).toBe(true);
  });
});

describe('resolvePageTouch', () => {
  const l = lay([ev('a', 2026, 5, 15), ev('trip', 2026, 5, 16, 2)]);
  const bar = (label: string) => l.bars.find((b) => b.label === label)!;

  it('opens the event when the touch is on its bar', () => {
    const b = bar('a');
    const r = resolvePageTouch(b.x + b.w / 2, b.y + b.h / 2, l);
    expect(r.week).toBe(2);
    expect(r.hit.kind).toBe('event');
  });

  it('opens a multi-day event from a day in its middle', () => {
    const b = bar('trip');
    const r = resolvePageTouch(b.x + b.w / 2, b.y + b.h / 2, l);
    expect(r.hit).toMatchObject({ kind: 'event' });
    expect((r.hit as { segment: { event: CalendarEvent } }).segment.event.uid).toBe('trip');
  });

  it('resolves a touch below the bars, in the same column, to the day', () => {
    const b = bar('a');
    const r = resolvePageTouch(b.x + 2, b.y + 60, l);
    expect(r.week).toBe(2);
    expect(r.hit).toEqual({ kind: 'day', col: 1 });
  });

  it('resolves the day-number area to the day', () => {
    expect(resolvePageTouch(3.5 * colW, rowH + 10, l)).toEqual({ week: 1, hit: { kind: 'day', col: 3 } });
  });

  it('clamps a touch past the edges to the nearest week and column', () => {
    expect(resolvePageTouch(-50, -50, l).week).toBe(0);
    expect(resolvePageTouch(W + 50, H + 50, l)).toMatchObject({ week: weeks.length - 1, hit: { kind: 'day', col: COLS - 1 } });
  });
});
