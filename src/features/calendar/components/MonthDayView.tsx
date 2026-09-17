import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, StyleSheet,
  useWindowDimensions,
} from 'react-native';
import dayjs from 'dayjs';
import localizedFormat from 'dayjs/plugin/localizedFormat';
import { useTranslation } from 'react-i18next';
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

interface MonthGridProps {
  weeks: (dayjs.Dayjs | null)[][];
  selected: dayjs.Dayjs;
  today: dayjs.Dayjs;
  eventsByDay: Map<string, CalendarEvent[]>;
  pagerHeight: number;
  colors: ReturnType<typeof useTheme>['colors'];
  onDayPress: (d: dayjs.Dayjs) => void;
  onPressCell: (d: Date) => void;
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
  weeks, selected, today, eventsByDay, pagerHeight, colors, onDayPress, onPressCell,
}: MonthGridProps) {
  // Known synchronously from pagerHeight (derived from gridHeight up in
  // MonthDayViewImpl) rather than measured, so the lane count is right from
  // this page's very first render — see the comment on the constants above.
  const rowHeight = pagerHeight / weeks.length;
  const rawMaxLanes = Math.max(0, Math.floor((rowHeight - DAY_NUMBER_ROW_HEIGHT) / LANE_HEIGHT));

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
                        onPress={() => onDayPress(segStart)}
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

function MonthDayViewImpl({ date, events, weekStartsOn, jump, onSelectDate, onMonthChange, onPressEvent, onPressCell }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const language = useSettingsStore((s) => s.language);
  const { height } = useWindowDimensions();

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

  const dayEvents = useMemo(() => {
    const sel = selected.format('YYYY-MM-DD');
    return events
      .filter((e) => eventCoversDay(e, sel))
      .sort((a, b) => a.dtstart.getTime() - b.dtstart.getTime());
  }, [events, selected]);

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

  const gridHeight = height * 0.44;
  const pagerHeight = gridHeight - DOW_ROW_HEIGHT;

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
    return (
      <MonthGrid
        weeks={weeks}
        selected={selected}
        today={today}
        eventsByDay={eventsByDay}
        pagerHeight={pagerHeight}
        colors={theme.colors}
        onDayPress={handleDayPress}
        onPressCell={onPressCell}
      />
    );
  }, [localAnchor, weekStartsOn, selected, today, eventsByDay, pagerHeight, theme.colors, handleDayPress, onPressCell]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.grid, { height: gridHeight, borderBottomColor: theme.colors.border }]}>
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

      <View style={styles.dayList} testID="monthDayEventsList">
        <Text style={[styles.dayListHeader, { color: theme.colors.textSecondary }]}>
          {selected.locale(language).format('dddd, LL')}
        </Text>
        {dayEvents.length === 0 ? (
          <Text style={[styles.emptyText, { color: theme.colors.textTertiary }]}>{t('calendar.noEvents')}</Text>
        ) : (
          <FlatList
            data={dayEvents}
            keyExtractor={(e, i) => `${e.calendarId}-${e.uid}-${e.dtstart.getTime()}-${i}`}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.eventRow, { borderLeftColor: item.color, backgroundColor: theme.colors.surface }]}
                onPress={() => onPressEvent(item)}
              >
                <View style={[styles.eventColorBar, { backgroundColor: item.color }]} />
                <View style={styles.eventInfo}>
                  <Text style={[styles.eventTitle, { color: theme.colors.text }]} numberOfLines={1}>
                    {item.summary}
                  </Text>
                  <Text style={[styles.eventTime, { color: theme.colors.textSecondary }]}>
                    {item.allDay
                      ? t('calendar.allDay')
                      : `${dayjs(item.dtstart).locale(language).format('LT')} – ${dayjs(item.dtend).locale(language).format('LT')}`}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
            contentContainerStyle={{ paddingBottom: 16 }}
          />
        )}
      </View>
    </View>
  );
}

export const MonthDayView = memo(MonthDayViewImpl);

const styles = StyleSheet.create({
  container: { flex: 1 },
  fill: { flex: 1 },
  grid: { borderBottomWidth: StyleSheet.hairlineWidth },
  dowRow: { flexDirection: 'row', paddingVertical: 6 },
  dowLabel: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  pagerWrap: { flex: 1 },
  monthPage: { flex: 1 },
  weekRow: { flex: 1 },
  numberRow: { flexDirection: 'row' },
  numberCell: { flex: 1, alignItems: 'center', paddingTop: 2 },
  dayCircle: { width: 32, height: 32, borderRadius: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  dayNumber: { fontSize: 14, textAlign: 'center' },
  lanesWrap: { flex: 1 },
  laneRow: { flexDirection: 'row', height: LANE_HEIGHT, marginTop: 1 },
  spacerCell: { flex: 1 },
  eventBar: { borderRadius: 3, marginHorizontal: 1, paddingHorizontal: 3, justifyContent: 'center', height: LANE_HEIGHT - 2 },
  eventBarText: { fontSize: 9, fontWeight: '600' },
  overflowRow: { flexDirection: 'row', height: LANE_HEIGHT, marginTop: 1 },
  overflowCell: { flex: 1, alignItems: 'center' },
  overflowText: { fontSize: 9, fontWeight: '600' },
  dayList: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  dayListHeader: { fontSize: 13, fontWeight: '600', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  emptyText: { fontSize: 15, textAlign: 'center', marginTop: 32 },
  eventRow: { flexDirection: 'row', borderRadius: 8, marginBottom: 8, overflow: 'hidden' },
  eventColorBar: { width: 4 },
  eventInfo: { flex: 1, padding: 10 },
  eventTitle: { fontSize: 15, fontWeight: '500' },
  eventTime: { fontSize: 12, marginTop: 2 },
});
