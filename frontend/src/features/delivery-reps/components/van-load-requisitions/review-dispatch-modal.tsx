import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { CustomSelect } from '@/shared/ui/custom-select';
import {
  MinusIcon,
  PlusIcon,
  PrinterIcon,
  Trash2Icon,
  TruckIcon,
  XIcon,
} from '@/shared/components/icons/AppIcons';
import type { VanLoadRequisitionRecord, DriverAvailableProduct, DriverWarehouse } from '../../api/van-sales.api';
import type { AdminReviewLine } from './van-load-requisitions-admin-types';

export interface ReviewDispatchModalProps {
  selectedReq: VanLoadRequisitionRecord | null;
  reviewLines: AdminReviewLine[];
  onUpdateLineQty: (productId: number, newQty: number) => void;
  onUpdateLineCartonsPieces: (productId: number, cartons: number, pieces: number) => void;
  onRemoveLine: (productId: number) => void;
  onAddProduct: (prod: DriverAvailableProduct) => void;
  onSaveReviewed: () => void;
  onDispatch: (req: VanLoadRequisitionRecord) => Promise<void>;
  onReject: (req: VanLoadRequisitionRecord) => void;
  onDelete: (req: VanLoadRequisitionRecord) => Promise<void>;
  onPrint: (req: VanLoadRequisitionRecord, format?: 'a4' | 'receipt') => void;
  warehouseProducts: DriverAvailableProduct[];
  productSearch: string;
  onProductSearchChange: (value: string) => void;
  isAddProductOpen: boolean;
  onAddProductOpenChange: (open: boolean) => void;
  adminNotes: string;
  onAdminNotesChange: (value: string) => void;
  adminWarehouses: DriverWarehouse[];
  activeWarehouseId: number | undefined;
  onSourceWarehouseChange: (value: number) => void;
  isReviewPending: boolean;
  isDispatchPending: boolean;
  isDeletePending: boolean;
  onClose: () => void;
}

