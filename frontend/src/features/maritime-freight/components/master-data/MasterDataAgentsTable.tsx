import { useTranslation } from 'react-i18next';
import { ShippingLine } from '../../api/maritime-freight.api';
import { AppIcons } from '@/shared/components/icons/AppIcons';

interface MasterDataAgentsTableProps {
  subTab: 'lines' | 'airlines' | 'agents' | 'ports' | 'airports' | 'standards';
  filteredAgents: ShippingLine[];
  handleOpenEdit: (partner: ShippingLine) => void;
  handleDeletePartner: (partner: ShippingLine) => void;
  handleCopyEmail: (email: string) => void;
}

export function MasterDataAgentsTable({
  subTab,
  filteredAgents,
  handleOpenEdit,
  handleDeletePartner,
  handleCopyEmail,
}: MasterDataAgentsTableProps) {
  const { t: __t } = useTranslation();
  return (
    <>
        {/* ب. جدول وكلاء الشحن الدوليين بالخارج */}
        {subTab === 'agents' && (
          <div style={{ width: '100%', overflowX: 'auto', minHeight: '480px' }}>
            <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', textAlign: 'right', fontSize: '0.8125rem' }}>
              <colgroup>
                <col style={{ width: '11%' }} />
                <col style={{ width: '25%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '22%' }} />
                <col style={{ width: '12%' }} />
              </colgroup>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 700, textAlign: 'center' }}>
                  <th style={{ padding: '12px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>{__t('maritime_freight.maritime_master_data_tab.s88', "كود الوكيل")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>{__t('maritime_freight.maritime_master_data_tab.s89', "اسم الشركة الوكيلة")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>{__t('maritime_freight.maritime_master_data_tab.s90', "الدولة والمدينة")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>{__t('maritime_freight.maritime_master_data_tab.s91', "مسؤول التسعير والتواصل")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>{__t('maritime_freight.maritime_master_data_tab.s92', "البريد الإلكتروني (RFQ)")}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>{__t('maritime_freight.maritime_master_data_tab.s93', "الإجراءات")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredAgents.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
                      {__t('maritime_freight.maritime_master_data_tab.s94', "لا يوجد وكلاء شحن مسجلون في هذه الدولة حالياً")}
                    </td>
                  </tr>
                ) : (
                  filteredAgents.map((agent) => (
                    <tr key={agent.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '12px 14px', fontWeight: 800, color: '#170e5e', whiteSpace: 'nowrap' }}>
                        <span style={{ background: '#f0fdf4', color: '#166534', padding: '3px 8px', borderRadius: '4px', fontSize: '0.78rem' }}>
                          {agent.code}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', overflow: 'hidden' }}>
                        <div style={{ fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'rtl', textAlign: 'right' }} title={agent.name_ar}>
                          {agent.name_ar}
                        </div>
                        {agent.name_en && (
                          <div style={{ fontSize: '0.74rem', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'ltr', textAlign: 'left', marginTop: '2px' }} title={agent.name_en}>
                            {agent.name_en}
                          </div>
                        )}
                        {agent.services_offered && (
                          <div style={{ fontSize: '0.68rem', color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'ltr', textAlign: 'left', marginTop: '2px' }} title={agent.services_offered}>
                            {agent.services_offered}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', overflow: 'hidden' }}>
                        <div style={{ fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'rtl', textAlign: 'right' }}>
                          {agent.country_name || __t('maritime_freight.maritime_master_data_tab.s95', "غير محدد")}
                        </div>
                        {agent.city_name && (
                          <div style={{ fontSize: '0.74rem', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'rtl', textAlign: 'right', marginTop: '2px' }}>
                            {__t('maritime_freight.maritime_master_data_tab.s96', "مدينة:")} {agent.city_name}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', overflow: 'hidden', textAlign: 'left', direction: 'ltr' }}>
                        <div
                          style={{
                            color: '#0369a1',
                            fontWeight: 600,
                            fontSize: '0.78rem',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            direction: 'ltr',
                            textAlign: 'left',
                          }}
                          title={agent.contact_person || ''}
                        >
                          {agent.contact_person || '-'}
                        </div>
                        {agent.whatsapp && (
                          <div style={{ marginTop: '3px', display: 'flex', justifyContent: 'flex-start' }}>
                            <a
                              href={`https://wa.me/${agent.whatsapp.replace(/[^\d]/g, '')}`}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                fontSize: '0.72rem',
                                color: '#15803d',
                                fontWeight: 700,
                                textDecoration: 'none',
                                background: '#f0fdf4',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                border: '1px solid #bbf7d0',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px',
                                direction: 'ltr',
                                textAlign: 'left',
                              }}
                              title={__t('maritime_freight.maritime_master_data_tab.s97', "فتح محادثة واتساب فورية")}
                            >
                              WA: {agent.whatsapp}
                            </a>
                          </div>
                        )}
                        {agent.wechat && !agent.whatsapp && (
                          <div
                            style={{
                              fontSize: '0.72rem',
                              color: '#0284c7',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              direction: 'ltr',
                              textAlign: 'left',
                              marginTop: '2px',
                            }}
                          >
                            WeChat: {agent.wechat}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', overflow: 'hidden', textAlign: 'left', direction: 'ltr' }}>
                        {agent.rfq_email ? (
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'flex-start',
                              gap: '6px',
                              minWidth: 0,
                              direction: 'ltr',
                              textAlign: 'left',
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => handleCopyEmail(agent.rfq_email!)}
                              title={__t('maritime_freight.maritime_master_data_tab.s98', "نسخ الإيميل")}
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
                                color: '#1d4ed8',
                                fontSize: '0.8rem',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                direction: 'ltr',
                                textAlign: 'left',
                              }}
                              title={agent.rfq_email}
                            >
                              {agent.rfq_email}
                            </span>
                          </div>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>-</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', gap: '4px', justifyContent: 'center' }}>
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(agent)}
                            style={{
                              padding: '4px 8px',
                              background: '#f1f5f9',
                              color: '#170e5e',
                              border: '1px solid #e2e8f0',
                              borderRadius: '6px',
                              fontWeight: 600,
                              fontSize: '0.74rem',
                              cursor: 'pointer',
                            }}
                          >
                            {__t('maritime_freight.maritime_master_data_tab.s99', "تعديل")}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeletePartner(agent)}
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
                            {__t('maritime_freight.maritime_master_data_tab.s100', "حذف")}
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
