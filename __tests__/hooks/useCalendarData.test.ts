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

  it('clears the loading indicator when its sync ends, even after the effect that started it was replaced', async () => {
    const loading = (r: { current: ReturnType<typeof useCalendarData> }) =>
      r.current.showFullOverlay || r.current.showSmallLoader;

    const { result, rerender } = renderHook(({ d }: { d: Date }) => useCalendarData(d), { initialProps: { d: june } });
    await waitFor(() => expect(mockedSync).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(loading(result)).toBe(false));
    mockedSync.mockClear();

    // Moving on to July needs August, whose sync we hold open...
    let finish!: () => void;
    mockedSync.mockImplementationOnce(() => new Promise<void>((res) => { finish = res; }));
    rerender({ d: july });
    await waitFor(() => expect(loading(result)).toBe(true));

    // ...then back to June, whose whole window is already synced, so the new
    // effect starts no sync of its own and can't be what turns the spinner off.
    rerender({ d: june });
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
});
