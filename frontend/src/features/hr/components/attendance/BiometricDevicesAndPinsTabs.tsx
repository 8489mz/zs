import React, { useMemo, useState } from 'react';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import { toast, systemConfirm } from '@/shared/components/system-alert';
import {
  CopyIcon,
  DownloadIcon,
  PlusIcon,
  RefreshCwIcon,
  TrashIcon,
} from '@/shared/components/icons/AppIcons';
import { hrApi } from '@/features/hr/api/hr.api';

export interface BiometricDeviceItem {
  id: number;
  deviceName: string;
  serialNumber: string;
  deviceBrand: string;
  deviceModel: string | null;
  ipAddress: string | null;
  port: number;
  commKey: string;
  branchName: string | null;
  status: 'active' | 'inactive';
  lastSyncAt: string | null;
  totalPunchesReceived: number;
  notes: string | null;
}

export interface EmployeePinItem {
  id: number;
  employeeNo: string;
  biometricPin: string | null;
  displayName: string;
}

export function BiometricDevicesCloudTab({
  devices,
  loadingDevices,
  fullCloudUrl,
  onDevicesUpdated,
  onImported,
  onRefreshConfig,
}: {
  devices: BiometricDeviceItem[];
  loadingDevices: boolean;
  fullCloudUrl: string;
  onDevicesUpdated: (devices: BiometricDeviceItem[]) => void;
  onImported: () => void;
  onRefreshConfig?: () => Promise<void>;
}) {
  const [deviceName, setDeviceName] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [deviceBrand, setDeviceBrand] = useState('zkteco');
  const [ipAddress, setIpAddress] = useState('192.168.1.201');
  const [port, setPort] = useState('4370');
  const [branchName, setBranchName] = useState('');
  const [isSavingDevice, setIsSavingDevice] = useState(false);
  const [testingDeviceId, setTestingDeviceId] = useState<number | null>(null);
  const [pullingDeviceId, setPullingDeviceId] = useState<number | null>(null);

  const handleAddDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceName.trim() || !serialNumber.trim()) {
      toast.warning('أدخل اسم الجهاز والرقم التسلسلي (Serial Number)');
      return;
    }
    setIsSavingDevice(true);
    try {
      const res = await hrApi.saveBiometricDevice({
        deviceName: deviceName.trim(),
        serialNumber: serialNumber.trim().toUpperCase(),
        deviceBrand,
        ipAddress: ipAddress.trim() || null,
        port: Number(port || 4370),
        branchName: branchName.trim() || null,
        status: 'active',
      });
      onDevicesUpdated(res.devices || []);
      setDeviceName('');
      setSerialNumber('');
      toast.success('تم تسجيل جهاز البصمة بنجاح');
    } catch (err: any) {
      toast.error(err?.message || 'تعذر حفظ جهاز البصمة');
    } finally {
      setIsSavingDevice(false);
    }
  };

  const handleTestLan = async (deviceId: number) => {
    setTestingDeviceId(deviceId);
    try {
      const res = await hrApi.testBiometricDeviceLan(deviceId);
      if (res.reachable) toast.success(res.message);
      else toast.warning(res.message);
    } catch (err: any) {
      toast.error(err?.message || 'فشل اختبار الاتصال بالشبكة المحلية');
    } finally {
      setTestingDeviceId(null);
    }
  };

  const handlePullLan = async (deviceId: number) => {
    setPullingDeviceId(deviceId);
    try {
      const res = await hrApi.pullBiometricDeviceLan(deviceId);
      if (res.imported > 0) {
        toast.success(res.message);
        onImported();
      } else {
        toast.info(res.message || 'تم الاتصال بالجهاز — لا توجد حركات جديدة ضمن الشهر المفتوح');
      }
      if (onRefreshConfig) {
        await onRefreshConfig();
      } else {
        const refreshed = await hrApi.biometricDevices();
        onDevicesUpdated(refreshed.devices || []);
      }
    } catch (err: any) {
      toast.error(err?.message || 'تعذر سحب الحركات من الجهاز عبر الشبكة المحلية');
    } finally {
      setPullingDeviceId(null);
    }
  };

  const handleDeleteDevice = async (deviceId: number, name: string) => {
    const ok = await systemConfirm({
      title: 'حذف جهاز البصمة',
      message: `هل أنت متأكد من حذف جهاز البصمة "${name}"؟ لن يتم استقبال حركات سحابية جديدة من هذا الرقم التسلسلي.`,
      confirmText: 'حذف الجهاز',
      cancelText: 'إلغاء',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const res = await hrApi.deleteBiometricDevice(deviceId);
      onDevicesUpdated(res.devices || []);
      toast.success('تم حذف جهاز البصمة');
    } catch (err: any) {
      toast.error(err?.message || 'تعذر حذف الجهاز');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div
        style={{
          background: '#f8fafc',
          border: '1px solid #cbd5e1',
          borderRadius: '10px',
          padding: '10px 14px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ fontSize: '12.5px', fontWeight: 800, color: '#170e5e' }}>
            الربط السحابي المباشر اللحظي (ZKTeco ADMS / iClock Cloud Push)
          </div>
          <div style={{ fontSize: '11.5px', color: '#475569', marginTop: '2px' }}>
            في شاشة جهاز البصمة ادخل إلى: <b>Comm. &rarr; Cloud Server Setting</b> وفعل خيار <b>Enable Domain Name</b> وضع الرابط التالي ليتم إرسال البصمات لحظياً بمجرد وضع الإصبع:
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <code
            style={{
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              padding: '5px 10px',
              fontSize: '12px',
              fontWeight: 700,
              color: '#0f172a',
              direction: 'ltr',
            }}
          >
            {fullCloudUrl}
          </code>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(fullCloudUrl);
              toast.success('تم نسخ رابط الربط السحابي');
            }}
            style={{ padding: '5px 10px', fontSize: '12px' }}
          >
            <CopyIcon size={13} />
            <span>نسخ</span>
          </Button>
        </div>
      </div>

      <form
        onSubmit={handleAddDevice}
        style={{
          display: 'grid',
          gridTemplateColumns: '1.3fr 1.2fr 0.9fr 1fr 0.6fr 0.9fr auto',
          gap: '8px',
          alignItems: 'end',
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '10px',
          padding: '10px 12px',
        }}
      >
        <div>
          <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
            اسم الجهاز *
          </label>
          <input
            type="text"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            placeholder="مثال: بصمة الفرع الرئيسي"
            style={{ width: '100%', height: '33px', padding: '5px 8px', fontSize: '12.5px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
            الرقم التسلسلي (Serial Number) *
          </label>
          <input
            type="text"
            value={serialNumber}
            onChange={(e) => setSerialNumber(e.target.value)}
            placeholder="مثال: 6422150300031"
            style={{ width: '100%', height: '33px', padding: '5px 8px', fontSize: '12.5px', borderRadius: '6px', border: '1px solid #cbd5e1', fontFamily: 'monospace' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
            الماركة
          </label>
          <CustomSelect
            value={deviceBrand}
            onChange={(val) => setDeviceBrand(String(val))}
            options={[
              { value: 'zkteco', label: 'ZKTeco' },
              { value: 'hikvision', label: 'Hikvision' },
              { value: 'dahua', label: 'Dahua' },
              { value: 'generic', label: 'أخرى' },
            ]}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
            IP الشبكة المحلية
          </label>
          <input
            type="text"
            value={ipAddress}
            onChange={(e) => setIpAddress(e.target.value)}
            placeholder="192.168.1.201"
            style={{ width: '100%', height: '33px', padding: '5px 8px', fontSize: '12.5px', borderRadius: '6px', border: '1px solid #cbd5e1', direction: 'ltr' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
            Port
          </label>
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            style={{ width: '100%', height: '33px', padding: '5px 6px', fontSize: '12.5px', borderRadius: '6px', border: '1px solid #cbd5e1', direction: 'ltr' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
            الفرع / الموقع
          </label>
          <input
            type="text"
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            placeholder="الإدارة"
            style={{ width: '100%', height: '33px', padding: '5px 8px', fontSize: '12.5px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          disabled={isSavingDevice}
          style={{ height: '33px', padding: '0 12px', fontSize: '12.5px', backgroundColor: '#170e5e', color: '#fff', whiteSpace: 'nowrap' }}
        >
          <PlusIcon size={14} />
          <span>إضافة جهاز</span>
        </Button>
      </form>

      <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              <th style={{ padding: '8px 10px', textAlign: 'right' }}>اسم الجهاز</th>
              <th style={{ padding: '8px 10px', textAlign: 'right' }}>الرقم التسلسلي (SN)</th>
              <th style={{ padding: '8px 10px', textAlign: 'right' }}>الماركة</th>
              <th style={{ padding: '8px 10px', textAlign: 'right' }}>عنوان الشبكة (LAN)</th>
              <th style={{ padding: '8px 10px', textAlign: 'right' }}>حركات مستلمة</th>
              <th style={{ padding: '8px 10px', textAlign: 'right' }}>آخر اتصال</th>
              <th style={{ padding: '8px 10px', textAlign: 'center' }}>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {loadingDevices ? (
              <tr>
                <td colSpan={7} style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>
                  جاري تحميل الأجهزة المسجلة...
                </td>
              </tr>
            ) : devices.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>
                  لا توجد أجهزة بصمة مسجلة بعد. أضف الرقم التسلسلي لجهازك (مثل <code>6422150300031</code>) أعلاه لتفعيل الربط السحابي والشبكي.
                </td>
              </tr>
            ) : (
              devices.map((dev) => (
                <tr key={dev.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 700, color: '#0f172a' }}>
                    {dev.deviceName}
                    {dev.branchName && (
                      <span style={{ color: '#64748b', fontSize: '11px', marginRight: '4px' }}>({dev.branchName})</span>
                    )}
                  </td>
                  <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontWeight: 700, color: '#170e5e' }}>
                    {dev.serialNumber}
                  </td>
                  <td style={{ padding: '8px 10px', textTransform: 'uppercase', fontWeight: 600 }}>{dev.deviceBrand}</td>
                  <td style={{ padding: '8px 10px', fontFamily: 'monospace', direction: 'ltr', textAlign: 'right' }}>
                    {dev.ipAddress ? `${dev.ipAddress}:${dev.port}` : '—'}
                  </td>
                  <td style={{ padding: '8px 10px', fontWeight: 700 }}>{dev.totalPunchesReceived} حركة</td>
                  <td style={{ padding: '8px 10px', fontSize: '11.5px', color: '#64748b' }}>
                    {dev.lastSyncAt ? new Date(dev.lastSyncAt).toLocaleString('ar-EG') : 'لم يتصل بعد'}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                    <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                      {dev.ipAddress && (
                        <>
                          <Button
                            type="button"
                            variant="primary"
                            disabled={pullingDeviceId === dev.id}
                            onClick={() => void handlePullLan(dev.id)}
                            style={{ padding: '3px 8px', fontSize: '11.5px', backgroundColor: '#170e5e', color: '#ffffff' }}
                          >
                            <DownloadIcon size={12} />
                            <span>{pullingDeviceId === dev.id ? 'يسحب...' : 'سحب الحركات (LAN)'}</span>
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={testingDeviceId === dev.id}
                            onClick={() => void handleTestLan(dev.id)}
                            style={{ padding: '3px 8px', fontSize: '11.5px' }}
                          >
                            <RefreshCwIcon size={12} />
                            <span>{testingDeviceId === dev.id ? 'يفحص...' : 'فحص LAN'}</span>
                          </Button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleDeleteDevice(dev.id, dev.deviceName)}
                        title="حذف الجهاز"
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
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function BiometricEmployeePinsTab({
  employeePins,
  pinDrafts,
  setPinDrafts,
  onEmployeesUpdated,
  onRefreshConfig,
  onAttendanceChanged,
}: {
  employeePins: EmployeePinItem[];
  pinDrafts: Record<number, string>;
  setPinDrafts: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  onEmployeesUpdated: (employees: EmployeePinItem[]) => void;
  onRefreshConfig?: () => Promise<void>;
  onAttendanceChanged?: () => void;
}) {
  const [pinSearch, setPinSearch] = useState('');
  const [savingPinEmpId, setSavingPinEmpId] = useState<number | null>(null);

  const filteredEmployees = useMemo(() => {
    const q = pinSearch.trim().toLowerCase();
    if (!q) return employeePins;
    return employeePins.filter(
      (e) =>
        e.displayName.toLowerCase().includes(q) ||
        e.employeeNo.toLowerCase().includes(q) ||
        (e.biometricPin || '').toLowerCase().includes(q),
    );
  }, [employeePins, pinSearch]);

  const handleSaveEmployeePin = async (empId: number) => {
    setSavingPinEmpId(empId);
    try {
      const pinVal = (pinDrafts[empId] || '').trim() || null;
      const res = await hrApi.assignEmployeeBiometricPin(empId, pinVal);
      onEmployeesUpdated(res.employeePins || []);
      const posted = Number(res?.postedPendingDays || 0);
      if (posted > 0) {
        toast.success(`تم حفظ رقم البصمة وترحيل ${posted} يوم من «البصمات المعلقة» تلقائياً`);
        if (onRefreshConfig) await onRefreshConfig();
        if (onAttendanceChanged) onAttendanceChanged();
      } else {
        toast.success('تم حفظ رقم البصمة للموظف');
      }
    } catch (err: any) {
      toast.error(err?.message || 'تعذر حفظ رقم البصمة');
    } finally {
      setSavingPinEmpId(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          padding: '8px 12px',
        }}
      >
        <div style={{ fontSize: '12px', color: '#475569' }}>
          يتعرف النظام تلقائياً على كود الموظف أو الرقم المستخرج منه (مثال: <code>EMP-0105</code> يطابق رقم البصمة <code>105</code> تلقائياً). يمكنك أيضاً تخصيص رقم بصمة مختلف لأي موظف هنا:
        </div>
        <input
          type="text"
          value={pinSearch}
          onChange={(e) => setPinSearch(e.target.value)}
          placeholder="ابحث باسم الموظف أو الكود..."
          style={{
            width: '240px',
            height: '32px',
            padding: '4px 10px',
            fontSize: '12.5px',
            borderRadius: '6px',
            border: '1px solid #cbd5e1',
            background: '#ffffff',
          }}
        />
      </div>

      <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              <th style={{ padding: '8px 12px', textAlign: 'right' }}>اسم الموظف</th>
              <th style={{ padding: '8px 12px', textAlign: 'right' }}>كود الموظف بالنظام</th>
              <th style={{ padding: '8px 12px', textAlign: 'right' }}>الرقم التلقائي المستنتج</th>
              <th style={{ padding: '8px 12px', textAlign: 'right' }}>رقم البصمة المخصص على الجهاز (PIN)</th>
              <th style={{ padding: '8px 12px', textAlign: 'center' }}>حفظ</th>
            </tr>
          </thead>
          <tbody>
            {filteredEmployees.map((emp) => {
              const autoCore = emp.employeeNo.replace(/\D+/g, '').replace(/^0+/, '') || emp.employeeNo;
              const currentDraft = pinDrafts[emp.id] ?? emp.biometricPin ?? '';
              const isDirty = currentDraft.trim() !== (emp.biometricPin || '').trim();
              return (
                <tr key={emp.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '7px 12px', fontWeight: 700, color: '#0f172a' }}>{emp.displayName}</td>
                  <td style={{ padding: '7px 12px', fontFamily: 'monospace', fontWeight: 600 }}>{emp.employeeNo}</td>
                  <td style={{ padding: '7px 12px', fontFamily: 'monospace', color: '#64748b' }}>{autoCore}</td>
                  <td style={{ padding: '7px 12px' }}>
                    <input
                      type="text"
                      value={currentDraft}
                      onChange={(e) => setPinDrafts((prev) => ({ ...prev, [emp.id]: e.target.value }))}
                      placeholder={`افتراضي (${autoCore})`}
                      style={{
                        width: '150px',
                        height: '30px',
                        padding: '4px 8px',
                        fontSize: '12.5px',
                        borderRadius: '6px',
                        border: isDirty ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                        fontFamily: 'monospace',
                      }}
                    />
                  </td>
                  <td style={{ padding: '7px 12px', textAlign: 'center' }}>
                    <Button
                      type="button"
                      variant={isDirty ? 'primary' : 'secondary'}
                      disabled={!isDirty || savingPinEmpId === emp.id}
                      onClick={() => void handleSaveEmployeePin(emp.id)}
                      style={{
                        padding: '3px 10px',
                        fontSize: '11.5px',
                        backgroundColor: isDirty ? '#170e5e' : undefined,
                        color: isDirty ? '#ffffff' : undefined,
                      }}
                    >
                      {savingPinEmpId === emp.id ? 'يحفظ...' : 'حفظ'}
                    </Button>
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
