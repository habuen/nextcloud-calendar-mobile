import { createEventMapper, eventSignature, sameEvents } from '@/database/mappers/event';
import type Event from '@/database/models/Event';

function row(over: Record<string, unknown> = {}, id = 'r1'): Event {
  return {
    id, uid: 'u1', href: '/u1.ics', calendarId: 'cal', accountId: 'acc', summary: 'Standup',
    description: 'daily', location: 'Room 2', start: 1_800_000_000_000, end: 1_800_003_600_000,
    allDay: false, color: '#0082c9', attendees: JSON.stringify([{ email: 'a@b.c', displayName: 'A' }]),
    organizerEmail: 'o@x.y', talkUrl: undefined, isRecurring: false, rrule: undefined,
    recurrenceId: undefined, alarmMinutes: 10, isTask: false,
    ...over,
  } as unknown as Event;
}

describe('createEventMapper', () => {
  it('hands back the same event object for a row whose columns have not changed', () => {
    const mapper = createEventMapper();
    const [first] = mapper.map([row()]);
    const [second] = mapper.map([row()]);
    expect(second).toBe(first);
  });

  it('does not map or parse anything again for an unchanged row', () => {
    const mapper = createEventMapper();
    mapper.map([row()]);
    const parse = jest.spyOn(JSON, 'parse');
    mapper.map([row()]);
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
  });

  // Each column the mapper reads. Changing any one must produce a new event,
  // or an edit to it would be silently lost behind the old object.
  const changes: [string, unknown][] = [
    ['uid', 'u2'], ['href', '/other.ics'], ['calendarId', 'cal2'], ['accountId', 'acc2'],
    ['summary', 'Renamed'], ['description', 'changed'], ['location', 'Elsewhere'],
    ['start', 1_800_000_060_000], ['end', 1_800_007_200_000], ['allDay', true], ['color', '#ff0000'],
    ['attendees', JSON.stringify([{ email: 'z@z.z' }])], ['organizerEmail', 'p@x.y'],
    ['talkUrl', 'https://talk/call/1'], ['isRecurring', true], ['rrule', 'RRULE:FREQ=DAILY'],
    ['recurrenceId', 1_799_999_000_000], ['alarmMinutes', 30], ['isTask', true],
  ];
  it.each(changes)('rebuilds the event when %s changes', (field, value) => {
    const mapper = createEventMapper();
    const [before] = mapper.map([row()]);
    const [after] = mapper.map([row({ [field]: value })]);
    expect(after).not.toBe(before);
  });

  it('tells an emptied field apart from a missing one', () => {
    const mapper = createEventMapper();
    const [withNone] = mapper.map([row({ description: undefined })]);
    const [withEmpty] = mapper.map([row({ description: '' })]);
    expect(withEmpty).not.toBe(withNone);
    expect(withEmpty.description).toBe('');
    expect(withNone.description).toBeUndefined();
  });

  it('covers every column in the signature that changing it should notice', () => {
    const base = eventSignature(row());
    for (const [field, value] of changes) expect(eventSignature(row({ [field]: value }))).not.toBe(base);
  });

  it('maps only the rows that changed, keeping the rest', () => {
    const mapper = createEventMapper();
    const [a1, b1] = mapper.map([row({}, 'a'), row({ summary: 'B' }, 'b')]);
    const [a2, b2] = mapper.map([row({}, 'a'), row({ summary: 'B renamed' }, 'b')]);
    expect(a2).toBe(a1);
    expect(b2).not.toBe(b1);
    expect(b2.summary).toBe('B renamed');
  });

  it('recognises a row that left the window and came back unchanged', () => {
    const mapper = createEventMapper();
    const [a1] = mapper.map([row({}, 'a')]);
    mapper.map([row({}, 'b')]); // window moved: a is gone
    const [a2] = mapper.map([row({}, 'a')]);
    expect(a2).toBe(a1);
  });

  it('rebuilds a row that changed while it was out of the window', () => {
    const mapper = createEventMapper();
    const [a1] = mapper.map([row({}, 'a')]);
    mapper.map([row({}, 'b')]);
    const [a2] = mapper.map([row({ summary: 'edited elsewhere' }, 'a')]);
    expect(a2).not.toBe(a1);
    expect(a2.summary).toBe('edited elsewhere');
  });

  it('keeps memory bounded, dropping the least recently used rows first', () => {
    const mapper = createEventMapper();
    const rows = Array.from({ length: 3010 }, (_, i) => row({ uid: `u${i}` }, `id${i}`));
    const first = mapper.map(rows);
    const again = mapper.map(rows);
    // The oldest were evicted so they are rebuilt; the newest are kept.
    expect(again[0]).not.toBe(first[0]);
    expect(again[3009]).toBe(first[3009]);
  });

  it('matches what mapEventToShared would have produced', () => {
    const [event] = createEventMapper().map([row()]);
    expect(event).toMatchObject({
      uid: 'u1', summary: 'Standup', allDay: false, color: '#0082c9', alarmMinutes: 10,
      attendees: [{ email: 'a@b.c', displayName: 'A' }],
    });
    expect(event.dtstart).toEqual(new Date(1_800_000_000_000));
  });
});

describe('sameEvents', () => {
  const e = (n: number) => ({ uid: `${n}` } as never);
  it('is true for the same array and for the same objects in the same order', () => {
    const list = [e(1), e(2)];
    expect(sameEvents(list, list)).toBe(true);
    expect(sameEvents(list, [...list])).toBe(true);
  });
  it('is false when the length, an element or the order differs', () => {
    const [a, b] = [e(1), e(2)];
    expect(sameEvents([a], [a, b])).toBe(false);
    expect(sameEvents([a, b], [a, e(2)])).toBe(false);
    expect(sameEvents([a, b], [b, a])).toBe(false);
  });
});
