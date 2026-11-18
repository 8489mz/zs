import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { CustomSelect } from '@/shared/ui/custom-select';
import { contractingApi } from '../api/contracting.api';
import { ContractingSupplierPriceMemory } from '../contracting.types';
import { useSystemCurrency } from '@/shared/hooks/use-system-currency';
import { todayLocalDateKey } from '@/lib/format';

interface SuppliersDirectoryModalProps {
  open: boolean;
  onClose: () => void;
  onSelectSupplier?: (supplier: ContractingSupplierPriceMemory) => void;
}

const GOVERNORATE_OPTIONS = [
  { value: 'all', label: 'كافة المحافظات' },
  { value: 'القاهرة', label: 'القاهرة' },
  { value: 'الجيزة', label: 'الجيزة' },
  { value: 'القليوبية', label: 'القليوبية' },
  { value: 'الشرقية', label: 'الشرقية' },
  { value: 'الإسكندرية', label: 'الإسكندرية' },
  { value: 'السويس', label: 'السويس' },
  { value: 'الدقهلية', label: 'الدقهلية' },
  { value: 'المنوفية', label: 'المنوفية' },
  { value: 'بني سويف', label: 'بني سويف' },
];

const PAYMENT_TERMS_OPTIONS = [
  { value: 'all', label: 'كافة شروط السداد' },
  { value: 'cash', label: 'نقداً (كاش)' },
  { value: 'credit_30', label: 'آجل 30 يوم' },
  { value: 'credit_60', label: 'آجل 60 يوم' },
  { value: 'installments', label: 'دفعات وتسهيلات' },
];

