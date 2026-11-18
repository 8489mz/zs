import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { Button } from '@/shared/ui/button';
import { FileTextIcon } from '@/shared/components/icons/AppIcons';
import { usePartnerLedgerQuery, useRecordCapitalTransactionMutation, Partner } from './api/shipments.api';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { useQuery } from '@tanstack/react-query';
import { http } from '@/lib/http';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { todayLocalDateKey } from '@/lib/format';

export function CapitalTransactionDialog({ 
  partner, 
  type, 
  open, 
  onClose 
}: { 
  partner: Partner | null, 
  type: 'DEPOSIT' | 'WITHDRAWAL', 
  open: boolean, 
  onClose: () => void 
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayLocalDateKey());
  const [note, setNote] = useState('');
  const [accountId, setAccountId] = useState('');
  
  const mutation = useRecordCapitalTransactionMutation(partner?.id || '');

  const { data: accountsData } = useQuery({
    queryKey: ['accounts-list'],
    queryFn: () => http<{ accounts: any[] }>('/api/accounting/accounts').catch(() => ({ accounts: [] })),
  });
  const treasuryAccounts = (accountsData?.accounts || []).filter((a: any) => a.flags?.isCashBank === true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !partner) return;
    await mutation.mutateAsync({
      type,
      amount: Number(amount),
      date,
      note,
      accountId: accountId || undefined
    });
    setAmount('');
    setNote('');
    setAccountId('');
    onClose();
  };

  const isDeposit = type === 'DEPOSIT';

  return (
    <StandardDialog 
      open={open} 
      onClose={onClose} 
      title={isDeposit ? `إيداع رأس مال: ${partner?.name || ''}` : `سحب رأس مال: ${partner?.name || ''}`}
      subtitle={isDeposit 
        ? `تسجيل زيادة في رأس مال الشريك وتوريد المبلغ في الخزينة أو الحساب البنكي.`
        : `تسجيل سحب أو تخفيض من رأس مال الشريك وصرف المبلغ من الخزينة أو الحساب البنكي.`}
      width="min(520px, 95vw)"
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} dir="rtl">
        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
            {t('import_sales.partner_ledger_components.s0', "المبلغ المطلوب")} {isDeposit ? t('import_sales.partner_ledger_components.s1', "إيداعه") : t('import_sales.partner_ledger_components.s2', "سحبه")} <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <input 
            type="number" 
            min="0.01" 
            step="0.01" 
            value={amount} 
            onChange={e => setAmount(e.target.value)} 
            required 
            placeholder={`0.00 ${getGlobalCurrencySymbol()}`}
            style={{
              width: '100%',
              height: '38px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              padding: '0 12px',
              fontSize: '0.85rem',
              background: '#ffffff',
              color: '#0f172a',
              boxSizing: 'border-box',
              outline: 'none',
              fontWeight: 700,
            }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
            {t('import_sales.partner_ledger_components.s3', "تاريخ الحركة")} <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <input 
            type="date" 
            value={date} 
            onChange={e => setDate(e.target.value)} 
            required 
            style={{
              width: '100%',
              height: '38px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              padding: '0 12px',
              fontSize: '0.85rem',
              background: '#ffffff',
              color: '#0f172a',
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
            {isDeposit ? t('import_sales.partner_ledger_components.s4', "الخزينة / الحساب البنكي للإيداع") : t('import_sales.partner_ledger_components.s5', "الخزينة / الحساب البنكي للصرف")} <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <select 
            value={accountId} 
            onChange={e => setAccountId(e.target.value)} 
            required
            style={{
              width: '100%',
              height: '38px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              padding: '0 12px',
              fontSize: '0.85rem',
              background: '#ffffff',
              color: '#0f172a',
              boxSizing: 'border-box',
              outline: 'none',
            }}
          >
            <option value="">{t('import_sales.partner_ledger_components.s6', "-- اختر الخزينة أو البنك --")}</option>
            {treasuryAccounts?.map((a: any) => (
              <option key={a.id} value={a.id}>{a.nameAr || a.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
            {t('import_sales.partner_ledger_components.s7', "ملاحظات أو بيان الحركة (اختياري)")}
          </label>
          <textarea 
            rows={3} 
            value={note} 
            onChange={e => setNote(e.target.value)} 
            placeholder={t('import_sales.partner_ledger_components.s8', "تفاصيل إضافية عن الحركة...")}
            style={{
              width: '100%',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              padding: '8px 12px',
              fontSize: '0.85rem',
              background: '#ffffff',
              color: '#0f172a',
              boxSizing: 'border-box',
              outline: 'none',
              resize: 'vertical',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '12px', paddingTop: '16px', borderTop: '1px solid #e2e8f0' }}>
          <Button 
            type="button" 
            variant="secondary" 
            onClick={onClose}
            style={{ height: '36px', padding: '0 16px', fontSize: '0.82rem', fontWeight: 600, borderRadius: '6px' }}
          >
            {t('import_sales.partner_ledger_components.s9', "إلغاء")}
          </Button>
          <Button 
            type="submit" 
            disabled={mutation.isPending}
            style={{
              height: '36px',
              padding: '0 20px',
              fontSize: '0.82rem',
              fontWeight: 700,
              borderRadius: '6px',
              background: isDeposit ? '#170e5e' : '#dc2626',
              color: '#ffffff',
              border: 'none',
            }}
          >
            {mutation.isPending ? t('import_sales.partner_ledger_components.s10', "جاري الحفظ...") : (isDeposit ? t('import_sales.partner_ledger_components.s11', "حفظ وإيداع بالخزينة") : t('import_sales.partner_ledger_components.s12', "حفظ وصرف من الخزينة"))}
          </Button>
        </div>
        <MutationFeedback isError={mutation.isError} isSuccess={mutation.isSuccess} error={mutation.error} />
      </form>
    </StandardDialog>
  );
}

export function PartnerLedgerDialog({ partner, open, onClose }: { partner: Partner | null, open: boolean, onClose: () => void }) {
  const { t } = useTranslation();
  const { data: ledger, isLoading } = usePartnerLedgerQuery(partner?.id || '');

  return (
    <StandardDialog 
      open={open} 
      onClose={onClose} 
      title={`كشف حساب رأس مال: ${partner?.name || ''}`}
      subtitle={t('import_sales.partner_ledger_components.s13', "سجل تفصيلي لكافة حركات الإيداع والسحب وصرف الأرباح الخاصة بالشريك.")}
      width="min(760px, 95vw)"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} dir="rtl">
        {/* Partner Header Summary */}
        <div style={{ background: '#f8fafc', padding: '14px 18px', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <span style={{ fontSize: '0.78rem', color: '#64748b', display: 'block', marginBottom: '2px' }}>{t('import_sales.partner_ledger_components.s14', "رأس المال الحالي المسجل")}</span>
            <span style={{ fontSize: '1.25rem', fontWeight: 800, color: '#170e5e' }}>
              {Number(partner?.capital_amount || 0).toLocaleString()} <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#64748b' }}><CurrencySymbol /></span>
            </span>
          </div>
          <div>
            <span style={{ fontSize: '0.78rem', color: '#64748b', display: 'block', marginBottom: '2px' }}>{t('import_sales.partner_ledger_components.s15', "نسبة الأرباح المعتمدة")}</span>
            <span style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>
              {partner?.profit_share_percentage ?? 0}%
            </span>
          </div>
        </div>

        {isLoading ? (
          <p style={{ color: '#64748b', textAlign: 'center', padding: '32px' }}>{t('import_sales.partner_ledger_components.s16', "جاري التحميل...")}</p>
        ) : (
          <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden', background: '#ffffff' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '0.825rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '0.78rem', fontWeight: 700 }}>
                  <th style={{ padding: '10px 14px' }}>{t('import_sales.partner_ledger_components.s17', "التاريخ")}</th>
                  <th style={{ padding: '10px 14px' }}>{t('import_sales.partner_ledger_components.s18', "نوع الحركة")}</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left' }}>{t('import_sales.partner_ledger_components.s19', "المبلغ")}</th>
                  <th style={{ padding: '10px 14px' }}>{t('import_sales.partner_ledger_components.s20', "البيان والملاحظات")}</th>
                </tr>
              </thead>
              <tbody>
                {ledger?.map((entry, idx) => (
                  <tr key={entry.id} style={{ borderBottom: '1px solid #f1f5f9', background: idx % 2 === 0 ? '#ffffff' : '#fafafa' }}>
                    <td style={{ padding: '10px 14px', color: '#334155', fontWeight: 600 }}>
                      {new Date(entry.transaction_date).toLocaleDateString('ar-EG')}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {entry.type === 'DEPOSIT' && (
                        <span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: '4px', background: '#dcfce7', color: '#16a34a', fontSize: '0.74rem', fontWeight: 700 }}>
                          {t('import_sales.partner_ledger_components.s21', "إيداع رأس مال")}
                        </span>
                      )}
                      {entry.type === 'WITHDRAWAL' && (
                        <span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: '4px', background: '#fee2e2', color: '#dc2626', fontSize: '0.74rem', fontWeight: 700 }}>
                          {t('import_sales.partner_ledger_components.s22', "سحب رأس مال")}
                        </span>
                      )}
                      {entry.type === 'PROFIT_PAYOUT' && (
                        <span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: '4px', background: '#dbeafe', color: '#2563eb', fontSize: '0.74rem', fontWeight: 700 }}>
                          {t('import_sales.partner_ledger_components.s23', "صرف أرباح")}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 800, fontSize: '0.85rem' }} dir="ltr">
                      <span style={{ color: entry.type === 'DEPOSIT' ? '#16a34a' : '#dc2626' }}>
                        {entry.type !== 'DEPOSIT' ? '-' : '+'}{Number(entry.amount).toLocaleString()} <CurrencySymbol />
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', color: '#64748b' }}>
                      {entry.note || '-'}
                    </td>
                  </tr>
                ))}
                {(!ledger || ledger.length === 0) && (
                  <tr>
                    <td colSpan={4} style={{ padding: '36px 16px', textAlign: 'center' }}>
                      <div style={{ width: '38px', height: '38px', borderRadius: '8px', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px auto', color: '#94a3b8' }}>
                        <FileTextIcon size={20} />
                      </div>
                      <div style={{ fontWeight: 700, color: '#334155', fontSize: '0.84rem' }}>{t('import_sales.partner_ledger_components.s24', "لا توجد حركات مسجلة")}</div>
                      <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: '3px' }}>{t('import_sales.partner_ledger_components.s25', "لم يتم تسجيل أي عمليات إيداع أو سحب لهذا الشريك حتى الآن.")}</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '8px' }}>
          <Button 
            variant="secondary" 
            onClick={onClose}
            style={{ height: '36px', padding: '0 20px', fontSize: '0.82rem', fontWeight: 600, borderRadius: '6px' }}
          >
            {t('import_sales.partner_ledger_components.s26', "إغلاق")}
          </Button>
        </div>
      </div>
    </StandardDialog>
  );
}

