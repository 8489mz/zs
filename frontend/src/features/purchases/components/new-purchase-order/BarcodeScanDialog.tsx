import { useEffect, useRef, useState } from 'react';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { CameraBarcodeScannerModal } from '@/shared/components/CameraBarcodeScannerModal';
import { getBarcodeLookupCandidates } from '@/lib/barcode';
import { useTranslation } from '../../utils/i18n-purchase-prototype';
import type { ProductOption } from './newPurchaseOrder.types';

export function BarcodeScanDialog({
  open,
  query,
  products,
  onClose,
  onScan,
  onOpenQuickCreate,
}: {
  open: boolean;
  query: string;
  products: ProductOption[];
  onClose: () => void;
  onScan: (barcode: string) => void;
  onOpenQuickCreate: (barcode: string) => void;
}) {
  const { t: __t } = useTranslation();
  const { t } = useTranslation();
  const [barcode, setBarcode] = useState(query);
  const [showCamera, setShowCamera] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const scanCandidates = getBarcodeLookupCandidates(barcode).map((c) => c.toLowerCase());
  const matched = scanCandidates
    .map((candidate) => products.find((product) => String(product.barcode || '').trim().toLowerCase() === candidate))
    .find(Boolean);
  const resolvedScanCode = matched ? matched.barcode : barcode.trim();

  useEffect(() => {
    if (!open) return;
    setBarcode(query);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        onScan(resolvedScanCode || barcode);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [barcode, resolvedScanCode, onClose, onScan, open]);

  if (!open) return null;

  return (
    <>
      <div className="purchase-prototype-create-backdrop" role="presentation" onMouseDown={onClose}>
        <div className="purchase-prototype-create-card" role="dialog" aria-modal="true" aria-labelledby="purchase-prototype-barcode-title" onMouseDown={(event) => event.stopPropagation()}>
          <div className="purchase-prototype-create-header">
            <div>
              <h4 id="purchase-prototype-barcode-title">{t('scan_barcode_title')}</h4>
              <p>{t('scan_barcode_desc')}</p>
            </div>
            <button type="button" className="purchase-prototype-create-close" aria-label={t("close")} onClick={onClose}>×</button>
          </div>
          <div className="purchase-prototype-create-grid">
            <Field label={t("barcode")}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input className="purchase-prototype-create-input" style={{ flex: 1 }} ref={inputRef} value={barcode} onChange={(event) => setBarcode(event.target.value)} placeholder="622100001" />
                <Button type="button" variant="secondary" onClick={() => setShowCamera(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                    <circle cx="12" cy="13" r="4"></circle>
                  </svg>
                  <span>{__t('purchases.new_purchase_order.barcode_scan_dialog.s0', "كاميرا")}</span>
                </Button>
              </div>
            </Field>
            <div className="muted small">{t('test_barcode_notice')}</div>
            {matched ? <div className="success-box">{t('found_item')} <strong>{matched.name}</strong></div> : barcode.trim() ? <div className="error-box">{t('item_not_found')}</div> : null}
          </div>
          <div className="purchase-prototype-create-actions">
            <Button variant="secondary" type="button" onClick={onClose}>{t('cancel')}</Button>
            {matched ? (
              <Button type="button" onClick={() => onScan(resolvedScanCode || barcode)}>{t('add_to_item')}</Button>
            ) : (
              <Button type="button" onClick={() => onOpenQuickCreate(barcode)}>{t('create_new_item_with_barcode')}</Button>
            )}
          </div>
        </div>
      </div>

      <CameraBarcodeScannerModal
        isOpen={showCamera}
        onClose={() => setShowCamera(false)}
        onScan={(scannedCode) => {
          setBarcode(scannedCode);
          setShowCamera(false);
          onScan(scannedCode);
        }}
        title={__t('purchases.new_purchase_order.barcode_scan_dialog.s1', "مسح باركود الصنف بكاميرا الهاتف")}
      />
    </>
  );
}
