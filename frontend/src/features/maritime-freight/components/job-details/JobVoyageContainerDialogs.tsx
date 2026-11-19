import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { maritimeApi, MaritimeJob, MaritimeContainer } from '../../api/maritime-freight.api';
import { toast } from '@/shared/components/system-alert';

interface JobVoyageContainerDialogsProps {
  job: MaritimeJob;
  showEditVoyage: boolean;
  setShowEditVoyage: (value: boolean) => void;
  showAddContainer: boolean;
  setShowAddContainer: (value: boolean) => void;
  editingContainer: MaritimeContainer | null;
  setEditingContainer: (container: MaritimeContainer | null) => void;
  currencyCode: string;
  fetchJob: (specificId?: string) => Promise<void>;
  onUpdated: () => void;
  submitOnce: (key: string, action: () => Promise<void>) => Promise<void>;
}

export function JobVoyageContainerDialogs({
  job,
  showEditVoyage,
  setShowEditVoyage,
  showAddContainer,
  setShowAddContainer,
  editingContainer,
  setEditingContainer,
  currencyCode,
  fetchJob,
  onUpdated,
  submitOnce,
}: JobVoyageContainerDialogsProps) {
  const { t } = useTranslation();

  // Edit Voyage Form
  const [voyageForm, setVoyageForm] = useState({
    vesselName: '',
    voyageNumber: '',
    bookingNumber: '',
    etd: '',
    eta: '',
    portCutOff: '',
    blType: 'sea_waybill' as 'original' | 'telex_release' | 'sea_waybill',
    mblNumber: '',
    hblNumber: '',
    shipperDetails: '',
    consigneeDetails: '',
    notifyParty: '',
    notes: '',
  });

  // Add Container Form
  const [addContainerForm, setAddContainerForm] = useState({
    containerNumber: '',
    containerType: "40' HC",
    sealNumber: '',
    grossWeightKg: '',
    cbm: '',
    freeDays: '14',
    returnDeadline: '',
    demurrageRatePerDay: '50',
    depositAmount: '0',
    depositCurrency: 'USD',
    notes: '',
  });

  // Edit Container Form
  const [editContainerForm, setEditContainerForm] = useState({
    sealNumber: '',
    freeDays: '14',
    returnDeadline: '',
    demurrageRatePerDay: '50',
    depositAmount: '0',
    depositCurrency: 'USD',
    depositStatus: 'not_required' as any,
    notes: '',
  });

  // Populate the voyage form from the job each time the edit-voyage dialog opens.
  // The facade-owned opener only flips showEditVoyage; it cannot set this local form.
  useEffect(() => {
    if (!showEditVoyage) return;
    setVoyageForm({
      vesselName: job.vessel_name || '',
      voyageNumber: job.voyage_number || '',
      bookingNumber: job.booking_number || '',
      etd: job.etd ? job.etd.split('T')[0] : '',
      eta: job.eta ? job.eta.split('T')[0] : '',
      portCutOff: job.port_cut_off ? job.port_cut_off.split('T')[0] : '',
      blType: job.bl_type || 'sea_waybill',
      mblNumber: job.mbl_number || '',
      hblNumber: job.hbl_number || '',
      shipperDetails: job.shipper_details || '',
      consigneeDetails: job.consignee_details || '',
      notifyParty: job.notify_party || '',
      notes: job.notes || '',
    });
  }, [showEditVoyage]);

  // Populate the edit-container form from the selected container.
  // The facade-owned opener only sets editingContainer; it cannot set this local form.
  useEffect(() => {
    if (!editingContainer) return;
    setEditContainerForm({
      sealNumber: editingContainer.seal_number || '',
      freeDays: String(editingContainer.free_days ?? 14),
      returnDeadline: editingContainer.return_deadline ? editingContainer.return_deadline.split('T')[0] : '',
      demurrageRatePerDay: String(editingContainer.demurrage_rate_per_day ?? 50),
      depositAmount: String(editingContainer.deposit_amount || 0),
      depositCurrency: editingContainer.deposit_currency || 'USD',
      depositStatus: editingContainer.deposit_status || 'not_required',
      notes: editingContainer.notes || '',
    });
  }, [editingContainer]);

  const handleSaveVoyage = async () => {
    if (!job) return;
    try {
      await maritimeApi.updateJob(job.id, voyageForm);
      toast.success('تم تحديث بيانات الرحلة والبوالص بنجاح');
      setShowEditVoyage(false);
      await fetchJob();
      onUpdated();
    } catch (err: any) {
      toast.error(err?.message || 'فشل تحديث بيانات الرحلة');
    }
  };

  // Add Container
  const handleSaveAddContainer = async () => {
    if (!job) return;
    if (!addContainerForm.containerNumber.trim()) {
      toast.warning('يرجى إدخال رقم الحاوية (مثال: MSCU1234567)');
      return;
    }
    if (!addContainerForm.freeDays.trim() || !addContainerForm.demurrageRatePerDay.trim() || !Number.isInteger(Number(addContainerForm.freeDays)) || Number(addContainerForm.freeDays) < 0 || !Number.isFinite(Number(addContainerForm.demurrageRatePerDay)) || Number(addContainerForm.demurrageRatePerDay) < 0) {
      toast.warning('يرجى إدخال فترة سماح وغرامة يومية صالحتين');
      return;
    }
    try {
      await maritimeApi.createContainer({
        jobId: job.id,
        containerNumber: addContainerForm.containerNumber,
        containerType: addContainerForm.containerType,
        sealNumber: addContainerForm.sealNumber || undefined,
        grossWeightKg: Number(addContainerForm.grossWeightKg) || 0,
        cbm: Number(addContainerForm.cbm) || 0,
        freeDays: Number(addContainerForm.freeDays),
        returnDeadline: addContainerForm.returnDeadline || undefined,
        demurrageRatePerDay: Number(addContainerForm.demurrageRatePerDay),
        depositAmount: Number(addContainerForm.depositAmount) || 0,
        depositCurrency: currencyCode,
        notes: addContainerForm.notes || undefined,
      });
      toast.success(`تمت إضافة الحاوية [${addContainerForm.containerNumber.toUpperCase()}] بنجاح`);
      setShowAddContainer(false);
      setAddContainerForm({
        containerNumber: '',
        containerType: "40' HC",
        sealNumber: '',
        grossWeightKg: '',
        cbm: '',
        freeDays: '14',
        returnDeadline: '',
        demurrageRatePerDay: '50',
        depositAmount: '0',
        depositCurrency: 'USD',
        notes: '',
      });
      await fetchJob();
      onUpdated();
    } catch (err: any) {
      toast.error(err?.message || 'فشل إضافة الحاوية');
    }
  };

  const handleSaveEditContainer = async () => {
    if (!editingContainer) return;
    if (!editContainerForm.freeDays.trim() || !editContainerForm.demurrageRatePerDay.trim() || !Number.isInteger(Number(editContainerForm.freeDays)) || Number(editContainerForm.freeDays) < 0 || !Number.isFinite(Number(editContainerForm.demurrageRatePerDay)) || Number(editContainerForm.demurrageRatePerDay) < 0) {
      toast.warning('يرجى إدخال فترة سماح وغرامة يومية صالحتين');
      return;
    }
    try {
      await maritimeApi.updateContainer(editingContainer.id, {
        sealNumber: editContainerForm.sealNumber || undefined,
        freeDays: Number(editContainerForm.freeDays),
        returnDeadline: editContainerForm.returnDeadline === (editingContainer.return_deadline?.split('T')[0] || '')
          ? undefined
          : editContainerForm.returnDeadline,
        demurrageRatePerDay: Number(editContainerForm.demurrageRatePerDay),
        depositAmount: Number(editContainerForm.depositAmount) || 0,
        depositCurrency: editContainerForm.depositCurrency,
        depositStatus: editContainerForm.depositStatus,
        notes: editContainerForm.notes || undefined,
      });
      toast.success('تم تحديث بيانات الحاوية بنجاح');
      setEditingContainer(null);
      await fetchJob();
      onUpdated();
    } catch (err: any) {
      toast.error(err?.message || 'فشل تحديث الحاوية');
    }
  };

  return (
    <>
      {/* Modal 1: Edit Voyage Modal */}
      {showEditVoyage && (
        <StandardDialog
          open={showEditVoyage}
          onClose={() => setShowEditVoyage(false)}
          title={t('maritime_freight.job_details_modal.s240', "تعديل بيانات الرحلة والبوالص")}
          subtitle={`العملية الملاحية: ${job.job_number}`}
          width="min(800px, 92vw)"
          minHeight="min(460px, 80vh)"
          footerActions={(
            <StandardDialogFooter
              onSubmit={() => submitOnce('voyage', handleSaveVoyage)}
              submitText={t('maritime_freight.job_details_modal.s241', "حفظ التعديلات")}
              onCancel={() => setShowEditVoyage(false)}
              cancelText={t('maritime_freight.job_details_modal.s242', "إلغاء")}
            />
          )}
        >
          <style>{`
            .job-submodal-compact .field {
              margin-bottom: 0 !important;
              gap: 3px !important;
            }
            .job-submodal-compact .field span {
              font-size: 0.74rem !important;
              font-weight: 600 !important;
              color: #334155 !important;
              white-space: nowrap !important;
              overflow: hidden !important;
              text-overflow: ellipsis !important;
            }
            .job-submodal-compact input,
            .job-submodal-compact textarea {
              height: 33px !important;
              font-size: 0.8125rem !important;
              border-radius: 6px !important;
              padding: 0 10px !important;
              border: 1px solid #cbd5e1 !important;
              background: #ffffff !important;
              box-sizing: border-box !important;
              outline: none !important;
              width: 100% !important;
            }
            .job-submodal-compact textarea {
              height: auto !important;
              min-height: 48px !important;
              padding: 6px 10px !important;
              resize: vertical !important;
              line-height: 1.4 !important;
            }
            .job-submodal-compact input:focus,
            .job-submodal-compact textarea:focus {
              border-color: #170e5e !important;
              box-shadow: 0 0 0 1px #170e5e !important;
            }
            .job-submodal-compact .custom-select-trigger {
              min-height: 33px !important;
              height: 33px !important;
              font-size: 0.8125rem !important;
              border-radius: 6px !important;
            }
          `}</style>
          <div className="job-submodal-compact" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }} dir="rtl">
            {/* Card 1: بيانات السفينة والحجز */}
            <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
                <AppIcons.Ship size={15} />
                <span>{t('maritime_freight.job_details_modal.s243', "1. بيانات السفينة ورقم الحجز (Vessel & Booking)")}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1.2fr', gap: '10px' }}>
                <Field label={t('maritime_freight.job_details_modal.s244', "اسم السفينة (Vessel Name)")}>
                  <input
                    type="text"
                    value={voyageForm.vesselName}
                    onChange={(e) => setVoyageForm({ ...voyageForm, vesselName: e.target.value })}
                    placeholder={t('maritime_freight.job_details_modal.s245', "مثال: MSC MAESTRO")}
                  />
                </Field>
                <Field label={t('maritime_freight.job_details_modal.s246', "رقم الرحلة (Voyage No)")}>
                  <input
                    type="text"
                    value={voyageForm.voyageNumber}
                    onChange={(e) => setVoyageForm({ ...voyageForm, voyageNumber: e.target.value })}
                    placeholder={t('maritime_freight.job_details_modal.s247', "مثال: 412W")}
                  />
                </Field>
                <Field label={t('maritime_freight.job_details_modal.s248', "رقم حجز الخط (Booking No)")}>
                  <input
                    type="text"
                    value={voyageForm.bookingNumber}
                    onChange={(e) => setVoyageForm({ ...voyageForm, bookingNumber: e.target.value })}
                    placeholder={t('maritime_freight.job_details_modal.s249', "مثال: BKG-994821")}
                  />
                </Field>
                <Field label={t('maritime_freight.job_details_modal.s250', "نوع البوليصة (B/L Type)")}>
                  <CustomSelect
                    value={voyageForm.blType}
                    onChange={(val) => setVoyageForm({ ...voyageForm, blType: val as any })}
                    options={[
                      { value: 'original', label: t('maritime_freight.job_details_modal.s251', "Original B/L (أصل ورقي)") },
                      { value: 'telex_release', label: t('maritime_freight.job_details_modal.s252', "Telex Release (تلكس)") },
                      { value: 'sea_waybill', label: t('maritime_freight.job_details_modal.s253', "Sea Waybill (إلكترونية)") },
                    ]}
                  />
                </Field>
              </div>
            </div>

            {/* Card 2: المواعيد الزمنية للرحلة */}
            <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
                <AppIcons.Clock size={15} />
                <span>{t('maritime_freight.job_details_modal.s254', "2. المواعيد الزمنية للرحلة (Schedule Dates)")}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <Field label={t('maritime_freight.job_details_modal.s255', "تاريخ الإبحار المتوقع (ETD)")}>
                  <input
                    type="date"
                    value={voyageForm.etd}
                    onChange={(e) => setVoyageForm({ ...voyageForm, etd: e.target.value })}
                  />
                </Field>
                <Field label={t('maritime_freight.job_details_modal.s256', "تاريخ الوصول المتوقع (ETA)")}>
                  <input
                    type="date"
                    value={voyageForm.eta}
                    onChange={(e) => setVoyageForm({ ...voyageForm, eta: e.target.value })}
                  />
                </Field>
              </div>
            </div>

            {/* Card 3: بوالص الشحن والأطراف التعاقدية */}
            <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
                <AppIcons.FileText size={15} />
                <span>{t('maritime_freight.job_details_modal.s257', "3. بوالص الشحن والأطراف التعاقدية (Bills of Lading & Parties)")}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '8px' }}>
                <Field label="Master B/L No">
                  <input
                    type="text"
                    value={voyageForm.mblNumber}
                    onChange={(e) => setVoyageForm({ ...voyageForm, mblNumber: e.target.value })}
                    placeholder={t('maritime_freight.job_details_modal.s258', "مثال: MSK9823412")}
                  />
                </Field>
                <Field label="House B/L No">
                  <input
                    type="text"
                    value={voyageForm.hblNumber}
                    onChange={(e) => setVoyageForm({ ...voyageForm, hblNumber: e.target.value })}
                    placeholder={t('maritime_freight.job_details_modal.s259', "مثال: HBL-260914-0001")}
                  />
                </Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <Field label={t('maritime_freight.job_details_modal.s260', "بيانات الشاحن (Shipper Details)")}>
                  <textarea
                    value={voyageForm.shipperDetails}
                    onChange={(e) => setVoyageForm({ ...voyageForm, shipperDetails: e.target.value })}
                    rows={2}
                    placeholder={t('maritime_freight.job_details_modal.s261', "اسم شركة الشحن، العنوان، ورقم التواصل")}
                  />
                </Field>
                <Field label={t('maritime_freight.job_details_modal.s262', "بيانات المستلم (Consignee Details)")}>
                  <textarea
                    value={voyageForm.consigneeDetails}
                    onChange={(e) => setVoyageForm({ ...voyageForm, consigneeDetails: e.target.value })}
                    rows={2}
                    placeholder={t('maritime_freight.job_details_modal.s263', "اسم العميل المستلم، العنوان، ورقم التواصل")}
                  />
                </Field>
              </div>
            </div>
          </div>
        </StandardDialog>
      )}

      {/* Modal 2: Add Container Modal */}
      {showAddContainer && (
        <StandardDialog
          open={showAddContainer}
          onClose={() => setShowAddContainer(false)}
          title={t('maritime_freight.job_details_modal.s264', "إضافة حاوية جديدة للشحنة")}
          subtitle={`العملية: ${job.job_number} | الخط: ${job.shipping_line_name}`}
          width="min(720px, 92vw)"
          minHeight="min(480px, 80vh)"
          footerActions={(
            <StandardDialogFooter
              onSubmit={() => submitOnce('add-container', handleSaveAddContainer)}
              submitText={t('maritime_freight.job_details_modal.s265', "إضافة الحاوية")}
              onCancel={() => setShowAddContainer(false)}
              cancelText={t('maritime_freight.job_details_modal.s266', "إلغاء")}
            />
          )}
        >
          <div className="job-submodal-compact" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }} dir="rtl">
            {/* Card 1: مواصفات وهوية الحاوية */}
            <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
                <AppIcons.Container size={15} />
                <span>{t('maritime_freight.job_details_modal.s267', "1. هوية الحاوية والمواصفات الفنية (Container Specs)")}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 1fr', gap: '10px' }}>
                <Field label={t('maritime_freight.job_details_modal.s268', "رقم الحاوية (Container Number) *")}>
                  <input
                    type="text"
                    value={addContainerForm.containerNumber}
                    onChange={(e) => setAddContainerForm({ ...addContainerForm, containerNumber: e.target.value.toUpperCase() })}
                    placeholder={t('maritime_freight.job_details_modal.s269', "مثال: MSCU9842104")}
                    style={{ fontWeight: 700 }}
                  />
                </Field>
                <Field label={t('maritime_freight.job_details_modal.s270', "نوع وحجم الحاوية *")}>
                  <CustomSelect
                    value={addContainerForm.containerType}
                    onChange={(val) => setAddContainerForm({ ...addContainerForm, containerType: val })}
                    options={[
                      { value: "20' GP", label: "20' GP - Standard Dry Container" },
                      { value: "40' GP", label: "40' GP - Standard Dry Container" },
                      { value: "40' HC", label: "40' HC - High Cube Container" },
                      { value: "45' HC", label: "45' HC - High Cube Extra" },
                      { value: "20' RF", label: "20' RF - Reefer Container" },
                      { value: "40' RH", label: "40' RH - Reefer High Cube" },
                      { value: "20' OT", label: "20' OT - Open Top Container" },
                      { value: "40' OT", label: "40' OT - Open Top Container" },
                      { value: "20' FR", label: "20' FR - Flat Rack Container" },
                      { value: "40' FR", label: "40' FR - Flat Rack Container" },
                    ]}
                  />
                </Field>
                <Field label={t('maritime_freight.job_details_modal.s271', "رقم الختم (Seal No)")}>
                  <input
                    type="text"
                    value={addContainerForm.sealNumber}
                    onChange={(e) => setAddContainerForm({ ...addContainerForm, sealNumber: e.target.value })}
                    placeholder={t('maritime_freight.job_details_modal.s272', "مثال: SL-984210")}
                  />
                </Field>
              </div>
            </div>

            {/* Card 2: شروط السماح والغرامات والتأمين */}
            <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
                <AppIcons.Clock size={15} />
                <span>{t('maritime_freight.job_details_modal.s273', "2. شروط السماح والغرامات والتأمين (Free Days & Deposit)")}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1.2fr', gap: '10px' }}>
                <Field label={t('maritime_freight.job_details_modal.s274', "فترة السماح (أيام) *")}>
                  <input
                    type="number"
                    value={addContainerForm.freeDays}
                    onChange={(e) => setAddContainerForm({ ...addContainerForm, freeDays: e.target.value })}
                    placeholder="14"
                  />
                </Field>
                <Field label={t('maritime_freight.job_details_modal.s275', "غرامة التأخير اليومية ($)")}>
                  <input
                    type="number"
                    value={addContainerForm.demurrageRatePerDay}
                    onChange={(e) => setAddContainerForm({ ...addContainerForm, demurrageRatePerDay: e.target.value })}
                    placeholder="50"
                  />
                </Field>
                <Field label={t('maritime_freight.job_details_modal.s276', "مبلغ التأمين المحتجز للخط")}>
                  <input
                    type="number"
                    value={addContainerForm.depositAmount}
                    onChange={(e) => setAddContainerForm({ ...addContainerForm, depositAmount: e.target.value })}
                    placeholder="0"
                  />
                </Field>
              </div>
            </div>
          </div>
        </StandardDialog>
      )}

      {/* Modal 3: Edit Container Modal */}
      {editingContainer && (
        <StandardDialog
          open={!!editingContainer}
          onClose={() => setEditingContainer(null)}
          title={`تعديل بيانات الحاوية: ${editingContainer.container_number}`}
          subtitle={`النوع: ${editingContainer.container_type}`}
          width="min(720px, 92vw)"
          minHeight="min(480px, 80vh)"
          footerActions={(
            <StandardDialogFooter
              onSubmit={() => submitOnce('edit-container', handleSaveEditContainer)}
              submitText={t('maritime_freight.job_details_modal.s277', "حفظ التعديلات")}
              onCancel={() => setEditingContainer(null)}
              cancelText={t('maritime_freight.job_details_modal.s278', "إلغاء")}
            />
          )}
        >
          <div className="job-submodal-compact" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }} dir="rtl">
            {/* Card 1: الختم والمواعيد */}
            <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
                <AppIcons.Container size={15} />
                <span>{t('maritime_freight.job_details_modal.s279', "1. بيانات الختم والمواعيد (Seal & Schedule)")}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                <Field label={t('maritime_freight.job_details_modal.s280', "رقم الختم الرصاصي (Seal No)")}>
                  <input
                    type="text"
                    value={editContainerForm.sealNumber}
                    onChange={(e) => setEditContainerForm({ ...editContainerForm, sealNumber: e.target.value })}
                  />
                </Field>
                <Field label={t('maritime_freight.job_details_modal.s281', "فترة السماح (أيام)")}>
                  <input
                    type="number"
                    value={editContainerForm.freeDays}
                    onChange={(e) => setEditContainerForm({ ...editContainerForm, freeDays: e.target.value })}
                  />
                </Field>
                <Field label={t('maritime_freight.job_details_modal.s282', "آخر موعد للإرجاع (Return Deadline)")}>
                  <input
                    type="date"
                    value={editContainerForm.returnDeadline}
                    onChange={(e) => setEditContainerForm({ ...editContainerForm, returnDeadline: e.target.value })}
                  />
                </Field>
              </div>
            </div>

            {/* Card 2: الغرامات وحالة التأمين */}
            <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
                <AppIcons.DollarSign size={15} />
                <span>{t('maritime_freight.job_details_modal.s283', "2. الغرامات وحالة التأمين (Demurrage & Deposit)")}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.3fr', gap: '10px' }}>
                <Field label={t('maritime_freight.job_details_modal.s284', "غرامة التأخير اليومية ($)")}>
                  <input
                    type="number"
                    value={editContainerForm.demurrageRatePerDay}
                    onChange={(e) => setEditContainerForm({ ...editContainerForm, demurrageRatePerDay: e.target.value })}
                  />
                </Field>
                <Field label={t('maritime_freight.job_details_modal.s285', "مبلغ التأمين المحتجز")}>
                  <input
                    type="number"
                    value={editContainerForm.depositAmount}
                    onChange={(e) => setEditContainerForm({ ...editContainerForm, depositAmount: e.target.value })}
                  />
                </Field>
                <Field label={t('maritime_freight.job_details_modal.s286', "حالة أمانة التأمين")}>
                  <CustomSelect
                    value={editContainerForm.depositStatus}
                    onChange={(val) => setEditContainerForm({ ...editContainerForm, depositStatus: val as any })}
                    options={[
                      { value: 'not_required', label: t('maritime_freight.job_details_modal.s287', "غير مطلوبة / بدون تأمين") },
                      { value: 'held_by_line', label: t('maritime_freight.job_details_modal.s288', "محتجزة لدى التوكيل الملاحي") },
                      { value: 'pending_return_proof', label: t('maritime_freight.job_details_modal.s289', "بانتظار إثبات إرجاع الفارغ") },
                      { value: 'refunded_to_treasury', label: t('maritime_freight.job_details_modal.s290', "تم الاسترداد للخزينة") },
                      { value: 'forfeited', label: t('maritime_freight.job_details_modal.s291', "تمت مصادرة التأمين") },
                    ]}
                  />
                </Field>
              </div>
            </div>
          </div>
        </StandardDialog>
      )}
    </>
  );
}
