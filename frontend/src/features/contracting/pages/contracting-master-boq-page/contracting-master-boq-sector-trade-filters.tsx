import { AppIcons } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';
import type { MasterBoqItem } from '../../contracting.types';
import type { SectorDef } from './contracting-master-boq-shared';
import type { ReactNode } from 'react';

export interface ContractingMasterBoqSectorTradeFiltersProps {
  __t: ReturnType<typeof useTranslation>['t'];
  SECTORS: SectorDef[];
  selectedSector: string;
  sectorCounts: Record<string, number>;
  setSelectedSector: (val: string) => void;
  setSelectedTrade: (val: string) => void;
  selectedTrade: string;
  allItems: MasterBoqItem[];
  visibleTrades: { tradeCategory: string; tradeNameAr: string; itemsCount: number; }[];
  TRADE_ICONS: Record<string, (props: any) => ReactNode>;
}

export function ContractingMasterBoqSectorTradeFilters({ __t, SECTORS, selectedSector, sectorCounts, setSelectedSector, setSelectedTrade, selectedTrade, allItems, visibleTrades, TRADE_ICONS }: ContractingMasterBoqSectorTradeFiltersProps) {
  return (
    <>
    {/* شريط تصنيف وفلاتر التخصصات الهندسية المعتمدة — تصميم مؤسسي منظم ومريح للعين */}
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        padding: '16px 18px',
        marginBottom: '18px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
      }}
    >
      {/* 1. شريط القطاعات الهندسية الكبرى (Super-Tabs) — شبكة متناسقة تمتد بعرض الصفحة */}
      <div
        style={{
          paddingBottom: '14px',
          marginBottom: '14px',
          borderBottom: '1px solid #f1f5f9',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
          <AppIcons.Sliders size={16} color="#170e5e" />
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#1e293b' }}>
            {__t('contracting.contracting_master_boq_page.s19', "القطاعات الهندسية الرئيسية:")}
          </span>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '8px',
            width: '100%',
          }}
        >
          {SECTORS.map((sec) => {
            const isSecActive = selectedSector === sec.id;
            const SecIcon = sec.icon;
            const count = sectorCounts[sec.id] || 0;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => {
                  setSelectedSector(sec.id);
                  setSelectedTrade('all');
                }}
                style={{
                  height: '40px',
                  padding: '0 14px',
                  borderRadius: '8px',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  border: isSecActive ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
                  background: isSecActive ? '#170e5e' : '#f8fafc',
                  color: isSecActive ? '#ffffff' : '#334155',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  boxSizing: 'border-box',
                  boxShadow: isSecActive ? '0 2px 4px rgba(23, 14, 94, 0.12)' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <SecIcon size={15} color={isSecActive ? '#ffffff' : '#64748b'} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sec.name}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    background: isSecActive ? 'rgba(255,255,255,0.25)' : '#e2e8f0',
                    color: isSecActive ? '#ffffff' : '#334155',
                    fontWeight: 700,
                    flexShrink: 0,
                    marginInlineStart: '6px',
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. شرائح التخصصات التنفيذية المنظمة بدون أي تكرار — بحجم موحد وشبكة ممتدة بعرض الصفحة */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
          <AppIcons.Tool size={15} color="#170e5e" />
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#1e293b' }}>
            {__t('contracting.contracting_master_boq_page.s20', "التخصصات التنفيذية:")}
          </span>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
            gap: '8px',
            width: '100%',
          }}
        >
          {/* زر الكل داخل القطاع */}
          <button
            type="button"
            onClick={() => setSelectedTrade('all')}
            style={{
              height: '42px',
              padding: '0 14px',
              borderRadius: '8px',
              fontSize: '12.5px',
              fontWeight: 600,
              border: selectedTrade === 'all' ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
              background: selectedTrade === 'all' ? '#170e5e' : '#ffffff',
              color: selectedTrade === 'all' ? '#ffffff' : '#334155',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              boxSizing: 'border-box',
              boxShadow: selectedTrade === 'all' ? '0 2px 4px rgba(23, 14, 94, 0.15)' : '0 1px 2px rgba(0,0,0,0.02)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
              <AppIcons.Layers size={15} color={selectedTrade === 'all' ? '#ffffff' : '#64748b'} style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
                {selectedSector === 'all' ? __t('contracting.contracting_master_boq_page.s21', "كافة التخصصات") : `كافة بنود ${SECTORS.find(s => s.id === selectedSector)?.name || ''}`}
              </span>
            </div>
            <span
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '12px',
                background: selectedTrade === 'all' ? 'rgba(255,255,255,0.2)' : '#f1f5f9',
                color: selectedTrade === 'all' ? '#ffffff' : '#475569',
                fontWeight: 700,
                flexShrink: 0,
                marginInlineStart: '8px',
              }}
            >
              {selectedSector === 'all'
                ? allItems.length
                : sectorCounts[selectedSector] || 0}
            </span>
          </button>

          {visibleTrades.map((t) => {
            const isSelected = selectedTrade === t.tradeCategory;
            const TradeIcon = TRADE_ICONS[t.tradeCategory] || AppIcons.Tool;
            return (
              <button
                key={t.tradeCategory}
                type="button"
                onClick={() => setSelectedTrade(t.tradeCategory)}
                style={{
                  height: '42px',
                  padding: '0 14px',
                  borderRadius: '8px',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  border: isSelected ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                  background: isSelected ? '#170e5e' : '#ffffff',
                  color: isSelected ? '#ffffff' : '#334155',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  boxSizing: 'border-box',
                  boxShadow: isSelected ? '0 2px 4px rgba(23, 14, 94, 0.15)' : '0 1px 2px rgba(0,0,0,0.02)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                  <TradeIcon size={15} color={isSelected ? '#ffffff' : '#64748b'} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {t.tradeNameAr}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    background: isSelected ? 'rgba(255,255,255,0.2)' : '#f1f5f9',
                    color: isSelected ? '#ffffff' : '#475569',
                    fontWeight: 700,
                    flexShrink: 0,
                    marginInlineStart: '8px',
                  }}
                >
                  {t.itemsCount}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
    </>
  );
}
