// Marketplace onboarding tab + M11 letter-of-authorization modal —
// pure move from SettingsMarketplacesSection.tsx (slice S2). The hook owns
// the onboarding query, the onboarding modal states, and the save mutation;
// the tab and modal components render the onboarding tab JSX and the M11
// DialogShell. The facade calls useMarketplaceOnboarding(activeTab) once and
// passes hook values as props. The GTIN/photo modal setters (S10) arrive as
// props — the modal state lives with its modal's slice, never duplicated here.
// TabKey is not exported by the facade and slices never import the facade, so
// the hook parameter type duplicates the union inline (S4 precedent).
import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { DialogShell } from '@/shared/components/dialog-shell';
import { toast } from '@/shared/components/system-alert';
import {
  marketplaceSyncApi,
  SupportedMarketplace,
  MarketplaceOnboardingCheck,
} from '@/features/storefront/api/marketplace-sync.api';
import {
  CheckCircleIcon,
  AlertTriangleIcon,
  XIcon,
  PlusIcon,
  FileTextIcon,
  CopyIcon,
  SlidersIcon,
  PrinterIcon,
  CheckShieldIcon,
  CameraIcon,
} from '@/shared/components/icons/AppIcons';

type MarketplaceTabKey = 'onboarding' | 'calculator' | 'studio' | 'inventory' | 'inbound' | 'settlements' | 'orders' | 'analytics' | 'amazon' | 'noon' | 'jumia' | 'trendyol';

export function useMarketplaceOnboarding(activeTab: MarketplaceTabKey) {
  // Onboarding & Verification State & Query
  const onboardingQuery = useQuery({
    queryKey: ['marketplace-onboarding-check'],
    queryFn: marketplaceSyncApi.getSellerOnboardingCheck,
    enabled: activeTab === 'onboarding',
  });

  const [showEditOnboardingModal, setShowEditOnboardingModal] = useState<boolean>(false);
  const [onboardingTargetSection, setOnboardingTargetSection] = useState<string>('all');
  const [showLoaModal, setShowLoaModal] = useState<boolean>(false);
  const [loaLanguage, setLoaLanguage] = useState<'ar' | 'en'>('ar');
  const [activePlatformGuide, setActivePlatformGuide] = useState<SupportedMarketplace>('amazon');

  const saveOnboardingMutation = useMutation({
    mutationFn: (data: Partial<MarketplaceOnboardingCheck>) => marketplaceSyncApi.saveOnboardingProfile(data),
    onSuccess: () => {
      toast.success('تم حفظ البيانات المدخلة بنجاح، يمكنك استكمال باقي البيانات في أي وقت');
      try {
        sessionStorage.removeItem('marketplace_onboarding_draft');
      } catch {}
      onboardingQuery.refetch();
      setShowEditOnboardingModal(false);
    },
    onError: (err: any) => toast.error(err?.message || 'فشل حفظ بيانات التاجر'),
  });

  return {
    onboardingQuery,
    showEditOnboardingModal,
    setShowEditOnboardingModal,
    onboardingTargetSection,
    setOnboardingTargetSection,
    showLoaModal,
    setShowLoaModal,
    loaLanguage,
    setLoaLanguage,
    activePlatformGuide,
    setActivePlatformGuide,
    saveOnboardingMutation,
  };
}

export interface MarketplaceOnboardingTabProps {
  onboarding: ReturnType<typeof useMarketplaceOnboarding>;
  setShowGtinModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowPhotoOptimizerModal: React.Dispatch<React.SetStateAction<boolean>>;
}

