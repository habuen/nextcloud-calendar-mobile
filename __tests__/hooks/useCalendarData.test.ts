import { renderHook, act, waitFor } from '@testing-library/react-native';
import dayjs from 'dayjs';
import { useCalendarData } from '@/features/calendar/hooks/useCalendarData';
import { syncEvents } from '@/database/sync';
import { resetCoverage } from '@/database/syncCoverage';
import type { Account, CalendarMeta } from '@/types';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@/database/sync', () => ({ syncEvents: jest.fn() }));
jest.mock('@/database/useEvents', () => ({ useEventsForRange: () => [] }));
jest.mock('@/stores/accountStore', () => ({
  useAccountStore: (sel: (s: { activeAccountId: string }) => unknown) => sel({ activeAccountId: 'acc-1' }),
}));
jest.mock('@/stores/calendarStore', () => ({
  useCalendarStore: (sel: (s: { hiddenCalendarIds: string[] }) => unknown) => sel({ hiddenCalendarIds: [] }),
}));

const mockAccount: Account = {
  id: 'acc-1', displayName: 'C', baseUrl: 'https://c.example', username: 'c',
  appPassword: 'x', davUserId: 'c',
};
const mockCalendars: CalendarMeta[] = [
  { id: 'cal-1', accountId: 'acc-1', displayName: 'P', color: '#0082c9', ctag: '1', url: 'https://c.example/p/', slug: 'p' },
];

jest.mock('@/hooks/useAccounts', () => ({ useActiveAccount: () => mockAccount }));
jest.mock('@/hooks/useCalendars', () => ({
  useCalendars: () => ({ data: mockCalendars, isFetching: false }),
}));

const mockedSync = syncEvents as jest.Mock;
const ymd = (d: Date) => dayjs(d).format('YYYY-MM-DD');
const june = new Date(2026, 5, 15);
const july = new Date(2026, 6, 15);

