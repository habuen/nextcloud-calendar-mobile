import React, { useState } from 'react';
import { Text } from 'react-native';
import { render, act, fireEvent } from '@testing-library/react-native';
import { ViewLayer } from '@/features/calendar/components/ViewLayer';

let renders = 0;

function Counter({ label }: { label: string }) {
  const [taps, setTaps] = useState(0);
  renders += 1;
  return (
    <Text testID="counter" onPress={() => setTaps((t) => t + 1)}>
      {`${label}:${taps}`}
    </Text>
  );
}

beforeEach(() => { renders = 0; });

describe('ViewLayer', () => {
  it('does not mount its children until it has been shown once', () => {
    const { queryByTestId, rerender } = render(<ViewLayer visible={false}><Counter label="a" /></ViewLayer>);
    expect(queryByTestId('counter')).toBeNull();
    expect(renders).toBe(0);

    rerender(<ViewLayer visible><Counter label="a" /></ViewLayer>);
    expect(queryByTestId('counter')).toBeTruthy();
  });

  it('does not re-render a hidden view when its props change', () => {
    const { rerender } = render(<ViewLayer visible><Counter label="a" /></ViewLayer>);
    rerender(<ViewLayer visible={false}><Counter label="a" /></ViewLayer>);
    const before = renders;

    for (const label of ['b', 'c', 'd', 'e']) {
      rerender(<ViewLayer visible={false}><Counter label={label} /></ViewLayer>);
    }

    expect(renders).toBe(before);
  });

  it('renders once with the latest props when shown again, and keeps its state', () => {
    const { getByTestId, rerender } = render(<ViewLayer visible><Counter label="a" /></ViewLayer>);
    fireEvent.press(getByTestId('counter'));
    fireEvent.press(getByTestId('counter'));
    expect(getByTestId('counter').props.children).toBe('a:2');

    rerender(<ViewLayer visible={false}><Counter label="a" /></ViewLayer>);
    for (const label of ['b', 'c', 'latest']) {
      rerender(<ViewLayer visible={false}><Counter label={label} /></ViewLayer>);
    }
    rerender(<ViewLayer visible><Counter label="latest" /></ViewLayer>);

    expect(getByTestId('counter').props.children).toBe('latest:2');
  });

  it('keeps re-rendering a visible view as its props change', () => {
    const { getByTestId, rerender } = render(<ViewLayer visible><Counter label="a" /></ViewLayer>);
    rerender(<ViewLayer visible><Counter label="b" /></ViewLayer>);
    expect(getByTestId('counter').props.children).toBe('b:0');
  });
});
