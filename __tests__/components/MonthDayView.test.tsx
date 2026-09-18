import React from 'react';
import { render as rtlRender, act, fireEvent } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { ThemeWrapper } from '../helpers/theme';
import dayjs from 'dayjs';

const render = (ui: React.ReactElement, opts?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: ThemeWrapper, ...opts });
import 'dayjs/locale/fr';
import { MonthDayView, buildMonthGrid, eventDayKeys, buildWeekSegments, assignLanes, maxLanesFor, columnAt, laneAt, resolveWeekTouch, weekNumberFor, WEEK_NUMBER_GUTTER } from '@/features/calendar/components/MonthDayView';
import { useSettingsStore } from '@/stores/settingsStore';
import type { CalendarEvent } from '../../src/types';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

let mockCapturedPagerProps: any[] = [];

// Render the pager's current page directly; the real pager pulls Reanimated
// hooks the jest mock does not provide.
jest.mock('react-native-infinite-pager', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: React.forwardRef((props: any, _ref: any) => {
      mockCapturedPagerProps.push(props);
      return props.renderPage ? props.renderPage({ index: 0 }) : null;
    }),
  };
});

// These tests cover the view-based renderer; the canvas one has its own file.
beforeAll(() => { useSettingsStore.setState({ monthRenderer: 'views' }); });

const june10 = new Date(2026, 5, 10);
const june15 = new Date(2026, 5, 15);

const event: CalendarEvent = {
  uid: 'e1', href: '/e1.ics', calendarId: 'c1', accountId: 'a1',
  summary: 'Birthday Party',
  dtstart: new Date(2026, 5, 15, 10, 0), dtend: new Date(2026, 5, 15, 11, 0),
  allDay: false, color: '#0082c9', attendees: [], isRecurring: false,
};

function view(date: Date) {
  return (
    <MonthDayView
      date={date}
      events={[event]}
      weekStartsOn={0}
      jump={{ nonce: 0, target: date }}
      onSelectDate={jest.fn()}
      onMonthChange={jest.fn()}
      onPressEvent={jest.fn()}
      onPressCell={jest.fn()}
    />
  );
}

describe('buildMonthGrid', () => {
  afterEach(() => {
    dayjs.locale('en');
  });

  function expectColumnsMatchWeekdays(weekStartsOn: 0 | 1) {
    const grid = buildMonthGrid(2026, 5, weekStartsOn);
    for (const week of grid) {
      week.forEach((cell, col) => {
        if (cell === null) return;
        expect(cell.day()).toBe((weekStartsOn + col) % 7);
      });
    }
  }

  it('aligns dates with weekday columns when week starts on Sunday', () => {
    expectColumnsMatchWeekdays(0);
  });

  it('aligns dates with weekday columns when week starts on Monday', () => {
    expectColumnsMatchWeekdays(1);
  });

  it('stays aligned under a Monday-start locale (fr)', () => {
    dayjs.locale('fr');
    expectColumnsMatchWeekdays(0);
    expectColumnsMatchWeekdays(1);
  });

  it('places June 1, 2026 (a Monday) under the Monday column', () => {
    dayjs.locale('fr');
    const isJune1 = (d: dayjs.Dayjs | null) => d !== null && d.date() === 1 && d.month() === 5;
    for (const weekStartsOn of [0, 1] as const) {
      const grid = buildMonthGrid(2026, 5, weekStartsOn);
      const firstRow = grid.find((week) => week.some(isJune1))!;
      const col = firstRow.findIndex(isJune1);
      expect((weekStartsOn + col) % 7).toBe(1);
    }
  });
});

