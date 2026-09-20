import { createPerfProbe } from '@/features/calendar/perf/perfProbe';

describe('perfProbe', () => {
  it('starts empty', () => {
    expect(createPerfProbe().snapshot()).toEqual({
      jsStallMax: 0, jsStalls: 0, uiFrameMax: 0, uiSlowFrames: 0, uiFrames: 0, builds: 0, buildMax: 0, buildTotal: 0,
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
    p.recordUiFrames(48, 5, 300);
    expect(p.snapshot()).toMatchObject({ uiFrameMax: 48, uiSlowFrames: 5, uiFrames: 300 });
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
