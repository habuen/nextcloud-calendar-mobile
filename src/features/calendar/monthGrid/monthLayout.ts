import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import type { CalendarEvent } from '@/types';

dayjs.extend(isoWeek);

// Pure month-grid logic shared by both renderers (the view-based MonthGrid and
// the Skia canvas one) and the tests: which days a month shows, how events are
// clipped and stacked into lanes, week numbers, and how a touch maps to a day
// or an event. Nothing here touches React or React Native.

export function buildMonthGrid(year: number, month: number, weekStartsOn: 0 | 1): (dayjs.Dayjs | null)[][] {
  const firstOfMonth = dayjs(new Date(year, month, 1));

  const offset = (firstOfMonth.day() - weekStartsOn + 7) % 7;

  const rows: (dayjs.Dayjs | null)[][] = [];
  let cursor = firstOfMonth.subtract(offset, 'day');
  for (let row = 0; row < 6; row++) {
    const week: (dayjs.Dayjs | null)[] = [];
    for (let col = 0; col < 7; col++) {
      week.push(cursor.month() === month ? cursor : null);
      cursor = cursor.add(1, 'day');
    }
    const allNull = week.every((d) => d === null);
    if (allNull) break;
    rows.push(week);
    if (cursor.month() !== month && row >= 3) break;
  }
  return rows;
}

export function lastDayOf(e: CalendarEvent): dayjs.Dayjs {
  const end = dayjs(e.dtend);
  if (e.allDay) return end.startOf('day');
  return (end.isSame(end.startOf('day')) ? end.subtract(1, 'millisecond') : end).startOf('day');
}

export function eventDayKeys(e: CalendarEvent): string[] {
  const start = dayjs(e.dtstart);
  const startKey = start.format('YYYY-MM-DD');
  const endDay = lastDayOf(e);
  const keys: string[] = [];
  let cur = start.startOf('day');
  while (!cur.isAfter(endDay, 'day') && keys.length <= 366) {
    keys.push(cur.format('YYYY-MM-DD'));
    cur = cur.add(1, 'day');
  }
  return keys.length ? keys : [startKey];
}

export function eventCoversDay(e: CalendarEvent, dayKey: string): boolean {
  const startKey = dayjs(e.dtstart).format('YYYY-MM-DD');
  const endKey = lastDayOf(e).format('YYYY-MM-DD');
  return dayKey >= startKey && dayKey <= (endKey < startKey ? startKey : endKey);
}

export interface WeekSegment {
  event: CalendarEvent;
  startCol: number;
  endCol: number;
}

