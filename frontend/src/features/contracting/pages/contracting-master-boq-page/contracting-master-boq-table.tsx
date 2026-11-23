import { AppIcons } from '@/shared/components/icons/AppIcons';
import { getTextDirection } from '@/lib/arabic-normalization';
import type { useTranslation } from 'react-i18next';
import type { MasterBoqItem } from '../../contracting.types';

export interface ContractingMasterBoqTableProps {
  loading: boolean;
  __t: ReturnType<typeof useTranslation>['t'];
  filteredItems: MasterBoqItem[];
  actioningId: string | null;
  setEditingItem: (val: MasterBoqItem | null) => void;
  setIsCreateModalOpen: (val: boolean) => void;
  handleDeleteItem: (item: MasterBoqItem) => Promise<void>;
  handleToggleItemStatus: (item: MasterBoqItem, targetActive: boolean) => Promise<void>;
}

export function ContractingMasterBoqTable({ loading, __t, filteredItems, actioningId, setEditingItem, setIsCreateModalOpen, handleDeleteItem, handleToggleItemStatus }: ContractingMasterBoqTableProps) {
  return (
    <>
    {/* جدول البنود المرجعية (Master BOQ Table) */}
    <div
      style={{
        background: '#ffffff',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
      }}
    >
      {loading ? (
        <div style={{ padding: '60px 24px', textAlign: 'center', color: '#64748b' }}>
          {__t('contracting.contracting_master_boq_page.s24', "جاري تحميل بنك البنود المرجعي...")}
        </div>
      ) : filteredItems.length === 0 ? (
        <div style={{ padding: '60px 24px', textAlign: 'center' }}>
          <div style={{ color: '#94a3b8', marginBottom: '12px', display: 'flex', justifyContent: 'center' }}>
            <AppIcons.FileText size={48} />
          </div>
          <div style={{ fontSize: 'var(--font-section-title)', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {__t('contracting.contracting_master_boq_page.s25', "لا توجد بنود مطابقة")}
          </div>
          <div style={{ fontSize: 'var(--font-subtitle)', color: '#64748b', maxWidth: '420px', margin: '0 auto' }}>
            {__t('contracting.contracting_master_boq_page.s26', "لم يتم العثور على أي بنود في هذا التخصص أو بكلمة البحث المحددة.")}
          </div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
            <colgroup>
              <col style={{ width: '105px' }} />
              <col style={{ width: '150px' }} />
              <col style={{ width: 'auto' }} />
              <col style={{ width: '65px' }} />
              <col style={{ width: '110px' }} />
              <col style={{ width: '110px' }} />
              <col style={{ width: '75px' }} />
              <col style={{ width: '100px' }} />
              <col style={{ width: '115px' }} />
            </colgroup>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '12px 14px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569' }}>
                  {__t('contracting.contracting_master_boq_page.s27', "كود البند")}
                </th>
                <th style={{ padding: '12px 14px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569' }}>
                  {__t('contracting.contracting_master_boq_page.s28', "التخصص")}
                </th>
                <th style={{ padding: '12px 14px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569' }}>
                  {__t('contracting.contracting_master_boq_page.s29', "مسمى البند والمواصفات الفنية")}
                </th>
                <th style={{ padding: '12px 14px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569', textAlign: 'center' }}>
                  {__t('contracting.contracting_master_boq_page.s30', "الوحدة")}
                </th>
                <th style={{ padding: '12px 14px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569' }}>
                  {__t('contracting.contracting_master_boq_page.s31', "التكلفة")}
                </th>
                <th style={{ padding: '12px 14px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569' }}>
                  {__t('contracting.contracting_master_boq_page.s32', "سعر البيع")}
                </th>
                <th style={{ padding: '12px 14px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569', textAlign: 'center' }}>
                  {__t('contracting.contracting_master_boq_page.s33', "الهامش")}
                </th>
                <th style={{ padding: '12px 14px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569', textAlign: 'center' }}>
                  {__t('contracting.contracting_master_boq_page.s34', "النوع")}
                </th>
                <th style={{ padding: '12px 14px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569', textAlign: 'center' }}>
                  {__t('contracting.contracting_master_boq_page.s35', "الإجراءات")}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const price = Number(item.standardPrice) || 0;
                const cost = Number(item.standardCost) || 0;
                const margin = price > 0 ? Math.round(((price - cost) / price) * 100) : 0;
                const isBusy = actioningId === item.id;

                return (
                  <tr
                    key={item.id}
                    style={{
                      borderBottom: '1px solid #f1f5f9',
                      transition: 'background-color 0.15s',
                      opacity: item.isActive ? 1 : 0.65,
                      background: item.isActive ? 'transparent' : '#fdfaf9',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = item.isActive ? '#f8fafc' : '#fbf3f1')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = item.isActive ? 'transparent' : '#fdfaf9')}
                  >
                    <td style={{ padding: '12px 14px', fontSize: 'var(--font-body)', fontWeight: 700, color: '#170e5e', fontFamily: 'monospace' }}>
                      {item.itemCode}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: 'var(--font-micro)' }}>
                      <span
                        style={{
                          background: '#f1f5f9',
                          color: '#475569',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                          display: 'inline-block',
                        }}
                      >
                        {item.tradeNameAr || item.tradeCategory}
                      </span>
                    </td>
                    {(() => {
                      const descText = (item.description && item.description !== item.name) ? item.description : (item.name || '');
                      const dir = getTextDirection(descText);
                      const isRtl = dir === 'rtl';
                      return (
                        <td dir={dir} style={{ padding: '12px 14px', maxWidth: '380px', textAlign: isRtl ? 'right' : 'left' }}>
                          <div
                            dir={dir}
                            style={{
                              fontSize: 'var(--font-body)',
                              fontWeight: 600,
                              color: '#0f172a',
                              marginBottom: '2px',
                              textAlign: isRtl ? 'right' : 'left',
                              direction: dir,
                            }}
                          >
                            {item.name}
                          </div>
                          {item.description && item.description !== item.name && (
                            <div
                              dir={dir}
                              className="text-justify spec-description"
                              style={{
                                fontSize: 'var(--font-micro)',
                                color: '#64748b',
                                lineHeight: 1.55,
                                textAlign: 'justify',
                                textJustify: 'inter-word',
                                textAlignLast: isRtl ? 'right' : 'left',
                                wordBreak: 'break-word',
                                direction: dir,
                              }}
                            >
                              {item.description}
                            </div>
                          )}
                        </td>
                      );
                    })()}
                    <td style={{ padding: '12px 14px', fontSize: 'var(--font-body)', color: '#475569', textAlign: 'center' }}>
                      {item.unit}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: 'var(--font-body)', color: '#64748b' }}>
                      {cost > 0 ? cost.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: 'var(--font-body)', fontWeight: 700, color: '#170e5e' }}>
                      {price.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      <span
                        style={{
                          fontSize: 'var(--font-micro)',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '12px',
                          background: margin >= 20 ? '#ecfdf5' : margin > 0 ? '#fffbeb' : '#fef2f2',
                          color: margin >= 20 ? '#047857' : margin > 0 ? '#b45309' : '#b91c1c',
                        }}
                      >
                        {margin}%
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      <span
                        style={{
                          fontSize: 'var(--font-micro)',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          background: item.isCustom ? '#eff6ff' : '#f8fafc',
                          color: item.isCustom ? '#1d4ed8' : '#64748b',
                          border: `1px solid ${item.isCustom ? '#bfdbfe' : '#e2e8f0'}`,
                          fontWeight: 600,
                        }}
                      >
                        {item.isCustom ? __t('contracting.contracting_master_boq_page.s36', "مخصص للشركة") : __t('contracting.contracting_master_boq_page.s37', "نظام قياسي")}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                        {/* زر التعديل */}
                        <button
                          type="button"
                          title={__t('contracting.contracting_master_boq_page.s38', "تعديل السعر والمواصفات")}
                          disabled={isBusy}
                          onClick={() => {
                            setEditingItem(item);
                            setIsCreateModalOpen(true);
                          }}
                          style={{
                            padding: '5px 8px',
                            borderRadius: '6px',
                            background: '#f8fafc',
                            color: '#475569',
                            border: '1px solid #cbd5e1',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                          }}
                        >
                          <AppIcons.Edit size={13} />
                        </button>

                        {/* زر الحذف أو الاستبعاد / إعادة التفعيل */}
                        {item.isActive ? (
                          <button
                            type="button"
                            title={item.isCustom ? __t('contracting.contracting_master_boq_page.s39', "حذف البند المخصص نهائياً") : __t('contracting.contracting_master_boq_page.s40', "استبعاد وإخفاء البند من مكتبة الشركة")}
                            disabled={isBusy}
                            onClick={() => handleDeleteItem(item)}
                            style={{
                              padding: '5px 8px',
                              borderRadius: '6px',
                              background: item.isCustom ? '#fef2f2' : '#fffbeb',
                              color: item.isCustom ? '#b91c1c' : '#b45309',
                              border: `1px solid ${item.isCustom ? '#fecaca' : '#fde68a'}`,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                            }}
                          >
                            <AppIcons.Trash size={13} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            title={__t('contracting.contracting_master_boq_page.s41', "إعادة تفعيل وإظهار البند في المكتبة")}
                            disabled={isBusy}
                            onClick={() => handleToggleItemStatus(item, true)}
                            style={{
                              padding: '5px 8px',
                              borderRadius: '6px',
                              background: '#f0fdf4',
                              color: '#15803d',
                              border: '1px solid #bbf7d0',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                            }}
                          >
                            <AppIcons.CheckCircle size={13} />
                          </button>
                        )}
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
    </>
  );
}
