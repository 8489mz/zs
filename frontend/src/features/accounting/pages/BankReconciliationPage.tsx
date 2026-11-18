import { useTranslation } from 'react-i18next';
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { XIcon, PlusIcon } from '@/shared/components/icons/AppIcons';
import { PageHeader } from '@/shared/components/page-header';
import {
  bankReconciliationApi,
  accountingApi,
  type BankStatementLine,
} from '@/features/accounting/api/accounting.api';
import { BankStatementsListTable } from '../components/bank-reconciliation/BankStatementsListTable';
import { ReconciliationSummaryHeader } from '../components/bank-reconciliation/ReconciliationSummaryHeader';
import { ReconciliationDualLedger } from '../components/bank-reconciliation/ReconciliationDualLedger';
import { CreateBankStatementModal } from '../components/bank-reconciliation/CreateBankStatementModal';
import { BankFeeAdjustmentModal } from '../components/bank-reconciliation/BankFeeAdjustmentModal';
import { TreasuryNavTabs } from '@/features/treasury';
import { todayLocalDateKey } from '@/lib/format';

export function BankReconciliationPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [selectedStatementId, setSelectedStatementId] = useState<number | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isFeeModalOpen, setIsFeeModalOpen] = useState(false);
  const [feeTargetLine, setFeeTargetLine] = useState<BankStatementLine | null>(null);
  const [selectedExpenseAccountId, setSelectedExpenseAccountId] = useState<number>(0);
  const [statementFilterStatus, setStatementFilterStatus] = useState<'all' | 'pending' | 'reconciled'>('all');
  const [glFilterText, setGlFilterText] = useState('');
  const [selectedStatementLineId, setSelectedStatementLineId] = useState<number | null>(null);
  const [selectedGlLineId, setSelectedGlLineId] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');

  // Fetch Accounts
  const accountsQuery = useQuery({
    queryKey: ['accounting-accounts'],
    queryFn: accountingApi.accounts,
  });

  const accounts = useMemo(() => {
    const raw = accountsQuery.data?.accounts || [];
    return Array.isArray(raw) ? raw : [];
  }, [accountsQuery.data]);

  const bankAccounts = useMemo(() => {
    return accounts.filter((a: any) => a.flags?.isCashBank || a.accountGroup === 'current_assets' || a.accountType === 'asset');
  }, [accounts]);

  const expenseAccounts = useMemo(() => {
    return accounts.filter((a: any) => a.accountType === 'expense');
  }, [accounts]);

  // Fetch Statements List
  const statementsQuery = useQuery({
    queryKey: ['bank-statements'],
    queryFn: () => bankReconciliationApi.listStatements(),
  });

  // Fetch Active Workspace
  const workspaceQuery = useQuery({
    queryKey: ['bank-reconciliation-workspace', selectedStatementId],
    queryFn: () => bankReconciliationApi.getWorkspace(selectedStatementId!),
    enabled: selectedStatementId !== null,
  });

  // Reconcile Match Mutation
  const matchMutation = useMutation({
    mutationFn: (data: { statementLineId: number; journalLineId: number }) =>
      bankReconciliationApi.reconcileMatch(data),
    onSuccess: () => {
      setSelectedStatementLineId(null);
      setSelectedGlLineId(null);
      setStatusMessage('تمت مطابقة السطر البنكي مع القيد المحاسبي بنجاح.');
      void queryClient.invalidateQueries({ queryKey: ['bank-reconciliation-workspace', selectedStatementId] });
      void queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
    },
    onError: (err: any) => {
      setStatusMessage(err?.message || 'تعذر إجراء المطابقة');
    },
  });

  // Unreconcile Match Mutation
  const unmatchMutation = useMutation({
    mutationFn: (statementLineId: number) => bankReconciliationApi.unreconcileMatch(statementLineId),
    onSuccess: () => {
      setStatusMessage('تم إلغاء المطابقة وإعادة السطر للحركات المعلقة.');
      void queryClient.invalidateQueries({ queryKey: ['bank-reconciliation-workspace', selectedStatementId] });
      void queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
    },
  });

  // Fee Adjustment Mutation
  const feeAdjustmentMutation = useMutation({
    mutationFn: (data: { statementLineId: number; expenseAccountId: number; description?: string }) =>
      bankReconciliationApi.createFeeAdjustment(data),
    onSuccess: () => {
      setIsFeeModalOpen(false);
      setFeeTargetLine(null);
      setStatusMessage('تم إنشاء قيد المصاريف البنكية ومطابقته فورياً بنجاح.');
      void queryClient.invalidateQueries({ queryKey: ['bank-reconciliation-workspace', selectedStatementId] });
      void queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
    },
    onError: (err: any) => {
      setStatusMessage(err?.message || 'تعذر إنشاء قيد المصاريف البنكية');
    },
  });

  // Form state for creating a statement
  const [newStmtAccountId, setNewStmtAccountId] = useState<number>(0);
  const [newStmtNo, setNewStmtNo] = useState('');
  const [newStmtDate, setNewStmtDate] = useState(todayLocalDateKey());
  const [newStmtStartBal, setNewStmtStartBal] = useState<number>(0);
  const [newStmtEndBal, setNewStmtEndBal] = useState<number>(0);
  const [newStmtNotes, setNewStmtNotes] = useState('');
  const [newStmtLines, setNewStmtLines] = useState<Array<{ lineDate: string; description: string; reference: string; amount: number }>>([]);

  const createStatementMutation = useMutation({
    mutationFn: (data: any) => bankReconciliationApi.createStatement(data),
    onSuccess: (res) => {
      setIsCreateModalOpen(false);
      setStatusMessage('تم إنشاء كشف الحساب البنكي بنجاح.');
      void queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
      if (res?.statement?.id) {
        setSelectedStatementId(Number(res.statement.id));
      }
    },
    onError: (err: any) => {
      setStatusMessage(err?.message || 'تعذر إنشاء كشف الحساب');
    },
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStmtAccountId || !newStmtNo.trim()) {
      setStatusMessage('يرجى اختيار الحساب البنكي وإدخال رقم كشف الحساب.');
      return;
    }
    const validLines = newStmtLines.filter((l) => l.description.trim() && l.amount !== 0);
    createStatementMutation.mutate({
      accountId: newStmtAccountId,
      statementNo: newStmtNo.trim(),
      statementDate: newStmtDate,
      startingBalance: Number(newStmtStartBal),
      endingBalance: Number(newStmtEndBal),
      notes: newStmtNotes.trim(),
      lines: validLines,
    });
  };

  const handleBatchAcceptSuggestions = async () => {
    const suggestions = workspaceQuery.data?.suggestions || [];
    if (!suggestions.length) return;
    for (const s of suggestions) {
      await matchMutation.mutateAsync({
        statementLineId: s.statementLineId,
        journalLineId: s.journalLineId,
      });
    }
    setStatusMessage(`تم اعتماد ${suggestions.length} مطابقة آلية مقترحة بنجاح.`);
  };

  // Filtered Lines in Workspace
  const filteredStatementLines = useMemo(() => {
    const lines = workspaceQuery.data?.statementLines || [];
    if (statementFilterStatus === 'pending') return lines.filter((l) => !l.isReconciled);
    if (statementFilterStatus === 'reconciled') return lines.filter((l) => l.isReconciled);
    return lines;
  }, [workspaceQuery.data?.statementLines, statementFilterStatus]);

  const filteredGlLines = useMemo(() => {
    const lines = workspaceQuery.data?.glLines || [];
    if (!glFilterText.trim()) return lines;
    const query = glFilterText.trim().toLowerCase();
    return lines.filter((l) =>
      l.description.toLowerCase().includes(query) ||
      l.entryNo.toLowerCase().includes(query) ||
      String(l.debit).includes(query) ||
      String(l.credit).includes(query)
    );
  }, [workspaceQuery.data?.glLines, glFilterText]);

  const summary = workspaceQuery.data?.summary;
  const currentStatement = workspaceQuery.data?.statement;

  return (
    <div className="page-stack page-shell bank-reconciliation-page" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '100px' }}>
        <PageHeader
          title={t('accounting.bank_reconciliation_page.s0', "التسويات البنكية ومطابقة كشوف الحساب (Bank Reconciliation)")}
          description={t('accounting.bank_reconciliation_page.s1', "مطابقة كشوف الحسابات البنكية الواردة مع قيود وحركات الأستاذ العام وتسوية الفروقات والعمولات")}
          badge={<span className="nav-pill">{t('accounting.bank_reconciliation_page.s2', "المحاسبة والتسويات")}</span>}
          actions={
            selectedStatementId !== null ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setSelectedStatementId(null);
                  setSelectedStatementLineId(null);
                  setSelectedGlLineId(null);
                }}
                style={{ fontSize: '13px', fontWeight: 700 }}
              >
                {t('accounting.bank_reconciliation_page.s3', "← العودة لقائمة كشوف الحسابات")}
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  setIsCreateModalOpen(true);
                  if (bankAccounts.length > 0 && !newStmtAccountId) {
                    setNewStmtAccountId(Number(bankAccounts[0].id));
                  }
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: '#170e5e',
                  borderColor: '#170e5e',
                  fontSize: '13px',
                  fontWeight: 800,
                }}
              >
                <PlusIcon size={16} />
                {t('accounting.bank_reconciliation_page.s4', "إضافة / استيراد كشف حساب بنكي")}
              </Button>
            )
          }
        />

        <TreasuryNavTabs currentTab="reconciliation" />

        {/* Global Status Message */}
        {statusMessage && (
          <div style={{
            padding: '10px 16px',
            borderRadius: '8px',
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            color: '#1e40af',
            fontSize: '13px',
            fontWeight: 700,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span>{statusMessage}</span>
            <button type="button" onClick={() => setStatusMessage('')} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#1e40af' }}>
              <XIcon size={14} />
            </button>
          </div>
        )}

        {/* VIEW A: STATEMENTS LIST */}
        {selectedStatementId === null ? (
          <BankStatementsListTable
            isLoading={statementsQuery.isLoading}
            statements={statementsQuery.data}
            onOpenCreate={() => setIsCreateModalOpen(true)}
            onSelectStatement={(id) => setSelectedStatementId(id)}
          />
        ) : (
          /* VIEW B: INTERACTIVE RECONCILIATION WORKSPACE */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <ReconciliationSummaryHeader
              statement={currentStatement}
              summary={summary}
              suggestions={workspaceQuery.data?.suggestions}
              onRefetch={() => void workspaceQuery.refetch()}
              onAcceptSuggestions={() => void handleBatchAcceptSuggestions()}
              isAccepting={matchMutation.isPending}
            />

            {/* Action Bar when an item is selected */}
            {(selectedStatementLineId || selectedGlLineId) && (
              <div style={{
                background: '#170e5e',
                color: '#ffffff',
                borderRadius: '8px',
                padding: '10px 18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxShadow: '0 4px 12px rgba(23, 14, 94, 0.2)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '13px', fontWeight: 700 }}>
                  <span>{t('accounting.bank_reconciliation_page.s5', "العناصر المحددة للمطابقة:")}</span>
                  <span>{t('accounting.bank_reconciliation_page.s6', "السطر البنكي:")} <strong>{selectedStatementLineId ? `#${selectedStatementLineId}` : t('accounting.bank_reconciliation_page.s7', "لم يحدد")}</strong></span>
                  <span>•</span>
                  <span>{t('accounting.bank_reconciliation_page.s8', "قيد الأستاذ:")} <strong>{selectedGlLineId ? `#${selectedGlLineId}` : t('accounting.bank_reconciliation_page.s9', "لم يحدد")}</strong></span>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <Button
                    type="button"
                    variant="success"
                    disabled={!selectedStatementLineId || !selectedGlLineId || matchMutation.isPending}
                    onClick={() => {
                      if (selectedStatementLineId && selectedGlLineId) {
                        matchMutation.mutate({ statementLineId: selectedStatementLineId, journalLineId: selectedGlLineId });
                      }
                    }}
                    style={{ fontWeight: 800, fontSize: '12.5px' }}
                  >
                    {t('accounting.bank_reconciliation_page.s10', "تأكيد مطابقة العنصرين (Match)")}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setSelectedStatementLineId(null);
                      setSelectedGlLineId(null);
                    }}
                    style={{ color: '#ffffff', borderColor: '#ffffff', fontSize: '12px' }}
                  >
                    {t('accounting.bank_reconciliation_page.s11', "إلغاء التحديد")}
                  </Button>
                </div>
              </div>
            )}

            {/* DUAL SIDE-BY-SIDE LEDGER PANELS */}
            <ReconciliationDualLedger
              statementLines={filteredStatementLines}
              statementFilterStatus={statementFilterStatus}
              onStatementFilterStatusChange={setStatementFilterStatus}
              selectedStatementLineId={selectedStatementLineId}
              onSelectStatementLine={setSelectedStatementLineId}
              onUnmatchLine={(id) => unmatchMutation.mutate(id)}
              onOpenFeeModal={(line) => {
                setFeeTargetLine(line);
                if (expenseAccounts.length > 0 && !selectedExpenseAccountId) {
                  setSelectedExpenseAccountId(Number(expenseAccounts[0].id));
                }
                setIsFeeModalOpen(true);
              }}
              glLines={filteredGlLines}
              glFilterText={glFilterText}
              onGlFilterTextChange={setGlFilterText}
              selectedGlLineId={selectedGlLineId}
              onSelectGlLine={setSelectedGlLineId}
            />
          </div>
        )}

        {/* MODAL 1: CREATE / IMPORT STATEMENT */}
        <CreateBankStatementModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          bankAccounts={bankAccounts}
          newStmtAccountId={newStmtAccountId}
          setNewStmtAccountId={setNewStmtAccountId}
          newStmtNo={newStmtNo}
          setNewStmtNo={setNewStmtNo}
          newStmtDate={newStmtDate}
          setNewStmtDate={setNewStmtDate}
          newStmtNotes={newStmtNotes}
          setNewStmtNotes={setNewStmtNotes}
          newStmtStartBal={newStmtStartBal}
          setNewStmtStartBal={setNewStmtStartBal}
          newStmtEndBal={newStmtEndBal}
          setNewStmtEndBal={setNewStmtEndBal}
          newStmtLines={newStmtLines}
          setNewStmtLines={setNewStmtLines}
          onSubmit={handleCreateSubmit}
          isSubmitting={createStatementMutation.isPending}
        />

        {/* MODAL 2: BANK FEE ADJUSTMENT */}
        <BankFeeAdjustmentModal
          isOpen={isFeeModalOpen}
          onClose={() => setIsFeeModalOpen(false)}
          feeTargetLine={feeTargetLine}
          expenseAccounts={expenseAccounts}
          selectedExpenseAccountId={selectedExpenseAccountId}
          onSelectedExpenseAccountIdChange={setSelectedExpenseAccountId}
          onSubmit={() => {
            if (feeTargetLine && selectedExpenseAccountId) {
              feeAdjustmentMutation.mutate({
                statementLineId: feeTargetLine.id,
                expenseAccountId: selectedExpenseAccountId,
              });
            }
          }}
          isSubmitting={feeAdjustmentMutation.isPending}
        />
      </main>
    </div>
  );
}

export default BankReconciliationPage;
