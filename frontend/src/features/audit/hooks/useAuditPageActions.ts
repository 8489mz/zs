import { useCallback, useState } from 'react';
import { auditApi } from '@/features/audit/api/audit.api';
import { formatDate } from '@/lib/format';
import { downloadExcelFile, escapeHtml, printHtmlDocument } from '@/lib/browser';
import type { AuditLog } from '@/types/domain';

import { getAuditActionLabel, normalizeAuditDetailText, normalizeAuditUserDisplay } from '@/shared/utils/audit-activity-presenter';
import { formatAuditDetails } from '@/shared/utils/audit-details-format';

interface Params {
  search: string;
  mode: 'all' | 'today' | 'withDetails';
  userId?: string;
  totalRows: number;
  summary: { distinctUsers: number; todayCount: number };
  rangeStart: number;
  rangeEnd: number;
  isEn?: boolean;
}

export function useAuditPageActions({ search, mode, userId = '', totalRows, summary, rangeStart, rangeEnd, isEn = false }: Params) {
  const [copyFeedback, setCopyFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const copyAuditSummary = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    const lines = isEn
      ? [
          'Audit Log Summary',
          `Total Matching Records: ${totalRows}`,
          `Distinct Actors: ${summary.distinctUsers}`,
          `Today's Records: ${summary.todayCount}`,
          `Currently Displayed: ${rangeStart}-${rangeEnd}`,
        ]
      : [
          'ملخص سجل النشاط',
          `إجمالي السجلات المطابقة: ${totalRows}`,
          `عدد المنفذين: ${summary.distinctUsers}`,
          `سجلات اليوم: ${summary.todayCount}`,
          `النطاق المعروض الآن: ${rangeStart}-${rangeEnd}`,
        ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopyFeedback({ kind: 'success', text: isEn ? 'Audit summary copied to clipboard.' : 'تم نسخ ملخص سجل النشاط.' });
    } catch {
      setCopyFeedback({ kind: 'error', text: isEn ? 'Failed to copy audit summary.' : 'تعذر نسخ ملخص سجل النشاط.' });
    }
  }, [isEn, rangeEnd, rangeStart, summary.distinctUsers, summary.todayCount, totalRows]);

  const exportAuditRows = useCallback(async () => {
    if (!totalRows) return;
    setIsExporting(true);
    try {
      const payload = await auditApi.listAll({ search, mode, userId });
      downloadExcelFile(
        'audit-log-results.csv',
        isEn ? ['Activity', 'Details', 'Actor', 'Date'] : ['النشاط', 'التفاصيل', 'المنفذ', 'التاريخ'],
        payload.rows.map((row: AuditLog) => [
          getAuditActionLabel(row.action || '', isEn),
          normalizeAuditDetailText(formatAuditDetails(row), isEn),
          normalizeAuditUserDisplay(row),
          row.createdAt || row.created_at || '',
        ])
      );
      setCopyFeedback({ kind: 'success', text: isEn ? 'Full export of matching records generated.' : 'تم تجهيز تصدير كامل للسجلات المطابقة.' });
    } catch {
      setCopyFeedback({ kind: 'error', text: isEn ? 'Failed to export records.' : 'تعذر تصدير السجلات المطابقة.' });
    } finally {
      setIsExporting(false);
    }
  }, [isEn, mode, search, totalRows, userId]);

  const printAuditRows = useCallback(async () => {
    if (!totalRows) return;
    setIsExporting(true);
    try {
      const payload = await auditApi.listAll({ search, mode, userId });
      printHtmlDocument(
        isEn ? 'Audit Log' : 'سجل النشاط',
        `
        <h1>${isEn ? 'Audit Trail Log' : 'سجل النشاط'}</h1>
        <div class="meta">${isEn ? `Total Records: ${payload.rows.length} · Actors: ${summary.distinctUsers} · Today: ${summary.todayCount}` : `إجمالي السجلات المطابقة: ${payload.rows.length} · عدد المنفذين: ${summary.distinctUsers} · سجلات اليوم: ${summary.todayCount}`}</div>
        <table>
          <thead><tr><th>${isEn ? 'Activity' : 'النشاط'}</th><th>${isEn ? 'Details' : 'التفاصيل'}</th><th>${isEn ? 'Actor' : 'المنفذ'}</th><th>${isEn ? 'Date' : 'التاريخ'}</th></tr></thead>
          <tbody>${payload.rows
            .map(
              (row) =>
                `<tr><td>${escapeHtml(getAuditActionLabel(row.action || '—', isEn))}</td><td>${escapeHtml(
                  normalizeAuditDetailText(formatAuditDetails(row), isEn)
                )}</td><td>${escapeHtml(normalizeAuditUserDisplay(row))}</td><td>${escapeHtml(
                  formatDate(row.createdAt || row.created_at || '')
                )}</td></tr>`
            )
            .join('')}</tbody>
        </table>
      `
      );
    } catch {
      setCopyFeedback({ kind: 'error', text: isEn ? 'Failed to print records.' : 'تعذر طباعة السجلات المطابقة.' });
    } finally {
      setIsExporting(false);
    }
  }, [isEn, mode, search, summary.distinctUsers, summary.todayCount, totalRows, userId]);

  return { copyFeedback, isExporting, copyAuditSummary, exportAuditRows, printAuditRows };
}
