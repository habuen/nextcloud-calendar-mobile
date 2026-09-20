import React from 'react';
import { render as rtlRender, act } from '@testing-library/react-native';
import { ThemeWrapper } from '../helpers/theme';
import { MonthDayView } from '@/features/calendar/components/MonthDayView';
import { useSettingsStore } from '@/stores/settingsStore';
import type { CalendarEvent } from '../../src/types';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Renders the three months around the current one and counts how many times
// the view rebuilds its pager (each render of MonthDayView re-renders it). The
// count lives on globalThis because the mock factory can't close over locals.
const mockScreenReader = jest.fn(() => false);
jest.mock('@/features/calendar/monthGrid/useScreenReaderEnabled', () => ({
  useScreenReaderEnabled: () => mockScreenReader(),
}));

jest.mock('react-native-infinite-pager', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: React.forwardRef((props: any, _ref: any) => {
      (globalThis as any).__renderPage = props.renderPage;
      (globalThis as any).__pagerRenders = ((globalThis as any).__pagerRenders ?? 0) + 1;
      return [-1, 0, 1].map((index) => React.createElement(React.Fragment, { key: index }, props.renderPage({ index })));
    }),
  };
});

const ev = (uid: string, m: number, d: number): CalendarEvent => ({
  uid, href: `/${uid}.ics`, calendarId: 'c', accountId: 'a', summary: uid,
  dtstart: new Date(2026, m, d, 9), dtend: new Date(2026, m, d, 10),
  allDay: false, color: '#0082c9', attendees: [], isRecurring: false,
});
const inMay = ev('may', 4, 12);
const inJune = ev('june', 5, 12);
const inJuly = ev('july', 6, 12);

const june10 = new Date(2026, 5, 10);
// Held in one place, as the calendar screen holds `nav.jump` in state: a new
// object each render would count as a real change.
const jump = { nonce: 0, target: june10 };
const handlers = { onSelectDate: jest.fn(), onMonthChange: jest.fn(), onPressEvent: jest.fn(), onPressCell: jest.fn() };
const view = (events: CalendarEvent[], date = june10) => (
  <MonthDayView date={date} events={events} weekStartsOn={0} jump={jump} {...handlers} />
);

const pages = () => [-1, 0, 1].map((i) => (globalThis as any).__renderPage({ index: i }) as React.ReactElement);
const wouldSkip = (a: React.ReactElement, b: React.ReactElement) => {
  const pa = a.props as Record<string, unknown>;
  const pb = b.props as Record<string, unknown>;
  return [...new Set([...Object.keys(pa), ...Object.keys(pb)])].every((k) => Object.is(pa[k], pb[k]));
};
const renders = () => (globalThis as any).__pagerRenders as number;

beforeEach(() => {
  (globalThis as any).__pagerRenders = 0;
  useSettingsStore.setState({ monthEventDisplay: 'bars', showWeekNumbers: false });
});

describe('canvas month pages when the events change', () => {
  it('leaves the pages of months whose events did not change untouched', () => {
    const { rerender } = rtlRender(view([inMay, inJune, inJuly]), { wrapper: ThemeWrapper });
    const before = pages();
    rerender(view([inMay, inJune, inJuly, ev('july-2', 6, 20)]));
    const after = pages();

    expect(wouldSkip(before[0], after[0])).toBe(true);  // May
    expect(wouldSkip(before[1], after[1])).toBe(true);  // June
    expect(wouldSkip(before[2], after[2])).toBe(false); // July gained an event
  });

  it('redoes only the month whose event was edited', () => {
    const { rerender } = rtlRender(view([inMay, inJune, inJuly]), { wrapper: ThemeWrapper });
    const before = pages();
    rerender(view([inMay, { ...inJune, summary: 'edited' }, inJuly]));
    const after = pages();
    expect(before.map((b, i) => wouldSkip(b, after[i]))).toEqual([true, false, true]);
  });

  it('survives the events window sliding by one month, redoing only the month that entered', () => {
    const { rerender } = rtlRender(view([inMay, inJune, inJuly]), { wrapper: ThemeWrapper });
    const before = pages();
    // The three-month query window moved forward: May left, August arrived.
    const aug = ev('aug', 7, 3);
    rerender(view([inJune, inJuly, aug]));
    const after = pages();
    expect(wouldSkip(before[0], after[0])).toBe(false); // May lost its event
    expect(wouldSkip(before[1], after[1])).toBe(true);  // June is the same objects
    expect(wouldSkip(before[2], after[2])).toBe(true);  // July too
  });

  it('redoes every page when the display setting changes', () => {
    const { rerender } = rtlRender(view([inMay, inJune, inJuly]), { wrapper: ThemeWrapper });
    const before = pages();
    act(() => { useSettingsStore.setState({ monthEventDisplay: 'dots' }); });
    rerender(view([inMay, inJune, inJuly]));
    const after = pages();
    expect(before.every((b, i) => !wouldSkip(b, after[i]))).toBe(true);
  });
});

describe('MonthDayView when only the date changes', () => {
  it('does not render again, since a swipe reports a new date on every settle', () => {
    const events = [inJune];
    const { rerender } = rtlRender(view(events), { wrapper: ThemeWrapper });
    const before = renders();

    rerender(view(events, new Date(2026, 6, 1)));
    rerender(view(events, new Date(2026, 7, 1)));

    expect(renders()).toBe(before);
  });

  it('still renders when anything it does use changes', () => {
    const { rerender } = rtlRender(view([inJune]), { wrapper: ThemeWrapper });
    const before = renders();
    rerender(view([inJune, inJuly]));
    expect(renders()).toBeGreaterThan(before);
  });
});

describe('screen reader lookup', () => {
  it('is made once for the whole view, not once per mounted page', () => {
    mockScreenReader.mockClear();
    rtlRender(view([inJune]), { wrapper: ThemeWrapper });
    // Three pages are mounted; the lookup is the view's, so one call.
    expect(mockScreenReader).toHaveBeenCalledTimes(1);
  });
});
