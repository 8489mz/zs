import { useTranslation } from 'react-i18next';
import type { ShippingLine } from '../../api/maritime-freight.api';
import { AppIcons } from '@/shared/components/icons/AppIcons';

const TRADE_LANE_LABELS: Record<string, string> = {
  far_east: 'الصين والشرق الأقصى',
  europe_med: 'أوروبا والمتوسط',
  arabian_gulf: 'الخليج والبحر الأحمر',
  americas: 'الأمريكتين',
  africa: 'أفريقيا',
  indian_sub: 'الهند وجنوب آسيا',
  middle_east: 'الشرق الأوسط',
  black_sea: 'البحر الأسود',
};

interface MasterDataLinesTableProps {
  subTab: 'lines' | 'airlines' | 'agents' | 'ports' | 'airports' | 'standards';
  filteredLines: ShippingLine[];
  handleOpenEdit: (partner: ShippingLine) => void;
  handleCopyEmail: (email: string) => void;
}

export function MasterDataLinesTable({
  subTab,
  filteredLines,
  handleOpenEdit,
  handleCopyEmail,
}: MasterDataLinesTableProps) {
  const { t: __t } = useTranslation();
  return (
    <>
        {/* أ. جدول الخطوط الملاحية */}
        {subTab === 'lines' && (
          <div style={{ width: '100%', overflowX: 'auto', minHeight: '480px' }}>
            <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', textAlign: 'right', fontSize: '0.8125rem' }}>
              <colgroup>
                <col style={{ width: '10%' }} />
                <col style={{ width: '25%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '23%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '10%' }} />
              </colgroup>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 700, textAlign: 'center' }}>
                  <th style={{ padding: '12px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>{__t('maritime_freight.maritime_master_data_tab.s65', "كود الخط")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>{__t('maritime_freight.maritime_master_data_tab.s66', "اسم الخط الملاحي")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>{__t('maritime_freight.maritime_master_data_tab.s67', "مسارات الإبحار")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>{__t('maritime_freight.maritime_master_data_tab.s68', "إيميل التسعير والحجز")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>{__t('maritime_freight.maritime_master_data_tab.s69', "الهاتف والتواصل")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>{__t('maritime_freight.maritime_master_data_tab.s70', "الإجراءات")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredLines.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
                      {__t('maritime_freight.maritime_master_data_tab.s71', "لا توجد خطوط ملاحية مطابقة لمعايير البحث")}
                    </td>
                  </tr>
                ) : (
                  filteredLines.map((line) => (
                    <tr key={line.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '12px 14px', fontWeight: 800, color: '#170e5e', whiteSpace: 'nowrap' }}>
                        <span style={{ background: '#eff6ff', color: '#1d4ed8', padding: '3px 8px', borderRadius: '4px', fontSize: '0.78rem' }}>
                          {line.code}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', overflow: 'hidden' }}>
                        <div style={{ fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={line.name_ar}>
                          {line.name_ar}
                        </div>
                        <div style={{ fontSize: '0.74rem', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={line.name_en || ''}>
                          {line.name_en}
                        </div>
                        {line.trade_lanes && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '3px' }}>
                            {line.trade_lanes.split(',').slice(0, 2).map((lane: string) => {
                              const trimmed = lane.trim();
                              return (
                                <span
                                  key={trimmed}
                                  style={{
                                    fontSize: '0.66rem',
                                    fontWeight: 600,
                                    padding: '1px 5px',
                                    borderRadius: '4px',
                                    background: '#f1f5f9',
                                    color: '#475569',
                                    border: '1px solid #e2e8f0',
                                  }}
                                >
                                  {TRADE_LANE_LABELS[trimmed] || trimmed}
                                </span>
                              );
                            })}
                          </div>
                        )}
                        {(line.notes || line.services_offered) && (
                          <div style={{ fontSize: '0.68rem', color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '2px' }} title={line.notes || line.services_offered || undefined}>
                            {line.notes || line.services_offered}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', overflow: 'hidden' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {!line.trade_lanes ? (
                            <span style={{ color: '#94a3b8', fontSize: '0.74rem' }}>{__t('maritime_freight.maritime_master_data_tab.s72', "عالمي")}</span>
                          ) : (
                            line.trade_lanes.split(',').slice(0, 3).map((l) => (
                              <span
                                key={l}
                                style={{
                                  background: '#f1f5f9',
                                  color: '#334155',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  fontSize: '0.7rem',
                                  fontWeight: 600,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {TRADE_LANE_LABELS[l.trim()] || l}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '12px 14px', overflow: 'hidden', textAlign: 'left', direction: 'ltr' }}>
                        {line.rfq_email ? (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '6px', minWidth: 0, direction: 'ltr' }}>
                            <button
                              type="button"
                              onClick={() => handleCopyEmail(line.rfq_email!)}
                              title={__t('maritime_freight.maritime_master_data_tab.s73', "نسخ الإيميل")}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: '2px', flexShrink: 0, display: 'inline-flex', alignItems: 'center' }}
                            >
                              <AppIcons.Copy size={13} />
                            </button>
                            <span
                              style={{
                                fontWeight: 600,
                                color: '#1d4ed8',
                                fontSize: '0.8rem',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                direction: 'ltr',
                                textAlign: 'left',
                              }}
                              title={line.rfq_email}
                            >
                              {line.rfq_email}
                            </span>
                          </div>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>{__t('maritime_freight.maritime_master_data_tab.s74', "غير مسجل")}</span>
                        )}
                        {line.booking_email && (
                          <div
                            style={{
                              fontSize: '0.72rem',
                              color: '#64748b',
                              direction: 'ltr',
                              textAlign: 'left',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              marginTop: '2px',
                            }}
                            title={`حجز: ${line.booking_email}`}
                          >
                            booking: {line.booking_email}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', overflow: 'hidden', textAlign: 'left', direction: 'ltr' }}>
                        {line.phone ? (
                          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                            <a
                              href={`https://wa.me/${line.phone.replace(/[^\d]/g, '')}`}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                fontSize: '0.74rem',
                                color: '#15803d',
                                fontWeight: 700,
                                textDecoration: 'none',
                                direction: 'ltr',
                                textAlign: 'left',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                              title={__t('maritime_freight.maritime_master_data_tab.s75', "فتح محادثة واتساب")}
                            >
                              <span>{line.phone}</span>
                            </a>
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.76rem', color: '#94a3b8' }}>-</div>
                        )}
                        {line.contact_person && (
                          <div style={{ fontSize: '0.72rem', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'ltr', textAlign: 'left', marginTop: '2px' }}>
                            {line.contact_person}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(line)}
                          style={{
                            padding: '4px 10px',
                            background: '#f1f5f9',
                            color: '#170e5e',
                            border: '1px solid #e2e8f0',
                            borderRadius: '6px',
                            fontWeight: 600,
                            fontSize: '0.74rem',
                            cursor: 'pointer',
                          }}
                        >
                          {__t('maritime_freight.maritime_master_data_tab.s76', "تعديل")}
                        </button>
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
