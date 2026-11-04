import { useTranslation } from 'react-i18next';
import { useState, useEffect, useRef } from 'react';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { useSystemCurrency } from '@/shared/hooks/use-system-currency';
import { useAuthStore } from '@/stores/auth-store';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { maritimeApi, MaritimeJob, MaritimeContainer, MaritimeCarrierInvoice, FreightAuditPreview, CargoInsurance, WarehouseReceipt } from '../api/maritime-freight.api';
import { DCSA_STANDARD_MILESTONES, DcsaMilestoneKey } from '../maritime-freight.types';
import { toast, systemConfirm } from '@/shared/components/system-alert';
import { printCarrierDisputeNote, printCargoInsuranceCertificate, printWarehouseReceipt, printFreightInvoice, printJobProfitabilitySheet, printTruckingWaybill } from '../utils/maritime-documents';
import { CustomsDeclarationModal } from './CustomsDeclarationModal';
import { JobEgyptianAciCard } from './job-details/JobEgyptianAciCard';
import { JobExportCutoffsCard } from './job-details/JobExportCutoffsCard';
import { JobRoeForexCard } from './job-details/JobRoeForexCard';
import { JobChargesTab } from './job-details/JobChargesTab';
import { JobDocumentsTab } from './job-details/JobDocumentsTab';
import { JobConsolidationTab } from './job-details/JobConsolidationTab';
import { JobInlandTruckingTab } from './job-details/JobInlandTruckingTab';

interface JobDetailsModalProps {
  open: boolean;
  jobId: string | null;
  onClose: () => void;
  onUpdated: () => void;
}