beforeEach(() => {
  resetCoverage();
  mockedSync.mockReset();
  mockedSync.mockResolvedValue(undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('useCalendarData sync', () => {
  it('syncs the three visible months as one request, then quietly prefetches the months either side', async () => {
    renderHook(() => useCalendarData(june));

    await waitFor(() => expect(mockedSync).toHaveBeenCalledTimes(3));

    const ranges = mockedSync.mock.calls.map(([, , from, to, del]) => [ymd(from), ymd(to), del]);
    expect(ranges).toEqual([
      ['2026-05-01', '2026-07-31', true],
      ['2026-04-01', '2026-04-30', false],
      ['2026-08-01', '2026-08-31', false],
    ]);
  });

  it('fetches only the one new month after moving forward a month', async () => {
    const { rerender } = renderHook(({ d }: { d: Date }) => useCalendarData(d), { initialProps: { d: june } });
    await waitFor(() => expect(mockedSync).toHaveBeenCalledTimes(3));
    mockedSync.mockClear();

    rerender({ d: july });

    // June+1's window is May..Aug; only Aug is new and it was prefetched as
    // "soft", so it needs one full sync; Sep is the only new prefetch.
    await waitFor(() => expect(mockedSync).toHaveBeenCalledTimes(2));
    const ranges = mockedSync.mock.calls.map(([, , from, to, del]) => [ymd(from), ymd(to), del]);
    expect(ranges).toEqual([
      ['2026-08-01', '2026-08-31', true],
      ['2026-09-01', '2026-09-30', false],
    ]);
  });

  it('does nothing when returning to a month whose window is already synced', async () => {
    const { rerender } = renderHook(({ d }: { d: Date }) => useCalendarData(d), { initialProps: { d: june } });
    await waitFor(() => expect(mockedSync).toHaveBeenCalledTimes(3));
    mockedSync.mockClear();

    rerender({ d: june });
    await act(async () => { await Promise.resolve(); });

    expect(mockedSync).not.toHaveBeenCalled();
  });

  const loading = (r: { current: ReturnType<typeof useCalendarData> }) =>
    r.current.showFullOverlay || r.current.showSmallLoader;
  const farAway = new Date(2027, 2, 15);

  it('clears the loading indicator when its sync ends, even after the effect that started it was replaced', async () => {
    const { result, rerender } = renderHook(({ d }: { d: Date }) => useCalendarData(d), { initialProps: { d: june } });
    await waitFor(() => expect(mockedSync).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(loading(result)).toBe(false));
    mockedSync.mockClear();

    // Jumping to a month never synced needs its sync, which we hold open...
    let finish!: () => void;
    mockedSync.mockImplementationOnce(() => new Promise<void>((res) => { finish = res; }));
    rerender({ d: farAway });
    await waitFor(() => expect(loading(result)).toBe(true));

    // ...then back to June, whose whole window is already synced, so the new
    // effect starts no sync of its own and can't be what turns the spinner off.
    rerender({ d: june });
    await act(async () => { finish(); });

    await waitFor(() => expect(loading(result)).toBe(false));
  });

  it('shows no spinner when a swipe only brings an already prefetched month up to date', async () => {
    const { result, rerender } = renderHook(({ d }: { d: Date }) => useCalendarData(d), { initialProps: { d: june } });
    await waitFor(() => expect(mockedSync).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(loading(result)).toBe(false));
    mockedSync.mockClear();

    // August was prefetched, so July's window only needs it refreshed.
    let finish!: () => void;
    mockedSync.mockImplementationOnce(() => new Promise<void>((res) => { finish = res; }));
    rerender({ d: july });
    await waitFor(() => expect(mockedSync).toHaveBeenCalledTimes(1));
    expect(ymd(mockedSync.mock.calls[0][2])).toBe('2026-08-01');
    expect(loading(result)).toBe(false);

    await act(async () => { finish(); });
    expect(loading(result)).toBe(false);
  });

  it('refreshes months quietly once their coverage has expired', async () => {
    const realNow = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(realNow);
    const { result, rerender } = renderHook(({ d }: { d: Date }) => useCalendarData(d), { initialProps: { d: june } });
    await waitFor(() => expect(mockedSync).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(loading(result)).toBe(false));
    mockedSync.mockClear();

    now.mockReturnValue(realNow + 10 * 60 * 1000);
    let finish!: () => void;
    mockedSync.mockImplementationOnce(() => new Promise<void>((res) => { finish = res; }));
    // Every month of July's window has expired, so it is all synced again.
    rerender({ d: july });
    await waitFor(() => expect(mockedSync).toHaveBeenCalled());
    expect(loading(result)).toBe(false);

    await act(async () => { finish(); });
    now.mockRestore();
  });

  it('shows the spinner for a month that has never been synced', async () => {
    let finish!: () => void;
    mockedSync.mockImplementationOnce(() => new Promise<void>((res) => { finish = res; }));
    const { result } = renderHook(() => useCalendarData(june));
    await waitFor(() => expect(loading(result)).toBe(true));
    await act(async () => { finish(); });
    await waitFor(() => expect(loading(result)).toBe(false));
  });

  it('does not prefetch the old neighbours once the user has moved to another month mid-sync', async () => {
    let finish!: () => void;
    mockedSync.mockImplementationOnce(() => new Promise<void>((res) => { finish = res; }));

    const { rerender } = renderHook(({ d }: { d: Date }) => useCalendarData(d), { initialProps: { d: june } });
    await waitFor(() => expect(mockedSync).toHaveBeenCalledTimes(1));

    rerender({ d: new Date(2027, 2, 15) });
    await act(async () => { finish(); });
    await act(async () => { await Promise.resolve(); });

    const starts = mockedSync.mock.calls.map(([, , from]) => ymd(from));
    // June's neighbours (April, August 2026) were never requested.
    expect(starts).not.toContain('2026-04-01');
    expect(starts).not.toContain('2026-08-01');
  });

  it('keeps swiping through many months from flooding the server, and still syncs the one you land on', async () => {
    const started: string[] = [];
    const finishers: (() => void)[] = [];
    mockedSync.mockImplementation((_a, _c, from: Date) => new Promise<void>((res) => {
      started.push(ymd(from));
      finishers.push(res);
    }));

    const { rerender } = renderHook(({ d }: { d: Date }) => useCalendarData(d), { initialProps: { d: june } });
    for (let m = 1; m <= 8; m++) {
      rerender({ d: new Date(2026, 5 + m * 2, 15) });
    }
    const landed = new Date(2026, 5 + 8 * 2, 15);
    await act(async () => { await Promise.resolve(); });

    // Only the limit's worth of syncs started while the rest waited.
    expect(started.length).toBeLessThanOrEqual(2);

    // Let everything finish; the month landed on must end up synced, and the
    // months swiped past in between must not have been.
    for (let i = 0; i < 40; i++) {
      await act(async () => { finishers.splice(0).forEach((f) => f()); await Promise.resolve(); });
    }
    const landedStart = ymd(new Date(landed.getFullYear(), landed.getMonth() - 1, 1));
    expect(started).toContain(landedStart);
    const passedThrough = ymd(new Date(2026, 5 + 4 * 2 - 1, 1));
    expect(started).not.toContain(passedThrough);
  });
});
