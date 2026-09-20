import { renderHook } from '@testing-library/react-native';
import { useCalendarData } from '@/features/calendar/hooks/useCalendarData';
import type { Account, CalendarEvent, CalendarMeta } from '@/types';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@/database/sync', () => ({ syncEvents: jest.fn().mockResolvedValue(undefined) }));

let mockDbEvents: CalendarEvent[] = [];
let mockCalendars: CalendarMeta[] = [];
let mockHidden: string[] = [];
jest.mock('@/database/useEvents', () => ({ useEventsForRange: () => mockDbEvents }));
jest.mock('@/stores/accountStore', () => ({
  useAccountStore: (sel: (s: { activeAccountId: string }) => unknown) => sel({ activeAccountId: 'acc-1' }),
}));
jest.mock('@/stores/calendarStore', () => ({
  useCalendarStore: (sel: (s: { hiddenCalendarIds: string[] }) => unknown) => sel({ hiddenCalendarIds: mockHidden }),
}));
const mockAccount: Account = {
  id: 'acc-1', displayName: 'C', baseUrl: 'https://c.example', username: 'c', appPassword: 'x', davUserId: 'c',
};
jest.mock('@/hooks/useAccounts', () => ({ useActiveAccount: () => mockAccount }));
jest.mock('@/hooks/useCalendars', () => ({
  useCalendars: () => ({ data: mockCalendars, isFetching: false }),
}));

const cal = (id: string, over: Partial<CalendarMeta> = {}): CalendarMeta => ({
  id, accountId: 'acc-1', displayName: id, color: '#0082c9', ctag: '1', url: `https://c.example/${id}/`, slug: id, ...over,
});
const ev = (uid: string, calendarId: string): CalendarEvent => ({
  uid, href: `/${uid}.ics`, calendarId, accountId: 'acc-1', summary: uid,
  dtstart: new Date(2026, 5, 15, 9), dtend: new Date(2026, 5, 15, 10),
  allDay: false, color: '#0082c9', attendees: [], isRecurring: false,
});

const june = new Date(2026, 5, 15);
const run = () => renderHook(() => useCalendarData(june));

beforeEach(() => {
  mockCalendars = [cal('editable'), cal('locked', { isReadOnly: true }), cal('shared', { isSubscribed: true })];
  mockHidden = [];
  mockDbEvents = [ev('a', 'editable'), ev('b', 'locked'), ev('c', 'shared')];
});

describe('useCalendarData events', () => {
  it('marks events of read-only and subscribed calendars, and leaves the others alone', () => {
    const { result } = run();
    const byUid = Object.fromEntries(result.current.allEvents.map((e) => [e.uid, e]));
    expect(byUid.a.readOnly).toBeUndefined();
    expect(byUid.b.readOnly).toBe(true);
    expect(byUid.c.readOnly).toBe(true);
  });

  it('hands back the very same read-only event object each time the list is recomputed', () => {
    const first = run().result.current.allEvents.find((e) => e.uid === 'b')!;
    // A new calendars array with the same content (what a refetch produces),
    // which recomputes the list from the same database events.
    mockCalendars = [...mockCalendars];
    const second = run().result.current.allEvents.find((e) => e.uid === 'b')!;
    expect(second).toBe(first);
  });

  it('keeps an untouched editable event as the database\'s own object', () => {
    const { result } = run();
    expect(result.current.allEvents.find((e) => e.uid === 'a')).toBe(mockDbEvents[0]);
  });

  it('makes a fresh read-only copy when the event itself is a new object', () => {
    const first = run().result.current.allEvents.find((e) => e.uid === 'b')!;
    mockDbEvents = [ev('a', 'editable'), ev('b', 'locked'), ev('c', 'shared')];
    const second = run().result.current.allEvents.find((e) => e.uid === 'b')!;
    expect(second).not.toBe(first);
    expect(second.readOnly).toBe(true);
  });

  it('drops the events of a hidden calendar', () => {
    mockHidden = ['locked'];
    expect(run().result.current.allEvents.map((e) => e.uid)).toEqual(['a', 'c']);
  });
});
