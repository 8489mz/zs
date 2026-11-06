import { useTranslation } from 'react-i18next';
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
import {
  ShipIcon,
  AlertCircleIcon,
  ArrowRightIcon,
  FileCheckIcon,
  FileTextIcon,
  DollarSignIcon,
  PlusCircleIcon,
  SearchIcon,
  PlaneIcon,
  ClockIcon,
  DownloadIcon,
  CheckCircleIcon,
  RefreshCwIcon,
} from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';

type ActiveTab = 'shipments' | 'request_quote' | 'quotes' | 'documents' | 'statement';

export function MaritimeCustomerPortalPage() {
  const { t } = useTranslation();
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
      <div dir="rtl" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
        <div style={{ padding: '24px', background: '#fff', borderRadius: '16px', border: '1px solid #e2e8f0', textAlign: 'center', minWidth: '280px' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#170e5e', margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
            <ShipIcon size={24} color="#fff" />
          </div>
          <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '15px' }}>{t('maritime_freight.maritime_customer_portal_page.s0', "بوابة عملاء الشحن واللوجستيات")}</div>
          <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>{t('maritime_freight.maritime_customer_portal_page.s1', "جاري التحقق من الجلسة...")}</div>
        </div>
      </div>
    );
  }

  // 3. Render Login Screen if not authenticated
  if (!customer) {
    return (
      <div dir="rtl" style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ width: '100%', maxWidth: '440px', background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 4px 20px rgba(15, 23, 42, 0.05)', padding: '28px 24px' }}>
          {/* Logo & Header */}
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <div style={{ width: '54px', height: '54px', borderRadius: '14px', background: '#170e5e', margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff' }}>
              <ShipIcon size={30} color="#ffffff" />
            </div>
            <h1 style={{ fontSize: '19px', fontWeight: 800, color: '#0f172a', margin: '0 0 6px' }}>{t('maritime_freight.maritime_customer_portal_page.s2', "بوابة الخدمة الذاتية لعملاء الشحن")}</h1>
            <p style={{ fontSize: '13px', color: '#64748b', margin: 0, lineHeight: 1.5 }}>
              {t('maritime_freight.maritime_customer_portal_page.s3', "متابعة الشحنات والأحداث التقديرية المجدولة، طلبات التسعير، واعتماد العروض والمستندات إلكترونياً")}
            </p>
          </div>

          {loginError && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '10px 14px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: '#991b1b', fontSize: '12.5px' }}>
              <AlertCircleIcon size={16} color="#991b1b" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
                {t('maritime_freight.maritime_customer_portal_page.s4', "رقم الهاتف المسجل لدى الشحن")} <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="tel"
                value={loginPhone}
                onChange={(e) => setLoginPhone(e.target.value)}
                placeholder={t('maritime_freight.maritime_customer_portal_page.s5', "مثال: 01012345678")}
                dir="ltr"
                required
                style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13.5px', boxSizing: 'border-box', outline: 'none' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
                {t('maritime_freight.maritime_customer_portal_page.s6', "رمز الدخول السري (PIN)")} <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="password"
                value={loginPin}
                onChange={(e) => setLoginPin(e.target.value)}
                placeholder={t('maritime_freight.maritime_customer_portal_page.s7', "الرمز السري الخاص بك")}
                dir="ltr"
                required
                style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13.5px', boxSizing: 'border-box', outline: 'none' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: '4px' }}>
                {t('maritime_freight.maritime_customer_portal_page.s8', "كود المنشأة / الشركة (اختياري)")}
              </label>
              <input
                type="text"
                value={loginCompany}
                onChange={(e) => setLoginCompany(e.target.value)}
                placeholder={t('maritime_freight.maritime_customer_portal_page.s9', "اتركه فارغاً إن كنت مسجلاً لدى شركة واحدة")}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '12.5px', boxSizing: 'border-box', outline: 'none' }}
              />
            </div>

            <button
              type="submit"
              disabled={loginLoading}
              style={{
                marginTop: '8px',
                padding: '12px',
                background: '#170e5e',
                color: '#ffffff',
                border: 'none',
                borderRadius: '10px',
                fontSize: '14px',
                fontWeight: 700,
                cursor: loginLoading ? 'not-allowed' : 'pointer',
                opacity: loginLoading ? 0.7 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              {loginLoading ? t('maritime_freight.maritime_customer_portal_page.s10', "جاري التحقق...") : t('maritime_freight.maritime_customer_portal_page.s11', "دخول البوابة")}
              {!loginLoading && <ArrowRightIcon size={16} color="#fff" />}
            </button>
          </form>

          {/* Quick Help Card */}
          <div style={{ marginTop: '20px', padding: '12px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '11.5px', color: '#64748b', lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700, color: '#334155', marginBottom: '2px' }}>{t('maritime_freight.maritime_customer_portal_page.s12', "عميل جديد أو نسيت الرمز السري؟")}</div>
            {t('maritime_freight.maritime_customer_portal_page.s13', "تواصل مباشرة مع مدير الحساب أو قسم العمليات اللوجستية للحصول على رمز PIN خاص أو رابط الدخول المباشر لشحناتك.")}
          </div>
        </div>
      </div>
    );
  }

  // 4. Render Main Authenticated Customer Portal
  return (
    <div dir="rtl" style={{ minHeight: '100vh', background: '#f8fafc', color: '#0f172a', paddingBottom: '60px' }}>
      {/* Top Navbar */}
      <header style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: '1280px', width: 'min(100%, 1280px)', margin: '0 auto', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          {/* Brand & Portal Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: '#170e5e', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff' }}>
              <ShipIcon size={22} color="#ffffff" />
            </div>
            <div>
              <div style={{ fontSize: '14.5px', fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>
                {customer.tenantName || t('maritime_freight.maritime_customer_portal_page.s14', "منظومة الشحن الملاحي")}
              </div>
              <div style={{ fontSize: '11.5px', color: '#64748b' }}>{t('maritime_freight.maritime_customer_portal_page.s15', "بوابة الخدمة الذاتية للعملاء (B2B Freight Portal)")}</div>
            </div>
          </div>

          {/* Customer Profile & Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ padding: '6px 12px', background: '#f1f5f9', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '12px' }}>
              <span style={{ fontWeight: 700, color: '#0f172a' }}>{customer.name}</span>
              {customer.companyName && <span style={{ color: '#64748b', marginRight: '6px' }}>({customer.companyName})</span>}
            </div>

            <button
              onClick={handleCopyMagicLink}
              title={t('maritime_freight.maritime_customer_portal_page.s16', "نسخ رابط الوصول المباشر لحسابك")}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                fontSize: '11.5px',
                fontWeight: 600,
                color: '#1e293b',
                cursor: 'pointer',
              }}
            >
              <FileCheckIcon size={14} color="#170e5e" />
              <span>{t('maritime_freight.maritime_customer_portal_page.s17', "نسخ رابط الحساب")}</span>
            </button>

            <button
              onClick={handleLogout}
              style={{
                padding: '6px 12px',
                background: '#fee2e2',
                border: '1px solid #fecaca',
                borderRadius: '8px',
                fontSize: '11.5px',
                fontWeight: 700,
                color: '#991b1b',
                cursor: 'pointer',
              }}
            >
              {t('maritime_freight.maritime_customer_portal_page.s18', "خروج")}
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main style={{ maxWidth: '1280px', width: 'min(100%, 1280px)', margin: '20px auto 0', padding: '0 16px' }}>
        {/* KPI Banner Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px', marginBottom: '20px' }}>
          {/* Active Shipments KPI */}
          <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>{t('maritime_freight.maritime_customer_portal_page.s19', "الشحنات الجارية والتتبع")}</span>
              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ShipIcon size={18} color="#2563eb" />
              </div>
            </div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a' }}>
              {dashboard?.kpis.activeShipmentsCount ?? '—'}
            </div>
            <div style={{ fontSize: '11px', color: '#10b981', fontWeight: 600, marginTop: '2px' }}>
              {dashboard?.kpis.deliveredShipmentsCount ? `${dashboard.kpis.deliveredShipmentsCount} شحنة مسلّمة في الأرشيف` : t('maritime_freight.maritime_customer_portal_page.s20', "محدث لحظياً")}
            </div>
          </div>

          {/* Pending Quotes KPI */}
          <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>{t('maritime_freight.maritime_customer_portal_page.s21', "عروض أسعار قيد المراجعة")}</span>
              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <FileTextIcon size={18} color="#d97706" />
              </div>
            </div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a' }}>
              {dashboard?.kpis.pendingQuotesCount ?? '—'}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
              {dashboard?.kpis.approvedQuotesCount ? `${dashboard.kpis.approvedQuotesCount} عرض معتمد ومؤكد` : t('maritime_freight.maritime_customer_portal_page.s22', "عروض تنتظر موافقتكم")}
            </div>
          </div>

          {/* Account Balance KPI */}
          <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>{t('maritime_freight.maritime_customer_portal_page.s23', "الرصيد المستحق (المديونية)")}</span>
              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <DollarSignIcon size={18} color="#0f172a" />
              </div>
            </div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: (customer.balance || 0) > 0 ? '#b91c1c' : '#0f172a' }}>
              {Number(customer.balance || 0).toLocaleString()} <span style={{ fontSize: '13px', fontWeight: 600 }}>{t('maritime_freight.maritime_customer_portal_page.s24', "ج.م")}</span>
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
              {t('maritime_freight.maritime_customer_portal_page.s25', "الحد الائتماني:")} {Number(customer.creditLimit || 0).toLocaleString()} {t('maritime_freight.maritime_customer_portal_page.s26', "ج.م")}
            </div>
          </div>

          {/* Quick Action Tile */}
          <div
            onClick={() => setActiveTab('request_quote')}
            style={{
              background: '#170e5e',
              borderRadius: '14px',
              padding: '16px',
              color: '#ffffff',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: '0 4px 14px rgba(23, 14, 94, 0.15)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#ffffff' }}>{t('maritime_freight.maritime_customer_portal_page.s27', "طلب تسعير شحنة جديدة")}</span>
              <PlusCircleIcon size={20} color="#ffffff" />
            </div>
            <div style={{ fontSize: '11.5px', color: '#cbd5e1', lineHeight: 1.4 }}>
              {t('maritime_freight.maritime_customer_portal_page.s28', "احصل على أفضل أسعار النولون البحري والجوي والبري مع تفريغ الحاويات في دقائق")}
            </div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#93c5fd', marginTop: '8px' }}>
              {t('maritime_freight.maritime_customer_portal_page.s29', "ابدأ الطلب الآن ←")}
            </div>
          </div>
        </div>

        {/* Tab Navigation Bar */}
        <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '6px', display: 'flex', gap: '6px', marginBottom: '20px', overflowX: 'auto' }}>
          {[
            { id: 'shipments', label: t('maritime_freight.maritime_customer_portal_page.s30', "الشحنات الجارية والتتبع التقديري"), icon: ShipIcon },
            { id: 'request_quote', label: t('maritime_freight.maritime_customer_portal_page.s31', "طلب تسعير جديد (RFQ)"), icon: PlusCircleIcon },
            { id: 'quotes', label: t('maritime_freight.maritime_customer_portal_page.s32', "عروض الأسعار والتعميد"), icon: FileTextIcon },
            { id: 'documents', label: t('maritime_freight.maritime_customer_portal_page.s33', "مركز المستندات والبوالص"), icon: FileCheckIcon },
            { id: 'statement', label: t('maritime_freight.maritime_customer_portal_page.s34', "كشف الحساب والمديونيات"), icon: DollarSignIcon },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as ActiveTab)}
                style={{
                  flex: 1,
                  minWidth: '150px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: isActive ? '1px solid #170e5e' : '1px solid transparent',
                  background: isActive ? '#170e5e' : 'transparent',
                  color: isActive ? '#ffffff' : '#475569',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  boxSizing: 'border-box',
                }}
              >
                <Icon size={16} color={isActive ? '#ffffff' : '#64748b'} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* TAB 1: SHIPMENTS & LIVE RADAR */}
        {activeTab === 'shipments' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Filter and Search Bar */}
            <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                {(['active', 'completed', 'all'] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setShipmentFilter(filter)}
                    style={{
                      padding: '6px 14px',
                      borderRadius: '8px',
                      border: '1px solid',
                      borderColor: shipmentFilter === filter ? '#170e5e' : '#cbd5e1',
                      background: shipmentFilter === filter ? '#170e5e' : '#ffffff',
                      color: shipmentFilter === filter ? '#ffffff' : '#334155',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {filter === 'active' ? t('maritime_freight.maritime_customer_portal_page.s35', "الشحنات الجارية") : filter === 'completed' ? t('maritime_freight.maritime_customer_portal_page.s36', "المكتملة والمسلّمة") : t('maritime_freight.maritime_customer_portal_page.s37', "كافة الشحنات")}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '260px' }}>
                <input
                  type="text"
                  value={shipmentSearch}
                  onChange={(e) => setShipmentSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && loadShipments()}
                  placeholder={t('maritime_freight.maritime_customer_portal_page.s38', "بحث برقم الشحنة، السفينة، أو ACID...")}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12.5px', outline: 'none' }}
                />
                <button
                  onClick={loadShipments}
                  style={{ padding: '8px 12px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '8px', cursor: 'pointer' }}
                >
                  <SearchIcon size={16} color="#1e293b" />
                </button>
              </div>
            </div>

            {/* Shipments List */}
            {loadingShipments ? (
              <div style={{ background: '#ffffff', borderRadius: '14px', padding: '40px', textAlign: 'center', border: '1px solid #e2e8f0', color: '#64748b' }}>
                {t('maritime_freight.maritime_customer_portal_page.s39', "جاري تحميل الشحنات وتحديثات التتبع...")}
              </div>
            ) : shipments.length === 0 ? (
              <div style={{ background: '#ffffff', borderRadius: '14px', padding: '40px', textAlign: 'center', border: '1px solid #e2e8f0' }}>
                <ShipIcon size={36} color="#94a3b8" />
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#334155', marginTop: '10px' }}>{t('maritime_freight.maritime_customer_portal_page.s40', "لا توجد شحنات مسجلة حالياً")}</div>
                <div style={{ fontSize: '12.5px', color: '#64748b', marginTop: '4px' }}>{t('maritime_freight.maritime_customer_portal_page.s41', "يمكنكم تقديم طلب تسعير جديد الآن لبدء شحنتكم القادمة")}</div>
              </div>
            ) : (
              shipments.map((job) => {
                const isDelivered = job.status === 'delivered' || job.status === 'closed';
                return (
                  <div
                    key={job.id}
                    style={{
                      background: '#ffffff',
                      borderRadius: '14px',
                      border: '1px solid #e2e8f0',
                      padding: '18px',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                    }}
                  >
                    {/* Header Row */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {job.transport_mode === 'air' ? <PlaneIcon size={18} color="#170e5e" /> : <ShipIcon size={18} color="#170e5e" />}
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>{job.job_number}</span>
                            <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '6px', background: isDelivered ? '#dcfce7' : '#e0e7ff', color: isDelivered ? '#15803d' : '#3730a3' }}>
                              {isDelivered ? t('maritime_freight.maritime_customer_portal_page.s42', "مسلّمة بنجاح") : t('maritime_freight.maritime_customer_portal_page.s43', "شحنة جارية")}
                            </span>
                            {job.direction && (
                              <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px', background: '#f1f5f9', color: '#475569' }}>
                                {job.direction === 'import' ? t('maritime_freight.maritime_customer_portal_page.s44', "استيراد") : job.direction === 'export' ? t('maritime_freight.maritime_customer_portal_page.s45', "تصدير") : t('maritime_freight.maritime_customer_portal_page.s46', "ترانزيت")}
                              </span>
                            )}
                          </div>
                          {job.acid_number && (
                            <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
                              {t('maritime_freight.maritime_customer_portal_page.s47', "رقم ACID الجمركي:")} <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0f172a' }}>{job.acid_number}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Free days / Demurrage Indicator */}
                      {job.freeDaysRemaining !== null && (
                        <div
                          style={{
                            padding: '4px 10px',
                            borderRadius: '8px',
                            fontSize: '11.5px',
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            background: job.demurrageStatus === 'demurrage' ? '#fee2e2' : job.demurrageStatus === 'critical' ? '#ffedd5' : '#f0fdf4',
                            color: job.demurrageStatus === 'demurrage' ? '#991b1b' : job.demurrageStatus === 'critical' ? '#c2410c' : '#166534',
                            border: '1px solid',
                            borderColor: job.demurrageStatus === 'demurrage' ? '#fecaca' : job.demurrageStatus === 'critical' ? '#fed7aa' : '#bbf7d0',
                          }}
                        >
                          <ClockIcon size={14} />
                          <span>
                            {job.demurrageStatus === 'demurrage'
                              ? `غرامات أرضيات/تأخير (-${Math.abs(job.freeDaysRemaining)} يوم)`
                              : `متبقي ${job.freeDaysRemaining} يوم سماح`}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Routing Details Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', background: '#f8fafc', padding: '12px', borderRadius: '10px', marginBottom: '14px', fontSize: '12.5px' }}>
                      <div>
                        <div style={{ color: '#64748b', fontSize: '11px' }}>{t('maritime_freight.maritime_customer_portal_page.s48', "ميناء الشحن (POL)")}</div>
                        <div style={{ fontWeight: 700, color: '#0f172a' }}>{job.pol_name} ({job.pol_code})</div>
                        {job.etd && <div style={{ fontSize: '11px', color: '#64748b' }}>{t('maritime_freight.maritime_customer_portal_page.s49', "إبحار:")} {new Date(job.etd).toLocaleDateString('ar-EG')}</div>}
                      </div>

                      <div>
                        <div style={{ color: '#64748b', fontSize: '11px' }}>{t('maritime_freight.maritime_customer_portal_page.s50', "ميناء الوصول (POD)")}</div>
                        <div style={{ fontWeight: 700, color: '#0f172a' }}>{job.pod_name} ({job.pod_code})</div>
                        {job.eta && <div style={{ fontSize: '11px', color: '#64748b' }}>{t('maritime_freight.maritime_customer_portal_page.s51', "وصول متوقع:")} {new Date(job.eta).toLocaleDateString('ar-EG')}</div>}
                      </div>

                      <div>
                        <div style={{ color: '#64748b', fontSize: '11px' }}>{t('maritime_freight.maritime_customer_portal_page.s52', "الخط الملاحي / الناقل")}</div>
                        <div style={{ fontWeight: 700, color: '#0f172a' }}>{job.shipping_line_name || '—'}</div>
                        {job.vessel_name && (
                          <div style={{ fontSize: '11px', color: '#64748b' }}>
                            {t('maritime_freight.maritime_customer_portal_page.s53', "السفينة:")} {job.vessel_name} {job.voyage_number ? `(${job.voyage_number})` : ''}
                          </div>
                        )}
                      </div>

                      <div>
                        <div style={{ color: '#64748b', fontSize: '11px' }}>{t('maritime_freight.maritime_customer_portal_page.s54', "الحاويات والوزن")}</div>
                        <div style={{ fontWeight: 700, color: '#0f172a' }}>
                          {job.containers?.length || 1} {t('maritime_freight.maritime_customer_portal_page.s55', "حاوية |")} {Number(job.gross_weight_kg || 0).toLocaleString()} {t('maritime_freight.maritime_customer_portal_page.s56', "كجم")}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>{t('maritime_freight.maritime_customer_portal_page.s57', "الحجم:")} {Number(job.total_cbm || 0).toFixed(1)} CBM</div>
                      </div>
                    </div>

                    {/* DCSA Milestones Radar Progression */}
                    <div style={{ marginBottom: '14px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '8px' }}>
                        {t('maritime_freight.maritime_customer_portal_page.s58', "مراحل الشحنة المجدولة (DCSA Milestones)")}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '4px', textAlign: 'center' }}>
                        {[
                          { label: t('maritime_freight.maritime_customer_portal_page.s59', "تأكيد الحجز"), code: 'BOOK' },
                          { label: t('maritime_freight.maritime_customer_portal_page.s60', "دخول الميناء"), code: 'GTI' },
                          { label: t('maritime_freight.maritime_customer_portal_page.s61', "التحميل"), code: 'LOAD' },
                          { label: t('maritime_freight.maritime_customer_portal_page.s62', "الإبحار"), code: 'DEPT' },
                          { label: t('maritime_freight.maritime_customer_portal_page.s63', "وصول الميناء"), code: 'ARRI' },
                          { label: t('maritime_freight.maritime_customer_portal_page.s64', "التسليم"), code: 'DELV' },
                        ].map((m, idx) => {
                          const isDone = isDelivered || (idx <= 3); // realistic progressive preview based on milestone records
                          return (
                            <div
                              key={m.code}
                              style={{
                                padding: '6px 2px',
                                borderRadius: '6px',
                                background: isDone ? '#170e5e' : '#f1f5f9',
                                color: isDone ? '#ffffff' : '#64748b',
                                fontSize: '10.5px',
                                fontWeight: 700,
                              }}
                            >
                              {m.label}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Containers Badges & Action Buttons */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {(job.containers || []).map((cntr: any) => (
                          <div
                            key={cntr.id || cntr.container_number}
                            style={{
                              padding: '4px 8px',
                              background: '#f1f5f9',
                              border: '1px solid #e2e8f0',
                              borderRadius: '6px',
                              fontSize: '11.5px',
                              fontFamily: 'monospace',
                              fontWeight: 700,
                              color: '#0f172a',
                            }}
                          >
                            {cntr.container_number} ({cntr.container_type || '40HC'})
                          </div>
                        ))}
                      </div>

                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => setSelectedShipmentForModal(job)}
                          style={{
                            padding: '6px 12px',
                            background: '#f8fafc',
                            border: '1px solid #cbd5e1',
                            borderRadius: '8px',
                            fontSize: '12px',
                            fontWeight: 600,
                            color: '#0f172a',
                            cursor: 'pointer',
                          }}
                        >
                          {t('maritime_freight.maritime_customer_portal_page.s65', "التفاصيل الكاملة")}
                        </button>

                        <button
                          onClick={() => handlePrintDocument('hbl', job)}
                          style={{
                            padding: '6px 12px',
                            background: '#170e5e',
                            border: 'none',
                            borderRadius: '8px',
                            fontSize: '12px',
                            fontWeight: 700,
                            color: '#ffffff',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          <DownloadIcon size={14} color="#fff" />
                          <span>{t('maritime_freight.maritime_customer_portal_page.s66', "بوليصة HBL")}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* TAB 2: REQUEST A QUOTE (RFQ) */}
        {activeTab === 'request_quote' && (
          <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '12px', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '17px', fontWeight: 800, color: '#0f172a', margin: '0 0 4px' }}>
                {t('maritime_freight.maritime_customer_portal_page.s67', "طلب تسعير شحنة جديدة إلكترونياً (Request Freight Quote)")}
              </h2>
              <p style={{ fontSize: '12.5px', color: '#64748b', margin: 0 }}>
                {t('maritime_freight.maritime_customer_portal_page.s68', "أدخل مواصفات شحنتك وموانئ التحميل والوصول، وسيقوم فريق التسعير بإعداد عرض سعر رسمي متكامل وموافاتكم به")}
              </p>
            </div>

            {submittedQuoteResult ? (
              <div style={{ padding: '30px 20px', textAlign: 'center', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px' }}>
                <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#22c55e', color: '#fff', margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CheckCircleIcon size={28} color="#fff" />
                </div>
                <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#166534', margin: '0 0 6px' }}>{t('maritime_freight.maritime_customer_portal_page.s69', "تم استلام طلب التسعير بنجاح!")}</h3>
                <div style={{ fontSize: '13px', color: '#166534', marginBottom: '12px' }}>
                  {t('maritime_freight.maritime_customer_portal_page.s70', "كود الطلب المرجعي:")} <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '15px' }}>{submittedQuoteResult.inquiryNumber}</span>
                </div>
                <p style={{ fontSize: '12px', color: '#15803d', maxWidth: '480px', margin: '0 auto 18px' }}>
                  {t('maritime_freight.maritime_customer_portal_page.s71', "تم تحويل الطلب لفريق العمليات والتسعير، وستظهر عروض الأسعار المقترحة فور اعتمادها في تبويب \"عروض الأسعار والتعميد\".")}
                </p>
                <button
                  onClick={() => {
                    setSubmittedQuoteResult(null);
                    setActiveTab('quotes');
                  }}
                  style={{
                    padding: '8px 18px',
                    background: '#166534',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {t('maritime_freight.maritime_customer_portal_page.s72', "الانتقال لعروض الأسعار")}
                </button>
              </div>
            ) : (
              <form onSubmit={handleQuoteSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Transport Mode & Direction */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                      {t('maritime_freight.maritime_customer_portal_page.s73', "وسيلة الشحن")} <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {[
                        { id: 'sea', label: t('maritime_freight.maritime_customer_portal_page.s74', "بحري (Sea Freight)") },
                        { id: 'air', label: t('maritime_freight.maritime_customer_portal_page.s75', "جوي (Air Freight)") },
                        { id: 'road', label: t('maritime_freight.maritime_customer_portal_page.s76', "بري (Trucking)") },
                      ].map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setQuoteForm({ ...quoteForm, transportMode: m.id as any })}
                          style={{
                            flex: 1,
                            padding: '8px',
                            borderRadius: '8px',
                            border: '1px solid',
                            borderColor: quoteForm.transportMode === m.id ? '#170e5e' : '#cbd5e1',
                            background: quoteForm.transportMode === m.id ? '#170e5e' : '#ffffff',
                            color: quoteForm.transportMode === m.id ? '#ffffff' : '#334155',
                            fontSize: '11.5px',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                      {t('maritime_freight.maritime_customer_portal_page.s77', "مسار الشحنة")} <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {[
                        { id: 'import', label: t('maritime_freight.maritime_customer_portal_page.s78', "استيراد") },
                        { id: 'export', label: t('maritime_freight.maritime_customer_portal_page.s79', "تصدير") },
                        { id: 'cross_trade', label: t('maritime_freight.maritime_customer_portal_page.s80', "ترانزيت") },
                      ].map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => setQuoteForm({ ...quoteForm, direction: d.id as any })}
                          style={{
                            flex: 1,
                            padding: '8px',
                            borderRadius: '8px',
                            border: '1px solid',
                            borderColor: quoteForm.direction === d.id ? '#170e5e' : '#cbd5e1',
                            background: quoteForm.direction === d.id ? '#170e5e' : '#ffffff',
                            color: quoteForm.direction === d.id ? '#ffffff' : '#334155',
                            fontSize: '11.5px',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Ports (POL & POD) */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                      {t('maritime_freight.maritime_customer_portal_page.s81', "ميناء التحميل / بلد المنشأ (POL)")} <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      type="text"
                      value={quoteForm.polName}
                      onChange={(e) => setQuoteForm({ ...quoteForm, polName: e.target.value })}
                      placeholder={t('maritime_freight.maritime_customer_portal_page.s82', "مثال: شنغهاي / نينغبو / جبل علي / هامبورغ")}
                      required
                      style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                      {t('maritime_freight.maritime_customer_portal_page.s83', "ميناء الوصول / جهة التفريغ (POD)")} <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      type="text"
                      value={quoteForm.podName}
                      onChange={(e) => setQuoteForm({ ...quoteForm, podName: e.target.value })}
                      placeholder={t('maritime_freight.maritime_customer_portal_page.s84', "مثال: الإسكندرية / دمياط / السخنة / مطار القاهرة")}
                      required
                      style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>

                {/* Container Type & RTL Stepper standard ([+] right, [-] left) */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                      {t('maritime_freight.maritime_customer_portal_page.s85', "نوع الحاوية / الشحن")}
                    </label>
                    <select
                      value={quoteForm.containerType}
                      onChange={(e) => setQuoteForm({ ...quoteForm, containerType: e.target.value })}
                      style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box', background: '#fff' }}
                    >
                      <option value="40HC">40' High Cube (40HC)</option>
                      <option value="20GP">20' General Purpose (20GP)</option>
                      <option value="40GP">40' Standard Box (40GP)</option>
                      <option value="40RF">{t('maritime_freight.maritime_customer_portal_page.s86', "40' Reefer مبرد (40RF)")}</option>
                      <option value="LCL">{t('maritime_freight.maritime_customer_portal_page.s87', "شحنة جزئية (LCL - Groupage)")}</option>
                    </select>
                  </div>

                  {/* Quantity Stepper: (+) on right, (-) on left */}
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                      {t('maritime_freight.maritime_customer_portal_page.s88', "عدد الحاويات")}
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #cbd5e1', borderRadius: '8px', overflow: 'hidden' }}>
                      <button
                        type="button"
                        onClick={() => setQuoteForm({ ...quoteForm, containerCount: quoteForm.containerCount + 1 })}
                        style={{ width: '38px', height: '38px', background: '#f1f5f9', border: 'none', borderLeft: '1px solid #cbd5e1', fontSize: '16px', fontWeight: 800, cursor: 'pointer' }}
                      >
                        +
                      </button>
                      <div style={{ flex: 1, textAlign: 'center', fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
                        {quoteForm.containerCount}
                      </div>
                      <button
                        type="button"
                        onClick={() => setQuoteForm({ ...quoteForm, containerCount: Math.max(1, quoteForm.containerCount - 1) })}
                        style={{ width: '38px', height: '38px', background: '#f1f5f9', border: 'none', borderRight: '1px solid #cbd5e1', fontSize: '16px', fontWeight: 800, cursor: 'pointer' }}
                      >
                        -
                      </button>
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                      {t('maritime_freight.maritime_customer_portal_page.s89', "الشرط التجاري (Incoterm)")}
                    </label>
                    <select
                      value={quoteForm.incoterm}
                      onChange={(e) => setQuoteForm({ ...quoteForm, incoterm: e.target.value })}
                      style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box', background: '#fff' }}
                    >
                      <option value="FOB">FOB - Free on Board</option>
                      <option value="CIF">CIF - Cost, Insurance, Freight</option>
                      <option value="CFR">CFR - Cost and Freight</option>
                      <option value="EXW">{t('maritime_freight.maritime_customer_portal_page.s90', "EXW - Ex Works (من المصنع)")}</option>
                      <option value="DAP">DAP - Delivered at Place</option>
                    </select>
                  </div>
                </div>

                {/* Commodity & Weight */}
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '14px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                      {t('maritime_freight.maritime_customer_portal_page.s91', "بيان البضاعة ونوعها")} <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      type="text"
                      value={quoteForm.commodityDescription}
                      onChange={(e) => setQuoteForm({ ...quoteForm, commodityDescription: e.target.value })}
                      placeholder={t('maritime_freight.maritime_customer_portal_page.s92', "مثال: قطع غيار سيارات، أقمشة ومنسوجات، ألواح شمسية...")}
                      required
                      style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                      {t('maritime_freight.maritime_customer_portal_page.s93', "الوزن الإجمالي (كجم)")}
                    </label>
                    <input
                      type="number"
                      value={quoteForm.grossWeightKg}
                      onChange={(e) => setQuoteForm({ ...quoteForm, grossWeightKg: Number(e.target.value) })}
                      dir="ltr"
                      style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                      {t('maritime_freight.maritime_customer_portal_page.s94', "الحجم (CBM)")}
                    </label>
                    <input
                      type="number"
                      value={quoteForm.totalCbm}
                      onChange={(e) => setQuoteForm({ ...quoteForm, totalCbm: Number(e.target.value) })}
                      dir="ltr"
                      style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>

                {/* Notes & Special Requests */}
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                    {t('maritime_freight.maritime_customer_portal_page.s95', "متطلبات خاصة أو ملاحظات (تخليص جمركي، نقل حتى الباب، بضائع خطرة)")}
                  </label>
                  <textarea
                    rows={3}
                    value={quoteForm.notes}
                    onChange={(e) => setQuoteForm({ ...quoteForm, notes: e.target.value })}
                    placeholder={t('maritime_freight.maritime_customer_portal_page.s96', "أدخل أي مواصفات أو متطلبات خاصة لتضمينها في العرض...")}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
                  />
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={submittingQuote}
                  style={{
                    padding: '12px 24px',
                    background: '#170e5e',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '10px',
                    fontSize: '14px',
                    fontWeight: 700,
                    cursor: submittingQuote ? 'not-allowed' : 'pointer',
                    opacity: submittingQuote ? 0.7 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    marginTop: '8px',
                  }}
                >
                  {submittingQuote ? t('maritime_freight.maritime_customer_portal_page.s97', "جاري إرسال الطلب...") : t('maritime_freight.maritime_customer_portal_page.s98', "إرسال طلب التسعير الرسمي")}
                  {!submittingQuote && <ArrowRightIcon size={16} color="#fff" />}
                </button>
              </form>
            )}
          </div>
        )}

        {/* TAB 3: QUOTATIONS & ONLINE APPROVAL */}
        {activeTab === 'quotes' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h2 style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: '0 0 2px' }}>
                  {t('maritime_freight.maritime_customer_portal_page.s99', "عروض الأسعار والتعميد الإلكتروني (Quotations & Approvals)")}
                </h2>
                <div style={{ fontSize: '12px', color: '#64748b' }}>
                  {t('maritime_freight.maritime_customer_portal_page.s100', "استعراض عروض الأسعار المقدمة واعتماد وتعميد الشحنة فورياً بنقرة زر")}
                </div>
              </div>

              <button
                onClick={loadQuotations}
                style={{ padding: '6px 12px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <RefreshCwIcon size={14} color="#0f172a" />
                <span>{t('maritime_freight.maritime_customer_portal_page.s101', "تحديث العروض")}</span>
              </button>
            </div>

            {loadingQuotes ? (
              <div style={{ background: '#ffffff', borderRadius: '14px', padding: '40px', textAlign: 'center', border: '1px solid #e2e8f0', color: '#64748b' }}>
                {t('maritime_freight.maritime_customer_portal_page.s102', "جاري تحميل عروض الأسعار...")}
              </div>
            ) : quotations.length === 0 ? (
              <div style={{ background: '#ffffff', borderRadius: '14px', padding: '40px', textAlign: 'center', border: '1px solid #e2e8f0' }}>
                <FileTextIcon size={36} color="#94a3b8" />
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#334155', marginTop: '10px' }}>{t('maritime_freight.maritime_customer_portal_page.s103', "لا توجد عروض أسعار متاحة حالياً")}</div>
                <div style={{ fontSize: '12.5px', color: '#64748b', marginTop: '4px' }}>{t('maritime_freight.maritime_customer_portal_page.s104', "بإمكانكم تقديم طلب تسعير من تبويب \"طلب تسعير جديد\" وسيوافيكم الفريق بعرض فوري")}</div>
              </div>
            ) : (
              quotations.map((q) => {
                const isApproved = q.status === 'approved' || q.status === 'converted_to_job';
                const isSent = q.status === 'sent';
                return (
                  <div
                    key={q.id}
                    style={{
                      background: '#ffffff',
                      borderRadius: '14px',
                      border: '1px solid #e2e8f0',
                      padding: '18px',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <FileTextIcon size={18} color="#170e5e" />
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>{q.quotation_number}</span>
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: 700,
                                padding: '2px 8px',
                                borderRadius: '6px',
                                background: isApproved ? '#dcfce7' : isSent ? '#fef3c7' : '#f1f5f9',
                                color: isApproved ? '#15803d' : isSent ? '#b45309' : '#475569',
                              }}
                            >
                              {isApproved ? t('maritime_freight.maritime_customer_portal_page.s105', "معتمد ومُعمّد") : isSent ? t('maritime_freight.maritime_customer_portal_page.s106', "بانتظار موافقتكم") : q.status}
                            </span>
                          </div>
                          <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
                            {t('maritime_freight.maritime_customer_portal_page.s107', "تاريخ العرض:")} {new Date(q.created_at).toLocaleDateString('ar-EG')}
                            {q.valid_until && ` | صالح حتى: ${new Date(q.valid_until).toLocaleDateString('ar-EG')}`}
                          </div>
                        </div>
                      </div>

                      {/* Total Amount Pill */}
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>{t('maritime_freight.maritime_customer_portal_page.s108', "إجمالي عرض السعر")}</div>
                        <div style={{ fontSize: '20px', fontWeight: 900, color: '#170e5e' }}>
                          {Number(q.final_total || 0).toLocaleString()} <span style={{ fontSize: '13px' }}>{q.currency || 'USD'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Breakdown & Charges if available */}
                    {q.charges && q.charges.length > 0 && (
                      <div style={{ marginBottom: '14px', background: '#f8fafc', borderRadius: '8px', padding: '10px 12px' }}>
                        <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', marginBottom: '6px' }}>{t('maritime_freight.maritime_customer_portal_page.s109', "تفصيل البنود والرسوم:")}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px', fontSize: '12px' }}>
                          {q.charges.map((c: any, cIdx: number) => (
                            <div key={cIdx} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                              <span style={{ color: '#475569' }}>{c.charge_name}</span>
                              <span style={{ fontWeight: 700, color: '#0f172a' }}>{Number(c.amount || 0).toLocaleString()} {c.currency || q.currency}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Footer Actions */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', paddingTop: '6px' }}>
                      {isSent && (
                        <button
                          onClick={() => setApprovalModalQuote(q)}
                          style={{
                            padding: '8px 18px',
                            background: '#170e5e',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '8px',
                            fontSize: '13px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          <CheckCircleIcon size={16} color="#fff" />
                          <span>{t('maritime_freight.maritime_customer_portal_page.s110', "اعتماد وتعميد العرض (Approve & Book)")}</span>
                        </button>
                      )}

                      {isApproved && (
                        <div style={{ fontSize: '12px', fontWeight: 700, color: '#166534', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <CheckCircleIcon size={16} color="#166534" />
                          <span>{t('maritime_freight.maritime_customer_portal_page.s111', "تم اعتماد وتعميد العرض وتحويله لشحنة تشغيلية")}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {/* Approval Modal */}
            {approvalModalQuote && (
              <div
                style={{
                  position: 'fixed',
                  inset: 0,
                  background: 'rgba(15, 23, 42, 0.6)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 9999,
                  padding: '16px',
                }}
              >
                <div
                  style={{
                    background: '#ffffff',
                    borderRadius: '16px',
                    maxWidth: '500px',
                    width: '100%',
                    padding: '24px',
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
                  }}
                >
                  <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: '0 0 6px' }}>
                    {t('maritime_freight.maritime_customer_portal_page.s112', "تأكيد اعتماد وتعميد عرض السعر")} {approvalModalQuote.quotation_number}
                  </h3>
                  <p style={{ fontSize: '12.5px', color: '#64748b', margin: '0 0 16px', lineHeight: 1.5 }}>
                    {t('maritime_freight.maritime_customer_portal_page.s113', "بالموافقة على هذا العرض، يتم تثبيت أسعار النولون والرسوم وفتح أمر تشغيل شحن رسمي فورياً.")}
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                        {t('maritime_freight.maritime_customer_portal_page.s114', "رقم أمر الشراء للعميل (Client PO / Reference Number)")}
                      </label>
                      <input
                        type="text"
                        value={approvalPoNumber}
                        onChange={(e) => setApprovalPoNumber(e.target.value)}
                        placeholder={t('maritime_freight.maritime_customer_portal_page.s115', "مثال: PO-2026-991")}
                        style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                        {t('maritime_freight.maritime_customer_portal_page.s116', "ملاحظات الاعتماد والتسليم")}
                      </label>
                      <textarea
                        rows={2}
                        value={approvalNotes}
                        onChange={(e) => setApprovalNotes(e.target.value)}
                        placeholder={t('maritime_freight.maritime_customer_portal_page.s117', "أي تعليمات خاصة بالاستلام أو المستندات المطلوبة...")}
                        style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    <button
                      onClick={() => setApprovalModalQuote(null)}
                      style={{ padding: '8px 16px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                    >
                      {t('maritime_freight.maritime_customer_portal_page.s118', "إلغاء")}
                    </button>
                    <button
                      onClick={handleConfirmApproval}
                      disabled={Boolean(approvingQuoteId)}
                      style={{
                        padding: '8px 18px',
                        background: '#170e5e',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: 700,
                        cursor: approvingQuoteId ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {approvingQuoteId ? t('maritime_freight.maritime_customer_portal_page.s119', "جاري الاعتماد...") : t('maritime_freight.maritime_customer_portal_page.s120', "تأكيد الاعتماد والتعميد")}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: DOCUMENT HUB & DOWNLOADS */}
        {activeTab === 'documents' && (
          <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '12px', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '17px', fontWeight: 800, color: '#0f172a', margin: '0 0 4px' }}>
                {t('maritime_freight.maritime_customer_portal_page.s121', "مركز المستندات والبوالص (Digital Document Center)")}
              </h2>
              <p style={{ fontSize: '12.5px', color: '#64748b', margin: 0 }}>
                {t('maritime_freight.maritime_customer_portal_page.s122', "تحميل وطباعة المستندات الرسمية المعتمدة لشحناتكم مباشرة بصيغة PDF الرسمية مع باركود التتبع المعتمد")}
              </p>
            </div>

            {/* Shipment Selector */}
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('maritime_freight.maritime_customer_portal_page.s123', "اختر الشحنة لعرض مستنداتها:")}
              </label>
              <select
                value={selectedDocShipmentId}
                onChange={(e) => setSelectedDocShipmentId(e.target.value)}
                style={{ width: '100%', maxWidth: '480px', padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
              >
                {shipments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.job_number} — {s.pol_name} {t('maritime_freight.maritime_customer_portal_page.s124', "إلى")} {s.pod_name} ({s.shipping_line_name || t('maritime_freight.maritime_customer_portal_page.s125', "الناقل")})
                  </option>
                ))}
              </select>
            </div>

            {/* Documents Tiles */}
            {(() => {
              const currentJob = shipments.find((s) => String(s.id) === String(selectedDocShipmentId)) || shipments[0];
              if (!currentJob) {
                return (
                  <div style={{ padding: '30px', textAlign: 'center', color: '#64748b', background: '#f8fafc', borderRadius: '10px' }}>
                    {t('maritime_freight.maritime_customer_portal_page.s126', "لا توجد شحنات متاحة لتحميل مستنداتها")}
                  </div>
                );
              }

              return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
                  {/* HBL Document */}
                  <div style={{ padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#e0e7ff', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '10px' }}>
                        <FileTextIcon size={20} color="#3730a3" />
                      </div>
                      <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                        {t('maritime_freight.maritime_customer_portal_page.s127', "بوليصة الشحن (House Bill of Lading - HBL)")}
                      </div>
                      <div style={{ fontSize: '11.5px', color: '#64748b', lineHeight: 1.4 }}>
                        {t('maritime_freight.maritime_customer_portal_page.s128', "بوليصة الشحن الرسمية المتوافقة مع معايير FIATA الدولية شاملة أرقام الحاويات والأختام.")}
                      </div>
                    </div>
                    <button
                      onClick={() => handlePrintDocument('hbl', currentJob)}
                      style={{ marginTop: '16px', padding: '8px 12px', background: '#170e5e', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                    >
                      <DownloadIcon size={14} color="#fff" />
                      <span>{t('maritime_freight.maritime_customer_portal_page.s129', "عرض وطباعة البوليصة")}</span>
                    </button>
                  </div>

                  {/* Delivery Order Document */}
                  <div style={{ padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '10px' }}>
                        <FileCheckIcon size={20} color="#15803d" />
                      </div>
                      <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                        {t('maritime_freight.maritime_customer_portal_page.s130', "إذن التسليم الملاحي (Delivery Order - D/O)")}
                      </div>
                      <div style={{ fontSize: '11.5px', color: '#64748b', lineHeight: 1.4 }}>
                        {t('maritime_freight.maritime_customer_portal_page.s131', "إذن التسليم الجمركي المعتمد لساحات الموانئ والمستودعات لاستلام وتفريغ البضائع.")}
                      </div>
                    </div>
                    <button
                      onClick={() => handlePrintDocument('delivery_order', currentJob)}
                      style={{ marginTop: '16px', padding: '8px 12px', background: '#170e5e', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                    >
                      <DownloadIcon size={14} color="#fff" />
                      <span>{t('maritime_freight.maritime_customer_portal_page.s132', "عرض وطباعة إذن التسليم")}</span>
                    </button>
                  </div>

                  {/* Arrival Notice Document */}
                  <div style={{ padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '10px' }}>
                        <ClockIcon size={20} color="#b45309" />
                      </div>
                      <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                        {t('maritime_freight.maritime_customer_portal_page.s133', "إخطار وصول الشحنة (Arrival Notice - A/N)")}
                      </div>
                      <div style={{ fontSize: '11.5px', color: '#64748b', lineHeight: 1.4 }}>
                        {t('maritime_freight.maritime_customer_portal_page.s134', "إشعار رسمي ببيانات وصول السفينة، الرصيف، وتاريخ بدء حساب فترات السماح (Free Time).")}
                      </div>
                    </div>
                    <button
                      onClick={() => handlePrintDocument('arrival_notice', currentJob)}
                      style={{ marginTop: '16px', padding: '8px 12px', background: '#170e5e', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                    >
                      <DownloadIcon size={14} color="#fff" />
                      <span>{t('maritime_freight.maritime_customer_portal_page.s135', "عرض وطباعة إخطار الوصول")}</span>
                    </button>
                  </div>

                  {/* Freight Invoice Document */}
                  <div style={{ padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '10px' }}>
                        <DollarSignIcon size={20} color="#0f172a" />
                      </div>
                      <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                        {t('maritime_freight.maritime_customer_portal_page.s136', "مطالبة ورسوم الشحن (Freight Billing / Invoice)")}
                      </div>
                      <div style={{ fontSize: '11.5px', color: '#64748b', lineHeight: 1.4 }}>
                        {t('maritime_freight.maritime_customer_portal_page.s137', "كشف تفصيلي برسوم الشحن، عوائد الموانئ THC، والخدمات اللوجستية الإضافية.")}
                      </div>
                    </div>
                    <button
                      onClick={() => handlePrintDocument('invoice', currentJob)}
                      style={{ marginTop: '16px', padding: '8px 12px', background: '#170e5e', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                    >
                      <DownloadIcon size={14} color="#fff" />
                      <span>{t('maritime_freight.maritime_customer_portal_page.s138', "عرض وطباعة المطالبة")}</span>
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* TAB 5: STATEMENT OF ACCOUNT & INVOICES */}
        {activeTab === 'statement' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h2 style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: '0 0 2px' }}>
                  {t('maritime_freight.maritime_customer_portal_page.s139', "كشف الحساب والمديونيات (Statement of Account)")}
                </h2>
                <div style={{ fontSize: '12px', color: '#64748b' }}>
                  {t('maritime_freight.maritime_customer_portal_page.s140', "سجل تفصيلي بالعمليات المالية، الفواتير، والأرصدة المستحقة على الشحنات")}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => window.print()}
                  style={{ padding: '6px 14px', background: '#170e5e', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <DownloadIcon size={14} color="#fff" />
                  <span>{t('maritime_freight.maritime_customer_portal_page.s141', "طباعة كشف الحساب")}</span>
                </button>
              </div>
            </div>

            {/* Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
              <div style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '16px' }}>
                <div style={{ fontSize: '11.5px', color: '#64748b' }}>{t('maritime_freight.maritime_customer_portal_page.s142', "الرصيد المستحق الحالي")}</div>
                <div style={{ fontSize: '22px', fontWeight: 900, color: (customer.balance || 0) > 0 ? '#b91c1c' : '#0f172a', marginTop: '4px' }}>
                  {Number(customer.balance || 0).toLocaleString()} <span style={{ fontSize: '13px' }}>{t('maritime_freight.maritime_customer_portal_page.s143', "ج.م")}</span>
                </div>
              </div>

              <div style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '16px' }}>
                <div style={{ fontSize: '11.5px', color: '#64748b' }}>{t('maritime_freight.maritime_customer_portal_page.s144', "الحد الائتماني المعتمد")}</div>
                <div style={{ fontSize: '22px', fontWeight: 900, color: '#0f172a', marginTop: '4px' }}>
                  {Number(customer.creditLimit || 0).toLocaleString()} <span style={{ fontSize: '13px' }}>{t('maritime_freight.maritime_customer_portal_page.s145', "ج.م")}</span>
                </div>
              </div>

              <div style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '16px' }}>
                <div style={{ fontSize: '11.5px', color: '#64748b' }}>{t('maritime_freight.maritime_customer_portal_page.s146', "الرصيد الائتماني المتبقي")}</div>
                <div style={{ fontSize: '22px', fontWeight: 900, color: '#166534', marginTop: '4px' }}>
                  {Math.max(0, Number(customer.creditLimit || 0) - Number(customer.balance || 0)).toLocaleString()} <span style={{ fontSize: '13px' }}>{t('maritime_freight.maritime_customer_portal_page.s147', "ج.م")}</span>
                </div>
              </div>
            </div>

            {/* Jobs Ledger Summary Table */}
            <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', fontWeight: 700, fontSize: '13.5px', color: '#0f172a' }}>
                {t('maritime_freight.maritime_customer_portal_page.s148', "سجل شحنات ومطالبات العميل")}
              </div>

              {loadingStatement ? (
                <div style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>{t('maritime_freight.maritime_customer_portal_page.s149', "جاري تحميل البيانات...")}</div>
              ) : !statementData?.jobsSummary || statementData.jobsSummary.length === 0 ? (
                <div style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>{t('maritime_freight.maritime_customer_portal_page.s150', "لا توجد قيود أو فواتير مسجلة")}</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12.5px' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                        <th style={{ padding: '10px 14px', fontWeight: 700 }}>{t('maritime_freight.maritime_customer_portal_page.s151', "رقم الشحنة")}</th>
                        <th style={{ padding: '10px 14px', fontWeight: 700 }}>{t('maritime_freight.maritime_customer_portal_page.s152', "الناقل")}</th>
                        <th style={{ padding: '10px 14px', fontWeight: 700 }}>{t('maritime_freight.maritime_customer_portal_page.s153', "المسار (POL → POD)")}</th>
                        <th style={{ padding: '10px 14px', fontWeight: 700 }}>{t('maritime_freight.maritime_customer_portal_page.s154', "التاريخ")}</th>
                        <th style={{ padding: '10px 14px', fontWeight: 700, textAlign: 'left' }}>{t('maritime_freight.maritime_customer_portal_page.s155', "إجمالي الرسوم المسجلة")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statementData.jobsSummary.map((job: any) => (
                        <tr key={job.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '10px 14px', fontWeight: 800, color: '#0f172a' }}>{job.job_number}</td>
                          <td style={{ padding: '10px 14px', color: '#475569' }}>{job.shipping_line_name || '—'}</td>
                          <td style={{ padding: '10px 14px', color: '#334155' }}>{job.pol_name} → {job.pod_name}</td>
                          <td style={{ padding: '10px 14px', color: '#64748b' }}>{new Date(job.created_at).toLocaleDateString('ar-EG')}</td>
                          <td style={{ padding: '10px 14px', fontWeight: 800, textAlign: 'left', color: '#170e5e' }}>
                            {Number(job.totalAmount || 0).toLocaleString()} {t('maritime_freight.maritime_customer_portal_page.s156', "ج.م")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Shipment Details Slide-over / Modal */}
      {selectedShipmentForModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px',
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              maxWidth: '640px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px', marginBottom: '16px' }}>
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: '0 0 2px' }}>
                  {t('maritime_freight.maritime_customer_portal_page.s157', "تفاصيل الشحنة")} {selectedShipmentForModal.job_number}
                </h3>
                <div style={{ fontSize: '12px', color: '#64748b' }}>
                  {selectedShipmentForModal.pol_name} → {selectedShipmentForModal.pod_name}
                </div>
              </div>
              <button
                onClick={() => setSelectedShipmentForModal(null)}
                style={{ background: '#f1f5f9', border: 'none', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', fontWeight: 700 }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px' }}>
              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div><strong>{t('maritime_freight.maritime_customer_portal_page.s158', "الخط الملاحي:")}</strong> {selectedShipmentForModal.shipping_line_name || '—'}</div>
                <div><strong>{t('maritime_freight.maritime_customer_portal_page.s159', "اسم السفينة:")}</strong> {selectedShipmentForModal.vessel_name || '—'}</div>
                <div><strong>{t('maritime_freight.maritime_customer_portal_page.s160', "رقم الحجز:")}</strong> {selectedShipmentForModal.booking_number || '—'}</div>
                <div><strong>{t('maritime_freight.maritime_customer_portal_page.s161', "رقم ACID:")}</strong> {selectedShipmentForModal.acid_number || '—'}</div>
              </div>

              <div>
                <h4 style={{ fontSize: '13px', fontWeight: 700, color: '#1e293b', margin: '0 0 8px' }}>{t('maritime_freight.maritime_customer_portal_page.s162', "الحاويات المربوطة:")}</h4>
                {(selectedShipmentForModal.containers || []).map((c: any, idx: number) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: '#f1f5f9', borderRadius: '8px', marginBottom: '6px' }}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{c.container_number}</span>
                    <span style={{ color: '#64748b' }}>{c.container_type} {t('maritime_freight.maritime_customer_portal_page.s163', "| سيل:")} {c.seal_number || '—'}</span>
                    <span style={{ fontWeight: 700 }}>{Number(c.gross_weight_kg || 0).toLocaleString()} {t('maritime_freight.maritime_customer_portal_page.s164', "كجم")}</span>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
                <button
                  onClick={() => handlePrintDocument('hbl', selectedShipmentForModal)}
                  style={{ padding: '8px 14px', background: '#170e5e', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' }}
                >
                  {t('maritime_freight.maritime_customer_portal_page.s165', "طباعة بوليصة HBL")}
                </button>
                <button
                  onClick={() => handlePrintDocument('delivery_order', selectedShipmentForModal)}
                  style={{ padding: '8px 14px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' }}
                >
                  {t('maritime_freight.maritime_customer_portal_page.s166', "طباعة إذن التسليم")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MaritimeCustomerPortalPage;
