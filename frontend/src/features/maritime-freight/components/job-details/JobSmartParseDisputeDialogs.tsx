import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Field } from '@/shared/ui/field';
import { useAuthStore } from '@/stores/auth-store';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { maritimeApi, MaritimeJob, MaritimeCarrierInvoice } from '../../api/maritime-freight.api';
import { toast } from '@/shared/components/system-alert';
import { CustomsDeclarationModal } from '../CustomsDeclarationModal';

export interface JobSmartParseDisputeDialogsProps {
  job: MaritimeJob;
  showSmartParseModal: boolean;
  setShowSmartParseModal: (value: boolean) => void;
  showDisputeDialog: boolean;
  setShowDisputeDialog: (value: boolean) => void;
  disputeInvoice: MaritimeCarrierInvoice | null;
  disputeAmountInput: string;
  setDisputeAmountInput: (value: string) => void;
  disputeReasonInput: string;
  setDisputeReasonInput: (value: string) => void;
  showOverrideDialog: boolean;
  setShowOverrideDialog: (value: boolean) => void;
  overrideInvoice: MaritimeCarrierInvoice | null;
  setOverrideInvoice: (value: MaritimeCarrierInvoice | null) => void;
  overrideReasonInput: string;
  setOverrideReasonInput: (value: string) => void;
  showCustomsModal: boolean;
  setShowCustomsModal: (value: boolean) => void;
  fetchJob: () => Promise<void>;
  fetchLedger: (id: string) => Promise<void>;
  fetchCarrierInvoices: (id: string) => Promise<void>;
  submitOnce: (key: string, action: () => Promise<void>) => Promise<void>;
  onUpdated: () => void;
}

