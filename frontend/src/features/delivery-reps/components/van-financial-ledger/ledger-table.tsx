import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { CheckCircleIcon, CheckIcon } from '@/shared/components/icons/AppIcons';
import type { VanRepFinancialSettlementItem } from '../../api/van-sales.api';
import { getEntryTypeBadge, getStatusBadge } from './ledger-badges';

export interface LedgerTableProps {
  allReps: { id: number; name: string; phone?: string; vehicle_plate?: string }[];
  displayItems: VanRepFinancialSettlementItem[];
  handleToggleItem: (id: number) => void;
  handleToggleSelectAll: () => void;
  isLoading: boolean;
  selectedIds: number[];
  selectedRepId: string;
  setIsPushPayrollOpen: Dispatch<SetStateAction<boolean>>;
  setLinkingRep: Dispatch<SetStateAction<{ repId: number; repName: string; employeeId: number | null } | null>>;
  setSelectedCandidateEmployeeId: Dispatch<SetStateAction<string>>;
  setSelectedIds: Dispatch<SetStateAction<number[]>>;
  setSelectedRepId: Dispatch<SetStateAction<string>>;
  setSettleMethod: Dispatch<SetStateAction<'cash' | 'waiver'>>;
  setSettleModalItem: Dispatch<SetStateAction<VanRepFinancialSettlementItem | null>>;
  setSettleNotes: Dispatch<SetStateAction<string>>;
  setSettlePin: Dispatch<SetStateAction<string>>;
}

