import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import {
  useFxPortfolioQuery,
  useRecordFxAcquisitionMutation,
} from './api/shipments.api';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { formatCurrency } from '@/lib/format';
import {
  PlusCircleIcon,
  RefreshCwIcon,
} from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';
import { useQuery } from '@tanstack/react-query';
import { http } from '@/lib/http';

export default function ImportFxTreasuryManager() {
  const navigate = useNavigate();
  const { data: fxData, isLoading, refetch } = useFxPortfolioQuery();
  const recordAcquisitionMutation = useRecordFxAcquisitionMutation();

  const [isRecordModalOpen, setIsRecordModalOpen] = useState(false);

  // Form State
  const [currency, setCurrency] = useState('USD');
  const [foreignAmount, setForeignAmount] = useState<number>(10000);
  const [sourceProvider, setSourceProvider] = useState('اعتماد بنكي رسمي');
  const [treasuryAccountId, setTreasuryAccountId] = useState('');
  const [sourceTreasuryAccountId, setSourceTreasuryAccountId] = useState('');
  const [notes, setNotes] = useState('');

  // INV-IMPORT-FX-TREASURY-LIVE-RATE (I4-D7): the rate comes from the
  // live registered rates (GET /api/accounting/currencies — the same
  // rows resolveFxRate reads server-side), never from user-entered
  // amounts. The EGP cost is the RESULT of that rate
  // (foreignAmount x live rate) and is displayed read-only; the
  // mutation sends the live rate and the backend re-resolves it and
  // derives the cost itself. With no registered rate for the
  // currency there is nothing to post — submit stays blocked.
  const { data: currenciesData } = useQuery({
    queryKey: ['accounting-currencies'],
    queryFn: () => http<any>('/api/accounting/currencies').catch(() => ({ currencies: [] })),
  });
  const liveRateRaw = (currenciesData?.currencies || []).find(
    (c: any) => String(c.code || '').trim().toUpperCase() === currency,
  )?.exchangeRate;
  const liveRate = Number(liveRateRaw);
  const hasLiveRate = Number.isFinite(liveRate) && liveRate > 0;
  const egpCost = hasLiveRate ? Number((foreignAmount * liveRate).toFixed(2)) : 0;

  // Fetch Treasury Accounts
  const { data: accountsData } = useQuery({
    queryKey: ['accounts-list'],
    queryFn: () => http<any>('/api/accounting/accounts').catch(() => ({ accounts: [] })),
  });
  // INV-IMPORT-FX-TREASURY-LIVE-RATE (I4-D7): only cash/bank accounts
  // are eligible as a treasury source/destination — the backend
  // 'bank' role rejects anything with is_cash_bank false, so offering
  // parent current-asset accounts only lets the user pick an account
  // the backend must reject. Two traps in the old filter:
  // (a) the endpoint nests the flag as flags.isCashBank, so a
  // top-level a.isCashBank is always undefined and that arm never
  // matched a real cash/bank account; (b) real cash/bank leaves
  // (1110 الخزينة / 1120 البنك) carry accountGroup 'cash_bank', NOT
  // 'current_assets', so the group arm admitted exactly the parent
  // accounts (1100 الأصول المتداولة / 1160 عهد وسلف موظفين /
  // 1170 مصروفات مدفوعة مقدمًا) and never the accounts the backend
  // accepts. The live trial offered only those three parents and all
  // three were rejected — correctly. Offer only what the backend
  // accepts: active asset accounts flagged cash/bank.
  const bankAccounts = useMemo(
    () =>
      (accountsData?.accounts || (Array.isArray(accountsData) ? accountsData : [])).filter(
        (a: any) => a?.isActive !== false && a?.accountType === 'asset' && a?.flags?.isCashBank === true,
      ),
    [accountsData],
  );

  // The posting moves EGP from the source account to the destination
  // account: the two must differ, or there is no movement to post.
  // Default them to two DIFFERENT eligible accounts — the old form
  // left both unset so both resolved to the same settings bank
  // account and every submit died with IMPORT_FX_SAME_ACCOUNT.
  useEffect(() => {
    if (bankAccounts.length >= 2 && !treasuryAccountId && !sourceTreasuryAccountId) {
      setTreasuryAccountId(String(bankAccounts[0].id));
      setSourceTreasuryAccountId(String(bankAccounts[1].id));
    }
  }, [bankAccounts, treasuryAccountId, sourceTreasuryAccountId]);

  // This endpoint returns historic purchases, not an audited foreign-currency cash balance.
  const portfolio = Object.entries(fxData?.portfolio || {}).map(([currency, raw]) => {
    const item = raw as { totalForeign: number; totalEgp: number; weightedAvgRate: number };
    return { currency, total_foreign: item.totalForeign, total_egp_cost: item.totalEgp,
      weighted_avg_rate: item.weightedAvgRate };
  });
  const acquisitions = fxData?.transactions || [];

  const usdItem = portfolio.find((p: any) => p.currency === 'USD');
  const cnyItem = portfolio.find((p: any) => p.currency === 'CNY');
  const totalEgpDeployed = portfolio.reduce((sum: number, p: any) => sum + Number(p.total_egp_cost || 0), 0);

  const handleRecordAcquisition = async (e: React.FormEvent) => {
    e.preventDefault();
    // No live registered rate for the currency: there is no rate to
    // post at. Fail here, naming the fix (register the rate), instead
    // of posting user-invented amounts. INV-IMPORT-FX-RATE-REGISTRATION
    // (I9-E): the registration screen is real now — /accounting/forex
    // ("تقييم العملات وفروق الصرف") carries the تسجيل سعر الصرف card —
    // so the message names that screen instead of a "شاشة العملات"
    // the user could never find, and the dialog below offers the
    // navigation to it instead of a dead end.
    if (!hasLiveRate) {
      toast.error(`سعر صرف ${currency} غير مسجل؛ سجّل السعر من شاشة العملات (المحاسبة ← تقييم العملات وفروق الصرف) قبل تسجيل التدبير`);
      return;
    }
    // Both legs must be chosen explicitly, and they must differ —
    // the posting moves EGP from the source to the destination.
    if (!sourceTreasuryAccountId || !treasuryAccountId) {
      toast.error('اختر حساب المصدر وحساب الوجهة من حسابات النقدية/البنك');
      return;
    }
    if (sourceTreasuryAccountId === treasuryAccountId) {
      toast.error('حساب مصدر التدبير يجب أن يختلف عن حساب الوجهة');
      return;
    }
    try {
      // The live rate is sent (the payload builder derives the EGP
      // cost from it); the backend re-resolves the same live rate and
      // derives the cost itself — no user-entered amount is a source.
      await recordAcquisitionMutation.mutateAsync({
        currency,
        foreignAmount: Number(foreignAmount),
        exchangeRate: liveRate,
        source: 'bank',
        bankAccountId: treasuryAccountId || undefined,
        sourceAccountId: sourceTreasuryAccountId || undefined,
        notes: `جهة التدبير: ${sourceProvider}. ${notes}`,
      });
      toast.success('تم ترحيل تدبير العملة بقيد خزينة متوازن من حساب المصدر إلى حساب الوجهة');
      setIsRecordModalOpen(false);
      setNotes('');
      refetch();
    } catch (err: any) {
      toast.error('فشل تسجيل تدبير العملة: ' + (err.message || 'خطأ غير معروف'));
    }
  };

  return (
    <div className="page-stack page-shell import-sales-page" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '80px', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
        <PageHeader
          title="محفظة النقد الأجنبي وتدبير العملة"
          description="سجل عمليات تدبير العملة ومتوسط تكلفتها المرجح؛ متابعة أسعار الصرف الحقيقية لحماية تكلفة المخزون."
          actions={
            <div className="actions compact-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Button
                variant="primary"
                onClick={() => setIsRecordModalOpen(true)}
                style={{
                  height: '38px',
                  padding: '0 16px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  background: '#170e5e',
                  color: '#ffffff',
                  border: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                }}
              >
                <PlusCircleIcon size={15} />
                <span>تسجيل تدبير عملة جديد</span>
              </Button>
              <Button
                variant="secondary"
                onClick={() => refetch()}
                disabled={isLoading}
                style={{
                  height: '38px',
                  padding: '0 14px',
                  borderRadius: '8px',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <RefreshCwIcon size={14} />
                <span>تحديث</span>
              </Button>
            </div>
          }
        />

        {/* 2. KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: 4 }}>إجمالي الدولار المسجل تدبيره (USD)</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#16a34a' }}>
            ${Number(usdItem?.total_foreign || 0).toLocaleString()}
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: 4 }}>
            متوسط سعر الصرف المرجح: <strong>{Number(usdItem?.weighted_avg_rate || 0).toFixed(2)} ج.م</strong>
          </div>
        </div>

        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: 4 }}>إجمالي اليوان المسجل تدبيره (CNY)</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#0284c7' }}>
            ¥{Number(cnyItem?.total_foreign || 0).toLocaleString()}
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: 4 }}>
            متوسط سعر الصرف المرجح: <strong>{Number(cnyItem?.weighted_avg_rate || 0).toFixed(2)} ج.م</strong>
          </div>
        </div>

        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: 4 }}>إجمالي تكلفة تدبير العملة المسجلة</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#170e5e' }}>{formatCurrency(totalEgpDeployed)}</div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: 4 }}>إجمالي التكلفة الدفترية للنقد الأجنبي</div>
        </div>

        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: 4 }}>مستوى التحقق المحاسبي</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#334155' }}>مرحل بقيد متوازن</div>
          <div style={{ fontSize: '11px', color: '#16a34a', marginTop: 4 }}>كل تدبير مسجل يرحل قيد خزينة متوازناً من حساب المصدر إلى حساب الوجهة</div>
        </div>
      </div>

      {/* 3. History of Acquisitions */}
      <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', margin: 0 }}>
            سجل عمليات تدبير وشراء النقد الأجنبي ({acquisitions.length})
          </h2>
          <span style={{ fontSize: '12px', color: '#64748b' }}>
            تسجيل سعر الصرف الحقيقي يمنع تضخيم الأرباح الوهمية ويحمي تكلفة المخزون
          </span>
        </div>

        {isLoading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>جاري تحميل سجل المحفظة...</div>
        ) : acquisitions.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
            لا توجد عمليات تدبير عملة مسجلة حالياً. استخدم زر "تسجيل تدبير عملة جديد" لإثبات العملات الأجنبية.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>التاريخ</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>العملة والمبلغ</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>سعر الصرف الفعلي</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>التكلفة الإجمالية (ج.م)</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>جهة / مصدر التدبير</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>الملاحظات</th>
                </tr>
              </thead>
              <tbody>
                {acquisitions.map((a: any) => (
                  <tr key={a.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 14px', fontSize: '12px', color: '#64748b' }}>
                      {new Date(a.created_at || Date.now()).toLocaleDateString('ar-EG')}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: '12.5px', fontWeight: 700, color: '#0f172a' }}>
                      {a.currency} {Number(a.foreign_amount || 0).toLocaleString()}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: '12.5px', fontWeight: 600, color: '#0284c7' }}>
                      {Number(a.effective_exchange_rate || (a.egp_cost / a.foreign_amount)).toFixed(3)} ج.م
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: '12.5px', fontWeight: 700, color: '#170e5e' }}>
                      {formatCurrency(a.egp_cost)}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: '12px', color: '#334155' }}>
                      <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: '11px', fontWeight: 600, backgroundColor: '#f1f5f9', color: '#334155' }}>
                        {a.source || 'تدبير مباشر'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: '12px', color: '#64748b' }}>
                      {a.notes || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 4. Record FX Acquisition Dialog */}
      <StandardDialog
        open={isRecordModalOpen}
        onClose={() => setIsRecordModalOpen(false)}
        title="تسجيل عملية تدبير وشراء عملة أجنبية"
        subtitle="توثيق سعر الصرف الفعلي وحساب متوسط التكلفة المرجح للشركة"
        width="560px"
      >
        <form onSubmit={handleRecordAcquisition} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: 4 }}>
                العملة الأجنبية
              </label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              >
                <option value="USD">الدولار الأمريكي (USD)</option>
                <option value="CNY">اليوان الصيني (CNY)</option>
                <option value="EUR">اليورو الأوروبي (EUR)</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: 4 }}>
                المبلغ بالعملة الأجنبية
              </label>
              <input
                type="number"
                required
                value={foreignAmount}
                onChange={(e) => setForeignAmount(Number(e.target.value))}
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: 4 }}>
                التكلفة الإجمالية بالجنيه (EGP) — من السعر الحي
              </label>
              <input
                type="number"
                disabled
                value={hasLiveRate ? egpCost : ''}
                placeholder={hasLiveRate ? undefined : 'لا يوجد سعر مسجل'}
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #e2e8f0', backgroundColor: '#f8fafc', borderRadius: 6, fontSize: '12.5px', fontWeight: 700, color: '#170e5e' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: 4 }}>
                سعر الصرف الحي المسجل (ج.م)
              </label>
              <input
                type="text"
                disabled
                value={hasLiveRate ? liveRate.toFixed(4) : 'غير مسجل — سجّل السعر من شاشة العملات'}
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #e2e8f0', backgroundColor: '#f8fafc', borderRadius: 6, fontSize: '12.5px', fontWeight: 700, color: '#170e5e' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: 4 }}>
                حساب المصدر (يُخصم منه بالجنيه)
              </label>
              <select
                value={sourceTreasuryAccountId}
                onChange={(e) => setSourceTreasuryAccountId(e.target.value)}
                required
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              >
                <option value="">-- اختر حساب المصدر --</option>
                {bankAccounts.map((acc: any) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.nameAr || acc.nameEn || acc.code}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: 4 }}>
                مصدر وجهة التدبير
              </label>
              <select
                value={sourceProvider}
                onChange={(e) => setSourceProvider(e.target.value)}
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              >
                <option value="اعتماد بنكي رسمي">اعتماد بنكي رسمي (Bank Auction)</option>
                <option value="تمويل شخصي من الشركاء">تمويل شخصي من الشركاء (Partner Capital)</option>
                <option value="تدبير تجاري مباشر">تدبير تجاري مباشر (Commercial FX)</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: 4 }}>
                الحساب البنكي / الخزينة المودع فيها
              </label>
              <select
                value={treasuryAccountId}
                onChange={(e) => setTreasuryAccountId(e.target.value)}
                required
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              >
                <option value="">-- اختيار الحساب البنكي --</option>
                {bankAccounts.map((acc: any) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.nameAr || acc.nameEn || acc.code}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: 4 }}>
              ملاحظات وبيان التدبير
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="مثال: تدبير سداد الدفعة النهائية لمصنع قوانغتشو"
              style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>

          {/* INV-IMPORT-FX-RATE-REGISTRATION (I9-E): with no registered
              rate the submit must stay blocked (fail-closed), but a
              dead end is not a fix — offer the one action that
              unblocks it: registering the rate on the currencies
              screen. */}
          {!hasLiveRate && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '10px 14px',
                backgroundColor: '#fef3c7',
                border: '1px solid #fcd34d',
                borderRadius: 8,
              }}
            >
              <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#92400e' }}>
                لا يوجد سعر صرف مسجل لـ {currency} — سجّل السعر أولاً لتأكيد التدبير
              </span>
              <button
                type="button"
                onClick={() => navigate('/accounting/forex')}
                style={{ padding: '8px 16px', borderRadius: 6, border: 'none', backgroundColor: '#170e5e', color: '#ffffff', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
              >
                تسجيل سعر الصرف
              </button>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setIsRecordModalOpen(false)}
              style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={recordAcquisitionMutation.isPending}
              style={{ padding: '8px 18px', borderRadius: 6, border: 'none', backgroundColor: '#170e5e', color: '#ffffff', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' }}
            >
              {recordAcquisitionMutation.isPending ? 'جاري القيد...' : 'تأكيد تدبير العملة'}
            </button>
          </div>
        </form>
      </StandardDialog>
      </main>
    </div>
  );
}
