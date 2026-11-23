import { BarcodeIcon, DownloadIcon, FileSpreadsheetIcon, PrinterIcon, RefreshCwIcon, RotateCcwIcon, SlidersIcon } from '@/shared/components/icons/AppIcons';
import { Button } from '@/shared/ui/button';
import type { useTranslation } from 'react-i18next';
import type { StockCountType } from './inventory-composer-cards-shared';
import type { Product, StockCountItem } from '@/types/domain';
import type { StockCountSheetRow } from '@/features/inventory/lib/inventory-documents';

export interface StockCountComposerToolbarProps {
  t: ReturnType<typeof useTranslation>['t'];
  barcodeInputRef: React.RefObject<HTMLInputElement | null>;
  barcodeScanInput: string;
  setBarcodeScanInput: React.Dispatch<React.SetStateAction<string>>;
  handleBarcodeKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  handleBarcodeScan: (code: string) => void;
  canReviewStock: boolean;
  showExpectedInElectronicCount: boolean;
  setShowExpectedInElectronicCount: React.Dispatch<React.SetStateAction<boolean>>;
  countType: StockCountType;
  items: StockCountItem[];
  handlePopulateScopeItems: () => void;
  scopeProducts: Product[];
  handleZeroUncounted: () => void;
  uncountedCount: number;
  handleZeroAllCounts: () => void;
  handleResetAllToExpected: () => void;
  handleClearAllCounts: () => void;
  handlePrintSheet: () => void;
  sheetRows: StockCountSheetRow[];
  handleExportExcel: () => void;
}

export function StockCountComposerToolbar({ t, barcodeInputRef, barcodeScanInput, setBarcodeScanInput, handleBarcodeKeyDown, handleBarcodeScan, canReviewStock, showExpectedInElectronicCount, setShowExpectedInElectronicCount, countType, items, handlePopulateScopeItems, scopeProducts, handleZeroUncounted, uncountedCount, handleZeroAllCounts, handleResetAllToExpected, handleClearAllCounts, handlePrintSheet, sheetRows, handleExportExcel }: StockCountComposerToolbarProps) {
  return (
    <div className="stock-count-active-toolbar">
      <div className="stock-count-scanner-group">
        <span className="scanner-tag">
          <BarcodeIcon size={16} />
          <span>{t('inventory.sections.inventory_composer_cards.s54', "مسح سريع")}</span>
        </span>
        <input
          ref={barcodeInputRef}
          type="text"
          className="stock-count-scanner-field"
          placeholder={t('inventory.sections.inventory_composer_cards.s55', "امسح الباركود للعد السريع (+1 تلقائياً)...")}
          value={barcodeScanInput}
          onChange={(e) => setBarcodeScanInput(e.target.value)}
          onKeyDown={handleBarcodeKeyDown}
        />
        <Button type="button" variant="secondary" onClick={() => handleBarcodeScan(barcodeScanInput)}>{t('inventory.sections.inventory_composer_cards.s56', "عد")}</Button>
      </div>

      <div className="stock-count-tools-group">
        {canReviewStock ? (
          <label className="stock-count-sheet-expected-toggle" title={t('inventory.sections.inventory_composer_cards.s57', "إظهار كميات النظام في شيت الطباعة والإكسيل")}>
            <input
              type="checkbox"
              checked={showExpectedInElectronicCount}
              onChange={(e) => setShowExpectedInElectronicCount(e.target.checked)}
            />
            <span>{t('inventory.sections.inventory_composer_cards.s58', "رصيد النظام")}</span>
          </label>
        ) : null}
        {(countType === 'category' || countType === 'supplier' || countType === 'full') && !items.length ? (
          <Button type="button" variant="primary" onClick={handlePopulateScopeItems}>
            <DownloadIcon size={15} />
            <span>{t('inventory.sections.inventory_composer_cards.s59', "إدخال إلكتروني (")}{scopeProducts.length} {t('inventory.sections.inventory_composer_cards.s60', "صنف)")}</span>
          </Button>
        ) : null}
        {items.length > 0 ? (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={handleZeroUncounted}
              disabled={uncountedCount === 0}
              title={uncountedCount > 0 ? `وضع رصيد (0) لعدد ${uncountedCount} صنف متبقٍ لم يتم عده، مع الحفاظ على ما قمت بعده` : 'تم عد كافة الأصناف بالفعل'}
              style={{
                borderColor: uncountedCount > 0 ? '#93c5fd' : undefined,
                backgroundColor: uncountedCount > 0 ? '#eff6ff' : undefined,
                color: uncountedCount > 0 ? '#1d4ed8' : undefined,
                fontWeight: 700,
              }}
            >
              <RotateCcwIcon size={14} />
              <span>{uncountedCount > 0 ? `تصفير المتبقي (${uncountedCount})` : 'تصفير المتبقي (0)'}</span>
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={handleZeroAllCounts}
              title="وضع رصيد صفري (0) لكافة أصناف الجلسة لإثبات أن المخزن فارغ ثم تعديل ما يتواجد فعلياً"
            >
              <span>تصفير الكل (0)</span>
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={handleResetAllToExpected}
              title="إعادة تعيين كافة الكميات المعدودة لتطابق رصيد النظام (تصفير الفروقات)"
            >
              <RefreshCwIcon size={14} />
              <span>ملء برصيد النظام</span>
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={handleClearAllCounts}
              title="إفراغ كافة خانات العد للبدء في الجرد الأعمى (الأصناف الفارغة لا يتم إدراجها في الجلسة)"
            >
              <SlidersIcon size={14} />
              <span>إفراغ الخانات (أعمى)</span>
            </Button>
          </>
        ) : null}
        <Button type="button" variant="secondary" onClick={handlePrintSheet} disabled={!sheetRows.length}>
          <PrinterIcon size={15} />
          <span>{t('inventory.sections.inventory_composer_cards.s61', "طباعة الشيت")}</span>
        </Button>
        <Button type="button" variant="secondary" onClick={handleExportExcel} disabled={!sheetRows.length}>
          <FileSpreadsheetIcon size={15} />
          <span>Excel</span>
        </Button>
      </div>
    </div>
  );
}
