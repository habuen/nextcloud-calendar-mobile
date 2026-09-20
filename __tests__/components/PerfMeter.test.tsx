import { act, fireEvent, render } from '@testing-library/react-native';

import { PerfMeter } from '@/features/calendar/perf/PerfMeter';
import { perfProbe } from '@/features/calendar/perf/perfProbe';

describe('PerfMeter', () => {
  beforeEach(() => { jest.useFakeTimers(); perfProbe.reset(); });
  afterEach(() => { jest.useRealTimers(); });

  it('shows what the probe has recorded and clears it when tapped', () => {
    const { getByTestId, getByText, queryByText } = render(<PerfMeter />);
    perfProbe.recordBuild(42);
    act(() => { jest.advanceTimersByTime(400); });
    expect(getByText(/builds 1 · avg 42 ms · worst 42 ms/)).toBeTruthy();
    fireEvent.press(getByTestId('perf-meter'));
    expect(queryByText(/builds 1/)).toBeNull();
    expect(getByText(/builds 0/)).toBeTruthy();
  });

  it('stops its timers when it goes away', () => {
    const { unmount } = render(<PerfMeter />);
    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});
