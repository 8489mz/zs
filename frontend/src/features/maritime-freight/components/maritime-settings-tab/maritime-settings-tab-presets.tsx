import type { useTranslation } from 'react-i18next';
import type { MaritimeMailConfig } from '../../api/maritime-freight.api';

export interface MaritimeSettingsTabPresetsProps {
  __t: ReturnType<typeof useTranslation>['t'];
  applyPreset: (provider: 'custom' | 'outlook' | 'gmail') => void;
  config: MaritimeMailConfig;
}

export function MaritimeSettingsTabPresets({ __t, applyPreset, config }: MaritimeSettingsTabPresetsProps) {
  return (
    <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px 20px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#170e5e' }}>
          {__t('maritime_freight.maritime_settings_tab.s7', "الضبط المسبق لخوادم البريد الشائعة:")}
        </span>
        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
          {__t('maritime_freight.maritime_settings_tab.s8', "(اختر نوع السيرفر لتعبئة المنافذ والعناوين القياسية تلقائياً)")}
        </span>
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => applyPreset('custom')}
          style={{
            padding: '6px 14px',
            borderRadius: '8px',
            border: config.outgoingProvider === 'custom' ? '1px solid #170e5e' : '1px solid #e2e8f0',
            background: config.outgoingProvider === 'custom' ? '#170e5e' : '#f8fafc',
            color: config.outgoingProvider === 'custom' ? '#ffffff' : '#475569',
            fontSize: '0.78rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {__t('maritime_freight.maritime_settings_tab.s9', "سيرفر خاص مخصص (Custom SMTP / Private Server)")}
        </button>
        <button
          type="button"
          onClick={() => applyPreset('outlook')}
          style={{
            padding: '6px 14px',
            borderRadius: '8px',
            border: config.outgoingProvider === 'outlook' ? '1px solid #170e5e' : '1px solid #e2e8f0',
            background: config.outgoingProvider === 'outlook' ? '#170e5e' : '#f8fafc',
            color: config.outgoingProvider === 'outlook' ? '#ffffff' : '#475569',
            fontSize: '0.78rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Microsoft 365 / Outlook
        </button>
        <button
          type="button"
          onClick={() => applyPreset('gmail')}
          style={{
            padding: '6px 14px',
            borderRadius: '8px',
            border: config.outgoingProvider === 'gmail' ? '1px solid #170e5e' : '1px solid #e2e8f0',
            background: config.outgoingProvider === 'gmail' ? '#170e5e' : '#f8fafc',
            color: config.outgoingProvider === 'gmail' ? '#ffffff' : '#475569',
            fontSize: '0.78rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Google Workspace / Gmail
        </button>
      </div>
    </div>
  );
}
