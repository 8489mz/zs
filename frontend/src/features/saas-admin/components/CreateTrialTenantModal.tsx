import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { XIcon } from '@/shared/components/icons/AppIcons';
import { formatDate } from '@/lib/format';
import { saasAdminApi, SaasTenantRow } from '../api/saas-admin.api';

import {
  SYSTEM_VERTICAL_OPTIONS,
  getPlansForVertical,
} from '@/shared/verticals/vertical-catalog';
import { resolveFrontendPlanDisplayName } from '@/shared/verticals/plan-tiers';

export interface CreateTrialTenantModalProps {
  open: boolean;
  onClose: () => void;
  featurePlans: any[];
  onShareWelcome: (data: { tenant: SaasTenantRow; temporaryPassword?: string; username: string }) => void;
  onSuccessFeedback?: (message: string) => void;
}

const INDUSTRY_MODE_OPTIONS = SYSTEM_VERTICAL_OPTIONS.map((v) => ({
  value: v.key,
  label: v.label,
  badge: v.badge,
}));

const initialForm = {
  slug: '',
  businessName: '',
  branchName: '',
  ownerName: '',
  ownerPhone: '',
  ownerEmail: '',
  activityType: 'التجزئة والمحلات والمتاجر العامة',
  businessIndustry: 'retail',
  username: '',
  password: '',
  days: '14',
  source: '',
  campaign: '',
  notes: '',
  featurePlanId: 'plan_ultimate',
};

