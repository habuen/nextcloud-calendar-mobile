import { memo, useMemo, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { Canvas, Picture, createPicture } from '@shopify/react-native-skia';
import dayjs from 'dayjs';
import { useSettingsStore } from '@/stores/settingsStore';
import type { CalendarEvent } from '@/types';
import { drawMonthPage, type MonthPalette } from './monthDraw';
import { layoutMonthPage, resolvePageTouch } from './monthLayout';
import { useScreenReaderEnabled } from './useScreenReaderEnabled';

export interface MonthGridCanvasProps {
  weeks: (dayjs.Dayjs | null)[][];
  today: dayjs.Dayjs;
  eventsByDay: Map<string, CalendarEvent[]>;
  pagerHeight: number;
  // Width already taken by the week-number column beside this, if shown.
  gutterWidth: number;
  mode: 'bars' | 'dots';
  colors: { surfaceRaised: string; primary: string; text: string; textTertiary: string };
  onDayPress: (d: dayjs.Dayjs) => void;
  onPressCell: (d: Date) => void;
  onPressEvent: (e: CalendarEvent) => void;
}

// A whole month page drawn onto ONE canvas from a recorded picture, with one
// touch surface over it. The view-based renderer builds a couple of hundred
// native views per page on the JS thread as a page swipes in; this builds none:
// laying the page out is arithmetic, recording the picture is a few hundred
// draw calls, and the canvas paints it off the JS thread.
export const MonthGridCanvas = memo(function MonthGridCanvas({
  weeks, today, eventsByDay, pagerHeight, gutterWidth, mode, colors, onDayPress, onPressCell, onPressEvent,
}: MonthGridCanvasProps) {
  // Seeded from the window so the first frame is already the right size; the
  // real width replaces it once measured (only differs if the window isn't the
  // full pager width).
  const [width, setWidth] = useState(() => Dimensions.get('window').width - gutterWidth);

  const layout = useMemo(
    () => layoutMonthPage({ weeks, eventsByDay, width, height: pagerHeight, mode, today }),
    [weeks, eventsByDay, width, pagerHeight, mode, today],
  );

  const palette = useMemo<MonthPalette>(
    () => ({
      tile: colors.surfaceRaised,
      primary: colors.primary,
      text: colors.text,
      textTertiary: colors.textTertiary,
    }),
    [colors.surfaceRaised, colors.primary, colors.text, colors.textTertiary],
  );

  const picture = useMemo(
    () => createPicture((canvas) => drawMonthPage(canvas, layout, palette), { width: layout.width, height: layout.height }),
    [layout, palette],
  );

  const handle = (e: GestureResponderEvent, long: boolean) => {
    const { week, hit } = resolvePageTouch(e.nativeEvent.locationX, e.nativeEvent.locationY, layout);
    if (hit.kind === 'event' && !long) { onPressEvent(hit.segment.event); return; }
    const col = hit.kind === 'event' ? hit.segment.startCol : hit.col;
    const day = weeks[week]?.[col];
    if (!day) return;
    if (long) onPressCell(day.toDate());
    else onDayPress(day);
  };

  const screenReader = useScreenReaderEnabled();
  const language = useSettingsStore((s) => s.language);

  return (
    <View testID="canvas-area" style={styles.area} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
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
      {screenReader && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {weeks.map((week, wi) => week.map((day, ci) => {
            if (!day) return null;
            const titles = (eventsByDay.get(day.format('YYYY-MM-DD')) ?? []).map((e) => e.summary);
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
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  area: { flex: 1 },
  canvas: { flex: 1 },
});
