import { Link } from 'react-router-dom';
import { DataTable } from '@/shared/ui/data-table';
import { Button } from '@/shared/ui/button';
import { SearchToolbar } from '@/shared/components/search-toolbar';
import { QueryFeedback } from '@/shared/components/query-feedback';
import { formatCurrency } from '@/lib/format';
import { useTranslation } from 'react-i18next';
import { useCustomerProfile } from '@/features/customers/constants/customer-profiles';
import type { Customer } from '@/types/domain';

interface CustomersRegisterCardProps {
  search: string;
  setSearch: (value: string) => void;
  filterMode: 'all' | 'vip' | 'debt' | 'cash';
  setFilterMode: (value: 'all' | 'vip' | 'debt' | 'cash') => void;
  setPage: (value: number) => void;
  copyCustomersSummary: () => Promise<void> | void;
  printCustomersRegister: () => void;
  rows: Customer[];
  canPrint: boolean;
  summary?: { totalCustomers?: number } | null;
  selectedCustomer: Customer | null;
  totalBalance: number;
  selectedIds: string[];
  setSelectedIds: (value: string[]) => void;
  setBulkDeleteOpen: (value: boolean) => void;
  canDelete: boolean;
  customersQuery: { isLoading: boolean; isError: boolean; error: unknown };
  page: number;
  pageSize: number;
  setPageSize: (value: number) => void;
  setSelectedCustomer: (customer: Customer | null) => void;
  setCustomerToDelete: (customer: Customer | null) => void;
  onOpenCreate?: () => void;
  onOpenLoyalty?: (customer: Customer) => void;
}

