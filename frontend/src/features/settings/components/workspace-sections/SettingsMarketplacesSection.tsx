import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { SubmitButton } from '@/shared/components/submit-button';
import { DialogShell } from '@/shared/components/dialog-shell';
import { toast } from '@/shared/components/system-alert';
import { formatDateTimeArabic } from '@/lib/format';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { translateUiText } from '@/lib/auto-translator';
import {
  marketplaceSyncApi,
  AmazonConfig,
  NoonConfig,
  JumiaConfig,
  TrendyolConfig,
  SupportedMarketplace,
  MarketplaceSkuMapping,
  MarketplaceFeeCalculationInput,
  MarketplaceFeeCalculationResult,
  ListingStudioResult,
  BulkMappingImportRow,
  BulkMappingImportResult,
  MarketplaceSettlementInput,
  FbaInboundItem,
  FbaInboundShipment,
  FbaDiscrepancyClaimReport,
  MarketplaceOnboardingCheck,
  GtinExemptionApplication,
} from '@/features/storefront/api/marketplace-sync.api';
import { productsApi } from '@/features/products';
import {
  CheckIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
  PackageIcon,
  ShoppingCartIcon,
  RefreshCwIcon,
  ReceiptIcon,
  LinkIcon,
  XIcon,
  PlusIcon,
  CalculatorIcon,
  FileTextIcon,
  CopyIcon,
  DownloadIcon,
  GlobeIcon,
  LayersIcon,
  UploadIcon,
  SlidersIcon,
  TruckIcon,
  PrinterIcon,
  CheckShieldIcon,
  CameraIcon,
  SaveIcon,
} from '@/shared/components/icons/AppIcons';

type TabKey = 'onboarding' | 'calculator' | 'studio' | 'inventory' | 'inbound' | 'settlements' | 'orders' | 'analytics' | 'amazon' | 'noon' | 'jumia' | 'trendyol';

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

