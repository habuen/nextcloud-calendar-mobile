import { Q } from '@nozbe/watermelondb';
import { useEffect, useRef, useState } from 'react';

import type { CalendarEvent } from '@/types';

import { useDatabase } from './DatabaseProvider';
import { createEventMapper, sameEvents, type EventMapper } from './mappers/event';
import { EVENT_OBSERVED_COLUMNS } from './observedColumns';
import Event from './models/Event';

export function useEventsForRange(accountId: string, start: Date, end: Date, refresh = 0) {
  const database = useDatabase();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  // Lives as long as the hook, so an event that is in both the old and the new
  // window (or unchanged across a sync) keeps the same object.
  const mapper = useRef<EventMapper | null>(null);
  if (!mapper.current) mapper.current = createEventMapper();

  useEffect(() => {
    const query = database.get<Event>('events').query(
      Q.where('account_id', accountId),
      Q.where('start', Q.lt(end.getTime())),
      Q.where('end', Q.gt(start.getTime())),
    );
    const subscription = query.observeWithColumns(EVENT_OBSERVED_COLUMNS).subscribe((rows) => {
      const next = mapper.current!.map(rows).sort((a, b) => a.dtstart.getTime() - b.dtstart.getTime());
      // WatermelonDB emits on any row change to an observed column, even ones
      // that don't affect this range's content (e.g. a sync touching other
      // events' etags). Without this guard every such write hands every
      // calendar view (month grid, week grid, agenda) a brand-new array
      // reference and forces a full re-render cascade for no visible change.
      // Unchanged rows come back as the same objects (see createEventMapper),
      // so comparing them by identity is exact — and no longer a JSON.stringify
      // of the whole list on every emission.
      setEvents((prev) => (sameEvents(prev, next) ? prev : next));
    });
    return () => subscription.unsubscribe();
  }, [accountId, start, end, database, refresh]);

  return events;
}