export function CustomersRegisterCard(props: CustomersRegisterCardProps) {
  const { t: __t } = useTranslation();
  const { t, i18n } = useTranslation();
  const profile = useCustomerProfile();

  const columns = [
    {
      key: 'name',
      header: profile.id === 'maritime' ? 'الشاحن / المستورد' : profile.id === 'contracting' ? 'جهة الإسناد / المالك' : profile.id === 'distribution' ? 'المحل / منفذ التوزيع' : profile.nameLabel.replace(' *', ''),
      cell: (customer: Customer) => {
        const meta = customer.metadata || {};
        const code = meta.customer_code || meta.code;
        const route = meta.route;
        const loc = meta.location_url || (meta.gps_lat && meta.gps_lng ? `https://maps.google.com/?q=${meta.gps_lat},${meta.gps_lng}` : null);
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              {code && profile.id === 'distribution' && (
                <span style={{ fontSize: '11px', fontWeight: 800, background: '#f1f5f9', color: '#1e293b', padding: '1px 6px', borderRadius: '4px', border: '1px solid #cbd5e1' }}>
                  #{code}
                </span>
              )}
              <strong>{customer.name}</strong>
              {route && profile.id === 'distribution' && (
                <span style={{ fontSize: '11px', fontWeight: 600, background: '#eff6ff', color: '#1d4ed8', padding: '1px 6px', borderRadius: '4px' }}>
                  {route}
                </span>
              )}
              {loc && profile.id === 'distribution' && (
                <a
                  href={loc}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{ fontSize: '11px', color: '#0284c7', textDecoration: 'underline', fontWeight: 600 }}
                  title={__t('customers.customers_page.customers_register_card.s0', "فتح الموقع الجغرافي للمحل على خرائط جوجل")}
                >
                  {__t('customers.customers_page.customers_register_card.s1', "اللوكيشن ↗")}
                </a>
              )}
            </div>
            <div className="muted small">{customer.phone || (i18n.language === 'en' ? 'No phone' : __t('customers.customers_page.customers_register_card.s2', "بدون هاتف"))} · {customer.address || (i18n.language === 'en' ? 'No address' : __t('customers.customers_page.customers_register_card.s3', "بدون عنوان"))}</div>
          </div>
        );
      }
    },
    {
      key: 'type',
      header: profile.typeLabel,
      cell: (customer: Customer) => {
        const option = profile.types.find((t) => t.value === customer.type) || profile.types[0];
        return (
          <span style={{
            background: option.badgeStyle.bg,
            color: option.badgeStyle.color,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: '6px',
            fontSize: '12px',
            display: 'inline-block'
          }}>
            {option.badgeLabel}
          </span>
        );
      }
    },
    {
      key: 'balance',
      header: profile.id === 'maritime' ? 'رصيد النولون' : profile.id === 'contracting' ? 'رصيد التعاقدات' : profile.id === 'distribution' ? 'مديونية المحل (إجمالي وتفصيل المناديب)' : profile.balanceLabel,
      cell: (customer: Customer) => {
        const totalBal = Number(customer.balance || 0);
        const repBals = customer.repBalances || [];
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <strong style={{ color: totalBal > 0 ? '#dc2626' : '#0f172a' }}>
              {formatCurrency(totalBal)}
            </strong>
            {repBals.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {repBals.map((rb) => (
                  <span
                    key={rb.repId}
                    style={{
                      fontSize: '10.5px',
                      fontWeight: 700,
                      color: rb.balance > 0 ? '#9a3412' : '#475569',
                      backgroundColor: rb.balance > 0 ? '#ffedd5' : '#f1f5f9',
                      border: `1px solid ${rb.balance > 0 ? '#fed7aa' : '#cbd5e1'}`,
                      padding: '1px 6px',
                      borderRadius: '4px',
                      whiteSpace: 'nowrap',
                    }}
                    title={`مديونية المندوب (${rb.repName}) المعزولة لدى المحل`}
                  >
                    {rb.repName}: {formatCurrency(rb.balance)}
                  </span>
                ))}
                {(customer.unassignedBalance ?? 0) > 0 && (
                  <span
                    style={{
                      fontSize: '10.5px',
                      fontWeight: 600,
                      color: '#475569',
                      backgroundColor: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      padding: '1px 6px',
                      borderRadius: '4px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {__t('customers.customers_page.customers_register_card.s4', "مباشر/إدارة:")} {formatCurrency(customer.unassignedBalance || 0)}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      }
    },
    {
      key: 'creditLimit',
      header: profile.id === 'maritime' ? 'سقف الائتمان' : profile.id === 'contracting' ? 'سقف التمويل' : profile.id === 'distribution' ? 'سقف المديونية' : profile.creditLimitLabel,
      cell: (customer: Customer) => formatCurrency(customer.creditLimit || 0)
    },
    ...(profile.showLoyalty ? [{
      key: 'loyaltyPoints',
      header: i18n.language === 'en' ? 'Loyalty Points' : 'نقاط الولاء',
      cell: (customer: Customer) => (
        <span style={{ background: '#fdf2f8', color: '#be185d', fontWeight: 800, padding: '2px 8px', borderRadius: '6px', fontSize: '12px' }}>
          {Number((customer as any).loyaltyPoints || 0)} {i18n.language === 'en' ? 'pts' : __t('customers.customers_page.customers_register_card.s5', "نقطة")}
        </span>
      )
    }] : []),
    {
      key: 'actions',
      header: i18n.language === 'en' ? 'Actions' : 'إجراءات',
      cell: (customer: Customer) => (
        <div className="actions" style={{ flexWrap: 'nowrap' }}>
          {profile.showLoyalty && (
            <Button
              variant="secondary"
              onClick={(event) => { event.stopPropagation(); props.onOpenLoyalty?.(customer); }}
              style={{ color: '#be185d', borderColor: '#fbcfe8', background: '#fdf2f8' }}
            >
              {i18n.language === 'en' ? 'Loyalty' : __t('customers.customers_page.customers_register_card.s6', "نقاط الولاء")}
            </Button>
          )}
          <Link className="button button-secondary" to={`/accounts?customerId=${encodeURIComponent(customer.id)}`} onClick={(event) => { event.stopPropagation(); }}>
            {i18n.language === 'en' ? 'Statement' : __t('customers.customers_page.customers_register_card.statement_link', "كشف الحساب")}
          </Link>
          <Button variant="secondary" onClick={(event) => { event.stopPropagation(); props.setSelectedCustomer(customer); }}>
            {t('common.edit', 'تعديل')}
          </Button>
          <Button variant="danger" onClick={(event) => { event.stopPropagation(); props.setCustomerToDelete(customer); }} disabled={!props.canDelete}>
            {t('common.delete', 'حذف')}
          </Button>
        </div>
      )
    }
  ];

  return (
    <section className="document-prototype-section">
      <div className="section-header-compact-row">
        <h3 className="document-prototype-section-title">
          {profile.id === 'maritime' ? __t('customers.customers_page.customers_register_card.s7', "الشاحنون والمستوردون الحاليون") : profile.id === 'contracting' ? __t('customers.customers_page.customers_register_card.s8', "جهات الإسناد والملاك الحاليون") : (i18n.language === 'en' ? 'Current Customers' : __t('customers.customers_page.customers_register_card.s9', "العملاء الحاليون"))}
        </h3>
        <div className="section-header-actions-group">
          {props.onOpenCreate && <Button variant="primary" onClick={props.onOpenCreate} className="section-header-action-btn">{profile.addBtnText}</Button>}
          <Button variant="secondary" onClick={() => { props.setSearch(''); props.setFilterMode('all'); props.setPage(1); }} className="section-header-action-btn" style={{ marginInlineStart: '6px' }}>{t('common.clear_filters', 'إلغاء الفلاتر')}</Button>
        </div>
      </div>
      <p className="muted small section-header-subtitle">
        {i18n.language === 'en' ? 'Quick filtering with summaries and direct editing/adding.' : __t('customers.customers_page.customers_register_card.s10', "فلترة سريعة مع ملخصات وإمكانية التعديل والإضافة المباشرة.")}
      </p>
      <SearchToolbar
        search={props.search}
        onSearchChange={(value) => { props.setSearch(value); props.setPage(1); }}
        searchPlaceholder={i18n.language === 'en' ? 'Search by name, phone, code, or address...' : __t('customers.customers_page.customers_register_card.s11', "ابحث بالاسم أو كود المحل (مثل 0002) أو الهاتف أو العنوان")}
        title={t('common.search_and_filter', 'بحث وتصفية')}
        description={i18n.language === 'en' ? 'Select a customer to view or edit account details.' : __t('customers.customers_page.customers_register_card.s12', "ابدأ بالفلتر المناسب ثم اختر السجل المطلوب لتظهر لوحة التعديل فورًا.")}
        actions={<span className="nav-pill">{props.filterMode === 'all' ? (profile.id === 'maritime' ? __t('customers.customers_page.customers_register_card.s13', "كل الشاحنين") : profile.id === 'contracting' ? __t('customers.customers_page.customers_register_card.s14', "كل جهات الإسناد") : __t('customers.customers_page.customers_register_card.s15', "كل العملاء")) : props.filterMode === 'vip' ? (profile.id === 'maritime' ? __t('customers.customers_page.customers_register_card.s16', "شاحن VIP") : 'VIP') : props.filterMode === 'debt' ? __t('customers.customers_page.customers_register_card.s17', "عليهم رصيد") : __t('customers.customers_page.customers_register_card.s18', "نقدي")}</span>}
        meta={(
          <>
            <span className="toolbar-meta-pill">{__t('customers.customers_page.customers_register_card.s19', "النتائج:")} {props.summary?.totalCustomers || props.rows.length}</span>
            <span className="toolbar-meta-pill">{__t('customers.customers_page.customers_register_card.s20', "الرصيد:")} {props.selectedCustomer ? formatCurrency(props.selectedCustomer.balance || 0) : formatCurrency(props.totalBalance)}</span>
            {props.selectedCustomer ? <span className="toolbar-meta-pill">{__t('customers.customers_page.customers_register_card.s21', "المحدد:")} {props.selectedCustomer.name}</span> : null}
          </>
        )}
        onReset={() => { props.setSearch(''); props.setFilterMode('all'); props.setPage(1); }}
        resetLabel={__t('customers.customers_page.customers_register_card.s22', "تفريغ")}
      >
        <div className="filter-chip-row toolbar-chip-row">
          <Button variant={props.filterMode === 'all' ? 'primary' : 'secondary'} onClick={() => { props.setFilterMode('all'); props.setPage(1); }}>{__t('customers.customers_page.customers_register_card.s23', "الكل")}</Button>
          <Button variant={props.filterMode === 'vip' ? 'primary' : 'secondary'} onClick={() => { props.setFilterMode('vip'); props.setPage(1); }}>VIP</Button>
          <Button variant={props.filterMode === 'debt' ? 'primary' : 'secondary'} onClick={() => { props.setFilterMode('debt'); props.setPage(1); }}>{__t('customers.customers_page.customers_register_card.s24', "عليهم رصيد")}</Button>
          <Button variant={props.filterMode === 'cash' ? 'primary' : 'secondary'} onClick={() => { props.setFilterMode('cash'); props.setPage(1); }}>{__t('customers.customers_page.customers_register_card.s25', "نقدي")}</Button>
        </div>
      </SearchToolbar>
      {props.selectedIds.length ? <div className="bulk-toolbar"><div className="bulk-toolbar-meta"><strong>{__t('customers.customers_page.customers_register_card.s26', "تحديد نشط:")} {props.selectedIds.length}</strong><span className="muted small">{__t('customers.customers_page.customers_register_card.s27', "يمكنك حذف السجلات المحددة دفعة واحدة أو مسح التحديد الحالي.")}</span></div><div className="actions compact-actions"><Button variant="secondary" onClick={() => props.setSelectedIds([])}>{__t('customers.customers_page.customers_register_card.s28', "مسح التحديد")}</Button><Button variant="danger" onClick={() => props.setBulkDeleteOpen(true)} disabled={!props.canDelete}>{__t('customers.customers_page.customers_register_card.s29', "حذف المحدد")}</Button></div></div> : null}
      <QueryFeedback isLoading={props.customersQuery.isLoading} isError={props.customersQuery.isError} error={props.customersQuery.error} isEmpty={!props.rows.length} loadingText={__t('customers.customers_page.customers_register_card.s30', "جاري تحميل البيانات...")} errorTitle={__t('customers.customers_page.customers_register_card.s31', "تعذر تحميل البيانات")} emptyTitle={__t('customers.customers_page.customers_register_card.s32', "لا توجد نتائج مطابقة")} emptyHint={__t('customers.customers_page.customers_register_card.s33', "جرّب تغيير الفلاتر أو أضف سجلًا جديدًا.")}>
        <DataTable
          rows={props.rows as Customer[]}
          rowKey={(customer) => String(customer.id)}
          onRowClick={(customer) => props.setSelectedCustomer(customer)}
          rowClassName={(customer) => props.selectedCustomer?.id === customer.id ? 'table-row-selected' : undefined}
          rowTitle={(customer) => `عرض وتعديل: ${customer.name}`}
          selection={{ selectedKeys: props.selectedIds, onChange: props.setSelectedIds, checkboxLabel: (customer) => `تحديد ${customer.name}` }}
          pagination={{ page: props.page, pageSize: props.pageSize, totalItems: props.summary?.totalCustomers || props.rows.length, onPageChange: props.setPage, onPageSizeChange: (nextPageSize) => { props.setPageSize(nextPageSize); props.setPage(1); }, itemLabel: profile.badgeUnit }}
          columns={columns}
        />
      </QueryFeedback>
    </section>
  );
}
