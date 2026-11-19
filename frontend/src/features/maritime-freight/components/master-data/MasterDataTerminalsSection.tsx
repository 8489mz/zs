import { useTranslation } from 'react-i18next';
import { PortTerminal } from '../../api/maritime-freight.api';

interface MasterDataTerminalsSectionProps {
  filteredTerminals: PortTerminal[];
}

export function MasterDataTerminalsSection({
  filteredTerminals,
}: MasterDataTerminalsSectionProps) {
  const { t: __t } = useTranslation();
  return (
              <div>
                <div style={{ marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 800, color: '#0f172a' }}>
                      {__t('maritime_freight.maritime_master_data_tab.s150', "محطات الحاويات واللوجستيات بالموانئ (Port Terminals)")}
                    </h4>
                    <p style={{ margin: '2px 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                      {__t('maritime_freight.maritime_master_data_tab.s151', "دليل محطات تداول الحاويات والبضائع بالموانئ المصرية والدولية والربط مع منظومة نافذة")}
                    </p>
                  </div>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#170e5e', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '3px 10px', borderRadius: '12px' }}>
                    {filteredTerminals.length} {__t('maritime_freight.maritime_master_data_tab.s152', "محطة")}
                  </span>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                    gap: '14px',
                  }}
                >
                  {filteredTerminals.map((t) => (
                    <div
                      key={t.code}
                      style={{
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '10px',
                        padding: '14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <span
                            style={{
                              fontWeight: 800,
                              fontSize: '0.84rem',
                              color: '#170e5e',
                              background: '#f8fafc',
                              border: '1px solid #e2e8f0',
                              padding: '2px 8px',
                              borderRadius: '4px',
                            }}
                          >
                            {t.code}
                          </span>
                          <div style={{ fontWeight: 700, fontSize: '0.84rem', color: '#0f172a', marginTop: '6px' }}>
                            {t.name_ar}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{t.name_en}</div>
                        </div>

                        <span
                          style={{
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: '10px',
                            background: '#eff6ff',
                            color: '#1d4ed8',
                            border: '1px solid #bfdbfe',
                          }}
                        >
                          {t.port_code}
                        </span>
                      </div>

                      <div style={{ fontSize: '0.75rem', color: '#334155' }}>
                        <span style={{ color: '#64748b' }}>{__t('maritime_freight.maritime_master_data_tab.s153', "المشغل:")} </span>
                        <strong>{t.terminal_operator}</strong>
                      </div>

                      {t.notes && (
                        <p
                          style={{
                            margin: 0,
                            fontSize: '0.74rem',
                            color: '#64748b',
                            background: '#f8fafc',
                            padding: '6px 10px',
                            borderRadius: '4px',
                            border: '1px solid #f1f5f9',
                            lineHeight: 1.45,
                          }}
                        >
                          {t.notes}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
  );
}
