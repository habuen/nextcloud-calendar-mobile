import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';

import { averageHz, perfProbe, SLOW_FRAME_MS, TIGHT_FRAME_MS, type PerfSnapshot } from './perfProbe';

const JS_TICK_MS = 50;
const REFRESH_MS = 300;

// A diagnostic, off unless switched on in Settings. Shows the worst moments
// since it was last cleared, so: switch it on, swipe through some months, read
// it. Tap it to clear.
//  - "JS" is how long the JS thread was tied up (a timer that should fire every
//    50 ms firing late). Big numbers here mean our own code is the cost.
//  - "UI" is the gap between drawn frames on the UI thread. Big numbers here
//    with a small JS figure mean the cost is native (views, Skia, compositing).
//    "avg" is the frame rate the screen actually ran the app at: about 16.7 ms
//    is 60 Hz, about 8.3 ms is 120 Hz. ">12" counts frames that missed a
//    90 Hz-or-better budget, so it is nearly every frame at 60 Hz.
//  - "builds" are month pictures made on the JS thread.
export function PerfMeter() {
  const [snap, setSnap] = useState<PerfSnapshot>(() => perfProbe.snapshot());
  const uiMax = useSharedValue(0);
  const uiSlow = useSharedValue(0);
  const uiFrames = useSharedValue(0);
  const uiOverTight = useSharedValue(0);
  const uiGapTotal = useSharedValue(0);
  const uiReset = useSharedValue(0);

  useFrameCallback((frame) => {
    'worklet';
    if (uiReset.value) {
      uiMax.value = 0; uiSlow.value = 0; uiOverTight.value = 0; uiFrames.value = 0; uiGapTotal.value = 0; uiReset.value = 0;
    }
    const gap = frame.timeSincePreviousFrame;
    // The first callback has no previous frame.
    if (gap === null || gap === undefined) return;
    uiFrames.value += 1;
    uiGapTotal.value += gap;
    if (gap > uiMax.value) uiMax.value = gap;
    if (gap > SLOW_FRAME_MS) uiSlow.value += 1;
    if (gap > TIGHT_FRAME_MS) uiOverTight.value += 1;
  });

  useEffect(() => {
    let last = Date.now();
    const tick = setInterval(() => {
      const now = Date.now();
      perfProbe.recordJsLag(now - last - JS_TICK_MS);
      last = now;
    }, JS_TICK_MS);
    const refresh = setInterval(() => {
      perfProbe.recordUiFrames({
        max: uiMax.value, slow: uiSlow.value, overTight: uiOverTight.value,
        frames: uiFrames.value, gapTotal: uiGapTotal.value,
      });
      setSnap(perfProbe.snapshot());
    }, REFRESH_MS);
    return () => { clearInterval(tick); clearInterval(refresh); };
  }, [uiMax, uiSlow, uiOverTight, uiFrames, uiGapTotal]);

  const avgBuild = snap.builds ? snap.buildTotal / snap.builds : 0;
  const hz = averageHz(snap);
  const avgGap = snap.uiFrames ? snap.uiGapTotal / snap.uiFrames : 0;
  return (
    <Pressable
      testID="perf-meter"
      style={styles.box}
      onPress={() => { perfProbe.reset(); uiReset.value = 1; setSnap(perfProbe.snapshot()); }}
    >
      <Text style={styles.text}>{`JS  worst ${snap.jsStallMax.toFixed(0)} ms · late ticks ${snap.jsStalls}`}</Text>
      <Text style={styles.text}>{`UI  worst ${snap.uiFrameMax.toFixed(0)} ms · slow ${snap.uiSlowFrames}/${snap.uiFrames}`}</Text>
      <Text style={styles.text}>{`UI  avg ${avgGap.toFixed(1)} ms (${hz.toFixed(0)} Hz) · >12 ms ${snap.uiOverTight}`}</Text>
      <Text style={styles.text}>{`builds ${snap.builds} · avg ${avgBuild.toFixed(0)} ms · worst ${snap.buildMax.toFixed(0)} ms`}</Text>
      <Text style={styles.hint}>tap to clear</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    right: 8,
    top: 4,
    zIndex: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  text: { color: '#fff', fontSize: 10, fontFamily: 'monospace' },
  hint: { color: '#aaa', fontSize: 9, fontFamily: 'monospace' },
});
