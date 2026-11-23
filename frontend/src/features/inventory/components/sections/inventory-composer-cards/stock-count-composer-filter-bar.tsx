import { Button } from '@/shared/ui/button';
import { SearchIcon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';
import type { StockCountItem } from '@/types/domain';

export interface StockCountComposerFilterBarProps {
  items: StockCountItem[];
  t: ReturnType<typeof useTranslation>['t'];
  tableSearchQuery: string;
  setTableSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  tableFilterTab: 'all' | 'counted' | 'variance' | 'uncounted';
  setTableFilterTab: React.Dispatch<React.SetStateAction<'all' | 'counted' | 'variance' | 'uncounted'>>;
  countedCount: number;
  varianceItems: number;
  uncountedCount: number;
  pagination: {
    page: number;
    pageSize: number;
    pageSizeOptions: number[];
    totalItems: number;
    totalPages: number;
    rangeStart: number;
    rangeEnd: number;
    rows: StockCountItem[];
    hasPreviousPage: boolean;
    hasNextPage: boolean;
    goToPage: (nextPage: number) => void;
    setPageSize: (nextPageSize: number) => void;
    resetPagination: () => void;
  };
}

export function StockCountComposerFilterBar({ items, t, tableSearchQuery, setTableSearchQuery, tableFilterTab, setTableFilterTab, countedCount, varianceItems, uncountedCount, pagination }: StockCountComposerFilterBarProps) {
  return (
    <>
    {items.length > 3 ? (
      <div className="stock-count-table-filter-bar">
        <div className="stock-count-table-search-box">
          <span className="search-icon"><SearchIcon size={14} color="#94a3b8" /></span>
          <input
            type="text"
            className="table-search-input"
            placeholder={t('inventory.sections.inventory_composer_cards.s70', "ابحث في جدول الجلسة باسم الصنف أو الباركود...")}
            value={tableSearchQuery}
            onChange={(e) => setTableSearchQuery(e.target.value)}
          />
          {tableSearchQuery ? (
            <button type="button" className="clear-search-btn" onClick={() => setTableSearchQuery('')}>×</button>
          ) : null}
        </div>

        <div className="stock-count-filter-pills">
          <button
            type="button"
            className={`filter-pill-btn ${tableFilterTab === 'all' ? 'filter-pill-btn--active' : ''}`}
            onClick={() => setTableFilterTab('all')}
          >
            الكل ({items.length})
          </button>
          <button
            type="button"
            className={`filter-pill-btn ${tableFilterTab === 'counted' ? 'filter-pill-btn--active' : ''}`}
            onClick={() => setTableFilterTab('counted')}
          >
            تم عدها ({countedCount})
          </button>
          <button
            type="button"
            className={`filter-pill-btn ${tableFilterTab === 'variance' ? 'filter-pill-btn--active' : ''}`}
            onClick={() => setTableFilterTab('variance')}
          >
            فروقات ({varianceItems})
          </button>
          <button
            type="button"
            className={`filter-pill-btn ${tableFilterTab === 'uncounted' ? 'filter-pill-btn--active' : ''}`}
            onClick={() => setTableFilterTab('uncounted')}
          >
            لم تُعد ({uncountedCount})
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginRight: 'auto', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '11px', color: '#64748b' }}>لكل صفحة:</span>
            {[25, 50, 100].map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => pagination.setPageSize(size)}
                style={{
                  padding: '2px 7px',
                  fontSize: '11px',
                  fontWeight: '700',
                  borderRadius: '4px',
                  border: pagination.pageSize === size ? '1.5px solid #2563eb' : '1px solid #cbd5e1',
                  background: pagination.pageSize === size ? '#eff6ff' : '#ffffff',
                  color: pagination.pageSize === size ? '#1d4ed8' : '#64748b',
                  cursor: 'pointer',
                  transition: 'all 120ms ease',
                }}
              >
                {size}
              </button>
            ))}
          </div>

          {pagination.totalPages > 1 ? (
            <div className="stock-count-quick-pager" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', fontWeight: '600', color: '#64748b' }}>
                {t('pagination.page_of', 'صفحة {{page}} من {{totalPages}}', { page: pagination.page, totalPages: pagination.totalPages })}
              </span>
              <div style={{ display: 'flex', gap: '4px' }}>
                <Button variant="secondary" type="button" onClick={() => pagination.goToPage(pagination.page - 1)} disabled={!pagination.hasPreviousPage} style={{ padding: '3px 8px', fontSize: '11px', height: '28px', minHeight: '28px' }}>
                  {t('pagination.prev', 'السابق')}
                </Button>
                <Button variant="secondary" type="button" onClick={() => pagination.goToPage(pagination.page + 1)} disabled={!pagination.hasNextPage} style={{ padding: '3px 8px', fontSize: '11px', height: '28px', minHeight: '28px' }}>
                  {t('pagination.next', 'التالي')}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    ) : null}
    </>
  );
}
