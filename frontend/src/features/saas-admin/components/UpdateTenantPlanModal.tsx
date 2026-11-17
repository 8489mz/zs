import { useTranslation } from 'react-i18next';
import { XIcon, ShieldCheckIcon } from '@/shared/components/icons/AppIcons';
import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { saasAdminApi, SaasTenantRow } from '../api/saas-admin.api';
import { getFriendlyApiErrorMessage } from '@/lib/api-error-message';
import { STANDARD_TIER_FEATURES } from '@/shared/system/DeveloperActivationPanel';

import {
  SYSTEM_VERTICAL_OPTIONS,
  normalizeVerticalKey,
  getPlansForVertical,
  getSystemVertical,
} from '@/shared/verticals/vertical-catalog';

interface UpdateTenantPlanModalProps {
  tenant: SaasTenantRow | null;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

const VERTICAL_MODE_OPTIONS = SYSTEM_VERTICAL_OPTIONS.map((v) => ({
  value: v.key,
  label: v.label,
  hint: `[${v.badge}]`,
}));

const AVAILABLE_FEATURES = [
  { id: 'catalog', name: 'المنتجات والأصناف' },
  { id: 'sales', name: 'المبيعات ونقاط البيع' },
  { id: 'sessions', name: 'ورديات العمل' },
  { id: 'cashDrawer', name: 'صندوق الكاشير والخزينة' },
  { id: 'purchases', name: 'المشتريات والموردين' },
  { id: 'inventory', name: 'المخزون المتقدم والجرد' },
  { id: 'reports', name: 'التقارير المتقدمة وسجل النشاط' },
  { id: 'hr', name: 'الموارد البشرية والرواتب' },
  { id: 'deliveryReps', name: 'مناديب التوصيل والدليفري' },
  { id: 'vanSales', name: 'مبيعات وتوزيع الفان' },
  { id: 'services', name: 'الخدمات والمصنعيات' },
  { id: 'weightedBarcode', name: 'باركود الميزان الإلكتروني' },
  { id: 'combo', name: 'العروض المجمعة والكومبو' },
  { id: 'crm', name: 'إدارة علاقات العملاء والصفقات (CRM)' },
  { id: 'loyalty', name: 'محرك نقاط وولاء العملاء' },
  { id: 'maintenance', name: 'إدارة الصيانة وتتبع السيريال (IMEI)' },
  { id: 'clothing', name: 'المتغيرات والمقاسات والألوان' },
  { id: 'restaurant', name: 'المطاعم والكافيهات والطاولات' },
  { id: 'accounting', name: 'الحسابات العامة وشجرة الحسابات' },
  { id: 'fixed_assets', name: 'إدارة وإهلاك الأصول الثابتة' },
  { id: 'installments', name: 'مبيعات وجدولة التقسيط' },
  { id: 'taxIntegration', name: 'الربط الضريبي والفاتورة الإلكترونية' },
  { id: 'vat_declaration', name: 'الإقرار الضريبي (ن10 و ZATCA)' },
  { id: 'manufacturing', name: 'التصنيع وقوائم المواد وأوامر الإنتاج' },
  { id: 'import', name: 'الاستيراد والشراكة والحاويات' },
  { id: 'pharmacy', name: 'الصيدليات والأدوية والروشتات' },
  { id: 'storefront', name: 'المتجر الإلكتروني وطلبات الأونلاين' },
];

export function UpdateTenantPlanModal({ tenant, onClose, onSuccess }: UpdateTenantPlanModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [planId, setPlanId] = useState<string>('');
  const [activityType, setActivityType] = useState<string>('retail');
  const [extraFeatures, setExtraFeatures] = useState<string[]>([]);
  // P10 (INV-VAN-GENERAL-FEATURE-OVERRIDES): per-tenant feature overrides
  // (grant / hide / default) for the two features the super-admin can
  // override from this modal. 'default' means no override row — the
  // profile/plan default applies.
  type OverrideChoice = 'default' | 'grant' | 'hide';
  const [posOverride, setPosOverride] = useState<OverrideChoice>('default');
  const [drawerOverride, setDrawerOverride] = useState<OverrideChoice>('default');
  const [posOverrideReason, setPosOverrideReason] = useState('');
  const [drawerOverrideReason, setDrawerOverrideReason] = useState('');
  const [renewSubscription, setRenewSubscription] = useState(false);
  const [durationMonths, setDurationMonths] = useState(12);
  const [paymentAmount, setPaymentAmount] = useState<number | ''>('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [error, setError] = useState('');

  const featurePlansQuery = useQuery({
    queryKey: ['saas-feature-plans'],
    queryFn: () => saasAdminApi.listFeaturePlans(),
    staleTime: 0,
  });
  const featurePlans = featurePlansQuery.data || [];

  useEffect(() => {
    if (tenant) {
      setPlanId(tenant.planId || '');
      const raw = String(tenant.activityType || '').toLowerCase();
      let norm = normalizeVerticalKey(raw);
      if (tenant.slug === 'almhnds' && norm === 'services') {
        norm = 'retail';
      }
      setActivityType(norm);
      setExtraFeatures(tenant.extraFeatures || []);
      // P10: initialise the override controls from the tenant's current
      // override rows (getTenantById returns them).
      const initialOverrides = new Map((tenant.featureOverrides || []).map((o) => [o.featureCode, o]));
      const posRow = initialOverrides.get('pos');
      const drawerRow = initialOverrides.get('cashDrawer');
      setPosOverride(posRow?.granted === true ? 'grant' : posRow?.granted === false ? 'hide' : 'default');
      setDrawerOverride(drawerRow?.granted === true ? 'grant' : drawerRow?.granted === false ? 'hide' : 'default');
      setPosOverrideReason(posRow?.reason || '');
      setDrawerOverrideReason(drawerRow?.reason || '');
      setRenewSubscription(false);
      setDurationMonths(12);
      setPaymentAmount('');
      setPaymentMethod('cash');
      setError('');
    }
  }, [tenant]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      await saasAdminApi.updateTenantPlan(tenant!.id, {
        planId: planId || undefined,
        extraFeatures,
        activityType,
        // P10: both rows are always sent; the backend writes only the
        // ones whose value actually changed (and audits each change).
        featureOverrides: [
          { featureCode: 'pos', granted: posOverride === 'default' ? null : posOverride === 'grant', reason: posOverrideReason.trim() || undefined },
          { featureCode: 'cashDrawer', granted: drawerOverride === 'default' ? null : drawerOverride === 'grant', reason: drawerOverrideReason.trim() || undefined },
        ],
      });

      if (renewSubscription) {
        await saasAdminApi.activateTenant(tenant!.id, {
          durationMonths,
          paymentAmount: paymentAmount ? Number(paymentAmount) : undefined,
          paymentMethod,
        });
      }
    },
    onSuccess: async () => {
      onSuccess(renewSubscription
        ? 'تم تحديث نمط المنشأة، باقة الميزات، وتمديد فترة الاشتراك بنجاح.'
        : 'تم تحديث نمط المنشأة والباقة والميزات بنجاح.');
      await queryClient.invalidateQueries({ queryKey: ['saas-admin-tenants'] });
      await queryClient.invalidateQueries({ queryKey: ['saas-tenants'] });
      onClose();
    },
    onError: (err) => setError(getFriendlyApiErrorMessage(err, 'حدث خطأ أثناء التحديث.')),
  });

