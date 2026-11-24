import React from 'react';

export function renderInlineTokens(line: string) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      const inner = part.slice(2, -2).trim();
      const isCriticalStock =
        inner === '0' ||
        inner === '-1' ||
        inner.startsWith('-') ||
        inner.includes(' 0 ') ||
        inner.startsWith('0 ') ||
        inner.includes('0 قطعة') ||
        inner.includes('0 صنف');

      return (
        <strong
          key={idx}
          style={{
            fontWeight: 800,
            color: isCriticalStock ? '#dc2626' : '#0f172a',
            ...(isCriticalStock
              ? {
                  background: '#fee2e2',
                  padding: '1px 6px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  display: 'inline-block',
                }
              : {}),
          }}
        >
          {inner}
        </strong>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}
