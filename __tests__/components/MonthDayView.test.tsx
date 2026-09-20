import React from 'react';
import { render as rtlRender, act } from '@testing-library/react-native';
import { ThemeWrapper } from '../helpers/theme';
import dayjs from 'dayjs';

const render = (ui: React.ReactElement, opts?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: ThemeWrapper, ...opts });
import 'dayjs/locale/fr';
import { MonthDayView } from '@/features/calendar/components/MonthDayView';
import { buildMonthGrid, eventDayKeys, buildWeekSegments, assignLanes, maxLanesFor, columnAt, laneAt, resolveWeekTouch, weekNumberFor } from '@/features/calendar/monthGrid/monthLayout';
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

const june10 = new Date(2026, 5, 10);

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

describe('MonthDayView paging', () => {
  afterEach(() => {
    act(() => { useSettingsStore.getState().setShowWeekNumbers(false); });
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

  it('labels the week-number column in the weekday header once week numbers are on', () => {
    expect(render(view(june10)).queryByText('W')).toBeNull();
    act(() => { useSettingsStore.getState().setShowWeekNumbers(true); });
    expect(render(view(june10)).getByText('W')).toBeTruthy();
  });
});
