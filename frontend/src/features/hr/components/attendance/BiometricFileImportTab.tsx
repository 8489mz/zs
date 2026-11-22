import { useState } from 'react';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import {
  CalendarIcon,
  DownloadIcon,
  FileTextIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  SlidersIcon,
  UploadIcon,
} from '@/shared/components/icons/AppIcons';
import type { EmployeePinItem } from './BiometricDevicesAndPinsTabs';

type BiometricSyncScope = 'since_last' | 'open_month' | 'custom';

interface BiometricFileImportTabProps {
  selectedFileName: string;
  debounceMinutes: number;
  onDebounceMinutesChange: (val: number) => void;
  syncScope: BiometricSyncScope;
  customFromDate: string;
  customToDate: string;
  onChangeDateScope: (scope: BiometricSyncScope, fromDate?: string, toDate?: string) => Promise<void>;
  autoCreateEmployees: boolean;
  onAutoCreateEmployeesChange: (val: boolean) => void;
  isPreviewLoading: boolean;
  previewData: any;
  employeePins: EmployeePinItem[];
  quickPinAssignEmpId: Record<string, string>;
  onSelectQuickPinEmp: (pin: string, empId: string) => void;
  onFilePicked: (file?: File | null) => Promise<void>;
  onDownloadBlankTemplate: () => void;
  onUpdateColumnMapping: (patch: Record<string, number | boolean | null>) => Promise<void>;
  onQuickAssignPin: (pin: string) => Promise<void>;
  onQuickCreateEmployee: (pin: string) => Promise<void>;
}

