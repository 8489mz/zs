import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import { accountingApi, type OpeningBalancesPreviewResponse } from '@/features/accounting/api/accounting.api';
import { AccountingAccountsMapSection } from '../components/settings/AccountingAccountsMapSection';
import { AccountingOpeningBalancesSection } from '../components/settings/AccountingOpeningBalancesSection';
import { AccountingLockDatesSection } from '../components/settings/AccountingLockDatesSection';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';

type AccountRef = { id?: string; code?: string; nameAr?: string; nameEn?: string } | null;
type SettingsSection = 'accounts-map' | 'opening-balances' | 'lock-dates';

function normalizeNumerals(value: string): string {
  const arabicIndic = '٠١٢٣٤٥٦٧٨٩';
  const easternArabicIndic = '۰۱۲۳۴۵۶۷۸۹';
  return String(value || '')
    .replace(/[٠-٩]/g, (char) => String(arabicIndic.indexOf(char)))
    .replace(/[۰-۹]/g, (char) => String(easternArabicIndic.indexOf(char)));
}

function parseMoneyInput(value: string): number {
  const normalized = normalizeNumerals(value).replace(/,/g, '.').trim();
  if (!normalized) return 0;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  // INV-FE3-FRONTEND-BOOK-DIGITS: cash/bank opening balances post to the
  // ledger, so they round at the tenant's book digits, not hardcoded 2dp.
  return roundMoneyValue(parsed, currencyMoneyDigits(getGlobalSystemCurrency()));
}

import { translateUiText } from '@/lib/auto-translator';

