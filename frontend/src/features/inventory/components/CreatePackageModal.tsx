import { useTranslation } from 'react-i18next';
import { useState, useEffect, type FC, type FormEvent } from 'react';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { CustomSelect } from '@/shared/ui/custom-select';
import { toast } from '@/shared/components/system-alert';
import { PlusIcon, Trash2Icon } from '@/shared/components/icons/AppIcons';
import { productsApi } from '@/shared/api/products.api';
import {
  warehousePackagesApi,
  type CreatePackagePayload,
  type WarehousePackageRecord,
} from '../api/warehouse-packages.api';

interface CreatePackageModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  existingPackages: WarehousePackageRecord[];
}

export const CreatePackageModal: FC<CreatePackageModalProps> = ({
  open,
  onClose,
  onSuccess,
  existingPackages,
}) => {
  const { t } = useTranslation();
  const [packageType, setPackageType] = useState<'pallet' | 'crate' | 'carton' | 'box'>('box');
  const [parentPackageId, setParentPackageId] = useState<string>('');
  const [packageNumber, setPackageNumber] = useState('');
  const [grossWeightKg, setGrossWeightKg] = useState('');
  const [netWeightKg, setNetWeightKg] = useState('');
  const [notes, setNotes] = useState('');
  const [products, setProducts] = useState<Array<{ id: number; name: string; code?: string }>>([]);
  const [items, setItems] = useState<Array<{
    productId: number;
    quantity: number;
    unitName: string;
    batchNumber: string;
  }>>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      productsApi.listAll().then((res) => {
        const prods = (res as any)?.products || res || [];
        setProducts(prods);
      }).catch((err) => console.error('Failed to load products', err));
    }
  }, [open]);

  const packageTypeOptions = [
    { value: 'box', label: 'صندوق / كرتونة صغيرة (Box)' },
    { value: 'carton', label: 'كرتونة مجمعة (Carton)' },
    { value: 'crate', label: 'قفص لوجستي (Crate)' },
    { value: 'pallet', label: 'طبلية / بالتة خشبية (Pallet)' },
  ];

  // Eligible parent packages (cannot pack inside a box if current is pallet)
  const parentOptions = [
    { value: '', label: 'بدون طرد رئيسي (مستوى أعلى رئيسي)' },
    ...existingPackages
      .filter((p) => p.status !== 'shipped' && p.status !== 'consumed')
      .map((p) => ({
        value: p.id,
        label: `${p.package_number} (${p.package_type === 'pallet' ? 'طبلية' : 'صندوق'}) - ${p.status}`,
      })),
  ];

  const productOptions = products.map((p) => ({
    value: String(p.id),
    label: `${p.name} ${p.code ? `[${p.code}]` : ''}`,
  }));

  const addItemRow = () => {
    setItems([...items, { productId: products[0]?.id || 0, quantity: 1, unitName: 'قطعة', batchNumber: '' }]);
  };

  const removeItemRow = (idx: number) => {
    setItems(items.filter((_, i) => i !== idx));
  };

  const updateItemRow = (idx: number, field: string, val: any) => {
    setItems(items.map((item, i) => i === idx ? { ...item, [field]: val } : item));
  };

  const handleSubmit = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    setIsSubmitting(true);
    try {
      const payload: CreatePackagePayload = {
        packageType,
        parentPackageId: parentPackageId || undefined,
        packageNumber: packageNumber.trim() || undefined,
        grossWeightKg: grossWeightKg ? Number(grossWeightKg) : undefined,
        netWeightKg: netWeightKg ? Number(netWeightKg) : undefined,
        notes: notes.trim() || undefined,
        items: items.filter((i) => i.productId > 0 && i.quantity > 0).map((i) => ({
          productId: Number(i.productId),
          quantity: Number(i.quantity),
          unitName: i.unitName.trim() || 'قطعة',
          batchNumber: i.batchNumber.trim() || undefined,
        })),
      };

      await warehousePackagesApi.create(payload);
      toast.success('تم إنشاء وترميز الطرد المخزني بنجاح');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'فشل إنشاء الطرد');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={t('inventory.create_package_modal.s0', "إنشاء وترميز طرد / بالتة جديدة (Multi-level Packaging & Pallets)")}
      subtitle={t('inventory.create_package_modal.s1', "إدارة التعبئة متعددة الطبقات (طبلية - كرتونة - قطعة) والترميز التسلسلي الباركودي")}
      size="lg"
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              {t('inventory.create_package_modal.s2', "نوع ومستوى الطرد *")}
            </label>
            <CustomSelect
              value={packageType}
              onChange={(val) => setPackageType(val as any)}
              options={packageTypeOptions}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              {t('inventory.create_package_modal.s3', "الطرد الأب الحاوي (Pack-in-Pack)")}
            </label>
            <CustomSelect
              value={parentPackageId}
              onChange={setParentPackageId}
              options={parentOptions}
              placeholder={t('inventory.create_package_modal.s4', "اختر الطبلية أو الحاوية الحاوية...")}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              {t('inventory.create_package_modal.s5', "باركود / كود الطرد (يولد تلقائياً إن تُرِك فارغاً)")}
            </label>
            <input
              type="text"
              value={packageNumber}
              onChange={(e) => setPackageNumber(e.target.value)}
              placeholder={t('inventory.create_package_modal.s6', "مثال: PAL-260930-0001 أو BOX-...")}
              style={{ width: '100%', height: '36px', padding: '6px 10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              {t('inventory.create_package_modal.s7', "الوزن القائم التقريبي (Gross Weight - كجم)")}
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={grossWeightKg}
              onChange={(e) => setGrossWeightKg(e.target.value)}
              placeholder={t('inventory.create_package_modal.s8', "مثال: 45.5")}
              style={{ width: '100%', height: '36px', padding: '6px 10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              {t('inventory.create_package_modal.s9', "الوزن الصافي التقريبي (Net Weight - كجم)")}
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={netWeightKg}
              onChange={(e) => setNetWeightKg(e.target.value)}
              placeholder={t('inventory.create_package_modal.s10', "مثال: 42.0")}
              style={{ width: '100%', height: '36px', padding: '6px 10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
            />
          </div>
        </div>

        {/* Packed Items */}
        <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px', background: '#f8fafc' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#1e293b' }}>
              {t('inventory.create_package_modal.s11', "الأصناف المعبأة داخل هذا الطرد مباشرة")}
            </h4>
            <button
              type="button"
              onClick={addItemRow}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 10px',
                fontSize: '12.5px',
                fontWeight: 600,
                color: '#170e5e',
                background: '#e0e7ff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              <PlusIcon size={14} />
              {t('inventory.create_package_modal.s12', "إضافة صنف")}
            </button>
          </div>

          {items.length === 0 ? (
            <div style={{ padding: '16px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
              {t('inventory.create_package_modal.s13', "لا توجد أصناف معبأة مباشرة (يمكن أن يكون طرداً مجمعاً يحتوي فقط على طرود داخلية)")}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #cbd5e1', color: '#64748b', textAlign: 'right' }}>
                  <th style={{ padding: '8px' }}>{t('inventory.create_package_modal.s14', "الصنف")}</th>
                  <th style={{ padding: '8px', width: '120px' }}>{t('inventory.create_package_modal.s15', "الكمية")}</th>
                  <th style={{ padding: '8px', width: '100px' }}>{t('inventory.create_package_modal.s16', "الوحدة")}</th>
                  <th style={{ padding: '8px', width: '130px' }}>{t('inventory.create_package_modal.s17', "رقم التشغيلة (Batch)")}</th>
                  <th style={{ padding: '8px', width: '40px' }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((row, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '6px' }}>
                      <CustomSelect
                        value={String(row.productId)}
                        onChange={(val) => updateItemRow(idx, 'productId', Number(val))}
                        options={productOptions}
                        placeholder={t('inventory.create_package_modal.s18', "اختر الصنف...")}
                      />
                    </td>
                    <td style={{ padding: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }} dir="rtl">
                        <button
                          type="button"
                          onClick={() => updateItemRow(idx, 'quantity', Number(row.quantity || 0) + 1)}
                          style={{ width: '28px', height: '28px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#ffffff', cursor: 'pointer' }}
                        >
                          +
                        </button>
                        <input
                          type="number"
                          min="0.001"
                          step="1"
                          value={row.quantity}
                          onChange={(e) => updateItemRow(idx, 'quantity', e.target.value)}
                          style={{ width: '50px', height: '28px', textAlign: 'center', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                          required
                        />
                        <button
                          type="button"
                          onClick={() => updateItemRow(idx, 'quantity', Math.max(1, Number(row.quantity || 0) - 1))}
                          style={{ width: '28px', height: '28px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#ffffff', cursor: 'pointer' }}
                        >
                          -
                        </button>
                      </div>
                    </td>
                    <td style={{ padding: '6px' }}>
                      <input
                        type="text"
                        value={row.unitName}
                        onChange={(e) => updateItemRow(idx, 'unitName', e.target.value)}
                        style={{ width: '100%', height: '30px', padding: '4px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                      />
                    </td>
                    <td style={{ padding: '6px' }}>
                      <input
                        type="text"
                        value={row.batchNumber}
                        onChange={(e) => updateItemRow(idx, 'batchNumber', e.target.value)}
                        placeholder={t('inventory.create_package_modal.s19', "اختياري")}
                        style={{ width: '100%', height: '30px', padding: '4px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                      />
                    </td>
                    <td style={{ padding: '6px', textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => removeItemRow(idx)}
                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}
                      >
                        <Trash2Icon size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
            {t('inventory.create_package_modal.s20', "ملاحظات وشروط التخزين")}
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder={t('inventory.create_package_modal.s21', "ملاحظات حول قابلية الكسر، اتجاه الرص، أو قيود النقل...")}
            style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e1', resize: 'vertical' }}
          />
        </div>

        <StandardDialogFooter
          onClose={onClose}
          primaryButton={{
            label: isSubmitting ? t('inventory.create_package_modal.s22', "جاري الترميز والحفظ...") : t('inventory.create_package_modal.s23', "تأكيد وترميز الطرد"),
            disabled: isSubmitting,
            onClick: () => handleSubmit(),
          }}
        />
      </form>
    </StandardDialog>
  );
};
