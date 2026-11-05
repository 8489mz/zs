import { useTranslation } from 'react-i18next';
import { useMemo, useState } from 'react';
import { Button } from '@/shared/ui/button';
import { parseImportFile } from '@/lib/browser';
import { normalizeImportRows, type CsvRow, type ImportFieldMapping } from './import-workbench.utils';

export function normalizeHeader(value: string) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

export function summarizeImportResult(result: unknown, rowCount: number, fileName: string): { kind: 'success' | 'warning'; text: string } {
  const payload = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
  const inserted = Number(payload.inserted || 0);
  const updated = Number(payload.updated || 0);
  const warnings = Array.isArray(payload.warnings)
    ? payload.warnings.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];

  const summaryParts: string[] = [];
  if (inserted > 0) summaryParts.push(`إضافة ${inserted}`);
  if (updated > 0) summaryParts.push(`تحديث ${updated}`);
  if (!summaryParts.length) summaryParts.push(`معالجة ${rowCount}`);

  const baseText = `تمت العملية بنجاح (${summaryParts.join('، ')}) من ${fileName || 'الملف المحدد'}.`;
  if (!warnings.length) {
    return { kind: 'success', text: baseText };
  }

  return {
    kind: 'warning',
    text: `${baseText} تحذيرات: ${warnings.join(' ')}`,
  };
}

export interface ImportTemplateOption {
  label: string;
  onDownload: () => void;
  variant?: 'default' | 'primary';
  description?: string;
}

interface ImportWorkbenchProps {
  title: string;
  description?: string;
  requiredColumns: string[];
  requiredFieldKeys?: string[];
  fieldMappings?: ImportFieldMapping[];
  onDownloadTemplate?: () => void;
  templateOptions?: ImportTemplateOption[];
  onExportData?: () => void | Promise<void>;
  onImportRows: (rows: CsvRow[]) => Promise<unknown>;
  isPending?: boolean;
  defaultCollapsed?: boolean;
}

