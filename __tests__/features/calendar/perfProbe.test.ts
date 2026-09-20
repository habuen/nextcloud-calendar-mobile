import { averageHz, createPerfProbe } from '@/features/calendar/perf/perfProbe';

describe('perfProbe', () => {
  it('starts empty', () => {
    expect(createPerfProbe().snapshot()).toEqual({
      jsStallMax: 0, jsStalls: 0, uiFrameMax: 0, uiSlowFrames: 0, uiOverTight: 0, uiFrames: 0, uiGapTotal: 0, builds: 0, buildMax: 0, buildTotal: 0,
    });
  });

  it('keeps the worst JS lag and counts only late ticks as stalls', () => {
    const p = createPerfProbe();
    [0, 3, 40, 12, 90, 5].forEach((ms) => p.recordJsLag(ms));
    expect(p.snapshot().jsStallMax).toBe(90);
    expect(p.snapshot().jsStalls).toBe(2);
  });

  it('totals and peaks the month builds', () => {
    const p = createPerfProbe();
    [10, 30, 20].forEach((ms) => p.recordBuild(ms));
    expect(p.snapshot()).toMatchObject({ builds: 3, buildTotal: 60, buildMax: 30 });
  });

  it('takes the UI-thread figures as given', () => {
    const p = createPerfProbe();
    p.recordUiFrames({ max: 48, slow: 5, overTight: 120, frames: 300, gapTotal: 3000 });
    expect(p.snapshot()).toMatchObject({ uiFrameMax: 48, uiSlowFrames: 5, uiOverTight: 120, uiFrames: 300, uiGapTotal: 3000 });
  });

  it('clears everything on reset and hands out copies', () => {
    const p = createPerfProbe();
    p.recordBuild(10);
    const before = p.snapshot();
    p.reset();
    expect(p.snapshot().builds).toBe(0);
    expect(before.builds).toBe(1);
  });
});

describe('averageHz', () => {
  it('turns the average gap into a frame rate', () => {
    expect(averageHz({ uiFrames: 600, uiGapTotal: 10000 })).toBeCloseTo(60, 5); // 16.67 ms
    expect(averageHz({ uiFrames: 1200, uiGapTotal: 10000 })).toBeCloseTo(120, 5); // 8.33 ms
  });

  it('is 0 before any frame is recorded', () => {
    expect(averageHz({ uiFrames: 0, uiGapTotal: 0 })).toBe(0);
  });
});
