import { Suspense, lazy, useState } from 'react';
import { Button } from '@/shared/ui/button';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';
import { resolveBarcodeUnit, type BarcodePrintItem } from '@/lib/barcode-labels';
import { getSavedUnitBarcode } from '@/features/products/components/product-barcode-print.helpers';
import type { Product } from '@/types/domain';

const LazyBarcodePrintDialog = lazy(() =>
  import('@/features/products/components/BarcodePrintDialog').then((module) => ({
    default: module.BarcodePrintDialog,
  }))
);

export interface FashionGroupBarcodePrintActionProps {
  groupProducts: Product[];
  hasDraftChanges: boolean;
  disabled?: boolean;
}

export function buildGroupBarcodePrintItems(groupProducts: Product[]): {
  items: BarcodePrintItem[];
  skippedMissingBarcode: number;
} {
  const active = groupProducts.filter(
    (item) => item.isActive !== false && item.is_active !== false
  );
  const sorted = [...active].sort(
    (a, b) =>
      String(a.color || '').localeCompare(String(b.color || ''), 'ar') ||
      String(a.size || '').localeCompare(String(b.size || ''), 'ar')
  );

  const items: BarcodePrintItem[] = [];
  let skippedMissingBarcode = 0;

  for (const row of sorted) {
    const unit = resolveBarcodeUnit(row);
    const savedBarcode = getSavedUnitBarcode(row, unit);
    if (!savedBarcode) {
      skippedMissingBarcode += 1;
      continue;
    }
    items.push({
      product: row,
      unit,
      copies: Math.max(1, Number(row.stock || 0)),
    });
  }

  return { items, skippedMissingBarcode };
}

export function FashionGroupBarcodePrintAction({
  groupProducts,
  hasDraftChanges,
  disabled,
}: FashionGroupBarcodePrintActionProps) {
  const [printItems, setPrintItems] = useState<BarcodePrintItem[] | null>(null);

  const handleOpenPrint = () => {
    if (!groupProducts.length) {
      toast.warning('لا توجد متغيرات محفوظة للطباعة حالياً.');
      return;
    }
    if (hasDraftChanges) {
      toast.warning('احفظ تعديلات الموديل أولاً قبل طباعة ملصقات الباركود.');
      return;
    }

    const { items, skippedMissingBarcode } = buildGroupBarcodePrintItems(groupProducts);
    if (!items.length) {
      toast.warning('لا توجد باركودات محفوظة لهذا الموديل. اضغط "توليد باركودات" ثم احفظ أولاً.');
      return;
    }

    if (skippedMissingBarcode > 0) {
      toast.info(`تم تجهيز ${items.length} ملصق (وتخطي ${skippedMissingBarcode} متغير بدون باركود محفوظ).`);
    }
    setPrintItems(items);
  };

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={handleOpenPrint}
        disabled={disabled || !groupProducts.length}
        style={{
          fontSize: '0.74rem',
          padding: '3px 8px',
          whiteSpace: 'nowrap',
          color: '#170e5e',
          borderColor: '#cbd5e1',
          background: '#f8fafc',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
        }}
        title="طباعة ملصقات الباركود لكل متغيرات الموديل المحفوظة (الألوان والمقاسات)"
      >
        <AppIcons.Printer size={13} />
        <span>طباعة الملصقات</span>
      </Button>

      {printItems && (
        <Suspense fallback={null}>
          <LazyBarcodePrintDialog
            open
            items={printItems}
            onClose={() => setPrintItems(null)}
          />
        </Suspense>
      )}
    </>
  );
}
