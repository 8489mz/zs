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
    const rounded = Number(displayValue.toFixed(decimals));
    if (formatter) return formatter(rounded);
    return new Intl.NumberFormat('ar-EG', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(rounded);
  }, [decimals, displayValue, formatter]);

  return <>{rendered}</>;
}
