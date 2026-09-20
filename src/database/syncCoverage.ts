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
const inFlight = new Map<string, Promise<boolean>>();

// Swiping through several months used to start one sync per month at once,
// each sending its own requests for every calendar, so the month you landed on
// queued behind a pile of syncs for months you'd already passed. Syncs go
// through this small scheduler instead: a couple at a time, newest visible
// month first, and a sync for a month you've left is dropped if it hasn't
// started yet.
export const MAX_CONCURRENT_SYNCS = 2;
const VISIBLE = 0;
const PREFETCH = 1;

interface Job {
  run: () => Promise<void>;
  priority: number;
  isStale: () => boolean;
  seq: number;
  settle: (ran: boolean) => void;
  fail: (e: unknown) => void;
}

const queue: Job[] = [];
let running = 0;
let epoch = 0;
let nextSeq = 0;

function pickNext(): Job | undefined {
  let best = -1;
  for (let i = 0; i < queue.length; i++) {
    const j = queue[i];
    if (best === -1) { best = i; continue; }
    const b = queue[best];
    if (j.priority !== b.priority) {
      if (j.priority < b.priority) best = i;
    } else if (j.priority === VISIBLE ? j.seq > b.seq : j.seq < b.seq) {
      // Visible: newest first (it's the month on screen). Prefetch: oldest first.
      best = i;
    }
  }
  return best === -1 ? undefined : queue.splice(best, 1)[0];
}

function pump(): void {
  while (running < MAX_CONCURRENT_SYNCS) {
    const job = pickNext();
    if (!job) return;
    if (job.isStale()) { job.settle(false); continue; }
    running += 1;
    const myEpoch = epoch;
    job.run().then(
      () => job.settle(true),
      (e) => job.fail(e),
    ).finally(() => {
      if (myEpoch === epoch) running -= 1;
      pump();
    });
  }
}

// Resolves true if the job ran, false if it was dropped as stale before it
// started.
function schedule(run: () => Promise<void>, priority: number, isStale: () => boolean): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    queue.push({ run, priority, isStale, seq: nextSeq++, settle: resolve, fail: reject });
    pump();
  });
}

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

// True if any of the months has not been synced at all (in any way, however
// long ago) since the app started. Those are the months whose events may simply
// not be here yet; every other month already shows what it has, and a sync of
// it only brings it up to date.
export function hasNeverSynced(scope: string, months: Date[]): boolean {
  return months.some((m) => !covered.has(entryKey(scope, m)));
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
  queue.length = 0;
  running = 0;
  epoch += 1;
}

// Syncs only the uncovered months of `months`, one range at a time, and marks
// each range covered once it succeeds (a failed range stays uncovered, so the
// next visit retries it). The same range requested twice at once shares one
// request. `isStale` reports that the caller has moved on: its queued ranges
// are dropped rather than started.
export async function syncUncovered(opts: {
  scope: string;
  months: Date[];
  full: boolean;
  run: (start: Date, end: Date) => Promise<void>;
  isStale?: () => boolean;
}): Promise<void> {
  const { scope, months, full, run, isStale = () => false } = opts;
  for (const range of missingRanges(scope, months, full)) {
    // A shared request can be dropped as stale by whoever queued it first while
    // this caller is still interested, so try again once before giving up.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (isStale()) return;
      const key = `${scope}|${full}|${range.start.getTime()}|${range.end.getTime()}`;
      let pending = inFlight.get(key);
      if (!pending) {
        pending = schedule(() => run(range.start, range.end), full ? VISIBLE : PREFETCH, isStale)
          .then((ran) => {
            if (ran) markCovered(scope, range.months, full);
            return ran;
          })
          .finally(() => { inFlight.delete(key); });
        inFlight.set(key, pending);
      }
      if (await pending) break;
    }
  }
}
