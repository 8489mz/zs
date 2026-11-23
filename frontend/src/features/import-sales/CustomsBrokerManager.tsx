import { useState } from 'react';
import {
  useCustomsBrokersQuery,
  useCreateCustomsBrokerMutation,
  useDisburseBrokerAdvanceMutation,
  useLiquidateBrokerExpenseMutation,
  useVerifyBrokerExpenseMutation,
  useCustomsBrokerStatementQuery,
  useShipmentsQuery,
  useImportProjectsQuery,
  CustomsBroker,
} from './api/shipments.api';
import { todayLocalDateKey } from '@/lib/format';
import { toast } from '@/shared/components/system-alert';
import { useQuery } from '@tanstack/react-query';
import { http } from '@/lib/http';
import { isCashBankAccount } from '@/features/accounting';
import { CustomsBrokerHeader } from './customs-broker-manager/customs-broker-header';
import { CustomsBrokerSummary } from './customs-broker-manager/customs-broker-summary';
import { CustomsBrokerTable } from './customs-broker-manager/customs-broker-table';
import { CustomsBrokerCreateDialog } from './customs-broker-manager/customs-broker-create-dialog';
import { CustomsBrokerDisburseDialog } from './customs-broker-manager/customs-broker-disburse-dialog';
import { CustomsBrokerLiquidateDialog } from './customs-broker-manager/customs-broker-liquidate-dialog';
import { CustomsBrokerStatementDialog } from './customs-broker-manager/customs-broker-statement-dialog';

