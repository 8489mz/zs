import React, { useEffect, useMemo, useState } from 'react';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import { toast } from '@/shared/components/system-alert';
import {
  CheckCircleIcon,
  DownloadIcon,
  FileTextIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
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

interface BiometricIntegrationModalProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

type ModalTab = 'file_import' | 'devices_cloud' | 'employee_pins';

export function BiometricIntegrationModal({
  open,
  onClose,
  onImported,
}: BiometricIntegrationModalProps) {
  const [activeTab, setActiveTab] = useState<ModalTab>('file_import');
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [devices, setDevices] = useState<BiometricDeviceItem[]>([]);
  const [employeePins, setEmployeePins] = useState<EmployeePinItem[]>([]);
  const [admsPushPath, setAdmsPushPath] = useState('/api/hr/biometric/iclock/cdata');

  // File Import & User.dat decoder state
  const [selectedFileName, setSelectedFileName] = useState('');
  const [rawLogText, setRawLogText] = useState('');
  const [debounceMinutes, setDebounceMinutes] = useState(3);
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
      const res = await hrApi.biometricDevices();
      setDevices(res.devices || []);
      setEmployeePins(res.employeePins || []);
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
        });
        setPreviewData(res);
        setCustomColumnMapping(res.appliedColumnMapping);
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
      });
      setPreviewData(res);
      setCustomColumnMapping(res.appliedColumnMapping);
    } catch (err: any) {
      toast.error(err?.message || 'تعذر تحليل ملف البصمة');
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
      });
      if (res.imported > 0) {
        toast.success(`تم استيراد ${res.imported} سجل حضور وانصراف بنجاح`);
        onImported();
        onClose();
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
        });
        setPreviewData(refreshed);
      }
    } catch (err: any) {
      toast.error(err?.message || 'تعذر ربط رقم البصمة');
    }
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
              <Button type="button" variant="secondary" onClick={handleExportDecodedUsersCsv}>
                <DownloadIcon size={14} />
                <span>تصدير مستخدمي الجهاز (CSV)</span>
              </Button>
            )}
            {activeTab === 'file_import' && previewData?.mode === 'attendance_log' && previewData?.readyToImportCount > 0 && (
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
                    ? 'جاري الاعتماد والاستيراد...'
                    : `اعتماد واستيراد الحركات (${previewData.readyToImportCount})`}
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
              label: '1. قراءة ملفات البصمة والإكسيل (.dat / .xlsx / .csv / user.dat)',
              icon: <UploadIcon size={14} />,
            },
            {
              id: 'devices_cloud' as ModalTab,
              label: `2. أجهزة البصمة والربط السحابي والشبكي (${devices.length})`,
              icon: <SlidersIcon size={14} />,
            },
            {
              id: 'employee_pins' as ModalTab,
              label: '3. أرقام البصمة للموظفين (PIN Mapping)',
              icon: <UsersIcon size={14} />,
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
                padding: '7px 14px',
                fontSize: '12.5px',
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: '12px',
                alignItems: 'center',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                padding: '10px 14px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    backgroundColor: '#170e5e',
                    color: '#ffffff',
                    padding: '6px 14px',
                    borderRadius: '7px',
                    fontSize: '12.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <UploadIcon size={14} />
                  <span>اختر ملف البصمة أو الإكسيل (.dat / .xlsx / .csv / user.dat)</span>
                  <input
                    type="file"
                    accept=".dat,.txt,.csv,.log,.xlsx,.xls"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const f = e.currentTarget.files?.[0];
                      void handleFilePicked(f);
                      e.currentTarget.value = '';
                    }}
                  />
                </label>
                {selectedFileName && (
                  <span
                    style={{
                      fontSize: '12.5px',
                      fontWeight: 700,
                      color: '#0f172a',
                      background: '#e2e8f0',
                      padding: '4px 10px',
                      borderRadius: '6px',
                    }}
                  >
                    {selectedFileName}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>فلتر البصمة المكررة (دقائق):</span>
                <input
                  type="number"
                  min={0}
                  max={30}
                  value={debounceMinutes}
                  onChange={(e) => setDebounceMinutes(Math.max(0, Number(e.target.value) || 0))}
                  style={{
                    width: '58px',
                    height: '32px',
                    padding: '4px 8px',
                    fontSize: '12.5px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    textAlign: 'center',
                  }}
                />
              </div>
            </div>

            {isPreviewLoading ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  minHeight: '300px',
                  color: '#64748b',
                  gap: '8px',
                }}
              >
                <RefreshCwIcon size={24} />
                <span style={{ fontSize: '13px', fontWeight: 600 }}>جاري تحليل وفك تشفير ملف البصمة...</span>
              </div>
            ) : !previewData ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  minHeight: '300px',
                  border: '1px dashed #cbd5e1',
                  borderRadius: '10px',
                  backgroundColor: '#ffffff',
                  padding: '20px',
                  textAlign: 'center',
                }}
              >
                <FileTextIcon size={32} />
                <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#0f172a', marginTop: '8px' }}>
                  ارفع ملف الحركات من الفلاشة أو الإكسيل بأي ترتيب أعمدة
                </div>
                <div style={{ fontSize: '12px', color: '#64748b', maxWidth: '620px', marginTop: '4px', lineHeight: 1.6 }}>
                  يتعرف المحرك تلقائياً على عمود كود الموظف والتاريخ والوقت مهما كان ترتيب الأعمدة في الملف، ويدعم فك تشفير ملف <code>user.dat</code> لاستخراج أسماء الموظفين وكلمات مرور السوبر أدمن المسجلة داخل الجهاز.
                </div>
              </div>
            ) : previewData.mode === 'user_dat' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: '#eef2ff',
                    border: '1px solid #c7d2fe',
                    borderRadius: '8px',
                    padding: '8px 12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ShieldCheckIcon size={16} />
                    <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#170e5e' }}>
                      تم فك تشفير ملف مستخدمي جهاز البصمة (user.dat) بنجاح — إجمالي {previewData.decodedUsers?.length || 0} مستخدم
                    </span>
                  </div>
                </div>

                <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                        <th style={{ padding: '8px 12px', textAlign: 'right' }}>UID</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right' }}>رقم المستخدم (User ID)</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right' }}>الاسم على الجهاز</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right' }}>مستوى الصلاحية</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right' }}>كلمة المرور المسجلة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(previewData.decodedUsers || []).map((u: any) => (
                        <tr key={u.uid} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '7px 12px', fontWeight: 600 }}>{u.uid}</td>
                          <td style={{ padding: '7px 12px', fontWeight: 800, color: '#170e5e' }}>{u.userId}</td>
                          <td style={{ padding: '7px 12px' }}>{u.name}</td>
                          <td style={{ padding: '7px 12px' }}>
                            <span
                              style={{
                                padding: '2px 8px',
                                borderRadius: '6px',
                                fontSize: '11.5px',
                                fontWeight: 700,
                                background: u.privilegeRole === 'super_admin' ? '#fee2e2' : u.privilegeRole !== 'user' ? '#fef3c7' : '#f1f5f9',
                                color: u.privilegeRole === 'super_admin' ? '#991b1b' : u.privilegeRole !== 'user' ? '#92400e' : '#334155',
                              }}
                            >
                              {u.privilegeLabelAr}
                            </span>
                          </td>
                          <td style={{ padding: '7px 12px', fontFamily: 'monospace', fontWeight: 700, color: u.password ? '#0f172a' : '#94a3b8' }}>
                            {u.password || 'بصمة فقط (بدون باسورد)'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 12px' }}>
                    <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>إجمالي البصمات الخام بالملف</div>
                    <div style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>
                      {previewData.totalRawPunches ?? 0}
                    </div>
                  </div>
                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 12px' }}>
                    <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>بصمات مكررة مستبعدة لحظياً</div>
                    <div style={{ fontSize: '16px', fontWeight: 800, color: '#475569', marginTop: '2px' }}>
                      {previewData.totalDeduplicatedTaps ?? 0}
                    </div>
                  </div>
                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 12px' }}>
                    <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>حركات أرشيفية خارج الشهر المفتوح</div>
                    <div style={{ fontSize: '16px', fontWeight: 800, color: '#d97706', marginTop: '2px' }}>
                      {previewData.historicalOutOfMonthCount ?? 0}
                    </div>
                  </div>
                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '8px 12px' }}>
                    <div style={{ fontSize: '11.5px', color: '#166534', fontWeight: 600 }}>جاهز للاعتماد بالشهر المفتوح</div>
                    <div style={{ fontSize: '16px', fontWeight: 800, color: '#15803d', marginTop: '2px' }}>
                      {previewData.readyToImportCount ?? 0} يوم عمل
                    </div>
                  </div>
                </div>

                {previewData.detectedColumns?.length >= 2 && (
                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#170e5e' }}>
                        ترتيب الأعمدة المكتشف تلقائياً (يمكنك تعديل أي عمود إذا كان الملف من جهاز مختلف):
                      </span>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', fontWeight: 600, color: '#334155', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={Boolean(previewData.appliedColumnMapping?.hasHeaderRow)}
                          onChange={(e) => void handleUpdateColumnMapping({ hasHeaderRow: e.target.checked })}
                        />
                        <span>السطر الأول يحتوي على عناوين أعمدة</span>
                      </label>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                      <div>
                        <span style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '2px' }}>
                          عمود كود الموظف / البصمة:
                        </span>
                        <CustomSelect
                          value={String(previewData.appliedColumnMapping?.pinColIndex ?? 0)}
                          onChange={(val) => void handleUpdateColumnMapping({ pinColIndex: Number(val) })}
                          options={previewData.detectedColumns.map((col: any) => ({
                            value: String(col.index),
                            label: `${col.headerLabel} (${col.sampleValue.slice(0, 18)})`,
                          }))}
                        />
                      </div>
                      <div>
                        <span style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '2px' }}>
                          عمود التاريخ والوقت المدمج:
                        </span>
                        <CustomSelect
                          value={
                            previewData.appliedColumnMapping?.dateTimeColIndex !== null &&
                            previewData.appliedColumnMapping?.dateTimeColIndex !== undefined
                              ? String(previewData.appliedColumnMapping.dateTimeColIndex)
                              : '-1'
                          }
                          onChange={(val) => {
                            const idx = Number(val);
                            void handleUpdateColumnMapping({
                              dateTimeColIndex: idx >= 0 ? idx : -1,
                            });
                          }}
                          options={[
                            { value: '-1', label: '— التاريخ والوقت مفصولان —' },
                            ...previewData.detectedColumns.map((col: any) => ({
                              value: String(col.index),
                              label: `${col.headerLabel} (${col.sampleValue.slice(0, 18)})`,
                            })),
                          ]}
                        />
                      </div>
                      <div>
                        <span style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '2px' }}>
                          عمود التاريخ فقط (إن كان مفصولاً):
                        </span>
                        <CustomSelect
                          value={
                            previewData.appliedColumnMapping?.dateColIndex !== null &&
                            previewData.appliedColumnMapping?.dateColIndex !== undefined
                              ? String(previewData.appliedColumnMapping.dateColIndex)
                              : '-1'
                          }
                          onChange={(val) => {
                            const idx = Number(val);
                            void handleUpdateColumnMapping({
                              dateColIndex: idx >= 0 ? idx : -1,
                              dateTimeColIndex: idx >= 0 ? -1 : previewData.appliedColumnMapping?.dateTimeColIndex,
                            });
                          }}
                          options={[
                            { value: '-1', label: '— غير مستخدم —' },
                            ...previewData.detectedColumns.map((col: any) => ({
                              value: String(col.index),
                              label: `${col.headerLabel} (${col.sampleValue.slice(0, 18)})`,
                            })),
                          ]}
                        />
                      </div>
                      <div>
                        <span style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '2px' }}>
                          عمود الوقت / الحضور (إن كان مفصولاً):
                        </span>
                        <CustomSelect
                          value={
                            previewData.appliedColumnMapping?.checkInTimeColIndex !== null &&
                            previewData.appliedColumnMapping?.checkInTimeColIndex !== undefined
                              ? String(previewData.appliedColumnMapping.checkInTimeColIndex)
                              : '-1'
                          }
                          onChange={(val) => {
                            const idx = Number(val);
                            void handleUpdateColumnMapping({
                              checkInTimeColIndex: idx >= 0 ? idx : -1,
                            });
                          }}
                          options={[
                            { value: '-1', label: '— مدمج مع التاريخ —' },
                            ...previewData.detectedColumns.map((col: any) => ({
                              value: String(col.index),
                              label: `${col.headerLabel} (${col.sampleValue.slice(0, 18)})`,
                            })),
                          ]}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {previewData.unmatchedPins?.length > 0 && (
                  <div
                    style={{
                      background: '#fffbeb',
                      border: '1px solid #fde68a',
                      borderRadius: '8px',
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#92400e' }}>
                      أرقام بصمة في الملف غير مربوطة بموظفين حالياً ({previewData.unmatchedPins.length} رقم) — يمكنك ربطها فوراً:
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {previewData.unmatchedPins.slice(0, 6).map((item: { pin: string; daysCount: number }) => (
                        <div
                          key={item.pin}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            background: '#ffffff',
                            border: '1px solid #fcd34d',
                            borderRadius: '6px',
                            padding: '4px 8px',
                          }}
                        >
                          <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>
                            رقم #{item.pin} ({item.daysCount} يوم):
                          </span>
                          <div style={{ width: '175px' }}>
                            <CustomSelect
                              value={quickPinAssignEmpId[item.pin] || ''}
                              onChange={(val) =>
                                setQuickPinAssignEmpId((prev) => ({ ...prev, [item.pin]: String(val) }))
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
                            variant="primary"
                            onClick={() => void handleQuickAssignPin(item.pin)}
                            style={{ padding: '4px 8px', fontSize: '11.5px', backgroundColor: '#170e5e', color: '#fff' }}
                          >
                            ربط
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                        <th style={{ padding: '8px 10px', textAlign: 'right' }}>الموظف</th>
                        <th style={{ padding: '8px 10px', textAlign: 'right' }}>رقم البصمة</th>
                        <th style={{ padding: '8px 10px', textAlign: 'right' }}>التاريخ</th>
                        <th style={{ padding: '8px 10px', textAlign: 'right' }}>أول بصمة (حضور)</th>
                        <th style={{ padding: '8px 10px', textAlign: 'right' }}>آخر بصمة (انصراف)</th>
                        <th style={{ padding: '8px 10px', textAlign: 'right' }}>إجمالي البصمات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(previewData.previewRecords || []).length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                            لا توجد سجلات مطابقة ضمن الشهر المفتوح ({previewData.openPayrollMonth?.from} إلى{' '}
                            {previewData.openPayrollMonth?.to}). يمكنك تصدير الملف الكامل إلى إكسيل من الزر السفلي، أو ربط أرقام البصمة أعلاه.
                          </td>
                        </tr>
                      ) : (
                        (previewData.previewRecords || []).map((rec: any, idx: number) => (
                          <tr key={`${rec.pin}_${rec.workDate}_${idx}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '7px 10px', fontWeight: 700, color: '#0f172a' }}>
                              {rec.employeeName} <span style={{ color: '#64748b', fontSize: '11px' }}>({rec.employeeNo})</span>
                            </td>
                            <td style={{ padding: '7px 10px', fontFamily: 'monospace', fontWeight: 700 }}>{rec.pin}</td>
                            <td style={{ padding: '7px 10px' }}>{rec.workDate}</td>
                            <td style={{ padding: '7px 10px', color: '#15803d', fontWeight: 700 }}>
                              {rec.checkInTime || '—'}
                            </td>
                            <td style={{ padding: '7px 10px', color: rec.checkOutTime ? '#1e40af' : '#d97706', fontWeight: 700 }}>
                              {rec.checkOutTime || 'بصمة منفردة (تُراجع بالاستثناءات)'}
                            </td>
                            <td style={{ padding: '7px 10px', fontSize: '11.5px', color: '#475569' }}>
                              {rec.rawPunchCount} بصمة
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'devices_cloud' && (
          <BiometricDevicesCloudTab
            devices={devices}
            loadingDevices={loadingDevices}
            fullCloudUrl={fullCloudUrl}
            onDevicesUpdated={setDevices}
            onImported={onImported}
          />
        )}

        {activeTab === 'employee_pins' && (
          <BiometricEmployeePinsTab
            employeePins={employeePins}
            pinDrafts={pinDrafts}
            setPinDrafts={setPinDrafts}
            onEmployeesUpdated={setEmployeePins}
          />
        )}
      </div>
    </StandardDialog>
  );
}
