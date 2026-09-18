import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, Dimensions,
  type GestureResponderEvent, type LayoutChangeEvent,
} from 'react-native';
import dayjs from 'dayjs';
import localizedFormat from 'dayjs/plugin/localizedFormat';
import isoWeek from 'dayjs/plugin/isoWeek';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'expo-router';
import InfinitePager, { type InfinitePagerImperativeApi } from 'react-native-infinite-pager';
import { useSettingsStore } from '@/stores/settingsStore';
import type { CalendarEvent } from '@/types';

dayjs.extend(localizedFormat);
dayjs.extend(isoWeek);

// Jumps within this many months slide (animated); farther ones re-anchor
// instantly rather than spring across a long stretch of empty months.
const MAX_ANIMATED_JUMP_MONTHS = 2;

interface Props {
  date: Date;
  events: CalendarEvent[];
  weekStartsOn: 0 | 1;
  jump: { nonce: number; target: Date };
  onSelectDate: (d: Date) => void;
  onMonthChange: (d: Date) => void;
  onPressEvent: (e: CalendarEvent) => void;
  onPressCell: (d: Date) => void;
}

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

function lastDayOf(e: CalendarEvent): dayjs.Dayjs {
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

function monthDiff(from: Date, to: Date): number {
  return (dayjs(to).year() - dayjs(from).year()) * 12 + (dayjs(to).month() - dayjs(from).month());
}

interface WeekSegment {
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

interface LanedSegment extends WeekSegment {
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

function textColorFor(bgHex: string): string {
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
const DOW_ROW_HEIGHT = 26;
const DAY_NUMBER_ROW_HEIGHT = 34;
const LANE_HEIGHT = 15;
// Gap above each lane row. A lane's real footprint is LANE_HEIGHT + LANE_GAP;
// budgeting with LANE_HEIGHT alone under-counted by 1px per lane, so bars ran
// past the bottom of the day tile in shorter rows.
const LANE_GAP = 1;
const LANE_STRIDE = LANE_HEIGHT + LANE_GAP;
// Inset of each day's rounded tile from its cell. The bottom inset comes off
// the lane budget, and event bars are inset past it so they sit inside the
// tile instead of poking out 1px on each side.
const TILE_MARGIN = 2;
const BAR_INSET = TILE_MARGIN + 1;
// Rough guess at the chrome above the grid (top bar, safe area, offline
// banner) for a synchronous first-frame estimate — see its one use below.
const ESTIMATED_CHROME_HEIGHT = 130;

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

interface MonthGridProps {
  weeks: (dayjs.Dayjs | null)[][];
  today: dayjs.Dayjs;
  eventsByDay: Map<string, CalendarEvent[]>;
  pagerHeight: number;
  // One entry per week row, or null when week numbers are off.
  weekNumbers: (number | null)[] | null;
  colors: ReturnType<typeof useTheme>['colors'];
  onDayPress: (d: dayjs.Dayjs) => void;
  onPressCell: (d: Date) => void;
  onPressEvent: (e: CalendarEvent) => void;
}

// Events covering any of this week's (non-null) days, deduped by uid. Scoping
// each week to just its own candidates keeps buildWeekSegments from re-scanning
// the whole 3-month event set 6 times per page.
function weekCandidates(week: (dayjs.Dayjs | null)[], eventsByDay: Map<string, CalendarEvent[]>): CalendarEvent[] {
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
const COLS = 7;

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

const WeekNumberGutter = memo(function WeekNumberGutter({
  numbers, color,
}: { numbers: (number | null)[]; color: string }) {
  return (
    <View style={styles.weekNumberGutter}>
      {numbers.map((n, i) => (
        <View key={i} style={styles.weekNumberCell}>
          {n !== null && (
            <Text testID="week-number" allowFontScaling={false} style={[styles.weekNumber, { color }]}>{n}</Text>
          )}
        </View>
      ))}
    </View>
  );
});

// One month's 6-week grid. Rendered per pager page so a horizontal swipe slides a
// full month in and out under the finger instead of the old swipe-then-jump.
const MonthGrid = memo(function MonthGrid({
  weeks, today, eventsByDay, pagerHeight, weekNumbers, colors, onDayPress, onPressCell, onPressEvent,
}: MonthGridProps) {
  // pagerHeight is a synchronous estimate on this page's very first render,
  // corrected in place once MonthDayViewImpl's own container is measured —
  // see its comment. Either way it's a plain number by the time it gets
  // here, so a page's own lane count is synchronous — see the comment on
  // the constants above for why that still matters.
  const rawMaxLanes = maxLanesFor(pagerHeight / weeks.length);

  // Only read when a touch lands, so a ref: measuring it must not re-render.
  const widthRef = useRef(Dimensions.get('window').width - (weekNumbers ? WEEK_NUMBER_GUTTER : 0));

  const weekLanes = useMemo(
    () => weeks.map((week) => assignLanes(buildWeekSegments(week, weekCandidates(week, eventsByDay)))),
    [weeks, eventsByDay],
  );

  return (
    <View style={styles.monthPage}>
      {weekNumbers && <WeekNumberGutter numbers={weekNumbers} color={colors.textTertiary} />}
      <View
        testID="week-area"
        style={styles.weekArea}
        onLayout={(e) => { widthRef.current = e.nativeEvent.layout.width; }}
      >
      {weeks.map((week, wi) => {
        const laned = weekLanes[wi];
        const laneCount = laned.reduce((max, s) => Math.max(max, s.lane + 1), 0);
        const hasOverflow = laneCount > rawMaxLanes;
        const visibleLanes = hasOverflow ? Math.max(0, rawMaxLanes - 1) : laneCount;

        const laneGrid: (LanedSegment | null)[][] =
          Array.from({ length: visibleLanes }, () => Array(COLS).fill(null));
        for (const seg of laned) {
          if (seg.lane >= visibleLanes) continue;
          for (let c = seg.startCol; c <= seg.endCol; c++) laneGrid[seg.lane][c] = seg;
        }

        const overflowByCol = Array<number>(COLS).fill(0);
        if (hasOverflow) {
          for (const seg of laned) {
            if (seg.lane < visibleLanes) continue;
            for (let c = seg.startCol; c <= seg.endCol; c++) overflowByCol[c] += 1;
          }
        }

        const resolve = (e: GestureResponderEvent) =>
          resolveWeekTouch(e.nativeEvent.locationX, e.nativeEvent.locationY, widthRef.current, laneGrid);

        return (
          <View key={wi} style={styles.weekRow}>
            <Pressable
              testID="week-touch"
              style={StyleSheet.absoluteFill}
              onPress={(e) => {
                const hit = resolve(e);
                if (hit.kind === 'event') { onPressEvent(hit.segment.event); return; }
                const d = week[hit.col];
                if (d) onDayPress(d);
              }}
              onLongPress={(e) => {
                const hit = resolve(e);
                const d = hit.kind === 'event' ? week[hit.segment.startCol] : week[hit.col];
                if (d) onPressCell(d.toDate());
              }}
            />
            {/* Everything visible sits above the touch surface and is inert, so
                every touch lands on the Pressable and its locationX/Y are
                relative to the week row rather than to whatever child was hit. */}
            <View pointerEvents="none" style={styles.weekContent}>
              {/* One rounded tile per day that also holds the day number, so a day is
                  two views (tile + number) instead of four (tile, number cell,
                  circle, text). The number is the circle: fixed size, radius and
                  background on the Text itself. */}
              <View style={styles.tileRow}>
                {week.map((d, di) => {
                  if (d === null) return <View key={di} style={styles.tileSlot} />;
                  const dayKey = d.format('YYYY-MM-DD');
                  const isToday = d.isSame(today, 'day');
                  return (
                    <View
                      key={di}
                      testID={isToday ? `day-today-${dayKey}` : undefined}
                      style={[styles.tileSlot, styles.tile, { backgroundColor: colors.surfaceRaised }]}
                    >
                      <Text
                        numberOfLines={1}
                        allowFontScaling={false}
                        style={[
                          styles.dayNumber,
                          {
                            borderWidth: isToday ? 1.5 : 0,
                            borderColor: colors.primary,
                            color: isToday ? colors.primary : colors.text,
                            fontWeight: isToday ? '700' : '400',
                          },
                        ]}
                      >
                        {d.date()}
                      </Text>
                    </View>
                  );
                })}
              </View>

              <View style={styles.lanesWrap}>
                {laneGrid.map((row, li) => (
                  <View key={li} testID="lane-row" style={styles.laneRow}>
                    {row.map((seg, ci) => {
                      if (!seg || ci !== seg.startCol) return null;
                      const span = seg.endCol - seg.startCol + 1;
                      // Placed by percentage of the row, so a bar lines up with its
                      // day columns exactly and needs no empty spacer views around
                      // it. The inset is padding on the slot, not a margin on
                      // anything that shares the row's width.
                      return (
                        <View
                          key={ci}
                          testID="lane-bar"
                          style={[styles.barSlot, { left: `${(seg.startCol / COLS) * 100}%`, width: `${(span / COLS) * 100}%` }]}
                        >
                          <Text
                            numberOfLines={1}
                            style={[styles.eventBar, { backgroundColor: seg.event.color, color: textColorFor(seg.event.color) }]}
                          >
                            {seg.event.summary}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                ))}
                {hasOverflow && (
                  <View style={styles.overflowRow}>
                    {overflowByCol.map((n, ci) => (
                      n > 0 && week[ci] !== null ? (
                        <Text
                          key={ci}
                          numberOfLines={1}
                          style={[
                            styles.overflowText,
                            { left: `${(ci / COLS) * 100}%`, width: `${100 / COLS}%`, color: colors.textTertiary },
                          ]}
                        >
                          +{n}
                        </Text>
                      ) : null
                    ))}
                  </View>
                )}
              </View>
            </View>
          </View>
        );
      })}
      </View>
    </View>
  );
});

interface MonthGridDotsProps {
  weeks: (dayjs.Dayjs | null)[][];
  today: dayjs.Dayjs;
  eventsByDay: Map<string, CalendarEvent[]>;
  weekNumbers: (number | null)[] | null;
  colors: ReturnType<typeof useTheme>['colors'];
  onDayPress: (d: dayjs.Dayjs) => void;
  onPressCell: (d: Date) => void;
}

// The original, simpler month cell: a day number and up to 3 small colored
// dots (one per distinct event color that day, no titles). Offered as a
// lighter-weight alternative to MonthGrid's event-bar lanes via
// settings.monthEventDisplay — no per-page height measurement needed since
// every cell is the same fixed size regardless of how many events land on it.
// Same one-touch-surface-per-week approach as MonthGrid.
const MonthGridDots = memo(function MonthGridDots({
  weeks, today, eventsByDay, weekNumbers, colors, onDayPress, onPressCell,
}: MonthGridDotsProps) {
  const widthRef = useRef(Dimensions.get('window').width - (weekNumbers ? WEEK_NUMBER_GUTTER : 0));

  return (
    <View style={styles.monthPage}>
      {weekNumbers && <WeekNumberGutter numbers={weekNumbers} color={colors.textTertiary} />}
      <View
        testID="week-area"
        style={styles.weekArea}
        onLayout={(e) => { widthRef.current = e.nativeEvent.layout.width; }}
      >
      {weeks.map((week, wi) => (
        <View key={wi} style={styles.weekRow}>
          <Pressable
            testID="week-touch"
            style={StyleSheet.absoluteFill}
            onPress={(e) => {
              const d = week[columnAt(e.nativeEvent.locationX, widthRef.current)];
              if (d) onDayPress(d);
            }}
            onLongPress={(e) => {
              const d = week[columnAt(e.nativeEvent.locationX, widthRef.current)];
              if (d) onPressCell(d.toDate());
            }}
          />
          <View pointerEvents="none" style={styles.dotsWeekRow}>
            {week.map((d, di) => {
              if (d === null) return <View key={di} style={styles.dayCell} />;
              const key = d.format('YYYY-MM-DD');
              const isToday = d.isSame(today, 'day');
              const dots = Array.from(new Set((eventsByDay.get(key) ?? []).map((e) => e.color))).slice(0, 3);

              return (
                <View
                  key={di}
                  testID={isToday ? `day-today-${key}` : undefined}
                  style={[styles.dayCell, styles.tile, { backgroundColor: colors.surfaceRaised }]}
                >
                  <Text
                    numberOfLines={1}
                    allowFontScaling={false}
                    style={[
                      styles.dayNumber,
                      {
                        borderWidth: isToday ? 1.5 : 0,
                        borderColor: colors.primary,
                        color: isToday ? colors.primary : colors.text,
                        fontWeight: isToday ? '700' : '400',
                      },
                    ]}
                  >
                    {d.date()}
                  </Text>
                  <View style={styles.dotsRow}>
                    {dots.map((color, ci) => (
                      <View key={ci} testID="month-event-dot" style={[styles.dot, { backgroundColor: color }]} />
                    ))}
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ))}
      </View>
    </View>
  );
});

function MonthDayViewImpl({ date, events, weekStartsOn, jump, onSelectDate, onMonthChange, onPressEvent, onPressCell }: Props) {
  const theme = useTheme();
  const language = useSettingsStore((s) => s.language);
  const monthEventDisplay = useSettingsStore((s) => s.monthEventDisplay);
  const showWeekNumbers = useSettingsStore((s) => s.showWeekNumbers);
  const { t } = useTranslation();

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      for (const key of eventDayKeys(ev)) {
        let list = map.get(key);
        if (!list) { list = []; map.set(key, list); }
        list.push(ev);
      }
    }
    return map;
  }, [events]);

  const todayKey = dayjs().format('YYYY-MM-DD');
  const today = useMemo(() => dayjs(todayKey), [todayKey]);

  const handleDayPress = useCallback((d: dayjs.Dayjs) => {
    onSelectDate(d.toDate());
  }, [onSelectDate]);

  const dayHeaders = useMemo(() => {
    const headers: string[] = [];
    for (let i = 0; i < 7; i++) {
      const dow = (weekStartsOn + i) % 7;
      headers.push(dayjs().day(dow).locale(language).format('dd'));
    }
    return headers;
  }, [weekStartsOn, language]);

  // The grid now fills the whole screen (no day list below it to size
  // against), so its height comes from measuring the container instead of a
  // fixed ratio. Seeded with a rough synchronous estimate so there's a
  // sensible lane count from this component's very first render (avoiding
  // the exact per-page flash MonthGrid's own comment describes), then
  // corrected in place once the container's real onLayout lands a frame
  // later — a one-time correction here, not a per-page one, so it isn't the
  // repeated-on-every-swipe version of that same problem.
  const [measuredGridHeight, setMeasuredGridHeight] = useState(
    () => Dimensions.get('window').height - ESTIMATED_CHROME_HEIGHT,
  );
  const handleGridLayout = useCallback((e: LayoutChangeEvent) => {
    setMeasuredGridHeight(e.nativeEvent.layout.height);
  }, []);
  const pagerHeight = measuredGridHeight - DOW_ROW_HEIGHT;

  // The pager pages by whole months: page `index` renders the month `index`
  // months from `localAnchor`. localAnchor is only reset on an external jump
  // (Today button, mode switch); ordinary swiping runs the index up and down
  // without re-anchoring, so paging never fights its own state.
  const [localAnchor, setLocalAnchor] = useState(date);
  const [pagerKey, setPagerKey] = useState(0);
  const pagerRef = useRef<InfinitePagerImperativeApi>(null);
  const localAnchorRef = useRef(localAnchor); localAnchorRef.current = localAnchor;
  const settledIndexRef = useRef(0);
  // Target index of an in-flight programmatic jump; while set, page-change
  // callbacks are the animation crossing months, not a user swipe, so they must
  // not report a month change (the parent already holds the jumped-to date).
  const jumpTargetRef = useRef<number | null>(null);

  // Re-anchor remounts the pager on a fresh key. A far jump's setPage would
  // write `translate` across a gap wider than the page buffer, leaving the
  // mounted pages several widths off-screen (blank) until curIndex caught up a
  // frame later. A remounted pager comes up at index 0 with translate 0,
  // consistent from its first commit. useLayoutEffect, not useEffect: the render
  // that carries the new anchor still sits on the old index, so it must not
  // paint — landing page 0 before paint removes the blank frame.
  const firstAnchorReset = useRef(true);
  useLayoutEffect(() => {
    if (firstAnchorReset.current) { firstAnchorReset.current = false; return; }
    settledIndexRef.current = 0;
    setPagerKey((k) => k + 1);
  }, [localAnchor]);

  const firstJump = useRef(true);
  useEffect(() => {
    if (firstJump.current) { firstJump.current = false; return; }
    const target = monthDiff(localAnchorRef.current, jump.target);
    const from = settledIndexRef.current;
    // Ignore jumps that land on the month already shown (e.g. tapping a day in
    // the current month).
    if (target === from) return;
    // Near jump (Today from a nearby month): slide to it like the other views.
    // At most MAX_ANIMATED_JUMP_MONTHS so the spring never crosses a page the
    // buffer has not mounted yet.
    if (Math.abs(target - from) <= MAX_ANIMATED_JUMP_MONTHS) {
      jumpTargetRef.current = target;
      settledIndexRef.current = target;
      pagerRef.current?.setPage(target, { animated: true });
      return;
    }
    // Too far to animate: re-anchor. The layout effect above remounts the pager
    // at index 0 on the new anchor, swapping months in a single commit rather
    // than blanking while the pager catches up.
    setLocalAnchor(jump.target);
  }, [jump]);

  const handlePageChange = useCallback((index: number) => {
    const prev = settledIndexRef.current;
    settledIndexRef.current = index;
    if (jumpTargetRef.current !== null) {
      if (index === jumpTargetRef.current) jumpTargetRef.current = null;
      return;
    }
    // InfinitePager emits the current page once on mount (and after a remount);
    // that echo is not a swipe. Only a real change of page reports a new month,
    // which also avoids a setState firing into the parent's render.
    if (index === prev) return;
    onMonthChange(dayjs(localAnchorRef.current).add(index, 'month').startOf('month').toDate());
  }, [onMonthChange]);

  // A month's grid (and its week numbers) is built once and reused. renderPage
  // runs again on every swipe, and a fresh weeks array each time made every
  // page's props differ, so React re-rendered all three mounted months and
  // rebuilt their lane layout right as the next swipe was starting. No page
  // depends on the date being shown (there is no selected day: a swipe reports
  // the 1st of the new month, which used to light up as a blue circle), so a
  // swipe now leaves every page's props identical.
  const gridCache = useRef(new Map<string, { weeks: (dayjs.Dayjs | null)[][]; weekNumbers: (number | null)[] | null }>());
  const gridFor = useCallback((m: dayjs.Dayjs) => {
    const key = `${m.year()}-${m.month()}-${weekStartsOn}-${showWeekNumbers}`;
    let hit = gridCache.current.get(key);
    if (!hit) {
      if (gridCache.current.size >= 24) gridCache.current.clear();
      const weeks = buildMonthGrid(m.year(), m.month(), weekStartsOn);
      hit = {
        weeks,
        weekNumbers: showWeekNumbers ? weeks.map((w) => weekNumberFor(w, weekStartsOn)) : null,
      };
      gridCache.current.set(key, hit);
    }
    return hit;
  }, [weekStartsOn, showWeekNumbers]);

  const renderPage = useCallback(({ index }: { index: number }) => {
    const m = dayjs(localAnchor).add(index, 'month');
    const { weeks, weekNumbers } = gridFor(m);
    return monthEventDisplay === 'dots' ? (
      <MonthGridDots
        weeks={weeks}
        today={today}
        eventsByDay={eventsByDay}
        weekNumbers={weekNumbers}
        colors={theme.colors}
        onDayPress={handleDayPress}
        onPressCell={onPressCell}
      />
    ) : (
      <MonthGrid
        weeks={weeks}
        today={today}
        eventsByDay={eventsByDay}
        pagerHeight={pagerHeight}
        weekNumbers={weekNumbers}
        colors={theme.colors}
        onDayPress={handleDayPress}
        onPressCell={onPressCell}
        onPressEvent={onPressEvent}
      />
    );
  }, [
    localAnchor, gridFor, monthEventDisplay, today, eventsByDay, pagerHeight,
    theme.colors, handleDayPress, onPressCell, onPressEvent,
  ]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
      <View style={styles.grid} onLayout={handleGridLayout}>
        <View style={styles.dowRow}>
          {showWeekNumbers && (
            <Text style={[styles.dowLabel, styles.weekNumberHeader, { color: theme.colors.textTertiary }]}>
              {t('calendar.weekAbbr')}
            </Text>
          )}
          {dayHeaders.map((d, i) => (
            <Text key={i} style={[styles.dowLabel, { color: theme.colors.textTertiary }]}>{d}</Text>
          ))}
        </View>

        <View style={styles.pagerWrap}>
          <InfinitePager
            key={pagerKey}
            ref={pagerRef}
            style={styles.fill}
            pageWrapperStyle={styles.fill}
            renderPage={renderPage}
            onPageChange={handlePageChange}
            pageBuffer={1}
          />
        </View>
      </View>
    </View>
  );
}

export const MonthDayView = memo(MonthDayViewImpl);

const styles = StyleSheet.create({
  container: { flex: 1 },
  fill: { flex: 1 },
  grid: { flex: 1 },
  dowRow: { flexDirection: 'row', paddingVertical: 6 },
  dowLabel: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  pagerWrap: { flex: 1 },
  monthPage: { flex: 1, flexDirection: 'row' },
  weekArea: { flex: 1 },
  weekNumberGutter: { width: WEEK_NUMBER_GUTTER },
  weekNumberCell: { flex: 1, alignItems: 'center' },
  // Same box as the day number beside it so the two centre on one line.
  weekNumber: { marginTop: TILE_MARGIN, height: 32, lineHeight: 32, fontSize: 10, fontWeight: '600', textAlign: 'center', includeFontPadding: false },
  weekNumberHeader: { flex: 0, width: WEEK_NUMBER_GUTTER },
  weekRow: { flex: 1 },
  weekContent: { flex: 1 },
  tileRow: { flexDirection: 'row', position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  tileSlot: { flex: 1 },
  tile: { margin: TILE_MARGIN, borderRadius: 10 },
  // The day number and its highlight circle are one Text: fixed 32px box,
  // fully rounded, centred glyph.
  dayNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    overflow: 'hidden',
    fontSize: 14,
    lineHeight: 32,
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  // MonthGridDots only:
  dotsWeekRow: { flex: 1, flexDirection: 'row' },
  dayCell: { flex: 1, alignItems: 'center', paddingTop: 2 },
  dotsRow: { flexDirection: 'row', gap: 2, marginTop: 2 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  // Sits under the day number (which now lives in the tile), so it can't be
  // in normal flow after it.
  lanesWrap: { position: 'absolute', top: DAY_NUMBER_ROW_HEIGHT, left: 0, right: 0 },
  laneRow: { height: LANE_HEIGHT, marginTop: LANE_GAP },
  barSlot: { position: 'absolute', top: 0, paddingHorizontal: BAR_INSET },
  eventBar: {
    borderRadius: 3,
    overflow: 'hidden',
    paddingHorizontal: 3,
    height: LANE_HEIGHT - 2,
    lineHeight: LANE_HEIGHT - 2,
    fontSize: 9,
    fontWeight: '600',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  overflowRow: { height: LANE_HEIGHT, marginTop: LANE_GAP },
  overflowText: { position: 'absolute', top: 0, textAlign: 'center', fontSize: 9, fontWeight: '600' },
});
