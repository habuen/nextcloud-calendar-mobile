import { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';

import { syncEvents } from '@/database/sync';
import { coverageScope, hasUncovered, monthsAround, syncUncovered } from '@/database/syncCoverage';
import { useEventsForRange } from '@/database/useEvents';
import { useAccountStore } from '@/stores/accountStore';
import { useCalendarStore } from '@/stores/calendarStore';
import { useActiveAccount } from '@/hooks/useAccounts';
import { useCalendars } from '@/hooks/useCalendars';
import { normalizeEvents } from '@/utils/normalizeEvent';
import { monthRange } from '../utils/range';

export function useCalendarData(date: Date) {
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const hiddenCalendarIds = useCalendarStore((s) => s.hiddenCalendarIds);
  const activeAccount = useActiveAccount(activeAccountId);

  const { data: calendars = [], isFetching: calsFetching } = useCalendars(activeAccount);

  const year = dayjs(date).year();
  const month = dayjs(date).month();
  const { start, end } = useMemo(() => monthRange(date), [year, month]);

  const dbEvents = useEventsForRange(activeAccountId ?? '', start, end);

  const [syncing, setSyncing] = useState(false);
  // Visible-month syncs currently running. A counter rather than a flag: a
  // sync can outlive its effect (you swipe on mid-sync), and the spinner must
  // still clear when the last one ends, even if the effect that replaced it
  // found its months already synced and never started one of its own.
  const runningSyncs = useRef(0);


  useEffect(() => {
    if (!activeAccount || calendars.length === 0) return;
    if (calendars.some((c) => c.accountId !== activeAccount.id)) {
      if (__DEV__) {
        console.warn('[useCalendarData] stale calendars for account, skipping sync', activeAccount.id);
      }
      return;
    }
    let active = true;
    const scope = coverageScope(activeAccount.id, calendars.map((c) => c.id));
    // The three months the query above reads are what must be fresh; the
    // months just outside them are fetched quietly afterwards so the next
    // swipe already finds them in the database. Only months not synced
    // recently are fetched, so a swipe costs one month, not the whole window.
    const visible = monthsAround(date, -1, 1);
    const prefetch = [monthsAround(date, -2, -2), monthsAround(date, 2, 2)];
    const isStale = () => !active;
    const runSync = (deleteMissing: boolean) => (from: Date, to: Date) =>
      syncEvents(activeAccount, calendars, from, to, deleteMissing);

    (async () => {
      if (hasUncovered(scope, visible, true)) {
        runningSyncs.current += 1;
        setSyncing(true);
        try {
          await syncUncovered({ scope, months: visible, full: true, run: runSync(true), isStale });
        } catch (error) {
          console.warn('[useCalendarData] syncEvents failed:', String(error));
        } finally {
          runningSyncs.current -= 1;
          setSyncing(runningSyncs.current > 0);
        }
      }
      for (const months of prefetch) {
        // Moved on to another month while syncing: that month's own effect
        // handles its neighbours, so don't spend the network on stale ones.
        if (!active) return;
        try {
          await syncUncovered({ scope, months, full: false, run: runSync(false), isStale });
        } catch (e) {
          console.warn('[useCalendarData] prefetch syncEvents failed:', String(e));
        }
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccount?.id, calendars, start.getTime(), end.getTime()]);

  const allEvents = useMemo(() => {
    const nonEditableCalendarIds = new Set(
      calendars.filter((c) => c.isReadOnly || c.isSubscribed).map((c) => c.id),
    );
    return normalizeEvents(
      dbEvents.filter((e) => !hiddenCalendarIds.includes(e.calendarId)),
    ).map((e) =>
      nonEditableCalendarIds.has(e.calendarId) ? { ...e, readOnly: true } : e,
    );
  }, [dbEvents, hiddenCalendarIds, calendars]);

  const hadEventsRef = useRef(false);
  useEffect(() => {
    if (allEvents.length > 0) hadEventsRef.current = true;
  }, [allEvents]);
  useEffect(() => {
    hadEventsRef.current = false;
  }, [activeAccountId]);

  const showFullOverlay = !hadEventsRef.current && syncing && allEvents.length === 0;
  const showSmallLoader = (syncing || calsFetching) && !showFullOverlay;

  return { activeAccount, calendars, allEvents, showFullOverlay, showSmallLoader };
}