export function LedgerTable({
  allReps,
  displayItems,
  handleToggleItem,
  handleToggleSelectAll,
  isLoading,
  selectedIds,
  selectedRepId,
  setIsPushPayrollOpen,
  setLinkingRep,
  setSelectedCandidateEmployeeId,
  setSelectedIds,
  setSelectedRepId,
  setSettleMethod,
  setSettleModalItem,
  setSettleNotes,
  setSettlePin,
}: LedgerTableProps) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        overflow: 'hidden',
        boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid #e2e8f0',
          backgroundColor: '#f8fafc',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '3px', height: '14px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
          <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
            {t('delivery_reps.van_financial_ledger_admin_tab.s37', "سجل حركات العجوزات والعهد والعمولات (")}{displayItems.length} {t('delivery_reps.van_financial_ledger_admin_tab.s38', "حركة)")}
          </h4>
          {selectedRepId && (
            <span
              style={{
                fontSize: '11px',
                backgroundColor: '#eef2ff',
                color: '#170e5e',
                border: '1px solid #c7d2fe',
                borderRadius: '4px',
                padding: '1px 8px',
                fontWeight: 700,
              }}
            >
              {t('delivery_reps.van_financial_ledger_admin_tab.s39', "المندوب:")} {allReps.find((r) => String(r.id) === selectedRepId)?.name || `#${selectedRepId}`}
            </span>
          )}
        </div>

        {selectedRepId && (
          <button
            type="button"
            onClick={() => setSelectedRepId('')}
            style={{
              background: 'none',
              border: 'none',
              color: '#64748b',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {t('delivery_reps.van_financial_ledger_admin_tab.s40', "عرض كافة المناديب ✕")}
          </button>
        )}
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#64748b', fontSize: '13px' }}>
          {t('delivery_reps.van_financial_ledger_admin_tab.s41', "جاري تحميل حركات المركز المالي...")}
        </div>
      ) : displayItems.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#64748b' }}>
          <CheckCircleIcon size={36} color="#16a34a" style={{ margin: '0 auto 8px', display: 'block' }} />
          <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
            {t('delivery_reps.van_financial_ledger_admin_tab.s42', "لا توجد حركات مالية مطابقة للفلتر المحدد")}
          </div>
          <div style={{ fontSize: '12px', color: '#94a3b8' }}>
            {t('delivery_reps.van_financial_ledger_admin_tab.s43', "كافة عهد المناديب مطابقة تماماً ومسواة بنسبة 100%.")}
          </div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12px' }}>
            <thead>
              <tr style={{ backgroundColor: '#f1f5f9', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                <th style={{ padding: '9px 10px', textAlign: 'center', width: '36px' }}>
                  <input
                    type="checkbox"
                    checked={
                      selectedIds.length > 0 &&
                      selectedIds.length === displayItems.filter((i) => i.status === 'pending').length
                    }
                    onChange={handleToggleSelectAll}
                    style={{ cursor: 'pointer' }}
                    title={t('delivery_reps.van_financial_ledger_admin_tab.s44', "تحديد الكل")}
                  />
                </th>
                <th style={{ padding: '9px 8px', fontWeight: 700 }}>{t('delivery_reps.van_financial_ledger_admin_tab.s45', "التاريخ والتوقيت")}</th>
                <th style={{ padding: '9px 8px', fontWeight: 700 }}>{t('delivery_reps.van_financial_ledger_admin_tab.s46', "المندوب")}</th>
                <th style={{ padding: '9px 8px', fontWeight: 700 }}>{t('delivery_reps.van_financial_ledger_admin_tab.s47', "الرحلة / المركبة")}</th>
                <th style={{ padding: '9px 8px', fontWeight: 700, textAlign: 'center' }}>{t('delivery_reps.van_financial_ledger_admin_tab.s48', "نوع الحركة")}</th>
                <th style={{ padding: '9px 8px', fontWeight: 700, textAlign: 'center' }}>{t('delivery_reps.van_financial_ledger_admin_tab.s49', "المبلغ")}</th>
                <th style={{ padding: '9px 8px', fontWeight: 700 }}>{t('delivery_reps.van_financial_ledger_admin_tab.s50', "البيان والسبب")}</th>
                <th style={{ padding: '9px 8px', fontWeight: 700, textAlign: 'center' }}>{t('delivery_reps.van_financial_ledger_admin_tab.s51', "حالة التسوية")}</th>
                <th style={{ padding: '9px 8px', fontWeight: 700, textAlign: 'center' }}>{t('delivery_reps.van_financial_ledger_admin_tab.s52', "إجراءات التسوية")}</th>
              </tr>
            </thead>
            <tbody>
              {displayItems.map((it) => {
                const typeBadge = getEntryTypeBadge(it.entryType);
                const statusBadge = getStatusBadge(it.status, it.settlementMethod, it.receiptVoucherNo, isEn);
                const isPending = it.status === 'pending';
                const isShortage = ['cash_shortage', 'stock_shortage'].includes(it.entryType);

                return (
                  <tr
                    key={it.id}
                    style={{
                      borderBottom: '1px solid #f1f5f9',
                      backgroundColor: selectedIds.includes(it.id) ? '#f8fafc' : undefined,
                    }}
                  >
                    {/* Checkbox */}
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                      {isPending && isShortage ? (
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(it.id)}
                          onChange={() => handleToggleItem(it.id)}
                          style={{ cursor: 'pointer' }}
                        />
                      ) : (
                        <span style={{ color: '#cbd5e1' }}>—</span>
                      )}
                    </td>

                    {/* Date */}
                    <td style={{ padding: '8px 8px', whiteSpace: 'nowrap', color: '#334155', fontSize: '11px' }}>
                      <div>{new Date(it.createdAt).toLocaleDateString('ar-EG')}</div>
                      <div style={{ color: '#94a3b8', fontSize: '10px' }}>
                        {new Date(it.createdAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>

                    {/* Rep Name */}
                    <td style={{ padding: '8px 8px' }}>
                      <div style={{ fontWeight: 800, color: '#0f172a' }}>{it.repName}</div>
                      <div style={{ fontSize: '10px', color: '#64748b' }}>
                        {it.employeeName ? (
                          <span
                            style={{ color: '#15803d', cursor: 'pointer' }}
                            title={t('delivery_reps.van_financial_ledger_admin_tab.s53', "انقر لتعديل ربط الموظف")}
                            onClick={() => {
                              setLinkingRep({ repId: it.repId, repName: it.repName, employeeId: it.employeeId || null });
                              setSelectedCandidateEmployeeId(it.employeeId ? String(it.employeeId) : '');
                            }}
                          >
                            {t('delivery_reps.van_financial_ledger_admin_tab.s54', "موظف HR:")} {it.employeeName}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setLinkingRep({ repId: it.repId, repName: it.repName, employeeId: it.employeeId || null });
                              setSelectedCandidateEmployeeId(it.employeeId ? String(it.employeeId) : '');
                            }}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#64748b',
                              fontSize: '10px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              padding: 0,
                            }}
                            title={t('delivery_reps.van_financial_ledger_admin_tab.s55', "انقر لربط المندوب بملف موظف HR")}
                          >
                            {t('delivery_reps.van_financial_ledger_admin_tab.s56', "+ ربط بملف HR")}
                          </button>
                        )}
                      </div>
                    </td>

                    {/* Trip Info */}
                    <td style={{ padding: '8px 8px', whiteSpace: 'nowrap' }}>
                      {it.tripId ? (
                        <div>
                          <span style={{ fontWeight: 800, fontFamily: 'monospace', color: '#170e5e' }}>
                            {t('delivery_reps.van_financial_ledger_admin_tab.s57', "رحلة #")}{it.tripId}
                          </span>
                          <div style={{ fontSize: '10px', color: '#64748b' }}>
                            {it.vehiclePlate || it.shiftName || t('delivery_reps.van_financial_ledger_admin_tab.s58', "تصفية مسائية")}
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>{t('delivery_reps.van_financial_ledger_admin_tab.s59', "تسوية إدارية مباشرة")}</span>
                      )}
                    </td>

                    {/* Type Badge */}
                    <td style={{ padding: '8px 8px', textAlign: 'center' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: '6px',
                          fontSize: '10.5px',
                          fontWeight: 700,
                          backgroundColor: typeBadge.bg,
                          color: typeBadge.color,
                          border: `1px solid ${typeBadge.border}`,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {typeBadge.label}
                      </span>
                    </td>

                    {/* Amount */}
                    <td
                      style={{
                        padding: '8px 8px',
                        textAlign: 'center',
                        fontFamily: 'monospace',
                        fontWeight: 900,
                        fontSize: '13px',
                        color: isShortage ? '#b91c1c' : '#166534',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {isShortage ? `-${Number(it.amount).toFixed(2)}` : `+${Number(it.amount).toFixed(2)}`}{' '}
                      <CurrencySymbol />
                    </td>

                    {/* Notes / Reason */}
                    <td style={{ padding: '8px 8px', maxWidth: '240px', fontSize: '11px', color: '#334155' }}>
                      <div style={{ whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.4 }}>
                        {it.notes || t('delivery_reps.van_financial_ledger_admin_tab.s60', "لا توجد ملاحظات مدونة")}
                      </div>
                      {it.settledByName && (
                        <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>
                          {t('delivery_reps.van_financial_ledger_admin_tab.s61', "بواسطة:")} {it.settledByName}
                        </div>
                      )}
                    </td>

                    {/* Status */}
                    <td style={{ padding: '8px 8px', textAlign: 'center' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: '6px',
                          fontSize: '10.5px',
                          fontWeight: 700,
                          backgroundColor: statusBadge.bg,
                          color: statusBadge.color,
                          border: `1px solid ${statusBadge.border}`,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {statusBadge.label}
                      </span>
                    </td>

                    {/* Actions */}
                    <td style={{ padding: '8px 8px', textAlign: 'center' }}>
                      {isPending ? (
                        <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
                          <button
                            type="button"
                            onClick={() => {
                              setSettleModalItem(it);
                              setSettleMethod('cash');
                              setSettleNotes('');
                              setSettlePin('');
                            }}
                            style={{
                              height: '26px',
                              padding: '0 8px',
                              borderRadius: '6px',
                              border: '1px solid #bbf7d0',
                              backgroundColor: '#ffffff',
                              color: '#15803d',
                              fontSize: '10.5px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                              boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                            }}
                            title={t('delivery_reps.van_financial_ledger_admin_tab.s62', "تسجيل سداد نقدي بالخزينة وإصدار سند قبض")}
                          >
                            {t('delivery_reps.van_financial_ledger_admin_tab.s63', "سداد كاش")}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setSettleModalItem(it);
                              setSettleMethod('waiver');
                              setSettleNotes('');
                              setSettlePin('');
                            }}
                            style={{
                              height: '26px',
                              padding: '0 8px',
                              borderRadius: '6px',
                              border: '1px solid #e2e8f0',
                              backgroundColor: '#ffffff',
                              color: '#475569',
                              fontSize: '10.5px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                              boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                            }}
                            title={t('delivery_reps.van_financial_ledger_admin_tab.s64', "إعفاء وتسوية إدارية")}
                          >
                            {t('delivery_reps.van_financial_ledger_admin_tab.s65', "إعفاء")}
                          </button>

                          {isShortage && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedIds([it.id]);
                                setIsPushPayrollOpen(true);
                              }}
                              style={{
                                height: '26px',
                                padding: '0 8px',
                                borderRadius: '6px',
                                border: '1px solid #e2e8f0',
                                backgroundColor: '#ffffff',
                                color: '#170e5e',
                                fontSize: '10.5px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                                boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                              }}
                              title={t('delivery_reps.van_financial_ledger_admin_tab.s66', "ترحيل كاستقطاع لمسير الرواتب")}
                            >
                              {t('delivery_reps.van_financial_ledger_admin_tab.s67', "للمرتبات ↗")}
                            </button>
                          )}
                        </div>
                      ) : (
                        <span style={{ fontSize: '11px', color: '#166534', fontWeight: 700 }}>
                          <CheckIcon size={12} color="#166534" style={{ display: 'inline', verticalAlign: 'middle', marginInlineEnd: '2px' }} />
                          {t('delivery_reps.van_financial_ledger_admin_tab.s68', "تم الإقفال")}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
