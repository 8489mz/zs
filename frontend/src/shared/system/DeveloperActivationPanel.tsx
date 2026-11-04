import { useTranslation } from 'react-i18next';
import { XIcon } from '@/shared/components/icons/AppIcons';
import { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { http } from '@/lib/http';
import { DialogShell } from '@/shared/components/dialog-shell';
import { getFriendlyApiErrorMessage } from '@/lib/api-error-message';

import { useAuthStore } from '@/stores/auth-store';
import { isDesktopOfflineApp } from '@/app/router/access';

const AVAILABLE_FEATURES = [
  // 1. الباقة الأساسية (4 ميزات)
  { id: 'sales', name: 'المبيعات ونقاط البيع (POS)', planName: 'الأساسية', planBadgeBg: '#ecfdf5', planBadgeColor: '#047857' },
  { id: 'catalog', name: 'المنتجات والأصناف', planName: 'الأساسية', planBadgeBg: '#ecfdf5', planBadgeColor: '#047857' },
  { id: 'sessions', name: 'ورديات العمل والكاشير', planName: 'الأساسية', planBadgeBg: '#ecfdf5', planBadgeColor: '#047857' },
  { id: 'cashDrawer', name: 'صندوق الكاشير والخزينة', planName: 'الأساسية', planBadgeBg: '#ecfdf5', planBadgeColor: '#047857' },

  // 2. الباقة الاحترافية (3 ميزات إضافية)
  { id: 'purchases', name: 'المشتريات والموردين', planName: 'الاحترافية', planBadgeBg: '#eff6ff', planBadgeColor: '#1d4ed8' },
  { id: 'inventory', name: 'المخزون المتقدم والجرد', planName: 'الاحترافية', planBadgeBg: '#eff6ff', planBadgeColor: '#1d4ed8' },
  { id: 'reports', name: 'التقارير المتقدمة وسجل النشاط', planName: 'الاحترافية', planBadgeBg: '#eff6ff', planBadgeColor: '#1d4ed8' },

  // 3. الباقة المتكاملة (Ultimate ERP) (14 ميزة إضافية)
  { id: 'hr', name: 'الموارد البشرية والرواتب', planName: 'المتكاملة', planBadgeBg: '#f5f3ff', planBadgeColor: '#6d28d9' },
  { id: 'deliveryReps', name: 'مناديب التوصيل والشحن', planName: 'المتكاملة', planBadgeBg: '#f5f3ff', planBadgeColor: '#6d28d9' },
  { id: 'loyalty', name: 'محرك نقاط وولاء العملاء', planName: 'المتكاملة', planBadgeBg: '#f5f3ff', planBadgeColor: '#6d28d9' },
  { id: 'maintenance', name: 'إدارة الصيانة وتتبع السيريال (IMEI)', planName: 'المتكاملة', planBadgeBg: '#f5f3ff', planBadgeColor: '#6d28d9' },
  { id: 'clothing', name: 'المتغيرات والمقاسات والألوان', planName: 'المتكاملة', planBadgeBg: '#f5f3ff', planBadgeColor: '#6d28d9' },
  { id: 'restaurant', name: 'المطاعم والكافيهات والطاولات', planName: 'المتكاملة', planBadgeBg: '#f5f3ff', planBadgeColor: '#6d28d9' },
  { id: 'accounting', name: 'الحسابات العامة وشجرة الحسابات', planName: 'المتكاملة', planBadgeBg: '#f5f3ff', planBadgeColor: '#6d28d9' },
  { id: 'fixed_assets', name: 'إدارة وإهلاك الأصول الثابتة', planName: 'المتكاملة', planBadgeBg: '#f5f3ff', planBadgeColor: '#6d28d9' },
  { id: 'installments', name: 'مبيعات وجدولة التقسيط', planName: 'المتكاملة', planBadgeBg: '#f5f3ff', planBadgeColor: '#6d28d9' },
  { id: 'taxIntegration', name: 'الربط الضريبي والفاتورة الإلكترونية', planName: 'المتكاملة', planBadgeBg: '#f5f3ff', planBadgeColor: '#6d28d9' },
  { id: 'vat_declaration', name: 'الإقرار الضريبي (ن10 و ZATCA)', planName: 'المتكاملة', planBadgeBg: '#f5f3ff', planBadgeColor: '#6d28d9' },
  { id: 'manufacturing', name: 'التصنيع وقوائم المواد وأوامر الإنتاج', planName: 'المتكاملة', planBadgeBg: '#f5f3ff', planBadgeColor: '#6d28d9' },
  { id: 'import', name: 'الاستيراد والشراكة والحاويات', planName: 'المتكاملة', planBadgeBg: '#f5f3ff', planBadgeColor: '#6d28d9' },
  { id: 'pharmacy', name: 'الصيدليات والأدوية والبدائل والنواقص', planName: 'المتكاملة', planBadgeBg: '#f5f3ff', planBadgeColor: '#6d28d9' },
  { id: 'maritime_freight', name: 'الشحن واللوجستيات والموانئ', planName: 'المتكاملة', planBadgeBg: '#f5f3ff', planBadgeColor: '#6d28d9' },

  // 4. باقة التجارة الشاملة (Omnichannel Enterprise)
  { id: 'storefront', name: 'المتجر الإلكتروني وطلبات الأونلاين', planName: 'التجارة الشاملة', planBadgeBg: '#fef3c7', planBadgeColor: '#b45309' },
];

export const STANDARD_TIER_FEATURES: Record<string, string[]> = {
  plan_basic: ['sales', 'catalog', 'sessions', 'cashDrawer'],
  basic: ['sales', 'catalog', 'sessions', 'cashDrawer'],
  BASIC: ['sales', 'catalog', 'sessions', 'cashDrawer'],
  '1': ['sales', 'catalog', 'sessions', 'cashDrawer'],

  plan_pro: ['sales', 'catalog', 'sessions', 'cashDrawer', 'purchases', 'inventory', 'reports'],
  pro: ['sales', 'catalog', 'sessions', 'cashDrawer', 'purchases', 'inventory', 'reports'],
  PRO: ['sales', 'catalog', 'sessions', 'cashDrawer', 'purchases', 'inventory', 'reports'],
  '2': ['sales', 'catalog', 'sessions', 'cashDrawer', 'purchases', 'inventory', 'reports'],

  plan_ultimate: [
    'sales', 'catalog', 'sessions', 'cashDrawer',
    'purchases', 'inventory', 'reports',
    'hr', 'deliveryReps', 'loyalty', 'maintenance', 'clothing', 'restaurant',
    'accounting', 'fixed_assets', 'installments', 'taxIntegration', 'vat_declaration',
    'manufacturing', 'import', 'pharmacy', 'maritime_freight',
  ],
  ultimate: [
    'sales', 'catalog', 'sessions', 'cashDrawer',
    'purchases', 'inventory', 'reports',
    'hr', 'deliveryReps', 'loyalty', 'maintenance', 'clothing', 'restaurant',
    'accounting', 'fixed_assets', 'installments', 'taxIntegration', 'vat_declaration',
    'manufacturing', 'import', 'pharmacy', 'maritime_freight',
  ],
  ULTIMATE: [
    'sales', 'catalog', 'sessions', 'cashDrawer',
    'purchases', 'inventory', 'reports',
    'hr', 'deliveryReps', 'loyalty', 'maintenance', 'clothing', 'restaurant',
    'accounting', 'fixed_assets', 'installments', 'taxIntegration', 'vat_declaration',
    'manufacturing', 'import', 'pharmacy', 'maritime_freight',
  ],
  '3': [
    'sales', 'catalog', 'sessions', 'cashDrawer',
    'purchases', 'inventory', 'reports',
    'hr', 'deliveryReps', 'loyalty', 'maintenance', 'clothing', 'restaurant',
    'accounting', 'fixed_assets', 'installments', 'taxIntegration', 'vat_declaration',
    'manufacturing', 'import', 'pharmacy', 'maritime_freight',
  ],

  plan_omnichannel: [
    'sales', 'catalog', 'sessions', 'cashDrawer',
    'purchases', 'inventory', 'reports',
    'hr', 'deliveryReps', 'loyalty', 'maintenance', 'clothing', 'restaurant',
    'accounting', 'fixed_assets', 'installments', 'taxIntegration', 'vat_declaration',
    'manufacturing', 'import', 'pharmacy',
    'storefront',
  ],
  omnichannel: [
    'sales', 'catalog', 'sessions', 'cashDrawer',
    'purchases', 'inventory', 'reports',
    'hr', 'deliveryReps', 'loyalty', 'maintenance', 'clothing', 'restaurant',
    'accounting', 'fixed_assets', 'installments', 'taxIntegration', 'vat_declaration',
    'manufacturing', 'import', 'pharmacy',
    'storefront',
  ],
  OMNICHANNEL: [
    'sales', 'catalog', 'sessions', 'cashDrawer',
    'purchases', 'inventory', 'reports',
    'hr', 'deliveryReps', 'loyalty', 'maintenance', 'clothing', 'restaurant',
    'accounting', 'fixed_assets', 'installments', 'taxIntegration', 'vat_declaration',
    'manufacturing', 'import', 'pharmacy',
    'storefront',
  ],
  '4': [
    'sales', 'catalog', 'sessions', 'cashDrawer',
    'purchases', 'inventory', 'reports',
    'hr', 'deliveryReps', 'loyalty', 'maintenance', 'clothing', 'restaurant',
    'accounting', 'fixed_assets', 'installments', 'taxIntegration', 'vat_declaration',
    'manufacturing', 'import', 'pharmacy',
    'storefront',
  ],

  // --- Band 1: General Retail Tiers ---
  tier_band1_L1: ['sales', 'catalog', 'sessions', 'cashDrawer'],
  tier_band1_L2: ['sales', 'catalog', 'sessions', 'cashDrawer', 'purchases', 'inventory', 'reports', 'loyalty', 'deliveryReps', 'installments'],
  tier_band1_L3: ['sales', 'catalog', 'sessions', 'cashDrawer', 'purchases', 'inventory', 'reports', 'loyalty', 'deliveryReps', 'installments', 'accounting', 'fixed_assets', 'hr', 'taxIntegration', 'vat_declaration'],

  // --- Band 2: Specialized Showrooms Tiers ---
  tier_band2_L1: ['sales', 'catalog', 'sessions', 'cashDrawer'],
  tier_band2_L2: ['sales', 'catalog', 'sessions', 'cashDrawer', 'purchases', 'inventory', 'reports', 'loyalty', 'deliveryReps', 'installments'],
  tier_band2_L3: ['sales', 'catalog', 'sessions', 'cashDrawer', 'purchases', 'inventory', 'reports', 'loyalty', 'deliveryReps', 'installments', 'accounting', 'fixed_assets', 'hr', 'taxIntegration', 'vat_declaration'],

  // --- Band 3: Hospitality & Restaurant Tiers ---
  tier_band3_L1: ['sales', 'catalog', 'sessions', 'cashDrawer', 'restaurant'],
  tier_band3_L2: ['sales', 'catalog', 'sessions', 'cashDrawer', 'restaurant', 'purchases', 'inventory', 'reports', 'loyalty', 'deliveryReps', 'installments'],
  tier_band3_L3: ['sales', 'catalog', 'sessions', 'cashDrawer', 'restaurant', 'purchases', 'inventory', 'reports', 'loyalty', 'deliveryReps', 'installments', 'accounting', 'fixed_assets', 'hr', 'taxIntegration', 'vat_declaration'],

  // --- Band 4: Corporate, Wholesale & Manufacturing Tiers ---
  tier_band4_L1: ['sales', 'catalog', 'sessions', 'cashDrawer'],
  tier_band4_L2: ['sales', 'catalog', 'sessions', 'cashDrawer', 'purchases', 'inventory', 'reports', 'loyalty', 'deliveryReps', 'installments'],
  tier_band4_L3: ['sales', 'catalog', 'sessions', 'cashDrawer', 'purchases', 'inventory', 'reports', 'loyalty', 'deliveryReps', 'installments', 'accounting', 'fixed_assets', 'hr', 'taxIntegration', 'vat_declaration'],

  // --- Band 5: Institutional & Maritime Freight Tiers ---
  tier_band5_L1: ['sales', 'catalog', 'sessions', 'cashDrawer', 'maritime_freight'],
  tier_band5_L2: ['sales', 'catalog', 'sessions', 'cashDrawer', 'maritime_freight', 'purchases', 'inventory', 'reports', 'loyalty', 'deliveryReps', 'installments'],
  tier_band5_L3: ['sales', 'catalog', 'sessions', 'cashDrawer', 'maritime_freight', 'purchases', 'inventory', 'reports', 'loyalty', 'deliveryReps', 'installments', 'accounting', 'fixed_assets', 'hr', 'taxIntegration', 'vat_declaration'],
};

export function DeveloperActivationPanel() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const tenant = useAuthStore((s) => s.tenant);
  const canAccessDeveloperPanel = Boolean(user);
  const [open, setOpen] = useState(false);
  
  const [masterPassword, setMasterPassword] = useState('');
  const [planId, setPlanId] = useState('');
  const [newMasterPassword, setNewMasterPassword] = useState('');
  const [confirmMasterPassword, setConfirmMasterPassword] = useState('');
  const isSuperAdmin = user?.role === 'super_admin';
  const [extraFeatures, setExtraFeatures] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (open && tenant) {
      setPlanId(tenant.planId || '');
      setExtraFeatures(tenant.extraFeatures || []);
      setError('');
      setSuccessMsg('');
      setMasterPassword('');
      setNewMasterPassword('');
      setConfirmMasterPassword('');
    }
  }, [open, tenant]);

  // Listen for Ctrl+Alt+Shift+L (Developer Tier & Plan Activation)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!canAccessDeveloperPanel) return;
      if (e.ctrlKey && e.altKey && e.shiftKey && (e.code === 'KeyL' || e.key.toLowerCase() === 'l')) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canAccessDeveloperPanel]);

  const featurePlansQuery = useQuery({
    queryKey: ['developer-feature-plans'],
    queryFn: () => http<any[]>('/api/developer/feature-plans', { skipUnauthorizedInterceptor: true }),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });
  const featurePlans = featurePlansQuery.data || [];

  const CORE_PLAN_KEYS = ['plan_basic', 'plan_pro', 'plan_ultimate', 'plan_omnichannel', 'basic', 'pro', 'ultimate', 'omnichannel', '1', '2', '3', '4'];
  const baseCorePlans = [
    { id: 'plan_basic', name: t('shared.system.developer_activation_panel.s9', "الأساسية") },
    { id: 'plan_pro', name: t('shared.system.developer_activation_panel.s10', "الاحترافية") },
    { id: 'plan_ultimate', name: t('shared.system.developer_activation_panel.s11', "المتكاملة") },
    { id: 'plan_omnichannel', name: t('shared.system.developer_activation_panel.s12', "باقة التجارة الشاملة (Omnichannel Enterprise)") },
  ];

  const resolvedCorePlans = baseCorePlans.map((cp) => {
    const match = featurePlans.find((fp: any) => String(fp.id).toLowerCase() === cp.id || String(fp.name).includes(cp.name));
    return match ? { id: String(match.id), name: match.name || cp.name } : cp;
  });

  const sectorPlans = featurePlans.filter((p: any) => {
    const pId = String(p.id).toLowerCase();
    return pId.startsWith('tier_band') || pId.startsWith('band') || (!CORE_PLAN_KEYS.includes(pId) && !resolvedCorePlans.some((rc) => rc.id === p.id));
  });

  const updateMutation = useMutation({
    mutationFn: () => http<{ ok: boolean }>('/api/developer/update-plan', { 
      method: 'POST', 
      skipUnauthorizedInterceptor: true,
      body: JSON.stringify({ tenantId: tenant?.id, masterPassword, planId, extraFeatures }) 
    }),
    onSuccess: async () => {
      setSuccessMsg('تم تفعيل الباقة والميزات بنجاح!');
      setError('');
      setMasterPassword('');
      // Force reload to fetch fresh tenant data from the backend
      setTimeout(() => window.location.reload(), 1500);
    },
    onError: (err) => {
      setError(getFriendlyApiErrorMessage(err, 'كلمة المرور غير صحيحة أو حدث خطأ'));
      setSuccessMsg('');
    },
  });

  const setMasterPasswordMutation = useMutation({
    mutationFn: () => http<{ ok: boolean }>('/api/developer/master-password', {
      method: 'POST',
      body: JSON.stringify({ newMasterPassword }),
    }),
    onSuccess: () => {
      setSuccessMsg('تم حفظ كلمة مرور المطور الجديدة بنجاح!');
      setError('');
      setNewMasterPassword('');
      setConfirmMasterPassword('');
    },
    onError: (err) => {
      setError(getFriendlyApiErrorMessage(err, 'تعذر حفظ كلمة مرور المطور'));
      setSuccessMsg('');
    },
  });

  const saveMasterPassword = () => {
    if (newMasterPassword.length < 12) {
      setError('كلمة مرور المطور يجب أن تكون 12 حرفاً على الأقل');
      setSuccessMsg('');
      return;
    }
    if (newMasterPassword !== confirmMasterPassword) {
      setError('تأكيد كلمة المرور غير مطابق');
      setSuccessMsg('');
      return;
    }
    setMasterPasswordMutation.mutate();
  };

  if (!open || !canAccessDeveloperPanel) return null;

  const selectedPlanFeatures = STANDARD_TIER_FEATURES[planId] 
    || featurePlans.find(p => String(p.id) === planId)?.features 
    || [];

  const toggleFeature = (featId: string) => {
    setExtraFeatures(prev => {
      const isBaseIncluded = selectedPlanFeatures.includes(featId);
      
      if (isBaseIncluded) {
        // If it's in the base plan, we negate it to exclude it
        if (prev.includes(`-${featId}`)) {
          return prev.filter(f => f !== `-${featId}`); // Re-include it
        } else {
          return [...prev, `-${featId}`]; // Exclude it
        }
      } else {
        // Normal extra feature logic
        if (prev.includes(featId)) {
          return prev.filter(f => f !== featId);
        } else {
          return [...prev, featId];
        }
      }
    });
  };

  return (
    <DialogShell open={open} onClose={() => setOpen(false)} width="min(760px, 95vw)" zIndex={9999} ariaLabel={t('shared.system.developer_activation_panel.s0', "إعدادات ترخيص النظام")}>
      <div style={{ padding: '24px 28px', direction: 'rtl', background: '#ffffff', borderRadius: '16px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid #f1f5f9' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em' }}>
                {t('shared.system.developer_activation_panel.s1', "إعدادات ترخيص النظام")}
              </h2>
              <span style={{
                background: '#0f172a',
                color: '#ffffff',
                fontSize: '0.72rem',
                fontWeight: 800,
                padding: '2px 8px',
                borderRadius: '5px',
                letterSpacing: '0.04em',
              }}>
                DEV CONSOLE
              </span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: '#64748b' }}>
              {t('shared.system.developer_activation_panel.s2', "التحكم في الباقات وتفعيل / تعطيل الوحدات والميزات للمستأجر الحالي")}
            </p>
            {!isDesktopOfflineApp() && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px' }}>
                <a
                  href="/saas-admin/tenants"
                  onClick={() => setOpen(false)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '5px 12px',
                    borderRadius: '6px',
                    background: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    color: '#1d4ed8',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    textDecoration: 'none',
                  }}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                  <span>{t('shared.system.developer_activation_panel.s3', "إدارة المشتركين والنسخ")}</span>
                </a>
                <a
                  href="/saas-admin/plans"
                  onClick={() => setOpen(false)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '5px 12px',
                    borderRadius: '6px',
                    background: '#fef3c7',
                    border: '1px solid #fde68a',
                    color: '#b45309',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    textDecoration: 'none',
                  }}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                  </svg>
                  <span>{t('shared.system.developer_activation_panel.s4', "باقات الاشتراكات والأسعار")}</span>
                </a>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{
              border: 'none',
              background: 'transparent',
              color: '#94a3b8',
              width: '32px',
              height: '32px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#0f172a'; e.currentTarget.style.background = '#f1f5f9'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.background = 'transparent'; }}
          ><XIcon size={15} /></button>
        </div>

        {/* Alerts */}
        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#b91c1c', padding: '10px 14px', borderRadius: '8px', marginBottom: '16px', fontSize: '0.88rem', fontWeight: 600 }}>
            {error}
          </div>
        )}
        {successMsg && (
          <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#047857', padding: '10px 14px', borderRadius: '8px', marginBottom: '16px', fontSize: '0.88rem', fontWeight: 700 }}>
            {successMsg}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* Master Password Input */}
          <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
            <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 800, color: '#0f172a', marginBottom: '6px' }}>
              {t('shared.system.developer_activation_panel.s5', "كلمة مرور المطور (Master Password)")} <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input 
              type="password" 
              className="secure-password-field"
              name="developer_master_pwd_nosave"
              autoComplete="new-password"
              autoCorrect="off" 
              autoCapitalize="off" 
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              value={masterPassword} 
              onChange={(e) => setMasterPassword(e.target.value)} 
              placeholder={t('shared.system.developer_activation_panel.s6', "أدخل كلمة المرور السرية لتأكيد التعديلات...")} 
              style={{
                width: '100%',
                padding: '9px 14px',
                borderRadius: '7px',
                border: '1px solid #cbd5e1',
                fontSize: '0.9rem',
                outline: 'none',
                background: '#ffffff',
                boxSizing: 'border-box',
                transition: 'border-color 0.15s ease',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#0f172a'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#cbd5e1'; }}
            />
          </div>

          {/* Segmented Plan Selector */}
          <div>
            <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>
              {t('shared.system.developer_activation_panel.s7', "باقة الترخيص الأساسية:")}
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              <button
                type="button"
                onClick={() => {
                  if (planId !== '') {
                    const currentActive = AVAILABLE_FEATURES
                      .map(f => f.id)
                      .filter(id => {
                        const isBase = selectedPlanFeatures.includes(id);
                        const isExcluded = extraFeatures.includes(`-${id}`);
                        const isExtra = extraFeatures.includes(id);
                        return (isBase && !isExcluded) || isExtra;
                      });
                    setExtraFeatures(currentActive);
                  }
                  setPlanId('');
                }}
                style={{
                  padding: '7px 16px',
                  borderRadius: '8px',
                  fontSize: '0.84rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: planId === '' ? '1.5px solid #0f172a' : '1px solid #e2e8f0',
                  background: planId === '' ? '#0f172a' : '#f8fafc',
                  color: planId === '' ? '#ffffff' : '#475569',
                  transition: 'all 0.15s ease',
                }}
              >
                {t('shared.system.developer_activation_panel.s8', "بدون باقة (مخصص)")}
              </button>

              {resolvedCorePlans.map((p: any) => {
                const isActive = String(p.id) === planId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setPlanId(String(p.id));
                      setExtraFeatures([]); // Clear overrides so it strictly adopts this plan's exact features!
                    }}
                    style={{
                      padding: '7px 16px',
                      borderRadius: '8px',
                      fontSize: '0.84rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      border: isActive ? '1.5px solid #0f172a' : '1px solid #e2e8f0',
                      background: isActive ? '#0f172a' : '#f8fafc',
                      color: isActive ? '#ffffff' : '#334155',
                      boxShadow: isActive ? '0 2px 8px rgba(15,23,42,0.12)' : 'none',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>

            {/* Optional Sector / Industry Template Dropdown */}
            {sectorPlans.length > 0 && (
              <div
                style={{
                  marginTop: '10px',
                  padding: '8px 14px',
                  background: '#f8fafc',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                }}
              >
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569', whiteSpace: 'nowrap' }}>
                  {t('shared.system.developer_activation_panel.sector_preset_label', "أو اختر قالباً مخصصاً حسب النشاط:")}
                </span>
                <select
                  value={sectorPlans.some((p: any) => String(p.id) === planId) ? planId : ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val) {
                      setPlanId(val);
                      setExtraFeatures([]);
                    }
                  }}
                  style={{
                    flex: 1,
                    maxWidth: '420px',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    color: '#0f172a',
                    background: '#ffffff',
                    cursor: 'pointer',
                    outline: 'none',
                  }}
                >
                  <option value="">{t('shared.system.developer_activation_panel.select_sector_placeholder', "-- اختر قالباً تخصصياً (اختياري) --")}</option>
                  {sectorPlans.map((p: any) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Features Module Switchboard */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span style={{ fontSize: '0.84rem', fontWeight: 800, color: '#0f172a' }}>
                {t('shared.system.developer_activation_panel.s13', "تخصيص الوحدات البرمجية المتاحة:")}
              </span>
              <span style={{ fontSize: '0.76rem', color: '#64748b' }}>
                {t('shared.system.developer_activation_panel.s14', "اضغط على أي وحدة للتبديل بين التفعيل والإيقاف")}
              </span>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: '8px',
              maxHeight: '42vh',
              overflowY: 'auto',
              padding: '2px',
            }}>
              {AVAILABLE_FEATURES.map((feat) => {
                const isBaseIncluded = selectedPlanFeatures.includes(feat.id);
                const isExcluded = extraFeatures.includes(`-${feat.id}`);
                const isExtraIncluded = extraFeatures.includes(feat.id);
                const isChecked = (isBaseIncluded && !isExcluded) || isExtraIncluded;
                
                return (
                  <div
                    key={feat.id}
                    onClick={() => toggleFeature(feat.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '9px 14px',
                      borderRadius: '8px',
                      border: isChecked ? '1px solid #cbd5e1' : '1px solid #f1f5f9',
                      background: isChecked ? '#ffffff' : '#fafafa',
                      boxShadow: isChecked ? '0 1px 3px rgba(0,0,0,0.03)' : 'none',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      opacity: isExcluded ? 0.6 : 1,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#94a3b8'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = isChecked ? '#cbd5e1' : '#f1f5f9'; }}
                  >
                    {/* Feature Name & Mini Badge */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.84rem', fontWeight: 700, color: isChecked ? '#0f172a' : '#64748b' }}>
                        {feat.name}
                      </span>
                      <span style={{
                        background: feat.planBadgeBg,
                        color: feat.planBadgeColor,
                        fontSize: '0.66rem',
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: '4px',
                        border: `1px solid ${feat.planBadgeColor}33`,
                      }}>
                        {feat.planName}
                      </span>
                      {isBaseIncluded && isExcluded && (
                        <span style={{ background: '#fef2f2', color: '#dc2626', fontSize: '0.66rem', fontWeight: 700, padding: '1px 5px', borderRadius: '4px', border: '1px solid #fee2e2' }}>
                          {t('shared.system.developer_activation_panel.s15', "مستثناة")}
                        </span>
                      )}
                      {!isBaseIncluded && isExtraIncluded && (
                        <span style={{ background: '#eff6ff', color: '#1d4ed8', fontSize: '0.66rem', fontWeight: 700, padding: '1px 5px', borderRadius: '4px', border: '1px solid #dbeafe' }}>
                          {t('shared.system.developer_activation_panel.s16', "إضافية")}
                        </span>
                      )}
                    </div>

                    {/* Modern iOS/macOS Style Toggle Switch */}
                    <div style={{
                      width: '32px',
                      height: '18px',
                      borderRadius: '10px',
                      background: isChecked ? '#0f172a' : '#cbd5e1',
                      position: 'relative',
                      transition: 'background 0.2s ease',
                      flexShrink: 0,
                    }}>
                      <div style={{
                        width: '14px',
                        height: '14px',
                        borderRadius: '50%',
                        background: '#ffffff',
                        position: 'absolute',
                        top: '2px',
                        right: isChecked ? '16px' : '2px',
                        transition: 'right 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Master Password Setting (super_admin only, ONE clear place) */}
        {isSuperAdmin && (
          <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '10px', border: '1px solid #e2e8f0', marginTop: '18px' }}>
            <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 800, color: '#0f172a', marginBottom: '6px' }}>
              {t('shared.system.developer_activation_panel.s20', "تعيين كلمة مرور المطور (12 حرفاً على الأقل)")}
            </label>
            <input
              type="password"
              className="secure-password-field"
              name="developer_master_new_nosave"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              value={newMasterPassword}
              onChange={(e) => setNewMasterPassword(e.target.value)}
              placeholder={t('shared.system.developer_activation_panel.s21', "كلمة المرور الجديدة...")}
              style={{
                width: '100%',
                padding: '9px 14px',
                borderRadius: '7px',
                border: '1px solid #cbd5e1',
                fontSize: '0.9rem',
                outline: 'none',
                background: '#ffffff',
                boxSizing: 'border-box',
                marginBottom: '10px',
              }}
            />
            <input
              type="password"
              className="secure-password-field"
              name="developer_master_confirm_nosave"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              value={confirmMasterPassword}
              onChange={(e) => setConfirmMasterPassword(e.target.value)}
              placeholder={t('shared.system.developer_activation_panel.s22', "تأكيد كلمة المرور الجديدة...")}
              style={{
                width: '100%',
                padding: '9px 14px',
                borderRadius: '7px',
                border: '1px solid #cbd5e1',
                fontSize: '0.9rem',
                outline: 'none',
                background: '#ffffff',
                boxSizing: 'border-box',
                marginBottom: '10px',
              }}
            />
            <button
              type="button"
              onClick={saveMasterPassword}
              disabled={setMasterPasswordMutation.isPending || !newMasterPassword || !confirmMasterPassword}
              style={{
                padding: '8px 20px',
                fontSize: '0.84rem',
                fontWeight: 700,
                borderRadius: '7px',
                border: '1px solid #0f172a',
                background: '#0f172a',
                color: '#ffffff',
                cursor: setMasterPasswordMutation.isPending || !newMasterPassword || !confirmMasterPassword ? 'not-allowed' : 'pointer',
                opacity: setMasterPasswordMutation.isPending || !newMasterPassword || !confirmMasterPassword ? 0.6 : 1,
              }}
            >
              {setMasterPasswordMutation.isPending ? t('shared.system.developer_activation_panel.s23', "جاري الحفظ...") : t('shared.system.developer_activation_panel.s24', "حفظ كلمة مرور المطور")}
            </button>
          </div>
        )}

        {/* Footer Actions */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', marginTop: '20px', paddingTop: '16px', borderTop: '1px solid #f1f5f9' }}>
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={updateMutation.isPending}
            style={{
              padding: '8px 20px',
              fontSize: '0.84rem',
              fontWeight: 600,
              borderRadius: '7px',
              border: '1px solid #e2e8f0',
              background: '#f8fafc',
              color: '#334155',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#f8fafc'; }}
          >
            {t('shared.system.developer_activation_panel.s17', "إغلاق")}
          </button>
          <button
            type="button"
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending || !masterPassword}
            style={{
              padding: '8px 24px',
              fontSize: '0.84rem',
              fontWeight: 700,
              borderRadius: '7px',
              border: '1px solid #0f172a',
              background: '#0f172a',
              color: '#ffffff',
              cursor: updateMutation.isPending || !masterPassword ? 'not-allowed' : 'pointer',
              opacity: updateMutation.isPending || !masterPassword ? 0.6 : 1,
              transition: 'all 0.15s ease',
              boxShadow: '0 2px 6px rgba(15,23,42,0.15)',
            }}
            onMouseEnter={(e) => {
              if (!updateMutation.isPending && masterPassword) {
                e.currentTarget.style.background = '#1e293b';
              }
            }}
            onMouseLeave={(e) => {
              if (!updateMutation.isPending && masterPassword) {
                e.currentTarget.style.background = '#0f172a';
              }
            }}
          >
            {updateMutation.isPending ? t('shared.system.developer_activation_panel.s18', "جاري التفعيل...") : t('shared.system.developer_activation_panel.s19', "تفعيل الترخيص")}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}
