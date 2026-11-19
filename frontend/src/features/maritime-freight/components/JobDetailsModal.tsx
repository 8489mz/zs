import { useTranslation } from 'react-i18next';
import { useState, useEffect, useRef } from 'react';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { useSystemCurrency } from '@/shared/hooks/use-system-currency';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { maritimeApi, MaritimeJob, MaritimeContainer, MaritimeCarrierInvoice, CargoInsurance, WarehouseReceipt } from '../api/maritime-freight.api';
import { toast, systemConfirm } from '@/shared/components/system-alert';
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
import { JobFinanceInsuranceLedger } from './job-details/JobFinanceInsuranceLedger';
import { JobVoyageContainerDialogs } from './job-details/JobVoyageContainerDialogs';
import { JobMoneyDialogs } from './job-details/JobMoneyDialogs';
import { JobSmartParseDisputeDialogs } from './job-details/JobSmartParseDisputeDialogs';
import { todayLocalDateKey } from '@/lib/format';

interface JobDetailsModalProps {
  open: boolean;
  jobId: string | null;
  onClose: () => void;
  onUpdated: () => void;
}

export function JobDetailsModal({ open, jobId, onClose, onUpdated }: JobDetailsModalProps) {
  const { t } = useTranslation();
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

  const [showExpenseDialog, setShowExpenseDialog] = useState(false);

  // Carrier Invoices & Freight Audit State
  const [carrierInvoicesList, setCarrierInvoicesList] = useState<MaritimeCarrierInvoice[]>([]);
  const [loadingCarrierInvoices, setLoadingCarrierInvoices] = useState(false);
  const [showOverrideDialog, setShowOverrideDialog] = useState(false);
  const [overrideInvoice, setOverrideInvoice] = useState<MaritimeCarrierInvoice | null>(null);
  const [overrideReasonInput, setOverrideReasonInput] = useState('');
  const [showDisputeDialog, setShowDisputeDialog] = useState(false);
  const [disputeInvoice, setDisputeInvoice] = useState<MaritimeCarrierInvoice | null>(null);
  const [disputeReasonInput, setDisputeReasonInput] = useState('');
  const [disputeAmountInput, setDisputeAmountInput] = useState('');

  // Smart Booking Extraction State
  const [showSmartParseModal, setShowSmartParseModal] = useState(false);

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

  // Open the edit-voyage dialog; JobVoyageContainerDialogs populates its form from the job on open.
  const handleOpenEditVoyage = () => {
    if (!job) return;
    setShowEditVoyage(true);
  };

  // Edit Container
  const handleOpenEditContainer = (c: MaritimeContainer) => {
    setEditingContainer(c);
  };

  // Quick Billing / Voucher Triggers
  const handleOpenIssueInvoice = () => {
    if (!job) return;
    setShowInvoiceDialog(true);
  };

  const handleOpenRecordExpense = () => {
    if (!job) return;
    setShowExpenseDialog(true);
  };

  const handleOpenDispute = (inv: MaritimeCarrierInvoice) => {
    setDisputeInvoice(inv);
    const variance = Number(inv.varianceAmount || 0);
    setDisputeAmountInput(String(variance > 0 ? variance : inv.totalInvoicedAmount));
    setDisputeReasonInput(`فروق أسعار عن التعرفة المعتمدة: الفاتورة #${inv.invoiceNumber} بمبلغ ${inv.totalInvoicedAmount} مقابل تعرفة متعاقد عليها ${inv.contractedAmount}`);
    setShowDisputeDialog(true);
  };

  const handleOpenOverrideDialog = (inv: MaritimeCarrierInvoice) => {
    setOverrideInvoice(inv);
    setOverrideReasonInput('');
    setShowOverrideDialog(true);
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

                  <JobFinanceInsuranceLedger
                    job={job}
                    insurancesList={insurancesList}
                    loadingInsurances={loadingInsurances}
                    ledgerEntries={ledgerEntries}
                    loadingLedger={loadingLedger}
                    setShowAddInsuranceDialog={setShowAddInsuranceDialog}
                    handleOpenClaim={handleOpenClaim}
                  />
                </div>
              );
            })()}
          </div>
        </div>
      </StandardDialog>

      <JobVoyageContainerDialogs
        job={job}
        showEditVoyage={showEditVoyage}
        setShowEditVoyage={setShowEditVoyage}
        showAddContainer={showAddContainer}
        setShowAddContainer={setShowAddContainer}
        editingContainer={editingContainer}
        setEditingContainer={setEditingContainer}
        currencyCode={currencyCode}
        fetchJob={fetchJob}
        onUpdated={onUpdated}
        submitOnce={submitOnce}
      />

      {(showInvoiceDialog || showExpenseDialog) && (
        <JobMoneyDialogs
          job={job}
          showInvoiceDialog={showInvoiceDialog}
          setShowInvoiceDialog={setShowInvoiceDialog}
          showExpenseDialog={showExpenseDialog}
          setShowExpenseDialog={setShowExpenseDialog}
          fetchJob={fetchJob}
          fetchLedger={fetchLedger}
          fetchCarrierInvoices={fetchCarrierInvoices}
          onUpdated={onUpdated}
          submitOnce={submitOnce}
        />
      )}

      {/* Modal 6/7: Smart-parse, dispute, override dialogs + CustomsDeclarationModal (JobSmartParseDisputeDialogs; mounted only while one of its dialogs is open, so each open is a fresh mount with empty smart-parse state) */}
      {(showSmartParseModal || showDisputeDialog || showOverrideDialog || showCustomsModal) && (
        <JobSmartParseDisputeDialogs
          job={job}
          showSmartParseModal={showSmartParseModal}
          setShowSmartParseModal={setShowSmartParseModal}
          showDisputeDialog={showDisputeDialog}
          setShowDisputeDialog={setShowDisputeDialog}
          disputeInvoice={disputeInvoice}
          disputeAmountInput={disputeAmountInput}
          setDisputeAmountInput={setDisputeAmountInput}
          disputeReasonInput={disputeReasonInput}
          setDisputeReasonInput={setDisputeReasonInput}
          showOverrideDialog={showOverrideDialog}
          setShowOverrideDialog={setShowOverrideDialog}
          overrideInvoice={overrideInvoice}
          setOverrideInvoice={setOverrideInvoice}
          overrideReasonInput={overrideReasonInput}
          setOverrideReasonInput={setOverrideReasonInput}
          showCustomsModal={showCustomsModal}
          setShowCustomsModal={setShowCustomsModal}
          fetchJob={fetchJob}
          fetchLedger={fetchLedger}
          fetchCarrierInvoices={fetchCarrierInvoices}
          submitOnce={submitOnce}
          onUpdated={onUpdated}
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
