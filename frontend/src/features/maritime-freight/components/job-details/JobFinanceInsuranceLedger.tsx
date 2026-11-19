import { useTranslation } from 'react-i18next';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { useSystemCurrency } from '@/shared/hooks/use-system-currency';
import { CargoInsurance, MaritimeJob } from '../../api/maritime-freight.api';
import { printCargoInsuranceCertificate } from '../../utils/maritime-documents';

interface JobFinanceInsuranceLedgerProps {
  job: MaritimeJob;
  insurancesList: CargoInsurance[];
  loadingInsurances: boolean;
  ledgerEntries: any[];
  loadingLedger: boolean;
  setShowAddInsuranceDialog: (value: boolean) => void;
  handleOpenClaim: (ins: CargoInsurance) => void;
}

export function JobFinanceInsuranceLedger({
  job,
  insurancesList,
  loadingInsurances,
  ledgerEntries,
  loadingLedger,
  setShowAddInsuranceDialog,
  handleOpenClaim,
}: JobFinanceInsuranceLedgerProps) {
  const { t } = useTranslation();
  const { currencySymbol } = useSystemCurrency();

  return (
    <>
                  {/* 2.8. وثائق تأمين البضائع ومطالبات التعويض (Cargo Insurance Policies & Claims) */}
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
                        <AppIcons.CheckShield size={18} />
                        <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#170e5e' }}>
                          {t('maritime_freight.job_details_modal.s206', "وثائق تأمين البضائع ومطالبات التعويض (Cargo Insurance & Claims)")}
                        </span>
                        <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', background: '#ecfdf5', color: '#047857' }}>
                          {insurancesList.length} {t('maritime_freight.job_details_modal.s207', "وثائق")}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowAddInsuranceDialog(true)}
                        style={{
                          padding: '4px 10px',
                          background: '#166534',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {t('maritime_freight.job_details_modal.s208', "+ إصدار وثيقة تأمين")}
                      </button>
                    </div>

                    {loadingInsurances ? (
                      <div style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: '0.8rem' }}>
                        {t('maritime_freight.job_details_modal.s209', "جاري تحميل وثائق التأمين...")}
                      </div>
                    ) : insurancesList.length === 0 ? (
                      <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: '0.78rem' }}>
                        {t('maritime_freight.job_details_modal.s210', "لم يتم تسجيل وثائق تأمين لهذه الشحنة بعد. انقر على \"+ إصدار وثيقة تأمين\" لتسجيل بوليصة التأمين البحري أو الجوي وتغطية المخاطر.")}
                      </div>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                        <thead>
                          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'right' }}>
                            <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s211', "رقم الوثيقة")}</th>
                            <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s212', "شركة التأمين")}</th>
                            <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s213', "نوع التغطية")}</th>
                            <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s214', "القيمة المؤمنة")}</th>
                            <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s215', "القسط التأميني")}</th>
                            <th style={{ padding: '8px 12px', fontWeight: 700, textAlign: 'center' }}>{t('maritime_freight.job_details_modal.s216', "الحالة")}</th>
                            <th style={{ padding: '8px 12px', fontWeight: 700, textAlign: 'center' }}>{t('maritime_freight.job_details_modal.s217', "الإجراءات")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {insurancesList.map((ins) => (
                            <tr key={ins.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <td style={{ padding: '8px 12px', fontWeight: 800, fontFamily: 'monospace', color: '#0f172a' }}>
                                {ins.policy_number}
                              </td>
                              <td style={{ padding: '8px 12px', color: '#334155', fontWeight: 600 }}>
                                {ins.insurance_company}
                              </td>
                              <td style={{ padding: '8px 12px', color: '#64748b' }}>
                                {ins.coverage_type === 'all_risks' ? t('maritime_freight.job_details_modal.s218', "شامل All Risks") : ins.coverage_type === 'clauses_a' ? t('maritime_freight.job_details_modal.s219', "شروط أ (ICC-A)") : ins.coverage_type === 'clauses_b' ? t('maritime_freight.job_details_modal.s220', "شروط ب (ICC-B)") : t('maritime_freight.job_details_modal.s221', "شروط ج (ICC-C)")}
                              </td>
                              <td style={{ padding: '8px 12px', fontWeight: 800, color: '#15803d' }}>
                                {ins.currency} {Number(ins.insured_value).toLocaleString()}
                              </td>
                              <td style={{ padding: '8px 12px', fontWeight: 700, color: '#b91c1c' }}>
                                {ins.currency} {Number(ins.premium_amount).toLocaleString()}
                              </td>
                              <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                <span
                                  style={{
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    fontSize: '0.7rem',
                                    fontWeight: 700,
                                    background:
                                      ins.status === 'active'
                                        ? '#dcfce7'
                                        : ins.status === 'claimed'
                                        ? '#fef3c7'
                                        : ins.status === 'expired'
                                        ? '#fee2e2'
                                        : '#f1f5f9',
                                    color:
                                      ins.status === 'active'
                                        ? '#15803d'
                                        : ins.status === 'claimed'
                                        ? '#b45309'
                                        : ins.status === 'expired'
                                        ? '#b91c1c'
                                        : '#64748b',
                                  }}
                                >
                                  {ins.status === 'active'
                                    ? t('maritime_freight.job_details_modal.s222', "سارية")
                                    : ins.status === 'claimed'
                                    ? `مطالبة (${ins.currency} ${Number(ins.claim_amount || 0).toLocaleString()})`
                                    : ins.status === 'expired'
                                    ? t('maritime_freight.job_details_modal.s223', "منتهية")
                                    : t('maritime_freight.job_details_modal.s224', "مسودة")}
                                </span>
                              </td>
                              <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                                  <button
                                    type="button"
                                    onClick={() => printCargoInsuranceCertificate(job, ins)}
                                    style={{
                                      padding: '2px 8px',
                                      background: '#170e5e',
                                      color: '#ffffff',
                                      border: 'none',
                                      borderRadius: '4px',
                                      fontSize: '0.68rem',
                                      fontWeight: 700,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    {t('maritime_freight.job_details_modal.s225', "طباعة الشهادة")}
                                  </button>
                                  {ins.status === 'active' && (
                                    <button
                                      type="button"
                                      onClick={() => handleOpenClaim(ins)}
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
                                      {t('maritime_freight.job_details_modal.s226', "تسجيل مطالبة")}
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

                  {/* 3. بطاقة تكامل دليل الحسابات ومراكز التكلفة */}
                  <div
                    style={{
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '10px',
                      padding: '12px 16px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '12px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '8px',
                          background: '#eff6ff',
                          color: '#1e40af',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 800,
                          fontSize: '0.78rem',
                          flexShrink: 0,
                        }}
                      >
                        GL
                      </div>
                      <div>
                        <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#170e5e' }}>
                          {job.cost_center_id ? `مركز تكلفة #${job.cost_center_id} (${job.job_number})` : `مركز تكلفة ملاحي #${job.job_number}`}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '1px' }}>
                          {t('maritime_freight.job_details_modal.s227', "مربوط بدليل الحسابات العام (شجرة الحسابات ← مراكز تكلفة الشحن واللوجستيات)")}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{
                          padding: '3px 10px',
                          background: '#f0fdf4',
                          color: '#166534',
                          border: '1px solid #bbf7d0',
                          borderRadius: '20px',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                        }}
                      >
                        {t('maritime_freight.job_details_modal.s228', "الترحيل الآلي للقيود مفعل")}
                      </span>
                      <span
                        style={{
                          padding: '3px 10px',
                          background: '#f8fafc',
                          color: '#475569',
                          border: '1px solid #e2e8f0',
                          borderRadius: '20px',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                        }}
                      >
                        {job.payment_term === 'prepaid' ? t('maritime_freight.job_details_modal.s229', "سداد مسبق (Prepaid)") : t('maritime_freight.job_details_modal.s230', "تحصيل بميناء الوصول (Collect)")}
                      </span>
                    </div>
                  </div>

                  {/* 4. قيود اليومية المحاسبية المعتمدة (Live GL Entries) */}
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
                        padding: '8px 14px',
                        background: '#f8fafc',
                        borderBottom: '1px solid #e2e8f0',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0f172a' }}>
                        {t('maritime_freight.job_details_modal.s231', "سجل قيود اليومية المحاسبية المعتمدة للعملية (General Ledger)")}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: ledgerEntries.length > 0 ? '#15803d' : '#64748b', fontWeight: 700 }}>
                        {loadingLedger
                          ? t('maritime_freight.job_details_modal.s232', "جاري تحميل القيود...")
                          : ledgerEntries.length > 0
                          ? `قيود معتمدة (${ledgerEntries.length} حركة)`
                          : t('maritime_freight.job_details_modal.s233', "لا توجد قيود مرحلة بعد")}
                      </div>
                    </div>

                    {ledgerEntries.length > 0 ? (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                        <thead>
                          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'right' }}>
                            <th style={{ padding: '6px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s234', "رقم القيد والتاريخ")}</th>
                            <th style={{ padding: '6px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s235', "الحساب المحاسبي")}</th>
                            <th style={{ padding: '6px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s236', "البيان / الوصف")}</th>
                            <th style={{ padding: '6px 12px', fontWeight: 700, color: '#15803d' }}>{t('maritime_freight.job_details_modal.s237', "مدين (Debit)")}</th>
                            <th style={{ padding: '6px 12px', fontWeight: 700, color: '#b91c1c' }}>{t('maritime_freight.job_details_modal.s238', "دائن (Credit)")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ledgerEntries.map((row: any, i: number) => (
                            <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <td style={{ padding: '6px 12px', fontWeight: 700, color: '#170e5e' }}>
                                <div>{row.entry_no}</div>
                                <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>
                                  {row.entry_date ? new Date(row.entry_date).toLocaleDateString('ar-EG') : '-'}
                                </div>
                              </td>
                              <td style={{ padding: '6px 12px', color: '#0f172a' }}>
                                <span style={{ fontWeight: 700 }}>[{row.account_code}]</span> {row.account_name}
                              </td>
                              <td style={{ padding: '6px 12px', color: '#475569' }}>
                                {row.line_description || row.entry_description}
                              </td>
                              <td style={{ padding: '6px 12px', fontWeight: 700, color: Number(row.debit) > 0 ? '#15803d' : '#94a3b8' }}>
                                {Number(row.debit) > 0 ? `${currencySymbol} ${Number(row.debit).toLocaleString()}` : '-'}
                              </td>
                              <td style={{ padding: '6px 12px', fontWeight: 700, color: Number(row.credit) > 0 ? '#b91c1c' : '#94a3b8' }}>
                                {Number(row.credit) > 0 ? `${currencySymbol} ${Number(row.credit).toLocaleString()}` : '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div style={{ padding: '16px', textAlign: 'center', color: '#94a3b8', fontSize: '0.78rem' }}>
                        {t('maritime_freight.job_details_modal.s239', "اضغط على \"إصدار فاتورة مبيعات\" أو \"تسجيل سند مصروفات\" لترحيل القيود لمركز تكلفة الشحنة.")}
                      </div>
                    )}
                  </div>
    </>
  );
}
