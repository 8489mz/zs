import React from 'react';
import { useTranslation } from 'react-i18next';
import { SearchIcon, XIcon } from '@/shared/components/icons/AppIcons';

interface CatalogSearchBarProps {
  searchCatalogQuery: string;
  setSearchCatalogQuery: React.Dispatch<React.SetStateAction<string>>;
}

export const CatalogSearchBar: React.FC<CatalogSearchBarProps> = ({
  searchCatalogQuery,
  setSearchCatalogQuery,
}) => {
  const { t } = useTranslation();

  return (
    <>
          {/* CATALOG SEARCH BAR */}
          <div style={{ position: 'relative', width: '100%' }}>
            <input
              type="text"
              placeholder={t('delivery_reps.van_pre_sales_tab.s14', "ابحث بالاسم أو الباركود في المخزن الرئيسي...")}
              value={searchCatalogQuery}
              onChange={(e) => setSearchCatalogQuery(e.target.value)}
              style={{
                width: '100%',
                height: '38px',
                padding: searchCatalogQuery ? '0 32px 0 32px' : '0 32px 0 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '12.5px',
                boxSizing: 'border-box',
                backgroundColor: '#ffffff',
                outline: 'none',
              }}
            />
            <SearchIcon
              size={15}
              color="#94a3b8"
              style={{
                position: 'absolute',
                right: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                pointerEvents: 'none',
              }}
            />
            {searchCatalogQuery && (
              <button
                type="button"
                onClick={() => setSearchCatalogQuery('')}
                style={{
                  position: 'absolute',
                  left: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: '#f1f5f9',
                  border: 'none',
                  borderRadius: '50%',
                  width: '22px',
                  height: '22px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: '#64748b',
                  padding: 0,
                }}
                title={t('delivery_reps.van_pre_sales_tab.s15', "مسح البحث")}
              >
                <XIcon size={13} />
              </button>
            )}
          </div>
    </>
  );
};
