import type { CalendarEvent, RecurrenceEditScope } from '@/types';

export type MoveEventDecision =
  | { kind: 'commit'; scope: RecurrenceEditScope }
  | { kind: 'prompt' };

export function decideMoveEventScope(
  event: Pick<CalendarEvent, 'isRecurring' | 'rrule'>,
): MoveEventDecision {
  if (!event.isRecurring) return { kind: 'commit', scope: 'all' };
  // No raw rrule string to preserve at all (should not happen in synced data,
  // isRecurring always comes from an rrule property being present) — nothing
  // to lose either way, so skip the prompt rather than ask about a series we
  // can't describe.
  if (!event.rrule) return { kind: 'commit', scope: 'this' };
  // Previously this fell back to a silent scope:'this' commit whenever the
  // rule used an RRULE feature parseRrule doesn't model (BYMONTHDAY,
  // BYSETPOS, ...), with no indication to the user. That's no longer needed
  // for safety — eventToInput/EventForm now preserve the original rrule line
  // verbatim when it can't be parsed, so every scope is safe to apply. Always
  // let the user choose.
  return { kind: 'prompt' };
}
