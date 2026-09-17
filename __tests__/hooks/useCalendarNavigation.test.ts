import { renderHook, act } from '@testing-library/react-native';
import { useCalendarNavigation } from '../../src/features/calendar/hooks/useCalendarNavigation';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

describe('useCalendarNavigation', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('page change updates date immediately but debounces fetchDate to the last value', () => {
    const { result } = renderHook(() => useCalendarNavigation());
    const d1 = new Date('2026-03-10T00:00:00Z');
    const d2 = new Date('2026-03-17T00:00:00Z');

    act(() => { result.current.onPageChange(d1); });
    expect(result.current.date).toEqual(d1);
    expect(result.current.fetchDate).not.toEqual(d1);

    act(() => { result.current.onPageChange(d2); });
    expect(result.current.date).toEqual(d2);

    act(() => { jest.advanceTimersByTime(300); });
    expect(result.current.fetchDate).toEqual(d2);
  });

  it('setDate updates fetchDate immediately and cancels a pending page change', () => {
    const { result } = renderHook(() => useCalendarNavigation());
    const swiped = new Date('2026-04-01T00:00:00Z');
    const tapped = new Date('2026-05-15T00:00:00Z');

    act(() => { result.current.onPageChange(swiped); });
    act(() => { result.current.setDate(tapped); });
    expect(result.current.fetchDate).toEqual(tapped);

    act(() => { jest.advanceTimersByTime(300); });
    expect(result.current.fetchDate).toEqual(tapped);
  });

  it('a page change leaves the anchor alone so the pager keeps its index', () => {
    const { result } = renderHook(() => useCalendarNavigation());
    const before = result.current.anchorDate;

    act(() => { result.current.onPageChange(new Date('2026-06-01T00:00:00Z')); });

    expect(result.current.anchorDate).toBe(before);
  });

  it('setDate leaves the anchor put and publishes the jump instead', () => {
    const { result } = renderHook(() => useCalendarNavigation());
    const anchorBefore = result.current.anchorDate;
    const nonceBefore = result.current.jump.nonce;
    const target = new Date('2026-09-09T00:00:00Z');

    act(() => { result.current.setDate(target); });

    expect(result.current.anchorDate).toBe(anchorBefore);
    expect(result.current.date).toEqual(target);
    expect(result.current.jump.nonce).toBe(nonceBefore + 1);
    expect(result.current.jump.target).toEqual(target);
  });

  it('a swipe does not publish a jump', () => {
    const { result } = renderHook(() => useCalendarNavigation());
    const jumpBefore = result.current.jump;

    act(() => { result.current.onPageChange(new Date('2026-06-01T00:00:00Z')); });

    expect(result.current.jump).toBe(jumpBefore);
  });

  it('switchMode re-anchors, because the page span changed', () => {
    const { result } = renderHook(() => useCalendarNavigation());
    const swiped = new Date('2026-07-04T00:00:00Z');

    act(() => { result.current.onPageChange(swiped); });
    act(() => { result.current.switchMode('day'); });

    expect(result.current.viewMode).toBe('day');
    expect(result.current.anchorDate).toEqual(swiped);
  });

  it('goToDay switches to day view anchored on the date it was given', () => {
    const { result } = renderHook(() => useCalendarNavigation());
    const tapped = new Date('2026-08-12T00:00:00Z');

    act(() => { result.current.goToDay(tapped); });

    expect(result.current.viewMode).toBe('day');
    expect(result.current.date).toEqual(tapped);
    expect(result.current.anchorDate).toEqual(tapped);
  });

  it('goToDay uses the date it was given, not whatever date was current a moment earlier in the same handler', () => {
    // Regression guard: switchMode reads `date` through a ref that only
    // updates on the next render, so a caller doing setDate(d) then
    // switchMode('day') in one synchronous handler would anchor on the
    // stale pre-tap date. goToDay takes the date directly instead.
    const { result } = renderHook(() => useCalendarNavigation());
    const staleDate = new Date('2026-02-01T00:00:00Z');
    const tapped = new Date('2026-08-12T00:00:00Z');

    act(() => {
      result.current.setDate(staleDate);
      result.current.goToDay(tapped);
    });

    expect(result.current.date).toEqual(tapped);
    expect(result.current.anchorDate).toEqual(tapped);
  });

  it('goToday returns the date to now and publishes it as a jump', () => {
    const { result } = renderHook(() => useCalendarNavigation());
    const anchorBefore = result.current.anchorDate;

    act(() => { result.current.onPageChange(new Date('2026-01-01T00:00:00Z')); });
    act(() => { result.current.goToday(); });

    const today = new Date().toDateString();
    expect(result.current.date.toDateString()).toBe(today);
    expect(result.current.jump.target.toDateString()).toBe(today);
    expect(result.current.anchorDate).toBe(anchorBefore);
  });
});
