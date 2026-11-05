import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DataTable } from '@/shared/ui/data-table';
import { Button } from '@/shared/ui/button';
import { SearchToolbar } from '@/shared/components/search-toolbar';
import { QueryFeedback } from '@/shared/components/query-feedback';
import { formatCurrency } from '@/lib/format';
import type { Supplier } from '@/types/domain';

export function SuppliersRegisterCard(props: { search: string; setSearch: (value: string) => void; filterMode: "all" | "debt" | "withNotes"; setFilterMode: (value: "all" | "debt" | "withNotes") => void; setPage: (value: number) => void; copySuppliersSummary: () => Promise<void> | void; printSuppliersRegister: () => void; rows: Supplier[]; canPrint: boolean; summary?: { totalSuppliers?: number } | null; selectedSupplier: Supplier | null; totalBalance: number; selectedIds: string[]; setSelectedIds: (value: string[]) => void; setBulkDeleteOpen: (value: boolean) => void; canDelete: boolean; suppliersQuery: { isLoading: boolean; isError: boolean; error: unknown }; page: number; pageSize: number; setPageSize: (value: number) => void; setSelectedSupplier: (supplier: Supplier | null) => void; setSupplierToDelete: (supplier: Supplier | null) => void; onOpenCreate?: () => void; }) {
  const { t } = useTranslation();
  return (
    <section className="document-prototype-section">
      <div className="section-header-compact-row">
        <h3 className="document-prototype-section-title">{t('suppliers.suppliers_page.suppliers_register_card.s0', "الموردون الحاليون")}</h3>
        <div className="section-header-actions-group">
          {props.onOpenCreate && <Button variant="primary" onClick={props.onOpenCreate} className="section-header-action-btn">{t('suppliers.suppliers_page.suppliers_register_card.s1', "+ مورد جديد")}</Button>}
          <Button variant="secondary" onClick={() => { props.setSearch(''); props.setFilterMode('all'); props.setPage(1); }} className="section-header-action-btn" style={{ marginInlineStart: '6px' }}>{t('suppliers.suppliers_page.suppliers_register_card.s2', "إلغاء الفلاتر")}</Button>
        </div>
      </div>
      <p className="muted small section-header-subtitle">
        {t('suppliers.suppliers_page.suppliers_register_card.s3', "فلترة سريعة مع ملخصات وإمكانية التعديل والإضافة المباشرة.")}
      </p>
      <SearchToolbar
        search={props.search}
        onSearchChange={(value) => { props.setSearch(value); props.setPage(1); }}
        searchPlaceholder={t('suppliers.suppliers_page.suppliers_register_card.s4', "ابحث بالاسم أو الهاتف أو العنوان أو الملاحظات")}
        title={t('suppliers.suppliers_page.suppliers_register_card.s5', "بحث وتصفية")}
        description={t('suppliers.suppliers_page.suppliers_register_card.s6', "فلترة سريعة لسجل الموردين مع إبقاء المورد المحدد والرصيد الحالي واضحين طوال الوقت.")}
        actions={<span className="nav-pill">{props.filterMode === 'all' ? t('suppliers.suppliers_page.suppliers_register_card.s7', "كل الموردين") : props.filterMode === 'debt' ? t('suppliers.suppliers_page.suppliers_register_card.s8', "عليهم رصيد") : t('suppliers.suppliers_page.suppliers_register_card.s9', "لديهم ملاحظات")}</span>}
        meta={(
          <>
            <span className="toolbar-meta-pill">{t('suppliers.suppliers_page.suppliers_register_card.s10', "النتائج:")} {props.summary?.totalSuppliers || props.rows.length}</span>
            <span className="toolbar-meta-pill">{t('suppliers.suppliers_page.suppliers_register_card.s11', "الرصيد:")} {props.selectedSupplier ? formatCurrency(props.selectedSupplier.balance || 0) : formatCurrency(props.totalBalance)}</span>
            {props.selectedSupplier ? <span className="toolbar-meta-pill">{t('suppliers.suppliers_page.suppliers_register_card.s12', "المحدد:")} {props.selectedSupplier.name}</span> : null}
          </>
        )}
        onReset={() => { props.setSearch(''); props.setFilterMode('all'); props.setPage(1); }}
        resetLabel={t('suppliers.suppliers_page.suppliers_register_card.s13', "تفريغ")}
      >
        <div className="filter-chip-row toolbar-chip-row">
          <Button variant={props.filterMode === 'all' ? 'primary' : 'secondary'} onClick={() => { props.setFilterMode('all'); props.setPage(1); }}>{t('suppliers.suppliers_page.suppliers_register_card.s14', "الكل")}</Button>
          <Button variant={props.filterMode === 'debt' ? 'primary' : 'secondary'} onClick={() => { props.setFilterMode('debt'); props.setPage(1); }}>{t('suppliers.suppliers_page.suppliers_register_card.s15', "عليهم رصيد")}</Button>
          <Button variant={props.filterMode === 'withNotes' ? 'primary' : 'secondary'} onClick={() => { props.setFilterMode('withNotes'); props.setPage(1); }}>{t('suppliers.suppliers_page.suppliers_register_card.s16', "لديهم ملاحظات")}</Button>
        </div>
      </SearchToolbar>
      {props.selectedIds.length ? <div className="bulk-toolbar"><div className="bulk-toolbar-meta"><strong>{t('suppliers.suppliers_page.suppliers_register_card.s17', "تحديد نشط:")} {props.selectedIds.length}</strong><span className="muted small">{t('suppliers.suppliers_page.suppliers_register_card.s18', "يمكنك حذف الموردين المحددين دفعة واحدة أو مسح التحديد الحالي.")}</span></div><div className="actions compact-actions"><Button variant="secondary" onClick={() => props.setSelectedIds([])}>{t('suppliers.suppliers_page.suppliers_register_card.s19', "مسح التحديد")}</Button><Button variant="danger" onClick={() => props.setBulkDeleteOpen(true)} disabled={!props.canDelete}>{t('suppliers.suppliers_page.suppliers_register_card.s20', "حذف المحدد")}</Button></div></div> : null}
      <QueryFeedback isLoading={props.suppliersQuery.isLoading} isError={props.suppliersQuery.isError} error={props.suppliersQuery.error} isEmpty={!props.rows.length} loadingText={t('suppliers.suppliers_page.suppliers_register_card.s21', "جاري تحميل الموردين...")} errorTitle={t('suppliers.suppliers_page.suppliers_register_card.s22', "تعذر تحميل الموردين")} emptyTitle={t('suppliers.suppliers_page.suppliers_register_card.s23', "لا توجد نتائج مطابقة")} emptyHint={t('suppliers.suppliers_page.suppliers_register_card.s24', "غيّر البحث أو أضف موردًا جديدًا.")}>
        <DataTable rows={props.rows as Supplier[]} rowKey={(supplier) => String(supplier.id)} onRowClick={(supplier) => props.setSelectedSupplier(supplier)} rowClassName={(supplier) => props.selectedSupplier?.id === supplier.id ? 'table-row-selected' : undefined} rowTitle={(supplier) => `عرض وتعديل: ${supplier.name}`} selection={{ selectedKeys: props.selectedIds, onChange: props.setSelectedIds, checkboxLabel: (supplier) => `تحديد المورد ${supplier.name}` }} pagination={{ page: props.page, pageSize: props.pageSize, totalItems: props.summary?.totalSuppliers || props.rows.length, onPageChange: props.setPage, onPageSizeChange: (nextPageSize) => { props.setPageSize(nextPageSize); props.setPage(1); }, itemLabel: t('suppliers.suppliers_page.suppliers_register_card.s25', "مورد") }} columns={[{ key: 'name', header: t('suppliers.suppliers_page.suppliers_register_card.s26', "المورد"), cell: (supplier) => <div><strong>{supplier.name}</strong><div className="muted small">{supplier.phone || t('suppliers.suppliers_page.suppliers_register_card.s27', "بدون هاتف")} · {supplier.address || t('suppliers.suppliers_page.suppliers_register_card.s28', "بدون عنوان")}</div></div> }, { key: 'balance', header: t('suppliers.suppliers_page.suppliers_register_card.s29', "الرصيد"), cell: (supplier) => formatCurrency(supplier.balance || 0) }, { key: 'notes', header: t('suppliers.suppliers_page.suppliers_register_card.s30', "ملاحظات"), cell: (supplier) => supplier.notes || '—' }, { key: 'actions', header: t('suppliers.suppliers_page.suppliers_register_card.s31', "إجراءات"), cell: (supplier) => <div className="actions" style={{ flexWrap: 'nowrap' }}><Button variant="secondary" onClick={(event) => { event.stopPropagation(); props.setSelectedSupplier(supplier); }}>{t('suppliers.suppliers_page.suppliers_register_card.s32', "تعديل")}</Button><Link className="button button-secondary" to={`/accounts?supplierId=${encodeURIComponent(supplier.id)}`} onClick={(event) => { event.stopPropagation(); }}>{t('suppliers.suppliers_page.suppliers_register_card.pay_supplier_link', "دفع لمورد")}</Link><Button variant="danger" onClick={(event) => { event.stopPropagation(); props.setSupplierToDelete(supplier); }} disabled={!props.canDelete}>{t('suppliers.suppliers_page.suppliers_register_card.s33', "حذف")}</Button></div> }]} />
      </QueryFeedback>
    </section>
  );
}
