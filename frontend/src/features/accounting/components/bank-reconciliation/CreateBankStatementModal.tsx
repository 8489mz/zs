import { useTranslation } from 'react-i18next';
import React, { useState, useRef, useMemo } from 'react';
import { DialogShell } from '@/shared/components/dialog-shell';
import { AppIcons, XIcon } from '@/shared/components/icons/AppIcons';
import { CustomSelect } from '@/shared/ui/custom-select';
import { useSystemCurrency } from '@/shared/hooks/use-system-currency';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { toast } from '@/shared/components/system-alert';
import {
  parseBankStatementFile,
  parseBankStatementText,
  downloadBankStatementTemplate,
  BankStatementFileParseResult,
  BankColumnMapping,
  extractLinesFromRows,
  BankStatementParsedLine,
} from '../../utils/bankStatementParser';

interface CreateBankStatementModalProps {
  isOpen: boolean;
  onClose: () => void;
  bankAccounts: any[];
  newStmtAccountId: number;
  setNewStmtAccountId: (id: number) => void;
  newStmtNo: string;
  setNewStmtNo: (no: string) => void;
  newStmtDate: string;
  setNewStmtDate: (date: string) => void;
  newStmtNotes: string;
  setNewStmtNotes: (notes: string) => void;
  newStmtStartBal: number;
  setNewStmtStartBal: (bal: number) => void;
  newStmtEndBal: number;
  setNewStmtEndBal: (bal: number) => void;
  newStmtLines: Array<{ lineDate: string; description: string; reference: string; amount: number }>;
  setNewStmtLines: React.Dispatch<React.SetStateAction<Array<{ lineDate: string; description: string; reference: string; amount: number }>>>;
  onSubmit: (e: React.FormEvent) => void;
  isSubmitting: boolean;
}

