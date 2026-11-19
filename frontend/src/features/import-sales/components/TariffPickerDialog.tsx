import type { Dispatch, SetStateAction } from 'react';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { CheckCircleIcon, CheckShieldIcon, PlusCircleIcon, SearchIcon } from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';

export interface TariffPickerDialogProps {
  isTariffPickerOpen: boolean;
  pickerSector: string;
  setPickerSector: Dispatch<SetStateAction<string>>;
  pickerSearch: string;
  setPickerSearch: Dispatch<SetStateAction<string>>;
  availableSectors: any[];
  isTariffsLoading: boolean;
  displayedTariffs: any[];
  items: Array<{ hsCode: string; name: string }>;
  onSelectTariffItem: (tariff: any) => void;
  onClose: () => void;
}

export function TariffPickerDialog({
  isTariffPickerOpen,
  pickerSector,
  setPickerSector,
  pickerSearch,
  setPickerSearch,
  availableSectors,
  isTariffsLoading,
  displayedTariffs,
  items,
  onSelectTariffItem,
  onClose,
}: TariffPickerDialogProps) {
  return (
    <>
      {isTariffPickerOpen && (
        <StandardDialog
          isOpen={isTariffPickerOpen}
          onClose={onClose}
          title="مكتبة التعريفة الجمركية المصرية المعتمدة (القرار 218 لسنة 2022 وتعديلاته)"
          subtitle="اختر البند الجمركي لاستيراد قطع غيار الشاحنات أو البضائع لإدراجه فوراً في دراسة الجدوى وتطبيق نسب الرسوم الدقيقة"
          width="min(1240px, 96vw)"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Quick Sector Selector Tabs */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => setPickerSector('commercial_vehicles_spare_parts')}
                style={{
                  padding: '7px 14px',
                  borderRadius: 20,
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: pickerSector === 'commercial_vehicles_spare_parts' ? '2px solid #170e5e' : '1px solid #cbd5e1',
                  backgroundColor: pickerSector === 'commercial_vehicles_spare_parts' ? '#170e5e' : '#ffffff',
                  color: pickerSector === 'commercial_vehicles_spare_parts' ? '#ffffff' : '#334155',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <CheckShieldIcon size={14} />
                <span>قطع غيار سيارات النقل والتريلات (5%)</span>
              </button>

              <button
                type="button"
                onClick={() => setPickerSector('all')}
                style={{
                  padding: '7px 14px',
                  borderRadius: 20,
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: pickerSector === 'all' ? '2px solid #170e5e' : '1px solid #cbd5e1',
                  backgroundColor: pickerSector === 'all' ? '#170e5e' : '#ffffff',
                  color: pickerSector === 'all' ? '#ffffff' : '#334155',
                }}
              >
                <span>كافة القطاعات</span>
              </button>

              {availableSectors
                .filter((sec: any) => sec.id !== 'commercial_vehicles_spare_parts')
                .map((sec: any) => (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => setPickerSector(sec.id)}
                    style={{
                      padding: '7px 14px',
                      borderRadius: 20,
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      border: pickerSector === sec.id ? '2px solid #170e5e' : '1px solid #cbd5e1',
                      backgroundColor: pickerSector === sec.id ? '#170e5e' : '#ffffff',
                      color: pickerSector === sec.id ? '#ffffff' : '#334155',
                    }}
                  >
                    <span>{sec.name_ar}</span>
                  </button>
                ))}
            </div>

            {/* Search Input Bar */}
            <div style={{ position: 'relative', width: '100%' }}>
              <input
                type="text"
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                placeholder="ابحث برقم البند HS Code أو اسم القطعة أو التصنيف (مثال: فرامل، محرك، تروس، 8708.30، تيل، مساعدين...)"
                style={{
                  width: '100%',
                  height: 40,
                  padding: '6px 40px 6px 14px',
                  border: '1.5px solid #cbd5e1',
                  borderRadius: 8,
                  fontSize: '13px',
                  boxSizing: 'border-box',
                }}
              />
              <span style={{ position: 'absolute', right: 12, top: 11, color: '#94a3b8' }}>
                <SearchIcon size={18} />
              </span>
              {pickerSearch && (
                <button
                  type="button"
                  onClick={() => setPickerSearch('')}
                  style={{
                    position: 'absolute',
                    left: 12,
                    top: 10,
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}
                >
                  ✕
                </button>
              )}
            </div>

            {/* Sector Context Alert */}
            {pickerSector === 'commercial_vehicles_spare_parts' && (
              <div
                style={{
                  padding: '8px 14px',
                  backgroundColor: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: 6,
                  fontSize: '11.5px',
                  color: '#166534',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <CheckShieldIcon size={15} />
                <span>
                  <strong>ميزة تشغيلية لقطاع النقل التجاري:</strong> تخضع قطع غيار سيارات النقل والتريلات لتعريفة جمركية مخفضة وموحدة بنسبة <strong>5%</strong> معفاة من ضريبة الجدول، مع ضريبة قيمة مضافة <strong>14%</strong> ورسوم فحص رقابي (صادرات وواردات) <strong>1%</strong>.
                </span>
              </div>
            )}

            {/* Tariffs Fixed-Layout Table with Zero Horizontal Scrolling */}
            <div
              style={{
                height: '380px',
                maxHeight: '380px',
                minHeight: '280px',
                overflowY: 'scroll',
                overflowX: 'hidden',
                overscrollBehavior: 'contain',
                border: '1px solid #cbd5e1',
                borderRadius: 8,
                backgroundColor: '#ffffff',
              }}
              onWheel={(e) => {
                e.stopPropagation();
              }}
            >
              <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', textAlign: 'right' }}>
                <colgroup>
                  <col style={{ width: '110px' }} />
                  <col style={{ width: '40%' }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '140px' }} />
                </colgroup>
                <thead style={{ position: 'sticky', top: 0, backgroundColor: '#f8fafc', zIndex: 2 }}>
                  <tr style={{ borderBottom: '1px solid #cbd5e1' }}>
                    <th style={{ padding: '10px 12px', fontSize: '11.5px', fontWeight: 800, color: '#334155' }}>HS Code</th>
                    <th style={{ padding: '10px 12px', fontSize: '11.5px', fontWeight: 800, color: '#334155' }}>الوصف وتوصيف البند المعتمد</th>
                    <th style={{ padding: '10px 12px', fontSize: '11.5px', fontWeight: 800, color: '#334155' }}>التصنيف / الجهة الرقابية</th>
                    <th style={{ padding: '10px 12px', fontSize: '11.5px', fontWeight: 800, color: '#334155', textAlign: 'center' }}>الجمارك</th>
                    <th style={{ padding: '10px 12px', fontSize: '11.5px', fontWeight: 800, color: '#334155', textAlign: 'center' }}>قيمة مضافة</th>
                    <th style={{ padding: '10px 12px', fontSize: '11.5px', fontWeight: 800, color: '#334155', textAlign: 'center' }}>الإجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {isTariffsLoading ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '36px', color: '#64748b' }}>
                        جاري تحميل بنود التعريفة الجمركية...
                      </td>
                    </tr>
                  ) : displayedTariffs.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '36px', color: '#64748b' }}>
                        لا توجد بنود مطابقة لبحثك في هذا القطاع.
                      </td>
                    </tr>
                  ) : (
                    displayedTariffs.map((t: any) => (
                      <tr
                        key={t.id || t.hs_code}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          transition: 'background-color 0.1s',
                        }}
                      >
                        <td style={{ padding: '8px 12px', verticalAlign: 'middle' }}>
                          <span
                            style={{
                              fontFamily: 'monospace',
                              fontWeight: 800,
                              fontSize: '12px',
                              color: '#170e5e',
                              backgroundColor: '#eef2ff',
                              padding: '2px 6px',
                              borderRadius: 4,
                              display: 'inline-block',
                              direction: 'ltr',
                            }}
                          >
                            {t.hs_code}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', verticalAlign: 'middle' }}>
                          <div
                            style={{
                              fontSize: '12px',
                              fontWeight: 700,
                              color: '#0f172a',
                              whiteSpace: 'normal',
                              wordBreak: 'break-word',
                              lineHeight: 1.45,
                              textJustify: 'inter-word',
                            }}
                          >
                            {t.description_ar}
                          </div>
                          {t.description_en && (
                            <div
                              style={{
                                fontSize: '10.5px',
                                color: '#64748b',
                                whiteSpace: 'normal',
                                wordBreak: 'break-word',
                                direction: 'ltr',
                                textAlign: 'left',
                                marginTop: 2,
                              }}
                            >
                              {t.description_en}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '8px 12px', verticalAlign: 'middle' }}>
                          <div style={{ fontSize: '11px', fontWeight: 600, color: '#334155' }}>
                            {t.category_ar || 'قطع غيار ومكونات'}
                          </div>
                          <span
                            style={{
                              display: 'inline-block',
                              marginTop: 2,
                              fontSize: '10px',
                              fontWeight: 700,
                              color: '#475569',
                              backgroundColor: '#f1f5f9',
                              padding: '1px 6px',
                              borderRadius: 4,
                            }}
                          >
                            {t.regulatory_body || 'GOEIC رقابة صادرات'}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                          <span
                            style={{
                              fontSize: '12px',
                              fontWeight: 800,
                              color: Number(t.duty_rate_percent) <= 5 ? '#15803d' : '#0f172a',
                              backgroundColor: Number(t.duty_rate_percent) <= 5 ? '#dcfce7' : '#f8fafc',
                              padding: '2px 8px',
                              borderRadius: 6,
                              display: 'inline-block',
                            }}
                          >
                            {t.duty_rate_percent}%
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                          <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#475569' }}>
                            {t.vat_rate_percent}%
                          </span>
                          <span style={{ display: 'block', fontSize: '9.5px', color: '#94a3b8' }}>
                            + {t.inspection_fees_percent || 1}% فحص
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                          {items.some((it) => it.hsCode === t.hs_code || it.name === t.description_ar) ? (
                            <button
                              type="button"
                              onClick={() => {
                                toast.warning(`البند الجمركي (${t.hs_code}) "${t.description_ar.slice(0, 30)}..." مضاف بالفعل في دراسة الجدوى.`);
                              }}
                              style={{
                                width: '100%',
                                padding: '6px 10px',
                                backgroundColor: '#f0fdf4',
                                color: '#166534',
                                border: '1px solid #bbf7d0',
                                borderRadius: 6,
                                fontSize: '11px',
                                fontWeight: 700,
                                cursor: 'default',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 4,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <CheckCircleIcon size={13} color="#16a34a" />
                              <span>مضاف بالدراسة</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onSelectTariffItem(t)}
                              style={{
                                width: '100%',
                                padding: '6px 10px',
                                backgroundColor: '#170e5e',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: 6,
                                fontSize: '11.5px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 4,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <PlusCircleIcon size={13} />
                              <span>+ إدراج في الجدوى</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Dialog Footer Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                تم إدراج {items.length} صنف في دراسة الجدوى الحالية. يمكنك إدراج أكثر من بند متتالي دون إغلاق النافذة.
              </span>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '8px 20px',
                  backgroundColor: '#170e5e',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                تم والعودة لدراسة الجدوى
              </button>
            </div>
          </div>
        </StandardDialog>
      )}
    </>
  );
}