describe('eventDayKeys', () => {
  const make = (over: Partial<CalendarEvent>): CalendarEvent => ({
    uid: 'x', href: '/x.ics', calendarId: 'c1', accountId: 'a1', summary: 'x',
    dtstart: new Date(2026, 5, 15), dtend: new Date(2026, 5, 15),
    allDay: true, color: '#000', attendees: [], isRecurring: false, ...over,
  });

  it('returns one key for a single-day all-day event', () => {
    expect(eventDayKeys(make({ dtstart: new Date(2026, 5, 15), dtend: new Date(2026, 5, 15) })))
      .toEqual(['2026-06-15']);
  });

  it('returns every day across a multi-day all-day span (inclusive end)', () => {
    expect(eventDayKeys(make({ dtstart: new Date(2026, 5, 15), dtend: new Date(2026, 5, 17) })))
      .toEqual(['2026-06-15', '2026-06-16', '2026-06-17']);
  });

  it('spans across a month boundary', () => {
    expect(eventDayKeys(make({ dtstart: new Date(2026, 5, 30), dtend: new Date(2026, 6, 2) })))
      .toEqual(['2026-06-30', '2026-07-01', '2026-07-02']);
  });

  it('returns only the start day for a timed event inside one day', () => {
    expect(eventDayKeys(make({
      allDay: false, dtstart: new Date(2026, 5, 15, 9, 0), dtend: new Date(2026, 5, 15, 10, 0),
    }))).toEqual(['2026-06-15']);
  });

  it('spans a timed event that runs past midnight', () => {
    expect(eventDayKeys(make({
      allDay: false, dtstart: new Date(2026, 5, 15, 22, 0), dtend: new Date(2026, 5, 16, 9, 0),
    }))).toEqual(['2026-06-15', '2026-06-16']);
  });

  it('stops on the start day when a timed event ends exactly at midnight', () => {
    expect(eventDayKeys(make({
      allDay: false, dtstart: new Date(2026, 5, 15, 22, 0), dtend: new Date(2026, 5, 16, 0, 0),
    }))).toEqual(['2026-06-15']);
  });

  it('spans a timed event running over several nights', () => {
    expect(eventDayKeys(make({
      allDay: false, dtstart: new Date(2026, 5, 30, 20, 0), dtend: new Date(2026, 6, 2, 6, 0),
    }))).toEqual(['2026-06-30', '2026-07-01', '2026-07-02']);
  });
});