const EditOnboardingProfileModal: React.FC<EditOnboardingProfileModalProps> = React.memo(({
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

export const SettingsMarketplacesSection: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabKey>('onboarding');

  // Config States
  const [amazonCfg, setAmazonCfg] = useState<AmazonConfig>({
    enabled: false,
    sellerId: '',
    refreshToken: '',
    clientId: '',
    clientSecret: '',
    marketplaceId: 'eg',
    autoSyncStock: true,
    autoPullOrders: true,
    fulfillmentType: 'fbm',
  });

  const [noonCfg, setNoonCfg] = useState<NoonConfig>({
    enabled: false,
    merchantId: '',
    apiKey: '',
    appSecret: '',
    marketplace: 'eg',
    autoSyncStock: true,
    autoPullOrders: true,
    fulfillmentType: 'direct',
  });

  const [jumiaCfg, setJumiaCfg] = useState<JumiaConfig>({
    enabled: false,
    sellerEmail: '',
    apiKey: '',
    marketplace: 'eg',
    autoSyncStock: true,
    autoPullOrders: true,
    fulfillmentType: 'dropshipping',
  });

  const [trendyolCfg, setTrendyolCfg] = useState<TrendyolConfig>({
    enabled: false,
    supplierId: '',
    apiKey: '',
    apiSecret: '',
    autoSyncStock: true,
    autoPullOrders: true,
    fulfillmentType: 'merchant_cargo',
  });

  const [testResult, setTestResult] = useState<{ success: boolean; message: string; pingMs?: number; accountName?: string } | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [simulatedOrderInfo, setSimulatedOrderInfo] = useState<string | null>(null);
  const [selectedInventoryPlatform, setSelectedInventoryPlatform] = useState<'all' | SupportedMarketplace>('all');

  // Competitor Price Modal
  const [editPriceModal, setEditPriceModal] = useState<MarketplaceSkuMapping | null>(null);
  const [editCompetitorPrice, setEditCompetitorPrice] = useState<string>('');
  const [editBuyBoxPrice, setEditBuyBoxPrice] = useState<string>('');

  // New mapping form
  const [newMapping, setNewMapping] = useState<{
    productId: number;
    marketplace: SupportedMarketplace;
    marketplaceSku: string;
    marketplaceTitle: string;
    customPrice: string;
    competitorPrice: string;
    buyBoxPrice: string;
    syncStock: boolean;
  }>({
    productId: 0,
    marketplace: 'amazon',
    marketplaceSku: '',
    marketplaceTitle: '',
    customPrice: '',
    competitorPrice: '',
    buyBoxPrice: '',
    syncStock: true,
  });

  // Calculator Form State (حاسبة وهوامش الأرباح والرسوم)
  const [calcInput, setCalcInput] = useState<MarketplaceFeeCalculationInput>({
    marketplace: 'amazon',
    region: 'eg',
    category: 'electronics',
    fulfillmentType: 'fba',
    weightTier: 'standard',
    sellingPrice: 350,
    itemCost: 200,
    inboundShippingCost: 10,
    packagingCost: 5,
  });
  const [calcResult, setCalcResult] = useState<MarketplaceFeeCalculationResult | null>(null);

  // Listing Studio Form State ("ستوديو / ليو")
  const [studioProductId, setStudioProductId] = useState<number>(0);
  const [studioResult, setStudioResult] = useState<ListingStudioResult | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Settlement Reconciliation Form State
  const [showReconcileModal, setShowReconcileModal] = useState<boolean>(false);
  const [selectedSettlementPlatform, setSelectedSettlementPlatform] = useState<'all' | SupportedMarketplace>('all');
  const [settlementForm, setSettlementForm] = useState<MarketplaceSettlementInput>({
    marketplace: 'amazon',
    settlementId: '',
    periodStart: new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0],
    periodEnd: new Date().toISOString().split('T')[0],
    // INV-FE3-FRONTEND-BOOK-DIGITS: was hardcoded 'EGP' with no selector
    // anywhere; the backend requires the tenant's base currency, so the
    // form now defaults to it (see settlementBookDigits below).
    currency: getGlobalSystemCurrency(),
    grossSales: 0,
    referralFees: 0,
    fulfillmentFees: 0,
    refunds: 0,
    storageOrOtherFees: 0,
    netPayout: 0,
    bankAccountId: undefined,
    referralFeesAccountId: undefined,
    fulfillmentFeesAccountId: undefined,
    salesAccountId: undefined,
    notes: '',
  });

  // INV-FE3-FRONTEND-BOOK-DIGITS: the backend (reconcileSettlement)
  // REQUIRES input.currency === the tenant's base currency and checks
  // precision at book digits (INV-MARKETPLACE-SETTLEMENT-BOOK-DIGITS).
  // Every computed amount in this form rounds at the form currency's
  // book digits, so the rounding always matches what is sent.
  const settlementBookDigits = currencyMoneyDigits(settlementForm.currency || getGlobalSystemCurrency());

  // Bulk Import State
  const [showBulkImportModal, setShowBulkImportModal] = useState<boolean>(false);
  // bulkImportMarketplace removed (unused)
  const [bulkImportText, setBulkImportText] = useState<string>('');
  const [bulkImportResult, setBulkImportResult] = useState<BulkMappingImportResult | null>(null);

  // Inbound Shipments State (FBA / FBN)
  const [showInboundModal, setShowInboundModal] = useState<boolean>(false);
  const [inboundForm, setInboundForm] = useState<{
    marketplace: 'amazon' | 'noon';
    fulfillmentCenterId: string;
    trackingNumber: string;
    notes: string;
    selectedProductId: number;
    quantity: string;
    boxNumber: string;
    items: FbaInboundItem[];
  }>({
    marketplace: 'amazon',
    fulfillmentCenterId: 'CAI1',
    trackingNumber: '',
    notes: '',
    selectedProductId: 0,
    quantity: '10',
    boxNumber: '1',
    items: [],
  });

  // Repricing Settings Modal State
  const [editRepricingModal, setEditRepricingModal] = useState<MarketplaceSkuMapping | null>(null);
  const [repricingForm, setRepricingForm] = useState<{
    repricingEnabled: boolean;
    minPrice: string;
    maxPrice: string;
    repricingRule: 'match_buy_box' | 'undercut_buy_box' | 'match_lowest' | 'undercut_lowest';
    repricingDelta: string;
  }>({
    repricingEnabled: true,
    minPrice: '',
    maxPrice: '',
    repricingRule: 'undercut_buy_box',
    repricingDelta: '1',
  });

  // Queries
  const configQuery = useQuery({
    queryKey: ['marketplace-all-config'],
    queryFn: marketplaceSyncApi.getConfig,
  });

  const mappingsQuery = useQuery({
    queryKey: ['marketplace-mappings'],
    queryFn: () => marketplaceSyncApi.listMappings(),
  });

  const settlementsQuery = useQuery({
    queryKey: ['marketplace-settlements'],
    queryFn: () => marketplaceSyncApi.getSettlements(),
  });

  const settlementAccountsQuery = useQuery({
    queryKey: ['marketplace-settlement-accounts'],
    queryFn: () => marketplaceSyncApi.getSettlementAccounts(),
  });

  const inboundShipmentsQuery = useQuery({
    queryKey: ['marketplace-inbound-shipments'],
    queryFn: () => marketplaceSyncApi.getInboundShipments(),
  });

  const productsQuery = useQuery({
    queryKey: ['marketplace-products-selector'],
    queryFn: () => productsApi.listPage({ pageSize: 150 }),
  });

  // Analytics State & Query
  const [analyticsPeriod, setAnalyticsPeriod] = useState<'30d' | '7d' | 'all'>('30d');
  const analyticsQuery = useQuery({
    queryKey: ['marketplace-analytics', analyticsPeriod],
    queryFn: () => marketplaceSyncApi.getMarketplaceAnalytics(analyticsPeriod),
    enabled: activeTab === 'analytics',
  });

  // Receiving Modal State
  const [receiveShipmentModal, setReceiveShipmentModal] = useState<FbaInboundShipment | null>(null);
  const [receiveFormItems, setReceiveFormItems] = useState<{ [sku: string]: string }>({});

  // Discrepancy Claim Report State
  const [claimReportModal, setClaimReportModal] = useState<FbaDiscrepancyClaimReport | null>(null);
  const [claimLanguage, setClaimLanguage] = useState<'ar' | 'en'>('en');

  // FNSKU Label Printing State
  const [printFnskuModal, setPrintFnskuModal] = useState<{
    productName: string;
    marketplaceSku: string;
    barcode?: string;
    condition: string;
    marketplace: string;
    format: 'thermal_50x30' | 'thermal_40x25' | 'a4_44up';
    copies: number;
  } | null>(null);

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

  // GTIN / Barcode Exemption State
  const [showGtinModal, setShowGtinModal] = useState<boolean>(false);
  const [gtinForm, setGtinForm] = useState<{
    productId?: number;
    brandName: string;
    category: string;
    marketplace: SupportedMarketplace;
    reason: 'unbranded' | 'private_label' | 'custom_manufacturing' | 'parts_accessories';
  }>({
    brandName: '',
    category: 'Home & Kitchen / الأدوات المنزلية',
    marketplace: 'amazon',
    reason: 'unbranded',
  });
  const [gtinResult, setGtinResult] = useState<GtinExemptionApplication | null>(null);
  const [gtinLanguage, setGtinLanguage] = useState<'en' | 'ar'>('en');

  // Marketplace Photo Optimizer State
  const [showPhotoOptimizerModal, setShowPhotoOptimizerModal] = useState<boolean>(false);
  const [optimizerImageSrc, setOptimizerImageSrc] = useState<string | null>(null);
  const [optimizedImageResult, setOptimizedImageResult] = useState<string | null>(null);
  const [imageMetrics, setImageMetrics] = useState<{
    width: number;
    height: number;
    isSquare: boolean;
    isZoomable: boolean;
  } | null>(null);

  useEffect(() => {
    if (configQuery.data) {
      if (configQuery.data.amazon) setAmazonCfg(configQuery.data.amazon);
      if (configQuery.data.noon) setNoonCfg(configQuery.data.noon);
      if (configQuery.data.jumia) setJumiaCfg(configQuery.data.jumia);
      if (configQuery.data.trendyol) setTrendyolCfg(configQuery.data.trendyol);
    }
  }, [configQuery.data]);

  // Initial calculation on mount
  useEffect(() => {
    marketplaceSyncApi.calculateFees(calcInput).then((res) => setCalcResult(res)).catch(() => {});
  }, []);

  // Mutations
  const saveMutation = useMutation({
    mutationFn: (data: {
      amazon?: Partial<AmazonConfig>;
      noon?: Partial<NoonConfig>;
      jumia?: Partial<JumiaConfig>;
      trendyol?: Partial<TrendyolConfig>;
    }) => marketplaceSyncApi.saveConfig(data),
    onSuccess: () => {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      configQuery.refetch();
      toast.success('تم حفظ إعدادات منصات الماركت بليس بنجاح');
    },
    onError: (err: any) => toast.error(err?.message || 'فشل حفظ الإعدادات'),
  });

  const testMutation = useMutation({
    mutationFn: (marketplace: SupportedMarketplace) => marketplaceSyncApi.testConnection(marketplace),
    onSuccess: (res) => setTestResult(res),
    onError: (err: any) => setTestResult({ success: false, message: err?.message || 'تعذر الاتصال بالمنصة' }),
  });

  // Stock sync is handled directly via mappings table actions

  const simulateOrderMutation = useMutation({
    mutationFn: (marketplace: 'amazon' | 'noon') => marketplaceSyncApi.simulateIncomingOrder(marketplace),
    onSuccess: (res: any) => {
      setSimulatedOrderInfo(`تم استلام وحجز طلب ${res.marketplace.toUpperCase()} برقم ${res.marketplaceOrderId} للعميل ${res.customerName}! الرصيد المحجوز: ${res.quantity} قطعة.`);
      mappingsQuery.refetch();
      toast.success('تمت محاكاة سحب الطلب وحجز الرصيد من المخزن بنجاح');
    },
    onError: (err: any) => toast.error(err?.message || 'فشلت محاكاة الطلب'),
  });

  const addMappingMutation = useMutation({
    mutationFn: (payload: any) => marketplaceSyncApi.addMapping(payload),
    onSuccess: () => {
      setShowAddModal(false);
      setNewMapping({
        productId: 0,
        marketplace: 'amazon',
        marketplaceSku: '',
        marketplaceTitle: '',
        customPrice: '',
        competitorPrice: '',
        buyBoxPrice: '',
        syncStock: true,
      });
      mappingsQuery.refetch();
      toast.success('تم ربط الصنف مع المنصة بنجاح');
    },
    onError: (err: any) => toast.error(err?.message || 'فشل حفظ الربط'),
  });

  const deleteMappingMutation = useMutation({
    mutationFn: (id: number | string) => marketplaceSyncApi.deleteMapping(id),
    onSuccess: () => {
      mappingsQuery.refetch();
      toast.success('تم إلغاء ربط الصنف');
    },
    onError: (err: any) => toast.error(err?.message || 'فشل الحذف'),
  });

  const updateCompetitorPriceMutation = useMutation({
    mutationFn: (data: { id: string; competitorPrice?: number; buyBoxPrice?: number }) =>
      marketplaceSyncApi.updateCompetitorPrice(data.id, { competitorPrice: data.competitorPrice, buyBoxPrice: data.buyBoxPrice }),
    onSuccess: () => {
      setEditPriceModal(null);
      mappingsQuery.refetch();
      toast.success('تم تحديث سعر المنافس وصندوق الشراء بنجاح');
    },
    onError: (err: any) => toast.error(err?.message || 'فشل تحديث أسعار المنافسة'),
  });

  const calcMutation = useMutation({
    mutationFn: (input: MarketplaceFeeCalculationInput) => marketplaceSyncApi.calculateFees(input),
    onSuccess: (res) => setCalcResult(res),
    onError: (err: any) => toast.error(err?.message || 'فشل حساب الرسوم'),
  });

  const studioMutation = useMutation({
    mutationFn: (pId: number) => marketplaceSyncApi.getListingStudio(pId),
    onSuccess: (res) => {
      setStudioResult(res);
      toast.success('تم توليد محتوى وسيو القوائم للمنصة بنجاح');
    },
    onError: (err: any) => toast.error(err?.message || 'فشل توليد المحتوى'),
  });

  const reconcileMutation = useMutation({
    mutationFn: (input: MarketplaceSettlementInput) => marketplaceSyncApi.reconcileSettlement(input),
    onSuccess: (res) => {
      toast.success(`تمت تسوية كشف الحساب بنجاح وإنشاء القيد اليومي رقم ${res.journalEntryNo}`);
      setShowReconcileModal(false);
      settlementsQuery.refetch();
    },
    onError: (err: any) => toast.error(err?.message || 'فشلت تسوية كشف الحساب'),
  });

  const bulkImportMutation = useMutation({
    mutationFn: (rows: BulkMappingImportRow[]) => marketplaceSyncApi.importMappings(rows),
    onSuccess: (res) => {
      setBulkImportResult(res);
      toast.success(`تم استيراد ${res.importedCount} صنفاً جديداً وتحديث ${res.updatedCount} صنفاً`);
      mappingsQuery.refetch();
    },
    onError: (err: any) => toast.error(err?.message || 'فشل استيراد الشيت'),
  });

  const liveSyncMutation = useMutation({
    mutationFn: (productId?: number) => marketplaceSyncApi.syncStockLive(productId),
    onSuccess: (res) => {
      toast.success(res.message);
      mappingsQuery.refetch();
    },
    onError: (err: any) => toast.error(err?.message || 'فشل البث اللحظي للمخزون'),
  });

  const runRepricingMutation = useMutation({
    mutationFn: (marketplace?: SupportedMarketplace) => marketplaceSyncApi.runRepricingBot(marketplace),
    onSuccess: (res) => {
      toast.success(`قام الروبوت بفحص ${res.totalEvaluated} صنفاً وتعديل أسعار ${res.totalRepriced} صنفاً بنجاح`);
      mappingsQuery.refetch();
    },
    onError: (err: any) => toast.error(err?.message || 'فشل تشغيل روبوت إعادة التسعير'),
  });

  const saveRepricingMutation = useMutation({
    mutationFn: (data: { id: string; payload: any }) =>
      marketplaceSyncApi.saveRepricingSettings(data.id, data.payload),
    onSuccess: () => {
      setEditRepricingModal(null);
      mappingsQuery.refetch();
      toast.success('تم حفظ إعدادات وقواعد التسعير الذكي بنجاح');
    },
    onError: (err: any) => toast.error(err?.message || 'فشل حفظ إعدادات التسعير'),
  });

  const createInboundMutation = useMutation({
    mutationFn: (data: any) => marketplaceSyncApi.createInboundShipment(data),
    onSuccess: (res) => {
      toast.success(`تم إنشاء إذن توريد ${res.marketplace.toUpperCase()} بنجاح برقم ${res.shipmentNumber}`);
      setShowInboundModal(false);
      inboundShipmentsQuery.refetch();
    },
    onError: (err: any) => toast.error(err?.message || 'فشل إنشاء إذن التوريد'),
  });

  const receiveShipmentMutation = useMutation({
    mutationFn: (data: { id: string; receivedItems: { productId: number; marketplaceSku: string; quantityReceived: number }[] }) =>
      marketplaceSyncApi.recordShipmentReceiving(data.id, data.receivedItems),
    onSuccess: (res) => {
      toast.success(`تم تسجيل فحص واستلام الشحنة ${res.shipmentNumber}. الفاقد المرصود: ${res.totalDiscrepancyUnits || 0} قطعة`);
      setReceiveShipmentModal(null);
      inboundShipmentsQuery.refetch();
    },
    onError: (err: any) => toast.error(err?.message || 'فشل تسجيل فحص واستلام الشحنة'),
  });

  const loadClaimReportMutation = useMutation({
    mutationFn: (shipmentId: string) => marketplaceSyncApi.getDiscrepancyClaim(shipmentId),
    onSuccess: (res) => {
      setClaimReportModal(res);
    },
    onError: (err: any) => toast.error(err?.message || 'فشل استخراج تقرير المطالبة'),
  });

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

  const gtinMutation = useMutation({
    mutationFn: (data: any) => marketplaceSyncApi.generateGtinExemption(data),
    onSuccess: (res) => {
      setGtinResult(res);
      toast.success('تم توليد ملف وخطاب طلب إعفاء الباركود الدولي بنجاح');
    },
    onError: (err: any) => toast.error(err?.message || 'فشل توليد طلب الإعفاء'),
  });

  const handleOptimizeProductImage = (dataUrl: string) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const isSquare = Math.abs(img.naturalWidth - img.naturalHeight) < 5;
      const isZoomable = img.naturalWidth >= 1000 && img.naturalHeight >= 1000;
      setImageMetrics({
        width: img.naturalWidth,
        height: img.naturalHeight,
        isSquare,
        isZoomable,
      });

      const targetSize = 1500;
      const canvas = document.createElement('canvas');
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Fill pure white background
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, targetSize, targetSize);

      // Scale to fit 85% of canvas (~1275px)
      const maxDim = targetSize * 0.85;
      const scale = Math.min(maxDim / img.naturalWidth, maxDim / img.naturalHeight);
      const scaledW = img.naturalWidth * scale;
      const scaledH = img.naturalHeight * scale;
      const posX = (targetSize - scaledW) / 2;
      const posY = (targetSize - scaledH) / 2;

      ctx.drawImage(img, posX, posY, scaledW, scaledH);

      try {
        const imgData = ctx.getImageData(0, 0, targetSize, targetSize);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          if (r > 235 && g > 235 && b > 235) {
            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
          }
        }
        ctx.putImageData(imgData, 0, 0);
      } catch {
        // Fallback without pixel manipulation if tainted
      }

      const resultUrl = canvas.toDataURL('image/jpeg', 0.94);
      setOptimizedImageResult(resultUrl);
    };
    img.src = dataUrl;
  };

  const handlePrintFnskuLabels = () => {
    if (!printFnskuModal) return;
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) {
      toast.error('يرجى السماح بالنوافذ المنبثقة للطباعة');
      return;
    }

    const { productName, marketplaceSku, format, copies, condition } = printFnskuModal;
    const isA4 = format === 'a4_44up';
    const is50x30 = format === 'thermal_50x30';

    const labelHtml = `
      <div class="label-box">
        <div class="sku-code">${marketplaceSku}</div>
        <div class="barcode-svg">
          <svg viewBox="0 0 160 45" style="width: 100%; height: 34px;">
            <rect x="0" y="0" width="4" height="40" fill="#000"/>
            <rect x="7" y="0" width="2" height="40" fill="#000"/>
            <rect x="12" y="0" width="5" height="40" fill="#000"/>
            <rect x="20" y="0" width="2" height="40" fill="#000"/>
            <rect x="25" y="0" width="3" height="40" fill="#000"/>
            <rect x="31" y="0" width="6" height="40" fill="#000"/>
            <rect x="40" y="0" width="2" height="40" fill="#000"/>
            <rect x="45" y="0" width="4" height="40" fill="#000"/>
            <rect x="52" y="0" width="2" height="40" fill="#000"/>
            <rect x="57" y="0" width="5" height="40" fill="#000"/>
            <rect x="65" y="0" width="3" height="40" fill="#000"/>
            <rect x="71" y="0" width="2" height="40" fill="#000"/>
            <rect x="76" y="0" width="4" height="40" fill="#000"/>
            <rect x="83" y="0" width="2" height="40" fill="#000"/>
            <rect x="88" y="0" width="6" height="40" fill="#000"/>
            <rect x="97" y="0" width="3" height="40" fill="#000"/>
            <rect x="103" y="0" width="2" height="40" fill="#000"/>
            <rect x="108" y="0" width="5" height="40" fill="#000"/>
            <rect x="116" y="0" width="2" height="40" fill="#000"/>
            <rect x="121" y="0" width="4" height="40" fill="#000"/>
            <rect x="128" y="0" width="2" height="40" fill="#000"/>
            <rect x="133" y="0" width="6" height="40" fill="#000"/>
            <rect x="142" y="0" width="2" height="40" fill="#000"/>
            <rect x="147" y="0" width="4" height="40" fill="#000"/>
            <rect x="154" y="0" width="4" height="40" fill="#000"/>
          </svg>
        </div>
        <div class="prod-title">${productName}</div>
        <div class="condition-tag">${condition}</div>
      </div>
    `;

    const labels = Array.from({ length: copies }, () => labelHtml).join('');

    const pageSize = isA4 ? 'A4 portrait' : is50x30 ? '50mm 30mm' : '40mm 25mm';
    const pageMargin = isA4 ? '8mm' : '0';

    const layoutCss = isA4
      ? `
        .grid-container {
          display: grid;
          grid-template-columns: repeat(4, 48.5mm);
          grid-auto-rows: 25.4mm;
          gap: 0;
          justify-content: center;
        }
        .label-box {
          box-sizing: border-box;
          width: 48.5mm;
          height: 25.4mm;
          padding: 1.5mm;
          text-align: center;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
      `
      : `
        .grid-container {
          display: block;
        }
        .label-box {
          box-sizing: border-box;
          width: ${is50x30 ? '50mm' : '40mm'};
          height: ${is50x30 ? '30mm' : '25mm'};
          padding: 1.5mm;
          text-align: center;
          page-break-after: always;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
      `;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>FNSKU Labels - ${marketplaceSku}</title>
          <style>
            @page {
              size: ${pageSize};
              margin: ${pageMargin};
            }
            body {
              font-family: Arial, sans-serif;
              margin: 0;
              padding: 0;
              -webkit-print-color-adjust: exact;
            }
            ${layoutCss}
            .sku-code {
              font-size: 8pt;
              font-weight: bold;
              letter-spacing: 0.5px;
            }
            .barcode-svg {
              margin: 1px 0;
            }
            .prod-title {
              font-size: 6pt;
              line-height: 1.1;
              max-height: 13px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }
            .condition-tag {
              font-size: 5.5pt;
              font-weight: bold;
              text-transform: uppercase;
            }
          </style>
        </head>
        <body>
          <div class="grid-container">
            ${labels}
          </div>
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    toast.success('تم النسخ إلى الحافظة');
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleExportFlatFile = async (marketplace: SupportedMarketplace) => {
    try {
      const res = await marketplaceSyncApi.exportFlatFile(marketplace);
      const blob = new Blob([res.data], { type: res.contentType });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success(`تم تحميل شيت الرفع ${res.filename} (${res.rowCount} صنفاً)`);
    } catch (err: any) {
      toast.error(err?.message || 'فشل تصدير ملف الإدراج');
    }
  };

  const handleDownloadSampleMappingTemplate = () => {
    const headers = 'barcode,marketplace,marketplaceSku,marketplaceTitle,customPrice,competitorPrice';
    const sampleRows = [
      '622123456789,amazon,B08N5WRWNW,كابل شحن سريع أصلي تايب سي,199,189',
      '622987654321,noon,N45678901A,سماعة رأس بلوتوث محيطية,450,420',
      '622112233445,jumia,JM987654,ماوس ألعاب لاسلكي مريح,290,275',
    ].join('\n');
    const csvContent = '\uFEFF' + [headers, sampleRows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Marketplace_SKU_Mapping_Template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    toast.success('تم تحميل نموذج شيت الربط التجريبي بنجاح');
  };

  const handleExportPackingSlip = async (shipmentId: string) => {
    try {
      const res = await marketplaceSyncApi.exportPackingSlip(shipmentId);
      const blob = new Blob([res.data], { type: res.contentType });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success('تم تحميل كشف التعبئة (Packing Slip) بنجاح');
    } catch (err: any) {
      toast.error(err?.message || 'فشل تحميل كشف التعبئة');
    }
  };

  const mappings: MarketplaceSkuMapping[] = mappingsQuery.data || [];
  const availableProducts = productsQuery.data?.products || [];

  const winningCount = mappings.filter((m) => m.buyBoxStatus === 'winning').length;
  const atRiskCount = mappings.filter((m) => m.buyBoxStatus === 'at_risk').length;
  const losingCount = mappings.filter((m) => m.buyBoxStatus === 'losing').length;

  const filteredMappings = selectedInventoryPlatform === 'all'
    ? mappings
    : mappings.filter((m) => m.marketplace === selectedInventoryPlatform);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1280px', width: 'min(100%, 1280px)', margin: '0 auto' }} dir="rtl">
      {/* Header Info */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s49', "بوابة إدارة ومزامنة التجارة الإلكترونية والماركت بليس (Marketplaces Suite)")}
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
            {t('settings.workspace_sections.settings_marketplaces_section.s50', "الربط السحابي ومزامنة المخزون، وحساب هوامش الأرباح ورسوم المنصات، واستوديو السيو وتتبع الـ Buy Box.")}
          </p>
        </div>

        {saveSuccess ? (
          <span
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              background: '#f0fdf4',
              color: '#15803d',
              border: '1px solid #bbf7d0',
              fontSize: '13px',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <CheckIcon size={14} color="#15803d" strokeWidth={2.5} />
            <span>{t('settings.workspace_sections.settings_marketplaces_section.s51', "تم حفظ الإعدادات بنجاح!")}</span>
          </span>
        ) : null}
      </div>

      {/* Tab Navigation */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          borderBottom: '1px solid #e2e8f0',
          paddingBottom: '10px',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
        }}
      >
        <button
          type="button"
          onClick={() => { setActiveTab('onboarding'); setTestResult(null); }}
          style={{
            border: 'none',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            background: activeTab === 'onboarding' ? '#170e5e' : '#f1f5f9',
            color: activeTab === 'onboarding' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
          }}
        >
          <CheckShieldIcon size={15} />
          <span>{t('settings.workspace_sections.settings_marketplaces_section.s52', "معالج فتح وتفعيل الحساب (Onboarding)")}</span>
          {onboardingQuery.data ? (
            <span
              style={{
                fontSize: '11px',
                padding: '1px 6px',
                borderRadius: '9999px',
                background: onboardingQuery.data.overallReadinessScore >= 80 ? '#16a34a' : '#ea580c',
                color: '#ffffff',
                fontWeight: 700,
              }}
            >
              {onboardingQuery.data.overallReadinessScore}%
            </span>
          ) : null}
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('calculator'); setTestResult(null); }}
          style={{
            border: 'none',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            background: activeTab === 'calculator' ? '#170e5e' : '#f1f5f9',
            color: activeTab === 'calculator' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
          }}
        >
          <CalculatorIcon size={15} />
          <span>{t('settings.workspace_sections.settings_marketplaces_section.s53', "حاسبة وهوامش الأرباح والرسوم")}</span>
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('studio'); setTestResult(null); }}
          style={{
            border: 'none',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            background: activeTab === 'studio' ? '#170e5e' : '#f1f5f9',
            color: activeTab === 'studio' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
          }}
        >
          <FileTextIcon size={15} />
          <span>{t('settings.workspace_sections.settings_marketplaces_section.s54', "استوديو الكتالوج والمحتوى والسيو")}</span>
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('inventory'); setTestResult(null); }}
          style={{
            border: 'none',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            background: activeTab === 'inventory' ? '#170e5e' : '#f1f5f9',
            color: activeTab === 'inventory' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
          }}
        >
          <RefreshCwIcon size={15} />
          <span>{t('settings.workspace_sections.settings_marketplaces_section.s55', "مطابقة الأكواد وروبوت الأسعار")}</span>
          <span
            style={{
              fontSize: '11px',
              padding: '1px 6px',
              borderRadius: '9999px',
              background: activeTab === 'inventory' ? '#ffffff' : '#e2e8f0',
              color: activeTab === 'inventory' ? '#170e5e' : '#475569',
              fontWeight: 700,
            }}
          >
            {mappings.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('inbound'); setTestResult(null); }}
          style={{
            border: 'none',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            background: activeTab === 'inbound' ? '#170e5e' : '#f1f5f9',
            color: activeTab === 'inbound' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
          }}
        >
          <TruckIcon size={15} />
          <span>{t('settings.workspace_sections.settings_marketplaces_section.s56', "توريد مستودعات FBA/FBN")}</span>
          <span
            style={{
              fontSize: '11px',
              padding: '1px 6px',
              borderRadius: '9999px',
              background: activeTab === 'inbound' ? '#ffffff' : '#e2e8f0',
              color: activeTab === 'inbound' ? '#170e5e' : '#475569',
              fontWeight: 700,
            }}
          >
            {inboundShipmentsQuery.data?.length || 0}
          </span>
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('settlements'); setTestResult(null); }}
          style={{
            border: 'none',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            background: activeTab === 'settlements' ? '#170e5e' : '#f1f5f9',
            color: activeTab === 'settlements' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
          }}
        >
          <ReceiptIcon size={15} />
          <span>{t('settings.workspace_sections.settings_marketplaces_section.s57', "تسوية كشوف الحسابات والقيود")}</span>
          <span
            style={{
              fontSize: '11px',
              padding: '1px 6px',
              borderRadius: '9999px',
              background: activeTab === 'settlements' ? '#ffffff' : '#e2e8f0',
              color: activeTab === 'settlements' ? '#170e5e' : '#475569',
              fontWeight: 700,
            }}
          >
            {settlementsQuery.data?.length || 0}
          </span>
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('orders'); setTestResult(null); }}
          style={{
            border: 'none',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            background: activeTab === 'orders' ? '#170e5e' : '#f1f5f9',
            color: activeTab === 'orders' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
          }}
        >
          <ReceiptIcon size={15} />
          <span>{t('settings.workspace_sections.settings_marketplaces_section.s58', "سحب وحجز الطلبات")}</span>
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('analytics'); setTestResult(null); }}
          style={{
            border: 'none',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            background: activeTab === 'analytics' ? '#170e5e' : '#f1f5f9',
            color: activeTab === 'analytics' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
          }}
        >
          <SlidersIcon size={15} />
          <span>{t('settings.workspace_sections.settings_marketplaces_section.s59', "تحليلات ومؤشرات الأداء")}</span>
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('amazon'); setTestResult(null); }}
          style={{
            border: 'none',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            background: activeTab === 'amazon' ? '#170e5e' : '#f1f5f9',
            color: activeTab === 'amazon' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
          }}
        >
          <PackageIcon size={15} />
          <span>{t('settings.workspace_sections.settings_marketplaces_section.s60', "أمازون (SP-API)")}</span>
          {amazonCfg.enabled ? <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#22c55e' }} /> : null}
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('noon'); setTestResult(null); }}
          style={{
            border: 'none',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            background: activeTab === 'noon' ? '#170e5e' : '#f1f5f9',
            color: activeTab === 'noon' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
          }}
        >
          <ShoppingCartIcon size={15} />
          <span>{t('settings.workspace_sections.settings_marketplaces_section.s61', "نون (Noon)")}</span>
          {noonCfg.enabled ? <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#22c55e' }} /> : null}
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('jumia'); setTestResult(null); }}
          style={{
            border: 'none',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            background: activeTab === 'jumia' ? '#170e5e' : '#f1f5f9',
            color: activeTab === 'jumia' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
          }}
        >
          <GlobeIcon size={15} />
          <span>{t('settings.workspace_sections.settings_marketplaces_section.s62', "جوميا (Jumia)")}</span>
          {jumiaCfg.enabled ? <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#22c55e' }} /> : null}
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('trendyol'); setTestResult(null); }}
          style={{
            border: 'none',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            background: activeTab === 'trendyol' ? '#170e5e' : '#f1f5f9',
            color: activeTab === 'trendyol' ? '#ffffff' : '#475569',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
          }}
        >
          <LayersIcon size={15} />
          <span>{t('settings.workspace_sections.settings_marketplaces_section.s63', "ترينديول (Trendyol)")}</span>
          {trendyolCfg.enabled ? <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#22c55e' }} /> : null}
        </button>
      </div>

      {/* Test Result Banner */}
      {testResult ? (
        <div
          style={{
            padding: '12px 18px',
            borderRadius: '10px',
            background: testResult.success ? '#f0fdf4' : '#fef2f2',
            border: `1px solid ${testResult.success ? '#bbf7d0' : '#fecaca'}`,
            color: testResult.success ? '#15803d' : '#b91c1c',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '13.5px',
            fontWeight: 600,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {testResult.success ? <CheckIcon size={16} color="#15803d" strokeWidth={2.5} /> : <AlertTriangleIcon size={16} color="#b91c1c" />}
            <span>{testResult.message}</span>
            {testResult.accountName ? <span style={{ marginRight: '8px', opacity: 0.85 }}>({testResult.accountName})</span> : null}
          </div>
          {testResult.pingMs ? <span style={{ fontSize: '11.5px', opacity: 0.8 }}>{t('settings.workspace_sections.settings_marketplaces_section.s64', "زمن الاستجابة:")} {testResult.pingMs}ms</span> : null}
        </div>
      ) : null}

      {/* ========================================================================= */}
      {/* TAB 0: SELLER ONBOARDING & VERIFICATION ENGINE ("معالج فتح وتأهيل الحساب") */}
      {/* ========================================================================= */}
      {activeTab === 'onboarding' ? (
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
      ) : null}

      {/* ========================================================================= */}
      {/* TAB 1: PROFIT & FEE CALCULATOR (محرك حساب هوامش الأرباح ورسوم المنصات) */}
      {/* ========================================================================= */}
      {activeTab === 'calculator' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div style={{ marginBottom: '18px' }}>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s91', "محرك حساب هوامش الأرباح ورسوم المنصات (Profit & Fee Engine)")}
              </h4>
              <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s92', "احسب صافي أرباحك وعمولات أمازون، نون، وجوميا، ومصاريف الشحن والتجهيز والضريبة ونقطة التعادل بدقة من واقع تكلفة الصنف بالـ ERP.")}
              </p>
            </div>

            {/* Product Quick-Picker */}
            <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0', marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s93', "اختيار صنف مسجل في الـ ERP لجلب تكلفته وسعر بيعه تلقائياً:")}
              </label>
              <select
                onChange={(e) => {
                  const id = parseInt(e.target.value, 10);
                  const p = availableProducts.find((item) => Number(item.id) === id);
                  if (p) {
                    const updated = {
                      ...calcInput,
                      itemCost: Number((p as any).cost_price ?? (p as any).costPrice ?? 0),
                      sellingPrice: Number((p as any).retail_price ?? (p as any).retailPrice ?? 0),
                    };
                    setCalcInput(updated);
                    calcMutation.mutate(updated);
                  }
                }}
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#ffffff' }}
              >
                <option value="">{t('settings.workspace_sections.settings_marketplaces_section.s94', "-- اضغط لاختيار صنف من المخزن --")}</option>
                {availableProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {t('settings.workspace_sections.settings_marketplaces_section.s95', "(التكلفة:")} {(p as any).costPrice ?? (p as any).cost_price ?? 0} {t('settings.workspace_sections.settings_marketplaces_section.s96', "ج.م | سعر البيع:")} {(p as any).retailPrice ?? (p as any).retail_price ?? 0} {t('settings.workspace_sections.settings_marketplaces_section.s97', "ج.م)")}
                  </option>
                ))}
              </select>
            </div>

            {/* Inputs Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s98', "منصة البيع")}
                </label>
                <select
                  value={calcInput.marketplace}
                  onChange={(e) => {
                    const updated = { ...calcInput, marketplace: e.target.value as any };
                    setCalcInput(updated);
                    calcMutation.mutate(updated);
                  }}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#ffffff' }}
                >
                  <option value="amazon">{t('settings.workspace_sections.settings_marketplaces_section.s99', "أمازون (Amazon SP-API)")}</option>
                  <option value="noon">{t('settings.workspace_sections.settings_marketplaces_section.s100', "نون (Noon Marketplace)")}</option>
                  <option value="jumia">{t('settings.workspace_sections.settings_marketplaces_section.s101', "جوميا (Jumia Seller Center)")}</option>
                  <option value="trendyol">{t('settings.workspace_sections.settings_marketplaces_section.s102', "ترينديول (Trendyol)")}</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s103', "دولة وسوق البيع")}
                </label>
                <select
                  value={calcInput.region}
                  onChange={(e) => {
                    const updated = { ...calcInput, region: e.target.value as any };
                    setCalcInput(updated);
                    calcMutation.mutate(updated);
                  }}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#ffffff' }}
                >
                  <option value="eg">{t('settings.workspace_sections.settings_marketplaces_section.s104', "مصر (EGP - ج.م)")}</option>
                  <option value="sa">{t('settings.workspace_sections.settings_marketplaces_section.s105', "السعودية (SAR - ر.س)")}</option>
                  <option value="ae">{t('settings.workspace_sections.settings_marketplaces_section.s106', "الإمارات (AED - د.إ)")}</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s107', "فئة وتصنيف المنتج")}
                </label>
                <select
                  value={calcInput.category}
                  onChange={(e) => {
                    const updated = { ...calcInput, category: e.target.value };
                    setCalcInput(updated);
                    calcMutation.mutate(updated);
                  }}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#ffffff' }}
                >
                  <option value="electronics">{t('settings.workspace_sections.settings_marketplaces_section.s108', "إلكترونيات وكمبيوتر (عمولة ~7-8%)")}</option>
                  <option value="mobile_accessories">{t('settings.workspace_sections.settings_marketplaces_section.s109', "إكسسوارات موبايل (عمولة ~12-14%)")}</option>
                  <option value="apparel">{t('settings.workspace_sections.settings_marketplaces_section.s110', "ملابس وأزياء وأحذية (عمولة ~15%)")}</option>
                  <option value="home_kitchen">{t('settings.workspace_sections.settings_marketplaces_section.s111', "أدوات منزلية ومطبخ (عمولة ~11-12%)")}</option>
                  <option value="beauty_health">{t('settings.workspace_sections.settings_marketplaces_section.s112', "عطور وصحة وتجميل (عمولة ~12%)")}</option>
                  <option value="grocery">{t('settings.workspace_sections.settings_marketplaces_section.s113', "سوبرماركت وأغذية (عمولة ~9%)")}</option>
                  <option value="baby_toys">{t('settings.workspace_sections.settings_marketplaces_section.s114', "ألعاب ومستلزمات أطفال (عمولة ~12%)")}</option>
                  <option value="sports_outdoors">{t('settings.workspace_sections.settings_marketplaces_section.s115', "رياضة ولياقة بدنية (عمولة ~13%)")}</option>
                  <option value="general">{t('settings.workspace_sections.settings_marketplaces_section.s116', "فئات عامة وأخرى (عمولة ~12%)")}</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s117', "نمط الشحن والتجهيز")}
                </label>
                <select
                  value={calcInput.fulfillmentType}
                  onChange={(e) => {
                    const updated = { ...calcInput, fulfillmentType: e.target.value };
                    setCalcInput(updated);
                    calcMutation.mutate(updated);
                  }}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#ffffff' }}
                >
                  <option value="fba">{t('settings.workspace_sections.settings_marketplaces_section.s118', "FBA / FBN / Express (مستودعات المنصة الرسمية)")}</option>
                  <option value="fbm">{t('settings.workspace_sections.settings_marketplaces_section.s119', "FBM / Direct (شحن مباشر من مستودعك الخاص)")}</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s120', "وزن وحجم الطرد")}
                </label>
                <select
                  value={calcInput.weightTier}
                  onChange={(e) => {
                    const updated = { ...calcInput, weightTier: e.target.value as any };
                    setCalcInput(updated);
                    calcMutation.mutate(updated);
                  }}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#ffffff' }}
                >
                  <option value="small">{t('settings.workspace_sections.settings_marketplaces_section.s121', "طرد صغير وخفيف (أقل من 250 جرام)")}</option>
                  <option value="standard">{t('settings.workspace_sections.settings_marketplaces_section.s122', "طرد قياسي (250 جرام إلى 1 كجم)")}</option>
                  <option value="medium">{t('settings.workspace_sections.settings_marketplaces_section.s123', "طرد متوسط (1 كجم إلى 2 كجم)")}</option>
                  <option value="large">{t('settings.workspace_sections.settings_marketplaces_section.s124', "طرد كبير (2 كجم إلى 5 كجم)")}</option>
                  <option value="heavy">{t('settings.workspace_sections.settings_marketplaces_section.s125', "طرد ثقيل (أكثر من 5 كجم)")}</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s126', "سعر البيع المستهدف للمستهلك *")}
                </label>
                <input
                  type="number"
                  value={calcInput.sellingPrice || ''}
                  onChange={(e) => {
                    const updated = { ...calcInput, sellingPrice: parseFloat(e.target.value) || 0 };
                    setCalcInput(updated);
                    calcMutation.mutate(updated);
                  }}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', fontWeight: 700, color: '#170e5e' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s127', "تكلفة شراء الصنف (ERP Cost) *")}
                </label>
                <input
                  type="number"
                  value={calcInput.itemCost || ''}
                  onChange={(e) => {
                    const updated = { ...calcInput, itemCost: parseFloat(e.target.value) || 0 };
                    setCalcInput(updated);
                    calcMutation.mutate(updated);
                  }}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s128', "شحن لمستودع المنصة + تغليف")}
                </label>
                <input
                  type="number"
                  value={(calcInput.inboundShippingCost || 0) + (calcInput.packagingCost || 0)}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    const updated = { ...calcInput, inboundShippingCost: val, packagingCost: 0 };
                    setCalcInput(updated);
                    calcMutation.mutate(updated);
                  }}
                  placeholder="0"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>
            </div>

            {/* Real-time Results Dashboard */}
            {calcResult ? (
              <div style={{ marginTop: '24px', borderTop: '1px solid #e2e8f0', paddingTop: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                  <span style={{ fontSize: '14.5px', fontWeight: 800, color: '#0f172a' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s129', "تقرير الربحية الصافية والتحليل المالي للقطعة:")}
                  </span>
                  <span
                    style={{
                      padding: '4px 12px',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontWeight: 800,
                      background:
                        calcResult.ratingStatus === 'exceptional'
                          ? '#f0fdf4'
                          : calcResult.ratingStatus === 'healthy'
                          ? '#eff6ff'
                          : calcResult.ratingStatus === 'tight'
                          ? '#fefce8'
                          : '#fef2f2',
                      color:
                        calcResult.ratingStatus === 'exceptional'
                          ? '#15803d'
                          : calcResult.ratingStatus === 'healthy'
                          ? '#1d4ed8'
                          : calcResult.ratingStatus === 'tight'
                          ? '#a16207'
                          : '#b91c1c',
                      border: `1px solid ${
                        calcResult.ratingStatus === 'exceptional'
                          ? '#bbf7d0'
                          : calcResult.ratingStatus === 'healthy'
                          ? '#bfdbfe'
                          : calcResult.ratingStatus === 'tight'
                          ? '#fef08a'
                          : '#fecaca'
                      }`,
                    }}
                  >
                    {calcResult.ratingStatus === 'exceptional'
                      ? t('settings.workspace_sections.settings_marketplaces_section.s130', "ربحية استثنائية (25%+)")
                      : calcResult.ratingStatus === 'healthy'
                      ? t('settings.workspace_sections.settings_marketplaces_section.s131', "ربحية صحية وممتازة (12% - 24%)")
                      : calcResult.ratingStatus === 'tight'
                      ? t('settings.workspace_sections.settings_marketplaces_section.s132', "هامش ربح ضيق (أقل من 12%)")
                      : t('settings.workspace_sections.settings_marketplaces_section.s133', "خسارة محققة على المنصة!")}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                  <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s134', "سعر البيع للمستهلك")}</div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                      {calcResult.sellingPrice} {calcResult.currency}
                    </div>
                  </div>

                  <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '11.5px', color: '#dc2626', fontWeight: 600 }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s135', "عمولة البيع (")}{calcResult.referralRatePercent}%)
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#dc2626', marginTop: '4px' }}>
                      -{calcResult.referralFee} {calcResult.currency}
                    </div>
                  </div>

                  <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '11.5px', color: '#dc2626', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s136', "الشحن والتجهيز + الإغلاق")}</div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#dc2626', marginTop: '4px' }}>
                      -{(calcResult.fulfillmentFee + calcResult.closingFee).toFixed(1)} {calcResult.currency}
                    </div>
                  </div>

                  <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '11.5px', color: '#dc2626', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s137', "ضريبة القيمة المضافة (")}{calcResult.vatRatePercent}%)</div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#dc2626', marginTop: '4px' }}>
                      -{calcResult.vatOnFees} {calcResult.currency}
                    </div>
                  </div>

                  <div style={{ background: '#f0f9ff', padding: '14px', borderRadius: '10px', border: '1px solid #bae6fd' }}>
                    <div style={{ fontSize: '11.5px', color: '#0369a1', fontWeight: 700 }}>{t('settings.workspace_sections.settings_marketplaces_section.s138', "صافي المحول لحساب البنك")}</div>
                    <div style={{ fontSize: '22px', fontWeight: 900, color: '#0369a1', marginTop: '4px' }}>
                      {calcResult.netPayoutToMerchant} {calcResult.currency}
                    </div>
                  </div>

                  <div
                    style={{
                      background: calcResult.netProfit >= 0 ? '#f0fdf4' : '#fef2f2',
                      padding: '14px',
                      borderRadius: '10px',
                      border: `1px solid ${calcResult.netProfit >= 0 ? '#bbf7d0' : '#fecaca'}`,
                    }}
                  >
                    <div style={{ fontSize: '11.5px', color: calcResult.netProfit >= 0 ? '#15803d' : '#b91c1c', fontWeight: 700 }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s139', "صافي الربح الحقيقي")}
                    </div>
                    <div style={{ fontSize: '22px', fontWeight: 900, color: calcResult.netProfit >= 0 ? '#15803d' : '#b91c1c', marginTop: '4px' }}>
                      {calcResult.netProfit} {calcResult.currency}
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s140', "هامش الربح:")} <strong style={{ color: calcResult.netProfit >= 0 ? '#15803d' : '#b91c1c' }}>{calcResult.netMarginPercent}%</strong>
                    </div>
                  </div>

                  <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '11.5px', color: '#475569', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s141', "أدنى سعر للتعادل (Break-Even)")}</div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#170e5e', marginTop: '4px' }}>
                      {calcResult.breakEvenPrice} {calcResult.currency}
                    </div>
                    <div style={{ fontSize: '10.5px', color: '#94a3b8', marginTop: '2px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s142', "أقل من هذا السعر يسبب خسارة")}</div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ========================================================================= */}
      {/* TAB 2: LISTING STUDIO ("ستوديو / ليو") */}
      {/* ========================================================================= */}
      {activeTab === 'studio' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s143', "استوديو تجهيز المنتجات وسيو المنصات (Content & Listing Studio)")}
              </h4>
              <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s144', "توليد عناوين احترافية متوافقة مع خوارزميات أمازون ونون، و5 نقاط بيعية رئيسية (Bullet Points)، والكلمات المفتاحية الخلفية (Backend Keywords).")}
              </p>
            </div>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '16px', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '260px' }}>
                <select
                  value={studioProductId}
                  onChange={(e) => setStudioProductId(parseInt(e.target.value, 10) || 0)}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#ffffff' }}
                >
                  <option value={0}>{t('settings.workspace_sections.settings_marketplaces_section.s145', "-- اختر صنفاً لتوليد صفحات البيع والسيو له --")}</option>
                  {availableProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.barcode ? `(${p.barcode})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <Button
                variant="primary"
                onClick={() => {
                  if (!studioProductId) {
                    toast.error(t('settings.workspace_sections.settings_marketplaces_section.s146', "يرجى اختيار صنف أولاً"));
                    return;
                  }
                  studioMutation.mutate(studioProductId);
                }}
                disabled={studioMutation.isPending || !studioProductId}
                style={{ background: '#170e5e', color: '#ffffff', minWidth: '150px' }}
              >
                {studioMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s147', "جاري التوليد والتحليل...") : t('settings.workspace_sections.settings_marketplaces_section.s148', "توليد محتوى وسيو القائمة")}
              </Button>

              <Button
                variant="secondary"
                onClick={() => {
                  if (studioProductId) {
                    setGtinForm({
                      productId: studioProductId,
                      brandName: '',
                      category: t('settings.workspace_sections.settings_marketplaces_section.s149', "Home & Kitchen / الأدوات المنزلية"),
                      marketplace: 'amazon',
                      reason: 'unbranded',
                    });
                  }
                  setShowGtinModal(true);
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              >
                <PlusIcon size={14} />
                <span>{t('settings.workspace_sections.settings_marketplaces_section.s150', "طلب إعفاء الباركود (GTIN)")}</span>
              </Button>

              <Button
                variant="secondary"
                onClick={() => setShowPhotoOptimizerModal(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              >
                <CameraIcon size={14} />
                <span>{t('settings.workspace_sections.settings_marketplaces_section.s151', "فاحص ومحسن صور المنصات")}</span>
              </Button>
            </div>

            {studioResult ? (
              <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '16px', borderTop: '1px solid #e2e8f0', paddingTop: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s152', "تم تجهيز محتوى الإدراج والسيو بنجاح للصنف:")} {studioResult.productName}
                  </span>
                  <Button
                    variant="primary"
                    onClick={() => {
                      const fullListing = `[العنوان العربي]\n${studioResult.optimizedTitleAr}\n\n[English Title]\n${studioResult.optimizedTitleEn}\n\n[النقاط البيعية الـ 5]\n• ${studioResult.bulletPointsAr.join('\n• ')}\n\n[Backend Keywords]\n${studioResult.backendKeywordsAr}`;
                      handleCopy(fullListing, 'fullListing');
                    }}
                    style={{ background: '#170e5e', color: '#ffffff', fontSize: '11.5px', padding: '4px 12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    <CopyIcon size={13} />
                    <span>{copiedKey === 'fullListing' ? t('settings.workspace_sections.settings_marketplaces_section.s153', "تم نسخ كامل المحتوى!") : t('settings.workspace_sections.settings_marketplaces_section.s154', "نسخ كامل محتوى القائمة")}</span>
                  </Button>
                </div>

                {/* Titles Card */}
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 800, fontSize: '13.5px', color: '#0f172a' }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s155', "عنوان المنتج المحسّن لمحركات بحث أمازون ونون (Arabic Title):")}
                    </span>
                    <Button
                      variant="secondary"
                      onClick={() => handleCopy(studioResult.optimizedTitleAr, 'titleAr')}
                      style={{ fontSize: '11.5px', padding: '3px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      <CopyIcon size={12} />
                      <span>{copiedKey === 'titleAr' ? t('settings.workspace_sections.settings_marketplaces_section.s156', "تم النسخ!") : t('settings.workspace_sections.settings_marketplaces_section.s157', "نسخ العنوان")}</span>
                    </Button>
                  </div>
                  <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '10px 12px', fontSize: '13px', color: '#0f172a', fontWeight: 600 }}>
                    {studioResult.optimizedTitleAr}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 800, fontSize: '13.5px', color: '#0f172a' }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s158', "عنوان المنتج بالإنجليزية (English Title):")}
                    </span>
                    <Button
                      variant="secondary"
                      onClick={() => handleCopy(studioResult.optimizedTitleEn, 'titleEn')}
                      style={{ fontSize: '11.5px', padding: '3px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      <CopyIcon size={12} />
                      <span>{copiedKey === 'titleEn' ? t('settings.workspace_sections.settings_marketplaces_section.s159', "تم النسخ!") : 'Copy English'}</span>
                    </Button>
                  </div>
                  <div dir="ltr" style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '10px 12px', fontSize: '13px', color: '#0f172a', fontWeight: 600, textAlign: 'left' }}>
                    {studioResult.optimizedTitleEn}
                  </div>
                </div>

                {/* 5 Bullet Points */}
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <span style={{ fontWeight: 800, fontSize: '13.5px', color: '#0f172a' }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s160', "النقاط البيعية الـ 5 الرئيسية (5 Key Product Features / Bullets):")}
                    </span>
                    <Button
                      variant="secondary"
                      onClick={() => handleCopy(studioResult.bulletPointsAr.join('\n• '), 'bulletsAr')}
                      style={{ fontSize: '11.5px', padding: '3px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      <CopyIcon size={12} />
                      <span>{copiedKey === 'bulletsAr' ? t('settings.workspace_sections.settings_marketplaces_section.s161', "تم النسخ!") : t('settings.workspace_sections.settings_marketplaces_section.s162', "نسخ كافة النقاط")}</span>
                    </Button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {studioResult.bulletPointsAr.map((bp, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', background: '#ffffff', padding: '8px 12px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '12.5px' }}>
                        <span style={{ background: '#170e5e', color: '#ffffff', width: '20px', height: '20px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, flexShrink: 0 }}>
                          {idx + 1}
                        </span>
                        <span style={{ color: '#334155', lineHeight: 1.5 }}>{bp}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Backend Keywords */}
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 800, fontSize: '13.5px', color: '#0f172a' }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s163', "الكلمات المفتاحية الخلفية (Amazon Backend Search Terms):")}
                    </span>
                    <Button
                      variant="secondary"
                      onClick={() => handleCopy(studioResult.backendKeywordsAr, 'keywordsAr')}
                      style={{ fontSize: '11.5px', padding: '3px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      <CopyIcon size={12} />
                      <span>{copiedKey === 'keywordsAr' ? t('settings.workspace_sections.settings_marketplaces_section.s164', "تم النسخ!") : t('settings.workspace_sections.settings_marketplaces_section.s165', "نسخ الكلمات")}</span>
                    </Button>
                  </div>
                  <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '8px 12px', fontSize: '12.5px', color: '#475569', fontFamily: 'monospace' }}>
                    {studioResult.backendKeywordsAr}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {studioProductId > 0 ? (
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                    {(() => {
                      const p = availableProducts.find((item) => Number(item.id) === studioProductId);
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <div style={{ fontWeight: 800, fontSize: '14px', color: '#0f172a' }}>
                            {t('settings.workspace_sections.settings_marketplaces_section.s166', "الصنف المختار:")} {p?.name || '—'}
                          </div>
                          <div style={{ fontSize: '12px', color: '#64748b' }}>
                            {t('settings.workspace_sections.settings_marketplaces_section.s167', "الباركود:")} <strong style={{ color: '#0f172a' }}>{p?.barcode || t('settings.workspace_sections.settings_marketplaces_section.s168', "غير مسجل")}</strong> {t('settings.workspace_sections.settings_marketplaces_section.s169', "| سعر البيع:")} <strong style={{ color: '#15803d' }}>{(p as any)?.retailPrice ?? (p as any)?.retail_price ?? 0} {t('settings.workspace_sections.settings_marketplaces_section.s170', "ج.م")}</strong> {t('settings.workspace_sections.settings_marketplaces_section.s171', "| تكلفة الشراء:")} <strong style={{ color: '#0369a1' }}>{(p as any)?.costPrice ?? (p as any)?.cost_price ?? 0} {t('settings.workspace_sections.settings_marketplaces_section.s172', "ج.م")}</strong>
                          </div>
                        </div>
                      );
                    })()}
                    <Button
                      variant="primary"
                      onClick={() => studioMutation.mutate(studioProductId)}
                      disabled={studioMutation.isPending}
                      style={{ background: '#170e5e', color: '#ffffff', minWidth: '160px' }}
                    >
                      {studioMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s173', "جاري التوليد والتحليل...") : t('settings.workspace_sections.settings_marketplaces_section.s174', "بدء التوليد الذكي للقائمة")}
                    </Button>
                  </div>
                ) : null}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: '#170e5e', marginBottom: '4px' }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s175', "صياغة العناوين التنافسية (SEO Titles)")}
                    </div>
                    <p style={{ margin: 0, fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s176', "توليد عناوين عربية وإنجليزية تجمع اسم الماركة، الموديل، اللون، والحجم لرفع نسبة النقر (CTR) مع الالتزام بحد الـ 200 حرف.")}
                    </p>
                  </div>

                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: '#15803d', marginBottom: '4px' }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s177', "النقاط البيعية الـ 5 المقنعة (Bullet Points)")}
                    </div>
                    <p style={{ margin: 0, fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s178', "صياغة 5 مميزات تفصيلية تركز على جودة الخامات وسهولة الاستخدام لحث المشتري على إتمام الطلب وزيادة التحويل.")}
                    </p>
                  </div>

                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: '#0369a1', marginBottom: '4px' }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s179', "الكلمات المفتاحية الخلفية (Backend Keywords)")}
                    </div>
                    <p style={{ margin: 0, fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s180', "استخراج الكلمات البحثية الأكثر صلة دون تكرار أو علامات ترقيم لتغذية خوارزمية محرك البحث A9 في أمازون ونون.")}
                    </p>
                  </div>
                </div>

                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '14px 18px' }}>
                  <div style={{ fontSize: '12.5px', fontWeight: 800, color: '#1e40af', marginBottom: '4px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s181', "شروط وقواعد إدراج المنتجات الرسمية لتفادي حظر القوائم (Listing Guidelines):")}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '8px', fontSize: '11.5px', color: '#1e3a8a', lineHeight: 1.5 }}>
                    <div>• <strong>{t('settings.workspace_sections.settings_marketplaces_section.s182', "العناوين:")}</strong> {t('settings.workspace_sections.settings_marketplaces_section.s183', "يُمنع كتابة عبارات تسويقية مثل (Best Seller أو 100% Free Shipping أو تخفيض).")}</div>
                    <div>• <strong>{t('settings.workspace_sections.settings_marketplaces_section.s184', "الصور الأساسية:")}</strong> {t('settings.workspace_sections.settings_marketplaces_section.s185', "خلفية بيضاء نقية تماماً (RGB: 255, 255, 255) بنسبة تغطية للمنتج لا تقل عن 85%.")}</div>
                    <div>• <strong>{t('settings.workspace_sections.settings_marketplaces_section.s186', "أبعاد الصورة:")}</strong> {t('settings.workspace_sections.settings_marketplaces_section.s187', "دقة لا تقل عن 1000 × 1000 بكسل لتفعيل خاصية التكبير التفاعلي (Zoom-in).")}</div>
                    <div>• <strong>{t('settings.workspace_sections.settings_marketplaces_section.s188', "الكلمات الخلفية:")}</strong> {t('settings.workspace_sections.settings_marketplaces_section.s189', "لا تكرر الكلمات الموجودة في العنوان، ولا تستخدم علامات ترقيم أو فواصل.")}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* ========================================================================= */}
      {/* TAB 3: INVENTORY SYNC, SKU MAPPING & REPRICER (مطابقة الأكواد وروبوت الأسعار) */}
      {/* ========================================================================= */}
      {activeTab === 'inventory' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Summary Strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
              <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s190', "إجمالي الأصناف المربوطة")}</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                {mappings.length}
              </div>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
              <div style={{ fontSize: '12px', color: '#15803d', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s191', "رابح لصندوق الشراء (Buy Box)")}</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#15803d', marginTop: '4px' }}>
                {winningCount}
              </div>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
              <div style={{ fontSize: '12px', color: '#b45309', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s192', "في خطر فقدان المبيعات")}</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#b45309', marginTop: '4px' }}>
                {atRiskCount}
              </div>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
              <div style={{ fontSize: '12px', color: '#b91c1c', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s193', "خاسر لصندوق الشراء")}</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#b91c1c', marginTop: '4px' }}>
                {losingCount}
              </div>
            </div>
          </div>

          {/* Table Card */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s194', "جدول مطابقة الأكواد (SKU Mapping) وتتبع أسعار المنافسين والـ Buy Box")}
                </h4>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s195', "مزامنة الأرصدة الحية، مراقبة أسعار المنافسين لنفس الـ ASIN، وتصدير شيتات الإكسيل الرسمية للرفع المباشر.")}
                </p>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <Button
                  variant="secondary"
                  onClick={() => setShowBulkImportModal(true)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}
                >
                  <UploadIcon size={14} />
                  <span>{t('settings.workspace_sections.settings_marketplaces_section.s196', "استيراد شيت (CSV / Excel)")}</span>
                </Button>

                <Button
                  variant="secondary"
                  onClick={() => handleExportFlatFile('amazon')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}
                >
                  <DownloadIcon size={14} />
                  <span>{t('settings.workspace_sections.settings_marketplaces_section.s197', "تصدير أمازون (TSV)")}</span>
                </Button>

                <Button
                  variant="secondary"
                  onClick={() => handleExportFlatFile('noon')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}
                >
                  <DownloadIcon size={14} />
                  <span>{t('settings.workspace_sections.settings_marketplaces_section.s198', "تصدير نون (CSV)")}</span>
                </Button>

                <Button
                  variant="secondary"
                  onClick={() => liveSyncMutation.mutate(undefined)}
                  disabled={liveSyncMutation.isPending || !mappings.length}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}
                >
                  <RefreshCwIcon size={14} />
                  <span>{liveSyncMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s199', "جاري البث...") : t('settings.workspace_sections.settings_marketplaces_section.s200', "بث لحظي للمخزون")}</span>
                </Button>

                <Button
                  variant="secondary"
                  onClick={() => runRepricingMutation.mutate(selectedInventoryPlatform === 'all' ? undefined : selectedInventoryPlatform)}
                  disabled={runRepricingMutation.isPending || !mappings.length}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', borderColor: '#cbd5e1' }}
                  title={t('settings.workspace_sections.settings_marketplaces_section.s201', "تشغيل روبوت إعادة التسعير الآلي لمطابقة أو النزول عن الـ Buy Box")}
                >
                  <SlidersIcon size={14} />
                  <span>{runRepricingMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s202', "جاري الرصد والتسعير...") : t('settings.workspace_sections.settings_marketplaces_section.s203', "تشغيل روبوت التسعير")}</span>
                </Button>

                <Button
                  variant="primary"
                  onClick={() => setShowAddModal(true)}
                  style={{ background: '#170e5e', color: '#ffffff', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
                >
                  <PlusIcon size={14} />
                  <span>{t('settings.workspace_sections.settings_marketplaces_section.s204', "ربط صنف جديد")}</span>
                </Button>
              </div>
            </div>

            {/* Platform Filter Filter Pills */}
            <div style={{ display: 'flex', gap: '6px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
              {(['all', 'amazon', 'noon', 'jumia', 'trendyol'] as const).map((plt) => (
                <button
                  key={plt}
                  type="button"
                  onClick={() => setSelectedInventoryPlatform(plt)}
                  style={{
                    border: 'none',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 600,
                    background: selectedInventoryPlatform === plt ? '#170e5e' : '#f1f5f9',
                    color: selectedInventoryPlatform === plt ? '#ffffff' : '#64748b',
                    cursor: 'pointer',
                  }}
                >
                  {plt === 'all'
                    ? t('settings.workspace_sections.settings_marketplaces_section.s205', "الكل")
                    : plt === 'amazon'
                    ? t('settings.workspace_sections.settings_marketplaces_section.s206', "أمازون")
                    : plt === 'noon'
                    ? t('settings.workspace_sections.settings_marketplaces_section.s207', "نون")
                    : plt === 'jumia'
                    ? t('settings.workspace_sections.settings_marketplaces_section.s208', "جوميا")
                    : t('settings.workspace_sections.settings_marketplaces_section.s209', "ترينديول")}
                </button>
              ))}
            </div>

            {mappingsQuery.isLoading ? (
              <div style={{ textAlign: 'center', padding: '30px', color: '#94a3b8' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s210', "جاري تحميل جدول مطابقة الأكواد...")}
              </div>
            ) : !filteredMappings.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ textAlign: 'center', padding: '36px 20px', background: '#f8fafc', borderRadius: '10px', border: '1px dashed #cbd5e1', color: '#64748b' }}>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
                    <LinkIcon size={32} color="#94a3b8" />
                  </div>
                  <div style={{ fontWeight: 800, fontSize: '15px', color: '#0f172a' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s211', "لا توجد أصناف مربوطة حالياً في قسم")} {selectedInventoryPlatform === 'all' ? t('settings.workspace_sections.settings_marketplaces_section.s212', "المنصات") : selectedInventoryPlatform === 'amazon' ? t('settings.workspace_sections.settings_marketplaces_section.s213', "أمازون") : selectedInventoryPlatform === 'noon' ? t('settings.workspace_sections.settings_marketplaces_section.s214', "نون") : selectedInventoryPlatform === 'jumia' ? t('settings.workspace_sections.settings_marketplaces_section.s215', "جوميا") : t('settings.workspace_sections.settings_marketplaces_section.s216', "ترينديول")}
                  </div>
                  <p style={{ fontSize: '12.5px', color: '#64748b', maxWidth: '520px', margin: '6px auto 16px', lineHeight: 1.5 }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s217', "ابدأ بربط أصناف الـ ERP مع أكواد ASIN أو Partner SKU لمزامنة الأرصدة وتفعيل روبوت تتبع أسعار المنافسين والـ Buy Box تلقائياً.")}
                  </p>

                  <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <Button
                      variant="primary"
                      onClick={() => setShowAddModal(true)}
                      style={{ background: '#170e5e', color: '#ffffff', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px' }}
                    >
                      <PlusIcon size={14} />
                      <span>{t('settings.workspace_sections.settings_marketplaces_section.s218', "ربط صنف جديد الآن")}</span>
                    </Button>

                    <Button
                      variant="secondary"
                      onClick={() => setShowBulkImportModal(true)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px' }}
                    >
                      <UploadIcon size={14} />
                      <span>{t('settings.workspace_sections.settings_marketplaces_section.s219', "استيراد شيت مجمع (CSV / Excel)")}</span>
                    </Button>

                    <Button
                      variant="secondary"
                      onClick={handleDownloadSampleMappingTemplate}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px' }}
                    >
                      <DownloadIcon size={14} />
                      <span>{t('settings.workspace_sections.settings_marketplaces_section.s220', "تحميل نموذج الشيت التجريبي (.CSV)")}</span>
                    </Button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 16px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: '#170e5e', marginBottom: '4px' }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s221', "1. مزامنة الأرصدة الحية")}
                    </div>
                    <p style={{ margin: 0, fontSize: '11.5px', color: '#64748b', lineHeight: 1.5 }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s222', "تحديث المخزون على المنصات فور حدوث أي بيع محلي في الكاشير أو المناديب لتجنب غرامات إلغاء الطلبات (Cancellation Rate).")}
                    </p>
                  </div>

                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 16px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: '#15803d', marginBottom: '4px' }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s223', "2. روبوت تتبع الـ Buy Box")}
                    </div>
                    <p style={{ margin: 0, fontSize: '11.5px', color: '#64748b', lineHeight: 1.5 }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s224', "مراقبة عروض المنافسين لحظياً وإعادة التسعير الذكي بإنقاص جنيه أو نسبة محددة مع الالتزام بالحد الأدنى لحماية أرباحك.")}
                    </p>
                  </div>

                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 16px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: '#0369a1', marginBottom: '4px' }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s225', "3. تصدير ملفات الرفع الرسمية")}
                    </div>
                    <p style={{ margin: 0, fontSize: '11.5px', color: '#64748b', lineHeight: 1.5 }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s226', "تصدير شيتات Inventory Loader لأمازون (TSV) ونون (CSV) معدة مسبقاً بالأعمدة الرسمية لرفع آلاف الأصناف بضغطة زر.")}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12.5px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                      <th style={{ padding: '10px 12px', fontWeight: 700 }}>{t('settings.workspace_sections.settings_marketplaces_section.s227', "اسم الصنف والتكلفة بالـ ERP")}</th>
                      <th style={{ padding: '10px 12px', fontWeight: 700 }}>{t('settings.workspace_sections.settings_marketplaces_section.s228', "المنصة")}</th>
                      <th style={{ padding: '10px 12px', fontWeight: 700 }}>{t('settings.workspace_sections.settings_marketplaces_section.s229', "كود المنصة (ASIN / SKU)")}</th>
                      <th style={{ padding: '10px 12px', fontWeight: 700 }}>{t('settings.workspace_sections.settings_marketplaces_section.s230', "رصيد المخزن")}</th>
                      <th style={{ padding: '10px 12px', fontWeight: 700 }}>{t('settings.workspace_sections.settings_marketplaces_section.s231', "سعرنا على المنصة")}</th>
                      <th style={{ padding: '10px 12px', fontWeight: 700 }}>{t('settings.workspace_sections.settings_marketplaces_section.s232', "سعر المنافس / Buy Box")}</th>
                      <th style={{ padding: '10px 12px', fontWeight: 700 }}>{t('settings.workspace_sections.settings_marketplaces_section.s233', "حالة صندوق الشراء")}</th>
                      <th style={{ padding: '10px 12px', fontWeight: 700, textAlign: 'center' }}>{t('settings.workspace_sections.settings_marketplaces_section.s234', "إجراءات")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMappings.map((m) => (
                      <tr key={m.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '12px' }}>
                          <div style={{ fontWeight: 700, color: '#0f172a' }}>{m.productName}</div>
                          <div style={{ fontSize: '11px', color: '#64748b' }}>
                            {t('settings.workspace_sections.settings_marketplaces_section.s235', "تكلفة:")} {m.costPrice || 0} {t('settings.workspace_sections.settings_marketplaces_section.s236', "ج.م | بيع محلي:")} {m.retailPrice || 0} {t('settings.workspace_sections.settings_marketplaces_section.s237', "ج.م")}
                          </div>
                        </td>

                        <td style={{ padding: '12px' }}>
                          <span
                            style={{
                              background:
                                m.marketplace === 'amazon'
                                  ? '#fef3c7'
                                  : m.marketplace === 'noon'
                                  ? '#fef9c3'
                                  : m.marketplace === 'jumia'
                                  ? '#ffedd5'
                                  : '#e0e7ff',
                              color:
                                m.marketplace === 'amazon'
                                  ? '#92400e'
                                  : m.marketplace === 'noon'
                                  ? '#854d0e'
                                  : m.marketplace === 'jumia'
                                  ? '#9a3412'
                                  : '#3730a3',
                              padding: '2px 8px',
                              borderRadius: '6px',
                              fontWeight: 700,
                              fontSize: '11px',
                            }}
                          >
                            {m.marketplace.toUpperCase()}
                          </span>
                        </td>

                        <td style={{ padding: '12px', fontFamily: 'monospace', fontWeight: 700, color: '#170e5e' }}>
                          {m.marketplaceSku}
                        </td>

                        <td style={{ padding: '12px', fontWeight: 800, color: '#0f172a' }}>
                          {m.currentLocalStock ?? 0} {t('settings.workspace_sections.settings_marketplaces_section.s238', "قطعة")}
                        </td>

                        <td style={{ padding: '12px', fontWeight: 800, color: '#170e5e' }}>
                          {m.customPrice ? `${m.customPrice} ج.م (مخصص)` : `${m.retailPrice || 0} ج.م`}
                        </td>

                        <td style={{ padding: '12px' }}>
                          {m.buyBoxPrice ? (
                            <div style={{ fontWeight: 700, color: '#0f172a' }}>
                              {m.buyBoxPrice} {t('settings.workspace_sections.settings_marketplaces_section.s239', "ج.م")}
                            </div>
                          ) : (
                            <span style={{ color: '#94a3b8', fontSize: '11px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s240', "غير مسجل")}</span>
                          )}
                          {m.competitorPrice ? (
                            <div style={{ fontSize: '11px', color: '#64748b' }}>
                              {t('settings.workspace_sections.settings_marketplaces_section.s241', "المنافس:")} {m.competitorPrice} {t('settings.workspace_sections.settings_marketplaces_section.s242', "ج.م")}
                            </div>
                          ) : null}
                        </td>

                        <td style={{ padding: '12px' }}>
                          {m.buyBoxStatus === 'winning' ? (
                            <span style={{ background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              <CheckIcon size={11} color="#15803d" strokeWidth={2.5} />
                              <span>{t('settings.workspace_sections.settings_marketplaces_section.s243', "رابح للـ Buy Box")}</span>
                            </span>
                          ) : m.buyBoxStatus === 'at_risk' ? (
                            <span style={{ background: '#fefce8', color: '#a16207', border: '1px solid #fef08a', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700 }}>
                              {t('settings.workspace_sections.settings_marketplaces_section.s244', "في خطر (+5%)")}
                            </span>
                          ) : m.buyBoxStatus === 'losing' ? (
                            <span style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700 }}>
                              {t('settings.workspace_sections.settings_marketplaces_section.s245', "خاسر لصندوق الشراء")}
                            </span>
                          ) : (
                            <span style={{ background: '#f8fafc', color: '#64748b', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600 }}>
                              {t('settings.workspace_sections.settings_marketplaces_section.s246', "متزامن")}
                            </span>
                          )}
                          {m.repricingEnabled ? (
                            <div style={{ marginTop: '4px' }}>
                              <span style={{ background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', padding: '1px 6px', borderRadius: '4px', fontSize: '10.5px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                <span>{t('settings.workspace_sections.settings_marketplaces_section.s247', "روبوت:")} {m.minPrice ? `${m.minPrice}` : '0'}-{m.maxPrice ? `${m.maxPrice}` : '∞'} {t('settings.workspace_sections.settings_marketplaces_section.s248', "ج.م")}</span>
                              </span>
                            </div>
                          ) : null}
                        </td>

                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center' }}>
                            <Button
                              variant="secondary"
                              onClick={() => {
                                setEditPriceModal(m);
                                setEditCompetitorPrice(m.competitorPrice ? String(m.competitorPrice) : '');
                                setEditBuyBoxPrice(m.buyBoxPrice ? String(m.buyBoxPrice) : '');
                              }}
                              style={{ fontSize: '11px', padding: '3px 8px' }}
                            >
                              {t('settings.workspace_sections.settings_marketplaces_section.s249', "تعديل المنافسة")}
                            </Button>

                            <Button
                              variant="secondary"
                              onClick={() => {
                                setEditRepricingModal(m);
                                setRepricingForm({
                                  repricingEnabled: m.repricingEnabled ?? false,
                                  minPrice: m.minPrice ? String(m.minPrice) : '',
                                  maxPrice: m.maxPrice ? String(m.maxPrice) : '',
                                  repricingRule: (m.repricingRule as any) ?? 'undercut_buy_box',
                                  repricingDelta: m.repricingDelta ? String(m.repricingDelta) : '1',
                                });
                              }}
                              style={{
                                fontSize: '11px',
                                padding: '3px 8px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                background: m.repricingEnabled ? '#f0fdf4' : undefined,
                                borderColor: m.repricingEnabled ? '#86efac' : undefined,
                                color: m.repricingEnabled ? '#15803d' : undefined,
                              }}
                              title={t('settings.workspace_sections.settings_marketplaces_section.s250', "إعدادات وقواعد روبوت إعادة التسعير الآلي للـ Buy Box")}
                            >
                              <SlidersIcon size={12} />
                              <span>{m.repricingEnabled ? t('settings.workspace_sections.settings_marketplaces_section.s251', "الروبوت نشط") : t('settings.workspace_sections.settings_marketplaces_section.s252', "قواعد الروبوت")}</span>
                            </Button>

                            <Button
                              variant="secondary"
                              onClick={() => {
                                setPrintFnskuModal({
                                  productName: m.productName || t('settings.workspace_sections.settings_marketplaces_section.s253', "صنف ماركت بليس"),
                                  marketplaceSku: m.marketplaceSku,
                                  barcode: m.barcode,
                                  condition: 'NEW',
                                  marketplace: m.marketplace,
                                  format: 'thermal_50x30',
                                  copies: 1,
                                });
                              }}
                              style={{ fontSize: '11px', padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                              title={t('settings.workspace_sections.settings_marketplaces_section.s254', "طباعة ملصق وباركود FNSKU الحراري للصنف")}
                            >
                              <PrinterIcon size={12} />
                              <span>{t('settings.workspace_sections.settings_marketplaces_section.s255', "طباعة FNSKU")}</span>
                            </Button>

                            <Button
                              variant="danger"
                              onClick={() => deleteMappingMutation.mutate(m.id)}
                              style={{ fontSize: '11px', padding: '3px 8px' }}
                            >
                              {t('settings.workspace_sections.settings_marketplaces_section.s256', "إلغاء الربط")}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* ========================================================================= */}
      {/* TAB: FBA / FBN INBOUND SHIPMENTS WORKFLOW */}
      {/* ========================================================================= */}
      {activeTab === 'inbound' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Summary KPI Cards */}
          {(() => {
            const list = inboundShipmentsQuery.data || [];
            const totalShipments = list.length;
            const amazonCount = list.filter((s) => s.marketplace === 'amazon').length;
            const noonCount = list.filter((s) => s.marketplace === 'noon').length;
            const totalUnits = list.reduce((sum, s) => sum + (s.totalUnits || 0), 0);
            const totalBoxes = list.reduce((sum, s) => sum + (s.totalBoxes || 0), 0);

            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '12px' }}>
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
                  <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s257', "إجمالي أذونات التوريد للمستودعات")}</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                    {totalShipments} <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>{t('settings.workspace_sections.settings_marketplaces_section.s258', "شحنة")}</span>
                  </div>
                </div>

                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
                  <div style={{ fontSize: '12px', color: '#92400e', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s259', "شحنات أمازون FBA")}</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#92400e', marginTop: '4px' }}>
                    {amazonCount} <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>{t('settings.workspace_sections.settings_marketplaces_section.s260', "إذن شحن")}</span>
                  </div>
                </div>

                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
                  <div style={{ fontSize: '12px', color: '#854d0e', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s261', "شحنات نون FBN")}</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#854d0e', marginTop: '4px' }}>
                    {noonCount} <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>{t('settings.workspace_sections.settings_marketplaces_section.s262', "إذن شحن")}</span>
                  </div>
                </div>

                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
                  <div style={{ fontSize: '12px', color: '#15803d', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s263', "إجمالي القطع المشحونة للمراكز")}</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#15803d', marginTop: '4px' }}>
                    {totalUnits.toLocaleString('en-US')} <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>{t('settings.workspace_sections.settings_marketplaces_section.s264', "قطعة (")}{totalBoxes} {t('settings.workspace_sections.settings_marketplaces_section.s265', "كرتونة)")}</span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Main Card */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <TruckIcon size={18} color="#170e5e" />
                  <span>{t('settings.workspace_sections.settings_marketplaces_section.s266', "أذونات الشحن والتوريد لمستودعات FBA و FBN")}</span>
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s267', "إدارة وتجهيز الشحنات المرسلة لمراكز Fulfillment By Amazon و Fulfillment By Noon، حجز المخزون، وتصدير كشوف التعبئة للكراتين (Packing Slips).")}
                </p>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <Button
                  variant="primary"
                  onClick={() => setShowInboundModal(true)}
                  style={{ background: '#170e5e', color: '#ffffff', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px' }}
                >
                  <PlusIcon size={14} />
                  <span>{t('settings.workspace_sections.settings_marketplaces_section.s268', "إنشاء إذن توريد جديد (FBA/FBN)")}</span>
                </Button>
              </div>
            </div>

            {/* Inbound Shipments Table */}
            {inboundShipmentsQuery.isLoading ? (
              <div style={{ textAlign: 'center', padding: '36px', color: '#64748b' }}>{t('settings.workspace_sections.settings_marketplaces_section.s269', "جاري تحميل أذونات التوريد...")}</div>
            ) : !inboundShipmentsQuery.data || inboundShipmentsQuery.data.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ textAlign: 'center', padding: '36px 20px', background: '#f8fafc', borderRadius: '10px', border: '1px dashed #cbd5e1' }}>
                  <TruckIcon size={32} color="#94a3b8" style={{ margin: '0 auto 8px', display: 'block' }} />
                  <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '15px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s270', "لا توجد أذونات شحن أو توريد مسجلة حتى الآن")}</div>
                  <p style={{ fontSize: '12.5px', color: '#64748b', maxWidth: '540px', margin: '6px auto 16px', lineHeight: 1.5 }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s271', "يمكنك إنشاء إذن توريد جديد لحجز المخزون من مستودعك المحلي وتصدير ملصقات الكراتين المتوافقة مع مراكز توزيع أمازون FBA ونون FBN.")}
                  </p>
                  <Button
                    variant="primary"
                    onClick={() => setShowInboundModal(true)}
                    style={{ background: '#170e5e', color: '#ffffff', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px' }}
                  >
                    <PlusIcon size={14} />
                    <span>{t('settings.workspace_sections.settings_marketplaces_section.s272', "إنشاء أول إذن توريد الآن (FBA/FBN)")}</span>
                  </Button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#170e5e', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 800 }}>1</span>
                      <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>{t('settings.workspace_sections.settings_marketplaces_section.s273', "حجز المخزون المحلي")}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: '11.5px', color: '#64748b', lineHeight: 1.5 }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s274', "إنشاء الإذن يحجز الكميات المحددة فوراً داخل الـ ERP لحمايتها من البيع في الفروع أو الكاشير.")}
                    </p>
                  </div>

                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#170e5e', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 800 }}>2</span>
                      <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>{t('settings.workspace_sections.settings_marketplaces_section.s275', "توزيع الكراتين والوجهة")}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: '11.5px', color: '#64748b', lineHeight: 1.5 }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s276', "تحديد مركز الشحن (مثل مستودع أمازون العاشر من رمضان CAI1 أو نون EG01) وتوزيع القطع بالكرتونة.")}
                    </p>
                  </div>

                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#170e5e', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 800 }}>3</span>
                      <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>{t('settings.workspace_sections.settings_marketplaces_section.s277', "كشف التعبئة وبوليصة الكرتونة")}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: '11.5px', color: '#64748b', lineHeight: 1.5 }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s278', "طباعة كشف المحتويات الرسمي (Packing Slip) وملصقات الكراتين الخارجية للتحقق عند الاستلام.")}
                    </p>
                  </div>

                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#170e5e', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 800 }}>4</span>
                      <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>{t('settings.workspace_sections.settings_marketplaces_section.s279', "طباعة باركود القطع FNSKU")}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: '11.5px', color: '#64748b', lineHeight: 1.5 }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s280', "توليد باركودات القطع الحرارية بمقاس 50x30 أو 40x25 ولصقها على كل وحدة قبل الإغلاق.")}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12.5px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                      <th style={{ padding: '10px 12px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s281', "رقم الإذن")}</th>
                      <th style={{ padding: '10px 12px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s282', "المنصة والوجهة")}</th>
                      <th style={{ padding: '10px 12px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s283', "مركز التوزيع (FC)")}</th>
                      <th style={{ padding: '10px 12px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s284', "الكراتين / القطع")}</th>
                      <th style={{ padding: '10px 12px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s285', "رقم التتبع / البوليصة")}</th>
                      <th style={{ padding: '10px 12px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s286', "الحالة")}</th>
                      <th style={{ padding: '10px 12px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s287', "تاريخ الإنشاء")}</th>
                      <th style={{ padding: '10px 12px', textAlign: 'center' }}>{t('settings.workspace_sections.settings_marketplaces_section.s288', "كشف التعبئة")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inboundShipmentsQuery.data.map((shipment) => (
                      <tr key={shipment.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '12px', fontWeight: 800, color: '#170e5e', fontFamily: 'monospace' }}>
                          {shipment.shipmentNumber}
                        </td>

                        <td style={{ padding: '12px' }}>
                          <span
                            style={{
                              background: shipment.marketplace === 'amazon' ? '#fef3c7' : '#fef9c3',
                              color: shipment.marketplace === 'amazon' ? '#92400e' : '#854d0e',
                              padding: '2px 8px',
                              borderRadius: '6px',
                              fontWeight: 700,
                              fontSize: '11px',
                            }}
                          >
                            {shipment.marketplace === 'amazon' ? t('settings.workspace_sections.settings_marketplaces_section.s289', "أمازون FBA") : t('settings.workspace_sections.settings_marketplaces_section.s290', "نون FBN")}
                          </span>
                        </td>

                        <td style={{ padding: '12px', fontWeight: 600, color: '#334155' }}>
                          {shipment.fulfillmentCenterId}
                        </td>

                        <td style={{ padding: '12px' }}>
                          <span style={{ fontWeight: 800, color: '#0f172a' }}>{shipment.totalUnits} {t('settings.workspace_sections.settings_marketplaces_section.s291', "قطعة")}</span>
                          <span style={{ color: '#64748b', fontSize: '11.5px', marginRight: '6px' }}>({shipment.totalBoxes} {t('settings.workspace_sections.settings_marketplaces_section.s292', "كرتونة)")}</span>
                        </td>

                        <td style={{ padding: '12px', fontFamily: 'monospace', color: shipment.trackingNumber ? '#0f172a' : '#94a3b8' }}>
                          {shipment.trackingNumber || '—'}
                        </td>

                        <td style={{ padding: '12px' }}>
                          {shipment.status === 'draft' ? (
                            <span style={{ background: '#f8fafc', color: '#64748b', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600 }}>
                              {t('settings.workspace_sections.settings_marketplaces_section.s293', "مسودة وتجهيز")}
                            </span>
                          ) : shipment.status === 'shipped' ? (
                            <span style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700 }}>
                              {t('settings.workspace_sections.settings_marketplaces_section.s294', "تم الشحن في الطريق")}
                            </span>
                          ) : (shipment.totalDiscrepancyUnits || 0) > 0 ? (
                            <div>
                              <span style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, display: 'inline-block' }}>
                                {t('settings.workspace_sections.settings_marketplaces_section.s295', "عجز:")} {shipment.totalDiscrepancyUnits} {t('settings.workspace_sections.settings_marketplaces_section.s296', "قطعة (")}{shipment.discrepancyLossAmount || 0} {t('settings.workspace_sections.settings_marketplaces_section.s297', "ج.م)")}
                              </span>
                              <div style={{ marginTop: '3px' }}>
                                <button
                                  type="button"
                                  onClick={() => loadClaimReportMutation.mutate(shipment.id)}
                                  style={{ border: 'none', background: 'transparent', color: '#b91c1c', textDecoration: 'underline', cursor: 'pointer', fontSize: '11px', fontWeight: 700 }}
                                >
                                  {t('settings.workspace_sections.settings_marketplaces_section.s298', "تقرير المطالبة بالتعويض")}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <span style={{ background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700 }}>
                              {t('settings.workspace_sections.settings_marketplaces_section.s299', "تم الاستلام بالكامل")}
                            </span>
                          )}
                        </td>

                        <td style={{ padding: '12px', color: '#64748b', fontSize: '11.5px' }}>
                          {formatDateTimeArabic(shipment.createdAt)}
                        </td>

                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: '5px', justifyContent: 'center', flexWrap: 'wrap' }}>
                            <Button
                              variant="secondary"
                              onClick={() => {
                                const initItems: { [sku: string]: string } = {};
                                shipment.items.forEach((it) => {
                                  initItems[it.marketplaceSku] = String(it.quantityReceived ?? it.quantityShipped);
                                });
                                setReceiveFormItems(initItems);
                                setReceiveShipmentModal(shipment);
                              }}
                              style={{ fontSize: '11px', padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                              title={t('settings.workspace_sections.settings_marketplaces_section.s300', "تسجيل الفحص ومطابقة الكميات المستلمة في مستودع المنصة")}
                            >
                              <CheckIcon size={12} />
                              <span>{shipment.status === 'received' ? t('settings.workspace_sections.settings_marketplaces_section.s301', "تعديل الفحص") : t('settings.workspace_sections.settings_marketplaces_section.s302', "فحص واستلام")}</span>
                            </Button>

                            <Button
                              variant="secondary"
                              onClick={() => {
                                const firstItem = shipment.items[0];
                                setPrintFnskuModal({
                                  productName: firstItem?.productName || shipment.shipmentNumber,
                                  marketplaceSku: firstItem?.marketplaceSku || shipment.shipmentNumber,
                                  barcode: firstItem?.barcode,
                                  condition: 'NEW',
                                  marketplace: shipment.marketplace,
                                  format: 'thermal_50x30',
                                  copies: firstItem?.quantityShipped || 10,
                                });
                              }}
                              style={{ fontSize: '11px', padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                              title={t('settings.workspace_sections.settings_marketplaces_section.s303', "طباعة ملصقات وباركودات FNSKU للقطع المشحونة")}
                            >
                              <PrinterIcon size={12} />
                              <span>{t('settings.workspace_sections.settings_marketplaces_section.s304', "طباعة FNSKU")}</span>
                            </Button>

                            <Button
                              variant="secondary"
                              onClick={() => handleExportPackingSlip(shipment.id)}
                              style={{ fontSize: '11px', padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                              title={t('settings.workspace_sections.settings_marketplaces_section.s305', "تحميل كشف التعبئة المخصص لكراتين المنصة")}
                            >
                              <DownloadIcon size={12} />
                              <span>{t('settings.workspace_sections.settings_marketplaces_section.s306', "كشف التعبئة")}</span>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* ========================================================================= */}
      {/* TAB: SETTLEMENT RECONCILIATION & DOUBLE-ENTRY GL POSTING */}
      {/* ========================================================================= */}
      {activeTab === 'settlements' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Summary Strip */}
          {(() => {
            const list = settlementsQuery.data || [];
            const gross = list.reduce((sum, s) => sum + Number(s.grossSales || 0), 0);
            const referral = list.reduce((sum, s) => sum + Number(s.referralFees || 0), 0);
            const fulfillment = list.reduce((sum, s) => sum + Number(s.fulfillmentFees || 0), 0);
            const net = list.reduce((sum, s) => sum + Number(s.netPayout || 0), 0);
            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
                  <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s307', "إجمالي مبيعات المنصات المسواة")}</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                    {gross.toLocaleString('en-US', { minimumFractionDigits: 2 })} <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>{t('settings.workspace_sections.settings_marketplaces_section.s308', "ج.م")}</span>
                  </div>
                </div>

                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
                  <div style={{ fontSize: '12px', color: '#b45309', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s309', "إجمالي عمولات ورسوم البيع")}</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#b45309', marginTop: '4px' }}>
                    {referral.toLocaleString('en-US', { minimumFractionDigits: 2 })} <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>{t('settings.workspace_sections.settings_marketplaces_section.s310', "ج.م")}</span>
                  </div>
                </div>

                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
                  <div style={{ fontSize: '12px', color: '#6366f1', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s311', "مصاريف الشحن والتخزين (FBA/FBN)")}</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#6366f1', marginTop: '4px' }}>
                    {fulfillment.toLocaleString('en-US', { minimumFractionDigits: 2 })} <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>{t('settings.workspace_sections.settings_marketplaces_section.s312', "ج.م")}</span>
                  </div>
                </div>

                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
                  <div style={{ fontSize: '12px', color: '#15803d', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s313', "صافي الإيداعات البنكية المسجلة")}</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#15803d', marginTop: '4px' }}>
                    {net.toLocaleString('en-US', { minimumFractionDigits: 2 })} <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>{t('settings.workspace_sections.settings_marketplaces_section.s314', "ج.م")}</span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Table Card */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s315', "كشوف حسابات الماركت بليس والتسوية المحاسبية والقيود اليومية")}
                </h4>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s316', "تسوية مبالغ إيداعات البنك الدورية، فك تشابك الخصومات والعمولات، وتوليد قيود محاسبية مزدوجة متزنة برقم رسمي.")}
                </p>
              </div>

              <Button
                variant="primary"
                onClick={() => setShowReconcileModal(true)}
                style={{ background: '#170e5e', color: '#ffffff', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px' }}
              >
                <PlusIcon size={14} />
                <span>{t('settings.workspace_sections.settings_marketplaces_section.s317', "تسوية كشف حساب جديد وإنشاء القيد")}</span>
              </Button>
            </div>

            {/* Platform Filter Pills */}
            <div style={{ display: 'flex', gap: '6px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
              {(['all', 'amazon', 'noon', 'jumia', 'trendyol'] as const).map((plt) => (
                <button
                  key={plt}
                  type="button"
                  onClick={() => setSelectedSettlementPlatform(plt)}
                  style={{
                    border: 'none',
                    padding: '4px 12px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: selectedSettlementPlatform === plt ? 700 : 500,
                    background: selectedSettlementPlatform === plt ? '#170e5e' : '#f8fafc',
                    color: selectedSettlementPlatform === plt ? '#ffffff' : '#64748b',
                    cursor: 'pointer',
                  }}
                >
                  {plt === 'all' && t('settings.workspace_sections.settings_marketplaces_section.s318', "الكل")}
                  {plt === 'amazon' && t('settings.workspace_sections.settings_marketplaces_section.s319', "أمازون (Amazon)")}
                  {plt === 'noon' && t('settings.workspace_sections.settings_marketplaces_section.s320', "نون (Noon)")}
                  {plt === 'jumia' && t('settings.workspace_sections.settings_marketplaces_section.s321', "جوميا (Jumia)")}
                  {plt === 'trendyol' && t('settings.workspace_sections.settings_marketplaces_section.s322', "ترينديول (Trendyol)")}
                </button>
              ))}
            </div>

            {/* Settlements Table */}
            {(() => {
              const allList = settlementsQuery.data || [];
              const filtered = selectedSettlementPlatform === 'all'
                ? allList
                : allList.filter((s) => s.marketplace === selectedSettlementPlatform);

              if (settlementsQuery.isLoading) {
                return (
                  <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s323', "جاري تحميل سجل كشوف الحسابات...")}
                  </div>
                );
              }

              if (!filtered.length) {
                return (
                  <div style={{ padding: '40px 20px', textAlign: 'center', background: '#f8fafc', borderRadius: '10px', border: '1px dashed #cbd5e1' }}>
                    <ReceiptIcon size={36} color="#94a3b8" />
                    <div style={{ marginTop: '10px', fontWeight: 700, fontSize: '14px', color: '#334155' }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s324', "لا توجد كشوف حسابات مسواة حتى الآن")}
                    </div>
                    <div style={{ marginTop: '4px', fontSize: '12.5px', color: '#64748b', maxWidth: '420px', marginInline: 'auto' }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s325', "عند استلام كشف الحساب البنكي من أمازون أو نون، اضغط على «تسوية كشف حساب جديد» لتوليد القيد المالي المزدوج آلياً وربط المبيعات بالحساب البنكي.")}
                    </div>
                  </div>
                );
              }

              return (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12.5px' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '12px' }}>
                        <th style={{ padding: '10px 12px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s326', "المنصة")}</th>
                        <th style={{ padding: '10px 12px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s327', "رقم كشف الحساب")}</th>
                        <th style={{ padding: '10px 12px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s328', "الفترة الزمنية")}</th>
                        <th style={{ padding: '10px 12px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s329', "إجمالي المبيعات")}</th>
                        <th style={{ padding: '10px 12px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s330', "عمولة البيع")}</th>
                        <th style={{ padding: '10px 12px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s331', "الشحن والتخزين")}</th>
                        <th style={{ padding: '10px 12px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s332', "المرتجعات والتسويات")}</th>
                        <th style={{ padding: '10px 12px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s333', "صافي المستلم بالبنك")}</th>
                        <th style={{ padding: '10px 12px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s334', "رقم القيد اليومي")}</th>
                        <th style={{ padding: '10px 12px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s335', "تاريخ التسوية")}</th>
                        <th style={{ padding: '10px 12px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s336', "الحالة")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((s) => (
                        <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '12px' }}>
                            <span
                              style={{
                                padding: '3px 8px',
                                borderRadius: '6px',
                                fontSize: '11px',
                                fontWeight: 700,
                                background:
                                  s.marketplace === 'amazon'
                                    ? '#fef3c7'
                                    : s.marketplace === 'noon'
                                    ? '#fef9c3'
                                    : s.marketplace === 'jumia'
                                    ? '#fed7aa'
                                    : '#e0e7ff',
                                color:
                                  s.marketplace === 'amazon'
                                    ? '#92400e'
                                    : s.marketplace === 'noon'
                                    ? '#854d0e'
                                    : s.marketplace === 'jumia'
                                    ? '#c2410c'
                                    : '#3730a3',
                              }}
                            >
                              {s.marketplace.toUpperCase()}
                            </span>
                          </td>
                          <td style={{ padding: '12px', fontWeight: 700, color: '#0f172a' }}>
                            {s.settlementId}
                          </td>
                          <td style={{ padding: '12px', color: '#64748b' }}>
                            {s.periodStart} {t('settings.workspace_sections.settings_marketplaces_section.s337', "إلى")} {s.periodEnd}
                          </td>
                          <td style={{ padding: '12px', fontWeight: 700, color: '#0f172a' }}>
                            {Number(s.grossSales).toLocaleString('en-US', { minimumFractionDigits: 2 })} {s.currency || t('settings.workspace_sections.settings_marketplaces_section.s338', "ج.م")}
                          </td>
                          <td style={{ padding: '12px', color: '#b45309', fontWeight: 600 }}>
                            -{Number(s.referralFees).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </td>
                          <td style={{ padding: '12px', color: '#6366f1', fontWeight: 600 }}>
                            -{Number(s.fulfillmentFees).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </td>
                          <td style={{ padding: '12px', color: '#b91c1c' }}>
                            -{(Number(s.refunds || 0) + Number(s.storageOrOtherFees || 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </td>
                          <td style={{ padding: '12px', fontWeight: 800, color: '#15803d', fontSize: '13px' }}>
                            {Number(s.netPayout).toLocaleString('en-US', { minimumFractionDigits: 2 })} {s.currency || t('settings.workspace_sections.settings_marketplaces_section.s339', "ج.م")}
                          </td>
                          <td style={{ padding: '12px' }}>
                            {s.journalEntryNo ? (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  background: '#ecfdf5',
                                  color: '#065f46',
                                  padding: '3px 8px',
                                  borderRadius: '6px',
                                  fontFamily: 'monospace',
                                  fontWeight: 700,
                                  fontSize: '11.5px',
                                  border: '1px solid #a7f3d0',
                                }}
                              >
                                <CheckIcon size={12} />
                                <span>{s.journalEntryNo}</span>
                              </span>
                            ) : (
                              <span style={{ color: '#94a3b8' }}>—</span>
                            )}
                          </td>
                          <td style={{ padding: '12px', color: '#64748b', fontSize: '11.5px' }}>
                            {s.reconciledAt ? formatDateTimeArabic(s.reconciledAt) : '—'}
                          </td>
                          <td style={{ padding: '12px' }}>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '3px 8px',
                                borderRadius: '9999px',
                                fontSize: '11px',
                                fontWeight: 700,
                                background: '#dcfce7',
                                color: '#166534',
                              }}
                            >
                              {t('settings.workspace_sections.settings_marketplaces_section.s340', "مسوى رسمياً")}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        </div>
      ) : null}

      {/* ========================================================================= */}
      {/* TAB 4: ORDERS PULL & SIMULATOR */}
      {/* ========================================================================= */}
      {activeTab === 'orders' ? (
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div>
            <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
              {t('settings.workspace_sections.settings_marketplaces_section.s341', "سحب ومحاكاة الطلبات الخارجية وحماية المخزون (Stock Shield & Notifications)")}
            </h4>
            <p style={{ margin: '3px 0 0', fontSize: '12.5px', color: '#64748b' }}>
              {t('settings.workspace_sections.settings_marketplaces_section.s342', "عند ورود طلب من أمازون أو نون، يقوم النظام تلقائياً بخصم وحجز الكمية من المخزن المحلي لمنع بيعها محلياً، وإرسال تنبيه فوري بالواتساب.")}
            </p>
          </div>

          {simulatedOrderInfo ? (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '14px 18px', color: '#15803d', fontSize: '13.5px', fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>{simulatedOrderInfo}</div>
              <Button variant="secondary" onClick={() => setSimulatedOrderInfo(null)} style={{ fontSize: '11px', padding: '2px 8px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s343', "إغلاق")}
              </Button>
            </div>
          ) : null}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '18px', background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <PackageIcon size={20} color="#170e5e" />
                <span style={{ fontWeight: 800, fontSize: '14.5px', color: '#0f172a' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s344', "اختبار سحب طلب من أمازون (Amazon Order Simulation)")}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s345', "محاكاة وصول طلب جديد من سوق أمازون؛ ينشئ طلباً إلكترونياً، ويحجز الصنف، ويخصم رصيد المخزن فورياً عبر ledger.")}
              </p>
              <div style={{ marginTop: 'auto', paddingTop: '10px' }}>
                <Button
                  variant="primary"
                  onClick={() => simulateOrderMutation.mutate('amazon')}
                  disabled={simulateOrderMutation.isPending}
                  style={{ background: '#170e5e', color: '#ffffff', width: '100%' }}
                >
                  {simulateOrderMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s346', "جاري المحاكاة والحجز...") : t('settings.workspace_sections.settings_marketplaces_section.s347', "اختبار سحب طلب أمازون")}
                </Button>
              </div>
            </div>

            <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '18px', background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShoppingCartIcon size={20} color="#b45309" />
                <span style={{ fontWeight: 800, fontSize: '14.5px', color: '#0f172a' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s348', "اختبار سحب طلب من نون (Noon Order Simulation)")}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s349', "محاكاة استلام طلب من منصة نون ديركت؛ يسحب بيانات العميل، ويثبت الدفع المسبق، ويطلق إشعاراً لمالك المتجر على الواتساب.")}
              </p>
              <div style={{ marginTop: 'auto', paddingTop: '10px' }}>
                <Button
                  variant="primary"
                  onClick={() => simulateOrderMutation.mutate('noon')}
                  disabled={simulateOrderMutation.isPending}
                  style={{ background: '#170e5e', color: '#ffffff', width: '100%' }}
                >
                  {simulateOrderMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s350', "جاري المحاكاة والحجز...") : t('settings.workspace_sections.settings_marketplaces_section.s351', "اختبار سحب طلب نون")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ========================================================================= */}
      {/* TAB 5: AMAZON CONFIG */}
      {/* ========================================================================= */}
      {activeTab === 'amazon' ? (
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s352', "إعدادات الربط مع متجر أمازون (Amazon Selling Partner API)")}
              </h4>
              <p style={{ margin: '3px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s353', "اربط حساب البائع الخاص بك على أمازون لمزامنة الكميات وسحب الطلبات تلقائياً.")}
              </p>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '13.5px' }}>
              <input
                type="checkbox"
                checked={amazonCfg.enabled}
                onChange={(e) => setAmazonCfg({ ...amazonCfg, enabled: e.target.checked })}
                style={{ width: '18px', height: '18px', accentColor: '#170e5e', cursor: 'pointer' }}
              />
              {t('settings.workspace_sections.settings_marketplaces_section.s354', "تفعيل قناة أمازون")}
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s355', "معرّف البائع (Seller ID / Merchant ID) *")}
              </label>
              <input
                type="text"
                value={amazonCfg.sellerId}
                onChange={(e) => setAmazonCfg({ ...amazonCfg, sellerId: e.target.value })}
                placeholder={t('settings.workspace_sections.settings_marketplaces_section.s356', "مثال: A2XXXXXX5678")}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s357', "سوق أمازون المستهدف")}
              </label>
              <select
                value={amazonCfg.marketplaceId}
                onChange={(e) => setAmazonCfg({ ...amazonCfg, marketplaceId: e.target.value as any })}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px', background: '#ffffff' }}
              >
                <option value="eg">{t('settings.workspace_sections.settings_marketplaces_section.s358', "أمازون مصر (Amazon.eg - EGP)")}</option>
                <option value="sa">{t('settings.workspace_sections.settings_marketplaces_section.s359', "أمازون السعودية (Amazon.sa - SAR)")}</option>
                <option value="ae">{t('settings.workspace_sections.settings_marketplaces_section.s360', "أمازون الإمارات (Amazon.ae - AED)")}</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s361', "رمز التحديث السحابي (LWA Refresh Token)")}
              </label>
              <input
                type="password"
                value={amazonCfg.refreshToken}
                onChange={(e) => setAmazonCfg({ ...amazonCfg, refreshToken: e.target.value })}
                placeholder="Atzr|IQEBLz4k6..."
                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s362', "نمط الشحن والتجهيز")}
              </label>
              <select
                value={amazonCfg.fulfillmentType}
                onChange={(e) => setAmazonCfg({ ...amazonCfg, fulfillmentType: e.target.value as any })}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px', background: '#ffffff' }}
              >
                <option value="fbm">{t('settings.workspace_sections.settings_marketplaces_section.s363', "FBM (شحن وتجهيز من مخزن التاجر الخاص)")}</option>
                <option value="fba">{t('settings.workspace_sections.settings_marketplaces_section.s364', "FBA (الشحن عبر مستودعات أمازون الرسمية)")}</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '24px', background: '#f8fafc', padding: '14px', borderRadius: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={amazonCfg.autoSyncStock}
                onChange={(e) => setAmazonCfg({ ...amazonCfg, autoSyncStock: e.target.checked })}
                style={{ width: '16px', height: '16px', accentColor: '#170e5e' }}
              />
              {t('settings.workspace_sections.settings_marketplaces_section.s365', "تحديث المخزون فورياً على أمازون عند حدوث بيع محلي")}
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={amazonCfg.autoPullOrders}
                onChange={(e) => setAmazonCfg({ ...amazonCfg, autoPullOrders: e.target.checked })}
                style={{ width: '16px', height: '16px', accentColor: '#170e5e' }}
              />
              {t('settings.workspace_sections.settings_marketplaces_section.s366', "سحب الطلبات تلقائياً وحجز الأصناف من المخزن")}
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <Button variant="secondary" onClick={() => testMutation.mutate('amazon')} disabled={testMutation.isPending}>
              {testMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s367', "جاري الفحص...") : t('settings.workspace_sections.settings_marketplaces_section.s368', "فحص واختبار الاتصال")}
            </Button>
            <SubmitButton
              type="button"
              onClick={() => saveMutation.mutate({ amazon: amazonCfg })}
              isPending={saveMutation.isPending}
              isSuccess={saveSuccess}
              idleText={t('settings.workspace_sections.settings_marketplaces_section.s370', "حفظ إعدادات أمازون")}
              pendingText={t('settings.workspace_sections.settings_marketplaces_section.s369', "جاري الحفظ...")}
              successText="تم حفظ إعدادات أمازون بنجاح!"
              style={{ background: '#170e5e', color: '#ffffff' }}
            />
          </div>
        </div>
      ) : null}

      {/* ========================================================================= */}
      {/* TAB 6: NOON CONFIG */}
      {/* ========================================================================= */}
      {activeTab === 'noon' ? (
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s371', "إعدادات الربط مع متجر نون (Noon Marketplace API)")}
              </h4>
              <p style={{ margin: '3px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s372', "اربط حساب شريك نون (Noon Partner) لمزامنة الكميات والأسعار وسحب طلبيات نون ديركت.")}
              </p>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '13.5px' }}>
              <input
                type="checkbox"
                checked={noonCfg.enabled}
                onChange={(e) => setNoonCfg({ ...noonCfg, enabled: e.target.checked })}
                style={{ width: '18px', height: '18px', accentColor: '#170e5e', cursor: 'pointer' }}
              />
              {t('settings.workspace_sections.settings_marketplaces_section.s373', "تفعيل قناة نون")}
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s374', "معرّف التاجر (Noon Partner Identifier) *")}
              </label>
              <input
                type="text"
                value={noonCfg.merchantId}
                onChange={(e) => setNoonCfg({ ...noonCfg, merchantId: e.target.value })}
                placeholder={t('settings.workspace_sections.settings_marketplaces_section.s375', "مثال: noon_partner_1234")}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s376', "دولة متجر نون")}
              </label>
              <select
                value={noonCfg.marketplace}
                onChange={(e) => setNoonCfg({ ...noonCfg, marketplace: e.target.value as any })}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px', background: '#ffffff' }}
              >
                <option value="eg">{t('settings.workspace_sections.settings_marketplaces_section.s377', "نون مصر (Noon Egypt - EGP)")}</option>
                <option value="sa">{t('settings.workspace_sections.settings_marketplaces_section.s378', "نون السعودية (Noon KSA - SAR)")}</option>
                <option value="ae">{t('settings.workspace_sections.settings_marketplaces_section.s379', "نون الإمارات (Noon UAE - AED)")}</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s380', "مفتاح الواجهة (API Key)")}
              </label>
              <input
                type="password"
                value={noonCfg.apiKey}
                onChange={(e) => setNoonCfg({ ...noonCfg, apiKey: e.target.value })}
                placeholder="key_live_noon_..."
                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s381', "نمط البيع (Fulfillment Model)")}
              </label>
              <select
                value={noonCfg.fulfillmentType}
                onChange={(e) => setNoonCfg({ ...noonCfg, fulfillmentType: e.target.value as any })}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px', background: '#ffffff' }}
              >
                <option value="direct">{t('settings.workspace_sections.settings_marketplaces_section.s382', "Noon Direct / Cross-dock (الشحن من مستودعك الخاص)")}</option>
                <option value="fbn">{t('settings.workspace_sections.settings_marketplaces_section.s383', "FBN (الشحن عبر مستودعات Fulfilled by Noon)")}</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '24px', background: '#f8fafc', padding: '14px', borderRadius: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={noonCfg.autoSyncStock}
                onChange={(e) => setNoonCfg({ ...noonCfg, autoSyncStock: e.target.checked })}
                style={{ width: '16px', height: '16px', accentColor: '#170e5e' }}
              />
              {t('settings.workspace_sections.settings_marketplaces_section.s384', "تحديث المخزون فورياً على نون عند أي حركة بيع")}
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={noonCfg.autoPullOrders}
                onChange={(e) => setNoonCfg({ ...noonCfg, autoPullOrders: e.target.checked })}
                style={{ width: '16px', height: '16px', accentColor: '#170e5e' }}
              />
              {t('settings.workspace_sections.settings_marketplaces_section.s385', "سحب وتأكيد طلبيات نون وحجزها في النظام آلياً")}
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <Button variant="secondary" onClick={() => testMutation.mutate('noon')} disabled={testMutation.isPending}>
              {testMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s386', "جاري الفحص...") : t('settings.workspace_sections.settings_marketplaces_section.s387', "فحص واختبار الاتصال")}
            </Button>
            <SubmitButton
              type="button"
              onClick={() => saveMutation.mutate({ noon: noonCfg })}
              isPending={saveMutation.isPending}
              isSuccess={saveSuccess}
              idleText={t('settings.workspace_sections.settings_marketplaces_section.s389', "حفظ إعدادات نون")}
              pendingText={t('settings.workspace_sections.settings_marketplaces_section.s388', "جاري الحفظ...")}
              successText="تم حفظ إعدادات نون بنجاح!"
              style={{ background: '#170e5e', color: '#ffffff' }}
            />
          </div>
        </div>
      ) : null}

      {/* ========================================================================= */}
      {/* TAB 7: JUMIA CONFIG */}
      {/* ========================================================================= */}
      {activeTab === 'jumia' ? (
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s390', "إعدادات الربط مع متجر جوميا (Jumia Seller Center API)")}
              </h4>
              <p style={{ margin: '3px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s391', "ربط حساب البائع في جوميا لمزامنة كميات المستودع وتأكيد الشحنات وسحب الطلبات.")}
              </p>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '13.5px' }}>
              <input
                type="checkbox"
                checked={jumiaCfg.enabled}
                onChange={(e) => setJumiaCfg({ ...jumiaCfg, enabled: e.target.checked })}
                style={{ width: '18px', height: '18px', accentColor: '#170e5e', cursor: 'pointer' }}
              />
              {t('settings.workspace_sections.settings_marketplaces_section.s392', "تفعيل قناة جوميا")}
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s393', "البريد الإلكتروني لحساب البائع (Seller Email) *")}
              </label>
              <input
                type="email"
                value={jumiaCfg.sellerEmail}
                onChange={(e) => setJumiaCfg({ ...jumiaCfg, sellerEmail: e.target.value })}
                placeholder="vendor@company.com"
                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s394', "سوق جوميا")}
              </label>
              <select
                value={jumiaCfg.marketplace}
                onChange={(e) => setJumiaCfg({ ...jumiaCfg, marketplace: e.target.value as any })}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px', background: '#ffffff' }}
              >
                <option value="eg">{t('settings.workspace_sections.settings_marketplaces_section.s395', "جوميا مصر (Jumia Egypt - EGP)")}</option>
                <option value="ng">{t('settings.workspace_sections.settings_marketplaces_section.s396', "جوميا نيجيريا (Jumia Nigeria - NGN)")}</option>
                <option value="ke">{t('settings.workspace_sections.settings_marketplaces_section.s397', "جوميا كينيا (Jumia Kenya - KES)")}</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s398', "مفتاح API الخاص بجوميا")}
              </label>
              <input
                type="password"
                value={jumiaCfg.apiKey}
                onChange={(e) => setJumiaCfg({ ...jumiaCfg, apiKey: e.target.value })}
                placeholder="jumia_api_key_..."
                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s399', "نمط الشحن")}
              </label>
              <select
                value={jumiaCfg.fulfillmentType}
                onChange={(e) => setJumiaCfg({ ...jumiaCfg, fulfillmentType: e.target.value as any })}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px', background: '#ffffff' }}
              >
                <option value="dropshipping">{t('settings.workspace_sections.settings_marketplaces_section.s400', "Drop-shipping (الشحن من مستودعك الخاص)")}</option>
                <option value="express">{t('settings.workspace_sections.settings_marketplaces_section.s401', "Jumia Express (مستودعات جوميا الرسمية)")}</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <Button variant="secondary" onClick={() => testMutation.mutate('jumia')} disabled={testMutation.isPending}>
              {testMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s402', "جاري الفحص...") : t('settings.workspace_sections.settings_marketplaces_section.s403', "فحص واختبار الاتصال")}
            </Button>
            <SubmitButton
              type="button"
              onClick={() => saveMutation.mutate({ jumia: jumiaCfg })}
              isPending={saveMutation.isPending}
              isSuccess={saveSuccess}
              idleText={t('settings.workspace_sections.settings_marketplaces_section.s405', "حفظ إعدادات جوميا")}
              pendingText={t('settings.workspace_sections.settings_marketplaces_section.s404', "جاري الحفظ...")}
              successText="تم حفظ إعدادات جوميا بنجاح!"
              style={{ background: '#170e5e', color: '#ffffff' }}
            />
          </div>
        </div>
      ) : null}

      {/* ========================================================================= */}
      {/* TAB 8: TRENDYOL CONFIG */}
      {/* ========================================================================= */}
      {activeTab === 'trendyol' ? (
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s406', "إعدادات الربط مع ترينديول (Trendyol Marketplace API)")}
              </h4>
              <p style={{ margin: '3px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s407', "ربط حساب المورّد الخاص بك على ترينديول لمزامنة الأسعار والأرصدة والتوسع في الأسواق الإقليمية.")}
              </p>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '13.5px' }}>
              <input
                type="checkbox"
                checked={trendyolCfg.enabled}
                onChange={(e) => setTrendyolCfg({ ...trendyolCfg, enabled: e.target.checked })}
                style={{ width: '18px', height: '18px', accentColor: '#170e5e', cursor: 'pointer' }}
              />
              {t('settings.workspace_sections.settings_marketplaces_section.s408', "تفعيل قناة ترينديول")}
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s409', "معرّف المورّد (Supplier ID) *")}
              </label>
              <input
                type="text"
                value={trendyolCfg.supplierId}
                onChange={(e) => setTrendyolCfg({ ...trendyolCfg, supplierId: e.target.value })}
                placeholder={t('settings.workspace_sections.settings_marketplaces_section.s410', "مثال: 123456")}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s411', "مفتاح الواجهة (API Key)")}
              </label>
              <input
                type="password"
                value={trendyolCfg.apiKey}
                onChange={(e) => setTrendyolCfg({ ...trendyolCfg, apiKey: e.target.value })}
                placeholder="trendyol_api_key_..."
                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s412', "سر الواجهة (API Secret)")}
              </label>
              <input
                type="password"
                value={trendyolCfg.apiSecret}
                onChange={(e) => setTrendyolCfg({ ...trendyolCfg, apiSecret: e.target.value })}
                placeholder="••••••••"
                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s413', "خدمة الشحن (Cargo Provider)")}
              </label>
              <select
                value={trendyolCfg.fulfillmentType}
                onChange={(e) => setTrendyolCfg({ ...trendyolCfg, fulfillmentType: e.target.value as any })}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px', background: '#ffffff' }}
              >
                <option value="merchant_cargo">{t('settings.workspace_sections.settings_marketplaces_section.s414', "شحن التاجر المباشر (Merchant Cargo)")}</option>
                <option value="trendyol_cargo">{t('settings.workspace_sections.settings_marketplaces_section.s415', "شحن ترينديول الرسمي (Trendyol Cargo)")}</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <Button variant="secondary" onClick={() => testMutation.mutate('trendyol')} disabled={testMutation.isPending}>
              {testMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s416', "جاري الفحص...") : t('settings.workspace_sections.settings_marketplaces_section.s417', "فحص واختبار الاتصال")}
            </Button>
            <SubmitButton
              type="button"
              onClick={() => saveMutation.mutate({ trendyol: trendyolCfg })}
              isPending={saveMutation.isPending}
              isSuccess={saveSuccess}
              idleText={t('settings.workspace_sections.settings_marketplaces_section.s419', "حفظ إعدادات ترينديول")}
              pendingText={t('settings.workspace_sections.settings_marketplaces_section.s418', "جاري الحفظ...")}
              successText="تم حفظ إعدادات ترينديول بنجاح!"
              style={{ background: '#170e5e', color: '#ffffff' }}
            />
          </div>
        </div>
      ) : null}

      {/* ========================================================================= */}
      {/* TAB 9: MARKETPLACE BI & ANALYTICS */}
      {/* ========================================================================= */}
      {activeTab === 'analytics' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Header & Period Selectors */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s420', "تحليلات ومؤشرات أداء الماركت بليس (Marketplace BI & Performance Analytics)")}
              </h4>
              <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s421', "لوحة ذكاء أعمال حية تقارن حجم المبيعات، العمولات، صافي التحصيلات، ونسب المرتجعات عبر كافة المنصات.")}
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ display: 'flex', background: '#f1f5f9', padding: '3px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <button
                  type="button"
                  onClick={() => setAnalyticsPeriod('7d')}
                  style={{
                    padding: '6px 14px',
                    fontSize: '12.5px',
                    fontWeight: 600,
                    borderRadius: '6px',
                    border: 'none',
                    background: analyticsPeriod === '7d' ? '#ffffff' : 'transparent',
                    color: analyticsPeriod === '7d' ? '#170e5e' : '#64748b',
                    boxShadow: analyticsPeriod === '7d' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                    cursor: 'pointer',
                  }}
                >
                  {t('settings.workspace_sections.settings_marketplaces_section.s422', "آخر 7 أيام")}
                </button>
                <button
                  type="button"
                  onClick={() => setAnalyticsPeriod('30d')}
                  style={{
                    padding: '6px 14px',
                    fontSize: '12.5px',
                    fontWeight: 600,
                    borderRadius: '6px',
                    border: 'none',
                    background: analyticsPeriod === '30d' ? '#ffffff' : 'transparent',
                    color: analyticsPeriod === '30d' ? '#170e5e' : '#64748b',
                    boxShadow: analyticsPeriod === '30d' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                    cursor: 'pointer',
                  }}
                >
                  {t('settings.workspace_sections.settings_marketplaces_section.s423', "آخر 30 يوماً")}
                </button>
                <button
                  type="button"
                  onClick={() => setAnalyticsPeriod('all')}
                  style={{
                    padding: '6px 14px',
                    fontSize: '12.5px',
                    fontWeight: 600,
                    borderRadius: '6px',
                    border: 'none',
                    background: analyticsPeriod === 'all' ? '#ffffff' : 'transparent',
                    color: analyticsPeriod === 'all' ? '#170e5e' : '#64748b',
                    boxShadow: analyticsPeriod === 'all' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                    cursor: 'pointer',
                  }}
                >
                  {t('settings.workspace_sections.settings_marketplaces_section.s424', "كامل الفترة")}
                </button>
              </div>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => analyticsQuery.refetch()}
                disabled={analyticsQuery.isFetching}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <RefreshCwIcon size={14} />
                {t('settings.workspace_sections.settings_marketplaces_section.s425', "تحديث")}
              </Button>
            </div>
          </div>

          {analyticsQuery.isLoading ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', color: '#64748b' }}>
              {t('settings.workspace_sections.settings_marketplaces_section.s426', "جاري تجميع مؤشرات الأداء من قنوات البيع وقواعد البيانات...")}
            </div>
          ) : analyticsQuery.data ? (
            <>
              {/* Summary 4-KPI Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                  <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#64748b', marginBottom: '6px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s427', "إجمالي المبيعات الإجمالية (Gross Sales)")}
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#0f172a' }}>
                    {analyticsQuery.data.totalGrossSales.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: 500 }}>{t('settings.workspace_sections.settings_marketplaces_section.s428', "ج.م")}</span>
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#10b981', marginTop: '6px', fontWeight: 600 }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s429', "عبر")} {analyticsQuery.data.totalOrders} {t('settings.workspace_sections.settings_marketplaces_section.s430', "طلباً مكتمل")}
                  </div>
                </div>

                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                  <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#64748b', marginBottom: '6px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s431', "صافي التحصيلات البنكية (Net Payout)")}
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#16a34a' }}>
                    {analyticsQuery.data.totalNetPayout.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: 500 }}>{t('settings.workspace_sections.settings_marketplaces_section.s432', "ج.م")}</span>
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '6px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s433', "المبالغ المستحقة للتحويل إلى الحسابات البنكية")}
                  </div>
                </div>

                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                  <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#64748b', marginBottom: '6px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s434', "رسوم وعمولات المنصات (Fees & Comm.)")}
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#ea580c' }}>
                    {analyticsQuery.data.totalFees.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: 500 }}>{t('settings.workspace_sections.settings_marketplaces_section.s435', "ج.م")}</span>
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '6px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s436', "تمثل")} {analyticsQuery.data.totalGrossSales > 0 ? ((analyticsQuery.data.totalFees / analyticsQuery.data.totalGrossSales) * 100).toFixed(1) : 0}{t('settings.workspace_sections.settings_marketplaces_section.s437', "% من إجمالي المبيعات")}
                  </div>
                </div>

                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                  <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#64748b', marginBottom: '6px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s438', "معدل المرتجعات العام (Blended RTO %)")}
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: (analyticsQuery.data.marketplaceBreakdown?.[0]?.returnRatePercent ?? 0) > 15 ? '#dc2626' : '#2563eb' }}>
                    {(analyticsQuery.data.marketplaceBreakdown?.[0]?.returnRatePercent ?? 0).toFixed(1)}%
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '6px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s439', "متوسط نسبة الطلبات الملغاة أو المرتجعة")}
                  </div>
                </div>
              </div>

              {/* Channels Breakdown Section */}
              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                <h4 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s440', "مقارنة الأداء والحصص السوقية بين المنصات (Marketplace Share & P&L)")}
                </h4>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
                  {analyticsQuery.data.marketplaceBreakdown.map((m: any) => {
                    const brandColor =
                      m.marketplace === 'amazon' ? '#f97316' :
                      m.marketplace === 'noon' ? '#eab308' :
                      m.marketplace === 'jumia' ? '#0d9488' : '#8b5cf6';
                    const brandBg =
                      m.marketplace === 'amazon' ? '#fff7ed' :
                      m.marketplace === 'noon' ? '#fefce8' :
                      m.marketplace === 'jumia' ? '#f0fdfa' : '#f5f3ff';
                    const brandName =
                      m.marketplace === 'amazon' ? t('settings.workspace_sections.settings_marketplaces_section.s441', "أمازون (Amazon)") :
                      m.marketplace === 'noon' ? t('settings.workspace_sections.settings_marketplaces_section.s442', "نون (Noon)") :
                      m.marketplace === 'jumia' ? t('settings.workspace_sections.settings_marketplaces_section.s443', "جوميا (Jumia)") : t('settings.workspace_sections.settings_marketplaces_section.s444', "ترينديول (Trendyol)");

                    return (
                      <div
                        key={m.marketplace}
                        style={{
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          borderRadius: '10px',
                          padding: '16px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '12px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a' }}>
                            {brandName}
                          </span>
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: '12px',
                              background: brandBg,
                              color: brandColor,
                              border: `1px solid ${brandColor}40`,
                            }}
                          >
                            {t('settings.workspace_sections.settings_marketplaces_section.s445', "حصة")} {m.sharePercentage.toFixed(1)}%
                          </span>
                        </div>

                        {/* Progress Bar */}
                        <div style={{ width: '100%', height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${Math.min(100, m.sharePercentage)}%`,
                              height: '100%',
                              background: brandColor,
                              borderRadius: '3px',
                            }}
                          />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px', marginTop: '4px' }}>
                          <div>
                            <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s446', "المبيعات الإجمالية")}</span>
                            <span style={{ fontWeight: 700, color: '#0f172a' }}>{m.grossSales.toLocaleString()} {t('settings.workspace_sections.settings_marketplaces_section.s447', "ج.م")}</span>
                          </div>
                          <div>
                            <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s448', "صافي المستحق")}</span>
                            <span style={{ fontWeight: 700, color: '#16a34a' }}>{m.netPayout.toLocaleString()} {t('settings.workspace_sections.settings_marketplaces_section.s449', "ج.م")}</span>
                          </div>
                          <div>
                            <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s450', "رسوم المنصة")}</span>
                            <span style={{ fontWeight: 700, color: '#ea580c' }}>{m.marketplaceFees.toLocaleString()} {t('settings.workspace_sections.settings_marketplaces_section.s451', "ج.م")}</span>
                          </div>
                          <div>
                            <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s452', "نسبة المرتجع (RTO)")}</span>
                            <span style={{ fontWeight: 700, color: m.returnRate > 15 ? '#dc2626' : '#2563eb' }}>
                              {m.returnRate.toFixed(1)}%
                            </span>
                          </div>
                        </div>

                        <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '8px', fontSize: '11.5px', color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
                          <span>{t('settings.workspace_sections.settings_marketplaces_section.s453', "عدد الطلبات:")}</span>
                          <span style={{ fontWeight: 700, color: '#0f172a' }}>{m.ordersCount} {t('settings.workspace_sections.settings_marketplaces_section.s454', "طلب")}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Top Selling Products */}
              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                <h4 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s455', "الأصناف الأكثر طلباً ومبيعاً عبر المنصات (Top Velocity Products)")}
                </h4>

                {analyticsQuery.data.topSellingProducts.length > 0 ? (
                  <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                      <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                        <tr>
                          <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#475569' }}>{t('settings.workspace_sections.settings_marketplaces_section.s456', "الصنف / المنتج")}</th>
                          <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#475569' }}>{t('settings.workspace_sections.settings_marketplaces_section.s457', "كود المنصة (SKU)")}</th>
                          <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700, color: '#475569' }}>{t('settings.workspace_sections.settings_marketplaces_section.s458', "المنصة")}</th>
                          <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700, color: '#475569' }}>{t('settings.workspace_sections.settings_marketplaces_section.s459', "الوحدات المباعة")}</th>
                          <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#475569' }}>{t('settings.workspace_sections.settings_marketplaces_section.s460', "إجمالي الإيراد")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analyticsQuery.data.topSellingProducts.map((p, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '10px 14px', fontWeight: 600, color: '#0f172a' }}>{p.productName}</td>
                            <td style={{ padding: '10px 14px', fontFamily: 'monospace', color: '#64748b' }}>{p.sku}</td>
                            <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                              <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#f1f5f9', fontWeight: 700, textTransform: 'uppercase' }}>
                                {p.marketplace}
                              </span>
                            </td>
                            <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700, color: '#16a34a' }}>
                              {p.unitsSold} {t('settings.workspace_sections.settings_marketplaces_section.s461', "قطعة")}
                            </td>
                            <td style={{ padding: '10px 14px', fontWeight: 700, color: '#0f172a' }}>
                              {p.totalRevenue.toLocaleString()} {t('settings.workspace_sections.settings_marketplaces_section.s462', "ج.م")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '24px', color: '#94a3b8', fontSize: '13px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s463', "لم يتم تسجيل طلبات بيع عبر المنصات خلال هذه الفترة حتى الآن.")}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {/* ========================================================================= */}
      {/* MODAL 1: ADD SKU MAPPING */}
      {/* ========================================================================= */}
      <DialogShell open={showAddModal} onClose={() => setShowAddModal(false)} width="min(560px, 95vw)" ariaLabel={t('settings.workspace_sections.settings_marketplaces_section.s464', "ربط صنف بالمنصات")}>
        <div dir="rtl" style={{ background: '#ffffff', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
              {t('settings.workspace_sections.settings_marketplaces_section.s465', "ربط صنف مع منصات الماركت بليس (Add Marketplace SKU)")}
            </h4>
            <button type="button" onClick={() => setShowAddModal(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center' }}>
              <XIcon size={18} />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s466', "اختيار الصنف من الـ ERP *")}
              </label>
              <select
                value={newMapping.productId}
                onChange={(e) => setNewMapping({ ...newMapping, productId: parseInt(e.target.value, 10) || 0 })}
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#ffffff' }}
              >
                <option value={0}>{t('settings.workspace_sections.settings_marketplaces_section.s467', "-- اختر صنفاً --")}</option>
                {availableProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.barcode ? `(${p.barcode})` : ''} {t('settings.workspace_sections.settings_marketplaces_section.s468', "- سعر:")} {(p as any).retailPrice ?? (p as any).retail_price ?? 0} {t('settings.workspace_sections.settings_marketplaces_section.s469', "ج.م")}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s470', "المنصة المستهدفة *")}
              </label>
              <select
                value={newMapping.marketplace}
                onChange={(e) => setNewMapping({ ...newMapping, marketplace: e.target.value as any })}
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#ffffff' }}
              >
                <option value="amazon">{t('settings.workspace_sections.settings_marketplaces_section.s471', "أمازون (Amazon ASIN)")}</option>
                <option value="noon">{t('settings.workspace_sections.settings_marketplaces_section.s472', "نون (Noon Partner SKU)")}</option>
                <option value="jumia">{t('settings.workspace_sections.settings_marketplaces_section.s473', "جوميا (Jumia Seller SKU)")}</option>
                <option value="trendyol">{t('settings.workspace_sections.settings_marketplaces_section.s474', "ترينديول (Trendyol Barcode/SKU)")}</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s475', "كود الصنف على المنصة (ASIN / Partner SKU) *")}
              </label>
              <input
                type="text"
                value={newMapping.marketplaceSku}
                onChange={(e) => setNewMapping({ ...newMapping, marketplaceSku: e.target.value })}
                placeholder={newMapping.marketplace === 'amazon' ? t('settings.workspace_sections.settings_marketplaces_section.s476', "مثال: B08N5WRWNW") : t('settings.workspace_sections.settings_marketplaces_section.s477', "مثال: NOON-SKU-9921")}
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s478', "سعر مخصص على المنصة (اختياري)")}
                </label>
                <input
                  type="number"
                  value={newMapping.customPrice}
                  onChange={(e) => setNewMapping({ ...newMapping, customPrice: e.target.value })}
                  placeholder={t('settings.workspace_sections.settings_marketplaces_section.s479', "سعر البيع الافتراضي بالـ ERP")}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s480', "سعر صندوق الشراء (Buy Box Price)")}
                </label>
                <input
                  type="number"
                  value={newMapping.buyBoxPrice}
                  onChange={(e) => setNewMapping({ ...newMapping, buyBoxPrice: e.target.value })}
                  placeholder={t('settings.workspace_sections.settings_marketplaces_section.s481', "سعر الـ Buy Box الحالي")}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
            <Button variant="secondary" onClick={() => setShowAddModal(false)}>
              {t('settings.workspace_sections.settings_marketplaces_section.s482', "إلغاء")}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (!newMapping.productId || !newMapping.marketplaceSku) {
                  toast.error(t('settings.workspace_sections.settings_marketplaces_section.s483', "يرجى اختيار الصنف وإدخال كود المنصة"));
                  return;
                }
                addMappingMutation.mutate({
                  productId: newMapping.productId,
                  marketplace: newMapping.marketplace,
                  marketplaceSku: newMapping.marketplaceSku,
                  customPrice: newMapping.customPrice ? parseFloat(newMapping.customPrice) : undefined,
                  buyBoxPrice: newMapping.buyBoxPrice ? parseFloat(newMapping.buyBoxPrice) : undefined,
                  competitorPrice: newMapping.competitorPrice ? parseFloat(newMapping.competitorPrice) : undefined,
                  syncStock: newMapping.syncStock,
                  status: 'synced',
                });
              }}
              disabled={addMappingMutation.isPending}
              style={{ background: '#170e5e', color: '#ffffff' }}
            >
              {addMappingMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s484', "جاري الحفظ...") : t('settings.workspace_sections.settings_marketplaces_section.s485', "حفظ وتفعيل الربط")}
            </Button>
          </div>
        </div>
      </DialogShell>

      {/* ========================================================================= */}
      {/* MODAL 2: EDIT COMPETITOR & BUY BOX PRICE (تحديث أسعار المنافسين وصندوق الشراء) */}
      {/* ========================================================================= */}
      <DialogShell open={Boolean(editPriceModal)} onClose={() => setEditPriceModal(null)} width="min(460px, 95vw)" ariaLabel={t('settings.workspace_sections.settings_marketplaces_section.s486', "تعديل أسعار المنافسة")}>
        <div dir="rtl" style={{ background: '#ffffff', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
              {t('settings.workspace_sections.settings_marketplaces_section.s487', "تحديث أسعار المنافسين وصندوق الشراء (Buy Box & Competitor Pricing)")}
            </h4>
            <button type="button" onClick={() => setEditPriceModal(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center' }}>
              <XIcon size={18} />
            </button>
          </div>

          {editPriceModal ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12.5px' }}>
                <div style={{ fontWeight: 700, color: '#0f172a' }}>{editPriceModal.productName}</div>
                <div style={{ color: '#64748b', marginTop: '2px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s488', "كود المنصة:")} <strong style={{ color: '#170e5e' }}>{editPriceModal.marketplaceSku}</strong> ({editPriceModal.marketplace.toUpperCase()})
                </div>
                <div style={{ color: '#64748b' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s489', "سعرنا الحالي:")} <strong>{editPriceModal.customPrice || editPriceModal.retailPrice || 0} {t('settings.workspace_sections.settings_marketplaces_section.s490', "ج.م")}</strong>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s491', "سعر صندوق الشراء الحائز على المبيعات (Buy Box Price)")}
                </label>
                <input
                  type="number"
                  value={editBuyBoxPrice}
                  onChange={(e) => setEditBuyBoxPrice(e.target.value)}
                  placeholder={t('settings.workspace_sections.settings_marketplaces_section.s492', "مثال: 340")}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s493', "سعر أدنى منافس (Lowest Competitor Price)")}
                </label>
                <input
                  type="number"
                  value={editCompetitorPrice}
                  onChange={(e) => setEditCompetitorPrice(e.target.value)}
                  placeholder={t('settings.workspace_sections.settings_marketplaces_section.s494', "مثال: 335")}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>
            </div>
          ) : null}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
            <Button variant="secondary" onClick={() => setEditPriceModal(null)}>
              {t('settings.workspace_sections.settings_marketplaces_section.s495', "إلغاء")}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (!editPriceModal) return;
                updateCompetitorPriceMutation.mutate({
                  id: editPriceModal.id,
                  competitorPrice: editCompetitorPrice ? parseFloat(editCompetitorPrice) : undefined,
                  buyBoxPrice: editBuyBoxPrice ? parseFloat(editBuyBoxPrice) : undefined,
                });
              }}
              disabled={updateCompetitorPriceMutation.isPending}
              style={{ background: '#170e5e', color: '#ffffff' }}
            >
              {updateCompetitorPriceMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s496', "جاري التحديث...") : t('settings.workspace_sections.settings_marketplaces_section.s497', "تحديث أسعار المنافسة")}
            </Button>
          </div>
        </div>
      </DialogShell>

      {/* ========================================================================= */}
      {/* MODAL 3: BULK SKU MAPPING IMPORT (CSV / EXCEL) */}
      {/* ========================================================================= */}
      <DialogShell
        open={showBulkImportModal}
        onClose={() => {
          setShowBulkImportModal(false);
          setBulkImportResult(null);
        }}
        width="min(820px, 95vw)"
        ariaLabel={t('settings.workspace_sections.settings_marketplaces_section.s498', "استيراد شيت الأكواد")}
      >
        <div dir="rtl" style={{ background: '#ffffff', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s499', "استيراد شيت مطابقة الأكواد الجماعي (Bulk SKU Mapping Import)")}
              </h4>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s500', "رفع ملف CSV أو لصق محتوى جدول الإكسيل لربط وتحديث مئات الأصناف دفعة واحدة.")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowBulkImportModal(false);
                setBulkImportResult(null);
              }}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center' }}
            >
              <XIcon size={18} />
            </button>
          </div>

          {/* Instructions & Template Download Bar */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ fontSize: '12.5px', color: '#334155', lineHeight: 1.5 }}>
              {t('settings.workspace_sections.settings_marketplaces_section.s501', "الأعمدة المدعومة:")} <strong>{t('settings.workspace_sections.settings_marketplaces_section.s502', "الباركود (barcode)")}</strong> {t('settings.workspace_sections.settings_marketplaces_section.s503', "أو")} <strong>{t('settings.workspace_sections.settings_marketplaces_section.s504', "كود الصنف (sku)")}</strong>{t('settings.workspace_sections.settings_marketplaces_section.s505', "،")} <strong>{t('settings.workspace_sections.settings_marketplaces_section.s506', "المنصة (marketplace)")}</strong>{t('settings.workspace_sections.settings_marketplaces_section.s507', "،")} <strong>{t('settings.workspace_sections.settings_marketplaces_section.s508', "كود الصنف بالمنصة (marketplace_sku)")}</strong>{t('settings.workspace_sections.settings_marketplaces_section.s509', "،")} <strong>{t('settings.workspace_sections.settings_marketplaces_section.s510', "سعر البيع (custom_price)")}</strong>{t('settings.workspace_sections.settings_marketplaces_section.s511', "،")} <strong>{t('settings.workspace_sections.settings_marketplaces_section.s512', "سعر المنافس (competitor_price)")}</strong>.
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                const sample = `barcode,marketplace,marketplace_sku,marketplace_title,custom_price,competitor_price\n622123456789,amazon,B08N5WRWNW,كابل شحن فائق السرعة,299,285\n622987654321,noon,N45678901A,سماعة بلوتوث لاسلكية,450,420\n622555666777,jumia,JM-99120,ساعة يد رياضية,380,360`;
                const blob = new Blob([sample], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = 'marketplace_sku_mapping_template.csv';
                link.click();
                URL.revokeObjectURL(url);
              }}
              style={{ fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              <DownloadIcon size={14} />
              <span>{t('settings.workspace_sections.settings_marketplaces_section.s513', "تحميل نموذج CSV تجريبي")}</span>
            </Button>
          </div>

          {/* File Picker or Paste Area */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontSize: '13px', fontWeight: 700, color: '#334155' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s514', "لصق بيانات الشيت أو رفع ملف CSV:")}
              </label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={handleDownloadSampleMappingTemplate}
                  style={{
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    fontSize: '11.5px',
                    color: '#334155',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '3px 10px',
                    borderRadius: '6px',
                  }}
                >
                  <DownloadIcon size={12} />
                  <span>{t('settings.workspace_sections.settings_marketplaces_section.s515', "تحميل نموذج الشيت (.CSV)")}</span>
                </button>

                <label
                  style={{
                    fontSize: '11.5px',
                    color: '#170e5e',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    background: '#f1f5f9',
                    padding: '3px 10px',
                    borderRadius: '6px',
                  }}
                >
                  <UploadIcon size={12} />
                  <span>{t('settings.workspace_sections.settings_marketplaces_section.s516', "اختر ملف من جهازك")}</span>
                  <input
                    type="file"
                    accept=".csv,.tsv,.txt"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = (ev) => {
                        const content = String(ev.target?.result || '');
                        setBulkImportText(content);
                        setBulkImportResult(null);
                      };
                      reader.readAsText(file);
                    }}
                  />
                </label>
              </div>
            </div>

            <textarea
              rows={8}
              value={bulkImportText}
              onChange={(e) => {
                setBulkImportText(e.target.value);
                setBulkImportResult(null);
              }}
              placeholder={`انسخ والصق الأعمدة هنا من الإكسيل مباشرة، أو بصيغة CSV:\n622123456789,amazon,B08N5WRWNW,كابل شحن,299,285\n622987654321,noon,N45678901A,سماعة بلوتوث,450,420`}
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '12px',
                fontFamily: 'monospace',
                direction: 'ltr',
                textAlign: 'left',
              }}
            />
          </div>

          {/* Bulk Import Result Banner */}
          {bulkImportResult ? (
            <div
              style={{
                background: bulkImportResult.importedCount > 0 || bulkImportResult.updatedCount > 0 ? '#f0fdf4' : '#fffbeb',
                border: `1px solid ${bulkImportResult.importedCount > 0 || bulkImportResult.updatedCount > 0 ? '#86efac' : '#fde68a'}`,
                borderRadius: '8px',
                padding: '12px 16px',
                fontSize: '12.5px',
              }}
            >
              <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s517', "نتيجة المعالجة:")}
              </div>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', color: '#334155' }}>
                <span>{t('settings.workspace_sections.settings_marketplaces_section.s518', "إجمالي الصفوف:")} <strong>{bulkImportResult.totalRows}</strong></span>
                <span style={{ color: '#15803d' }}>{t('settings.workspace_sections.settings_marketplaces_section.s519', "تم استيراد جديد:")} <strong>{bulkImportResult.importedCount}</strong></span>
                <span style={{ color: '#0369a1' }}>{t('settings.workspace_sections.settings_marketplaces_section.s520', "تم تحديث قائم:")} <strong>{bulkImportResult.updatedCount}</strong></span>
                <span style={{ color: '#b45309' }}>{t('settings.workspace_sections.settings_marketplaces_section.s521', "تم التخطي / أخطاء:")} <strong>{bulkImportResult.skippedCount}</strong></span>
              </div>
              {bulkImportResult.errors && bulkImportResult.errors.length > 0 ? (
                <div style={{ marginTop: '8px', maxHeight: '100px', overflowY: 'auto', background: '#ffffff', padding: '6px 10px', borderRadius: '6px', border: '1px solid #fecaca', fontSize: '11.5px', color: '#b91c1c' }}>
                  {bulkImportResult.errors.map((err, idx) => (
                    <div key={idx}>{t('settings.workspace_sections.settings_marketplaces_section.s522', "صف")} {err.row}: {err.reason}</div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Action buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button
              variant="secondary"
              onClick={() => {
                setShowBulkImportModal(false);
                setBulkImportResult(null);
              }}
            >
              {t('settings.workspace_sections.settings_marketplaces_section.s523', "إغلاق")}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (!bulkImportText.trim()) {
                  toast.error(t('settings.workspace_sections.settings_marketplaces_section.s524', "برجاء إدخال أو لصق بيانات الشيت أولاً"));
                  return;
                }
                const lines = bulkImportText.trim().split('\n');
                const parsedRows: BulkMappingImportRow[] = [];

                for (let i = 0; i < lines.length; i++) {
                  const line = lines[i].trim();
                  if (!line) continue;
                  const parts = line.includes('\t') ? line.split('\t') : line.split(',');
                  if (i === 0 && (parts[0].toLowerCase().includes('barcode') || parts[0].toLowerCase().includes('sku') || parts[1]?.toLowerCase().includes('market'))) {
                    continue;
                  }
                  if (parts.length < 3) continue;

                  const col0 = parts[0]?.replace(/"/g, '').trim();
                  const col1 = parts[1]?.replace(/"/g, '').trim().toLowerCase() as SupportedMarketplace;
                  const col2 = parts[2]?.replace(/"/g, '').trim();
                  const col3 = parts[3]?.replace(/"/g, '').trim();
                  const col4 = parts[4]?.replace(/"/g, '').trim();
                  const col5 = parts[5]?.replace(/"/g, '').trim();

                  parsedRows.push({
                    barcode: col0,
                    sku: col0,
                    marketplace: (col1 as any) || 'amazon',
                    marketplaceSku: col2,
                    marketplaceTitle: isNaN(Number(col3)) && col3 ? col3 : undefined,
                    customPrice: !isNaN(Number(col3)) ? parseFloat(col3) : (!isNaN(Number(col4)) ? parseFloat(col4) : undefined),
                    competitorPrice: !isNaN(Number(col4)) && isNaN(Number(col3)) ? parseFloat(col4) : (!isNaN(Number(col5)) ? parseFloat(col5) : undefined),
                    syncStock: true,
                  });
                }

                if (!parsedRows.length) {
                  toast.error(t('settings.workspace_sections.settings_marketplaces_section.s525', "لم يتم التعرف على أي صفوف صالحة من البيانات المدخلة"));
                  return;
                }

                bulkImportMutation.mutate(parsedRows);
              }}
              disabled={bulkImportMutation.isPending || !bulkImportText.trim()}
              style={{ background: '#170e5e', color: '#ffffff' }}
            >
              {bulkImportMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s526', "جاري الاستيراد والمعالجة...") : t('settings.workspace_sections.settings_marketplaces_section.s527', "بدء معالجة واستيراد الشيت")}
            </Button>
          </div>
        </div>
      </DialogShell>

      {/* ========================================================================= */}
      {/* MODAL 4: RECONCILE MARKETPLACE SETTLEMENT & GL POSTING */}
      {/* ========================================================================= */}
      <DialogShell
        open={showReconcileModal}
        onClose={() => setShowReconcileModal(false)}
        width="min(880px, 95vw)"
        ariaLabel={t('settings.workspace_sections.settings_marketplaces_section.s528', "تسوية كشف حساب")}
      >
        <div dir="rtl" style={{ background: '#ffffff', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s529', "تسوية كشف حساب منصة وإنشاء القيد المحاسبي المزدوج (GL Posting)")}
              </h4>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s530', "إدخال بيانات الكشف الدوري من البائع، فك تشابك العمولات ومصاريف الشحن، وتوليد قيد يومية متزن آلياً.")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowReconcileModal(false)}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center' }}
            >
              <XIcon size={18} />
            </button>
          </div>

          {/* Form Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s531', "المنصة الإلكترونية:")}
              </label>
              <select
                value={settlementForm.marketplace}
                onChange={(e) => setSettlementForm({ ...settlementForm, marketplace: e.target.value as SupportedMarketplace })}
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              >
                <option value="amazon">{t('settings.workspace_sections.settings_marketplaces_section.s532', "أمازون (Amazon)")}</option>
                <option value="noon">{t('settings.workspace_sections.settings_marketplaces_section.s533', "نون (Noon)")}</option>
                <option value="jumia">{t('settings.workspace_sections.settings_marketplaces_section.s534', "جوميا (Jumia)")}</option>
                <option value="trendyol">{t('settings.workspace_sections.settings_marketplaces_section.s535', "ترينديول (Trendyol)")}</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s536', "رقم كشف الحساب / الكود المرجعي:")}
              </label>
              <input
                type="text"
                value={settlementForm.settlementId}
                onChange={(e) => setSettlementForm({ ...settlementForm, settlementId: e.target.value })}
                placeholder={t('settings.workspace_sections.settings_marketplaces_section.s537', "مثال: AMZ-DISBURSE-1928374")}
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s538', "تاريخ بداية الفترة:")}
              </label>
              <input
                type="date"
                value={settlementForm.periodStart}
                onChange={(e) => setSettlementForm({ ...settlementForm, periodStart: e.target.value })}
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s539', "تاريخ نهاية الفترة (تاريخ القيد):")}
              </label>
              <input
                type="date"
                value={settlementForm.periodEnd}
                onChange={(e) => setSettlementForm({ ...settlementForm, periodEnd: e.target.value })}
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s540', "إجمالي مبيعات البضاعة (Gross Product Sales):")}
              </label>
              <input
                type="number"
                step="0.01"
                value={settlementForm.grossSales || ''}
                onChange={(e) => {
                  const gross = parseFloat(e.target.value) || 0;
                  const net = gross - (settlementForm.referralFees || 0) - (settlementForm.fulfillmentFees || 0) - (settlementForm.refunds || 0) - (settlementForm.storageOrOtherFees || 0);
                  setSettlementForm({ ...settlementForm, grossSales: gross, netPayout: Math.max(0, roundMoneyValue(net, settlementBookDigits)) });
                }}
                placeholder="0.00"
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s541', "عمولات البيع ورسوم الإحالة (Referral Fees):")}
              </label>
              <input
                type="number"
                step="0.01"
                value={settlementForm.referralFees || ''}
                onChange={(e) => {
                  const ref = parseFloat(e.target.value) || 0;
                  const net = (settlementForm.grossSales || 0) - ref - (settlementForm.fulfillmentFees || 0) - (settlementForm.refunds || 0) - (settlementForm.storageOrOtherFees || 0);
                  setSettlementForm({ ...settlementForm, referralFees: ref, netPayout: Math.max(0, roundMoneyValue(net, settlementBookDigits)) });
                }}
                placeholder="0.00"
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s542', "مصاريف الشحن والتخزين FBA / FBN:")}
              </label>
              <input
                type="number"
                step="0.01"
                value={settlementForm.fulfillmentFees || ''}
                onChange={(e) => {
                  const ful = parseFloat(e.target.value) || 0;
                  const net = (settlementForm.grossSales || 0) - (settlementForm.referralFees || 0) - ful - (settlementForm.refunds || 0) - (settlementForm.storageOrOtherFees || 0);
                  setSettlementForm({ ...settlementForm, fulfillmentFees: ful, netPayout: Math.max(0, roundMoneyValue(net, settlementBookDigits)) });
                }}
                placeholder="0.00"
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s543', "المرتجعات والمردودات (Customer Refunds):")}
              </label>
              <input
                type="number"
                step="0.01"
                value={settlementForm.refunds || ''}
                onChange={(e) => {
                  const ref = parseFloat(e.target.value) || 0;
                  const net = (settlementForm.grossSales || 0) - (settlementForm.referralFees || 0) - (settlementForm.fulfillmentFees || 0) - ref - (settlementForm.storageOrOtherFees || 0);
                  setSettlementForm({ ...settlementForm, refunds: ref, netPayout: Math.max(0, roundMoneyValue(net, settlementBookDigits)) });
                }}
                placeholder="0.00"
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s544', "مصاريف تخزين شهري / إعلانات أخرى:")}
              </label>
              <input
                type="number"
                step="0.01"
                value={settlementForm.storageOrOtherFees || ''}
                onChange={(e) => {
                  const oth = parseFloat(e.target.value) || 0;
                  const net = (settlementForm.grossSales || 0) - (settlementForm.referralFees || 0) - (settlementForm.fulfillmentFees || 0) - (settlementForm.refunds || 0) - oth;
                  setSettlementForm({ ...settlementForm, storageOrOtherFees: oth, netPayout: Math.max(0, roundMoneyValue(net, settlementBookDigits)) });
                }}
                placeholder="0.00"
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#15803d', marginBottom: '4px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s545', "صافي التحويل المودع في حساب البنك (Net Payout):")}
              </label>
              <input
                type="number"
                step="0.01"
                value={settlementForm.netPayout || ''}
                onChange={(e) => setSettlementForm({ ...settlementForm, netPayout: parseFloat(e.target.value) || 0 })}
                placeholder="0.00"
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '2px solid #86efac', fontSize: '13px', fontWeight: 700, color: '#15803d' }}
              />
            </div>
          </div>

          {/* Chart of Accounts Routing */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
              {t('settings.workspace_sections.settings_marketplaces_section.s546', "توجيه حسابات دفتر الأستاذ (Chart of Accounts):")}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '3px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s547', "حساب البنك / الخزينة المستلم:")}
                </label>
                <select
                  value={settlementForm.bankAccountId || ''}
                  onChange={(e) => setSettlementForm({ ...settlementForm, bankAccountId: e.target.value ? Number(e.target.value) : undefined })}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px' }}
                >
                  <option value="">{t('settings.workspace_sections.settings_marketplaces_section.s548', "تلقائي (حساب البنك / النقدية الرئيسي)")}</option>
                  {(settlementAccountsQuery.data?.bankAccounts || []).map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.code} - {acc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '3px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s549', "حساب عمولات البيع (مصاريف):")}
                </label>
                <select
                  value={settlementForm.referralFeesAccountId || ''}
                  onChange={(e) => setSettlementForm({ ...settlementForm, referralFeesAccountId: e.target.value ? Number(e.target.value) : undefined })}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px' }}
                >
                  <option value="">{t('settings.workspace_sections.settings_marketplaces_section.s550', "تلقائي (مصاريف عمولات البيع والتسويق)")}</option>
                  {(settlementAccountsQuery.data?.expenseAccounts || []).map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.code} - {acc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '3px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s551', "حساب مصاريف الشحن والتسليم (مصاريف):")}
                </label>
                <select
                  value={settlementForm.fulfillmentFeesAccountId || ''}
                  onChange={(e) => setSettlementForm({ ...settlementForm, fulfillmentFeesAccountId: e.target.value ? Number(e.target.value) : undefined })}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px' }}
                >
                  <option value="">{t('settings.workspace_sections.settings_marketplaces_section.s552', "تلقائي (مصاريف شحن ونقل المبيعات)")}</option>
                  {(settlementAccountsQuery.data?.expenseAccounts || []).map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.code} - {acc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '3px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s553', "حساب إيرادات مبيعات المنصات (إيراد):")}
                </label>
                <select
                  value={settlementForm.salesAccountId || ''}
                  onChange={(e) => setSettlementForm({ ...settlementForm, salesAccountId: e.target.value ? Number(e.target.value) : undefined })}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px' }}
                >
                  <option value="">{t('settings.workspace_sections.settings_marketplaces_section.s554', "تلقائي (مبيعات المتجر الإلكتروني / المنصات)")}</option>
                  {(settlementAccountsQuery.data?.revenueAccounts || []).map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.code} - {acc.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Double-Entry Balance Check Card */}
          {(() => {
            const net = Number(settlementForm.netPayout || 0);
            const ref = Number(settlementForm.referralFees || 0);
            const ful = Number(settlementForm.fulfillmentFees || 0);
            const rfd = Number(settlementForm.refunds || 0);
            const oth = Number(settlementForm.storageOrOtherFees || 0);
            // INV-FE3-FRONTEND-BOOK-DIGITS: every leg is already rounded
            // at book digits, so the check is exact equality — the old
            // < 0.05 tolerance hid a real 0.001 (one fils) imbalance on
            // a 3-decimal tenant, and the backend checks the same
            // identity exactly. totalDebit/totalCredit round here so a
            // hand-typed (unrounded) field still compares correctly.
            const totalDebit = roundMoneyValue(net + ref + ful + rfd + oth, settlementBookDigits);
            const totalCredit = roundMoneyValue(Number(settlementForm.grossSales || 0), settlementBookDigits);
            const isBalanced = totalDebit === totalCredit;

            return (
              <div
                style={{
                  background: isBalanced ? '#f0fdf4' : '#fffbeb',
                  border: `1px solid ${isBalanced ? '#86efac' : '#fde68a'}`,
                  borderRadius: '10px',
                  padding: '12px 16px',
                  fontSize: '12.5px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <span style={{ fontWeight: 800, color: '#0f172a' }}>{t('settings.workspace_sections.settings_marketplaces_section.s555', "التحقق المحاسبي المزدوج للقيد:")}</span>
                    <span style={{ marginRight: '8px', color: '#475569' }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s556', "المدين [البنك + العمولات + الشحن] =")} <strong>{totalDebit.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong> {t('settings.workspace_sections.settings_marketplaces_section.s557', "| الدائن [المبيعات] =")} <strong>{totalCredit.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
                    </span>
                  </div>
                  <div>
                    <span
                      style={{
                        padding: '3px 10px',
                        borderRadius: '9999px',
                        fontSize: '11.5px',
                        fontWeight: 700,
                        background: isBalanced ? '#dcfce7' : '#fef3c7',
                        color: isBalanced ? '#166534' : '#92400e',
                      }}
                    >
                      {isBalanced ? t('settings.workspace_sections.settings_marketplaces_section.s558', "متزن محاسبياً 100%") : `فارق غير متزن: ${(totalDebit - totalCredit).toFixed(settlementBookDigits)}`}
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Action buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
            <Button variant="secondary" onClick={() => setShowReconcileModal(false)}>
              {t('settings.workspace_sections.settings_marketplaces_section.s559', "إلغاء")}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (!settlementForm.settlementId.trim()) {
                  toast.error(t('settings.workspace_sections.settings_marketplaces_section.s560', "برجاء إدخال رقم كشف الحساب من المنصة"));
                  return;
                }
                if (!settlementForm.grossSales || settlementForm.grossSales <= 0) {
                  toast.error(t('settings.workspace_sections.settings_marketplaces_section.s561', "إجمالي مبيعات الكشف يجب أن يكون أكبر من الصفر"));
                  return;
                }
                reconcileMutation.mutate(settlementForm);
              }}
              disabled={reconcileMutation.isPending}
              style={{ background: '#170e5e', color: '#ffffff' }}
            >
              {reconcileMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s562', "جاري ترحيل القيد...") : t('settings.workspace_sections.settings_marketplaces_section.s563', "تسوية الكشف وترحيل القيد اليومي الآن")}
            </Button>
          </div>
        </div>
      </DialogShell>

      {/* ========================================================================= */}
      {/* MODAL 5: REPRICING BOT SETTINGS MODAL */}
      {/* ========================================================================= */}
      <DialogShell
        open={Boolean(editRepricingModal)}
        onClose={() => setEditRepricingModal(null)}
        width="min(560px, 95vw)"
        ariaLabel={t('settings.workspace_sections.settings_marketplaces_section.s564', "إعداد روبوت إعادة التسعير الآلي")}
      >
        <div dir="rtl" style={{ background: '#ffffff', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <SlidersIcon size={18} color="#170e5e" />
              <span>{t('settings.workspace_sections.settings_marketplaces_section.s565', "إعداد روبوت إعادة التسعير الآلي (Buy Box Repricer)")}</span>
            </h4>
            <button
              type="button"
              onClick={() => setEditRepricingModal(null)}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center' }}
            >
              <XIcon size={18} />
            </button>
          </div>

          {editRepricingModal ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Product Info Card */}
              <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12.5px' }}>
                <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '13.5px' }}>{editRepricingModal.productName}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px', marginTop: '8px', color: '#475569' }}>
                  <div>
                    {t('settings.workspace_sections.settings_marketplaces_section.s566', "المنصة:")} <strong style={{ color: '#170e5e' }}>{editRepricingModal.marketplace.toUpperCase()}</strong>
                  </div>
                  <div>
                    {t('settings.workspace_sections.settings_marketplaces_section.s567', "كود SKU:")} <strong style={{ fontFamily: 'monospace' }}>{editRepricingModal.marketplaceSku}</strong>
                  </div>
                  <div>
                    {t('settings.workspace_sections.settings_marketplaces_section.s568', "سعر البيع:")} <strong>{editRepricingModal.customPrice || editRepricingModal.retailPrice || 0} {t('settings.workspace_sections.settings_marketplaces_section.s569', "ج.م")}</strong>
                  </div>
                  <div>
                    {t('settings.workspace_sections.settings_marketplaces_section.s570', "سعر التكلفة:")} <strong style={{ color: '#059669' }}>{editRepricingModal.costPrice || 0} {t('settings.workspace_sections.settings_marketplaces_section.s571', "ج.م")}</strong>
                  </div>
                  <div>
                    {t('settings.workspace_sections.settings_marketplaces_section.s572', "سعر المنافس:")} <strong>{editRepricingModal.competitorPrice ? `${editRepricingModal.competitorPrice} ج.م` : t('settings.workspace_sections.settings_marketplaces_section.s573', "غير مسجل")}</strong>
                  </div>
                  <div>
                    {t('settings.workspace_sections.settings_marketplaces_section.s574', "سعر Buy Box:")} <strong>{editRepricingModal.buyBoxPrice ? `${editRepricingModal.buyBoxPrice} ج.م` : t('settings.workspace_sections.settings_marketplaces_section.s575', "غير مسجل")}</strong>
                  </div>
                </div>
              </div>

              {/* Bot Toggle Switch */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  cursor: 'pointer',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: repricingForm.repricingEnabled ? '#f0fdf4' : '#f8fafc',
                  border: `1px solid ${repricingForm.repricingEnabled ? '#86efac' : '#cbd5e1'}`,
                }}
              >
                <input
                  type="checkbox"
                  checked={repricingForm.repricingEnabled}
                  onChange={(e) => setRepricingForm({ ...repricingForm, repricingEnabled: e.target.checked })}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                <div>
                  <div style={{ fontWeight: 800, color: repricingForm.repricingEnabled ? '#15803d' : '#334155', fontSize: '13px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s576', "تفعيل روبوت إعادة التسعير الآلي التلقائي")}
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#64748b' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s577', "يقوم النظام برصد أسعار المنافسين وإعادة تعديل سعر الصنف تلقائياً للفوز بصندوق الشراء.")}
                  </div>
                </div>
              </label>

              {/* Repricing Rule */}
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s578', "استراتيجية وقاعدة التسعير (Repricing Strategy)")}
                </label>
                <select
                  value={repricingForm.repricingRule}
                  onChange={(e) => setRepricingForm({ ...repricingForm, repricingRule: e.target.value as any })}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#ffffff' }}
                >
                  <option value="undercut_buy_box">{t('settings.workspace_sections.settings_marketplaces_section.s579', "النزول عن سعر صندوق الشراء (Buy Box) بقيمة فارق — للفوز الفوري")}</option>
                  <option value="match_buy_box">{t('settings.workspace_sections.settings_marketplaces_section.s580', "مطابقة سعر صندوق الشراء (Buy Box) بدقة")}</option>
                  <option value="undercut_lowest">{t('settings.workspace_sections.settings_marketplaces_section.s581', "النزول عن أقل منافس في السوق بقيمة فارق")}</option>
                  <option value="match_lowest">{t('settings.workspace_sections.settings_marketplaces_section.s582', "مطابقة أقل سعر منافس في السوق")}</option>
                </select>
              </div>

              {/* Delta & Floor/Ceiling Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s583', "الفارق السعري (Delta - ج.م)")}
                  </label>
                  <input
                    type="number"
                    min="0.25"
                    step="0.5"
                    value={repricingForm.repricingDelta}
                    onChange={(e) => setRepricingForm({ ...repricingForm, repricingDelta: e.target.value })}
                    placeholder="1"
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s584', "الحد الأدنى (Floor - ج.م)")}
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={repricingForm.minPrice}
                    onChange={(e) => setRepricingForm({ ...repricingForm, minPrice: e.target.value })}
                    placeholder={String(Math.ceil((editRepricingModal.costPrice || 0) * 1.05))}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s585', "الحد الأقصى (Ceiling - ج.م)")}
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={repricingForm.maxPrice}
                    onChange={(e) => setRepricingForm({ ...repricingForm, maxPrice: e.target.value })}
                    placeholder={String(Math.ceil((editRepricingModal.retailPrice || 100) * 1.5))}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                  />
                </div>
              </div>

              {/* Safety Margin Alert */}
              {Number(repricingForm.minPrice) > 0 && Number(repricingForm.minPrice) < (editRepricingModal.costPrice || 0) ? (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: '#b91c1c' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s586', "تنبيه: الحد الأدنى الذي أدخلته (")}{repricingForm.minPrice} {t('settings.workspace_sections.settings_marketplaces_section.s587', "ج.م) أقل من سعر التكلفة (")}{editRepricingModal.costPrice} {t('settings.workspace_sections.settings_marketplaces_section.s588', "ج.م). سيمنع النظام الروبوت من البيع بخسارة!")}
                </div>
              ) : (
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: '#64748b' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s589', "قاعدة الأمان: لن يقوم الروبوت بتخفيض السعر إطلاقاً تحت الحد الأدنى، وسيرفع السعر تلقائياً إلى الحد الأقصى إذا نفد مخزون المنافسين.")}
                </div>
              )}
            </div>
          ) : null}

          {/* Action buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
            <Button variant="secondary" onClick={() => setEditRepricingModal(null)}>
              {t('settings.workspace_sections.settings_marketplaces_section.s590', "إلغاء")}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (!editRepricingModal) return;
                const min = Number(repricingForm.minPrice) || undefined;
                const max = Number(repricingForm.maxPrice) || undefined;
                const delta = Number(repricingForm.repricingDelta) || 1;

                if (min && max && min >= max) {
                  toast.error(t('settings.workspace_sections.settings_marketplaces_section.s591', "الحد الأدنى يجب أن يكون أقل من الحد الأقصى للسعر"));
                  return;
                }

                saveRepricingMutation.mutate({
                  id: editRepricingModal.id,
                  payload: {
                    repricingEnabled: repricingForm.repricingEnabled,
                    minPrice: min,
                    maxPrice: max,
                    repricingRule: repricingForm.repricingRule,
                    repricingDelta: delta,
                  },
                });
              }}
              disabled={saveRepricingMutation.isPending}
              style={{ background: '#170e5e', color: '#ffffff' }}
            >
              {saveRepricingMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s592', "جاري الحفظ...") : t('settings.workspace_sections.settings_marketplaces_section.s593', "حفظ إعدادات الروبوت")}
            </Button>
          </div>
        </div>
      </DialogShell>

      {/* ========================================================================= */}
      {/* MODAL 6: CREATE FBA / FBN INBOUND SHIPMENT MODAL */}
      {/* ========================================================================= */}
      <DialogShell
        open={showInboundModal}
        onClose={() => setShowInboundModal(false)}
        width="min(760px, 95vw)"
        ariaLabel={t('settings.workspace_sections.settings_marketplaces_section.s594', "إنشاء إذن توريد جديد FBA / FBN")}
      >
        <div dir="rtl" style={{ background: '#ffffff', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TruckIcon size={18} color="#170e5e" />
              <span>{t('settings.workspace_sections.settings_marketplaces_section.s595', "إنشاء إذن توريد وشحن لمستودعات FBA و FBN")}</span>
            </h4>
            <button
              type="button"
              onClick={() => setShowInboundModal(false)}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center' }}
            >
              <XIcon size={18} />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Top Form Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s596', "المنصة الوجهة")}
                </label>
                <select
                  value={inboundForm.marketplace}
                  onChange={(e) => {
                    const mp = e.target.value as 'amazon' | 'noon';
                    setInboundForm({
                      ...inboundForm,
                      marketplace: mp,
                      fulfillmentCenterId: mp === 'amazon' ? 'CAI1' : 'EGP1',
                    });
                  }}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#ffffff' }}
                >
                  <option value="amazon">{t('settings.workspace_sections.settings_marketplaces_section.s597', "أمازون (FBA - Fulfillment By Amazon)")}</option>
                  <option value="noon">{t('settings.workspace_sections.settings_marketplaces_section.s598', "نون (FBN - Fulfillment By Noon)")}</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s599', "مركز التوزيع المستلم (FC)")}
                </label>
                <input
                  type="text"
                  value={inboundForm.fulfillmentCenterId}
                  onChange={(e) => setInboundForm({ ...inboundForm, fulfillmentCenterId: e.target.value })}
                  placeholder={inboundForm.marketplace === 'amazon' ? t('settings.workspace_sections.settings_marketplaces_section.s600', "مثال: CAI1 أو CAI2") : t('settings.workspace_sections.settings_marketplaces_section.s601', "مثال: EGP1 أو EGP2")}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s602', "رقم الشحنة الخارجي / التتبع")}
                </label>
                <input
                  type="text"
                  value={inboundForm.trackingNumber}
                  onChange={(e) => setInboundForm({ ...inboundForm, trackingNumber: e.target.value })}
                  placeholder={t('settings.workspace_sections.settings_marketplaces_section.s603', "مثال: FBA17XXXXXX أو PO-89231")}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>
            </div>

            {/* Add Items Box */}
            <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '13px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s604', "إضافة الأصناف المشحونة إلى الكراتين:")}</div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 240px' }}>
                  <label style={{ display: 'block', fontSize: '12px', color: '#475569', marginBottom: '3px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s605', "اختيار الصنف")}</label>
                  <select
                    value={inboundForm.selectedProductId}
                    onChange={(e) => setInboundForm({ ...inboundForm, selectedProductId: Number(e.target.value) })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', background: '#ffffff' }}
                  >
                    <option value={0}>{t('settings.workspace_sections.settings_marketplaces_section.s606', "-- اختر صنفاً للشحن --")}</option>
                    {availableProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.barcode || (p as any).style_code || (p as any).styleCode || `#${p.id}`})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#475569', marginBottom: '3px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s607', "رقم الكرتونة")}</label>
                  <input
                    type="number"
                    min="1"
                    value={inboundForm.boxNumber}
                    onChange={(e) => setInboundForm({ ...inboundForm, boxNumber: e.target.value })}
                    style={{ width: '80px', padding: '7px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px' }}
                  />
                </div>

                {/* Strict RTL Stepper: Plus on RIGHT, Minus on LEFT! */}
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#475569', marginBottom: '3px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s608', "الكمية المشحونة")}</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <button
                      type="button"
                      onClick={() => {
                        const cur = Math.max(1, Number(inboundForm.quantity) || 1);
                        setInboundForm({ ...inboundForm, quantity: String(cur + 1) });
                      }}
                      style={{ width: '30px', height: '32px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#ffffff', fontWeight: 800, cursor: 'pointer', fontSize: '14px', color: '#0f172a' }}
                      title={t('settings.workspace_sections.settings_marketplaces_section.s609', "زيادة الكمية")}
                    >
                      +
                    </button>
                    <input
                      type="number"
                      min="1"
                      value={inboundForm.quantity}
                      onChange={(e) => setInboundForm({ ...inboundForm, quantity: e.target.value })}
                      style={{ width: '60px', height: '32px', textAlign: 'center', padding: '4px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '13px', fontWeight: 800 }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const cur = Math.max(1, Number(inboundForm.quantity) || 1);
                        setInboundForm({ ...inboundForm, quantity: String(Math.max(1, cur - 1)) });
                      }}
                      style={{ width: '30px', height: '32px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#ffffff', fontWeight: 800, cursor: 'pointer', fontSize: '14px', color: '#0f172a' }}
                      title={t('settings.workspace_sections.settings_marketplaces_section.s610', "إنقاص الكمية")}
                    >
                      −
                    </button>
                  </div>
                </div>

                <Button
                  variant="primary"
                  onClick={() => {
                    if (!inboundForm.selectedProductId) {
                      toast.error(t('settings.workspace_sections.settings_marketplaces_section.s611', "يرجى اختيار صنف أولاً"));
                      return;
                    }
                    const prod = availableProducts.find((p) => Number(p.id) === Number(inboundForm.selectedProductId));
                    if (!prod) return;
                    const qty = Number(inboundForm.quantity) || 1;
                    const box = Number(inboundForm.boxNumber) || 1;

                    const mapping = mappings.find((m) => Number(m.productId) === Number(prod.id) && m.marketplace === inboundForm.marketplace);
                    const sku = mapping ? mapping.marketplaceSku : prod.barcode || (prod as any).style_code || `SKU-${prod.id}`;

                    const newItem: FbaInboundItem = {
                      productId: Number(prod.id),
                      marketplaceSku: sku,
                      productName: prod.name,
                      barcode: prod.barcode || undefined,
                      quantityShipped: qty,
                      boxNumber: box,
                    };

                    setInboundForm({
                      ...inboundForm,
                      items: [...inboundForm.items, newItem],
                      selectedProductId: 0,
                      quantity: '10',
                    });
                    toast.success(`تمت إضافة ${qty} قطعة من ${prod.name}`);
                  }}
                  style={{ background: '#170e5e', color: '#ffffff', height: '32px', fontSize: '12px' }}
                >
                  {t('settings.workspace_sections.settings_marketplaces_section.s612', "+ إضافة للشحنة")}
                </Button>
              </div>

              {/* Items List Table */}
              {inboundForm.items.length > 0 ? (
                <div style={{ marginTop: '8px', border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden', background: '#ffffff' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                        <th style={{ padding: '6px 10px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s613', "الصنف")}</th>
                        <th style={{ padding: '6px 10px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s614', "كود المنصة (SKU / FNSKU)")}</th>
                        <th style={{ padding: '6px 10px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s615', "رقم الكرتونة")}</th>
                        <th style={{ padding: '6px 10px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s616', "الكمية")}</th>
                        <th style={{ padding: '6px 10px', textAlign: 'center' }}>{t('settings.workspace_sections.settings_marketplaces_section.s617', "إجراء")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inboundForm.items.map((it, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '6px 10px', fontWeight: 600 }}>{it.productName}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: '#170e5e' }}>{it.marketplaceSku}</td>
                          <td style={{ padding: '6px 10px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s618', "كرتونة #")}{it.boxNumber || 1}</td>
                          <td style={{ padding: '6px 10px', fontWeight: 800, color: '#15803d' }}>{it.quantityShipped} {t('settings.workspace_sections.settings_marketplaces_section.s619', "قطعة")}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => {
                                const newItems = [...inboundForm.items];
                                newItems.splice(idx, 1);
                                setInboundForm({ ...inboundForm, items: newItems });
                              }}
                              style={{ border: 'none', background: 'transparent', color: '#b91c1c', cursor: 'pointer', fontSize: '12px' }}
                            >
                              {t('settings.workspace_sections.settings_marketplaces_section.s620', "حذف")}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ padding: '8px 12px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 700 }}>
                    <span>{t('settings.workspace_sections.settings_marketplaces_section.s621', "إجمالي الأصناف:")} {inboundForm.items.length}</span>
                    <span style={{ color: '#15803d' }}>
                      {t('settings.workspace_sections.settings_marketplaces_section.s622', "إجمالي القطع المشحونة:")} {inboundForm.items.reduce((s, it) => s + it.quantityShipped, 0)} {t('settings.workspace_sections.settings_marketplaces_section.s623', "قطعة")}
                    </span>
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '12px', color: '#94a3b8', fontSize: '12px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s624', "لم يتم إضافة أصناف للشحنة بعد. اختر صنفاً وحدد الكمية ثم اضغط \"+ إضافة للشحنة\".")}
                </div>
              )}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s625', "ملاحظات إذن التوريد")}
              </label>
              <textarea
                rows={2}
                value={inboundForm.notes}
                onChange={(e) => setInboundForm({ ...inboundForm, notes: e.target.value })}
                placeholder={t('settings.workspace_sections.settings_marketplaces_section.s626', "ملاحظات لفرق التجهيز أو مستلمي المستودع...")}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12.5px', resize: 'vertical' }}
              />
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
            <Button variant="secondary" onClick={() => setShowInboundModal(false)}>
              {t('settings.workspace_sections.settings_marketplaces_section.s627', "إلغاء")}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (!inboundForm.fulfillmentCenterId.trim()) {
                  toast.error(t('settings.workspace_sections.settings_marketplaces_section.s628', "يرجى إدخال كود مركز التوزيع المستلم"));
                  return;
                }
                if (inboundForm.items.length === 0) {
                  toast.error(t('settings.workspace_sections.settings_marketplaces_section.s629', "يرجى إضافة صنف واحد على الأقل للشحنة"));
                  return;
                }

                const totalUnits = inboundForm.items.reduce((s, it) => s + it.quantityShipped, 0);
                const boxSet = new Set(inboundForm.items.map((it) => it.boxNumber || 1));

                createInboundMutation.mutate({
                  marketplace: inboundForm.marketplace,
                  fulfillmentCenterId: inboundForm.fulfillmentCenterId,
                  items: inboundForm.items,
                  totalUnits,
                  totalBoxes: boxSet.size || 1,
                  trackingNumber: inboundForm.trackingNumber.trim() || undefined,
                  notes: inboundForm.notes.trim() || undefined,
                  status: 'draft',
                });
              }}
              disabled={createInboundMutation.isPending}
              style={{ background: '#170e5e', color: '#ffffff' }}
            >
              {createInboundMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s630', "جاري إنشاء إذن التوريد...") : t('settings.workspace_sections.settings_marketplaces_section.s631', "تأكيد إنشاء إذن التوريد وحجز الكميات")}
            </Button>
          </div>
        </div>
      </DialogShell>

      {/* ========================================================================= */}
      {/* MODAL 7: FNSKU BARCODE THERMAL PRINTING MODAL */}
      {/* ========================================================================= */}
      <DialogShell
        open={!!printFnskuModal}
        onClose={() => setPrintFnskuModal(null)}
        width="min(540px, 95vw)"
        ariaLabel={t('settings.workspace_sections.settings_marketplaces_section.s632', "طباعة ملصقات الباركود FNSKU")}
      >
        <div dir="rtl" style={{ background: '#ffffff', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s633', "طباعة ملصقات الباركود FNSKU / FBN للوحدات")}
              </h4>
              <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#64748b' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s634', "طباعة باركودات التتبع للوحدات الفردية قبل شحنها لمستودعات أمازون ونون")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPrintFnskuModal(null)}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center' }}
            >
              <XIcon size={18} />
            </button>
          </div>

          {printFnskuModal ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Product Info Card */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px', fontSize: '12.5px' }}>
                <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>{printFnskuModal.productName}</div>
                <div style={{ display: 'flex', gap: '16px', color: '#64748b', fontSize: '12px' }}>
                  <span>{t('settings.workspace_sections.settings_marketplaces_section.s635', "كود المنصة:")} <strong style={{ color: '#0f172a', fontFamily: 'monospace' }}>{printFnskuModal.marketplaceSku}</strong></span>
                  <span>{t('settings.workspace_sections.settings_marketplaces_section.s636', "المنصة:")} <strong style={{ color: '#0f172a', textTransform: 'uppercase' }}>{printFnskuModal.marketplace}</strong></span>
                  <span>{t('settings.workspace_sections.settings_marketplaces_section.s637', "الحالة:")} <strong style={{ color: '#16a34a' }}>{printFnskuModal.condition}</strong></span>
                </div>
              </div>

              {/* Print Configuration Form */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s638', "مقاس ونوع الملصق")}
                  </label>
                  <select
                    value={printFnskuModal.format}
                    onChange={(e) => setPrintFnskuModal({ ...printFnskuModal, format: e.target.value as any })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12.5px', background: '#ffffff' }}
                  >
                    <option value="thermal_50x30">{t('settings.workspace_sections.settings_marketplaces_section.s639', "رول حراري 50 × 30 مم (أمازون / Xprinter)")}</option>
                    <option value="thermal_40x25">{t('settings.workspace_sections.settings_marketplaces_section.s640', "رول حراري 40 × 25 مم (نون / Zebra)")}</option>
                    <option value="a4_44up">{t('settings.workspace_sections.settings_marketplaces_section.s641', "ورقة A4 ملصقات جاهزة (44 ملصق بالورقة)")}</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s642', "عدد النسخ (الملصقات)")}
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                      type="button"
                      onClick={() => setPrintFnskuModal({ ...printFnskuModal, copies: printFnskuModal.copies + 1 })}
                      style={{ width: '32px', height: '32px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', fontSize: '16px', fontWeight: 700 }}
                      title={t('settings.workspace_sections.settings_marketplaces_section.s643', "زيادة")}
                    >
                      +
                    </button>
                    <input
                      type="number"
                      min={1}
                      value={printFnskuModal.copies}
                      onChange={(e) => setPrintFnskuModal({ ...printFnskuModal, copies: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                      style={{ width: '60px', height: '32px', textAlign: 'center', borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 700, fontSize: '13px' }}
                    />
                    <button
                      type="button"
                      onClick={() => setPrintFnskuModal({ ...printFnskuModal, copies: Math.max(1, printFnskuModal.copies - 1) })}
                      style={{ width: '32px', height: '32px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', fontSize: '16px', fontWeight: 700 }}
                      title={t('settings.workspace_sections.settings_marketplaces_section.s644', "إنقاص")}
                    >
                      -
                    </button>
                  </div>
                </div>
              </div>

              {/* Label Visual Live Preview */}
              <div>
                <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s645', "معاينة الملصق على الطبيعة (Live Label Preview)")}
                </label>
                <div style={{ display: 'flex', justifyContent: 'center', padding: '16px', background: '#f1f5f9', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
                  <div
                    style={{
                      background: '#ffffff',
                      border: '1px solid #000000',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      width: '210px',
                      textAlign: 'center',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                    }}
                  >
                    <div style={{ fontSize: '12px', fontWeight: 800, fontFamily: 'monospace', letterSpacing: '1px' }}>
                      {printFnskuModal.marketplaceSku}
                    </div>
                    {/* SVG Barcode Graphic */}
                    <div style={{ margin: '4px 0' }}>
                      <svg viewBox="0 0 160 38" style={{ width: '100%', height: '30px' }}>
                        <rect x="0" y="0" width="3" height="38" fill="#000" />
                        <rect x="5" y="0" width="2" height="38" fill="#000" />
                        <rect x="9" y="0" width="4" height="38" fill="#000" />
                        <rect x="15" y="0" width="2" height="38" fill="#000" />
                        <rect x="19" y="0" width="5" height="38" fill="#000" />
                        <rect x="26" y="0" width="2" height="38" fill="#000" />
                        <rect x="30" y="0" width="4" height="38" fill="#000" />
                        <rect x="36" y="0" width="2" height="38" fill="#000" />
                        <rect x="40" y="0" width="5" height="38" fill="#000" />
                        <rect x="47" y="0" width="3" height="38" fill="#000" />
                        <rect x="52" y="0" width="2" height="38" fill="#000" />
                        <rect x="56" y="0" width="4" height="38" fill="#000" />
                        <rect x="62" y="0" width="2" height="38" fill="#000" />
                        <rect x="66" y="0" width="5" height="38" fill="#000" />
                        <rect x="73" y="0" width="3" height="38" fill="#000" />
                        <rect x="78" y="0" width="2" height="38" fill="#000" />
                        <rect x="82" y="0" width="4" height="38" fill="#000" />
                        <rect x="88" y="0" width="2" height="38" fill="#000" />
                        <rect x="92" y="0" width="6" height="38" fill="#000" />
                        <rect x="100" y="0" width="2" height="38" fill="#000" />
                        <rect x="104" y="0" width="4" height="38" fill="#000" />
                        <rect x="110" y="0" width="2" height="38" fill="#000" />
                        <rect x="114" y="0" width="5" height="38" fill="#000" />
                        <rect x="121" y="0" width="3" height="38" fill="#000" />
                        <rect x="126" y="0" width="2" height="38" fill="#000" />
                        <rect x="130" y="0" width="4" height="38" fill="#000" />
                        <rect x="136" y="0" width="2" height="38" fill="#000" />
                        <rect x="140" y="0" width="5" height="38" fill="#000" />
                        <rect x="147" y="0" width="3" height="38" fill="#000" />
                        <rect x="152" y="0" width="4" height="38" fill="#000" />
                      </svg>
                    </div>
                    <div style={{ fontSize: '9.5px', color: '#334155', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {printFnskuModal.productName}
                    </div>
                    <div style={{ fontSize: '8.5px', fontWeight: 700, color: '#16a34a', marginTop: '2px' }}>
                      {printFnskuModal.condition}
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                <Button variant="secondary" onClick={() => setPrintFnskuModal(null)}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s646', "إلغاء")}
                </Button>
                <Button
                  variant="primary"
                  onClick={handlePrintFnskuLabels}
                  style={{ background: '#170e5e', color: '#ffffff', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <PrinterIcon size={16} />
                  {t('settings.workspace_sections.settings_marketplaces_section.s647', "طباعة")} {printFnskuModal.copies} {t('settings.workspace_sections.settings_marketplaces_section.s648', "ملصق الآن")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </DialogShell>

      {/* ========================================================================= */}
      {/* MODAL 8: RECEIVING & DISCREPANCIES CHECK-IN MODAL */}
      {/* ========================================================================= */}
      <DialogShell
        open={!!receiveShipmentModal}
        onClose={() => setReceiveShipmentModal(null)}
        width="min(760px, 95vw)"
        ariaLabel={t('settings.workspace_sections.settings_marketplaces_section.s649', "تسجيل استلام الشحنة وفحص الفروقات")}
      >
        <div dir="rtl" style={{ background: '#ffffff', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s650', "تسجيل استلام الشحنة وفحص عجز المستودع (Receiving & Discrepancies)")}
              </h4>
              <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#64748b' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s651', "إذن توريد رقم:")} <strong style={{ color: '#0f172a' }}>{receiveShipmentModal?.shipmentNumber}</strong> {t('settings.workspace_sections.settings_marketplaces_section.s652', "| المستودع المستلم:")}{' '}
                <strong style={{ color: '#0f172a' }}>{receiveShipmentModal?.fulfillmentCenterId}</strong> ({receiveShipmentModal?.marketplace.toUpperCase()})
              </p>
            </div>
            <button
              type="button"
              onClick={() => setReceiveShipmentModal(null)}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center' }}
            >
              <XIcon size={18} />
            </button>
          </div>

          {receiveShipmentModal ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                  <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <tr>
                      <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: '#475569' }}>{t('settings.workspace_sections.settings_marketplaces_section.s653', "الصنف / كود المنصة")}</th>
                      <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, color: '#475569' }}>{t('settings.workspace_sections.settings_marketplaces_section.s654', "الكمية المشحونة")}</th>
                      <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, color: '#475569' }}>{t('settings.workspace_sections.settings_marketplaces_section.s655', "الكمية المستلمة فعلياً")}</th>
                      <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, color: '#475569' }}>{t('settings.workspace_sections.settings_marketplaces_section.s656', "الفارق / العجز")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receiveShipmentModal.items.map((it) => {
                      const receivedVal = parseInt(receiveFormItems[it.marketplaceSku] ?? String(it.quantityReceived ?? it.quantityShipped), 10) || 0;
                      const diff = receivedVal - it.quantityShipped;

                      return (
                        <tr key={it.marketplaceSku} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '8px 12px' }}>
                            <div style={{ fontWeight: 700, color: '#0f172a' }}>{it.productName}</div>
                            <div style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace' }}>{it.marketplaceSku}</div>
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, color: '#0f172a' }}>
                            {it.quantityShipped}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              <button
                                type="button"
                                onClick={() =>
                                  setReceiveFormItems({
                                    ...receiveFormItems,
                                    [it.marketplaceSku]: String(receivedVal + 1),
                                  })
                                }
                                style={{ width: '26px', height: '26px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', fontWeight: 700 }}
                              >
                                +
                              </button>
                              <input
                                type="number"
                                min={0}
                                value={receivedVal}
                                onChange={(e) =>
                                  setReceiveFormItems({
                                    ...receiveFormItems,
                                    [it.marketplaceSku]: e.target.value,
                                  })
                                }
                                style={{ width: '55px', height: '26px', textAlign: 'center', borderRadius: '4px', border: '1px solid #cbd5e1', fontWeight: 700, fontSize: '12px' }}
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setReceiveFormItems({
                                    ...receiveFormItems,
                                    [it.marketplaceSku]: String(Math.max(0, receivedVal - 1)),
                                  })
                                }
                                style={{ width: '26px', height: '26px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', fontWeight: 700 }}
                              >
                                -
                              </button>
                            </div>
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                            {diff < 0 ? (
                              <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#fee2e2', color: '#dc2626', fontWeight: 700 }}>
                                {t('settings.workspace_sections.settings_marketplaces_section.s657', "عجز")} {Math.abs(diff)} {t('settings.workspace_sections.settings_marketplaces_section.s658', "قطعة")}
                              </span>
                            ) : diff === 0 ? (
                              <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#dcfce7', color: '#16a34a', fontWeight: 700 }}>
                                {t('settings.workspace_sections.settings_marketplaces_section.s659', "مطابق 100%")}
                              </span>
                            ) : (
                              <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#dbeafe', color: '#2563eb', fontWeight: 700 }}>
                                {t('settings.workspace_sections.settings_marketplaces_section.s660', "زيادة +")}{diff} {t('settings.workspace_sections.settings_marketplaces_section.s661', "قطعة")}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Summary Calculation */}
              {(() => {
                const totalShipped = receiveShipmentModal.items.reduce((s, it) => s + it.quantityShipped, 0);
                const totalReceived = receiveShipmentModal.items.reduce((s, it) => {
                  const val = parseInt(receiveFormItems[it.marketplaceSku] ?? String(it.quantityReceived ?? it.quantityShipped), 10) || 0;
                  return s + val;
                }, 0);
                const totalDiscrepancy = Math.max(0, totalShipped - totalReceived);

                return (
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12.5px' }}>
                    <div>
                      <span>{t('settings.workspace_sections.settings_marketplaces_section.s662', "إجمالي المشحون:")} <strong>{totalShipped}</strong> {t('settings.workspace_sections.settings_marketplaces_section.s663', "قطعة")}</span>
                      <span style={{ margin: '0 8px', color: '#cbd5e1' }}>|</span>
                      <span>{t('settings.workspace_sections.settings_marketplaces_section.s664', "المستلم الفعلي:")} <strong style={{ color: '#16a34a' }}>{totalReceived}</strong> {t('settings.workspace_sections.settings_marketplaces_section.s665', "قطعة")}</span>
                    </div>
                    <div>
                      {totalDiscrepancy > 0 ? (
                        <span style={{ color: '#dc2626', fontWeight: 800 }}>
                          {t('settings.workspace_sections.settings_marketplaces_section.s666', "إجمالي الفاقد والعجز:")} {totalDiscrepancy} {t('settings.workspace_sections.settings_marketplaces_section.s667', "قطعة مفقودة")}
                        </span>
                      ) : (
                        <span style={{ color: '#16a34a', fontWeight: 800 }}>
                          {t('settings.workspace_sections.settings_marketplaces_section.s668', "الشحنة مطابقة بالكامل دون أي عجز")}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                <Button variant="secondary" onClick={() => setReceiveShipmentModal(null)}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s669', "إلغاء")}
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    const receivedItems = receiveShipmentModal.items.map((it) => ({
                      productId: it.productId,
                      marketplaceSku: it.marketplaceSku,
                      quantityReceived: parseInt(receiveFormItems[it.marketplaceSku] ?? String(it.quantityReceived ?? it.quantityShipped), 10) || 0,
                    }));
                    receiveShipmentMutation.mutate({
                      id: receiveShipmentModal.id,
                      receivedItems,
                    });
                  }}
                  disabled={receiveShipmentMutation.isPending}
                  style={{ background: '#170e5e', color: '#ffffff' }}
                >
                  {receiveShipmentMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s670', "جاري تسجيل الاستلام...") : t('settings.workspace_sections.settings_marketplaces_section.s671', "تأكيد الاستلام وحفظ تقرير الفروقات")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </DialogShell>

      {/* ========================================================================= */}
      {/* MODAL 9: DISCREPANCY & SAFE-T CLAIM REPORT MODAL */}
      {/* ========================================================================= */}
      <DialogShell
        open={!!claimReportModal}
        onClose={() => setClaimReportModal(null)}
        width="min(800px, 95vw)"
        ariaLabel={t('settings.workspace_sections.settings_marketplaces_section.s672', "تقرير ومطالبة التعويض Safe-T / Dispute")}
      >
        <div dir="rtl" style={{ background: '#ffffff', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s673', "تقرير المطالبة المالية وفروقات الشحنة (Safe-T / Dispute Claim)")}
              </h4>
              <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#64748b' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s674', "مطالبة رسمية جاهزة للتقديم لفريق دعم البائعين لدى")} {claimReportModal?.marketplace.toUpperCase()} {t('settings.workspace_sections.settings_marketplaces_section.s675', "للشحنة")} {claimReportModal?.shipmentNumber}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setClaimReportModal(null)}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center' }}
            >
              <XIcon size={18} />
            </button>
          </div>

          {claimReportModal ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Claim Overview Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '12px 14px' }}>
                  <div style={{ fontSize: '11.5px', color: '#991b1b', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s676', "إجمالي القطع المفقودة (العجز)")}</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: '#dc2626', marginTop: '2px' }}>
                    {claimReportModal.missingUnits} {t('settings.workspace_sections.settings_marketplaces_section.s677', "قطعة")}
                  </div>
                </div>

                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '12px 14px' }}>
                  <div style={{ fontSize: '11.5px', color: '#166534', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s678', "إجمالي قيمة التعويض المطالب به")}</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: '#16a34a', marginTop: '2px' }}>
                    {claimReportModal.estimatedReimbursementAmount.toLocaleString()} {t('settings.workspace_sections.settings_marketplaces_section.s679', "ج.م")}
                  </div>
                </div>

                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 14px' }}>
                  <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>{t('settings.workspace_sections.settings_marketplaces_section.s680', "المستودع المستلم")}</div>
                  <div style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                    {claimReportModal.fulfillmentCenterId}
                  </div>
                </div>
              </div>

              {/* Language Switcher & Claim Template Text */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', background: '#f1f5f9', padding: '3px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <button
                    type="button"
                    onClick={() => setClaimLanguage('en')}
                    style={{
                      padding: '4px 12px',
                      fontSize: '12px',
                      fontWeight: 600,
                      borderRadius: '4px',
                      border: 'none',
                      background: claimLanguage === 'en' ? '#ffffff' : 'transparent',
                      color: claimLanguage === 'en' ? '#170e5e' : '#64748b',
                      cursor: 'pointer',
                    }}
                  >
                    English (Amazon / Noon Support)
                  </button>
                  <button
                    type="button"
                    onClick={() => setClaimLanguage('ar')}
                    style={{
                      padding: '4px 12px',
                      fontSize: '12px',
                      fontWeight: 600,
                      borderRadius: '4px',
                      border: 'none',
                      background: claimLanguage === 'ar' ? '#ffffff' : 'transparent',
                      color: claimLanguage === 'ar' ? '#170e5e' : '#64748b',
                      cursor: 'pointer',
                    }}
                  >
                    {t('settings.workspace_sections.settings_marketplaces_section.s681', "العربية (صيغة محلية)")}
                  </button>
                </div>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const textToCopy = claimLanguage === 'en' ? claimReportModal.generatedClaimTemplateEn : claimReportModal.generatedClaimTemplateAr;
                    navigator.clipboard.writeText(textToCopy);
                    toast.success(t('settings.workspace_sections.settings_marketplaces_section.s682', "تم نسخ نص المطالبة بالكامل إلى الحافظة بنجاح"));
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <CopyIcon size={14} />
                  {t('settings.workspace_sections.settings_marketplaces_section.s683', "نسخ نص التقرير والمطالبة")}
                </Button>
              </div>

              {/* Claim Body Box */}
              <div
                dir={claimLanguage === 'en' ? 'ltr' : 'rtl'}
                style={{
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: '8px',
                  padding: '16px',
                  maxHeight: '260px',
                  overflowY: 'auto',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  lineHeight: '1.6',
                  whiteSpace: 'pre-wrap',
                  color: '#1e293b',
                }}
              >
                {claimLanguage === 'en' ? claimReportModal.generatedClaimTemplateEn : claimReportModal.generatedClaimTemplateAr}
              </div>

              {/* Items Breakdown Table */}
              <div>
                <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s684', "تفاصيل الأصناف التي بها عجز:")}
                </div>
                <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                      <tr>
                        <th style={{ padding: '6px 10px', textAlign: 'right' }}>{t('settings.workspace_sections.settings_marketplaces_section.s685', "الصنف")}</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right' }}>{t('settings.workspace_sections.settings_marketplaces_section.s686', "كود المنصة (SKU)")}</th>
                        <th style={{ padding: '6px 10px', textAlign: 'center' }}>{t('settings.workspace_sections.settings_marketplaces_section.s687', "مشحون")}</th>
                        <th style={{ padding: '6px 10px', textAlign: 'center' }}>{t('settings.workspace_sections.settings_marketplaces_section.s688', "مستلم")}</th>
                        <th style={{ padding: '6px 10px', textAlign: 'center' }}>{t('settings.workspace_sections.settings_marketplaces_section.s689', "العجز")}</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right' }}>{t('settings.workspace_sections.settings_marketplaces_section.s690', "سعر التكلفة")}</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right' }}>{t('settings.workspace_sections.settings_marketplaces_section.s691', "مبلغ التعويض")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {claimReportModal.items.map((it: any, idx: number) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '6px 10px', fontWeight: 600 }}>{it.productName}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: '#64748b' }}>{it.marketplaceSku}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'center' }}>{it.shipped}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'center', color: '#16a34a' }}>{it.received}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'center', color: '#dc2626', fontWeight: 700 }}>
                            {it.missing}
                          </td>
                          <td style={{ padding: '6px 10px', textAlign: 'right' }}>{it.costPrice} {t('settings.workspace_sections.settings_marketplaces_section.s692', "ج.م")}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>
                            {it.claimAmount.toLocaleString()} {t('settings.workspace_sections.settings_marketplaces_section.s693', "ج.م")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                <Button variant="secondary" onClick={() => setClaimReportModal(null)}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s694', "إغلاق")}
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    const textToCopy = claimLanguage === 'en' ? claimReportModal.generatedClaimTemplateEn : claimReportModal.generatedClaimTemplateAr;
                    navigator.clipboard.writeText(textToCopy);
                    toast.success(t('settings.workspace_sections.settings_marketplaces_section.s695', "تم نسخ نص المطالبة إلى الحافظة"));
                  }}
                  style={{ background: '#170e5e', color: '#ffffff', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <CopyIcon size={16} />
                  {t('settings.workspace_sections.settings_marketplaces_section.s696', "نسخ نص المطالبة لتقديمه للدعم")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </DialogShell>

      {/* ========================================================================= */}
      {/* MODAL 10: EDIT ONBOARDING PROFILE */}
      <EditOnboardingProfileModal
        open={showEditOnboardingModal}
        initialData={onboardingQuery.data || {}}
        targetSection={onboardingTargetSection}
        onClose={() => setShowEditOnboardingModal(false)}
        onSave={(data) => saveOnboardingMutation.mutate(data)}
        isSaving={saveOnboardingMutation.isPending}
      />

      {/* ========================================================================= */}
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

      {/* ========================================================================= */}
      {/* MODAL 12: GTIN / BARCODE EXEMPTION ASSISTANT */}
      {/* ========================================================================= */}
      <DialogShell
        open={showGtinModal}
        onClose={() => { setShowGtinModal(false); setGtinResult(null); }}
        width="min(760px, 95vw)"
        ariaLabel={t('settings.workspace_sections.settings_marketplaces_section.s706', "طلب إعفاء الباركود الدولي")}
      >
        <div dir="rtl" style={{ background: '#ffffff', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s707', "طلب إعفاء رسمي من الباركود الدولي (GTIN / EAN Exemption Assistant)")}
              </h4>
              <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#64748b' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s708', "توليد ملف طلب رسمي موجه لأمازون أو نون لإدراج منتجاتك المحلية أو الخاصة دون شراء باركود دولي GS1.")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setShowGtinModal(false); setGtinResult(null); }}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center' }}
            >
              <XIcon size={18} />
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s709', "اختيار الصنف من الـ ERP")}
              </label>
              <select
                value={gtinForm.productId || 0}
                onChange={(e) => setGtinForm({ ...gtinForm, productId: parseInt(e.target.value, 10) || undefined })}
                style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', background: '#ffffff' }}
              >
                <option value={0}>{t('settings.workspace_sections.settings_marketplaces_section.s710', "-- طلب إعفاء عام / صنف محدد --")}</option>
                {availableProducts.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s711', "اسم البراند / العلامة التجارية *")}
              </label>
              <input
                type="text"
                value={gtinForm.brandName}
                onChange={(e) => setGtinForm({ ...gtinForm, brandName: e.target.value })}
                placeholder={t('settings.workspace_sections.settings_marketplaces_section.s712', "مثال: Generic أو اسم علامتك")}
                style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s713', "فئة المنتج (Category) *")}
              </label>
              <input
                type="text"
                value={gtinForm.category}
                onChange={(e) => setGtinForm({ ...gtinForm, category: e.target.value })}
                placeholder={t('settings.workspace_sections.settings_marketplaces_section.s714', "مثال: Fashion, Home & Kitchen")}
                style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s715', "المنصة المستهدفة")}
              </label>
              <select
                value={gtinForm.marketplace}
                onChange={(e) => setGtinForm({ ...gtinForm, marketplace: e.target.value as any })}
                style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', background: '#ffffff' }}
              >
                <option value="amazon">{t('settings.workspace_sections.settings_marketplaces_section.s716', "أمازون (Amazon SP-API)")}</option>
                <option value="noon">{t('settings.workspace_sections.settings_marketplaces_section.s717', "نون (Noon Marketplace)")}</option>
              </select>
            </div>

            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s718', "سبب طلب الإعفاء (Exemption Reason)")}
              </label>
              <select
                value={gtinForm.reason}
                onChange={(e) => setGtinForm({ ...gtinForm, reason: e.target.value as any })}
                style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', background: '#ffffff' }}
              >
                <option value="unbranded">{t('settings.workspace_sections.settings_marketplaces_section.s719', "منتج عام بدون علامة تجارية (Generic / Unbranded item)")}</option>
                <option value="private_label">{t('settings.workspace_sections.settings_marketplaces_section.s720', "منتج علامة خاصة مصنع خصيصاً لنا (Private Label Product)")}</option>
                <option value="custom_manufacturing">{t('settings.workspace_sections.settings_marketplaces_section.s721', "منتجات يدوية أو تفصيلية لا تخضع للترقيم الدولي (Handmade / Custom)")}</option>
                <option value="parts_accessories">{t('settings.workspace_sections.settings_marketplaces_section.s722', "قطع غيار أو إكسسوارات تكميلية غير معبأة بباركود (Parts & Accessories)")}</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button
              variant="primary"
              onClick={() => {
                if (!gtinForm.brandName.trim()) {
                  toast.error(t('settings.workspace_sections.settings_marketplaces_section.s723', "يرجى كتابة اسم البراند أو كتابة Generic"));
                  return;
                }
                gtinMutation.mutate(gtinForm);
              }}
              disabled={gtinMutation.isPending}
              style={{ background: '#170e5e', color: '#ffffff' }}
            >
              {gtinMutation.isPending ? t('settings.workspace_sections.settings_marketplaces_section.s724', "جاري توليد ملف الإعفاء...") : t('settings.workspace_sections.settings_marketplaces_section.s725', "توليد خطاب وطلب الإعفاء الرسمي")}
            </Button>
          </div>

          {gtinResult ? (
            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', background: '#f1f5f9', padding: '3px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <button
                    type="button"
                    onClick={() => setGtinLanguage('en')}
                    style={{
                      padding: '4px 12px',
                      fontSize: '12px',
                      fontWeight: 600,
                      borderRadius: '4px',
                      border: 'none',
                      background: gtinLanguage === 'en' ? '#ffffff' : 'transparent',
                      color: gtinLanguage === 'en' ? '#170e5e' : '#64748b',
                      cursor: 'pointer',
                    }}
                  >
                    English (Amazon / Noon Support)
                  </button>
                  <button
                    type="button"
                    onClick={() => setGtinLanguage('ar')}
                    style={{
                      padding: '4px 12px',
                      fontSize: '12px',
                      fontWeight: 600,
                      borderRadius: '4px',
                      border: 'none',
                      background: gtinLanguage === 'ar' ? '#ffffff' : 'transparent',
                      color: gtinLanguage === 'ar' ? '#170e5e' : '#64748b',
                      cursor: 'pointer',
                    }}
                  >
                    {t('settings.workspace_sections.settings_marketplaces_section.s726', "العربية")}
                  </button>
                </div>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const text = gtinLanguage === 'en' ? gtinResult.letterEn : gtinResult.letterAr;
                    navigator.clipboard.writeText(text);
                    toast.success(t('settings.workspace_sections.settings_marketplaces_section.s727', "تم نسخ خطاب الإعفاء بنجاح"));
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <CopyIcon size={13} />
                  {t('settings.workspace_sections.settings_marketplaces_section.s728', "نسخ نص الخطاب")}
                </Button>
              </div>

              <div
                dir={gtinLanguage === 'en' ? 'ltr' : 'rtl'}
                style={{
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: '8px',
                  padding: '14px',
                  maxHeight: '220px',
                  overflowY: 'auto',
                  fontFamily: 'monospace',
                  fontSize: '11.5px',
                  lineHeight: '1.6',
                  whiteSpace: 'pre-wrap',
                  color: '#1e293b',
                }}
              >
                {gtinLanguage === 'en' ? gtinResult.letterEn : gtinResult.letterAr}
              </div>

              {/* Instructions */}
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '12px 14px' }}>
                <div style={{ fontSize: '12.5px', fontWeight: 800, color: '#166534', marginBottom: '6px' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s729', "خطوات تقديم الطلب لدى المنصة للحصول على الموافقة الفورية:")}
                </div>
                <ul style={{ margin: 0, paddingRight: '20px', fontSize: '12px', color: '#15803d', lineHeight: '1.6' }}>
                  {gtinResult.submissionInstructions.map((ins, i) => (
                    <li key={i}>{ins}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </div>
      </DialogShell>

      {/* ========================================================================= */}
      {/* MODAL 13: MARKETPLACE PHOTO READINESS & OPTIMIZER */}
      {/* ========================================================================= */}
      <DialogShell
        open={showPhotoOptimizerModal}
        onClose={() => { setShowPhotoOptimizerModal(false); setOptimizerImageSrc(null); setOptimizedImageResult(null); setImageMetrics(null); }}
        width="min(760px, 95vw)"
        ariaLabel={t('settings.workspace_sections.settings_marketplaces_section.s730', "فاحص ومحسن صور المنتجات")}
      >
        <div dir="rtl" style={{ background: '#ffffff', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s731', "فاحص ومحسن صور المنتجات للمنصات (Marketplace Photo Studio)")}
              </h4>
              <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#64748b' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s732', "فحص وضبط صور المنتجات تلقائياً لتوافق معايير أمازون ونون (خلفية بيضاء نقية 100%، مقاس 1500x1500px، ومطابقة التكبير Zoom).")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setShowPhotoOptimizerModal(false); setOptimizerImageSrc(null); setOptimizedImageResult(null); setImageMetrics(null); }}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center' }}
            >
              <XIcon size={18} />
            </button>
          </div>

          {/* Upload Area */}
          <div
            style={{
              border: '2px dashed #cbd5e1',
              borderRadius: '10px',
              padding: '24px',
              textAlign: 'center',
              background: '#f8fafc',
              cursor: 'pointer',
            }}
            onClick={() => {
              const fileInput = document.getElementById('marketplace-photo-file-input') as HTMLInputElement;
              fileInput?.click();
            }}
          >
            <input
              id="marketplace-photo-file-input"
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (event) => {
                  const url = event.target?.result as string;
                  setOptimizerImageSrc(url);
                  handleOptimizeProductImage(url);
                };
                reader.readAsDataURL(file);
              }}
            />
            <div style={{ color: '#170e5e', marginBottom: '8px' }}>
              <CameraIcon size={32} />
            </div>
            <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#0f172a' }}>
              {t('settings.workspace_sections.settings_marketplaces_section.s733', "انقر لاختيار صورة المنتج من جهازك أو اسحبها هنا")}
            </div>
            <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '4px' }}>
              {t('settings.workspace_sections.settings_marketplaces_section.s734', "يدعم صور الهاتف والكاميرا بصيغ (JPEG, PNG, WebP)")}
            </div>
          </div>

          {/* Analysis & Split Comparison View */}
          {optimizerImageSrc && imageMetrics ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Metrics Pills */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '6px', background: '#f1f5f9', color: '#334155' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s735', "الأبعاد الأصلية:")} <strong>{imageMetrics.width} × {imageMetrics.height} px</strong>
                </span>
                <span
                  style={{
                    fontSize: '12px',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    background: imageMetrics.isZoomable ? '#dcfce7' : '#fee2e2',
                    color: imageMetrics.isZoomable ? '#166534' : '#991b1b',
                    fontWeight: 700,
                  }}
                >
                  {imageMetrics.isZoomable ? t('settings.workspace_sections.settings_marketplaces_section.s736', "✓ دقة فائقة تفعل التكبير (Zoom Ready)") : t('settings.workspace_sections.settings_marketplaces_section.s737', "⚠ أقل من 1000px (ستتم مضاعفة الدقة)")}
                </span>
                <span
                  style={{
                    fontSize: '12px',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    background: '#e0e7ff',
                    color: '#3730a3',
                    fontWeight: 700,
                  }}
                >
                  {t('settings.workspace_sections.settings_marketplaces_section.s738', "الناتج المحسن: 1500 × 1500 px (مربع 1:1)")}
                </span>
              </div>

              {/* Split Preview */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                {/* Original */}
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px', textAlign: 'center', background: '#f8fafc' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', marginBottom: '8px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s739', "الصورة الأصلية المرفوعة")}</div>
                  <div style={{ width: '100%', height: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    <img src={optimizerImageSrc} alt="Original" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                  </div>
                </div>

                {/* Optimized */}
                <div style={{ border: '1px solid #bbf7d0', borderRadius: '8px', padding: '10px', textAlign: 'center', background: '#ffffff', boxShadow: '0 2px 4px rgba(0,0,0,0.03)' }}>
                  <div style={{ fontSize: '12px', fontWeight: 800, color: '#16a34a', marginBottom: '8px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s740', "النتيجة المحسنة بخلفية بيضاء 100%")}</div>
                  <div style={{ width: '100%', height: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: '#ffffff', border: '1px solid #00000010' }}>
                    {optimizedImageResult ? (
                      <img src={optimizedImageResult} alt="Optimized" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <Button variant="secondary" onClick={() => { setOptimizerImageSrc(null); setOptimizedImageResult(null); }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s741', "إعادة اختيار صورة أخرى")}
                </Button>
                {optimizedImageResult ? (
                  <a
                    href={optimizedImageResult}
                    download="marketplace-optimized-product.jpg"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      background: '#170e5e',
                      color: '#ffffff',
                      padding: '8px 16px',
                      borderRadius: '6px',
                      fontSize: '12.5px',
                      fontWeight: 700,
                      textDecoration: 'none',
                    }}
                  >
                    <DownloadIcon size={14} />
                    {t('settings.workspace_sections.settings_marketplaces_section.s742', "تحميل الصورة المجهزة (1500x1500px JPEG)")}
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </DialogShell>
    </div>
  );
};
