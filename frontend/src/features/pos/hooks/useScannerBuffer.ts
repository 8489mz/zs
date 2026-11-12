import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { listenToHardwareBarcode } from '@/shared/utils/hardware-scanner';

/**
 * Scanner Input Buffer — Zero-Render Edition
 *
 * Barcode scanners emulate keyboard input — they type each character one by one
 * with very short delays (typically 5-30ms between characters). Without buffering,
 * every character triggers a full React re-render cascade (state update → re-render
 * → useMemo recalculations → API calls → localStorage writes).
 *
 * This hook completely eliminates React re-renders during scanning by:
 * 1. Using a ref (not state) for the local value → NO React renders during typing
 * 2. Manipulating the DOM input directly via the inputRef → native browser speed
 * 3. Only flushing (triggering React state update) when scanning is done or user pauses
 *
 * Result: a 13-digit barcode scan triggers exactly 1 React render (at the end)
 * instead of 13 renders (one per character).
 */
export function useScannerBuffer(opts: {
  /** The external controlled value (e.g., `search` from parent state). */
  externalValue: string;
  /** Called when the buffer flushes (scanner done or typing pause). */
  onFlush: (value: string) => void;
  /** Optional handler to immediately execute a match and clear input on success. */
  onAutoSubmit?: (value: string) => boolean | Promise<boolean> | void;
  /** Ref to the input element — used for direct DOM manipulation. */
  inputRef: RefObject<HTMLInputElement | null>;
  /** Optional sanitizer applied to each input change. */
  sanitize?: (raw: string) => string;
  /** Max ms between keystrokes to be considered rapid/scanner input. Default: 60 */
  scanThresholdMs?: number;
  /** Delay before flushing scanner input (after last rapid keystroke). Default: 15 */
  scanFlushMs?: number;
  /** Delay before flushing manual typing input. Default: 80 */
  typeFlushMs?: number;
}) {
  const {
    externalValue,
    onFlush,
    onAutoSubmit,
    inputRef,
    sanitize,
    scanThresholdMs = 60,
    scanFlushMs = 15,
    typeFlushMs = 80,
  } = opts;

  // Use a ref — NOT state — so typing never triggers React re-renders.
  const localValueRef = useRef(externalValue);
  const flushTimerRef = useRef<number>(0);
  const lastKeystrokeRef = useRef<number>(0);
  const rapidCountRef = useRef(0);
  const onAutoSubmitRef = useRef(onAutoSubmit);
  useEffect(() => { onAutoSubmitRef.current = onAutoSubmit; }, [onAutoSubmit]);

  // Sync external → DOM when the external value changes
  // (e.g., search cleared after adding a product, or set programmatically).
  useEffect(() => {
    // Skip the overwrite when the user typed ahead of the last flushed value:
    // the only sources of a non-empty externalValue change are onFlush/flushNow
    // (value = the last flushed value), so a non-empty external that differs
    // from the local buffer can only mean the user edited after the last flush
    // (e.g. typed "200" while "20" was still in flight) — overwriting would
    // clobber that keystroke back to the stale flushed value. The local buffer
    // keeps the typed-ahead value, so the next flush still sends the full text.
    // Programmatic clears ('') always apply.
    if (externalValue !== '' && localValueRef.current !== externalValue) {
      return;
    }
    localValueRef.current = externalValue;
    const input = inputRef.current;
    if (input && input.value !== externalValue) {
      input.value = externalValue;
    }
  }, [externalValue, inputRef]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) window.clearTimeout(flushTimerRef.current);
    };
  }, []);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value;
      const value = sanitize ? sanitize(raw) : raw;
      localValueRef.current = value;

      // If sanitization changed the value, update the DOM input directly
      // (e.g., Arabic keyboard → English for invoice barcodes).
      if (value !== raw) {
        const input = inputRef.current;
        if (input) {
          const cursorPos = input.selectionStart;
          input.value = value;
          // Best-effort cursor restore after sanitization
          if (cursorPos !== null && cursorPos <= value.length) {
            input.setSelectionRange(cursorPos, cursorPos);
          }
        }
      }

      // Track keystroke timing to detect scanner vs. manual input
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const elapsed = now - lastKeystrokeRef.current;
      lastKeystrokeRef.current = now;

      if (elapsed > 0 && elapsed < scanThresholdMs) {
        rapidCountRef.current++;
      } else {
        rapidCountRef.current = 1;
      }

      // 3+ rapid keystrokes → scanner
      const isScanning = rapidCountRef.current >= 3;

      // Clear any pending flush
      if (flushTimerRef.current) window.clearTimeout(flushTimerRef.current);

      // Schedule flush: ultra-fast for scanner, smooth for manual typing
      const delay = isScanning ? scanFlushMs : typeFlushMs;
      flushTimerRef.current = window.setTimeout(() => {
        const current = localValueRef.current;
        // Only auto-submit on true rapid scanner input, NEVER during manual typing
        if (isScanning && onAutoSubmitRef.current && current.trim()) {
          const autoHandled = onAutoSubmitRef.current(current);
          if (autoHandled) {
            localValueRef.current = '';
            if (inputRef.current) inputRef.current.value = '';
            rapidCountRef.current = 0;
            return;
          }
        }
        onFlush(current);
        rapidCountRef.current = 0;
      }, delay);
    },
    [onFlush, sanitize, inputRef, scanThresholdMs, scanFlushMs, typeFlushMs],
  );

  /** Immediately flush the current value. Call this on Enter / Escape / submit. */
  const flushNow = useCallback(
    (overrideValue?: string) => {
      if (flushTimerRef.current) window.clearTimeout(flushTimerRef.current);
      const value = overrideValue !== undefined ? overrideValue : localValueRef.current;
      localValueRef.current = value;
      // Update DOM if override differs from current input value
      if (overrideValue !== undefined) {
        const input = inputRef.current;
        if (input && input.value !== value) {
          input.value = value;
        }
      }
      onFlush(value);
      rapidCountRef.current = 0;
    },
    [onFlush, inputRef],
  );

  useEffect(() => {
    let windowRapidCount = 0;
    let windowLastKeystroke = 0;
    let windowBuffer = '';
    let windowFlushTimer: number = 0;

    const handleWindowKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement).isContentEditable) {
        return;
      }

      // If a hardware scanner sends Enter at the end of a rapid scan sequence
      if (e.key === 'Enter' && windowBuffer.trim() && windowRapidCount >= 2) {
        e.preventDefault();
        if (windowFlushTimer) window.clearTimeout(windowFlushTimer);
        const finalValue = sanitize ? sanitize(windowBuffer) : windowBuffer;
        if (onAutoSubmitRef.current && finalValue.trim()) {
          const autoHandled = onAutoSubmitRef.current(finalValue);
          if (autoHandled) {
            windowBuffer = '';
            windowRapidCount = 0;
            return;
          }
        }
        onFlush(finalValue);
        windowBuffer = '';
        windowRapidCount = 0;
        return;
      }

      if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return;

      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const elapsed = now - windowLastKeystroke;
      windowLastKeystroke = now;

      if (elapsed > 0 && elapsed < scanThresholdMs) {
        windowRapidCount++;
      } else {
        windowRapidCount = 1;
        windowBuffer = '';
      }

      windowBuffer += e.key;

      if (windowFlushTimer) window.clearTimeout(windowFlushTimer);

      const isScanning = windowRapidCount >= 3;

      if (isScanning) {
        windowFlushTimer = window.setTimeout(() => {
          const finalValue = sanitize ? sanitize(windowBuffer) : windowBuffer;
          if (onAutoSubmitRef.current && finalValue.trim()) {
            const autoHandled = onAutoSubmitRef.current(finalValue);
            if (autoHandled) {
              windowBuffer = '';
              windowRapidCount = 0;
              return;
            }
          }
          onFlush(finalValue);
          windowBuffer = '';
          windowRapidCount = 0;
        }, scanFlushMs);
      }
    };

    const unlistenHardware = listenToHardwareBarcode((scannedCode) => {
      const finalValue = sanitize ? sanitize(scannedCode) : scannedCode;
      if (onAutoSubmitRef.current && finalValue.trim()) {
        const autoHandled = onAutoSubmitRef.current(finalValue);
        if (autoHandled) return;
      }
      onFlush(finalValue);
    });

    window.addEventListener('keydown', handleWindowKeyDown);
    return () => {
      unlistenHardware();
      window.removeEventListener('keydown', handleWindowKeyDown);
      if (windowFlushTimer) window.clearTimeout(windowFlushTimer);
    };
  }, [onFlush, sanitize, scanThresholdMs, scanFlushMs]);

  return {
    /** onChange handler for the input element. */
    handleChange,
    /** Immediately flush the buffer (call on Enter/Escape/programmatic submit). */
    flushNow,
    /** Read the current buffered value (from the ref, not React state). */
    getValue: () => localValueRef.current,
  };
}