export function ReviewDispatchModal(props: ReviewDispatchModalProps) {
  const { t } = useTranslation();
  const {
    selectedReq,
    reviewLines,
    onUpdateLineQty,
    onUpdateLineCartonsPieces,
    onRemoveLine,
    onAddProduct,
    onSaveReviewed,
    onDispatch,
    onReject,
    onDelete,
    onPrint,
    warehouseProducts,
    productSearch,
    onProductSearchChange,
    isAddProductOpen,
    onAddProductOpenChange,
    adminNotes,
    onAdminNotesChange,
    adminWarehouses,
    activeWarehouseId,
    onSourceWarehouseChange,
    isReviewPending,
    isDispatchPending,
    isDeletePending,
    onClose,
  } = props;
  return (
    <>
      <style>{`
        input.no-spin-arrows::-webkit-outer-spin-button,
        input.no-spin-arrows::-webkit-inner-spin-button {
          -webkit-appearance: none !important;
          margin: 0 !important;
        }
        input.no-spin-arrows {
          -moz-appearance: textfield !important;
          appearance: textfield !important;
        }
      `}</style>
      {/* Review & Dispatch Modal */}
      {selectedReq && (
        <StandardDialog
          open={Boolean(selectedReq)}
          onClose={() => onClose()}
          title={`مراجعة إذن تحميل البضاعة #${selectedReq.docNo}`}
          subtitle={`المندوب: ${selectedReq.repName} • المستودع المصدر: ${selectedReq.sourceWarehouseName}`}
          width="min(1080px, 96vw)"
          maxWidth="1080px"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }} dir="rtl">
            {/* Header summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', backgroundColor: '#f8fafc', padding: '12px 16px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '2px' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s51', "المندوب والسائق:")}</span>
                <strong style={{ fontSize: '13px', color: '#0f172a' }}>{selectedReq.repName}</strong>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '2px' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s52', "المركبة المسندة:")}</span>
                <strong style={{ fontSize: '13px', color: '#0f172a' }}>{selectedReq.vehiclePlate || '—'}</strong>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '2px' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s53', "مستودع الصرف:")}</span>
                {selectedReq.status === 'pending' ? (
                  <CustomSelect
                    value={String(activeWarehouseId || '')}
                    onChange={(val) => onSourceWarehouseChange(Number(val))}
                    options={adminWarehouses.map((w) => ({
                      value: String(w.id),
                      label: w.name,
                    }))}
                    placeholder={t('delivery_reps.van_load_requisitions_admin_tab.s54', "اختر مستودع الصرف...")}
                  />
                ) : (
                  <strong style={{ fontSize: '13px', color: '#0369a1' }}>{selectedReq.sourceWarehouseName}</strong>
                )}
              </div>
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '2px' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s55', "حالة الإذن:")}</span>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 800,
                    backgroundColor: selectedReq.status === 'dispatched' ? '#ecfdf5' : selectedReq.status === 'rejected' ? '#fef2f2' : '#fef3c7',
                    color: selectedReq.status === 'dispatched' ? '#15803d' : selectedReq.status === 'rejected' ? '#b91c1c' : '#b45309',
                    border: `1px solid ${selectedReq.status === 'dispatched' ? '#bbf7d0' : selectedReq.status === 'rejected' ? '#fecaca' : '#fde68a'}`,
                  }}
                >
                  {selectedReq.status === 'dispatched' ? t('delivery_reps.van_load_requisitions_admin_tab.s56', "تم الصرف وبدء الرحلة") : selectedReq.status === 'rejected' ? t('delivery_reps.van_load_requisitions_admin_tab.s57', "مرفوض") : t('delivery_reps.van_load_requisitions_admin_tab.s58', "بانتظار الصرف")}
                </span>
              </div>
            </div>

            {/* Items Table with warehouse availability check */}
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#334155' }}>
                  {t('delivery_reps.van_load_requisitions_admin_tab.s59', "الأصناف ومطابقة رصيد المستودع (")}{reviewLines.length} {t('delivery_reps.van_load_requisitions_admin_tab.s60', "أصناف)")}
                </span>
                {selectedReq.status === 'pending' ? (
                  <span style={{ fontSize: '11px', color: '#64748b' }}>
                    {t('delivery_reps.van_load_requisitions_admin_tab.s61', "يمكنك تعديل الكمية المعتمدة، إضافة أصناف جديدة، أو استبعاد صنف")}
                  </span>
                ) : (
                  <span style={{ fontSize: '11px', color: '#15803d', fontWeight: 700 }}>
                    {t('delivery_reps.van_load_requisitions_admin_tab.s62', "تم اعتماد وصرف البضاعة وتحميلها لسيارة المندوب")}
                  </span>
                )}
              </div>

              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', maxHeight: '380px', overflowY: 'auto' }}>
                <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12.5px' }}>
                  <colgroup>
                    <col style={{ width: selectedReq.status === 'pending' ? '30%' : '36%' }} />
                    <col style={{ width: selectedReq.status === 'pending' ? '18%' : '20%' }} />
                    <col style={{ width: selectedReq.status === 'pending' ? '18%' : '20%' }} />
                    <col style={{ width: selectedReq.status === 'pending' ? '28%' : '24%' }} />
                    {selectedReq.status === 'pending' && <col style={{ width: '6%' }} />}
                  </colgroup>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', position: 'sticky', top: 0, zIndex: 2 }}>
                      <th style={{ padding: '9px 12px', fontWeight: 700 }}>{t('delivery_reps.van_load_requisitions_admin_tab.s63', "الصنف والباركود")}</th>
                      <th style={{ padding: '9px 12px', fontWeight: 700, textAlign: 'center' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s64', "طلب المندوب")}</th>
                      <th style={{ padding: '9px 12px', fontWeight: 700, textAlign: 'center' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s65', "المتاح بالمستودع")}</th>
                      <th style={{ padding: '9px 12px', fontWeight: 700, textAlign: 'center' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s66', "المعتمد للصرف")}</th>
                      {selectedReq.status === 'pending' && (
                        <th style={{ padding: '9px 12px', textAlign: 'center' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s67', "حذف")}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {reviewLines.length === 0 ? (
                      <tr>
                        <td colSpan={selectedReq.status === 'pending' ? 5 : 4} style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                          {t('delivery_reps.van_load_requisitions_admin_tab.s68', "لا توجد أصناف في هذا الإذن. يمكنك إضافة أصناف بالأسفل.")}
                        </td>
                      </tr>
                    ) : (
                      reviewLines.map((it) => {
                        const avail = it.warehouseAvailQty ?? 0;
                        const isShortage = avail < it.approvedQty;
                        const isCarton = Boolean(it.packagingUnit && it.packagingUnit.multiplier > 1);
                        const mult = it.packagingUnit?.multiplier || 1;

                        return (
                          <tr key={it.productId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>
                              <div style={{ wordBreak: 'break-word', overflowWrap: 'break-word', whiteSpace: 'normal', lineHeight: 1.45 }}>
                                <span style={{ fontWeight: 700, color: '#0f172a' }}>{it.productName}</span>
                                {it.requestedQty === 0 && (
                                  <span
                                    style={{
                                      fontSize: '10px',
                                      fontWeight: 700,
                                      background: '#e0e7ff',
                                      color: '#3730a3',
                                      padding: '1px 6px',
                                      borderRadius: '4px',
                                      marginInlineStart: '6px',
                                      display: 'inline-block',
                                    }}
                                  >
                                    {t('delivery_reps.van_load_requisitions_admin_tab.s69', "إضافة المشرف")}
                                  </span>
                                )}
                              </div>
                              {it.barcode && (
                                <span style={{ fontSize: '10.5px', color: '#64748b', fontFamily: 'monospace', display: 'block', marginTop: '2px' }}>
                                  {t('delivery_reps.van_load_requisitions_admin_tab.s70', "باركود:")} {it.barcode}
                                </span>
                              )}
                              {isCarton && (
                                <span style={{ fontSize: '10px', color: '#170e5e', fontWeight: 600, display: 'inline-block', marginTop: '2px', backgroundColor: '#eef2ff', padding: '1px 5px', borderRadius: '4px' }}>
                                  {t('delivery_reps.van_load_requisitions_admin_tab.s71', "الكرتونة =")} {mult} {it.unit || t('delivery_reps.van_load_requisitions_admin_tab.s72', "قطعة")}
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 800, fontSize: '13px', verticalAlign: 'middle' }}>
                              {it.requestedQty > 0 ? (
                                <div>
                                  <div>
                                    <span>{it.requestedQty}</span> <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>{it.unit || t('delivery_reps.van_load_requisitions_admin_tab.s73', "قطعة")}</span>
                                  </div>
                                  {it.requestedPackingText ? (
                                    <div style={{ fontSize: '10.5px', color: '#170e5e', fontWeight: 700, marginTop: '2px' }}>
                                      {it.requestedPackingText}
                                    </div>
                                  ) : isCarton && it.packagingUnit ? (
                                    <div style={{ fontSize: '10.5px', color: '#170e5e', fontWeight: 700, marginTop: '2px' }}>
                                      {Math.floor(it.requestedQty / mult)} {it.packagingUnit.name}
                                      {it.requestedQty % mult > 0 ? ` + ${it.requestedQty % mult} ${it.unit || t('delivery_reps.van_load_requisitions_admin_tab.s74', "قطعة")}` : ''}
                                    </div>
                                  ) : null}
                                </div>
                              ) : (
                                <span style={{ color: '#94a3b8' }}>—</span>
                              )}
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                              <span
                                style={{
                                  display: 'inline-block',
                                  padding: '3px 8px',
                                  borderRadius: '6px',
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  background: isShortage ? '#fef2f2' : '#f0fdf4',
                                  color: isShortage ? '#b91c1c' : '#15803d',
                                  border: `1px solid ${isShortage ? '#fca5a5' : '#bbf7d0'}`,
                                }}
                              >
                                {avail} {it.unit || t('delivery_reps.van_load_requisitions_admin_tab.s75', "قطعة")} {isShortage ? t('delivery_reps.van_load_requisitions_admin_tab.s76', "(عجز)") : t('delivery_reps.van_load_requisitions_admin_tab.s77', "(متوفر)")}
                              </span>
                              {isShortage && it.warehouseStocks && it.warehouseStocks.length > 0 && (
                                (() => {
                                  const other = it.warehouseStocks.find((w: any) => w.warehouseId !== activeWarehouseId && w.qty > 0);
                                  if (!other) return null;
                                  return (
                                    <div style={{ fontSize: '10px', color: '#0369a1', marginTop: '3px', fontWeight: 700 }}>
                                      {t('delivery_reps.van_load_requisitions_admin_tab.s78', "متوفر في")} {other.warehouseName}: {other.qty} {it.unit || t('delivery_reps.van_load_requisitions_admin_tab.s79', "قطعة")}
                                    </div>
                                  );
                                })()
                              )}
                              {isCarton && it.packagingUnit && (
                                <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px', fontWeight: 600 }}>
                                  {Math.floor(avail / mult)} {it.packagingUnit.name}
                                  {avail % mult > 0 ? ` + ${avail % mult} ${it.unit || t('delivery_reps.van_load_requisitions_admin_tab.s80', "قطعة")}` : ''}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                              {selectedReq.status === 'pending' ? (
                                isCarton ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                      {/* Cartons Stepper: + first (right in RTL), - last (left in RTL) */}
                                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                        <div
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            border: '1px solid #cbd5e1',
                                            borderRadius: '6px',
                                            backgroundColor: '#ffffff',
                                            overflow: 'hidden',
                                            height: '28px',
                                          }}
                                        >
                                          <button
                                            type="button"
                                            onClick={() => onUpdateLineCartonsPieces(it.productId, (it.approvedCartons || 0) + 1, it.approvedPieces || 0)}
                                            style={{
                                              width: '24px',
                                              height: '100%',
                                              border: 'none',
                                              backgroundColor: '#f8fafc',
                                              color: '#334155',
                                              cursor: 'pointer',
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              borderInlineEnd: '1px solid #e2e8f0',
                                            }}
                                            title={`زيادة ${it.packagingUnit?.name || t('delivery_reps.van_load_requisitions_admin_tab.s81', "كرتونة")}`}
                                          >
                                            <PlusIcon size={11} />
                                          </button>
                                          <input
                                            type="number"
                                            min="0"
                                            className="no-spin-arrows"
                                            value={it.approvedCartons ?? 0}
                                            onChange={(e) => {
                                              const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                                              onUpdateLineCartonsPieces(it.productId, val, it.approvedPieces || 0);
                                            }}
                                            style={{
                                              width: '36px',
                                              height: '100%',
                                              border: 'none',
                                              textAlign: 'center',
                                              fontSize: '12px',
                                              fontWeight: 800,
                                              color: '#0f172a',
                                              outline: 'none',
                                            }}
                                          />
                                          <button
                                            type="button"
                                            onClick={() => onUpdateLineCartonsPieces(it.productId, Math.max(0, (it.approvedCartons || 0) - 1), it.approvedPieces || 0)}
                                            disabled={(it.approvedCartons || 0) <= 0}
                                            style={{
                                              width: '24px',
                                              height: '100%',
                                              border: 'none',
                                              backgroundColor: '#f8fafc',
                                              color: '#334155',
                                              cursor: (it.approvedCartons || 0) <= 0 ? 'not-allowed' : 'pointer',
                                              opacity: (it.approvedCartons || 0) <= 0 ? 0.4 : 1,
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              borderInlineStart: '1px solid #e2e8f0',
                                            }}
                                            title={`إنقاص ${it.packagingUnit?.name || t('delivery_reps.van_load_requisitions_admin_tab.s82', "كرتونة")}`}
                                          >
                                            <MinusIcon size={11} />
                                          </button>
                                        </div>
                                        <span style={{ fontSize: '10.5px', fontWeight: 700, color: '#475569', whiteSpace: 'nowrap' }}>
                                          {it.packagingUnit?.name || t('delivery_reps.van_load_requisitions_admin_tab.s83', "كرتونة")}
                                        </span>
                                      </div>

                                      {/* Pieces Stepper: + first (right in RTL), - last (left in RTL) */}
                                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                        <div
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            border: '1px solid #cbd5e1',
                                            borderRadius: '6px',
                                            backgroundColor: '#ffffff',
                                            overflow: 'hidden',
                                            height: '28px',
                                          }}
                                        >
                                          <button
                                            type="button"
                                            onClick={() => onUpdateLineCartonsPieces(it.productId, it.approvedCartons || 0, (it.approvedPieces || 0) + 1)}
                                            style={{
                                              width: '24px',
                                              height: '100%',
                                              border: 'none',
                                              backgroundColor: '#f8fafc',
                                              color: '#334155',
                                              cursor: 'pointer',
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              borderInlineEnd: '1px solid #e2e8f0',
                                            }}
                                            title={`زيادة ${it.unit || t('delivery_reps.van_load_requisitions_admin_tab.s84', "قطع")}`}
                                          >
                                            <PlusIcon size={11} />
                                          </button>
                                          <input
                                            type="number"
                                            min="0"
                                            className="no-spin-arrows"
                                            value={it.approvedPieces ?? 0}
                                            onChange={(e) => {
                                              const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                                              onUpdateLineCartonsPieces(it.productId, it.approvedCartons || 0, val);
                                            }}
                                            style={{
                                              width: '32px',
                                              height: '100%',
                                              border: 'none',
                                              textAlign: 'center',
                                              fontSize: '12px',
                                              fontWeight: 800,
                                              color: '#0f172a',
                                              outline: 'none',
                                            }}
                                          />
                                          <button
                                            type="button"
                                            onClick={() => onUpdateLineCartonsPieces(it.productId, it.approvedCartons || 0, Math.max(0, (it.approvedPieces || 0) - 1))}
                                            disabled={(it.approvedPieces || 0) <= 0}
                                            style={{
                                              width: '24px',
                                              height: '100%',
                                              border: 'none',
                                              backgroundColor: '#f8fafc',
                                              color: '#334155',
                                              cursor: (it.approvedPieces || 0) <= 0 ? 'not-allowed' : 'pointer',
                                              opacity: (it.approvedPieces || 0) <= 0 ? 0.4 : 1,
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              borderInlineStart: '1px solid #e2e8f0',
                                            }}
                                            title={`إنقاص ${it.unit || t('delivery_reps.van_load_requisitions_admin_tab.s85', "قطع")}`}
                                          >
                                            <MinusIcon size={11} />
                                          </button>
                                        </div>
                                        <span style={{ fontSize: '10.5px', fontWeight: 700, color: '#475569', whiteSpace: 'nowrap' }}>
                                          {it.unit || t('delivery_reps.van_load_requisitions_admin_tab.s86', "قطع")}
                                        </span>
                                      </div>
                                    </div>

                                    {/* Total Approved Summary Badge */}
                                    <span
                                      style={{
                                        fontSize: '11px',
                                        fontWeight: 800,
                                        color: isShortage ? '#dc2626' : '#170e5e',
                                        backgroundColor: isShortage ? '#fef2f2' : '#f1f5f9',
                                        padding: '2px 8px',
                                        borderRadius: '5px',
                                        border: `1px solid ${isShortage ? '#fca5a5' : '#cbd5e1'}`,
                                      }}
                                    >
                                      {t('delivery_reps.van_load_requisitions_admin_tab.s87', "إجمالي المعتمد:")} {it.approvedQty} {it.unit || t('delivery_reps.van_load_requisitions_admin_tab.s88', "قطعة")}
                                    </span>
                                  </div>
                                ) : (
                                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                    <div
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        border: '1px solid #cbd5e1',
                                        borderRadius: '6px',
                                        backgroundColor: '#ffffff',
                                        overflow: 'hidden',
                                        height: '28px',
                                      }}
                                    >
                                      <button
                                        type="button"
                                        onClick={() => onUpdateLineQty(it.productId, (it.approvedQty || 0) + (it.isWeight ? 1 : 1))}
                                        style={{
                                          width: '26px',
                                          height: '100%',
                                          border: 'none',
                                          backgroundColor: '#f8fafc',
                                          color: '#475569',
                                          cursor: 'pointer',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          borderInlineEnd: '1px solid #e2e8f0',
                                        }}
                                        title={t('delivery_reps.van_load_requisitions_admin_tab.s89', "زيادة الكمية")}
                                      >
                                        <PlusIcon size={12} />
                                      </button>
                                      <input
                                        type="number"
                                        min="0"
                                        step={it.isWeight ? '0.1' : '1'}
                                        className="no-spin-arrows"
                                        value={it.approvedQty}
                                        onChange={(e) => {
                                          const val = Math.max(0, (it.isWeight ? parseFloat(e.target.value) : parseInt(e.target.value, 10)) || 0);
                                          onUpdateLineQty(it.productId, val);
                                        }}
                                        style={{
                                          width: '46px',
                                          height: '100%',
                                          border: 'none',
                                          textAlign: 'center',
                                          fontSize: '13px',
                                          fontWeight: 800,
                                          color: isShortage ? '#dc2626' : '#0f172a',
                                          outline: 'none',
                                        }}
                                      />
                                      <button
                                        type="button"
                                        onClick={() => onUpdateLineQty(it.productId, Math.max(0, (it.approvedQty || 0) - (it.isWeight ? 1 : 1)))}
                                        disabled={it.approvedQty <= 0}
                                        style={{
                                          width: '26px',
                                          height: '100%',
                                          border: 'none',
                                          backgroundColor: '#f8fafc',
                                          color: '#475569',
                                          cursor: it.approvedQty <= 0 ? 'not-allowed' : 'pointer',
                                          opacity: it.approvedQty <= 0 ? 0.4 : 1,
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          borderInlineStart: '1px solid #e2e8f0',
                                        }}
                                        title={t('delivery_reps.van_load_requisitions_admin_tab.s90', "تقليل الكمية")}
                                      >
                                        <MinusIcon size={12} />
                                      </button>
                                    </div>
                                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#475569' }}>
                                      {it.unit || t('delivery_reps.van_load_requisitions_admin_tab.s91', "قطعة")}
                                    </span>
                                  </div>
                                )
                              ) : (
                                <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                                  <span
                                    style={{
                                      display: 'inline-block',
                                      padding: '3px 10px',
                                      borderRadius: '6px',
                                      fontSize: '12px',
                                      fontWeight: 800,
                                      backgroundColor: '#ecfdf5',
                                      color: '#15803d',
                                      border: '1px solid #bbf7d0',
                                    }}
                                  >
                                    {it.approvedQty} {it.unit || t('delivery_reps.van_load_requisitions_admin_tab.s92', "قطعة")}
                                  </span>
                                  {it.packingText ? (
                                    <span style={{ fontSize: '10.5px', color: '#170e5e', fontWeight: 700 }}>
                                      {it.packingText}
                                    </span>
                                  ) : isCarton && it.packagingUnit ? (
                                    <span style={{ fontSize: '10.5px', color: '#170e5e', fontWeight: 700 }}>
                                      {Math.floor(it.approvedQty / mult)} {it.packagingUnit.name}
                                      {it.approvedQty % mult > 0 ? ` + ${it.approvedQty % mult} ${it.unit || t('delivery_reps.van_load_requisitions_admin_tab.s93', "قطعة")}` : ''}
                                    </span>
                                  ) : null}
                                </div>
                              )}
                            </td>
                            {selectedReq.status === 'pending' && (
                              <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                                <button
                                  type="button"
                                  onClick={() => onRemoveLine(it.productId)}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    color: '#ef4444',
                                    cursor: 'pointer',
                                    padding: '4px',
                                    borderRadius: '4px',
                                  }}
                                  title={t('delivery_reps.van_load_requisitions_admin_tab.s94', "استبعاد هذا الصنف")}
                                >
                                  <Trash2Icon size={14} />
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  {reviewLines.length > 0 && (
                    <tfoot style={{ backgroundColor: '#f8fafc', borderTop: '2px solid #e2e8f0', fontWeight: 800 }}>
                      <tr>
                        <td style={{ padding: '9px 12px', color: '#334155' }}>
                          {t('delivery_reps.van_load_requisitions_admin_tab.s95', "إجمالي الأصناف:")} <span style={{ color: '#170e5e' }}>{reviewLines.length} {t('delivery_reps.van_load_requisitions_admin_tab.s96', "صنف")}</span>
                        </td>
                        <td style={{ padding: '9px 12px', textAlign: 'center', color: '#0f172a' }}>
                          {reviewLines.reduce((acc, l) => acc + (l.requestedQty || 0), 0)} <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>{t('delivery_reps.van_load_requisitions_admin_tab.s97', "وحدة")}</span>
                        </td>
                        <td style={{ padding: '9px 12px', textAlign: 'center', color: '#64748b' }}>
                          —
                        </td>
                        <td style={{ padding: '9px 12px', textAlign: 'center', color: '#15803d' }}>
                          {reviewLines.reduce((acc, l) => acc + (l.approvedQty || 0), 0)} <span style={{ fontSize: '11px', color: '#15803d', fontWeight: 500 }}>{t('delivery_reps.van_load_requisitions_admin_tab.s98', "وحدة")}</span>
                        </td>
                        {selectedReq.status === 'pending' && <td />}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {/* Add Extra Item Section for Admin */}
              {selectedReq.status === 'pending' && (
                <div style={{ padding: '10px 12px', background: '#fafafa', borderTop: '1px solid #e2e8f0' }}>
                  {!isAddProductOpen ? (
                    <Button
                      variant="secondary"
                      type="button"
                      onClick={() => onAddProductOpenChange(true)}
                      style={{ fontSize: '12px', fontWeight: 700, color: '#170e5e', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    >
                      <PlusIcon size={14} />
                      {t('delivery_reps.van_load_requisitions_admin_tab.s99', "+ إضافة صنف إضافي للإذن")}
                    </Button>
                  ) : (
                    <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '10px 12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 800, color: '#170e5e' }}>
                          {t('delivery_reps.van_load_requisitions_admin_tab.s100', "اختر صنفاً لإضافته من مستودع \"")}{selectedReq.sourceWarehouseName}":
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            onAddProductOpenChange(false);
                            onProductSearchChange('');
                          }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: '2px' }}
                        >
                          <XIcon size={16} />
                        </button>
                      </div>

                      <input
                        type="text"
                        value={productSearch}
                        onChange={(e) => onProductSearchChange(e.target.value)}
                        placeholder={t('delivery_reps.van_load_requisitions_admin_tab.s101', "ابحث بالاسم أو الباركود...")}
                        style={{
                          width: '100%',
                          height: '36px',
                          padding: '0 10px',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          fontSize: '12px',
                          boxSizing: 'border-box',
                        }}
                        autoFocus
                      />

                      <div
                        style={{
                          maxHeight: '160px',
                          overflowY: 'auto',
                          marginTop: '6px',
                          border: '1px solid #e2e8f0',
                          borderRadius: '6px',
                        }}
                      >
                        {warehouseProducts
                          .filter((p) => {
                            if (!productSearch.trim()) return true;
                            const q = productSearch.toLowerCase().trim();
                            return (p.name || '').toLowerCase().includes(q) || (p.barcode || '').toLowerCase().includes(q);
                          })
                          .slice(0, 12)
                          .map((p) => {
                            const alreadyInReview = reviewLines.some((l) => l.productId === p.id);
                            return (
                              <div
                                key={p.id}
                                onClick={() => onAddProduct(p)}
                                style={{
                                  padding: '8px 10px',
                                  borderBottom: '1px solid #f1f5f9',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  cursor: 'pointer',
                                  fontSize: '12px',
                                  backgroundColor: alreadyInReview ? '#f8fafc' : '#ffffff',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f5f9')}
                                onMouseLeave={(e) =>
                                  (e.currentTarget.style.backgroundColor = alreadyInReview ? '#f8fafc' : '#ffffff')
                                }
                              >
                                <div>
                                  <span style={{ fontWeight: 700, color: '#0f172a' }}>{p.name}</span>
                                  <span style={{ fontSize: '10.5px', color: '#94a3b8', marginRight: '6px' }}>
                                    {p.barcode || t('delivery_reps.van_load_requisitions_admin_tab.s102', "بدون باركود")}
                                  </span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span
                                    style={{
                                      fontSize: '11px',
                                      fontWeight: 800,
                                      color: (p.availableQty ?? p.totalStock) > 0 ? '#15803d' : '#dc2626',
                                    }}
                                  >
                                    {t('delivery_reps.van_load_requisitions_admin_tab.s103', "متاح:")} {p.availableQty ?? p.totalStock} {t('delivery_reps.van_load_requisitions_admin_tab.s104', "قطعة")}
                                  </span>
                                  <span style={{ fontSize: '11.5px', color: '#170e5e', fontWeight: 800 }}>
                                    {alreadyInReview ? t('delivery_reps.van_load_requisitions_admin_tab.s105', "+ زيادة كمية") : t('delivery_reps.van_load_requisitions_admin_tab.s106', "+ إضافة")}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {selectedReq.status === 'pending' && (
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                  {t('delivery_reps.van_load_requisitions_admin_tab.s107', "ملاحظات وتوجيهات الإدارة:")}
                </label>
                <input
                  type="text"
                  placeholder={t('delivery_reps.van_load_requisitions_admin_tab.s108', "ملاحظات تظهر للمندوب في تقرير الصرف والرحلة...")}
                  value={adminNotes}
                  onChange={(e) => onAdminNotesChange(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '12.5px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            )}

            {selectedReq.rejectionReason && (
              <div style={{ fontSize: '12px', color: '#991b1b', backgroundColor: '#fef2f2', padding: '10px 12px', borderRadius: '8px', border: '1px solid #fecaca' }}>
                <strong>{t('delivery_reps.van_load_requisitions_admin_tab.s109', "سبب الرفض:")}</strong> {selectedReq.rejectionReason}
              </div>
            )}

            {selectedReq.reviewedByName && (
              <div style={{ fontSize: '11px', color: '#64748b' }}>
                {t('delivery_reps.van_load_requisitions_admin_tab.s110', "تمت المراجعة بواسطة:")} <strong>{selectedReq.reviewedByName}</strong>{' '}
                {selectedReq.reviewedAt && `بتاريخ ${new Date(selectedReq.reviewedAt).toLocaleString('ar-EG')}`}
              </div>
            )}

            {/* Modal Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
              <Button variant="secondary" onClick={() => onClose()}>
                {t('delivery_reps.van_load_requisitions_admin_tab.s111', "إغلاق")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => onPrint(selectedReq, 'a4')}
                style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}
                title={t('delivery_reps.van_load_requisitions_admin_tab.s112', "طباعة نموذج المستودع الرسمي A4")}
              >
                <PrinterIcon size={13} />
                {t('delivery_reps.van_load_requisitions_admin_tab.s113', "طباعة A4")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => onPrint(selectedReq, 'receipt')}
                style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}
                title={t('delivery_reps.van_load_requisitions_admin_tab.s114', "طباعة إيصال حراري 80mm للمندوب")}
              >
                <PrinterIcon size={13} />
                {t('delivery_reps.van_load_requisitions_admin_tab.s115', "إيصال حراري (80mm)")}
              </Button>
              {selectedReq.status === 'pending' && (
                <>
                  <Button
                    variant="secondary"
                    onClick={onSaveReviewed}
                    disabled={isReviewPending}
                    style={{ fontSize: '12px' }}
                  >
                    {isReviewPending ? t('delivery_reps.van_load_requisitions_admin_tab.s116', "جاري الحفظ...") : t('delivery_reps.van_load_requisitions_admin_tab.s117', "حفظ تعديل الكميات")}
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => onReject(selectedReq)}
                    style={{ backgroundColor: '#dc2626', color: '#ffffff', fontSize: '12px' }}
                  >
                    {t('delivery_reps.van_load_requisitions_admin_tab.s118', "رفض / إلغاء الطلب")}
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => onDelete(selectedReq)}
                    disabled={isDeletePending}
                    style={{ backgroundColor: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}
                  >
                    <Trash2Icon size={13} />
                    {t('delivery_reps.van_load_requisitions_admin_tab.s119', "حذف الطلب")}
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => onDispatch(selectedReq)}
                    disabled={isDispatchPending}
                    style={{ backgroundColor: '#15803d', color: '#ffffff', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <TruckIcon size={14} />
                    {isDispatchPending ? t('delivery_reps.van_load_requisitions_admin_tab.s120', "جاري الصرف والتحميل...") : t('delivery_reps.van_load_requisitions_admin_tab.s121', "اعتماد وصرف وتحميل وبدء الرحلة")}
                  </Button>
                </>
              )}
            </div>
          </div>
        </StandardDialog>
      )}
    </>
  );
}
