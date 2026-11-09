import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RestaurantOperationsDialog } from './RestaurantOperationsDialog';
import { toast } from '@/shared/components/system-alert';
import { PlusCircleIcon, TrashIcon, CheckCircleIcon } from '@/shared/components/icons/AppIcons';
import { restaurantAdvancedFnbApi } from '@/features/pos/api/restaurant-advanced-fnb.api';
import { formatCurrency, todayLocalDateKey } from '@/lib/format';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';

interface PosTipPoolModalProps {
  open: boolean;
  onClose: () => void;
  branchId?: number | null;
  currency?: string;
  initialCashTips?: number;
  initialCardTips?: number;
  onBack?: () => void;
}

interface StaffMember {
  employeeId: number;
  employeeName: string;
  roleName: string;
  hoursWorked: number;
  pointWeight: number;
}

export function PosTipPoolModal({
  open,
  onClose,
  branchId: _branchId,
  currency = 'ج.م',
  initialCashTips = 0,
  initialCardTips = 0,
  onBack,
}: PosTipPoolModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // INV-REST-FNB-CLAIMS-POST: the shift date is the tenant-local business
  // day (local calendar parts), never the UTC slice — a pool opened at
  // 00:30 Cairo used to be keyed to the previous UTC day, and the server
  // reconciles the totals against that day's collected tips.
  const todayStr = todayLocalDateKey();

  const [shiftDate] = useState(todayStr);
  const [shiftName] = useState('وردية اليوم');
  // INV-REST-FNB-CLAIMS-POST: no invented defaults — the old 250/450 were
  // hardcoded guesses the server now rejects (it reconciles against the
  // actual collected tips), so the cashier types the real counted totals.
  const [cashTips, setCashTips] = useState<number>(initialCashTips || 0);
  const [cardTips, setCardTips] = useState<number>(initialCardTips || 0);
  const [distributionMethod, setDistributionMethod] = useState<'roles' | 'hours' | 'equal'>('roles');
  const [notes] = useState('');

  const [staffList, setStaffList] = useState<StaffMember[]>([]);

  // INV-REST-TIP-STAFF-REAL: the roster is a REAL picker fed by the
  // restaurant-scoped staff list (active hr_employees of this tenant).
  // The old code seeded five invented employees (ids 1-5) and let a
  // typed-in name invent an id from the clock — neither is a person,
  // and the server (which validates every id against hr_employees)
  // would refuse the pool. The list starts empty; nobody is on the
  // roster until a real employee is picked below.
  const { data: staffCandidates = [], isLoading: staffLoading } = useQuery({
    queryKey: ['restaurant-tip-pool-staff'],
    queryFn: () => restaurantAdvancedFnbApi.getTipPoolStaff(),
    enabled: open,
  });
  // The endpoint already returns active employees only; filter again
  // client-side so an inactive row can never be picked even if the
  // payload ever changes. Role is NOT in HR data (no waiter/captain
  // field — only free-form job titles), so no job-title → role mapping
  // is invented: the role stays the per-person select below.
  const activeStaff = staffCandidates.filter((e) => e.status === 'active');
  const availableStaff = activeStaff.filter(
    (e) => !staffList.some((s) => s.employeeId === Number(e.id)),
  );

  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [newStaffRole, setNewStaffRole] = useState('waiter');

  // INV-FE1-FRONTEND-BOOK-DIGITS: tip totals round at the tenant's
  // book digits (global system currency; the `currency` prop is a
  // display symbol like 'ج.م', not a currency code).
  const bookDigits = currencyMoneyDigits(getGlobalSystemCurrency());
  const totalTips = roundMoneyValue(cashTips + cardTips, bookDigits);

  // Compute live preview of allocations
  const roleWeights: Record<string, number> = {
    waiter: 1.2,
    captain: 1.5,
    barista: 1.0,
    kitchen: 0.8,
    cashier: 0.8,
  };

  let totalScore = 0;
  const computedStaff = staffList.map((s) => {
    let weight = s.pointWeight || 1;
    if (distributionMethod === 'roles') {
      weight = roleWeights[s.roleName] || 1;
    } else if (distributionMethod === 'equal') {
      weight = 1;
    }

    const score = distributionMethod === 'equal' ? 1 : weight * (distributionMethod === 'hours' ? s.hoursWorked : 1);
    totalScore += score;
    return { ...s, weight, score };
  });

  const previewAllocations = computedStaff.map((s) => {
    const amount = totalScore > 0 ? (s.score / totalScore) * totalTips : 0;
    return {
      ...s,
      allocatedAmount: roundMoneyValue(amount, bookDigits),
    };
  });

  const calculateMutation = useMutation({
    mutationFn: () =>
      restaurantAdvancedFnbApi.calculateTipPool({
        shiftDate,
        shiftName,
        totalCashTips: cashTips,
        totalCardTips: cardTips,
        distributionMethod,
        notes,
        staff: staffList.map((s) => ({
          employeeId: s.employeeId,
          employeeName: s.employeeName,
          roleName: s.roleName,
          hoursWorked: s.hoursWorked,
          pointWeight: s.pointWeight,
        })),
      }),
    onSuccess: async (res) => {
      // INV-REST-FNB-CLAIMS-POST: calculating a pool does NOT confirm it.
      // The old code auto-confirmed immediately, so one click calculated
      // AND "paid" the tips while no money moved. The pool is saved as a
      // draft; confirming it is a separate, explicit manager step, and
      // even confirming only approves the distribution — the payout stays
      // pending until the money is actually paid out.
      toast.success(`تم حفظ مجمع الإكراميات (${formatCurrency(res.totalTips, currency)}) كمسودة بانتظار الاعتماد — لم يتحرك أي مبلغ بعد`);
      queryClient.invalidateQueries({ queryKey: ['restaurant-tip-pools'] });
      onClose();
    },
    onError: (err: any) => {
      // INV-REST-FNB-CLAIMS-POST: surface the server's message — a
      // reconciliation failure reports the actual collected totals, so the
      // cashier can correct the typed numbers instead of seeing a generic
      // error.
      toast.error(err?.message || 'تعذر حفظ مجمع الإكراميات');
    },
  });

  const handleAddStaff = () => {
    // INV-REST-TIP-STAFF-REAL: only a picked real employee joins the
    // roster, with the wire id converted to the DTO's number — never a
    // typed-in name, never an invented id. The wire id is a string;
    // a NaN conversion is refused instead of being sent to the server.
    const picked = activeStaff.find((e) => e.id === selectedEmployeeId);
    if (!picked) {
      toast.warning('يرجى اختيار موظف من القائمة');
      return;
    }
    const employeeId = Number(picked.id);
    if (!Number.isSafeInteger(employeeId) || employeeId <= 0) {
      toast.warning('معرف الموظف المختار غير صالح');
      return;
    }
    if (staffList.some((s) => s.employeeId === employeeId)) {
      toast.warning('الموظف مضاف بالفعل إلى الوردية');
      return;
    }
    setStaffList([
      ...staffList,
      {
        employeeId,
        employeeName: picked.displayName,
        roleName: newStaffRole,
        hoursWorked: picked.expectedDailyHours ?? 8,
        pointWeight: roleWeights[newStaffRole] || 1,
      },
    ]);
    setSelectedEmployeeId('');
  };

  const handleRemoveStaff = (id: number) => {
    setStaffList(staffList.filter((s) => s.employeeId !== id));
  };

  return (
    <RestaurantOperationsDialog
      open={open}
      onClose={onClose}
      onBack={onBack}
      backText={t('pos.pos_workspace.pos_tip_pool_modal.s0', "الرجوع لعمليات المطعم")}
      title={t('pos.pos_workspace.pos_tip_pool_modal.s1', "مجمع الإكراميات وتوزيع حصص الوردية (Tip Pooling & Distribution Engine)")}
      subtitle={t('pos.pos_workspace.pos_tip_pool_modal.s2', "حساب وتوزيع إكراميات الكاشير والبطاقات على طاقم الصالة والمطبخ وفق معايير Toast و Foodics العالمية")}
      footerNote={t('pos.pos_workspace.pos_tip_pool_modal.s3', "سيتم ترحيل مستحقات كل موظف وإمكانية طباعة إيصالات الصرف الحرارية فور الاعتماد.")}
      footerActions={
        <button
          type="button"
          onClick={() => calculateMutation.mutate()}
          disabled={calculateMutation.isPending || totalTips <= 0 || staffList.length === 0}
          style={{
            padding: '5px 16px',
            borderRadius: '7px',
            background: '#170e5e',
            color: '#fff',
            fontSize: '12px',
            fontWeight: 800,
            border: 'none',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
          }}
        >
          <CheckCircleIcon size={14} />
          <span>{t('pos.pos_workspace.pos_tip_pool_modal.s4', "حفظ مجمع الإكراميات")}</span>
        </button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* Top Summary Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '12px',
          }}
        >
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px' }}>
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>{t('pos.pos_workspace.pos_tip_pool_modal.s5', "إكراميات نقدية (Cash Tips)")}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
              <input
                type="number"
                value={cashTips}
                onChange={(e) => setCashTips(Math.max(0, Number(e.target.value)))}
                style={{
                  width: '100%',
                  fontSize: '16px',
                  fontWeight: 800,
                  color: '#16a34a',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  padding: '4px 8px',
                }}
              />
              <span style={{ fontSize: '12px', color: '#64748b' }}>{currency}</span>
            </div>
          </div>

          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px' }}>
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>{t('pos.pos_workspace.pos_tip_pool_modal.s6', "إكراميات البطاقات والـ QR")}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
              <input
                type="number"
                value={cardTips}
                onChange={(e) => setCardTips(Math.max(0, Number(e.target.value)))}
                style={{
                  width: '100%',
                  fontSize: '16px',
                  fontWeight: 800,
                  color: '#2563eb',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  padding: '4px 8px',
                }}
              />
              <span style={{ fontSize: '12px', color: '#64748b' }}>{currency}</span>
            </div>
          </div>

          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '10px 14px' }}>
            <div style={{ fontSize: '11px', color: '#1e40af', fontWeight: 700 }}>{t('pos.pos_workspace.pos_tip_pool_modal.s7', "إجمالي مجمع الوردية للتقسيم")}</div>
            <div style={{ fontSize: '20px', fontWeight: 900, color: '#170e5e', marginTop: '4px' }}>
              {formatCurrency(totalTips, currency)}
            </div>
          </div>

          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px' }}>
            <div style={{ fontSize: '11px', color: '#475569', fontWeight: 700, marginBottom: '4px' }}>{t('pos.pos_workspace.pos_tip_pool_modal.s8', "نموذج التوزيع:")}</div>
            <select
              value={distributionMethod}
              onChange={(e) => setDistributionMethod(e.target.value as any)}
              style={{
                width: '100%',
                padding: '5px 8px',
                fontSize: '12px',
                fontWeight: 700,
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                outline: 'none',
              }}
            >
              <option value="roles">{t('pos.pos_workspace.pos_tip_pool_modal.s9', "أوزان الأدوار الوظيفية (Role-Based Points)")}</option>
              <option value="hours">{t('pos.pos_workspace.pos_tip_pool_modal.s10', "ساعات العمل الفعلية (Hours Worked)")}</option>
              <option value="equal">{t('pos.pos_workspace.pos_tip_pool_modal.s11', "التساوي بين الجميع (Equal Split)")}</option>
            </select>
          </div>
        </div>

        {/* Staff Table & Fast Add */}
        <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
          <div
            style={{
              padding: '8px 12px',
              background: '#f1f5f9',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#1e293b' }}>
              {t('pos.pos_workspace.pos_tip_pool_modal.s12', "طاقم الوردية المستحق للإكرامية (")}{staffList.length} {t('pos.pos_workspace.pos_tip_pool_modal.s13', "موظف)")}
            </span>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <select
                value={selectedEmployeeId}
                onChange={(e) => setSelectedEmployeeId(e.target.value)}
                disabled={staffLoading || availableStaff.length === 0}
                aria-label={t('pos.pos_workspace.pos_tip_pool_modal.s34', "اختر موظفاً من القائمة")}
                style={{ padding: '4px 6px', fontSize: '12px', borderRadius: '6px', border: '1px solid #cbd5e1', width: '150px' }}
              >
                <option value="">
                  {staffLoading
                    ? t('pos.pos_workspace.pos_tip_pool_modal.s35', "جارٍ تحميل الموظفين…")
                    : t('pos.pos_workspace.pos_tip_pool_modal.s36', "اختر موظفاً…")}
                </option>
                {availableStaff.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.displayName}
                  </option>
                ))}
              </select>
              <select
                value={newStaffRole}
                onChange={(e) => setNewStaffRole(e.target.value)}
                aria-label={t('pos.pos_workspace.pos_tip_pool_modal.s40', "الدور الوظيفي للموظف المختار")}
                style={{ padding: '4px 6px', fontSize: '12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              >
                <option value="waiter">{t('pos.pos_workspace.pos_tip_pool_modal.s15', "ويتر صالة")}</option>
                <option value="captain">{t('pos.pos_workspace.pos_tip_pool_modal.s16', "كابتن صالة")}</option>
                <option value="barista">{t('pos.pos_workspace.pos_tip_pool_modal.s17', "باريستا")}</option>
                <option value="kitchen">{t('pos.pos_workspace.pos_tip_pool_modal.s18', "طاقم المطبخ")}</option>
                <option value="cashier">{t('pos.pos_workspace.pos_tip_pool_modal.s19', "كاشير")}</option>
              </select>
              <button
                type="button"
                onClick={handleAddStaff}
                disabled={staffLoading || availableStaff.length === 0}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  background: '#170e5e',
                  color: '#fff',
                  border: 'none',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <PlusCircleIcon size={13} />
                <span>{t('pos.pos_workspace.pos_tip_pool_modal.s20', "إضافة")}</span>
              </button>
            </div>
          </div>

          <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'right' }}>
              <thead>
                <tr style={{ background: '#f8fafc', color: '#475569', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '8px 12px' }}>{t('pos.pos_workspace.pos_tip_pool_modal.s21', "اسم الموظف")}</th>
                  <th style={{ padding: '8px 12px' }}>{t('pos.pos_workspace.pos_tip_pool_modal.s22', "الدور الوظيفي")}</th>
                  <th style={{ padding: '8px 12px' }}>{t('pos.pos_workspace.pos_tip_pool_modal.s23', "ساعات الوردية")}</th>
                  <th style={{ padding: '8px 12px' }}>{t('pos.pos_workspace.pos_tip_pool_modal.s24', "الوزن النسبي")}</th>
                  <th style={{ padding: '8px 12px' }}>{t('pos.pos_workspace.pos_tip_pool_modal.s25', "الحصة المحسوبة")}</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center' }}>{t('pos.pos_workspace.pos_tip_pool_modal.s26', "إجراء")}</th>
                </tr>
              </thead>
              <tbody>
                {staffList.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: '16px 12px', textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
                      {staffLoading
                        ? t('pos.pos_workspace.pos_tip_pool_modal.s37', "جارٍ تحميل قائمة الموظفين…")
                        : activeStaff.length === 0
                          ? t('pos.pos_workspace.pos_tip_pool_modal.s38', "لا يوجد موظفون نشطون — لا يمكن حفظ مجمع إكراميات بدون طاقم")
                          : t('pos.pos_workspace.pos_tip_pool_modal.s39', "لم تتم إضافة أي موظف بعد — اختر موظفاً من القائمة أعلاه")}
                    </td>
                  </tr>
                )}
                {previewAllocations.map((staff, idx) => (
                  <tr key={staff.employeeId} style={{ borderBottom: '1px solid #f1f5f9', background: idx % 2 === 0 ? '#fff' : '#fcfcfd' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 700, color: '#0f172a' }}>{staff.employeeName}</td>
                    <td style={{ padding: '8px 12px', color: '#475569' }}>
                      {staff.roleName === 'captain' && t('pos.pos_workspace.pos_tip_pool_modal.s27', "كابتن صالة")}
                      {staff.roleName === 'waiter' && t('pos.pos_workspace.pos_tip_pool_modal.s28', "ويتر صالة")}
                      {staff.roleName === 'barista' && t('pos.pos_workspace.pos_tip_pool_modal.s29', "باريستا")}
                      {staff.roleName === 'kitchen' && t('pos.pos_workspace.pos_tip_pool_modal.s30', "شيف / مطبخ")}
                      {staff.roleName === 'cashier' && t('pos.pos_workspace.pos_tip_pool_modal.s31', "كاشير")}
                    </td>
                    <td style={{ padding: '8px 12px', color: '#0f172a' }}>{staff.hoursWorked} {t('pos.pos_workspace.pos_tip_pool_modal.s32', "س")}</td>
                    <td style={{ padding: '8px 12px', color: '#64748b' }}>{staff.weight}x</td>
                    <td style={{ padding: '8px 12px', fontWeight: 800, color: '#16a34a' }}>
                      {formatCurrency(staff.allocatedAmount, currency)}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => handleRemoveStaff(staff.employeeId)}
                        style={{ border: 'none', background: 'transparent', color: '#dc2626', cursor: 'pointer', padding: '2px' }}
                        title={t('pos.pos_workspace.pos_tip_pool_modal.s33', "حذف")}
                      >
                        <TrashIcon size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </RestaurantOperationsDialog>
  );
}