export const MarketplaceOnboardingTab: React.FC<MarketplaceOnboardingTabProps> = ({
  onboarding,
  setShowGtinModal,
  setShowPhotoOptimizerModal,
}) => {
  const { t } = useTranslation();
  const {
    onboardingQuery,
    setShowEditOnboardingModal,
    setOnboardingTargetSection,
    setShowLoaModal,
    activePlatformGuide,
    setActivePlatformGuide,
  } = onboarding;
  return (
    <>
      {/* ========================================================================= */}
      {/* TAB 0: SELLER ONBOARDING & VERIFICATION ENGINE ("معالج فتح وتأهيل الحساب") */}
      {/* ========================================================================= */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Header Card */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '20px 24px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '16px',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    background: '#eef2ff',
                    color: '#170e5e',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <CheckShieldIcon size={18} />
                </span>
                <h4 style={{ margin: 0, fontSize: '16.5px', fontWeight: 800, color: '#0f172a' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s65', "معالج فتح وتأهيل حساب التاجر وفحص الاعتماد (Seller Onboarding & Verification)")}
                </h4>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#64748b' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s66', "دليلك الذكي لإعداد الأوراق الرسمية والتحقق المسبق من جاهزية ملفك لفتح حساب بائع على أمازون، نون، جوميا، وترينديول وتفادي الرفض الآلي.")}
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setOnboardingTargetSection('all');
                  setShowEditOnboardingModal(true);
                }}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <SlidersIcon size={14} />
                {t('settings.workspace_sections.settings_marketplaces_section.s67', "تعديل واستكمال بيانات التاجر")}
              </Button>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowLoaModal(true)}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <FileTextIcon size={14} />
                {t('settings.workspace_sections.settings_marketplaces_section.s68', "خطاب التفويض الرسمي (LOA)")}
              </Button>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowGtinModal(true)}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <PlusIcon size={14} />
                {t('settings.workspace_sections.settings_marketplaces_section.s69', "طلب إعفاء الباركود (GTIN)")}
              </Button>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowPhotoOptimizerModal(true)}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <CameraIcon size={14} />
                {t('settings.workspace_sections.settings_marketplaces_section.s70', "فاحص ومحسن صور المنتجات")}
              </Button>
            </div>
          </div>

          {onboardingQuery.isLoading ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', color: '#64748b' }}>
              {t('settings.workspace_sections.settings_marketplaces_section.s71', "جاري فحص وتدقيق بيانات المنشأة ومطابقة السجلات مع معايير المنصات...")}
            </div>
          ) : onboardingQuery.data ? (
            <>
              {/* Readiness Banner & Name Match Card */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
                {/* Readiness Score Card */}
                <div
                  style={{
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    padding: '20px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '18px',
                  }}
                >
                  <div
                    style={{
                      width: '72px',
                      height: '72px',
                      borderRadius: '50%',
                      background: onboardingQuery.data.overallReadinessScore >= 80 ? '#f0fdf4' : '#fff7ed',
                      border: `3px solid ${onboardingQuery.data.overallReadinessScore >= 80 ? '#16a34a' : '#ea580c'}`,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <span style={{ fontSize: '20px', fontWeight: 800, color: onboardingQuery.data.overallReadinessScore >= 80 ? '#16a34a' : '#ea580c' }}>
                      {onboardingQuery.data.overallReadinessScore}%
                    </span>
                    <span style={{ fontSize: '9px', fontWeight: 700, color: '#64748b', marginTop: '-2px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s72', "جاهزية")}</span>
                  </div>

                  <div>
                    <h5 style={{ margin: 0, fontSize: '14.5px', fontWeight: 800, color: '#0f172a' }}>
                      {onboardingQuery.data.overallReadinessScore >= 80 ? t('settings.workspace_sections.settings_marketplaces_section.s73', "الملف جاهز بنسبة ممتازة للاعتماد") : t('settings.workspace_sections.settings_marketplaces_section.s74', "يرجى استكمال النواقص لتفادي الرفض")}
                    </h5>
                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b', lineHeight: '1.5' }}>
                      {onboardingQuery.data.overallReadinessScore >= 80
                        ? t('settings.workspace_sections.settings_marketplaces_section.s75', "أوراقك ومستنداتك القانونية مستوفية لأهم شروط الاعتماد الآلي لدى أمازون ونون وجوميا.")
                        : t('settings.workspace_sections.settings_marketplaces_section.s76', "هناك حقول ومستندات هامة غير مكتملة، استكمالها يحميك من الرفض الفوري لحسابك الجديد.")}
                    </p>
                  </div>
                </div>

                {/* Name Match Check Alert */}
                <div
                  style={{
                    background: onboardingQuery.data.nameMatchStatus === 'perfect_match' ? '#f0fdf4' : onboardingQuery.data.nameMatchStatus === 'name_mismatch' ? '#fef2f2' : '#f8fafc',
                    border: `1px solid ${onboardingQuery.data.nameMatchStatus === 'perfect_match' ? '#bbf7d0' : onboardingQuery.data.nameMatchStatus === 'name_mismatch' ? '#fecaca' : '#e2e8f0'}`,
                    borderRadius: '12px',
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    {onboardingQuery.data.nameMatchStatus === 'perfect_match' ? (
                      <CheckCircleIcon size={18} color="#16a34a" />
                    ) : (
                      <AlertTriangleIcon size={18} color={onboardingQuery.data.nameMatchStatus === 'name_mismatch' ? '#dc2626' : '#ea580c'} />
                    )}
                    <span
                      style={{
                        fontSize: '13.5px',
                        fontWeight: 800,
                        color: onboardingQuery.data.nameMatchStatus === 'perfect_match' ? '#166534' : onboardingQuery.data.nameMatchStatus === 'name_mismatch' ? '#991b1b' : '#334155',
                      }}
                    >
                      {t('settings.workspace_sections.settings_marketplaces_section.s77', "فحص تطابق الاسم بالسجل مع الحساب البنكي (Name Match)")}
                    </span>
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: '12px',
                      color: onboardingQuery.data.nameMatchStatus === 'perfect_match' ? '#15803d' : onboardingQuery.data.nameMatchStatus === 'name_mismatch' ? '#b91c1c' : '#64748b',
                      lineHeight: '1.5',
                    }}
                  >
                    {onboardingQuery.data.nameMatchDetails}
                  </p>
                </div>
              </div>

              {/* 6 Verification Checklist Cards */}
              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s78', "قائمة التحقق المسبق للمستندات والبيانات القانونية (Pre-Flight Document Checklist)")}
                  </h4>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s79', "مكتمل:")} {onboardingQuery.data.checklist.filter((c) => c.status === 'ready').length} {t('settings.workspace_sections.settings_marketplaces_section.s80', "من")} {onboardingQuery.data.checklist.length}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
                  {onboardingQuery.data.checklist.map((item) => {
                    const isReady = item.status === 'ready';
                    const isWarning = item.status === 'warning';

                    return (
                      <div
                        key={item.key}
                        style={{
                          background: '#f8fafc',
                          border: `1px solid ${isReady ? '#bbf7d0' : isWarning ? '#fed7aa' : '#e2e8f0'}`,
                          borderRadius: '10px',
                          padding: '14px 16px',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          gap: '10px',
                        }}
                      >
                        <div>
                          {(() => {
                            const [arLabel, enLabel] = item.label.includes('(')
                              ? [item.label.split('(')[0].trim(), item.label.split('(')[1].replace(')', '').trim()]
                              : [item.label, ''];

                            return (
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                                  <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
                                    {arLabel}
                                  </span>
                                  {enLabel ? (
                                    <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>
                                      {enLabel}
                                    </span>
                                  ) : null}
                                </div>
                                <span
                                  style={{
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    padding: '2px 8px',
                                    borderRadius: '12px',
                                    background: isReady ? '#dcfce7' : isWarning ? '#fef3c7' : '#fee2e2',
                                    color: isReady ? '#15803d' : isWarning ? '#b45309' : '#b91c1c',
                                    whiteSpace: 'nowrap',
                                    flexShrink: 0,
                                  }}
                                >
                                  {isReady ? t('settings.workspace_sections.settings_marketplaces_section.s81', "مكتمل") : isWarning ? t('settings.workspace_sections.settings_marketplaces_section.s82', "تنبيه") : t('settings.workspace_sections.settings_marketplaces_section.s83', "ناقص")}
                                </span>
                              </div>
                            );
                          })()}
                          <p style={{ margin: '6px 0 0', fontSize: '11.5px', color: '#64748b', lineHeight: '1.45' }}>
                            {item.notes}
                          </p>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #e2e8f0', paddingTop: '8px' }}>
                          <button
                            type="button"
                            onClick={() => {
                              if (item.key === 'letter_of_auth') {
                                setShowLoaModal(true);
                              } else {
                                setOnboardingTargetSection(item.key);
                                setShowEditOnboardingModal(true);
                              }
                            }}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: '#170e5e',
                              fontSize: '11.5px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              padding: '2px 6px',
                            }}
                          >
                            {item.key === 'letter_of_auth' ? t('settings.workspace_sections.settings_marketplaces_section.s84', "استعراض وطباعة الخطاب ➔") : t('settings.workspace_sections.settings_marketplaces_section.s85', "تحديث البيان ➔")}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Step-by-Step Platform Registration Guides */}
              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '18px' }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s86', "دليل التسجيل والاعتماد خطوة بخطوة لكل منصة (Platform Walkthrough)")}
                    </h4>
                    <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#64748b' }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s87', "إرشادات مصممة خصيصاً لمساعدتك على إتمام التسجيل دون تعليق أو أخطاء.")}
                    </p>
                  </div>

                  <div style={{ display: 'flex', gap: '6px', background: '#f1f5f9', padding: '3px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    {onboardingQuery.data.platformGuides.map((guide) => (
                      <button
                        key={guide.marketplace}
                        type="button"
                        onClick={() => setActivePlatformGuide(guide.marketplace)}
                        style={{
                          padding: '6px 14px',
                          fontSize: '12px',
                          fontWeight: 600,
                          borderRadius: '6px',
                          border: 'none',
                          background: activePlatformGuide === guide.marketplace ? '#ffffff' : 'transparent',
                          color: activePlatformGuide === guide.marketplace ? '#170e5e' : '#64748b',
                          boxShadow: activePlatformGuide === guide.marketplace ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                          cursor: 'pointer',
                        }}
                      >
                        {guide.nameAr}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Active Guide Steps */}
                {(() => {
                  const currentGuide = onboardingQuery.data.platformGuides.find((g) => g.marketplace === activePlatformGuide) || onboardingQuery.data.platformGuides[0];
                  if (!currentGuide) return null;

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <span style={{ fontSize: '12.5px', color: '#334155' }}>
                          {t('settings.workspace_sections.settings_marketplaces_section.s88', "بوابة التسجيل الرسمية:")} <strong style={{ color: '#0f172a', direction: 'ltr', display: 'inline-block' }}>{currentGuide.portalUrl}</strong>
                        </span>
                        <a
                          href={currentGuide.portalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            background: '#170e5e',
                            color: '#ffffff',
                            padding: '6px 12px',
                            borderRadius: '6px',
                            fontSize: '11.5px',
                            fontWeight: 700,
                            textDecoration: 'none',
                          }}
                        >
                          {t('settings.workspace_sections.settings_marketplaces_section.s89', "فتح بوابة التاجر الرسمية ↗")}
                        </a>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
                        {currentGuide.steps.map((st) => (
                          <div
                            key={st.stepNumber}
                            style={{
                              background: '#ffffff',
                              border: '1px solid #e2e8f0',
                              borderRadius: '10px',
                              padding: '14px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '6px',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span
                                style={{
                                  width: '22px',
                                  height: '22px',
                                  borderRadius: '50%',
                                  background: '#170e5e',
                                  color: '#ffffff',
                                  fontSize: '11px',
                                  fontWeight: 800,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                              >
                                {st.stepNumber}
                              </span>
                              <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
                                {st.title}
                              </span>
                            </div>

                            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#334155', lineHeight: '1.5' }}>
                              {st.instruction}
                            </p>

                            {st.tip ? (
                              <div style={{ background: '#fefce8', border: '1px solid #fef08a', borderRadius: '6px', padding: '6px 8px', fontSize: '11px', color: '#854d0e', marginTop: '4px' }}>
                                <strong>{t('settings.workspace_sections.settings_marketplaces_section.s90', "تلميحة ذهبية:")}</strong> {st.tip}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </>
          ) : null}
        </div>
    </>
  );
};

export interface MarketplaceLoaModalProps {
  onboarding: ReturnType<typeof useMarketplaceOnboarding>;
}

export const MarketplaceLoaModal: React.FC<MarketplaceLoaModalProps> = ({ onboarding }) => {
  const { t } = useTranslation();
  const {
    onboardingQuery,
    showLoaModal,
    setShowLoaModal,
    loaLanguage,
    setLoaLanguage,
  } = onboarding;
  return (
    <>
      {/* MODAL 11: LETTER OF AUTHORIZATION (LOA) */}
      {/* ========================================================================= */}
      <DialogShell
        open={showLoaModal}
        onClose={() => setShowLoaModal(false)}
        width="min(760px, 95vw)"
        ariaLabel={t('settings.workspace_sections.settings_marketplaces_section.s697', "خطاب التفويض الرسمي")}
      >
        <div dir="rtl" style={{ background: '#ffffff', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s698', "خطاب التفويض الرسمي المعتمد (Letter of Authorization - LOA)")}
              </h4>
              <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#64748b' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s699', "خطاب قانوني معتمد جاهز للطباعة والختم لتقديمه لفرق التحقق لدى أمازون ونون.")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowLoaModal(false)}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center' }}
            >
              <XIcon size={18} />
            </button>
          </div>

          {onboardingQuery.data ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', background: '#f1f5f9', padding: '3px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <button
                    type="button"
                    onClick={() => setLoaLanguage('ar')}
                    style={{
                      padding: '4px 12px',
                      fontSize: '12px',
                      fontWeight: 600,
                      borderRadius: '4px',
                      border: 'none',
                      background: loaLanguage === 'ar' ? '#ffffff' : 'transparent',
                      color: loaLanguage === 'ar' ? '#170e5e' : '#64748b',
                      cursor: 'pointer',
                    }}
                  >
                    {t('settings.workspace_sections.settings_marketplaces_section.s700', "العربية (صيغة محلية معتمدة)")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLoaLanguage('en')}
                    style={{
                      padding: '4px 12px',
                      fontSize: '12px',
                      fontWeight: 600,
                      borderRadius: '4px',
                      border: 'none',
                      background: loaLanguage === 'en' ? '#ffffff' : 'transparent',
                      color: loaLanguage === 'en' ? '#170e5e' : '#64748b',
                      cursor: 'pointer',
                    }}
                  >
                    English (Amazon & Noon Compliance)
                  </button>
                </div>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const text = loaLanguage === 'ar' ? onboardingQuery.data.letterOfAuthorizationAr : onboardingQuery.data.letterOfAuthorizationEn;
                    navigator.clipboard.writeText(text);
                    toast.success(t('settings.workspace_sections.settings_marketplaces_section.s701', "تم نسخ نص الخطاب بنجاح"));
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <CopyIcon size={13} />
                  {t('settings.workspace_sections.settings_marketplaces_section.s702', "نسخ النص")}
                </Button>
              </div>

              <div
                dir={loaLanguage === 'en' ? 'ltr' : 'rtl'}
                style={{
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: '8px',
                  padding: '16px',
                  maxHeight: '280px',
                  overflowY: 'auto',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  lineHeight: '1.6',
                  whiteSpace: 'pre-wrap',
                  color: '#1e293b',
                }}
              >
                {loaLanguage === 'ar' ? onboardingQuery.data.letterOfAuthorizationAr : onboardingQuery.data.letterOfAuthorizationEn}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <Button variant="secondary" onClick={() => setShowLoaModal(false)}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s703', "إغلاق")}
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    const text = loaLanguage === 'ar' ? onboardingQuery.data.letterOfAuthorizationAr : onboardingQuery.data.letterOfAuthorizationEn;
                    const printWin = window.open('', '_blank', 'width=800,height=900');
                    if (!printWin) {
                      toast.error(t('settings.workspace_sections.settings_marketplaces_section.s704', "يرجى السماح بالنوافذ المنبثقة للطباعة"));
                      return;
                    }
                    printWin.document.write(`
                      <!DOCTYPE html>
                      <html dir="${loaLanguage === 'ar' ? 'rtl' : 'ltr'}">
                        <head>
                          <title>Letter of Authorization</title>
                          <style>
                            @page { size: A4; margin: 25mm 20mm; }
                            body { font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.7; color: #000; padding: 20px; }
                            pre { font-family: inherit; white-space: pre-wrap; font-size: 11pt; }
                            .stamp-box { border: 2px dashed #999; width: 140px; height: 100px; display: flex; align-items: center; justify-content: center; font-size: 9pt; color: #666; margin-top: 10px; }
                          </style>
                        </head>
                        <body>
                          <pre>${text}</pre>
                          <script>
                            window.onload = function() { window.print(); };
                          </script>
                        </body>
                      </html>
                    `);
                    printWin.document.close();
                  }}
                  style={{ background: '#170e5e', color: '#ffffff', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <PrinterIcon size={16} />
                  {t('settings.workspace_sections.settings_marketplaces_section.s705', "طباعة الخطاب الرسمي A4 للختم")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </DialogShell>
    </>
  );
};
