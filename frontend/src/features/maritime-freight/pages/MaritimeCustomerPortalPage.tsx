import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  useMaritimeCustomerPortal,
  FreightPortalCustomer,
  FreightPortalDashboard,
} from '../hooks/use-maritime-customer-portal';
import {
  printOceanBillOfLading,
  printAirWaybill,
  printDeliveryOrder,
  printArrivalNotice,
  printJobChargesInvoice,
} from '../utils/maritime-documents';
import { toast } from '@/shared/components/system-alert';
import type { ActiveTab } from './maritime-customer-portal/maritime-portal-types';
import { MaritimePortalLoadingSplash } from './maritime-customer-portal/maritime-portal-loading-splash';
import { MaritimePortalLoginScreen } from './maritime-customer-portal/maritime-portal-login-screen';
import { MaritimePortalHeader } from './maritime-customer-portal/maritime-portal-header';
import { MaritimePortalKpiBanner } from './maritime-customer-portal/maritime-portal-kpi-banner';
import { MaritimePortalTabNav } from './maritime-customer-portal/maritime-portal-tab-nav';
import { MaritimePortalShipmentsTab } from './maritime-customer-portal/maritime-portal-shipments-tab';
import { MaritimePortalQuoteTab } from './maritime-customer-portal/maritime-portal-quote-tab';
import { MaritimePortalQuotationsTab } from './maritime-customer-portal/maritime-portal-quotations-tab';
import { MaritimePortalDocumentsTab } from './maritime-customer-portal/maritime-portal-documents-tab';
import { MaritimePortalStatementTab } from './maritime-customer-portal/maritime-portal-statement-tab';
import { MaritimePortalShipmentModal } from './maritime-customer-portal/maritime-portal-shipment-modal';


