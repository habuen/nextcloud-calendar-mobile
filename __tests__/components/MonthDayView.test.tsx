import React from 'react';
import { render as rtlRender, within, act } from '@testing-library/react-native';
import { ThemeWrapper } from '../helpers/theme';
import dayjs from 'dayjs';

const render = (ui: React.ReactElement, opts?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: ThemeWrapper, ...opts });
import 'dayjs/locale/fr';
import { MonthDayView, buildMonthGrid, eventDayKeys, buildWeekSegments, assignLanes } from '@/features/calendar/components/MonthDayView';
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
  it('derives the selected day from the date prop and follows prop changes', () => {
    // Scoped to the day list below the grid: the grid itself always shows an
    // event bar on its actual date regardless of which day is selected.
    const { getByText, getByTestId, rerender } = render(view(june10));
    const dayList = () => within(getByTestId('monthDayEventsList'));

    expect(getByText(dayjs(june10).format('dddd, LL'))).toBeTruthy();
    expect(dayList().queryByText('Birthday Party')).toBeNull();

    rerender(view(june15));

    expect(getByText(dayjs(june15).format('dddd, LL'))).toBeTruthy();
    expect(dayList().queryByText('Birthday Party')).toBeTruthy();
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

  function dayList(date: Date) {
    return within(render(allDayView(date)).getByTestId('monthDayEventsList'));
  }

  it('lists the event on its start day', () => {
    expect(dayList(new Date(2026, 5, 15)).queryByText('Conference')).toBeTruthy();
  });

  it('lists the event on a middle day it spans', () => {
    expect(dayList(new Date(2026, 5, 16)).queryByText('Conference')).toBeTruthy();
  });

  it('lists the event on its inclusive last day', () => {
    expect(dayList(new Date(2026, 5, 17)).queryByText('Conference')).toBeTruthy();
  });

  it('does not list the event the day before it starts', () => {
    expect(dayList(new Date(2026, 5, 14)).queryByText('Conference')).toBeNull();
  });

  it('does not list the event the day after it ends', () => {
    expect(dayList(new Date(2026, 5, 18)).queryByText('Conference')).toBeNull();
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
