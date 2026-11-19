import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import type { ShippingLine, ShippingPort } from '../../api/maritime-freight.api';

export type MasterDataSubTab = 'lines' | 'airlines' | 'agents' | 'ports' | 'airports' | 'standards';

interface MasterDataTabsBarProps {
  subTab: MasterDataSubTab;
  setSubTab: Dispatch<SetStateAction<MasterDataSubTab>>;
  enableSeaFreight: boolean;
  enableAirFreight: boolean;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  setSelectedLane: Dispatch<SetStateAction<string>>;
  setSelectedCountry: Dispatch<SetStateAction<string>>;
  shippingLinesList: ShippingLine[];
  airlinesList: ShippingLine[];
  overseasAgentsList: ShippingLine[];
  seaPortsList: ShippingPort[];
  airPortsList: ShippingPort[];
}

export function MasterDataTabsBar({
  subTab,
  setSubTab,
  enableSeaFreight,
  enableAirFreight,
  setSearchQuery,
  setSelectedLane,
  setSelectedCountry,
  shippingLinesList,
  airlinesList,
  overseasAgentsList,
  seaPortsList,
  airPortsList,
}: MasterDataTabsBarProps) {
  const { t: __t } = useTranslation();
  return (
    <>
      {/* 2. شريط التبويبات المتكامل داخل الكارت */}
      <div
        style={{
          background: '#f8fafc',
          borderBottom: '1px solid #e2e8f0',
          padding: '6px 12px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
          alignItems: 'center',
          minHeight: '44px',
          boxSizing: 'border-box',
        }}
      >
        {enableSeaFreight && (
          <button
            type="button"
            onClick={() => {
              setSubTab('lines');
              setSearchQuery('');
              setSelectedLane('all');
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '5px',
              height: '32px',
              padding: '0 10px',
              borderRadius: '6px',
              border: subTab === 'lines' ? '1.5px solid #170e5e' : '1.5px solid #cbd5e1',
              background: subTab === 'lines' ? '#170e5e' : '#ffffff',
              color: subTab === 'lines' ? '#ffffff' : '#334155',
              fontWeight: 700,
              fontSize: '0.78rem',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <AppIcons.Ship size={14} />
            <span>{__t('maritime_freight.maritime_master_data_tab.s16', "الخطوط الملاحية (")}{shippingLinesList.length})</span>
          </button>
        )}

        {enableAirFreight && (
          <button
            type="button"
            onClick={() => {
              setSubTab('airlines');
              setSearchQuery('');
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '5px',
              height: '32px',
              padding: '0 10px',
              borderRadius: '6px',
              border: subTab === 'airlines' ? '1.5px solid #170e5e' : '1.5px solid #cbd5e1',
              background: subTab === 'airlines' ? '#170e5e' : '#ffffff',
              color: subTab === 'airlines' ? '#ffffff' : '#334155',
              fontWeight: 700,
              fontSize: '0.78rem',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <AppIcons.Plane size={14} />
            <span>{__t('maritime_freight.maritime_master_data_tab.s17', "شركات الطيران (")}{airlinesList.length})</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            setSubTab('agents');
            setSearchQuery('');
            setSelectedCountry('all');
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '5px',
            height: '32px',
            padding: '0 10px',
            borderRadius: '6px',
            border: subTab === 'agents' ? '1.5px solid #170e5e' : '1.5px solid #cbd5e1',
            background: subTab === 'agents' ? '#170e5e' : '#ffffff',
            color: subTab === 'agents' ? '#ffffff' : '#334155',
            fontWeight: 700,
            fontSize: '0.78rem',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <AppIcons.Users size={14} />
          <span>{__t('maritime_freight.maritime_master_data_tab.s18', "وكلاء الشحن (")}{overseasAgentsList.length})</span>
        </button>

        {enableSeaFreight && (
          <button
            type="button"
            onClick={() => {
              setSubTab('ports');
              setSearchQuery('');
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '5px',
              height: '32px',
              padding: '0 10px',
              borderRadius: '6px',
              border: subTab === 'ports' ? '1.5px solid #170e5e' : '1.5px solid #cbd5e1',
              background: subTab === 'ports' ? '#170e5e' : '#ffffff',
              color: subTab === 'ports' ? '#ffffff' : '#334155',
              fontWeight: 700,
              fontSize: '0.78rem',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <AppIcons.Globe size={14} />
            <span>{__t('maritime_freight.maritime_master_data_tab.s19', "الموانئ البحرية (")}{seaPortsList.length})</span>
          </button>
        )}

        {enableAirFreight && (
          <button
            type="button"
            onClick={() => {
              setSubTab('airports');
              setSearchQuery('');
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '5px',
              height: '32px',
              padding: '0 10px',
              borderRadius: '6px',
              border: subTab === 'airports' ? '1.5px solid #170e5e' : '1.5px solid #cbd5e1',
              background: subTab === 'airports' ? '#170e5e' : '#ffffff',
              color: subTab === 'airports' ? '#ffffff' : '#334155',
              fontWeight: 700,
              fontSize: '0.78rem',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <AppIcons.Plane size={14} />
            <span>{__t('maritime_freight.maritime_master_data_tab.s20', "مطارات الشحن (")}{airPortsList.length})</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            setSubTab('standards');
            setSearchQuery('');
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '5px',
            height: '32px',
            padding: '0 10px',
            borderRadius: '6px',
            border: subTab === 'standards' ? '1.5px solid #170e5e' : '1.5px solid #cbd5e1',
            background: subTab === 'standards' ? '#170e5e' : '#ffffff',
            color: subTab === 'standards' ? '#ffffff' : '#334155',
            fontWeight: 700,
            fontSize: '0.78rem',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <AppIcons.Container size={14} />
          <span>{__t('maritime_freight.maritime_master_data_tab.s21', "المواصفات و Incoterms")}</span>
        </button>
      </div>
    </>
  );
}
