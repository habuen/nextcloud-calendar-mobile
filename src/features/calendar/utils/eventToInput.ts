import type { Account, CalendarEvent, CreateEventInput } from '@/types';
import { resolveOrganizer } from '@/features/event/utils/organizer';
import { parseRrule } from './parseRrule';

export function eventToInput(event: CalendarEvent, account: Account): CreateEventInput {
  const { organizerEmail, organizerName } = resolveOrganizer(account);
  const rrule = parseRrule(event.rrule);
  return {
    summary: event.summary,
    calendarId: event.calendarId,
    dtstart: event.dtstart,
    dtend: event.dtend,
    allDay: event.allDay,
    description: event.description,
    location: event.location,
    attendees: [...event.attendees],
    withTalkRoom: false,
    organizerEmail,
    organizerName,
    rrule,
    // parseRrule only understands a subset of RRULE (no BYMONTHDAY, BYSETPOS,
    // ...). When it can't represent the event's actual rule, fall back to the
    // original line so a rebuilt ICS re-emits it verbatim instead of a
    // rebuild silently turning the whole series into a one-time event.
    rawRrule: !rrule && event.rrule ? event.rrule : undefined,
    alarmMinutes: event.alarmMinutes,
  };
}