export function SuppliersDirectoryModal({
  open,
  onClose,
  onSelectSupplier,
}: SuppliersDirectoryModalProps) {
  const { t: __t } = useTranslation();
  const { currencySymbol, formatCurrency } = useSystemCurrency();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<ContractingSupplierPriceMemory[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);

  // Filters
  const [searchMaterial, setSearchMaterial] = useState('');
  const [selectedGov, setSelectedGov] = useState('all');
  const [selectedTerms, setSelectedTerms] = useState('all');

  // Add Form state
  const [supplierName, setSupplierName] = useState('');
  const [materialName, setMaterialName] = useState('');
  const [unit, setUnit] = useState('طن');
  const [lastUnitPrice, setLastUnitPrice] = useState<number | ''>('');
  const [lastPurchaseDate, setLastPurchaseDate] = useState(todayLocalDateKey());
  const [governorate, setGovernorate] = useState('القاهرة');
  const [paymentTerms, setPaymentTerms] = useState<any>('cash');
  const [qualityRating, setQualityRating] = useState<number>(5);
  const [deliverySpeedRating, setDeliverySpeedRating] = useState<number>(5);
  const [notes, setNotes] = useState('');

  const loadDirectory = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await contractingApi.getSupplierPriceMemory({
        materialName: searchMaterial.trim() || undefined,
        governorate: selectedGov !== 'all' ? selectedGov : undefined,
        paymentTerms: selectedTerms !== 'all' ? selectedTerms : undefined,
      });
      setSuppliers(data);
    } catch (err: any) {
      console.error('Failed to load supplier price memory:', err);
      setErrorMsg(err?.message || 'فشل تحميل دليل الموردين والذاكرة السعرية');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadDirectory();
    }
  }, [open, selectedGov, selectedTerms]);

  const handleCreatePriceMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierName.trim() || !materialName.trim()) {
      setErrorMsg('يرجى تحديد اسم المورد والخامة');
      return;
    }
    const numPrice = Number(lastUnitPrice);
    if (isNaN(numPrice) || numPrice <= 0) {
      setErrorMsg('يرجى كتابة سعر صحيح للوحدة');
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      await contractingApi.recordSupplierPriceMemory({
        supplierId: Date.now(), // Fallback local supplier id
        supplierName: supplierName.trim(),
        materialName: materialName.trim(),
        unit: unit.trim(),
        lastUnitPrice: numPrice,
        lastPurchaseDate,
        governorate,
        paymentTerms,
        qualityRating,
        deliverySpeedRating,
        notes: notes.trim() || undefined,
      });

      setSupplierName('');
      setMaterialName('');
      setLastUnitPrice('');
      setNotes('');
      setShowAddForm(false);
      await loadDirectory();
    } catch (err: any) {
      console.error('Failed to record supplier price memory:', err);
      setErrorMsg(err?.message || 'حدث خطأ أثناء حفظ بيانات المورد');
    } finally {
      setSaving(false);
    }
  };

  const filteredSuppliers = suppliers.filter((s) => {
    if (!searchMaterial.trim()) return true;
    const q = searchMaterial.trim().toLowerCase();
    return s.materialName.toLowerCase().includes(q) || s.supplierName.toLowerCase().includes(q);
  });

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={__t('contracting.suppliers_directory_modal.s0', "دليل وسجل الموردين المتقدم والذاكرة السعرية")}
      subtitle={__t('contracting.suppliers_directory_modal.s1', "تتبع آخر أسعار التوريد، وتقييم جودة وسرعة الموردين، وسداد الكاش والآجل حسب المحافظة")}
      width="min(1150px, 95vw)"
      minHeight="min(600px, 85vh)"
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <div style={{ fontSize: 'var(--font-micro)', color: '#64748b' }}>
            {__t('contracting.suppliers_directory_modal.s2', "تساعد الذاكرة السعرية في سرعة تسعير المناقصات الجديدة بأحدث أسعار الشراء الحقيقية.")}
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 22px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#ffffff',
              color: '#475569',
              fontSize: 'var(--font-body)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {__t('contracting.suppliers_directory_modal.s3', "إغلاق النافذة")}
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }} dir="rtl">
        {errorMsg && (
          <div style={{ padding: '10px 14px', borderRadius: '8px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 'var(--font-body)', fontWeight: 600 }}>
            {errorMsg}
          </div>
        )}

        {/* Filter Controls Bar */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 1.5fr auto', gap: '10px', alignItems: 'center' }}>
          <div>
            <input
              type="text"
              value={searchMaterial}
              onChange={(e) => setSearchMaterial(e.target.value)}
              placeholder={__t('contracting.suppliers_directory_modal.s4', "بحث بالخامة (حديد، أسمنت، رمل، سن...) أو اسم المورد...")}
              style={{
                width: '100%',
                height: '36px',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: 'var(--font-body)',
              }}
            />
          </div>

          <div>
            <CustomSelect
              value={selectedGov}
              options={GOVERNORATE_OPTIONS}
              onChange={(val) => setSelectedGov(val)}
              placeholder={__t('contracting.suppliers_directory_modal.s5', "المحافظة...")}
            />
          </div>

          <div>
            <CustomSelect
              value={selectedTerms}
              options={PAYMENT_TERMS_OPTIONS}
              onChange={(val) => setSelectedTerms(val)}
              placeholder={__t('contracting.suppliers_directory_modal.s6', "شروط السداد...")}
            />
          </div>

          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            style={{
              padding: '6px 14px',
              height: '36px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: showAddForm ? '#f1f5f9' : '#170e5e',
              color: showAddForm ? '#334155' : '#ffffff',
              fontSize: 'var(--font-body)',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
            }}
          >
            {showAddForm ? <AppIcons.X size={15} /> : <AppIcons.Plus size={15} />}
            <span>{showAddForm ? __t('contracting.suppliers_directory_modal.s7', "إلغاء الإضافة") : __t('contracting.suppliers_directory_modal.s8', "إضافة سعر لمورد")}</span>
          </button>
        </div>

        {/* Add Form */}
        {showAddForm && (
          <form
            onSubmit={handleCreatePriceMemory}
            style={{
              padding: '16px',
              borderRadius: '12px',
              backgroundColor: '#f8fafc',
              border: '1px solid #cbd5e1',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ fontWeight: 700, color: '#170e5e', fontSize: 'var(--font-body)' }}>
              {__t('contracting.suppliers_directory_modal.s9', "تسجيل سعر خامة جديد في ذاكرة الموردين")}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1.5fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  {__t('contracting.suppliers_directory_modal.s10', "اسم المورد أو الشركة *")}
                </label>
                <input
                  type="text"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  placeholder={__t('contracting.suppliers_directory_modal.s11', "شركة الأهرام للأسمنت، مخزن السعادة...")}
                  required
                  style={{
                    width: '100%',
                    height: '36px',
                    padding: '0 10px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: 'var(--font-body)',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  {__t('contracting.suppliers_directory_modal.s12', "اسم الخامة / الصنف *")}
                </label>
                <input
                  type="text"
                  value={materialName}
                  onChange={(e) => setMaterialName(e.target.value)}
                  placeholder={__t('contracting.suppliers_directory_modal.s13', "أسمنت بورتلاندي رتبة 42.5، حديد عز 16 مم...")}
                  required
                  style={{
                    width: '100%',
                    height: '36px',
                    padding: '0 10px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: 'var(--font-body)',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  {__t('contracting.suppliers_directory_modal.s14', "الوحدة")}
                </label>
                <input
                  type="text"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder={__t('contracting.suppliers_directory_modal.s15', "طن / م³ / ألف...")}
                  style={{
                    width: '100%',
                    height: '36px',
                    padding: '0 10px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: 'var(--font-body)',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  {__t('contracting.suppliers_directory_modal.s16', "سعر الوحدة الأخير (")}{currencySymbol}) *
                </label>
                <input
                  type="number"
                  min="0.01"
                  step="any"
                  value={lastUnitPrice}
                  onChange={(e) => setLastUnitPrice(e.target.value === '' ? '' : parseFloat(e.target.value))}
                  placeholder="0.00"
                  required
                  style={{
                    width: '100%',
                    height: '36px',
                    padding: '0 10px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: 'var(--font-body)',
                    fontWeight: 700,
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1.5fr 1.5fr 1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  {__t('contracting.suppliers_directory_modal.s17', "المحافظة / النطاق")}
                </label>
                <CustomSelect
                  value={governorate}
                  options={GOVERNORATE_OPTIONS.filter((o) => o.value !== 'all')}
                  onChange={(val) => setGovernorate(val)}
                  placeholder={__t('contracting.suppliers_directory_modal.s18', "المحافظة...")}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  {__t('contracting.suppliers_directory_modal.s19', "شروط السداد")}
                </label>
                <CustomSelect
                  value={paymentTerms}
                  options={PAYMENT_TERMS_OPTIONS.filter((o) => o.value !== 'all')}
                  onChange={(val) => setPaymentTerms(val)}
                  placeholder={__t('contracting.suppliers_directory_modal.s20', "السداد...")}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  {__t('contracting.suppliers_directory_modal.s21', "تاريخ التعامل الأخير")}
                </label>
                <input
                  type="date"
                  value={lastPurchaseDate}
                  onChange={(e) => setLastPurchaseDate(e.target.value)}
                  style={{
                    width: '100%',
                    height: '36px',
                    padding: '0 10px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: 'var(--font-body)',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  {__t('contracting.suppliers_directory_modal.s22', "تقييم الجودة (1-5)")}
                </label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={qualityRating}
                  onChange={(e) => setQualityRating(parseInt(e.target.value) || 5)}
                  style={{
                    width: '100%',
                    height: '36px',
                    padding: '0 10px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: 'var(--font-body)',
                    fontWeight: 700,
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  {__t('contracting.suppliers_directory_modal.s23', "سرعة التوريد (1-5)")}
                </label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={deliverySpeedRating}
                  onChange={(e) => setDeliverySpeedRating(parseInt(e.target.value) || 5)}
                  style={{
                    width: '100%',
                    height: '36px',
                    padding: '0 10px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: 'var(--font-body)',
                    fontWeight: 700,
                  }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                {__t('contracting.suppliers_directory_modal.s24', "ملاحظات التعامل وخبرة الموقع")}
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={__t('contracting.suppliers_directory_modal.s25', "السعر شامل النقل والتعتيق / ملتزم بمواعيد الصب...")}
                style={{
                  width: '100%',
                  height: '34px',
                  padding: '0 10px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: 'var(--font-body)',
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                style={{
                  padding: '7px 16px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff',
                  color: '#475569',
                  fontSize: 'var(--font-body)',
                  cursor: 'pointer',
                }}
              >
                {__t('contracting.suppliers_directory_modal.s26', "إلغاء")}
              </button>
              <button
                type="submit"
                disabled={saving}
                style={{
                  padding: '7px 20px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: '#170e5e',
                  color: '#ffffff',
                  fontSize: 'var(--font-body)',
                  fontWeight: 700,
                  cursor: saving ? 'not-allowed' : 'pointer',
                }}
              >
                {saving ? __t('contracting.suppliers_directory_modal.s27', "جارٍ الحفظ...") : __t('contracting.suppliers_directory_modal.s28', "حفظ بالذاكرة السعرية")}
              </button>
            </div>
          </form>
        )}

        {/* Suppliers Table */}
        <div
          style={{
            minHeight: '280px',
            maxHeight: '380px',
            overflowY: 'auto',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            background: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {loading ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '280px', gap: '12px', backgroundColor: '#f8fafc', color: '#64748b' }}>
              <div style={{ width: '32px', height: '32px', border: '3px solid #cbd5e1', borderTopColor: '#170e5e', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              <span style={{ fontSize: 'var(--font-body)', fontWeight: 600 }}>
                {__t('contracting.suppliers_directory_modal.s29', "جارٍ تحميل دليل الموردين والذاكرة السعرية...")}
              </span>
            </div>
          ) : filteredSuppliers.length === 0 ? (
            <div style={{ flex: 1, minHeight: '280px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '36px', textAlign: 'center', color: '#64748b' }}>
              <AppIcons.ShoppingBag size={32} style={{ color: '#94a3b8' }} />
              <div style={{ fontWeight: 600 }}>{__t('contracting.suppliers_directory_modal.s30', "لا توجد خامات أو موردين يطابقون شروط البحث.")}</div>
              <div style={{ fontSize: 'var(--font-micro)', color: '#94a3b8' }}>
                {__t('contracting.suppliers_directory_modal.s31', "اضغط على \"إضافة سعر لمورد\" لتسجيل أول تسعيرة خامة في الذاكرة.")}
              </div>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>
                  <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{__t('contracting.suppliers_directory_modal.s32', "المورد")}</th>
                    <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{__t('contracting.suppliers_directory_modal.s33', "الخامة / الصنف")}</th>
                    <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{__t('contracting.suppliers_directory_modal.s34', "آخر سعر شراء")}</th>
                    <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{__t('contracting.suppliers_directory_modal.s35', "المحافظة")}</th>
                    <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{__t('contracting.suppliers_directory_modal.s36', "شروط السداد")}</th>
                    <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{__t('contracting.suppliers_directory_modal.s37', "تاريخ التعامل")}</th>
                    <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{__t('contracting.suppliers_directory_modal.s38', "التقييم")}</th>
                    {onSelectSupplier && (
                      <th style={{ padding: '10px 12px', fontSize: 'var(--font-table-head)', color: '#475569', textAlign: 'center' }}>{__t('contracting.suppliers_directory_modal.s39', "إجراء")}</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredSuppliers.map((sup) => {
                    const termsLabel = PAYMENT_TERMS_OPTIONS.find((t) => t.value === sup.paymentTerms)?.label || sup.paymentTerms;
                    return (
                      <tr key={sup.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', fontWeight: 700, color: '#170e5e' }}>
                          {sup.supplierName}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', fontWeight: 600, color: '#1e293b' }}>
                          {sup.materialName}
                          {sup.notes && (
                            <div style={{ fontSize: 'var(--font-micro)', color: '#64748b', fontWeight: 400, marginTop: '2px' }}>
                              {sup.notes}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', fontWeight: 800, color: '#0f172a' }}>
                          {formatCurrency(sup.lastUnitPrice)} / {sup.unit}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', color: '#475569' }}>
                          {sup.governorate}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)' }}>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '6px',
                              fontSize: 'var(--font-badge)',
                              fontWeight: 600,
                              backgroundColor: sup.paymentTerms === 'cash' ? '#f0fdf4' : '#eff6ff',
                              color: sup.paymentTerms === 'cash' ? '#166534' : '#1e40af',
                            }}
                          >
                            {termsLabel}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', color: '#64748b' }}>
                          {sup.lastPurchaseDate}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 'var(--font-body)', color: '#334155' }}>
                          {__t('contracting.suppliers_directory_modal.s40', "جودة:")} {sup.qualityRating}{__t('contracting.suppliers_directory_modal.s41', "/5 | سرعة:")} {sup.deliverySpeedRating}/5
                        </td>
                        {onSelectSupplier && (
                          <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => {
                                onSelectSupplier(sup);
                                onClose();
                              }}
                              style={{
                                padding: '4px 10px',
                                borderRadius: '6px',
                                border: 'none',
                                backgroundColor: '#170e5e',
                                color: '#ffffff',
                                fontSize: 'var(--font-micro)',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              {__t('contracting.suppliers_directory_modal.s42', "اختيار للتسعير")}
                            </button>
                          </td>
                        )}
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
