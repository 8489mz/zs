import type { TFunction } from 'i18next';
import type { ParsedBoqItemResult } from '../../utils/boqExcelParser';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { getTextDirection } from '@/lib/arabic-normalization';

const CATEGORY_NAMES: Record<string, string> = {
  fire_fighting: 'مكافحة وإطفاء الحريق',
  hvac: 'تكييف وتهوية',
  civil_concrete: 'خرسانة ومدني',
  architecture_finishes: 'تشطيبات ومعماري',
  plumbing_sanitary: 'صحي وتغذية',
  electrical_power: 'كهرباء وإنارة',
  hvac_firefighting: 'تكييف وإطفاء',
  general: 'أعمال عامة',
};

const UNIT_LABELS: Record<string, string> = {
  m3: 'م3',
  m2: 'م2',
  m: 'م.ط',
  item: 'عدد',
  ls: 'مقطوعية',
  point: 'نقطة',
  set: 'طقم',
  ton: 'طن',
  kg: 'كجم',
};

export interface BoqPreviewTableProps {
  t: TFunction;
  displayedRows: ParsedBoqItemResult[];
  ignoreSectionHeaders: boolean;
  ignorePreambles: boolean;
  handleRowCategoryChange: (rowIndex: number, newCategory: string) => void;
  handleRowUnitChange: (rowIndex: number, newUnit: string) => void;
  handleRowQtyChange: (rowIndex: number, newQty: number) => void;
  handleRowPriceChange: (rowIndex: number, newPrice: number) => void;
}

