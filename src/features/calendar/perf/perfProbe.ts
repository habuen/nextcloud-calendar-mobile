// Peaks recorded while the app is used, read by the on-screen meter. Plain
// numbers and no allocation per sample, so leaving the recording calls in place
// costs nothing when the meter is off.
export interface PerfSnapshot {
  // Longest time the JS thread was unavailable to a 50 ms timer.
  jsStallMax: number;
  // Timer ticks that came in more than 16 ms late.
  jsStalls: number;
  // UI-thread frames: the longest gap between two, how many gaps were over
  // SLOW_FRAME_MS, how many were over TIGHT_FRAME_MS (a screen running at 60 Hz
  // is over it on every frame; one at 90 Hz or more is not), how many frames in
  // all, and the sum of the gaps, from which the average rate follows.
  uiFrameMax: number;
  uiSlowFrames: number;
  uiOverTight: number;
  uiFrames: number;
  uiGapTotal: number;
  // Month pictures built on the JS thread (layout + recording).
  builds: number;
  buildMax: number;
  buildTotal: number;
}

export const SLOW_FRAME_MS = 20;
export const TIGHT_FRAME_MS = 12;
export const STALL_MS = 16;

export interface PerfProbe {
  recordJsLag(ms: number): void;
  recordUiFrames(t: { max: number; slow: number; overTight: number; frames: number; gapTotal: number }): void;
  recordBuild(ms: number): void;
  reset(): void;
  snapshot(): PerfSnapshot;
}

function empty(): PerfSnapshot {
  return { jsStallMax: 0, jsStalls: 0, uiFrameMax: 0, uiSlowFrames: 0, uiOverTight: 0, uiFrames: 0, uiGapTotal: 0, builds: 0, buildMax: 0, buildTotal: 0 };
}

export function createPerfProbe(): PerfProbe {
  let s = empty();
  return {
    recordJsLag(ms) {
      if (ms > s.jsStallMax) s.jsStallMax = ms;
      if (ms > STALL_MS) s.jsStalls += 1;
    },
    // The UI thread keeps its own running totals; these are read from it.
    recordUiFrames({ max, slow, overTight, frames, gapTotal }) {
      s.uiFrameMax = max;
      s.uiSlowFrames = slow;
      s.uiOverTight = overTight;
      s.uiFrames = frames;
      s.uiGapTotal = gapTotal;
    },
    recordBuild(ms) {
      s.builds += 1;
      s.buildTotal += ms;
      if (ms > s.buildMax) s.buildMax = ms;
    },
    reset() { s = empty(); },
    snapshot() { return { ...s }; },
  };
}

// The average frame rate the UI thread ran at, from the recorded gaps; 0 with
// nothing recorded yet.
export function averageHz(s: Pick<PerfSnapshot, 'uiFrames' | 'uiGapTotal'>): number {
  return s.uiFrames > 0 && s.uiGapTotal > 0 ? (s.uiFrames * 1000) / s.uiGapTotal : 0;
}

export const perfProbe = createPerfProbe();
