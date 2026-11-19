import { useTranslation } from 'react-i18next';
import type { ContainerTypeSpec } from '../../api/maritime-freight.api';

export interface MasterDataContainersSectionProps {
  filteredContainers: ContainerTypeSpec[];
}

export function MasterDataContainersSection({ filteredContainers }: MasterDataContainersSectionProps) {
  const { t: __t } = useTranslation();

  return (
              <div>
                <div style={{ marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 800, color: '#0f172a' }}>
                      {__t('maritime_freight.maritime_master_data_tab.s112', "المواصفات الهندسية للحاويات القياسية (ISO 6346 Container Specifications)")}
                    </h4>
                    <p style={{ margin: '2px 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                      {__t('maritime_freight.maritime_master_data_tab.s113', "الأوزان القصوى، السعات الحجمية بالمتر المكعب (CBM)، والأبعاد الداخلية والخارجية المعتمدة دولياً")}
                    </p>
                  </div>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#170e5e', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '3px 10px', borderRadius: '12px' }}>
                    {filteredContainers.length} {__t('maritime_freight.maritime_master_data_tab.s114', "نوع حاوية")}
                  </span>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
                    gap: '14px',
                  }}
                >
                  {filteredContainers.map((c) => (
                    <div
                      key={c.code}
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
                      {/* هيدر كارت الحاوية */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span
                              style={{
                                fontWeight: 800,
                                fontSize: '0.88rem',
                                color: '#170e5e',
                                background: '#f1f5f9',
                                border: '1px solid #cbd5e1',
                                padding: '2px 8px',
                                borderRadius: '4px',
                              }}
                            >
                              {c.code}
                            </span>
                            <span style={{ fontWeight: 700, fontSize: '0.84rem', color: '#0f172a' }}>
                              {c.name_ar}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                            {c.name_en} ({c.length_feet} ft)
                          </div>
                        </div>

                        <span
                          style={{
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: '10px',
                            background:
                              c.category === 'dry'
                                ? '#f1f5f9'
                                : c.category === 'reefer'
                                ? '#eff6ff'
                                : '#fef3c7',
                            color:
                              c.category === 'dry'
                                ? '#334155'
                                : c.category === 'reefer'
                                ? '#1d4ed8'
                                : '#b45309',
                            border: `1px solid ${
                              c.category === 'dry'
                                ? '#cbd5e1'
                                : c.category === 'reefer'
                                ? '#bfdbfe'
                                : '#fde68a'
                            }`,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {c.category === 'dry'
                            ? __t('maritime_freight.maritime_master_data_tab.s115', "بضائع عامة جافة")
                            : c.category === 'reefer'
                            ? __t('maritime_freight.maritime_master_data_tab.s116', "مبردة ومجمدة")
                            : __t('maritime_freight.maritime_master_data_tab.s117', "تجهيز وتداول خاص")}
                        </span>
                      </div>

                      {/* مؤشرات السعة والأوزان */}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr 1fr',
                          gap: '6px',
                          background: '#f8fafc',
                          padding: '8px',
                          borderRadius: '6px',
                          border: '1px solid #f1f5f9',
                          textAlign: 'center',
                        }}
                      >
                        <div>
                          <div style={{ fontSize: '0.6875rem', color: '#64748b' }}>{__t('maritime_freight.maritime_master_data_tab.s118', "السعة (CBM)")}</div>
                          <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#0369a1', marginTop: '2px' }}>
                            {c.max_cbm} {__t('maritime_freight.maritime_master_data_tab.s119', "م³")}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: '0.6875rem', color: '#64748b' }}>{__t('maritime_freight.maritime_master_data_tab.s120', "أقصى حمولة")}</div>
                          <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#15803d', marginTop: '2px' }}>
                            {c.max_payload_kg.toLocaleString()} {__t('maritime_freight.maritime_master_data_tab.s121', "كجم")}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: '0.6875rem', color: '#64748b' }}>{__t('maritime_freight.maritime_master_data_tab.s122', "الوزن فارغ")}</div>
                          <div style={{ fontSize: '0.84rem', fontWeight: 700, color: '#475569', marginTop: '2px' }}>
                            {c.tare_weight_kg.toLocaleString()} {__t('maritime_freight.maritime_master_data_tab.s123', "كجم")}
                          </div>
                        </div>
                      </div>

                      {/* الأبعاد الهندسية */}
                      <div
                        style={{
                          fontSize: '0.74rem',
                          color: '#334155',
                          background: '#ffffff',
                          border: '1px solid #e2e8f0',
                          borderRadius: '6px',
                          padding: '6px 10px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '3px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#64748b' }}>{__t('maritime_freight.maritime_master_data_tab.s124', "الأبعاد الداخلية (ط × ع × ع):")}</span>
                          <span style={{ fontWeight: 600, direction: 'ltr' }}>
                            {c.internal_length_m} × {c.internal_width_m} × {c.internal_height_m} m
                          </span>
                        </div>
                        {c.door_width_m > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#64748b' }}>{__t('maritime_freight.maritime_master_data_tab.s125', "أبعاد فتحة الباب (ع × ع):")}</span>
                            <span style={{ fontWeight: 600, direction: 'ltr' }}>
                              {c.door_width_m} × {c.door_height_m} m
                            </span>
                          </div>
                        )}
                      </div>

                      {/* الوصف الفني للضبط المتوازي */}
                      <p
                        style={{
                          margin: 0,
                          fontSize: '0.75rem',
                          color: '#64748b',
                          textAlign: 'justify',
                          textJustify: 'inter-word',
                          textAlignLast: 'start',
                          lineHeight: 1.5,
                        }}
                      >
                        {c.description_ar}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
  );
}
