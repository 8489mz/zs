import { AppIcons } from '@/shared/components/icons/AppIcons';
import { getTextDirection } from '@/lib/arabic-normalization';
import { TRADE_LABELS, getNum } from './contracting-boq-tab-shared';
import type { useTranslation } from 'react-i18next';
import type { ContractingBoqItem } from '../../contracting.types';

export interface ContractingBoqTabTableProps {
  loading: boolean;
  t: ReturnType<typeof useTranslation>['t'];
  items: ContractingBoqItem[];
  projectId?: string;
  setIsImportModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsImportMasterOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onNewItem: () => void;
  setEditingItem: React.Dispatch<React.SetStateAction<ContractingBoqItem | null>>;
  currencySymbol: string;
  setIsAutoPricingOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setTakeoffItem: React.Dispatch<React.SetStateAction<ContractingBoqItem | null>>;
  handleDeleteItem: (id: string, code: string, desc: string) => Promise<void>;
  deletingId: string | null;
}

export function ContractingBoqTabTable({ loading, t, items, projectId, setIsImportModalOpen, setIsImportMasterOpen, onNewItem, setEditingItem, currencySymbol, setIsAutoPricingOpen, setTakeoffItem, handleDeleteItem, deletingId }: ContractingBoqTabTableProps) {
  return (
    <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontSize: 'var(--font-body)' }}>
          {t('contracting.contracting_boq_tab.s25', "جاري تحميل جدول الكميات...")}
        </div>
      ) : items.length === 0 ? (
        <div style={{ padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ color: '#94a3b8', marginBottom: '12px', display: 'flex', justifyContent: 'center' }}>
            <AppIcons.FileText size={48} />
          </div>
          <div style={{ fontSize: 'var(--font-section-title)', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {t('contracting.contracting_boq_tab.s26', "لا توجد بنود تعاقدية مسجلة لهذا المشروع")}
          </div>
          <div style={{ fontSize: 'var(--font-subtitle)', color: '#64748b', maxWidth: '420px', margin: '0 auto 16px' }}>
            {t('contracting.contracting_boq_tab.s27', "أضف بنود الأعمال والمقايسة للمشروع يدوياً أو قم باستيرادها مباشرة من ملف Excel أو سحبها من بنك البنود المرجعي.")}
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
            {projectId && (
              <button
                type="button"
                onClick={() => setIsImportModalOpen(true)}
                style={{
                  height: '36px',
                  padding: '0 16px',
                  borderRadius: '8px',
                  fontWeight: 600,
                  background: '#f8fafc',
                  color: '#170e5e',
                  border: '1px solid #cbd5e1',
                  cursor: 'pointer',
                  fontSize: 'var(--font-body)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <AppIcons.FileSpreadsheet size={15} />
                <span>{t('contracting.contracting_boq_tab.s28', "استيراد جدول المقايسة من Excel")}</span>
              </button>
            )}
            {projectId && (
              <button
                type="button"
                onClick={() => setIsImportMasterOpen(true)}
                style={{
                  height: '36px',
                  padding: '0 16px',
                  borderRadius: '8px',
                  fontWeight: 600,
                  background: '#eff6ff',
                  color: '#1e40af',
                  border: '1px solid #bfdbfe',
                  cursor: 'pointer',
                  fontSize: 'var(--font-body)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <AppIcons.Layers size={15} />
                <span>{t('contracting.contracting_boq_tab.s29', "سحب تخصصات جاهزة من بنك البنود")}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onNewItem}
              style={{
                height: '36px',
                padding: '0 16px',
                borderRadius: '8px',
                fontWeight: 700,
                background: '#170e5e',
                color: '#ffffff',
                border: 'none',
                cursor: 'pointer',
                fontSize: 'var(--font-body)',
              }}
            >
              {t('contracting.contracting_boq_tab.s30', "إضافة بند جديد يدوياً")}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
          <table
            style={{
              width: '100%',
              minWidth: '1240px',
              tableLayout: 'fixed',
              borderCollapse: 'collapse',
              textAlign: 'right',
            }}
          >
            <colgroup>
              <col style={{ width: '85px' }} />
              <col style={{ width: '375px' }} />
              <col style={{ width: '65px' }} />
              <col style={{ width: '95px' }} />
              <col style={{ width: '95px' }} />
              <col style={{ width: '110px' }} />
              <col style={{ width: '125px' }} />
              <col style={{ width: '80px' }} />
              <col style={{ width: '100px' }} />
              <col style={{ width: '130px' }} />
            </colgroup>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ padding: '12px 8px', fontSize: 'var(--font-table-head)', fontWeight: 700, color: '#334155', textAlign: 'center' }}>{t('contracting.contracting_boq_tab.s31', "كود البند")}</th>
                <th style={{ padding: '12px 14px', fontSize: 'var(--font-table-head)', fontWeight: 700, color: '#334155', textAlign: 'right' }}>{t('contracting.contracting_boq_tab.s32', "بيان الأعمال والمواصفات")}</th>
                <th style={{ padding: '12px 6px', fontSize: 'var(--font-table-head)', fontWeight: 700, color: '#334155', textAlign: 'center' }}>{t('contracting.contracting_boq_tab.s33', "الوحدة")}</th>
                <th style={{ padding: '12px 8px', fontSize: 'var(--font-table-head)', fontWeight: 700, color: '#334155', textAlign: 'center' }}>{t('contracting.contracting_boq_tab.s34', "الكمية التعاقدية")}</th>
                <th style={{ padding: '12px 8px', fontSize: 'var(--font-table-head)', fontWeight: 700, color: '#334155', textAlign: 'center' }}>{t('contracting.contracting_boq_tab.s35', "الكمية المعدلة")}</th>
                <th style={{ padding: '12px 8px', fontSize: 'var(--font-table-head)', fontWeight: 700, color: '#334155', textAlign: 'center' }}>{t('contracting.contracting_boq_tab.s36', "سعر الفئة")}</th>
                <th style={{ padding: '12px 8px', fontSize: 'var(--font-table-head)', fontWeight: 700, color: '#334155', textAlign: 'center' }}>{t('contracting.contracting_boq_tab.s37', "إجمالي القيمة")}</th>
                <th style={{ padding: '12px 6px', fontSize: 'var(--font-table-head)', fontWeight: 700, color: '#334155', textAlign: 'center' }}>{t('contracting.contracting_boq_tab.s38', "المنفذ")}</th>
                <th style={{ padding: '12px 8px', fontSize: 'var(--font-table-head)', fontWeight: 700, color: '#334155', textAlign: 'center' }}>{t('contracting.contracting_boq_tab.s39', "نسبة الإنجاز")}</th>
                <th style={{ padding: '12px 8px', fontSize: 'var(--font-table-head)', fontWeight: 700, color: '#334155', textAlign: 'center' }}>{t('contracting.contracting_boq_tab.s40', "الإجراءات")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const contractQty = getNum(item.contractQty ?? (item as any).contract_qty);
                const revisedQty = getNum(item.revisedQty ?? (item as any).revised_qty ?? contractQty);
                const unitPrice = getNum(item.unitPrice ?? (item as any).unit_price);
                const total = revisedQty * unitPrice;
                const executedQty = getNum(item.executedQty ?? (item as any).executed_qty);
                const completion = revisedQty > 0 ? Math.min(100, Math.round((executedQty / revisedQty) * 100)) : 0;
                const itemCode = item.itemCode || (item as any).item_code || '---';
                const categoryAr = TRADE_LABELS[item.category] || item.category;

                return (
                  <tr
                    key={item.id}
                    style={{
                      borderBottom: '1px solid #f1f5f9',
                      transition: 'background-color 0.15s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    {/* 1. كود البند */}
                    <td style={{ padding: '12px 10px', textAlign: 'center', verticalAlign: 'middle' }}>
                      <span
                        style={{
                          fontFamily: 'monospace',
                          fontWeight: 700,
                          color: '#170e5e',
                          background: '#f1f5f9',
                          border: '1px solid #e2e8f0',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontSize: '0.8rem',
                          display: 'inline-block',
                          letterSpacing: '0.5px',
                        }}
                      >
                        {itemCode}
                      </span>
                    </td>

                    {/* 2. بيان الأعمال والمواصفات */}
                    {(() => {
                      const dir = getTextDirection(item.description);
                      const isRtl = dir === 'rtl';
                      return (
                        <td
                          dir={dir}
                          style={{
                            padding: '12px 14px',
                            textAlign: isRtl ? 'right' : 'left',
                            verticalAlign: 'middle',
                          }}
                        >
                          <div
                            dir={dir}
                            className="text-justify spec-description"
                            style={{
                              fontSize: 'var(--font-body)',
                              fontWeight: 600,
                              color: '#0f172a',
                              marginBottom: '6px',
                              lineHeight: 1.6,
                              textAlign: 'justify',
                              textJustify: 'inter-word',
                              textAlignLast: isRtl ? 'right' : 'left',
                              wordBreak: 'break-word',
                              whiteSpace: 'normal',
                              direction: dir,
                            }}
                          >
                            {item.description}
                          </div>
                          {categoryAr && (
                            <div style={{ textAlign: isRtl ? 'right' : 'left' }}>
                              <span
                                style={{
                                  fontSize: 'var(--font-micro)',
                                  color: '#475569',
                                  background: '#f1f5f9',
                                  border: '1px solid #e2e8f0',
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                  fontWeight: 600,
                                  display: 'inline-block',
                                }}
                              >
                                {categoryAr}
                              </span>
                            </div>
                          )}
                        </td>
                      );
                    })()}

                    {/* 3. الوحدة */}
                    <td style={{ padding: '12px 8px', textAlign: 'center', verticalAlign: 'middle' }}>
                      <span
                        style={{
                          fontSize: 'var(--font-micro)',
                          color: '#475569',
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontWeight: 600,
                          display: 'inline-block',
                        }}
                      >
                        {item.unit || '---'}
                      </span>
                    </td>

                    {/* 4. الكمية التعاقدية */}
                    <td style={{ padding: '12px 10px', textAlign: 'center', verticalAlign: 'middle' }}>
                      {contractQty === 0 ? (
                        <button
                          type="button"
                          onClick={() => setEditingItem(item)}
                          title={t('contracting.contracting_boq_tab.s41', "انقر لتحديد كمية المشروع وحساب إجمالي القيمة")}
                          style={{
                            background: '#fffbeb',
                            border: '1px dashed #f59e0b',
                            color: '#b45309',
                            padding: '4px 8px',
                            borderRadius: '6px',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            margin: '0 auto',
                            transition: 'all 0.15s ease',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = '#fef3c7';
                            e.currentTarget.style.borderColor = '#d97706';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = '#fffbeb';
                            e.currentTarget.style.borderColor = '#f59e0b';
                          }}
                        >
                          <AppIcons.Edit size={12} />
                          <span>{t('contracting.contracting_boq_tab.s42', "0 (حدد الكمية)")}</span>
                        </button>
                      ) : (
                        <span style={{ fontSize: 'var(--font-body)', fontWeight: 700, color: '#0f172a' }}>
                          {contractQty.toLocaleString('en-US')}
                        </span>
                      )}
                    </td>

                    {/* 5. الكمية المعدلة */}
                    <td style={{ padding: '12px 10px', textAlign: 'center', verticalAlign: 'middle' }}>
                      <span
                        style={{
                          fontSize: 'var(--font-body)',
                          fontWeight: 600,
                          color: revisedQty !== contractQty ? '#1e40af' : '#475569',
                        }}
                      >
                        {revisedQty.toLocaleString('en-US')}
                      </span>
                    </td>

                    {/* 6. سعر الفئة */}
                    <td style={{ padding: '12px 10px', textAlign: 'center', verticalAlign: 'middle' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: '3px' }}>
                        <span style={{ fontSize: 'var(--font-body)', fontWeight: 700, color: '#0f172a' }}>
                          {Math.round(unitPrice).toLocaleString('en-US')}
                        </span>
                        <span style={{ fontSize: '0.6875rem', color: '#94a3b8' }}>{currencySymbol}</span>
                      </div>
                    </td>

                    {/* 7. إجمالي القيمة */}
                    <td style={{ padding: '12px 10px', textAlign: 'center', verticalAlign: 'middle' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: '3px' }}>
                        <span
                          style={{
                            fontSize: '0.875rem',
                            fontWeight: 800,
                            color: total > 0 ? '#170e5e' : '#94a3b8',
                          }}
                        >
                          {Math.round(total).toLocaleString('en-US')}
                        </span>
                        <span style={{ fontSize: '0.6875rem', color: '#94a3b8' }}>{currencySymbol}</span>
                      </div>
                    </td>

                    {/* 8. المنفذ */}
                    <td style={{ padding: '12px 8px', textAlign: 'center', verticalAlign: 'middle' }}>
                      <span
                        style={{
                          fontSize: 'var(--font-body)',
                          fontWeight: 600,
                          color: executedQty > 0 ? '#15803d' : '#94a3b8',
                        }}
                      >
                        {executedQty.toLocaleString('en-US')}
                      </span>
                    </td>

                    {/* 9. نسبة الإنجاز */}
                    <td style={{ padding: '12px 10px', textAlign: 'center', verticalAlign: 'middle' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', width: '100%', maxWidth: '100px', margin: '0 auto' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '0.72rem', fontWeight: 700, color: completion >= 100 ? '#15803d' : '#334155' }}>
                          <span>{t('contracting.contracting_boq_tab.s43', "الإنجاز")}</span>
                          <span>{completion}%</span>
                        </div>
                        <div style={{ width: '100%', height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${Math.min(completion, 100)}%`,
                              height: '100%',
                              background: completion >= 100 ? '#10b981' : '#170e5e',
                              borderRadius: '3px',
                              transition: 'width 0.3s ease',
                            }}
                          />
                        </div>
                      </div>
                    </td>

                    {/* 10. الإجراءات */}
                    <td style={{ padding: '8px 6px', textAlign: 'center', verticalAlign: 'middle' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                        {!item.isSectionHeader && (
                          <button
                            type="button"
                            title={t('contracting.contracting_boq_tab.s44', "تسعير آلي وحساب تفكيك التكلفة للبند")}
                            onClick={() => {
                              setEditingItem(item);
                              setIsAutoPricingOpen(true);
                            }}
                            style={{
                              width: '26px',
                              height: '26px',
                              borderRadius: '6px',
                              background: '#eef2ff',
                              color: '#4338ca',
                              border: '1px solid #c7d2fe',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              padding: 0,
                              transition: 'all 0.15s ease',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = '#170e5e';
                              e.currentTarget.style.color = '#ffffff';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = '#eef2ff';
                              e.currentTarget.style.color = '#4338ca';
                            }}
                          >
                            <AppIcons.Calculator size={13} />
                          </button>
                        )}
                        <button
                          type="button"
                          title={t('contracting.contracting_boq_tab.s45', "شيت حصر كميات لوحات الكاد (CAD Takeoff)")}
                          onClick={() => setTakeoffItem(item)}
                          style={{
                            width: '26px',
                            height: '26px',
                            borderRadius: '6px',
                            background: '#f0fdf4',
                            color: '#15803d',
                            border: '1px solid #bbf7d0',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 0,
                            transition: 'all 0.15s ease',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = '#15803d';
                            e.currentTarget.style.color = '#ffffff';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = '#f0fdf4';
                            e.currentTarget.style.color = '#15803d';
                          }}
                        >
                          <AppIcons.Maximize size={13} />
                        </button>
                        <button
                          type="button"
                          title={t('contracting.contracting_boq_tab.s46', "تعديل بيانات البند والكميات")}
                          onClick={() => setEditingItem(item)}
                          style={{
                            width: '26px',
                            height: '26px',
                            borderRadius: '6px',
                            background: '#f1f5f9',
                            color: '#1e293b',
                            border: '1px solid #cbd5e1',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 0,
                            transition: 'all 0.15s ease',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = '#e2e8f0';
                            e.currentTarget.style.color = '#170e5e';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = '#f1f5f9';
                            e.currentTarget.style.color = '#1e293b';
                          }}
                        >
                          <AppIcons.Edit size={13} />
                        </button>
                        <button
                          type="button"
                          title={t('contracting.contracting_boq_tab.s47', "حذف البند من المقايسة")}
                          onClick={() => handleDeleteItem(item.id, itemCode, item.description)}
                          style={{
                            width: '26px',
                            height: '26px',
                            borderRadius: '6px',
                            background: '#fef2f2',
                            color: '#b91c1c',
                            border: '1px solid #fecaca',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 0,
                            transition: 'all 0.15s ease',
                          }}
                        >
                          {deletingId === item.id ? '...' : <AppIcons.Trash size={13} />}
                        </button>
                      </div>
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
