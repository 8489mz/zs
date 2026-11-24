import { AiRobotIcon } from '@/shared/ui/AiRobotIcon';
import { XIcon } from '@/shared/components/icons/AppIcons';
import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';

export interface AiBusinessCopilotModalHeaderProps {
  t: ReturnType<typeof useTranslation>['t'];
  setActiveTab: Dispatch<SetStateAction<'chat' | 'knowledge'>>;
  activeTab: 'chat' | 'knowledge';
  onClose: () => void;
}
export function AiBusinessCopilotModalHeader({ t, setActiveTab, activeTab, onClose }: AiBusinessCopilotModalHeaderProps) {
  return (
    <>
    {/* Header */}
    <div
      style={{
        padding: '12px 18px',
        borderBottom: '1px solid #e2e8f0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: '#f8fafc',
        borderRadius: '12px 12px 0 0',
        gap: '12px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
        <div
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #170e5e 0%, #2e1065 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(23,14,94,0.22)',
            border: '1px solid rgba(255,255,255,0.15)',
            flexShrink: 0,
          }}
        >
          <AiRobotIcon size={24} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '2px', minWidth: 0 }}>
          <div
            style={{
              margin: 0,
              fontSize: '14.5px',
              fontWeight: 900,
              color: '#0f172a',
              lineHeight: '1.25',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
            }}
          >
            <span>{t('ai_copilot.ai_business_copilot_modal.s1', "زاد AI")}</span>
            <span style={{ color: '#94a3b8', fontSize: '13px' }}>•</span>
            <span>{t('ai_copilot.ai_business_copilot_modal.s2', "المستشار التنفيذي الذكي")}</span>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '10.5px',
              color: '#059669',
              fontWeight: 700,
              lineHeight: '1.2',
            }}
          >
            <span style={{ fontSize: '7px', lineHeight: 1, color: '#10b981' }}>●</span>
            <span>{t('ai_copilot.ai_business_copilot_modal.s3', "مستودع المعرفة (RAG) + أدوات ERP الحية")}</span>
          </div>
        </div>
      </div>

      {/* Navigation Symmetrical Tabs */}
      <div
        style={{
          display: 'flex',
          background: '#e2e8f0',
          padding: '3px',
          borderRadius: '8px',
          gap: '2px',
          boxSizing: 'border-box',
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab('chat')}
          style={{
            padding: '6px 14px',
            border: 'none',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            background: activeTab === 'chat' ? '#170e5e' : 'transparent',
            color: activeTab === 'chat' ? '#ffffff' : '#475569',
            boxSizing: 'border-box',
          }}
        >
          {t('ai_copilot.ai_business_copilot_modal.s4', "المستشار والمحادثة")}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('knowledge')}
          style={{
            padding: '6px 14px',
            border: 'none',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            background: activeTab === 'knowledge' ? '#170e5e' : 'transparent',
            color: activeTab === 'knowledge' ? '#ffffff' : '#475569',
            boxSizing: 'border-box',
          }}
        >
          {t('ai_copilot.ai_business_copilot_modal.s5', "مستودع المعرفة (Chatbase)")}
        </button>
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label={t('ai_copilot.ai_business_copilot_modal.s6', "إغلاق")}
        style={{
          background: '#ffffff',
          border: '1.5px solid #cbd5e1',
          borderRadius: '9px',
          width: '34px',
          height: '34px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#0f172a',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <XIcon size={18} strokeWidth={2.4} />
      </button>
    </div>
    </>
  );
}
