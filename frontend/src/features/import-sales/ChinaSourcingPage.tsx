import React, { useState } from 'react';
import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import {
  useChinaSuppliersQuery,
  useCreateChinaSupplierMutation,
  useUpsertSupplierMetaMutation,
  useQcInspectionsQuery,
  useCreateQcInspectionMutation,
  useSourcingTripsQuery,
  useCreateSourcingTripMutation,
  ChinaSupplier,
} from './api/shipments.api';
import { StandardDialog } from '@/shared/components/StandardDialog';
import {
  CheckCircleIcon,
  RefreshCwIcon,
  PlusCircleIcon,
  SearchIcon,
  AlertTriangleIcon,
} from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';
import { ChinaQuotationsTab } from './components/ChinaQuotationsTab';
import { ChinaSamplesTab } from './components/ChinaSamplesTab';
import { ChinaProformasTab } from './components/ChinaProformasTab';

export default function ChinaSourcingPage() {
  const { data: suppliers = [], refetch } = useChinaSuppliersQuery();
  const { data: qcInspections = [], refetch: refetchQc } = useQcInspectionsQuery();
  const upsertSupplierMetaMutation = useUpsertSupplierMetaMutation('');
  const createQcMutation = useCreateQcInspectionMutation();

  const [activeTab, setActiveTab] = useState<'factories' | 'quotations' | 'samples' | 'proformas' | 'qc' | 'trips'>('factories');
  const { data: sourcingTrips = [], refetch: refetchTrips } = useSourcingTripsQuery();
  const createTripMutation = useCreateSourcingTripMutation();
  const [isTripModalOpen, setIsTripModalOpen] = useState(false);
  const [tripTitle, setTripTitle] = useState('');
  const [tripDestination, setTripDestination] = useState('Guangzhou / Yiwu, China');
  const [tripStartDate, setTripStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [tripEndDate, setTripEndDate] = useState('');
  const [tripBudgetEgp, setTripBudgetEgp] = useState<number>(75000);
  const [tripObjectives, setTripObjectives] = useState('');
  const createChinaSupplierMutation = useCreateChinaSupplierMutation();
  const [search, setSearch] = useState('');

  // New Factory Modal
  const [isNewSupplierModalOpen, setIsNewSupplierModalOpen] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [newChineseName, setNewChineseName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newCity, setNewCity] = useState('');
  const [newProvince, setNewProvince] = useState('');
  const [newMoq, setNewMoq] = useState('');
  const [newLeadTime, setNewLeadTime] = useState<number>(30);
  const [newBankBeneficiary, setNewBankBeneficiary] = useState('');
  const [newBankName, setNewBankName] = useState('');
  const [newBankSwift, setNewBankSwift] = useState('');
  const [newBankAccount, setNewBankAccount] = useState('');
  const [newNotes, setNewNotes] = useState('');

  // Sourcing Meta Modal
  const [selectedSupplier, setSelectedSupplier] = useState<ChinaSupplier | null>(null);
  const [chineseName, setChineseName] = useState('');
  const [city, setCity] = useState('');
  const [province, setProvince] = useState('');
  const [moq, setMoq] = useState('');
  const [leadTime, setLeadTime] = useState<number>(30);
  const [bankBeneficiary, setBankBeneficiary] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankSwift, setBankSwift] = useState('');
  const [bankIban, setBankIban] = useState('');
  const [notes, setNotes] = useState('');

  // QC Modal
  const [isQcModalOpen, setIsQcModalOpen] = useState(false);
  const [qcStage, setQcStage] = useState('pre_shipment');
  const [qcDate, setQcDate] = useState(new Date().toISOString().slice(0, 10));
  const [qcInspector, setQcInspector] = useState('');
  const [qcSampleSize, setQcSampleSize] = useState<number>(100);
  const [qcPassedQty, setQcPassedQty] = useState<number>(98);
  const [qcFailedQty, setQcFailedQty] = useState<number>(2);
  const [qcDefectNotes, setQcDefectNotes] = useState('');
  const [qcStatus, setQcStatus] = useState('passed');

  const filteredSuppliers = suppliers.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.chinese_name && s.chinese_name.includes(search)) ||
      (s.city && s.city.toLowerCase().includes(search.toLowerCase()))
  );

  const openMetaModal = (s: ChinaSupplier) => {
    setSelectedSupplier(s);
    setChineseName(s.chinese_name || '');
    setCity(s.city || '');
    setProvince(s.province || '');
    setMoq(s.moq_description || '');
    setLeadTime(s.production_lead_time_days || 30);
    const bank = s.verified_bank_details || {};
    setBankBeneficiary(bank.beneficiaryName || '');
    setBankName(bank.bankName || '');
    setBankSwift(bank.swiftCode || '');
    setBankIban(bank.ibanOrAccount || '');
    setNotes(s.import_notes || '');
  };

  const handleSaveMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplier) return;

    try {
      await upsertSupplierMetaMutation.mutateAsync({
        supplierId: selectedSupplier.id,
        chineseName,
        city,
        province,
        moqDescription: moq,
        productionLeadTimeDays: Number(leadTime),
        verifiedBankDetails: {
          beneficiaryName: bankBeneficiary,
          bankName,
          swiftCode: bankSwift,
          ibanOrAccount: bankIban,
        },
        auditStatus: 'verified',
        notes,
      });
      toast.success('تم حفظ وتوثيق بيانات المصنع والحساب البنكي بنجاح');
      setSelectedSupplier(null);
      refetch();
    } catch (err: any) {
      toast.error('حدث خطأ أثناء حفظ بيانات المصنع: ' + (err.message || 'خطأ غير معروف'));
    }
  };

  const handleCreateNewSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSupplierName.trim()) {
      toast.error('اسم المصنع أو المورد الدولي مطلوب');
      return;
    }

    try {
      await createChinaSupplierMutation.mutateAsync({
        name: newSupplierName.trim(),
        chineseName: newChineseName.trim() || undefined,
        phone: newPhone.trim() || undefined,
        address: newAddress.trim() || undefined,
        city: newCity.trim() || undefined,
        province: newProvince.trim() || undefined,
        moqDescription: newMoq.trim() || undefined,
        productionLeadTimeDays: Number(newLeadTime) || 30,
        bankBeneficiary: newBankBeneficiary.trim() || undefined,
        bankName: newBankName.trim() || undefined,
        bankSwift: newBankSwift.trim() || undefined,
        bankAccount: newBankAccount.trim() || undefined,
        incotermsAccepted: ['FOB', 'CIF', 'EXW'],
        notes: newNotes.trim() || undefined,
      });

      toast.success('تمت إضافة المصنع وتوثيق بياناته بنجاح');
      setIsNewSupplierModalOpen(false);
      setNewSupplierName('');
      setNewChineseName('');
      setNewPhone('');
      setNewAddress('');
      setNewCity('');
      setNewProvince('');
      setNewMoq('');
      setNewLeadTime(30);
      setNewBankBeneficiary('');
      setNewBankName('');
      setNewBankSwift('');
      setNewBankAccount('');
      setNewNotes('');
      refetch();
    } catch (err: any) {
      toast.error('حدث خطأ أثناء إضافة المصنع: ' + (err.message || 'خطأ غير معروف'));
    }
  };

  const handleCreateQc = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createQcMutation.mutateAsync({
        stage: qcStage,
        inspectionDate: qcDate,
        inspectorName: qcInspector,
        sampleSize: Number(qcSampleSize),
        passedQuantity: Number(qcPassedQty),
        failedQuantity: Number(qcFailedQty),
        defectNotes: qcDefectNotes,
        status: qcStatus,
      });
      toast.success('تم تسجيل تقرير فحص الجودة في الصين بنجاح');
      setIsQcModalOpen(false);
      refetchQc();
    } catch (err: any) {
      toast.error('حدث خطأ أثناء تسجيل تقرير الفحص: ' + (err.message || 'خطأ غير معروف'));
    }
  };

  const tabItems: Array<{ key: 'factories' | 'quotations' | 'samples' | 'proformas' | 'qc' | 'trips'; label: string }> = [
    { key: 'factories', label: `دليل المصانع والحسابات الموثقة (${suppliers.length})` },
    { key: 'quotations', label: 'مقارنة عروض الأسعار (RFQ)' },
    { key: 'samples', label: 'العينات والاعتماد المرجعي' },
    { key: 'proformas', label: 'الفواتير المبدئية وأوامر الشراء (PI / PO)' },
    { key: 'qc', label: `تقارير فحص الجودة (${qcInspections.length})` },
    { key: 'trips', label: `رحلات الصين والمعارض (${sourcingTrips.length})` },
  ];

  return (
    <div className="page-stack page-shell import-sales-page" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '80px', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
        <PageHeader
          title="سورسينج الصين وإدارة المصانع وفحص الجودة"
          description="توثيق حسابات البنوك لمنع الاحتيال، متابعة عروض الأسعار والعينات والفواتير المبدئية، وتقارير فحص الجودة قبل الشحن."
          actions={
            <div className="actions compact-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Button
                variant="primary"
                onClick={() => setIsNewSupplierModalOpen(true)}
                style={{
                  height: '38px',
                  padding: '0 18px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  background: '#170e5e',
                  color: '#ffffff',
                  border: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                }}
              >
                <PlusCircleIcon size={15} />
                <span>إضافة مصنع / مورد دولي جديد</span>
              </Button>
              <Button
                variant="secondary"
                onClick={() => setIsQcModalOpen(true)}
                style={{
                  height: '38px',
                  padding: '0 16px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  background: '#ffffff',
                  color: '#170e5e',
                  border: '1px solid #cbd5e1',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                }}
              >
                <PlusCircleIcon size={15} />
                <span>تقرير فحص جودة (QC)</span>
              </Button>
            </div>
          }
        />

        {/* 2. Tabs */}
      <div className="horizontal-scroll-tabs" style={{ display: 'flex', gap: 8, borderBottom: '1px solid #e2e8f0', paddingBottom: 8, overflowX: 'auto' }}>
        {tabItems.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: isActive ? '1px solid #170e5e' : '1px solid #e2e8f0',
                boxSizing: 'border-box',
                fontSize: '12.5px',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                backgroundColor: isActive ? '#170e5e' : '#f8fafc',
                color: isActive ? '#ffffff' : '#475569',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 3. Tab Content */}
      {activeTab === 'quotations' && <ChinaQuotationsTab />}

      {activeTab === 'samples' && <ChinaSamplesTab />}

      {activeTab === 'proformas' && <ChinaProformasTab />}

      {activeTab === 'trips' && (
        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', margin: 0 }}>
              سجل رحلات وزيارات المصانع بالصين ({sourcingTrips.length})
            </h2>
            <button
              onClick={() => setIsTripModalOpen(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 14px',
                borderRadius: 8,
                backgroundColor: '#170e5e',
                color: '#ffffff',
                border: 'none',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <PlusCircleIcon size={15} />
              تسجيل رحلة مصانع جديدة
            </button>
          </div>

          {sourcingTrips.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#64748b', fontSize: '13px' }}>
              لا توجد رحلات مصانع مسجلة حالياً. قم بتسجيل زيارات المعارض والمصانع لتوثيق المصاريف والنتائج.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '10px 12px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>عنوان الرحلة / المعرض</th>
                    <th style={{ padding: '10px 12px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>الوجهة والمدن</th>
                    <th style={{ padding: '10px 12px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>تاريخ البدء والانتهاء</th>
                    <th style={{ padding: '10px 12px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>الميزانية المقدرة</th>
                    <th style={{ padding: '10px 12px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>المصروف الفعلي</th>
                    <th style={{ padding: '10px 12px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>حالة الترحيل</th>
                    <th style={{ padding: '10px 12px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>الملاحظات والأهداف</th>
                  </tr>
                </thead>
                <tbody>
                  {sourcingTrips.map((t: any) => (
                    <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 12px', fontSize: '12.5px', fontWeight: 600, color: '#0f172a' }}>{t.trip_title || t.title}</td>
                      <td style={{ padding: '10px 12px', fontSize: '12px', color: '#475569' }}>{t.destination_city || t.destination}</td>
                      <td style={{ padding: '10px 12px', fontSize: '12px', color: '#64748b' }}>
                        {t.start_date ? String(t.start_date).slice(0, 10) : '—'} إلى {t.end_date ? String(t.end_date).slice(0, 10) : 'مستمر'}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: '12px', fontWeight: 600, color: '#0f172a' }}>{Number(t.budget_egp || 0).toLocaleString()} ج.م</td>
                      <td style={{ padding: '10px 12px', fontSize: '12px', fontWeight: 600, color: '#0f172a' }}>{Number(t.actual_cost_egp ?? t.actual_expenses_egp ?? 0).toLocaleString()} ج.م</td>
                      <td style={{ padding: '10px 12px', fontSize: '11.5px' }}>
                        {t.journal_entry_id ? (
                          <span style={{ background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', borderRadius: 999, padding: '2px 8px', fontWeight: 700 }}>مرحل بقيد محاسبي</span>
                        ) : (
                          <span style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a', borderRadius: 999, padding: '2px 8px', fontWeight: 700 }}>تقدير غير مرحل — مستبعد من التقارير المالية</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: '12px', color: '#475569' }}>
                        {t.notes || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'factories' && (
        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ position: 'relative', width: 280 }}>
                <input
                  type="text"
                  placeholder="بحث عن مصنع أو مدينة أو مقاطعة..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ width: '100%', height: 34, padding: '4px 32px 4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
                />
                <span style={{ position: 'absolute', right: 10, top: 9, color: '#94a3b8' }}>
                  <SearchIcon size={14} />
                </span>
              </div>

              <button
                onClick={() => refetch()}
                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '12px' }}
              >
                <RefreshCwIcon size={13} />
                تحديث
              </button>
            </div>

            <button
              onClick={() => setIsNewSupplierModalOpen(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 16px',
                borderRadius: 8,
                backgroundColor: '#170e5e',
                color: '#ffffff',
                border: 'none',
                fontSize: '12.5px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <PlusCircleIcon size={15} />
              إضافة مصنع / مورد دولي جديد
            </button>
          </div>

          {filteredSuppliers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 20px', border: '1px dashed #cbd5e1', borderRadius: 10, margin: '10px 0' }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>
                لا توجد مصانع أو موردين دوليين مسجلين
              </div>
              <p style={{ fontSize: '12.5px', color: '#64748b', maxWidth: 500, margin: '0 auto 16px', lineHeight: 1.6 }}>
                قم بتسجيل بيانات المصنع الصيني أو المورد الدولي، الاسم باللغة الصينية، والبيانات البنكية الرسمية لبدء طلب عروض الأسعار (RFQ) وإصدار الفواتير المبدئية (PI).
              </p>
              <button
                onClick={() => setIsNewSupplierModalOpen(true)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 18px',
                  borderRadius: 8,
                  backgroundColor: '#170e5e',
                  color: '#ffffff',
                  border: 'none',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                <PlusCircleIcon size={15} />
                تسجيل أول مصنع صيني الآن
              </button>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>المصنع / المورد الدولي</th>
                    <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>الاسم الصيني والموقع</th>
                    <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>حد الطلب الأدنى MOQ</th>
                    <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>مدة الإنتاج والتجهيز</th>
                    <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>الحساب البنكي الموثق</th>
                    <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>الرصيد الدفتري (ج.م)</th>
                    <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSuppliers.map((s) => {
                    const bank = typeof s.verified_bank_details === 'string' ? JSON.parse(s.verified_bank_details || '{}') : (s.verified_bank_details || {});
                    const isVerified = Boolean(bank.bankName && bank.swiftCode);
                    return (
                      <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '12px 14px', fontSize: '12.5px', fontWeight: 700, color: '#0f172a' }}>
                          {s.name}
                        </td>
                        <td style={{ padding: '12px 14px', fontSize: '12px', color: '#475569' }}>
                          {s.chinese_name ? `${s.chinese_name} (${s.city || ''})` : s.city || '—'}
                        </td>
                        <td style={{ padding: '12px 14px', fontSize: '12px', color: '#475569' }}>
                          {s.moq_description || 'غير محدد'}
                        </td>
                        <td style={{ padding: '12px 14px', fontSize: '12px', color: '#475569' }}>
                          {s.production_lead_time_days || 30} يوم
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 700,
                              padding: '3px 8px',
                              borderRadius: 6,
                              backgroundColor: isVerified ? '#ecfdf5' : '#fffbeb',
                              color: isVerified ? '#047857' : '#b45309',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            {isVerified ? <CheckCircleIcon size={12} /> : <AlertTriangleIcon size={12} />}
                            {isVerified ? 'حساب موثق ومحمى' : 'يحتاج توثيق'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px', fontSize: '12px', fontWeight: 700, color: Number(s.balance || 0) > 0 ? '#b91c1c' : '#059669' }}>
                          {Number(s.balance || 0).toLocaleString()} ج.م
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <button
                            onClick={() => openMetaModal(s)}
                            style={{
                              padding: '4px 10px',
                              backgroundColor: '#f1f5f9',
                              border: '1px solid #cbd5e1',
                              borderRadius: 6,
                              fontSize: '11.5px',
                              fontWeight: 700,
                              color: '#170e5e',
                              cursor: 'pointer',
                            }}
                          >
                            توثيق البيانات
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 4. Tab: QC Inspections */}
      {activeTab === 'qc' && (
        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a', margin: 0 }}>
              سجل فحوصات الجودة ومراحل التصنيع ({qcInspections.length})
            </h2>
            <button
              onClick={() => refetchQc()}
              style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '12px' }}
            >
              <RefreshCwIcon size={13} />
              تحديث
            </button>
          </div>

          {qcInspections.length === 0 ? (
            <div style={{ padding: '30px 0', textAlign: 'center', color: '#64748b', fontSize: '12.5px' }}>
              لا توجد تقارير فحص مسجلة حتى الآن.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>تاريخ الفحص</th>
                    <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>مرحلة الفحص</th>
                    <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>المفتش / شركة الفحص</th>
                    <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>العينة المفحوصة</th>
                    <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>المقبول vs المرفوض</th>
                    <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>ملاحظات العيوب</th>
                    <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>القرار النهائي</th>
                  </tr>
                </thead>
                <tbody>
                  {qcInspections.map((q) => (
                    <tr key={q.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '12px 14px', fontSize: '12px', color: '#475569' }}>{q.inspection_date}</td>
                      <td style={{ padding: '12px 14px', fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                        {q.stage === 'pre_shipment' ? 'قبل الشحن (Pre-Shipment)' : q.stage === 'during_production' ? 'أثناء الإنتاج (DUPRO)' : q.stage}
                      </td>
                      <td style={{ padding: '12px 14px', fontSize: '12px', color: '#475569' }}>{q.inspector_name || 'مكتب فحص الصين'}</td>
                      <td style={{ padding: '12px 14px', fontSize: '12px', color: '#475569' }}>{q.sample_size} قطعة</td>
                      <td style={{ padding: '12px 14px', fontSize: '12px' }}>
                        <span style={{ color: '#059669', fontWeight: 700 }}>{q.passed_quantity} مطابق</span> | <span style={{ color: '#b91c1c', fontWeight: 700 }}>{q.failed_quantity} مرفوض</span>
                      </td>
                      <td style={{ padding: '12px 14px', fontSize: '12px', color: '#64748b' }}>{q.defect_notes || 'لا توجد ملاحظات حرجة'}</td>
                      <td style={{ padding: '12px 14px' }}>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '3px 8px',
                            borderRadius: 6,
                            backgroundColor: q.status === 'passed' ? '#dcfce7' : q.status === 'conditional' ? '#fef3c7' : '#fee2e2',
                            color: q.status === 'passed' ? '#166534' : q.status === 'conditional' ? '#92400e' : '#991b1b',
                          }}
                        >
                          {q.status === 'passed' ? 'معتمد للشحن' : q.status === 'conditional' ? 'معتمد بشروط' : 'مرفوض'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* New China Factory Modal */}
      <StandardDialog
        open={isNewSupplierModalOpen}
        onClose={() => setIsNewSupplierModalOpen(false)}
        title="إضافة مصنع أو مورد دولي جديد (China Factory)"
        subtitle="تسجيل بيانات المصنع، الاسم باللغة الصينية، المقاطعة، وتوثيق الحساب البنكي الرسمي لمنع الاحتيال"
        width="680px"
      >
        <form onSubmit={handleCreateNewSupplier} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Row 1: Factory Name (EN/Trade) & Chinese Name */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
                اسم المصنع / المورد التجاري <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="text"
                required
                value={newSupplierName}
                onChange={(e) => setNewSupplierName(e.target.value)}
                placeholder="مثال: Shandong Liangshan Titan Trailer Parts Co., Ltd"
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
                الاسم باللغة الصينية (Chinese Name)
              </label>
              <input
                type="text"
                value={newChineseName}
                onChange={(e) => setNewChineseName(e.target.value)}
                placeholder="مثال: 山东梁山泰坦挂车配件有限公司"
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
          </div>

          {/* Row 2: City & Province & Phone/WeChat */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
                المدينة (City)
              </label>
              <input
                type="text"
                value={newCity}
                onChange={(e) => setNewCity(e.target.value)}
                placeholder="مثال: Jining / Liangshan"
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
                المقاطعة (Province)
              </label>
              <input
                type="text"
                value={newProvince}
                onChange={(e) => setNewProvince(e.target.value)}
                placeholder="مثال: Shandong / 山东"
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
                هاتف / WeChat
              </label>
              <input
                type="text"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="مثال: +86 138 0000 0000"
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
          </div>

          {/* Row 3: Full Address */}
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
              العنوان التفصيلي وموقع المصنع
            </label>
            <input
              type="text"
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              placeholder="مثال: Liangshan Industrial Park, Jining City, Shandong Province, China"
              style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>

          {/* Row 4: MOQ & Lead Time */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
                حد الطلب الأدنى (MOQ)
              </label>
              <input
                type="text"
                value={newMoq}
                onChange={(e) => setNewMoq(e.target.value)}
                placeholder="مثال: 1x20ft أو 50 قطعة لكل صنف"
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
                مدة دورة الإنتاج والتجهيز (بالأيام)
              </label>
              <input
                type="number"
                min={1}
                value={newLeadTime}
                onChange={(e) => setNewLeadTime(Number(e.target.value))}
                placeholder="30"
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
          </div>

          {/* Verified Bank Details Box */}
          <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '12.5px', fontWeight: 800, color: '#170e5e', display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircleIcon size={14} />
                بيانات الحساب البنكي الرسمي الموثق للحوالات الدولية (Bank Wire Details)
              </div>
              <span style={{ fontSize: '11px', color: '#64748b' }}>حماية من القرصنة والاحتيال</span>
            </div>

            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>
                اسم المستفيد بالإنجليزية (Beneficiary Name)
              </label>
              <input
                type="text"
                value={newBankBeneficiary}
                onChange={(e) => setNewBankBeneficiary(e.target.value)}
                placeholder="الاسم الإنجليزي المطابق لحساب الشركة البنكي في الصين"
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>
                  اسم البنك الصيني (Bank Name)
                </label>
                <input
                  type="text"
                  value={newBankName}
                  onChange={(e) => setNewBankName(e.target.value)}
                  placeholder="مثال: Bank of China, Liangshan Branch"
                  style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>
                  سويفت كود (SWIFT Code / BIC)
                </label>
                <input
                  type="text"
                  value={newBankSwift}
                  onChange={(e) => setNewBankSwift(e.target.value)}
                  placeholder="مثال: BKCHCNBJ110"
                  style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px' }}
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>
                رقم الحساب البنكي / الآيبان (Account / IBAN)
              </label>
              <input
                type="text"
                value={newBankAccount}
                onChange={(e) => setNewBankAccount(e.target.value)}
                placeholder="رقم الحساب البنكي المعتمد للتحويلات الدولية USD/EUR"
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px' }}
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
              ملاحظات فنية وتشغيلية (المهندس المسؤول / التخصص / شروط الشحن)
            </label>
            <textarea
              rows={2}
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              placeholder="مثال: مصنع متخصص في تصنيع محاور المقطورات وجنازير الصدر، شروط التسليم FOB Qingdao..."
              style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setIsNewSupplierModalOpen(false)}
              style={{ padding: '8px 16px', backgroundColor: '#f1f5f9', border: 'none', borderRadius: 6, fontSize: '12.5px', fontWeight: 600, color: '#475569', cursor: 'pointer' }}
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={createChinaSupplierMutation.isPending}
              style={{ padding: '8px 22px', backgroundColor: '#170e5e', border: 'none', borderRadius: 6, fontSize: '12.5px', fontWeight: 700, color: '#ffffff', cursor: 'pointer' }}
            >
              {createChinaSupplierMutation.isPending ? 'جاري الحفظ...' : 'حفظ المصنع وتوثيقه'}
            </button>
          </div>
        </form>
      </StandardDialog>

      {/* Sourcing Trip Modal */}
      <StandardDialog
        open={isTripModalOpen}
        onClose={() => setIsTripModalOpen(false)}
        title="تسجيل رحلة عمل وزيارة مصانع بالصين"
        subtitle="توثيق زيارات معارض الصين (كانتون فير / إيوو) وحساب ميزانية السفر والمصروفات"
        width="600px"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await createTripMutation.mutateAsync({
                title: tripTitle,
                destination: tripDestination,
                startDate: tripStartDate,
                endDate: tripEndDate || undefined,
                budgetEgp: Number(tripBudgetEgp),
                objectives: tripObjectives,
              });
              toast.success('تم تسجيل رحلة المصانع بنجاح');
              setIsTripModalOpen(false);
              setTripTitle('');
              refetchTrips();
            } catch (err: any) {
              toast.error('فشل حفظ الرحلة: ' + (err.message || 'خطأ غير معروف'));
            }
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
              عنوان الرحلة أو المعرض
            </label>
            <input
              type="text"
              required
              value={tripTitle}
              onChange={(e) => setTripTitle(e.target.value)}
              placeholder="مثال: زيارة معرض كانتون فير دورة الخريف 2026 - قوانغتشو"
              style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
                المدينة / الوجهة
              </label>
              <input
                type="text"
                required
                value={tripDestination}
                onChange={(e) => setTripDestination(e.target.value)}
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
                الميزانية المقدرة (ج.م)
              </label>
              <input
                type="number"
                value={tripBudgetEgp}
                onChange={(e) => setTripBudgetEgp(Number(e.target.value))}
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
                تاريخ السفر والبدء
              </label>
              <input
                type="date"
                required
                value={tripStartDate}
                onChange={(e) => setTripStartDate(e.target.value)}
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
                تاريخ العودة المتوقع
              </label>
              <input
                type="date"
                value={tripEndDate}
                onChange={(e) => setTripEndDate(e.target.value)}
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
              أهداف الرحلة والأصناف المستهدفة
            </label>
            <textarea
              rows={3}
              value={tripObjectives}
              onChange={(e) => setTripObjectives(e.target.value)}
              placeholder="مثال: فحص خطوط إنتاج أدوات المطبخ والتعاقد على 3 حاويات للأصناف الجديدة..."
              style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button
              type="button"
              onClick={() => setIsTripModalOpen(false)}
              style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={createTripMutation.isPending}
              style={{ padding: '8px 18px', borderRadius: 6, border: 'none', backgroundColor: '#170e5e', color: '#ffffff', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' }}
            >
              {createTripMutation.isPending ? 'جاري الحفظ...' : 'حفظ الرحلة'}
            </button>
          </div>
        </form>
      </StandardDialog>

      {/* 5. Sourcing Metadata Dialog */}
      <StandardDialog
        open={Boolean(selectedSupplier)}
        onClose={() => setSelectedSupplier(null)}
        title={`توثيق بيانات المصنع الصيني والحساب البنكي: ${selectedSupplier?.name || ''}`}
        subtitle="توثيق الحسابات البنكية الرسمية المعتمدة لحماية الحوالات الخارجية من الاحتيال"
        width="650px"
      >
        <form onSubmit={handleSaveMeta} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
                الاسم الصيني للمصنع (Chinese Company Name)
              </label>
              <input
                type="text"
                value={chineseName}
                onChange={(e) => setChineseName(e.target.value)}
                placeholder="مثال: 广州智能科技有限公司"
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
                المدينة والمقاطعة
              </label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="مثال: Shenzhen, Guangdong"
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
                الحد الأدنى للطلب MOQ
              </label>
              <input
                type="text"
                value={moq}
                onChange={(e) => setMoq(e.target.value)}
                placeholder="مثال: 500 قطعة لكل لون"
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
                مدة التصنيع والتجهيز (بالأيام)
              </label>
              <input
                type="number"
                value={leadTime}
                onChange={(e) => setLeadTime(Number(e.target.value))}
                style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
          </div>

          {/* Bank Verified Details Box */}
          <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: '12px', fontWeight: 800, color: '#170e5e' }}>
              الحساب البنكي الموثق للحوالات الدولية (Verified Bank Account)
            </div>

            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>اسم المستفيد (Beneficiary Name)</label>
              <input
                type="text"
                value={bankBeneficiary}
                onChange={(e) => setBankBeneficiary(e.target.value)}
                placeholder="اسم الشركة المطابق للسجل التجاري الصيني"
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>اسم البنك (Bank Name)</label>
                <input
                  type="text"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="مثال: Bank of China"
                  style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>سويفت كود (SWIFT Code)</label>
                <input
                  type="text"
                  value={bankSwift}
                  onChange={(e) => setBankSwift(e.target.value)}
                  placeholder="مثال: BKCHCNBJ110"
                  style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px' }}
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>رقم الحساب / الآيبان (Account / IBAN)</label>
              <input
                type="text"
                value={bankIban}
                onChange={(e) => setBankIban(e.target.value)}
                placeholder="رقم الحساب البنكي المعتمد"
                style={{ width: '100%', height: 34, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px' }}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
              ملاحظات المورد والتعامل
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="شروط التسليم، شهادات الجودة، وكيل الشحن المحلي..."
              style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12px' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
            <button
              type="button"
              onClick={() => setSelectedSupplier(null)}
              style={{ padding: '8px 16px', backgroundColor: '#f1f5f9', border: 'none', borderRadius: 6, fontSize: '12.5px', fontWeight: 600, color: '#475569', cursor: 'pointer' }}
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={upsertSupplierMetaMutation.isPending}
              style={{ padding: '8px 20px', backgroundColor: '#170e5e', border: 'none', borderRadius: 6, fontSize: '12.5px', fontWeight: 700, color: '#ffffff', cursor: 'pointer' }}
            >
              {upsertSupplierMetaMutation.isPending ? 'جاري الحفظ...' : 'حفظ وتوثيق المصنع'}
            </button>
          </div>
        </form>
      </StandardDialog>

      {/* 6. QC Inspection Dialog */}
      <StandardDialog
        open={isQcModalOpen}
        onClose={() => setIsQcModalOpen(false)}
        title="تسجيل تقرير فحص جودة جديد (New QC Inspection)"
        subtitle="فحص العينات في الصين ومطابقة المواصفات قبل شحن الحاوية"
        width="600px"
      >
        <form onSubmit={handleCreateQc} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>مرحلة الفحص</label>
              <select
                value={qcStage}
                onChange={(e) => setQcStage(e.target.value)}
                style={{ width: '100%', height: 36, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              >
                <option value="raw_material">فحص المواد الخام</option>
                <option value="during_production">أثناء الإنتاج (DUPRO)</option>
                <option value="pre_shipment">قبل الشحن (Pre-Shipment)</option>
                <option value="container_loading">أثناء تحميل الحاوية (CLC)</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>تاريخ الفحص</label>
              <input
                type="date"
                required
                value={qcDate}
                onChange={(e) => setQcDate(e.target.value)}
                style={{ width: '100%', height: 36, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>المفتش / وكيل الجودة</label>
              <input
                type="text"
                value={qcInspector}
                onChange={(e) => setQcInspector(e.target.value)}
                placeholder="اسم المفتش أو شركة الفحص"
                style={{ width: '100%', height: 36, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>حجم العينة المفحوصة (قطعة)</label>
              <input
                type="number"
                value={qcSampleSize}
                onChange={(e) => setQcSampleSize(Number(e.target.value))}
                style={{ width: '100%', height: 36, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>القطع المقبولة</label>
              <input
                type="number"
                value={qcPassedQty}
                onChange={(e) => setQcPassedQty(Number(e.target.value))}
                style={{ width: '100%', height: 36, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>القطع المرفوعة / المعيبة</label>
              <input
                type="number"
                value={qcFailedQty}
                onChange={(e) => setQcFailedQty(Number(e.target.value))}
                style={{ width: '100%', height: 36, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>القرار النهائي للفحص</label>
            <select
              value={qcStatus}
              onChange={(e) => setQcStatus(e.target.value)}
              style={{ width: '100%', height: 36, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            >
              <option value="passed">معتمد ومطابق للشحن (Passed)</option>
              <option value="conditional">معتمد بشروط / إعادة تعبئة (Conditional)</option>
              <option value="rejected">مرفوض تماماً / إعادة تصنيع (Rejected)</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>ملاحظات العيوب والاختبارات</label>
            <textarea
              rows={3}
              value={qcDefectNotes}
              onChange={(e) => setQcDefectNotes(e.target.value)}
              placeholder="تفاصيل العيوب الملاحظة، اختلاف الألوان، مطابقة الأوزان والأبعاد..."
              style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
            <button
              type="button"
              onClick={() => setIsQcModalOpen(false)}
              style={{ padding: '8px 16px', backgroundColor: '#f1f5f9', border: 'none', borderRadius: 6, fontSize: '12.5px', fontWeight: 600, color: '#475569', cursor: 'pointer' }}
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={createQcMutation.isPending}
              style={{ padding: '8px 20px', backgroundColor: '#170e5e', border: 'none', borderRadius: 6, fontSize: '12.5px', fontWeight: 700, color: '#ffffff', cursor: 'pointer' }}
            >
              {createQcMutation.isPending ? 'جاري الحفظ...' : 'حفظ تقرير الفحص'}
            </button>
          </div>
        </form>
      </StandardDialog>
      </main>
    </div>
  );
}
