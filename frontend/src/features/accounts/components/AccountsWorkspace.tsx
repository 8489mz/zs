import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/shared/components/page-header';
import { FilterChipGroup } from '@/shared/components/filter-chip-group';
import { Button } from '@/shared/ui/button';
import { CustomerPaymentForm, SupplierPaymentForm } from '@/features/accounts/components/PaymentForms';
import { LedgerPanel } from '@/features/accounts/components/LedgerPanel';
import { AccountsPartyCard } from '@/features/accounts/components/AccountsPartyCard';
import { AccountsLedgerCard } from '@/features/accounts/components/AccountsLedgerCard';
import { AccountsLedgerActions } from '@/features/accounts/components/AccountsLedgerActions';
import { SupplierBalanceScheduleCard } from '@/features/accounts/components/SupplierBalanceScheduleCard';
import { useAccountsWorkspaceController } from '@/features/accounts/hooks/useAccountsWorkspaceController';
import { useHasAnyPermission } from '@/shared/hooks/use-permission';
import { useCustomerProfile } from '@/features/customers/constants/customer-profiles';
import type { Customer, Supplier } from '@/types/domain';

type AccountsFocusMode = 'customers' | 'suppliers';

export function AccountsWorkspace() {
  const { t } = useTranslation();
  const profile = useCustomerProfile();
  const controller = useAccountsWorkspaceController();
  const canManageAccounts = useHasAnyPermission('accounts');
  const canManageCustomers = useHasAnyPermission('customers');
  const canManageSuppliers = useHasAnyPermission('suppliers');
  const canPrint = useHasAnyPermission('canPrint');
  const [focusMode, setFocusMode] = useState<AccountsFocusMode>('customers');

  useEffect(() => {
    if (controller.selectedSupplierId && !controller.selectedCustomerId) setFocusMode('suppliers');
    if (controller.selectedCustomerId && !controller.selectedSupplierId) setFocusMode('customers');
  }, [controller.selectedCustomerId, controller.selectedSupplierId]);

  const isCustomerMode = focusMode === 'customers';

  return (
    <div className="page-stack page-shell accounts-workspace accounts-workspace--compact" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '100px' }}>
      <PageHeader
        title={t('accounts.accounts_workspace.s0', "الحسابات")}
        description={t('accounts.accounts_workspace.s1', "ابدأ بالكشف المطلوب ثم سجل التحصيل أو الدفع من نفس الشاشة بدون ازدحام.")}
        badge={<span className="nav-pill">{t('accounts.accounts_workspace.s2', "متابعة مالية")}</span>}
      />

      <div className="stats-grid compact-grid accounts-stats-grid">
        {controller.overviewStats.map((stat) => (
          <div className="stat-card" key={stat.label}>
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
          </div>
        ))}
      </div>

      <div className="accounts-focus-toolbar">
        <FilterChipGroup
          value={focusMode}
          onChange={setFocusMode}
          className="filter-chip-row toolbar-chip-row accounts-focus-tabs"
          options={[
            { value: 'customers', label: t('accounts.accounts_workspace.s3', "العملاء") },
            { value: 'suppliers', label: t('accounts.accounts_workspace.s4', "الموردون") },
          ]}
        />

        <div className="actions compact-actions accounts-shortcuts-row">
          {isCustomerMode ? (
            <Button variant="secondary" onClick={controller.selectTopCustomer} disabled={!controller.customerBalanceOptions.length}>{t('accounts.accounts_workspace.s5', "أعلى عميل رصيدًا")}</Button>
          ) : (
            <Button variant="secondary" onClick={controller.selectTopSupplier} disabled={!controller.supplierBalanceOptions.length}>{t('accounts.accounts_workspace.s6', "أعلى مورد رصيدًا")}</Button>
          )}
          <Button
            variant="secondary"
            onClick={() => {
              controller.setSelectedCustomerId('');
              controller.setSelectedSupplierId('');
            }}
          >
            {t('accounts.accounts_workspace.s7', "إلغاء الاختيار")}
          </Button>
        </div>
      </div>

      {isCustomerMode ? (
        <div className="page-stack">
          <AccountsLedgerCard
            title={t('accounts.accounts_workspace.s8', "كشف حساب عميل")}
            description={t('accounts.accounts_workspace.s9', "اختر العميل وراجع الحركة ثم اطبع أو صدّر الكشف عند الحاجة.")}
            actions={(
              <AccountsLedgerActions
                title={t('accounts.accounts_workspace.s10', "كشف حساب عميل")}
                filename="customer-ledger.csv"
                partyName={controller.selectedCustomer?.name || ''}
                entries={controller.customerEntries}
                canPrint={canPrint}
                disabled={!controller.selectedCustomerId}
                loadAllEntries={controller.exportCustomerLedger}
              />
            )}
            isLoading={controller.customerBalancesQuery.isLoading || controller.customerLedgerQuery.isLoading}
            isError={controller.customerBalancesQuery.isError || controller.customerLedgerQuery.isError}
            error={controller.customerBalancesQuery.error || controller.customerLedgerQuery.error}
            isEmpty={!controller.customerBalanceOptions.length}
            loadingText={t('accounts.accounts_workspace.s11', "جاري تحميل كشف العميل...")}
            emptyTitle={t('accounts.accounts_workspace.s12', "لا توجد بيانات عملاء للحسابات")}
            emptyHint={t('accounts.accounts_workspace.s13', "سيظهر كشف العميل هنا بمجرد وجود عملاء أو حركة مالية.")}
          >
            <LedgerPanel
              title={t('accounts.accounts_workspace.s14', "كشف حساب عميل")}
              value={controller.selectedCustomerId}
              onChange={controller.setSelectedCustomerId}
              options={controller.customerBalanceOptions as Customer[]}
              emptyLabel={t('accounts.accounts_workspace.s15', "اختر العميل")}
              entries={controller.customerEntries}
              search={controller.customerLedgerSearch}
              onSearchChange={controller.setCustomerLedgerSearch}
              summary={controller.customerLedgerSummary}
              pagination={controller.customerLedgerPagination}
              onPageChange={controller.setCustomerLedgerPage}
              onPageSizeChange={controller.setCustomerLedgerPageSize}
            />
          </AccountsLedgerCard>

          <AccountsPartyCard
            title={profile.id === 'maritime' ? t('accounts.accounts_workspace.s16', "سند قبض / تحصيل نولون ودفعات شحن") : profile.id === 'contracting' ? t('accounts.accounts_workspace.s17', "سند قبض / تحصيل دفعات ومستخلصات") : t('accounts.accounts_workspace.s18', "سند قبض / تحصيل من عميل")}
            description={profile.id === 'maritime' ? t('accounts.accounts_workspace.s19', "تسجيل سند قبض لحساب الشاحن أو المستورد (سداد نولون، أو دفعة مقدمة / عربون على الحساب).") : profile.id === 'contracting' ? t('accounts.accounts_workspace.s20', "تسجيل سند قبض لجهة الإسناد أو المالك (سداد مستخلصات، أو دفعة مقدمة للمشروع).") : t('accounts.accounts_workspace.s21', "تسجيل سند قبض لحساب العميل سواء سداد مديونية مستحقة أو دفعة مقدمة / عربون على الحساب.")}
            badge={t('accounts.accounts_workspace.s22', "سند قبض")}
            isLoading={controller.customersQuery.isLoading}
            isError={controller.customersQuery.isError}
            error={controller.customersQuery.error}
            isEmpty={!controller.collectableCustomers.length}
            loadingText={t('accounts.accounts_workspace.s23', "جاري تحميل البيانات...")}
            emptyTitle={profile.id === 'maritime' ? t('accounts.accounts_workspace.s24', "لا يوجد شاحنون مسجلون حالياً") : profile.id === 'contracting' ? t('accounts.accounts_workspace.s25', "لا توجد جهات إسناد مسجلة حالياً") : t('accounts.accounts_workspace.s26', "لا يوجد عملاء مسجلون حالياً")}
            emptyHint={t('accounts.accounts_workspace.s27', "سجل طرفاً جديداً للبدء في إصدار سندات القبض والتحصيل.")}
            quickLabel={profile.id === 'maritime' ? t('accounts.accounts_workspace.s28', "إضافة شاحن سريع") : profile.id === 'contracting' ? t('accounts.accounts_workspace.s29', "إضافة جهة إسناد سريعة") : t('accounts.accounts_workspace.s30', "إضافة عميل سريع")}
            quickName={controller.quickCustomerName}
            onQuickNameChange={controller.setQuickCustomerName}
            quickPhone={controller.quickCustomerPhone}
            onQuickPhoneChange={controller.setQuickCustomerPhone}
            quickPending={controller.quickCustomerMutation.isPending}
            canManageParty={canManageCustomers}
            onQuickSubmit={controller.handleQuickCustomerSubmit}
            quickSubmitLabel={t('accounts.accounts_workspace.s31', "إضافة فوراً")}
            permissionHint={t('accounts.accounts_workspace.s32', "هذا الحساب لا يملك صلاحية إنشاء حساب جديد من شاشة الحسابات.")}
          >
            <CustomerPaymentForm customers={controller.collectableCustomers as Customer[]} activeCustomerId={controller.selectedCustomerId} disabled={!canManageAccounts} />
          </AccountsPartyCard>
        </div>
      ) : (
        <div className="page-stack">
          <div className="page-stack">
            <AccountsLedgerCard
              title={t('accounts.accounts_workspace.s33', "كشف حساب مورد")}
              description={t('accounts.accounts_workspace.s34', "اختر المورد وراجع الحركة ثم انسخ أو اطبع الكشف مباشرة.")}
              actions={(
                <AccountsLedgerActions
                  title={t('accounts.accounts_workspace.s35', "كشف حساب مورد")}
                  filename="supplier-ledger.csv"
                  partyName={controller.selectedSupplier?.name || ''}
                  entries={controller.supplierEntries}
                  canPrint={canPrint}
                  disabled={!controller.selectedSupplierId}
                  loadAllEntries={controller.exportSupplierLedger}
                />
              )}
              isLoading={controller.supplierBalancesQuery.isLoading || controller.supplierLedgerQuery.isLoading}
              isError={controller.supplierBalancesQuery.isError || controller.supplierLedgerQuery.isError}
              error={controller.supplierBalancesQuery.error || controller.supplierLedgerQuery.error}
              isEmpty={!controller.supplierBalanceOptions.length}
              loadingText={t('accounts.accounts_workspace.s36', "جاري تحميل كشف المورد...")}
              emptyTitle={t('accounts.accounts_workspace.s37', "لا توجد بيانات موردين للحسابات")}
              emptyHint={t('accounts.accounts_workspace.s38', "سيظهر كشف المورد هنا بمجرد وجود موردين أو حركة مالية.")}
            >
              <LedgerPanel
                title={t('accounts.accounts_workspace.s39', "كشف حساب مورد")}
                value={controller.selectedSupplierId}
                onChange={controller.setSelectedSupplierId}
                options={controller.supplierBalanceOptions as Supplier[]}
                emptyLabel={t('accounts.accounts_workspace.s40', "اختر المورد")}
                entries={controller.supplierEntries}
                search={controller.supplierLedgerSearch}
                onSearchChange={controller.setSupplierLedgerSearch}
                summary={controller.supplierLedgerSummary}
                pagination={controller.supplierLedgerPagination}
                onPageChange={controller.setSupplierLedgerPage}
                onPageSizeChange={controller.setSupplierLedgerPageSize}
              />
            </AccountsLedgerCard>

            <AccountsPartyCard
              title={t('accounts.accounts_workspace.s41', "سند صرف / دفع لمورد")}
              description={t('accounts.accounts_workspace.s42', "اختر المورد وسجل سند صرف لمستحقاته أو دفعة تعاقدية.")}
              badge={t('accounts.accounts_workspace.s43', "سند صرف")}
              isLoading={controller.supplierBalancesQuery.isLoading}
              isError={controller.supplierBalancesQuery.isError}
              error={controller.supplierBalancesQuery.error}
              isEmpty={!controller.supplierPaymentSuppliers.length}
              loadingText={t('accounts.accounts_workspace.s44', "جاري تحميل الموردين...")}
              emptyTitle={t('accounts.accounts_workspace.s45', "لا يوجد موردون عليهم رصيد حالياً")}
              emptyHint={t('accounts.accounts_workspace.s46', "سيظهر الموردون هنا بمجرد وجود رصيد مستحق للسداد.")}
              quickLabel={t('accounts.accounts_workspace.s47', "إضافة مورد سريع")}
              quickName={controller.quickSupplierName}
              onQuickNameChange={controller.setQuickSupplierName}
              quickPhone={controller.quickSupplierPhone}
              onQuickPhoneChange={controller.setQuickSupplierPhone}
              quickPending={controller.quickSupplierMutation.isPending}
              canManageParty={canManageSuppliers}
              onQuickSubmit={controller.handleQuickSupplierSubmit}
              quickSubmitLabel={t('accounts.accounts_workspace.s48', "إضافة المورد فوراً")}
              permissionHint={t('accounts.accounts_workspace.s49', "هذا الحساب لا يملك صلاحية إنشاء مورد جديد من شاشة الحسابات.")}
            >
              <SupplierPaymentForm suppliers={controller.supplierPaymentSuppliers as Supplier[]} activeSupplierId={controller.selectedSupplierId} disabled={!canManageAccounts} />
            </AccountsPartyCard>
          </div>

          <SupplierBalanceScheduleCard supplier={controller.selectedSupplier as Supplier | null} disabled={!canManageAccounts} />
        </div>
      )}
      </main>
    </div>
  );
}