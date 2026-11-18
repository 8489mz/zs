import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { contractingApi } from '../api/contracting.api';
import { ContractingPettyCashRecord } from '../contracting.types';
import { useSystemCurrency } from '@/shared/hooks/use-system-currency';
import { todayLocalDateKey } from '@/lib/format';

interface PettyCashModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
  projectName?: string;
}

export function PettyCashModal({
  isOpen,
  onClose,
  projectId,
  projectName,
}: PettyCashModalProps) {
  const { t } = useTranslation();
  const { currencySymbol, formatCurrency } = useSystemCurrency();
  const [records, setRecords] = useState<ContractingPettyCashRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [settlingId, setSettlingId] = useState<string | null>(null);

  // New Petty Cash Form
  const [custodianName, setCustodianName] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [issueDate, setIssueDate] = useState(todayLocalDateKey());
  const [notes, setNotes] = useState('');

  // Settlement Form
  const [spentAmount, setSpentAmount] = useState<number>(0);
  const [settlementNotes, setSettlementNotes] = useState('');
  const [receiptNumbers, setReceiptNumbers] = useState('');

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadRecords = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMsg(null);
      const data = await contractingApi.getPettyCashRecords(projectId ? { projectId } : undefined);
      setRecords(data);
    } catch (err: any) {
      setErrorMsg(err?.message || 'فشل تحميل سجل العهد النقدية للمشروع');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (isOpen) {
      loadRecords();
      setIsAdding(false);
      setSettlingId(null);
      setErrorMsg(null);
      setSuccessMsg(null);
    }
  }, [isOpen, loadRecords]);

  // Check if a custodian already has an active (unsettled) custody
  const activeCustodies = records.filter((r) => r.status === 'active');
  const hasActiveCustody = (name: string) =>
    activeCustodies.some((r) => r.custodianName.trim().toLowerCase() === name.trim().toLowerCase());

  const handleCreatePettyCash = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!custodianName.trim()) {
      setErrorMsg('يرجى كتابة اسم أمين العهدة (المهندس أو المشرف المستلم)');
      return;
    }
    if (!amount || amount <= 0) {
      setErrorMsg('يرجى تحديد مبلغ العهدة المنصرف بشكل صحيح');
      return;
    }

    // Client-side anti-leakage audit check
    if (hasActiveCustody(custodianName)) {
      setErrorMsg(`تنبيه رقابي صارم: توجد عهدة نقدية نشطة ومفتوحة باسم (${custodianName}). يمنع فتح أو صرف عهدة جديدة حتى تتم تصفية وإغلاق العهدة السابقة.`);
      return;
    }

    try {
      setSaving(true);
      await contractingApi.createPettyCash(projectId || '', {
        custodianName: custodianName.trim(),
        amount: Number(amount),
        issueDate,
        notes: notes.trim() || undefined,
      });
      setIsAdding(false);
      setCustodianName('');
      setAmount(0);
      setNotes('');
      setSuccessMsg('تم صرف وتسجيل العهدة النقدية بنجاح.');
      await loadRecords();
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر صرف العهدة النقدية');
    } finally {
      setSaving(false);
    }
  };

  const handleSettlePettyCash = async (recordId: string) => {
    setErrorMsg(null);
    setSuccessMsg(null);

    if (spentAmount < 0) {
      setErrorMsg('المبلغ المصروف لا يمكن أن يكون سالباً');
      return;
    }
    if (!receiptNumbers.trim()) {
      setErrorMsg('يرجى إرفاق أرقام الفواتير والإيصالات الثبوتية للمصروفات النثرية');
      return;
    }

    try {
      setSaving(true);
      await contractingApi.settlePettyCash(recordId, {
        receipts: [
          {
            receiptNumber: receiptNumbers.trim(),
            amount: Number(spentAmount),
            notes: settlementNotes.trim() || undefined,
          },
        ],
        closureNotes: settlementNotes.trim() || undefined,
      });
      setSettlingId(null);
      setSpentAmount(0);
      setSettlementNotes('');
      setReceiptNumbers('');
      setSuccessMsg('تم اعتماد تصفية العهدة النقدية وإغلاقها محاسبياً.');
      await loadRecords();
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر تصفية العهدة');
    } finally {
      setSaving(false);
    }
  };

  const totalIssued = records.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const totalActive = activeCustodies.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const totalSpentSettled = records.filter((r) => r.status === 'settled').reduce((sum, r) => sum + Number(r.spentAmount || 0), 0);

  return (
    <StandardDialog
      open={isOpen}
      onClose={onClose}
      title={t('contracting.petty_cash_modal.s0', "إدارة العهد النقدية الميدانية (Site Petty Cash & Expense Settlement)")}
      maxWidth="940px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} dir="rtl">
        {/* هيدر المودال وزر الإضافة */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <div style={{ fontSize: 'var(--font-section-title)', fontWeight: 700, color: '#1e293b' }}>
              {t('contracting.petty_cash_modal.s1', "العهد النثرية لمهندسي ومشرفي الموقع")}
            </div>
            <div style={{ fontSize: 'var(--font-subtitle)', color: '#64748b' }}>
              {projectName ? `المشروع: ${projectName}` : t('contracting.petty_cash_modal.s2', "الرقابة المالية على المصروفات النثرية ومنع ازدواج العهد قبل التصفية المستندية")}
            </div>
          </div>
          {!isAdding && (
            <button
              type="button"
              onClick={() => {
                setIsAdding(true);
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
              style={{
                height: '34px',
                padding: '0 14px',
                borderRadius: '6px',
                fontWeight: 700,
                background: '#170e5e',
                color: '#ffffff',
                border: 'none',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: 'var(--font-body)',
              }}
            >
              <AppIcons.Plus size={14} />
              <span>{t('contracting.petty_cash_modal.s3', "صرف عهدة نقدية جديدة")}</span>
            </button>
          )}
        </div>

        {/* تنبيهات النجاح والخطأ */}
        {errorMsg && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '10px 14px', borderRadius: '8px', fontSize: 'var(--font-body)', lineHeight: 1.5 }}>
            {errorMsg}
          </div>
        )}
        {successMsg && (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d', padding: '10px 14px', borderRadius: '8px', fontSize: 'var(--font-body)' }}>
            {successMsg}
          </div>
        )}

        {/* شريط الإحصائيات المالي */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 14px' }}>
            <div style={{ fontSize: 'var(--font-micro)', color: '#64748b', fontWeight: 600 }}>{t('contracting.petty_cash_modal.s4', "إجمالي العهد المنصرفة بالمشروع")}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#1e293b', marginTop: '2px' }}>
              {formatCurrency(totalIssued)}
            </div>
          </div>
          <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '8px', padding: '12px 14px' }}>
            <div style={{ fontSize: 'var(--font-micro)', color: '#9f1239', fontWeight: 600 }}>{t('contracting.petty_cash_modal.s5', "العهد المفتوحة قيد العمل (غير مصفاة)")}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#b91c1c', marginTop: '2px' }}>
              {formatCurrency(totalActive)}
            </div>
          </div>
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '12px 14px' }}>
            <div style={{ fontSize: 'var(--font-micro)', color: '#15803d', fontWeight: 600 }}>{t('contracting.petty_cash_modal.s6', "المصروفات النثرية المصفاة بالفواتير")}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#15803d', marginTop: '2px' }}>
              {formatCurrency(totalSpentSettled)}
            </div>
          </div>
        </div>

        {/* نموذج صرف عهدة جديدة مع الفحص الرقابي الصارم */}
        {isAdding && (
          <form
            onSubmit={handleCreatePettyCash}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            {/* بطاقة 1: بيانات أمين العهدة وتاريخ الصرف */}
            <div style={{ background: '#f8fafc', padding: '9px 13px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
                <AppIcons.User size={15} />
                <span>{t('contracting.petty_cash_modal.s7', "1. بيانات أمين العهدة وتاريخ الصرف والرقابة")}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                    {t('contracting.petty_cash_modal.s8', "اسم أمين العهدة (المهندس / المشرف المستلم) *")}
                  </label>
                  <input
                    type="text"
                    required
                    value={custodianName}
                    onChange={(e) => setCustodianName(e.target.value)}
                    placeholder={t('contracting.petty_cash_modal.s9', "مثال: م. محمود السيد")}
                    style={{ width: '100%', height: '33px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.8125rem', background: '#fff', boxSizing: 'border-box' }}
                  />
                  {custodianName.trim() && hasActiveCustody(custodianName) && (
                    <span style={{ fontSize: '0.72rem', color: '#b91c1c', fontWeight: 600, display: 'block', marginTop: '3px' }}>
                      {t('contracting.petty_cash_modal.s10', "تنبيه رقابي: هذا المهندس لديه عهدة سابقة مفتوحة لم تتم تسويتها!")}
                    </span>
                  )}
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                    {t('contracting.petty_cash_modal.s11', "تاريخ الصرف *")}
                  </label>
                  <input
                    type="date"
                    required
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    style={{ width: '100%', height: '33px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.8125rem', background: '#fff', boxSizing: 'border-box' }}
                  />
                </div>
              </div>
            </div>

            {/* بطاقة 2: القيمة المالية وأوجه الصرف */}
            <div style={{ background: '#f8fafc', padding: '9px 13px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
                <AppIcons.DollarSign size={15} />
                <span>{t('contracting.petty_cash_modal.s12', "2. القيمة المالية وأوجه الصرف المصرح بها")}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                    {t('contracting.petty_cash_modal.s13', "مبلغ العهدة (")}{currencySymbol}) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    required
                    value={amount || ''}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    placeholder="0.00"
                    style={{ width: '100%', height: '33px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.8125rem', background: '#fff', fontWeight: 700, color: '#170e5e', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                    {t('contracting.petty_cash_modal.s14', "الغرض من العهدة وبيان أوجه الصرف المصرح بها")}
                  </label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={t('contracting.petty_cash_modal.s15', "مثال: نثريات الموقع، مشال حديد طارئ، وقود المولدات، مستلزمات السلامة والصحة المهنية")}
                    style={{ width: '100%', height: '33px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.8125rem', background: '#fff', boxSizing: 'border-box' }}
                  />
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '2px' }}>
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                style={{ height: '33px', padding: '0 14px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', color: '#475569', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600 }}
              >
                {t('contracting.petty_cash_modal.s16', "إلغاء")}
              </button>
              <button
                type="submit"
                disabled={saving || (custodianName.trim() !== '' && hasActiveCustody(custodianName))}
                style={{
                  height: '33px',
                  padding: '0 18px',
                  borderRadius: '6px',
                  border: 'none',
                  background: (custodianName.trim() !== '' && hasActiveCustody(custodianName)) ? '#94a3b8' : '#170e5e',
                  color: '#fff',
                  fontWeight: 700,
                  cursor: (custodianName.trim() !== '' && hasActiveCustody(custodianName)) ? 'not-allowed' : 'pointer',
                  fontSize: '0.8125rem',
                }}
              >
                {saving ? t('contracting.petty_cash_modal.s17', "جارٍ الصرف...") : t('contracting.petty_cash_modal.s18', "اعتماد وصرف العهدة")}
              </button>
            </div>
          </form>
        )}

        {/* جدول العهد النقدية */}
        <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>{t('contracting.petty_cash_modal.s19', "جاري تحميل سجل العهد النقدية...")}</div>
          ) : records.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>{t('contracting.petty_cash_modal.s20', "لا توجد عهد نقدية مسجلة لهذا المشروع حتى الآن")}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('contracting.petty_cash_modal.s21', "أمين العهدة")}</th>
                  <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('contracting.petty_cash_modal.s22', "مبلغ العهدة (")}{currencySymbol})</th>
                  <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('contracting.petty_cash_modal.s23', "المصروف الفعلي (")}{currencySymbol})</th>
                  <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('contracting.petty_cash_modal.s24', "المتبقي / المردود (")}{currencySymbol})</th>
                  <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('contracting.petty_cash_modal.s25', "تاريخ الصرف")}</th>
                  <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('contracting.petty_cash_modal.s26', "الحالة")}</th>
                  <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569', textAlign: 'center' }}>{t('contracting.petty_cash_modal.s27', "الإجراء والتصفية")}</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  const isSettlingThis = settlingId === r.id;
                  const remaining = Number(r.remainingAmount || (Number(r.amount) - Number(r.spentAmount || 0)));

                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', fontWeight: 700, color: '#1e293b' }}>
                        <div>{r.custodianName}</div>
                        {r.notes && (
                          <div style={{ fontSize: 'var(--font-micro)', color: '#64748b', marginTop: '2px' }}>
                            {r.notes}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', fontWeight: 700, color: '#0f172a' }}>
                        {Number(r.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', color: '#15803d', fontWeight: 600 }}>
                        {r.status === 'settled' ? Number(r.spentAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', color: remaining < 0 ? '#b91c1c' : '#0369a1', fontWeight: 600 }}>
                        {r.status === 'settled' ? remaining.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 'var(--font-micro)', color: '#64748b' }}>
                        {r.issueDate}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: '6px',
                            fontSize: 'var(--font-badge)',
                            fontWeight: 600,
                            background: r.status === 'active' ? '#fee2e2' : '#dcfce7',
                            color: r.status === 'active' ? '#991b1b' : '#15803d',
                          }}
                        >
                          {r.status === 'active' ? t('contracting.petty_cash_modal.s28', "مفتوحة قيد الصرف") : t('contracting.petty_cash_modal.s29', "مصفاة ومغلقة")}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        {r.status === 'active' ? (
                          isSettlingThis ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '180px', padding: '6px', background: '#f8fafc', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={spentAmount || ''}
                                onChange={(e) => setSpentAmount(Number(e.target.value))}
                                placeholder={t('contracting.petty_cash_modal.s30', "إجمالي المنصرف الفعلي")}
                                style={{ height: '28px', borderRadius: '4px', border: '1px solid #cbd5e1', padding: '0 6px', fontSize: 'var(--font-micro)', background: '#fff' }}
                              />
                              <input
                                type="text"
                                value={receiptNumbers}
                                onChange={(e) => setReceiptNumbers(e.target.value)}
                                placeholder={t('contracting.petty_cash_modal.s31', "أرقام الفواتير والإيصالات")}
                                style={{ height: '28px', borderRadius: '4px', border: '1px solid #cbd5e1', padding: '0 6px', fontSize: 'var(--font-micro)', background: '#fff' }}
                              />
                              <input
                                type="text"
                                value={settlementNotes}
                                onChange={(e) => setSettlementNotes(e.target.value)}
                                placeholder={t('contracting.petty_cash_modal.s32', "ملاحظات التسوية والتصفية")}
                                style={{ height: '28px', borderRadius: '4px', border: '1px solid #cbd5e1', padding: '0 6px', fontSize: 'var(--font-micro)', background: '#fff' }}
                              />
                              <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                                <button
                                  type="button"
                                  onClick={() => handleSettlePettyCash(r.id)}
                                  disabled={saving}
                                  style={{ height: '26px', padding: '0 10px', borderRadius: '4px', background: '#15803d', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 'var(--font-micro)', fontWeight: 600 }}
                                >
                                  {t('contracting.petty_cash_modal.s33', "تأكيد التصفية")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setSettlingId(null)}
                                  style={{ height: '26px', padding: '0 8px', borderRadius: '4px', background: '#e2e8f0', color: '#334155', border: 'none', cursor: 'pointer', fontSize: 'var(--font-micro)' }}
                                >
                                  {t('contracting.petty_cash_modal.s34', "إلغاء")}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setSettlingId(r.id);
                                setSpentAmount(Number(r.amount));
                                setErrorMsg(null);
                              }}
                              style={{
                                height: '28px',
                                padding: '0 10px',
                                borderRadius: '4px',
                                background: '#f8fafc',
                                border: '1px solid #cbd5e1',
                                color: '#170e5e',
                                cursor: 'pointer',
                                fontSize: 'var(--font-micro)',
                                fontWeight: 600,
                              }}
                            >
                              {t('contracting.petty_cash_modal.s35', "تصفية وإغلاق العهدة")}
                            </button>
                          )
                        ) : (
                          <div style={{ fontSize: 'var(--font-micro)', color: '#15803d' }}>
                            <div>{t('contracting.petty_cash_modal.s36', "تم الإغلاق:")} {r.settlementDate || '—'}</div>
                            {r.receiptNumbers && <div>{t('contracting.petty_cash_modal.s37', "فواتير:")} {r.receiptNumbers}</div>}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </StandardDialog>
  );
}
