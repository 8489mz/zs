import { useTranslation } from 'react-i18next';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import type { ShippingLine, ShippingPort } from '../../api/maritime-freight.api';

export type MasterDataSubTab = 'lines' | 'airlines' | 'agents' | 'ports' | 'airports' | 'standards';

export type MasterDataPartnerType = 'shipping_line' | 'overseas_agent' | 'airline' | 'trucking';

export interface MasterDataHeaderProps {
  subTab: MasterDataSubTab;
  shippingLinesList: ShippingLine[];
  airlinesList: ShippingLine[];
  overseasAgentsList: ShippingLine[];
  seaPortsList: ShippingPort[];
  airPortsList: ShippingPort[];
  isSeeding: boolean;
  handleSeedDefaults: () => void;
  exportMasterDataCsv: () => void;
  setImportModalOpen: (open: boolean) => void;
  handleOpenAdd: (type: MasterDataPartnerType) => void;
  showAddPortForm: boolean;
  setShowAddPortForm: (show: boolean) => void;
  setEditingPartner: (partner: ShippingLine | null) => void;
  setModalType: (type: MasterDataPartnerType) => void;
  setModalOpen: (open: boolean) => void;
}

export function MasterDataHeader({
  subTab,
  shippingLinesList,
  airlinesList,
  overseasAgentsList,
  seaPortsList,
  airPortsList,
  isSeeding,
  handleSeedDefaults,
  exportMasterDataCsv,
  setImportModalOpen,
  handleOpenAdd,
  showAddPortForm,
  setShowAddPortForm,
  setEditingPartner,
  setModalType,
  setModalOpen,
}: MasterDataHeaderProps) {
  const { t: __t } = useTranslation();

  return (
    <>
      {/* 1. هيدر الكارت الموحد القياسي */}
      <div
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid #e2e8f0',
          background: '#f8fafc',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: '0.94rem', fontWeight: 800, color: '#0f172a' }}>
            {__t('maritime_freight.maritime_master_data_tab.s0', "دليل الخطوط والوكلاء والموانئ (Shipping Lines, Agents & Ports)")}
          </h3>
          <p style={{ margin: '3px 0 0 0', fontSize: '0.78rem', color: '#64748b' }}>
            {__t('maritime_freight.maritime_master_data_tab.s1', "إدارة شاملة لخطوط الملاحة البحرية، شبكة وكلاء الشحن المعتمدين حول العالم، ودليل الموانئ الدولية")}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setImportModalOpen(true)}
            title={__t('maritime_freight.maritime_master_data_tab.s2', "استيراد جهات الاتصال وخطوط الشحن من ملف Excel أو CSV")}
            style={{
              height: '36px',
              padding: '0 12px',
              background: '#ffffff',
              color: '#334155',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              fontWeight: 700,
              fontSize: '0.78rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            }}
          >
            <AppIcons.FileSpreadsheet size={15} color="#0f766e" />
            <span>{__t('maritime_freight.maritime_master_data_tab.s3', "استيراد من Excel / CSV")}</span>
          </button>
          <button
            type="button"
            onClick={exportMasterDataCsv}
            title={__t('maritime_freight.maritime_master_data_tab.s4', "تصدير السجلات الحالية إلى ملف Excel أو CSV")}
            style={{
              height: '36px',
              padding: '0 12px',
              background: '#ffffff',
              color: '#334155',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              fontWeight: 700,
              fontSize: '0.78rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            }}
          >
            <AppIcons.FileSpreadsheet size={15} color="#15803d" />
            <span>{__t('maritime_freight.maritime_master_data_tab.s5', "تصدير إلى Excel / CSV")}</span>
          </button>

          <button
            type="button"
            onClick={handleSeedDefaults}
            disabled={isSeeding}
            title={__t('maritime_freight.maritime_master_data_tab.s6', "استعادة وتحديث الدليل القياسي لخطوط الملاحة وشركات الطيران والموانئ والمطارات")}
            style={{
              height: '36px',
              padding: '0 12px',
              background: '#ffffff',
              color: '#170e5e',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              fontWeight: 700,
              fontSize: '0.78rem',
              cursor: isSeeding ? 'not-allowed' : 'pointer',
              opacity: isSeeding ? 0.7 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            }}
          >
            <AppIcons.RotateCcw size={14} />
            <span>{isSeeding ? __t('maritime_freight.maritime_master_data_tab.s7', "جاري الاستعادة...") : __t('maritime_freight.maritime_master_data_tab.s8', "استعادة الدليل القياسي")}</span>
          </button>

          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              background: '#ffffff',
              color: '#475569',
              border: '1px solid #e2e8f0',
              padding: '4px 10px',
              borderRadius: '12px',
              whiteSpace: 'nowrap',
              minWidth: '95px',
              textAlign: 'center',
              display: 'inline-block',
            }}
          >
            {subTab === 'lines' && `${shippingLinesList.length} خط ملاحي`}
            {subTab === 'airlines' && `${airlinesList.length} شركة طيران`}
            {subTab === 'agents' && `${overseasAgentsList.length} وكيل شحن`}
            {subTab === 'ports' && `${seaPortsList.length} ميناء بحري`}
            {subTab === 'airports' && `${airPortsList.length} مطار شحن`}
            {subTab === 'standards' && __t('maritime_freight.maritime_master_data_tab.s9', "المواصفات القياسية")}
          </span>

          {subTab === 'lines' && (
            <button
              type="button"
              onClick={() => handleOpenAdd('shipping_line')}
              style={{
                height: '36px',
                padding: '0 14px',
                background: '#170e5e',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: '0.8125rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 4px rgba(23, 14, 94, 0.15)',
              }}
            >
              <AppIcons.Plus size={15} />
              <span>{__t('maritime_freight.maritime_master_data_tab.s10', "+ إضافة خط ملاحي")}</span>
            </button>
          )}

          {subTab === 'airlines' && (
            <button
              type="button"
              onClick={() => {
                setEditingPartner(null);
                setModalType('airline');
                setModalOpen(true);
              }}
              style={{
                height: '36px',
                padding: '0 14px',
                background: '#170e5e',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: '0.8125rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 4px rgba(23, 14, 94, 0.15)',
              }}
            >
              <AppIcons.Plus size={15} />
              <span>{__t('maritime_freight.maritime_master_data_tab.s11', "+ إضافة شركة طيران")}</span>
            </button>
          )}

          {subTab === 'agents' && (
            <button
              type="button"
              onClick={() => handleOpenAdd('overseas_agent')}
              style={{
                height: '36px',
                padding: '0 14px',
                background: '#170e5e',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: '0.8125rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 4px rgba(23, 14, 94, 0.15)',
              }}
            >
              <AppIcons.Plus size={15} />
              <span>{__t('maritime_freight.maritime_master_data_tab.s12', "+ إضافة وكيل خارجي")}</span>
            </button>
          )}

          {(subTab === 'ports' || subTab === 'airports') && (
            <button
              type="button"
              onClick={() => setShowAddPortForm(!showAddPortForm)}
              style={{
                height: '36px',
                padding: '0 14px',
                background: '#170e5e',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: '0.8125rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 4px rgba(23, 14, 94, 0.15)',
              }}
            >
              <AppIcons.Plus size={15} />
              <span>{showAddPortForm ? __t('maritime_freight.maritime_master_data_tab.s13', "إخفاء نموذج الإضافة") : subTab === 'airports' ? __t('maritime_freight.maritime_master_data_tab.s14', "+ إضافة مطار شحن") : __t('maritime_freight.maritime_master_data_tab.s15', "+ إضافة ميناء جديد")}</span>
            </button>
          )}
        </div>
      </div>
    </>
  );
}
