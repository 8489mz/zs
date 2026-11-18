// Marketplace settlements tab + M4 reconcile-settlement modal —
// pure move from SettingsMarketplacesSection.tsx (slice S9). The hook owns
// the settlement state/queries/mutations; the tab and modal components render
// the tab JSX and the M4 DialogShell. The facade calls
// useMarketplaceSettlements() once and passes hook values as props. The
// settlement form defaults (periodStart/periodEnd) come from the CLIENT clock
// — flagged for a future clock package, moved byte-identical, NOT fixed here.
// Every computed amount rounds at settlementBookDigits (INV-FE3); the M4
// double-entry check is an EXACT identity at book digits — never "simplify" it.
import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { DialogShell } from '@/shared/components/dialog-shell';
import { toast } from '@/shared/components/system-alert';
import { formatDateTimeArabic, addDaysLocalDateKey, todayLocalDateKey } from '@/lib/format';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import {
  marketplaceSyncApi,
  SupportedMarketplace,
  MarketplaceSettlementInput,
} from '@/features/storefront/api/marketplace-sync.api';
import {
  CheckIcon,
  ReceiptIcon,
  XIcon,
  PlusIcon,
} from '@/shared/components/icons/AppIcons';

export function useMarketplaceSettlements() {
  // Settlement Reconciliation Form State
  const [showReconcileModal, setShowReconcileModal] = useState<boolean>(false);
  const [selectedSettlementPlatform, setSelectedSettlementPlatform] = useState<'all' | SupportedMarketplace>('all');
  const [settlementForm, setSettlementForm] = useState<MarketplaceSettlementInput>({
    marketplace: 'amazon',
    settlementId: '',
    periodStart: addDaysLocalDateKey(-14),
    periodEnd: todayLocalDateKey(),
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

  const settlementsQuery = useQuery({
    queryKey: ['marketplace-settlements'],
    queryFn: () => marketplaceSyncApi.getSettlements(),
  });

  const settlementAccountsQuery = useQuery({
    queryKey: ['marketplace-settlement-accounts'],
    queryFn: () => marketplaceSyncApi.getSettlementAccounts(),
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

  return {
    showReconcileModal,
    setShowReconcileModal,
    selectedSettlementPlatform,
    setSelectedSettlementPlatform,
    settlementForm,
    setSettlementForm,
    settlementBookDigits,
    settlementsQuery,
    settlementAccountsQuery,
    reconcileMutation,
  };
}

export interface MarketplaceSettlementsTabProps {
  settlements: ReturnType<typeof useMarketplaceSettlements>;
}

export const MarketplaceSettlementsTab: React.FC<MarketplaceSettlementsTabProps> = ({ settlements }) => {
  const { t } = useTranslation();
  const {
    settlementsQuery,
    setShowReconcileModal,
    selectedSettlementPlatform,
    setSelectedSettlementPlatform,
  } = settlements;
  return (
    <>
      {/* ========================================================================= */}
      {/* TAB: SETTLEMENT RECONCILIATION & DOUBLE-ENTRY GL POSTING */}
      {/* ========================================================================= */}
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
    </>
  );
};

export interface ReconcileSettlementModalProps {
  settlements: ReturnType<typeof useMarketplaceSettlements>;
}

export const ReconcileSettlementModal: React.FC<ReconcileSettlementModalProps> = ({ settlements }) => {
  const { t } = useTranslation();
  const {
    showReconcileModal,
    setShowReconcileModal,
    settlementForm,
    setSettlementForm,
    settlementBookDigits,
    settlementAccountsQuery,
    reconcileMutation,
  } = settlements;
  return (
    <>
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
    </>
  );
};
