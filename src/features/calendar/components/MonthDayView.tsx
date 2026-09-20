import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, Dimensions,
  type GestureResponderEvent, type LayoutChangeEvent,
} from 'react-native';
import dayjs from 'dayjs';
import localizedFormat from 'dayjs/plugin/localizedFormat';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'expo-router';
import InfinitePager, { type InfinitePagerImperativeApi } from 'react-native-infinite-pager';
import { useSettingsStore } from '@/stores/settingsStore';
import { MonthGridCanvas } from '../monthGrid/MonthGridCanvas';
import { createMonthPageCache, type MonthPage } from '../monthGrid/monthPageCache';
import { useScreenReaderEnabled } from '../monthGrid/useScreenReaderEnabled';
import type { CalendarEvent } from '@/types';
import {
  buildMonthGrid,
  eventDayKeys,
  eventCoversDay,
  buildWeekSegments,
  assignLanes,
  maxLanesFor,
  columnAt,
  laneAt,
  resolveWeekTouch,
  weekNumberFor,
  WEEK_NUMBER_GUTTER,
  lastDayOf,
  textColorFor,
  weekCandidates,
  DOW_ROW_HEIGHT,
  DAY_NUMBER_ROW_HEIGHT,
  LANE_HEIGHT,
  LANE_GAP,
  LANE_STRIDE,
  TILE_MARGIN,
  BAR_INSET,
  COLS,
  type WeekSegment,
  type LanedSegment,
  type WeekTouch,
} from '../monthGrid/monthLayout';
export {
  buildMonthGrid,
  eventDayKeys,
  eventCoversDay,
  buildWeekSegments,
  assignLanes,
  maxLanesFor,
  columnAt,
  laneAt,
  resolveWeekTouch,
  weekNumberFor,
  WEEK_NUMBER_GUTTER,
} from '../monthGrid/monthLayout';

dayjs.extend(localizedFormat);

// Jumps within this many months slide (animated); farther ones re-anchor
// instantly rather than spring across a long stretch of empty months.
const MAX_ANIMATED_JUMP_MONTHS = 2;

// After a swipe settles, the months a further swipe could reach are built in
// the background, one per tick, so the page that mounts mid-swipe finds its
// picture already recorded. Nearest first; the wait lets the swipe's own commit
// go through before any of it starts.
const WARM_OFFSETS = [1, -1, 2, -2];
const WARM_START_DELAY_MS = 120;
const WARM_STEP_DELAY_MS = 40;

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

function monthDiff(from: Date, to: Date): number {
  return (dayjs(to).year() - dayjs(from).year()) * 12 + (dayjs(to).month() - dayjs(from).month());
}

// Rough guess at the chrome above the grid (top bar, safe area, offline
// banner) for a synchronous first-frame estimate — see its one use below.
const ESTIMATED_CHROME_HEIGHT = 130;

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

