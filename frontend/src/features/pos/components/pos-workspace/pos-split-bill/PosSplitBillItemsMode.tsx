// Mode 1 of the split-bill modal — split by items: the bills grid with
// per-item transfer and fractional-split actions, per-bill pay actions,
// and the bottom bulk action plus distributed-sum summary. Pure move;
// the modal keeps all state and mounts this component with the bills
// and their handlers.

import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { formatCurrency } from '@/lib/format';
import { PlusIcon, TrashIcon } from '@/shared/components/icons/AppIcons';
import { calcCartLineDiscount, calcCartLineNetTotal, calcModifiersTotal } from '@/features/pos/lib/pos-modifier-totals';
import type { SplitBill, SplitBillAmounts } from '../pos-split-bill.helpers';

interface PosSplitBillItemsModeProps {
  bills: SplitBill[];
  billAmounts: SplitBillAmounts[];
  handleAddBill: () => void;
  handleRemoveBill: (billId: string) => void;
  handleMoveAllItems: (fromBillId: string, toBillId: string) => void;
  handleMoveItem: (fromBillId: string, toBillId: string, itemLineKey: string, moveQty?: number) => void;
  handleFractionalSplit: (fromBillId: string, itemLineKey: string, partsCount: 2 | 3 | 4) => void;
  isProcessingPayment: boolean;
  handlePayBill: (billId: string, paymentChannel: 'cash' | 'card' | 'transfer') => Promise<void>;
  handleSaveAsSeparateHeldChecks: () => Promise<void>;
  totalSplitSum: number;
  totalAmount: number;
  splitSumMismatch: boolean;
  onClose: () => void;
}

