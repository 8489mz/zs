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
import { JobInsuranceReceiptDialogs } from './job-details/JobInsuranceReceiptDialogs';

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
  const [showClaimDialog, setShowClaimDialog] = useState(false);
  const [selectedInsuranceForClaim, setSelectedInsuranceForClaim] = useState<CargoInsurance | null>(null);
  const [warehouseReceiptsList, setWarehouseReceiptsList] = useState<WarehouseReceipt[]>([]);
  const [loadingWarehouseReceipts, setLoadingWarehouseReceipts] = useState(false);
  const [showAddWarehouseReceiptDialog, setShowAddWarehouseReceiptDialog] = useState(false);
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
  const handleOpenClaim = (ins: CargoInsurance) => {
    setSelectedInsuranceForClaim(ins);
    setShowClaimDialog(true);
  };

  // Warehouse Receipts Handlers
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

      <JobInsuranceReceiptDialogs
        job={job}
        showAddInsuranceDialog={showAddInsuranceDialog}
        setShowAddInsuranceDialog={setShowAddInsuranceDialog}
        showClaimDialog={showClaimDialog}
        selectedInsuranceForClaim={selectedInsuranceForClaim}
        onCloseClaim={() => {
          setShowClaimDialog(false);
          setSelectedInsuranceForClaim(null);
        }}
        showAddWarehouseReceiptDialog={showAddWarehouseReceiptDialog}
        setShowAddWarehouseReceiptDialog={setShowAddWarehouseReceiptDialog}
        fetchJob={fetchJob}
        onUpdated={onUpdated}
        submitOnce={submitOnce}
      />
    </>
  );
}