  if (!tenant) return null;

  const currentVertical = getSystemVertical(activityType);
  const authorizedPlans = getPlansForVertical(activityType, featurePlans);

  const planOptions = [
    { value: '', label: '-- بدون باقة --' },
    ...authorizedPlans.map((p) => ({
      value: p.value,
      label: p.label,
      hint: p.badge ? `[${p.badge}]` : undefined,
    })),
  ];

  // Preserve legacy plan if tenant had one previously not matching current band
  if (planId && !planOptions.some((o) => o.value === planId)) {
    const legacyPlan = featurePlans.find((p: any) => String(p.id) === planId);
    planOptions.push({
      value: planId,
      label: legacyPlan ? `${legacyPlan.name} (باقة مسجلة حالياً)` : `${planId} (باقة مسجلة حالياً)`,
    });
  }

  const handleVerticalChange = (newVerticalKey: string) => {
    setActivityType(newVerticalKey);
    const validPlans = getPlansForVertical(newVerticalKey, featurePlans);
    const isValid = validPlans.some((p) => p.value === planId);
    if (!isValid) {
      const rec = validPlans.find((p) => p.isRecommended) || validPlans[1] || validPlans[0];
      if (rec) {
        setPlanId(rec.value);
        setExtraFeatures([]);
      }
    }
  };

