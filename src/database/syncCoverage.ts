import dayjs from 'dayjs';

// Which months the calendar screen has already synced from the server, so a
// month change only fetches what's actually missing instead of re-downloading
// the whole surrounding window every time.

export const COVERAGE_TTL_MS = 5 * 60 * 1000;

interface Entry {
  at: number;
  // A full sync also removes local events the server no longer has; a
  // prefetch sync doesn't. Only a full one satisfies a visible month.
  full: boolean;
}

const covered = new Map<string, Entry>();
const inFlight = new Map<string, Promise<void>>();

export interface MonthRange {
  start: Date;
  end: Date;
  months: Date[];
}

export function coverageScope(accountId: string, calendarIds: string[]): string {
  return `${accountId}|${[...calendarIds].sort().join(',')}`;
}

// Start-of-month dates around `center`, from `fromOffset` to `toOffset` months
// (inclusive).
export function monthsAround(center: Date, fromOffset: number, toOffset: number): Date[] {
  const base = dayjs(center).startOf('month');
  const out: Date[] = [];
  for (let o = fromOffset; o <= toOffset; o++) out.push(base.add(o, 'month').toDate());
  return out;
}

function entryKey(scope: string, month: Date): string {
  return `${scope}|${dayjs(month).format('YYYY-MM')}`;
}

function isCovered(scope: string, month: Date, needFull: boolean, now: number): boolean {
  const e = covered.get(entryKey(scope, month));
  if (!e || now - e.at > COVERAGE_TTL_MS) return false;
  return needFull ? e.full : true;
}

// Contiguous runs of months not covered yet, each as one range so a run of
// several missing months is a single request rather than one per month.
export function missingRanges(
  scope: string,
  months: Date[],
  needFull: boolean,
  now: number = Date.now(),
): MonthRange[] {
  const ranges: MonthRange[] = [];
  let run: Date[] = [];
  const flush = () => {
    if (run.length === 0) return;
    ranges.push({
      start: dayjs(run[0]).startOf('month').toDate(),
      end: dayjs(run[run.length - 1]).endOf('month').toDate(),
      months: run,
    });
    run = [];
  };
  for (const m of months) {
    if (isCovered(scope, m, needFull, now)) flush();
    else run.push(m);
  }
  flush();
  return ranges;
}

export function hasUncovered(
  scope: string,
  months: Date[],
  needFull: boolean,
  now: number = Date.now(),
): boolean {
  return months.some((m) => !isCovered(scope, m, needFull, now));
}

export function markCovered(scope: string, months: Date[], full: boolean, now: number = Date.now()): void {
  for (const m of months) {
    const key = entryKey(scope, m);
    const prev = covered.get(key);
    // A prefetch never downgrades a still-fresh full sync of the same month.
    const keepFull = prev && full === false && prev.full && now - prev.at <= COVERAGE_TTL_MS;
    covered.set(key, { at: keepFull ? prev.at : now, full: full || !!keepFull });
  }
}

export function resetCoverage(): void {
  covered.clear();
  inFlight.clear();
}

// Syncs only the uncovered months of `months`, one range at a time, and marks
// each range covered once it succeeds (a failed range stays uncovered, so the
// next visit retries it). The same range requested twice at once shares one
// request.
export async function syncUncovered(opts: {
  scope: string;
  months: Date[];
  full: boolean;
  run: (start: Date, end: Date) => Promise<void>;
}): Promise<void> {
  const { scope, months, full, run } = opts;
  for (const range of missingRanges(scope, months, full)) {
    const key = `${scope}|${full}|${range.start.getTime()}|${range.end.getTime()}`;
    let pending = inFlight.get(key);
    if (!pending) {
      pending = run(range.start, range.end)
        .then(() => markCovered(scope, range.months, full))
        .finally(() => { inFlight.delete(key); });
      inFlight.set(key, pending);
    }
    await pending;
  }
}
