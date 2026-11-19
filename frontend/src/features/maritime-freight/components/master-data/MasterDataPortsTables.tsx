import { useTranslation } from 'react-i18next';
import { ShippingPort } from '../../api/maritime-freight.api';

interface MasterDataPortsTablesProps {
  subTab: 'lines' | 'airlines' | 'agents' | 'ports' | 'airports' | 'standards';
  filteredPorts: ShippingPort[];
  filteredAirports: ShippingPort[];
}

export function MasterDataPortsTables({
  subTab,
  filteredPorts,
  filteredAirports,
}: MasterDataPortsTablesProps) {
  const { t: __t } = useTranslation();
  return (
    <>
        {/* ج. جدول الموانئ البحرية */}
        {subTab === 'ports' && (
          <div style={{ width: '100%', overflowX: 'auto', minHeight: '480px' }}>
            <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', textAlign: 'right', fontSize: '0.8125rem' }}>
              <colgroup>
                <col style={{ width: '15%' }} />
                <col style={{ width: '35%' }} />
                <col style={{ width: '30%' }} />
                <col style={{ width: '20%' }} />
              </colgroup>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 700 }}>
                  <th style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>{__t('maritime_freight.maritime_master_data_tab.s101', "كود UN/LOCODE")}</th>
                  <th style={{ padding: '12px 14px' }}>{__t('maritime_freight.maritime_master_data_tab.s102', "الاسم بالعربية")}</th>
                  <th style={{ padding: '12px 14px' }}>{__t('maritime_freight.maritime_master_data_tab.s103', "الاسم بالإنجليزية")}</th>
                  <th style={{ padding: '12px 14px' }}>{__t('maritime_freight.maritime_master_data_tab.s104', "الدولة والرمز")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredPorts.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
                      {__t('maritime_freight.maritime_master_data_tab.s105', "لا توجد موانئ مطابقة لبحثك")}
                    </td>
                  </tr>
                ) : (
                  filteredPorts.map((p) => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '12px 14px', fontWeight: 800, color: '#170e5e', whiteSpace: 'nowrap' }}>
                        <span style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '3px 8px', borderRadius: '4px' }}>
                          {p.code}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.name_ar}
                      </td>
                      <td style={{ padding: '12px 14px', color: '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.name_en}
                      </td>
                      <td style={{ padding: '12px 14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <span style={{ fontWeight: 600, color: '#1e293b' }}>{p.country_name}</span>
                        <span style={{ color: '#64748b', fontSize: '0.74rem', marginInlineStart: '6px' }}>({p.country_code})</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ج2. جدول مطارات الشحن الدولية */}
        {subTab === 'airports' && (
          <div style={{ width: '100%', overflowX: 'auto', minHeight: '480px' }}>
            <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', textAlign: 'right', fontSize: '0.8125rem' }}>
              <colgroup>
                <col style={{ width: '15%' }} />
                <col style={{ width: '35%' }} />
                <col style={{ width: '30%' }} />
                <col style={{ width: '20%' }} />
              </colgroup>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 700 }}>
                  <th style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>{__t('maritime_freight.maritime_master_data_tab.s106', "كود IATA / ICAO")}</th>
                  <th style={{ padding: '12px 14px' }}>{__t('maritime_freight.maritime_master_data_tab.s107', "اسم المطار بالعربية")}</th>
                  <th style={{ padding: '12px 14px' }}>{__t('maritime_freight.maritime_master_data_tab.s108', "الاسم بالإنجليزية")}</th>
                  <th style={{ padding: '12px 14px' }}>{__t('maritime_freight.maritime_master_data_tab.s109', "الدولة والرمز")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredAirports.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
                      {__t('maritime_freight.maritime_master_data_tab.s110', "لا توجد مطارات شحن مطابقة لبحثك")}
                    </td>
                  </tr>
                ) : (
                  filteredAirports.map((p) => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '12px 14px', fontWeight: 800, color: '#0284c7', whiteSpace: 'nowrap' }}>
                        <span style={{ background: '#f0f9ff', border: '1px solid #bae6fd', padding: '3px 8px', borderRadius: '4px' }}>
                          {p.iata_code || p.code}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.name_ar}
                      </td>
                      <td style={{ padding: '12px 14px', color: '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.name_en}
                      </td>
                      <td style={{ padding: '12px 14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <span style={{ fontWeight: 600, color: '#1e293b' }}>{p.country_name}</span>
                        <span style={{ color: '#64748b', fontSize: '0.74rem', marginInlineStart: '6px' }}>({p.country_code})</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
    </>
  );
}