export function BoqPreviewTable({
  t,
  displayedRows,
  ignoreSectionHeaders,
  ignorePreambles,
  handleRowCategoryChange,
  handleRowUnitChange,
  handleRowQtyChange,
  handleRowPriceChange,
}: BoqPreviewTableProps) {
  return (
    <>
      {/* 3. Interactive BOQ Data Table */}
      <div
        style={{
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          overflowX: 'hidden',
          overflowY: 'auto',
          maxHeight: '440px',
          backgroundColor: '#ffffff',
          width: '100%',
        }}
      >
        <table
          style={{
            width: '100%',
            tableLayout: 'fixed',
            borderCollapse: 'collapse',
            fontSize: 'var(--font-subtitle)',
          }}
        >
          <colgroup>
            <col style={{ width: '36px' }} />
            <col style={{ width: '75px' }} />
            <col />
            <col style={{ width: '140px' }} />
            <col style={{ width: '75px' }} />
            <col style={{ width: '90px' }} />
            <col style={{ width: '100px' }} />
            <col style={{ width: '105px' }} />
            <col style={{ width: '105px' }} />
          </colgroup>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, zIndex: 2 }}>
              <th style={{ padding: '10px 4px', textAlign: 'center', fontWeight: 600, color: '#475569' }}>{t('contracting.import_boq_modal.s55', "م")}</th>
              <th style={{ padding: '10px 6px', textAlign: 'center', fontWeight: 600, color: '#475569' }}>{t('contracting.import_boq_modal.s56', "كود البند")}</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#475569' }}>{t('contracting.import_boq_modal.s57', "بيان الأعمال والمواصفات")}</th>
              <th style={{ padding: '10px 6px', textAlign: 'center', fontWeight: 600, color: '#475569' }}>{t('contracting.import_boq_modal.s58', "التخصص")}</th>
              <th style={{ padding: '10px 4px', textAlign: 'center', fontWeight: 600, color: '#475569' }}>{t('contracting.import_boq_modal.s59', "الوحدة")}</th>
              <th style={{ padding: '10px 6px', textAlign: 'right', fontWeight: 600, color: '#475569' }}>{t('contracting.import_boq_modal.s60', "الكمية")}</th>
              <th style={{ padding: '10px 6px', textAlign: 'right', fontWeight: 600, color: '#475569' }}>{t('contracting.import_boq_modal.s61', "سعر الفئة")}</th>
              <th style={{ padding: '10px 6px', textAlign: 'right', fontWeight: 600, color: '#475569' }}>{t('contracting.import_boq_modal.s62', "إجمالي القيمة")}</th>
              <th style={{ padding: '10px 6px', textAlign: 'center', fontWeight: 600, color: '#475569' }}>{t('contracting.import_boq_modal.s63', "الحالة")}</th>
            </tr>
          </thead>
          <tbody>
            {displayedRows.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ padding: '32px', textAlign: 'center', color: '#64748b', fontSize: 'var(--font-body)' }}>
                  {t('contracting.import_boq_modal.s64', "لا توجد بنود تطابق التصفية المختارة")}
                </td>
              </tr>
            ) : (
              displayedRows.map((row) => {
                const isRowIgnored =
                  (ignoreSectionHeaders && row.isSectionHeader) ||
                  (ignorePreambles && row.isPreamble);

                return (
                  <tr
                    key={row.index}
                    style={{
                      borderBottom: '1px solid #f1f5f9',
                      backgroundColor: isRowIgnored
                        ? '#f8fafc'
                        : !row.isValid
                        ? '#fff1f2'
                        : row.status === 'unpriced'
                        ? '#fffbeb'
                        : 'transparent',
                      opacity: isRowIgnored ? 0.75 : 1,
                    }}
                  >
                    <td style={{ padding: '8px 4px', textAlign: 'center', color: '#64748b' }}>{row.index}</td>
                    <td
                      style={{
                        padding: '8px 6px',
                        textAlign: 'center',
                        fontWeight: 700,
                        color: '#1e293b',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        fontSize: 'var(--font-micro)',
                      }}
                      title={row.itemCode}
                    >
                      {row.itemCode}
                    </td>
                    {(() => {
                      const dir = getTextDirection(row.description);
                      const isRtl = dir === 'rtl';
                      return (
                        <td
                          dir={dir}
                          className="spec-description text-justify"
                          style={{
                            padding: '10px 14px',
                            textAlign: isRtl ? 'right' : 'left',
                            textAlignLast: isRtl ? 'right' : 'left',
                            textJustify: 'inter-word',
                            lineHeight: 1.55,
                            wordBreak: 'break-word',
                            overflowWrap: 'break-word',
                            whiteSpace: 'normal',
                            direction: dir,
                            verticalAlign: 'middle',
                          }}
                        >
                          <div
                            dir={dir}
                            style={{
                              fontWeight: row.isSectionHeader ? 700 : 600,
                              color: '#0f172a',
                              textAlign: isRtl ? 'right' : 'left',
                              textAlignLast: isRtl ? 'right' : 'left',
                              direction: dir,
                              wordBreak: 'break-word',
                              overflowWrap: 'break-word',
                              whiteSpace: 'normal',
                            }}
                          >
                            {row.description}
                          </div>
                          {row.warningMessage && (
                            <div
                              dir="rtl"
                              style={{
                                color: row.isSectionHeader ? '#64748b' : '#b45309',
                                fontSize: 'var(--font-micro)',
                                marginTop: '4px',
                                fontWeight: 600,
                                textAlign: 'right',
                                direction: 'rtl',
                              }}
                            >
                              {row.warningMessage}
                            </div>
                          )}
                          {row.validationError && (
                            <div
                              dir="rtl"
                              style={{
                                color: '#b91c1c',
                                fontSize: 'var(--font-micro)',
                                marginTop: '4px',
                                fontWeight: 600,
                                textAlign: 'right',
                                direction: 'rtl',
                              }}
                            >
                              {row.validationError}
                            </div>
                          )}
                        </td>
                      );
                    })()}
                    <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                      {row.isSectionHeader ? (
                        <span style={{ color: '#94a3b8' }}>-</span>
                      ) : (
                        <select
                          value={row.category || 'general'}
                          onChange={(e) => handleRowCategoryChange(row.index, e.target.value)}
                          style={{
                            width: '100%',
                            padding: '4px 6px',
                            paddingLeft: '18px',
                            borderRadius: '5px',
                            border: '1px solid #cbd5e1',
                            backgroundColor: '#f8fafc',
                            color: '#334155',
                            fontSize: 'var(--font-micro)',
                            fontWeight: 600,
                            cursor: 'pointer',
                            textOverflow: 'ellipsis',
                            overflow: 'hidden',
                            outline: 'none',
                            boxSizing: 'border-box',
                          }}
                        >
                          {Object.entries(CATEGORY_NAMES).map(([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                      {row.isSectionHeader ? (
                        <span style={{ color: '#94a3b8' }}>-</span>
                      ) : (
                        <select
                          value={row.unit || ''}
                          onChange={(e) => handleRowUnitChange(row.index, e.target.value)}
                          style={{
                            width: '100%',
                            padding: '4px 4px',
                            paddingLeft: '14px',
                            borderRadius: '5px',
                            border: '1px solid #cbd5e1',
                            backgroundColor: '#ffffff',
                            color: '#334155',
                            fontSize: 'var(--font-micro)',
                            fontWeight: 600,
                            cursor: 'pointer',
                            textAlign: 'center',
                            outline: 'none',
                            boxSizing: 'border-box',
                          }}
                        >
                          <option value="">-</option>
                          {Object.entries(UNIT_LABELS).map(([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                      {row.isSectionHeader ? (
                        <span style={{ color: '#94a3b8' }}>-</span>
                      ) : (
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={row.contractQty === 0 ? '' : Math.round((row.contractQty + Number.EPSILON) * 10000) / 10000}
                          placeholder="0"
                          onChange={(e) => handleRowQtyChange(row.index, parseFloat(e.target.value) || 0)}
                          style={{
                            width: '100%',
                            padding: '4px 6px',
                            borderRadius: '5px',
                            border: '1px solid #cbd5e1',
                            backgroundColor: row.contractQty === 0 ? '#fff7ed' : '#ffffff',
                            fontSize: 'var(--font-subtitle)',
                            fontWeight: 600,
                            color: '#0f172a',
                            textAlign: 'right',
                            outline: 'none',
                            boxSizing: 'border-box',
                          }}
                        />
                      )}
                    </td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                      {row.isSectionHeader ? (
                        <span style={{ color: '#94a3b8' }}>-</span>
                      ) : (
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={row.unitPrice === 0 ? '' : Math.round((row.unitPrice + Number.EPSILON) * 10000) / 10000}
                          placeholder="0.00"
                          onChange={(e) => handleRowPriceChange(row.index, parseFloat(e.target.value) || 0)}
                          style={{
                            width: '100%',
                            padding: '4px 6px',
                            borderRadius: '5px',
                            border: row.unitPrice === 0 ? '1px solid #f59e0b' : row.isAutoPriced ? '1px solid #10b981' : '1px solid #cbd5e1',
                            backgroundColor: row.unitPrice === 0 ? '#fffbeb' : row.isAutoPriced ? '#f0fdf4' : '#ffffff',
                            fontSize: 'var(--font-subtitle)',
                            fontWeight: 700,
                            color: row.unitPrice === 0 ? '#b45309' : row.isAutoPriced ? '#15803d' : '#0f172a',
                            textAlign: 'right',
                            outline: 'none',
                            boxSizing: 'border-box',
                          }}
                          title={row.isAutoPriced ? (row.warningMessage || t('contracting.import_boq_modal.s65', "تم التسعير التقديري تلقائياً من المكتبة الهندسية")) : (row.unitPrice === 0 ? t('contracting.import_boq_modal.s66', "انقر لتسعير البند مباشرة في المقايسة") : t('contracting.import_boq_modal.s67', "سعر الفئة التعاقدي"))}
                        />
                      )}
                    </td>
                    <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 700, color: '#170e5e', whiteSpace: 'nowrap', fontSize: 'var(--font-micro)' }}>
                      {row.isSectionHeader ? '-' : (row.contractQty * row.unitPrice).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '6px 4px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {row.isSectionHeader ? (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            color: isRowIgnored ? '#64748b' : '#b45309',
                            background: isRowIgnored ? '#f1f5f9' : '#fef3c7',
                            padding: '3px 6px',
                            borderRadius: '6px',
                            fontSize: 'var(--font-micro)',
                            fontWeight: 700,
                          }}
                        >
                          <AppIcons.FileText size={12} />
                          {t('contracting.import_boq_modal.s68', "عنوان رئيسي")}
                        </span>
                      ) : row.isPreamble && ignorePreambles ? (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            color: '#64748b',
                            background: '#f1f5f9',
                            padding: '3px 6px',
                            borderRadius: '6px',
                            fontSize: 'var(--font-micro)',
                            fontWeight: 700,
                          }}
                        >
                          <AppIcons.FileText size={12} />
                          {t('contracting.import_boq_modal.s69', "ديباجة")}
                        </span>
                      ) : row.isAutoPriced ? (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            color: '#15803d',
                            background: '#dcfce7',
                            padding: '3px 6px',
                            borderRadius: '6px',
                            fontSize: 'var(--font-micro)',
                            fontWeight: 700,
                          }}
                          title={row.warningMessage || t('contracting.import_boq_modal.s70', "تم التسعير التقديري تلقائياً من المكتبة الهندسية")}
                        >
                          <AppIcons.CheckCircle size={12} />
                          {t('contracting.import_boq_modal.s71', "مسعر آلياً")}
                        </span>
                      ) : row.status === 'ready' ? (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            color: '#15803d',
                            background: '#dcfce7',
                            padding: '3px 6px',
                            borderRadius: '6px',
                            fontSize: 'var(--font-micro)',
                            fontWeight: 700,
                          }}
                        >
                          <AppIcons.CheckCircle size={12} />
                          {t('contracting.import_boq_modal.s72', "جاهز")}
                        </span>
                      ) : row.status === 'unpriced' ? (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            color: '#b45309',
                            background: '#fef3c7',
                            padding: '3px 6px',
                            borderRadius: '6px',
                            fontSize: 'var(--font-micro)',
                            fontWeight: 700,
                          }}
                        >
                          <AppIcons.AlertTriangle size={12} />
                          {t('contracting.import_boq_modal.s73', "غير مسعر")}
                        </span>
                      ) : row.status === 'zero_qty' ? (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            color: '#c2410c',
                            background: '#ffedd5',
                            padding: '3px 6px',
                            borderRadius: '6px',
                            fontSize: 'var(--font-micro)',
                            fontWeight: 700,
                          }}
                        >
                          <AppIcons.AlertTriangle size={12} />
                          {t('contracting.import_boq_modal.s74', "كمية 0")}
                        </span>
                      ) : (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            color: '#b91c1c',
                            background: '#fee2e2',
                            padding: '3px 6px',
                            borderRadius: '6px',
                            fontSize: 'var(--font-micro)',
                            fontWeight: 700,
                          }}
                        >
                          <AppIcons.AlertCircle size={12} />
                          {t('contracting.import_boq_modal.s75', "غير صالح")}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
