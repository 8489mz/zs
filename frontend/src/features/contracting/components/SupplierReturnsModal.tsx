import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { contractingApi } from '../api/contracting.api';
import { ContractingSupplierReturn } from '../contracting.types';
import { useSystemCurrency } from '@/shared/hooks/use-system-currency';
import { todayLocalDateKey } from '@/lib/format';

interface SupplierReturnsModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
  projectName?: string;
}

export function SupplierReturnsModal({
  isOpen,
  onClose,
  projectId,
  projectName,
}: SupplierReturnsModalProps) {
  const { t } = useTranslation();
  const { currencySymbol, formatCurrency } = useSystemCurrency();
  const [returns, setReturns] = useState<ContractingSupplierReturn[]>([]);
  const [loading, setLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);

  // Form states
  const [supplierName, setSupplierName] = useState('');
  const [materialName, setMaterialName] = useState('');
  const [quantity, setQuantity] = useState<number>(0);
  const [unit, setUnit] = useState('طن');
  const [unitCost, setUnitCost] = useState<number>(0);
  const [reason, setReason] = useState('غير مطابق للمواصفات الفنية');
  const [creditNoteNumber, setCreditNoteNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadReturns = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMsg(null);
      const data = await contractingApi.getSupplierReturns(projectId);
      setReturns(data);
    } catch (err: any) {
      setErrorMsg(err?.message || 'فشل تحميل سجل مرتجعات الموردين');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (isOpen) {
      loadReturns();
      setIsAdding(false);
    }
  }, [isOpen, loadReturns]);

  const handleCreateReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!materialName.trim()) {
      setErrorMsg('يرجى كتابة اسم المادة المرتجعة');
      return;
    }
    if (!quantity || quantity <= 0) {
      setErrorMsg('يرجى تحديد كمية المرتجع بشكل صحيح');
      return;
    }
    if (!supplierName.trim()) {
      setErrorMsg('يرجى تحديد اسم المورد');
      return;
    }

    try {
      setSaving(true);
      setErrorMsg(null);
      await contractingApi.createSupplierReturn(projectId || '', {
        supplierName: supplierName.trim(),
        materialName: materialName.trim(),
        quantity: Number(quantity),
        unit,
        unitCost: Number(unitCost || 0),
        reason: reason.trim(),
        creditNoteNumber: creditNoteNumber.trim() || undefined,
        returnDate: todayLocalDateKey(),
      });
      setIsAdding(false);
      setSupplierName('');
      setMaterialName('');
      setQuantity(0);
      setUnitCost(0);
      setReason('غير مطابق للمواصفات الفنية');
      setCreditNoteNumber('');
      await loadReturns();
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر تسجيل إذن المرتجع');
    } finally {
      setSaving(false);
    }
  };

  const totalReturnValue = returns.reduce((sum, r) => sum + Number(r.totalAmount || 0), 0);

  return (
    <StandardDialog
      open={isOpen}
      onClose={onClose}
      title={t('contracting.supplier_returns_modal.s0', "مرتجعات خامات ومواد للموردين (Supplier Returns & Credit Notes)")}
      maxWidth="940px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} dir="rtl">
        {/* هيدر المودال وزر الإضافة */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <div style={{ fontSize: 'var(--font-section-title)', fontWeight: 700, color: '#1e293b' }}>
              {t('contracting.supplier_returns_modal.s1', "سجل رد وتكهين الخامات للموردين")}
            </div>
            <div style={{ fontSize: 'var(--font-subtitle)', color: '#64748b' }}>
              {projectName ? `المشروع: ${projectName}` : t('contracting.supplier_returns_modal.s2', "توثيق أذون خروج الخامات المرفوضة وإشعارات الخصم الدائنة")}
            </div>
          </div>
          {!isAdding && (
            <button
              type="button"
              onClick={() => {
                setIsAdding(true);
                setErrorMsg(null);
              }}
              style={{
                height: '34px',
                padding: '0 14px',
                borderRadius: '6px',
                fontWeight: 700,
                background: '#ea580c',
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
              <span>{t('contracting.supplier_returns_modal.s3', "إصدار إذن مرتجع جديد")}</span>
            </button>
          )}
        </div>

        {errorMsg && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '10px 14px', borderRadius: '8px', fontSize: 'var(--font-body)' }}>
            {errorMsg}
          </div>
        )}

        {/* بطاقة الإجمالي */}
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 'var(--font-micro)', color: '#9a3412', fontWeight: 600 }}>{t('contracting.supplier_returns_modal.s4', "إجمالي قيمة المرتجعات وإشعارات الدائن")}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#c2410c', marginTop: '2px' }}>
              {formatCurrency(totalReturnValue)}
            </div>
          </div>
          <div style={{ fontSize: 'var(--font-body)', fontWeight: 600, color: '#9a3412' }}>
            {t('contracting.supplier_returns_modal.s5', "عدد أذون الإرجاع:")} {returns.length}
          </div>
        </div>

        {/* نموذج إضافة مرتجع */}
        {isAdding && (
          <form
            onSubmit={handleCreateReturn}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            {/* بطاقة 1: بيانات المورد والمادة المرتجعة */}
            <div style={{ background: '#f8fafc', padding: '9px 13px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
                <AppIcons.Truck size={15} />
                <span>{t('contracting.supplier_returns_modal.s6', "1. بيانات المورد والمادة المرتجعة")}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1.5fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                    {t('contracting.supplier_returns_modal.s7', "اسم المورد *")}
                  </label>
                  <input
                    type="text"
                    required
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    placeholder={t('contracting.supplier_returns_modal.s8', "مثال: شركة السويس للأسمنت")}
                    style={{ width: '100%', height: '33px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.8125rem', background: '#fff', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                    {t('contracting.supplier_returns_modal.s9', "المادة أو الخامة المرتجعة *")}
                  </label>
                  <input
                    type="text"
                    required
                    value={materialName}
                    onChange={(e) => setMaterialName(e.target.value)}
                    placeholder={t('contracting.supplier_returns_modal.s10', "مثال: أسمنت بورتلاندي عادي")}
                    style={{ width: '100%', height: '33px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.8125rem', background: '#fff', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                    {t('contracting.supplier_returns_modal.s11', "الوحدة")}
                  </label>
                  <input
                    type="text"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    placeholder={t('contracting.supplier_returns_modal.s12', "طن / م3 / شيكارة")}
                    style={{ width: '100%', height: '33px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.8125rem', background: '#fff', boxSizing: 'border-box' }}
                  />
                </div>
              </div>
            </div>

            {/* بطاقة 2: الكمية والتسعير وإشعار الدائن والسبب */}
            <div style={{ background: '#f8fafc', padding: '9px 13px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
                <AppIcons.DollarSign size={15} />
                <span>{t('contracting.supplier_returns_modal.s13', "2. الكمية والتسعير وإشعار الدائن وسبب الإرجاع")}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                    {t('contracting.supplier_returns_modal.s14', "الكمية المرتجعة *")}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    required
                    value={quantity || ''}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    placeholder="0.00"
                    style={{ width: '100%', height: '33px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.8125rem', background: '#fff', fontWeight: 700, color: '#170e5e', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                    {t('contracting.supplier_returns_modal.s15', "سعر الوحدة (")}{currencySymbol})
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={unitCost || ''}
                    onChange={(e) => setUnitCost(Number(e.target.value))}
                    placeholder="0.00"
                    style={{ width: '100%', height: '33px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.8125rem', background: '#fff', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                    {t('contracting.supplier_returns_modal.s16', "رقم إشعار الدائن (Credit Note)")}
                  </label>
                  <input
                    type="text"
                    value={creditNoteNumber}
                    onChange={(e) => setCreditNoteNumber(e.target.value)}
                    placeholder={t('contracting.supplier_returns_modal.s17', "مثال: CRN-260914-0001")}
                    style={{ width: '100%', height: '33px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.8125rem', background: '#fff', boxSizing: 'border-box' }}
                  />
                </div>
              </div>
              <div style={{ marginTop: '8px' }}>
                <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  {t('contracting.supplier_returns_modal.s18', "سبب الإرجاع وملاحظات الفحص المخبري / الاستشاري *")}
                </label>
                <input
                  type="text"
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t('contracting.supplier_returns_modal.s19', "مثال: تلف وشك الأسمنت بسبب الرطوبة أو رسوب اختبار الشد للحديد...")}
                  style={{ width: '100%', height: '33px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '0.8125rem', background: '#fff', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '2px' }}>
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                style={{ height: '33px', padding: '0 14px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', color: '#475569', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600 }}
              >
                {t('contracting.supplier_returns_modal.s20', "إلغاء")}
              </button>
              <button
                type="submit"
                disabled={saving}
                style={{ height: '33px', padding: '0 18px', borderRadius: '6px', border: 'none', background: '#170e5e', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: '0.8125rem' }}
              >
                {saving ? t('contracting.supplier_returns_modal.s21', "جارٍ الحفظ...") : t('contracting.supplier_returns_modal.s22', "حفظ إذن المرتجع")}
              </button>
            </div>
          </form>
        )}

        {/* جدول المرتجعات */}
        <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>{t('contracting.supplier_returns_modal.s23', "جاري تحميل أذون المرتجع...")}</div>
          ) : returns.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>{t('contracting.supplier_returns_modal.s24', "لا توجد أذون مرتجع مواد مسجلة لهذا المشروع")}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('contracting.supplier_returns_modal.s25', "رقم الإذن")}</th>
                  <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('contracting.supplier_returns_modal.s26', "المورد")}</th>
                  <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('contracting.supplier_returns_modal.s27', "الخامة / المادة")}</th>
                  <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('contracting.supplier_returns_modal.s28', "الكمية والوحدة")}</th>
                  <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('contracting.supplier_returns_modal.s29', "إجمالي المبلغ (")}{currencySymbol})</th>
                  <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('contracting.supplier_returns_modal.s30', "سبب الإرجاع")}</th>
                  <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('contracting.supplier_returns_modal.s31', "إشعار الدائن")}</th>
                  <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('contracting.supplier_returns_modal.s32', "التاريخ")}</th>
                </tr>
              </thead>
              <tbody>
                {returns.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', fontWeight: 700, color: '#1e293b' }}>
                      {r.returnNumber}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', fontWeight: 600, color: '#0f172a' }}>
                      {r.supplierName}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', color: '#170e5e', fontWeight: 600 }}>
                      {r.materialName}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', color: '#334155' }}>
                      {Number(r.quantity).toLocaleString('en-US')} {r.unit}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', fontWeight: 700, color: '#c2410c' }}>
                      {Number(r.totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 'var(--font-micro)', color: '#475569', maxWidth: '200px' }}>
                      {r.reason}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 'var(--font-micro)', color: '#0369a1', fontWeight: 600 }}>
                      {r.creditNoteNumber || '—'}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 'var(--font-micro)', color: '#64748b' }}>
                      {r.returnDate ? new Date(r.returnDate).toLocaleDateString('ar-EG') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </StandardDialog>
  );
}
