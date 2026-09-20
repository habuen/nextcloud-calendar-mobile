import { renderHook, act } from '@testing-library/react-native';
import { useEventsForRange } from '@/database/useEvents';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

type Row = Record<string, unknown>;
const subscribers: ((rows: Row[]) => void)[] = [];
const unsubscribed = jest.fn();
const queryCalls: unknown[][] = [];

const fakeDatabase = {
  get: () => ({
    query: (...conditions: unknown[]) => {
      queryCalls.push(conditions);
      return {
        observeWithColumns: () => ({
          subscribe: (cb: (rows: Row[]) => void) => {
            subscribers.push(cb);
            return { unsubscribe: () => { unsubscribed(); subscribers.splice(subscribers.indexOf(cb), 1); } };
          },
        }),
      };
    },
  }),
};

jest.mock('@/database/DatabaseProvider', () => ({ useDatabase: () => fakeDatabase }));
jest.mock('@nozbe/watermelondb', () => ({
  Q: { where: (...a: unknown[]) => a, lt: (v: number) => ['lt', v], gt: (v: number) => ['gt', v] },
}));

const row = (id: string, start: number, over: Row = {}): Row => ({
  id, uid: `u-${id}`, href: `/${id}.ics`, calendarId: 'cal', accountId: 'acc', summary: `Event ${id}`,
  description: undefined, location: undefined, start, end: start + 3_600_000, allDay: false, color: '#0082c9',
  attendees: '[]', organizerEmail: undefined, talkUrl: undefined, isRecurring: false, rrule: undefined,
  recurrenceId: undefined, alarmMinutes: undefined, isTask: false, ...over,
});
const emit = (rows: Row[]) => act(() => { subscribers.forEach((cb) => cb(rows)); });

const w1 = { start: new Date(2026, 4, 1), end: new Date(2026, 6, 31) };
const w2 = { start: new Date(2026, 5, 1), end: new Date(2026, 7, 31) };

beforeEach(() => {
  subscribers.length = 0;
  unsubscribed.mockClear();
  queryCalls.length = 0;
});

describe('useEventsForRange', () => {
  it('returns the mapped events sorted by start', () => {
    const { result } = renderHook(() => useEventsForRange('acc', w1.start, w1.end));
    emit([row('b', 2000), row('a', 1000)]);
    expect(result.current.map((e) => e.uid)).toEqual(['u-a', 'u-b']);
  });

  it('keeps the same array when the database re-emits identical rows', () => {
    const { result } = renderHook(() => useEventsForRange('acc', w1.start, w1.end));
    emit([row('a', 1000), row('b', 2000)]);
    const first = result.current;
    emit([row('a', 1000), row('b', 2000)]);
    expect(result.current).toBe(first);
  });

  it('gives a new array, keeping the untouched events, when one row changes', () => {
    const { result } = renderHook(() => useEventsForRange('acc', w1.start, w1.end));
    emit([row('a', 1000), row('b', 2000)]);
    const [a1, b1] = result.current;
    emit([row('a', 1000), row('b', 2000, { summary: 'renamed' })]);
    const [a2, b2] = result.current;
    expect(a2).toBe(a1);
    expect(b2).not.toBe(b1);
    expect(b2.summary).toBe('renamed');
  });

  it('gives a new array when a row appears or disappears', () => {
    const { result } = renderHook(() => useEventsForRange('acc', w1.start, w1.end));
    emit([row('a', 1000)]);
    const first = result.current;
    emit([row('a', 1000), row('b', 2000)]);
    expect(result.current).not.toBe(first);
    expect(result.current).toHaveLength(2);
    emit([row('b', 2000)]);
    expect(result.current.map((e) => e.uid)).toEqual(['u-b']);
  });

  it('keeps the events that are in both windows as the same objects when the window moves', () => {
    const { result, rerender } = renderHook(
      ({ w }: { w: { start: Date; end: Date } }) => useEventsForRange('acc', w.start, w.end),
      { initialProps: { w: w1 } },
    );
    emit([row('may', 1000), row('june', 2000), row('july', 3000)]);
    const before = new Map(result.current.map((e) => [e.uid, e]));

    rerender({ w: w2 });
    expect(unsubscribed).toHaveBeenCalledTimes(1); // the old query stopped
    emit([row('june', 2000), row('july', 3000), row('aug', 4000)]);

    const after = new Map(result.current.map((e) => [e.uid, e]));
    expect(after.get('u-june')).toBe(before.get('u-june'));
    expect(after.get('u-july')).toBe(before.get('u-july'));
    expect(after.has('u-may')).toBe(false);
    expect(after.has('u-aug')).toBe(true);
  });

  it('stops listening when it unmounts', () => {
    const { unmount } = renderHook(() => useEventsForRange('acc', w1.start, w1.end));
    unmount();
    expect(unsubscribed).toHaveBeenCalledTimes(1);
  });

  it('no longer serialises the whole list to compare emissions', () => {
    const stringify = jest.spyOn(JSON, 'stringify');
    const { result } = renderHook(() => useEventsForRange('acc', w1.start, w1.end));
    emit([row('a', 1000), row('b', 2000)]);
    emit([row('a', 1000), row('b', 2000)]);
    expect(result.current).toHaveLength(2);
    expect(stringify).not.toHaveBeenCalled();
    stringify.mockRestore();
  });
});
