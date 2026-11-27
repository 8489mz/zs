import {Fragment, type ReactElement} from 'react';
import { Button } from '@/shared/ui/button';
import { FileTextIcon, LayersIcon } from '@/shared/components/icons/AppIcons';
import { formatCurrency } from '@/lib/format';
import { displayProductName } from '../../utils/product-submit.utils';
import { getProductLocationDisplayName } from '../../utils/product-location.utils';
import { ProductsMatrixView } from '../ProductsMatrixView';
import { ProductThumbnail } from './products-table-card-thumbnail';
import {variantLabel, deriveBaseName, type ProductGroup} from './products-table-card-shared';
import type { Product } from '@/types/domain';
import type { ProductIconSettings } from '@/shared/components/icons/product-icon-theme';
import type { useTranslation } from 'react-i18next';

export interface ProductsTableCardTableProps {
  __t: ReturnType<typeof useTranslation>['t'];
  allVisibleSelected: boolean;
  someVisibleSelected: boolean;
  selectedIds: string[];
  visibleLeafIds: string[];
  onSelectedIdsChange: (value: string[]) => void;
  renderSortableTh: (field: string, label: string, align?: 'start' | 'center') => ReactElement;
  t: ReturnType<typeof useTranslation>['t'];
  groupedRows: ProductGroup[];
  expandedKeys: string[];
  locationNames: Record<string, string>;
  selectedProduct: Product | null;
  onSelectProduct: (product: Product | null) => void;
  toggleGroupSelection: (group: ProductGroup, checked: boolean) => void;
  iconSettings: ProductIconSettings & { effectiveColor: string; update: (s: Partial<ProductIconSettings>) => void; };
  setPreviewImage: (val: { url: string; title: string } | null) => void;
  categoryNames: Record<string, string>;
  supplierNames: Record<string, string>;
  setActiveNoteModal: (val: { productName: string; note: string } | null) => void;
  setActiveCardProduct: (val: Product | null) => void;
  toggleExpand: (key: string) => void;
}

