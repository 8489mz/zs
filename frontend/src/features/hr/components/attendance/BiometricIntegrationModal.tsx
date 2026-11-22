import { useEffect, useMemo, useState } from 'react';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/components/system-alert';
import {
  CheckCircleIcon,
  ClockIcon,
  DownloadIcon,
  PlusIcon,
  SlidersIcon,
  UploadIcon,
  UsersIcon,
} from '@/shared/components/icons/AppIcons';
import { hrApi } from '@/features/hr/api/hr.api';
import {
  BiometricDevicesCloudTab,
  BiometricEmployeePinsTab,
  type BiometricDeviceItem,
  type EmployeePinItem,
} from './BiometricDevicesAndPinsTabs';
import {
  BiometricPendingPunchesTab,
  type PendingBiometricGroup,
} from './BiometricPendingPunchesTab';
import { BiometricFileImportTab } from './BiometricFileImportTab';

interface BiometricIntegrationModalProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

type ModalTab = 'file_import' | 'pending_punches' | 'devices_cloud' | 'employee_pins';

export function BiometricIntegrationModal({
  open,
  onClose,
  onImported,
}: BiometricIntegrationModalProps) {
  const [activeTab, setActiveTab] = useState<ModalTab>('file_import');
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [devices, setDevices] = useState<BiometricDeviceItem[]>([]);
  const [employeePins, setEmployeePins] = useState<EmployeePinItem[]>([]);
  const [pendingGroups, setPendingGroups] = useState<PendingBiometricGroup[]>([]);
  const [admsPushPath, setAdmsPushPath] = useState('/api/hr/biometric/iclock/cdata');

  // File Import & User.dat decoder state
  const [selectedFileName, setSelectedFileName] = useState('');
  const [rawLogText, setRawLogText] = useState('');
  const [debounceMinutes, setDebounceMinutes] = useState(3);
  const [syncScope, setSyncScope] = useState<'since_last' | 'open_month' | 'custom'>('since_last');
  const [customFromDate, setCustomFromDate] = useState('');
  const [customToDate, setCustomToDate] = useState('');
  const [autoCreateEmployees, setAutoCreateEmployees] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [quickPinAssignEmpId, setQuickPinAssignEmpId] = useState<Record<string, string>>({});
  const [customColumnMapping, setCustomColumnMapping] = useState<Record<string, number | boolean | null> | undefined>(
    undefined,
  );
  const [pinDrafts, setPinDrafts] = useState<Record<number, string>>({});

  const loadBiometricConfig = async () => {
    setLoadingDevices(true);
    try {
      const [res, pendingRes] = await Promise.all([
        hrApi.biometricDevices(),
        hrApi.biometricPendingPunches().catch(() => ({ groups: [], totalPendingDays: 0, pendingPinsCount: 0 })),
      ]);
      setDevices(res.devices || []);
      setEmployeePins(res.employeePins || []);
      setPendingGroups(pendingRes.groups || []);
      if (res.admsPushPath) setAdmsPushPath(res.admsPushPath);
      const drafts: Record<number, string> = {};
      for (const emp of res.employeePins || []) {
        drafts[emp.id] = emp.biometricPin || '';
      }
      setPinDrafts(drafts);
    } catch (err: any) {
      toast.error(err?.message || 'تعذر تحميل إعدادات أجهزة البصمة');
    } finally {
      setLoadingDevices(false);
    }
  };

  useEffect(() => {
    if (open) {
      void loadBiometricConfig();
    }
  }, [open]);

  const handleFilePicked = async (file?: File | null) => {
    if (!file) return;
    setSelectedFileName(file.name);
    setIsPreviewLoading(true);
    setPreviewData(null);
    setCustomColumnMapping(undefined);

    try {
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
        const XLSX = await import('xlsx');
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) throw new Error('ملف الإكسيل فارغ');
        const worksheet = workbook.Sheets[firstSheetName];
        const matrix = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          raw: false,
          dateNF: 'yyyy-mm-dd hh:mm:ss',
          defval: '',
        }) as unknown[][];
        const tsvText = matrix
          .filter((row) => Array.isArray(row) && row.some((c) => String(c ?? '').trim().length > 0))
          .map((row) => row.map((c) => String(c ?? '').replace(/\t/g, ' ').trim()).join('\t'))
          .join('\n');
        setRawLogText(tsvText);
        const res = await hrApi.previewBiometricLog({
          rawText: tsvText,
          debounceMinutes,
          syncScope,
          fromDate: syncScope === 'custom' ? customFromDate : null,
          toDate: syncScope === 'custom' ? customToDate : null,
        });
        setPreviewData(res);
        setCustomColumnMapping(res.appliedColumnMapping);
        if (res.openPayrollMonth) {
          setCustomFromDate((prev) => prev || res.openPayrollMonth.from);
          setCustomToDate((prev) => prev || res.openPayrollMonth.to);
        }
        return;
      }

      if (lowerName === 'user.dat' || (lowerName.endsWith('.dat') && file.size > 0 && file.size % 72 === 0 && file.size <= 360000)) {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const hasBinaryNulls = bytes.subarray(0, Math.min(24, bytes.length)).includes(0);
        if (hasBinaryNulls) {
          let binaryStr = '';
          for (let i = 0; i < bytes.length; i++) {
            binaryStr += String.fromCharCode(bytes[i]);
          }
          const base64UserDat = window.btoa(binaryStr);
          const res = await hrApi.previewBiometricLog({ base64UserDat });
          setPreviewData(res);
          setRawLogText('');
          toast.success(`تم فك ملف مستخدمي جهاز البصمة (${res.decodedUsers?.length || 0} مستخدم)`);
          return;
        }
      }

      const text = await file.text();
      setRawLogText(text);
      const res = await hrApi.previewBiometricLog({
        rawText: text,
        debounceMinutes,
        syncScope,
        fromDate: syncScope === 'custom' ? customFromDate : null,
        toDate: syncScope === 'custom' ? customToDate : null,
      });
      setPreviewData(res);
      setCustomColumnMapping(res.appliedColumnMapping);
      if (res.openPayrollMonth) {
        setCustomFromDate((prev) => prev || res.openPayrollMonth.from);
        setCustomToDate((prev) => prev || res.openPayrollMonth.to);
      }
    } catch (err: any) {
      toast.error(err?.message || 'تعذر تحليل ملف البصمة');
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleChangeDateScope = async (
    nextScope: 'since_last' | 'open_month' | 'custom',
    nextFrom?: string,
    nextTo?: string,
  ) => {
    const resolvedFrom = nextFrom !== undefined ? nextFrom : customFromDate || previewData?.openPayrollMonth?.from || '';
    const resolvedTo = nextTo !== undefined ? nextTo : customToDate || previewData?.openPayrollMonth?.to || '';
    setSyncScope(nextScope);
    if (nextFrom !== undefined) setCustomFromDate(nextFrom);
    if (nextTo !== undefined) setCustomToDate(nextTo);
    if (!rawLogText) return;
    setIsPreviewLoading(true);
    try {
      const res = await hrApi.previewBiometricLog({
        rawText: rawLogText,
        debounceMinutes,
        columnMapping: customColumnMapping,
        syncScope: nextScope,
        fromDate: nextScope === 'custom' ? resolvedFrom : null,
        toDate: nextScope === 'custom' ? resolvedTo : null,
      });
      setPreviewData(res);
    } catch (err: any) {
      toast.error(err?.message || 'تعذر تحديث نطاق التواريخ');
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleUpdateColumnMapping = async (patch: Record<string, number | boolean | null>) => {
    if (!rawLogText) return;
    const nextMapping = {
      ...(customColumnMapping || previewData?.appliedColumnMapping || {}),
      ...patch,
    };
    setCustomColumnMapping(nextMapping);
    setIsPreviewLoading(true);
    try {
      const res = await hrApi.previewBiometricLog({
        rawText: rawLogText,
        debounceMinutes,
        columnMapping: nextMapping,
        syncScope,
        fromDate: syncScope === 'custom' ? customFromDate : null,
        toDate: syncScope === 'custom' ? customToDate : null,
      });
      setPreviewData(res);
    } catch (err: any) {
      toast.error(err?.message || 'تعذر إعادة تحليل الأعمدة');
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleExecuteImport = async () => {
    if (!rawLogText) return;
    setIsImporting(true);
    try {
      const res = await hrApi.importBiometricLog({
        rawText: rawLogText,
        debounceMinutes,
        onlyOpenPayrollMonth: true,
        columnMapping: customColumnMapping,
        autoCreateEmployees,
        stageUnmatched: true,
        syncScope,
        fromDate: syncScope === 'custom' ? customFromDate : null,
        toDate: syncScope === 'custom' ? customToDate : null,
      });
      await loadBiometricConfig();
      if (res.imported > 0) {
        const extra =
          res.autoCreatedEmployees && res.autoCreatedEmployees > 0
            ? ` (تم إنشاء ${res.autoCreatedEmployees} موظف تلقائياً)`
            : res.stagedPendingCount && res.stagedPendingCount > 0
              ? ` وحفظ ${res.stagedPendingCount} يوم غير مربوط في «البصمات المعلقة»`
              : '';
        toast.success(`تم استيراد ${res.imported} سجل حضور وانصراف بنجاح${extra}`);
        onImported();
        if (!res.stagedPendingCount) onClose();
      } else if (res.stagedPendingCount && res.stagedPendingCount > 0) {
        toast.info(`تم حفظ ${res.stagedPendingCount} يوم في «البصمات المعلقة» بانتظار ربط أو إنشاء الموظفين`);
        setActiveTab('pending_punches');
      } else {
        toast.warning(res.errors?.[0] || 'لم يتم استيراد سجلات جديدة ضمن الشهر المفتوح');
      }
    } catch (err: any) {
      toast.error(err?.message || 'حدث خطأ أثناء استيراد سجلات البصمة');
    } finally {
      setIsImporting(false);
    }
  };

  const handleExportConvertedCsv = () => {
    if (!rawLogText) return;
    const lines = rawLogText.replace(/^\ufeff/, '').split(/\r?\n/);
    const csvRows: string[] = ['كود الموظف (PIN),التاريخ والوقت,طريقة التحقق,الحالة'];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\t|\s{2,}/);
      if (parts.length >= 2) {
        const pin = parts[0].trim();
        const dt = parts[1].trim();
        const verify = parts[2]?.trim() === '0' ? 'كلمة مرور' : 'بصمة إصبع';
        const status = parts[3]?.trim() === '1' ? 'انصراف' : 'حضور';
        csvRows.push(`${pin},${dt},${verify},${status}`);
      }
    }
    const blob = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), csvRows.join('\r\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedFileName.replace(/\.[^.]+$/, '') || 'attendance'}_excel.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success('تم تصدير ملف الحركات بصيغة إكسيل (CSV)');
  };

  const handleExportDecodedUsersCsv = () => {
    if (!previewData?.decodedUsers?.length) return;
    const rows = ['المعرف الداخلي (UID),رقم المستخدم (User ID),الاسم,الصلاحية,كلمة المرور المسجلة'];
    for (const u of previewData.decodedUsers) {
      rows.push(`${u.uid},${u.userId},"${u.name || ''}",${u.privilegeLabelAr},${u.password || ''}`);
    }
    const blob = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), rows.join('\r\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'biometric_device_users.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success('تم تصدير قائمة مستخدمي جهاز البصمة');
  };

  const handleQuickAssignPin = async (pin: string) => {
    const empId = Number(quickPinAssignEmpId[pin]);
    if (!empId) {
      toast.warning('اختر الموظف أولاً لربطه برقم البصمة');
      return;
    }
    try {
      await hrApi.assignEmployeeBiometricPin(empId, pin);
      toast.success(`تم ربط رقم البصمة (${pin}) بالموظف بنجاح`);
      await loadBiometricConfig();
      if (rawLogText) {
        const refreshed = await hrApi.previewBiometricLog({
          rawText: rawLogText,
          debounceMinutes,
          columnMapping: customColumnMapping,
          syncScope,
          fromDate: syncScope === 'custom' ? customFromDate : null,
          toDate: syncScope === 'custom' ? customToDate : null,
        });
        setPreviewData(refreshed);
      }
    } catch (err: any) {
      toast.error(err?.message || 'تعذر ربط رقم البصمة');
    }
  };

  const handleQuickCreateEmployee = async (pin: string) => {
    try {
      const res = await hrApi.createEmployeeFromBiometricPin({ pin });
      toast.success(`تم إنشاء الموظف (${res.displayName}) وربطه برقم البصمة (#${pin})`);
      await loadBiometricConfig();
      if (rawLogText) {
        const refreshed = await hrApi.previewBiometricLog({
          rawText: rawLogText,
          debounceMinutes,
          columnMapping: customColumnMapping,
          syncScope,
          fromDate: syncScope === 'custom' ? customFromDate : null,
          toDate: syncScope === 'custom' ? customToDate : null,
        });
        setPreviewData(refreshed);
      }
    } catch (err: any) {
      toast.error(err?.message || 'تعذر إنشاء الموظف');
    }
  };

  const handleBulkCreateFromUserDat = async () => {
    const regularUsers = (previewData?.decodedUsers || []).filter((u: any) => u.privilegeRole === 'user');
    if (!regularUsers.length) {
      toast.warning('لا يوجد موظفون عاديون في ملف user.dat لإنشائهم');
      return;
    }
    setIsImporting(true);
    try {
      const res = await hrApi.bulkCreateEmployeesFromBiometricPins(
        regularUsers.map((u: any) => ({ pin: String(u.userId), displayName: u.name })),
      );
      toast.success(`تم إنشاء ${res.createdCount} موظف جديد (ومطابقة ${res.existedCount} موظف موجود بالفعل)`);
      await loadBiometricConfig();
      if (res.postedDays > 0) onImported();
    } catch (err: any) {
      toast.error(err?.message || 'تعذر إنشاء الموظفين من user.dat');
    } finally {
      setIsImporting(false);
    }
  };

  const handleDownloadBlankTemplate = () => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const csv = `كود الموظف,التاريخ,وقت الحضور,وقت الانصراف\r\n101,${todayIso},09:00,17:00`;
    const blob = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'نموذج_الحضور.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const fullCloudUrl = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}${admsPushPath}`;
  }, [admsPushPath]);

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      compact
      width="min(1140px, 96vw)"
      minHeight="min(560px, 88vh)"
      title="مركز ربط أجهزة البصمة الذكي (فلاشة USB / ربط سحابي ADMS / شبكة محلية)"
      subtitle="قراءة ملفات ZKTeco الخام (.dat / attlog.dat / user.dat) وملفات الإكسيل/CSV بأي ترتيب أعمدة، والربط السحابي."
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>
            يدعم التجميع التلقائي لأول بصمة حضور وآخر بصمة انصراف مع فلترة التكرار اللحظي.
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {activeTab === 'file_import' && rawLogText && (
              <Button type="button" variant="secondary" onClick={handleExportConvertedCsv}>
                <DownloadIcon size={14} />
                <span>تحويل الفلاشة إلى إكسيل (CSV)</span>
              </Button>
            )}
            {activeTab === 'file_import' && previewData?.mode === 'user_dat' && previewData?.decodedUsers?.length > 0 && (
              <>
                <Button
                  type="button"
                  variant="primary"
                  disabled={isImporting}
                  onClick={() => void handleBulkCreateFromUserDat()}
                  style={{ backgroundColor: '#170e5e', color: '#ffffff' }}
                >
                  <PlusIcon size={14} />
                  <span>{isImporting ? 'جاري الإنشاء...' : 'إنشاء موظفي الجهاز بالنظام'}</span>
                </Button>
                <Button type="button" variant="secondary" onClick={handleExportDecodedUsersCsv}>
                  <DownloadIcon size={14} />
                  <span>تصدير مستخدمي الجهاز (CSV)</span>
                </Button>
              </>
            )}
            {activeTab === 'file_import' &&
              previewData?.mode === 'attendance_log' &&
              (previewData?.readyToImportCount > 0 || previewData?.unmatchedInMonthCount > 0) && (
                <Button
                  type="button"
                  variant="primary"
                  disabled={isImporting}
                  onClick={handleExecuteImport}
                  style={{ backgroundColor: '#170e5e', color: '#ffffff' }}
                >
                  <CheckCircleIcon size={14} />
                  <span>
                    {isImporting
                      ? 'جاري التنفيذ...'
                      : previewData.readyToImportCount > 0
                        ? `اعتماد واستيراد الحركات (${previewData.readyToImportCount})`
                        : autoCreateEmployees
                          ? `إنشاء الموظفين واستيراد (${previewData.unmatchedInMonthCount} يوم)`
                          : `حفظ في البصمات المعلقة (${previewData.unmatchedInMonthCount} يوم)`}
                  </span>
                </Button>
              )}
            <Button type="button" variant="secondary" onClick={onClose}>
              إغلاق
            </Button>
          </div>
        </div>
      }
    >
      <div
        style={{
          display: 'flex',
          gap: '6px',
          borderBottom: '1px solid #e2e8f0',
          paddingBottom: '10px',
          marginBottom: '12px',
        }}
      >
        {(
          [
            {
              id: 'file_import' as ModalTab,
              label: '1. قراءة الملفات (.dat / .xlsx / .csv)',
              icon: <UploadIcon size={14} />,
              badgeCount: 0,
            },
            {
              id: 'pending_punches' as ModalTab,
              label: '2. بصمات معلقة بانتظار الربط',
              icon: <ClockIcon size={14} />,
              badgeCount: pendingGroups.length,
            },
            {
              id: 'devices_cloud' as ModalTab,
              label: `3. الأجهزة والربط السحابي (${devices.length})`,
              icon: <SlidersIcon size={14} />,
              badgeCount: 0,
            },
            {
              id: 'employee_pins' as ModalTab,
              label: '4. أرقام البصمة (PIN)',
              icon: <UsersIcon size={14} />,
              badgeCount: 0,
            },
          ] as const
        ).map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 12px',
                fontSize: '12px',
                fontWeight: 600,
                boxSizing: 'border-box',
                borderRadius: '8px',
                border: isActive ? '1px solid #170e5e' : '1px solid #cbd5e1',
                backgroundColor: isActive ? '#170e5e' : '#f8fafc',
                color: isActive ? '#ffffff' : '#334155',
                cursor: 'pointer',
              }}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.badgeCount > 0 && (
                <span
                  style={{
                    background: isActive ? '#ffffff' : '#dc2626',
                    color: isActive ? '#170e5e' : '#ffffff',
                    borderRadius: '10px',
                    padding: '0 6px',
                    fontSize: '11px',
                    fontWeight: 800,
                  }}
                >
                  {tab.badgeCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div
        className="thin-scrollbar"
        style={{
          height: '395px',
          minHeight: '395px',
          maxHeight: '395px',
          boxSizing: 'border-box',
          overflowY: 'auto',
          paddingLeft: '4px',
        }}
      >
        {activeTab === 'file_import' && (
          <BiometricFileImportTab
            selectedFileName={selectedFileName}
            debounceMinutes={debounceMinutes}
            onDebounceMinutesChange={setDebounceMinutes}
            syncScope={syncScope}
            customFromDate={customFromDate}
            customToDate={customToDate}
            onChangeDateScope={handleChangeDateScope}
            autoCreateEmployees={autoCreateEmployees}
            onAutoCreateEmployeesChange={setAutoCreateEmployees}
            isPreviewLoading={isPreviewLoading}
            previewData={previewData}
            employeePins={employeePins}
            quickPinAssignEmpId={quickPinAssignEmpId}
            onSelectQuickPinEmp={(pin, empId) =>
              setQuickPinAssignEmpId((prev) => ({ ...prev, [pin]: empId }))
            }
            onFilePicked={handleFilePicked}
            onDownloadBlankTemplate={handleDownloadBlankTemplate}
            onUpdateColumnMapping={handleUpdateColumnMapping}
            onQuickAssignPin={handleQuickAssignPin}
            onQuickCreateEmployee={handleQuickCreateEmployee}
          />
        )}

        {activeTab === 'pending_punches' && (
          <BiometricPendingPunchesTab
            groups={pendingGroups}
            employeePins={employeePins}
            loading={loadingDevices}
            onRefresh={loadBiometricConfig}
            onAttendanceChanged={onImported}
          />
        )}

        {activeTab === 'devices_cloud' && (
          <BiometricDevicesCloudTab
            devices={devices}
            loadingDevices={loadingDevices}
            fullCloudUrl={fullCloudUrl}
            onDevicesUpdated={setDevices}
            onImported={onImported}
            onRefreshConfig={loadBiometricConfig}
          />
        )}

        {activeTab === 'employee_pins' && (
          <BiometricEmployeePinsTab
            employeePins={employeePins}
            pinDrafts={pinDrafts}
            setPinDrafts={setPinDrafts}
            onEmployeesUpdated={setEmployeePins}
            onRefreshConfig={loadBiometricConfig}
            onAttendanceChanged={onImported}
          />
        )}
      </div>
    </StandardDialog>
  );
}
