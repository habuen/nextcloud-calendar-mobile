import dayjs from 'dayjs';

export interface DateRange {
  start: Date;
  end: Date;
}

export function monthRange(date: Date): DateRange {
  const y = dayjs(date).year();
  const m = dayjs(date).month();
  return {
    start: new Date(y, m - 1, 1),
    end: new Date(y, m + 2, 0, 23, 59, 59, 999),
  };
}

export function monthRangeAt(date: Date, monthOffset: number): DateRange {
  return monthRange(dayjs(date).add(monthOffset, 'month').toDate());
}

// The months of events kept in memory around `date`: two either side. Wider than
// monthRange (one either side) so the month you are about to swipe to already has
// its events when you settle on the current one. The window follows the date with
// a short delay (fetchDate is debounced), so at that moment it is still centred
// on the previous month; with one month either side, the next month was not in
// it, got drawn empty and filled in a moment later.
export function eventsWindow(date: Date): DateRange {
  const y = dayjs(date).year();
  const m = dayjs(date).month();
  return {
    start: new Date(y, m - 2, 1),
    end: new Date(y, m + 3, 0, 23, 59, 59, 999),
  };
}