describe('MonthDayView', () => {
  it('rings today, and nothing else, whichever date the view is showing', () => {
    const now = new Date();
    const key = dayjs(now).format('YYYY-MM-DD');
    const { queryAllByTestId, rerender } = render(view(now));
    expect(queryAllByTestId(/^day-today-/)).toHaveLength(1);
    expect(queryAllByTestId(`day-today-${key}`)).toHaveLength(1);

    // A swipe reports the 1st of the new month as the date; that must not
    // light up as a highlighted day (it used to be a blue circle on every 1st).
    rerender(view(new Date(2026, 6, 1)));
    expect(queryAllByTestId(/^day-selected-/)).toHaveLength(0);
    expect(queryAllByTestId('day-selected-2026-07-01')).toHaveLength(0);
  });

  it('does not mark the date it was given as a selected day', () => {
    const { queryAllByTestId } = render(view(june10));
    expect(queryAllByTestId(/^day-selected-/)).toHaveLength(0);
  });

  it('shows an event\'s title in the grid whatever date the view is showing', () => {
    // The grid isn't scoped to the selected day — it always shows every
    // event on its own actual date(s) within the rendered month.
    expect(render(view(june10)).queryByText('Birthday Party')).toBeTruthy();
  });

  it('reports the first day of the paged-to month through onMonthChange', () => {
    mockCapturedPagerProps = [];
    const onMonthChange = jest.fn();
    render(
      <MonthDayView
        date={june10}
        events={[event]}
        weekStartsOn={0}
        jump={{ nonce: 0, target: june10 }}
        onSelectDate={jest.fn()}
        onMonthChange={onMonthChange}
        onPressEvent={jest.fn()}
        onPressCell={jest.fn()}
      />
    );

    const pager = mockCapturedPagerProps.find((p) => typeof p.onPageChange === 'function');

    // The pager echoes the current page (0) on mount; that is not a swipe and
    // must not report a month change (which would setState into the parent's
    // render and snap the selection to the 1st).
    pager.onPageChange(0);
    expect(onMonthChange).not.toHaveBeenCalled();

    pager.onPageChange(1);
    expect(onMonthChange).toHaveBeenCalledTimes(1);
    expect(dayjs(onMonthChange.mock.calls[0][0]).format('YYYY-MM-DD')).toBe('2026-07-01');

    pager.onPageChange(-2);
    expect(dayjs(onMonthChange.mock.calls[1][0]).format('YYYY-MM-DD')).toBe('2026-04-01');
  });

  // Touches: each week row has one touch surface and the handler works out the
  // day / event from where the finger landed. June 2026 (Sunday-first): row 1
  // is Jun 7-13 (Wed 10 is column 3), row 2 is Jun 14-20 (Mon 15 is column 1);
  // row 0 has no Sunday (May 31 is outside the month).
  const width = Dimensions.get('window').width;
  const xIn = (col: number) => ((col + 0.5) * width) / 7;
  const NUMBER_ROW_Y = 10;
  const LANE_Y = (lane: number) => 34 + lane * 16 + 8;

  function touchable(events: CalendarEvent[]) {
    const onSelectDate = jest.fn();
    const onPressEvent = jest.fn();
    const onPressCell = jest.fn();
    const utils = render(
      <MonthDayView
        date={june10}
        events={events}
        weekStartsOn={0}
        jump={{ nonce: 0, target: june10 }}
        onSelectDate={onSelectDate}
        onMonthChange={jest.fn()}
        onPressEvent={onPressEvent}
        onPressCell={onPressCell}
      />
    );
    const week = (i: number) => utils.getAllByTestId('week-touch')[i];
    const press = (i: number, col: number, y: number) =>
      fireEvent.press(week(i), { nativeEvent: { locationX: xIn(col), locationY: y } });
    const longPress = (i: number, col: number, y: number) =>
      fireEvent(week(i), 'longPress', { nativeEvent: { locationX: xIn(col), locationY: y } });
    return { onSelectDate, onPressEvent, onPressCell, press, longPress };
  }
  const dayOf = (fn: jest.Mock) => dayjs(fn.mock.calls[0][0]).format('YYYY-MM-DD');

  it('presses a day number through to onSelectDate, the hook used to jump straight into day view', () => {
    const { onSelectDate, press } = touchable([]);
    press(1, 3, NUMBER_ROW_Y);
    expect(onSelectDate).toHaveBeenCalledTimes(1);
    expect(dayOf(onSelectDate)).toBe('2026-06-10');
  });

  it('presses the blank square below a day through to onSelectDate, same as its number', () => {
    const { onSelectDate, press } = touchable([event]);
    // Jun 15 has a bar in lane 0; lane 2 of the same day is empty square.
    press(2, 1, LANE_Y(2));
    expect(dayOf(onSelectDate)).toBe('2026-06-15');
  });

  it('presses an event bar through to onPressEvent, not onSelectDate — the grid is the only way left to open an event', () => {
    const { onSelectDate, onPressEvent, press } = touchable([event]);
    press(2, 1, LANE_Y(0));
    expect(onPressEvent).toHaveBeenCalledWith(event);
    expect(onSelectDate).not.toHaveBeenCalled();
  });

  it('treats the empty part of a lane row beside a bar as its own day, not the bar', () => {
    const { onSelectDate, onPressEvent, press } = touchable([event]);
    press(2, 2, LANE_Y(0)); // Jun 16, same lane row as Jun 15's bar
    expect(onPressEvent).not.toHaveBeenCalled();
    expect(dayOf(onSelectDate)).toBe('2026-06-16');
  });

  it('opens a multi-day event from any day it covers', () => {
    const trip = { ...event, uid: 'trip', summary: 'Trip', dtstart: new Date(2026, 5, 16), dtend: new Date(2026, 5, 18), allDay: true };
    for (const col of [2, 3, 4]) {
      const { onPressEvent, press } = touchable([trip]);
      press(2, col, LANE_Y(0));
      expect(onPressEvent).toHaveBeenCalledWith(trip);
    }
  });

  it('ignores a touch on a column outside the month', () => {
    const { onSelectDate, onPressEvent, press } = touchable([event]);
    press(0, 0, NUMBER_ROW_Y); // May 31: not part of June's grid
    expect(onSelectDate).not.toHaveBeenCalled();
    expect(onPressEvent).not.toHaveBeenCalled();
  });

  it('long-presses a day to create an event there, and a bar to create one on the bar\'s first day', () => {
    const day = touchable([event]);
    day.longPress(1, 3, NUMBER_ROW_Y);
    expect(dayOf(day.onPressCell)).toBe('2026-06-10');

    const bar = touchable([{ ...event, dtstart: new Date(2026, 5, 16), dtend: new Date(2026, 5, 18), allDay: true }]);
    bar.longPress(2, 3, LANE_Y(0)); // middle of a Jun 16-18 bar
    expect(dayOf(bar.onPressCell)).toBe('2026-06-16');
  });
});

