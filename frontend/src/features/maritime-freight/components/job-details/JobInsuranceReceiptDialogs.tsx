import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { maritimeApi, MaritimeJob, CargoInsurance } from '../../api/maritime-freight.api';
import { toast } from '@/shared/components/system-alert';
import { todayLocalDateKey } from '@/lib/format';

interface JobInsuranceReceiptDialogsProps {
  job: MaritimeJob | null;
  showAddInsuranceDialog: boolean;
  setShowAddInsuranceDialog: (open: boolean) => void;
  showClaimDialog: boolean;
  selectedInsuranceForClaim: CargoInsurance | null;
  onCloseClaim: () => void;
  showAddWarehouseReceiptDialog: boolean;
  setShowAddWarehouseReceiptDialog: (open: boolean) => void;
  fetchJob: (specificId?: string) => Promise<void>;
  onUpdated: () => void;
  submitOnce: (key: string, action: () => Promise<void>) => Promise<void>;
}

export function JobInsuranceReceiptDialogs({
  job,
  showAddInsuranceDialog,
  setShowAddInsuranceDialog,
  showClaimDialog,
  selectedInsuranceForClaim,
  onCloseClaim,
  showAddWarehouseReceiptDialog,
  setShowAddWarehouseReceiptDialog,
  fetchJob,
  onUpdated,
  submitOnce,
}: JobInsuranceReceiptDialogsProps) {
  const { t } = useTranslation();
  const [isSubmittingInsurance, setIsSubmittingInsurance] = useState(false);
  const [insuranceForm, setInsuranceForm] = useState({
    policyNumber: '',
    insuranceCompany: '',
    insuredValue: '',
    premiumAmount: '',
    currency: 'USD',
    coverageType: 'all_risks' as 'all_risks' | 'clauses_a' | 'clauses_b' | 'clauses_c',
    issueDate: todayLocalDateKey(),
    expiryDate: '',
    notes: '',
  });

  const [claimAmountInput, setClaimAmountInput] = useState('');
  const [claimNotesInput, setClaimNotesInput] = useState('');
  const [isSubmittingClaim, setIsSubmittingClaim] = useState(false);

  const [isSubmittingWarehouseReceipt, setIsSubmittingWarehouseReceipt] = useState(false);
  const [warehouseReceiptForm, setWarehouseReceiptForm] = useState({
    packageCount: '1',
    grossWeightKg: '',
    cbm: '',
    bayRackBin: '',
    notes: '',
  });

  // Claim form inputs are local here; the facade opener (handleOpenClaim) only
  // sets selectedInsuranceForClaim + showClaimDialog, so sync the defaults
  // (insured value / cleared notes) from the selected policy when it opens.
  useEffect(() => {
    if (showClaimDialog && selectedInsuranceForClaim) {
      setClaimAmountInput(String(selectedInsuranceForClaim.insured_value || ''));
      setClaimNotesInput('');
    }
  }, [showClaimDialog, selectedInsuranceForClaim]);

  const handleSaveAddInsurance = async () => {
    if (!job) return;
    if (!insuranceForm.policyNumber.trim()) {
      toast.warning('يرجى إدخال رقم وثيقة التأمين');
      return;
    }
    if (!insuranceForm.insuranceCompany.trim()) {
      toast.warning('يرجى إدخال اسم شركة التأمين');
      return;
    }
    const insuredVal = Number(insuranceForm.insuredValue);
    const premium = Number(insuranceForm.premiumAmount);
    if (!insuredVal || insuredVal <= 0) {
      toast.warning('يرجى إدخال قيمة بضائع مؤمنة صالحة');
      return;
    }
    try {
      setIsSubmittingInsurance(true);
      await maritimeApi.createCargoInsurance(job.id, {
        policy_number: insuranceForm.policyNumber.trim(),
        insurance_company: insuranceForm.insuranceCompany.trim(),
        insured_value: insuredVal,
        premium_amount: premium || 0,
        currency: insuranceForm.currency || 'USD',
        coverage_type: insuranceForm.coverageType,
        issue_date: insuranceForm.issueDate || todayLocalDateKey(),
        expiry_date: insuranceForm.expiryDate || undefined,
        notes: insuranceForm.notes || undefined,
      });
      toast.success(`تم إصدار وثيقة تأمين البضائع [${insuranceForm.policyNumber}] بنجاح`);
      setShowAddInsuranceDialog(false);
      setInsuranceForm({
        policyNumber: '',
        insuranceCompany: '',
        insuredValue: '',
        premiumAmount: '',
        currency: 'USD',
        coverageType: 'all_risks',
        issueDate: todayLocalDateKey(),
        expiryDate: '',
        notes: '',
      });
      await fetchJob();
      onUpdated();
    } catch (err: any) {
      toast.error(err?.message || 'فشل إصدار وثيقة التأمين');
    } finally {
      setIsSubmittingInsurance(false);
    }
  };

  const handleConfirmClaim = async () => {
    if (!selectedInsuranceForClaim) return;
    const claimAmt = Number(claimAmountInput);
    if (!claimAmt || claimAmt <= 0) {
      toast.warning('يرجى إدخال مبلغ تعويض صالح أكبر من صفر');
      return;
    }
    try {
      setIsSubmittingClaim(true);
      await maritimeApi.claimCargoInsurance(selectedInsuranceForClaim.id, {
        claimAmount: claimAmt,
        claimStatus: 'submitted',
        claimNotes: claimNotesInput || undefined,
      });
      toast.success(`تم تسجيل المطالبة التأمينية بمبلغ ${claimAmt} بنجاح`);
      onCloseClaim();
      await fetchJob();
      onUpdated();
    } catch (err: any) {
      toast.error(err?.message || 'فشل تسجيل المطالبة التأمينية');
    } finally {
      setIsSubmittingClaim(false);
    }
  };

  const handleSaveAddWarehouseReceipt = async () => {
    if (!job) return;
    const pkgs = Number(warehouseReceiptForm.packageCount);
    if (!pkgs || pkgs <= 0) {
      toast.warning('يرجى تحديد عدد الطرود المستلمة');
      return;
    }
    try {
      setIsSubmittingWarehouseReceipt(true);
      await maritimeApi.createWarehouseReceipt(job.id, {
        package_count: pkgs,
        gross_weight_kg: Number(warehouseReceiptForm.grossWeightKg) || 0,
        cbm: Number(warehouseReceiptForm.cbm) || 0,
        bay_rack_bin: warehouseReceiptForm.bayRackBin || undefined,
        notes: warehouseReceiptForm.notes || undefined,
      });
      toast.success('تم إصدار إذن استلام وإيداع المستودع (MWR) بنجاح');
      setShowAddWarehouseReceiptDialog(false);
      setWarehouseReceiptForm({
        packageCount: '1',
        grossWeightKg: '',
        cbm: '',
        bayRackBin: '',
        notes: '',
      });
      await fetchJob();
      onUpdated();
    } catch (err: any) {
      toast.error(err?.message || 'فشل إصدار إذن استلام المستودع');
    } finally {
      setIsSubmittingWarehouseReceipt(false);
    }
  };

  return (
    <>
    {/* Modal 8: Add Cargo Insurance Dialog */}
    {showAddInsuranceDialog && job && (
      <StandardDialog
        open={showAddInsuranceDialog}
        onClose={() => setShowAddInsuranceDialog(false)}
        title={t('maritime_freight.job_details_modal.s357', "إصدار وثيقة تأمين بضائع (Cargo Insurance Policy)")}
        subtitle={`العملية: ${job.job_number} | العميل: ${job.customer_name}`}
        width="min(640px, 95vw)"
        minHeight="min(480px, 85vh)"
        footerActions={(
          <StandardDialogFooter
            onSubmit={() => submitOnce('insurance', handleSaveAddInsurance)}
            submitText={isSubmittingInsurance ? t('maritime_freight.job_details_modal.s358', "جاري الإصدار...") : t('maritime_freight.job_details_modal.s359', "إصدار وتأكيد الوثيقة")}
            isSubmitting={isSubmittingInsurance}
            onCancel={() => setShowAddInsuranceDialog(false)}
            cancelText={t('maritime_freight.job_details_modal.s360', "إلغاء")}
          />
        )}
      >
        <div className="job-submodal-compact" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }} dir="rtl">
          <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.78rem', color: '#334155', lineHeight: 1.5 }}>
            {t('maritime_freight.job_details_modal.s361', "إصدار وثيقة تأمين معتمدة للشحنة لحماية البضائع ضد أخطار النقل البحري / الجوي / البري، مع تحديد نوع التغطية وقيمة البضاعة وقسط التأمين.")}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label={t('maritime_freight.job_details_modal.s362', "رقم وثيقة التأمين (Policy No) *")}>
              <input
                type="text"
                value={insuranceForm.policyNumber}
                onChange={(e) => setInsuranceForm({ ...insuranceForm, policyNumber: e.target.value })}
                placeholder={t('maritime_freight.job_details_modal.s363', "مثال: POL-2026-0918")}
                style={{ width: '100%', padding: '8px 10px', fontSize: '0.78rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
              />
            </Field>

            <Field label={t('maritime_freight.job_details_modal.s364', "شركة التأمين (Insurance Company) *")}>
              <input
                type="text"
                value={insuranceForm.insuranceCompany}
                onChange={(e) => setInsuranceForm({ ...insuranceForm, insuranceCompany: e.target.value })}
                placeholder={t('maritime_freight.job_details_modal.s365', "مثال: شركة مصر للتأمين / أليانز")}
                style={{ width: '100%', padding: '8px 10px', fontSize: '0.78rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
              />
            </Field>

            <Field label={t('maritime_freight.job_details_modal.s366', "نوع التغطية التأمينية *")}>
              <CustomSelect
                value={insuranceForm.coverageType}
                onChange={(val) => setInsuranceForm({ ...insuranceForm, coverageType: val as any })}
                options={[
                  { value: 'all_risks', label: t('maritime_freight.job_details_modal.s367', "تأمين شامل ضد كافة الأخطار (All Risks)") },
                  { value: 'clauses_a', label: t('maritime_freight.job_details_modal.s368', "شروط معهد المكتتبين بضائع (أ) - ICC A") },
                  { value: 'clauses_b', label: t('maritime_freight.job_details_modal.s369', "شروط معهد المكتتبين بضائع (ب) - ICC B") },
                  { value: 'clauses_c', label: t('maritime_freight.job_details_modal.s370', "شروط معهد المكتتبين بضائع (ج) - ICC C") },
                ]}
              />
            </Field>

            <Field label={t('maritime_freight.job_details_modal.s371', "العملة")}>
              <CustomSelect
                value={insuranceForm.currency}
                onChange={(val) => setInsuranceForm({ ...insuranceForm, currency: val })}
                options={[
                  { value: 'USD', label: 'USD ($)' },
                  { value: 'EUR', label: 'EUR (€)' },
                  { value: 'EGP', label: t('maritime_freight.job_details_modal.s372', "EGP (ج.م)") },
                  { value: 'SAR', label: t('maritime_freight.job_details_modal.s373', "SAR (ر.س)") },
                  { value: 'AED', label: t('maritime_freight.job_details_modal.s374', "AED (د.إ)") },
                ]}
              />
            </Field>

            <Field label={t('maritime_freight.job_details_modal.s375', "القيمة المؤمنة للبضاعة (Insured Value) *")}>
              <input
                type="number"
                min="0"
                step="0.01"
                value={insuranceForm.insuredValue}
                onChange={(e) => setInsuranceForm({ ...insuranceForm, insuredValue: e.target.value })}
                placeholder="0.00"
                style={{ width: '100%', padding: '8px 10px', fontSize: '0.78rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
              />
            </Field>

            <Field label={t('maritime_freight.job_details_modal.s376', "مبلغ القسط التأميني (Premium Amount)")}>
              <input
                type="number"
                min="0"
                step="0.01"
                value={insuranceForm.premiumAmount}
                onChange={(e) => setInsuranceForm({ ...insuranceForm, premiumAmount: e.target.value })}
                placeholder="0.00"
                style={{ width: '100%', padding: '8px 10px', fontSize: '0.78rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
              />
            </Field>

            <Field label={t('maritime_freight.job_details_modal.s377', "تاريخ الإصدار")}>
              <input
                type="date"
                value={insuranceForm.issueDate}
                onChange={(e) => setInsuranceForm({ ...insuranceForm, issueDate: e.target.value })}
                style={{ width: '100%', padding: '8px 10px', fontSize: '0.78rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
              />
            </Field>

            <Field label={t('maritime_freight.job_details_modal.s378', "تاريخ انتهاء السريان")}>
              <input
                type="date"
                value={insuranceForm.expiryDate}
                onChange={(e) => setInsuranceForm({ ...insuranceForm, expiryDate: e.target.value })}
                style={{ width: '100%', padding: '8px 10px', fontSize: '0.78rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
              />
            </Field>
          </div>

          <Field label={t('maritime_freight.job_details_modal.s379', "ملاحظات وشروط خاصة")}>
            <textarea
              value={insuranceForm.notes}
              onChange={(e) => setInsuranceForm({ ...insuranceForm, notes: e.target.value })}
              placeholder={t('maritime_freight.job_details_modal.s380', "أي شروط خاصة أو بنود استثناء إضافية...")}
              rows={2}
              style={{ width: '100%', padding: '8px 10px', fontSize: '0.78rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
            />
          </Field>
        </div>
      </StandardDialog>
    )}

    {/* Modal 9: Claim Insurance Dialog */}
    {showClaimDialog && selectedInsuranceForClaim && job && (
      <StandardDialog
        open={showClaimDialog}
        onClose={onCloseClaim}
        title={t('maritime_freight.job_details_modal.s381', "تسجيل مطالبة تعويض تأميني (Cargo Insurance Claim)")}
        subtitle={`وثيقة رقم: ${selectedInsuranceForClaim.policy_number} | شركة: ${selectedInsuranceForClaim.insurance_company}`}
        width="min(560px, 95vw)"
        minHeight="min(440px, 80vh)"
        footerActions={(
          <StandardDialogFooter
            onSubmit={() => submitOnce('claim', handleConfirmClaim)}
            submitText={isSubmittingClaim ? t('maritime_freight.job_details_modal.s382', "جاري التسجيل...") : t('maritime_freight.job_details_modal.s383', "تسجيل المطالبة رسميًا")}
            isSubmitting={isSubmittingClaim}
            onCancel={onCloseClaim}
            cancelText={t('maritime_freight.job_details_modal.s384', "إلغاء")}
          />
        )}
      >
        <div className="job-submodal-compact" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }} dir="rtl">
          <div style={{ background: '#fef2f2', padding: '10px 14px', borderRadius: '8px', border: '1px solid #fecaca', fontSize: '0.78rem', color: '#991b1b', lineHeight: 1.5 }}>
            {t('maritime_freight.job_details_modal.s385', "سيتم تسجيل المطالبة ضد شركة التأمين وتحويل حالة الوثيقة إلى [مطالبة قيد المعالجة] وتوثيق تفاصيل الحادث أو التلف للمتابعة القانونية والمالية.")}
          </div>

          <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.78rem' }}>
            <div>
              <span style={{ color: '#64748b' }}>{t('maritime_freight.job_details_modal.s386', "القيمة المؤمنة الأصلية:")} </span>
              <strong style={{ color: '#170e5e' }}>{selectedInsuranceForClaim.currency} {Number(selectedInsuranceForClaim.insured_value).toLocaleString()}</strong>
            </div>
            <div>
              <span style={{ color: '#64748b' }}>{t('maritime_freight.job_details_modal.s387', "نوع التغطية:")} </span>
              <strong style={{ color: '#0f172a' }}>{selectedInsuranceForClaim.coverage_type}</strong>
            </div>
          </div>

          <Field label={t('maritime_freight.job_details_modal.s388', "مبلغ التعويض المطلوب (Claim Amount) *")}>
            <input
              type="number"
              min="0"
              step="0.01"
              value={claimAmountInput}
              onChange={(e) => setClaimAmountInput(e.target.value)}
              placeholder="0.00"
              style={{ width: '100%', padding: '8px 10px', fontSize: '0.78rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
            />
          </Field>

          <Field label={t('maritime_freight.job_details_modal.s389', "بيان سبب المطالبة وتفاصيل التلف أو الفقد *")}>
            <textarea
              value={claimNotesInput}
              onChange={(e) => setClaimNotesInput(e.target.value)}
              placeholder={t('maritime_freight.job_details_modal.s390', "مثال: تعرضت الشحنة للبلل نتيجة تسرب مياه أثناء الرحلة البحرية، وتم تحرير محضر معاينة مشترك...")}
              rows={3}
              style={{ width: '100%', padding: '8px 10px', fontSize: '0.78rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
            />
          </Field>
        </div>
      </StandardDialog>
    )}

    {/* Modal 10: Add Warehouse Receipt Dialog */}
    {showAddWarehouseReceiptDialog && job && (
      <StandardDialog
        open={showAddWarehouseReceiptDialog}
        onClose={() => setShowAddWarehouseReceiptDialog(false)}
        title={t('maritime_freight.job_details_modal.s391', "إصدار إذن استلام وإيداع مستودع ترانزيت / جمركي (MWR)")}
        subtitle={`العملية: ${job.job_number} | العميل: ${job.customer_name}`}
        width="min(600px, 95vw)"
        minHeight="min(480px, 85vh)"
        footerActions={(
          <StandardDialogFooter
            onSubmit={() => submitOnce('warehouse-receipt', handleSaveAddWarehouseReceipt)}
            submitText={isSubmittingWarehouseReceipt ? t('maritime_freight.job_details_modal.s392', "جاري الإصدار...") : t('maritime_freight.job_details_modal.s393', "إصدار إذن الإيداع")}
            isSubmitting={isSubmittingWarehouseReceipt}
            onCancel={() => setShowAddWarehouseReceiptDialog(false)}
            cancelText={t('maritime_freight.job_details_modal.s394', "إلغاء")}
          />
        )}
      >
        <div className="job-submodal-compact" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }} dir="rtl">
          <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.78rem', color: '#334155', lineHeight: 1.5 }}>
            {t('maritime_freight.job_details_modal.s395', "إصدار إذن استلام رسمي للبضائع الواردة لمستودع الترانزيت أو الإيداع الجمركي (MWR) لتحديد موقع التخزين (Bay / Rack / Bin) والوزن والحجم تمهيداً للتفتيش أو الإفراج.")}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <Field label={t('maritime_freight.job_details_modal.s396', "عدد الطرود / الطبالي *")}>
              <input
                type="number"
                min="1"
                value={warehouseReceiptForm.packageCount}
                onChange={(e) => setWarehouseReceiptForm({ ...warehouseReceiptForm, packageCount: e.target.value })}
                style={{ width: '100%', padding: '8px 10px', fontSize: '0.78rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
              />
            </Field>

            <Field label={t('maritime_freight.job_details_modal.s397', "الوزن الإجمالي الفعلي (كجم)")}>
              <input
                type="number"
                min="0"
                step="0.01"
                value={warehouseReceiptForm.grossWeightKg}
                onChange={(e) => setWarehouseReceiptForm({ ...warehouseReceiptForm, grossWeightKg: e.target.value })}
                placeholder="0.00"
                style={{ width: '100%', padding: '8px 10px', fontSize: '0.78rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
              />
            </Field>

            <Field label={t('maritime_freight.job_details_modal.s398', "الحجم الإجمالي (CBM)")}>
              <input
                type="number"
                min="0"
                step="0.01"
                value={warehouseReceiptForm.cbm}
                onChange={(e) => setWarehouseReceiptForm({ ...warehouseReceiptForm, cbm: e.target.value })}
                placeholder="0.00"
                style={{ width: '100%', padding: '8px 10px', fontSize: '0.78rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
              />
            </Field>
          </div>

          <Field label={t('maritime_freight.job_details_modal.s399', "موقع التخزين والرف (Bay / Rack / Bin Location)")}>
            <input
              type="text"
              value={warehouseReceiptForm.bayRackBin}
              onChange={(e) => setWarehouseReceiptForm({ ...warehouseReceiptForm, bayRackBin: e.target.value })}
              placeholder={t('maritime_freight.job_details_modal.s400', "مثال: Bay A-12 / Rack 03 / Bin 04 أو ساحة الترانزيت 2")}
              style={{ width: '100%', padding: '8px 10px', fontSize: '0.78rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
            />
          </Field>

          <Field label={t('maritime_freight.job_details_modal.s401', "ملاحظات الفحص الظاهري وحالة الطرود")}>
            <textarea
              value={warehouseReceiptForm.notes}
              onChange={(e) => setWarehouseReceiptForm({ ...warehouseReceiptForm, notes: e.target.value })}
              placeholder={t('maritime_freight.job_details_modal.s402', "ملاحظات الفحص الظاهري، حالة الأغلفة، سلامة الأشرطة اللاصقة...")}
              rows={3}
              style={{ width: '100%', padding: '8px 10px', fontSize: '0.78rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
            />
          </Field>
        </div>
      </StandardDialog>
    )}
    </>
  );
}
