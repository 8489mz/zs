import { useState } from 'react';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import { toast, systemConfirm } from '@/shared/components/system-alert';
import { CheckCircleIcon, PlusIcon, TrashIcon, UsersIcon } from '@/shared/components/icons/AppIcons';
import { hrApi } from '@/features/hr/api/hr.api';
import type { EmployeePinItem } from './BiometricDevicesAndPinsTabs';

export interface PendingBiometricGroup {
  pin: string;
  deviceSerial: string;
  daysCount: number;
  totalPunches: number;
  minDate: string;
  maxDate: string;
  recentDays: Array<{ workDate: string; checkInAt: string | null; checkOutAt: string | null }>;
}

interface BiometricPendingPunchesTabProps {
  groups: PendingBiometricGroup[];
  employeePins: EmployeePinItem[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onAttendanceChanged: () => void;
}

export function BiometricPendingPunchesTab({
  groups,
  employeePins,
  loading,
  onRefresh,
  onAttendanceChanged,
}: BiometricPendingPunchesTabProps) {
  const [selectedEmpByPin, setSelectedEmpByPin] = useState<Record<string, string>>({});
  const [busyPin, setBusyPin] = useState<string | null>(null);

  const handleLinkAndPost = async (pin: string) => {
    const empId = Number(selectedEmpByPin[pin]);
    if (!empId) {
      toast.warning('اختر الموظف أولاً لربطه برقم البصمة وترحيل حركاته');
      return;
    }
    setBusyPin(pin);
    try {
      const res = await hrApi.assignEmployeeBiometricPin(empId, pin);
      const posted = Number(res?.postedPendingDays || 0);
      toast.success(
        posted > 0
          ? `تم ربط رقم البصمة (#${pin}) وترحيل ${posted} يوم عمل إلى جدول الحضور بنجاح`
          : `تم ربط رقم البصمة (#${pin}) بالموظف بنجاح`,
      );
      await onRefresh();
      if (posted > 0) onAttendanceChanged();
    } catch (err: any) {
      toast.error(err?.message || 'تعذر ربط رقم البصمة');
    } finally {
      setBusyPin(null);
    }
  };

  const handleCreateEmployeeAndPost = async (pin: string) => {
    setBusyPin(pin);
    try {
      const res = await hrApi.createEmployeeFromBiometricPin({ pin });
      toast.success(
        `تم إنشاء الموظف (${res.displayName}) وترحيل ${res.postedDays} يوم عمل إلى الحضور؛ يمكنك استكمال راتبه من شاشة الموظفين`,
      );
      await onRefresh();
      onAttendanceChanged();
    } catch (err: any) {
      toast.error(err?.message || 'تعذر إنشاء الموظف من رقم البصمة');
    } finally {
      setBusyPin(null);
    }
  };

  const handleDismiss = async (pin: string) => {
    const ok = await systemConfirm({
      title: 'تجاهل رقم بصمة غير موظف',
      message: `هل تريد تجاهل البصمات المعلقة للرقم (#${pin})؟ يُستخدم هذا الخيار لأرقام الفنيين أو حسابات السوبر أدمن على الماكينة.`,
      confirmText: 'تجاهل الرقم',
      cancelText: 'إلغاء',
      variant: 'danger',
    });
    if (!ok) return;
    setBusyPin(pin);
    try {
      await hrApi.dismissPendingBiometricPin(pin);
      toast.success(`تم تجاهل الرقم (#${pin}) وإزالته من المعلقات`);
      await onRefresh();
    } catch (err: any) {
      toast.error(err?.message || 'تعذر تجاهل الرقم');
    } finally {
      setBusyPin(null);
    }
  };

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          minHeight: '340px',
          color: '#64748b',
          fontSize: '13px',
          fontWeight: 600,
        }}
      >
        جاري تحميل البصمات المعلقة...
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          minHeight: '340px',
          border: '1px dashed #cbd5e1',
          borderRadius: '10px',
          backgroundColor: '#ffffff',
          padding: '20px',
          textAlign: 'center',
          gap: '8px',
        }}
      >
        <CheckCircleIcon size={32} />
        <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#0f172a' }}>
          لا توجد بصمات معلقة بانتظار الربط حالياً
        </div>
        <div style={{ fontSize: '12px', color: '#64748b', maxWidth: '560px', lineHeight: 1.6 }}>
          أي بصمة تصل من الماكينة (سحابياً أو عبر الشبكة أو الفلاشة) لرقم موظف غير مسجل بعد في النظام تُحفظ هنا تلقائياً لحين ربطها بموظف أو إنشاء ملف موظف جديد لها دون أن تضيع أي حركة.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div
        style={{
          background: '#fffbeb',
          border: '1px solid #fde68a',
          borderRadius: '8px',
          padding: '8px 12px',
          fontSize: '12px',
          color: '#92400e',
          fontWeight: 600,
        }}
      >
        يوجد {groups.length} رقم بصمة مسجّل له حركات محفوظة بأمان بانتظار الربط؛ يمكنك ربط الرقم بموظف حالي أو إنشاء موظف جديد لترحيل كل أيامه للحضور والرواتب فوراً:
      </div>

      <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              <th style={{ padding: '8px 10px', textAlign: 'right' }}>رقم البصمة (PIN)</th>
              <th style={{ padding: '8px 10px', textAlign: 'right' }}>الأيام / البصمات</th>
              <th style={{ padding: '8px 10px', textAlign: 'right' }}>الفترة المسجلة</th>
              <th style={{ padding: '8px 10px', textAlign: 'right' }}>ربط بموظف مسجل وترحيل</th>
              <th style={{ padding: '8px 10px', textAlign: 'center' }}>أو إنشاء موظف جديد</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((grp) => {
              const isBusy = busyPin === grp.pin;
              return (
                <tr key={grp.pin} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontWeight: 800, color: '#170e5e' }}>
                    #{grp.pin}
                    <div style={{ fontSize: '10.5px', color: '#64748b', fontWeight: 500 }}>{grp.deviceSerial}</div>
                  </td>
                  <td style={{ padding: '8px 10px', fontWeight: 700 }}>
                    {grp.daysCount} يوم ({grp.totalPunches} بصمة)
                  </td>
                  <td style={{ padding: '8px 10px', fontSize: '11.5px', color: '#475569' }}>
                    {grp.minDate === grp.maxDate ? grp.minDate : `${grp.minDate} ← ${grp.maxDate}`}
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ width: '190px' }}>
                        <CustomSelect
                          value={selectedEmpByPin[grp.pin] || ''}
                          onChange={(val) =>
                            setSelectedEmpByPin((prev) => ({ ...prev, [grp.pin]: String(val) }))
                          }
                          options={employeePins.map((emp) => ({
                            value: String(emp.id),
                            label: emp.displayName,
                            hint: emp.employeeNo,
                          }))}
                          placeholder="اختر الموظف..."
                        />
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={isBusy}
                        onClick={() => void handleLinkAndPost(grp.pin)}
                        style={{ padding: '4px 9px', fontSize: '11.5px', whiteSpace: 'nowrap' }}
                      >
                        <UsersIcon size={12} />
                        <span>ربط وترحيل</span>
                      </Button>
                    </div>
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <Button
                        type="button"
                        variant="primary"
                        disabled={isBusy}
                        onClick={() => void handleCreateEmployeeAndPost(grp.pin)}
                        style={{
                          padding: '4px 10px',
                          fontSize: '11.5px',
                          backgroundColor: '#170e5e',
                          color: '#ffffff',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <PlusIcon size={12} />
                        <span>إنشاء موظف وترحيل</span>
                      </Button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleDismiss(grp.pin)}
                        title="تجاهل هذا الرقم"
                        style={{
                          border: '1px solid #fecaca',
                          background: '#fef2f2',
                          color: '#dc2626',
                          borderRadius: '6px',
                          padding: '4px 6px',
                          cursor: 'pointer',
                        }}
                      >
                        <TrashIcon size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
