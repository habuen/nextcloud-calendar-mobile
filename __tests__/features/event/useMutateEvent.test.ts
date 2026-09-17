import { renderHook, act, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useCreateEvent, useUpdateEvent, useDeleteEvent } from '@/features/event/hooks/useMutateEvent';
import * as caldav from '@/services/nextcloud/caldav';
import * as eventWrites from '@/database/eventWrites';
import type { Account, CalendarMeta, CalendarEvent, CreateEventInput } from '@/types';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@/services/nextcloud/caldav');
jest.mock('@/database/eventWrites');

const mockedCaldav = caldav as jest.Mocked<typeof caldav>;
const mockedWrites = eventWrites as jest.Mocked<typeof eventWrites>;

// A promise the test controls the settling of, to prove the hook's returned
// promise doesn't wait on it.
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const account: Account = {
  id: 'acc-1', displayName: 'Charlie', baseUrl: 'https://cloud.example.org',
  username: 'charlie', appPassword: 'secret', davUserId: 'charlie',
};

const calendar: CalendarMeta = {
  id: 'cal-1', accountId: 'acc-1', displayName: 'Personal', color: '#0082c9',
  ctag: '1', url: 'https://cloud.example.org/remote.php/dav/calendars/charlie/personal/', slug: 'personal',
};

const input: CreateEventInput = {
  summary: 'Standup', calendarId: 'cal-1',
  dtstart: new Date(2026, 7, 7, 9, 0), dtend: new Date(2026, 7, 7, 9, 30),
  allDay: false, attendees: [], withTalkRoom: false,
  organizerEmail: 'charlie@example.org', organizerName: 'Charlie',
};

const existingEvent: CalendarEvent = {
  uid: 'e1', href: '/e1.ics', calendarId: 'cal-1', accountId: 'acc-1',
  summary: 'Standup', dtstart: input.dtstart, dtend: input.dtend,
  allDay: false, color: '#0082c9', attendees: [], isRecurring: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockedWrites.insertEvents.mockResolvedValue(undefined);
  mockedWrites.removeWhere.mockResolvedValue([existingEvent]);
  mockedWrites.patchByUid.mockResolvedValue(undefined);
  mockedWrites.snapshotByBase.mockResolvedValue([existingEvent]);
  mockedWrites.restoreSeries.mockResolvedValue(undefined);
});

describe('useCreateEvent', () => {
  it('resolves as soon as the local optimistic write is done, without waiting for the CalDAV round-trip', async () => {
    const { promise: putPromise } = deferred<void>();
    mockedCaldav.putEvent.mockReturnValue(putPromise as unknown as ReturnType<typeof caldav.putEvent>);

    const { result } = renderHook(() => useCreateEvent(account, [calendar]));

    await act(async () => {
      // putEvent's promise is intentionally left unsettled — if mutateAsync
      // awaited it inline, this would hang and the test would time out.
      await result.current.mutateAsync(input);
    });

    expect(mockedWrites.insertEvents).toHaveBeenCalled();
    expect(mockedCaldav.putEvent).toHaveBeenCalled();
  });

  it('still reverts the optimistic write and alerts once the background round-trip eventually fails', async () => {
    const { promise: putPromise, reject } = deferred<void>();
    mockedCaldav.putEvent.mockReturnValue(putPromise as unknown as ReturnType<typeof caldav.putEvent>);

    const { result } = renderHook(() => useCreateEvent(account, [calendar]));
    await act(async () => { await result.current.mutateAsync(input); });

    reject(new Error('network down'));

    await waitFor(() => {
      expect(mockedWrites.removeWhere).toHaveBeenCalled();
      expect(Alert.alert).toHaveBeenCalled();
    });
  });
});

describe('useUpdateEvent', () => {
  it('resolves as soon as the local optimistic write is done, without waiting for the CalDAV round-trip', async () => {
    const { promise: updatePromise } = deferred<void>();
    mockedCaldav.updateEvent.mockReturnValue(updatePromise as unknown as ReturnType<typeof caldav.updateEvent>);
    mockedCaldav.fetchEventIcs.mockResolvedValue('BEGIN:VCALENDAR\r\nEND:VCALENDAR');

    const { result } = renderHook(() => useUpdateEvent(account, [calendar]));

    await act(async () => {
      await result.current.mutateAsync({ event: existingEvent, input });
    });

    expect(mockedWrites.patchByUid).toHaveBeenCalled();
    expect(mockedCaldav.updateEvent).toHaveBeenCalled();
  });

  it('still restores the snapshot and alerts once the background round-trip eventually fails', async () => {
    const { promise: updatePromise, reject } = deferred<void>();
    mockedCaldav.updateEvent.mockReturnValue(updatePromise as unknown as ReturnType<typeof caldav.updateEvent>);
    mockedCaldav.fetchEventIcs.mockResolvedValue('BEGIN:VCALENDAR\r\nEND:VCALENDAR');

    const { result } = renderHook(() => useUpdateEvent(account, [calendar]));
    await act(async () => {
      await result.current.mutateAsync({ event: existingEvent, input });
    });

    reject(new Error('network down'));

    await waitFor(() => {
      expect(mockedWrites.restoreSeries).toHaveBeenCalled();
      expect(Alert.alert).toHaveBeenCalled();
    });
  });
});

describe('useDeleteEvent', () => {
  it('resolves as soon as the local optimistic removal is done, without waiting for the CalDAV round-trip', async () => {
    const { promise: deletePromise } = deferred<void>();
    mockedCaldav.deleteEvent.mockReturnValue(deletePromise as unknown as ReturnType<typeof caldav.deleteEvent>);

    const { result } = renderHook(() => useDeleteEvent(account));

    await act(async () => {
      await result.current.mutateAsync({ event: existingEvent });
    });

    expect(mockedWrites.removeWhere).toHaveBeenCalled();
    expect(mockedCaldav.deleteEvent).toHaveBeenCalled();
  });

  it('still restores the removed event and alerts once the background round-trip eventually fails', async () => {
    const { promise: deletePromise, reject } = deferred<void>();
    mockedCaldav.deleteEvent.mockReturnValue(deletePromise as unknown as ReturnType<typeof caldav.deleteEvent>);

    const { result } = renderHook(() => useDeleteEvent(account));
    await act(async () => { await result.current.mutateAsync({ event: existingEvent }); });

    reject(new Error('network down'));

    await waitFor(() => {
      expect(mockedWrites.insertEvents).toHaveBeenCalledWith([existingEvent]);
      expect(Alert.alert).toHaveBeenCalled();
    });
  });
});
