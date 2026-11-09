import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { RestaurantOperationsDialog } from './RestaurantOperationsDialog';
import { toast } from '@/shared/components/system-alert';
import { CheckCircleIcon, PlusCircleIcon, PrinterIcon } from '@/shared/components/icons/AppIcons';
import { restaurantAdvancedFnbApi, RestaurantPrepSheetItem } from '@/features/pos/api/restaurant-advanced-fnb.api';
import { todayLocalIsoDate } from '@/features/pos/lib/pos.domain';
import { printPrepDayDotLabel } from '@/lib/pos-printing/prep-day-dot';

interface KitchenDailyPrepSheetModalProps {
  open: boolean;
  onClose: () => void;
  branchId?: number | null;
  onBack?: () => void;
}

export function KitchenDailyPrepSheetModal({
  open,
  onClose,
  branchId: _branchId,
  onBack,
}: KitchenDailyPrepSheetModalProps) {
  const { t } = useTranslation();
  // INV-REST-FNB-TRUTH-2 (R-I19): tenant-local date — the old UTC
  // toISOString() made 00:00–02:00 Cairo "today's" sheet yesterday's.
  const todayStr = todayLocalIsoDate();

  const [shiftType, setShiftType] = useState<'morning' | 'evening' | 'night'>('morning');
  const [actualValues, setActualValues] = useState<Record<number, number>>({});

  const { data: prepSheets = [], refetch } = useQuery({
    queryKey: ['restaurant-prep-sheets', todayStr],
    queryFn: () => restaurantAdvancedFnbApi.getPrepSheets(todayStr),
    enabled: open,
  });

  const activeSheet = prepSheets[0];

  const generateMutation = useMutation({
    mutationFn: () =>
      restaurantAdvancedFnbApi.generatePrepSheet({
        prepDate: todayStr,
        shiftType,
        notes: `جدول تحضير ${shiftType === 'morning' ? 'الوردية الصباحية' : 'الوردية المسائية'}`,
      }),
    onSuccess: () => {
      toast.success('تم توليد ورقة التحضير اليومية للمطبخ بنجاح');
      refetch();
    },
    onError: () => {
      toast.error('تعذر توليد ورقة التحضير');
    },
  });

  const recordMutation = useMutation({
    mutationFn: ({ itemId, qty }: { itemId: number; qty: number }) =>
      restaurantAdvancedFnbApi.recordPrepProduction(itemId, qty),
    onSuccess: (res) => {
      toast.success(res.message);
      refetch();
    },
    onError: () => {
      toast.error('تعذر تسجيل كمية التحضير');
    },
  });

  const handleStepQty = (itemId: number, currentVal: number, delta: number) => {
    const newVal = Math.max(0, currentVal + delta);
    setActualValues((prev) => ({ ...prev, [itemId]: newVal }));
  };

  const handleSaveItem = (item: RestaurantPrepSheetItem) => {
    const qty = actualValues[item.id] !== undefined ? actualValues[item.id] : Number(item.prep_required);
    recordMutation.mutate({ itemId: item.id, qty });
  };

  const handlePrintDayDot = (item: RestaurantPrepSheetItem) => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const prepDateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const shelfHours = Number(item.shelf_life_hours || 48);
    const expiry = new Date(now.getTime() + shelfHours * 60 * 60 * 1000);
    const expiryDateStr = `${expiry.getFullYear()}-${pad(expiry.getMonth() + 1)}-${pad(expiry.getDate())} ${pad(expiry.getHours())}:${pad(expiry.getMinutes())}`;

    const currentVal = actualValues[item.id] !== undefined ? actualValues[item.id] : Number(item.prep_actual || item.prep_required);

    printPrepDayDotLabel({
      prepItemName: item.product_name,
      prepDate: prepDateStr,
      expiryDate: expiryDateStr,
      shelfLifeHours: shelfHours,
      storageTemp: item.storage_temp || '4°C',
      unitName: item.unit_name,
      batchQty: currentVal,
    });
  };

  return (
    <RestaurantOperationsDialog
      open={open}
      onClose={onClose}
      onBack={onBack}
      backText={t('pos.pos_workspace.kitchen_daily_prep_sheet_modal.s0', "الرجوع لعمليات المطعم")}
      title={t('pos.pos_workspace.kitchen_daily_prep_sheet_modal.s1', "ورقة التحضير اليومية للمطبخ المركزي (Daily Prep Sheet & Commissary)")}
      subtitle={t('pos.pos_workspace.kitchen_daily_prep_sheet_modal.s2', "جدولة ومتابعة تحضير الأصناف نصف المصنعة (تتبيل، صوصات، عجين) لضمان جاهزية الوردية ومنع العجز")}
      footerNote={t('pos.pos_workspace.kitchen_daily_prep_sheet_modal.s3', "الكميات المحضرة تُسجَّل هنا لمتابعة كفاءة الشيف فقط، ولا تخصم من المخزون.")}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* Top Control Bar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '10px 14px',
          }}
        >
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#334155' }}>{t('pos.pos_workspace.kitchen_daily_prep_sheet_modal.s4', "وردية التحضير:")}</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              {(['morning', 'evening', 'night'] as const).map((shift) => (
                <button
                  key={shift}
                  type="button"
                  onClick={() => setShiftType(shift)}
                  style={{
                    padding: '4px 12px',
                    borderRadius: '6px',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    border: shiftType === shift ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                    background: shiftType === shift ? '#170e5e' : '#fff',
                    color: shiftType === shift ? '#fff' : '#475569',
                    cursor: 'pointer',
                  }}
                >
                  {shift === 'morning' && t('pos.pos_workspace.kitchen_daily_prep_sheet_modal.s5', "صباحية (افتتاح)")}
                  {shift === 'evening' && t('pos.pos_workspace.kitchen_daily_prep_sheet_modal.s6', "مسائية (ذروة)")}
                  {shift === 'night' && t('pos.pos_workspace.kitchen_daily_prep_sheet_modal.s7', "ليلية (إغلاق وتجهيز)")}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {!activeSheet ? (
              <button
                type="button"
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  background: '#16a34a',
                  color: '#fff',
                  border: 'none',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <PlusCircleIcon size={14} />
                <span>{t('pos.pos_workspace.kitchen_daily_prep_sheet_modal.s8', "توليد ورقة اليوم بناءً على الاستهلاك المتوقع")}</span>
              </button>
            ) : (
              <span style={{ fontSize: '12px', color: '#166534', background: '#dcfce7', padding: '4px 10px', borderRadius: '6px', fontWeight: 800 }}>
                {t('pos.pos_workspace.kitchen_daily_prep_sheet_modal.s9', "ورقة اليوم معتمدة (")}{activeSheet.items?.length || 0} {t('pos.pos_workspace.kitchen_daily_prep_sheet_modal.s10', "بنود تحضير)")}
              </span>
            )}
          </div>
        </div>

        {/* Prep Items List */}
        <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
          <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', textAlign: 'right' }}>
              <thead>
                <tr style={{ background: '#f8fafc', color: '#475569', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '9px 12px' }}>{t('pos.pos_workspace.kitchen_daily_prep_sheet_modal.s11', "بند التحضير نصف المصنع")}</th>
                  <th style={{ padding: '9px 12px' }}>{t('pos.pos_workspace.kitchen_daily_prep_sheet_modal.s12', "الوحدة")}</th>
                  <th style={{ padding: '9px 12px' }}>{t('pos.pos_workspace.kitchen_daily_prep_sheet_modal.s13', "المستهدف (Par Level)")}</th>
                  <th style={{ padding: '9px 12px' }}>{t('pos.pos_workspace.kitchen_daily_prep_sheet_modal.s14', "المتاح بالثلاجة")}</th>
                  <th style={{ padding: '9px 12px' }}>{t('pos.pos_workspace.kitchen_daily_prep_sheet_modal.s15', "المطلوب تحضيره")}</th>
                  <th style={{ padding: '9px 12px' }}>{t('pos.pos_workspace.kitchen_daily_prep_sheet_modal.s16', "المحضر فعلياً")}</th>
                  <th style={{ padding: '9px 12px', textAlign: 'center' }}>{t('pos.pos_workspace.kitchen_daily_prep_sheet_modal.s17', "الحالة والإجراء")}</th>
                </tr>
              </thead>
              <tbody>
                {activeSheet?.items?.map((item, idx) => {
                  const currentVal =
                    actualValues[item.id] !== undefined
                      ? actualValues[item.id]
                      : Number(item.prep_actual) || Number(item.prep_required);

                  const isCompleted = item.status === 'prepped' || Number(item.prep_actual) >= Number(item.prep_required);

                  return (
                    <tr
                      key={item.id}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        background: isCompleted ? '#f0fdf4' : idx % 2 === 0 ? '#fff' : '#fafafa',
                      }}
                    >
                      <td style={{ padding: '9px 12px', fontWeight: 800, color: '#0f172a' }}>{item.product_name}</td>
                      <td style={{ padding: '9px 12px', color: '#64748b' }}>{item.unit_name}</td>
                      <td style={{ padding: '9px 12px', color: '#0f172a' }}>{item.par_level}</td>
                      <td style={{ padding: '9px 12px', color: '#64748b' }}>{item.current_on_hand}</td>
                      <td style={{ padding: '9px 12px', fontWeight: 800, color: '#b91c1c' }}>{item.prep_required}</td>

                      {/* RTL Stepper: [+] first on the right, [-] on the left */}
                      <td style={{ padding: '9px 12px' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '2px 4px' }}>
                          <button
                            type="button"
                            onClick={() => handleStepQty(item.id, currentVal, 1)}
                            style={{ width: '22px', height: '22px', border: 'none', background: '#f1f5f9', borderRadius: '4px', cursor: 'pointer', fontWeight: 900 }}
                          >
                            +
                          </button>
                          <span style={{ minWidth: '34px', textAlign: 'center', fontWeight: 800, color: '#0f172a' }}>
                            {currentVal}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleStepQty(item.id, currentVal, -1)}
                            style={{ width: '22px', height: '22px', border: 'none', background: '#f1f5f9', borderRadius: '4px', cursor: 'pointer', fontWeight: 900 }}
                          >
                            -
                          </button>
                        </div>
                      </td>

                      <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                          <button
                            type="button"
                            onClick={() => handleSaveItem(item)}
                            disabled={recordMutation.isPending}
                            style={{
                              padding: '4px 10px',
                              borderRadius: '6px',
                              border: 'none',
                              fontSize: '11.5px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              background: isCompleted ? '#16a34a' : '#170e5e',
                              color: '#fff',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <CheckCircleIcon size={12} />
                            <span>{isCompleted ? t('pos.pos_workspace.kitchen_daily_prep_sheet_modal.s18', "مكتمل") : t('pos.pos_workspace.kitchen_daily_prep_sheet_modal.s19', "تأكيد التحضير")}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handlePrintDayDot(item)}
                            style={{
                              padding: '4px 8px',
                              borderRadius: '6px',
                              border: '1px solid #cbd5e1',
                              fontSize: '11px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              background: '#ffffff',
                              color: '#334155',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                            title={t('pos.pos_workspace.kitchen_daily_prep_sheet_modal.s20', "طباعة ملصق الصلاحية الحراري 50x30 مم (Day-Dot)")}
                          >
                            <PrinterIcon size={12} color="#170e5e" />
                            <span>{t('pos.pos_workspace.kitchen_daily_prep_sheet_modal.s21', "ملصق (50x30)")}</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {(!activeSheet || !activeSheet.items || activeSheet.items.length === 0) && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '30px', color: '#94a3b8' }}>
                      {t('pos.pos_workspace.kitchen_daily_prep_sheet_modal.s22', "لا توجد ورقة تحضير منشأة لليوم بعد. انقر على زر \"توليد ورقة اليوم\" للبدء.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </RestaurantOperationsDialog>
  );
}