describe('MonthDayView dots mode touches', () => {
  afterEach(() => {
    act(() => { useSettingsStore.getState().setMonthEventDisplay('bars'); });
  });

  it('presses a day through to onSelectDate and long-presses through to onPressCell', () => {
    act(() => { useSettingsStore.getState().setMonthEventDisplay('dots'); });
    const onSelectDate = jest.fn();
    const onPressCell = jest.fn();
    const { getAllByTestId } = render(
      <MonthDayView
        date={june10}
        events={[event]}
        weekStartsOn={0}
        jump={{ nonce: 0, target: june10 }}
        onSelectDate={onSelectDate}
        onMonthChange={jest.fn()}
        onPressEvent={jest.fn()}
        onPressCell={onPressCell}
      />
    );
    const width = Dimensions.get('window').width;
    const week = getAllByTestId('week-touch')[2]; // Jun 14-20
    const at = { nativeEvent: { locationX: (1.5 * width) / 7, locationY: 40 } };

    fireEvent.press(week, at);
    fireEvent(week, 'longPress', at);

    expect(dayjs(onSelectDate.mock.calls[0][0]).format('YYYY-MM-DD')).toBe('2026-06-15');
    expect(dayjs(onPressCell.mock.calls[0][0]).format('YYYY-MM-DD')).toBe('2026-06-15');
  });
});

describe('week touch hit-testing', () => {
  const seg = (col0: number, col1: number) => ({ event, startCol: col0, endCol: col1, lane: 0 });

  it('maps a horizontal offset to one of seven equal columns and clamps the edges', () => {
    expect(columnAt(0, 700)).toBe(0);
    expect(columnAt(99, 700)).toBe(0);
    expect(columnAt(100, 700)).toBe(1);
    expect(columnAt(699, 700)).toBe(6);
    expect(columnAt(-20, 700)).toBe(0);
    expect(columnAt(9999, 700)).toBe(6);
  });

  it('maps a vertical offset to a lane row, or -1 in the day number area', () => {
    expect(laneAt(0)).toBe(-1);
    expect(laneAt(33)).toBe(-1);
    expect(laneAt(34)).toBe(0);
    expect(laneAt(49)).toBe(0);
    expect(laneAt(50)).toBe(1);
  });

  it('resolves a touch on a bar to its event in every column the bar spans', () => {
    const grid = [[null, seg(1, 3), seg(1, 3), seg(1, 3), null, null, null]];
    for (const col of [1, 2, 3]) {
      expect(resolveWeekTouch(100 * col + 50, 40, 700, grid)).toEqual({ kind: 'event', segment: seg(1, 3) });
    }
    expect(resolveWeekTouch(450, 40, 700, grid)).toEqual({ kind: 'day', col: 4 });
  });

  it('resolves a touch above the lanes, or in a lane row that does not exist, to the day', () => {
    const grid = [[seg(0, 0), null, null, null, null, null, null]];
    expect(resolveWeekTouch(50, 10, 700, grid)).toEqual({ kind: 'day', col: 0 });
    expect(resolveWeekTouch(50, 200, 700, grid)).toEqual({ kind: 'day', col: 0 });
  });
});

describe('MonthDayView multi-day all-day events', () => {
  const conference: CalendarEvent = {
    uid: 'e2', href: '/e2.ics', calendarId: 'c1', accountId: 'a1',
    summary: 'Conference',
    dtstart: new Date(2026, 5, 15), dtend: new Date(2026, 5, 17),
    allDay: true, color: '#e74c3c', attendees: [], isRecurring: false,
  };

  function allDayView(date: Date) {
    return (
      <MonthDayView
        date={date}
        events={[conference]}
        weekStartsOn={0}
        jump={{ nonce: 0, target: date }}
        onSelectDate={jest.fn()}
        onMonthChange={jest.fn()}
        onPressEvent={jest.fn()}
        onPressCell={jest.fn()}
      />
    );
  }

  it('renders the multi-day event as a single spanning bar, not one per covered day', () => {
    // The grid isn't scoped to the selected day, so whichever day is passed
    // as `date` (as long as it's in the same month) renders the same grid.
    const { getAllByText } = render(allDayView(new Date(2026, 5, 15)));
    expect(getAllByText('Conference')).toHaveLength(1);
  });

  it('does not show the event when a different month is rendered', () => {
    expect(render(allDayView(new Date(2026, 8, 1))).queryByText('Conference')).toBeNull();
  });
});

