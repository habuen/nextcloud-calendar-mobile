import dayjs from 'dayjs';
import { createPicture, type SkPicture } from '@shopify/react-native-skia';
import type { CalendarEvent } from '@/types';
import { keyOfDayNumber } from './dayMath';
import { drawMonthPage, type MonthPalette } from './monthDraw';
import { layoutMonthPage, weekDayNumbers, type MonthPageLayout } from './monthLayout';

export interface MonthPage {
  layout: MonthPageLayout;
  picture: SkPicture;
  // Titles of the events on a day ('YYYY-MM-DD'), for the screen-reader labels.
  // Read from the events the page was built from, so a page never has to be
  // handed the whole event map just to describe itself.
  titlesFor(dayKey: string): string[];
}

// Everything a page is drawn from except the events. When any of it changes the
// whole cache is replaced (that is the invalidation); the events are compared
// per month instead, so one month's events changing doesn't redo the others.
export interface MonthPageConfig {
  width: number;
  height: number;
  mode: 'bars' | 'dots';
  today: dayjs.Dayjs;
  palette: MonthPalette;
}

export interface MonthPageCache {
  // The month's page: built on first ask, then handed back as long as the
  // events it shows are the same ones.
  get(weeks: (dayjs.Dayjs | null)[][], eventsByDay: Map<string, CalendarEvent[]>): MonthPage;
}

// Enough for the month shown, the ones the pager keeps mounted beside it and
// the ones warmed ahead of a swipe, with some slack for swiping back.
const MAX_PAGES = 9;

const eventIds = new WeakMap<object, number>();
let nextEventId = 1;
function idOf(e: object): number {
  let id = eventIds.get(e);
  if (id === undefined) { id = nextEventId++; eventIds.set(e, id); }
  return id;
}

const dayKeys = new WeakMap<object, string[]>();
function dayKeysOf(weeks: (dayjs.Dayjs | null)[][]): string[] {
  let keys = dayKeys.get(weeks);
  if (!keys) {
    keys = [];
    for (const week of weeks) for (const n of weekDayNumbers(week)) if (n === n) keys.push(keyOfDayNumber(n));
    dayKeys.set(weeks, keys);
  }
  return keys;
}

// A fingerprint of the events a month shows: which event objects are on each of
// its days, in order. Events are immutable objects that the data layer hands
// back unchanged for unchanged rows (see createEventMapper), so the same objects
// mean the same page. A window shift or a sync that touched some other month
// leaves this month's fingerprint alone, and its recorded picture is reused.
export function monthDigest(weeks: (dayjs.Dayjs | null)[][], eventsByDay: Map<string, CalendarEvent[]>): string {
  let digest = '';
  for (const key of dayKeysOf(weeks)) {
    const list = eventsByDay.get(key);
    if (list) for (const e of list) digest += `${idOf(e)},`;
    digest += ';';
  }
  return digest;
}

// A month's layout and recorded picture can be built ahead of the swipe that
// shows it. Pager pages mount halfway through a swipe; building there (laying
// out, recording, shaping every event title) is what made the swipe stutter.
// Keyed by the weeks array itself, which the caller reuses per month. Least
// recently used months are dropped past MAX_PAGES, which caps the memory the
// recorded pictures hold (they are native, so the JS garbage collector would
// not feel them).
export function createMonthPageCache(config: MonthPageConfig): MonthPageCache {
  const pages = new Map<object, { digest: string; page: MonthPage }>();
  return {
    get(weeks, eventsByDay) {
      const digest = monthDigest(weeks, eventsByDay);
      let entry = pages.get(weeks);
      if (entry && entry.digest === digest) {
        pages.delete(weeks); // re-insert so it counts as the most recently used
      } else {
        const layout = layoutMonthPage({ weeks, eventsByDay, ...config });
        const picture = createPicture(
          (canvas) => drawMonthPage(canvas, layout, config.palette),
          { width: layout.width, height: layout.height },
        );
        entry = {
          digest,
          page: {
            layout,
            picture,
            titlesFor: (key) => (eventsByDay.get(key) ?? []).map((e) => e.summary),
          },
        };
        pages.delete(weeks);
        if (pages.size >= MAX_PAGES) pages.delete(pages.keys().next().value as object);
      }
      pages.set(weeks, entry);
      return entry.page;
    },
  };
}
