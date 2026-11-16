// Van-itinerary pagination (P0) — pure move from VanItineraryTab.tsx (slice P0).
// VanItineraryPaginationProps + VanItineraryPagination (own useTranslation, early-return IF).
// The facade keeps the bottom-pagination render and passes startIdx, pageSize, totalCount, currentPage, totalPages, onPageChange, onPageSizeChange as props.

import React from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRightIcon, ArrowLeftIcon } from '@/shared/components/icons/AppIcons';

interface VanItineraryPaginationProps {
  startIdx: number;
  pageSize: number;
  totalCount: number;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export const VanItineraryPagination: React.FC<VanItineraryPaginationProps> = ({
  startIdx,
  pageSize,
  totalCount,
  currentPage,
  totalPages,
  onPageChange,
  onPageSizeChange,
}) => {
  const { t } = useTranslation();
  if (totalCount === 0 || totalPages <= 1) return null;

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#ffffff',
        borderRadius: '10px',
        padding: '5px 10px',
        border: '1px solid #e2e8f0',
        boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
        gap: '6px',
        flexWrap: 'nowrap',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* Right Cluster: Count & Page Size Selector */}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
        <span style={{ fontSize: '11px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap' }}>
          {startIdx + 1}-{Math.min(startIdx + pageSize, totalCount)}
          <span style={{ color: '#64748b', fontSize: '10.5px', fontWeight: 500, margin: '0 2px' }}>{t('delivery_reps.van_itinerary_tab.s0', "من")}</span>
          {totalCount}
        </span>

        <span style={{ width: '1px', height: '14px', backgroundColor: '#e2e8f0', margin: '0 1px' }} />

        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          title={t('delivery_reps.van_itinerary_tab.s1', "عدد العناصر المعروضة لكل صفحة")}
          style={{
            backgroundColor: '#f8fafc',
            border: '1px solid #cbd5e1',
            borderRadius: '6px',
            padding: '1px 5px',
            fontSize: '11px',
            fontWeight: 800,
            color: '#170e5e',
            cursor: 'pointer',
            outline: 'none',
            height: '25px',
          }}
        >
          <option value={10}>10</option>
          <option value={15}>15</option>
          <option value={20}>20</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
      </div>

      {/* Left Cluster: Page Navigation */}
      {totalCount > pageSize && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '2px',
              height: '25px',
              padding: '0 7px',
              borderRadius: '6px',
              border: '1px solid ' + (currentPage <= 1 ? '#e2e8f0' : '#cbd5e1'),
              backgroundColor: currentPage <= 1 ? '#f8fafc' : '#ffffff',
              color: currentPage <= 1 ? '#cbd5e1' : '#170e5e',
              fontSize: '10.5px',
              fontWeight: 800,
              cursor: currentPage <= 1 ? 'not-allowed' : 'pointer',
              boxShadow: currentPage <= 1 ? 'none' : '0 1px 2px rgba(0,0,0,0.03)',
            }}
          >
            <ArrowRightIcon size={11} />
            <span>{t('delivery_reps.van_itinerary_tab.s2', "السابق")}</span>
          </button>

          <span
            dir="ltr"
            style={{
              fontSize: '11px',
              fontWeight: 800,
              color: '#170e5e',
              minWidth: '32px',
              textAlign: 'center',
              userSelect: 'none',
              whiteSpace: 'nowrap',
              padding: '0 2px',
            }}
          >
            {currentPage} / {totalPages}
          </span>

          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '2px',
              height: '25px',
              padding: '0 7px',
              borderRadius: '6px',
              border: '1px solid ' + (currentPage >= totalPages ? '#e2e8f0' : '#cbd5e1'),
              backgroundColor: currentPage >= totalPages ? '#f8fafc' : '#ffffff',
              color: currentPage >= totalPages ? '#cbd5e1' : '#170e5e',
              fontSize: '10.5px',
              fontWeight: 800,
              cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer',
              boxShadow: currentPage >= totalPages ? 'none' : '0 1px 2px rgba(0,0,0,0.03)',
            }}
          >
            <span>{t('delivery_reps.van_itinerary_tab.s3', "التالي")}</span>
            <ArrowLeftIcon size={11} />
          </button>
        </div>
      )}
    </div>
  );
};