describe('buildWeekSegments / assignLanes (month grid event bars)', () => {
  const day = (d: number) => dayjs(new Date(2026, 5, d));
  // A Sun-Sat week covering June 14-20, 2026.
  const week = Array.from({ length: 7 }, (_, i) => day(14 + i));

  const make = (over: Partial<CalendarEvent>): CalendarEvent => ({
    uid: 'x', href: '/x.ics', calendarId: 'c1', accountId: 'a1', summary: 'x',
    dtstart: new Date(2026, 5, 15), dtend: new Date(2026, 5, 15),
    allDay: true, color: '#000', attendees: [], isRecurring: false, ...over,
  });

  it('clips a multi-day event to the columns it covers within the week', () => {
    const ev = make({ uid: 'e1', dtstart: new Date(2026, 5, 15), dtend: new Date(2026, 5, 17) });
    const [seg] = buildWeekSegments(week, [ev]);
    expect(seg.startCol).toBe(1); // June 15 is column 1 (Mon)
    expect(seg.endCol).toBe(3); // June 17 is column 3 (Wed)
  });

  it('clips an event that starts before the week to the week start', () => {
    const ev = make({ uid: 'e1', dtstart: new Date(2026, 5, 10), dtend: new Date(2026, 5, 16) });
    const [seg] = buildWeekSegments(week, [ev]);
    expect(seg.startCol).toBe(0);
    expect(seg.endCol).toBe(2); // June 16 is column 2 (Tue)
  });

  it('omits an event that does not overlap the week at all', () => {
    const ev = make({ uid: 'e1', dtstart: new Date(2026, 5, 1), dtend: new Date(2026, 5, 2) });
    expect(buildWeekSegments(week, [ev])).toEqual([]);
  });

  it('places non-overlapping events on the same lane', () => {
    const a = make({ uid: 'a', dtstart: new Date(2026, 5, 14), dtend: new Date(2026, 5, 15) });
    const b = make({ uid: 'b', dtstart: new Date(2026, 5, 16), dtend: new Date(2026, 5, 17) });
    const laned = assignLanes(buildWeekSegments(week, [a, b]));
    expect(laned.find((s) => s.event.uid === 'a')!.lane).toBe(0);
    expect(laned.find((s) => s.event.uid === 'b')!.lane).toBe(0);
  });

  it('puts overlapping events on separate lanes', () => {
    const a = make({ uid: 'a', dtstart: new Date(2026, 5, 14), dtend: new Date(2026, 5, 17) });
    const b = make({ uid: 'b', dtstart: new Date(2026, 5, 16), dtend: new Date(2026, 5, 18) });
    const laned = assignLanes(buildWeekSegments(week, [a, b]));
    const laneA = laned.find((s) => s.event.uid === 'a')!.lane;
    const laneB = laned.find((s) => s.event.uid === 'b')!.lane;
    expect(laneA).not.toBe(laneB);
  });
});

describe('MonthDayView settings.monthEventDisplay', () => {
  afterEach(() => {
    act(() => { useSettingsStore.getState().setMonthEventDisplay('bars'); });
  });

  it('shows event titles as bars in the grid by default', () => {
    // june10 is selected but the event is on june15 (same month) — bars mode
    // shows the title in the grid regardless of which day is selected.
    expect(render(view(june10)).queryByText('Birthday Party')).toBeTruthy();
  });

  it('shows only colored dots, no event titles, when dots mode is selected', () => {
    act(() => { useSettingsStore.getState().setMonthEventDisplay('dots'); });
    const { queryByText, getAllByTestId } = render(view(june10));
    expect(queryByText('Birthday Party')).toBeNull();
    expect(getAllByTestId('month-event-dot').length).toBeGreaterThan(0);
  });
});