// The canvas renderer's page: the same week-number column as the view-based
// pages, beside a single canvas that draws the whole week area.
const MonthPageCanvas = memo(function MonthPageCanvas({
  weekNumbers, gutterColor, ...canvasProps
}: {
  weeks: (dayjs.Dayjs | null)[][];
  page: MonthPage;
  screenReader: boolean;
  weekNumbers: (number | null)[] | null;
  gutterColor: string;
  onDayPress: (d: dayjs.Dayjs) => void;
  onPressCell: (d: Date) => void;
  onPressEvent: (e: CalendarEvent) => void;
}) {
  return (
    <View style={styles.monthPage}>
      {weekNumbers && <WeekNumberGutter numbers={weekNumbers} color={gutterColor} />}
      <MonthGridCanvas {...canvasProps} />
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
  const monthRenderer = useSettingsStore((s) => s.monthRenderer);
  const { t } = useTranslation();
  // Read once here, not by every mounted page: each page asking the system
  // (and listening) on mount was a native call per page per swipe.
  const screenReader = useScreenReaderEnabled();

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
  // The width is measured here, once, rather than by each canvas page: a page
  // that learns its width after mounting would lay out and record twice.
  const [measuredGridWidth, setMeasuredGridWidth] = useState(() => Dimensions.get('window').width);
  const handleGridLayout = useCallback((e: LayoutChangeEvent) => {
    setMeasuredGridHeight(e.nativeEvent.layout.height);
    setMeasuredGridWidth(e.nativeEvent.layout.width);
  }, []);
  const pagerHeight = measuredGridHeight - DOW_ROW_HEIGHT;
  const canvasWidth = measuredGridWidth - (showWeekNumbers ? WEEK_NUMBER_GUTTER : 0);

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

  // Set below, once the grid cache it builds from exists.
  const warmAroundRef = useRef<(index: number) => void>(() => {});

  const handlePageChange = useCallback((index: number) => {
    const prev = settledIndexRef.current;
    settledIndexRef.current = index;
    warmAroundRef.current(index);
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

  // Built pages for the canvas renderer. A new cache (empty) whenever anything a
  // page is drawn from changes; otherwise months are built once and reused.
  const { surfaceRaised, primary, text, textTertiary } = theme.colors;
  const pageCache = useMemo(
    () => createMonthPageCache({
      width: canvasWidth,
      height: pagerHeight,
      mode: monthEventDisplay,
      today,
      palette: { tile: surfaceRaised, primary, text, textTertiary },
    }),
    [canvasWidth, pagerHeight, monthEventDisplay, today, surfaceRaised, primary, text, textTertiary],
  );

  const warmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warmAround = useCallback((index: number) => {
    if (warmTimer.current) clearTimeout(warmTimer.current);
    warmTimer.current = null;
    if (monthRenderer !== 'canvas') return;
    let step = 0;
    const next = () => {
      if (step >= WARM_OFFSETS.length) { warmTimer.current = null; return; }
      const m = dayjs(localAnchorRef.current).add(index + WARM_OFFSETS[step++], 'month');
      pageCache.get(gridFor(m).weeks, eventsByDay);
      warmTimer.current = setTimeout(next, WARM_STEP_DELAY_MS);
    };
    warmTimer.current = setTimeout(next, WARM_START_DELAY_MS);
  }, [monthRenderer, pageCache, gridFor, eventsByDay]);

  warmAroundRef.current = warmAround;

  // Warm on mount and whenever the cache is replaced (settings, sync, resize);
  // handlePageChange re-aims it after each swipe.
  useEffect(() => {
    warmAround(settledIndexRef.current);
    return () => { if (warmTimer.current) clearTimeout(warmTimer.current); };
  }, [warmAround, pagerKey]);

  const renderPage = useCallback(({ index }: { index: number }) => {
    const m = dayjs(localAnchor).add(index, 'month');
    const { weeks, weekNumbers } = gridFor(m);
    if (monthRenderer === 'canvas') {
      return (
        <MonthPageCanvas
          weeks={weeks}
          page={pageCache.get(weeks, eventsByDay)}
          screenReader={screenReader}
          weekNumbers={weekNumbers}
          gutterColor={textTertiary}
          onDayPress={handleDayPress}
          onPressCell={onPressCell}
          onPressEvent={onPressEvent}
        />
      );
    }
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
    localAnchor, gridFor, monthRenderer, pageCache, monthEventDisplay, today, eventsByDay, pagerHeight,
    theme.colors, textTertiary, screenReader, handleDayPress, onPressCell, onPressEvent,
  ]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
      <View testID="month-grid" style={styles.grid} onLayout={handleGridLayout}>
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

// `date` is only read to pick the first month shown (state seeded on mount); it
// changes on every swipe as the parent follows the month, and re-rendering the
// whole view for a prop it doesn't use is pure cost. Later moves reach the view
// through `jump`.
export const MonthDayView = memo(MonthDayViewImpl, (prev, next) => {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]) as Set<keyof Props>;
  for (const key of keys) {
    if (key !== 'date' && !Object.is(prev[key], next[key])) return false;
  }
  return true;
});

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