export function ImportWorkbench({
  title,
  description = '',
  requiredColumns,
  requiredFieldKeys,
  fieldMappings,
  onDownloadTemplate,
  templateOptions,
  onExportData,
  onImportRows,
  isPending = false,
  defaultCollapsed = false,
}: ImportWorkbenchProps) {
  const { t } = useTranslation();
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [isExporting, setIsExporting] = useState(false);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [status, setStatus] = useState<{ kind: 'success' | 'warning' | 'error' | ''; text: string }>({ kind: '', text: '' });

  const normalizedHeaderMap = useMemo(() => {
    return headers.reduce<Record<string, string>>((acc, header) => {
      acc[normalizeHeader(header)] = header;
      return acc;
    }, {});
  }, [headers]);

  const normalizedFieldMappings = useMemo<ImportFieldMapping[]>(() => {
    if (fieldMappings?.length) return fieldMappings;
    return requiredColumns.map((label) => ({ key: label, label, aliases: [label] }));
  }, [fieldMappings, requiredColumns]);

  const requiredMappings = useMemo(() => {
    const requiredKeys = new Set((requiredFieldKeys?.length ? requiredFieldKeys : requiredColumns).map((entry) => String(entry)));
    return normalizedFieldMappings.filter((entry) => requiredKeys.has(entry.key) || requiredKeys.has(entry.label));
  }, [normalizedFieldMappings, requiredFieldKeys, requiredColumns]);

  const resolvedHeaderByFieldKey = useMemo(() => {
    const resolved: Record<string, string> = {};
    for (const field of normalizedFieldMappings) {
      const candidates = [field.key, field.label, ...(field.aliases || [])];
      const matchedHeader = candidates
        .map((candidate) => normalizedHeaderMap[normalizeHeader(candidate)])
        .find(Boolean);
      if (matchedHeader) resolved[field.key] = matchedHeader;
    }
    return resolved;
  }, [normalizedFieldMappings, normalizedHeaderMap]);

  const missingRequiredFields = useMemo(() => requiredMappings.filter((field) => !resolvedHeaderByFieldKey[field.key]), [requiredMappings, resolvedHeaderByFieldKey]);

  const rowIssueCount = useMemo(() => {
    if (!rows.length) return 0;
    return rows.filter((row) => requiredMappings.some((field) => {
      const actualHeader = resolvedHeaderByFieldKey[field.key];
      return !String(actualHeader ? row[actualHeader] : '').trim();
    })).length;
  }, [requiredMappings, resolvedHeaderByFieldKey, rows]);

  const previewRows = useMemo(() => rows.slice(0, 5), [rows]);

  async function handleFileSelect(file?: File | null) {
    setStatus({ kind: '', text: '' });
    if (!file) {
      setFileName('');
      setRows([]);
      setHeaders([]);
      return;
    }
    try {
      const parsedRows = await parseImportFile(file);
      if (!parsedRows.length) throw new Error('الملف لا يحتوي على صفوف قابلة للاستيراد.');
      const discoveredHeaders = Array.from(new Set(parsedRows.flatMap((row) => Object.keys(row))));
      setFileName(file.name);
      setRows(parsedRows);
      setHeaders(discoveredHeaders);
    } catch (error) {
      setFileName(file.name);
      setRows([]);
      setHeaders([]);
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : 'تعذر قراءة الملف.' });
    }
  }

  async function handleImport() {
    try {
      if (!rows.length) throw new Error('اختر ملفًا أولًا.');
      if (missingRequiredFields.length) throw new Error(`العمود المطلوب غير موجود: ${missingRequiredFields.map((field) => field.label).join('، ')}`);
      const normalizedRows = normalizeImportRows(rows, normalizedFieldMappings, resolvedHeaderByFieldKey);
      const result = await onImportRows(normalizedRows);
      setStatus(summarizeImportResult(result, rows.length, fileName || 'الملف المحدد'));
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : 'تعذر استيراد الملف.' });
    }
  }

  async function handleExport() {
    if (!onExportData) return;
    try {
      setIsExporting(true);
      await onExportData();
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div style={{
      background: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: '12px',
      padding: '18px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '14px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
      transition: 'all 0.15s ease',
    }}>
      {/* Card Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <strong style={{ fontSize: '1rem', fontWeight: 800, color: '#0f172a', display: 'block' }}>
            {title}
          </strong>
          {description && <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '2px' }}>{description}</div>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          {onExportData && (
            <button
              type="button"
              onClick={handleExport}
              disabled={isExporting}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '5px 10px',
                fontSize: '0.76rem',
                fontWeight: 700,
                borderRadius: '6px',
                border: '1px solid #0f172a',
                background: '#0f172a',
                color: '#ffffff',
                cursor: isExporting ? 'wait' : 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => { if (!isExporting) e.currentTarget.style.background = '#1e293b'; }}
              onMouseLeave={(e) => { if (!isExporting) e.currentTarget.style.background = '#0f172a'; }}
            >
              {isExporting ? t('shared.import_workbench.s0', "جاري التصدير...") : t('shared.import_workbench.s1', "تصدير البيانات")}
            </button>
          )}

          {templateOptions && templateOptions.length > 0 ? (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
              {templateOptions.map((opt, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={opt.onDownload}
                  title={opt.description || opt.label}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '5px 10px',
                    fontSize: '0.76rem',
                    fontWeight: 700,
                    borderRadius: '6px',
                    border: opt.variant === 'primary' ? '1px solid #170e5e' : '1px solid #cbd5e1',
                    background: opt.variant === 'primary' ? '#170e5e' : '#f8fafc',
                    color: opt.variant === 'primary' ? '#ffffff' : '#1e293b',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (opt.variant === 'primary') e.currentTarget.style.background = '#24147c';
                    else { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.borderColor = '#94a3b8'; }
                  }}
                  onMouseLeave={(e) => {
                    if (opt.variant === 'primary') e.currentTarget.style.background = '#170e5e';
                    else { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.borderColor = '#cbd5e1'; }
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          ) : onDownloadTemplate ? (
            <button
              type="button"
              onClick={onDownloadTemplate}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '5px 10px',
                fontSize: '0.76rem',
                fontWeight: 700,
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                color: '#1e293b',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.borderColor = '#94a3b8'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.borderColor = '#cbd5e1'; }}
            >
              {t('shared.import_workbench.s2', "قالب فارغ")}
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            style={{
              padding: '6px 10px',
              fontSize: '0.75rem',
              fontWeight: 600,
              borderRadius: '6px',
              border: 'none',
              background: '#f1f5f9',
              color: '#64748b',
              cursor: 'pointer',
            }}
          >
            {isCollapsed ? t('shared.import_workbench.s3', "فتح") : t('shared.import_workbench.s4', "طي")}
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <>
          {/* Required Fields Pill Tags */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: '0.78rem', color: '#64748b' }}>
            <span style={{ fontWeight: 700, color: '#475569' }}>{t('shared.import_workbench.s5', "الأعمدة المطلوبة:")}</span>
            {requiredColumns.map((col) => (
              <span
                key={col}
                style={{
                  background: '#f1f5f9',
                  border: '1px solid #e2e8f0',
                  borderRadius: '4px',
                  padding: '2px 8px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#334155',
                }}
              >
                {col}
              </span>
            ))}
          </div>

          {/* File Upload Dropzone */}
          <div>
            <label
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                background: fileName ? '#f8fafc' : '#ffffff',
                border: fileName ? '1.5px solid #0f172a' : '1.5px dashed #cbd5e1',
                borderRadius: '10px',
                padding: '16px',
                cursor: 'pointer',
                textAlign: 'center',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => { if (!fileName) { e.currentTarget.style.borderColor = '#0f172a'; e.currentTarget.style.background = '#fafafa'; } }}
              onMouseLeave={(e) => { if (!fileName) { e.currentTarget.style.borderColor = '#cbd5e1'; e.currentTarget.style.background = '#ffffff'; } }}
            >
              <input
                type="file"
                style={{ display: 'none' }}
                accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                onChange={async (event) => {
                  const input = event.currentTarget;
                  await handleFileSelect(input.files?.[0]);
                  input.value = '';
                }}
              />

              {fileName ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '0 8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                      background: '#0f172a',
                      color: '#ffffff',
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      padding: '3px 8px',
                      borderRadius: '5px',
                    }}>
                      {t('shared.import_workbench.s6', "ملف محدد")}
                    </div>
                    <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0f172a' }}>
                      {fileName}
                    </span>
                    <span style={{ fontSize: '0.78rem', color: '#64748b', background: '#f1f5f9', padding: '2px 8px', borderRadius: '4px' }}>
                      {rows.length} {t('shared.import_workbench.s7', "صف")}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#2563eb' }}>
                    {t('shared.import_workbench.s8', "انقر لتغيير الملف")}
                  </span>
                </div>
              ) : (
                <>
                  <span style={{ fontSize: '0.86rem', fontWeight: 700, color: '#1e293b' }}>
                    {t('shared.import_workbench.s9', "اضغط هنا لاختيار ملف Excel أو CSV")}
                  </span>
                  <span style={{ fontSize: '0.76rem', color: '#94a3b8' }}>
                    {t('shared.import_workbench.s10', "يدعم ملفات (.xlsx, .xls, .csv)")}
                  </span>
                </>
              )}
            </label>
          </div>

          {/* Validation Warnings (ONLY IF FILE IS UPLOADED) */}
          {rows.length > 0 && missingRequiredFields.length > 0 && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', padding: '10px 14px', borderRadius: '8px', fontSize: '0.82rem', fontWeight: 600 }}>
              {missingRequiredFields.map((field) => (
                <div key={field.key}>{t('shared.import_workbench.s11', "العمود المطلوب غير موجود:")} {field.label}</div>
              ))}
            </div>
          )}

          {rows.length > 0 && rowIssueCount > 0 && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', padding: '10px 14px', borderRadius: '8px', fontSize: '0.82rem', fontWeight: 600 }}>
              {t('shared.import_workbench.s12', "يوجد")} {rowIssueCount} {t('shared.import_workbench.s13', "صف يفتقد قيمة واحدة أو أكثر من الحقول المطلوبة.")}
            </div>
          )}

          {status.text && (
            <div style={{
              background: status.kind === 'error' ? '#fef2f2' : status.kind === 'warning' ? '#fffbeb' : '#ecfdf5',
              border: status.kind === 'error' ? '1px solid #fca5a5' : status.kind === 'warning' ? '1px solid #fde68a' : '1px solid #a7f3d0',
              color: status.kind === 'error' ? '#b91c1c' : status.kind === 'warning' ? '#92400e' : '#047857',
              padding: '10px 14px',
              borderRadius: '8px',
              fontSize: '0.84rem',
              fontWeight: 700,
            }}>
              {status.text}
            </div>
          )}

          {/* Preview Table if file loaded */}
          {previewRows.length > 0 && (
            <div style={{ borderRadius: '8px', border: '1px solid #e2e8f0', overflow: 'hidden', maxHeight: '180px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'right' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    {headers.map((header) => (
                      <th key={header} style={{ padding: '8px 10px', fontWeight: 700, color: '#334155' }}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, index) => (
                    <tr key={`${fileName}-${index}`} style={{ borderBottom: index < previewRows.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                      {headers.map((header) => (
                        <td key={`${header}-${index}`} style={{ padding: '7px 10px', color: '#475569' }}>
                          {row[header] || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' }}>
            {rows.length > 0 && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => { setFileName(''); setRows([]); setHeaders([]); setStatus({ kind: '', text: '' }); }}
                style={{ fontSize: '0.82rem', padding: '6px 14px' }}
              >
                {t('shared.import_workbench.s14', "مسح المعاينة")}
              </Button>
            )}

            <Button
              type="button"
              onClick={() => void handleImport()}
              disabled={isPending || !rows.length || !!missingRequiredFields.length}
              style={{
                fontSize: '0.82rem',
                padding: '7px 20px',
                fontWeight: 700,
                background: rows.length && !missingRequiredFields.length ? '#0f172a' : undefined,
                color: rows.length && !missingRequiredFields.length ? '#ffffff' : undefined,
              }}
            >
              {isPending ? t('shared.import_workbench.s15', "جارٍ الاستيراد...") : t('shared.import_workbench.s16', "استيراد الآن")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