export function BiometricFileImportTab({
  selectedFileName,
  debounceMinutes,
  onDebounceMinutesChange,
  syncScope,
  customFromDate,
  customToDate,
  onChangeDateScope,
  autoCreateEmployees,
  onAutoCreateEmployeesChange,
  isPreviewLoading,
  previewData,
  employeePins,
  quickPinAssignEmpId,
  onSelectQuickPinEmp,
  onFilePicked,
  onDownloadBlankTemplate,
  onUpdateColumnMapping,
  onQuickAssignPin,
  onQuickCreateEmployee,
}: BiometricFileImportTabProps) {
  const [showColumnMapping, setShowColumnMapping] = useState(false);

  const detectedCols: any[] = previewData?.detectedColumns || [];
  const appliedMap = previewData?.appliedColumnMapping;
  const pinColLabel =
    detectedCols.find((c) => c.index === appliedMap?.pinColIndex)?.headerLabel ||
    `عمود ${(appliedMap?.pinColIndex ?? 0) + 1}`;
  const dateColLabel =
    appliedMap?.dateTimeColIndex !== null && appliedMap?.dateTimeColIndex !== undefined && appliedMap.dateTimeColIndex >= 0
      ? detectedCols.find((c) => c.index === appliedMap.dateTimeColIndex)?.headerLabel || 'التاريخ والوقت'
      : detectedCols.find((c) => c.index === appliedMap?.dateColIndex)?.headerLabel || 'التاريخ';

  const outOfRangeCount =
    Number(previewData?.historicalOutOfMonthCount ?? 0) + Number(previewData?.skippedBeforeWindowCount ?? 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', height: '100%' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: '12px',
          alignItems: 'center',
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '10px',
          padding: '8px 12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
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
                setShowColumnMapping(false);
                void onFilePicked(f);
                e.currentTarget.value = '';
              }}
            />
          </label>
          <Button
            type="button"
            variant="secondary"
            onClick={onDownloadBlankTemplate}
            style={{ padding: '5px 10px', fontSize: '12px' }}
          >
            <DownloadIcon size={13} />
            <span>قالب إكسيل فارغ</span>
          </Button>
          {selectedFileName && (
            <span
              style={{
                fontSize: '12px',
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
          <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#475569' }}>فلتر التكرار (دقائق):</span>
          <input
            type="number"
            min={0}
            max={30}
            value={debounceMinutes}
            onChange={(e) => onDebounceMinutesChange(Math.max(0, Number(e.target.value) || 0))}
            style={{
              width: '54px',
              height: '30px',
              padding: '3px 6px',
              fontSize: '12px',
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
            ارفع ملف الحركات من الفلاشة أو الإكسيل في خطوة واحدة
          </div>
          <div style={{ fontSize: '12px', color: '#64748b', maxWidth: '620px', marginTop: '4px', lineHeight: 1.6 }}>
            يتعرف النظام تلقائياً على الأعمدة ويستبعد الشهور القديمة المقفولة، ويسحب فقط الحركات الجديدة منذ آخر استيراد (أو كامل الشهر المفتوح حسب اختيارك)، كما يدعم فك ملف{' '}
            <code>user.dat</code>.
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
                          background:
                            u.privilegeRole === 'super_admin'
                              ? '#fee2e2'
                              : u.privilegeRole !== 'user'
                                ? '#fef3c7'
                                : '#f1f5f9',
                          color:
                            u.privilegeRole === 'super_admin'
                              ? '#991b1b'
                              : u.privilegeRole !== 'user'
                                ? '#92400e'
                                : '#334155',
                        }}
                      >
                        {u.privilegeLabelAr}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: '7px 12px',
                        fontFamily: 'monospace',
                        fontWeight: 700,
                        color: u.password ? '#0f172a' : '#94a3b8',
                      }}
                    >
                      {u.password || 'بصمة فقط (بدون باسورد)'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Clean 3-option Date Scope Bar (Incremental Watermark / Full Open Month / Custom Range) */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              padding: '8px 12px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <CalendarIcon size={14} />
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>نطاق الاستيراد:</span>
              {(
                [
                  {
                    id: 'since_last' as BiometricSyncScope,
                    label: previewData.lastImportedDate
                      ? `الجديد فقط (من ${previewData.lastImportedDate} حتى اليوم)`
                      : 'الجديد فقط تلقائياً (أول استيراد بالشهر)',
                  },
                  {
                    id: 'open_month' as BiometricSyncScope,
                    label: `الشهر المفتوح بالكامل (${previewData.openPayrollMonth?.from || ''} ← ${previewData.openPayrollMonth?.to || ''})`,
                  },
                  {
                    id: 'custom' as BiometricSyncScope,
                    label: 'فترة مخصصة',
                  },
                ] as const
              ).map((opt) => {
                const active = syncScope === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => void onChangeDateScope(opt.id)}
                    style={{
                      padding: '4px 10px',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      borderRadius: '6px',
                      boxSizing: 'border-box',
                      border: active ? '1px solid #170e5e' : '1px solid #cbd5e1',
                      backgroundColor: active ? '#170e5e' : '#f8fafc',
                      color: active ? '#ffffff' : '#334155',
                      cursor: 'pointer',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}

              {syncScope === 'custom' && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginRight: '4px' }}>
                  <span style={{ fontSize: '11.5px', color: '#475569', fontWeight: 600 }}>من:</span>
                  <input
                    type="date"
                    min={previewData.openPayrollMonth?.from}
                    max={previewData.openPayrollMonth?.to}
                    value={customFromDate || previewData.appliedDateRange?.from || ''}
                    onChange={(e) => void onChangeDateScope('custom', e.target.value, customToDate)}
                    style={{
                      height: '28px',
                      padding: '2px 6px',
                      fontSize: '11.5px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                    }}
                  />
                  <span style={{ fontSize: '11.5px', color: '#475569', fontWeight: 600 }}>إلى:</span>
                  <input
                    type="date"
                    min={customFromDate || previewData.openPayrollMonth?.from}
                    max={previewData.openPayrollMonth?.to}
                    value={customToDate || previewData.appliedDateRange?.to || ''}
                    onChange={(e) => void onChangeDateScope('custom', customFromDate, e.target.value)}
                    style={{
                      height: '28px',
                      padding: '2px 6px',
                      fontSize: '11.5px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                    }}
                  />
                </div>
              )}
            </div>

            {detectedCols.length >= 2 && (
              <button
                type="button"
                onClick={() => setShowColumnMapping((v) => !v)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '4px 9px',
                  fontSize: '11px',
                  fontWeight: 600,
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  backgroundColor: showColumnMapping ? '#eef2ff' : '#f8fafc',
                  color: '#170e5e',
                  cursor: 'pointer',
                }}
                title={`الأعمدة المكتشفة: ${pinColLabel} + ${dateColLabel}`}
              >
                <SlidersIcon size={12} />
                <span>{showColumnMapping ? 'إخفاء تعديل الأعمدة' : `تعديل الأعمدة يدوياً (${pinColLabel})`}</span>
              </button>
            )}
          </div>

          {/* Compact 4 KPI Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '7px 10px' }}>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>إجمالي البصمات بالملف</div>
              <div style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a', marginTop: '1px' }}>
                {previewData.totalRawPunches ?? 0}
              </div>
            </div>
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '7px 10px' }}>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>مستبعدة (قديمة أو خارج النطاق)</div>
              <div style={{ fontSize: '15px', fontWeight: 800, color: '#475569', marginTop: '1px' }}>
                {outOfRangeCount} يوم
              </div>
            </div>
            <div
              style={{
                background: (previewData.unmatchedInMonthCount ?? 0) > 0 ? '#fffbeb' : '#ffffff',
                border: (previewData.unmatchedInMonthCount ?? 0) > 0 ? '1px solid #fde68a' : '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '7px 10px',
              }}
            >
              <div
                style={{
                  fontSize: '11px',
                  color: (previewData.unmatchedInMonthCount ?? 0) > 0 ? '#92400e' : '#64748b',
                  fontWeight: 600,
                }}
              >
                غير مربوطة بموظفين في النطاق
              </div>
              <div
                style={{
                  fontSize: '15px',
                  fontWeight: 800,
                  color: (previewData.unmatchedInMonthCount ?? 0) > 0 ? '#d97706' : '#0f172a',
                  marginTop: '1px',
                }}
              >
                {previewData.unmatchedInMonthCount ?? 0} يوم
              </div>
            </div>
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '7px 10px' }}>
              <div style={{ fontSize: '11px', color: '#166534', fontWeight: 600 }}>جاهز للاعتماد الآن</div>
              <div style={{ fontSize: '15px', fontWeight: 800, color: '#15803d', marginTop: '1px' }}>
                {previewData.readyToImportCount ?? 0} يوم عمل
              </div>
            </div>
          </div>

          {/* Collapsible Advanced Column Mapping (Hidden by Default) */}
          {showColumnMapping && detectedCols.length >= 2 && (
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
                  تعديل ترتيب الأعمدة يدوياً (للملفات غير القياسية فقط):
                </span>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    color: '#334155',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(appliedMap?.hasHeaderRow)}
                    onChange={(e) => void onUpdateColumnMapping({ hasHeaderRow: e.target.checked })}
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
                    value={String(appliedMap?.pinColIndex ?? 0)}
                    onChange={(val) => void onUpdateColumnMapping({ pinColIndex: Number(val) })}
                    options={detectedCols.map((col: any) => ({
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
                      appliedMap?.dateTimeColIndex !== null && appliedMap?.dateTimeColIndex !== undefined
                        ? String(appliedMap.dateTimeColIndex)
                        : '-1'
                    }
                    onChange={(val) => {
                      const idx = Number(val);
                      void onUpdateColumnMapping({ dateTimeColIndex: idx >= 0 ? idx : -1 });
                    }}
                    options={[
                      { value: '-1', label: '— التاريخ والوقت مفصولان —' },
                      ...detectedCols.map((col: any) => ({
                        value: String(col.index),
                        label: `${col.headerLabel} (${col.sampleValue.slice(0, 18)})`,
                      })),
                    ]}
                  />
                </div>
                <div>
                  <span style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '2px' }}>
                    عمود التاريخ فقط:
                  </span>
                  <CustomSelect
                    value={
                      appliedMap?.dateColIndex !== null && appliedMap?.dateColIndex !== undefined
                        ? String(appliedMap.dateColIndex)
                        : '-1'
                    }
                    onChange={(val) => {
                      const idx = Number(val);
                      void onUpdateColumnMapping({
                        dateColIndex: idx >= 0 ? idx : -1,
                        dateTimeColIndex: idx >= 0 ? -1 : appliedMap?.dateTimeColIndex,
                      });
                    }}
                    options={[
                      { value: '-1', label: '— غير مستخدم —' },
                      ...detectedCols.map((col: any) => ({
                        value: String(col.index),
                        label: `${col.headerLabel} (${col.sampleValue.slice(0, 18)})`,
                      })),
                    ]}
                  />
                </div>
                <div>
                  <span style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '2px' }}>
                    عمود الوقت فقط:
                  </span>
                  <CustomSelect
                    value={
                      appliedMap?.checkInTimeColIndex !== null && appliedMap?.checkInTimeColIndex !== undefined
                        ? String(appliedMap.checkInTimeColIndex)
                        : '-1'
                    }
                    onChange={(val) => {
                      const idx = Number(val);
                      void onUpdateColumnMapping({ checkInTimeColIndex: idx >= 0 ? idx : -1 });
                    }}
                    options={[
                      { value: '-1', label: '— مدمج مع التاريخ —' },
                      ...detectedCols.map((col: any) => ({
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
                padding: '8px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#92400e' }}>
                  أرقام بصمة غير مربوطة بموظفين ({previewData.unmatchedPins.length} رقم — {previewData.unmatchedInMonthCount ?? 0} يوم عمل):
                </span>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    color: '#170e5e',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={autoCreateEmployees}
                    onChange={(e) => onAutoCreateEmployeesChange(e.target.checked)}
                  />
                  <span>إنشاء ملفات موظفين تلقائياً عند الاعتماد</span>
                </label>
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
                    <div style={{ width: '160px' }}>
                      <CustomSelect
                        value={quickPinAssignEmpId[item.pin] || ''}
                        onChange={(val) => onSelectQuickPinEmp(item.pin, String(val))}
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
                      onClick={() => void onQuickAssignPin(item.pin)}
                      style={{ padding: '4px 8px', fontSize: '11.5px' }}
                    >
                      ربط
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      onClick={() => void onQuickCreateEmployee(item.pin)}
                      style={{ padding: '4px 8px', fontSize: '11.5px', backgroundColor: '#170e5e', color: '#fff' }}
                    >
                      إنشاء موظف
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
                    <td colSpan={6} style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>
                      {previewData.unmatchedInMonthCount > 0 ? (
                        `توجد ${previewData.unmatchedInMonthCount} يوم عمل ضمن النطاق لأرقام بصمة غير مربوطة بموظفين بعد. اربطها أو أنشئ ملفات موظفين لها أعلاه، أو اضغط على الزر السفلي لحفظها في «البصمات المعلقة».`
                      ) : previewData.skippedBeforeWindowCount > 0 && syncScope === 'since_last' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                          <span>
                            لا توجد حركات جديدة بعد آخر استيراد ({previewData.lastImportedDate})، وتوجد{' '}
                            {previewData.skippedBeforeWindowCount} حركة سابقة داخل الشهر المفتوح.
                          </span>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => void onChangeDateScope('open_month')}
                            style={{ padding: '4px 12px', fontSize: '12px' }}
                          >
                            عرض الشهر المفتوح بالكامل
                          </Button>
                        </div>
                      ) : (
                        `لا توجد سجلات مطابقة ضمن النطاق المحدد (${previewData.appliedDateRange?.from || previewData.openPayrollMonth?.from} إلى ${previewData.appliedDateRange?.to || previewData.openPayrollMonth?.to}). يمكنك تصدير الملف الكامل إلى إكسيل من الزر السفلي.`
                      )}
                    </td>
                  </tr>
                ) : (
                  (previewData.previewRecords || []).map((rec: any, idx: number) => (
                    <tr key={`${rec.pin}_${rec.workDate}_${idx}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '7px 10px', fontWeight: 700, color: '#0f172a' }}>
                        {rec.employeeName}{' '}
                        <span style={{ color: '#64748b', fontSize: '11px' }}>({rec.employeeNo})</span>
                      </td>
                      <td style={{ padding: '7px 10px', fontFamily: 'monospace', fontWeight: 700 }}>{rec.pin}</td>
                      <td style={{ padding: '7px 10px' }}>{rec.workDate}</td>
                      <td style={{ padding: '7px 10px', color: '#15803d', fontWeight: 700 }}>
                        {rec.checkInTime || '—'}
                      </td>
                      <td
                        style={{
                          padding: '7px 10px',
                          color: rec.checkOutTime ? '#1e40af' : '#d97706',
                          fontWeight: 700,
                        }}
                      >
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
  );
}
