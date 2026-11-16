import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';
import { Button } from '@/shared/ui/button';
import { DialogShell } from '@/shared/components/dialog-shell';
import { translateUiText } from '@/lib/auto-translator';
import { MarketplaceOnboardingCheck } from '@/features/storefront/api/marketplace-sync.api';
import {
  CheckCircleIcon,
  XIcon,
  CheckShieldIcon,
  SaveIcon,
} from '@/shared/components/icons/AppIcons';

interface EditOnboardingProfileModalProps {
  open: boolean;
  initialData: Partial<MarketplaceOnboardingCheck>;
  targetSection?: string;
  onClose: () => void;
  onSave: (data: Partial<MarketplaceOnboardingCheck>) => void;
  isSaving: boolean;
}

const sectionTabs = [
  { id: 'all', label: 'كافة البيانات' },
  { id: 'commercial_register', label: 'السجل التجاري والكيان' },
  { id: 'tax_card', label: 'البطاقة الضريبية' },
  { id: 'bank_iban', label: 'الحساب البنكي والآيبان' },
  { id: 'national_id', label: 'هوية المالك' },
  { id: 'business_address', label: 'العنوان والتواصل' },
  { id: 'charge_method_card', label: 'طريقة الدفع' },
];

const sectionMeta: Record<string, { title: string; subtitle: string }> = {
  all: {
    title: 'استكمال وتعديل بيانات التاجر والمنشأة (Seller Legal & Bank Profile)',
    subtitle: 'يتم استخدام هذه البيانات للتحقق الآلي من تطابق أوراقك مع منصات أمازون ونون وتوليد خطابات التفويض.',
  },
  commercial_register: {
    title: 'تحديث بيانات السجل التجاري والكيان (Commercial Register & Entity)',
    subtitle: 'تحديد نوع الكيان واسم المنشأة بالسجل التجاري الرسمي واسم المتجر التجاري.',
  },
  tax_card: {
    title: 'تحديث بيانات البطاقة الضريبية (Tax Card & VAT)',
    subtitle: 'تسجيل رقم التسجيل الضريبي المعتمد (TIN) لتفادي تعليق الحساب على منصات البيع.',
  },
  bank_iban: {
    title: 'تحديث الحساب البنكي والآيبان الدولي (Bank Account & IBAN)',
    subtitle: 'يجب تطابق اسم صاحب الحساب بالحرف مع السجل التجاري أو هوية المالك لتفادي الرفض الفوري.',
  },
  national_id: {
    title: 'تحديث هوية المالك أو المفوض بالتوقيع (National ID / Passport)',
    subtitle: 'بيانات الهوية الوطنية أو جواز السفر للممثل القانوني للحساب.',
  },
  business_address: {
    title: 'تحديث العنوان الوطني وبيانات التواصل (Proof of Address & Phone)',
    subtitle: 'العنوان التجاري المسجل ورقم الهاتف المعتمد لاستلام إشعارات التحقق.',
  },
  charge_method_card: {
    title: 'تأكيد بطاقة الدفع والخصم الدولي (Credit / Debit Card)',
    subtitle: 'بطاقة فيزا أو ماستركارد دولية معتمدة للربط كطريقة دفع (Charge Method).',
  },
};

