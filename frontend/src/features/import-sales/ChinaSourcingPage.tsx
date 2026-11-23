import { useState } from 'react';
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
import { toast } from '@/shared/components/system-alert';
import { todayLocalDateKey } from '@/lib/format';
import { ChinaSourcingHeader } from './china-sourcing-page/china-sourcing-header';
import { ChinaSourcingTabs } from './china-sourcing-page/china-sourcing-tabs';
import { ChinaSourcingTabShortcuts } from './china-sourcing-page/china-sourcing-tab-shortcuts';
import { ChinaSourcingTripsTab } from './china-sourcing-page/china-sourcing-trips-tab';
import { ChinaSourcingFactoriesTab } from './china-sourcing-page/china-sourcing-factories-tab';
import { ChinaSourcingQcTab } from './china-sourcing-page/china-sourcing-qc-tab';
import { ChinaSourcingNewFactoryModal } from './china-sourcing-page/china-sourcing-new-factory-modal';
import { ChinaSourcingTripModal } from './china-sourcing-page/china-sourcing-trip-modal';
import { ChinaSourcingMetadataDialog } from './china-sourcing-page/china-sourcing-metadata-dialog';
import { ChinaSourcingQcDialog } from './china-sourcing-page/china-sourcing-qc-dialog';

export default function ChinaSourcingPage() {
  const { data: suppliers = [], isLoading: isSuppliersLoading, refetch } = useChinaSuppliersQuery();
  const { data: qcInspections = [], isLoading: isQcLoading, refetch: refetchQc } = useQcInspectionsQuery();
  const upsertSupplierMetaMutation = useUpsertSupplierMetaMutation('');
  const createQcMutation = useCreateQcInspectionMutation();

  const [activeTab, setActiveTab] = useState<'factories' | 'quotations' | 'samples' | 'proformas' | 'qc' | 'trips'>('factories');
  const { data: sourcingTrips = [], isLoading: isTripsLoading, refetch: refetchTrips } = useSourcingTripsQuery();
  const createTripMutation = useCreateSourcingTripMutation();
  const [isTripModalOpen, setIsTripModalOpen] = useState(false);
  const [tripTitle, setTripTitle] = useState('');
  const [tripDestination, setTripDestination] = useState('Guangzhou / Yiwu, China');
  const [tripStartDate, setTripStartDate] = useState(todayLocalDateKey());
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
  const [qcDate, setQcDate] = useState(todayLocalDateKey());
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
    { key: 'factories', label: `دليل المصانع والحسابات الموثقة (${isSuppliersLoading ? '…' : suppliers.length})` },
    { key: 'quotations', label: 'مقارنة عروض الأسعار (RFQ)' },
    { key: 'samples', label: 'العينات والاعتماد المرجعي' },
    { key: 'proformas', label: 'الفواتير المبدئية وأوامر الشراء (PI / PO)' },
    { key: 'qc', label: `تقارير فحص الجودة (${isQcLoading ? '…' : qcInspections.length})` },
    { key: 'trips', label: `رحلات الصين والمعارض (${isTripsLoading ? '…' : sourcingTrips.length})` },
  ];

  return (
    <div className="page-stack page-shell import-sales-page" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '80px', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
        <ChinaSourcingHeader
          setIsNewSupplierModalOpen={setIsNewSupplierModalOpen}
          setIsQcModalOpen={setIsQcModalOpen}
        />

        <ChinaSourcingTabs
          tabItems={tabItems}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
        />

      <ChinaSourcingTabShortcuts
        activeTab={activeTab}
      />

      <ChinaSourcingTripsTab
        activeTab={activeTab}
        isTripsLoading={isTripsLoading}
        sourcingTrips={sourcingTrips}
        setIsTripModalOpen={setIsTripModalOpen}
      />

      <ChinaSourcingFactoriesTab
        activeTab={activeTab}
        search={search}
        setSearch={setSearch}
        refetch={refetch}
        setIsNewSupplierModalOpen={setIsNewSupplierModalOpen}
        isSuppliersLoading={isSuppliersLoading}
        filteredSuppliers={filteredSuppliers}
        openMetaModal={openMetaModal}
      />

      <ChinaSourcingQcTab
        activeTab={activeTab}
        isQcLoading={isQcLoading}
        qcInspections={qcInspections}
        refetchQc={refetchQc}
      />

      <ChinaSourcingNewFactoryModal
        isNewSupplierModalOpen={isNewSupplierModalOpen}
        setIsNewSupplierModalOpen={setIsNewSupplierModalOpen}
        handleCreateNewSupplier={handleCreateNewSupplier}
        newSupplierName={newSupplierName}
        setNewSupplierName={setNewSupplierName}
        newChineseName={newChineseName}
        setNewChineseName={setNewChineseName}
        newCity={newCity}
        setNewCity={setNewCity}
        newProvince={newProvince}
        setNewProvince={setNewProvince}
        newPhone={newPhone}
        setNewPhone={setNewPhone}
        newAddress={newAddress}
        setNewAddress={setNewAddress}
        newMoq={newMoq}
        setNewMoq={setNewMoq}
        newLeadTime={newLeadTime}
        setNewLeadTime={setNewLeadTime}
        newBankBeneficiary={newBankBeneficiary}
        setNewBankBeneficiary={setNewBankBeneficiary}
        newBankName={newBankName}
        setNewBankName={setNewBankName}
        newBankSwift={newBankSwift}
        setNewBankSwift={setNewBankSwift}
        newBankAccount={newBankAccount}
        setNewBankAccount={setNewBankAccount}
        newNotes={newNotes}
        setNewNotes={setNewNotes}
        createChinaSupplierMutation={createChinaSupplierMutation}
      />

      <ChinaSourcingTripModal
        isTripModalOpen={isTripModalOpen}
        setIsTripModalOpen={setIsTripModalOpen}
        createTripMutation={createTripMutation}
        tripTitle={tripTitle}
        tripDestination={tripDestination}
        tripStartDate={tripStartDate}
        tripEndDate={tripEndDate}
        tripBudgetEgp={tripBudgetEgp}
        tripObjectives={tripObjectives}
        setTripTitle={setTripTitle}
        refetchTrips={refetchTrips}
        setTripDestination={setTripDestination}
        setTripBudgetEgp={setTripBudgetEgp}
        setTripStartDate={setTripStartDate}
        setTripEndDate={setTripEndDate}
        setTripObjectives={setTripObjectives}
      />

      <ChinaSourcingMetadataDialog
        selectedSupplier={selectedSupplier}
        setSelectedSupplier={setSelectedSupplier}
        handleSaveMeta={handleSaveMeta}
        chineseName={chineseName}
        setChineseName={setChineseName}
        city={city}
        setCity={setCity}
        moq={moq}
        setMoq={setMoq}
        leadTime={leadTime}
        setLeadTime={setLeadTime}
        bankBeneficiary={bankBeneficiary}
        setBankBeneficiary={setBankBeneficiary}
        bankName={bankName}
        setBankName={setBankName}
        bankSwift={bankSwift}
        setBankSwift={setBankSwift}
        bankIban={bankIban}
        setBankIban={setBankIban}
        notes={notes}
        setNotes={setNotes}
        upsertSupplierMetaMutation={upsertSupplierMetaMutation}
      />

      <ChinaSourcingQcDialog
        isQcModalOpen={isQcModalOpen}
        setIsQcModalOpen={setIsQcModalOpen}
        handleCreateQc={handleCreateQc}
        qcStage={qcStage}
        setQcStage={setQcStage}
        qcDate={qcDate}
        setQcDate={setQcDate}
        qcInspector={qcInspector}
        setQcInspector={setQcInspector}
        qcSampleSize={qcSampleSize}
        setQcSampleSize={setQcSampleSize}
        qcPassedQty={qcPassedQty}
        setQcPassedQty={setQcPassedQty}
        qcFailedQty={qcFailedQty}
        setQcFailedQty={setQcFailedQty}
        qcStatus={qcStatus}
        setQcStatus={setQcStatus}
        qcDefectNotes={qcDefectNotes}
        setQcDefectNotes={setQcDefectNotes}
        createQcMutation={createQcMutation}
      />
      </main>
    </div>
  );
}
