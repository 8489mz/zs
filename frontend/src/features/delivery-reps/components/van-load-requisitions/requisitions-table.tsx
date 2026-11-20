import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { ChevronDownIcon, FileTextIcon, PrinterIcon, Trash2Icon, TruckIcon, XCircleIcon } from '@/shared/components/icons/AppIcons';
import type { VanLoadRequisitionRecord } from '../../api/van-sales.api';

export interface RequisitionsTableProps {
  requisitions: VanLoadRequisitionRecord[];
  isLoading: boolean;
  onOpenReview: (req: VanLoadRequisitionRecord) => void;
  onDelete: (req: VanLoadRequisitionRecord) => Promise<void>;
  onDispatch: (req: VanLoadRequisitionRecord) => Promise<void>;
  onReject: (req: VanLoadRequisitionRecord) => void;
  onPrint: (req: VanLoadRequisitionRecord, format?: 'a4' | 'receipt') => void;
  activePrintMenuId: number | null;
  onPrintMenuChange: (id: number | null) => void;
  isDispatchPending: boolean;
  isDeletePending: boolean;
  defaultPaperSize: 'a4' | 'receipt';
}

export function RequisitionsTable({
  requisitions,
  isLoading,
  onOpenReview,
  onDelete,
  onDispatch,
  onReject,
  onPrint,
  activePrintMenuId,
  onPrintMenuChange,
  isDispatchPending,
  isDeletePending,
  defaultPaperSize,
}: RequisitionsTableProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* Requisitions Table (Zero Horizontal Scroll Standard) */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          overflowX: 'auto',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        {isLoading ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#64748b', fontWeight: 700 }}>
            {t('delivery_reps.van_load_requisitions_admin_tab.s17', "جاري تحميل أذونات التحميل...")}
          </div>
        ) : requisitions.length === 0 ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#64748b', fontWeight: 600 }}>
            {t('delivery_reps.van_load_requisitions_admin_tab.s18', "لا توجد أذونات تحميل مطابقة للفلتر المحدد.")}
          </div>
        ) : (
          <table
            style={{
              width: '100%',
              minWidth: '1080px',
              borderCollapse: 'collapse',
              textAlign: 'right',
              fontSize: '12px',
              tableLayout: 'fixed',
            }}
          >
            <colgroup>
              <col style={{ width: '14%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '17%' }} />
              <col style={{ width: '13%' }} />
            </colgroup>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                <th style={{ padding: '10px 8px', fontWeight: 700, fontSize: '11.5px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s19', "رقم الإذن")}</th>
                <th style={{ padding: '10px 8px', fontWeight: 700, fontSize: '11.5px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s20', "مندوب التوزيع")}</th>
                <th style={{ padding: '10px 6px', fontWeight: 700, fontSize: '11.5px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s21', "المركبة")}</th>
                <th style={{ padding: '10px 6px', fontWeight: 700, fontSize: '11.5px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s22', "المستودع")}</th>
                <th style={{ padding: '10px 6px', fontWeight: 700, textAlign: 'center', fontSize: '11.5px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s23', "الأصناف")}</th>
                <th style={{ padding: '10px 6px', fontWeight: 700, textAlign: 'center', fontSize: '11.5px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s24', "القطع")}</th>
                <th style={{ padding: '10px 6px', fontWeight: 700, fontSize: '11.5px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s25', "تاريخ الطلب")}</th>
                <th style={{ padding: '10px 6px', fontWeight: 700, textAlign: 'center', fontSize: '11.5px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s26', "حالة الإذن والقرار")}</th>
                <th style={{ padding: '10px 8px', fontWeight: 700, textAlign: 'center', fontSize: '11.5px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s27', "المعاينة والطباعة")}</th>
              </tr>
            </thead>
            <tbody>
              {requisitions.map((r) => {
                const totalReqPieces = (r.requestedItems || []).reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
                const isPending = r.status === 'pending';
                const isDispatched = r.status === 'dispatched';
                const isRejected = r.status === 'rejected';

                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9', background: isPending ? '#fffdf7' : 'transparent', height: '48px' }}>
                    <td style={{ padding: '8px 8px', fontFamily: 'monospace', fontWeight: 800, color: '#170e5e', fontSize: '11.5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'middle' }}>
                      {r.docNo}
                    </td>
                    <td style={{ padding: '8px 8px', fontWeight: 700, color: '#0f172a', fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'middle' }}>
                      {r.repName}
                    </td>
                    <td style={{ padding: '8px 6px', verticalAlign: 'middle' }}>
                      {r.vehiclePlate ? (
                        <span style={{ fontSize: '10.5px', background: '#f1f5f9', color: '#334155', padding: '1px 5px', borderRadius: '4px', border: '1px solid #e2e8f0', fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {t('delivery_reps.van_load_requisitions_admin_tab.s28', "لوحة:")} {r.vehiclePlate}
                        </span>
                      ) : (
                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s29', "غير محددة")}</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 6px', color: '#475569', fontWeight: 600, fontSize: '11.5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'middle' }}>
                      {r.sourceWarehouseName}
                    </td>
                    <td style={{ padding: '8px 6px', textAlign: 'center', fontWeight: 700, fontSize: '11.5px', verticalAlign: 'middle' }}>
                      {(r.requestedItems || []).length} {t('delivery_reps.van_load_requisitions_admin_tab.s30', "صنف")}
                    </td>
                    <td style={{ padding: '8px 6px', textAlign: 'center', fontWeight: 800, color: '#1e293b', fontSize: '11.5px', verticalAlign: 'middle' }}>
                      {totalReqPieces} {t('delivery_reps.van_load_requisitions_admin_tab.s31', "قطعة")}
                    </td>
                    <td style={{ padding: '8px 6px', fontSize: '10.5px', color: '#64748b', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                      {new Date(r.createdAt).toLocaleDateString('ar-EG', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td style={{ padding: '8px 6px', textAlign: 'center', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                      {isPending && (
                        <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center', justifyContent: 'center' }}>
                          <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '10px', background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a', fontWeight: 700, whiteSpace: 'nowrap' }}>
                            {t('delivery_reps.van_load_requisitions_admin_tab.s32', "بانتظار الصرف")}
                          </span>
                          <Button
                            variant="primary"
                            style={{ fontSize: '11px', padding: '3px 7px', background: '#15803d', color: '#ffffff', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '2px' }}
                            onClick={() => onDispatch(r)}
                            disabled={isDispatchPending}
                            title={t('delivery_reps.van_load_requisitions_admin_tab.s33', "صرف وتحميل السيارة فوراً")}
                          >
                            <TruckIcon size={12} />
                            {t('delivery_reps.van_load_requisitions_admin_tab.s34', "صرف")}
                          </Button>
                          <Button
                            variant="danger"
                            style={{ fontSize: '11px', padding: '3px 6px', background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '2px' }}
                            onClick={() => onReject(r)}
                            title={t('delivery_reps.van_load_requisitions_admin_tab.s35', "رفض أو إلغاء الطلب")}
                          >
                            <XCircleIcon size={12} />
                            {t('delivery_reps.van_load_requisitions_admin_tab.s36', "رفض")}
                          </Button>
                          <Button
                            variant="danger"
                            style={{ fontSize: '11px', padding: '3px 5px', color: '#ef4444', background: '#fef2f2', border: '1px solid #fee2e2', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                            onClick={() => onDelete(r)}
                            disabled={isDeletePending}
                            title={t('delivery_reps.van_load_requisitions_admin_tab.s37', "حذف الطلب نهائياً")}
                          >
                            <Trash2Icon size={12} />
                          </Button>
                        </div>
                      )}
                      {isDispatched && (
                        <span style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '10px', background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0', fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {t('delivery_reps.van_load_requisitions_admin_tab.s38', "تم الصرف #")}{r.tripId}
                        </span>
                      )}
                      {isRejected && (
                        <div style={{ display: 'inline-flex', gap: '5px', alignItems: 'center', justifyContent: 'center' }}>
                          <span style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '10px', background: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca', fontWeight: 700, whiteSpace: 'nowrap' }}>
                            {t('delivery_reps.van_load_requisitions_admin_tab.s39', "مرفوض")}
                          </span>
                          <Button
                            variant="danger"
                            style={{ fontSize: '11px', padding: '3px 5px', color: '#ef4444', background: '#fef2f2', border: '1px solid #fee2e2', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                            onClick={() => onDelete(r)}
                            disabled={isDeletePending}
                            title={t('delivery_reps.van_load_requisitions_admin_tab.s40', "حذف الطلب نهائياً")}
                          >
                            <Trash2Icon size={12} />
                          </Button>
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '8px 8px', textAlign: 'center', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'inline-flex', gap: '5px', justifyContent: 'center', alignItems: 'center', flexWrap: 'nowrap' }}>
                        <Button
                          variant="secondary"
                          style={{ fontSize: '11px', padding: '4px 8px', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                          onClick={() => onOpenReview(r)}
                          title={t('delivery_reps.van_load_requisitions_admin_tab.s41', "معاينة ومراجعة الأصناف والكميات")}
                        >
                          <FileTextIcon size={12} />
                          {t('delivery_reps.van_load_requisitions_admin_tab.s42', "معاينة")}
                        </Button>
                        {/* Split Print Button */}
                        <div style={{ display: 'inline-flex', alignItems: 'stretch', position: 'relative' }}>
                          <button
                            type="button"
                            style={{
                              fontSize: '11px',
                              padding: '4px 7px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px',
                              whiteSpace: 'nowrap',
                              backgroundColor: '#ffffff',
                              color: '#334155',
                              border: '1px solid #cbd5e1',
                              borderInlineEnd: 'none',
                              borderStartStartRadius: '6px',
                              borderEndStartRadius: '6px',
                              cursor: 'pointer',
                              fontWeight: 600,
                              lineHeight: '1.2',
                            }}
                            onClick={() => onPrint(r)}
                            title={`طباعة مباشرة (${defaultPaperSize === 'receipt' ? t('delivery_reps.van_load_requisitions_admin_tab.s43', "إيصال حراري 80mm") : t('delivery_reps.van_load_requisitions_admin_tab.s44', "نموذج A4")})`}
                          >
                            <PrinterIcon size={12} />
                            {t('delivery_reps.van_load_requisitions_admin_tab.s45', "طباعة")}
                          </button>
                          <button
                            type="button"
                            style={{
                              padding: '4px 4px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: '#f8fafc',
                              color: '#64748b',
                              border: '1px solid #cbd5e1',
                              borderStartEndRadius: '6px',
                              borderEndEndRadius: '6px',
                              cursor: 'pointer',
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              onPrintMenuChange(activePrintMenuId === r.id ? null : r.id);
                            }}
                            title={t('delivery_reps.van_load_requisitions_admin_tab.s46', "خيارات الطباعة (A4 أو حراري)")}
                          >
                            <ChevronDownIcon size={11} />
                          </button>

                          {/* Floating print format menu */}
                          {activePrintMenuId === r.id && (
                            <div
                              style={{
                                position: 'absolute',
                                top: 'calc(100% + 4px)',
                                left: 0,
                                zIndex: 100,
                                backgroundColor: '#ffffff',
                                border: '1px solid #e2e8f0',
                                borderRadius: '8px',
                                boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
                                padding: '4px',
                                minWidth: '160px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '2px',
                                textAlign: 'right',
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                style={{
                                  padding: '6px 10px',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  color: defaultPaperSize === 'a4' ? '#170e5e' : '#334155',
                                  backgroundColor: defaultPaperSize === 'a4' ? '#f1f5f9' : 'transparent',
                                  border: 'none',
                                  borderRadius: '5px',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  width: '100%',
                                  textAlign: 'right',
                                }}
                                onClick={() => {
                                  onPrintMenuChange(null);
                                  onPrint(r, 'a4');
                                }}
                              >
                                <span>{t('delivery_reps.van_load_requisitions_admin_tab.s47', "طباعة A4 (المستودع)")}</span>
                                {defaultPaperSize === 'a4' && <span style={{ fontSize: '10px', color: '#15803d' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s48', "افتراضي")}</span>}
                              </button>
                              <button
                                type="button"
                                style={{
                                  padding: '6px 10px',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  color: defaultPaperSize === 'receipt' ? '#170e5e' : '#334155',
                                  backgroundColor: defaultPaperSize === 'receipt' ? '#f1f5f9' : 'transparent',
                                  border: 'none',
                                  borderRadius: '5px',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  width: '100%',
                                  textAlign: 'right',
                                }}
                                onClick={() => {
                                  onPrintMenuChange(null);
                                  onPrint(r, 'receipt');
                                }}
                              >
                                <span>{t('delivery_reps.van_load_requisitions_admin_tab.s49', "إيصال حراري (80mm)")}</span>
                                {defaultPaperSize === 'receipt' && <span style={{ fontSize: '10px', color: '#15803d' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s50', "افتراضي")}</span>}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Backdrop to close print dropdown when clicking outside */}
      {activePrintMenuId !== null && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 90 }}
          onClick={() => onPrintMenuChange(null)}
        />
      )}
    </>
  );
}
