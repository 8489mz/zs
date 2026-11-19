import { useTranslation } from 'react-i18next';
import { useState, useEffect, useRef } from 'react';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { useSystemCurrency } from '@/shared/hooks/use-system-currency';
import { useAuthStore } from '@/stores/auth-store';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { maritimeApi, MaritimeJob, MaritimeContainer, MaritimeCarrierInvoice, FreightAuditPreview, CargoInsurance, WarehouseReceipt } from '../api/maritime-freight.api';
import { toast, systemConfirm } from '@/shared/components/system-alert';
import { printCargoInsuranceCertificate } from '../utils/maritime-documents';
import { CustomsDeclarationModal } from './CustomsDeclarationModal';
import { JobChargesTab } from './job-details/JobChargesTab';
import { JobDocumentsTab } from './job-details/JobDocumentsTab';
import { JobConsolidationTab } from './job-details/JobConsolidationTab';
import { JobContainersTab } from './job-details/JobContainersTab';
import { JobInlandTruckingTab } from './job-details/JobInlandTruckingTab';
import { JobOverviewSummary } from './job-details/JobOverviewSummary';
import { JobOverviewTrackers } from './job-details/JobOverviewTrackers';
import { JobMilestonesTab } from './job-details/JobMilestonesTab';
import { JobFinanceSummary } from './job-details/JobFinanceSummary';
import { JobFinanceCarrierInvoices } from './job-details/JobFinanceCarrierInvoices';
import { todayLocalDateKey } from '@/lib/format';

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
  const [copiedLink, setCopiedLink] = useState(false);

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
    issueDate: todayLocalDateKey(),
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
                <JobOverviewSummary
                  job={job}
                  currencySymbol={currencySymbol}
                  trackingUrl={trackingUrl}
                  copiedLink={copiedLink}
                  isSettlingFromBalance={isSettlingFromBalance}
                  submitOnce={submitOnce}
                  handleSettleFromBalance={handleSettleFromBalance}
                  handleOpenEditVoyage={handleOpenEditVoyage}
                  handleCopyTrackingLink={handleCopyTrackingLink}
                  setSmartParseText={setSmartParseText}
                  setParsedBookingData={setParsedBookingData}
                  setShowSmartParseModal={setShowSmartParseModal}
                />

                <JobOverviewTrackers job={job} fetchJob={fetchJob} onUpdated={onUpdated} />
              </div>
            )}

            {/* Tab 2: قائمة الحاويات / البضائع واستلام المستودع */}
            {activeTab === 'containers' && (
              <JobContainersTab
                job={job}
                warehouseReceiptsList={warehouseReceiptsList}
                loadingWarehouseReceipts={loadingWarehouseReceipts}
                submitOnce={submitOnce}
                setShowAddContainer={setShowAddContainer}
                handleOpenEditContainer={handleOpenEditContainer}
                setShowAddWarehouseReceiptDialog={setShowAddWarehouseReceiptDialog}
                handleReleaseWarehouseReceipt={handleReleaseWarehouseReceipt}
                fetchJob={fetchJob}
                onUpdated={onUpdated}
              />
            )}

            {/* Tab 3: مسار التتبع DCSA */}
            {activeTab === 'milestones' && (
              <JobMilestonesTab job={job} fetchJob={fetchJob} onUpdated={onUpdated} submitOnce={submitOnce} />
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
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <JobFinanceSummary
                    job={job}
                    ledgerEntries={ledgerEntries}
                    isSettlingFromBalance={isSettlingFromBalance}
                    handleSettleFromBalance={handleSettleFromBalance}
                    submitOnce={submitOnce}
                    handleOpenIssueInvoice={handleOpenIssueInvoice}
                    handleOpenRecordExpense={handleOpenRecordExpense}
                  />

                  <JobFinanceCarrierInvoices
                    job={job}
                    carrierInvoicesList={carrierInvoicesList}
                    loadingCarrierInvoices={loadingCarrierInvoices}
                    handleOpenRecordExpense={handleOpenRecordExpense}
                    handleOpenDispute={handleOpenDispute}
                    handleOpenOverrideDialog={handleOpenOverrideDialog}
                  />

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