describe('maxLanesFor', () => {
  // Footprint of the number row above the lanes, each lane (bar + 1px gap),
  // and the tile's bottom inset. Mirrors the constants in MonthDayView; the
  // point is that N lanes must always end inside the tile, at any row height.
  const NUMBER_ROW = 34;
  const LANE_FOOTPRINT = 16;
  const TILE_BOTTOM_INSET = 2;

  it('never budgets more lanes than fit inside the day tile, at any row height', () => {
    for (let rowHeight = 40; rowHeight <= 200; rowHeight++) {
      const n = maxLanesFor(rowHeight);
      expect(NUMBER_ROW + n * LANE_FOOTPRINT).toBeLessThanOrEqual(rowHeight - TILE_BOTTOM_INSET);
    }
  });

  it('does not leave room for another lane unused', () => {
    for (let rowHeight = 40; rowHeight <= 200; rowHeight++) {
      const n = maxLanesFor(rowHeight);
      expect(NUMBER_ROW + (n + 1) * LANE_FOOTPRINT).toBeGreaterThan(rowHeight - TILE_BOTTOM_INSET);
    }
  });

  it('is zero when the row is too short for even the day number', () => {
    expect(maxLanesFor(30)).toBe(0);
  });
});

describe('MonthDayView lane alignment', () => {
  const trip: CalendarEvent = {
    uid: 'trip', href: '/trip.ics', calendarId: 'c1', accountId: 'a1', summary: 'Trip',
    dtstart: new Date(2026, 5, 16), dtend: new Date(2026, 5, 18),
    allDay: true, color: '#e74c3c', attendees: [], isRecurring: false,
  };
  const COLUMN = 100 / 7;

  function bars() {
    const { getAllByTestId } = render(
      <MonthDayView
        date={june10}
        events={[event, trip]}
        weekStartsOn={0}
        jump={{ nonce: 0, target: june10 }}
        onSelectDate={jest.fn()}
        onMonthChange={jest.fn()}
        onPressEvent={jest.fn()}
        onPressCell={jest.fn()}
      />
    );
    return getAllByTestId('lane-bar').map((b) => {
      const st = StyleSheet.flatten(b.props.style);
      return { left: parseFloat(st.left as string), width: parseFloat(st.width as string), style: st };
    });
  }

  it('starts every bar exactly on a column boundary and gives it a whole number of columns', () => {
    for (const b of bars()) {
      expect(b.left / COLUMN).toBeCloseTo(Math.round(b.left / COLUMN), 5);
      expect(b.width / COLUMN).toBeCloseTo(Math.round(b.width / COLUMN), 5);
    }
  });

  it('never lets a bar run past the right edge of the week', () => {
    for (const b of bars()) expect(b.left + b.width).toBeLessThanOrEqual(100 + 1e-9);
  });

  it('gives a multi-day bar as many columns as days it covers within the week', () => {
    // Jun 16-18 is Tue-Thu: columns 2-4, so it starts at column 2 and is 3 wide.
    const multi = bars().find((b) => Math.round(b.width / COLUMN) === 3)!;
    expect(multi.left / COLUMN).toBeCloseTo(2, 5);
  });

  it('insets bars with padding, never a margin that could shift them off their columns', () => {
    for (const b of bars()) {
      expect(b.style.margin ?? 0).toBe(0);
      expect(b.style.marginHorizontal ?? 0).toBe(0);
      expect(b.style.marginLeft ?? 0).toBe(0);
      expect(b.style.marginRight ?? 0).toBe(0);
      expect(b.style.paddingHorizontal).toBeGreaterThan(0);
    }
  });
});

