/* Scanner-buffer type-ahead clobber: the externalValue sync effect used to
   overwrite the DOM input with the last FLUSHED value on every externalValue
   change, so a keystroke typed between the flush (120ms typing / 75ms
   scanner) and the effect run was clobbered back (typing "200" dropped to
   "20"). The sync must skip the overwrite when the user has typed ahead of
   the last flushed value, while still applying programmatic clears ('' after
   adding a product) and keeping scanner auto-submit intact. */
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { useScannerBuffer } from './useScannerBuffer';

function Harness(props: {
  externalValue: string;
  onFlush: (value: string) => void;
  onAutoSubmit?: (value: string) => boolean;
  typeFlushMs?: number;
  scanFlushMs?: number;
  scanThresholdMs?: number;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const buffer = useScannerBuffer({
    externalValue: props.externalValue,
    onFlush: props.onFlush,
    onAutoSubmit: props.onAutoSubmit,
    inputRef,
    typeFlushMs: props.typeFlushMs ?? 120,
    scanFlushMs: props.scanFlushMs ?? 75,
    scanThresholdMs: props.scanThresholdMs ?? 65,
  });
  return <input ref={inputRef} data-testid="scanner-input" onChange={buffer.handleChange} />;
}

describe('useScannerBuffer external sync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a digit typed after the flush but before the external value lands', () => {
    const onFlush = vi.fn();
    const { getByTestId, rerender } = render(
      <Harness externalValue="" onFlush={onFlush} />,
    );
    const input = getByTestId('scanner-input') as HTMLInputElement;

    // Cashier types "20" (manual typing, flush after a 120ms pause).
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.change(input, { target: { value: '20' } });
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(onFlush).toHaveBeenCalledWith('20');

    // The third digit lands BEFORE the parent applies the flushed value.
    fireEvent.change(input, { target: { value: '200' } });
    expect(input.value).toBe('200');

    // Parent now applies the flushed value ("20") as the new external value.
    rerender(<Harness externalValue="20" onFlush={onFlush} />);
    // The typed-ahead digit must survive the sync effect (was: dropped to "20").
    expect(input.value).toBe('200');

    // And the next flush must send the full typed value, not the stale one.
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(onFlush).toHaveBeenLastCalledWith('200');
  });

  it('clears the input when the external value is cleared after adding a product', () => {
    const onFlush = vi.fn();
    const { getByTestId, rerender } = render(
      <Harness externalValue="200" onFlush={onFlush} />,
    );
    const input = getByTestId('scanner-input') as HTMLInputElement;
    expect(input.value).toBe('200');

    rerender(<Harness externalValue="" onFlush={onFlush} />);
    expect(input.value).toBe('');

    // Typing still works from the cleared state.
    fireEvent.change(input, { target: { value: '5' } });
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(onFlush).toHaveBeenCalledWith('5');
  });

  it('still auto-submits and clears the input on an exact scanner barcode match', () => {
    const onFlush = vi.fn();
    const onAutoSubmit = vi.fn(() => true);
    const { getByTestId } = render(
      <Harness externalValue="" onFlush={onFlush} onAutoSubmit={onAutoSubmit} />,
    );
    const input = getByTestId('scanner-input') as HTMLInputElement;

    // Rapid scanner burst: keystrokes 10ms apart, inside the 65ms threshold.
    fireEvent.change(input, { target: { value: '6' } });
    act(() => {
      vi.advanceTimersByTime(10);
    });
    fireEvent.change(input, { target: { value: '62' } });
    act(() => {
      vi.advanceTimersByTime(10);
    });
    fireEvent.change(input, { target: { value: '622' } });
    act(() => {
      vi.advanceTimersByTime(10);
    });
    fireEvent.change(input, { target: { value: '6220' } });

    // Scanner flush fires 75ms after the last rapid keystroke.
    act(() => {
      vi.advanceTimersByTime(75);
    });
    expect(onAutoSubmit).toHaveBeenCalledWith('6220');
    expect(input.value).toBe('');
    expect(onFlush).not.toHaveBeenCalled();
  });
});
