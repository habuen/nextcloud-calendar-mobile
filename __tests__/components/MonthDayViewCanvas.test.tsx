import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { render as rtlRender, act, fireEvent } from '@testing-library/react-native';
import dayjs from 'dayjs';
import { ThemeWrapper } from '../helpers/theme';
import { MonthDayView, buildMonthGrid, eventDayKeys } from '@/features/calendar/components/MonthDayView';
import { layoutMonthPage } from '@/features/calendar/monthGrid/monthLayout';
import { useSettingsStore } from '@/stores/settingsStore';
import type { CalendarEvent } from '../../src/types';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('react-native-infinite-pager', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: React.forwardRef((props: any, _ref: any) => props.renderPage({ index: 0 })),
  };
});

const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: ThemeWrapper });

const june10 = new Date(2026, 5, 10);
const party: CalendarEvent = {
  uid: 'e1', href: '/e1.ics', calendarId: 'c1', accountId: 'a1', summary: 'Birthday Party',
  dtstart: new Date(2026, 5, 15, 10), dtend: new Date(2026, 5, 15, 11),
  allDay: false, color: '#0082c9', attendees: [], isRecurring: false,
};
const trip: CalendarEvent = {
  ...party, uid: 'trip', summary: 'Trip', dtstart: new Date(2026, 5, 16), dtend: new Date(2026, 5, 18), allDay: true,
};

// Page geometry the tests set explicitly, so the expected coordinates come from
// the same pure layout the component uses.
const PAGE_W = 700;
const PAGE_H = 600;
const weeks = buildMonthGrid(2026, 5, 0);

function eventsByDay(events: CalendarEvent[]) {
  const map = new Map<string, CalendarEvent[]>();
  for (const e of events) for (const k of eventDayKeys(e)) map.set(k, [...(map.get(k) ?? []), e]);
  return map;
}

function mount(events: CalendarEvent[], gutter = 0) {
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
  // 26 is the height of the weekday header above the pager. The canvas is the
  // grid's width minus the week-number column, if shown.
  fireEvent(utils.getByTestId('month-grid'), 'layout', { nativeEvent: { layout: { width: PAGE_W, height: PAGE_H + 26 } } });
  const layout = layoutMonthPage({
    weeks, eventsByDay: eventsByDay(events), width: PAGE_W - gutter, height: PAGE_H, mode: 'bars', today: dayjs(),
  });
  const at = (x: number, y: number) => ({ nativeEvent: { locationX: x, locationY: y } });
  return {
    ...utils, layout, onSelectDate, onPressEvent, onPressCell,
    press: (x: number, y: number) => fireEvent.press(utils.getByTestId('week-touch'), at(x, y)),
    longPress: (x: number, y: number) => fireEvent(utils.getByTestId('week-touch'), 'longPress', at(x, y)),
  };
}
const dayOf = (fn: jest.Mock) => dayjs(fn.mock.calls[0][0]).format('YYYY-MM-DD');
const centre = (b: { x: number; y: number; w: number; h: number }) => [b.x + b.w / 2, b.y + b.h / 2] as const;

beforeEach(() => {
  useSettingsStore.setState({ monthRenderer: 'canvas', monthEventDisplay: 'bars', showWeekNumbers: false });
});

