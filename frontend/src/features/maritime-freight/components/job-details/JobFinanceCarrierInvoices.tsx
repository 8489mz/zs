import { useTranslation } from 'react-i18next';
import { MaritimeCarrierInvoice, MaritimeJob } from '../../api/maritime-freight.api';
import { printCarrierDisputeNote } from '../../utils/maritime-documents';

interface Props {
  job: MaritimeJob;
  carrierInvoicesList: MaritimeCarrierInvoice[];
  loadingCarrierInvoices: boolean;
  handleOpenRecordExpense: () => void;
  handleOpenDispute: (inv: MaritimeCarrierInvoice) => void;
  handleOpenOverrideDialog: (inv: MaritimeCarrierInvoice) => void;
}

export function JobFinanceCarrierInvoices({
  job,
  carrierInvoicesList,
  loadingCarrierInvoices,
  handleOpenRecordExpense,
  handleOpenDispute,
  handleOpenOverrideDialog,
}: Props) {
  const { t } = useTranslation();

  return (
    <>
                  {/* 2.5. سجل فواتير الخطوط الملاحية وتدقيق النولون (Carrier Invoices & Freight Audit Log) */}
                  <div
                    style={{
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '10px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        padding: '10px 14px',
                        background: '#f8fafc',
                        borderBottom: '1px solid #e2e8f0',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#170e5e' }}>
                          {t('maritime_freight.job_details_modal.s186', "سجل فواتير الخطوط الملاحية والتدقيق المالي (Carrier Freight Audit)")}
                        </span>
                        <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', background: '#eff6ff', color: '#1e40af' }}>
                          {carrierInvoicesList.length} {t('maritime_freight.job_details_modal.s187', "فواتير")}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={handleOpenRecordExpense}
                        style={{
                          padding: '4px 10px',
                          background: '#170e5e',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {t('maritime_freight.job_details_modal.s188', "+ تسجيل فاتورة خط ملاحي")}
                      </button>
                    </div>

                    {loadingCarrierInvoices ? (
                      <div style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: '0.8rem' }}>
                        {t('maritime_freight.job_details_modal.s189', "جاري تحميل سجل فواتير الناقل...")}
                      </div>
                    ) : carrierInvoicesList.length === 0 ? (
                      <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: '0.78rem' }}>
                        {t('maritime_freight.job_details_modal.s190', "لم يتم تسجيل أي فواتير للخط الملاحي بعد. يمكنك تسجيل فواتير الناقل لمطابقتها تلقائياً بالتعرفة المتعاقد عليها.")}
                      </div>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                        <thead>
                          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'right' }}>
                            <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s191', "رقم الفاتورة")}</th>
                            <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s192', "التاريخ")}</th>
                            <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s193', "المبلغ المفوتر")}</th>
                            <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s194', "التعرفة المتعاقد عليها")}</th>
                            <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s195', "الفارق (Variance)")}</th>
                            <th style={{ padding: '8px 12px', fontWeight: 700, textAlign: 'center' }}>{t('maritime_freight.job_details_modal.s196', "حالة التدقيق")}</th>
                            <th style={{ padding: '8px 12px', fontWeight: 700, textAlign: 'center' }}>{t('maritime_freight.job_details_modal.s197', "الإجراءات")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {carrierInvoicesList.map((inv) => (
                            <tr key={inv.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <td style={{ padding: '8px 12px', fontWeight: 800, fontFamily: 'monospace', color: '#0f172a' }}>
                                {inv.invoiceNumber}
                              </td>
                              <td style={{ padding: '8px 12px', color: '#64748b' }}>
                                {inv.invoiceDate ? inv.invoiceDate.split('T')[0] : '—'}
                              </td>
                              <td style={{ padding: '8px 12px', fontWeight: 800, color: '#b91c1c' }}>
                                {inv.currency} {Number(inv.totalInvoicedAmount).toLocaleString()}
                              </td>
                              <td style={{ padding: '8px 12px', fontWeight: 700, color: '#166534' }}>
                                {inv.contractedAmount > 0 ? `${inv.currency} ${Number(inv.contractedAmount).toLocaleString()}` : '—'}
                              </td>
                              <td style={{ padding: '8px 12px', fontWeight: 800, color: inv.varianceAmount > 0 ? '#dc2626' : inv.varianceAmount < 0 ? '#2563eb' : '#16a34a' }}>
                                {inv.varianceAmount > 0 ? `+${inv.currency} ${Number(inv.varianceAmount).toLocaleString()} (+${inv.variancePct}%)` : inv.varianceAmount < 0 ? `-${inv.currency} ${Math.abs(Number(inv.varianceAmount)).toLocaleString()}` : '0.00'}
                              </td>
                              <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                <span
                                  style={{
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    fontSize: '0.7rem',
                                    fontWeight: 700,
                                    background:
                                      inv.auditStatus === 'matched'
                                        ? '#dcfce7'
                                        : inv.auditStatus === 'overcharge'
                                        ? '#fee2e2'
                                        : inv.auditStatus === 'approved_override'
                                        ? '#f3e8ff'
                                        : inv.auditStatus === 'disputed'
                                        ? '#fef3c7'
                                        : '#f1f5f9',
                                    color:
                                      inv.auditStatus === 'matched'
                                        ? '#15803d'
                                        : inv.auditStatus === 'overcharge'
                                        ? '#b91c1c'
                                        : inv.auditStatus === 'approved_override'
                                        ? '#7e22ce'
                                        : inv.auditStatus === 'disputed'
                                        ? '#b45309'
                                        : '#64748b',
                                  }}
                                >
                                  {inv.auditStatus === 'matched'
                                    ? t('maritime_freight.job_details_modal.s198', "مطابق للتعرفة")
                                    : inv.auditStatus === 'overcharge'
                                    ? t('maritime_freight.job_details_modal.s199', "زيادة غير معتمدة")
                                    : inv.auditStatus === 'approved_override'
                                    ? t('maritime_freight.job_details_modal.s200', "تجاوز معتمد")
                                    : inv.auditStatus === 'disputed'
                                    ? `نزاع مفتوح (${inv.dispute?.disputeNumber || ''})`
                                    : inv.auditStatus === 'undercharge'
                                    ? t('maritime_freight.job_details_modal.s201', "وفر / خصم")
                                    : t('maritime_freight.job_details_modal.s202', "بدون تعرفة")}
                                </span>
                              </td>
                              <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                                  {inv.auditStatus === 'overcharge' && (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => handleOpenOverrideDialog(inv)}
                                        style={{
                                          padding: '2px 8px',
                                          background: '#7e22ce',
                                          color: '#ffffff',
                                          border: 'none',
                                          borderRadius: '4px',
                                          fontSize: '0.68rem',
                                          fontWeight: 700,
                                          cursor: 'pointer',
                                        }}
                                      >
                                        {t('maritime_freight.job_details_modal.s203', "اعتماد تجاوز")}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleOpenDispute(inv)}
                                        style={{
                                          padding: '2px 8px',
                                          background: '#b45309',
                                          color: '#ffffff',
                                          border: 'none',
                                          borderRadius: '4px',
                                          fontSize: '0.68rem',
                                          fontWeight: 700,
                                          cursor: 'pointer',
                                        }}
                                      >
                                        {t('maritime_freight.job_details_modal.s204', "فتح نزاع")}
                                      </button>
                                    </>
                                  )}
                                  {inv.dispute && (
                                    <button
                                      type="button"
                                      onClick={() => printCarrierDisputeNote(job, inv, inv.dispute)}
                                      style={{
                                        padding: '2px 8px',
                                        background: '#0369a1',
                                        color: '#ffffff',
                                        border: 'none',
                                        borderRadius: '4px',
                                        fontSize: '0.68rem',
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                      }}
                                    >
                                      {t('maritime_freight.job_details_modal.s205', "طباعة النزاع")}
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
    </>
  );
}
