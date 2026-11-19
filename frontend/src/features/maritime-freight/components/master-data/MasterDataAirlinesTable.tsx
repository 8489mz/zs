import { useTranslation } from 'react-i18next';
import { ShippingLine } from '../../api/maritime-freight.api';
import { AppIcons } from '@/shared/components/icons/AppIcons';

interface MasterDataAirlinesTableProps {
  subTab: 'lines' | 'airlines' | 'agents' | 'ports' | 'airports' | 'standards';
  filteredAirlines: ShippingLine[];
  handleOpenEdit: (partner: ShippingLine) => void;
  handleDeletePartner: (partner: ShippingLine) => void;
  handleCopyEmail: (email: string) => void;
}

export function MasterDataAirlinesTable({
  subTab,
  filteredAirlines,
  handleOpenEdit,
  handleDeletePartner,
  handleCopyEmail,
}: MasterDataAirlinesTableProps) {
  const { t: __t } = useTranslation();
  return (
    <>
        {/* أ2. جدول شركات الشحن الجوي */}
        {subTab === 'airlines' && (
          <div style={{ width: '100%', overflowX: 'auto', minHeight: '480px' }}>
            <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', textAlign: 'right', fontSize: '0.8125rem' }}>
              <colgroup>
                <col style={{ width: '12%' }} />
                <col style={{ width: '25%' }} />
                <col style={{ width: '25%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '10%' }} />
              </colgroup>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 700, textAlign: 'center' }}>
                  <th style={{ padding: '12px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>{__t('maritime_freight.maritime_master_data_tab.s77', "كود وبادئة AWB")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>{__t('maritime_freight.maritime_master_data_tab.s78', "شركة الطيران / الشحن الجوي")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>{__t('maritime_freight.maritime_master_data_tab.s79', "إيميل التسعير والحجز (RFQ)")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>{__t('maritime_freight.maritime_master_data_tab.s80', "الهاتف والتواصل")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>{__t('maritime_freight.maritime_master_data_tab.s81', "مسؤول الشحن")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>{__t('maritime_freight.maritime_master_data_tab.s82', "الإجراءات")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredAirlines.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
                      {__t('maritime_freight.maritime_master_data_tab.s83', "لا توجد شركات طيران مطابقة لمعايير البحث")}
                    </td>
                  </tr>
                ) : (
                  filteredAirlines.map((airline) => (
                    <tr key={airline.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '12px 14px', fontWeight: 800, color: '#0284c7', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'center' }}>
                          <span style={{ background: '#f0f9ff', color: '#0369a1', border: '1px solid #bae6fd', padding: '2px 8px', borderRadius: '4px', fontSize: '0.78rem' }}>
                            {airline.code}
                          </span>
                          {airline.airline_prefix && (
                            <span style={{ fontSize: '0.7rem', color: '#0284c7', fontWeight: 700 }}>
                              AWB: {airline.airline_prefix}
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '12px 14px', overflow: 'hidden' }}>
                        <div style={{ fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={airline.name_ar}>
                          {airline.name_ar}
                        </div>
                        {airline.name_en && (
                          <div style={{ fontSize: '0.74rem', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'ltr', textAlign: 'left', marginTop: '2px' }} title={airline.name_en}>
                            {airline.name_en}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', overflow: 'hidden', textAlign: 'left', direction: 'ltr' }}>
                        {airline.rfq_email ? (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '6px', minWidth: 0 }}>
                            <button
                              type="button"
                              onClick={() => handleCopyEmail(airline.rfq_email!)}
                              title={__t('maritime_freight.maritime_master_data_tab.s84', "نسخ إيميل التسعير")}
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: '#64748b',
                                padding: '2px',
                                flexShrink: 0,
                                display: 'inline-flex',
                                alignItems: 'center',
                              }}
                            >
                              <AppIcons.Copy size={13} />
                            </button>
                            <span
                              style={{
                                fontWeight: 600,
                                color: '#0369a1',
                                fontSize: '0.8rem',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                              title={airline.rfq_email}
                            >
                              {airline.rfq_email}
                            </span>
                          </div>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>-</span>
                        )}
                        {airline.booking_email && airline.booking_email !== airline.rfq_email && (
                          <div
                            style={{
                              fontSize: '0.72rem',
                              color: '#64748b',
                              marginTop: '3px',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                            title={airline.booking_email}
                          >
                            booking: {airline.booking_email}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', overflow: 'hidden', textAlign: 'left', direction: 'ltr' }}>
                        {airline.phone ? (
                          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                            <a
                              href={`https://wa.me/${airline.phone.replace(/[^\d]/g, '')}`}
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
                              title={__t('maritime_freight.maritime_master_data_tab.s85', "فتح محادثة واتساب")}
                            >
                              <span>{airline.phone}</span>
                            </a>
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.76rem', color: '#94a3b8' }}>-</div>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', overflow: 'hidden', textAlign: 'center' }}>
                        <span style={{ fontSize: '0.78rem', color: '#334155', fontWeight: 600 }}>
                          {airline.contact_person || '-'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', gap: '4px', justifyContent: 'center' }}>
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(airline)}
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
                            {__t('maritime_freight.maritime_master_data_tab.s86', "تعديل")}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeletePartner(airline)}
                            style={{
                              padding: '4px 8px',
                              background: '#fff1f2',
                              color: '#be123c',
                              border: '1px solid #fecdd3',
                              borderRadius: '6px',
                              fontWeight: 600,
                              fontSize: '0.74rem',
                              cursor: 'pointer',
                            }}
                          >
                            {__t('maritime_freight.maritime_master_data_tab.s87', "حذف")}
                          </button>
                        </div>
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