describe('MonthDayView with the canvas renderer', () => {
  it('is the default renderer', () => {
    expect(useSettingsStore.getInitialState().monthRenderer).toBe('canvas');
  });

  it('builds one canvas and one touch surface for the whole page, and no per-day views', () => {
    const { getAllByTestId, queryAllByTestId, queryByText } = mount([party, trip]);
    expect(getAllByTestId('skia-canvas')).toHaveLength(1);
    expect(getAllByTestId('week-touch')).toHaveLength(1);
    expect(queryAllByTestId('lane-bar')).toHaveLength(0);
    expect(queryByText('Birthday Party')).toBeNull(); // drawn, not a view
  });

  it('builds the view-based page instead when the setting says so', () => {
    useSettingsStore.setState({ monthRenderer: 'views' });
    const { queryAllByTestId } = render(
      <MonthDayView date={june10} events={[party]} weekStartsOn={0} jump={{ nonce: 0, target: june10 }}
        onSelectDate={jest.fn()} onMonthChange={jest.fn()} onPressEvent={jest.fn()} onPressCell={jest.fn()} />
    );
    expect(queryAllByTestId('skia-canvas')).toHaveLength(0);
    expect(queryAllByTestId('lane-bar').length).toBeGreaterThan(0);
  });

  it('opens an event when its bar is tapped, and does not open Day view', () => {
    const m = mount([party]);
    const [x, y] = centre(m.layout.bars[0]);
    m.press(x, y);
    expect(m.onPressEvent).toHaveBeenCalledWith(party);
    expect(m.onSelectDate).not.toHaveBeenCalled();
  });

  it('opens a multi-day event from any of the days it covers', () => {
    for (const frac of [0.15, 0.5, 0.85]) {
      const m = mount([trip]);
      const b = m.layout.bars[0];
      m.press(b.x + b.w * frac, b.y + b.h / 2);
      expect(m.onPressEvent).toHaveBeenCalledWith(trip);
    }
  });

  it('opens Day view for the day tapped when the tap is on a number or the blank part of a tile', () => {
    const m = mount([party]);
    const colW = PAGE_W / 7;
    const rowH = PAGE_H / weeks.length;
    m.press(3.5 * colW, rowH + 10); // Wed Jun 10, number area
    expect(dayOf(m.onSelectDate)).toBe('2026-06-10');

    const m2 = mount([party]);
    m2.press(1.5 * colW, 2 * rowH + 100); // Mon Jun 15, well below its bar
    expect(dayOf(m2.onSelectDate)).toBe('2026-06-15');
    expect(m2.onPressEvent).not.toHaveBeenCalled();
  });

  it('ignores a tap on a blank cell outside the month', () => {
    const m = mount([party]);
    m.press(0.5 * (PAGE_W / 7), 10); // Sunday May 31, not shown
    expect(m.onSelectDate).not.toHaveBeenCalled();
    expect(m.onPressEvent).not.toHaveBeenCalled();
  });

  it('starts a new event on a long-pressed day, or on the first day of a long-pressed bar', () => {
    const day = mount([party]);
    day.longPress(3.5 * (PAGE_W / 7), PAGE_H / weeks.length + 10);
    expect(dayOf(day.onPressCell)).toBe('2026-06-10');

    const bar = mount([trip]);
    const b = bar.layout.bars[0];
    bar.longPress(b.x + b.w * 0.85, b.y + b.h / 2);
    expect(dayOf(bar.onPressCell)).toBe('2026-06-16');
  });

  it('works out taps from the width the grid was actually given, not the window\'s', () => {
    const m = mount([party]);
    fireEvent(m.getByTestId('month-grid'), 'layout', { nativeEvent: { layout: { width: 350, height: PAGE_H + 26 } } });
    const narrow = layoutMonthPage({
      weeks, eventsByDay: eventsByDay([party]), width: 350, height: PAGE_H, mode: 'bars', today: dayjs(),
    });
    const [x, y] = centre(narrow.bars[0]);
    m.press(x, y);
    expect(m.onPressEvent).toHaveBeenCalledWith(party);
  });

  it('shows a week-number column beside the canvas and taps still land on the right day', () => {
    useSettingsStore.setState({ showWeekNumbers: true });
    const m = mount([party], 26);
    expect(m.getAllByTestId('week-number').map((n) => n.props.children)).toEqual([23, 24, 25, 26, 27]);
    const [x, y] = centre(m.layout.bars[0]);
    m.press(x, y);
    expect(m.onPressEvent).toHaveBeenCalledWith(party);
  });

  it('resolves a tap to the day in dots mode too', () => {
    useSettingsStore.setState({ monthEventDisplay: 'dots' });
    const m = mount([party]);
    m.press(3.5 * (PAGE_W / 7), PAGE_H / weeks.length + 40);
    expect(dayOf(m.onSelectDate)).toBe('2026-06-10');
  });
});

describe('canvas month view with a screen reader', () => {
  afterEach(() => jest.restoreAllMocks());

  it('adds no accessibility elements when no screen reader is running', () => {
    const { queryAllByRole } = mount([party]);
    expect(queryAllByRole('button')).toHaveLength(0);
  });

  it('adds one labelled button per day, naming the events on it, when one is running', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    const m = mount([party]);
    await act(async () => { await Promise.resolve(); });

    const buttons = m.queryAllByRole('button');
    expect(buttons).toHaveLength(30);
    const labelled = buttons.find((b) => String(b.props.accessibilityLabel).includes('Birthday Party'));
    expect(labelled).toBeTruthy();
    expect(String(labelled!.props.accessibilityLabel)).toMatch(/June 15/);
  });

  it('opens that day when the accessible button is activated', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    const m = mount([party]);
    await act(async () => { await Promise.resolve(); });

    const button = m.queryAllByRole('button')
      .find((b) => String(b.props.accessibilityLabel).includes('Birthday Party'))!;
    act(() => { button.props.onAccessibilityTap(); });

    expect(dayOf(m.onSelectDate)).toBe('2026-06-15');
  });
});