export const EditOnboardingProfileModal: React.FC<EditOnboardingProfileModalProps> = React.memo(({
  open,
  initialData,
  targetSection,
  onClose,
  onSave,
  isSaving,
}) => {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const [formData, setFormData] = useState<Partial<MarketplaceOnboardingCheck>>({});
  const [activeSection, setActiveSection] = useState<string>('all');

  useEffect(() => {
    if (open) {
      setActiveSection(targetSection || 'all');
      let draft: any = null;
      try {
        const raw = sessionStorage.getItem('marketplace_onboarding_draft');
        if (raw) draft = JSON.parse(raw);
      } catch {}
      if (draft && typeof draft === 'object' && Object.keys(draft).length > 0) {
        setFormData({ ...(initialData || {}), ...draft });
      } else {
        setFormData({ ...(initialData || {}) });
      }
    }
  }, [open, initialData, targetSection]);

  // Debounced auto-save to sessionStorage (500ms) to guarantee instant 0ms typing performance
  useEffect(() => {
    if (!open || Object.keys(formData).length === 0) return;
    const timer = setTimeout(() => {
      try {
        sessionStorage.setItem('marketplace_onboarding_draft', JSON.stringify(formData));
      } catch {}
    }, 500);
    return () => clearTimeout(timer);
  }, [formData, open]);

  const isIndividualEntity = formData.legalEntityType === 'individual';
  const expectedOnboardingFields = isIndividualEntity
    ? [
        { key: 'tradeName', label: 'اسم المتجر التجاري' },
        { key: 'ownerName', label: 'اسم المالك أو المفوض' },
        { key: 'ownerNationalId', label: 'رقم بطاقة الرقم القومي أو الجواز' },
        { key: 'bankAccountName', label: 'اسم صاحب الحساب البنكي' },
        { key: 'bankIban', label: 'رقم الآيبان البنكي (IBAN)' },
        { key: 'bankSwift', label: 'كود السويفت (SWIFT)' },
        { key: 'bankName', label: 'اسم البنك المستلم' },
        { key: 'phone', label: 'رقم الهاتف' },
        { key: 'businessAddress', label: 'العنوان المسجل' },
        { key: 'hasCreditCard', label: 'بطاقة ائتمان / خصم دولي' },
      ]
    : [
        { key: 'companyLegalName', label: 'اسم الشركة بالسجل' },
        { key: 'tradeName', label: 'اسم المتجر التجاري' },
        { key: 'ownerName', label: 'اسم المفوض بالتوقيع' },
        { key: 'ownerNationalId', label: 'رقم بطاقة الرقم القومي أو الجواز' },
        { key: 'commercialRegister', label: 'رقم السجل التجاري' },
        { key: 'taxNumber', label: 'رقم التسجيل الضريبي (TIN)' },
        { key: 'bankAccountName', label: 'اسم صاحب الحساب البنكي' },
        { key: 'bankIban', label: 'رقم الآيبان البنكي (IBAN)' },
        { key: 'bankSwift', label: 'كود السويفت (SWIFT)' },
        { key: 'bankName', label: 'اسم البنك المستلم' },
        { key: 'phone', label: 'رقم الهاتف التجاري' },
        { key: 'businessAddress', label: 'العنوان التجاري المسجل' },
        { key: 'hasCreditCard', label: 'بطاقة ائتمان / خصم دولي' },
      ];

  const filledOnboardingFields = expectedOnboardingFields.filter((f) => {
    const val = (formData as any)[f.key];
    if (typeof val === 'boolean') return val === true;
    return Boolean(val && String(val).trim().length > 0);
  });
  const onboardingFilledCount = filledOnboardingFields.length;
  const onboardingTotalCount = expectedOnboardingFields.length;
  const onboardingPercent = Math.round((onboardingFilledCount / onboardingTotalCount) * 100);

  const currentMeta = sectionMeta[activeSection] || sectionMeta.all;

  const showCommercial = activeSection === 'all' || activeSection === 'commercial_register';
  const showTax = activeSection === 'all' || activeSection === 'tax_card';
  const showBank = activeSection === 'all' || activeSection === 'bank_iban';
  const showNationalId = activeSection === 'all' || activeSection === 'national_id';
  const showAddress = activeSection === 'all' || activeSection === 'business_address';
  const showCreditCard = activeSection === 'all' || activeSection === 'charge_method_card';

  // Section Renderers
  const renderSection1Commercial = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {activeSection === 'all' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', borderBottom: '1px solid #e2e8f0', paddingBottom: '4px' }}>
          <span style={{ width: '3px', height: '13px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
          <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#170e5e' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s0', "بيانات الكيان القانوني والسجل التجاري")}
          </span>
        </div>
      ) : null}

      {/* Legal Entity Type Toggle */}
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 12px' }}>
        <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 800, color: '#334155', marginBottom: '6px' }}>
          {t('settings.workspace_sections.settings_marketplaces_section.s1', "نوع الكيان القانوني على أمازون ونون:")}
        </label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setFormData({ ...formData, legalEntityType: 'business' })}
            style={{
              flex: 1,
              padding: '7px 10px',
              borderRadius: '6px',
              border: (!formData.legalEntityType || formData.legalEntityType === 'business') ? '2px solid #170e5e' : '1px solid #cbd5e1',
              background: (!formData.legalEntityType || formData.legalEntityType === 'business') ? '#eef2ff' : '#ffffff',
              color: (!formData.legalEntityType || formData.legalEntityType === 'business') ? '#170e5e' : '#64748b',
              fontWeight: 700,
              fontSize: '11.5px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <span>{t('settings.workspace_sections.settings_marketplaces_section.s2', "شركة / منشأة (سجل وبطاقة ضريبية)")}</span>
          </button>

          <button
            type="button"
            onClick={() => setFormData({ ...formData, legalEntityType: 'individual' })}
            style={{
              flex: 1,
              padding: '7px 10px',
              borderRadius: '6px',
              border: formData.legalEntityType === 'individual' ? '2px solid #170e5e' : '1px solid #cbd5e1',
              background: formData.legalEntityType === 'individual' ? '#eef2ff' : '#ffffff',
              color: formData.legalEntityType === 'individual' ? '#170e5e' : '#64748b',
              fontWeight: 700,
              fontSize: '11.5px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <span>{t('settings.workspace_sections.settings_marketplaces_section.s3', "بائع فردي / شخصي (بدون سجل)")}</span>
          </button>
        </div>
        <p style={{ margin: '4px 0 0', fontSize: '10.5px', color: '#64748b', lineHeight: '1.4' }}>
          {(!formData.legalEntityType || formData.legalEntityType === 'business')
            ? t('settings.workspace_sections.settings_marketplaces_section.s4', "حسابات الشركات تتطلب إلزامياً: السجل التجاري، البطاقة الضريبية، وحساباً بنكياً رسمياً باسم الشركة.")
            : t('settings.workspace_sections.settings_marketplaces_section.s5', "حسابات الأفراد لا تتطلب سجلاً تجارياً، ولكن تتطلب حتماً بطاقة رقم قومي سارية وحساباً بنكياً شخصياً.")}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s6', "اسم الشركة بالسجل")} {(!formData.legalEntityType || formData.legalEntityType === 'business') ? <span style={{ color: '#dc2626' }}>*</span> : null}
          </label>
          <input
            type="text"
            value={formData.companyLegalName || ''}
            onChange={(e) => setFormData({ ...formData, companyLegalName: e.target.value })}
            placeholder={t('settings.workspace_sections.settings_marketplaces_section.s7', "اسم الكيان القانوني المسجل")}
            style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', boxSizing: 'border-box' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s8', "اسم المتجر التجاري (Trade Name)")}
          </label>
          <input
            type="text"
            value={formData.tradeName || ''}
            onChange={(e) => setFormData({ ...formData, tradeName: e.target.value })}
            placeholder={t('settings.workspace_sections.settings_marketplaces_section.s9', "الاسم الذي يظهر للمشترين")}
            style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ gridColumn: 'span 2' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s10', "رقم السجل التجاري")} {(!formData.legalEntityType || formData.legalEntityType === 'business') ? <span style={{ color: '#dc2626' }}>*</span> : null}
          </label>
          <input
            type="text"
            value={formData.commercialRegister || ''}
            onChange={(e) => setFormData({ ...formData, commercialRegister: e.target.value })}
            placeholder={t('settings.workspace_sections.settings_marketplaces_section.s11', "مثال: 123456")}
            style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', boxSizing: 'border-box' }}
          />
        </div>
      </div>
    </div>
  );

  const renderSection2Tax = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {activeSection === 'all' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', borderBottom: '1px solid #e2e8f0', paddingBottom: '4px' }}>
          <span style={{ width: '3px', height: '13px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
          <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#170e5e' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s12', "البيانات الضريبية (Tax Card)")}
          </span>
        </div>
      ) : null}

      {formData.legalEntityType === 'individual' ? (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '6px 10px', fontSize: '11px', color: '#64748b' }}>
          {t('settings.workspace_sections.settings_marketplaces_section.s13', "ملاحظة: حسابات الأفراد غير ملزمة بالبطاقة الضريبية على منصات أمازون ونون. إذا كانت متوفرة يمكنك تسجيلها اختيارياً:")}
        </div>
      ) : null}

      <div>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
          {t('settings.workspace_sections.settings_marketplaces_section.s14', "رقم التسجيل الضريبي (TIN)")} {(!formData.legalEntityType || formData.legalEntityType === 'business') ? <span style={{ color: '#dc2626' }}>*</span> : null}
        </label>
        <input
          type="text"
          value={formData.taxNumber || ''}
          onChange={(e) => setFormData({ ...formData, taxNumber: e.target.value })}
          placeholder={t('settings.workspace_sections.settings_marketplaces_section.s15', "مثال: 100-200-300")}
          style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', boxSizing: 'border-box' }}
        />
      </div>
    </div>
  );

  const renderSection3NationalId = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {activeSection === 'all' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', borderBottom: '1px solid #e2e8f0', paddingBottom: '4px' }}>
          <span style={{ width: '3px', height: '13px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
          <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#170e5e' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s16', "هوية المالك أو المفوض بالتوقيع")}
          </span>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s17', "اسم المالك أو المفوض بالتوقيع")} <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <input
            type="text"
            value={formData.ownerName || ''}
            onChange={(e) => setFormData({ ...formData, ownerName: e.target.value })}
            placeholder={t('settings.workspace_sections.settings_marketplaces_section.s18', "الاسم الثلاثي أو الرباعي للمفوض")}
            style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', boxSizing: 'border-box' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s19', "رقم بطاقة الرقم القومي أو جواز السفر")} <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <input
            type="text"
            value={formData.ownerNationalId || ''}
            onChange={(e) => setFormData({ ...formData, ownerNationalId: e.target.value })}
            placeholder={t('settings.workspace_sections.settings_marketplaces_section.s20', "14 رقم للبطاقة أو رقم الجواز")}
            style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', direction: 'ltr', boxSizing: 'border-box' }}
          />
        </div>
      </div>
    </div>
  );

  const renderSection4Bank = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {activeSection === 'all' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', borderBottom: '1px solid #e2e8f0', paddingBottom: '4px' }}>
          <span style={{ width: '3px', height: '13px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
          <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#170e5e' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s21', "الحساب البنكي الرسمي ورقم الآيبان (IBAN)")}
          </span>
        </div>
      ) : null}

      <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '6px 10px', fontSize: '11px', color: '#475569', lineHeight: '1.45' }}>
        {t('settings.workspace_sections.settings_marketplaces_section.s22', "تنبيه التحقق البنكي: يجب أن يتطابق")} <strong>{t('settings.workspace_sections.settings_marketplaces_section.s23', "اسم صاحب الحساب")}</strong> {t('settings.workspace_sections.settings_marketplaces_section.s24', "بالحرف مع اسم الشركة المسجل أو اسم الهوية لتفادي الرفض التلقائي.")}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s25', "اسم صاحب الحساب البنكي")} <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <input
            type="text"
            value={formData.bankAccountName || ''}
            onChange={(e) => setFormData({ ...formData, bankAccountName: e.target.value })}
            placeholder={t('settings.workspace_sections.settings_marketplaces_section.s26', "يجب تطابقه بالحرف مع اسم الشركة أو الفرد")}
            style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', boxSizing: 'border-box' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s27', "اسم البنك المستلم")} <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <input
            type="text"
            value={formData.bankName || ''}
            onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
            placeholder={t('settings.workspace_sections.settings_marketplaces_section.s28', "مثال: البنك الأهلي المصري / CIB")}
            style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', boxSizing: 'border-box' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s29', "رقم الآيبان البنكي الدولي (IBAN)")} <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <input
            type="text"
            value={formData.bankIban || ''}
            onChange={(e) => setFormData({ ...formData, bankIban: e.target.value })}
            placeholder="EG123456789012345678901234567"
            style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', direction: 'ltr', boxSizing: 'border-box' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s30', "كود السويفت (SWIFT / BIC)")} <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <input
            type="text"
            value={formData.bankSwift || ''}
            onChange={(e) => setFormData({ ...formData, bankSwift: e.target.value })}
            placeholder={t('settings.workspace_sections.settings_marketplaces_section.s31', "مثال: NBEGEGCX")}
            style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', direction: 'ltr', boxSizing: 'border-box' }}
          />
        </div>
      </div>
    </div>
  );

  const renderSection5Address = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {activeSection === 'all' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', borderBottom: '1px solid #e2e8f0', paddingBottom: '4px' }}>
          <span style={{ width: '3px', height: '13px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
          <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#170e5e' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s32', "العنوان وبيانات التواصل")}
          </span>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s33', "رقم الهاتف التجاري")} <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <input
            type="text"
            value={formData.phone || ''}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            placeholder="01012345678"
            style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', direction: 'ltr', boxSizing: 'border-box' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s34', "العنوان التجاري المسجل")} <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <input
            type="text"
            value={formData.businessAddress || ''}
            onChange={(e) => setFormData({ ...formData, businessAddress: e.target.value })}
            placeholder={t('settings.workspace_sections.settings_marketplaces_section.s35', "اسم الشارع، رقم المبنى، المدينة")}
            style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', boxSizing: 'border-box' }}
          />
        </div>
      </div>
    </div>
  );

  const renderSection6CreditCard = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {activeSection === 'all' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', borderBottom: '1px solid #e2e8f0', paddingBottom: '4px' }}>
          <span style={{ width: '3px', height: '13px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
          <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#170e5e' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s36', "بطاقة الدفع والخصم الدولي (Charge Method)")}
          </span>
        </div>
      ) : null}

      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 700, color: '#92400e' }}>
          <input
            type="checkbox"
            checked={Boolean(formData.hasCreditCard)}
            onChange={(e) => setFormData({ ...formData, hasCreditCard: e.target.checked })}
            style={{ width: '16px', height: '16px', accentColor: '#170e5e', cursor: 'pointer' }}
          />
          <span>{t('settings.workspace_sections.settings_marketplaces_section.s37', "أؤكد توفر بطاقة ائتمان / خصم دولي (Visa أو Mastercard) صالحة للشراء والسحب الدولي *")}</span>
        </label>
        <p style={{ margin: 0, fontSize: '11px', color: '#b45309', lineHeight: '1.45' }}>
          {t('settings.workspace_sections.settings_marketplaces_section.s38', "تنبيه إلزامي لأمازون: لا يمكن إنهاء إنشاء الحساب أو تفعيله بدون إدخال بطاقة فيزا أو ماستركارد دولية لسداد رسوم التحقق (ولا يقبل كارت ميزة المحلي).")}
        </p>
      </div>
    </div>
  );

  const isAll = activeSection === 'all';
  const modalWidth = isAll ? 'min(960px, 95vw)' : 'min(620px, 95vw)';

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      width={modalWidth}
      ariaLabel={isEn ? (translateUiText(currentMeta.title) || currentMeta.title) : currentMeta.title}
    >
      <div
        dir="rtl"
        style={{
          background: '#ffffff',
          padding: '20px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          maxHeight: 'calc(92vh - 20px)',
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
              {currentMeta.title}
            </h4>
            <p style={{ margin: '2px 0 0', fontSize: '11.5px', color: '#64748b' }}>
              {isEn ? (translateUiText(currentMeta.subtitle) || currentMeta.subtitle) : currentMeta.subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center', padding: '4px' }}
          >
            <XIcon size={18} />
          </button>
        </div>

        {/* Section Navigation Tabs (Pills) */}
        <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap' }}>
          {sectionTabs.map((sec) => {
            const isSelected = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => setActiveSection(sec.id)}
                style={{
                  padding: '4px 11px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  borderRadius: '6px',
                  border: isSelected ? '1px solid #170e5e' : '1px solid #e2e8f0',
                  background: isSelected ? '#170e5e' : '#f8fafc',
                  color: isSelected ? '#ffffff' : '#475569',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {isEn ? (translateUiText(sec.label) || sec.label) : sec.label}
              </button>
            );
          })}
        </div>

        {/* Banner when viewing All */}
        {isAll ? (
          <div
            style={{
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '8px',
              padding: '8px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
              <div style={{ color: '#16a34a', flexShrink: 0 }}>
                <CheckShieldIcon size={18} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '12px', fontWeight: 800, color: '#166534' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s39', "ميزة الحفظ المرحلي: احفظ ما يتوفر معك الآن واستكمل الباقي لاحقاً")}
                  </span>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      background: onboardingFilledCount > 0 ? '#dcfce7' : '#f1f5f9',
                      color: onboardingFilledCount > 0 ? '#15803d' : '#64748b',
                      padding: '2px 8px',
                      borderRadius: '6px',
                      border: '1px solid ' + (onboardingFilledCount > 0 ? '#86efac' : '#cbd5e1'),
                    }}
                  >
                    {t('settings.workspace_sections.settings_marketplaces_section.s40', "تم تسجيل")} {onboardingFilledCount} {t('settings.workspace_sections.settings_marketplaces_section.s41', "من")} {onboardingTotalCount} ({onboardingPercent}%)
                  </span>
                </div>
                <div style={{ width: '100%', height: '4px', background: '#dcfce7', borderRadius: '2px', marginTop: '5px', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${onboardingPercent}%`,
                      height: '100%',
                      background: onboardingPercent >= 100 ? '#16a34a' : '#22c55e',
                      borderRadius: '2px',
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Main Sections Body */}
        {isAll ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
              gap: '20px',
              alignItems: 'start',
            }}
          >
            {/* Column 1: Legal Entity, Tax, Owner ID */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {renderSection1Commercial()}
              {renderSection2Tax()}
              {renderSection3NationalId()}
            </div>

            {/* Column 2: Bank Account, Address, Charge Method */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {renderSection4Bank()}
              {renderSection5Address()}
              {renderSection6CreditCard()}
            </div>
          </div>
        ) : (
          <div
            style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              minHeight: '180px',
              justifyContent: 'center',
            }}
          >
            {showCommercial && renderSection1Commercial()}
            {showTax && renderSection2Tax()}
            {showNationalId && renderSection3NationalId()}
            {showBank && renderSection4Bank()}
            {showAddress && renderSection5Address()}
            {showCreditCard && renderSection6CreditCard()}
          </div>
        )}

        {/* Footer Actions */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px',
            marginTop: '4px',
            paddingTop: '10px',
            borderTop: '1px solid #e2e8f0',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', color: '#64748b' }}>
            <span
              style={{
                display: 'inline-block',
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: onboardingFilledCount > 0 ? '#22c55e' : '#94a3b8',
              }}
            />
            <span>{onboardingFilledCount > 0 ? `المسودة تحتوي على ${onboardingFilledCount} بيان جاهز للحفظ` : t('settings.workspace_sections.settings_marketplaces_section.s42', "لم يتم إدخال بيانات بعد")}</span>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Button
              variant="secondary"
              onClick={onClose}
              disabled={isSaving}
              style={{ padding: '6px 14px', fontSize: '12px' }}
            >
              {t('settings.workspace_sections.settings_marketplaces_section.s43', "إلغاء")}
            </Button>

            <Button
              variant="secondary"
              onClick={() => onSave(formData)}
              disabled={isSaving || onboardingFilledCount === 0}
              style={{
                background: '#f8fafc',
                border: '1px solid #cbd5e1',
                color: '#0f172a',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontWeight: 700,
                padding: '6px 14px',
                fontSize: '12px',
              }}
              title={t('settings.workspace_sections.settings_marketplaces_section.s44', "حفظ ما تم إدخاله حتى الآن وإغلاق النافذة مع إمكانية المتابعة في أي وقت")}
            >
              <SaveIcon size={15} />
              <span>{t('settings.workspace_sections.settings_marketplaces_section.s45', "حفظ ومتابعة لاحقاً")}</span>
            </Button>

            <Button
              variant="primary"
              onClick={() => onSave(formData)}
              disabled={isSaving}
              style={{
                background: '#170e5e',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontWeight: 700,
                padding: '6px 16px',
                fontSize: '12px',
              }}
            >
              <CheckCircleIcon size={15} />
              <span>{isSaving ? t('settings.workspace_sections.settings_marketplaces_section.s46', "جاري الحفظ...") : (isAll ? t('settings.workspace_sections.settings_marketplaces_section.s47', "حفظ وتحديث مؤشر الجاهزية") : t('settings.workspace_sections.settings_marketplaces_section.s48', "حفظ هذا القسم وتحديث الجاهزية"))}</span>
            </Button>
          </div>
        </div>
      </div>
    </DialogShell>
  );
});
