import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Dimensions, type LayoutChangeEvent,
} from 'react-native';
import dayjs from 'dayjs';
import localizedFormat from 'dayjs/plugin/localizedFormat';
import { useTheme } from 'expo-router';
import InfinitePager, { type InfinitePagerImperativeApi } from 'react-native-infinite-pager';
import { useSettingsStore } from '@/stores/settingsStore';
import type { CalendarEvent } from '@/types';

dayjs.extend(localizedFormat);

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

// Must track the rendered size of dowRow/numberRow/laneRow below so the lane
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

// How many lane rows (event bars, or the "+N" row) fit under the day number
// inside a week row of `rowHeight`, without running past the day tile's bottom.
export function maxLanesFor(rowHeight: number): number {
  return Math.max(0, Math.floor((rowHeight - DAY_NUMBER_ROW_HEIGHT - TILE_MARGIN) / LANE_STRIDE));
}

interface MonthGridProps {
  weeks: (dayjs.Dayjs | null)[][];
  selected: dayjs.Dayjs;
  today: dayjs.Dayjs;
  eventsByDay: Map<string, CalendarEvent[]>;
  pagerHeight: number;
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

// One month's 6-week grid. Rendered per pager page so a horizontal swipe slides a
// full month in and out under the finger instead of the old swipe-then-jump.
const MonthGrid = memo(function MonthGrid({
  weeks, selected, today, eventsByDay, pagerHeight, colors, onDayPress, onPressCell, onPressEvent,
}: MonthGridProps) {
  // pagerHeight is a synchronous estimate on this page's very first render,
  // corrected in place once MonthDayViewImpl's own container is measured —
  // see its comment. Either way it's a plain number by the time it gets
  // here, so a page's own lane count is synchronous — see the comment on
  // the constants above for why that still matters.
  const rawMaxLanes = maxLanesFor(pagerHeight / weeks.length);

  const weekLanes = useMemo(
    () => weeks.map((week) => assignLanes(buildWeekSegments(week, weekCandidates(week, eventsByDay)))),
    [weeks, eventsByDay],
  );

  return (
    <View style={styles.monthPage}>
      {weeks.map((week, wi) => {
        const laned = weekLanes[wi];
        const laneCount = laned.reduce((max, s) => Math.max(max, s.lane + 1), 0);
        const hasOverflow = laneCount > rawMaxLanes;
        const visibleLanes = hasOverflow ? Math.max(0, rawMaxLanes - 1) : laneCount;

        // laneGrid[lane][col]: the segment starting there, 'cont' for a column a
        // wider bar already covers (skipped, its flex width spans over it), or
        // null for an empty, still-tappable slot.
        const laneGrid: (LanedSegment | 'cont' | null)[][] =
          Array.from({ length: visibleLanes }, () => Array(7).fill(null));
        for (const seg of laned) {
          if (seg.lane >= visibleLanes) continue;
          for (let c = seg.startCol; c <= seg.endCol; c++) {
            laneGrid[seg.lane][c] = c === seg.startCol ? seg : 'cont';
          }
        }

        const overflowByCol = Array<number>(7).fill(0);
        if (hasOverflow) {
          for (const seg of laned) {
            if (seg.lane < visibleLanes) continue;
            for (let c = seg.startCol; c <= seg.endCol; c++) overflowByCol[c] += 1;
          }
        }

        return (
          <View key={wi} style={styles.weekRow}>
            {/* Behind everything else: one rounded, lighter-tinted tile per day,
                spanning the whole week's height. Painted first (so it sits behind
                the number/lane content rendered after it) and covers the entire
                square, so a tap anywhere NOT already caught by a more specific
                touchable (day number, event bar, spacer/overflow cell) still
                reaches this and opens day view — closing the dead zones that used
                to exist below a mostly-empty day's lane bars. */}
            <View style={styles.tileRow} pointerEvents="box-none">
              {week.map((d, di) => {
                if (d === null) return <View key={di} style={styles.tileSlot} />;
                return (
                  <TouchableOpacity
                    key={di}
                    testID={`day-tile-${d.format('YYYY-MM-DD')}`}
                    style={[styles.tileSlot, styles.tile, { backgroundColor: colors.surfaceRaised }]}
                    onPress={() => onDayPress(d)}
                    onLongPress={() => onPressCell(d.toDate())}
                  />
                );
              })}
            </View>
            <View style={styles.numberRow}>
              {week.map((d, di) => {
                if (d === null) {
                  return <View key={di} style={styles.numberCell} />;
                }
                const isToday = d.isSame(today, 'day');
                const isSelected = d.isSame(selected, 'day');

                return (
                  <TouchableOpacity
                    key={di}
                    testID={isSelected ? `day-selected-${d.format('YYYY-MM-DD')}` : undefined}
                    style={styles.numberCell}
                    onPress={() => onDayPress(d)}
                    onLongPress={() => onPressCell(d.toDate())}
                  >
                    <View style={[
                      styles.dayCircle,
                      { backgroundColor: isSelected ? colors.primary : 'transparent' },
                      { borderWidth: isToday && !isSelected ? 1.5 : 0, borderColor: colors.primary },
                    ]}>
                      <Text
                        numberOfLines={1}
                        allowFontScaling={false}
                        style={[
                          styles.dayNumber,
                          { color: isSelected
                            ? colors.primaryText
                            : isToday
                              ? colors.primary
                              : colors.text, fontWeight: isSelected || isToday ? '700' : '400' },
                        ]}>
                        {d.date()}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.lanesWrap}>
              {laneGrid.map((row, li) => (
                <View key={li} style={styles.laneRow}>
                  {row.map((cell, ci) => {
                    if (cell === 'cont') return null;
                    const d = week[ci];
                    if (cell === null) {
                      return d === null
                        ? <View key={ci} style={styles.spacerCell} />
                        : (
                          <TouchableOpacity
                            key={ci}
                            style={styles.spacerCell}
                            onPress={() => onDayPress(d)}
                            onLongPress={() => onPressCell(d.toDate())}
                          />
                        );
                    }
                    const span = cell.endCol - cell.startCol + 1;
                    const segStart = week[cell.startCol]!;
                    return (
                      <TouchableOpacity
                        key={ci}
                        style={[styles.eventBar, { flex: span, backgroundColor: cell.event.color }]}
                        onPress={() => onPressEvent(cell.event)}
                        onLongPress={() => onPressCell(segStart.toDate())}
                      >
                        <Text numberOfLines={1} style={[styles.eventBarText, { color: textColorFor(cell.event.color) }]}>
                          {cell.event.summary}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
              {hasOverflow && (
                <View style={styles.overflowRow}>
                  {overflowByCol.map((n, ci) => {
                    const d = week[ci];
                    if (d === null) return <View key={ci} style={styles.overflowCell} />;
                    return (
                      <TouchableOpacity
                        key={ci}
                        style={styles.overflowCell}
                        onPress={() => onDayPress(d)}
                        onLongPress={() => onPressCell(d.toDate())}
                      >
                        {n > 0 && (
                          <Text numberOfLines={1} style={[styles.overflowText, { color: colors.textTertiary }]}>
                            +{n}
                          </Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
});

interface MonthGridDotsProps {
  weeks: (dayjs.Dayjs | null)[][];
  selected: dayjs.Dayjs;
  today: dayjs.Dayjs;
  eventsByDay: Map<string, CalendarEvent[]>;
  colors: ReturnType<typeof useTheme>['colors'];
  onDayPress: (d: dayjs.Dayjs) => void;
  onPressCell: (d: Date) => void;
}

// The original, simpler month cell: a day number and up to 3 small colored
// dots (one per distinct event color that day, no titles). Offered as a
// lighter-weight alternative to MonthGrid's event-bar lanes via
// settings.monthEventDisplay — no per-page height measurement needed since
// every cell is the same fixed size regardless of how many events land on it.
const MonthGridDots = memo(function MonthGridDots({
  weeks, selected, today, eventsByDay, colors, onDayPress, onPressCell,
}: MonthGridDotsProps) {
  return (
    <View style={styles.monthPage}>
      {weeks.map((week, wi) => (
        <View key={wi} style={styles.dotsWeekRow}>
          {week.map((d, di) => {
            if (d === null) {
              return <View key={di} style={styles.dayCell} />;
            }
            const key = d.format('YYYY-MM-DD');
            const isToday = d.isSame(today, 'day');
            const isSelected = d.isSame(selected, 'day');
            const dots = Array.from(new Set((eventsByDay.get(key) ?? []).map((e) => e.color))).slice(0, 3);

            return (
              <TouchableOpacity
                key={di}
                testID={isSelected ? `day-selected-${key}` : undefined}
                style={[styles.dayCell, styles.tile, { backgroundColor: colors.surfaceRaised }]}
                onPress={() => onDayPress(d)}
                onLongPress={() => onPressCell(d.toDate())}
              >
                <View style={[
                  styles.dayCircle,
                  { backgroundColor: isSelected ? colors.primary : 'transparent' },
                  { borderWidth: isToday && !isSelected ? 1.5 : 0, borderColor: colors.primary },
                ]}>
                  <Text
                    numberOfLines={1}
                    allowFontScaling={false}
                    style={[
                      styles.dayNumber,
                      { color: isSelected
                        ? colors.primaryText
                        : isToday
                          ? colors.primary
                          : colors.text, fontWeight: isSelected || isToday ? '700' : '400' },
                    ]}>
                    {d.date()}
                  </Text>
                </View>
                <View style={styles.dotsRow}>
                  {dots.map((color, ci) => (
                    <View key={ci} testID="month-event-dot" style={[styles.dot, { backgroundColor: color }]} />
                  ))}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
});

function MonthDayViewImpl({ date, events, weekStartsOn, jump, onSelectDate, onMonthChange, onPressEvent, onPressCell }: Props) {
  const theme = useTheme();
  const language = useSettingsStore((s) => s.language);
  const monthEventDisplay = useSettingsStore((s) => s.monthEventDisplay);

  const selected = useMemo(() => dayjs(date), [date]);

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

  const renderPage = useCallback(({ index }: { index: number }) => {
    const m = dayjs(localAnchor).add(index, 'month');
    const weeks = buildMonthGrid(m.year(), m.month(), weekStartsOn);
    return monthEventDisplay === 'dots' ? (
      <MonthGridDots
        weeks={weeks}
        selected={selected}
        today={today}
        eventsByDay={eventsByDay}
        colors={theme.colors}
        onDayPress={handleDayPress}
        onPressCell={onPressCell}
      />
    ) : (
      <MonthGrid
        weeks={weeks}
        selected={selected}
        today={today}
        eventsByDay={eventsByDay}
        pagerHeight={pagerHeight}
        colors={theme.colors}
        onDayPress={handleDayPress}
        onPressCell={onPressCell}
        onPressEvent={onPressEvent}
      />
    );
  }, [
    localAnchor, weekStartsOn, monthEventDisplay, selected, today, eventsByDay, pagerHeight,
    theme.colors, handleDayPress, onPressCell, onPressEvent,
  ]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
      <View style={styles.grid} onLayout={handleGridLayout}>
        <View style={styles.dowRow}>
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
  monthPage: { flex: 1 },
  weekRow: { flex: 1 },
  tileRow: { flexDirection: 'row', position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  tileSlot: { flex: 1 },
  tile: { margin: TILE_MARGIN, borderRadius: 10 },
  numberRow: { flexDirection: 'row' },
  numberCell: { flex: 1, alignItems: 'center', paddingTop: 2 },
  dayCircle: { width: 32, height: 32, borderRadius: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  dayNumber: { fontSize: 14, textAlign: 'center' },
  // MonthGridDots only:
  dotsWeekRow: { flex: 1, flexDirection: 'row' },
  dayCell: { flex: 1, alignItems: 'center', paddingTop: 2 },
  dotsRow: { flexDirection: 'row', gap: 2, marginTop: 2 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  lanesWrap: { flex: 1 },
  laneRow: { flexDirection: 'row', height: LANE_HEIGHT, marginTop: LANE_GAP },
  spacerCell: { flex: 1 },
  eventBar: { borderRadius: 3, marginHorizontal: BAR_INSET, paddingHorizontal: 3, justifyContent: 'center', height: LANE_HEIGHT - 2 },
  eventBarText: { fontSize: 9, fontWeight: '600' },
  overflowRow: { flexDirection: 'row', height: LANE_HEIGHT, marginTop: LANE_GAP },
  overflowCell: { flex: 1, alignItems: 'center' },
  overflowText: { fontSize: 9, fontWeight: '600' },
});
