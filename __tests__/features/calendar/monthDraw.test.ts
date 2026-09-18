import dayjs from 'dayjs';
import { buildMonthGrid, layoutMonthPage } from '@/features/calendar/monthGrid/monthLayout';
import { clearMonthDrawCaches, drawMonthPage } from '@/features/calendar/monthGrid/monthDraw';
import type { CalendarEvent } from '@/types';

// A recording stand-in for Skia: what matters here is what gets drawn where,
// not pixels.
const mockCalls: { op: string; args: unknown[] }[] = [];
const mockMake = jest.fn();
const mockAddText = jest.fn();
const mockPushStyle = jest.fn();
const mockLayout = jest.fn();

jest.mock('@shopify/react-native-skia', () => {
  const paint = () => ({ setAntiAlias: jest.fn(), setColor: jest.fn(), setStyle: jest.fn(), setStrokeWidth: jest.fn() });
  return {
    Skia: {
      Paint: jest.fn(paint),
      Color: (c: string) => `color(${c})`,
      XYWHRect: (x: number, y: number, w: number, h: number) => ({ x, y, w, h }),
      RRectXY: (rect: unknown, rx: number, ry: number) => ({ rect, rx, ry }),
      ParagraphBuilder: {
        Make: (...a: unknown[]) => {
          mockMake(...a);
          const builder = {
            pushStyle: (...b: unknown[]) => { mockPushStyle(...b); return builder; },
            addText: (t: string) => { mockAddText(t); return builder; },
            build: () => ({
              layout: (w: number) => mockLayout(w),
              paint: (_c: unknown, x: number, y: number) => mockCalls.push({ op: 'paragraph', args: [x, y] }),
              getHeight: () => 10,
            }),
          };
          return builder;
        },
      },
    },
    PaintStyle: { Fill: 0, Stroke: 1 },
    TextAlign: { Left: 0, Right: 1, Center: 2 },
    FontWeight: { Normal: 400, SemiBold: 600, Bold: 700 },
  };
});

const canvas = {
  drawRRect: (...a: unknown[]) => mockCalls.push({ op: 'rrect', args: a }),
  drawCircle: (...a: unknown[]) => mockCalls.push({ op: 'circle', args: a }),
} as never;

const weeks = buildMonthGrid(2026, 5, 0);
const today = dayjs(new Date(2026, 5, 17));
const palette = { tile: '#eee', primary: '#00f', text: '#111', textTertiary: '#999' };
const W = 700;
const H = 600;

const ev = (uid: string, d: number, span = 0, color = '#0082c9', summary = uid): CalendarEvent => ({
  uid, href: `/${uid}.ics`, calendarId: 'c', accountId: 'a', summary,
  dtstart: new Date(2026, 5, d, 9), dtend: new Date(2026, 5, d + span, 10),
  allDay: false, color, attendees: [], isRecurring: false,
});
function byDay(events: CalendarEvent[]) {
  const map = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    for (let d = dayjs(e.dtstart).startOf('day'); !d.isAfter(dayjs(e.dtend), 'day'); d = d.add(1, 'day')) {
      const k = d.format('YYYY-MM-DD');
      map.set(k, [...(map.get(k) ?? []), e]);
    }
  }
  return map;
}
const draw = (events: CalendarEvent[], mode: 'bars' | 'dots' = 'bars') => {
  const layout = layoutMonthPage({ weeks, eventsByDay: byDay(events), width: W, height: H, mode, today });
  drawMonthPage(canvas, layout, palette);
  return layout;
};
const count = (op: string) => mockCalls.filter((c) => c.op === op).length;

beforeEach(() => {
  mockCalls.length = 0;
  [mockMake, mockAddText, mockPushStyle, mockLayout].forEach((m) => m.mockClear());
  clearMonthDrawCaches();
});

describe('drawMonthPage', () => {
  it('draws a rounded rect for every day tile and every event bar', () => {
    const layout = draw([ev('a', 15), ev('trip', 16, 2)]);
    expect(count('rrect')).toBe(layout.tiles.length + layout.bars.length);
    expect(layout.bars).toHaveLength(2);
  });

  it('rings today and nothing else', () => {
    draw([]);
    expect(count('circle')).toBe(1);
    const [cx, cy, r] = mockCalls.find((c) => c.op === 'circle')!.args as number[];
    // Today, Jun 17, is a Wednesday: column 3, on the row below the first.
    expect(cx).toBeCloseTo(3.5 * (W / 7), 9);
    expect(cy).toBeCloseTo((H / weeks.length) * 2 + 18, 9);
    expect(r).toBeCloseTo(16 - 0.75, 9);
  });

  it('paints one paragraph per day number, event title and +N', () => {
    const many = Array.from({ length: 12 }, (_, i) => ev(`e${i}`, 15));
    const layout = draw(many);
    expect(count('paragraph')).toBe(layout.numbers.length + layout.bars.length + layout.overflows.length);
    expect(layout.overflows.length).toBeGreaterThan(0);
  });

  it('draws a title inside its bar, padded, vertically centred, and laid out to the bar\'s inner width', () => {
    const layout = draw([ev('Standup', 15)]);
    const bar = layout.bars[0];
    expect(mockAddText).toHaveBeenCalledWith('Standup');
    const painted = mockCalls.filter((c) => c.op === 'paragraph').map((c) => c.args as number[]);
    expect(painted).toContainEqual([bar.x + 3, bar.y + (bar.h - 10) / 2]);
    expect(mockLayout).toHaveBeenCalledWith(bar.w - 6);
  });

  it('asks for a single line with an ellipsis, so long titles are cut inside the bar', () => {
    draw([ev('a', 15, 0, '#0082c9', 'A very long event title that cannot possibly fit')]);
    expect(mockMake).toHaveBeenCalledWith(expect.objectContaining({ maxLines: 1, ellipsis: '…' }));
  });

  it('passes titles through untouched, emoji and non-Latin included, for Skia to shape and fall back on', () => {
    draw([ev('a', 15, 0, '#0082c9', 'Birthday 🎂 Привет')]);
    expect(mockAddText).toHaveBeenCalledWith('Birthday 🎂 Привет');
  });

  it('names an emoji fallback font next to the main one', () => {
    draw([ev('a', 15)]);
    const families = (mockPushStyle.mock.calls[0][0] as { fontFamilies: string[] }).fontFamilies;
    expect(families.length).toBeGreaterThanOrEqual(2);
    expect(families.join(' ')).toMatch(/Emoji/);
  });

  it('reuses the laid-out paragraph for a number or title it has already built', () => {
    draw([]);
    const first = mockMake.mock.calls.length;
    mockCalls.length = 0;
    draw([]);
    expect(mockMake.mock.calls.length).toBe(first);
    expect(count('paragraph')).toBeGreaterThan(0);
  });

  it('draws today\'s number in the accent colour and bold, others in the text colour', () => {
    draw([]);
    const colors = mockPushStyle.mock.calls.map((c) => (c[0] as { color: string }).color);
    expect(colors).toContain('color(#00f)');
    expect(colors).toContain('color(#111)');
  });

  it('draws event colours as fills and dots as small circles in dots mode', () => {
    const layout = draw([ev('a', 15, 0, '#111111'), ev('b', 15, 0, '#222222')], 'dots');
    expect(layout.bars).toHaveLength(0);
    // 1 ring for today + 2 dots
    expect(count('circle')).toBe(3);
  });
});
