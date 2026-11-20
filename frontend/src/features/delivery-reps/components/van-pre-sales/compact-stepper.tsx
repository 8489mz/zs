import React from 'react';
import type { CompactStepperProps } from './van-pre-sales-types';

/**
 * Strict RTL Stepper: [+] first in DOM (physically on the RIGHT), [-] last in DOM (physically on the LEFT).
 */
export const CompactStepper: React.FC<CompactStepperProps> = ({
  value,
  min = 0,
  max = 999999,
  step = 1,
  unitLabel,
  onIncrement,
  onDecrement,
  onChange,
  disabledIncrement = false,
  disabledDecrement = false,
  inputWidth = '36px',
  height = '30px',
}) => {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          border: '1px solid #cbd5e1',
          borderRadius: '7px',
          backgroundColor: '#ffffff',
          overflow: 'hidden',
          height,
          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
        }}
      >
        {/* STRICT RTL STEPPER: + is FIRST in DOM (Renders on the RIGHT) */}
        <button
          type="button"
          onClick={onIncrement}
          disabled={disabledIncrement}
          style={{
            width: '26px',
            height: '100%',
            border: 'none',
            backgroundColor: '#f8fafc',
            color: '#170e5e',
            cursor: disabledIncrement ? 'not-allowed' : 'pointer',
            opacity: disabledIncrement ? 0.35 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderInlineEnd: '1px solid #e2e8f0',
            fontWeight: 800,
            fontSize: '13px',
            padding: 0,
          }}
          title={`زيادة ${unitLabel}`}
        >
          +
        </button>

        <input
          type="number"
          step={step}
          className="no-spin-arrows"
          min={min}
          max={max}
          value={isNaN(value) ? '' : value}
          onChange={(e) => {
            const parsed = parseInt(e.target.value, 10);
            if (!isNaN(parsed)) onChange(Math.max(0, parsed));
            else if (e.target.value === '') onChange(0);
          }}
          onFocus={(e) => e.target.select()}
          style={{
            width: inputWidth,
            height: '100%',
            border: 'none',
            textAlign: 'center',
            fontSize: '12px',
            fontWeight: 800,
            color: '#0f172a',
            outline: 'none',
            MozAppearance: 'textfield',
            appearance: 'textfield',
            padding: '0 2px',
          }}
        />

        {/* STRICT RTL STEPPER: - is LAST in DOM (Renders on the LEFT) */}
        <button
          type="button"
          onClick={onDecrement}
          disabled={disabledDecrement}
          style={{
            width: '26px',
            height: '100%',
            border: 'none',
            backgroundColor: '#f8fafc',
            color: '#334155',
            cursor: disabledDecrement ? 'not-allowed' : 'pointer',
            opacity: disabledDecrement ? 0.35 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderInlineStart: '1px solid #e2e8f0',
            fontWeight: 800,
            fontSize: '14px',
            padding: 0,
          }}
          title={`إنقاص ${unitLabel}`}
        >
          -
        </button>
      </div>
      <span style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', whiteSpace: 'nowrap' }}>
        {unitLabel}
      </span>
    </div>
  );
};
