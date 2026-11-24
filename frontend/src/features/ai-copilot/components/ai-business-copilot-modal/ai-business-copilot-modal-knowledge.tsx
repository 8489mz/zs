import { RefreshCwIcon } from '@/shared/components/icons/AppIcons';
import { PlusCircleIcon } from '@/shared/components/icons/AppIcons';
import { FileTextIcon } from '@/shared/components/icons/AppIcons';
import { TrashIcon } from '@/shared/components/icons/AppIcons';
import { useTranslation } from 'react-i18next';
import type { UseMutationResult } from '@tanstack/react-query';
import type { KnowledgeSource } from './ai-business-copilot-modal-shared';
import type { Dispatch, SetStateAction } from 'react';

export interface AiBusinessCopilotModalKnowledgeProps {
  activeTab: 'chat' | 'knowledge';
  t: ReturnType<typeof useTranslation>['t'];
  autoIndexMutation: UseMutationResult<unknown, Error, void, unknown>;
  setIsAddingDoc: Dispatch<SetStateAction<boolean>>;
  isAddingDoc: boolean;
  docTitle: string;
  setDocTitle: Dispatch<SetStateAction<string>>;
  docType: string;
  setDocType: Dispatch<SetStateAction<string>>;
  docContent: string;
  setDocContent: Dispatch<SetStateAction<string>>;
  addDocMutation: UseMutationResult<unknown, Error, void, unknown>;
  sources: KnowledgeSource[];
  isLoadingSources: boolean;
  deleteDocMutation: UseMutationResult<unknown, Error, number, unknown>;
}
export function AiBusinessCopilotModalKnowledge({ activeTab, t, autoIndexMutation, setIsAddingDoc, isAddingDoc, docTitle, setDocTitle, docType, setDocType, docContent, setDocContent, addDocMutation, sources, isLoadingSources, deleteDocMutation }: AiBusinessCopilotModalKnowledgeProps) {
  return (
    <>
    {/* Tab 2: Knowledge Base / Chatbase RAG */}
    {activeTab === 'knowledge' && (
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '18px',
          background: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        {/* Top Banner */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '14px 16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div>
            <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
              {t('ai_copilot.ai_business_copilot_modal.s14', "مستودع المعرفة والوثائق (Chatbase RAG Engine)")}
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '3px' }}>
              {t('ai_copilot.ai_business_copilot_modal.s15', "ارفع لوائح شركتك، شروط الضمان، أو الكتالوجات لتدريب زاد AI عليها والإجابة منها بدقة.")}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={() => autoIndexMutation.mutate()}
              disabled={autoIndexMutation.isPending}
              style={{
                background: '#eff6ff',
                border: '1px solid #bfdbfe',
                color: '#1e40af',
                borderRadius: '8px',
                padding: '7px 14px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <RefreshCwIcon size={14} />
              <span>{autoIndexMutation.isPending ? t('ai_copilot.ai_business_copilot_modal.s16', "جاري الفهرسة...") : t('ai_copilot.ai_business_copilot_modal.s17', "فهرسة الأصناف تلقائياً")}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsAddingDoc(!isAddingDoc)}
              style={{
                background: '#170e5e',
                border: 'none',
                color: '#ffffff',
                borderRadius: '8px',
                padding: '7px 14px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <PlusCircleIcon size={14} />
              <span>{isAddingDoc ? t('ai_copilot.ai_business_copilot_modal.s18', "إلغاء") : t('ai_copilot.ai_business_copilot_modal.s19', "إضافة وثيقة / لائحة")}</span>
            </button>
          </div>
        </div>

        {/* Add Document Form */}
        {isAddingDoc && (
          <div
            style={{
              background: '#ffffff',
              border: '1.5px solid #cbd5e1',
              borderRadius: '10px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a' }}>
              {t('ai_copilot.ai_business_copilot_modal.s20', "إضافة مستند أو لائحة جديدة للمستودع الدلالي")}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                  {t('ai_copilot.ai_business_copilot_modal.s21', "عنوان المستند / اللائحة")}
                </label>
                <input
                  type="text"
                  placeholder={t('ai_copilot.ai_business_copilot_modal.s22', "مثال: سياسة الائتمان وفترات السماح للشركات")}
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '12.5px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                  {t('ai_copilot.ai_business_copilot_modal.s23', "نوع المحتوى")}
                </label>
                <select
                  value={docType}
                  onChange={(e) => setDocType(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '12.5px',
                    background: '#ffffff',
                    boxSizing: 'border-box',
                  }}
                >
                  <option value="policy">{t('ai_copilot.ai_business_copilot_modal.s24', "لائحة وسياسة عمل")}</option>
                  <option value="catalog">{t('ai_copilot.ai_business_copilot_modal.s25', "كتالوج ومواصفات أصناف")}</option>
                  <option value="manual">{t('ai_copilot.ai_business_copilot_modal.s26', "دليل تشغيل وإرشادات")}</option>
                  <option value="contract">{t('ai_copilot.ai_business_copilot_modal.s27', "شروط تعاقدية وضمان")}</option>
                </select>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                {t('ai_copilot.ai_business_copilot_modal.s28', "النص الكامل أو محتوى الوثيقة")}
              </label>
              <textarea
                rows={5}
                placeholder={t('ai_copilot.ai_business_copilot_modal.s29', "الصق نص اللائحة أو المواصفات هنا ليتم تقطيعه وتضمينه شعاعياً في قاعدة البيانات...")}
                value={docContent}
                onChange={(e) => setDocContent(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '12.5px',
                  lineHeight: 1.5,
                  boxSizing: 'border-box',
                  fontFamily: 'inherit',
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setIsAddingDoc(false)}
                style={{
                  padding: '7px 16px',
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  fontSize: '12.5px',
                  cursor: 'pointer',
                }}
              >
                {t('ai_copilot.ai_business_copilot_modal.s30', "إلغاء")}
              </button>
              <button
                type="button"
                onClick={() => addDocMutation.mutate()}
                disabled={!docTitle.trim() || !docContent.trim() || addDocMutation.isPending}
                style={{
                  padding: '7px 18px',
                  background: '#170e5e',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {addDocMutation.isPending ? t('ai_copilot.ai_business_copilot_modal.s31', "جاري التضمين...") : t('ai_copilot.ai_business_copilot_modal.s32', "حفظ وتضمين في الـ AI")}
              </button>
            </div>
          </div>
        )}

        {/* Sources List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
            {t('ai_copilot.ai_business_copilot_modal.s33', "المستندات والكتالوجات المفهرسة حالياً (")}{sources.length})
          </div>

          {isLoadingSources ? (
            <div style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
              {t('ai_copilot.ai_business_copilot_modal.s34', "جاري تحميل مصادر المعرفة...")}
            </div>
          ) : sources.length === 0 ? (
            <div
              style={{
                background: '#ffffff',
                border: '1px dashed #cbd5e1',
                borderRadius: '10px',
                padding: '32px 16px',
                textAlign: 'center',
                color: '#64748b',
                fontSize: '13px',
              }}
            >
              {t('ai_copilot.ai_business_copilot_modal.s35', "لا توجد وثائق مدربة حتى الآن. اضغط على \"إضافة وثيقة\" لرفع لوائحك، أو \"فهرسة الأصناف تلقائياً\" ليقرأ زاد كتالوج متجرك فوراً!")}
            </div>
          ) : (
            sources.map((s) => (
              <div
                key={s.id}
                style={{
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '12px 16px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div
                    style={{
                      width: '34px',
                      height: '34px',
                      borderRadius: '8px',
                      background: '#eff6ff',
                      color: '#1e40af',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <FileTextIcon size={18} />
                  </div>

                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>{s.title}</div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '3px', fontSize: '11px', color: '#64748b' }}>
                      <span style={{ background: '#f1f5f9', padding: '1px 6px', borderRadius: '4px' }}>
                        {s.source_type === 'catalog_auto' ? t('ai_copilot.ai_business_copilot_modal.s36', "كتالوج تلقائي") : s.source_type}
                      </span>
                      <span>•</span>
                      <span>{s.chunk_count} {t('ai_copilot.ai_business_copilot_modal.s37', "فقرة دلالية")}</span>
                      <span>•</span>
                      <span style={{ color: '#059669', fontWeight: 700 }}>{t('ai_copilot.ai_business_copilot_modal.s38', "جاهز ومفهرس")}</span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => deleteDocMutation.mutate(s.id)}
                  disabled={deleteDocMutation.isPending}
                  title={t('ai_copilot.ai_business_copilot_modal.s39', "حذف الوثيقة")}
                  style={{
                    background: '#fff1f2',
                    border: '1px solid #ffe4e6',
                    color: '#be123c',
                    borderRadius: '6px',
                    padding: '6px 10px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <TrashIcon size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    )}
    </>
  );
}
