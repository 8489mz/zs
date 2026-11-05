import { useTranslation } from 'react-i18next';
import { useState, useMemo, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';
import { useSystemCurrency } from '@/shared/hooks/use-system-currency';
import { SUPPORTED_CURRENCIES } from '@/lib/currencies';
import { customersApi } from '@/shared/api/customers.api';
import { userDirectoryApi } from '@/shared/api/user-directory';
import { crmApi, type CreateDealPayload, type DealStage, type DealPriority } from '../api/crm.api';
import { STAGES, PRIORITIES } from './CrmConstants';

export interface CrmDealCreateModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (msg: string) => void;
}

export function CrmDealCreateModal({ open, onClose, onSuccess }: CrmDealCreateModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const systemCurrency = useSystemCurrency();

  // INV-CRM-OPPORTUNITY-FORM-RESET: depend on the stable currencyCode
  // string, never on the hook's return object -- the hook used to return a
  // fresh object on every render, so this memo (and the reset effect below)
  // re-ran on every render and wiped the form while the user was typing.
  const initialDealForm: CreateDealPayload = useMemo(() => ({
    title: '',
    expectedAmount: 0,
    currency: systemCurrency.currencyCode || 'EGP',
    probability: 20,
    stage: 'new',
    expectedCloseDate: '',
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    companyName: '',
    source: 'direct',
    priority: 'medium',
    assignedUserId: null,
    customerId: null,
    lostReason: '',
    notes: '',
  }), [systemCurrency.currencyCode]);

  const [dealForm, setDealForm] = useState<CreateDealPayload>(initialDealForm);
  const [selectedCustomerValue, setSelectedCustomerValue] = useState<string>('');

  // Reset form when modal opens -- only on the closed -> open transition.
  // Resetting on every render (the old effect ran whenever initialDealForm
  // changed identity) discarded whatever the user had typed.
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setDealForm(initialDealForm);
      setSelectedCustomerValue('');
    }
    prevOpenRef.current = open;
  }, [open, initialDealForm]);

  // Load registered customers for selection
  const { data: customers = [], isLoading: isLoadingCustomers } = useQuery({
    queryKey: ['customers-list-for-crm'],
    queryFn: customersApi.list,
    enabled: open,
    staleTime: 60_000,
  });

  // Load system users for assigned sales rep
  const { data: users = [], isLoading: isLoadingUsers } = useQuery({
    queryKey: ['users-list-for-crm'],
    queryFn: userDirectoryApi.users,
    enabled: open,
    staleTime: 60_000,
  });

  // Customer dropdown options
  const customerOptions = useMemo(() => [
    { value: '', label: 'عميل محتمل جديد / غير مسجل (Manual Lead)' },
    ...customers.map((c: any) => ({
      value: String(c.id),
      label: `${c.name}${c.companyName ? ` — ${c.companyName}` : ''}`,
      hint: c.phone || c.email || undefined,
    })),
  ], [customers]);

  // Sales rep options
  const userOptions = useMemo(() => [
    { value: '', label: 'غير محدد (متاح للمتابعة العامة)' },
    ...users.map((u: any) => ({
      value: String(u.id),
      label: u.displayName || u.username,
      hint: u.role ? `[${u.role}]` : undefined,
    })),
  ], [users]);

  // Currency options
  const currencyOptions = useMemo(() => SUPPORTED_CURRENCIES.map((c) => ({
    value: c.code,
    label: `${c.code} (${c.symbol})`,
    hint: c.label,
  })), []);

  // Stage options
  const stageOptions = useMemo(() => STAGES.map((s) => ({
    value: s.key,
    label: `${t(`crm.stage.${s.key}`, s.label)} (${s.defaultProbability}%)`,
  })), [t]);

  // Priority options
  const priorityOptions = useMemo(() => Object.entries(PRIORITIES).map(([key, val]) => ({
    value: key,
    label: t(`crm.priority.${key}`, val.label),
  })), [t]);

  // Lead Source options
  const sourceOptions = useMemo(() => [
    { value: 'direct', label: 'مباشر / زيارة ميدانية' },
    { value: 'referral', label: 'ترشيح من عميل سابق' },
    { value: 'phone', label: 'اتصال هاتفي وارد' },
    { value: 'social_media', label: 'وسائل التواصل الاجتماعي' },
    { value: 'website', label: 'الموقع الإلكتروني' },
    { value: 'tender', label: 'مناقصة / مقايسة معتمدة' },
    { value: 'exhibition', label: 'معرض أو مؤتمر تجاري' },
  ], []);

  // Handle customer selection
  const handleCustomerSelect = (val: string) => {
    setSelectedCustomerValue(val);
    if (!val) {
      setDealForm((prev) => ({
        ...prev,
        customerId: null,
      }));
      return;
    }

    const found = customers.find((c: any) => String(c.id) === String(val)) as any;
    if (found) {
      setDealForm((prev) => ({
        ...prev,
        customerId: Number(found.id),
        contactName: found.name || prev.contactName,
        companyName: found.companyName || found.name || prev.companyName,
        contactPhone: found.phone || prev.contactPhone,
        contactEmail: found.email || prev.contactEmail,
      }));
    }
  };

  const createDealMutation = useMutation({
    mutationFn: crmApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-deals'] });
      queryClient.invalidateQueries({ queryKey: ['crm-summary'] });
      setDealForm(initialDealForm);
      onClose();
      toast.success('تمت إضافة الفرصة البيعية بنجاح.');
      onSuccess?.('تمت إضافة الفرصة البيعية بنجاح.');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'فشل إنشاء الفرصة البيعية.');
    },
  });

  const handleSubmit = () => {
    if (!dealForm.title.trim()) {
      toast.warning('يرجى إدخال عنوان الفرصة البيعية.');
      return;
    }
    createDealMutation.mutate(dealForm);
  };

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={t('crm.crm_deal_create_modal.s0', "إضافة فرصة بيعية جديدة (New Opportunity)")}
      subtitle={t('crm.crm_deal_create_modal.s1', "تسجيل بيانات الفرصة، تحديد القيمة المالية، وربطها بالعميل ومسؤول المتابعة")}
      width="min(880px, 95vw)"
      minHeight="auto"
      footerActions={(
        <StandardDialogFooter
          onCancel={onClose}
          onSubmit={handleSubmit}
          isSubmitting={createDealMutation.isPending}
          submitText={t('crm.crm_deal_create_modal.s2', "حفظ الفرصة البيعية")}
          cancelText={t('crm.crm_deal_create_modal.s3', "إلغاء")}
        />
      )}
    >
      <style>{`
        .enterprise-compact-modal .field {
          margin-bottom: 0 !important;
          gap: 5px !important;
        }
        .enterprise-compact-modal .field span {
          font-size: 0.78rem !important;
          font-weight: 600 !important;
          color: #475569 !important;
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
        }
        .enterprise-compact-modal input,
        .enterprise-compact-modal textarea {
          height: 35px !important;
          font-size: 0.8125rem !important;
          border-radius: 6px !important;
          padding: 0 12px !important;
          border: 1px solid #cbd5e1 !important;
          background: #ffffff !important;
          box-sizing: border-box !important;
          outline: none !important;
          width: 100% !important;
          transition: border-color 0.15s, box-shadow 0.15s !important;
        }
        .enterprise-compact-modal textarea {
          height: auto !important;
          min-height: 60px !important;
          padding: 8px 12px !important;
          resize: vertical !important;
          line-height: 1.5 !important;
          font-family: inherit !important;
        }
        .enterprise-compact-modal input:focus,
        .enterprise-compact-modal textarea:focus {
          border-color: #170e5e !important;
          box-shadow: 0 0 0 2px rgba(23, 14, 94, 0.1) !important;
        }
        .enterprise-compact-modal .custom-select-trigger {
          min-height: 35px !important;
          height: 35px !important;
          font-size: 0.8125rem !important;
          border-radius: 6px !important;
          border: 1px solid #cbd5e1 !important;
          padding: 0 10px !important;
        }
      `}</style>

      <div className="enterprise-compact-modal" style={{ display: 'flex', flexDirection: 'column', gap: '11px' }} dir="rtl">
        
        {/* 1. بيانات الفرصة والعميل */}
        <div style={{ background: '#fbfcfd', padding: '11px 14px', borderRadius: '10px', border: '1px solid #edf2f7' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '8px', color: '#170e5e', fontWeight: 700, fontSize: '0.85rem' }}>
            <AppIcons.Layers size={15} />
            <span>{t('crm.crm_deal_create_modal.s4', "1. بيانات الفرصة والعميل (Opportunity & Client Information)")}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.6fr', gap: '10px', marginBottom: '10px' }}>
            <Field label={t('crm.crm_deal_create_modal.s5', "عنوان الفرصة البيعية *")}>
              <input
                type="text"
                placeholder={t('crm.crm_deal_create_modal.s6', "مثال: توريد شحنة معدات لمستشفى الشفاء أو مقايسة برج النرجس")}
                value={dealForm.title}
                onChange={(e) => setDealForm({ ...dealForm, title: e.target.value })}
              />
            </Field>

            <Field label={t('crm.crm_deal_create_modal.s7', "العميل المرتبط (مسجل مسبقاً أو اتركه لعميل جديد)")}>
              <CustomSelect
                value={selectedCustomerValue}
                onChange={handleCustomerSelect}
                options={customerOptions}
                placeholder={isLoadingCustomers ? t('crm.crm_deal_create_modal.s8', "جاري تحميل العملاء...") : t('crm.crm_deal_create_modal.s9', "اختر عميلاً مسجلاً أو أدخل عميلاً جديداً...")}
              />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.3fr 1.1fr 1.5fr', gap: '10px' }}>
            <Field label={t('crm.crm_deal_create_modal.s10', "اسم جهة الاتصال")}>
              <input
                type="text"
                placeholder={t('crm.crm_deal_create_modal.s11', "مثال: د. طارق سالم")}
                value={dealForm.contactName || ''}
                onChange={(e) => setDealForm({ ...dealForm, contactName: e.target.value })}
              />
            </Field>

            <Field label={t('crm.crm_deal_create_modal.s12', "اسم الشركة / المؤسسة")}>
              <input
                type="text"
                placeholder={t('crm.crm_deal_create_modal.s13', "مثال: مجمع عيادات النور")}
                value={dealForm.companyName || ''}
                onChange={(e) => setDealForm({ ...dealForm, companyName: e.target.value })}
              />
            </Field>

            <Field label={t('crm.crm_deal_create_modal.s14', "رقم الهاتف والتواصل")}>
              <input
                type="text"
                placeholder="01xxxxxxxxx / +20..."
                value={dealForm.contactPhone || ''}
                onChange={(e) => setDealForm({ ...dealForm, contactPhone: e.target.value })}
              />
            </Field>

            <Field label={t('crm.crm_deal_create_modal.s15', "البريد الإلكتروني")}>
              <input
                type="email"
                placeholder="client@company.com"
                value={dealForm.contactEmail || ''}
                onChange={(e) => setDealForm({ ...dealForm, contactEmail: e.target.value })}
              />
            </Field>
          </div>
        </div>

        {/* 2. التقييم المالي ومرحلة الصفقة */}
        <div style={{ background: '#fbfcfd', padding: '11px 14px', borderRadius: '10px', border: '1px solid #edf2f7' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '8px', color: '#170e5e', fontWeight: 700, fontSize: '0.85rem' }}>
            <AppIcons.TrendingUp size={15} />
            <span>{t('crm.crm_deal_create_modal.s16', "2. التقييم المالي ومسار الصفقة (Financial Evaluation & Pipeline Stage)")}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1.3fr 1fr', gap: '10px' }}>
            <Field label={t('crm.crm_deal_create_modal.s17', "القيمة المالية المتوقعة")}>
              <input
                type="number"
                placeholder="0.00"
                value={dealForm.expectedAmount || ''}
                onChange={(e) => setDealForm({ ...dealForm, expectedAmount: Number(e.target.value) })}
                style={{ fontWeight: 700, color: '#170e5e' }}
              />
            </Field>

            <Field label={t('crm.crm_deal_create_modal.s18', "عملة الصفقة")}>
              <CustomSelect
                value={dealForm.currency || systemCurrency.currencyCode || 'EGP'}
                onChange={(val) => setDealForm({ ...dealForm, currency: val })}
                options={currencyOptions}
                placeholder={t('crm.crm_deal_create_modal.s19', "اختر العملة...")}
              />
            </Field>

            <Field label={t('crm.crm_deal_create_modal.s20', "المرحلة في خط الصفقات")}>
              <CustomSelect
                value={dealForm.stage || 'new'}
                onChange={(val) => {
                  const st = val as DealStage;
                  const defProb = STAGES.find((s) => s.key === st)?.defaultProbability ?? 20;
                  setDealForm({ ...dealForm, stage: st, probability: defProb });
                }}
                options={stageOptions}
                placeholder={t('crm.crm_deal_create_modal.s21', "اختر المرحلة...")}
              />
            </Field>

            <Field label={t('crm.crm_deal_create_modal.s22', "احتمالية الفوز (%)")}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={dealForm.probability ?? 20}
                  onChange={(e) => setDealForm({ ...dealForm, probability: Math.min(100, Math.max(0, Number(e.target.value))) })}
                  style={{ fontWeight: 700 }}
                />
                <span style={{
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  height: '35px',
                  lineHeight: '35px',
                  padding: '0 8px',
                  borderRadius: '6px',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  color: '#475569',
                  boxSizing: 'border-box',
                }}>
                  %
                </span>
              </div>
            </Field>
          </div>
        </div>

        {/* 3. التكليف والجدول الزمني والملاحظات */}
        <div style={{ background: '#fbfcfd', padding: '11px 14px', borderRadius: '10px', border: '1px solid #edf2f7' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '8px', color: '#170e5e', fontWeight: 700, fontSize: '0.85rem' }}>
            <AppIcons.Calendar size={15} />
            <span>{t('crm.crm_deal_create_modal.s23', "3. التكليف والجدول الزمني والمتابعة (Assignment, Timeline & Notes)")}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr 1.1fr', gap: '10px', marginBottom: '10px' }}>
            <Field label={t('crm.crm_deal_create_modal.s24', "مسؤول المتابعة (مندوب المبيعات)")}>
              <CustomSelect
                value={dealForm.assignedUserId ? String(dealForm.assignedUserId) : ''}
                onChange={(val) => setDealForm({ ...dealForm, assignedUserId: val ? Number(val) : null })}
                options={userOptions}
                placeholder={isLoadingUsers ? t('crm.crm_deal_create_modal.s25', "جاري التحميل...") : t('crm.crm_deal_create_modal.s26', "اختر مسؤول المتابعة...")}
              />
            </Field>

            <Field label={t('crm.crm_deal_create_modal.s27', "تاريخ الإغلاق المتوقع")}>
              <input
                type="date"
                value={dealForm.expectedCloseDate ?? ''}
                onChange={(e) => setDealForm({ ...dealForm, expectedCloseDate: e.target.value })}
              />
            </Field>

            <Field label={t('crm.crm_deal_create_modal.s28', "مستوى الأولوية")}>
              <CustomSelect
                value={dealForm.priority || 'medium'}
                onChange={(val) => setDealForm({ ...dealForm, priority: val as DealPriority })}
                options={priorityOptions}
                placeholder={t('crm.crm_deal_create_modal.s29', "اختر الأولوية...")}
              />
            </Field>

            <Field label={t('crm.crm_deal_create_modal.s30', "مصدر الفرصة (Lead Source)")}>
              <CustomSelect
                value={dealForm.source || 'direct'}
                onChange={(val) => setDealForm({ ...dealForm, source: val })}
                options={sourceOptions}
                placeholder={t('crm.crm_deal_create_modal.s31', "اختر المصدر...")}
              />
            </Field>
          </div>

          {dealForm.stage === 'lost' && (
            <div style={{ marginBottom: '10px' }}>
              <Field label={t('crm.crm_deal_create_modal.s32', "سبب الخسارة (Lost Reason) *")}>
                <input
                  type="text"
                  placeholder={t('crm.crm_deal_create_modal.s33', "مثال: السعر أعلى من المنافس، تأجيل أو إلغاء المشروع من العميل...")}
                  value={dealForm.lostReason || ''}
                  onChange={(e) => setDealForm({ ...dealForm, lostReason: e.target.value })}
                  style={{ border: '1px solid #f87171 !important', background: '#fef2f2 !important' }}
                />
              </Field>
            </div>
          )}

          <div>
            <Field label={t('crm.crm_deal_create_modal.s34', "ملاحظات واشتراطات خاصة بالمتابعة")}>
              <textarea
                rows={3}
                placeholder={t('crm.crm_deal_create_modal.s35', "سجل أي اشتراطات خاصة، ملخص الاجتماع الأولي، أو متطلبات فنية...")}
                value={dealForm.notes || ''}
                onChange={(e) => setDealForm({ ...dealForm, notes: e.target.value })}
              />
            </Field>
          </div>
        </div>

      </div>
    </StandardDialog>
  );
}
