import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { useSystemCurrency } from '@/shared/hooks/use-system-currency';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/shared/components/page-header';
import { StatsGrid, type StatsGridItem } from '@/shared/components/stats-grid';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/components/system-alert';
import { accountingApi } from '../api/accounting.api';
import {
  forexApi,
  CurrencyItem,
  ForexRevaluationPreview,
  ForexRevaluationRun,
} from '../api/forex.api';
import { CheckIcon, ShieldAlertIcon, ClockIcon } from '@/shared/components/icons/AppIcons';

export const AccountingForexRevaluationPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en-US' : 'ar-EG';
  const { currencySymbol } = useSystemCurrency();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'wizard' | 'history'>('wizard');

  // Wizard state
  const [periodDate, setPeriodDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [selectedCurrency, setSelectedCurrency] = useState<string>('USD');
  const [closingRate, setClosingRate] = useState<string>('50.00');
  const [previewData, setPreviewData] = useState<ForexRevaluationPreview | null>(null);
  const [previewError, setPreviewError] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [foreignBalances, setForeignBalances] = useState<Record<string, string>>({});

  // 1. Fetch currencies
  const { data: currenciesData } = useQuery({
    queryKey: ['forex-currencies'],
    queryFn: forexApi.listCurrencies,
  });

  const currencies: CurrencyItem[] = currenciesData?.currencies || [];
  const { data: accountsData } = useQuery({ queryKey: ['accounting-accounts'], queryFn: accountingApi.accounts });
  const monetaryAccounts = (accountsData?.accounts || []).filter((account) =>
    account.isActive && account.isMonetary && account.revaluationCurrency === selectedCurrency);
  const getItems = () => monetaryAccounts.map((account) => {
    const entered = foreignBalances[account.id];
    if (entered === undefined || entered.trim() === '' || !Number.isFinite(Number(entered))) {
      throw new Error(t('accounting.accounting_forex_revaluation_page.s35', 'أدخل الرصيد الفعلي بالعملة الأجنبية لكل حساب.'));
    }
    return { accountId: Number(account.id), foreignBalance: Number(entered) };
  });

  // INV-IMPORT-FX-RATE-REGISTRATION (I9-E): the rate-registration
  // form. POST /api/accounting/currencies (forexApi.upsertCurrency)
  // existed with ZERO callers anywhere in the frontend, and this
  // page only listed the registered rates read-only — so a fresh
  // tenant had no USD rate and no screen to add one, and the FX
  // treasury's "سجّل السعر من شاشة العملات" named a screen that did
  // not exist. This card is that screen: the admin enters the real
  // rate (bank / central bank), the live resolver reads it from here
  // on. No rate is ever invented or seeded — only the base currency
  // (rate 1) is seeded by listCurrencies.
  const [rateCurrency, setRateCurrency] = useState<string>('USD');
  const [rateValue, setRateValue] = useState<string>('');
  const rateCurrencyNames: Record<string, string> = {
    USD: 'الدولار الأمريكي',
    CNY: 'اليوان الصيني',
    EUR: 'اليورو الأوروبي',
  };
  const rateCurrencyOptions = Array.from(new Set([
    'USD', 'CNY', 'EUR',
    ...currencies.filter((c) => !c.isBase).map((c) => c.code),
  ]));
  const selectedRateRow = currencies.find((c) => c.code === rateCurrency);
  const upsertRateMutation = useMutation({
    mutationFn: async () => {
      const rate = Number(rateValue);
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error(t('accounting.accounting_forex_revaluation_page.s39', 'أدخل سعر صرف موجباً صحيحاً.'));
      }
      return await forexApi.upsertCurrency({
        currencyCode: rateCurrency,
        currencyName: rateCurrencyNames[rateCurrency] || selectedRateRow?.name || rateCurrency,
        exchangeRate: rate,
      });
    },
    onSuccess: () => {
      toast.success(t('accounting.accounting_forex_revaluation_page.s40', 'تم تسجيل سعر الصرف؛ أصبح متاحاً لتدبير العملة ودراسات الجدوى.'));
      queryClient.invalidateQueries({ queryKey: ['forex-currencies'] });
      queryClient.invalidateQueries({ queryKey: ['accounting-currencies'] });
      setRateValue('');
    },
    onError: (err: any) => {
      toast.error(err?.message || t('accounting.accounting_forex_revaluation_page.s41', 'فشل تسجيل سعر الصرف.'));
    },
  });

  // 2. Fetch past runs
  const { data: pastRuns = [], isLoading: isRunsLoading } = useQuery({
    queryKey: ['forex-runs'],
    queryFn: forexApi.listRuns,
  });

  // Preview mutation
  const previewMutation = useMutation({
    mutationFn: async () => {
      setPreviewError('');
      return await forexApi.previewRevaluation({
        periodDate,
        currencyCode: selectedCurrency,
        closingRate: Number(closingRate),
        items: getItems(),
      });
    },
    onSuccess: (data) => {
      setPreviewData(data);
    },
    onError: (err: any) => {
      setPreviewError(err?.message || 'فشلت عملية معاينة إعادة التقييم.');
      setPreviewData(null);
    },
  });

  // Execute mutation
  const executeMutation = useMutation({
    mutationFn: async () => {
      return await forexApi.executeRevaluation({
        periodDate,
        currencyCode: selectedCurrency,
        closingRate: Number(closingRate),
        items: getItems(),
        notes,
      });
    },
    onSuccess: (res) => {
      toast.success(`${t('accounting.accounting_forex_revaluation_page.s36', 'تم ترحيل قيد فروق العملة برقم')} ${res.journalEntryNo || '—'}`);
      queryClient.invalidateQueries({ queryKey: ['forex-runs'] });
      queryClient.invalidateQueries({ queryKey: ['forex-currencies'] });
      setPreviewData(null);
      setActiveTab('history');
    },
    onError: (err: any) => {
      toast.error(err?.message || t('accounting.accounting_forex_revaluation_page.s37', 'فشل اعتماد قيد إعادة التقييم.'));
    },
  });

  const stats: StatsGridItem[] = [
    {
      key: 'base-currency',
      label: 'العملة الأساسية للنظام',
      value: 'الجنيه المصري (EGP)',
    },
    {
      key: 'active-currencies',
      label: 'العملات الأجنبية النشطة',
      value: currencies.filter((c) => !c.isBase).length,
    },
    {
      key: 'past-runs',
      label: 'جلسات إعادة التقييم المنفذة',
      value: pastRuns.length,
    },
    {
      key: 'standard',
      label: 'معيار المحاسبة الدولي المطبق',
      value: 'IAS 21 / معيار مصري 13',
    },
  ];

  return (
    <div
      dir="rtl"
      style={{
        maxWidth: '1280px',
        margin: '0 auto',
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
      }}
    >
      <PageHeader
        title={t('accounting.accounting_forex_revaluation_page.s0', "إعادة تقييم العملات الأجنبية وفروق الصرف (FX Revaluation - IAS 21)")}
        description={t('accounting.accounting_forex_revaluation_page.s1', "حساب أرباح وخسائر فروق أسعار الصرف غير المحققة وإثبات القيود المحاسبية الآلية في نهاية الفترات المالية.")}
      />

      <StatsGrid items={stats} />

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          borderBottom: '1px solid #e2e8f0',
          paddingBottom: '10px',
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab('wizard')}
          style={{
            padding: '8px 18px',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: activeTab === 'wizard' ? '#170e5e' : '#f1f5f9',
            color: activeTab === 'wizard' ? '#ffffff' : '#475569',
            fontWeight: 700,
            fontSize: 'var(--font-body)',
            cursor: 'pointer',
          }}
        >
          {t('accounting.accounting_forex_revaluation_page.s2', "معالج إعادة التقييم وقيد التسوية")}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('history')}
          style={{
            padding: '8px 18px',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: activeTab === 'history' ? '#170e5e' : '#f1f5f9',
            color: activeTab === 'history' ? '#ffffff' : '#475569',
            fontWeight: 700,
            fontSize: 'var(--font-body)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <ClockIcon size={14} />
          {t('accounting.accounting_forex_revaluation_page.s3', "سجل الحركات السابقة (")}{pastRuns.length})
        </button>
      </div>

      {activeTab === 'wizard' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Currencies Bar */}
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: 'var(--font-section-title)', color: '#0f172a' }}>
                {t('accounting.accounting_forex_revaluation_page.s4', "أسعار الصرف الحالية المسجلة في النظام:")}
              </span>
              <span style={{ fontSize: 'var(--font-micro)', color: '#64748b' }}>
                {t('accounting.accounting_forex_revaluation_page.s5', "سعر الأساس 1.00")} {currencySymbol}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
              {currencies.map((c) => (
                <div
                  key={c.code}
                  style={{
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    backgroundColor: c.isBase ? '#f8fafc' : '#f0fdf4',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 700, color: '#0f172a' }}>{c.name}</span>
                    <div style={{ fontSize: 'var(--font-micro)', color: '#64748b' }}>{c.code} {c.symbol}</div>
                  </div>
                  <strong style={{ fontSize: 'var(--font-body)', color: '#170e5e' }}>
                    {Number(c.exchangeRate).toFixed(2)} {currencySymbol}
                  </strong>
                </div>
              ))}
            </div>
          </div>

          {/* Rate Registration Card (INV-IMPORT-FX-RATE-REGISTRATION, I9-E):
              the only screen that writes a live rate. The currencies bar
              above lists rates read-only; without this card no rate could
              ever be registered from the UI and every FX flow (treasury
              arrangement, feasibility approval, PI conversion) failed
              closed with "no rate registered". */}
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <h3 style={{ fontSize: 'var(--font-section-title)', fontWeight: 700, margin: 0, color: '#0f172a' }}>
              {t('accounting.accounting_forex_revaluation_page.s42', "تسجيل / تحديث سعر الصرف (شاشة العملات)")}
            </h3>
            <span style={{ fontSize: 'var(--font-body)', color: '#64748b' }}>
              {t('accounting.accounting_forex_revaluation_page.s43', "سجّل السعر الحقيقي من البنك أو البنك المركزي؛ تدبير العملة ودراسات الجدوى والتحويلات تقرأ هذا السعر مباشرة، ولا يجوز افتراض سعر غير مسجل.")}
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '12px', alignItems: 'flex-end' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: 'var(--font-body)', fontWeight: 600, color: '#334155' }}>
                  {t('accounting.accounting_forex_revaluation_page.s44', "العملة الأجنبية:")}
                </label>
                <select
                  value={rateCurrency}
                  onChange={(e) => { setRateCurrency(e.target.value); setRateValue(''); }}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: 'var(--font-body)',
                    outline: 'none',
                  }}
                >
                  {rateCurrencyOptions.map((code) => (
                    <option key={code} value={code}>
                      {rateCurrencyNames[code] || currencies.find((c) => c.code === code)?.name || code} ({code})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: 'var(--font-body)', fontWeight: 600, color: '#334155' }}>
                  {t('accounting.accounting_forex_revaluation_page.s45', "سعر الصرف المسجل (ج.م لكل وحدة):")}
                </label>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={rateValue}
                  onChange={(e) => setRateValue(e.target.value)}
                  placeholder={selectedRateRow ? `${t('accounting.accounting_forex_revaluation_page.s46', "المسجل حالياً:")} ${Number(selectedRateRow.exchangeRate).toFixed(4)}` : t('accounting.accounting_forex_revaluation_page.s47', "غير مسجل بعد — أدخل السعر")}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: 'var(--font-body)',
                    fontWeight: 700,
                    outline: 'none',
                    width: '100%',
                  }}
                />
              </div>

              <Button
                variant="primary"
                onClick={() => upsertRateMutation.mutate()}
                disabled={upsertRateMutation.isPending || !rateValue}
                style={{ height: '40px', padding: '0 20px' }}
              >
                {upsertRateMutation.isPending ? t('accounting.accounting_forex_revaluation_page.s48', "جاري التسجيل...") : t('accounting.accounting_forex_revaluation_page.s49', "تسجيل سعر الصرف")}
              </Button>
            </div>
          </div>

          {/* Wizard Card */}
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <h3 style={{ fontSize: 'var(--font-section-title)', fontWeight: 700, margin: 0, color: '#0f172a' }}>
              {t('accounting.accounting_forex_revaluation_page.s6', "معالج إعادة التقييم المالي (IAS 21 Revaluation Routine)")}
            </h3>

            {previewError && (
              <div
                style={{
                  padding: '10px 14px',
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '8px',
                  color: '#991b1b',
                  fontSize: 'var(--font-body)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <ShieldAlertIcon size={16} />
                <span>{previewError}</span>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '12px', alignItems: 'flex-end' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: 'var(--font-body)', fontWeight: 600, color: '#334155' }}>
                  {t('accounting.accounting_forex_revaluation_page.s7', "تاريخ نهاية الفترة المالية:")}
                </label>
                <input
                  type="date"
                  value={periodDate}
                  onChange={(e) => { setPeriodDate(e.target.value); setPreviewData(null); }}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: 'var(--font-body)',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: 'var(--font-body)', fontWeight: 600, color: '#334155' }}>
                  {t('accounting.accounting_forex_revaluation_page.s8', "العملة المراد تقييمها:")}
                </label>
                <select
                  value={selectedCurrency}
                  onChange={(e) => {
                    setSelectedCurrency(e.target.value);
                    setPreviewData(null);
                    const found = currencies.find((c) => c.code === e.target.value);
                    if (found) setClosingRate(String(found.exchangeRate));
                  }}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: 'var(--font-body)',
                    outline: 'none',
                  }}
                >
                  {currencies
                    .filter((c) => !c.isBase)
                    .map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name} ({c.code})
                      </option>
                    ))}
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: 'var(--font-body)', fontWeight: 600, color: '#334155' }}>
                  {t('accounting.accounting_forex_revaluation_page.s9', "سعر الصرف الإقفالي (سعر البنك المركزي):")}
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    type="number"
                    step="0.01"
                    value={closingRate}
                    onChange={(e) => { setClosingRate(e.target.value); setPreviewData(null); }}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: 'var(--font-body)',
                      fontWeight: 700,
                      outline: 'none',
                      width: '100%',
                    }}
                  />
                  <span style={{ fontSize: 'var(--font-body)', fontWeight: 600, color: '#64748b' }}>{currencySymbol}</span>
                </div>
              </div>

              <Button
                variant="primary"
                onClick={() => previewMutation.mutate()}
                disabled={previewMutation.isPending || !accountsData || monetaryAccounts.length === 0}
                style={{ height: '40px', padding: '0 20px' }}
              >
                {previewMutation.isPending ? t('accounting.accounting_forex_revaluation_page.s10', "جاري الفحص المحاسبي...") : t('accounting.accounting_forex_revaluation_page.s11', "معاينة فروق التقييم")}
              </Button>
            </div>

            <div style={{ display: 'grid', gap: '8px' }}>
              <strong>{t('accounting.accounting_forex_revaluation_page.s34', 'الأرصدة الفعلية بالعملة الأجنبية للحسابات النقدية')}</strong>
              {accountsData && monetaryAccounts.length === 0 && (
                <span>{t('accounting.accounting_forex_revaluation_page.s38', 'لا توجد حسابات نقدية نشطة مربوطة بهذه العملة في شجرة الحسابات.')}</span>
              )}
              {monetaryAccounts.map((account) => (
                <label key={account.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                  <span>{account.code} — {account.nameAr}</span>
                  <input type="number" step="0.01" value={foreignBalances[account.id] ?? ''}
                    onChange={(event) => {
                      setForeignBalances((prior) => ({ ...prior, [account.id]: event.target.value }));
                      setPreviewData(null);
                    }}
                    aria-label={`${account.code} ${selectedCurrency}`}
                    style={{ padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', width: '170px' }} />
                </label>
              ))}
            </div>

            {/* Preview Results Table */}
            {previewData && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '12px' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '14px 18px',
                    borderRadius: '8px',
                    backgroundColor: previewData.netUnrealizedGainLoss >= 0 ? '#f0fdf4' : '#fef2f2',
                    border: `1px solid ${previewData.netUnrealizedGainLoss >= 0 ? '#bbf7d0' : '#fecaca'}`,
                  }}
                >
                  <div>
                    <span style={{ fontSize: 'var(--font-micro)', color: '#64748b' }}>{t('accounting.accounting_forex_revaluation_page.s12', "صافي الأثر المالي (قائمة الدخل):")}</span>
                    <div
                      style={{
                        fontWeight: 800,
                        fontSize: 'var(--font-page-title)',
                        color: previewData.netUnrealizedGainLoss >= 0 ? '#15803d' : '#991b1b',
                      }}
                    >
                      {previewData.netUnrealizedGainLoss >= 0 ? t('accounting.accounting_forex_revaluation_page.s13', "أرباح فروق عملة غير محققة: +") : t('accounting.accounting_forex_revaluation_page.s14', "خسائر فروق عملة: ")}
                      {Math.abs(previewData.netUnrealizedGainLoss).toLocaleString(locale)} {currencySymbol}
                    </div>
                  </div>

                  <div style={{ textAlign: 'left' }}>
                    <span style={{ fontSize: 'var(--font-micro)', color: '#64748b' }}>{t('accounting.accounting_forex_revaluation_page.s15', "إجمالي الرصيد الأجنبي المعني:")}</span>
                    <div style={{ fontWeight: 700, fontSize: 'var(--font-section-title)', color: '#0f172a' }}>
                      {previewData.totalForeignBalance.toLocaleString(locale)} {previewData.currencyCode}
                    </div>
                  </div>
                </div>

                {/* Lines Table */}
                <div
                  style={{
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    overflow: 'hidden',
                  }}
                >
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                        <th style={{ padding: '10px 14px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('accounting.accounting_forex_revaluation_page.s16', "الحساب / الخزينة")}</th>
                        <th style={{ padding: '10px 14px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('accounting.accounting_forex_revaluation_page.s17', "الرصيد بالعملة الأجنبية")}</th>
                        <th style={{ padding: '10px 14px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('accounting.accounting_forex_revaluation_page.s18', "القيمة الدفترية السابقة")}</th>
                        <th style={{ padding: '10px 14px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('accounting.accounting_forex_revaluation_page.s19', "القيمة المقومة الجديدة")}</th>
                        <th style={{ padding: '10px 14px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('accounting.accounting_forex_revaluation_page.s20', "فارق التقييم (الأرباح/الخسائر)")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.lines.map((l, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '10px 14px', fontWeight: 600, color: '#0f172a' }}>
                            {l.accountName} ({l.accountCode})
                          </td>
                          <td style={{ padding: '10px 14px', color: '#1e293b' }}>
                            {l.foreignBalance.toLocaleString(locale)} {previewData.currencyCode}
                          </td>
                          <td style={{ padding: '10px 14px', color: '#64748b' }}>
                            {l.bookLocalValue.toLocaleString(locale)} {currencySymbol}
                          </td>
                          <td style={{ padding: '10px 14px', color: '#0f172a', fontWeight: 600 }}>
                            {l.revaluedLocalValue.toLocaleString(locale)} {currencySymbol}
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            <span
                              style={{
                                fontWeight: 700,
                                color: l.unrealizedDifference >= 0 ? '#15803d' : '#dc2626',
                              }}
                            >
                              {l.unrealizedDifference >= 0 ? '+' : ''}
                              {l.unrealizedDifference.toLocaleString(locale)} {currencySymbol}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Posting Action */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingTop: '12px',
                    borderTop: '1px solid #e2e8f0',
                  }}
                >
                  <input
                    type="text"
                    placeholder={t('accounting.accounting_forex_revaluation_page.s21', "ملاحظات قيد اليومية (اختياري)...")}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: 'var(--font-body)',
                      width: '380px',
                    }}
                  />

                  <Button
                    variant="primary"
                    onClick={() => executeMutation.mutate()}
                    disabled={executeMutation.isPending}
                    style={{ padding: '0 24px' }}
                  >
                    <CheckIcon size={16} />
                    {executeMutation.isPending ? t('accounting.accounting_forex_revaluation_page.s22', "جاري ترحيل القيد...") : t('accounting.accounting_forex_revaluation_page.s23', "اعتماد وترحيل قيد فروق التقييم الآلي")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '12px 16px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('accounting.accounting_forex_revaluation_page.s24', "تاريخ الفترة")}</th>
                <th style={{ padding: '12px 16px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('accounting.accounting_forex_revaluation_page.s25', "العملة")}</th>
                <th style={{ padding: '12px 16px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('accounting.accounting_forex_revaluation_page.s26', "سعر الصرف الإقفالي")}</th>
                <th style={{ padding: '12px 16px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('accounting.accounting_forex_revaluation_page.s27', "إجمالي الرصيد الأجنبي")}</th>
                <th style={{ padding: '12px 16px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('accounting.accounting_forex_revaluation_page.s28', "صافي الأثر المالي")}</th>
                <th style={{ padding: '12px 16px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('accounting.accounting_forex_revaluation_page.s29', "رقم قيد اليومية")}</th>
                <th style={{ padding: '12px 16px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('accounting.accounting_forex_revaluation_page.s30', "الحالة")}</th>
              </tr>
            </thead>
            <tbody>
              {isRunsLoading ? (
                <tr>
                  <td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
                    {t('accounting.accounting_forex_revaluation_page.s31', "جاري تحميل السجل...")}
                  </td>
                </tr>
              ) : pastRuns.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
                    {t('accounting.accounting_forex_revaluation_page.s32', "لا توجد أي جلسات إعادة تقييم مسجلة بعد.")}
                  </td>
                </tr>
              ) : (
                pastRuns.map((r: ForexRevaluationRun) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px 16px', fontWeight: 600, color: '#0f172a' }}>
                      {new Date(r.period_date).toLocaleDateString(locale)}
                    </td>
                    <td style={{ padding: '12px 16px', fontWeight: 700, color: '#170e5e' }}>
                      {r.currency_code}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#334155' }}>
                      {Number(r.closing_exchange_rate).toFixed(2)} {currencySymbol}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#475569' }}>
                      {Number(r.foreign_balance_total).toLocaleString(locale)} {r.currency_code}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span
                        style={{
                          fontWeight: 700,
                          color: Number(r.unrealized_gain_loss) >= 0 ? '#15803d' : '#dc2626',
                        }}
                      >
                        {Number(r.unrealized_gain_loss) >= 0 ? '+' : ''}
                        {Number(r.unrealized_gain_loss).toLocaleString(locale)} {currencySymbol}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', fontWeight: 600, color: '#2563eb' }}>
                      {r.journal_entry_no || `قيد #${r.journal_entry_id || '-'}`}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: '6px',
                          backgroundColor: '#dcfce7',
                          color: '#15803d',
                          fontSize: 'var(--font-badge)',
                          fontWeight: 600,
                        }}
                      >
                        {t('accounting.accounting_forex_revaluation_page.s33', "معتمد ومرحل")}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
