import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Button } from '@/shared/ui/button';
import { XIcon, CheckCircleIcon, ArrowLeftIcon } from '@/shared/components/icons/AppIcons';
import { formatCurrency } from '@/lib/format';
import { calcCartLineTotal } from '@/features/pos/lib/pos-modifier-totals';
import type { PosPriceType } from '@/features/pos/types/pos.types';
import { toast } from '@/shared/components/system-alert';

/* R-I34 / INV-REST-LINE-IDENTITY: the transfer item carries the FULL line
 * identity. The old shape ({productId, name, qty, price, unitName,
 * modifiers, notes}) stripped lineKey / unitId / seat / course / serials
 * before the transfer started, so the target line had no key for later
 * qty / modifier / seat edits and matching fell back to product + price. */
export interface TransferableCartItem {
  id?: string | number;
  lineKey?: string;
  productId: number | string;
  name: string;
  qty: number;
  price: number;
  priceType?: PosPriceType;
  unitId?: string;
  unitName?: string;
  unitMultiplier?: number;
  modifiers?: any[];
  notes?: string;
  seatNumber?: number;
  course?: string;
  serials?: string[];
  originalPrice?: number;
}

interface PosTransferItemModalProps {
  open: boolean;
  onClose: () => void;
  sourceTable: string;
  sourceItems: TransferableCartItem[];
  allTables: string[];
  occupiedTables: string[];
  onConfirmTransfer: (
    targetTable: string,
    transferredItems: TransferableCartItem[]
  ) => Promise<void> | void;
}

