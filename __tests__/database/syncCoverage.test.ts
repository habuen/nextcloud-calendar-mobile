import dayjs from 'dayjs';
import {
  COVERAGE_TTL_MS,
  MAX_CONCURRENT_SYNCS,
  coverageScope,
  hasUncovered,
  markCovered,
  missingRanges,
  monthsAround,
  resetCoverage,
  syncUncovered,
} from '@/database/syncCoverage';

const scope = 'acc|cal-a,cal-b';
const june = new Date(2026, 5, 15);
const ymd = (d: Date) => dayjs(d).format('YYYY-MM-DD');

beforeEach(() => resetCoverage());

describe('monthsAround', () => {
  it('lists start-of-month dates from the first offset to the last, inclusive', () => {
    expect(monthsAround(june, -1, 1).map(ymd)).toEqual(['2026-05-01', '2026-06-01', '2026-07-01']);
  });

  it('crosses a year boundary', () => {
    expect(monthsAround(new Date(2026, 0, 10), -2, -1).map(ymd)).toEqual(['2025-11-01', '2025-12-01']);
  });
});

describe('coverageScope', () => {
  it('does not depend on the order the calendars arrive in', () => {
    expect(coverageScope('a', ['x', 'y'])).toBe(coverageScope('a', ['y', 'x']));
  });

  it('differs when the set of calendars differs, so a new calendar gets fetched', () => {
    expect(coverageScope('a', ['x'])).not.toBe(coverageScope('a', ['x', 'y']));
  });
});

describe('missingRanges', () => {
  it('turns a run of uncovered months into one range spanning the whole run', () => {
    const [range, ...rest] = missingRanges(scope, monthsAround(june, -1, 1), true);
    expect(rest).toHaveLength(0);
    expect(ymd(range.start)).toBe('2026-05-01');
    expect(ymd(range.end)).toBe('2026-07-31');
    expect(range.months).toHaveLength(3);
  });

  it('ends a range at the last millisecond of its last month', () => {
    const [range] = missingRanges(scope, [june], true);
    expect(range.end.getTime()).toBe(new Date(2026, 5, 30, 23, 59, 59, 999).getTime());
  });

  it('splits around a month that is already covered', () => {
    const months = monthsAround(june, -1, 1);
    markCovered(scope, [months[1]], true);
    const ranges = missingRanges(scope, months, true);
    expect(ranges.map((r) => [ymd(r.start), ymd(r.end)])).toEqual([
      ['2026-05-01', '2026-05-31'],
      ['2026-07-01', '2026-07-31'],
    ]);
  });

  it('returns nothing when every month is covered', () => {
    const months = monthsAround(june, -1, 1);
    markCovered(scope, months, true);
    expect(missingRanges(scope, months, true)).toEqual([]);
    expect(hasUncovered(scope, months, true)).toBe(false);
  });

  it('only counts a full sync toward a visible month, not a prefetch', () => {
    markCovered(scope, [june], false);
    expect(hasUncovered(scope, [june], true)).toBe(true);
    expect(hasUncovered(scope, [june], false)).toBe(false);
  });

  it('lets a full sync satisfy a prefetch need too', () => {
    markCovered(scope, [june], true);
    expect(hasUncovered(scope, [june], false)).toBe(false);
  });

  it('treats a month as uncovered again once its entry is older than the TTL', () => {
    const t0 = 1_000_000;
    markCovered(scope, [june], true, t0);
    expect(missingRanges(scope, [june], true, t0 + COVERAGE_TTL_MS)).toEqual([]);
    expect(missingRanges(scope, [june], true, t0 + COVERAGE_TTL_MS + 1)).toHaveLength(1);
  });

  it('keeps months of different calendar sets apart', () => {
    markCovered(scope, [june], true);
    expect(hasUncovered('acc|cal-a', [june], true)).toBe(true);
  });

  it('does not let a prefetch downgrade a still-fresh full sync of the same month', () => {
    const t0 = 5_000_000;
    markCovered(scope, [june], true, t0);
    markCovered(scope, [june], false, t0 + 1000);
    expect(missingRanges(scope, [june], true, t0 + 2000)).toEqual([]);
  });
});

