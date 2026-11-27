import {SlidersIcon, ChevronUpIcon, ChevronDownIcon, RefreshCwIcon} from '@/shared/components/icons/AppIcons';
import { AiRobotIcon } from '@/shared/ui/AiRobotIcon';
import { useTranslation } from 'react-i18next';
import { renderFormattedContent } from './ai-business-copilot-modal-formatted-content';
import {
  QUICK_SUGGESTIONS,
  QUICK_SUGGESTIONS_EN,
  type Message,
  type ReasoningStep,
} from './ai-business-copilot-modal-shared';
import type { UseMutationResult } from '@tanstack/react-query';
import type {RefObject, Dispatch, SetStateAction} from 'react';

export interface AiBusinessCopilotModalChatProps {
  activeTab: 'chat' | 'knowledge';
  messages: Message[];
  expandedReasoning: Record<string, boolean>;
  toggleReasoning: (messageId: string) => void;
  t: ReturnType<typeof useTranslation>['t'];
  handleSend: (textToSend?: string) => void;
  chatMutation: UseMutationResult<{ sessionId: string; answer: string; reasoningSteps: ReasoningStep[]; suggestedQuestions: string[]; toolsUsed: string[]; }, Error, string, unknown>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  handleResetChat: () => void;
  isEn: boolean;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}
export function AiBusinessCopilotModalChat({ activeTab, messages, expandedReasoning, toggleReasoning, t, handleSend, chatMutation, messagesEndRef, handleResetChat, isEn, input, setInput, handleKeyDown }: AiBusinessCopilotModalChatProps) {
  return (
    <>
    {/* Tab 1: Chat Assistant */}
    {activeTab === 'chat' && (
      <>
        {/* Messages Body */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            background: '#ffffff',
          }}
        >
          {messages.map((m) => {
            const isAi = m.sender === 'ai';
            const hasReasoning = isAi && m.reasoningSteps && m.reasoningSteps.length > 0;
            const isReasoningOpen = !!expandedReasoning[m.id];

            return (
              <div
                key={m.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: isAi ? 'flex-start' : 'flex-end',
                }}
              >
                <div
                  style={{
                    maxWidth: '92%',
                    padding: isAi ? '14px 18px' : '10px 16px',
                    borderRadius: isAi ? '14px 14px 14px 2px' : '14px 14px 2px 14px',
                    background: isAi ? '#f8fafc' : '#170e5e',
                    color: isAi ? '#1e293b' : '#ffffff',
                    border: isAi ? '1px solid #e2e8f0' : 'none',
                    fontSize: '13px',
                    lineHeight: 1.6,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                  }}
                >
                  {/* Collapsible Reasoning & Tools Box */}
                  {hasReasoning && (
                    <div style={{ marginBottom: '10px' }}>
                      <button
                        type="button"
                        onClick={() => toggleReasoning(m.id)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          background: '#eff6ff',
                          border: '1px solid #bfdbfe',
                          color: '#1d4ed8',
                          borderRadius: '6px',
                          padding: '3px 8px',
                          fontSize: '11px',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        <SlidersIcon size={13} />
                        <span>{t('ai_copilot.ai_business_copilot_modal.s7', "استدعاء الأدوات وتحليل البيانات (")}{m.reasoningSteps?.length} {t('ai_copilot.ai_business_copilot_modal.s8', "خطوات)")}</span>
                        {isReasoningOpen ? <ChevronUpIcon size={13} /> : <ChevronDownIcon size={13} />}
                      </button>

                      {isReasoningOpen && (
                        <div
                          style={{
                            marginTop: '6px',
                            padding: '8px 10px',
                            background: '#f1f5f9',
                            border: '1px solid #e2e8f0',
                            borderRadius: '6px',
                            fontSize: '11.5px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                          }}
                        >
                          {m.reasoningSteps?.map((rs, idx) => (
                            <div key={idx} style={{ color: '#334155' }}>
                              <strong style={{ color: '#0f172a' }}>{rs.step}:</strong> {rs.observation}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {isAi ? renderFormattedContent(m.text) : m.text}
                </div>

                {/* Suggested Questions Pills */}
                {isAi && m.suggestedQuestions && m.suggestedQuestions.length > 0 && (
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                    {m.suggestedQuestions.map((sq, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handleSend(sq)}
                        disabled={chatMutation.isPending}
                        style={{
                          background: '#eff6ff',
                          border: '1px solid #bfdbfe',
                          color: '#1d4ed8',
                          borderRadius: '16px',
                          padding: '4px 11px',
                          fontSize: '11.5px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          boxSizing: 'border-box',
                        }}
                      >
                        {sq}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {chatMutation.isPending && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#6366f1', fontSize: '12.5px', padding: '6px 8px' }}>
              <AiRobotIcon size={18} />
              <span style={{ fontWeight: 700 }}>{t('ai_copilot.ai_business_copilot_modal.s9', "زاد AI يراجع الأدوات ويبحث في البيانات ويفكر في الحل الأنسب...")}</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Quick Shortcut Chips Bar */}
        <div
          className="ai-chips-bar"
          style={{
            padding: '8px 16px',
            background: '#f8fafc',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            overflowX: 'auto',
            whiteSpace: 'nowrap',
            borderTop: '1px solid #e2e8f0',
          }}
        >
          <button
            type="button"
            onClick={handleResetChat}
            title={t('ai_copilot.ai_business_copilot_modal.s10', "بدء جلسة جديدة")}
            style={{
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: '16px',
              padding: '4px 9px',
              fontSize: '11px',
              fontWeight: 600,
              color: '#475569',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              flexShrink: 0,
            }}
          >
            <RefreshCwIcon size={12} />
            <span>{t('ai_copilot.ai_business_copilot_modal.s11', "جلسة جديدة")}</span>
          </button>

          {(isEn ? QUICK_SUGGESTIONS_EN : QUICK_SUGGESTIONS).map((text, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleSend(text)}
              disabled={chatMutation.isPending}
              style={{
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '18px',
                padding: '5px 12px',
                fontSize: '11.5px',
                fontWeight: 600,
                color: '#1e293b',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                flexShrink: 0,
              }}
            >
              <span>{text}</span>
            </button>
          ))}
        </div>

        {/* Input Bar */}
        <div
          style={{
            padding: '10px 16px 14px 16px',
            background: '#f8fafc',
            display: 'flex',
            gap: '8px',
            borderRadius: '0 0 12px 12px',
          }}
        >
          <input
            type="text"
            placeholder={t('ai_copilot.ai_business_copilot_modal.s12', "اسأل زاد أي شيء عن أرقامك، مبيعاتك، مخزونك، أو اطلب استشارة بره الصندوق...")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={chatMutation.isPending}
            style={{
              flex: 1,
              padding: '9px 14px',
              borderRadius: '10px',
              border: '1.5px solid #cbd5e1',
              fontSize: '13px',
              background: '#ffffff',
              outline: 'none',
            }}
          />

          <button
            type="button"
            onClick={() => handleSend()}
            disabled={!input.trim() || chatMutation.isPending}
            style={{
              background: input.trim() && !chatMutation.isPending ? '#170e5e' : '#cbd5e1',
              color: '#ffffff',
              border: 'none',
              borderRadius: '10px',
              padding: '9px 18px',
              fontSize: '13px',
              fontWeight: 700,
              cursor: input.trim() && !chatMutation.isPending ? 'pointer' : 'not-allowed',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>{t('ai_copilot.ai_business_copilot_modal.s13', "إرسال")}</span>
          </button>
        </div>
      </>
    )}
    </>
  );
}
