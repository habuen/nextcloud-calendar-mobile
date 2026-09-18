import React, { useDeferredValue } from 'react';
import { Text } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { ViewLayer } from '@/features/calendar/components/ViewLayer';

// The calendar screen drives its view layers from a *deferred* copy of the view
// mode (useDeferredValue). That's a low-priority update, and React refuses to
// commit a low-priority update that would re-hide already-visible Suspense
// content — which is exactly what freezing a layer does. So a freeze that flips
// inside that update stalls the whole view switch.
function Screen({ mode }: { mode: 'month' | 'day' }) {
  const deferred = useDeferredValue(mode);
  return (
    <>
      <ViewLayer testID="month-layer" visible={deferred === 'month'}><Text>month</Text></ViewLayer>
      <ViewLayer testID="day-layer" visible={deferred === 'day'}><Text>day</Text></ViewLayer>
    </>
  );
}

const shown = (r: ReturnType<typeof render>, id: string) =>
  r.getByTestId(id).props.pointerEvents === 'auto';

describe('ViewLayer under a deferred view mode', () => {
  it('switches to the new view even though the old one is being frozen', async () => {
    const r = render(<Screen mode="month" />);
    expect(shown(r, 'month-layer')).toBe(true);

    r.rerender(<Screen mode="day" />);
    await act(async () => { await new Promise((res) => setTimeout(res, 50)); });

    expect(shown(r, 'day-layer')).toBe(true);
    expect(shown(r, 'month-layer')).toBe(false);
  });

  it('can switch back and forth repeatedly', async () => {
    const r = render(<Screen mode="month" />);
    for (const mode of ['day', 'month', 'day', 'month'] as const) {
      r.rerender(<Screen mode={mode} />);
      await act(async () => { await new Promise((res) => setTimeout(res, 50)); });
      expect(shown(r, mode === 'day' ? 'day-layer' : 'month-layer')).toBe(true);
    }
  });
});
