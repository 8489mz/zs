import { memo } from 'react';
import { PlusIcon, MinusIcon } from '@/shared/components/icons/AppIcons';
import type { DriverProductStock } from '../../hooks/useDriverLoadRequisition';

export interface RequisitionLineItem {
  id: string;
  productId: number | '';
  productName: string;
  barcode: string;
  unitPrice: number;
  unit: string;
  packagingUnit?: { name: string; multiplier: number };
  isWeight?: boolean;
  cartons?: number;
  pieces?: number;
  sourceWarehouseId: number | '';
  sourceWarehouseName: string;
  availableInWarehouse: number;
  warehouseStocks: DriverProductStock[];
  qty: number;
  searchQuery?: string;
  isSearchOpen?: boolean;
}

export interface CompactStepperProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unitLabel: string;
  isDecimal?: boolean;
  onIncrement: () => void;
  onDecrement: () => void;
  onChange: (val: number) => void;
  disabledIncrement?: boolean;
  disabledDecrement?: boolean;
  inputWidth?: string;
  height?: string;
}

/**
 * Universal Compact Stepper with strict RTL order: [+] (value) [-] (label)
 */
export const CompactStepper = memo(function CompactStepper({
  value,
  min = 0,
  max = 999999,
  step = 1,
  unitLabel,
  isDecimal = false,
  onIncrement,
  onDecrement,
  onChange,
  disabledIncrement = false,
  disabledDecrement = false,
  inputWidth = '36px',
  height = '28px',
}: CompactStepperProps) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        flexShrink: 0,
      }}
    >
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
        {/* RTL Stepper: + first (renders physically on the RIGHT) */}
        <button
          type="button"
          onClick={onIncrement}
          disabled={disabledIncrement}
          style={{
            width: '26px',
            height: '100%',
            border: 'none',
            backgroundColor: '#f8fafc',
            color: '#334155',
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
          <PlusIcon size={11} />
        </button>
        <input
          type="number"
          step={step}
          className="no-spin-arrows"
          min={min}
          max={max}
          value={isNaN(value) ? '' : value}
          onChange={(e) => {
            const parsed = isDecimal ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
            if (!isNaN(parsed)) onChange(parsed);
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
        {/* RTL Stepper: - last (renders physically on the LEFT) */}
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
            fontSize: '13px',
            padding: 0,
          }}
          title={`إنقاص ${unitLabel}`}
        >
          <MinusIcon size={11} />
        </button>
      </div>
      <span
        style={{
          fontSize: '10.5px',
          fontWeight: 700,
          color: '#475569',
          backgroundColor: '#f8fafc',
          padding: '2px 5px',
          borderRadius: '5px',
          whiteSpace: 'nowrap',
          border: '1px solid #e2e8f0',
        }}
      >
        {unitLabel}
      </span>
    </div>
  );
});

export interface DriverNewLoadRequisitionViewProps {
  mode?: 'driver' | 'admin';
  onBack: () => void;
  onRequisitionSubmitted?: (docNo: string) => void;
}
