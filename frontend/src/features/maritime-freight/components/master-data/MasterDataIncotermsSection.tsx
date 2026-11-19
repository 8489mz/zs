import { useTranslation } from 'react-i18next';
import type { IncotermRule } from '../../api/maritime-freight.api';

interface MasterDataIncotermsSectionProps {
  filteredIncoterms: IncotermRule[];
}

export function MasterDataIncotermsSection({ filteredIncoterms }: MasterDataIncotermsSectionProps) {
  const { t: __t } = useTranslation();
  return (
              <div>
                <div style={{ marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 800, color: '#0f172a' }}>
                      {__t('maritime_freight.maritime_master_data_tab.s126', "قواعد التجارة الدولية (Incoterms 2020 Rules)")}
                    </h4>
                    <p style={{ margin: '2px 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                      {__t('maritime_freight.maritime_master_data_tab.s127', "توزيع التكاليف ومسؤوليات الشحن والتأمين ونقاط انتقال المخاطر القانونية بين البائع والمشتري")}
                    </p>
                  </div>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#170e5e', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '3px 10px', borderRadius: '12px' }}>
                    {filteredIncoterms.length} {__t('maritime_freight.maritime_master_data_tab.s128', "قاعدة تجارية")}
                  </span>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
                    gap: '14px',
                  }}
                >
                  {filteredIncoterms.map((inc) => (
                    <div
                      key={inc.code}
                      style={{
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '10px',
                        padding: '14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                      }}
                    >
                      {/* هيدر القاعدة */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span
                              style={{
                                fontWeight: 800,
                                fontSize: '0.88rem',
                                color: '#170e5e',
                                background: '#eff6ff',
                                border: '1px solid #bfdbfe',
                                padding: '2px 8px',
                                borderRadius: '4px',
                              }}
                            >
                              {inc.code}
                            </span>
                            <span style={{ fontWeight: 700, fontSize: '0.84rem', color: '#0f172a' }}>
                              {inc.name_ar}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                            {inc.name_en}
                          </div>
                        </div>

                        <span
                          style={{
                            fontSize: '0.6875rem',
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: '10px',
                            background: inc.rule_type === 'sea_inland_waterway' ? '#f0fdf4' : '#f8fafc',
                            color: inc.rule_type === 'sea_inland_waterway' ? '#166534' : '#475569',
                            border: `1px solid ${inc.rule_type === 'sea_inland_waterway' ? '#bbf7d0' : '#e2e8f0'}`,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {inc.rule_type === 'sea_inland_waterway' ? __t('maritime_freight.maritime_master_data_tab.s129', "بحري ونهري فقط") : __t('maritime_freight.maritime_master_data_tab.s130', "متعدد الوسائط")}
                        </span>
                      </div>

                      {/* نقطة انتقال المخاطر */}
                      <div
                        style={{
                          background: '#f8fafc',
                          borderInlineStart: '3px solid #170e5e',
                          padding: '6px 10px',
                          borderRadius: '0 4px 4px 0',
                          fontSize: '0.74rem',
                          color: '#1e293b',
                        }}
                      >
                        <strong style={{ color: '#170e5e' }}>{__t('maritime_freight.maritime_master_data_tab.s131', "نقطة انتقال المسؤولية:")} </strong>
                        <span>{inc.risk_transfer_point_ar}</span>
                      </div>

                      {/* جدول المسؤوليات والتكاليف */}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: '6px',
                          fontSize: '0.72rem',
                        }}
                      >
                        <div
                          style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            background: inc.seller_pays_export_customs ? '#f0fdf4' : '#f8fafc',
                            border: `1px solid ${inc.seller_pays_export_customs ? '#bbf7d0' : '#e2e8f0'}`,
                            display: 'flex',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span style={{ color: '#475569' }}>{__t('maritime_freight.maritime_master_data_tab.s132', "جمارك التصدير:")}</span>
                          <strong style={{ color: inc.seller_pays_export_customs ? '#166534' : '#64748b' }}>
                            {inc.seller_pays_export_customs ? __t('maritime_freight.maritime_master_data_tab.s133', "البائع") : __t('maritime_freight.maritime_master_data_tab.s134', "المشتري")}
                          </strong>
                        </div>

                        <div
                          style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            background: inc.seller_pays_origin_thc ? '#f0fdf4' : '#f8fafc',
                            border: `1px solid ${inc.seller_pays_origin_thc ? '#bbf7d0' : '#e2e8f0'}`,
                            display: 'flex',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span style={{ color: '#475569' }}>{__t('maritime_freight.maritime_master_data_tab.s135', "شحن المغادرة THC:")}</span>
                          <strong style={{ color: inc.seller_pays_origin_thc ? '#166534' : '#64748b' }}>
                            {inc.seller_pays_origin_thc ? __t('maritime_freight.maritime_master_data_tab.s136', "البائع") : __t('maritime_freight.maritime_master_data_tab.s137', "المشتري")}
                          </strong>
                        </div>

                        <div
                          style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            background: inc.seller_pays_ocean_freight ? '#f0fdf4' : '#f8fafc',
                            border: `1px solid ${inc.seller_pays_ocean_freight ? '#bbf7d0' : '#e2e8f0'}`,
                            display: 'flex',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span style={{ color: '#475569' }}>{__t('maritime_freight.maritime_master_data_tab.s138', "نولون الشحن البحري:")}</span>
                          <strong style={{ color: inc.seller_pays_ocean_freight ? '#166534' : '#64748b' }}>
                            {inc.seller_pays_ocean_freight ? __t('maritime_freight.maritime_master_data_tab.s139', "البائع") : __t('maritime_freight.maritime_master_data_tab.s140', "المشتري")}
                          </strong>
                        </div>

                        <div
                          style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            background: inc.seller_pays_destination_thc ? '#f0fdf4' : '#f8fafc',
                            border: `1px solid ${inc.seller_pays_destination_thc ? '#bbf7d0' : '#e2e8f0'}`,
                            display: 'flex',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span style={{ color: '#475569' }}>{__t('maritime_freight.maritime_master_data_tab.s141', "شحن الوصول THC:")}</span>
                          <strong style={{ color: inc.seller_pays_destination_thc ? '#166534' : '#64748b' }}>
                            {inc.seller_pays_destination_thc ? __t('maritime_freight.maritime_master_data_tab.s142', "البائع") : __t('maritime_freight.maritime_master_data_tab.s143', "المشتري")}
                          </strong>
                        </div>

                        <div
                          style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            background: inc.seller_pays_insurance ? '#eff6ff' : '#f8fafc',
                            border: `1px solid ${inc.seller_pays_insurance ? '#bfdbfe' : '#e2e8f0'}`,
                            display: 'flex',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span style={{ color: '#475569' }}>{__t('maritime_freight.maritime_master_data_tab.s144', "التأمين البحري:")}</span>
                          <strong style={{ color: inc.seller_pays_insurance ? '#1d4ed8' : '#64748b' }}>
                            {inc.seller_pays_insurance ? __t('maritime_freight.maritime_master_data_tab.s145', "البائع") : __t('maritime_freight.maritime_master_data_tab.s146', "المشتري")}
                          </strong>
                        </div>

                        <div
                          style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            background: inc.seller_pays_import_customs ? '#f0fdf4' : '#f8fafc',
                            border: `1px solid ${inc.seller_pays_import_customs ? '#bbf7d0' : '#e2e8f0'}`,
                            display: 'flex',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span style={{ color: '#475569' }}>{__t('maritime_freight.maritime_master_data_tab.s147', "جمارك الاستيراد:")}</span>
                          <strong style={{ color: inc.seller_pays_import_customs ? '#166534' : '#64748b' }}>
                            {inc.seller_pays_import_customs ? __t('maritime_freight.maritime_master_data_tab.s148', "البائع") : __t('maritime_freight.maritime_master_data_tab.s149', "المشتري")}
                          </strong>
                        </div>
                      </div>

                      {/* الوصف */}
                      <p
                        style={{
                          margin: 0,
                          fontSize: '0.74rem',
                          color: '#64748b',
                          textAlign: 'justify',
                          textJustify: 'inter-word',
                          textAlignLast: 'start',
                          lineHeight: 1.5,
                        }}
                      >
                        {inc.description_ar}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
  );
}