function renderAccountRef(value: AccountRef, isEn?: boolean) {
  if (!value) return '—';
  const code = String(value.code || '').trim();
  const name = isEn && value.nameEn
    ? value.nameEn
    : isEn
      ? translateUiText(value.nameAr || '') || value.nameAr
      : value.nameAr || value.nameEn;
  const nameClean = String(name || '').trim();
  if (code && nameClean) return `${code} - ${nameClean}`;
  return code || nameClean || String(value.id || '—');
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function AccountingSettingsPage() {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const queryClient = useQueryClient();
  const [activeSection, setActiveSection] = useState<SettingsSection>('accounts-map');
  const [systemStartDate, setSystemStartDate] = useState(todayIsoDate());
  const [cashOpeningInput, setCashOpeningInput] = useState('');
  const [bankOpeningInput, setBankOpeningInput] = useState('');
  const [previewData, setPreviewData] = useState<OpeningBalancesPreviewResponse | null>(null);
  const [showPostConfirm, setShowPostConfirm] = useState(false);
  
  const [lockDateAll, setLockDateAll] = useState('');
  const [lockDateNonAdviser, setLockDateNonAdviser] = useState('');
  const [lockDateTax, setLockDateTax] = useState('');
  const [lockDatesSavedNotice, setLockDatesSavedNotice] = useState(false);

  const [isEditingSettings, setIsEditingSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: ['accounting', 'settings'],
    queryFn: () => accountingApi.settings(),
  });

  useEffect(() => {
    if (query.data?.settings) {
      const s = query.data.settings as any;
      if (s.lockDateAll) setLockDateAll(String(s.lockDateAll).slice(0, 10));
      if (s.lockDateNonAdviser) setLockDateNonAdviser(String(s.lockDateNonAdviser).slice(0, 10));
      if (s.lockDateTax) setLockDateTax(String(s.lockDateTax).slice(0, 10));
    }
  }, [query.data?.settings]);

  const updateLockDatesMutation = useMutation({
    mutationFn: (data: { lockDateAll: string | null; lockDateNonAdviser: string | null; lockDateTax: string | null }) =>
      accountingApi.updateSettings(data as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounting', 'settings'] });
      setLockDatesSavedNotice(true);
      setTimeout(() => setLockDatesSavedNotice(false), 4000);
    },
  });

  const accountsQuery = useQuery({
    queryKey: ['accounting', 'accounts'],
    queryFn: () => accountingApi.accounts(),
    enabled: isEditingSettings,
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (data: Record<string, number | null>) => accountingApi.updateSettings(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounting', 'settings'] });
      setIsEditingSettings(false);
    }
  });

  const previewMutation = useMutation({
    mutationFn: () =>
      (accountingApi as any).previewOpeningBalances
        ? (accountingApi as any).previewOpeningBalances({
            systemStartDate,
            cashOpening: parseMoneyInput(cashOpeningInput),
            bankOpening: parseMoneyInput(bankOpeningInput),
          })
        : Promise.resolve(null),
    onSuccess: (data) => {
      if (data) setPreviewData(data as OpeningBalancesPreviewResponse);
    },
  });

  const postMutation = useMutation({
    mutationFn: () =>
      (accountingApi as any).postOpeningBalances
        ? (accountingApi as any).postOpeningBalances({
            system_start_date: systemStartDate,
            cashOpening: parseMoneyInput(cashOpeningInput),
            bankOpening: parseMoneyInput(bankOpeningInput),
          })
        : Promise.resolve(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounting', 'settings'] });
      setShowPostConfirm(false);
      setPreviewData(null);
    },
  });

  const rows = useMemo(() => [
    { key: 'arAccount', label: 'حساب العملاء (المدينون)' },
    { key: 'apAccount', label: 'حساب الموردين (الدائنون)' },
    { key: 'salesAccount', label: 'حساب المبيعات' },
    { key: 'salesReturnsAccount', label: 'حساب مردودات المبيعات' },
    { key: 'purchasesAccount', label: 'حساب المشتريات' },
    { key: 'purchaseReturnsAccount', label: 'حساب مردودات المشتريات' },
    { key: 'inventoryAccount', label: 'حساب المخزون' },
    { key: 'cogsAccount', label: 'حساب تكلفة البضاعة المباعة' },
    { key: 'vatOutputAccount', label: 'حساب ضريبة المخرجات' },
    { key: 'vatInputAccount', label: 'حساب ضريبة المدخلات' },
    { key: 'cashAccount', label: 'حساب الصندوق / النقدية الافتراضي' },
    { key: 'bankAccount', label: 'حساب البنك الافتراضي' },
    { key: 'openingBalanceEquityAccount', label: 'حساب حقوق الملكية للأرصدة الافتتاحية' },
    { key: 'retainedEarningsAccount', label: 'حساب الأرباح المحتجزة' },
    { key: 'currentYearEarningsAccount', label: 'حساب أرباح العام الحالي' },
    { key: 'inventoryAdjustmentLossAccount', label: 'حساب خسائر جرد المخزون' },
    { key: 'inventoryAdjustmentGainAccount', label: 'حساب أرباح جرد المخزون' },
  ], []);

  const settings = (query.data?.settings || {}) as Record<string, any>;
  const isBalanced = Boolean(previewData && Math.abs(((previewData as any).totalDebit ?? 0) - ((previewData as any).totalCredit ?? 0)) < 0.01);
  const openingEntry = settings.openingBalancesJournalEntry;
  const canPost = Boolean(previewData && isBalanced && !openingEntry);

  return (
    <div className="page-stack page-shell accounting-settings-workspace" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '32px' }}>
        <PageHeader
          title={t('accounting.accounting_settings_page.s0', "إعدادات الحسابات والأرصدة الافتتاحية")}
          description={t('accounting.accounting_settings_page.s1', "إدارة شجرة الحسابات المرتبطة تلقائياً، إدخال الأرصدة الافتتاحية، وتحديد تواريخ إقفال الفترات المالية والضريبية.")}
        />

        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
          <Button
            type="button"
            variant={activeSection === 'accounts-map' ? 'primary' : 'secondary'}
            onClick={() => setActiveSection('accounts-map')}
          >
            {t('accounting.accounting_settings_page.s2', "ربط الحسابات")}
          </Button>
          <Button
            type="button"
            variant={activeSection === 'opening-balances' ? 'primary' : 'secondary'}
            onClick={() => setActiveSection('opening-balances')}
          >
            {t('accounting.accounting_settings_page.s3', "الأرصدة الافتتاحية")}
          </Button>
          <Button
            type="button"
            variant={activeSection === 'lock-dates' ? 'primary' : 'secondary'}
            onClick={() => setActiveSection('lock-dates')}
          >
            {t('accounting.accounting_settings_page.s4', "إقفال الفترات المالية")}
          </Button>
        </div>

        {activeSection === 'accounts-map' ? (
          <AccountingAccountsMapSection
            query={query}
            accountsQuery={accountsQuery}
            updateSettingsMutation={updateSettingsMutation}
            isEditingSettings={isEditingSettings}
            setIsEditingSettings={setIsEditingSettings}
            settingsForm={settingsForm}
            setSettingsForm={setSettingsForm}
            rows={rows}
            settings={settings}
            renderAccountRef={(val) => renderAccountRef(val, isEn)}
          />
        ) : activeSection === 'opening-balances' ? (
          <AccountingOpeningBalancesSection
            systemStartDate={systemStartDate}
            setSystemStartDate={setSystemStartDate}
            cashOpeningInput={cashOpeningInput}
            setCashOpeningInput={setCashOpeningInput}
            bankOpeningInput={bankOpeningInput}
            setBankOpeningInput={setBankOpeningInput}
            previewData={previewData}
            previewMutation={previewMutation}
            postMutation={postMutation}
            showPostConfirm={showPostConfirm}
            setShowPostConfirm={setShowPostConfirm}
            canPost={canPost}
            isBalanced={isBalanced}
            cashOpening={parseMoneyInput(cashOpeningInput)}
            bankOpening={parseMoneyInput(bankOpeningInput)}
            openingEntry={openingEntry}
          />
        ) : (
          <AccountingLockDatesSection
            lockDateAll={lockDateAll}
            setLockDateAll={setLockDateAll}
            lockDateNonAdviser={lockDateNonAdviser}
            setLockDateNonAdviser={setLockDateNonAdviser}
            lockDateTax={lockDateTax}
            setLockDateTax={setLockDateTax}
            lockDatesSavedNotice={lockDatesSavedNotice}
            onSave={() => updateLockDatesMutation.mutate({
              lockDateAll: lockDateAll || null,
              lockDateNonAdviser: lockDateNonAdviser || null,
              lockDateTax: lockDateTax || null,
            })}
            isPending={updateLockDatesMutation.isPending}
          />
        )}
      </main>
    </div>
  );
}

export default AccountingSettingsPage;