export function CustomsBrokerManager() {
  const { data: brokers = [], refetch } = useCustomsBrokersQuery();
  const createBrokerMutation = useCreateCustomsBrokerMutation();
  const disburseAdvanceMutation = useDisburseBrokerAdvanceMutation();
  const liquidateExpenseMutation = useLiquidateBrokerExpenseMutation();
  const verifyExpenseMutation = useVerifyBrokerExpenseMutation();

  // Broker-expense verification state (maker-checker: the
  // verifier must differ from the liquidator; the token is
  // minted in the approvals screen).
  const [verifyExpenseId, setVerifyExpenseId] = useState('');
  const [verifyTokenId, setVerifyTokenId] = useState('');

  // Modals
  const [isCreateBrokerOpen, setIsCreateBrokerOpen] = useState(false);
  const [isDisburseOpen, setIsDisburseOpen] = useState(false);
  const [isLiquidateOpen, setIsLiquidateOpen] = useState(false);
  const [selectedBrokerForStatement, setSelectedBrokerForStatement] = useState<CustomsBroker | null>(null);

  // Create Broker State
  const [brokerName, setBrokerName] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [portName, setPortName] = useState('Alexandria');
  const [brokerNotes, setBrokerNotes] = useState('');

  // Disburse Advance State
  const [selectedBrokerId, setSelectedBrokerId] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedShipmentId, setSelectedShipmentId] = useState('');
  const [advanceNo, setAdvanceNo] = useState('');
  const [advanceAmountEgp, setAdvanceAmountEgp] = useState<number | string>('');
  const [treasuryAccountId, setTreasuryAccountId] = useState('');
  const [advanceNotes, setAdvanceNotes] = useState('');

  // Liquidate Expense State
  const [selectedAdvanceId, setSelectedAdvanceId] = useState('');
  const [liquidateReceiptNo, setLiquidateReceiptNo] = useState('');
  const [liquidateCategory, setLiquidateCategory] = useState('customs_duty');
  const [liquidateAmountEgp, setLiquidateAmountEgp] = useState<number | string>('');
  const [isCapitalized, setIsCapitalized] = useState(true);
  const [isRefundableVat, setIsRefundableVat] = useState(false);
  const [liquidateNotes, setLiquidateNotes] = useState('');

  // Fetch Projects and Shipments
  const { data: projectsData } = useImportProjectsQuery();
  const projects: any[] = Array.isArray(projectsData)
    ? projectsData
    : (projectsData as any)?.rows || (projectsData as any)?.items || [];

  const { data: shipmentsData } = useShipmentsQuery();
  const shipments: any[] = Array.isArray(shipmentsData)
    ? shipmentsData
    : (shipmentsData as any)?.rows || (shipmentsData as any)?.items || [];

  // Fetch treasury accounts
  const { data: accountsData } = useQuery({
    queryKey: ['accounts-list'],
    queryFn: () => http<any>('/api/accounting/accounts').catch(() => ({ accounts: [] })),
  });
  // INV-IMPORT-ISCASHBANK-SWEEP (I5): cash/bank accounts only. The old
  // current_assets accountGroup arm offered ONLY the three
  // parent accounts (1100/1160/1170), which the backend bank role
  // rejects (is_cash_bank false) — and the `a.isCashBank` arm never
  // matched, because the flag lives under `flags`, not top-level.
  const treasuryAccounts = (accountsData?.accounts || (Array.isArray(accountsData) ? accountsData : [])).filter(
    (a: any) => isCashBankAccount(a),
  );

  const { data: brokerStatement, isLoading: isStatementLoading, refetch: refetchStatement } = useCustomsBrokerStatementQuery(
    selectedBrokerForStatement?.id || ''
  );

  const { data: liquidateBrokerStatement } = useCustomsBrokerStatementQuery(
    isLiquidateOpen && selectedBrokerId ? selectedBrokerId : ''
  );
  const activeBrokerAdvances = (liquidateBrokerStatement?.advances || []).filter(
    (a: any) => a.status !== 'settled' && Number(a.remaining_amount_egp || 0) > 0
  );

  const handleCreateBroker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brokerName.trim()) {
      toast.error('اسم المخلص مطلوب');
      return;
    }
    try {
      await createBrokerMutation.mutateAsync({
        name: brokerName.trim(),
        licenseNumber: licenseNumber || undefined,
        phone: phone || undefined,
        portName,
        notes: brokerNotes || undefined,
      });
      toast.success('تم تسجيل المخلص الجمركي بنجاح');
      setIsCreateBrokerOpen(false);
      setBrokerName('');
      setLicenseNumber('');
      setPhone('');
      refetch();
    } catch (err: any) {
      toast.error('فشل تسجيل المخلص: ' + (err.message || 'خطأ'));
    }
  };

  const handleDisburseAdvance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBrokerId) {
      toast.error('يرجى اختيار المخلص الجمركي');
      return;
    }
    if (Number(advanceAmountEgp) <= 0) {
      toast.error('مبلغ العهدة يجب أن يكون أكبر من صفر');
      return;
    }
    try {
      const generatedAdvanceNo =
        advanceNo.trim() ||
        `ADV-${todayLocalDateKey().slice(2).replace(/-/g, '')}-${String(Math.floor(1000 + Math.random() * 9000))}`;
      await disburseAdvanceMutation.mutateAsync({
        brokerId: selectedBrokerId,
        projectId: selectedProjectId || undefined,
        shipmentId: selectedShipmentId || undefined,
        advanceNo: generatedAdvanceNo,
        amountEgp: Number(advanceAmountEgp),
        treasuryAccountId: treasuryAccountId || undefined,
        notes: advanceNotes || undefined,
      });
      toast.success('تم صرف وقيد عهدة التخليص الجمركي بنجاح');
      setIsDisburseOpen(false);
      setAdvanceNo('');
      refetch();
      if (selectedBrokerForStatement) refetchStatement();
    } catch (err: any) {
      toast.error('فشل صرف العهدة: ' + (err.message || 'خطأ'));
    }
  };

  const handleLiquidateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBrokerId) {
      toast.error('يرجى اختيار المخلص الجمركي');
      return;
    }
    const targetAdvanceId = selectedAdvanceId || activeBrokerAdvances[0]?.id || '';
    if (!targetAdvanceId) {
      toast.error('يرجى اختيار عهدة فعالة للمخلص الجمركي لتسوية المصروف منها');
      return;
    }
    if (!liquidateReceiptNo.trim()) {
      toast.error('رقم الإيصال / الفاتورة مطلوب');
      return;
    }
    if (Number(liquidateAmountEgp) <= 0) {
      toast.error('مبلغ التصفية يجب أن يكون أكبر من صفر');
      return;
    }
    // A capitalised settlement with no linked shipment has nowhere
    // to capitalise: the backend fails it closed. Surface the
    // requirement here instead of a bare server error.
    const targetAdvance = activeBrokerAdvances.find((a: any) => a.id === targetAdvanceId);
    if ((isRefundableVat ? false : isCapitalized) && !selectedShipmentId && !targetAdvance?.shipment_id) {
      toast.error('التسوية المرسملة تتطلب شحنة مرتبطة: اختر شحنة أو عهدة مرتبطة بشحنة');
      return;
    }
    try {
      // INV-IMPORT-BROKER-ADVANCE-ACCOUNT: the toast reads the
      // posted state off the settlement response itself
      // (capitalization_state) — one source of truth with the
      // ledger. A revalued/expensed/VAT settlement already posted
      // its journal, so it must never claim to await a second
      // approval; a folded settlement posts no journal yet (the
      // cost enters the GL at receipt). The separate maker-checker
      // verification stays visible per expense in the statement
      // table ("بانتظار التحقق") — it is not the settlement state.
      const settled: any = await liquidateExpenseMutation.mutateAsync({
        brokerId: selectedBrokerId,
        advanceId: targetAdvanceId,
        projectId: selectedProjectId || undefined,
        shipmentId: selectedShipmentId || undefined,
        receiptNo: liquidateReceiptNo.trim(),
        category: liquidateCategory,
        amountEgp: Number(liquidateAmountEgp),
        isCapitalized: isRefundableVat ? false : isCapitalized,
        isRefundableVat,
        notes: liquidateNotes || undefined,
      });
      const settlementState = settled?.capitalization_state ?? settled?.data?.capitalization_state;
      toast.success(
        settlementState === 'revalued'
          ? 'تمت تسوية المصروف وترحيل قيدها (مخزون / عهدة المخلص)'
          : settlementState === 'vat_asset' || settlementState === 'expensed' || isRefundableVat || !isCapitalized
            ? 'تمت تصفية المصروف وقيده وخصمه من رصيد العهدة'
            : 'تمت تسوية المصروف وسُجلت رسملته (تدخل التكلفة عند الاستلام)'
      );
      setIsLiquidateOpen(false);
      setLiquidateReceiptNo('');
      refetch();
      if (selectedBrokerForStatement) refetchStatement();
    } catch (err: any) {
      toast.error('فشل تصفية المصروف: ' + (err.message || 'خطأ'));
    }
  };

  const handleVerifyExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyExpenseId) {
      toast.error('يرجى اختيار إيصال غير متحقق منه');
      return;
    }
    if (!verifyTokenId.trim()) {
      toast.error('معرف طلب الاعتماد المعتمد إلزامي للتحقق');
      return;
    }
    try {
      await verifyExpenseMutation.mutateAsync({ expenseId: verifyExpenseId, approvalRequestId: verifyTokenId.trim() });
      toast.success('تم التحقق من مصروف المخلص بموافقة ثانية');
      setVerifyTokenId('');
      setVerifyExpenseId('');
      if (selectedBrokerForStatement) refetchStatement();
    } catch (err: any) {
      toast.error('فشل التحقق: ' + (err.message || 'خطأ'));
    }
  };

  const totalUnliquidatedAll = brokers.reduce((sum: number, b: any) => sum + Number(b.unliquidated_balance_egp || 0), 0);

  return (
    <div className="page-stack page-shell import-sales-page" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '80px', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
        <CustomsBrokerHeader
          setIsCreateBrokerOpen={setIsCreateBrokerOpen}
          setIsDisburseOpen={setIsDisburseOpen}
          setIsLiquidateOpen={setIsLiquidateOpen}
        />

        <CustomsBrokerSummary
          totalUnliquidatedAll={totalUnliquidatedAll}
          brokers={brokers}
        />

      <CustomsBrokerTable
        brokers={brokers}
        setSelectedBrokerForStatement={setSelectedBrokerForStatement}
      />

      <CustomsBrokerCreateDialog
        isCreateBrokerOpen={isCreateBrokerOpen}
        setIsCreateBrokerOpen={setIsCreateBrokerOpen}
        handleCreateBroker={handleCreateBroker}
        brokerName={brokerName}
        setBrokerName={setBrokerName}
        licenseNumber={licenseNumber}
        setLicenseNumber={setLicenseNumber}
        portName={portName}
        setPortName={setPortName}
        phone={phone}
        setPhone={setPhone}
        brokerNotes={brokerNotes}
        setBrokerNotes={setBrokerNotes}
      />

      <CustomsBrokerDisburseDialog
        isDisburseOpen={isDisburseOpen}
        setIsDisburseOpen={setIsDisburseOpen}
        handleDisburseAdvance={handleDisburseAdvance}
        selectedBrokerId={selectedBrokerId}
        setSelectedBrokerId={setSelectedBrokerId}
        brokers={brokers}
        selectedProjectId={selectedProjectId}
        setSelectedProjectId={setSelectedProjectId}
        projects={projects}
        selectedShipmentId={selectedShipmentId}
        setSelectedShipmentId={setSelectedShipmentId}
        shipments={shipments}
        advanceAmountEgp={advanceAmountEgp}
        setAdvanceAmountEgp={setAdvanceAmountEgp}
        treasuryAccountId={treasuryAccountId}
        setTreasuryAccountId={setTreasuryAccountId}
        treasuryAccounts={treasuryAccounts}
        advanceNo={advanceNo}
        setAdvanceNo={setAdvanceNo}
        advanceNotes={advanceNotes}
        setAdvanceNotes={setAdvanceNotes}
      />

      <CustomsBrokerLiquidateDialog
        isLiquidateOpen={isLiquidateOpen}
        setIsLiquidateOpen={setIsLiquidateOpen}
        handleLiquidateExpense={handleLiquidateExpense}
        selectedBrokerId={selectedBrokerId}
        setSelectedBrokerId={setSelectedBrokerId}
        setSelectedAdvanceId={setSelectedAdvanceId}
        brokers={brokers}
        selectedAdvanceId={selectedAdvanceId}
        activeBrokerAdvances={activeBrokerAdvances}
        liquidateCategory={liquidateCategory}
        setLiquidateCategory={setLiquidateCategory}
        setIsRefundableVat={setIsRefundableVat}
        liquidateReceiptNo={liquidateReceiptNo}
        setLiquidateReceiptNo={setLiquidateReceiptNo}
        liquidateAmountEgp={liquidateAmountEgp}
        setLiquidateAmountEgp={setLiquidateAmountEgp}
        isCapitalized={isCapitalized}
        isRefundableVat={isRefundableVat}
        setIsCapitalized={setIsCapitalized}
        liquidateNotes={liquidateNotes}
        setLiquidateNotes={setLiquidateNotes}
      />

      <CustomsBrokerStatementDialog
        selectedBrokerForStatement={selectedBrokerForStatement}
        setSelectedBrokerForStatement={setSelectedBrokerForStatement}
        isStatementLoading={isStatementLoading}
        brokerStatement={brokerStatement}
        handleVerifyExpense={handleVerifyExpense}
        verifyExpenseId={verifyExpenseId}
        setVerifyExpenseId={setVerifyExpenseId}
        verifyTokenId={verifyTokenId}
        setVerifyTokenId={setVerifyTokenId}
        verifyExpenseMutation={verifyExpenseMutation}
      />
      </main>
    </div>
  );
}

export default CustomsBrokerManager;