export function PosTransferItemModal({
  open,
  onClose,
  sourceTable,
  sourceItems,
  allTables,
  occupiedTables,
  onConfirmTransfer,
}: PosTransferItemModalProps) {
  const { t: __t } = useTranslation();
  // Map of item index to quantity to transfer
  const [selectedQtys, setSelectedQtys] = useState<Record<number, number>>({});
  const [targetTable, setTargetTable] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedQtys({});
      // Default target table to first available table not equal to sourceTable
      const candidate = allTables.find((t) => t !== sourceTable) || '';
      setTargetTable(candidate);
      setIsSubmitting(false);
    }
  }, [open, sourceTable, allTables]);

  const handleSetQty = (idx: number, delta: number, maxQty: number) => {
    setSelectedQtys((prev) => {
      const current = prev[idx] || 0;
      const next = Math.max(0, Math.min(maxQty, current + delta));
      return { ...prev, [idx]: next };
    });
  };

  const handleSelectAll = () => {
    const next: Record<number, number> = {};
    sourceItems.forEach((item, idx) => {
      next[idx] = item.qty;
    });
    setSelectedQtys(next);
  };

  const handleClearSelection = () => {
    setSelectedQtys({});
  };

  const totalTransferredItemsCount = Object.values(selectedQtys).reduce((a, b) => a + b, 0);
  // R-I34: the transferred value is the real line total (price + modifiers)
  // for the selected quantity — qty x price alone drops the modifiers.
  const totalTransferredValue = sourceItems.reduce((sum, item, idx) => {
    const qty = selectedQtys[idx] || 0;
    return sum + calcCartLineTotal({ ...item, qty });
  }, 0);

  const handleSubmit = async () => {
    if (!targetTable || targetTable === sourceTable) {
      toast.warning('يرجى اختيار طاولة وجهة صالحة لنقل الأصناف إليها');
      return;
    }

    if (totalTransferredItemsCount <= 0) {
      toast.warning('يرجى تحديد كمية صنف واحد على الأقل لنقله');
      return;
    }

    const itemsToTransfer: TransferableCartItem[] = [];
    sourceItems.forEach((item, idx) => {
      const qty = selectedQtys[idx] || 0;
      if (qty > 0) {
        itemsToTransfer.push({
          ...item,
          qty,
        });
      }
    });

    setIsSubmitting(true);
    try {
      await onConfirmTransfer(targetTable, itemsToTransfer);
      onClose();
    } catch {
      toast.error('تعذر إتمام عملية نقل الأصناف');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      ariaLabel={__t('pos.pos_workspace.pos_transfer_item_modal.s0', __t('pos.pos_workspace.pos_transfer_item_modal.s0', "نقل أصناف فردية بين الطاولات"))}
      width="min(680px, 96vw)"
      zIndex={92}
    >
      <div style={{ padding: '18px 22px', direction: 'rtl', fontFamily: 'inherit' }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid #e2e8f0',
            paddingBottom: '12px',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '4px', height: '18px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
              <h3 className="no-pseudo-bar" style={{ margin: 0, fontSize: '16px', fontWeight: 900, color: '#0f172a' }}>
                {__t('pos.pos_workspace.pos_transfer_item_modal.s1', __t('pos.pos_workspace.pos_transfer_item_modal.s1', "نقل أصناف محددة بين الطاولات"))}
              </h3>
            </div>
            <p style={{ margin: '3px 0 0', fontSize: '11.5px', color: '#64748b' }}>
              {__t('pos.pos_workspace.pos_transfer_item_modal.s2', __t('pos.pos_workspace.pos_transfer_item_modal.s2', "نقل جزء من الأصناف من طاولة ("))}{sourceTable}{__t('pos.pos_workspace.pos_transfer_item_modal.s3', __t('pos.pos_workspace.pos_transfer_item_modal.s3', ") إلى طاولة أخرى دون ترحيل كامل الفاتورة"))}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '6px',
              color: '#64748b',
            }}
          >
            <XIcon size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Target Table Selector */}
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              padding: '12px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>
                {__t('pos.pos_workspace.pos_transfer_item_modal.s4', __t('pos.pos_workspace.pos_transfer_item_modal.s4', "طاولة المصدر:"))}
              </span>
              <span
                style={{
                  background: '#fee2e2',
                  color: '#991b1b',
                  padding: '3px 10px',
                  borderRadius: '6px',
                  fontWeight: 900,
                  fontSize: '12px',
                }}
              >
                {__t('pos.pos_workspace.pos_transfer_item_modal.s5', __t('pos.pos_workspace.pos_transfer_item_modal.s5', "طاولة"))} {sourceTable}
              </span>
              <ArrowLeftIcon size={16} color="#64748b" />
              <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>
                {__t('pos.pos_workspace.pos_transfer_item_modal.s6', __t('pos.pos_workspace.pos_transfer_item_modal.s6', "طاولة الوجهة:"))}
              </span>
              <select
                value={targetTable}
                onChange={(e) => setTargetTable(e.target.value)}
                style={{
                  height: '34px',
                  borderRadius: '6px',
                  border: '1.5px solid #170e5e',
                  padding: '0 10px',
                  fontSize: '12.5px',
                  fontWeight: 800,
                  color: '#170e5e',
                  background: '#ffffff',
                  cursor: 'pointer',
                }}
              >
                <option value="">{__t('pos.pos_workspace.pos_transfer_item_modal.s7', __t('pos.pos_workspace.pos_transfer_item_modal.s7', "-- اختر طاولة الوجهة --"))}</option>
                {allTables
                  .filter((t) => t !== sourceTable)
                  .map((t) => {
                    const isOccupied = occupiedTables.includes(t);
                    return (
                      <option key={t} value={t}>
                        {__t('pos.pos_workspace.pos_transfer_item_modal.s8', __t('pos.pos_workspace.pos_transfer_item_modal.s8', "طاولة"))} {t} {isOccupied ? __t('pos.pos_workspace.pos_transfer_item_modal.s9', __t('pos.pos_workspace.pos_transfer_item_modal.s9', "(مشغولة - سيتم الإلحاق)")) : __t('pos.pos_workspace.pos_transfer_item_modal.s10', __t('pos.pos_workspace.pos_transfer_item_modal.s10', "(شاغرة)"))}
                      </option>
                    );
                  })}
              </select>
            </div>

            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                onClick={handleSelectAll}
                style={{
                  background: '#eef2ff',
                  color: '#170e5e',
                  border: '1px solid #c7d2fe',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {__t('pos.pos_workspace.pos_transfer_item_modal.s11', __t('pos.pos_workspace.pos_transfer_item_modal.s11', "تحديد الكل"))}
              </button>
              <button
                type="button"
                onClick={handleClearSelection}
                style={{
                  background: '#ffffff',
                  color: '#64748b',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {__t('pos.pos_workspace.pos_transfer_item_modal.s12', __t('pos.pos_workspace.pos_transfer_item_modal.s12', "إلغاء التحديد"))}
              </button>
            </div>
          </div>

          {/* Items List */}
          <div
            style={{
              maxHeight: '290px',
              overflowY: 'auto',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              background: '#ffffff',
            }}
          >
            {sourceItems.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                {__t('pos.pos_workspace.pos_transfer_item_modal.s13', __t('pos.pos_workspace.pos_transfer_item_modal.s13', "لا توجد أصناف في هذه الطاولة للنقل"))}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11.5px', color: '#475569' }}>
                    <th style={{ padding: '8px 12px', fontWeight: 800 }}>{__t('pos.pos_workspace.pos_transfer_item_modal.s14', __t('pos.pos_workspace.pos_transfer_item_modal.s14', "الصنف"))}</th>
                    <th style={{ padding: '8px 10px', fontWeight: 800 }}>{__t('pos.pos_workspace.pos_transfer_item_modal.s15', __t('pos.pos_workspace.pos_transfer_item_modal.s15', "السعر"))}</th>
                    <th style={{ padding: '8px 10px', fontWeight: 800, textAlign: 'center' }}>{__t('pos.pos_workspace.pos_transfer_item_modal.s16', __t('pos.pos_workspace.pos_transfer_item_modal.s16', "الكمية الحالية"))}</th>
                    <th style={{ padding: '8px 12px', fontWeight: 800, textAlign: 'center', width: '150px' }}>{__t('pos.pos_workspace.pos_transfer_item_modal.s17', __t('pos.pos_workspace.pos_transfer_item_modal.s17', "الكمية المنقولة"))}</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceItems.map((item, idx) => {
                    const currentTransferQty = selectedQtys[idx] || 0;
                    const isSelected = currentTransferQty > 0;

                    return (
                      <tr
                        key={idx}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          background: isSelected ? '#f0fdf4' : 'transparent',
                          transition: 'background 0.15s ease',
                        }}
                      >
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ fontWeight: 800, fontSize: '12.5px', color: '#0f172a' }}>
                            {item.name}
                          </div>
                          {item.modifiers && item.modifiers.length > 0 && (
                            <div style={{ fontSize: '10.5px', color: '#b45309', marginTop: '2px' }}>
                              {item.modifiers.map((m: any) => m.name).join(' + ')}
                            </div>
                          )}
                          {item.notes && (
                            <div style={{ fontSize: '10.5px', color: '#64748b', fontStyle: 'italic' }}>
                              {item.notes}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '10px 10px', fontSize: '12px', fontWeight: 700, color: '#334155' }}>
                          {formatCurrency(item.price)}
                        </td>
                        <td style={{ padding: '10px 10px', textAlign: 'center', fontSize: '12.5px', fontWeight: 800, color: '#64748b' }}>
                          {item.qty}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          {/* Strict RTL Stepper Standard: [+] (الكمية) [-] */}
                          <div
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              border: `1.5px solid ${isSelected ? '#16a34a' : '#cbd5e1'}`,
                              borderRadius: '7px',
                              overflow: 'hidden',
                              background: '#ffffff',
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => handleSetQty(idx, 1, item.qty)}
                              disabled={currentTransferQty >= item.qty}
                              style={{
                                width: '28px',
                                height: '28px',
                                border: 'none',
                                background: currentTransferQty >= item.qty ? '#f1f5f9' : '#170e5e',
                                color: currentTransferQty >= item.qty ? '#94a3b8' : '#ffffff',
                                cursor: currentTransferQty >= item.qty ? 'default' : 'pointer',
                                fontWeight: 900,
                                fontSize: '15px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              +
                            </button>
                            <span
                              style={{
                                minWidth: '34px',
                                textAlign: 'center',
                                fontSize: '13px',
                                fontWeight: 900,
                                color: isSelected ? '#16a34a' : '#334155',
                              }}
                            >
                              {currentTransferQty}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleSetQty(idx, -1, item.qty)}
                              disabled={currentTransferQty <= 0}
                              style={{
                                width: '28px',
                                height: '28px',
                                border: 'none',
                                background: currentTransferQty <= 0 ? '#f1f5f9' : '#f8fafc',
                                color: currentTransferQty <= 0 ? '#94a3b8' : '#334155',
                                cursor: currentTransferQty <= 0 ? 'default' : 'pointer',
                                fontWeight: 900,
                                fontSize: '15px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              -
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Transfer Summary */}
          {totalTransferredItemsCount > 0 && (
            <div
              style={{
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: '8px',
                padding: '10px 14px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '12.5px',
                color: '#166534',
                fontWeight: 800,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckCircleIcon size={16} color="#16a34a" />
                <span>
                  {__t('pos.pos_workspace.pos_transfer_item_modal.s18', __t('pos.pos_workspace.pos_transfer_item_modal.s18', "تم تحديد"))} {totalTransferredItemsCount} {__t('pos.pos_workspace.pos_transfer_item_modal.s19', __t('pos.pos_workspace.pos_transfer_item_modal.s19', "قطعة للنقل إلى طاولة ("))}{targetTable || __t('pos.pos_workspace.pos_transfer_item_modal.s20', __t('pos.pos_workspace.pos_transfer_item_modal.s20', "؟"))})
                </span>
              </div>
              <div>
                {__t('pos.pos_workspace.pos_transfer_item_modal.s21', __t('pos.pos_workspace.pos_transfer_item_modal.s21', "إجمالي القيمة المنقولة:"))} <strong>{formatCurrency(totalTransferredValue)}</strong>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px',
            borderTop: '1px solid #e2e8f0',
            paddingTop: '14px',
            marginTop: '16px',
          }}
        >
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={isSubmitting}
            style={{ minHeight: '36px', height: '36px', padding: '0 16px', fontSize: '12px' }}
          >
            {__t('pos.pos_workspace.pos_transfer_item_modal.s22', __t('pos.pos_workspace.pos_transfer_item_modal.s22', "إلغاء"))}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleSubmit}
            disabled={isSubmitting || totalTransferredItemsCount <= 0 || !targetTable}
            style={{
              minHeight: '36px',
              height: '36px',
              padding: '0 20px',
              fontSize: '12px',
              fontWeight: 800,
              background: '#170e5e',
            }}
          >
            {isSubmitting ? __t('pos.pos_workspace.pos_transfer_item_modal.s23', __t('pos.pos_workspace.pos_transfer_item_modal.s23', "جارٍ النقل...")) : `تأكيد نقل الأصناف (${totalTransferredItemsCount})`}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}