export function JobSmartParseDisputeDialogs({
  job,
  showSmartParseModal,
  setShowSmartParseModal,
  showDisputeDialog,
  setShowDisputeDialog,
  disputeInvoice,
  disputeAmountInput,
  setDisputeAmountInput,
  disputeReasonInput,
  setDisputeReasonInput,
  showOverrideDialog,
  setShowOverrideDialog,
  overrideInvoice,
  setOverrideInvoice,
  overrideReasonInput,
  setOverrideReasonInput,
  showCustomsModal,
  setShowCustomsModal,
  fetchJob,
  fetchLedger,
  fetchCarrierInvoices,
  submitOnce,
  onUpdated,
}: JobSmartParseDisputeDialogsProps) {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const [smartParseText, setSmartParseText] = useState('');
  const [isParsingSmartBooking, setIsParsingSmartBooking] = useState(false);
  const [parsedBookingData, setParsedBookingData] = useState<any | null>(null);
  const [isApplyingParsedData, setIsApplyingParsedData] = useState(false);
  const [isSubmittingDispute, setIsSubmittingDispute] = useState(false);
  const [isSubmittingOverride, setIsSubmittingOverride] = useState(false);

  const handleConfirmDispute = async () => {
    if (!disputeInvoice || !job) return;
    const amount = Number(disputeAmountInput);
    if (!amount || amount <= 0) {
      toast.warning('يرجى تحديد مبلغ النزاع');
      return;
    }
    try {
      setIsSubmittingDispute(true);
      const res = await maritimeApi.createCarrierDispute(disputeInvoice.id, {
        reason: disputeReasonInput,
        disputedAmount: amount,
      });
      toast.success(res.message || 'تم إنشاء مذكرة النزاع وحجز الفاتورة عن الصرف بنجاح');
      setShowDisputeDialog(false);
      await fetchCarrierInvoices(String(job.id));
      onUpdated();
    } catch (err: any) {
      toast.error(err?.message || 'فشل إنشاء مذكرة النزاع');
    } finally {
      setIsSubmittingDispute(false);
    }
  };

  const handleConfirmOverride = async () => {
    if (!overrideInvoice || !job) return;

    if (user?.id && overrideInvoice.createdBy && String(user.id) === String(overrideInvoice.createdBy)) {
      toast.error('لا يمكنك اعتماد التجاوز المالي بنفسك (يجب أن يعتمد الفاتورة مسؤول مالي آخر تطبيقاً لمبدأ فصل المهام Maker-Checker)');
      return;
    }

    if (!overrideReasonInput.trim()) {
      toast.warning('يجب إدخال مبرر مالي لاعتماد التجاوز');
      return;
    }

    try {
      setIsSubmittingOverride(true);
      const res = await maritimeApi.overrideCarrierInvoice(overrideInvoice.id, overrideReasonInput.trim());
      toast.success(res.message || 'تم اعتماد التجاوز وترحيل القيد بنجاح');
      setShowOverrideDialog(false);
      setOverrideInvoice(null);
      await fetchJob();
      await fetchLedger(String(job.id));
      await fetchCarrierInvoices(String(job.id));
      onUpdated();
    } catch (err: any) {
      const errMsg = err?.data?.message || err?.message || 'فشل اعتماد التجاوز';
      toast.error(errMsg);
    } finally {
      setIsSubmittingOverride(false);
    }
  };

  const handleParseBookingEmail = async () => {
    if (!smartParseText.trim()) {
      toast.warning('يرجى لصق نص إيميل أو تأكيد الحجز أولاً');
      return;
    }
    try {
      setIsParsingSmartBooking(true);
      const res = await maritimeApi.parseBookingText(smartParseText);
      setParsedBookingData(res);
      toast.success('تم استخراج بيانات الحجز والرحلة بنجاح. يرجى مراجعتها واعتمادها');
    } catch (err: any) {
      toast.error(err?.message || 'تعذر استخراج بيانات الحجز');
    } finally {
      setIsParsingSmartBooking(false);
    }
  };

  const handleApplyParsedBooking = async () => {
    if (!job?.id || !parsedBookingData) return;
    try {
      setIsApplyingParsedData(true);
      const updatePayload: any = {};
      if (parsedBookingData.bookingNumber) updatePayload.bookingNumber = parsedBookingData.bookingNumber;
      if (parsedBookingData.vesselName) updatePayload.vesselName = parsedBookingData.vesselName;
      if (parsedBookingData.voyageNumber) updatePayload.voyageNumber = parsedBookingData.voyageNumber;
      if (parsedBookingData.etd) updatePayload.etd = parsedBookingData.etd;
      if (parsedBookingData.eta) updatePayload.eta = parsedBookingData.eta;
      if (parsedBookingData.portCutOff) updatePayload.portCutOff = parsedBookingData.portCutOff;
      if (parsedBookingData.mblNumber) updatePayload.mblNumber = parsedBookingData.mblNumber;
      if (parsedBookingData.shippingLineName) updatePayload.shippingLineName = parsedBookingData.shippingLineName;

      await maritimeApi.updateJob(String(job.id), updatePayload);

      // Auto add containers if found
      if (parsedBookingData.containers && parsedBookingData.containers.length > 0) {
        for (const c of parsedBookingData.containers) {
          try {
            await maritimeApi.createContainer({
              jobId: String(job.id),
              containerNumber: c.containerNumber,
              containerType: c.containerType || '40HC',
              freeDays: 14,
            });
          } catch {
            // ignore duplicates
          }
        }
      }

      toast.success('تم اعتماد وتحديث بيانات الحجز والرحلة بنجاح');
      setShowSmartParseModal(false);
      setSmartParseText('');
      setParsedBookingData(null);
      await fetchJob();
      onUpdated();
    } catch (err: any) {
      toast.error(err?.message || 'تعذر تحديث بيانات الحجز');
    } finally {
      setIsApplyingParsedData(false);
    }
  };
  return (
    <>
      {showSmartParseModal && (
        <StandardDialog
          open={showSmartParseModal}
          onClose={() => {
            setShowSmartParseModal(false);
            setParsedBookingData(null);
          }}
          title={t('maritime_freight.job_details_modal.s321', "الاستخراج والتحليل الذكي لبيانات الحجز الملاحي")}
          subtitle={`العملية: ${job.job_number} | يدعم Maersk, MSC, CMA CGM, Hapag-Lloyd, Cosco, Evergreen والخطوط العالمية`}
          width="min(720px, 95vw)"
          footerActions={
            parsedBookingData ? (
              <StandardDialogFooter
                onSubmit={() => submitOnce('apply-booking', handleApplyParsedBooking)}
                submitText={isApplyingParsedData ? t('maritime_freight.job_details_modal.s322', "جاري الاعتماد...") : t('maritime_freight.job_details_modal.s323', "اعتماد وملء بيانات الحجز بالشحنة")}
                isSubmitting={isApplyingParsedData}
                onCancel={() => {
                  setShowSmartParseModal(false);
                  setParsedBookingData(null);
                }}
                cancelText={t('maritime_freight.job_details_modal.s324', "إلغاء")}
              />
            ) : undefined
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }} dir="rtl">
            <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.78rem', color: '#334155', lineHeight: 1.6 }}>
              {t('maritime_freight.job_details_modal.s325', "انسخ نص إيميل تأكيد الحجز (Booking Confirmation) المستلم من الخط الملاحي أو الوكيل والصقه في الحقل أدناه. سيقوم الذكاء الاصطناعي ومحلل النصوص باستخراج رقم الحجز، اسم السفينة، رقم الرحلة، تواريخ ETD / ETA، موعد Cut-off، ورقم البوليصة والحاويات تمهيداً لمراجعتها واعتمادها بنقرة واحدة.")}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('maritime_freight.job_details_modal.s326', "نص تأكيد الحجز أو محتوى الإيميل الملاحي *")}
              </label>
              <textarea
                rows={6}
                value={smartParseText}
                onChange={(e) => setSmartParseText(e.target.value)}
                placeholder={t('maritime_freight.job_details_modal.s327', "الصق نص إيميل تأكيد الحجز هنا (مثال: Booking Confirmation: MSK12345678, Vessel: MAERSK MC-KINNEY MOLLER, Voyage: 2401E, ETD: 2026-09-20, ETA: 2026-10-05, Port Cut-off: 2026-09-18, Containers: MSKU1234567, MSKU7654321)...")}
                style={{
                  width: '100%',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  padding: '10px 12px',
                  fontSize: '0.82rem',
                  fontFamily: 'monospace',
                  lineHeight: 1.5,
                  resize: 'vertical',
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <button
                type="button"
                onClick={handleParseBookingEmail}
                disabled={isParsingSmartBooking || !smartParseText.trim()}
                style={{
                  padding: '8px 20px',
                  background: '#170e5e',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: isParsingSmartBooking || !smartParseText.trim() ? 'not-allowed' : 'pointer',
                  opacity: isParsingSmartBooking || !smartParseText.trim() ? 0.6 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <AppIcons.Search size={15} />
                {isParsingSmartBooking ? t('maritime_freight.job_details_modal.s328', "جاري التحليل والاستخراج...") : t('maritime_freight.job_details_modal.s329', "تحليل واستخراج البيانات")}
              </button>
            </div>

            {/* Results Preview Card */}
            {parsedBookingData && (
              <div
                style={{
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: '10px',
                  padding: '14px 16px',
                  marginTop: '4px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <span style={{ fontSize: '0.84rem', fontWeight: 800, color: '#166534' }}>
                    {t('maritime_freight.job_details_modal.s330', "نتائج الاستخراج المكتشفة من نص الحجز:")}
                  </span>
                  {parsedBookingData.shippingLineName && (
                    <span style={{ padding: '3px 10px', background: '#dcfce7', color: '#15803d', borderRadius: '6px', fontSize: '0.74rem', fontWeight: 700 }}>
                      {t('maritime_freight.job_details_modal.s331', "الخط المكتشف:")} {parsedBookingData.shippingLineName}
                    </span>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                  <div style={{ background: '#ffffff', padding: '8px 12px', borderRadius: '6px', border: '1px solid #dcfce7' }}>
                    <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{t('maritime_freight.job_details_modal.s332', "رقم الحجز (Booking No)")}</div>
                    <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#170e5e' }}>{parsedBookingData.bookingNumber || '—'}</div>
                  </div>

                  <div style={{ background: '#ffffff', padding: '8px 12px', borderRadius: '6px', border: '1px solid #dcfce7' }}>
                    <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{t('maritime_freight.job_details_modal.s333', "السفينة والرحلة (Vessel / Voyage)")}</div>
                    <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#170e5e' }}>
                      {parsedBookingData.vesselName || '—'} {parsedBookingData.voyageNumber ? ` / ${parsedBookingData.voyageNumber}` : ''}
                    </div>
                  </div>

                  <div style={{ background: '#ffffff', padding: '8px 12px', borderRadius: '6px', border: '1px solid #dcfce7' }}>
                    <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{t('maritime_freight.job_details_modal.s334', "تاريخ الإبحار (ETD)")}</div>
                    <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#170e5e' }}>{parsedBookingData.etd || '—'}</div>
                  </div>

                  <div style={{ background: '#ffffff', padding: '8px 12px', borderRadius: '6px', border: '1px solid #dcfce7' }}>
                    <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{t('maritime_freight.job_details_modal.s335', "تاريخ الوصول (ETA)")}</div>
                    <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#170e5e' }}>{parsedBookingData.eta || '—'}</div>
                  </div>

                  <div style={{ background: '#ffffff', padding: '8px 12px', borderRadius: '6px', border: '1px solid #dcfce7' }}>
                    <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{t('maritime_freight.job_details_modal.s336', "إغلاق الميناء (Cut-Off)")}</div>
                    <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#b91c1c' }}>{parsedBookingData.portCutOff || '—'}</div>
                  </div>

                  <div style={{ background: '#ffffff', padding: '8px 12px', borderRadius: '6px', border: '1px solid #dcfce7' }}>
                    <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{t('maritime_freight.job_details_modal.s337', "بوليصة الشحن (MBL)")}</div>
                    <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#170e5e' }}>{parsedBookingData.mblNumber || '—'}</div>
                  </div>
                </div>

                {parsedBookingData.containers && parsedBookingData.containers.length > 0 && (
                  <div style={{ marginTop: '12px', background: '#ffffff', padding: '10px 12px', borderRadius: '6px', border: '1px solid #dcfce7' }}>
                    <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#166534', marginBottom: '6px' }}>
                      {t('maritime_freight.job_details_modal.s338', "الحاويات المكتشفة (")}{parsedBookingData.containers.length} {t('maritime_freight.job_details_modal.s339', "حاوية):")}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {parsedBookingData.containers.map((cnt: any, idx: number) => (
                        <span
                          key={idx}
                          style={{
                            padding: '4px 10px',
                            background: '#f1f5f9',
                            border: '1px solid #cbd5e1',
                            borderRadius: '6px',
                            fontSize: '0.78rem',
                            fontWeight: 800,
                            color: '#1e293b',
                          }}
                        >
                          {cnt.containerNumber} ({cnt.containerType || "40' HC"})
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </StandardDialog>
      )}

      {/* Modal 7: Carrier Rate Dispute Dialog */}
      {showDisputeDialog && disputeInvoice && job && (
        <StandardDialog
          open={showDisputeDialog}
          onClose={() => setShowDisputeDialog(false)}
          title={t('maritime_freight.job_details_modal.s340', "إصدار مذكرة نزاع مالي مع الخط الملاحي")}
          subtitle={`العملية: ${job.job_number} | الفاتورة: #${disputeInvoice.invoiceNumber}`}
          width="min(560px, 95vw)"
          minHeight="min(440px, 80vh)"
          footerActions={(
            <StandardDialogFooter
              onSubmit={() => submitOnce('dispute', handleConfirmDispute)}
              submitText={isSubmittingDispute ? t('maritime_freight.job_details_modal.s341', "جاري الإصدار...") : t('maritime_freight.job_details_modal.s342', "إصدار مذكرة النزاع وحجز الفاتورة")}
              isSubmitting={isSubmittingDispute}
              onCancel={() => setShowDisputeDialog(false)}
              cancelText={t('maritime_freight.job_details_modal.s343', "إلغاء")}
            />
          )}
        >
          <div className="job-submodal-compact" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }} dir="rtl">
            <div style={{ background: '#fef2f2', padding: '10px 14px', borderRadius: '8px', border: '1px solid #fecaca', fontSize: '0.78rem', color: '#991b1b', lineHeight: 1.5 }}>
              {t('maritime_freight.job_details_modal.s344', "سيتم إنشاء مذكرة نزاع رسمي للخط الملاحي (Carrier Dispute Note) برقم موحد، وحجز صرف الفاتورة حتى ورود إشعار دائن (Credit Note) بالمبلغ الزائد.")}
            </div>

            <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <Field label={`المبلغ المتنازع عليه (${disputeInvoice.currency}) *`}>
                <input
                  type="number"
                  value={disputeAmountInput}
                  onChange={(e) => setDisputeAmountInput(e.target.value)}
                  style={{ fontWeight: 800, color: '#b91c1c' }}
                />
              </Field>

              <Field label={t('maritime_freight.job_details_modal.s345', "سبب النزاع والتفاصيل *")}>
                <textarea
                  value={disputeReasonInput}
                  onChange={(e) => setDisputeReasonInput(e.target.value)}
                  rows={3}
                  style={{ width: '100%', padding: '8px 10px', fontSize: '0.78rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                />
              </Field>
            </div>
          </div>
        </StandardDialog>
      )}

      {/* Modal 8: Carrier Invoice Override Dialog */}
      {showOverrideDialog && overrideInvoice && job && (
        <StandardDialog
          open={showOverrideDialog}
          onClose={() => {
            setShowOverrideDialog(false);
            setOverrideInvoice(null);
          }}
          title={t('maritime_freight.job_details_modal.s346', "اعتماد التجاوز المالي لفاتورة الخط الملاحي")}
          subtitle={`العملية: ${job.job_number} | الفاتورة: #${overrideInvoice.invoiceNumber}`}
          width="min(560px, 95vw)"
          minHeight="min(460px, 80vh)"
          footerActions={(
            <StandardDialogFooter
              onSubmit={() => submitOnce('override', handleConfirmOverride)}
              submitText={isSubmittingOverride ? t('maritime_freight.job_details_modal.s347', "جاري الاعتماد...") : t('maritime_freight.job_details_modal.s348', "اعتماد التجاوز وترحيل القيد")}
              isSubmitting={isSubmittingOverride}
              disabled={Boolean(user?.id && overrideInvoice.createdBy && String(user.id) === String(overrideInvoice.createdBy))}
              onCancel={() => {
                setShowOverrideDialog(false);
                setOverrideInvoice(null);
              }}
              cancelText={t('maritime_freight.job_details_modal.s349', "إلغاء")}
            />
          )}
        >
          <div className="job-submodal-compact" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }} dir="rtl">
            {user?.id && overrideInvoice.createdBy && String(user.id) === String(overrideInvoice.createdBy) ? (
              <div style={{ background: '#fef2f2', padding: '12px 14px', borderRadius: '8px', border: '1px solid #fecaca', fontSize: '0.78rem', color: '#991b1b', lineHeight: 1.5, fontWeight: 700 }}>
                {t('maritime_freight.job_details_modal.s350', "حظر رقابي (فصل المهام Maker-Checker): لقد قمت أنت بتسجيل هذه الفاتورة. يمنع النظام اعتماد التجاوز المالي بواسطة نفس المستخدم. يجب أن يقوم مسؤول مالي أو مدير نظام آخر بمراجعتها واعتمادها.")}
              </div>
            ) : (
              <div style={{ background: '#f5f3ff', padding: '10px 14px', borderRadius: '8px', border: '1px solid #ddd6fe', fontSize: '0.78rem', color: '#6b21a8', lineHeight: 1.5 }}>
                {t('maritime_freight.job_details_modal.s351', "سيتم اعتماد التجاوز المالي وترحيل القيد المحاسبي المزدوج في الأستاذ العام وتحديث تكلفة العملية، مع توثيق هوية المعتمد والمبرر في سجل التدقيق.")}
              </div>
            )}

            <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.78rem' }}>
                <div>
                  <span style={{ color: '#64748b' }}>{t('maritime_freight.job_details_modal.s352', "المبلغ المفوتر:")} </span>
                  <strong style={{ color: '#b91c1c' }}>{overrideInvoice.currency} {Number(overrideInvoice.totalInvoicedAmount).toLocaleString()}</strong>
                </div>
                <div>
                  <span style={{ color: '#64748b' }}>{t('maritime_freight.job_details_modal.s353', "التعرفة المتعاقد عليها:")} </span>
                  <strong style={{ color: '#166534' }}>{overrideInvoice.currency} {Number(overrideInvoice.contractedAmount).toLocaleString()}</strong>
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <span style={{ color: '#64748b' }}>{t('maritime_freight.job_details_modal.s354', "الزيادة غير المتفق عليها:")} </span>
                  <strong style={{ color: '#dc2626' }}>+{overrideInvoice.currency} {Number(overrideInvoice.varianceAmount).toLocaleString()} (+{overrideInvoice.variancePct}%)</strong>
                </div>
              </div>

              <Field label={t('maritime_freight.job_details_modal.s355', "المبرر المالي لاعتماد التجاوز (10 أحرف على الأقل) *")}>
                <textarea
                  value={overrideReasonInput}
                  onChange={(e) => setOverrideReasonInput(e.target.value)}
                  placeholder={t('maritime_freight.job_details_modal.s356', "مثال: تم قبول الزيادة بعد التحقق من إيميل الخط الملاحي بخصوص رسوم التكدس الطارئة بالميناء وموافقة العميل...")}
                  rows={3}
                  disabled={Boolean(user?.id && overrideInvoice.createdBy && String(user.id) === String(overrideInvoice.createdBy))}
                  style={{ width: '100%', padding: '8px 10px', fontSize: '0.78rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                />
              </Field>
            </div>
          </div>
        </StandardDialog>
      )}

      {showCustomsModal && job && (
        <CustomsDeclarationModal
          open={showCustomsModal}
          onClose={() => setShowCustomsModal(false)}
          jobId={job.id}
          jobNumber={job.job_number}
        />
      )}
    </>
  );
}
