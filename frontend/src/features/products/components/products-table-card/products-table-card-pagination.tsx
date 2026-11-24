import { PaginationControls } from '@/shared/components/pagination-controls';
import type { useTranslation } from 'react-i18next';

export interface ProductsTableCardPaginationProps {
  page: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
  rangeStart: number;
  rangeEnd: number;
  onPageChange: (value: number) => void;
  onPageSizeChange: (value: number) => void;
  __t: ReturnType<typeof useTranslation>['t'];
}

export function ProductsTableCardPagination({ page, totalPages, pageSize, totalItems, rangeStart, rangeEnd, onPageChange, onPageSizeChange, __t }: ProductsTableCardPaginationProps) {
  return (
    <PaginationControls
      page={page}
      totalPages={totalPages}
      pageSize={pageSize}
      totalItems={totalItems}
      rangeStart={rangeStart}
      rangeEnd={rangeEnd}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      itemLabel={__t('products.products_table_card.s71', "صنف")}
    />
  );
}
