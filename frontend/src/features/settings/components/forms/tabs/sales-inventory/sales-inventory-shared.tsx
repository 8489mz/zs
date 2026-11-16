import type { CSSProperties } from 'react';

// Premium SVG Line Icons
export function TaxCalcIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
      <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
      <path d="M12 6v12" />
    </svg>
  );
}

export function NegativeStockIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21 8-2 2-1.5-1.5" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      <path d="m15 5 3 3" />
      <path d="M3 21h18" />
    </svg>
  );
}

export function ZeroCostIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v20" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}

export function LowStockIndicatorIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-3 3" />
    </svg>
  );
}

export function IssueModeDocIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
      <path d="M10 9H8" />
    </svg>
  );
}

export const premiumCardStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '14px 18px',
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '10px',
  cursor: 'pointer',
  transition: 'all 0.15s ease',
  boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
  gap: '12px',
};

export const iconBadgeStyle = {
  width: '38px',
  height: '38px',
  borderRadius: '8px',
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#0f172a',
  flexShrink: 0,
};

export const premiumCardTextStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '3px',
};

export const premiumCheckboxInputStyle = {
  width: '18px',
  height: '18px',
  accentColor: '#0f172a',
  cursor: 'pointer',
  flexShrink: 0,
};

export const fieldControlStyle: CSSProperties = {
  width: '100%',
  height: '38px',
  minHeight: '38px',
  padding: '0 12px',
  fontSize: '0.84rem',
  fontWeight: 600,
  color: '#0f172a',
  background: '#ffffff',
  border: '1px solid #cbd5e1',
  borderRadius: '8px',
  boxSizing: 'border-box',
};
