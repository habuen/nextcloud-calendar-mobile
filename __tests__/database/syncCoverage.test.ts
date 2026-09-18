import dayjs from 'dayjs';
import {
  COVERAGE_TTL_MS,
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
