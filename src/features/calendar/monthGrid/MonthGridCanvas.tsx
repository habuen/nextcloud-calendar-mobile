import { memo } from 'react';
import { Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { Canvas, Picture } from '@shopify/react-native-skia';
import dayjs from 'dayjs';
import { useSettingsStore } from '@/stores/settingsStore';
import type { CalendarEvent } from '@/types';
import { resolvePageTouch } from './monthLayout';
import type { MonthPage } from './monthPageCache';

export interface MonthGridCanvasProps {
  weeks: (dayjs.Dayjs | null)[][];
  // The month's layout and recorded picture, built (or fetched) by the caller so
  // that mounting this does no layout or drawing work of its own.
  page: MonthPage;
  // Whether a screen reader is running; only then is the accessible overlay built.
  screenReader: boolean;
  onDayPress: (d: dayjs.Dayjs) => void;
  onPressCell: (d: Date) => void;
  onPressEvent: (e: CalendarEvent) => void;
}

// A whole month page drawn onto ONE canvas from a recorded picture, with one
// touch surface over it. The view-based renderer builds a couple of hundred
// native views per page on the JS thread as a page swipes in; this builds none,
// and (see monthPageCache) neither lays out nor records anything itself: the
// page it is handed is already built, so a swipe only mounts a canvas.
export const MonthGridCanvas = memo(function MonthGridCanvas({
  weeks, page, screenReader, onDayPress, onPressCell, onPressEvent,
}: MonthGridCanvasProps) {
  const { layout, picture } = page;

  const handle = (e: GestureResponderEvent, long: boolean) => {
    const { week, hit } = resolvePageTouch(e.nativeEvent.locationX, e.nativeEvent.locationY, layout);
    if (hit.kind === 'event' && !long) { onPressEvent(hit.segment.event); return; }
    const col = hit.kind === 'event' ? hit.segment.startCol : hit.col;
    const day = weeks[week]?.[col];
    if (!day) return;
    if (long) onPressCell(day.toDate());
    else onDayPress(day);
  };

  return (
    <View testID="canvas-area" style={styles.area}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Canvas style={styles.canvas}>
          <Picture picture={picture} />
        </Canvas>
      </View>
      <Pressable
        testID="week-touch"
        style={StyleSheet.absoluteFill}
        onPress={(e) => handle(e, false)}
        onLongPress={(e) => handle(e, true)}
      />
      {screenReader && <PageAccessibility weeks={weeks} page={page} onDayPress={onDayPress} />}
    </View>
  );
});

// One labelled button per day, only built while a screen reader is running, so
// the page has no per-day elements the rest of the time.
const PageAccessibility = memo(function PageAccessibility({
  weeks, page, onDayPress,
}: { weeks: (dayjs.Dayjs | null)[][]; page: MonthPage; onDayPress: (d: dayjs.Dayjs) => void }) {
  const language = useSettingsStore((s) => s.language);
  const { layout } = page;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {weeks.map((week, wi) => week.map((day, ci) => {
        if (!day) return null;
        const titles = page.titlesFor(day.format('YYYY-MM-DD'));
        const label = [day.locale(language).format('dddd, LL'), ...titles.slice(0, 3), titles.length > 3 ? `+${titles.length - 3}` : '']
          .filter(Boolean).join(', ');
        return (
          <View
            key={`${wi}-${ci}`}
            accessible
            accessibilityRole="button"
            accessibilityLabel={label}
            onAccessibilityTap={() => onDayPress(day)}
            style={{
              position: 'absolute',
              left: (ci * layout.width) / 7,
              top: wi * layout.rowHeight,
              width: layout.width / 7,
              height: layout.rowHeight,
            }}
          />
        );
      }))}
    </View>
  );
});

const styles = StyleSheet.create({
  area: { flex: 1 },
  canvas: { flex: 1 },
});
