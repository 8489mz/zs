import { Dispatch, SetStateAction, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { useSystemCurrency } from '@/shared/hooks/use-system-currency';
import { maritimeApi, FreightAuditPreview, MaritimeJob } from '../../api/maritime-freight.api';
import { toast } from '@/shared/components/system-alert';

interface JobMoneyDialogsProps {
  job: MaritimeJob;
  showInvoiceDialog: boolean;
  setShowInvoiceDialog: Dispatch<SetStateAction<boolean>>;
  showExpenseDialog: boolean;
  setShowExpenseDialog: Dispatch<SetStateAction<boolean>>;
  fetchJob: (specificId?: string) => Promise<void>;
  fetchLedger: (id: string) => Promise<void>;
  fetchCarrierInvoices: (id: string) => Promise<void>;
  onUpdated: () => void;
  submitOnce: (key: string, action: () => Promise<void>) => Promise<void>;
}

export function JobMoneyDialogs({
  job,
  showInvoiceDialog,
  setShowInvoiceDialog,
  showExpenseDialog,
  setShowExpenseDialog,
  fetchJob,
  fetchLedger,
  fetchCarrierInvoices,
  onUpdated,
  submitOnce,
}: JobMoneyDialogsProps) {
  const { t } = useTranslation();
  const { currencyCode, currencySymbol } = useSystemCurrency();

  const [invoiceAmountInput, setInvoiceAmountInput] = useState(String(job.client_invoiced_total || ''));
  const [invoiceNotesInput, setInvoiceNotesInput] = useState(`فاتورة مبيعات خدمات ملاحية - العملية #${job.job_number} (${job.customer_name})`);
  const [isSubmittingInvoice, setIsSubmittingInvoice] = useState(false);
  const [expenseAmountInput, setExpenseAmountInput] = useState('');
  const [expenseTypeInput, setExpenseTypeInput] = useState<'carrier' | 'port' | 'other'>('carrier');
  const [expensePaymentMethodInput, setExpensePaymentMethodInput] = useState<'payable' | 'cash' | 'bank'>('payable');
  const [expenseNotesInput, setExpenseNotesInput] = useState(`فاتورة نولون ومصروفات الخط الملاحي - العملية #${job.job_number}`);
  const [isSubmittingExpense, setIsSubmittingExpense] = useState(false);
  const [carrierInvoiceNumber, setCarrierInvoiceNumber] = useState('');
  const [carrierAuditPreview, setCarrierAuditPreview] = useState<FreightAuditPreview | null>(null);

  useEffect(() => {
    if (showExpenseDialog && expenseTypeInput === 'carrier' && job) {
      const amount = Number(expenseAmountInput);
      if (amount > 0) {
        const timer = setTimeout(async () => {
          try {
            const preview = await maritimeApi.previewCarrierInvoiceAudit(job.id, {
              invoicedTotal: amount,
              shippingLineId: job.shipping_line_id,
              currency: currencyCode,
            });
            setCarrierAuditPreview(preview);
          } catch {
            setCarrierAuditPreview(null);
          }
        }, 300);
        return () => clearTimeout(timer);
      } else {
        setCarrierAuditPreview(null);
      }
    } else {
      setCarrierAuditPreview(null);
    }
  }, [showExpenseDialog, expenseTypeInput, expenseAmountInput, job?.id, currencyCode]);

  const handleConfirmIssueInvoice = async () => {
    if (!job) return;
    const amount = Number(invoiceAmountInput);
    if (!amount || amount <= 0) {
      toast.warning('يرجى إدخال مبلغ صالح للفاتورة أكبر من صفر');
      return;
    }
    try {
      setIsSubmittingInvoice(true);
      const res = await maritimeApi.issueJobSalesInvoice(job.id, {
        amount,
        notes: invoiceNotesInput,
      });
      toast.success(res.message || `تم إصدار وترحيل فاتورة المبيعات للعملية #${job.job_number} بقيمة ${amount} بنجاح`);
      setShowInvoiceDialog(false);
      await fetchJob();
      await fetchLedger(String(job.id));
      onUpdated();
    } catch (err: any) {
      toast.error(err?.message || 'فشل إصدار فاتورة المبيعات');
    } finally {
      setIsSubmittingInvoice(false);
    }
  };

  const handleConfirmRecordExpense = async () => {
    if (!job) return;
    const amount = Number(expenseAmountInput);
    if (!amount || amount <= 0) {
      toast.warning('يرجى إدخال مبلغ صالح للمصروف أكبر من صفر');
      return;
    }

    if (expenseTypeInput === 'carrier' && !carrierInvoiceNumber.trim()) {
      toast.warning('يرجى إدخال رقم فاتورة الخط الملاحي');
      return;
    }

    try {
      setIsSubmittingExpense(true);
      if (expenseTypeInput === 'carrier') {
        const res = await maritimeApi.createCarrierInvoice(job.id, {
          invoiceNumber: carrierInvoiceNumber.trim(),
          totalInvoicedAmount: amount,
          currency: currencyCode,
          shippingLineId: job.shipping_line_id,
          carrierName: job.shipping_line_name,
          notes: expenseNotesInput,
        });
        toast.success(res.message || 'تم تسجيل فاتورة الخط الملاحي بنجاح');
      } else {
        const res = await maritimeApi.recordJobExpenseVoucher(job.id, {
          amount,
          expenseType: expenseTypeInput,
          paymentMethod: expensePaymentMethodInput,
          description: expenseNotesInput,
        });
        toast.success(res.message || `تم تسجيل وترحيل سند المصروفات للعملية #${job.job_number} بقيمة ${amount} بنجاح`);
      }
      setShowExpenseDialog(false);
      await fetchJob();
      await fetchLedger(String(job.id));
      await fetchCarrierInvoices(String(job.id));
      onUpdated();
    } catch (err: any) {
      const errMsg = err?.data?.message || err?.message || 'فشل تسجيل سند المصروفات';
      toast.error(errMsg);
    } finally {
      setIsSubmittingExpense(false);
    }
  };

  return (
    <>
      {/* Modal 4: Issue Sales Invoice Dialog */}
      {showInvoiceDialog && (
        <StandardDialog
          open={showInvoiceDialog}
          onClose={() => setShowInvoiceDialog(false)}
          title={t('maritime_freight.job_details_modal.s292', "إصدار وترحيل فاتورة مبيعات خدمات ملاحية")}
          subtitle={`العملية: ${job.job_number} | العميل: ${job.customer_name}`}
          width="min(580px, 95vw)"
          minHeight="min(440px, 80vh)"
          footerActions={(
            <StandardDialogFooter
              onSubmit={() => submitOnce('issue-invoice', handleConfirmIssueInvoice)}
              submitText={isSubmittingInvoice ? t('maritime_freight.job_details_modal.s293', "جاري الترحيل...") : t('maritime_freight.job_details_modal.s294', "ترحيل الفاتورة للدفاتر")}
              isSubmitting={isSubmittingInvoice}
              onCancel={() => setShowInvoiceDialog(false)}
              cancelText={t('maritime_freight.job_details_modal.s295', "إلغاء")}
            />
          )}
        >
          <div className="job-submodal-compact" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }} dir="rtl">
            <div style={{ background: '#eff6ff', padding: '10px 14px', borderRadius: '8px', border: '1px solid #bfdbfe', fontSize: '0.78rem', color: '#1e40af' }}>
              {t('maritime_freight.job_details_modal.s296', "سيتم إنشاء وترحيل قيد يومية معتمد (مدين: حساب العملاء 1130 / دائن: مبيعات الخدمات 4200) وتوجيهه آلياً لمركز تكلفة العملية")} <strong>#{job.job_number}</strong>.
            </div>

            <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <Field label={`مبلغ الفاتورة المفوتر للعميل (${currencySymbol}) *`}>
                <input
                  type="number"
                  value={invoiceAmountInput}
                  onChange={(e) => setInvoiceAmountInput(e.target.value)}
                  placeholder="0.00"
                  style={{ fontWeight: 800, color: '#170e5e' }}
                />
              </Field>

              <Field label={t('maritime_freight.job_details_modal.s297', "بيان ووصف الفاتورة")}>
                <input
                  type="text"
                  value={invoiceNotesInput}
                  onChange={(e) => setInvoiceNotesInput(e.target.value)}
                  placeholder={t('maritime_freight.job_details_modal.s298', "بيان الفاتورة...")}
                />
              </Field>
            </div>
          </div>
        </StandardDialog>
      )}

      {/* Modal 5: Record Expense Voucher Dialog */}
      {showExpenseDialog && (
        <StandardDialog
          open={showExpenseDialog}
          onClose={() => setShowExpenseDialog(false)}
          title={t('maritime_freight.job_details_modal.s299', "تسجيل وترحيل سند مصروفات ملاحية")}
          subtitle={`العملية: ${job.job_number} | التوكيل: ${job.shipping_line_name}`}
          width="min(620px, 95vw)"
          minHeight="min(460px, 80vh)"
          footerActions={(
            <StandardDialogFooter
              onSubmit={() => submitOnce('record-expense', handleConfirmRecordExpense)}
              submitText={isSubmittingExpense ? t('maritime_freight.job_details_modal.s300', "جاري الترحيل...") : t('maritime_freight.job_details_modal.s301', "ترحيل سند المصروفات")}
              isSubmitting={isSubmittingExpense}
              onCancel={() => setShowExpenseDialog(false)}
              cancelText={t('maritime_freight.job_details_modal.s302', "إلغاء")}
            />
          )}
        >
          <div className="job-submodal-compact" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }} dir="rtl">
            <div style={{ background: '#fef2f2', padding: '10px 14px', borderRadius: '8px', border: '1px solid #fecaca', fontSize: '0.78rem', color: '#991b1b' }}>
              {t('maritime_freight.job_details_modal.s303', "سيتم إنشاء قيد استحقاق مصروفات (مدين: مصروفات نقل وشحن 6400 بمركز تكلفة العملية / دائن: حساب السداد المحدد) وخصمه من أرباح العملية.")}
            </div>

            <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <Field label={t('maritime_freight.job_details_modal.s304', "نوع المصروف")}>
                  <CustomSelect
                    value={expenseTypeInput}
                    onChange={(val) => setExpenseTypeInput(val as any)}
                    options={[
                      { value: 'carrier', label: t('maritime_freight.job_details_modal.s305', "نولون وتكاليف الخط الملاحي") },
                      { value: 'port', label: t('maritime_freight.job_details_modal.s306', "رسوم ومصروفات محطات الميناء THC") },
                      { value: 'other', label: t('maritime_freight.job_details_modal.s307', "مصروفات تخليص أو خدمات أخرى") },
                    ]}
                  />
                </Field>

                <Field label={t('maritime_freight.job_details_modal.s308', "طريقة السداد والتسوية")}>
                  <CustomSelect
                    value={expensePaymentMethodInput}
                    onChange={(val) => setExpensePaymentMethodInput(val as any)}
                    options={[
                      { value: 'payable', label: t('maritime_freight.job_details_modal.s309', "استحقاق أجل على حساب المورد (2110)") },
                      { value: 'cash', label: t('maritime_freight.job_details_modal.s310', "صرف نقدي فوري من الخزينة (1110)") },
                      { value: 'bank', label: t('maritime_freight.job_details_modal.s311', "تحويل / شيك بنكي (1120)") },
                    ]}
                  />
                </Field>
              </div>

              <Field label={`مبلغ المصروف (${currencySymbol}) *`}>
                <input
                  type="number"
                  value={expenseAmountInput}
                  onChange={(e) => setExpenseAmountInput(e.target.value)}
                  placeholder="0.00"
                  style={{ fontWeight: 800, color: '#b91c1c' }}
                />
              </Field>

              {expenseTypeInput === 'carrier' && (
                <Field label={t('maritime_freight.job_details_modal.s312', "رقم فاتورة الخط الملاحي *")}>
                  <input
                    type="text"
                    value={carrierInvoiceNumber}
                    onChange={(e) => setCarrierInvoiceNumber(e.target.value)}
                    placeholder={t('maritime_freight.job_details_modal.s313', "مثال: MSKU-982341...")}
                    style={{ fontWeight: 700 }}
                  />
                </Field>
              )}

              {/* بطاقة الفحص والتدقيق اللحظي للتعرفة (Freight Audit Live Preview) */}
              {expenseTypeInput === 'carrier' && carrierAuditPreview && (
                <div
                  style={{
                    background: carrierAuditPreview.audit.isOvercharged
                      ? '#fef2f2'
                      : carrierAuditPreview.audit.isMatched
                      ? '#f0fdf4'
                      : '#eff6ff',
                    border: `1px solid ${
                      carrierAuditPreview.audit.isOvercharged
                        ? '#fecaca'
                        : carrierAuditPreview.audit.isMatched
                        ? '#bbf7d0'
                        : '#bfdbfe'
                    }`,
                    borderRadius: '8px',
                    padding: '10px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 800, color: carrierAuditPreview.audit.isOvercharged ? '#991b1b' : '#166534' }}>
                      {carrierAuditPreview.audit.hasRateCard ? (
                        <>
                          {t('maritime_freight.job_details_modal.s314', "تدقيق التعرفة المتعاقد عليها:")} {currencySymbol} {carrierAuditPreview.audit.contractedTotal.toLocaleString()}
                          {carrierAuditPreview.audit.containerCount > 1 ? ` (${carrierAuditPreview.audit.containerCount} حاويات)` : ''}
                        </>
                      ) : (
                        t('maritime_freight.job_details_modal.s315', "لا توجد بطاقة تعرفة نشطة مسجلة لهذا المسار والخط")
                      )}
                    </div>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '6px',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        background: carrierAuditPreview.audit.isOvercharged
                          ? '#dc2626'
                          : carrierAuditPreview.audit.isMatched
                          ? '#16a34a'
                          : '#2563eb',
                        color: '#ffffff',
                      }}
                    >
                      {carrierAuditPreview.audit.isOvercharged
                        ? `زيادة: +${currencySymbol} ${carrierAuditPreview.audit.varianceAmount.toLocaleString()} (+${carrierAuditPreview.audit.variancePct}%)`
                        : carrierAuditPreview.audit.isMatched
                        ? t('maritime_freight.job_details_modal.s316', "مطابق للتعرفة 100%")
                        : `وفر: -${currencySymbol} ${Math.abs(carrierAuditPreview.audit.varianceAmount).toLocaleString()}`}
                    </span>
                  </div>

                  {carrierAuditPreview.audit.isOvercharged && (
                    <div
                      style={{
                        marginTop: '6px',
                        borderTop: '1px dashed #fecaca',
                        paddingTop: '8px',
                        fontSize: '0.74rem',
                        color: '#991b1b',
                        lineHeight: 1.4,
                        fontWeight: 600,
                      }}
                    >
                      {t('maritime_freight.job_details_modal.s317', "تنبيه رقابي (فصل المهام Maker-Checker): قيمة الفاتورة تتجاوز التعرفة المتعاقد عليها بمقدار +")}{currencySymbol} {carrierAuditPreview.audit.varianceAmount.toLocaleString()} (+{carrierAuditPreview.audit.variancePct}{t('maritime_freight.job_details_modal.s318', "%). سيتم حفظ الفاتورة بحالة \"زيادة غير معتمدة\" لحين مراجعتها واعتمادها من مسؤول مالي آخر، أو يمكنك فتح نزاع رسمي مع الناقل.")}
                    </div>
                  )}
                </div>
              )}

              <Field label={t('maritime_freight.job_details_modal.s319', "البيان / الوصف")}>
                <input
                  type="text"
                  value={expenseNotesInput}
                  onChange={(e) => setExpenseNotesInput(e.target.value)}
                  placeholder={t('maritime_freight.job_details_modal.s320', "بيان سند المصروفات...")}
                />
              </Field>
            </div>
          </div>
        </StandardDialog>
      )}
    </>
  );
}
