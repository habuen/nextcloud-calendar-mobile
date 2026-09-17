import { memo, useCallback, useMemo } from 'react';
import { View, Pressable, StyleSheet, type GestureResponderEvent } from 'react-native';
import { useTheme } from 'expo-router';
import dayjs from 'dayjs';
import { eventPositionStyle, nowTopPct } from '../utils/grid';
import type { GridEvent } from '../utils/toGridEvents';
import type { PositionedEvent } from '../utils/eventLayout';
import { TimeGridEvent } from './TimeGridEvent';

interface Props {
  date: Date;
  positioned: PositionedEvent[];
  hourRowHeight: number;
  // Only set (by TimeGridPage) for whichever column is actually today; every
  // other column gets `undefined`, which stays referentially stable across
  // the current-time ticker so non-today columns don't re-render every
  // minute just to rebuild the same event list.
  now: Date | undefined;
  onPressSlot: (d: Date) => void;
  onPressEvent: (e: GridEvent) => void;
  dimmedUid?: string;
}

function DayColumnImpl({ date, positioned, hourRowHeight, now, onPressSlot, onPressEvent, dimmedUid }: Props) {
  const { colors } = useTheme();

  const columnStyle = useMemo(
    () => [styles.column, { borderLeftWidth: 1, borderLeftColor: colors.border }],
    [colors.border]
  );

  const handlePress = useCallback(
    (e: GestureResponderEvent) => {
      const raw = Math.floor(e.nativeEvent.locationY / hourRowHeight);
      const hour = Math.min(23, Math.max(0, raw));
      onPressSlot(dayjs(date).hour(hour).minute(0).second(0).millisecond(0).toDate());
    },
    [date, hourRowHeight, onPressSlot]
  );

  return (
    <View testID="day-column" style={columnStyle}>
      <Pressable testID="day-column-surface" style={StyleSheet.absoluteFill} onPress={handlePress} />

      {positioned.map(({ event, leftPct, widthPct, zIndex }) => {
        const { top, height } = eventPositionStyle(event.start, event.end);
        return (
          <TimeGridEvent
            key={`${event._event.uid}-${event.start.getTime()}`}
            event={event}
            top={top}
            height={height}
            leftPct={leftPct}
            widthPct={widthPct}
            zIndex={zIndex}
            hourRowHeight={hourRowHeight}
            dimmed={dimmedUid === event._event.uid}
            onPress={onPressEvent}
          />
        );
      })}

      {now !== undefined && (
        <View
          testID="now-indicator"
          pointerEvents="none"
          style={[styles.nowIndicator, { top: `${nowTopPct(now)}%` }]}
        />
      )}
    </View>
  );
}

export const DayColumn = memo(DayColumnImpl);

const styles = StyleSheet.create({
  column: { flex: 1, overflow: 'hidden' },
  nowIndicator: {
    position: 'absolute',
    zIndex: 10000,
    height: 2,
    width: '100%',
    backgroundColor: 'red',
  },
});