export function ProductsTableCardTable({ __t, allVisibleSelected, someVisibleSelected, selectedIds, visibleLeafIds, onSelectedIdsChange, renderSortableTh, t, groupedRows, expandedKeys, locationNames, selectedProduct, onSelectProduct, toggleGroupSelection, iconSettings, setPreviewImage, categoryNames, supplierNames, setActiveNoteModal, setActiveCardProduct, toggleExpand }: ProductsTableCardTableProps) {
  return (
    <>
    <div className="table-wrap table-wrap-sticky table-wrap-compact" style={{ overflowX: 'hidden' }}>
      <table aria-label={__t('products.products_table_card.s9', "قائمة الأصناف")} style={{ tableLayout: 'fixed', width: '100%', minWidth: '100%' }}>
        <colgroup>
          <col style={{ width: '38px' }} />
          <col style={{ width: '25%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '84px' }} />
          <col style={{ width: '114px' }} />
        </colgroup>
        <thead>
          <tr>
            <th className="table-selection-cell">
              <input
                type="checkbox"
                aria-label={__t('products.products_table_card.s10', "تحديد كل الصفوف الظاهرة")}
                checked={allVisibleSelected}
                ref={(node) => { if (node) node.indeterminate = someVisibleSelected; }}
                onChange={(event) => {
                  const next = new Set(selectedIds);
                  if (event.target.checked) visibleLeafIds.forEach((id) => next.add(id));
                  else visibleLeafIds.forEach((id) => next.delete(id));
                  onSelectedIdsChange(Array.from(next));
                }}
              />
            </th>
            {renderSortableTh('name', t('products.product_col', 'الصنف'), 'start')}
            {renderSortableTh('barcode', t('products.barcode_col', 'الباركود'), 'center')}
            <th style={{ textAlign: 'center' }}>{t('products.variants_col', 'المتغيرات')}</th>
            {renderSortableTh('category', t('products.category_supplier_store_col', 'القسم / المورد / المخزن'), 'start')}
            {renderSortableTh('price', t('products.prices_col', 'الأسعار'), 'start')}
            {renderSortableTh('stock', t('products.stock_col', 'المخزون'), 'center')}
            <th style={{ textAlign: 'center' }}>{t('products.notes_col', 'ملاحظات')}</th>
            <th style={{ textAlign: 'center' }}>{t('products.actions_col', 'إجراءات')}</th>
          </tr>
        </thead>
        <tbody>
          {groupedRows.map((group) => {
            const isExpanded = expandedKeys.includes(group.key);
            const groupIds = group.children.map((product) => String(product.id));
            const allSelected = groupIds.every((id) => selectedIds.includes(id));
            const someSelected = !allSelected && groupIds.some((id) => selectedIds.includes(id));
            const baseName = deriveBaseName(group.representative);
            const totalStock = group.children.reduce((sum, entry) => sum + Number(entry.stock || 0), 0);

            if (!group.grouped) {
              const product = group.representative;
              const activeLocationNames = getProductLocationDisplayName(product, locationNames);

              return (
                <tr key={group.key} className={selectedProduct?.id === product.id ? 'table-row-selected' : undefined} onClick={() => onSelectProduct(product)} style={{ cursor: 'pointer' }}>
                  <td className="table-selection-cell" onClick={(event) => event.stopPropagation()}>
                    <input type="checkbox" aria-label={`تحديد الصنف ${displayProductName(product)}`} checked={selectedIds.includes(String(product.id))} onChange={(event) => toggleGroupSelection(group, event.target.checked)} />
                  </td>
                  <td style={{ textAlign: 'start', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                      {iconSettings.showIcons ? (
                        <ProductThumbnail
                          imageUrl={product.imageUrl}
                          icon={product.icon}
                          name={displayProductName(product)}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewImage({ url: product.imageUrl!, title: displayProductName(product) });
                          }}
                        />
                      ) : null}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <strong style={{ color: '#0f172a', fontSize: '0.86rem', lineHeight: 1.35, display: 'block', wordBreak: 'break-word', whiteSpace: 'normal' }}>{displayProductName(product)}</strong>
                          {product.isActive === false ? (
                            <span className="status-badge" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', fontSize: '0.68rem', padding: '1px 5px', whiteSpace: 'nowrap' }}>{__t('products.products_table_card.s11', "مؤرشف")}</span>
                          ) : null}
                        </div>
                        <div className="muted small" style={{ fontSize: '0.74rem', marginTop: '2px', color: '#64748b', lineHeight: 1.3, wordBreak: 'break-word' }}>{(product.units || []).map((unit) => `${unit.name} × ${unit.multiplier || 1}`).join(' / ') || __t('products.products_table_card.s12', "قطعة")}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {product.barcode ? (
                      <span style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: '#334155', background: '#f8fafc', padding: '2px 6px', borderRadius: '4px', border: '1px solid #e2e8f0', display: 'inline-block' }}>
                        {product.barcode}
                      </span>
                    ) : (
                      <span style={{ color: '#94a3b8' }}>—</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                    {variantLabel(product) !== '—' ? (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '1px 7px',
                        borderRadius: '4px',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        background: '#f1f5f9',
                        color: '#334155',
                        border: '1px solid #e2e8f0',
                        whiteSpace: 'nowrap',
                      }}>
                        {variantLabel(product)}
                      </span>
                    ) : (
                      <span style={{ color: '#94a3b8' }}>—</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'start', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                    <div style={{ lineHeight: 1.35 }}>
                      <div>{categoryNames[product.categoryId] || __t('products.products_table_card.s13', "عام")}</div>
                      {activeLocationNames ? <div className="muted small" style={{ fontSize: '0.74rem' }}>{activeLocationNames}</div> : null}
                      {supplierNames[product.supplierId] ? <div className="muted small" style={{ fontSize: '0.74rem' }}>{supplierNames[product.supplierId]}</div> : null}
                    </div>
                  </td>
                  <td style={{ textAlign: 'start', whiteSpace: 'nowrap' }}>
                    <div style={{ lineHeight: 1.4 }}>
                      <div>{__t('products.products_table_card.s14', "بيع:")} <strong>{formatCurrency(product.retailPrice)}</strong></div>
                      <div className="muted small" style={{ fontSize: '0.75rem' }}>{__t('products.products_table_card.s15', "شراء:")} {formatCurrency(product.costPrice)}</div>
                      {product.wholesalePrice > 0 ? <div className="muted small" style={{ fontSize: '0.75rem' }}>{__t('products.products_table_card.s16', "جملة:")} {formatCurrency(product.wholesalePrice)}</div> : null}
                    </div>
                  </td>
                  <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <span className={product.stock <= product.minStock ? 'low-stock-badge' : 'status-badge status-posted'}>
                      {product.stock}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {product.notes ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveNoteModal({ productName: displayProductName(product), note: product.notes! });
                        }}
                        title={product.notes}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px',
                          padding: '2px 7px',
                          borderRadius: '6px',
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          background: '#eff6ff',
                          color: '#1d4ed8',
                          border: '1px solid #bfdbfe',
                          cursor: 'pointer',
                          boxSizing: 'border-box',
                        }}
                      >
                        <FileTextIcon size={12} />
                        <span>{__t('products.products_table_card.s17', "ملاحظة")}</span>
                      </button>
                    ) : (
                      <span style={{ color: '#cbd5e1' }}>—</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <div className="actions compact-actions" onClick={(event) => event.stopPropagation()} style={{ flexWrap: 'nowrap', justifyContent: 'center' }}>
                      <Button
                        variant="secondary"
                        type="button"
                        onClick={() => setActiveCardProduct(product)}
                        title={__t('products.products_table_card.card_btn_title', "عرض كارت الصنف وسجل الحركات التاريخية والمخزون")}
                        style={{
                          fontSize: '0.82rem',
                          fontWeight: 700,
                          color: '#170e5e',
                          borderColor: '#c7d2fe',
                          background: '#eef2ff',
                          padding: '5px 12px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          whiteSpace: 'nowrap',
                          borderRadius: '7px',
                        }}
                      >
                        <LayersIcon size={14} color="#170e5e" />
                        <span>{__t('products.products_table_card.card_btn', "كارت الصنف")}</span>
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            }

            const groupActiveLocationIds = Array.from(new Set(group.children.flatMap(p => p.activeLocationIds || [])));
            const groupActiveLocationNames = getProductLocationDisplayName(
              { ...group.representative, activeLocationIds: groupActiveLocationIds },
              locationNames
            );

            return (
              <Fragment key={group.key}>
                <tr key={group.key} className="products-group-row">
                  <td className="table-selection-cell">
                    <input
                      type="checkbox"
                      aria-label={`تحديد المجموعة ${baseName}`}
                      checked={allSelected}
                      ref={(node) => { if (node) node.indeterminate = someSelected; }}
                      onChange={(event) => toggleGroupSelection(group, event.target.checked)}
                    />
                  </td>
                  <td style={{ textAlign: 'start', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                    <div
                      onClick={() => toggleExpand(group.key)}
                      style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: '8px' }}
                      title={isExpanded ? __t('products.products_table_card.s28', "طي الأصناف الفرعية") : __t('products.products_table_card.s29', "توسيع الأصناف الفرعية")}
                    >
                      {iconSettings.showIcons ? (
                        <ProductThumbnail
                          imageUrl={group.representative.imageUrl || group.children.find((c) => c.imageUrl)?.imageUrl}
                          icon={group.representative.icon}
                          name={baseName}
                          onClick={(e) => {
                            const imgUrl = group.representative.imageUrl || group.children.find((c) => c.imageUrl)?.imageUrl;
                            if (imgUrl) {
                              e.stopPropagation();
                              setPreviewImage({ url: imgUrl, title: baseName });
                            }
                          }}
                        />
                      ) : null}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <strong style={{ color: '#0f172a', fontSize: '0.88rem', lineHeight: 1.35 }}>{baseName}</strong>
                        <div className="muted small" style={{ fontSize: '0.74rem', marginTop: '2px', color: '#64748b', lineHeight: 1.3 }}>
                          {group.children.length} {__t('products.products_table_card.s30', "فرعيات")}{group.representative.styleCode ? ` • كود ${group.representative.styleCode}` : ''}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <span style={{ color: '#94a3b8' }}>—</span>
                  </td>
                  <td style={{ textAlign: 'center', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', justifyContent: 'center', alignItems: 'center', maxHeight: '52px', overflow: 'hidden' }}>
                      {group.children.slice(0, 2).map((entry) => (
                        <span
                          key={entry.id}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            background: '#f1f5f9',
                            color: '#334155',
                            border: '1px solid #e2e8f0',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {variantLabel(entry)}
                        </span>
                      ))}
                      {group.children.length > 2 ? (
                        <button
                          type="button"
                          onClick={() => toggleExpand(group.key)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            background: isExpanded ? '#dbeafe' : '#eff6ff',
                            color: '#1e40af',
                            border: '1px solid #bfdbfe',
                            whiteSpace: 'nowrap',
                            cursor: 'pointer',
                          }}
                          title={isExpanded ? __t('products.products_table_card.s31', "إخفاء الفرعيات") : __t('products.products_table_card.s32', "عرض باقي الفرعيات")}
                        >
                          +{group.children.length - 2} {__t('products.products_table_card.s33', "فرعي")} {isExpanded ? '▲' : '▼'}
                        </button>
                      ) : null}
                    </div>
                  </td>
                  <td style={{ textAlign: 'start', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                    <div style={{ lineHeight: 1.35 }}>
                      <div>{categoryNames[group.representative.categoryId] || __t('products.products_table_card.s34', "عام")}</div>
                      {groupActiveLocationNames ? <div className="muted small" style={{ fontSize: '0.74rem' }}>{groupActiveLocationNames}</div> : null}
                      {supplierNames[group.representative.supplierId] ? <div className="muted small" style={{ fontSize: '0.74rem' }}>{supplierNames[group.representative.supplierId]}</div> : null}
                    </div>
                  </td>
                  <td style={{ textAlign: 'start', whiteSpace: 'nowrap' }}>
                    <div style={{ lineHeight: 1.4 }}>
                      <div>{__t('products.products_table_card.s35', "بيع:")} <strong>{formatCurrency(group.representative.retailPrice)}</strong></div>
                      <div className="muted small" style={{ fontSize: '0.75rem' }}>{__t('products.products_table_card.s36', "شراء:")} {formatCurrency(group.representative.costPrice)}</div>
                      {group.representative.wholesalePrice > 0 ? <div className="muted small" style={{ fontSize: '0.75rem' }}>{__t('products.products_table_card.s37', "جملة:")} {formatCurrency(group.representative.wholesalePrice)}</div> : null}
                    </div>
                  </td>
                  <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <span className={totalStock <= Number(group.representative.minStock || 0) ? 'low-stock-badge' : 'status-badge status-posted'}>
                      {totalStock}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {group.representative.notes ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveNoteModal({ productName: baseName, note: group.representative.notes! });
                        }}
                        title={group.representative.notes}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px',
                          padding: '2px 7px',
                          borderRadius: '6px',
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          background: '#eff6ff',
                          color: '#1d4ed8',
                          border: '1px solid #bfdbfe',
                          cursor: 'pointer',
                          boxSizing: 'border-box',
                        }}
                      >
                        <FileTextIcon size={12} />
                        <span>{__t('products.products_table_card.s38', "ملاحظة")}</span>
                      </button>
                    ) : (
                      <span style={{ color: '#cbd5e1' }}>—</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <div className="actions compact-actions" onClick={(event) => event.stopPropagation()} style={{ flexWrap: 'nowrap', justifyContent: 'center' }}>
                      <Button
                        variant="secondary"
                        type="button"
                        onClick={() => setActiveCardProduct(
                          group.grouped
                            ? {
                                ...group.representative,
                                name: baseName,
                                stock: totalStock,
                                variantsCount: group.children.length,
                              }
                            : group.representative
                        )}
                        title={__t('products.products_table_card.card_btn_title', "عرض كارت الصنف وسجل الحركات التاريخية والمخزون")}
                        style={{
                          fontSize: '0.82rem',
                          fontWeight: 700,
                          color: '#170e5e',
                          borderColor: '#c7d2fe',
                          background: '#eef2ff',
                          padding: '5px 12px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          whiteSpace: 'nowrap',
                          borderRadius: '7px',
                        }}
                      >
                        <LayersIcon size={14} color="#170e5e" />
                        <span>{__t('products.products_table_card.card_btn', "كارت الصنف")}</span>
                      </Button>
                    </div>
                  </td>
                </tr>
                {isExpanded && group.grouped && group.representative.styleCode && group.representative.itemKind === 'fashion' ? (
                  <tr className="products-matrix-row">
                    <td colSpan={9} style={{ padding: 0 }}>
                      <ProductsMatrixView products={group.children} />
                    </td>
                  </tr>
                ) : null}
                {isExpanded ? group.children.map((product) => (
                  <tr key={`child-${product.id}`} className={`products-group-child-row ${selectedProduct?.id === product.id ? 'table-row-selected' : ''}`} onClick={() => onSelectProduct(product)} style={{ cursor: 'pointer' }}>
                    <td className="table-selection-cell" onClick={(event) => event.stopPropagation()}>
                      <input type="checkbox" aria-label={`تحديد الصنف ${displayProductName(product)}`} checked={selectedIds.includes(String(product.id))} onChange={(event) => {
                        const next = new Set(selectedIds);
                        if (event.target.checked) next.add(String(product.id));
                        else next.delete(String(product.id));
                        onSelectedIdsChange(Array.from(next));
                      }} />
                    </td>
                    <td style={{ textAlign: 'start', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                      <div style={{ paddingInlineStart: 18, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {product.imageUrl ? (
                          <ProductThumbnail
                            imageUrl={product.imageUrl}
                            icon={product.icon}
                            name={displayProductName(product)}
                            size={22}
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreviewImage({ url: product.imageUrl!, title: `${displayProductName(product)} (${variantLabel(product)})` });
                            }}
                          />
                        ) : null}
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <strong>{variantLabel(product)}</strong>
                            {product.isActive === false ? (
                              <span className="status-badge" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', fontSize: '0.68rem', padding: '1px 5px' }}>{__t('products.products_table_card.s57', "مؤرشف")}</span>
                            ) : null}
                          </div>
                          <div className="muted small" style={{ fontSize: '0.74rem', lineHeight: 1.3 }}>{displayProductName(product)}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {product.barcode ? (
                        <span style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: '#334155', background: '#f8fafc', padding: '2px 6px', borderRadius: '4px', border: '1px solid #e2e8f0', display: 'inline-block' }}>
                          {product.barcode}
                        </span>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                      {variantLabel(product) !== '—' ? (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '1px 7px',
                          borderRadius: '4px',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          background: '#f1f5f9',
                          color: '#334155',
                          border: '1px solid #e2e8f0',
                          whiteSpace: 'nowrap',
                        }}>
                          {variantLabel(product)}
                        </span>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'start', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                      <div style={{ lineHeight: 1.35 }}>
                        <div style={{ fontWeight: 600, color: '#334155', fontSize: '0.8rem' }}>{categoryNames[product.categoryId] || __t('products.products_table_card.s58', "عام")}</div>
                        {getProductLocationDisplayName(product, locationNames) ? <div className="muted small" style={{ fontSize: '0.74rem', lineHeight: 1.3 }}>{getProductLocationDisplayName(product, locationNames)}</div> : null}
                        {supplierNames[product.supplierId] ? <div className="muted small" style={{ fontSize: '0.74rem', lineHeight: 1.3 }}>{supplierNames[product.supplierId]}</div> : null}
                      </div>
                    </td>
                    <td style={{ textAlign: 'start', whiteSpace: 'nowrap' }}>
                      <div style={{ lineHeight: 1.4 }}>
                        <div>{__t('products.products_table_card.s59', "بيع:")} <strong>{formatCurrency(product.retailPrice)}</strong></div>
                        <div className="muted small" style={{ fontSize: '0.75rem' }}>{__t('products.products_table_card.s60', "شراء:")} {formatCurrency(product.costPrice)}</div>
                        {product.wholesalePrice > 0 ? <div className="muted small" style={{ fontSize: '0.75rem' }}>{__t('products.products_table_card.s61', "جملة:")} {formatCurrency(product.wholesalePrice)}</div> : null}
                      </div>
                    </td>
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <span className={product.stock <= product.minStock ? 'low-stock-badge' : 'status-badge status-posted'}>
                        {product.stock}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {product.notes ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveNoteModal({ productName: `${baseName} (${variantLabel(product)})`, note: product.notes! });
                          }}
                          title={product.notes}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '4px',
                            padding: '2px 7px',
                            borderRadius: '6px',
                            fontSize: '0.74rem',
                            fontWeight: 700,
                            background: '#eff6ff',
                            color: '#1d4ed8',
                            border: '1px solid #bfdbfe',
                            cursor: 'pointer',
                            boxSizing: 'border-box',
                          }}
                        >
                          <FileTextIcon size={12} />
                          <span>{__t('products.products_table_card.s62', "ملاحظة")}</span>
                        </button>
                      ) : (
                        <span style={{ color: '#cbd5e1' }}>—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <div className="actions compact-actions" onClick={(event) => event.stopPropagation()} style={{ flexWrap: 'nowrap', justifyContent: 'center' }}>
                        <Button
                          variant="secondary"
                          type="button"
                          onClick={() => setActiveCardProduct(product)}
                          title={__t('products.products_table_card.card_btn_title', "عرض كارت الصنف وسجل الحركات التاريخية والمخزون")}
                          style={{
                            fontSize: '0.82rem',
                            fontWeight: 700,
                            color: '#170e5e',
                            borderColor: '#c7d2fe',
                            background: '#eef2ff',
                            padding: '5px 12px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            whiteSpace: 'nowrap',
                            borderRadius: '7px',
                          }}
                        >
                          <LayersIcon size={14} color="#170e5e" />
                          <span>{__t('products.products_table_card.card_btn', "كارت الصنف")}</span>
                        </Button>
                      </div>
                    </td>
                  </tr>
                )) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}
