import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { AppIcons } from '@/shared/components/icons/AppIcons';

export interface TenderLifecycleStripProps {
  projectIdParam: string | null;
  currentProject: any | null;
  tendersUnderStudyCount: number;
  handleStartNewTender: () => Promise<void>;
  handleSubmitBid: () => Promise<void>;
  handleCreateRevision: () => Promise<void>;
  setIsTenderSwitcherOpen: Dispatch<SetStateAction<boolean>>;
  setIsAwardModalOpen: Dispatch<SetStateAction<boolean>>;
  setIsLostModalOpen: Dispatch<SetStateAction<boolean>>;
  setIsWorkflowMapOpen: Dispatch<SetStateAction<boolean>>;
}

export function TenderLifecycleStrip({
  projectIdParam,
  currentProject,
  tendersUnderStudyCount,
  handleStartNewTender,
  handleSubmitBid,
  handleCreateRevision,
  setIsTenderSwitcherOpen,
  setIsAwardModalOpen,
  setIsLostModalOpen,
  setIsWorkflowMapOpen,
}: TenderLifecycleStripProps) {
  const { t } = useTranslation();
  return (
    <>
        {/* شريط حالة دورة حياة العطاء وإجراءات التفاوض والترسية */}
        {projectIdParam && currentProject ? (
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRight: '4px solid #170e5e',
              borderRadius: '10px',
              padding: '10px 16px',
              marginBottom: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.8rem', color: '#170e5e', background: '#ffffff', border: '1px solid #cbd5e1', padding: '3px 8px', borderRadius: '4px' }}>
                {currentProject.code || `PRJ-${currentProject.id}`}
              </span>
              <span style={{ fontSize: 'var(--font-body)', fontWeight: 700, color: '#0f172a' }}>
                {currentProject.name}
              </span>
              {currentProject.clientName && (
                <span style={{ fontSize: 'var(--font-subtitle)', color: '#64748b' }}>
                  {t('contracting.contracting_tender_page.s8', "(العميل:")} {currentProject.clientName})
                </span>
              )}
              <span
                style={{
                  padding: '3px 10px',
                  borderRadius: '6px',
                  fontSize: 'var(--font-badge)',
                  fontWeight: 600,
                  background: '#ffffff',
                  color: '#1e293b',
                  border: '1px solid #cbd5e1',
                }}
              >
                {currentProject.status === 'submitted'
                  ? t('contracting.contracting_tender_page.s9', "تم تقديم العرض المالي (بانتظار رد العميل)")
                  : currentProject.status === 'negotiation'
                  ? `تحت التفاوض والمراجعة (Rev-${currentProject.revisionNumber || 1})`
                  : currentProject.status === 'lost'
                  ? t('contracting.contracting_tender_page.s10', "أرشيف العطاءات غير المرسّاة")
                  : t('contracting.contracting_tender_page.s11', "عطاء قيد الدراسة والتسعير (Draft)")}
              </span>
              {Number(currentProject.revisionNumber || 0) > 0 && (
                <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '11px', color: '#475569', background: '#ffffff', padding: '2px 8px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                  Rev-{currentProject.revisionNumber}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setIsTenderSwitcherOpen(true)}
                style={{
                  height: '32px',
                  padding: '0 10px',
                  borderRadius: '6px',
                  fontWeight: 600,
                  background: '#ffffff',
                  color: '#334155',
                  border: '1px solid #cbd5e1',
                  cursor: 'pointer',
                  fontSize: '11.5px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  transition: 'all 0.15s ease',
                }}
              >
                <AppIcons.Folder size={13} />
                <span>{t('contracting.contracting_tender_page.s12', "تبديل العطاء")}</span>
              </button>

              <button
                type="button"
                onClick={handleStartNewTender}
                style={{
                  height: '32px',
                  padding: '0 10px',
                  borderRadius: '6px',
                  fontWeight: 600,
                  background: '#ffffff',
                  color: '#170e5e',
                  border: '1px solid #170e5e',
                  cursor: 'pointer',
                  fontSize: '11.5px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  transition: 'all 0.15s ease',
                }}
              >
                <AppIcons.Plus size={13} />
                <span>{t('contracting.contracting_tender_page.s13', "تسعير عطاء جديد")}</span>
              </button>

              {(currentProject.status === 'draft' || currentProject.status === 'planning') && (
                <button
                  type="button"
                  onClick={handleSubmitBid}
                  style={{
                    height: '32px',
                    padding: '0 12px',
                    borderRadius: '6px',
                    fontWeight: 600,
                    background: '#ffffff',
                    color: '#334155',
                    border: '1px solid #cbd5e1',
                    cursor: 'pointer',
                    fontSize: '11.5px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <AppIcons.CheckCircle size={13} />
                  <span>{t('contracting.contracting_tender_page.s14', "تقديم العرض للعميل")}</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleCreateRevision}
                style={{
                  height: '32px',
                  padding: '0 12px',
                  borderRadius: '6px',
                  fontWeight: 600,
                  background: '#ffffff',
                  color: '#334155',
                  border: '1px solid #cbd5e1',
                  cursor: 'pointer',
                  fontSize: '11.5px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  transition: 'all 0.15s ease',
                }}
              >
                <AppIcons.Copy size={13} />
                <span>{t('contracting.contracting_tender_page.s15', "إنشاء مراجعة تفاوض (Rev+)")}</span>
              </button>

              <button
                type="button"
                onClick={() => setIsAwardModalOpen(true)}
                style={{
                  height: '32px',
                  padding: '0 14px',
                  borderRadius: '6px',
                  fontWeight: 700,
                  background: '#170e5e',
                  color: '#ffffff',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '11.5px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  boxShadow: '0 1px 2px rgba(23, 14, 94, 0.15)',
                  transition: 'all 0.15s ease',
                }}
              >
                <AppIcons.CheckShield size={14} />
                <span>{t('contracting.contracting_tender_page.s16', "اعتماد وترسية العطاء")}</span>
              </button>

              <button
                type="button"
                onClick={() => setIsLostModalOpen(true)}
                style={{
                  height: '32px',
                  padding: '0 12px',
                  borderRadius: '6px',
                  fontWeight: 600,
                  background: '#ffffff',
                  color: '#64748b',
                  border: '1px solid #cbd5e1',
                  cursor: 'pointer',
                  fontSize: '11.5px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  transition: 'all 0.15s ease',
                }}
              >
                <AppIcons.Archive size={13} />
                <span>{t('contracting.contracting_tender_page.s17', "أرشفة (لم يُرسَ)")}</span>
              </button>
            </div>
          </div>
        ) : (
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRight: '4px solid #64748b',
              borderRadius: '10px',
              padding: '10px 16px',
              marginBottom: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AppIcons.Sliders size={16} style={{ color: '#170e5e' }} />
              <span style={{ fontSize: 'var(--font-body)', fontWeight: 700, color: '#1e293b' }}>
                {t('contracting.contracting_tender_page.s18', "مسودة عطاء جديد (جاهزة لإدخال أو سحب كراسة المقايسة BOQ)")}
              </span>
              <span style={{ fontSize: 'var(--font-subtitle)', color: '#64748b' }}>
                {t('contracting.contracting_tender_page.s19', "- يمكنك رفع ملف المقايسة وحصر المخططات، ثم حفظ العطاء قيد الدراسة والتسعير.")}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setIsTenderSwitcherOpen(true)}
                style={{
                  height: '32px',
                  padding: '0 12px',
                  borderRadius: '6px',
                  fontWeight: 600,
                  background: '#ffffff',
                  color: '#170e5e',
                  border: '1px solid #cbd5e1',
                  cursor: 'pointer',
                  fontSize: '11.5px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  transition: 'all 0.15s ease',
                }}
              >
                <AppIcons.Folder size={13} />
                <span>{t('contracting.contracting_tender_page.s20', "فتح عطاء محفوظ سابقاً (")}{tendersUnderStudyCount})</span>
              </button>

              <button
                type="button"
                onClick={() => setIsWorkflowMapOpen(true)}
                style={{
                  height: '32px',
                  padding: '0 12px',
                  borderRadius: '6px',
                  fontWeight: 600,
                  background: '#ffffff',
                  color: '#475569',
                  border: '1px solid #cbd5e1',
                  cursor: 'pointer',
                  fontSize: '11.5px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  transition: 'all 0.15s ease',
                }}
              >
                <AppIcons.Layers size={13} />
                <span>{t('contracting.contracting_tender_page.s21', "خريطة مسار وسيناريوهات المشروع")}</span>
              </button>
            </div>
          </div>
        )}
    </>
  );
}