export const CreateBankStatementModal: React.FC<CreateBankStatementModalProps> = ({
  isOpen,
  onClose,
  bankAccounts,
  newStmtAccountId,
  setNewStmtAccountId,
  newStmtNo,
  setNewStmtNo,
  newStmtDate,
  setNewStmtDate,
  newStmtNotes,
  setNewStmtNotes,
  newStmtStartBal,
  setNewStmtStartBal,
  newStmtEndBal,
  setNewStmtEndBal,
  newStmtLines,
  setNewStmtLines,
  onSubmit,
  isSubmitting,
}) => {
  const { t } = useTranslation();
  const selectedAccount = useMemo(() => {
    return bankAccounts.find((a: any) => Number(a.id) === Number(newStmtAccountId));
  }, [bankAccounts, newStmtAccountId]);

  const { currencySymbol } = useSystemCurrency(selectedAccount?.currency);
  // INV-FE3-FRONTEND-BOOK-DIGITS: statement balances are money in the
  // ACCOUNT's currency (a KWD bank account on an EGP tenant still books
  // at 3dp), so they round at the account currency's digits, not
  // hardcoded 2dp. The balances feed the statement the parent posts.
  const bookDigits = currencyMoneyDigits(selectedAccount?.currency || getGlobalSystemCurrency());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tabs: 'smart_import' | 'manual'
  const [activeTab, setActiveTab] = useState<'smart_import' | 'manual'>('smart_import');

  // File import states
  const [isParsingFile, setIsParsingFile] = useState(false);
  const [parseResult, setParseResult] = useState<BankStatementFileParseResult | null>(null);
  const [customMapping, setCustomMapping] = useState<BankColumnMapping | null>(null);
  const [showMappingBar, setShowMappingBar] = useState(false);

  // Text paste state
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [pastedText, setPastedText] = useState('');

  // Staged lines in preview before committing to form
  const [stagedLines, setStagedLines] = useState<BankStatementParsedLine[]>([]);
  const [autoUpdateEndingBalance, setAutoUpdateEndingBalance] = useState(true);

  if (!isOpen) return null;

  // Handle Excel/CSV file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsParsingFile(true);
      const res = await parseBankStatementFile(file);
      setParseResult(res);
      setCustomMapping(res.mapping);
      setStagedLines(res.parsedLines);
      setNewStmtLines(
        res.parsedLines.map((l) => ({
          lineDate: l.lineDate,
          description: l.description,
          reference: l.reference,
          amount: l.amount,
        }))
      );

      if (res.detectedStartBal !== undefined && newStmtStartBal === 0) {
        setNewStmtStartBal(roundMoneyValue(res.detectedStartBal, bookDigits));
      }
      if (res.detectedEndBal !== undefined) {
        setNewStmtEndBal(roundMoneyValue(res.detectedEndBal, bookDigits));
      } else if (autoUpdateEndingBalance) {
        setNewStmtEndBal(roundMoneyValue(newStmtStartBal + res.netChange, bookDigits));
      }

      toast.success(`تم استخراج ${res.parsedLines.length} حركة بنكية بنجاح من الملف [${file.name}]`);
    } catch (err: any) {
      toast.error(err?.message || 'تعذر قراءة ملف كشف الحساب البنكي.');
    } finally {
      setIsParsingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Handle custom column mapping re-calculation
  const handleApplyCustomMapping = (newMap: BankColumnMapping) => {
    if (!parseResult) return;
    setCustomMapping(newMap);
    const { lines, netChange } = extractLinesFromRows(parseResult.rawRows, parseResult.headerRowIndex + 1, newMap);
    setStagedLines(lines);
    setNewStmtLines(
      lines.map((l) => ({
        lineDate: l.lineDate,
        description: l.description,
        reference: l.reference,
        amount: l.amount,
      }))
    );
    if (autoUpdateEndingBalance) {
      setNewStmtEndBal(roundMoneyValue(newStmtStartBal + netChange, bookDigits));
    }
    toast.info('تم تحديث مطابقة الأعمدة واستخراج الحركات بنجاح');
  };

  // Handle paste text parsing
  const handleParsePastedText = () => {
    if (!pastedText.trim()) {
      toast.warning('يرجى لصق نص كشف الحساب أولاً');
      return;
    }
    const lines = parseBankStatementText(pastedText);
    if (lines.length === 0) {
      toast.error('لم يتم التعرف على أسطر صالحة تحتوي على تواريخ ومبالغ. يرجى التأكد من التنسيق.');
      return;
    }

    setStagedLines(lines);
    setNewStmtLines(
      lines.map((l) => ({
        lineDate: l.lineDate,
        description: l.description,
        reference: l.reference,
        amount: l.amount,
      }))
    );
    const net = lines.reduce((sum, l) => sum + l.amount, 0);
    if (autoUpdateEndingBalance) {
      setNewStmtEndBal(roundMoneyValue(newStmtStartBal + net, bookDigits));
    }
    toast.success(`تم استخراج ${lines.length} حركة من النص المنسوخ بنجاح`);
    setShowPasteBox(false);
    setPastedText('');
  };

  // Apply staged lines to form's newStmtLines
  const handleCommitStagedLines = () => {
    if (stagedLines.length === 0) {
      toast.warning('لا توجد حركات مستخرجة لاعتمادها');
      return;
    }

    setNewStmtLines(
      stagedLines.map((l) => ({
        lineDate: l.lineDate,
        description: l.description,
        reference: l.reference,
        amount: l.amount,
      }))
    );

    const net = stagedLines.reduce((sum, l) => sum + l.amount, 0);
    if (autoUpdateEndingBalance) {
      setNewStmtEndBal(roundMoneyValue(newStmtStartBal + net, bookDigits));
    }

    toast.success(`تم اعتماد ${stagedLines.length} حركة وإدراجها بكشف الحساب`);
    setActiveTab('manual'); // Switch to review lines tab
  };

  const removeStagedLine = (idx: number) => {
    setStagedLines((prev) => {
      const updated = prev.filter((_, i) => i !== idx);
      const net = updated.reduce((sum, l) => sum + l.amount, 0);
      if (autoUpdateEndingBalance) {
        setNewStmtEndBal(roundMoneyValue(newStmtStartBal + net, bookDigits));
      }
      return updated;
    });
    setNewStmtLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const totalStagedDeposits = stagedLines.filter((l) => l.amount > 0).reduce((sum, l) => sum + l.amount, 0);
  const totalStagedWithdrawals = stagedLines.filter((l) => l.amount < 0).reduce((sum, l) => sum + Math.abs(l.amount), 0);
  const netStaged = totalStagedDeposits - totalStagedWithdrawals;

  return (
    <DialogShell
      open={isOpen}
      onClose={onClose}
      width="min(920px, 96vw)"
      zIndex={95}
      ariaLabel={t('accounting.bank_reconciliation.create_bank_statement_modal.s0', "إضافة واستيراد كشف حساب بنكي")}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px 20px' }} dir="rtl">
        {/* Dialog Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#170e5e', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AppIcons.FileSpreadsheet size={20} color="#170e5e" />
              {t('accounting.bank_reconciliation.create_bank_statement_modal.s1', "إضافة واستيراد كشف حساب بنكي (Bank Statement)")}
            </h2>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>
              {t('accounting.bank_reconciliation.create_bank_statement_modal.s2', "مطابقة كشوف الحسابات الصادرة من البنوك (CIB, الأهلي, مصر, الراجحي, وغيرها) مع حركات الأستاذ العام")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: '#f1f5f9',
              border: 'none',
              borderRadius: '8px',
              padding: '6px',
              cursor: 'pointer',
              color: '#475569',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <XIcon size={18} />
          </button>
        </div>

        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Card 1: Bank & Statement Primary Meta */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px 16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '12px 16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('accounting.bank_reconciliation.create_bank_statement_modal.s3', "الحساب البنكي في شجرة الحسابات *")}
                </label>
                <CustomSelect
                  value={newStmtAccountId ? String(newStmtAccountId) : ''}
                  onChange={(val) => setNewStmtAccountId(Number(val))}
                  options={[
                    { value: '', label: t('accounting.bank_reconciliation.create_bank_statement_modal.s4', "اختر الحساب البنكي...") },
                    ...bankAccounts.map((a: any) => ({
                      value: String(a.id),
                      label: `${a.code} - ${a.nameAr}`,
                    })),
                  ]}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('accounting.bank_reconciliation.create_bank_statement_modal.s5', "رقم كشف الحساب البنكي *")}
                </label>
                <input
                  type="text"
                  placeholder={t('accounting.bank_reconciliation.create_bank_statement_modal.s6', "مثال: STMT-260914-0001")}
                  value={newStmtNo}
                  onChange={(e) => setNewStmtNo(e.target.value)}
                  style={{ width: '100%', height: '36px', padding: '0 10px', fontSize: '0.82rem', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('accounting.bank_reconciliation.create_bank_statement_modal.s7', "تاريخ كشف الحساب *")}
                </label>
                <input
                  type="date"
                  value={newStmtDate}
                  onChange={(e) => setNewStmtDate(e.target.value)}
                  style={{ width: '100%', height: '36px', padding: '0 10px', fontSize: '0.82rem', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('accounting.bank_reconciliation.create_bank_statement_modal.s8', "رصيد بداية الفترة (")}{currencySymbol}) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={newStmtStartBal}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setNewStmtStartBal(val);
                    if (autoUpdateEndingBalance && stagedLines.length > 0) {
                      setNewStmtEndBal(roundMoneyValue(val + netStaged, bookDigits));
                    }
                  }}
                  style={{ width: '100%', height: '36px', padding: '0 10px', fontSize: '0.86rem', fontWeight: 700, borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('accounting.bank_reconciliation.create_bank_statement_modal.s9', "رصيد نهاية الفترة المطلوب (")}{currencySymbol}) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={newStmtEndBal}
                  onChange={(e) => setNewStmtEndBal(Number(e.target.value))}
                  style={{ width: '100%', height: '36px', padding: '0 10px', fontSize: '0.86rem', fontWeight: 800, color: '#170e5e', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('accounting.bank_reconciliation.create_bank_statement_modal.s10', "ملاحظات وبيان إضافي")}
                </label>
                <input
                  type="text"
                  placeholder={t('accounting.bank_reconciliation.create_bank_statement_modal.s11', "ملاحظات اختيارية...")}
                  value={newStmtNotes}
                  onChange={(e) => setNewStmtNotes(e.target.value)}
                  style={{ width: '100%', height: '36px', padding: '0 10px', fontSize: '0.82rem', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                />
              </div>
            </div>
          </div>

          {/* Mode Switcher Tabs */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setActiveTab('smart_import')}
                style={{
                  padding: '7px 16px',
                  borderRadius: '8px',
                  border: 'none',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  background: activeTab === 'smart_import' ? '#170e5e' : '#f1f5f9',
                  color: activeTab === 'smart_import' ? '#ffffff' : '#475569',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <AppIcons.Upload size={14} />
                {t('accounting.bank_reconciliation.create_bank_statement_modal.s12', "الاستيراد الذكي (Excel / CSV / نسخ نصي)")}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('manual')}
                style={{
                  padding: '7px 16px',
                  borderRadius: '8px',
                  border: 'none',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  background: activeTab === 'manual' ? '#170e5e' : '#f1f5f9',
                  color: activeTab === 'manual' ? '#ffffff' : '#475569',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <AppIcons.Edit size={14} />
                {t('accounting.bank_reconciliation.create_bank_statement_modal.s13', "مراجعة وإدخال الأسطر يدوياً")} {newStmtLines.length > 0 ? `(${newStmtLines.length})` : ''}
              </button>
            </div>

            <button
              type="button"
              onClick={downloadBankStatementTemplate}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#170e5e',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <AppIcons.Download size={14} />
              {t('accounting.bank_reconciliation.create_bank_statement_modal.s14', "تحميل قالب إكسيل القياسي (Excel)")}
            </button>
          </div>

          {/* TAB 1: SMART IMPORT */}
          {activeTab === 'smart_import' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Dropzone & Quick Actions */}
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: '2px dashed #94a3b8',
                  borderRadius: '12px',
                  padding: '24px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: '#f8fafc',
                  transition: 'background 0.2s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f5f9')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#f8fafc')}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileUpload}
                  style={{ display: 'none' }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <AppIcons.Upload size={24} color="#1e40af" />
                  </div>
                  <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#1e293b' }}>
                    {isParsingFile ? t('accounting.bank_reconciliation.create_bank_statement_modal.s15', "جاري قراءة وتحليل ملف كشف الحساب...") : t('accounting.bank_reconciliation.create_bank_statement_modal.s16', "اسحب وأفلت ملف كشف الحساب هنا، أو انقر للاختيار")}
                  </div>
                  <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                    {t('accounting.bank_reconciliation.create_bank_statement_modal.s17', "يدعم ملفات Excel (.xlsx, .xls) وملفات القيم المفصولة (.csv) الصادرة من كافة البنوك")}
                  </div>
                </div>
              </div>

              {/* Paste Text Accordion Toggle */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => setShowPasteBox(!showPasteBox)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#2563eb',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: 0,
                  }}
                >
                  <AppIcons.Copy size={13} />
                  {showPasteBox ? t('accounting.bank_reconciliation.create_bank_statement_modal.s18', "إخفاء مربع اللصق النصي") : t('accounting.bank_reconciliation.create_bank_statement_modal.s19', "أو الصق نص الحركات مباشرة من كشف الحساب (PDF / موقع البنك)")}
                </button>

                {parseResult && (
                  <button
                    type="button"
                    onClick={() => setShowMappingBar(!showMappingBar)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#475569',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <AppIcons.Settings size={13} />
                    {showMappingBar ? t('accounting.bank_reconciliation.create_bank_statement_modal.s20', "إخفاء مطابقة الأعمدة") : t('accounting.bank_reconciliation.create_bank_statement_modal.s21', "تعديل مطابقة الأعمدة المكتشفة")}
                  </button>
                )}
              </div>

              {/* Paste Text Area */}
              {showPasteBox && (
                <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '10px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '0.76rem', fontWeight: 700, color: '#334155' }}>
                    {t('accounting.bank_reconciliation.create_bank_statement_modal.s22', "الصق جدول الحركات هنا (مفصول بمسافات أو Tab أو فواصل):")}
                  </label>
                  <textarea
                    rows={4}
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    placeholder={t('accounting.bank_reconciliation.create_bank_statement_modal.s23', "2026-09-01    تحويل بنكي وارد    REF101    50000\n2026-09-02    سداد فاتورة مورد    CHQ202    -18500")}
                    style={{
                      width: '100%',
                      fontFamily: 'monospace',
                      fontSize: '0.8rem',
                      padding: '8px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={handleParsePastedText}
                      style={{
                        padding: '6px 14px',
                        background: '#170e5e',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {t('accounting.bank_reconciliation.create_bank_statement_modal.s24', "استخراج الحركات من النص")}
                    </button>
                  </div>
                </div>
              )}

              {/* Column Mapping Customizer */}
              {showMappingBar && parseResult && customMapping && (
                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '12px' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#1e40af', marginBottom: '8px' }}>
                    {t('accounting.bank_reconciliation.create_bank_statement_modal.s25', "تخصيص مطابقة أعمدة الملف (")}{parseResult.headers.length} {t('accounting.bank_reconciliation.create_bank_statement_modal.s26', "عمود مكتشف):")}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#334155', marginBottom: '2px' }}>{t('accounting.bank_reconciliation.create_bank_statement_modal.s27', "عمود التاريخ")}</label>
                      <CustomSelect
                        value={String(customMapping.dateCol)}
                        onChange={(val) => handleApplyCustomMapping({ ...customMapping, dateCol: Number(val) })}
                        options={parseResult.headers.map((h, i) => ({ value: String(i), label: `${i + 1}. ${h}` }))}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#334155', marginBottom: '2px' }}>{t('accounting.bank_reconciliation.create_bank_statement_modal.s28', "عمود البيان / الوصف")}</label>
                      <CustomSelect
                        value={String(customMapping.descCol)}
                        onChange={(val) => handleApplyCustomMapping({ ...customMapping, descCol: Number(val) })}
                        options={parseResult.headers.map((h, i) => ({ value: String(i), label: `${i + 1}. ${h}` }))}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#334155', marginBottom: '2px' }}>{t('accounting.bank_reconciliation.create_bank_statement_modal.s29', "عمود المرجع / الشيك")}</label>
                      <CustomSelect
                        value={String(customMapping.refCol)}
                        onChange={(val) => handleApplyCustomMapping({ ...customMapping, refCol: Number(val) })}
                        options={[
                          { value: '-1', label: t('accounting.bank_reconciliation.create_bank_statement_modal.s30', "بدون مرجع") },
                          ...parseResult.headers.map((h, i) => ({ value: String(i), label: `${i + 1}. ${h}` })),
                        ]}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#334155', marginBottom: '2px' }}>{t('accounting.bank_reconciliation.create_bank_statement_modal.s31', "نمط المبالغ في الكشف")}</label>
                      <CustomSelect
                        value={customMapping.amountType}
                        onChange={(val) => handleApplyCustomMapping({ ...customMapping, amountType: val as any })}
                        options={[
                          { value: 'single', label: t('accounting.bank_reconciliation.create_bank_statement_modal.s32', "عمود واحد (+ / -)") },
                          { value: 'dual', label: t('accounting.bank_reconciliation.create_bank_statement_modal.s33', "عمودين منفصلين (سحب / إيداع)") },
                        ]}
                      />
                    </div>

                    {customMapping.amountType === 'single' ? (
                      <div>
                        <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#334155', marginBottom: '2px' }}>{t('accounting.bank_reconciliation.create_bank_statement_modal.s34', "عمود المبلغ")}</label>
                        <CustomSelect
                          value={String(customMapping.amountCol)}
                          onChange={(val) => handleApplyCustomMapping({ ...customMapping, amountCol: Number(val) })}
                          options={parseResult.headers.map((h, i) => ({ value: String(i), label: `${i + 1}. ${h}` }))}
                        />
                      </div>
                    ) : (
                      <>
                        <div>
                          <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#334155', marginBottom: '2px' }}>{t('accounting.bank_reconciliation.create_bank_statement_modal.s35', "عمود السحب (Debit)")}</label>
                          <CustomSelect
                            value={String(customMapping.debitCol)}
                            onChange={(val) => handleApplyCustomMapping({ ...customMapping, debitCol: Number(val) })}
                            options={parseResult.headers.map((h, i) => ({ value: String(i), label: `${i + 1}. ${h}` }))}
                          />
                        </div>
                        <div>
                          <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#334155', marginBottom: '2px' }}>{t('accounting.bank_reconciliation.create_bank_statement_modal.s36', "عمود الإيداع (Credit)")}</label>
                          <CustomSelect
                            value={String(customMapping.creditCol)}
                            onChange={(val) => handleApplyCustomMapping({ ...customMapping, creditCol: Number(val) })}
                            options={parseResult.headers.map((h, i) => ({ value: String(i), label: `${i + 1}. ${h}` }))}
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Staged Parsed Preview Card */}
              {stagedLines.length > 0 && (
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px 16px' }}>
                  {/* KPI Summary Strip */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '0.86rem', fontWeight: 800, color: '#170e5e' }}>
                        {t('accounting.bank_reconciliation.create_bank_statement_modal.s37', "الحركات المستخرجة:")} {stagedLines.length} {t('accounting.bank_reconciliation.create_bank_statement_modal.s38', "حركة")}
                      </span>
                      <span style={{ padding: '3px 8px', borderRadius: '6px', background: '#dcfce7', color: '#15803d', fontSize: '0.76rem', fontWeight: 700 }}>
                        {t('accounting.bank_reconciliation.create_bank_statement_modal.s39', "الإيداعات: +")}{totalStagedDeposits.toLocaleString()} {currencySymbol}
                      </span>
                      <span style={{ padding: '3px 8px', borderRadius: '6px', background: '#fee2e2', color: '#b91c1c', fontSize: '0.76rem', fontWeight: 700 }}>
                        {t('accounting.bank_reconciliation.create_bank_statement_modal.s40', "السحوبات: -")}{totalStagedWithdrawals.toLocaleString()} {currencySymbol}
                      </span>
                      <span style={{ padding: '3px 8px', borderRadius: '6px', background: '#eff6ff', color: '#1e40af', fontSize: '0.76rem', fontWeight: 700 }}>
                        {t('accounting.bank_reconciliation.create_bank_statement_modal.s41', "الصافي:")} {netStaged >= 0 ? `+${netStaged.toLocaleString()}` : netStaged.toLocaleString()} {currencySymbol}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <label style={{ fontSize: '0.76rem', color: '#475569', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={autoUpdateEndingBalance}
                          onChange={(e) => {
                            setAutoUpdateEndingBalance(e.target.checked);
                            if (e.target.checked) {
                              setNewStmtEndBal(roundMoneyValue(newStmtStartBal + netStaged, bookDigits));
                            }
                          }}
                        />
                        {t('accounting.bank_reconciliation.create_bank_statement_modal.s42', "تحديث رصيد النهاية تلقائياً")}
                      </label>

                      <button
                        type="button"
                        onClick={handleCommitStagedLines}
                        style={{
                          padding: '7px 16px',
                          background: '#166534',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '0.8rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <AppIcons.CheckCircle size={15} />
                        {t('accounting.bank_reconciliation.create_bank_statement_modal.s43', "اعتماد ونقل الحركات لكشف الحساب (")}{stagedLines.length})
                      </button>
                    </div>
                  </div>

                  {/* Lines Preview Table */}
                  <div style={{ maxHeight: '220px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                      <thead style={{ background: '#f8fafc', position: 'sticky', top: 0, zIndex: 1 }}>
                        <tr style={{ borderBottom: '1px solid #cbd5e1', textAlign: 'right' }}>
                          <th style={{ padding: '8px 10px', color: '#475569' }}>#</th>
                          <th style={{ padding: '8px 10px', color: '#475569' }}>{t('accounting.bank_reconciliation.create_bank_statement_modal.s44', "التاريخ")}</th>
                          <th style={{ padding: '8px 10px', color: '#475569' }}>{t('accounting.bank_reconciliation.create_bank_statement_modal.s45', "البيان والتفاصيل")}</th>
                          <th style={{ padding: '8px 10px', color: '#475569' }}>{t('accounting.bank_reconciliation.create_bank_statement_modal.s46', "المرجع")}</th>
                          <th style={{ padding: '8px 10px', color: '#475569', textAlign: 'left' }}>{t('accounting.bank_reconciliation.create_bank_statement_modal.s47', "المبلغ (")}{currencySymbol})</th>
                          <th style={{ padding: '8px 10px', width: '40px' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {stagedLines.map((line, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '6px 10px', color: '#94a3b8' }}>{idx + 1}</td>
                            <td style={{ padding: '6px 10px', fontWeight: 600 }}>{line.lineDate}</td>
                            <td style={{ padding: '6px 10px', color: '#1e293b' }}>{line.description}</td>
                            <td style={{ padding: '6px 10px', color: '#64748b' }}>{line.reference || '—'}</td>
                            <td
                              style={{
                                padding: '6px 10px',
                                textAlign: 'left',
                                fontWeight: 800,
                                color: line.amount >= 0 ? '#16a34a' : '#dc2626',
                                direction: 'ltr',
                              }}
                            >
                              {line.amount >= 0 ? `+${line.amount.toLocaleString()}` : line.amount.toLocaleString()}
                            </td>
                            <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                              <button
                                type="button"
                                onClick={() => removeStagedLine(idx)}
                                style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', padding: 0 }}
                                title={t('accounting.bank_reconciliation.create_bank_statement_modal.s48', "حذف هذا السطر")}
                              >
                                <XIcon size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: MANUAL LINE ENTRY */}
          {activeTab === 'manual' && (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px 16px', background: '#ffffff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div>
                  <strong style={{ fontSize: '0.86rem', color: '#0f172a' }}>{t('accounting.bank_reconciliation.create_bank_statement_modal.s49', "أسطر الحركات المعتمدة بكشف الحساب:")}</strong>
                  <span style={{ fontSize: '0.76rem', color: '#64748b', marginRight: '8px' }}>
                    ({newStmtLines.length} {t('accounting.bank_reconciliation.create_bank_statement_modal.s50', "حركة مسجلة)")}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setNewStmtLines((prev) => [...prev, { lineDate: newStmtDate, description: '', reference: '', amount: 0 }])}
                  style={{
                    padding: '5px 12px',
                    background: '#f1f5f9',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    fontSize: '0.76rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    color: '#170e5e',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <AppIcons.Plus size={13} />
                  {t('accounting.bank_reconciliation.create_bank_statement_modal.s51', "إضافة سطر حركة يدوي")}
                </button>
              </div>

              {newStmtLines.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px', background: '#f8fafc', borderRadius: '8px', color: '#64748b', fontSize: '0.8rem' }}>
                  {t('accounting.bank_reconciliation.create_bank_statement_modal.s52', "لا توجد حركات مسجلة حالياً. يمكنك استخدام تبويب الاستيراد الذكي لرفع ملف إكسيل أو النقر على \"إضافة سطر حركة يدوي\".")}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '240px', overflowY: 'auto' }}>
                  {newStmtLines.map((line, idx) => (
                    <div key={idx} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 120px 120px 30px', gap: '6px', alignItems: 'center' }}>
                      <input
                        type="date"
                        value={line.lineDate}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNewStmtLines((prev) => prev.map((l, i) => (i === idx ? { ...l, lineDate: val } : l)));
                        }}
                        style={{ padding: '6px', fontSize: '0.78rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                      />
                      <input
                        type="text"
                        placeholder={t('accounting.bank_reconciliation.create_bank_statement_modal.s53', "البيان (مثال: تحويل عميل / مصاريف بنكية)")}
                        value={line.description}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNewStmtLines((prev) => prev.map((l, i) => (i === idx ? { ...l, description: val } : l)));
                        }}
                        style={{ padding: '6px', fontSize: '0.78rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                      />
                      <input
                        type="text"
                        placeholder={t('accounting.bank_reconciliation.create_bank_statement_modal.s54', "رقم المرجع")}
                        value={line.reference}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNewStmtLines((prev) => prev.map((l, i) => (i === idx ? { ...l, reference: val } : l)));
                        }}
                        style={{ padding: '6px', fontSize: '0.78rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                      />
                      <input
                        type="number"
                        step="0.01"
                        placeholder={t('accounting.bank_reconciliation.create_bank_statement_modal.s55', "المبلغ (+ أو -)")}
                        value={line.amount || ''}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setNewStmtLines((prev) => prev.map((l, i) => (i === idx ? { ...l, amount: val } : l)));
                        }}
                        style={{
                          padding: '6px',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          color: line.amount >= 0 ? '#16a34a' : '#dc2626',
                          direction: 'ltr',
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setNewStmtLines((prev) => prev.filter((_, i) => i !== idx))}
                        style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <XIcon size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Footer Actions */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #e2e8f0', paddingTop: '14px' }}>
            <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
              {t('accounting.bank_reconciliation.create_bank_statement_modal.s56', "إجمالي الحركات التي سيتم حفظها:")} <strong style={{ color: '#170e5e' }}>{newStmtLines.length} {t('accounting.bank_reconciliation.create_bank_statement_modal.s57', "حركة")}</strong>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '8px 18px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#475569',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {t('accounting.bank_reconciliation.create_bank_statement_modal.s58', "إلغاء")}
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !newStmtAccountId || !newStmtNo.trim()}
                style={{
                  padding: '8px 22px',
                  borderRadius: '8px',
                  border: 'none',
                  background: isSubmitting || !newStmtAccountId || !newStmtNo.trim() ? '#94a3b8' : '#170e5e',
                  color: '#ffffff',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  cursor: isSubmitting || !newStmtAccountId || !newStmtNo.trim() ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <AppIcons.Check size={16} />
                {isSubmitting ? t('accounting.bank_reconciliation.create_bank_statement_modal.s59', "جارٍ الحفظ والترحيل...") : t('accounting.bank_reconciliation.create_bank_statement_modal.s60', "حفظ كشف الحساب البنكي")}
              </button>
            </div>
          </div>
        </form>
      </div>
    </DialogShell>
  );
};
