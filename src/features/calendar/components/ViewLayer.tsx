import { memo, useRef } from 'react';
import { View, StyleSheet, Platform, type ViewProps, type ViewStyle } from 'react-native';
import { Freeze } from 'react-freeze';

interface Props extends ViewProps {
  visible: boolean;
}

function visibilityStyle(visible: boolean): ViewStyle {
  if (Platform.OS === 'ios') {
    return { opacity: visible ? 1 : 0, zIndex: visible ? 1 : 0 };
  }
  return { display: visible ? 'flex' : 'none' };
}

// The calendar screen keeps month, agenda and week/day views all alive so
// switching between them keeps scroll position and state — but they all get
// the same event list and date, so a hidden view used to re-render in full on
// every month swipe and every sync update for nothing. Two changes:
//  - a view isn't mounted until the first time it's shown (no work at startup
//    for views that may never be opened), and
//  - once mounted, it's frozen while hidden: it keeps its state but React skips
//    re-rendering it, then renders once with the latest props when shown again.
function ViewLayerImpl({ visible, style, children, ...rest }: Props) {
  const everShown = useRef(visible);
  if (visible) everShown.current = true;

  return (
    <View
      {...rest}
      collapsable={false}
      style={[StyleSheet.absoluteFill, visibilityStyle(visible), style]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      {everShown.current ? <Freeze freeze={!visible}>{children}</Freeze> : null}
    </View>
  );
}

export const ViewLayer = memo(ViewLayerImpl);
