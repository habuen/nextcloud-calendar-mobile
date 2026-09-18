import React from 'react';
import { render as rtlRender } from '@testing-library/react-native';
import { ThemeWrapper } from '../helpers/theme';
import { MonthDayView } from '@/features/calendar/components/MonthDayView';
import type { CalendarEvent } from '../../src/types';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Keep hold of the pager's renderPage so the test can ask what props each
// month page would get on successive renders. A page whose props are all
// identical between two renders is one React.memo skips.
let latestRenderPage: ((a: { index: number }) => React.ReactElement) | null = null;
jest.mock('react-native-infinite-pager', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: React.forwardRef((props: any, _ref: any) => {
      (globalThis as any).__renderPage = props.renderPage;
      return [-1, 0, 1].map((index) => React.createElement(React.Fragment, { key: index }, props.renderPage({ index })));
    }),
  };
});

const event: CalendarEvent = {
  uid: 'e1', href: '/e1.ics', calendarId: 'c1', accountId: 'a1', summary: 'Party',
  dtstart: new Date(2026, 5, 15, 10), dtend: new Date(2026, 5, 15, 11),
  allDay: false, color: '#0082c9', attendees: [], isRecurring: false,
};
const events = [event];

const handlers = {
  onSelectDate: jest.fn(), onMonthChange: jest.fn(), onPressEvent: jest.fn(), onPressCell: jest.fn(),
};
const view = (date: Date) => (
  <MonthDayView date={date} events={events} weekStartsOn={0} jump={{ nonce: 0, target: date }} {...handlers} />
);

function pages(): React.ReactElement[] {
  latestRenderPage = (globalThis as any).__renderPage;
  return [-1, 0, 1].map((index) => latestRenderPage!({ index }));
}

// What React.memo does: skip when every prop is identical.
function wouldSkip(a: React.ReactElement, b: React.ReactElement): boolean {
  const pa = a.props as Record<string, unknown>;
  const pb = b.props as Record<string, unknown>;
  const keys = new Set([...Object.keys(pa), ...Object.keys(pb)]);
  return [...keys].every((k) => Object.is(pa[k], pb[k]));
}

describe('month pages across a swipe', () => {
  // A swipe settling reports the 1st of the new month, so the date prop moves
  // from mid-June to July 1 while the pager keeps showing May / June / July.
  const june10 = new Date(2026, 5, 10);
  const july1 = new Date(2026, 6, 1);

  it('leaves the page that neither gains nor loses the highlighted day untouched', () => {
    const { rerender } = rtlRender(view(june10), { wrapper: ThemeWrapper });
    const before = pages();
    rerender(view(july1));
    const after = pages();

    // May: the highlight was never there and still isn't.
    expect(wouldSkip(before[0], after[0])).toBe(true);
  });

  it('re-renders at most the two pages the highlight moves between', () => {
    const { rerender } = rtlRender(view(june10), { wrapper: ThemeWrapper });
    const before = pages();
    rerender(view(july1));
    const after = pages();

    const rerendered = before.filter((b, i) => !wouldSkip(b, after[i])).length;
    expect(rerendered).toBeLessThanOrEqual(2);
  });

  it('gives a page the same weeks array each time so its layout is not recomputed', () => {
    const { rerender } = rtlRender(view(june10), { wrapper: ThemeWrapper });
    const before = pages();
    rerender(view(july1));
    const after = pages();

    for (let i = 0; i < 3; i++) {
      expect((after[i].props as any).weeks).toBe((before[i].props as any).weeks);
    }
  });

  it('re-renders every page when the events change, since they all depend on them', () => {
    const { rerender } = rtlRender(view(june10), { wrapper: ThemeWrapper });
    const before = pages();
    rerender(
      <MonthDayView date={june10} events={[event, { ...event, uid: 'e2' }]} weekStartsOn={0}
        jump={{ nonce: 0, target: june10 }} {...handlers} />
    );
    const after = pages();
    expect(before.every((b, i) => !wouldSkip(b, after[i]))).toBe(true);
  });
});
