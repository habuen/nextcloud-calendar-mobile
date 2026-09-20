import dayjs from 'dayjs';
import { createPicture, type SkPicture } from '@shopify/react-native-skia';
import type { CalendarEvent } from '@/types';
import { drawMonthPage, type MonthPalette } from './monthDraw';
import { layoutMonthPage, type MonthPageLayout } from './monthLayout';

export interface MonthPage {
  layout: MonthPageLayout;
  picture: SkPicture;
}

export interface MonthPageInputs {
  eventsByDay: Map<string, CalendarEvent[]>;
  width: number;
  height: number;
  mode: 'bars' | 'dots';
  today: dayjs.Dayjs;
  palette: MonthPalette;
}

export interface MonthPageCache {
  // Builds the page on first ask; every later ask for the same weeks is a lookup.
  get(weeks: (dayjs.Dayjs | null)[][]): MonthPage;
}

// Enough for the month shown, the ones the pager keeps mounted beside it and
// the ones warmed ahead of a swipe, with some slack for swiping back.
const MAX_PAGES = 9;

// A month's layout and recorded picture depend on nothing but its weeks and the
// inputs the cache was made with, so they can be built ahead of the swipe that
// shows them. Pager pages mount halfway through a swipe; building there (laying
// out, recording, shaping every event title) is what made the swipe stutter.
// Make a new cache whenever any input changes: that is the invalidation.
// Keyed by the weeks array itself, which the caller reuses per month. Least
// recently used months are dropped past MAX_PAGES, which caps the memory the
// recorded pictures hold (they are native, so the JS garbage collector would
// not feel them).
export function createMonthPageCache(inputs: MonthPageInputs): MonthPageCache {
  const pages = new Map<object, MonthPage>();
  return {
    get(weeks) {
      let page = pages.get(weeks);
      if (page) {
        pages.delete(weeks); // re-insert so it counts as the most recently used
      } else {
        const layout = layoutMonthPage({ weeks, ...inputs });
        const picture = createPicture(
          (canvas) => drawMonthPage(canvas, layout, inputs.palette),
          { width: layout.width, height: layout.height },
        );
        page = { layout, picture };
        if (pages.size >= MAX_PAGES) pages.delete(pages.keys().next().value as object);
      }
      pages.set(weeks, page);
      return page;
    },
  };
}
