import { useTranslation } from 'react-i18next';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { MaintenanceTicket } from '@/types/domain-models/maintenance';
import {
  ClockIcon,
  CheckCircleIcon,
  PackageIcon,
  EyeIcon,
  FileTextIcon,
  CopyIcon,
  LinkIcon,
  AlertTriangleIcon,
} from '@/shared/components/icons/AppIcons';

interface MaintenanceTicketsTableProps {
  isLoading: boolean;
  isError: boolean;
  tickets: MaintenanceTicket[];
  totalItems: number;
  page: number;
  totalPages: number;
  setPage: (p: number | ((prev: number) => number)) => void;
  serialLabel: string;
  copiedPhone: string | null;
  onCopyPhone: (phone: string) => void;
  onOpenDetail: (t: MaintenanceTicket) => void;
  onOpenReceipt: (t: MaintenanceTicket) => void;
  onOpenSettlement: (t: MaintenanceTicket) => void;
  onChangeStatus: (id: string | number, status: string) => void;
  getStatusMeta: (status: string) => { label: string; bg: string; color: string; border: string };
  formatDate: (dt: string) => string;
}

export function MaintenanceTicketsTable({
  isLoading,
  isError,
  tickets,
  totalItems,
  page,
  totalPages,
  setPage,
  serialLabel,
  copiedPhone,
  onCopyPhone,
  onOpenDetail,
  onOpenReceipt,
  onOpenSettlement,
  onChangeStatus,
  getStatusMeta,
  formatDate,
}: MaintenanceTicketsTableProps) {
  const { t: __t } = useTranslation();
  return (
    <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'right' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '0.8rem', fontWeight: 700 }}>
              <th style={{ padding: '10px 14px', width: '105px' }}>{__t('maintenance.tickets.maintenance_tickets_table.s0', "كود الجهاز")}</th>
              <th style={{ padding: '10px 14px', width: '160px' }}>{__t('maintenance.tickets.maintenance_tickets_table.s1', "العميل / الهاتف")}</th>
              <th style={{ padding: '10px 14px', width: '180px' }}>{__t('maintenance.tickets.maintenance_tickets_table.s2', "الجهاز /")} {serialLabel}</th>
              <th style={{ padding: '10px 14px', minWidth: '140px' }}>{__t('maintenance.tickets.maintenance_tickets_table.s3', "العطل المشتكى منه")}</th>
              <th style={{ padding: '10px 14px', width: '150px' }}>{__t('maintenance.tickets.maintenance_tickets_table.s4', "الحساب المالي")}</th>
              <th style={{ padding: '10px 14px', width: '165px' }}>{__t('maintenance.tickets.maintenance_tickets_table.s5', "حالة الصيانة")}</th>
              <th style={{ padding: '10px 14px', width: '185px', textAlign: 'center' }}>{__t('maintenance.tickets.maintenance_tickets_table.s6', "الإجراءات")}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
                    <ClockIcon size={18} />
                    <span>{__t('maintenance.tickets.maintenance_tickets_table.s7', "جارٍ تحميل سجل تذاكر الصيانة...")}</span>
                  </div>
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={7} style={{ padding: '30px', textAlign: 'center', color: '#dc2626' }}>
                  <AlertTriangleIcon size={18} />
                  <span style={{ marginRight: '8px' }}>{__t('maintenance.tickets.maintenance_tickets_table.s8', "فشل جلب سجل تذاكر الصيانة. يرجى إعادة المحاولة.")}</span>
                </td>
              </tr>
            ) : tickets.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '50px 20px', textAlign: 'center', color: '#94a3b8' }}>
                  <PackageIcon size={36} />
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#475569', marginTop: '10px' }}>
                    {__t('maintenance.tickets.maintenance_tickets_table.s9', "لا توجد تذاكر صيانة مطابقة للبحث أو الفلتر")}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '4px' }}>
                    {__t('maintenance.tickets.maintenance_tickets_table.s10', "يمكنك استلام جهاز صيانة جديد بالضغط على زر \"استلام جهاز صيانة جديد\" بالأعلى")}
                  </div>
                </td>
              </tr>
            ) : (
              tickets.map((t) => {
                const statusMeta = getStatusMeta(t.status);
                const totalCost = t.finalCost > 0 ? t.finalCost : t.expectedCost;
                const isDelivered = t.status === 'delivered';
                const isTerminal = t.status === 'cancelled' || t.status === 'unrepairable';
                /* Delivered tickets are fully settled by construction: delivery
                 * enforces remaining + advance = finalCost in minor units
                 * server-side (422 MAINTENANCE_SETTLEMENT_MISMATCH otherwise),
                 * so the delivery collection is part of paid and the settled
                 * total is finalCost itself, never the estimate fallback.
                 * Terminal tickets hold nothing collectible (the counts
                 * endpoint excludes them from totalRemaining, and a terminal
                 * transition refunds any advance first), so the pre-refund
                 * advance must never render as paid. Open tickets keep the
                 * advance-only figures. */
                const displayTotal = isDelivered ? t.finalCost : totalCost;
                const paidAmount = isDelivered ? t.finalCost : isTerminal ? 0 : (t.advancePayment || 0);
                const remaining = isDelivered || isTerminal ? 0 : Math.max(0, totalCost - (t.advancePayment || 0));
                const hasRemaining = remaining > 0;

                return (
                  <tr
                    key={t.id}
                    style={{
                      borderBottom: '1px solid #f1f5f9',
                      transition: 'background-color 0.12s ease',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td style={{ padding: '12px 14px' }} onClick={() => onOpenDetail(t)}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <span
                          style={{
                            fontWeight: 800,
                            color: '#170e5e',
                            fontFamily: 'monospace',
                            fontSize: '0.88rem',
                            letterSpacing: '0.3px',
                          }}
                        >
                          {t.ticketNo}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '2px' }}>
                        {formatDate(t.createdAt)}
                      </div>
                    </td>

                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ fontWeight: 700, color: '#1e293b' }}>{t.customerName}</div>
                      {t.customerPhone && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                          <span style={{ fontSize: '0.76rem', color: '#64748b', direction: 'ltr', unicodeBidi: 'embed' }}>
                            {t.customerPhone}
                          </span>
                          <button
                            type="button"
                            title={__t('maintenance.tickets.maintenance_tickets_table.s11', "نسخ رقم الهاتف")}
                            onClick={(e) => { e.stopPropagation(); onCopyPhone(t.customerPhone); }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px', color: copiedPhone === t.customerPhone ? '#16a34a' : '#94a3b8' }}
                          >
                            <CopyIcon size={12} />
                          </button>
                          <a
                            href={`https://wa.me/${t.customerPhone.replace(/\D/g, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={__t('maintenance.tickets.maintenance_tickets_table.s12', "مراسلة واتساب")}
                            onClick={(e) => e.stopPropagation()}
                            style={{ color: '#25d366', display: 'inline-flex', alignItems: 'center' }}
                          >
                            <LinkIcon size={12} />
                          </a>
                        </div>
                      )}
                    </td>

                    <td style={{ padding: '12px 14px' }} onClick={() => onOpenDetail(t)}>
                      <div style={{ fontWeight: 700, color: '#0f172a' }}>{t.deviceModel}</div>
                      <div style={{ fontSize: '0.74rem', color: '#64748b', display: 'flex', gap: '6px', marginTop: '2px', alignItems: 'center' }}>
                        {t.deviceBrand && <span style={{ color: '#475569', fontWeight: 600 }}>{t.deviceBrand}</span>}
                        {t.deviceBrand && t.serialNumber && <span>•</span>}
                        {t.serialNumber && (
                          <span style={{ fontFamily: 'monospace', color: '#64748b' }}>
                            {t.serialNumber}
                          </span>
                        )}
                      </div>
                    </td>

                    <td style={{ padding: '12px 14px', maxWidth: '200px' }} onClick={() => onOpenDetail(t)}>
                      <div
                        style={{
                          color: '#334155',
                          fontSize: '0.8rem',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={t.problemDescription}
                      >
                        {t.problemDescription}
                      </div>
                      {t.technicianName && (
                        <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                          {__t('maintenance.tickets.maintenance_tickets_table.s13', "الفني:")} <strong style={{ color: '#475569' }}>{t.technicianName}</strong>
                        </div>
                      )}
                    </td>

                    <td style={{ padding: '12px 14px' }} onClick={() => onOpenDetail(t)}>
                      <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.88rem' }}>
                        {displayTotal.toFixed(2)}{' '}
                        <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b' }}><CurrencySymbol /></span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                        {paidAmount > 0 && (
                          <span style={{ fontSize: '0.72rem', color: '#16a34a', fontWeight: 700 }}>
                            {__t('maintenance.tickets.maintenance_tickets_table.s14', "مسدد:")} {paidAmount.toFixed(0)}
                          </span>
                        )}
                        {hasRemaining ? (
                          <span
                            style={{
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              color: '#d97706',
                              background: '#fffbeb',
                              padding: '1px 5px',
                              borderRadius: '4px',
                            }}
                          >
                            {__t('maintenance.tickets.maintenance_tickets_table.s15', "متبقي:")} {remaining.toFixed(0)}
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.7rem', color: '#16a34a', fontWeight: 700 }}>
                            {__t('maintenance.tickets.maintenance_tickets_table.s16', "خالص")}
                          </span>
                        )}
                      </div>
                    </td>

                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                        <select
                          value={t.status}
                          onChange={(e) => onChangeStatus(t.id, e.target.value)}
                          style={{
                            padding: '3px 8px',
                            borderRadius: '6px',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            background: statusMeta.bg,
                            color: statusMeta.color,
                            border: `1px solid ${statusMeta.border}`,
                            cursor: 'pointer',
                            outline: 'none',
                          }}
                        >
                          <option value="received">{__t('maintenance.tickets.maintenance_tickets_table.s17', "استلام جديد")}</option>
                          <option value="in_progress">{__t('maintenance.tickets.maintenance_tickets_table.s18', "قيد الصيانة")}</option>
                          <option value="waiting_parts">{__t('maintenance.tickets.maintenance_tickets_table.s19', "انتظار قطع غيار")}</option>
                          <option value="repaired">{__t('maintenance.tickets.maintenance_tickets_table.s20', "جاهز للتسليم")}</option>
                          <option value="delivered">{__t('maintenance.tickets.maintenance_tickets_table.s21', "تم التسليم")}</option>
                          <option value="cancelled">{__t('maintenance.tickets.maintenance_tickets_table.s22', "ملغي / غير قابل للإصلاح")}</option>
                        </select>
                      </div>
                    </td>

                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center', justifyContent: 'center' }}>
                        <button
                          type="button"
                          onClick={() => onOpenDetail(t)}
                          title={__t('maintenance.tickets.maintenance_tickets_table.s23', "تفاصيل التذكرة والفحص وقطع الغيار")}
                          style={{
                            padding: '5px 8px',
                            borderRadius: '6px',
                            border: '1px solid #e2e8f0',
                            background: '#ffffff',
                            color: '#334155',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                          }}
                        >
                          <EyeIcon size={14} />
                          <span>{__t('maintenance.tickets.maintenance_tickets_table.s24', "تفاصيل")}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onOpenReceipt(t)}
                          title={__t('maintenance.tickets.maintenance_tickets_table.s25', "طباعة إيصال الاستلام وباركود الجهاز")}
                          style={{
                            padding: '5px 7px',
                            borderRadius: '6px',
                            border: '1px solid #e2e8f0',
                            background: '#ffffff',
                            color: '#475569',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                          }}
                        >
                          <FileTextIcon size={14} />
                        </button>

                        {!isDelivered && (
                          <button
                            type="button"
                            onClick={() => onOpenSettlement(t)}
                            title={__t('maintenance.tickets.maintenance_tickets_table.s26', "تسليم الجهاز للعميل وتحصيل المتبقي")}
                            style={{
                              padding: '5px 8px',
                              borderRadius: '6px',
                              border: '1px solid #16a34a',
                              background: '#f0fdf4',
                              color: '#166534',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontSize: '0.75rem',
                              fontWeight: 700,
                            }}
                          >
                            <CheckCircleIcon size={13} />
                            <span>{__t('maintenance.tickets.maintenance_tickets_table.s27', "تسليم")}</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', fontSize: '0.8rem', color: '#64748b' }}>
          <div>
            {__t('maintenance.tickets.maintenance_tickets_table.s28', "إجمالي التذاكر:")} <strong>{totalItems}</strong> {__t('maintenance.tickets.maintenance_tickets_table.s29', "(صفحة")} {page} {__t('maintenance.tickets.maintenance_tickets_table.s30', "من")} {totalPages})
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                cursor: page <= 1 ? 'not-allowed' : 'pointer',
                color: page <= 1 ? '#94a3b8' : '#0f172a',
                fontSize: '0.78rem',
                fontWeight: 600,
              }}
            >
              {__t('maintenance.tickets.maintenance_tickets_table.s31', "السابق")}
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                color: page >= totalPages ? '#94a3b8' : '#0f172a',
                fontSize: '0.78rem',
                fontWeight: 600,
              }}
            >
              {__t('maintenance.tickets.maintenance_tickets_table.s32', "التالي")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
