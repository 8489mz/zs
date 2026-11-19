import { useTranslation } from 'react-i18next';
import { Dispatch, SetStateAction } from 'react';
import { MaritimeJob } from '../../api/maritime-freight.api';

interface JobOverviewSummaryProps {
  job: MaritimeJob;
  currencySymbol: string;
  trackingUrl: string;
  copiedLink: boolean;
  isSettlingFromBalance: boolean;
  submitOnce: (key: string, action: () => Promise<void>) => Promise<void>;
  handleSettleFromBalance: () => Promise<void>;
  handleOpenEditVoyage: () => void;
  handleCopyTrackingLink: () => void;
  setShowSmartParseModal: Dispatch<SetStateAction<boolean>>;
}

export function JobOverviewSummary({
  job,
  currencySymbol,
  trackingUrl,
  copiedLink,
  isSettlingFromBalance,
  submitOnce,
  handleSettleFromBalance,
  handleOpenEditVoyage,
  handleCopyTrackingLink,
  setShowSmartParseModal,
}: JobOverviewSummaryProps) {
  const { t } = useTranslation();
  return (
    <>
                {/* 1. شريط الإجراءات والموقف المالي الموحد */}
                <div
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    padding: '10px 16px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <div
                      style={{
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontSize: '0.78rem',
                        fontWeight: 800,
                        background: job.payment_status === 'paid' ? '#dcfce7' : job.payment_status === 'partially_paid' ? '#fef3c7' : '#f1f5f9',
                        color: job.payment_status === 'paid' ? '#15803d' : job.payment_status === 'partially_paid' ? '#b45309' : '#64748b',
                      }}
                    >
                      {job.payment_status === 'paid' ? t('maritime_freight.job_details_modal.s21', "مسددة بالكامل") : job.payment_status === 'partially_paid' ? t('maritime_freight.job_details_modal.s22', "مسددة جزئياً") : t('maritime_freight.job_details_modal.s23', "غير مسددة")}
                    </div>
                    <div style={{ fontSize: '0.82rem', color: '#475569' }}>
                      {t('maritime_freight.job_details_modal.s24', "المفوتر:")} <strong style={{ color: '#170e5e', fontSize: '0.9rem' }}>{currencySymbol} {Number(job.client_invoiced_total || 0).toLocaleString()}</strong>
                      {' | '}
                      {t('maritime_freight.job_details_modal.s25', "المسدد:")} <strong style={{ color: '#15803d', fontSize: '0.9rem' }}>{currencySymbol} {Number(job.client_paid_total || 0).toLocaleString()}</strong>
                    </div>

                    {Number(job.customerAvailableCredit || 0) > 0 && job.payment_status !== 'paid' && (
                      <button
                        type="button"
                        onClick={() => submitOnce('settle', handleSettleFromBalance)}
                        disabled={isSettlingFromBalance}
                        style={{
                          padding: '4px 12px',
                          background: '#166534',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '0.76rem',
                          fontWeight: 700,
                          cursor: isSettlingFromBalance ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {isSettlingFromBalance ? t('maritime_freight.job_details_modal.s26', "جاري السداد...") : `سداد من الرصيد (${currencySymbol} ${Number(job.customerAvailableCredit || 0).toLocaleString()})`}
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setShowSmartParseModal(true);
                      }}
                      style={{
                        padding: '6px 14px',
                        background: '#047857',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <span>{t('maritime_freight.job_details_modal.s27', "استخراج ذكي من إيميل الحجز")}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenEditVoyage}
                      style={{
                        padding: '6px 14px',
                        background: '#170e5e',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {t('maritime_freight.job_details_modal.s28', "تعديل بيانات الرحلة والبوالص")}
                    </button>
                  </div>
                </div>

                {/* 2. شبكة البطاقات الأساسية الأربع بتوزيع متزن وحجم مريح (متكيفة مع النمط جوي/بحري) */}
                {job.transport_mode === 'air' ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
                    {/* كارت 1: شركة الطيران ورقم الحجز */}
                    <div style={{ background: '#ffffff', padding: '12px 14px', borderRadius: '10px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
                      <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>{t('maritime_freight.job_details_modal.s29', "شركة الطيران ورقم الحجز")}</div>
                      <div style={{ fontSize: '0.94rem', fontWeight: 800, color: '#0369a1', marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={job.shipping_line_name || ''}>
                        {job.shipping_line_name || t('maritime_freight.job_details_modal.s30', "غير محدد")}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: '#334155', marginTop: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {t('maritime_freight.job_details_modal.s31', "رقم الحجز:")} <strong style={{ color: '#0f172a' }}>{job.booking_number || t('maritime_freight.job_details_modal.s32', "غير مسجل")}</strong>
                      </div>
                    </div>

                    {/* كارت 2: رقم الرحلة وتاريخ الإقلاع */}
                    <div style={{ background: '#ffffff', padding: '12px 14px', borderRadius: '10px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
                      <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>{t('maritime_freight.job_details_modal.s33', "الرحلة الجوية (Flight / Date)")}</div>
                      <div style={{ fontSize: '0.94rem', fontWeight: 800, color: '#170e5e', marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {job.flight_number ? `رحلة: ${job.flight_number}` : t('maritime_freight.job_details_modal.s34', "قيد الجدولة")}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: '#334155', marginTop: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {t('maritime_freight.job_details_modal.s35', "تاريخ:")} <strong>{job.flight_date ? job.flight_date.split('T')[0] : job.etd ? job.etd.split('T')[0] : '—'}</strong> | {job.payment_term || 'prepaid'}
                      </div>
                    </div>

                    {/* كارت 3: بوالص الشحن الجوي AWB */}
                    <div style={{ background: '#ffffff', padding: '12px 14px', borderRadius: '10px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
                      <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>{t('maritime_freight.job_details_modal.s36', "بوالص الشحن الجوي (AWB)")}</div>
                      <div style={{ fontSize: '0.86rem', fontWeight: 700, color: '#0369a1', marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        MAWB: {job.mawb_number || t('maritime_freight.job_details_modal.s37', "قيد الإصدار")}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        HAWB: {job.hawb_number || t('maritime_freight.job_details_modal.s38', "قيد الإصدار")}
                      </div>
                    </div>

                    {/* كارت 4: أوزان الشحن الجوي وفق إياتا */}
                    <div style={{ background: '#ffffff', padding: '12px 14px', borderRadius: '10px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
                      <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>{t('maritime_freight.job_details_modal.s39', "الوزن الخاضع للتحصيل (IATA)")}</div>
                      <div style={{ fontSize: '1rem', fontWeight: 900, color: '#15803d', marginTop: '4px' }}>
                        {Number(job.chargeable_weight_kg || Math.max(job.gross_weight_kg || 0, job.volumetric_weight_kg || 0)).toLocaleString()} {t('maritime_freight.job_details_modal.s40', "كجم")}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '3px' }}>
                        {t('maritime_freight.job_details_modal.s41', "قائم:")} {job.gross_weight_kg || 0} {t('maritime_freight.job_details_modal.s42', "كجم | حجمي:")} {job.volumetric_weight_kg || 0} {t('maritime_freight.job_details_modal.s43', "كجم |")} {job.package_count || 1} {t('maritime_freight.job_details_modal.s44', "طرد")}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
                    {/* كارت 1: الخط الملاحي ورقم الحجز */}
                    <div style={{ background: '#ffffff', padding: '12px 14px', borderRadius: '10px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
                      <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>{t('maritime_freight.job_details_modal.s45', "الخط الملاحي ورقم الحجز")}</div>
                      <div style={{ fontSize: '0.94rem', fontWeight: 800, color: '#170e5e', marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={job.shipping_line_name || ''}>
                        {job.shipping_line_name || t('maritime_freight.job_details_modal.s46', "غير محدد")}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: '#334155', marginTop: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {t('maritime_freight.job_details_modal.s47', "رقم الحجز:")} <strong style={{ color: '#0f172a' }}>{job.booking_number || t('maritime_freight.job_details_modal.s48', "غير مسجل")}</strong>
                      </div>
                    </div>

                    {/* كارت 2: السفينة ورقم الرحلة */}
                    <div style={{ background: '#ffffff', padding: '12px 14px', borderRadius: '10px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
                      <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>{t('maritime_freight.job_details_modal.s49', "السفينة ورقم الرحلة (Vessel / Voyage)")}</div>
                      <div style={{ fontSize: '0.94rem', fontWeight: 800, color: '#170e5e', marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={job.vessel_name || ''}>
                        {job.vessel_name || t('maritime_freight.job_details_modal.s50', "لم تسجل السفينة")}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: '#334155', marginTop: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {t('maritime_freight.job_details_modal.s51', "الرحلة:")} <strong>{job.voyage_number || '-'}</strong> {t('maritime_freight.job_details_modal.s52', "| سداد:")} {job.payment_term || 'prepaid'}
                      </div>
                    </div>

                    {/* كارت 3: مواعيد الإبحار والوصول */}
                    <div style={{ background: '#ffffff', padding: '12px 14px', borderRadius: '10px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
                      <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>{t('maritime_freight.job_details_modal.s53', "مواعيد الإبحار والوصول (ETD / ETA)")}</div>
                      <div style={{ fontSize: '0.84rem', fontWeight: 700, marginTop: '4px', direction: 'ltr', textAlign: 'right' }}>
                        <span style={{ color: '#0369a1' }}>ETD: {job.etd ? job.etd.split('T')[0] : t('maritime_freight.job_details_modal.s54', "قيد الجدولة")}</span>
                        {' → '}
                        <span style={{ color: '#15803d' }}>ETA: {job.eta ? job.eta.split('T')[0] : t('maritime_freight.job_details_modal.s55', "قيد الجدولة")}</span>
                      </div>
                      <div style={{ fontSize: '0.74rem', color: job.port_cut_off ? '#b91c1c' : '#64748b', marginTop: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {job.port_cut_off ? `إغلاق الميناء: ${job.port_cut_off.split('T')[0]}` : t('maritime_freight.job_details_modal.s56', "الميناء مفتوح للتسليم")}
                      </div>
                    </div>

                    {/* كارت 4: بوالص الشحن */}
                    <div style={{ background: '#ffffff', padding: '12px 14px', borderRadius: '10px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
                      <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>{t('maritime_freight.job_details_modal.s57', "بوالص الشحن (B/L Details)")}</div>
                      <div style={{ fontSize: '0.86rem', fontWeight: 700, color: '#170e5e', marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        Master B/L: {job.mbl_number || t('maritime_freight.job_details_modal.s58', "قيد الإصدار")}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        House B/L: {job.hbl_number || t('maritime_freight.job_details_modal.s59', "قيد الإصدار")} ({job.bl_type || 'sea_waybill'})
                      </div>
                    </div>
                  </div>
                )}

                {/* 3. صف بيانات الشاحن والمستلم */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div style={{ background: '#ffffff', padding: '12px 14px', borderRadius: '10px', border: '1px solid #e2e8f0', minHeight: '65px' }}>
                    <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s60', "بيانات الشاحن (Shipper Details)")}</div>
                    <div style={{ fontSize: '0.82rem', color: '#0f172a', marginTop: '3px', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
                      {job.shipper_details || t('maritime_freight.job_details_modal.s61', "غير مسجل")}
                    </div>
                  </div>

                  <div style={{ background: '#ffffff', padding: '12px 14px', borderRadius: '10px', border: '1px solid #e2e8f0', minHeight: '65px' }}>
                    <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s62', "بيانات المستلم (Consignee Details)")}</div>
                    <div style={{ fontSize: '0.82rem', color: '#0f172a', marginTop: '3px', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
                      {job.consignee_details || t('maritime_freight.job_details_modal.s63', "غير مسجل")}
                    </div>
                  </div>
                </div>

                {/* 4. رابط تتبع العميل السحابي المباشر */}
                <div
                  style={{
                    background: '#eff6ff',
                    padding: '10px 14px',
                    borderRadius: '10px',
                    border: '1px solid #bfdbfe',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: '0.76rem', fontWeight: 700, color: '#1e40af' }}>
                      {t('maritime_freight.job_details_modal.s64', "رابط تتبع الشحنة للعميل (أحداث تقديرية مجدولة):")}
                    </div>
                    <div style={{ fontSize: '0.76rem', color: '#475569', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'ltr', textAlign: 'right' }}>
                      {trackingUrl || t('maritime_freight.job_details_modal.s65', "جاري توليد الرابط...")}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyTrackingLink}
                    style={{
                      padding: '5px 14px',
                      background: copiedLink ? '#16a34a' : '#170e5e',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    {copiedLink ? t('maritime_freight.job_details_modal.s66', "تم النسخ!") : t('maritime_freight.job_details_modal.s67', "نسخ الرابط")}
                  </button>
                </div>
    </>
  );
}