export function MaritimeCustomerPortalPage() {
  const { portalApi: freightCustomerPortalApi } = useMaritimeCustomerPortal();
  const [searchParams] = useSearchParams();
  const urlToken = searchParams.get('token');

  // Authentication State
  const [customer, setCustomer] = useState<FreightPortalCustomer | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  // Login Form State
  const [loginPhone, setLoginPhone] = useState('');
  const [loginPin, setLoginPin] = useState('');
  const [loginCompany, setLoginCompany] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Portal Workspace State
  const [activeTab, setActiveTab] = useState<ActiveTab>('shipments');
  const [dashboard, setDashboard] = useState<FreightPortalDashboard | null>(null);

  // Shipments Tab State
  const [shipments, setShipments] = useState<any[]>([]);
  const [shipmentFilter, setShipmentFilter] = useState<'active' | 'completed' | 'all'>('active');
  const [shipmentSearch, setShipmentSearch] = useState('');
  const [loadingShipments, setLoadingShipments] = useState(false);
  const [selectedShipmentForModal, setSelectedShipmentForModal] = useState<any | null>(null);

  // Request Quote Tab State
  const [quoteForm, setQuoteForm] = useState({
    transportMode: 'sea' as 'sea' | 'air' | 'road',
    direction: 'import' as 'import' | 'export' | 'cross_trade',
    polCode: 'EGALY',
    polName: 'ميناء الإسكندرية (Alexandria)',
    podCode: 'CNSHA',
    podName: 'ميناء شنغهاي (Shanghai)',
    cargoMode: 'FCL',
    containerType: '40HC',
    containerCount: 1,
    commodityDescription: '',
    grossWeightKg: 18000,
    totalCbm: 45,
    incoterm: 'FOB',
    cargoReadyDate: '',
    notes: '',
  });
  const [submittingQuote, setSubmittingQuote] = useState(false);
  const [submittedQuoteResult, setSubmittedQuoteResult] = useState<{ inquiryNumber: string } | null>(null);

  // Quotations Tab State
  const [quotations, setQuotations] = useState<any[]>([]);
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [approvingQuoteId, setApprovingQuoteId] = useState<string | null>(null);
  const [approvalModalQuote, setApprovalModalQuote] = useState<any | null>(null);
  const [approvalPoNumber, setApprovalPoNumber] = useState('');
  const [approvalNotes, setApprovalNotes] = useState('');

  // Documents Tab State
  const [selectedDocShipmentId, setSelectedDocShipmentId] = useState<string>('');

  // Statement Tab State
  const [statementData, setStatementData] = useState<any | null>(null);
  const [loadingStatement, setLoadingStatement] = useState(false);

  // 1. Initial Auth Bootstrap
  useEffect(() => {
    const initSession = async () => {
      if (urlToken && urlToken.trim()) {
        try {
          const res = await freightCustomerPortalApi.tokenLogin(urlToken.trim());
          setCustomer(res.customer);
          setLoadingAuth(false);
          return;
        } catch {
          // Fall through to stored session
        }
      }

      const stored = freightCustomerPortalApi.getStoredSession();
      if (stored?.customer) {
        setCustomer(stored.customer);
      }
      setLoadingAuth(false);
    };

    initSession();
  }, [urlToken]);

  // 2. Fetch Dashboard & Tab Data when logged in
  const refreshDashboard = async () => {
    if (!customer) return;
    try {
      const data = await freightCustomerPortalApi.getDashboard();
      setDashboard(data);
    } catch {
      // ignore
    }
  };

  const loadShipments = async () => {
    if (!customer) return;
    setLoadingShipments(true);
    try {
      const res = await freightCustomerPortalApi.getShipments({
        status: shipmentFilter,
        search: shipmentSearch,
      });
      setShipments(res.items || []);
      if (!selectedDocShipmentId && res.items && res.items.length > 0) {
        setSelectedDocShipmentId(res.items[0].id);
      }
    } catch (err: any) {
      toast.error(err?.message || 'تعذر تحميل قائمة الشحنات');
    } finally {
      setLoadingShipments(false);
    }
  };

  const loadQuotations = async () => {
    if (!customer) return;
    setLoadingQuotes(true);
    try {
      const res = await freightCustomerPortalApi.getQuotations();
      setQuotations(res || []);
    } catch (err: any) {
      toast.error(err?.message || 'تعذر تحميل عروض الأسعار');
    } finally {
      setLoadingQuotes(false);
    }
  };

  const loadStatement = async () => {
    if (!customer) return;
    setLoadingStatement(true);
    try {
      const res = await freightCustomerPortalApi.getStatement();
      setStatementData(res);
    } catch (err: any) {
      toast.error(err?.message || 'تعذر تحميل كشف الحساب');
    } finally {
      setLoadingStatement(false);
    }
  };

  useEffect(() => {
    if (customer) {
      refreshDashboard();
      if (activeTab === 'shipments') loadShipments();
      if (activeTab === 'quotes') loadQuotations();
      if (activeTab === 'statement') loadStatement();
      if (activeTab === 'documents') loadShipments();
    }
  }, [customer, activeTab, shipmentFilter]);

  // Login Handler
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginPhone.trim() || !loginPin.trim()) {
      setLoginError('يرجى إدخال رقم الهاتف ورمز الدخول السري (PIN)');
      return;
    }
    setLoginLoading(true);
    setLoginError(null);
    try {
      const res = await freightCustomerPortalApi.login({
        phone: loginPhone.trim(),
        pinCode: loginPin.trim(),
        companyCode: loginCompany.trim() || undefined,
      });
      setCustomer(res.customer);
      toast.success(`مرحباً بكم ${res.customer.name}`);
    } catch (err: any) {
      setLoginError(err?.message || 'فشل تسجيل الدخول، تأكد من صحة البيانات أو اتصل بخدمة العملاء');
    } finally {
      setLoginLoading(false);
    }
  };

  // Logout Handler
  const handleLogout = () => {
    freightCustomerPortalApi.logout();
    setCustomer(null);
    setDashboard(null);
    toast.info('تم تسجيل الخروج بنجاح');
  };

  // Copy Magic Link
  const handleCopyMagicLink = () => {
    if (!customer?.portalToken) {
      toast.warning('رمز الرابط المباشر غير متاح حالياً');
      return;
    }
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const magicUrl = `${origin}/freight-portal?token=${customer.portalToken}`;
    navigator.clipboard.writeText(magicUrl);
    toast.success('تم نسخ رابط الوصول المباشر لحسابكم إلى الحافظة');
  };

  // Request Quote Submit
  const handleQuoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quoteForm.commodityDescription.trim()) {
      toast.error('يرجى إدخال بيان البضاعة ونوعها');
      return;
    }
    setSubmittingQuote(true);
    try {
      const res = await freightCustomerPortalApi.requestQuote(quoteForm);
      setSubmittedQuoteResult({ inquiryNumber: res.inquiryNumber });
      toast.success(res.message || 'تم إرسال طلب التسعير بنجاح');
      refreshDashboard();
    } catch (err: any) {
      toast.error(err?.message || 'تعذر إرسال طلب التسعير');
    } finally {
      setSubmittingQuote(false);
    }
  };

  // Approve Quotation
  const handleConfirmApproval = async () => {
    if (!approvalModalQuote) return;
    setApprovingQuoteId(approvalModalQuote.id);
    try {
      const res = await freightCustomerPortalApi.approveQuotation(approvalModalQuote.id, {
        clientReference: approvalPoNumber.trim() || undefined,
        approvalNotes: approvalNotes.trim() || undefined,
        confirmedBy: customer?.name,
      });
      toast.success(res.message || 'تم اعتماد وتعميد العرض بنجاح');
      setApprovalModalQuote(null);
      setApprovalPoNumber('');
      setApprovalNotes('');
      loadQuotations();
      refreshDashboard();
    } catch (err: any) {
      toast.error(err?.message || 'تعذر اعتماد العرض');
    } finally {
      setApprovingQuoteId(null);
    }
  };

  // Print Document Helper
  const handlePrintDocument = (docType: 'hbl' | 'awb' | 'delivery_order' | 'arrival_notice' | 'invoice', job: any) => {
    if (!job) return;
    const containers = job.containers || [];
    const company = customer?.tenantName || 'Z-Systems Freight';

    if (docType === 'hbl') {
      printOceanBillOfLading(job, containers, company);
    } else if (docType === 'awb') {
      printAirWaybill(job, company);
    } else if (docType === 'delivery_order') {
      printDeliveryOrder(job, containers, company);
    } else if (docType === 'arrival_notice') {
      printArrivalNotice(job, containers, company);
    } else if (docType === 'invoice') {
      const charges = job.charges || [];
      printJobChargesInvoice(job, charges, company);
    }
  };

  // Loading Splash Screen
  if (loadingAuth) {
    return (
      <MaritimePortalLoadingSplash />
    );
  }

  // 3. Render Login Screen if not authenticated
  if (!customer) {
    return (
      <MaritimePortalLoginScreen loginError={loginError} handleLoginSubmit={handleLoginSubmit} loginPhone={loginPhone} setLoginPhone={setLoginPhone} loginPin={loginPin} setLoginPin={setLoginPin} loginCompany={loginCompany} setLoginCompany={setLoginCompany} loginLoading={loginLoading} />
    );
  }

  // 4. Render Main Authenticated Customer Portal
  return (
    <div dir="rtl" style={{ minHeight: '100vh', background: '#f8fafc', color: '#0f172a', paddingBottom: '60px' }}>
      {/* Top Navbar */}
      <MaritimePortalHeader customer={customer} handleCopyMagicLink={handleCopyMagicLink} handleLogout={handleLogout} />

      {/* Main Container */}
      <main style={{ maxWidth: '1280px', width: 'min(100%, 1280px)', margin: '20px auto 0', padding: '0 16px' }}>
        {/* KPI Banner Cards */}
        <MaritimePortalKpiBanner dashboard={dashboard} customer={customer} setActiveTab={setActiveTab} />

        {/* Tab Navigation Bar */}
        <MaritimePortalTabNav activeTab={activeTab} setActiveTab={setActiveTab} />

        {/* TAB 1: SHIPMENTS & LIVE RADAR */}
        {activeTab === 'shipments' && (<MaritimePortalShipmentsTab setShipmentFilter={setShipmentFilter} shipmentFilter={shipmentFilter} shipmentSearch={shipmentSearch} setShipmentSearch={setShipmentSearch} loadShipments={loadShipments} loadingShipments={loadingShipments} shipments={shipments} setSelectedShipmentForModal={setSelectedShipmentForModal} handlePrintDocument={handlePrintDocument} />)}

        {/* TAB 2: REQUEST A QUOTE (RFQ) */}
        {activeTab === 'request_quote' && (<MaritimePortalQuoteTab submittedQuoteResult={submittedQuoteResult} setSubmittedQuoteResult={setSubmittedQuoteResult} setActiveTab={setActiveTab} handleQuoteSubmit={handleQuoteSubmit} setQuoteForm={setQuoteForm} quoteForm={quoteForm} submittingQuote={submittingQuote} />)}

        {/* TAB 3: QUOTATIONS & ONLINE APPROVAL */}
        {activeTab === 'quotes' && (<MaritimePortalQuotationsTab loadQuotations={loadQuotations} loadingQuotes={loadingQuotes} quotations={quotations} setApprovalModalQuote={setApprovalModalQuote} approvalModalQuote={approvalModalQuote} approvalPoNumber={approvalPoNumber} setApprovalPoNumber={setApprovalPoNumber} approvalNotes={approvalNotes} setApprovalNotes={setApprovalNotes} handleConfirmApproval={handleConfirmApproval} approvingQuoteId={approvingQuoteId} />)}

        {/* TAB 4: DOCUMENT HUB & DOWNLOADS */}
        {activeTab === 'documents' && (<MaritimePortalDocumentsTab selectedDocShipmentId={selectedDocShipmentId} setSelectedDocShipmentId={setSelectedDocShipmentId} shipments={shipments} handlePrintDocument={handlePrintDocument} />)}

        {/* TAB 5: STATEMENT OF ACCOUNT & INVOICES */}
        {activeTab === 'statement' && (<MaritimePortalStatementTab customer={customer} loadingStatement={loadingStatement} statementData={statementData} />)}
      </main>

      {/* Shipment Details Slide-over / Modal */}
      {selectedShipmentForModal && (<MaritimePortalShipmentModal selectedShipmentForModal={selectedShipmentForModal} setSelectedShipmentForModal={setSelectedShipmentForModal} handlePrintDocument={handlePrintDocument} />)}
    </div>
  );
}

export default MaritimeCustomerPortalPage;
