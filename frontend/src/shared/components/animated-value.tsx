import { useEffect, useMemo, useRef, useState } from 'react';

interface AnimatedValueProps {
  value: number;
  durationMs?: number;
  decimals?: number;
  formatter?: (value: number) => string;
}

export function AnimatedValue({ value, durationMs = 850, decimals = 0, formatter }: AnimatedValueProps) {
  /* INV-REPORTS-PARTIAL-TOTALS: the first paint shows the final value.
  Starting from 0 and sweeping to the value over 850ms displayed numbers
  that were never real totals in the first seconds (a reader, a print or
  an export taken then got a fake total). Animate only when the value
  CHANGES after mount, from the previous real value. */
  const initialValue = Number.isFinite(value) ? value : 0;
  const [displayValue, setDisplayValue] = useState(initialValue);
  const previousValueRef = useRef(initialValue);

  useEffect(() => {
    const target = Number.isFinite(value) ? value : 0;
    const startValue = previousValueRef.current;
    const startTime = performance.now();
    let frameId = 0;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = startValue + ((target - startValue) * eased);
      setDisplayValue(next);
      if (progress < 1) {
        frameId = window.requestAnimationFrame(tick);
      } else {
        previousValueRef.current = target;
      }
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [durationMs, value]);

  const rendered = useMemo(() => {
    /* INV-USER-SALES-020-GAP: a formatter owns its own decimal policy
    (formatCurrency renders at the tenant currency decimals, formatInteger
    at 0), so it receives the raw value. Pre-rounding to `decimals`
    (default 0) first destroyed the cents: a user-details sales total of
    1,869.80 rounded to 1,870 and then formatted as 1,870.00, while the
    sales register showed the true 1,869.80 via formatCurrency directly.
    `decimals` still governs the no-formatter path, so count cards keep
    rendering whole units. */
    if (formatter) return formatter(displayValue);
    const rounded = Number(displayValue.toFixed(decimals));
    return new Intl.NumberFormat('ar-EG', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(rounded);
  }, [decimals, displayValue, formatter]);

  return <>{rendered}</>;
}
