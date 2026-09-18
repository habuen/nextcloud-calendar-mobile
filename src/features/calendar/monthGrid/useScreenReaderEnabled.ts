import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// Whether a screen reader (TalkBack / VoiceOver) is on. The canvas month view
// has no per-day elements of its own, so it only builds an accessible overlay
// when one is running and costs nothing otherwise.
export function useScreenReaderEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isScreenReaderEnabled().then((v) => { if (alive) setEnabled(v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setEnabled);
    return () => { alive = false; sub.remove(); };
  }, []);
  return enabled;
}
