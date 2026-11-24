import { renderInlineTokens } from './ai-business-copilot-modal-inline-tokens';

export function renderFormattedContent(text: string) {
  const lines = text.split('\n');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return <div key={idx} style={{ height: '4px' }} />;
        }

        // 1. Recommendation box
        if (trimmed.includes('توصية زاد:') || trimmed.includes('الحل الابتكاري') || trimmed.includes('بره الصندوق')) {
          const content = trimmed.replace(/^\*\*توصية زاد:\*\*\s*/, '').replace(/^توصية:\s*/, '');
          return (
            <div
              key={idx}
              style={{
                margin: '8px 0 2px 0',
                padding: '9px 12px',
                borderRadius: '8px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRight: '3.5px solid #170e5e',
                color: '#334155',
                fontSize: '12.5px',
                lineHeight: 1.6,
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
              }}
            >
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  background: '#eff6ff',
                  color: '#1e40af',
                  padding: '1px 7px',
                  borderRadius: '4px',
                  flexShrink: 0,
                }}
              >
                توصية استراتيجية
              </span>
              <div>{renderInlineTokens(content)}</div>
            </div>
          );
        }

        // 2. Warning header (e.g. low stock warning or overdue installments)
        if (
          trimmed.includes('تنبيه الأقساط:') ||
          trimmed.includes('تنبيه مبكر:') ||
          trimmed.includes('أبرز الأصناف التي قاربت على النفاد:')
        ) {
          return (
            <div
              key={idx}
              style={{
                margin: '8px 0 3px 0',
                padding: '6px 10px',
                borderRadius: '6px',
                background: '#fff1f2',
                border: '1px solid #ffe4e6',
                borderRight: '3.5px solid #e11d48',
                color: '#be123c',
                fontWeight: 800,
                fontSize: '12.5px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  background: '#fee2e2',
                  color: '#9f1239',
                  padding: '1px 6px',
                  borderRadius: '4px',
                  flexShrink: 0,
                }}
              >
                تنبيه تشغيلي
              </span>
              <div>{renderInlineTokens(trimmed)}</div>
            </div>
          );
        }

        // 3. Main Topic Header (bold title ending with colon)
        const isTopicHeader = /^\*\*[^*]+:\*\*/.test(trimmed);
        if (isTopicHeader) {
          return (
            <div
              key={idx}
              style={{
                margin: '6px 0 4px 0',
                paddingBottom: '4px',
                borderBottom: '1px solid #f1f5f9',
                color: '#0f172a',
                fontSize: '13px',
                fontWeight: 800,
              }}
            >
              {renderInlineTokens(trimmed)}
            </div>
          );
        }

        // 4. Numbered item for low stock or ranking
        const isNumberedItem = /^\d+\.\s*/.test(trimmed);
        if (isNumberedItem) {
          return (
            <div
              key={idx}
              style={{
                padding: '4px 8px',
                margin: '1px 0',
                borderRadius: '6px',
                background: '#f8fafc',
                fontSize: '12.5px',
                lineHeight: 1.5,
                color: '#334155',
              }}
            >
              {renderInlineTokens(trimmed)}
            </div>
          );
        }

        // 5. Normal bullet point or paragraph
        return (
          <div
            key={idx}
            style={{
              lineHeight: 1.6,
              color: '#334155',
              fontSize: '13px',
              paddingRight: trimmed.startsWith('-') ? '6px' : '0',
            }}
          >
            {renderInlineTokens(trimmed)}
          </div>
        );
      })}
    </div>
  );
}