describe('syncUncovered', () => {
  it('fetches only the month that is new after swiping forward one month', async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    await syncUncovered({ scope, months: monthsAround(june, -1, 1), full: true, run });
    expect(run).toHaveBeenCalledTimes(1);

    run.mockClear();
    const july = new Date(2026, 6, 15);
    await syncUncovered({ scope, months: monthsAround(july, -1, 1), full: true, run });

    expect(run).toHaveBeenCalledTimes(1);
    const [start, end] = run.mock.calls[0];
    expect(ymd(start)).toBe('2026-08-01');
    expect(ymd(end)).toBe('2026-08-31');
  });

  it('does not fetch at all when returning to months it already has', async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    await syncUncovered({ scope, months: monthsAround(june, -1, 1), full: true, run });
    run.mockClear();

    await syncUncovered({ scope, months: monthsAround(june, -1, 1), full: true, run });

    expect(run).not.toHaveBeenCalled();
  });

  it('fetches one range for a jump to months it has never seen', async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    await syncUncovered({ scope, months: monthsAround(new Date(2027, 2, 1), -1, 1), full: true, run });
    expect(run).toHaveBeenCalledTimes(1);
    expect(ymd(run.mock.calls[0][0])).toBe('2027-02-01');
    expect(ymd(run.mock.calls[0][1])).toBe('2027-04-30');
  });

  it('leaves a failed range uncovered so the next visit retries it', async () => {
    const run = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    await expect(syncUncovered({ scope, months: [june], full: true, run })).rejects.toThrow('offline');

    await syncUncovered({ scope, months: [june], full: true, run });

    expect(run).toHaveBeenCalledTimes(2);
    expect(hasUncovered(scope, [june], true)).toBe(false);
  });

  it('shares one request when the same range is asked for twice at once', async () => {
    let finish!: () => void;
    const run = jest.fn().mockImplementation(() => new Promise<void>((res) => { finish = res; }));

    const first = syncUncovered({ scope, months: [june], full: true, run });
    const second = syncUncovered({ scope, months: [june], full: true, run });
    finish();
    await Promise.all([first, second]);

    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('sync scheduling', () => {
  // A run() the test settles by hand, recording the order calls start in.
  function controlled() {
    const started: string[] = [];
    const finishers: Record<string, () => void> = {};
    const runFor = (label: string) => () => new Promise<void>((res) => {
      started.push(label);
      finishers[label] = res;
    });
    return { started, finishers, runFor };
  }
  const month = (i: number) => new Date(2030, i, 1);
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('never runs more than the allowed number of syncs at once', async () => {
    const { started, finishers, runFor } = controlled();
    const jobs = [0, 1, 2, 3, 4].map((i) =>
      syncUncovered({ scope, months: [month(i)], full: true, run: runFor(`m${i}`) }));
    await flush();

    expect(started).toHaveLength(MAX_CONCURRENT_SYNCS);

    finishers[started[0]]();
    await flush();
    expect(started).toHaveLength(MAX_CONCURRENT_SYNCS + 1);

    for (const f of Object.values(finishers)) f();
    await flush();
    Object.values(finishers).forEach((f) => f());
    await flush();
    Object.values(finishers).forEach((f) => f());
    await Promise.all(jobs);
  });

  it('runs the newest visible month first once a slot frees up', async () => {
    const { started, finishers, runFor } = controlled();
    const jobs = [0, 1, 2, 3, 4].map((i) =>
      syncUncovered({ scope, months: [month(i)], full: true, run: runFor(`m${i}`) }));
    await flush();
    expect(started).toEqual(['m0', 'm1']);

    finishers.m0();
    await flush();
    expect(started[2]).toBe('m4');

    finishers.m1(); await flush();
    finishers.m4(); await flush();
    finishers.m3(); await flush();
    finishers.m2();
    await Promise.all(jobs);
  });

  it('runs a visible month before a prefetch that was queued earlier', async () => {
    const { started, finishers, runFor } = controlled();
    const busy = [0, 1].map((i) =>
      syncUncovered({ scope, months: [month(i)], full: true, run: runFor(`busy${i}`) }));
    await flush();
    const prefetch = syncUncovered({ scope, months: [month(5)], full: false, run: runFor('prefetch') });
    const visible = syncUncovered({ scope, months: [month(6)], full: true, run: runFor('visible') });

    finishers.busy0();
    await flush();
    expect(started[2]).toBe('visible');

    finishers.busy1(); await flush();
    finishers.visible(); await flush();
    finishers.prefetch();
    await Promise.all([...busy, prefetch, visible]);
  });

  it('drops a queued sync whose caller has moved on, without running or covering it', async () => {
    const { started, finishers, runFor } = controlled();
    const busy = [0, 1].map((i) =>
      syncUncovered({ scope, months: [month(i)], full: true, run: runFor(`busy${i}`) }));
    await flush();

    let stale = false;
    const dropped = syncUncovered({
      scope, months: [month(9)], full: true, run: runFor('dropped'), isStale: () => stale,
    });
    stale = true;

    finishers.busy0(); finishers.busy1();
    await Promise.all([...busy, dropped]);

    expect(started).not.toContain('dropped');
    expect(hasUncovered(scope, [month(9)], true)).toBe(true);
  });

  it('still serves a second caller that shares a request the first caller dropped', async () => {
    const { started, finishers, runFor } = controlled();
    const busy = [0, 1].map((i) =>
      syncUncovered({ scope, months: [month(i)], full: true, run: runFor(`busy${i}`) }));
    await flush();

    let firstStale = false;
    const first = syncUncovered({
      scope, months: [month(9)], full: true, run: runFor('shared'), isStale: () => firstStale,
    });
    const second = syncUncovered({ scope, months: [month(9)], full: true, run: runFor('shared') });
    firstStale = true;

    finishers.busy0(); finishers.busy1();
    await flush(); await flush();
    finishers.shared?.();
    await Promise.all([...busy, first, second]);

    expect(started.filter((l) => l === 'shared')).toHaveLength(1);
    expect(hasUncovered(scope, [month(9)], true)).toBe(false);
  });
});