export function JobDetailsModal({ open, jobId, onClose, onUpdated }: JobDetailsModalProps) {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { currencyCode, currencySymbol } = useSystemCurrency();
  const pendingSubmissions = useRef(new Set<string>());
  const submitOnce = async (key: string, action: () => Promise<void>) => {
    if (pendingSubmissions.current.has(key)) return;
    pendingSubmissions.current.add(key);
    try {
      await action();
    } finally {
      pendingSubmissions.current.delete(key);
    }
  };
  const [currentJobId, setCurrentJobId] = useState<string | null>(jobId);
  const [job, setJob] = useState<MaritimeJob | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'charges' | 'containers' | 'milestones' | 'consolidation' | 'trucking' | 'documents' | 'finance'>('overview');
  const [nextMilestone, setNextMilestone] = useState<DcsaMilestoneKey>('GTI');
  const [milestoneNotes, setMilestoneNotes] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [sendingWhatsAppKey, setSendingWhatsAppKey] = useState<string | null>(null);

  // Sub-Modals
  const [showEditVoyage, setShowEditVoyage] = useState(false);
  const [showAddContainer, setShowAddContainer] = useState(false);
  const [editingContainer, setEditingContainer] = useState<MaritimeContainer | null>(null);
  const [showCustomsModal, setShowCustomsModal] = useState(false);

  // Financial Posting Modals State
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [invoiceAmountInput, setInvoiceAmountInput] = useState('');
  const [invoiceNotesInput, setInvoiceNotesInput] = useState('');
  const [isSubmittingInvoice, setIsSubmittingInvoice] = useState(false);

  const [showExpenseDialog, setShowExpenseDialog] = useState(false);
  const [expenseAmountInput, setExpenseAmountInput] = useState('');
  const [expenseTypeInput, setExpenseTypeInput] = useState<'carrier' | 'port' | 'other'>('carrier');
  const [expensePaymentMethodInput, setExpensePaymentMethodInput] = useState<'payable' | 'cash' | 'bank'>('payable');
  const [expenseNotesInput, setExpenseNotesInput] = useState('');
  const [isSubmittingExpense, setIsSubmittingExpense] = useState(false);

  // Carrier Invoices & Freight Audit State
  const [carrierInvoicesList, setCarrierInvoicesList] = useState<MaritimeCarrierInvoice[]>([]);
  const [loadingCarrierInvoices, setLoadingCarrierInvoices] = useState(false);
  const [carrierInvoiceNumber, setCarrierInvoiceNumber] = useState('');
  const [carrierAuditPreview, setCarrierAuditPreview] = useState<FreightAuditPreview | null>(null);
  const [showOverrideDialog, setShowOverrideDialog] = useState(false);
  const [overrideInvoice, setOverrideInvoice] = useState<MaritimeCarrierInvoice | null>(null);
  const [overrideReasonInput, setOverrideReasonInput] = useState('');
  const [isSubmittingOverride, setIsSubmittingOverride] = useState(false);
  const [showDisputeDialog, setShowDisputeDialog] = useState(false);
  const [disputeInvoice, setDisputeInvoice] = useState<MaritimeCarrierInvoice | null>(null);
  const [disputeReasonInput, setDisputeReasonInput] = useState('');
  const [disputeAmountInput, setDisputeAmountInput] = useState('');
  const [isSubmittingDispute, setIsSubmittingDispute] = useState(false);

  // Smart Booking Extraction State
  const [showSmartParseModal, setShowSmartParseModal] = useState(false);
  const [smartParseText, setSmartParseText] = useState('');
  const [isParsingSmartBooking, setIsParsingSmartBooking] = useState(false);
  const [parsedBookingData, setParsedBookingData] = useState<any | null>(null);
  const [isApplyingParsedData, setIsApplyingParsedData] = useState(false);

  const [ledgerEntries, setLedgerEntries] = useState<any[]>([]);
  const [loadingLedger, setLoadingLedger] = useState(false);

  // Cargo Insurance & Warehouse Intake State
  const [insurancesList, setInsurancesList] = useState<CargoInsurance[]>([]);
  const [loadingInsurances, setLoadingInsurances] = useState(false);
  const [showAddInsuranceDialog, setShowAddInsuranceDialog] = useState(false);
  const [isSubmittingInsurance, setIsSubmittingInsurance] = useState(false);
  const [insuranceForm, setInsuranceForm] = useState({
    policyNumber: '',
    insuranceCompany: '',
    insuredValue: '',
    premiumAmount: '',
    currency: 'USD',
    coverageType: 'all_risks' as 'all_risks' | 'clauses_a' | 'clauses_b' | 'clauses_c',
    issueDate: new Date().toISOString().split('T')[0],
    expiryDate: '',
    notes: '',
  });

  const [showClaimDialog, setShowClaimDialog] = useState(false);
  const [selectedInsuranceForClaim, setSelectedInsuranceForClaim] = useState<CargoInsurance | null>(null);
  const [claimAmountInput, setClaimAmountInput] = useState('');
  const [claimNotesInput, setClaimNotesInput] = useState('');
  const [isSubmittingClaim, setIsSubmittingClaim] = useState(false);

  const [warehouseReceiptsList, setWarehouseReceiptsList] = useState<WarehouseReceipt[]>([]);
  const [loadingWarehouseReceipts, setLoadingWarehouseReceipts] = useState(false);
  const [showAddWarehouseReceiptDialog, setShowAddWarehouseReceiptDialog] = useState(false);
  const [isSubmittingWarehouseReceipt, setIsSubmittingWarehouseReceipt] = useState(false);
  const [warehouseReceiptForm, setWarehouseReceiptForm] = useState({
    packageCount: '1',
    grossWeightKg: '',
    cbm: '',
    bayRackBin: '',
    notes: '',
  });

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

  const fetchJob = async (specificId?: string) => {
    const targetId = specificId || currentJobId || jobId;
    if (!targetId) return;
    try {
      // Insurance and warehouse-receipt lists arrive as part of the job payload, so their loading
      // flags belong to this fetch (they were declared but never toggled, leaving the insurance
      // section's spinner permanently stuck at its initial `false` state).
      setLoadingInsurances(true);
      setLoadingWarehouseReceipts(true);
      const data = await maritimeApi.getJobById(targetId);
      setJob(data);
      setInsurancesList(data.insurances || []);
      setWarehouseReceiptsList(data.warehouseReceipts || []);
    } catch {
      // ignore
    } finally {
      setLoadingInsurances(false);
      setLoadingWarehouseReceipts(false);
    }
  };

  const fetchLedger = async (id: string) => {
    try {
      setLoadingLedger(true);
      const res = await maritimeApi.getJobFinancialLedger(id);
      setLedgerEntries(res.entries || []);
    } catch {
      setLedgerEntries([]);
    } finally {
      setLoadingLedger(false);
    }
  };

  const fetchCarrierInvoices = async (id: string) => {
    try {
      setLoadingCarrierInvoices(true);
      const data = await maritimeApi.listJobCarrierInvoices(id);
      setCarrierInvoicesList(data || []);
    } catch {
      setCarrierInvoicesList([]);
    } finally {
      setLoadingCarrierInvoices(false);
    }
  };

  useEffect(() => {
    if (open && jobId) {
      setCurrentJobId(jobId);
      fetchJob(jobId);
    } else if (!open) {
      setCurrentJobId(null);
      setJob(null);
      setLedgerEntries([]);
      setCarrierInvoicesList([]);
      setInsurancesList([]);
      setWarehouseReceiptsList([]);
    }
  }, [open, jobId]);

  // Insurance Handlers
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
        issue_date: insuranceForm.issueDate || new Date().toISOString().split('T')[0],
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
        issueDate: new Date().toISOString().split('T')[0],
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

  const handleOpenClaim = (ins: CargoInsurance) => {
    setSelectedInsuranceForClaim(ins);
    setClaimAmountInput(String(ins.insured_value || ''));
    setClaimNotesInput('');
    setShowClaimDialog(true);
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
      setShowClaimDialog(false);
      setSelectedInsuranceForClaim(null);
      await fetchJob();
      onUpdated();
    } catch (err: any) {
      toast.error(err?.message || 'فشل تسجيل المطالبة التأمينية');
    } finally {
      setIsSubmittingClaim(false);
    }
  };

  // Warehouse Receipts Handlers
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

  const handleReleaseWarehouseReceipt = async (receipt: WarehouseReceipt) => {
    const confirmed = await systemConfirm({
      title: 'الإفراج والتسليم من المستودع (Warehouse Release)',
      badge: receipt.receipt_number,
      message: `هل تريد اعتماد الإفراج النهائي عن الطرود المسجلة بالإذن ${receipt.receipt_number} وتسليمها للعميل/السائق؟`,
      confirmText: 'تأكيد الإفراج والتسليم',
      cancelText: 'تراجع',
      variant: 'primary',
    });
    if (!confirmed) return;
    try {
      await maritimeApi.releaseWarehouseReceipt(receipt.id, { notes: 'تم الإفراج والتسليم للعميل بموجب إذن تسليم رسمي' });
      toast.success(`تم اعتماد الإفراج عن البضاعة بالإذن ${receipt.receipt_number} بنجاح`);
      await fetchJob();
      onUpdated();
    } catch (err: any) {
      toast.error(err?.message || 'فشل الإفراج عن البضاعة');
    }
  };

  useEffect(() => {
    if (activeTab === 'finance' && job?.id) {
      fetchLedger(String(job.id));
      fetchCarrierInvoices(String(job.id));
    }
  }, [activeTab, job?.id]);

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

  // Populate Edit Voyage form when opening
  const handleOpenEditVoyage = () => {
    if (!job) return;
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
    setShowEditVoyage(true);
  };

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

  // Edit Container
  const handleOpenEditContainer = (c: MaritimeContainer) => {
    setEditingContainer(c);
    setEditContainerForm({
      sealNumber: c.seal_number || '',
      freeDays: String(c.free_days ?? 14),
      returnDeadline: c.return_deadline ? c.return_deadline.split('T')[0] : '',
      demurrageRatePerDay: String(c.demurrage_rate_per_day ?? 50),
      depositAmount: String(c.deposit_amount || 0),
      depositCurrency: c.deposit_currency || 'USD',
      depositStatus: c.deposit_status || 'not_required',
      notes: c.notes || '',
    });
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

  // Container quick movement triggers
  const handleContainerDischarge = async (c: MaritimeContainer) => {
    const confirmed = await systemConfirm({
      title: 'تسجيل تفريغ الحاوية بميناء الوصول (Discharged)',
      badge: c.container_number,
      message: `هل تريد تسجيل تفريغ الحاوية ${c.container_number} وبدء سريان فترة السماح (${c.free_days ?? 14} يوم)؟`,
      confirmText: 'تأكيد التفريغ',
      cancelText: 'تراجع',
      variant: 'primary',
    });
    if (!confirmed) return;
    try {
      const nowIso = new Date().toISOString();
      await maritimeApi.updateContainer(c.id, { dischargedAt: nowIso });
      toast.success(`تم تسجيل تفريغ الحاوية ${c.container_number} وحساب مهلة الإرجاع`);
      await fetchJob();
      onUpdated();
    } catch (err: any) {
      toast.error(err?.message || 'فشل تسجيل تفريغ الحاوية');
    }
  };

  const handleContainerGateOut = async (c: MaritimeContainer) => {
    const confirmed = await systemConfirm({
      title: 'تسجيل خروج الحاوية من بوابة الميناء (Gate Out)',
      badge: c.container_number,
      message: `هل تم خروج الحاوية ${c.container_number} من ساحات الميناء وتوجيهها لمقر العميل؟`,
      confirmText: 'تسجيل الخروج',
      cancelText: 'تراجع',
      variant: 'primary',
    });
    if (!confirmed) return;
    try {
      const nowIso = new Date().toISOString();
      await maritimeApi.updateContainer(c.id, { gatedOutAt: nowIso });
      toast.success(`تم تسجيل خروج الحاوية ${c.container_number} بنجاح`);
      await fetchJob();
      onUpdated();
    } catch (err: any) {
      toast.error(err?.message || 'فشل تسجيل خروج الحاوية');
    }
  };

  const handleContainerEmptyReturned = async (c: MaritimeContainer) => {
    const confirmed = await systemConfirm({
      title: 'تسجيل إرجاع الحاوية الفارغة (Empty Returned)',
      badge: c.container_number,
      message: `هل تم تسليم الحاوية الفارغة ${c.container_number} لساحة الخط الملاحي وإغلاق مهلة الغرامات؟`,
      confirmText: 'تأكيد الإرجاع',
      cancelText: 'تراجع',
      variant: 'primary',
    });
    if (!confirmed) return;
    try {
      const nowIso = new Date().toISOString();
      await maritimeApi.updateContainer(c.id, {
        emptyReturnedAt: nowIso,
        depositStatus: 'pending_return_proof',
      });
      toast.success(`تم إغلاق ملف الحاوية ${c.container_number} وتحويل التأمين لمعالجة الرد`);
      await fetchJob();
      onUpdated();
    } catch (err: any) {
      toast.error(err?.message || 'فشل تسجيل إرجاع الحاوية');
    }
  };

  // Quick Billing / Voucher Triggers
  const handleOpenIssueInvoice = () => {
    if (!job) return;
    setInvoiceAmountInput(String(job.client_invoiced_total || ''));
    setInvoiceNotesInput(`فاتورة مبيعات خدمات ملاحية - العملية #${job.job_number} (${job.customer_name})`);
    setShowInvoiceDialog(true);
  };

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

  const handleOpenRecordExpense = () => {
    if (!job) return;
    setExpenseAmountInput('');
    setCarrierInvoiceNumber('');
    setCarrierAuditPreview(null);
    setExpenseTypeInput('carrier');
    setExpensePaymentMethodInput('payable');
    setExpenseNotesInput(`فاتورة نولون ومصروفات الخط الملاحي - العملية #${job.job_number}`);
    setShowExpenseDialog(true);
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

  const handleOpenDispute = (inv: MaritimeCarrierInvoice) => {
    setDisputeInvoice(inv);
    const variance = Number(inv.varianceAmount || 0);
    setDisputeAmountInput(String(variance > 0 ? variance : inv.totalInvoicedAmount));
    setDisputeReasonInput(`فروق أسعار عن التعرفة المعتمدة: الفاتورة #${inv.invoiceNumber} بمبلغ ${inv.totalInvoicedAmount} مقابل تعرفة متعاقد عليها ${inv.contractedAmount}`);
    setShowDisputeDialog(true);
  };

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

  const handleOpenOverrideDialog = (inv: MaritimeCarrierInvoice) => {
    setOverrideInvoice(inv);
    setOverrideReasonInput('');
    setShowOverrideDialog(true);
  };

  const handleConfirmOverride = async () => {
    if (!overrideInvoice || !job) return;

    if (user?.id && overrideInvoice.createdBy && String(user.id) === String(overrideInvoice.createdBy)) {
      toast.error('لا يمكنك اعتماد التجاوز المالي بنفسك (يجب أن يعتمد الفاتورة مسؤول مالي آخر تطبيقاً لمبدأ فصل المهام Maker-Checker)');
      return;
    }

    if (overrideReasonInput.trim().length < 10) {
      toast.warning('يجب إدخال مبرر مالي تفصيلي لاعتماد التجاوز لا يقل عن 10 أحرف');
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

  const [isSettlingFromBalance, setIsSettlingFromBalance] = useState(false);

  const handleSettleFromBalance = async () => {
    if (!job?.id) return;
    const availableCredit = Number(job.customerAvailableCredit || 0);
    const invoiced = Number(job.client_invoiced_total || 0);
    const paid = Number(job.client_paid_total || 0);
    const unpaid = Math.max(0, invoiced - paid);
    const amountToSettle = Math.min(unpaid > 0 ? unpaid : invoiced, availableCredit);

    if (amountToSettle <= 0) {
      toast.warning('لا يوجد مبلغ مستحق للتسوية أو رصيد دائن متاح');
      return;
    }

    const confirmed = await systemConfirm({
      title: 'تأكيد سداد الشحنة من الرصيد الدائن',
      message: `هل تريد تسوية وخصم مبلغ ${currencySymbol} ${amountToSettle.toLocaleString()} من رصيد العميل المتاح (${job.customer_name}) لصالح هذه الشحنة؟`,
      confirmText: 'نعم، خصم وسداد الشحنة',
      cancelText: 'إلغاء',
    });

    if (!confirmed) return;

    try {
      setIsSettlingFromBalance(true);
      const res = await maritimeApi.settleJobFromBalance(String(job.id), amountToSettle);
      toast.success(res.message);
      await fetchJob();
      if (activeTab === 'finance') {
        await fetchLedger(String(job.id));
      }
      onUpdated();
    } catch (err: any) {
      toast.error(err?.message || 'تعذر تسوية الشحنة من رصيد العميل');
    } finally {
      setIsSettlingFromBalance(false);
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

  if (!open) return null;

  if (!job) {
    return (
      <StandardDialog
        open={open}
        onClose={onClose}
        title={t('maritime_freight.job_details_modal.s0', "ملف العملية الملاحية")}
        subtitle={t('maritime_freight.job_details_modal.s1', "جاري جلب تفاصيل وبيانات العملية...")}
        width="min(1180px, 95vw)"
        height="min(680px, 88vh)"
        loading={true}
        loadingText={t('maritime_freight.job_details_modal.s2', "جاري تحميل ملف العملية الملاحية...")}
      >
        <div style={{ minHeight: '420px' }} />
      </StandardDialog>
    );
  }

  const handleAdvanceMilestone = async () => {
    try {
      await maritimeApi.addJobMilestone(job.id, nextMilestone, milestoneNotes || undefined);
      setMilestoneNotes('');
      await fetchJob();
      onUpdated();
      toast.success('تم تسجيل المرحلة الملاحية وتحديث التتبع بنجاح');
    } catch (err: any) {
      toast.error(err?.message || 'فشل تحديث المرحلة الملاحية');
    }
  };

  const handleReleaseDo = async () => {
    const confirmed = await systemConfirm({
      title: 'اعتماد وتسليم إذن التسليم الملاحي D/O',
      badge: job.job_number,
      message: 'هل أنت متأكد من اعتماد وتسليم إذن التسليم الملاحي الرسمي (Delivery Order) للعميل؟',
      impactItems: [
        'تسجيل مرحلة D/O الرسمية في سجل الشحنة وتحديث بوابات التتبع للعميل.',
        'إتمام إجراءات الإفراج الجمركي والسماح بخروج الحاويات من ساحات الميناء.',
      ],
      confirmText: 'اعتماد وتسليم إذن الإفراج',
      cancelText: 'تراجع',
      variant: 'primary',
    });
    if (!confirmed) return;
    try {
      await maritimeApi.releaseDeliveryOrder(job.id);
      await fetchJob();
      onUpdated();
      toast.success('تم اعتماد وتسليم إذن التسليم D/O بنجاح');
    } catch (err: any) {
      toast.error(err?.message || 'فشل تسليم إذن الإفراج');
    }
  };

  const trackingUrl = job.tracking_token
    ? `${window.location.origin}/public/track/${job.tracking_token}`
    : '';

  const handleCopyTrackingLink = () => {
    if (trackingUrl) {
      navigator.clipboard.writeText(trackingUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const handleSendDirectWhatsApp = async (milestoneKey: string) => {
    if (!job) return;
    try {
      setSendingWhatsAppKey(milestoneKey);
      const res = await maritimeApi.sendJobMilestoneWhatsApp(job.id, milestoneKey, job.customer_phone || undefined);
      if (res.success) {
        toast.success('تم إرسال إشعار الواتساب للعميل عبر بوابة Cloud WhatsApp بنجاح');
      } else {
        toast.info(res.message || 'تمت محاولة الإرسال');
      }
    } catch (err: any) {
      toast.error(err?.message || 'فشل إرسال إشعار الواتساب المباشر');
    } finally {
      setSendingWhatsAppKey(null);
    }
  };

  if (!job && open) {
    return (
      <StandardDialog
        open={open}
        onClose={onClose}
        title={t('maritime_freight.job_details_modal.s3', "جاري التحميل...")}
        subtitle={t('maritime_freight.job_details_modal.s4', "ملف العملية اللوجستية")}
        width="min(1180px, 95vw)"
        height="min(780px, 90vh)"
      >
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', minHeight: '320px', color: '#64748b' }}>
          {t('maritime_freight.job_details_modal.s5', "جاري تحميل ملف العملية...")}
        </div>
      </StandardDialog>
    );
  }

  if (!job) return null;

  const renderModeBadge = (mode?: string) => {
    if (mode === 'air') {
      return (
        <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 800, background: '#e0f2fe', color: '#0369a1', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <AppIcons.Plane size={13} />
          {t('maritime_freight.job_details_modal.s6', "شحن جوي (Air Freight)")}
        </span>
      );
    }
    if (mode === 'road') {
      return (
        <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 800, background: '#fef3c7', color: '#b45309', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <AppIcons.Truck size={13} />
          {t('maritime_freight.job_details_modal.s7', "شحن بري (Road Freight)")}
        </span>
      );
    }
    if (mode === 'multimodal') {
      return (
        <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 800, background: '#f3e8ff', color: '#7e22ce', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          {t('maritime_freight.job_details_modal.s8', "متعدد الوسائط (Multimodal)")}
        </span>
      );
    }
    return (
      <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 800, background: '#e0e7ff', color: '#3730a3', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        <AppIcons.Ship size={13} />
        {t('maritime_freight.job_details_modal.s9', "شحن بحري (Ocean Freight)")}
      </span>
    );
  };

  return (
    <>
      <StandardDialog
        open={open}
        onClose={onClose}
        title={`ملف العملية: ${job.job_number}`}
        subtitle={(
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span>{t('maritime_freight.job_details_modal.s10', "العميل:")} {job.customer_name} {t('maritime_freight.job_details_modal.s11', "| المسار:")} {job.pol_name} {t('maritime_freight.job_details_modal.s12', "إلى")} {job.pod_name}</span>
            {renderModeBadge(job.transport_mode)}
          </div>
        )}
        width="min(1180px, 95vw)"
        height="min(780px, 90vh)"
        footerActions={(
          <StandardDialogFooter
            onCancel={onClose}
            cancelText={t('maritime_freight.job_details_modal.s13', "إغلاق")}
          />
        )}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }} dir="rtl">
          {/* هيدر التبويبات القياسي */}
          <div style={{ display: 'flex', gap: '6px', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px', flexShrink: 0, overflowX: 'auto' }}>
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                border: 'none',
                background: activeTab === 'overview' ? '#170e5e' : '#f1f5f9',
                color: activeTab === 'overview' ? '#ffffff' : '#475569',
                fontWeight: 700,
                fontSize: '0.8rem',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {t('maritime_freight.job_details_modal.s14', "بيانات الرحلة والحجز")}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('charges')}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                border: 'none',
                background: activeTab === 'charges' ? '#170e5e' : '#f1f5f9',
                color: activeTab === 'charges' ? '#ffffff' : '#475569',
                fontWeight: 700,
                fontSize: '0.8rem',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {t('maritime_freight.job_details_modal.s15', "بنود الرسوم والتسعير (Charges)")}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('containers')}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                border: 'none',
                background: activeTab === 'containers' ? '#170e5e' : '#f1f5f9',
                color: activeTab === 'containers' ? '#ffffff' : '#475569',
                fontWeight: 700,
                fontSize: '0.8rem',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {job.transport_mode === 'air' ? t('maritime_freight.job_details_modal.s16', "بيانات الشحنة والمستودع") : `الحاويات والمستودع (${job.containers?.length || 0})`}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('milestones')}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                border: 'none',
                background: activeTab === 'milestones' ? '#170e5e' : '#f1f5f9',
                color: activeTab === 'milestones' ? '#ffffff' : '#475569',
                fontWeight: 700,
                fontSize: '0.8rem',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {job.transport_mode === 'air' ? `تتبع Cargo iQ (${job.milestones?.length || 0})` : `مسار التتبع DCSA (${job.milestones?.length || 0})`}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('consolidation')}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                border: 'none',
                background: activeTab === 'consolidation' ? '#170e5e' : '#f1f5f9',
                color: activeTab === 'consolidation' ? '#ffffff' : '#475569',
                fontWeight: 700,
                fontSize: '0.8rem',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {t('maritime_freight.job_details_modal.s17', "التجميع المشترك (LCL)")}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('trucking')}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                border: 'none',
                background: activeTab === 'trucking' ? '#170e5e' : '#f1f5f9',
                color: activeTab === 'trucking' ? '#ffffff' : '#475569',
                fontWeight: 700,
                fontSize: '0.8rem',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {t('maritime_freight.job_details_modal.s18', "النقل البري والترحيل")}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('documents')}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                border: 'none',
                background: activeTab === 'documents' ? '#170e5e' : '#f1f5f9',
                color: activeTab === 'documents' ? '#ffffff' : '#475569',
                fontWeight: 700,
                fontSize: '0.8rem',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {t('maritime_freight.job_details_modal.s19', "الحافظة وبوالص الشحن (Docs)")}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('finance')}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                border: 'none',
                background: activeTab === 'finance' ? '#170e5e' : '#f1f5f9',
                color: activeTab === 'finance' ? '#ffffff' : '#475569',
                fontWeight: 700,
                fontSize: '0.8rem',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {t('maritime_freight.job_details_modal.s20', "ربحية العملية والتأمين (Job P&L)")}
            </button>
          </div>

          {/* جسم التبويبات الموحد بارتفاع ثابت */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', paddingInlineEnd: '4px' }}>
            {/* Tab 1: نظرة عامة وبيانات الحجز */}
            {activeTab === 'overview' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
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
                        setSmartParseText('');
                        setParsedBookingData(null);
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

                {/* 5. رادار التتبع الحي (طيران أو سفن بحسب النمط) */}
                {job.transport_mode === 'air' ? (
                  <div
                    style={{
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '10px',
                      padding: '12px 16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', fontWeight: 800, color: '#0369a1' }}>
                        <AppIcons.Plane size={17} />
                        <span>{t('maritime_freight.job_details_modal.s68', "رادار تتبع حركة الطيران والشحن الجوي الحي (Live Flight Tracker)")}</span>
                      </div>
                      {job.flight_number && (
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: '6px', background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' }}>
                          {t('maritime_freight.job_details_modal.s69', "رحلة مسجلة")}
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                      <div>
                        <div style={{ fontSize: '0.92rem', fontWeight: 800, color: '#0f172a' }}>
                          {job.flight_number ? `رحلة رقم: ${job.flight_number}` : t('maritime_freight.job_details_modal.s70', "لم يتم تسجيل رقم الرحلة بعد")}
                        </div>
                        <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: '2px' }}>
                          {t('maritime_freight.job_details_modal.s71', "المسار الجوي:")} <strong>{job.pol_name} ({job.pol_code})</strong> ← <strong>{job.pod_name} ({job.pod_code})</strong> {t('maritime_freight.job_details_modal.s72', "| الناقل:")} {job.shipping_line_name}
                        </div>
                      </div>

                      {job.flight_number ? (
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <a
                            href={`https://www.flightradar24.com/data/flights/${encodeURIComponent(job.flight_number.replace(/\s+/g, ''))}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              padding: '6px 12px',
                              background: '#0284c7',
                              color: '#ffffff',
                              borderRadius: '6px',
                              fontSize: '0.76rem',
                              fontWeight: 700,
                              textDecoration: 'none',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                            }}
                          >
                            <span>Flightradar24</span>
                            <AppIcons.Globe size={13} />
                          </a>
                          <a
                            href={`https://flightaware.com/live/flight/${encodeURIComponent(job.flight_number.replace(/\s+/g, ''))}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              padding: '6px 12px',
                              background: '#0369a1',
                              color: '#ffffff',
                              borderRadius: '6px',
                              fontSize: '0.76rem',
                              fontWeight: 700,
                              textDecoration: 'none',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                            }}
                          >
                            <span>FlightAware</span>
                            <AppIcons.Globe size={13} />
                          </a>
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.76rem', color: '#94a3b8' }}>
                          {t('maritime_freight.job_details_modal.s73', "قم بإدخال رقم الرحلة لتفعيل رادار التتبع الجوي")}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '10px',
                      padding: '12px 16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', fontWeight: 800, color: '#170e5e' }}>
                        <AppIcons.Ship size={17} />
                        <span>{t('maritime_freight.job_details_modal.s74', "رادار القمر الصناعي لتتبع حركة السفينة الحية (Live Satellite AIS Tracker)")}</span>
                      </div>
                      {job.vessel_name && (
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: '6px', background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' }}>
                          {t('maritime_freight.job_details_modal.s75', "متصل AIS")}
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                      <div>
                        <div style={{ fontSize: '0.92rem', fontWeight: 800, color: '#0f172a' }}>
                          {job.vessel_name || t('maritime_freight.job_details_modal.s76', "لم يتم تسجيل اسم السفينة بعد")}
                        </div>
                        <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: '2px' }}>
                          {t('maritime_freight.job_details_modal.s77', "المسار البحري:")} <strong>{job.pol_name}</strong> ← <strong>{job.pod_name}</strong> {job.voyage_number ? `| رحلة رقم: ${job.voyage_number}` : ''}
                        </div>
                      </div>

                      {job.vessel_name ? (
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <a
                            href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:0/vessel:${encodeURIComponent(job.vessel_name)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              padding: '6px 12px',
                              background: '#1d4ed8',
                              color: '#ffffff',
                              borderRadius: '6px',
                              fontSize: '0.76rem',
                              fontWeight: 700,
                              textDecoration: 'none',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                            }}
                          >
                            <span>MarineTraffic AIS</span>
                            <AppIcons.Globe size={13} />
                          </a>
                          <a
                            href={`https://www.vesselfinder.com/vessels?name=${encodeURIComponent(job.vessel_name)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              padding: '6px 12px',
                              background: '#047857',
                              color: '#ffffff',
                              borderRadius: '6px',
                              fontSize: '0.76rem',
                              fontWeight: 700,
                              textDecoration: 'none',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                            }}
                          >
                            <span>VesselFinder AIS</span>
                            <AppIcons.Globe size={13} />
                          </a>
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.76rem', color: '#94a3b8' }}>
                          {t('maritime_freight.job_details_modal.s78', "قم بإدخال اسم السفينة لتفعيل رادار التتبع")}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 6. بطاقات الامتثال والمواعيد والعملات المتعددة */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <JobEgyptianAciCard
                    job={job}
                    onUpdated={() => {
                      fetchJob();
                      onUpdated();
                    }}
                  />
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '12px' }}>
                    <JobExportCutoffsCard
                      job={job}
                      onUpdated={() => {
                        fetchJob();
                        onUpdated();
                      }}
                    />
                    <JobRoeForexCard
                      job={job}
                      onUpdated={() => {
                        fetchJob();
                        onUpdated();
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: قائمة الحاويات / البضائع واستلام المستودع */}
            {activeTab === 'containers' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {job.transport_mode === 'air' ? (
                  /* بطاقة تفاصيل الشحنة الجوية للأوزان والأبعاد */
                  <div style={{ background: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#e0f2fe', color: '#0369a1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <AppIcons.Plane size={20} />
                        </div>
                        <div>
                          <div style={{ fontSize: '0.96rem', fontWeight: 800, color: '#0f172a' }}>
                            {t('maritime_freight.job_details_modal.s79', "مواصفات الشحنة الجوية (Air Cargo Specifications)")}
                          </div>
                          <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                            {t('maritime_freight.job_details_modal.s80', "الناقل الجوي:")} <strong>{job.shipping_line_name}</strong> {t('maritime_freight.job_details_modal.s81', "| الرحلة:")} <strong>{job.flight_number || t('maritime_freight.job_details_modal.s82', "قيد التحديد")}</strong>
                          </div>
                        </div>
                      </div>
                      <span style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '0.76rem', fontWeight: 800, background: '#e0f2fe', color: '#0369a1' }}>
                        {t('maritime_freight.job_details_modal.s83', "معيار إياتا IATA (1:6000)")}
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', background: '#f8fafc', padding: '14px', borderRadius: '10px' }}>
                      <div>
                        <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>{t('maritime_freight.job_details_modal.s84', "الوزن القائم الفعلي (Gross Weight)")}</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                          {Number(job.gross_weight_kg || 0).toLocaleString()} {t('maritime_freight.job_details_modal.s85', "كجم")}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>{t('maritime_freight.job_details_modal.s86', "الوزن الحجمي (Volumetric Weight)")}</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0369a1', marginTop: '4px' }}>
                          {Number(job.volumetric_weight_kg || 0).toLocaleString()} {t('maritime_freight.job_details_modal.s87', "كجم")}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>{t('maritime_freight.job_details_modal.s88', "الوزن الخاضع للتحصيل (Chargeable)")}</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 900, color: '#15803d', marginTop: '4px' }}>
                          {Number(job.chargeable_weight_kg || Math.max(job.gross_weight_kg || 0, job.volumetric_weight_kg || 0)).toLocaleString()} {t('maritime_freight.job_details_modal.s89', "كجم")}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>{t('maritime_freight.job_details_modal.s90', "الحجم وعدد الطرود")}</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#170e5e', marginTop: '4px' }}>
                          {job.package_count || 1} {t('maritime_freight.job_details_modal.s91', "طرد (")}{job.total_cbm || 0} {t('maritime_freight.job_details_modal.s92', "م³)")}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '10px 14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#170e5e' }}>
                        {t('maritime_freight.job_details_modal.s93', "إدارة الحاويات وتتبع فترة السماح والغرامات")}
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowAddContainer(true)}
                        style={{
                          padding: '6px 14px',
                          background: '#170e5e',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '0.8rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {t('maritime_freight.job_details_modal.s94', "إضافة حاوية جديدة")}
                      </button>
                    </div>

                    {job.containers?.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '40px', background: '#f8fafc', borderRadius: '12px', border: '1px dashed #cbd5e1', color: '#64748b', fontSize: '0.85rem' }}>
                        {t('maritime_freight.job_details_modal.s95', "لا توجد حاويات مسجلة في هذا الملف بعد. انقر على \"إضافة حاوية جديدة\" لإدراج حاويات الشحنة.")}
                      </div>
                    ) : (
                      job.containers?.map((c) => (
                        <div key={c.id} style={{ background: '#ffffff', padding: '14px 16px', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '10px', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.03)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <span style={{ fontSize: '1.05rem', fontWeight: 900, color: '#170e5e' }}>{c.container_number}</span>
                              <span style={{ padding: '3px 10px', background: '#f1f5f9', color: '#1e293b', borderRadius: '6px', fontSize: '0.76rem', fontWeight: 700 }}>
                                {c.container_type}
                              </span>
                              {c.seal_number && (
                                <span style={{ fontSize: '0.78rem', color: '#64748b', background: '#fafafa', padding: '2px 8px', borderRadius: '4px', border: '1px solid #f1f5f9' }}>
                                  {t('maritime_freight.job_details_modal.s96', "ختم:")} {c.seal_number}
                                </span>
                              )}
                            </div>
                            <div>
                              {c.empty_returned_at ? (
                                <span style={{ padding: '4px 12px', background: '#f1f5f9', color: '#475569', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 700 }}>
                                  {t('maritime_freight.job_details_modal.s97', "تم إرجاع الفارغ بنجاح")}
                                </span>
                              ) : (
                                <span style={{ padding: '4px 12px', background: c.is_overdue ? '#fef2f2' : '#f0fdf4', color: c.is_overdue ? '#b91c1c' : '#15803d', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 700 }}>
                                  {c.is_overdue ? `تجاوزت المهلة (${c.overdue_days || 0} يوم غرامة)` : t('maritime_freight.job_details_modal.s98', "سارية ضمن فترة السماح")}
                                </span>
                              )}
                            </div>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', background: '#f8fafc', padding: '10px 12px', borderRadius: '8px', fontSize: '0.78rem' }}>
                            <div>
                              <span style={{ color: '#64748b' }}>{t('maritime_freight.job_details_modal.s99', "فترة السماح:")} </span>
                              <strong style={{ color: '#0f172a' }}>{c.free_days || 14} {t('maritime_freight.job_details_modal.s100', "يوم")}</strong>
                            </div>
                            <div>
                              <span style={{ color: '#64748b' }}>{t('maritime_freight.job_details_modal.s101', "موعد الإرجاع:")} </span>
                              <strong style={{ color: c.is_overdue ? '#b91c1c' : '#0f172a' }}>{c.return_deadline || t('maritime_freight.job_details_modal.s102', "لم يحدد")}</strong>
                            </div>
                            <div>
                              <span style={{ color: '#64748b' }}>{t('maritime_freight.job_details_modal.s103', "مبلغ التأمين:")} </span>
                              <strong style={{ color: '#0f172a' }}>{Number(c.deposit_amount).toLocaleString()} {c.deposit_currency || 'USD'}</strong>
                            </div>
                            <div>
                              <span style={{ color: '#64748b' }}>{t('maritime_freight.job_details_modal.s104', "حالة التأمين:")} </span>
                              <strong style={{ color: '#170e5e' }}>{c.deposit_status || 'not_required'}</strong>
                            </div>
                          </div>

                          {/* أزرار الإجراءات السريعة للحاوية */}
                          <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid #f1f5f9', paddingTop: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              onClick={() => printTruckingWaybill(job, c)}
                              style={{
                                padding: '4px 10px',
                                background: '#f8fafc',
                                color: '#170e5e',
                                border: '1px solid #cbd5e1',
                                borderRadius: '6px',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              <AppIcons.Truck size={13} />
                              <span>{t('maritime_freight.job_details_modal.s105', "إذن النقل البري (CMR)")}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenEditContainer(c)}
                              style={{
                                padding: '4px 10px',
                                background: '#f8fafc',
                                color: '#334155',
                                border: '1px solid #cbd5e1',
                                borderRadius: '6px',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              {t('maritime_freight.job_details_modal.s106', "تعديل الحاوية")}
                            </button>
                            {!c.discharged_at && (
                              <button
                                type="button"
                                onClick={() => submitOnce(`discharge-${c.id}`, () => handleContainerDischarge(c))}
                                style={{
                                  padding: '4px 10px',
                                  background: '#eff6ff',
                                  color: '#1d4ed8',
                                  border: '1px solid #bfdbfe',
                                  borderRadius: '6px',
                                  fontSize: '0.75rem',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                }}
                              >
                                {t('maritime_freight.job_details_modal.s107', "تسجيل تفريغ الميناء (Discharged)")}
                              </button>
                            )}
                            {c.discharged_at && !c.gated_out_at && (
                              <button
                                type="button"
                                onClick={() => submitOnce(`gate-out-${c.id}`, () => handleContainerGateOut(c))}
                                style={{
                                  padding: '4px 10px',
                                  background: '#fffbeb',
                                  color: '#b45309',
                                  border: '1px solid #fde68a',
                                  borderRadius: '6px',
                                  fontSize: '0.75rem',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                }}
                              >
                                {t('maritime_freight.job_details_modal.s108', "تسجيل خروج البوابة (Gate Out)")}
                              </button>
                            )}
                            {!c.empty_returned_at && (
                              <button
                                type="button"
                                onClick={() => submitOnce(`return-${c.id}`, () => handleContainerEmptyReturned(c))}
                                style={{
                                  padding: '4px 10px',
                                  background: '#f0fdf4',
                                  color: '#15803d',
                                  border: '1px solid #bbf7d0',
                                  borderRadius: '6px',
                                  fontSize: '0.75rem',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                }}
                              >
                                {t('maritime_freight.job_details_modal.s109', "تسجيل إرجاع الفارغ (Empty Returned)")}
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </>
                )}

                {/* قسم أذون استلام وإيداع المستودع الترانزيت والجمركي (Transit & Bonded Warehouse Intake Receipts - MWR) */}
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                  <div style={{ padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <AppIcons.Archive size={17} />
                      <div>
                        <span style={{ fontSize: '0.84rem', fontWeight: 800, color: '#170e5e' }}>
                          {t('maritime_freight.job_details_modal.s110', "أذون استلام وإيداع المستودع الترانزيت والجمركي (Warehouse Intake - MWR)")}
                        </span>
                        <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                          {t('maritime_freight.job_details_modal.s111', "إدارة استلام الطرود، تخصيص الأرفف والساحات (Bay/Rack/Bin)، وأوامر الإفراج والتسليم")}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAddWarehouseReceiptDialog(true)}
                      style={{
                        padding: '6px 14px',
                        background: '#047857',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {t('maritime_freight.job_details_modal.s112', "+ إذن استلام مستودع (MWR)")}
                    </button>
                  </div>

                  {loadingWarehouseReceipts ? (
                    <div style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: '0.8rem' }}>
                      {t('maritime_freight.job_details_modal.s113', "جاري تحميل أذون استلام المستودع...")}
                    </div>
                  ) : warehouseReceiptsList.length === 0 ? (
                    <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem' }}>
                      {t('maritime_freight.job_details_modal.s114', "لا توجد أذون استلام مستودع مسجلة لهذه العملية بعد. يمكنك إصدار إذن استلام لتسجيل إيداع الطرود بمستودع الترانزيت أو الإيداع الجمركي.")}
                    </div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'right' }}>
                          <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s115', "رقم الإذن (MWR)")}</th>
                          <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s116', "تاريخ الاستلام")}</th>
                          <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s117', "عدد الطرود")}</th>
                          <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s118', "الوزن / الحجم")}</th>
                          <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s119', "موقع التخزين (Bay/Rack/Bin)")}</th>
                          <th style={{ padding: '8px 12px', fontWeight: 700, textAlign: 'center' }}>{t('maritime_freight.job_details_modal.s120', "الحالة")}</th>
                          <th style={{ padding: '8px 12px', fontWeight: 700, textAlign: 'center' }}>{t('maritime_freight.job_details_modal.s121', "الإجراءات")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {warehouseReceiptsList.map((rcpt) => (
                          <tr key={rcpt.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '8px 12px', fontWeight: 800, fontFamily: 'monospace', color: '#170e5e' }}>
                              {rcpt.receipt_number}
                            </td>
                            <td style={{ padding: '8px 12px', color: '#64748b' }}>
                              {rcpt.received_date ? new Date(rcpt.received_date).toLocaleString('ar-EG') : '—'}
                            </td>
                            <td style={{ padding: '8px 12px', fontWeight: 700, color: '#0f172a' }}>
                              {rcpt.package_count || 1} {t('maritime_freight.job_details_modal.s122', "طرد")}
                            </td>
                            <td style={{ padding: '8px 12px', color: '#334155' }}>
                              {Number(rcpt.gross_weight_kg || 0).toLocaleString()} {t('maritime_freight.job_details_modal.s123', "كجم |")} {Number(rcpt.cbm || 0).toFixed(2)} {t('maritime_freight.job_details_modal.s124', "م³")}
                            </td>
                            <td style={{ padding: '8px 12px', color: '#1e293b', fontWeight: 600 }}>
                              {rcpt.bay_rack_bin || t('maritime_freight.job_details_modal.s125', "ساحة الاستلام والتفتيش")}
                            </td>
                            <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                              <span
                                style={{
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                  fontSize: '0.7rem',
                                  fontWeight: 700,
                                  background: rcpt.warehouse_status === 'released' ? '#dcfce7' : '#eff6ff',
                                  color: rcpt.warehouse_status === 'released' ? '#15803d' : '#1e40af',
                                }}
                              >
                                {rcpt.warehouse_status === 'released' ? t('maritime_freight.job_details_modal.s126', "تم الإفراج والتسليم") : t('maritime_freight.job_details_modal.s127', "مودعة بالمستودع")}
                              </span>
                            </td>
                            <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                              <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                                <button
                                  type="button"
                                  onClick={() => printWarehouseReceipt(job, rcpt)}
                                  style={{
                                    padding: '3px 8px',
                                    background: '#170e5e',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    fontSize: '0.68rem',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                  }}
                                >
                                  {t('maritime_freight.job_details_modal.s128', "طباعة الإذن")}
                                </button>
                                {rcpt.warehouse_status !== 'released' && (
                                  <button
                                    type="button"
                                    onClick={() => handleReleaseWarehouseReceipt(rcpt)}
                                    style={{
                                      padding: '3px 8px',
                                      background: '#16a34a',
                                      color: '#ffffff',
                                      border: 'none',
                                      borderRadius: '4px',
                                      fontSize: '0.68rem',
                                      fontWeight: 700,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    {t('maritime_freight.job_details_modal.s129', "إفراج وتسليم")}
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
              </div>
            )}

            {/* Tab 3: مسار التتبع DCSA */}
            {activeTab === 'milestones' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {/* ترقية المرحلة */}
                <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '4px' }}>{t('maritime_freight.job_details_modal.s130', "ترقية المرحلة الملاحية (DCSA Milestone)")}</div>
                    <CustomSelect
                      value={nextMilestone}
                      onChange={(val) => setNextMilestone(val as DcsaMilestoneKey)}
                      options={DCSA_STANDARD_MILESTONES.map((m) => ({
                        value: m.key,
                        label: `[${m.key}] ${m.title_ar} - ${m.title_en}`,
                      }))}
                      placeholder={t('maritime_freight.job_details_modal.s131', "اختر المرحلة الملاحية...")}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '4px' }}>{t('maritime_freight.job_details_modal.s132', "ملاحظات المرحلة أو الموقع")}</div>
                    <input
                      type="text"
                      value={milestoneNotes}
                      onChange={(e) => setMilestoneNotes(e.target.value)}
                      placeholder={t('maritime_freight.job_details_modal.s133', "مثال: رست السفينة برصيف 45")}
                      style={{ width: '100%', height: '36px', borderRadius: '8px', border: '1px solid #cbd5e1', padding: '0 8px', fontSize: '0.85rem' }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => submitOnce('milestone', handleAdvanceMilestone)}
                    style={{
                      height: '36px',
                      marginTop: '18px',
                      padding: '0 16px',
                      background: '#170e5e',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      fontWeight: 700,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t('maritime_freight.job_details_modal.s134', "تحديث المرحلة")}
                  </button>
                </div>

                {/* زر تسليم إذن التسليم D/O */}
                {!job.delivery_order_released && (
                  <div style={{ padding: '12px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '0.85rem', color: '#92400e', fontWeight: 600 }}>
                      {t('maritime_freight.job_details_modal.s135', "إذن التسليم (Delivery Order D/O) محتجز حتى تحصيل مستحقات الشحن.")}
                    </div>
                    <button
                      type="button"
                      onClick={() => submitOnce('release-do', handleReleaseDo)}
                      style={{
                        padding: '6px 14px',
                        background: '#d97706',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {t('maritime_freight.job_details_modal.s136', "اعتماد وتسليم إذن الإفراج (Release D/O)")}
                    </button>
                  </div>
                )}

                {/* السجل الزمني للمحطات */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                  {job.milestones?.map((m, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '10px 14px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', flex: 1 }}>
                        <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#dbeafe', color: '#1e40af', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.78rem', flexShrink: 0 }}>
                          {idx + 1}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0f172a' }}>{m.milestone_title}</div>
                          {m.notes && <div style={{ fontSize: '0.8rem', color: '#475569', marginTop: '2px' }}>{m.notes}</div>}
                          <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '4px' }}>
                            {new Date(m.occurred_at).toLocaleString('ar-EG')}
                          </div>
                        </div>
                      </div>

                      {job.customer_phone && (
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            type="button"
                            disabled={sendingWhatsAppKey === m.milestone_key}
                            onClick={() => handleSendDirectWhatsApp(m.milestone_key)}
                            title={t('maritime_freight.job_details_modal.s137', "إرسال إشعار فوري عبر بوابة Cloud WhatsApp")}
                            style={{
                              padding: '4px 10px',
                              background: '#15803d',
                              color: '#ffffff',
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              cursor: sendingWhatsAppKey === m.milestone_key ? 'not-allowed' : 'pointer',
                              whiteSpace: 'nowrap',
                              opacity: sendingWhatsAppKey === m.milestone_key ? 0.7 : 1,
                            }}
                          >
                            {sendingWhatsAppKey === m.milestone_key ? t('maritime_freight.job_details_modal.s138', "جاري الإرسال...") : t('maritime_freight.job_details_modal.s139', "إرسال سحابي فوري")}
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                const alertData = await maritimeApi.getJobWhatsAppAlert(job.id, m.milestone_key);
                                const cleanPhone = (alertData.customerPhone || job.customer_phone || '').replace(/[^0-9]/g, '');
                                if (cleanPhone) {
                                  window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(alertData.message)}`, '_blank');
                                } else {
                                  toast.warning(t('maritime_freight.job_details_modal.s140', "لا يوجد رقم هاتف مسجل للعميل"));
                                }
                              } catch (err: any) {
                                toast.error(err?.message || t('maritime_freight.job_details_modal.s141', "فشل توليد رسالة واتساب"));
                              }
                            }}
                            title={t('maritime_freight.job_details_modal.s142', "فتح تطبيق أو ويب واتساب مباشرة")}
                            style={{
                              padding: '4px 8px',
                              background: '#f0fdf4',
                              color: '#166534',
                              border: '1px solid #bbf7d0',
                              borderRadius: '6px',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {t('maritime_freight.job_details_modal.s143', "فتح واتساب")}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tab: بنود الرسوم والتسعير (Charges) */}
            {activeTab === 'charges' && (
              <JobChargesTab
                job={job}
                onUpdated={() => {
                  fetchJob();
                  onUpdated();
                }}
              />
            )}

            {/* Tab: التجميع المشترك والحاويات المجمعة (LCL Consolidation) */}
            {activeTab === 'consolidation' && (
              <JobConsolidationTab
                job={job}
                onUpdated={() => {
                  fetchJob();
                  onUpdated();
                }}
                onSelectSubJob={(subJobId) => {
                  setCurrentJobId(subJobId);
                  fetchJob(subJobId);
                }}
              />
            )}

            {/* Tab: رحلات النقل البري والترحيل الداخلي (Trucking) */}
            {activeTab === 'trucking' && (
              <JobInlandTruckingTab
                job={job}
                onUpdated={() => {
                  fetchJob();
                  onUpdated();
                }}
              />
            )}

            {/* Tab: الحافظة الرقمية الإلكترونية وبوالص الشحن (Documents & e-Folder) */}
            {activeTab === 'documents' && (
              <JobDocumentsTab
                job={job}
                onUpdated={() => {
                  fetchJob();
                  onUpdated();
                }}
              />
            )}

            {/* Tab 5: ربحية العملية والحسابات */}
            {activeTab === 'finance' && (() => {
              const revenue = Number(job.client_invoiced_total || 0);
              const carrierCost = Number(job.carrier_cost_total || 0);
              const otherCosts = Number(job.other_costs_total || 0);
              const totalCost = carrierCost + otherCosts;
              const netProfit = Number(job.net_profit || (revenue - totalCost));
              const marginPercent = revenue > 0 ? ((netProfit / revenue) * 100).toFixed(1) : '0.0';
              const containerDeposits = job.containers?.reduce((acc, c) => acc + (Number(c.deposit_amount) || 0), 0) || 0;

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {/* شريط الإجراءات المالية السريعة */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '10px 14px', borderRadius: '10px', border: '1px solid #e2e8f0', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#170e5e' }}>
                      {t('maritime_freight.job_details_modal.s144', "الإجراءات المالية وتصدير الفواتير والسندات")}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => printFreightInvoice(job)}
                        style={{
                          padding: '6px 14px',
                          background: '#170e5e',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '0.8rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <AppIcons.FileText size={14} />
                        <span>{t('maritime_freight.job_details_modal.s145', "طباعة فاتورة الشحن")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => printJobProfitabilitySheet(job, ledgerEntries)}
                        style={{
                          padding: '6px 14px',
                          background: '#047857',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '0.8rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <AppIcons.CheckShield size={14} />
                        <span>{t('maritime_freight.job_details_modal.s146', "كشف الربحية (P&L)")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleOpenIssueInvoice}
                        style={{
                          padding: '6px 14px',
                          background: '#eff6ff',
                          color: '#1d4ed8',
                          border: '1px solid #bfdbfe',
                          borderRadius: '8px',
                          fontSize: '0.8rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {t('maritime_freight.job_details_modal.s147', "إصدار فاتورة مبيعات للعميل")}
                      </button>
                      <button
                        type="button"
                        onClick={handleOpenRecordExpense}
                        style={{
                          padding: '6px 14px',
                          background: '#f1f5f9',
                          color: '#1e293b',
                          border: '1px solid #cbd5e1',
                          borderRadius: '8px',
                          fontSize: '0.8rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {t('maritime_freight.job_details_modal.s148', "تسجيل سند مصروفات الخط/الميناء")}
                      </button>
                    </div>
                  </div>

                  {/* شريط تسوية رصيد العميل الدائن المتاح */}
                  {Number(job.customerAvailableCredit || 0) > 0 && (
                    <div
                      style={{
                        background: '#f0fdf4',
                        border: '1px solid #bbf7d0',
                        borderRadius: '10px',
                        padding: '12px 16px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '12px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#166534' }}>
                          {t('maritime_freight.job_details_modal.s149', "رصيد العميل المتاح للخصم (دفعات مقدمة / على الحساب):")} {currencySymbol} {Number(job.customerAvailableCredit || 0).toLocaleString()}
                        </div>
                        <div style={{ fontSize: '0.74rem', color: '#15803d', marginTop: '2px' }}>
                          {t('maritime_freight.job_details_modal.s150', "العميل (")}{job.customer_name}{t('maritime_freight.job_details_modal.s151', ") قام بسداد مبالغ على حسابه العام، ويمكنك تسوية نولون هذه الشحنة مباشرة دون الحاجة لطلب تحويل إضافي.")}
                        </div>
                      </div>

                      {job.payment_status === 'paid' ? (
                        <span style={{ padding: '5px 12px', background: '#dcfce7', color: '#15803d', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 700 }}>
                          {t('maritime_freight.job_details_modal.s152', "الشحنة مسددة بالكامل")}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => submitOnce('settle', handleSettleFromBalance)}
                          disabled={isSettlingFromBalance}
                          style={{
                            padding: '7px 16px',
                            background: '#166534',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '8px',
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            cursor: isSettlingFromBalance ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {isSettlingFromBalance ? t('maritime_freight.job_details_modal.s153', "جاري التسوية...") : t('maritime_freight.job_details_modal.s154', "سداد الشحنة من الرصيد المتاح")}
                        </button>
                      )}
                    </div>
                  )}

                  {/* 1. الثلاث بطاقات المالية المعتمدة (Clean White KPI Cards bound to system currency) */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                    {/* Card 1: Revenue */}
                    <div
                      style={{
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '12px',
                        padding: '14px 16px',
                        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                        borderTop: '3px solid #170e5e',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#64748b' }}>{t('maritime_freight.job_details_modal.s155', "إجمالي الفاتورة للعميل")}</span>
                        <span style={{
                          padding: '2px 8px',
                          background: job.payment_status === 'paid' ? '#dcfce7' : job.payment_status === 'partially_paid' ? '#fef3c7' : '#eff6ff',
                          color: job.payment_status === 'paid' ? '#15803d' : job.payment_status === 'partially_paid' ? '#b45309' : '#1e40af',
                          borderRadius: '6px',
                          fontSize: '0.7rem',
                          fontWeight: 700,
                        }}>
                          {job.payment_status === 'paid' ? t('maritime_freight.job_details_modal.s156', "مسدد بالكامل") : job.payment_status === 'partially_paid' ? `مسدد: ${Number(job.client_paid_total || 0).toLocaleString()}` : t('maritime_freight.job_details_modal.s157', "غير مسدد")}
                        </span>
                      </div>
                      <div style={{ fontSize: '1.35rem', fontWeight: 900, color: '#170e5e', letterSpacing: '-0.02em' }}>
                        {currencySymbol} {revenue.toLocaleString()}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                        {t('maritime_freight.job_details_modal.s158', "مبيعات الشحن والخدمات البحرية")}
                      </div>
                    </div>

                    {/* Card 2: Cost */}
                    <div
                      style={{
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '12px',
                        padding: '14px 16px',
                        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                        borderTop: '3px solid #ef4444',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#64748b' }}>{t('maritime_freight.job_details_modal.s159', "تكلفة الخط والموانئ")}</span>
                        <span style={{ padding: '2px 8px', background: '#fef2f2', color: '#b91c1c', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 700 }}>
                          Direct Cost
                        </span>
                      </div>
                      <div style={{ fontSize: '1.35rem', fontWeight: 900, color: totalCost > 0 ? '#b91c1c' : '#0f172a', letterSpacing: '-0.02em' }}>
                        {currencySymbol} {totalCost.toLocaleString()}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                        {t('maritime_freight.job_details_modal.s160', "نولون بحري ومصروفات محطات الموانئ")}
                      </div>
                    </div>

                    {/* Card 3: Net Profit */}
                    <div
                      style={{
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '12px',
                        padding: '14px 16px',
                        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                        borderTop: '3px solid #10b981',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#64748b' }}>{t('maritime_freight.job_details_modal.s161', "صافي ربح العملية")}</span>
                        <span style={{ padding: '2px 8px', background: '#f0fdf4', color: '#166534', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 700 }}>
                          {t('maritime_freight.job_details_modal.s162', "هامش:")} {marginPercent}%
                        </span>
                      </div>
                      <div style={{ fontSize: '1.35rem', fontWeight: 900, color: netProfit >= 0 ? '#15803d' : '#b91c1c', letterSpacing: '-0.02em' }}>
                        {currencySymbol} {netProfit.toLocaleString()}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                        {t('maritime_freight.job_details_modal.s163', "المساهمة الصافية في أرباح التشغيل")}
                      </div>
                    </div>
                  </div>

                  {/* 2. جدول البيان المالي وتفكيك التكاليف والإيرادات */}
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
                        {t('maritime_freight.job_details_modal.s164', "بيان وتفكيك الحسابات التقديرية والفعلية للعملية")}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                        {t('maritime_freight.job_details_modal.s165', "العملة الأساسية للنظام: (")}{currencySymbol})
                      </div>
                    </div>

                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'right' }}>
                          <th style={{ padding: '8px 14px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s166', "بند الحساب")}</th>
                          <th style={{ padding: '8px 14px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s167', "الطرف والجهة")}</th>
                          <th style={{ padding: '8px 14px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s168', "التصنيف المحاسبي")}</th>
                          <th style={{ padding: '8px 14px', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s169', "المبلغ")}</th>
                          <th style={{ padding: '8px 14px', fontWeight: 700, textAlign: 'center' }}>{t('maritime_freight.job_details_modal.s170', "الحالة")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '8px 14px', fontWeight: 700, color: '#170e5e' }}>{t('maritime_freight.job_details_modal.s171', "إيراد الشحن البحري للعميل (Ocean Freight Billed)")}</td>
                          <td style={{ padding: '8px 14px', color: '#334155' }}>{job.customer_name}</td>
                          <td style={{ padding: '8px 14px', color: '#64748b' }}>{t('maritime_freight.job_details_modal.s172', "إيراد تشغيلي معتمد")}</td>
                          <td style={{ padding: '8px 14px', fontWeight: 800, color: '#170e5e' }}>{currencySymbol} {revenue.toLocaleString()}</td>
                          <td style={{ padding: '8px 14px', textAlign: 'center' }}>
                            <span style={{ padding: '2px 8px', background: '#eff6ff', color: '#1e40af', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s173', "مفوتر بالكامل")}</span>
                          </td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '8px 14px', fontWeight: 700, color: '#0f172a' }}>{t('maritime_freight.job_details_modal.s174', "نولون الخط الملاحي الأساسي (Carrier Ocean Freight)")}</td>
                          <td style={{ padding: '8px 14px', color: '#334155' }}>{job.shipping_line_name || t('maritime_freight.job_details_modal.s175', "غير محدد")}</td>
                          <td style={{ padding: '8px 14px', color: '#64748b' }}>{t('maritime_freight.job_details_modal.s176', "تكلفة شحن مباشرة")}</td>
                          <td style={{ padding: '8px 14px', fontWeight: 800, color: totalCost > 0 ? '#b91c1c' : '#64748b' }}>{currencySymbol} {carrierCost.toLocaleString()}</td>
                          <td style={{ padding: '8px 14px', textAlign: 'center' }}>
                            <span style={{ padding: '2px 8px', background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600 }}>{t('maritime_freight.job_details_modal.s177', "مطابقة الخط")}</span>
                          </td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '8px 14px', fontWeight: 700, color: '#0f172a' }}>{t('maritime_freight.job_details_modal.s178', "مصروفات الموانئ والمناولة (Port & THC Charges)")}</td>
                          <td style={{ padding: '8px 14px', color: '#334155' }}>{job.pol_name} ← {job.pod_name}</td>
                          <td style={{ padding: '8px 14px', color: '#64748b' }}>{t('maritime_freight.job_details_modal.s179', "خدمات موانئ وتداول")}</td>
                          <td style={{ padding: '8px 14px', fontWeight: 800, color: otherCosts > 0 ? '#b91c1c' : '#64748b' }}>
                            {otherCosts > 0 ? `${currencySymbol} ${otherCosts.toLocaleString()}` : t('maritime_freight.job_details_modal.s180', "ضمن النولون")}
                          </td>
                          <td style={{ padding: '8px 14px', textAlign: 'center' }}>
                            <span style={{ padding: '2px 8px', background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600 }}>{t('maritime_freight.job_details_modal.s181', "تسوية مباشرة")}</span>
                          </td>
                        </tr>
                        <tr>
                          <td style={{ padding: '8px 14px', fontWeight: 700, color: '#0f172a' }}>{t('maritime_freight.job_details_modal.s182', "تأمين الحاويات المسترد (Container Deposit)")}</td>
                          <td style={{ padding: '8px 14px', color: '#334155' }}>{t('maritime_freight.job_details_modal.s183', "خزينة أمانات الخط الملاحي")}</td>
                          <td style={{ padding: '8px 14px', color: '#64748b' }}>{t('maritime_freight.job_details_modal.s184', "أمانات مستردة (خارج الأرباح)")}</td>
                          <td style={{ padding: '8px 14px', fontWeight: 800, color: '#475569' }}>
                            {currencySymbol} {containerDeposits.toLocaleString()}
                          </td>
                          <td style={{ padding: '8px 14px', textAlign: 'center' }}>
                            <span style={{ padding: '2px 8px', background: '#f0fdf4', color: '#166534', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700 }}>{t('maritime_freight.job_details_modal.s185', "تحت التسوية")}</span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

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
                </div>
              );
            })()}
          </div>
        </div>
      </StandardDialog>

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

      {/* Modal 6: Smart Booking Confirmation Parser Dialog */}
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
            {Boolean(user?.id && overrideInvoice.createdBy && String(user.id) === String(overrideInvoice.createdBy)) ? (
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
          onClose={() => {
            setShowClaimDialog(false);
            setSelectedInsuranceForClaim(null);
          }}
          title={t('maritime_freight.job_details_modal.s381', "تسجيل مطالبة تعويض تأميني (Cargo Insurance Claim)")}
          subtitle={`وثيقة رقم: ${selectedInsuranceForClaim.policy_number} | شركة: ${selectedInsuranceForClaim.insurance_company}`}
          width="min(560px, 95vw)"
          minHeight="min(440px, 80vh)"
          footerActions={(
            <StandardDialogFooter
              onSubmit={() => submitOnce('claim', handleConfirmClaim)}
              submitText={isSubmittingClaim ? t('maritime_freight.job_details_modal.s382', "جاري التسجيل...") : t('maritime_freight.job_details_modal.s383', "تسجيل المطالبة رسميًا")}
              isSubmitting={isSubmittingClaim}
              onCancel={() => {
                setShowClaimDialog(false);
                setSelectedInsuranceForClaim(null);
              }}
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