// Clips each event to the columns of `week` it actually covers (columns outside
// the displayed month are null and never included, so a clipped range is always
// contiguous). Single-day events get startCol === endCol.
export function buildWeekSegments(week: (dayjs.Dayjs | null)[], events: CalendarEvent[]): WeekSegment[] {
  const segments: WeekSegment[] = [];
  for (const e of events) {
    const startDay = dayjs(e.dtstart).startOf('day');
    const endDay = lastDayOf(e);
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

export interface LanedSegment extends WeekSegment {
  lane: number;
}

// Greedy interval-graph coloring: events are stacked into the lowest lane whose
// last-placed segment ends before this one starts, so overlapping date ranges
// never share a lane. Longer spans are placed first among same-start events so
// multi-day bars tend to claim the top rows, matching typical calendar layouts.
export function assignLanes(segments: WeekSegment[]): LanedSegment[] {
  const sorted = [...segments].sort((a, b) =>
    a.startCol - b.startCol
    || (b.endCol - b.startCol) - (a.endCol - a.startCol)
    || a.event.dtstart.getTime() - b.event.dtstart.getTime());
  const laneEndCols: number[] = [];
  const placed: LanedSegment[] = [];
  for (const seg of sorted) {
    let lane = laneEndCols.findIndex((end) => end < seg.startCol);
    if (lane === -1) {
      lane = laneEndCols.length;
      laneEndCols.push(seg.endCol);
    } else {
      laneEndCols[lane] = seg.endCol;
    }
    placed.push({ ...seg, lane });
  }
  return placed;
}

export function textColorFor(bgHex: string): string {
  const hex = bgHex.replace('#', '');
  if (hex.length !== 6) return '#fff';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#1a1a1a' : '#fff';
}

// Must track the rendered size of dowRow / the day number / laneRow below so the lane
// count fits the cell instead of over- or under-filling it. Kept as constants
// (not measured via onLayout) so the right lane count is known on a page's
// very first render — an async measure-then-correct pass would otherwise pop
// extra event bars in a frame after every freshly mounted month, worst on a
// far jump (e.g. the Today button) where the page has no pre-buffered mount
// time to absorb the correction before it's shown.
export const DOW_ROW_HEIGHT = 26;
export const DAY_NUMBER_ROW_HEIGHT = 34;
export const LANE_HEIGHT = 15;
// Gap above each lane row. A lane's real footprint is LANE_HEIGHT + LANE_GAP;
// budgeting with LANE_HEIGHT alone under-counted by 1px per lane, so bars ran
// past the bottom of the day tile in shorter rows.
export const LANE_GAP = 1;
export const LANE_STRIDE = LANE_HEIGHT + LANE_GAP;
// Inset of each day's rounded tile from its cell. The bottom inset comes off
// the lane budget, and event bars are inset past it so they sit inside the
// tile instead of poking out 1px on each side.
export const TILE_MARGIN = 2;
export const BAR_INSET = TILE_MARGIN + 1;
// Width of the optional week-number column to the left of the seven day
// columns. It sits OUTSIDE them: the day columns, bar placement and touch
// hit-testing all work on the week area beside it, so showing it narrows that
// area but can't shift a bar off its day (which is how the earlier margin bug
// happened — anything that shares the columns' width has to be inside them).
export const WEEK_NUMBER_GUTTER = 26;

// ISO week number for a week row, taken from the row's Thursday (the ISO rule
// for which week a row belongs to), so a row spanning two ISO weeks — every
// Sunday-first row does — shows the one most of it is in. Columns outside the
// month are null in the grid, so the Thursday is derived from any real day in
// the row rather than read directly.
export function weekNumberFor(week: (dayjs.Dayjs | null)[], weekStartsOn: 0 | 1): number | null {
  const col = week.findIndex((d) => d !== null);
  if (col === -1) return null;
  const thursdayCol = (4 - weekStartsOn + 7) % 7;
  return week[col]!.add(thursdayCol - col, 'day').isoWeek();
}

// How many lane rows (event bars, or the "+N" row) fit under the day number
// inside a week row of `rowHeight`, without running past the day tile's bottom.
export function maxLanesFor(rowHeight: number): number {
  return Math.max(0, Math.floor((rowHeight - DAY_NUMBER_ROW_HEIGHT - TILE_MARGIN) / LANE_STRIDE));
}

// Events covering any of this week's (non-null) days, deduped by uid. Scoping
// each week to just its own candidates keeps buildWeekSegments from re-scanning
// the whole 3-month event set 6 times per page.
export function weekCandidates(week: (dayjs.Dayjs | null)[], eventsByDay: Map<string, CalendarEvent[]>): CalendarEvent[] {
  const seen = new Map<string, CalendarEvent>();
  for (const d of week) {
    if (!d) continue;
    const dayList = eventsByDay.get(d.format('YYYY-MM-DD'));
    if (!dayList) continue;
    for (const e of dayList) seen.set(e.uid, e);
  }
  return Array.from(seen.values());
}

// Touch handling. Each week row has ONE touch surface and works out what was
// hit from where the finger landed, instead of every day tile, day number,
// lane cell and bar being its own touchable. A month page used to mount ~116
// touchables (each an Animated view plus press state), all built on the JS
// thread as the page swiped in, which is what made fast swiping stutter.
export const COLS = 7;

// Which of the seven day columns a touch at horizontal offset `x` is in.
export function columnAt(x: number, width: number): number {
  if (width <= 0) return 0;
  return Math.min(COLS - 1, Math.max(0, Math.floor((x / width) * COLS)));
}

// Which lane row (0-based) a touch at vertical offset `y` within a week is in,
// or -1 above the lanes, in the day-number area.
export function laneAt(y: number): number {
  return y < DAY_NUMBER_ROW_HEIGHT ? -1 : Math.floor((y - DAY_NUMBER_ROW_HEIGHT) / LANE_STRIDE);
}

export type WeekTouch =
  | { kind: 'event'; segment: LanedSegment }
  | { kind: 'day'; col: number };

// laneGrid[lane][col] holds the segment covering that column (in every column
// it spans, not just where it starts), or null for an empty slot.
export function resolveWeekTouch(
  x: number,
  y: number,
  width: number,
  laneGrid: (LanedSegment | null)[][],
): WeekTouch {
  const col = columnAt(x, width);
  const segment = laneGrid[laneAt(y)]?.[col];
  return segment ? { kind: 'event', segment } : { kind: 'day', col };
}


// ---------------------------------------------------------------------------
// Whole-page layout, for the canvas renderer: every tile, number, bar, "+N" and
// dot as plain coordinates, so drawing is a loop over shapes and everything
// about where things go can be unit-tested without a canvas.
// ---------------------------------------------------------------------------

export interface Rect { x: number; y: number; w: number; h: number }
export interface PageNumber { cx: number; cy: number; text: string; today: boolean }
export interface PageBar extends Rect { color: string; textColor: string; label: string }
export interface PageOverflow extends Rect { text: string }
export interface PageDot { cx: number; cy: number; color: string }

export interface MonthPageLayout {
  width: number;
  height: number;
  rowHeight: number;
  tiles: Rect[];
  numbers: PageNumber[];
  bars: PageBar[];
  overflows: PageOverflow[];
  dots: PageDot[];
  // Per week row: the segment covering each lane/column, for touch resolution.
  laneGrids: (LanedSegment | null)[][][];
}

export const NUMBER_RADIUS = 16;
// The number's circle sits at the top of its tile. Bars mode: tile margin then
// the circle; dots mode has 2px extra padding above it and the dots below.
export const NUMBER_CY = TILE_MARGIN + NUMBER_RADIUS;
export const DOTS_NUMBER_CY = TILE_MARGIN + 2 + NUMBER_RADIUS;
export const DOT_RADIUS = 2.5;
export const DOT_GAP = 2;
export const DOTS_TOP = TILE_MARGIN + 2 + NUMBER_RADIUS * 2 + 2;
export const MAX_DOTS = 3;

export function layoutMonthPage(opts: {
  weeks: (dayjs.Dayjs | null)[][];
  eventsByDay: Map<string, CalendarEvent[]>;
  width: number;
  height: number;
  mode: 'bars' | 'dots';
  today: dayjs.Dayjs;
}): MonthPageLayout {
  const { weeks, eventsByDay, width, height, mode, today } = opts;
  const rowHeight = height / weeks.length;
  const colW = width / COLS;
  const maxLanes = maxLanesFor(rowHeight);

  const tiles: Rect[] = [];
  const numbers: PageNumber[] = [];
  const bars: PageBar[] = [];
  const overflows: PageOverflow[] = [];
  const dots: PageDot[] = [];
  const laneGrids: (LanedSegment | null)[][][] = [];

  weeks.forEach((week, wi) => {
    const y0 = wi * rowHeight;

    week.forEach((d, c) => {
      if (!d) return;
      tiles.push({
        x: c * colW + TILE_MARGIN,
        y: y0 + TILE_MARGIN,
        w: colW - 2 * TILE_MARGIN,
        h: rowHeight - 2 * TILE_MARGIN,
      });
      const cx = c * colW + colW / 2;
      numbers.push({
        cx,
        cy: y0 + (mode === 'dots' ? DOTS_NUMBER_CY : NUMBER_CY),
        text: String(d.date()),
        today: d.isSame(today, 'day'),
      });

      if (mode === 'dots') {
        const colors = Array.from(new Set((eventsByDay.get(d.format('YYYY-MM-DD')) ?? []).map((e) => e.color)))
          .slice(0, MAX_DOTS);
        const total = colors.length * DOT_RADIUS * 2 + (colors.length - 1) * DOT_GAP;
        colors.forEach((color, i) => {
          dots.push({
            cx: cx - total / 2 + DOT_RADIUS + i * (DOT_RADIUS * 2 + DOT_GAP),
            cy: y0 + DOTS_TOP + DOT_RADIUS,
            color,
          });
        });
      }
    });

    if (mode === 'dots') { laneGrids.push([]); return; }

    const laned = assignLanes(buildWeekSegments(week, weekCandidates(week, eventsByDay)));
    const laneCount = laned.reduce((max, s) => Math.max(max, s.lane + 1), 0);
    const hasOverflow = laneCount > maxLanes;
    const visibleLanes = hasOverflow ? Math.max(0, maxLanes - 1) : laneCount;

    const grid: (LanedSegment | null)[][] =
      Array.from({ length: visibleLanes }, () => Array(COLS).fill(null));
    const overflowByCol = Array<number>(COLS).fill(0);
    for (const seg of laned) {
      if (seg.lane >= visibleLanes) {
        for (let c = seg.startCol; c <= seg.endCol; c++) overflowByCol[c] += 1;
        continue;
      }
      for (let c = seg.startCol; c <= seg.endCol; c++) grid[seg.lane][c] = seg;
      bars.push({
        x: seg.startCol * colW + BAR_INSET,
        y: y0 + DAY_NUMBER_ROW_HEIGHT + seg.lane * LANE_STRIDE + LANE_GAP,
        w: (seg.endCol - seg.startCol + 1) * colW - 2 * BAR_INSET,
        h: LANE_HEIGHT - 2,
        color: seg.event.color,
        textColor: textColorFor(seg.event.color),
        label: seg.event.summary,
      });
    }
    laneGrids.push(grid);

    if (hasOverflow) {
      overflowByCol.forEach((n, c) => {
        if (n === 0 || !week[c]) return;
        overflows.push({
          x: c * colW,
          y: y0 + DAY_NUMBER_ROW_HEIGHT + visibleLanes * LANE_STRIDE + LANE_GAP,
          w: colW,
          h: LANE_HEIGHT,
          text: `+${n}`,
        });
      });
    }
  });

  return { width, height, rowHeight, tiles, numbers, bars, overflows, dots, laneGrids };
}

// Which week row and what within it a touch at (x, y) on the whole page hits.
export function resolvePageTouch(
  x: number,
  y: number,
  layout: Pick<MonthPageLayout, 'width' | 'rowHeight' | 'laneGrids'>,
): { week: number; hit: WeekTouch } {
  const rows = layout.laneGrids.length;
  const week = Math.min(rows - 1, Math.max(0, Math.floor(y / layout.rowHeight)));
  const withinWeek = y - week * layout.rowHeight;
  return { week, hit: resolveWeekTouch(x, withinWeek, layout.width, layout.laneGrids[week] ?? []) };
}
