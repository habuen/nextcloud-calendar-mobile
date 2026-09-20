import type { Attendee, CalendarEvent } from '@/types';
import { dedupeAttendees } from '@/utils/attendees';

import Event from '../models/Event';

function parseAttendees(raw?: string): Attendee[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? dedupeAttendees(parsed as Attendee[]) : [];
  } catch {
    return [];
  }
}

export function mapEventToShared(event: Event): CalendarEvent {
  return {
    uid: event.uid,
    href: event.href,
    calendarId: event.calendarId,
    accountId: event.accountId,
    summary: event.summary,
    description: event.description ?? undefined,
    location: event.location ?? undefined,
    dtstart: new Date(event.start),
    dtend: new Date(event.end),
    allDay: !!event.allDay,
    color: event.color,
    attendees: parseAttendees(event.attendees),
    organizerEmail: event.organizerEmail ?? undefined,
    talkUrl: event.talkUrl ?? undefined,
    isRecurring: !!event.isRecurring,
    rrule: event.rrule ?? undefined,
    recurrenceId: event.recurrenceId != null ? new Date(event.recurrenceId) : undefined,
    alarmMinutes: event.alarmMinutes ?? undefined,
    isTask: !!event.isTask,
  };
}

// ---------------------------------------------------------------------------
// Reusing events across database emissions
// ---------------------------------------------------------------------------

const SEP = '\u0001';
const NIL = '\u0002';
const part = (v: unknown): string => (v == null ? NIL : String(v));

// Every column mapEventToShared reads. If this misses one, an edit to it would
// go unnoticed (the old event object would be handed back), so a test changes
// each field in turn and checks the event is rebuilt.
export function eventSignature(e: Event): string {
  return part(e.uid) + SEP + part(e.href) + SEP + part(e.calendarId) + SEP + part(e.accountId) + SEP
    + part(e.summary) + SEP + part(e.description) + SEP + part(e.location) + SEP
    + part(e.start) + SEP + part(e.end) + SEP + part(e.allDay) + SEP + part(e.color) + SEP
    + part(e.attendees) + SEP + part(e.organizerEmail) + SEP + part(e.talkUrl) + SEP
    + part(e.isRecurring) + SEP + part(e.rrule) + SEP + part(e.recurrenceId) + SEP
    + part(e.alarmMinutes) + SEP + part(e.isTask);
}

export interface EventMapper {
  map(rows: Event[]): CalendarEvent[];
}

// Rows the database hands back on every emission are mapped into CalendarEvent
// objects (dates built, attendee JSON parsed). A window shift, or a sync
// touching some other event, re-emits nearly the same rows, and mapping them all
// again also gave every consumer brand-new objects, so everything downstream saw
// "changed" and redid its work. This hands back the previous object for a row
// whose columns are unchanged, and only maps the ones that did change. A row
// that left the window and came back is still recognised (up to MAX_CACHED),
// and is rebuilt if it changed while away.
const MAX_CACHED = 3000;

export function createEventMapper(): EventMapper {
  const cache = new Map<string, { sig: string; event: CalendarEvent }>();
  return {
    map(rows) {
      const out = rows.map((row) => {
        const sig = eventSignature(row);
        const hit = cache.get(row.id);
        let event: CalendarEvent;
        if (hit && hit.sig === sig) {
          event = hit.event;
        } else {
          event = mapEventToShared(row);
        }
        cache.delete(row.id); // re-insert so it counts as the most recently used
        cache.set(row.id, { sig, event });
        return event;
      });
      while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string);
      return out;
    },
  };
}

export function sameEvents(a: CalendarEvent[], b: CalendarEvent[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