export function CreateTrialTenantModal({
  open,
  onClose,
  featurePlans,
  onShareWelcome,
  onSuccessFeedback,
}: CreateTrialTenantModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [createForm, setCreateForm] = useState(initialForm);
  const [createResult, setCreateResult] = useState<{
    username: string;
    temporaryPassword?: string;
    trialEndsAt: string;
    tenantSlug: string;
    businessName?: string;
    fullTenant?: SaasTenantRow;
  } | null>(null);

  const copyToClipboard = (text: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      if (onSuccessFeedback) onSuccessFeedback('تم نسخ النص إلى الحافظة بنجاح.');
    }
  };

  const createTrialMutation = useMutation({
    mutationFn: () => saasAdminApi.createTrialTenant({
      slug: createForm.slug.trim(),
      businessName: createForm.businessName.trim(),
      branchName: createForm.branchName?.trim() || undefined,
      ownerName: createForm.ownerName.trim(),
      ownerPhone: createForm.ownerPhone.trim(),
      ownerEmail: createForm.ownerEmail?.trim() || undefined,
      activityType: createForm.activityType?.trim() || undefined,
      businessIndustry: createForm.businessIndustry,
      username: createForm.username.trim() || 'admin',
      password: createForm.password || undefined,
      days: Number(createForm.days || 14),
      source: createForm.source || undefined,
      campaign: createForm.campaign || undefined,
      notes: createForm.notes || undefined,
      featurePlanId: createForm.featurePlanId || 'plan_ultimate',
    }),
    onSuccess: async (payload) => {
      void queryClient.invalidateQueries({ queryKey: ['saas-tenants'] });
      const fullTenantWithDetails: SaasTenantRow = {
        ...payload.tenant,
        ownerUsername: payload.owner.username,
        planName: payload.tenant.planName || resolveFrontendPlanDisplayName(createForm.featurePlanId) || 'الأساسية',
      } as any;
      setCreateResult({
        username: payload.owner.username,
        temporaryPassword: payload.owner.temporaryPassword,
        trialEndsAt: payload.tenant.trialEndsAt || '',
        tenantSlug: payload.tenant.slug,
        businessName: payload.tenant.businessName,
        fullTenant: fullTenantWithDetails,
      });
      if (onSuccessFeedback) onSuccessFeedback('تم إنشاء النسخة التجريبية بنجاح.');
      setCreateForm(initialForm);
    },
  });

  const handleClose = () => {
    setCreateResult(null);
    onClose();
  };

  if (!open) return null;

  return (
    <DialogShell
      open={open}
      onClose={handleClose}
      width="980px"
      shellClassName="saas-create-modal-shell"
      ariaLabel={t('saas_admin.create_trial_tenant_modal.s0', "إنشاء نسخة تجريبية جديدة")}
    >
      <div className="dialog-card saas-compact-dialog-card">
        <div className="standard-dialog-header" style={{ marginBottom: '14px', paddingBottom: '12px' }}>
          <div className="standard-dialog-header-info">
            <h3 className="standard-dialog-title" style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: '#170c5c' }}>
              {t('saas_admin.create_trial_tenant_modal.s1', "إنشاء نسخة تجريبية جديدة")}
            </h3>
            <p className="standard-dialog-subtitle" style={{ margin: '3px 0 0 0', fontSize: '12px', color: '#64748b' }}>
              {t('saas_admin.create_trial_tenant_modal.s2', "إدخال بيانات المنشأة والمالك لتوليد نسخة سحابية فورية بحساب كامل الصلاحيات.")}
            </p>
          </div>
          <button
            type="button"
            className="standard-dialog-close-btn"
            onClick={handleClose}
            title={t('saas_admin.create_trial_tenant_modal.s3', "إغلاق")}
          >
            <XIcon size={16} />
          </button>
        </div>

        {createResult ? (
          <div className="saas-credentials-luxury-card">
            {/* 1. Header with Success Badge and Business Title */}
            <div className="saas-credentials-hero">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div className="saas-credentials-icon-box">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: '15px', fontWeight: 900, color: '#0f172a' }}>
                      {t('saas_admin.create_trial_tenant_modal.s4', "تم تجهيز النسخة السحابية بنجاح")}
                    </div>
                    <div style={{ fontSize: '12.5px', color: '#64748b', marginTop: '2px' }}>
                      {t('saas_admin.create_trial_tenant_modal.s5', "المنشأة:")} <strong style={{ color: '#0f172a' }}>{createResult.businessName || createResult.tenantSlug}</strong>
                    </div>
                  </div>
                </div>
                <span className="tenant-status-pill trial" style={{ fontSize: '11px', padding: '3px 10px', fontWeight: 800 }}>
                  {t('saas_admin.create_trial_tenant_modal.s6', "تجريبي • 14 يوماً")}
                </span>
              </div>
            </div>

            {/* 2. Credentials Grid */}
            <div className="saas-credentials-grid">
              {/* Slug */}
              <div className="saas-credential-box">
                <span className="saas-credential-label">{t('saas_admin.create_trial_tenant_modal.s7', "المعرف السحابي (Slug)")}</span>
                <div className="saas-credential-content">
                  <code className="saas-credential-code">{createResult.tenantSlug}</code>
                  <button type="button" className="saas-copy-btn" onClick={() => copyToClipboard(createResult.tenantSlug || '')}>{t('saas_admin.create_trial_tenant_modal.s8', "نسخ")}</button>
                </div>
              </div>

              {/* Username */}
              <div className="saas-credential-box">
                <span className="saas-credential-label">{t('saas_admin.create_trial_tenant_modal.s9', "اسم مستخدم المالك (Super Admin)")}</span>
                <div className="saas-credential-content">
                  <code className="saas-credential-code">{createResult.username}</code>
                  <button type="button" className="saas-copy-btn" onClick={() => copyToClipboard(createResult.username || '')}>{t('saas_admin.create_trial_tenant_modal.s10', "نسخ")}</button>
                </div>
              </div>

              {/* Temporary Password */}
              <div className="saas-credential-box" style={{ gridColumn: 'span 2' }}>
                <span className="saas-credential-label">{t('saas_admin.create_trial_tenant_modal.s11', "كلمة المرور المؤقتة (Temporary Password)")}</span>
                <div className="saas-credential-content">
                  <code className="saas-credential-code password-highlight">{createResult.temporaryPassword}</code>
                  <button type="button" className="saas-copy-btn" onClick={() => copyToClipboard(createResult.temporaryPassword || '')}>{t('saas_admin.create_trial_tenant_modal.s12', "نسخ كلمة المرور")}</button>
                </div>
              </div>

              {/* Expiry Date */}
              <div className="saas-credential-box" style={{ gridColumn: 'span 2' }}>
                <span className="saas-credential-label">{t('saas_admin.create_trial_tenant_modal.s13', "تاريخ انتهاء الفترة التجريبية")}</span>
                <div className="saas-credential-content">
                  <span style={{ fontSize: '13px', fontWeight: 700, color: '#334155' }}>
                    {formatDate(createResult.trialEndsAt)}
                  </span>
                </div>
              </div>
            </div>

            {/* 3. Action Bar */}
            <div className="saas-credentials-actions">
              {createResult.fullTenant && (
                <button
                  type="button"
                  className="saas-whatsapp-action-btn"
                  onClick={() => {
                    onShareWelcome({
                      tenant: {
                        ...createResult.fullTenant!,
                        ownerUsername: createResult.username,
                      },
                      temporaryPassword: createResult.temporaryPassword,
                      username: createResult.username,
                    });
                    handleClose();
                  }}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
                  </svg>
                  <span>{t('saas_admin.create_trial_tenant_modal.s14', "مشاركة رسالة الترحيب عبر واتساب")}</span>
                </button>
              )}

              <button
                type="button"
                className="saas-copy-all-btn"
                onClick={() => {
                  const allText = `بيانات الدخول للنسخة السحابية:\nاسم المنشأة: ${createResult.businessName || createResult.tenantSlug}\nالمعرف: ${createResult.tenantSlug}\nاسم المستخدم: ${createResult.username}\nكلمة المرور المؤقتة: ${createResult.temporaryPassword}\nصلاحية التجربة حتى: ${formatDate(createResult.trialEndsAt)}`;
                  copyToClipboard(allText);
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                  <span>{t('saas_admin.create_trial_tenant_modal.s15', "نسخ كامل البيانات")}</span>
                </span>
              </button>

              <button
                type="button"
                className="saas-close-action-btn"
                onClick={handleClose}
              >
                {t('saas_admin.create_trial_tenant_modal.s16', "إغلاق")}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); createTrialMutation.mutate(); }}>
            {/* 1. النشاط التجاري */}
            <div className="saas-modal-card">
              <div className="saas-modal-card-title">
                <span>{t('saas_admin.create_trial_tenant_modal.s17', "1. بيانات النشاط التجاري")}</span>
              </div>
              <div className="saas-modal-grid-2">
                <Field label={t('saas_admin.create_trial_tenant_modal.s18', "اسم النشاط / المحل *")}>
                  <input
                    type="text"
                    required
                    value={createForm.businessName}
                    onChange={(e) => setCreateForm((s) => ({ ...s, businessName: e.target.value }))}
                    placeholder={t('saas_admin.create_trial_tenant_modal.s19', "مثال: سوبر ماركت النور")}
                  />
                </Field>
                <Field label={t('saas_admin.create_trial_tenant_modal.s20', "المعرف السحابي (Slug - إنجليزي فقط) *")}>
                  <input
                    type="text"
                    required
                    value={createForm.slug}
                    onChange={(e) => setCreateForm((s) => ({ ...s, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') }))}
                    placeholder={t('saas_admin.create_trial_tenant_modal.s21', "مثال: al-nour-market")}
                    dir="ltr"
                  />
                </Field>
              </div>

              <div style={{ marginTop: '10px' }}>
                <Field label={t('saas_admin.create_trial_tenant_modal.s22', "نمط المنشأة والمود القطاعي (Vertical Mode) *")}>
                  <CustomSelect
                    value={createForm.businessIndustry}
                    onChange={(val) => {
                      const found = INDUSTRY_MODE_OPTIONS.find((opt) => opt.value === val);
                      const validPlans = getPlansForVertical(val, featurePlans);
                      const isValid = validPlans.some((p) => p.value === createForm.featurePlanId);
                      const recPlan = validPlans.find((p) => p.isRecommended) || validPlans[1] || validPlans[0];
                      setCreateForm((s) => ({
                        ...s,
                        businessIndustry: val,
                        activityType: found ? found.label : s.activityType,
                        featurePlanId: isValid ? s.featurePlanId : (recPlan ? recPlan.value : 'plan_ultimate'),
                      }));
                    }}
                    options={INDUSTRY_MODE_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: `${opt.label} — [${opt.badge}]`,
                    }))}
                    style={{
                      height: '38px',
                      fontWeight: 700,
                      color: '#170e5e',
                    }}
                  />
                </Field>
              </div>

              <div className="saas-modal-grid-2" style={{ marginTop: '10px' }}>
                <Field label={t('saas_admin.create_trial_tenant_modal.s23', "الوصف التجاري للنشاط")}>
                  <input
                    type="text"
                    value={createForm.activityType}
                    onChange={(e) => setCreateForm((s) => ({ ...s, activityType: e.target.value }))}
                    placeholder={t('saas_admin.create_trial_tenant_modal.s24', "مثال: مقاولات عامة وتطوير عقاري، سوبرماركت...")}
                  />
                </Field>
                <Field label={t('saas_admin.create_trial_tenant_modal.s25', "اسم الفرع الأولي (اختياري)")}>
                  <input
                    type="text"
                    value={createForm.branchName}
                    onChange={(e) => setCreateForm((s) => ({ ...s, branchName: e.target.value }))}
                    placeholder={t('saas_admin.create_trial_tenant_modal.s26', "مثال: فرع التعاونيات (افتراضي: الفرع الرئيسي)")}
                  />
                </Field>
              </div>
            </div>

            {/* 2. بيانات المالك والدخول */}
            <div className="saas-modal-card">
              <div className="saas-modal-card-title">
                <span>{t('saas_admin.create_trial_tenant_modal.s27', "2. بيانات المالك وحساب الإدارة")}</span>
              </div>
              <div className="saas-modal-grid-3">
                <Field label={t('saas_admin.create_trial_tenant_modal.s28', "اسم المالك *")}>
                  <input
                    type="text"
                    required
                    value={createForm.ownerName}
                    onChange={(e) => setCreateForm((s) => ({ ...s, ownerName: e.target.value }))}
                    placeholder={t('saas_admin.create_trial_tenant_modal.s29', "مثال: محمد أحمد")}
                  />
                </Field>
                <Field label={t('saas_admin.create_trial_tenant_modal.s30', "رقم هاتف المالك *")}>
                  <input
                    type="text"
                    required
                    value={createForm.ownerPhone}
                    onChange={(e) => setCreateForm((s) => ({ ...s, ownerPhone: e.target.value }))}
                    placeholder={t('saas_admin.create_trial_tenant_modal.s31', "مثال: 01018017523")}
                    dir="auto"
                  />
                </Field>
                <Field label={t('saas_admin.create_trial_tenant_modal.s32', "البريد الإلكتروني *")}>
                  <input
                    type="email"
                    required
                    value={createForm.ownerEmail}
                    onChange={(e) => setCreateForm((s) => ({ ...s, ownerEmail: e.target.value }))}
                    placeholder="owner@example.com"
                    dir="ltr"
                  />
                </Field>
              </div>
              <div className="saas-modal-grid-2" style={{ marginTop: '10px' }}>
                <Field label={t('saas_admin.create_trial_tenant_modal.s33', "اسم المستخدم")}>
                  <input
                    type="text"
                    value={createForm.username}
                    onChange={(e) => setCreateForm((s) => ({ ...s, username: e.target.value }))}
                    placeholder={t('saas_admin.create_trial_tenant_modal.s34', "افتراضي: admin")}
                    dir="ltr"
                  />
                </Field>
                <Field label={t('saas_admin.create_trial_tenant_modal.s35', "كلمة المرور")}>
                  <input
                    type="text"
                    value={createForm.password}
                    onChange={(e) => setCreateForm((s) => ({ ...s, password: e.target.value }))}
                    placeholder={t('saas_admin.create_trial_tenant_modal.s36', "فارغ = توليد تلقائي")}
                    dir="ltr"
                  />
                </Field>
              </div>
            </div>

            {/* 3 & 4. باقة التجربة والمتابعة */}
            <div className="saas-modal-dual-cards">
              <div className="saas-modal-card">
                <div className="saas-modal-card-title">
                  <span>{t('saas_admin.create_trial_tenant_modal.s37', "3. باقة التجربة والميزات")}</span>
                </div>
                <Field label={t('saas_admin.create_trial_tenant_modal.s38', "خطة الميزات المفعلة للنسخة *")}>
                  <CustomSelect
                    value={createForm.featurePlanId}
                    onChange={(val) => setCreateForm((s) => ({ ...s, featurePlanId: val }))}
                    options={getPlansForVertical(createForm.businessIndustry, featurePlans).map((p) => ({
                      value: p.value,
                      label: `${p.label} ${p.badge ? `— [${p.badge}]` : ''}`,
                    }))}
                    style={{
                      height: '38px',
                      fontWeight: 700,
                      color: '#170e5e',
                    }}
                  />
                </Field>
                <div style={{ marginTop: '10px' }}>
                  <Field label={t('saas_admin.create_trial_tenant_modal.s39', "مدة التجربة (أيام)")}>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={createForm.days}
                      onChange={(e) => setCreateForm((s) => ({ ...s, days: e.target.value }))}
                    />
                  </Field>
                </div>
              </div>

              <div className="saas-modal-card">
                <div className="saas-modal-card-title">
                  <span>{t('saas_admin.create_trial_tenant_modal.s40', "4. إعدادات التجربة والمتابعة")}</span>
                </div>
                <div className="saas-modal-grid-2">
                  <Field label={t('saas_admin.create_trial_tenant_modal.s41', "المصدر / القناة")}>
                    <input
                      type="text"
                      value={createForm.source}
                      onChange={(e) => setCreateForm((s) => ({ ...s, source: e.target.value }))}
                      placeholder={t('saas_admin.create_trial_tenant_modal.s42', "مثال: فيسبوك، إحالة عميل...")}
                    />
                  </Field>
                  <Field label={t('saas_admin.create_trial_tenant_modal.s43', "اسم الحملة الإعلانية")}>
                    <input
                      type="text"
                      value={createForm.campaign}
                      onChange={(e) => setCreateForm((s) => ({ ...s, campaign: e.target.value }))}
                      placeholder={t('saas_admin.create_trial_tenant_modal.s44', "اختياري")}
                    />
                  </Field>
                </div>
                <div style={{ marginTop: '10px' }}>
                  <Field label={t('saas_admin.create_trial_tenant_modal.s45', "ملاحظات إضافية")}>
                    <input
                      type="text"
                      value={createForm.notes}
                      onChange={(e) => setCreateForm((s) => ({ ...s, notes: e.target.value }))}
                      placeholder={t('saas_admin.create_trial_tenant_modal.s46', "أي ملاحظات خاصة بالتسجيل أو المتابعة")}
                    />
                  </Field>
                </div>
              </div>
            </div>

            <div className="standard-dialog-footer" style={{ marginTop: '16px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                type="button"
                className="button button-secondary"
                onClick={handleClose}
                style={{ padding: '8px 20px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#334155', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}
              >
                {t('saas_admin.create_trial_tenant_modal.s47', "إلغاء")}
              </button>
              <button
                type="submit"
                className="button"
                style={{
                  background: '#170e5e',
                  color: '#ffffff',
                  fontWeight: 800,
                  padding: '9px 28px',
                  borderRadius: '8px',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '13px',
                  boxShadow: '0 2px 4px rgba(23, 14, 94, 0.2)',
                  transition: 'background 0.15s ease',
                }}
                disabled={createTrialMutation.isPending || !createForm.businessName || !createForm.slug || !createForm.ownerPhone}
              >
                {createTrialMutation.isPending ? t('saas_admin.create_trial_tenant_modal.s48', "جاري إنشاء النسخة...") : t('saas_admin.create_trial_tenant_modal.s49', "إنشاء النسخة التجريبية")}
              </button>
            </div>
          </form>
        )}
      </div>
    </DialogShell>
  );
}