  const toggleFeature = (featId: string) => {
    setExtraFeatures(prev => {
      const isBaseIncluded = selectedPlanFeatures.includes(featId);
      
      if (isBaseIncluded) {
        if (prev.includes(`-${featId}`)) {
          return prev.filter(f => f !== `-${featId}`);
        } else {
          return [...prev, `-${featId}`];
        }
      } else {
        if (prev.includes(featId)) {
          return prev.filter(f => f !== featId);
        } else {
          return [...prev, featId];
        }
      }
    });
  };

  const selectedPlanFeatures = STANDARD_TIER_FEATURES[planId]
    || featurePlans.find(p => String(p.id) === planId)?.features 
    || [];

  return (
    <DialogShell open={true} onClose={onClose} width="min(1060px, 96vw)" ariaLabel={t('saas_admin.update_tenant_plan_modal.s0', "تحديث الباقة والمود القطاعي")}>
      <div className="dialog-card" dir="rtl" style={{ maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexShrink: 0 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#170c5c' }}>
              {t('saas_admin.update_tenant_plan_modal.s1', "تحديث نمط المنشأة وباقة النسخة")}
            </h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '12.5px', color: '#64748b' }}>
              {t('saas_admin.update_tenant_plan_modal.s2', "المنشأة:")} <strong style={{ color: '#0f172a' }}>{tenant.businessName || tenant.slug}</strong> ({tenant.slug})
            </p>
          </div>
          <button
            type="button"
            className="dialog-shell-close-btn"
            onClick={onClose}
            title={t('saas_admin.update_tenant_plan_modal.s3', "إغلاق")}
          ><XIcon size={15} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto', flex: 1, paddingInlineEnd: '4px' }}>
          {error && <div className="warning-box">{error}</div>}

          {/* تنبيه إرشادي يوضح خصائص النمط النشط وعزله الصارم */}
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderInlineStart: '4px solid #170e5e',
              borderRadius: '8px',
              padding: '8px 12px',
              fontSize: '12px',
              lineHeight: 1.5,
              color: '#334155',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800, color: '#170e5e', marginBottom: '3px' }}>
              <ShieldCheckIcon size={15} color="#170e5e" />
              <span>{t('saas_admin.update_tenant_plan_modal.s4', "دستور العزل والأنماط المؤسسية المعتمد (")}{currentVertical.groupLabel})</span>
            </div>
            <div>
              <strong>{t('saas_admin.update_tenant_plan_modal.s5', "النمط المختار:")}</strong> {currentVertical.label} — <em>[{currentVertical.badge}]</em><br />
              <strong>{t('saas_admin.update_tenant_plan_modal.s6', "الأقسام والصلاحيات:")}</strong> {currentVertical.description}<br />
              <span style={{ color: '#059669', fontWeight: 600 }}>
                {currentVertical.band === 5
                  ? t('saas_admin.update_tenant_plan_modal.s7', "يتم عزل هذا القطاع عزلاً تاماً (حجب نقاط بيع التجزئة، موازين الباركود، والمتجر السحابي على الكمبيوتر والموبايل).")
                  : currentVertical.key === 'wholesale'
                  ? t('saas_admin.update_tenant_plan_modal.s8', "يتم حجب كاشير التجزئة السريع وتفعيل أسطول التوزيع الفان والمبيعات الآجلة.")
                  : t('saas_admin.update_tenant_plan_modal.s9', "تقتصر خيارات الباقات تلقائياً على باقات ومستويات هذا النمط التشغيلي مع تفعيل نقطة البيع والكاشير السريع.")}
              </span>
            </div>
          </div>

          {/* 1 & 2. نمط المنشأة والباقة في صف ثنائي متوازن */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label={t('saas_admin.update_tenant_plan_modal.s10', "نمط المنشأة والمود القطاعي (Vertical Mode) *")}>
              <CustomSelect
                value={activityType}
                onChange={(val) => handleVerticalChange(val)}
                options={VERTICAL_MODE_OPTIONS}
                style={{ height: '38px', fontWeight: 700, color: '#170e5e' }}
              />
            </Field>

            <Field label={t('saas_admin.update_tenant_plan_modal.s11', "باقة الاشتراك والترخيص المتوافقة مع النمط (Feature Plan) *")}>
              <CustomSelect
                value={planId}
                onChange={(val) => {
                  setPlanId(val);
                  setExtraFeatures([]);
                }}
                options={planOptions}
                style={{ height: '38px', fontWeight: 700, color: '#170e5e' }}
              />
            </Field>
          </div>

          {/* قسم تمديد الاشتراك والفوترة */}
          <div
            style={{
              background: renewSubscription ? '#f0fdf4' : '#f8fafc',
              border: `1px solid ${renewSubscription ? '#86efac' : '#e2e8f0'}`,
              borderRadius: '10px',
              padding: '12px 14px',
              transition: 'all 0.15s ease',
            }}
          >
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <input
                type="checkbox"
                checked={renewSubscription}
                onChange={(e) => setRenewSubscription(e.target.checked)}
                style={{ width: '16px', height: '16px', cursor: 'pointer' }}
              />
              <div>
                <strong style={{ fontSize: '13px', color: '#0f172a' }}>
                  {t('saas_admin.update_tenant_plan_modal.renew_toggle', "تفعيل أو تمديد صلاحية الاشتراك المالي وتسجيل دفعة الآن")}
                </strong>
                <p style={{ margin: '1px 0 0', fontSize: '11.5px', color: '#64748b' }}>
                  {t('saas_admin.update_tenant_plan_modal.renew_sub', "تحديث تاريخ انتهاء صلاحية النسخة تلقائياً مع تسجيل إيصال سداد مالي في سجل المشترك")}
                </p>
              </div>
            </label>

            {renewSubscription && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: '12px',
                  marginTop: '12px',
                  paddingTop: '10px',
                  borderTop: '1px solid #dcfce7',
                }}
              >
                <Field label={t('saas_admin.update_tenant_plan_modal.duration', "مدة الاشتراك المستهدفة")}>
                  <select
                    value={durationMonths}
                    onChange={(e) => setDurationMonths(Number(e.target.value))}
                    style={{ height: '36px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 8px', fontSize: '12.5px', fontWeight: 600, width: '100%', background: '#ffffff' }}
                  >
                    <option value={1}>{t('saas_admin.update_tenant_plan_modal.m1', "شهر واحد")}</option>
                    <option value={3}>{t('saas_admin.update_tenant_plan_modal.m3', "3 أشهر")}</option>
                    <option value={6}>{t('saas_admin.update_tenant_plan_modal.m6', "6 أشهر")}</option>
                    <option value={12}>{t('saas_admin.update_tenant_plan_modal.m12', "سنة واحدة (12 شهراً)")}</option>
                    <option value={60}>{t('saas_admin.update_tenant_plan_modal.m60', "5 سنوات (شامل / مدى الحياة)")}</option>
                  </select>
                </Field>

                <Field label={t('saas_admin.update_tenant_plan_modal.amount', "المبلغ المحصل (اختياري)")}>
                  <input
                    type="number"
                    min="0"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="0.00"
                    style={{ height: '36px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 8px', fontSize: '12.5px', width: '100%', boxSizing: 'border-box' }}
                  />
                </Field>

                <Field label={t('saas_admin.update_tenant_plan_modal.method', "طريقة الدفع")}>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    style={{ height: '36px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 8px', fontSize: '12.5px', fontWeight: 600, width: '100%', background: '#ffffff' }}
                  >
                    <option value="cash">{t('saas_admin.update_tenant_plan_modal.cash', "نقدي (Cash)")}</option>
                    <option value="transfer">{t('saas_admin.update_tenant_plan_modal.transfer', "تحويل بنكي / فودافون كاش")}</option>
                    <option value="card">{t('saas_admin.update_tenant_plan_modal.card', "بطاقة دفع (Card)")}</option>
                  </select>
                </Field>
              </div>
            )}
          </div>

          {/* 3. الميزات الإضافية */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <div>
                <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: '#1e293b' }}>
                  {t('saas_admin.update_tenant_plan_modal.s12', "الميزات الإضافية والمستثناة:")}
                </h4>
                <p style={{ margin: '2px 0 0 0', fontSize: '11.5px', color: '#64748b' }}>
                  {t('saas_admin.update_tenant_plan_modal.s13', "يمكنك تفعيل ميزات إضافية يدوياً، أو استثناء ميزات متوفرة في الباقة المختارة.")}
                </p>
              </div>
            </div>
            
            <div 
              style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', 
                gap: '8px',
                padding: '6px',
                background: '#f8fafc',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
              }}
            >
              {AVAILABLE_FEATURES.map((feat) => {
                const isBaseIncluded = selectedPlanFeatures.includes(feat.id);
                const isExcluded = extraFeatures.includes(`-${feat.id}`);
                const isExtraIncluded = extraFeatures.includes(feat.id);
                const isChecked = (isBaseIncluded && !isExcluded) || isExtraIncluded;

                return (
                  <label 
                    key={feat.id} 
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '8px', 
                      cursor: 'pointer', 
                      opacity: isExcluded ? 0.6 : 1, 
                      padding: '8px 10px', 
                      background: isChecked ? '#f0fdf4' : '#ffffff', 
                      borderRadius: '8px', 
                      border: `1px solid ${isChecked ? '#bbf7d0' : '#e2e8f0'}`,
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <input 
                      type="checkbox" 
                      checked={isChecked} 
                      onChange={() => toggleFeature(feat.id)}
                      style={{ width: '15px', height: '15px', margin: 0, flexShrink: 0 }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '12.5px', fontWeight: 700, color: isChecked ? '#065f46' : '#334155' }}>
                        {feat.name}
                      </span>
                      {isBaseIncluded && !isExcluded && <span style={{ fontSize: '10.5px', color: '#10b981', fontWeight: 600 }}>{t('saas_admin.update_tenant_plan_modal.s14', "(متوفرة في الباقة)")}</span>}
                      {isBaseIncluded && isExcluded && <span style={{ fontSize: '10.5px', color: '#ef4444', fontWeight: 600 }}>{t('saas_admin.update_tenant_plan_modal.s15', "(مستثناة من الباقة)")}</span>}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
          {/* 4. تجاوزات الميزات (سوبر أدمن) — P10 INV-VAN-GENERAL-FEATURE-OVERRIDES */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <div>
                <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: '#1e293b' }}>
                  {t('saas_admin.update_tenant_plan_modal.overrides_title', "تجاوزات الميزات (سوبر أدمن فقط):")}
                </h4>
                <p style={{ margin: '2px 0 0 0', fontSize: '11.5px', color: '#64748b' }}>
                  {t('saas_admin.update_tenant_plan_modal.overrides_sub', "منح أو إخفاء ميزة لنسخة معينة فوق إعدادات النمط الافتراضية — تُطبق فوراً على الصلاحيات والإعدادات والقائمة.")}
                </p>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px',
                padding: '6px',
                background: '#f8fafc',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', padding: '8px 10px', background: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#334155' }}>
                  {t('saas_admin.update_tenant_plan_modal.override_pos', "نقطة البيع (POS)")}
                </span>
                <select
                  value={posOverride}
                  onChange={(e) => setPosOverride(e.target.value as 'default' | 'grant' | 'hide')}
                  style={{ height: '35px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 12px 0 36px', fontSize: '12.5px', fontWeight: 600, width: '100%', background: '#ffffff' }}
                >
                  <option value="default">{t('saas_admin.update_tenant_plan_modal.override_default', "افتراضي (حسب النمط)")}</option>
                  <option value="grant">{t('saas_admin.update_tenant_plan_modal.override_grant', "منح — تفعيل فوق النمط")}</option>
                  <option value="hide">{t('saas_admin.update_tenant_plan_modal.override_hide', "إخفاء — إيقاف فوق الباقة")}</option>
                </select>
                <input
                  type="text"
                  value={posOverrideReason}
                  onChange={(e) => setPosOverrideReason(e.target.value)}
                  placeholder={t('saas_admin.update_tenant_plan_modal.override_reason', "سبب التجاوز (اختياري)")}
                  style={{ height: '35px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 12px', fontSize: '12.5px', width: '100%', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', padding: '8px 10px', background: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#334155' }}>
                  {t('saas_admin.update_tenant_plan_modal.override_drawer', "صندوق الكاشير (الدرج)")}
                </span>
                <select
                  value={drawerOverride}
                  onChange={(e) => setDrawerOverride(e.target.value as 'default' | 'grant' | 'hide')}
                  style={{ height: '35px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 12px 0 36px', fontSize: '12.5px', fontWeight: 600, width: '100%', background: '#ffffff' }}
                >
                  <option value="default">{t('saas_admin.update_tenant_plan_modal.override_default', "افتراضي (حسب النمط)")}</option>
                  <option value="grant">{t('saas_admin.update_tenant_plan_modal.override_grant', "منح — تفعيل فوق النمط")}</option>
                  <option value="hide">{t('saas_admin.update_tenant_plan_modal.override_hide', "إخفاء — إيقاف فوق الباقة")}</option>
                </select>
                <input
                  type="text"
                  value={drawerOverrideReason}
                  onChange={(e) => setDrawerOverrideReason(e.target.value)}
                  placeholder={t('saas_admin.update_tenant_plan_modal.override_reason', "سبب التجاوز (اختياري)")}
                  style={{ height: '35px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 12px', fontSize: '12.5px', width: '100%', boxSizing: 'border-box' }}
                />
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #e2e8f0', flexShrink: 0 }}>
          <button type="button" className="button button-secondary" onClick={onClose} disabled={updateMutation.isPending}>{t('saas_admin.update_tenant_plan_modal.s16', "إلغاء")}</button>
          <button 
            type="button" 
            className="button button-primary" 
            onClick={() => updateMutation.mutate()} 
            disabled={updateMutation.isPending}
            style={{ fontWeight: 800, background: '#170e5e', color: '#ffffff' }}
          >
            {updateMutation.isPending ? t('saas_admin.update_tenant_plan_modal.s17', "جاري الحفظ...") : t('saas_admin.update_tenant_plan_modal.s18', "حفظ التعديلات")}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}
