import { useTranslation } from 'react-i18next';
import { Fragment, type Dispatch, type SetStateAction } from 'react';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { formatCurrency } from '@/lib/format';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { extractPurchaseId, formatLedgerDate, EyeIcon, ChevronDownIcon, ChevronUpIcon } from './supplier-schedule-helpers';
import { PurchaseItemsExpandable } from './purchase-items-expandable';
import type { SupplierLedgerEntry } from '@/types/domain';

export interface SupplierLedgerTabProps {
  directPaymentAmount: string;
  directPaymentChannel: 'cash' | 'bank' | 'card' | 'wallet' | 'instapay';
  directPaymentInstapayAddress: string;
  directPaymentMutation: { mutate: () => void; isPending: boolean; isError: boolean; error: Error | null };
  directPaymentNote: string;
  disabled: boolean;
  expandedPurchaseIds: Record<string, boolean>;
  filteredLedgerEntries: SupplierLedgerEntry[];
  handleSelectInvoiceAmount: (amount: number, invoiceDocNo?: string) => void;
  ledgerEntries: SupplierLedgerEntry[];
  ledgerFilter: 'all' | 'purchases' | 'payments';
  ledgerQuery: { isLoading: boolean };
  setDirectPaymentAmount: Dispatch<SetStateAction<string>>;
  setDirectPaymentChannel: Dispatch<SetStateAction<'cash' | 'bank' | 'card' | 'wallet' | 'instapay'>>;
  setDirectPaymentInstapayAddress: Dispatch<SetStateAction<string>>;
  setDirectPaymentNote: Dispatch<SetStateAction<string>>;
  setLedgerFilter: Dispatch<SetStateAction<'all' | 'purchases' | 'payments'>>;
  supplierBalance: number;
  supplierName: string;
  togglePurchaseDetails: (purchaseId: string) => void;
}