describe('weekNumberFor', () => {
  const numbers = (year: number, month: number, weekStartsOn: 0 | 1) =>
    buildMonthGrid(year, month, weekStartsOn).map((w) => weekNumberFor(w, weekStartsOn));

  it('numbers June 2026 by ISO week, the same for Sunday-first and Monday-first grids', () => {
    expect(numbers(2026, 5, 0)).toEqual([23, 24, 25, 26, 27]);
    expect(numbers(2026, 5, 1)).toEqual([23, 24, 25, 26, 27]);
  });

  it('uses the row\'s Thursday, so the row holding Jan 1 belongs to the year-end week it is mostly in', () => {
    // Jan 1 2027 is a Friday. A Sunday-first row is Dec 27-Jan 2 (Thursday is Dec 31, 2026's week 53).
    expect(numbers(2027, 0, 0)[0]).toBe(53);
    expect(numbers(2027, 0, 0)[1]).toBe(1);
    expect(numbers(2027, 0, 1)[0]).toBe(53);
    expect(numbers(2027, 0, 1)[1]).toBe(1);
  });

  it('works out the number for the partial first row even though its leading days are blank', () => {
    const first = buildMonthGrid(2026, 5, 0)[0];
    expect(first[0]).toBeNull();
    expect(weekNumberFor(first, 0)).toBe(23);
  });

  it('has no number for a row with no days in the month', () => {
    expect(weekNumberFor([null, null, null, null, null, null, null], 0)).toBeNull();
  });
});

describe('MonthDayView week numbers', () => {
  afterEach(() => {
    act(() => { useSettingsStore.getState().setShowWeekNumbers(false); });
  });

  function shown(over: Partial<React.ComponentProps<typeof MonthDayView>> = {}) {
    return render(
      <MonthDayView
        date={june10}
        events={[event]}
        weekStartsOn={0}
        jump={{ nonce: 0, target: june10 }}
        onSelectDate={jest.fn()}
        onMonthChange={jest.fn()}
        onPressEvent={jest.fn()}
        onPressCell={jest.fn()}
        {...over}
      />
    );
  }

  it('shows no week numbers by default', () => {
    expect(shown().queryAllByTestId('week-number')).toHaveLength(0);
  });

  it('shows one number per week row in a column beside the grid once turned on', () => {
    act(() => { useSettingsStore.getState().setShowWeekNumbers(true); });
    const { getAllByTestId } = shown();
    expect(getAllByTestId('week-number').map((n) => n.props.children)).toEqual([23, 24, 25, 26, 27]);
  });

  it('labels the column in the weekday header', () => {
    act(() => { useSettingsStore.getState().setShowWeekNumbers(true); });
    expect(shown().getByText('W')).toBeTruthy();
  });

  it('still works out the tapped day from the week area, not the whole row, with the column showing', () => {
    act(() => { useSettingsStore.getState().setShowWeekNumbers(true); });
    const onSelectDate = jest.fn();
    const { getAllByTestId } = shown({ onSelectDate });

    // The week area is what's left after the number column.
    const areaWidth = 700 - WEEK_NUMBER_GUTTER;
    fireEvent(getAllByTestId('week-area')[0], 'layout', { nativeEvent: { layout: { width: areaWidth, height: 500 } } });
    fireEvent.press(getAllByTestId('week-touch')[1], {
      nativeEvent: { locationX: (3.5 * areaWidth) / 7, locationY: 10 }, // Wed, Jun 10
    });

    expect(dayjs(onSelectDate.mock.calls[0][0]).format('YYYY-MM-DD')).toBe('2026-06-10');
  });

  it('keeps bars on exact column boundaries with the column showing', () => {
    act(() => { useSettingsStore.getState().setShowWeekNumbers(true); });
    const COLUMN = 100 / 7;
    for (const bar of shown().getAllByTestId('lane-bar')) {
      const st = StyleSheet.flatten(bar.props.style);
      expect(parseFloat(st.left as string) / COLUMN).toBeCloseTo(Math.round(parseFloat(st.left as string) / COLUMN), 5);
      expect(parseFloat(st.width as string) / COLUMN).toBeCloseTo(Math.round(parseFloat(st.width as string) / COLUMN), 5);
    }
  });

  it('numbers the dots view too', () => {
    act(() => {
      useSettingsStore.getState().setShowWeekNumbers(true);
      useSettingsStore.getState().setMonthEventDisplay('dots');
    });
    const { getAllByTestId } = shown();
    expect(getAllByTestId('week-number')).toHaveLength(5);
    act(() => { useSettingsStore.getState().setMonthEventDisplay('bars'); });
  });
});