export function PosSplitBillItemsMode({
  bills,
  billAmounts,
  handleAddBill,
  handleRemoveBill,
  handleMoveAllItems,
  handleMoveItem,
  handleFractionalSplit,
  isProcessingPayment,
  handlePayBill,
  handleSaveAsSeparateHeldChecks,
  totalSplitSum,
  totalAmount,
  splitSumMismatch,
  onClose,
}: PosSplitBillItemsModeProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* MODE 1: SPLIT BY ITEMS */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <span style={{ fontSize: '12.5px', color: '#475569', fontWeight: 600 }}>
            {t('pos.pos_workspace.pos_split_bill_modal.s9', "وزّع الأصناف والكميات على الشيكات المستقلة بالضغط على أزرار النقل، ثم حصّل كل شيك على حدة:")}
          </span>
          <Button
            type="button"
            variant="secondary"
            onClick={handleAddBill}
            style={{ fontSize: '12px', minHeight: '30px', padding: '0 12px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <PlusIcon size={14} />
            <span>{t('pos.pos_workspace.pos_split_bill_modal.s10', "إضافة شيك إضافي")}</span>
          </Button>
        </div>

        {/* Bills Columns Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(Math.max(bills.length, 1), 3)}, minmax(0, 1fr))`,
            gap: '12px',
            maxHeight: '400px',
            overflowY: 'auto',
            paddingBottom: '4px',
          }}
        >
          {bills.map((bill, _billIdx) => {
            // INV-REST-SPLIT-REAL-TOTALS (B10): the column shows what
            // the guest actually pays (lines + allocated extras).
            const billTotal = billAmounts[_billIdx]?.total ?? 0;
            const otherBills = bills.filter((b) => b.id !== bill.id && !b.isPaid);

            return (
              <div
                key={bill.id}
                style={{
                  border: bill.isPaid ? '1.5px solid #bbf7d0' : '1px solid #e2e8f0',
                  borderRadius: '10px',
                  background: bill.isPaid ? '#f0fdf4' : '#ffffff',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  minHeight: '300px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                }}
              >
                <div>
                  {/* Bill Title & Badges */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', paddingBottom: '8px', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <strong style={{ fontSize: '13.5px', color: bill.isPaid ? '#166534' : '#0f172a' }}>
                        {bill.name}
                      </strong>
                      <span style={{ fontSize: '11px', background: '#f1f5f9', color: '#475569', padding: '1px 6px', borderRadius: '10px', fontWeight: 600 }}>
                        {bill.items.reduce((s, i) => s + i.qty, 0)} {t('pos.pos_workspace.pos_split_bill_modal.s11', "قطعة")}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {bill.isPaid ? (
                        <span style={{ fontSize: '11px', background: '#16a34a', color: '#fff', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
                          {t('pos.pos_workspace.pos_split_bill_modal.s12', "تم السداد (")}{bill.paymentMethod === 'card' ? t('pos.pos_workspace.pos_split_bill_modal.s13', "شبكة") : bill.paymentMethod === 'transfer' ? t('pos.pos_workspace.pos_split_bill_modal.s43', "تحويل") : t('pos.pos_workspace.pos_split_bill_modal.s14', "نقد")})
                        </span>
                      ) : (
                        <span style={{ fontSize: '13px', fontWeight: 800, color: '#170e5e' }}>
                          {formatCurrency(billTotal)}
                        </span>
                      )}

                      {/* Option to delete extra bill if empty & unpaid */}
                      {!bill.isPaid && bill.items.length === 0 && bills.length > 2 && bill.id !== 'main' && (
                        <button
                          type="button"
                          onClick={() => handleRemoveBill(bill.id)}
                          title={t('pos.pos_workspace.pos_split_bill_modal.s15', "حذف هذا الشيك الفارغ")}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#ef4444',
                            cursor: 'pointer',
                            padding: '2px 4px',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          <TrashIcon size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Quick action: Move all items if available */}
                  {!bill.isPaid && bill.items.length > 0 && otherBills.length === 1 && (
                    <div style={{ marginBottom: '8px', textAlign: 'start' }}>
                      <button
                        type="button"
                        onClick={() => handleMoveAllItems(bill.id, otherBills[0].id)}
                        style={{
                          background: '#f8fafc',
                          border: '1px solid #cbd5e1',
                          borderRadius: '4px',
                          padding: '3px 8px',
                          fontSize: '11px',
                          fontWeight: 700,
                          color: '#475569',
                          cursor: 'pointer',
                          width: '100%',
                        }}
                      >
                        {t('pos.pos_workspace.pos_split_bill_modal.s16', "نقل جميع الأصناف إلى")} {otherBills[0].name}
                      </button>
                    </div>
                  )}

                  {/* Items in this bill */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '220px', overflowY: 'auto' }}>
                    {bill.items.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '32px 12px', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1', color: '#94a3b8', fontSize: '12px' }}>
                        <p style={{ margin: '0 0 4px 0', fontWeight: 700, color: '#64748b' }}>{t('pos.pos_workspace.pos_split_bill_modal.s17', "هذا الشيك فارغ")}</p>
                        <span>{t('pos.pos_workspace.pos_split_bill_modal.s18', "اضغط على أزرار النقل بجوار الأصناف في الشيكات الأخرى لنقلها هنا")}</span>
                      </div>
                    ) : (
                      bill.items.map((item) => (
                        <div
                          key={item.lineKey}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                            padding: '8px 10px',
                            borderRadius: '6px',
                            background: bill.isPaid ? '#ffffff' : '#f8fafc',
                            border: '1px solid #e2e8f0',
                            fontSize: '12px',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ fontWeight: 700, color: '#0f172a', flex: 1, wordBreak: 'break-word' }}>
                              {item.name}
                            </div>
                            <div style={{ fontWeight: 800, color: '#170e5e', whiteSpace: 'nowrap', marginInlineStart: '6px' }}>
                              {formatCurrency(calcCartLineNetTotal(item))}
                            </div>
                          </div>

                          {/* INV-POS-LINE-DISCOUNT: the line's own
                           * discount, so the visible bill items sum
                           * to the bill subtotal. */}
                          {calcCartLineDiscount(item) > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                              <span style={{ color: '#065f46', fontSize: '11px', fontWeight: 700 }}>
                                خصم الصنف: - {formatCurrency(calcCartLineDiscount(item))}
                              </span>
                            </div>
                          )}

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: '#64748b', fontSize: '11px' }}>
                              {item.qty} × {formatCurrency(Number(item.price || 0) + calcModifiersTotal(item.modifiers))}
                            </span>

                            {/* Item Transfer Buttons */}
                            {!bill.isPaid && otherBills.length > 0 && (
                              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                {otherBills.map((target) => (
                                  <div key={target.id} style={{ display: 'flex', gap: '2px' }}>
                                    {item.qty > 1 ? (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => handleMoveItem(bill.id, target.id, item.lineKey, 1)}
                                          title={`نقل قطعة واحدة إلى ${target.name}`}
                                          style={{
                                            background: '#ffffff',
                                            border: '1px solid #cbd5e1',
                                            borderRadius: '4px',
                                            padding: '2px 6px',
                                            fontSize: '10.5px',
                                            fontWeight: 700,
                                            color: '#170e5e',
                                            cursor: 'pointer',
                                          }}
                                        >
                                          {t('pos.pos_workspace.pos_split_bill_modal.s19', "نقل 1")} {otherBills.length > 1 ? `← #${target.name.replace(t('pos.pos_workspace.pos_split_bill_modal.s20', "الشيك "), '')}` : `← ${target.name}`}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleMoveItem(bill.id, target.id, item.lineKey, item.qty)}
                                          title={`نقل كل الكمية (${item.qty}) إلى ${target.name}`}
                                          style={{
                                            background: '#f1f5f9',
                                            border: '1px solid #cbd5e1',
                                            borderRadius: '4px',
                                            padding: '2px 6px',
                                            fontSize: '10.5px',
                                            fontWeight: 700,
                                            color: '#334155',
                                            cursor: 'pointer',
                                          }}
                                        >
                                          {t('pos.pos_workspace.pos_split_bill_modal.s21', "الكل (")}{item.qty})
                                        </button>
                                      </>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => handleMoveItem(bill.id, target.id, item.lineKey, 1)}
                                        title={`نقل إلى ${target.name}`}
                                        style={{
                                          background: '#ffffff',
                                          border: '1px solid #cbd5e1',
                                          borderRadius: '4px',
                                          padding: '2px 8px',
                                          fontSize: '10.5px',
                                          fontWeight: 700,
                                          color: '#170e5e',
                                          cursor: 'pointer',
                                        }}
                                      >
                                        {t('pos.pos_workspace.pos_split_bill_modal.s22', "نقل")} {otherBills.length > 1 ? `← #${target.name.replace(t('pos.pos_workspace.pos_split_bill_modal.s23', "الشيك "), '')}` : `← ${target.name}`}
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Fractional Item Splitting */}
                            {!bill.isPaid && (
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px', marginTop: '4px' }}>
                                <span style={{ fontSize: '9.5px', color: '#64748b' }}>{t('pos.pos_workspace.pos_split_bill_modal.s24', "تجزئة الصنف:")}</span>
                                <button
                                  type="button"
                                  onClick={() => handleFractionalSplit(bill.id, item.lineKey, 2)}
                                  title={t('pos.pos_workspace.pos_split_bill_modal.s25', "تجزئة هذا الصنف إلى نصفين (50% / 50%) وتوزيعهما على شيكين")}
                                  style={{
                                    background: '#eff6ff',
                                    border: '1px solid #bfdbfe',
                                    borderRadius: '3px',
                                    padding: '1px 5px',
                                    fontSize: '10px',
                                    fontWeight: 800,
                                    color: '#1d4ed8',
                                    cursor: 'pointer',
                                  }}
                                >
                                  {t('pos.pos_workspace.pos_split_bill_modal.s26', "½ نصفين")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleFractionalSplit(bill.id, item.lineKey, 3)}
                                  title={t('pos.pos_workspace.pos_split_bill_modal.s27', "تجزئة هذا الصنف إلى 3 أثلاث متساوية وتوزيعها على الشيكات")}
                                  style={{
                                    background: '#eff6ff',
                                    border: '1px solid #bfdbfe',
                                    borderRadius: '3px',
                                    padding: '1px 5px',
                                    fontSize: '10px',
                                    fontWeight: 800,
                                    color: '#1d4ed8',
                                    cursor: 'pointer',
                                  }}
                                >
                                  {t('pos.pos_workspace.pos_split_bill_modal.s28', "⅓ أثلاث")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleFractionalSplit(bill.id, item.lineKey, 4)}
                                  title={t('pos.pos_workspace.pos_split_bill_modal.s29', "تجزئة هذا الصنف إلى 4 أرباع متساوية وتوزيعها على الشيكات")}
                                  style={{
                                    background: '#eff6ff',
                                    border: '1px solid #bfdbfe',
                                    borderRadius: '3px',
                                    padding: '1px 5px',
                                    fontSize: '10px',
                                    fontWeight: 800,
                                    color: '#1d4ed8',
                                    cursor: 'pointer',
                                  }}
                                >
                                  {t('pos.pos_workspace.pos_split_bill_modal.s30', "¼ أرباع")}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Bill Actions */}
                {!bill.isPaid && bill.items.length > 0 && (
                  <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '10px', marginTop: '10px' }}>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <Button
                        type="button"
                        variant="primary"
                        disabled={isProcessingPayment}
                        onClick={() => void handlePayBill(bill.id, 'cash')}
                        style={{ flex: 1, minHeight: '32px', fontSize: '12px', padding: '0 4px' }}
                      >
                        {t('pos.pos_workspace.pos_split_bill_modal.s31', "تحصيل نقد")}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={isProcessingPayment}
                        onClick={() => void handlePayBill(bill.id, 'card')}
                        style={{ flex: 1, minHeight: '32px', fontSize: '12px', padding: '0 4px', borderColor: '#170e5e', color: '#170e5e' }}
                      >
                        {t('pos.pos_workspace.pos_split_bill_modal.s32', "تحصيل شبكة")}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={isProcessingPayment}
                        onClick={() => void handlePayBill(bill.id, 'transfer')}
                        style={{ flex: 1, minHeight: '32px', fontSize: '12px', padding: '0 4px', borderColor: '#0369a1', color: '#0369a1' }}
                      >
                        {t('pos.pos_workspace.pos_split_bill_modal.s53', "تحصيل تحويل")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Bottom bulk action & Summary */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #e2e8f0', paddingTop: '12px', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void handleSaveAsSeparateHeldChecks()}
              disabled={isProcessingPayment || bills.filter((b) => !b.isPaid && b.items.length > 0).length < 2}
              style={{ fontSize: '12px' }}
            >
              {t('pos.pos_workspace.pos_split_bill_modal.s33', "حفظ الشيكات كطلبات معلقة منفصلة في الصالة")}
            </Button>

            <span style={{ fontSize: '12px', color: '#64748b' }}>
              {t('pos.pos_workspace.pos_split_bill_modal.s34', "المجموع الموزع:")} <strong style={{ color: '#0f172a' }}>{formatCurrency(totalSplitSum)}</strong> {t('pos.pos_workspace.pos_split_bill_modal.s35', "من أصل")} <strong style={{ color: '#170e5e' }}>{formatCurrency(totalAmount)}</strong>
            </span>
            {splitSumMismatch && (
              <span style={{ fontSize: '12px', color: '#dc2626', fontWeight: 800 }}>
                {t('pos.pos_workspace.pos_split_bill_modal.s50', "تحذير: المجموع الموزع لا يطابق إجمالي الطلب — راجع توزيع الأصناف قبل التحصيل.")}
              </span>
            )}
          </div>

          <Button type="button" variant="secondary" onClick={onClose} disabled={isProcessingPayment}>
            {t('pos.pos_workspace.pos_split_bill_modal.s36', "إغلاق")}
          </Button>
        </div>
      </div>
    </>
  );
}