export function SupplierLedgerTab({
  directPaymentAmount,
  directPaymentChannel,
  directPaymentInstapayAddress,
  directPaymentMutation,
  directPaymentNote,
  disabled,
  expandedPurchaseIds,
  filteredLedgerEntries,
  handleSelectInvoiceAmount,
  ledgerEntries,
  ledgerFilter,
  ledgerQuery,
  setDirectPaymentAmount,
  setDirectPaymentChannel,
  setDirectPaymentInstapayAddress,
  setDirectPaymentNote,
  setLedgerFilter,
  supplierBalance,
  supplierName,
  togglePurchaseDetails,
}: SupplierLedgerTabProps) {
  const { t } = useTranslation();
  return (
    <div>
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <strong style={{ fontSize: '0.92rem', color: '#1e293b' }}>{t('accounts.supplier_balance_schedule_card.s27', "سجل فواتير المشتريات والمعاملات")}</strong>
            {ledgerQuery.isLoading ? <span style={{ fontSize: '0.78rem', color: '#64748b' }}>{t('accounts.supplier_balance_schedule_card.s28', "(جاري التحميل...)")}</span> : null}
          </div>
          <div className="actions compact-actions">
            <Button
              type="button"
              variant={ledgerFilter === 'all' ? 'primary' : 'secondary'}
              onClick={() => setLedgerFilter('all')}
            >
              {t('accounts.supplier_balance_schedule_card.s29', "الكل (")}{ledgerEntries.length})
            </Button>
            <Button
              type="button"
              variant={ledgerFilter === 'purchases' ? 'primary' : 'secondary'}
              onClick={() => setLedgerFilter('purchases')}
            >
              {t('accounts.supplier_balance_schedule_card.s30', "فواتير الشراء")}
            </Button>
            <Button
              type="button"
              variant={ledgerFilter === 'payments' ? 'primary' : 'secondary'}
              onClick={() => setLedgerFilter('payments')}
            >
              {t('accounts.supplier_balance_schedule_card.s31', "سندات الصرف")}
            </Button>
          </div>
        </div>

        {filteredLedgerEntries.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 12px', color: '#64748b', fontSize: '0.85rem' }}>
            {ledgerQuery.isLoading ? t('accounts.supplier_balance_schedule_card.s32', "جاري تحميل كشف الحساب...") : t('accounts.supplier_balance_schedule_card.s33', "لا توجد حركات مسجلة لهذا المورد في هذه التصفية.")}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', color: '#475569', borderBottom: '2px solid #e2e8f0', textAlign: 'right' }}>
                  <th style={{ padding: '8px 10px', fontWeight: 600 }}>{t('accounts.supplier_balance_schedule_card.s34', "التاريخ")}</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600 }}>{t('accounts.supplier_balance_schedule_card.s35', "نوع الحركة / البيان")}</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600 }}>{t('accounts.supplier_balance_schedule_card.s36', "دائن (فاتورة شراء)")}</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600 }}>{t('accounts.supplier_balance_schedule_card.s37', "مدين (صرف وسداد)")}</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600 }}>{t('accounts.supplier_balance_schedule_card.s38', "الرصيد بعد الحركة")}</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'center' }}>{t('accounts.supplier_balance_schedule_card.s39', "الأصناف")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredLedgerEntries.map((entry: any, index: number) => {
                  const purchaseId = extractPurchaseId(entry);
                  const isExpanded = Boolean(purchaseId && expandedPurchaseIds[purchaseId]);
                  const amt = Number(entry.amount ?? (Number(entry.credit || 0) > 0 ? entry.credit : -Number(entry.debit || 0)));
                  const credit = amt > 0 ? amt : Number(entry.credit || 0);
                  const debit = amt < 0 ? Math.abs(amt) : Number(entry.debit || 0);
                  const balanceAfter = entry.balanceAfter != null ? Number(entry.balanceAfter) : (entry.balance_after != null ? Number(entry.balance_after) : null);
                  const dateValue = entry.createdAt || entry.created_at || entry.date;
                  const isPurchase = Boolean(purchaseId) || credit > 0 || String(entry.note || '').includes(t('accounts.supplier_balance_schedule_card.s40', "فاتورة"));

                  return (
                    <Fragment key={entry.id || entry.doc_no || index}>
                      <tr
                        style={{
                          borderBottom: isExpanded ? 'none' : '1px solid #f1f5f9',
                          background: isExpanded ? '#f8fafc' : (index % 2 === 0 ? '#ffffff' : '#fafafa'),
                          cursor: purchaseId ? 'pointer' : 'default',
                        }}
                        onClick={() => {
                          if (purchaseId) togglePurchaseDetails(purchaseId);
                        }}
                      >
                        <td style={{ padding: '8px 10px', color: '#64748b', whiteSpace: 'nowrap' }}>
                          {formatLedgerDate(dateValue)}
                        </td>
                        <td style={{ padding: '8px 10px', fontWeight: 600, color: '#1e293b' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>{entry.note || entry.doc_no || (isPurchase ? t('accounts.supplier_balance_schedule_card.s41', "فاتورة مشتريات") : t('accounts.supplier_balance_schedule_card.s42', "سداد/صرف"))}</span>
                            {purchaseId ? (
                              <span style={{ fontSize: '0.72rem', background: '#eff6ff', color: '#2563eb', padding: '1px 5px', borderRadius: '4px' }}>
                                #{purchaseId}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td style={{ padding: '8px 10px', fontWeight: 700, color: credit > 0 ? '#dc2626' : '#94a3b8' }}>
                          {credit > 0 ? formatCurrency(credit) : '—'}
                        </td>
                        <td style={{ padding: '8px 10px', fontWeight: 700, color: debit > 0 ? '#16a34a' : '#94a3b8' }}>
                          {debit > 0 ? formatCurrency(debit) : '—'}
                        </td>
                        <td style={{ padding: '8px 10px', fontWeight: 700, color: '#0f172a' }}>
                          {balanceAfter != null ? formatCurrency(balanceAfter) : '—'}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                          {purchaseId ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePurchaseDetails(purchaseId);
                              }}
                              style={{
                                background: isExpanded ? '#1e293b' : '#ffffff',
                                color: isExpanded ? '#ffffff' : '#1e293b',
                                border: '1px solid #cbd5e1',
                                borderRadius: '4px',
                                padding: '3px 8px',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              <EyeIcon size={13} />
                              {isExpanded ? t('accounts.supplier_balance_schedule_card.s43', "إخفاء") : t('accounts.supplier_balance_schedule_card.s44', "عرض الأصناف")}
                              {isExpanded ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />}
                            </button>
                          ) : (
                            <span style={{ color: '#cbd5e1' }}>—</span>
                          )}
                        </td>
                      </tr>

                      {isExpanded && purchaseId ? (
                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                          <td colSpan={6} style={{ padding: '0 10px 10px' }}>
                            <PurchaseItemsExpandable
                              purchaseId={purchaseId}
                              onSelectAmount={handleSelectInvoiceAmount}
                            />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Direct Payment Panel */}
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px' }}>
        <strong style={{ display: 'block', marginBottom: '10px', fontSize: '0.94rem', color: '#0f172a' }}>
          {t('accounts.supplier_balance_schedule_card.s45', "تسجيل صرف وسداد مستحقات للمورد")} {supplierName}
        </strong>

        <div className="form-grid">
          <Field label={`المبلغ المدفوع للمورد (${getGlobalCurrencySymbol()})`}>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={directPaymentAmount}
              onChange={(event) => setDirectPaymentAmount(event.target.value)}
              placeholder={`مثال: ${supplierBalance > 0 ? supplierBalance : '0.00'}`}
              disabled={directPaymentMutation.isPending || disabled}
            />
            <div className="customer-quick-amount-shortcuts" style={{ marginTop: '6px' }}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setDirectPaymentAmount(String(supplierBalance > 0 ? supplierBalance : ''))}
                disabled={directPaymentMutation.isPending || disabled || supplierBalance <= 0}
              >
                {t('accounts.supplier_balance_schedule_card.s46', "سداد كامل الرصيد المستحق (")}{formatCurrency(supplierBalance)})
              </Button>
            </div>
          </Field>

          <Field label="وسيلة السداد">
            <select value={directPaymentChannel} onChange={e => setDirectPaymentChannel(e.target.value as typeof directPaymentChannel)} disabled={directPaymentMutation.isPending || disabled}>
              <option value="cash">نقدي (درج الكاشير)</option>
              <option value="bank">تحويل بنكي</option>
              <option value="card">بطاقة</option>
              <option value="wallet">محفظة إلكترونية</option>
              <option value="instapay">إنستاباي</option>
            </select>
          </Field>
          {directPaymentChannel === 'instapay' && (
            <Field label={t('accounts.supplier_balance_schedule_card.s113', "رقم حساب إنستاباي (IPA)")}>
              <input
                type="text"
                value={directPaymentInstapayAddress}
                onChange={(event) => setDirectPaymentInstapayAddress(event.target.value)}
                placeholder={t('accounts.supplier_balance_schedule_card.s114', "مثال: name@instapay")}
                disabled={directPaymentMutation.isPending || disabled}
              />
            </Field>
          )}
          <Field label={t('accounts.supplier_balance_schedule_card.s47', "ملاحظات الصرف (اختياري)")}>
            <textarea
              rows={2}
              value={directPaymentNote}
              onChange={(event) => setDirectPaymentNote(event.target.value)}
              placeholder={t('accounts.supplier_balance_schedule_card.s48', "مثال: تم التسليم نقداً لمندوب المورد / سداد فاتورة مشتريات محددة")}
              disabled={directPaymentMutation.isPending || disabled}
            />
          </Field>
        </div>

        <div className="actions compact-actions supplier-payment-dialog-actions" style={{ marginTop: '12px' }}>
          <Button
            type="button"
            onClick={() => directPaymentMutation.mutate()}
            disabled={directPaymentMutation.isPending || !(Number(directPaymentAmount) > 0) || disabled}
          >
            {directPaymentMutation.isPending ? t('accounts.supplier_balance_schedule_card.s49', "جاري تسجيل الدفع...") : t('accounts.supplier_balance_schedule_card.s50', "تأكيد صرف المبلغ للمورد")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setDirectPaymentAmount('');
              setDirectPaymentNote('');
              setDirectPaymentInstapayAddress('');
            }}
            disabled={directPaymentMutation.isPending}
          >
            {t('accounts.supplier_balance_schedule_card.s51', "إعادة ضبط")}
          </Button>
        </div>

        <MutationFeedback
          isError={directPaymentMutation.isError}
          isSuccess={false}
          error={directPaymentMutation.error}
          errorFallback={t('accounts.supplier_balance_schedule_card.s52', "تعذر تسجيل صرف المبلغ للمورد")}
          successText=""
        />
      </div>
    </div>
  );
}
