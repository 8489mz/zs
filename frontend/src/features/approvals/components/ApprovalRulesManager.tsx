import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { Button } from '@/shared/ui/button';
import {
  ApprovalRule,
  getApprovalRules,
  createApprovalRule,
  updateApprovalRule,
  deleteApprovalRule,
} from '../api/approvals.api';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { systemConfirm } from '@/shared/components/system-alert';
import { PlusIcon, TrashIcon, CheckIcon, ShieldAlertIcon } from '@/shared/components/icons/AppIcons';

export interface ApprovalRulesManagerProps {
  /**
   * INV-APPROVALS-SUMMARY-COUNT: called after every rules mutation
   * (create / toggle / delete) so the parent page can refresh its summary
   * counts. The manager used to reload only itself, leaving the parent's
   * mount-time rulesCount stale until a full page reload.
   */
  onRulesChanged?: () => void;
}

export const ApprovalRulesManager: React.FC<ApprovalRulesManagerProps> = ({ onRulesChanged }) => {
  const { t } = useTranslation();
  const [rules, setRules] = useState<ApprovalRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // New Rule Form state
  const module = 'purchase_orders';
  const [minAmount, setMinAmount] = useState<number>(5000);
  const [maxAmount, setMaxAmount] = useState<string>('');
  const [tierLevel, setTierLevel] = useState<number>(1);
  const [requiredRole, setRequiredRole] = useState<string>('admin');
  const [notes, setNotes] = useState<string>('');

  const loadRules = async () => {
    setLoading(true);
    try {
      const data = await getApprovalRules();
      setRules(data);
    } catch {
      // Resilience
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRules();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);
    setErrorMessage('');
    try {
      await createApprovalRule({
        module,
        minAmount: Number(minAmount),
        maxAmount: maxAmount ? Number(maxAmount) : null,
        tierLevel: Number(tierLevel),
        requiredRole,
        notes,
      });
      setModalOpen(false);
      loadRules();
      onRulesChanged?.();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.message || 'فشل حفظ قاعدة الموافقة.');
    } finally {
      setFormLoading(false);
    }
  };

  const handleToggleActive = async (rule: ApprovalRule) => {
    try {
      await updateApprovalRule(rule.id, { isActive: !rule.is_active });
      loadRules();
      onRulesChanged?.();
    } catch {
      // Resilience
    }
  };

  const handleDelete = async (id: string) => {
    if (!await systemConfirm({ title: 'حذف قاعدة الموافقة', message: 'هل أنت متأكد من حذف هذه القاعدة الرقابية؟', confirmText: 'حذف', variant: 'danger' })) return;
    try {
      await deleteApprovalRule(id);
      loadRules();
      onRulesChanged?.();
    } catch {
      // Resilience
    }
  };

  const moduleLabels: Record<string, string> = {
    purchase_orders: 'أوامر الشراء',
    purchases: 'فواتير المشتريات',
    expenses: 'المصروفات النقدية',
    treasury_transactions: 'حركات وسندات الخزينة',
  };

  const roleLabels: Record<string, string> = {
    admin: 'مدير النظام (Admin)',
    branch_manager: 'مدير الفرع',
    financial_manager: 'المدير المالي',
    general_manager: 'المدير العام / المالك',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ fontSize: 'var(--font-section-title)', fontWeight: 700, margin: 0, color: '#0f172a' }}>
            {t('approvals.approval_rules_manager.s0', "مصفوفة وقواعد الموافقات المعتمدة (Approval Matrix Rules)")}
          </h3>
          <p style={{ fontSize: 'var(--font-subtitle)', color: '#64748b', margin: '4px 0 0' }}>
            {t('approvals.approval_rules_manager.s1', "تحديد المستويات الهرمية وسقف المبالغ المالية والرتب المخولة بالاعتماد لكل موديول.")}
          </p>
        </div>
        <Button variant="primary" onClick={() => setModalOpen(true)}>
          <PlusIcon size={16} />
          {t('approvals.approval_rules_manager.s2', "إضافة قاعدة اعتماد جديدة")}
        </Button>
      </div>

      {/* Rules Table */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              <th style={{ padding: '12px 16px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('approvals.approval_rules_manager.s3', "الموديول")}</th>
              <th style={{ padding: '12px 16px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('approvals.approval_rules_manager.s4', "المستوى الهرمي")}</th>
              <th style={{ padding: '12px 16px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('approvals.approval_rules_manager.s5', "نطاق المبلغ المالي")}</th>
              <th style={{ padding: '12px 16px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('approvals.approval_rules_manager.s6', "الرتبة المخولة")}</th>
              <th style={{ padding: '12px 16px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{t('approvals.approval_rules_manager.s7', "الحالة")}</th>
              <th style={{ padding: '12px 16px', fontSize: 'var(--font-table-head)', color: '#475569', textAlign: 'center' }}>{t('approvals.approval_rules_manager.s8', "إجراءات")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
                  {t('approvals.approval_rules_manager.s9', "جاري تحميل القواعد...")}
                </td>
              </tr>
            ) : rules.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>
                  {t('approvals.approval_rules_manager.s10', "لم يتم تعريف أي قواعد موافقة بعد. يمكنك إضافة قاعدة لتفعيل التدقيق الهرمي.")}
                </td>
              </tr>
            ) : (
              rules.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600, color: '#0f172a' }}>
                    {moduleLabels[r.module] || r.module}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '3px 8px',
                        borderRadius: '6px',
                        backgroundColor: '#eff6ff',
                        color: '#1d4ed8',
                        fontSize: 'var(--font-badge)',
                        fontWeight: 600,
                      }}
                    >
                      {t('approvals.approval_rules_manager.s11', "المستوى")} {r.tier_level}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', color: '#334155' }}>
                    {t('approvals.approval_rules_manager.s12', "من")} {Number(r.min_amount).toLocaleString('ar-EG')} <CurrencySymbol />
                    {r.max_amount ? ` حتى ${Number(r.max_amount).toLocaleString('ar-EG')} ${getGlobalCurrencySymbol()}` : t('approvals.approval_rules_manager.s13', " فأكثر (بدون سقف)")}
                  </td>
                  <td style={{ padding: '12px 16px', color: '#170e5e', fontWeight: 600 }}>
                    {roleLabels[r.required_role] || r.required_role}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <button
                      type="button"
                      onClick={() => handleToggleActive(r)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '6px',
                        border: 'none',
                        backgroundColor: r.is_active ? '#dcfce7' : '#f1f5f9',
                        color: r.is_active ? '#15803d' : '#64748b',
                        fontSize: 'var(--font-micro)',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {r.is_active ? t('approvals.approval_rules_manager.s14', "مفعلة") : t('approvals.approval_rules_manager.s15', "معطلة")}
                    </button>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                    <button
                      type="button"
                      onClick={() => handleDelete(r.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#ef4444',
                        cursor: 'pointer',
                        padding: '4px',
                      }}
                      title={t('approvals.approval_rules_manager.s16', "حذف القاعدة")}
                    >
                      <TrashIcon size={16} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add Rule Dialog */}
      <StandardDialog
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={t('approvals.approval_rules_manager.s17', "إضافة قاعدة اعتماد ورقابة جديدة")}
        subtitle={t('approvals.approval_rules_manager.s18', "حدد شروط تفعيل طلب الموافقة الهرمي وسقف المبالغ والرتبة المطلوبة.")}
        width="600px"
      >
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {errorMessage && (
            <div
              style={{
                padding: '10px 14px',
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '8px',
                color: '#991b1b',
                fontSize: 'var(--font-body)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <ShieldAlertIcon size={16} />
              <span>{errorMessage}</span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: 'var(--font-body)', fontWeight: 600, color: '#334155' }}>
                {t('approvals.approval_rules_manager.s19', "الموديول الخاضع للاعتماد:")}
              </label>
              <p>{t('approvals.approval_rules_manager.s20', "أوامر الشراء (Purchase Orders)")}</p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: 'var(--font-body)', fontWeight: 600, color: '#334155' }}>
                {t('approvals.approval_rules_manager.s21', "المستوى الهرمي (Tier):")}
              </label>
              <select
                value={tierLevel}
                onChange={(e) => setTierLevel(Number(e.target.value))}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: 'var(--font-body)',
                  outline: 'none',
                }}
              >
                <option value={1}>{t('approvals.approval_rules_manager.s22', "المستوى 1 (الموافقة المبدئية)")}</option>
                <option value={2}>{t('approvals.approval_rules_manager.s23', "المستوى 2 (موافقة متوسطة)")}</option>
                <option value={3}>{t('approvals.approval_rules_manager.s24', "المستوى 3 (اعتماد نهائي عليا)")}</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: 'var(--font-body)', fontWeight: 600, color: '#334155' }}>
                {t('approvals.approval_rules_manager.s25', "الحد الأدنى للمبلغ (يبدأ التفعيل عنده):")}
              </label>
              <input
                type="number"
                min="0"
                step="100"
                value={minAmount}
                onChange={(e) => setMinAmount(Number(e.target.value))}
                required
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: 'var(--font-body)',
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: 'var(--font-body)', fontWeight: 600, color: '#334155' }}>
                {t('approvals.approval_rules_manager.s26', "الحد الأقصى للمبلغ (اتركه فارغاً لبلا سقف):")}
              </label>
              <input
                type="number"
                min="0"
                step="100"
                placeholder={t('approvals.approval_rules_manager.s27', "بدون سقف")}
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: 'var(--font-body)',
                  outline: 'none',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: 'var(--font-body)', fontWeight: 600, color: '#334155' }}>
              {t('approvals.approval_rules_manager.s28', "الرتبة الإدارية المخولة بالاعتماد:")}
            </label>
            <select
              value={requiredRole}
              onChange={(e) => setRequiredRole(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: 'var(--font-body)',
                outline: 'none',
              }}
            >
              <option value="admin">{t('approvals.approval_rules_manager.s29', "مدير النظام (Admin)")}</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: 'var(--font-body)', fontWeight: 600, color: '#334155' }}>
              {t('approvals.approval_rules_manager.s30', "وصف القاعدة أو التوجيهات (اختياري):")}
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('approvals.approval_rules_manager.s31', "مثال: يلزم اعتماد المدير المالي للمشتريات التي تتجاوز 20,000")}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: 'var(--font-body)',
                outline: 'none',
              }}
            />
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '8px',
              marginTop: '12px',
              paddingTop: '12px',
              borderTop: '1px solid #e2e8f0',
            }}
          >
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={formLoading}>
              {t('approvals.approval_rules_manager.s32', "إلغاء")}
            </Button>
            <Button variant="primary" type="submit" disabled={formLoading}>
              <CheckIcon size={16} />
              {t('approvals.approval_rules_manager.s33', "حفظ وتفعيل القاعدة")}
            </Button>
          </div>
        </form>
      </StandardDialog>
    </div>
  );
};
