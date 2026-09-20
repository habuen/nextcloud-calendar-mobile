// Peaks recorded while the app is used, read by the on-screen meter. Plain
// numbers and no allocation per sample, so leaving the recording calls in place
// costs nothing when the meter is off.
export interface PerfSnapshot {
  // Longest time the JS thread was unavailable to a 50 ms timer.
  jsStallMax: number;
  // Timer ticks that came in more than 16 ms late.
  jsStalls: number;
  // UI-thread frames: the longest gap between two, how many gaps were over
  // SLOW_FRAME_MS, and how many frames in all.
  uiFrameMax: number;
  uiSlowFrames: number;
  uiFrames: number;
  // Month pictures built on the JS thread (layout + recording).
  builds: number;
  buildMax: number;
  buildTotal: number;
}

export const SLOW_FRAME_MS = 20;
export const STALL_MS = 16;

export interface PerfProbe {
  recordJsLag(ms: number): void;
  recordUiFrames(max: number, slow: number, frames: number): void;
  recordBuild(ms: number): void;
  reset(): void;
  snapshot(): PerfSnapshot;
}

function empty(): PerfSnapshot {
  return { jsStallMax: 0, jsStalls: 0, uiFrameMax: 0, uiSlowFrames: 0, uiFrames: 0, builds: 0, buildMax: 0, buildTotal: 0 };
}

export function createPerfProbe(): PerfProbe {
  let s = empty();
  return {
    recordJsLag(ms) {
      if (ms > s.jsStallMax) s.jsStallMax = ms;
      if (ms > STALL_MS) s.jsStalls += 1;
    },
    // The UI thread keeps its own running totals; these are read from it.
    recordUiFrames(max, slow, frames) {
      s.uiFrameMax = max;
      s.uiSlowFrames = slow;
      s.uiFrames = frames;
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

export const perfProbe = createPerfProbe();
