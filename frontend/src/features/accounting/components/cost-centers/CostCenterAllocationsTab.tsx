import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { useSystemCurrency } from '@/shared/hooks/use-system-currency';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import {
  costCentersApi,
  type CostCenterAllocation,
  type CostCenterRecord,
} from '../../api/cost-centers.api';
import { PlusIcon, TrashIcon, CheckIcon, ShieldAlertIcon } from '@/shared/components/icons/AppIcons';

interface CostCenterAllocationsTabProps {
  costCenters: CostCenterRecord[];
}

export const CostCenterAllocationsTab: React.FC<CostCenterAllocationsTabProps> = ({ costCenters }) => {
  const { t } = useTranslation();
  const { currencySymbol, currencyCode } = useSystemCurrency();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAllocation, setEditingAllocation] = useState<CostCenterAllocation | null>(null);

  // Form State
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [splits, setSplits] = useState<Array<{ costCenterId: number; percentage: number; notes: string }>>([
    { costCenterId: costCenters[0]?.id || 0, percentage: 50, notes: '' },
    { costCenterId: costCenters[1]?.id || 0, percentage: 50, notes: '' },
  ]);
  const [formError, setFormError] = useState('');

  // Simulator State
  const [simulateAmount, setSimulateAmount] = useState<number>(10000);
  const [selectedSimulateId, setSelectedSimulateId] = useState<string | null>(null);

  const { data: allocations = [], isLoading } = useQuery({
    queryKey: ['cost-center-allocations'],
    queryFn: costCentersApi.listAllocations,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editingAllocation) {
        return await costCentersApi.updateAllocation(editingAllocation.id, {
          code,
          name,
          description,
          splits,
        });
      }
      return await costCentersApi.createAllocation({
        code,
        name,
        description,
        splits,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cost-center-allocations'] });
      setModalOpen(false);
      resetForm();
    },
    onError: (err: any) => {
      setFormError(err?.message || 'فشل حفظ مصفوفة التوزيع');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: costCentersApi.deleteAllocation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cost-center-allocations'] });
    },
  });

  const resetForm = () => {
    setCode('');
    setName('');
    setDescription('');
    setSplits([
      { costCenterId: costCenters[0]?.id || 0, percentage: 50, notes: '' },
      { costCenterId: costCenters[1]?.id || 0, percentage: 50, notes: '' },
    ]);
    setEditingAllocation(null);
    setFormError('');
  };

  const handleOpenCreate = () => {
    resetForm();
    setModalOpen(true);
  };

  const handleOpenEdit = (alloc: CostCenterAllocation) => {
    setEditingAllocation(alloc);
    setCode(alloc.code);
    setName(alloc.name);
    setDescription(alloc.description || '');
    setSplits(
      alloc.splits.map((s) => ({
        costCenterId: s.costCenterId,
        percentage: s.percentage,
        notes: s.notes || '',
      }))
    );
    setFormError('');
    setModalOpen(true);
  };

  const handleAddSplitRow = () => {
    setSplits([...splits, { costCenterId: costCenters[0]?.id || 0, percentage: 0, notes: '' }]);
  };

  const handleRemoveSplitRow = (index: number) => {
    if (splits.length <= 2) return;
    setSplits(splits.filter((_, i) => i !== index));
  };

  const currentTotal = splits.reduce((sum, s) => sum + Number(s.percentage || 0), 0);
  const isValidTotal = Math.abs(currentTotal - 100) < 0.05;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ fontSize: 'var(--font-section-title)', fontWeight: 700, margin: 0, color: '#0f172a' }}>
            {t('accounting.cost_centers.cost_center_allocations_tab.s0', "قوالب ومصفوفات توزيع مراكز التكلفة (Cost Center Allocation Matrices)")}
          </h3>
          <p style={{ fontSize: 'var(--font-subtitle)', color: '#64748b', margin: '4px 0 0' }}>
            {t('accounting.cost_centers.cost_center_allocations_tab.s1', "تمكين تقسيم المصروف الواحد تلقائياً بنسب مئوية دقيقة على أكثر من مركز تكلفة (IFRS / Analytical Accounting).")}
          </p>
        </div>
        <Button variant="primary" onClick={handleOpenCreate}>
          <PlusIcon size={16} />
          {t('accounting.cost_centers.cost_center_allocations_tab.s2', "إضافة قالب توزيع نسبي جديد")}
        </Button>
      </div>

      {/* Allocations Cards Grid */}
      {isLoading ? (
        <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>{t('accounting.cost_centers.cost_center_allocations_tab.s3', "جاري تحميل المصفوفات...")}</div>
      ) : allocations.length === 0 ? (
        <div
          style={{
            padding: '40px',
            textAlign: 'center',
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            color: '#94a3b8',
          }}
        >
          {t('accounting.cost_centers.cost_center_allocations_tab.s4', "لم يتم إنشاء أي مصفوفات توزيع بعد. يمكنك إنشاء قالب لتوزيع المصروفات المشتركة بنسب مئوية.")}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: '16px' }}>
          {allocations.map((alloc) => (
            <div
              key={alloc.id}
              style={{
                backgroundColor: '#ffffff',
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '6px',
                        backgroundColor: '#eff6ff',
                        color: '#1d4ed8',
                        fontSize: 'var(--font-micro)',
                        fontWeight: 700,
                      }}
                    >
                      {alloc.code}
                    </span>
                    <span style={{ fontWeight: 700, fontSize: 'var(--font-body)', color: '#0f172a' }}>
                      {alloc.name}
                    </span>
                  </div>
                  {alloc.description && (
                    <p style={{ margin: '4px 0 0', fontSize: 'var(--font-micro)', color: '#64748b' }}>
                      {alloc.description}
                    </p>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                  <Button
                    variant="secondary"
                    onClick={() => handleOpenEdit(alloc)}
                    style={{ padding: '4px 10px', fontSize: 'var(--font-micro)' }}
                  >
                    {t('accounting.cost_centers.cost_center_allocations_tab.s5', "تعديل")}
                  </Button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`هل أنت متأكد من حذف مصفوفة: ${alloc.name}؟`)) {
                        deleteMutation.mutate(alloc.id);
                      }
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#ef4444',
                      cursor: 'pointer',
                      padding: '4px',
                    }}
                    title={t('accounting.cost_centers.cost_center_allocations_tab.s6', "حذف")}
                  >
                    <TrashIcon size={16} />
                  </button>
                </div>
              </div>

              {/* Progress Distribution Bar */}
              <div
                style={{
                  height: '10px',
                  borderRadius: '5px',
                  backgroundColor: '#f1f5f9',
                  overflow: 'hidden',
                  display: 'flex',
                }}
              >
                {alloc.splits.map((s, idx) => {
                  const colors = ['#170e5e', '#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777'];
                  return (
                    <div
                      key={s.id || idx}
                      style={{
                        width: `${s.percentage}%`,
                        backgroundColor: colors[idx % colors.length],
                      }}
                      title={`${s.costCenterName}: ${s.percentage}%`}
                    />
                  );
                })}
              </div>

              {/* Splits Breakdown List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {alloc.splits.map((s, idx) => {
                  const colors = ['#170e5e', '#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777'];
                  return (
                    <div
                      key={s.id || idx}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: 'var(--font-micro)',
                        alignItems: 'center',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor: colors[idx % colors.length],
                          }}
                        />
                        <span style={{ color: '#334155', fontWeight: 600 }}>{s.costCenterName}</span>
                      </div>
                      <span style={{ fontWeight: 700, color: '#170e5e' }}>{s.percentage}%</span>
                    </div>
                  );
                })}
              </div>

              {/* Quick Simulator Button */}
              <div
                style={{
                  paddingTop: '8px',
                  borderTop: '1px solid #f1f5f9',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <button
                  type="button"
                  onClick={() =>
                    setSelectedSimulateId(selectedSimulateId === alloc.id ? null : alloc.id)
                  }
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#2563eb',
                    fontSize: 'var(--font-micro)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  {selectedSimulateId === alloc.id ? t('accounting.cost_centers.cost_center_allocations_tab.s7', "إخفاء المحاكي") : t('accounting.cost_centers.cost_center_allocations_tab.s8', "تجربة محاكي المبالغ")}
                </button>
              </div>

              {/* Live Simulator View */}
              {selectedSimulateId === alloc.id && (
                <div
                  style={{
                    backgroundColor: '#f8fafc',
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <label style={{ fontSize: 'var(--font-micro)', fontWeight: 600, color: '#475569' }}>
                      {t('accounting.cost_centers.cost_center_allocations_tab.s9', "مبلغ التجربة:")}
                    </label>
                    <input
                      type="number"
                      value={simulateAmount}
                      onChange={(e) => setSimulateAmount(Number(e.target.value))}
                      style={{
                        padding: '4px 8px',
                        width: '110px',
                        borderRadius: '4px',
                        border: '1px solid #cbd5e1',
                        fontSize: 'var(--font-micro)',
                        fontWeight: 700,
                      }}
                    />
                    <span style={{ fontSize: 'var(--font-micro)', color: '#64748b' }}>{currencySymbol}</span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {alloc.splits.map((s) => {
                      // INV-FE3-FRONTEND-BOOK-DIGITS: simulated split
                      // share is money; it rounds at book digits, not 2dp.
                      const share = roundMoneyValue((simulateAmount * s.percentage) / 100, currencyMoneyDigits(currencyCode));
                      return (
                        <div
                          key={s.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: 'var(--font-micro)',
                          }}
                        >
                          <span style={{ color: '#64748b' }}>{s.costCenterName}:</span>
                          <strong style={{ color: '#0f172a' }}>{share.toLocaleString('ar-EG')} {currencySymbol}</strong>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal: Create or Edit Allocation */}
      <StandardDialog
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingAllocation ? t('accounting.cost_centers.cost_center_allocations_tab.s10', "تعديل مصفوفة توزيع مراكز التكلفة") : t('accounting.cost_centers.cost_center_allocations_tab.s11', "إنشاء مصفوفة وقالب توزيع نسبي جديد")}
        subtitle={t('accounting.cost_centers.cost_center_allocations_tab.s12', "حدد مراكز التكلفة المستفيدة ونسبة كل مركز بحيث يكون المجموع الإجمالي 100% بالضبط.")}
        width="620px"
      >
        <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {formError && (
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
              <span>{formError}</span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: 'var(--font-body)', fontWeight: 600, color: '#334155' }}>{t('accounting.cost_centers.cost_center_allocations_tab.s13', "الكود:")}</label>
              <input
                type="text"
                placeholder={t('accounting.cost_centers.cost_center_allocations_tab.s14', "مثال: ALLOC-HQ")}
                value={code}
                onChange={(e) => setCode(e.target.value)}
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
              <label style={{ fontSize: 'var(--font-body)', fontWeight: 600, color: '#334155' }}>{t('accounting.cost_centers.cost_center_allocations_tab.s15', "اسم المصفوفة:")}</label>
              <input
                type="text"
                placeholder={t('accounting.cost_centers.cost_center_allocations_tab.s16', "مثال: توزيع مصروفات المقر الرئيسي والمرافق")}
                value={name}
                onChange={(e) => setName(e.target.value)}
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
            <label style={{ fontSize: 'var(--font-body)', fontWeight: 600, color: '#334155' }}>{t('accounting.cost_centers.cost_center_allocations_tab.s17', "الوصف (اختياري):")}</label>
            <input
              type="text"
              placeholder={t('accounting.cost_centers.cost_center_allocations_tab.s18', "مثال: تقسيم فواتير الإيجار والكهرباء والإنترنت بين الفروع")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: 'var(--font-body)',
                outline: 'none',
              }}
            />
          </div>

          {/* Splits Table */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: 'var(--font-body)', color: '#0f172a' }}>
                {t('accounting.cost_centers.cost_center_allocations_tab.s19', "مراكز التكلفة ونسب التوزيع:")}
              </span>
              <button
                type="button"
                onClick={handleAddSplitRow}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#2563eb',
                  fontWeight: 600,
                  fontSize: 'var(--font-micro)',
                  cursor: 'pointer',
                }}
              >
                {t('accounting.cost_centers.cost_center_allocations_tab.s20', "+ إضافة مركز تكلفة")}
              </button>
            </div>

            {splits.map((row, idx) => (
              <div
                key={idx}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1fr 30px',
                  gap: '8px',
                  alignItems: 'center',
                }}
              >
                <select
                  value={row.costCenterId}
                  onChange={(e) => {
                    const next = [...splits];
                    next[idx].costCenterId = Number(e.target.value);
                    setSplits(next);
                  }}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: 'var(--font-body)',
                    outline: 'none',
                  }}
                >
                  {costCenters.map((cc) => (
                    <option key={cc.id} value={cc.id}>
                      {cc.name} ({cc.code})
                    </option>
                  ))}
                </select>

                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    value={row.percentage}
                    onChange={(e) => {
                      const next = [...splits];
                      next[idx].percentage = Number(e.target.value);
                      setSplits(next);
                    }}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: 'var(--font-body)',
                      fontWeight: 700,
                      width: '100%',
                      outline: 'none',
                    }}
                  />
                  <span style={{ fontSize: 'var(--font-body)', fontWeight: 700, color: '#475569' }}>%</span>
                </div>

                <button
                  type="button"
                  onClick={() => handleRemoveSplitRow(idx)}
                  disabled={splits.length <= 2}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: splits.length <= 2 ? '#cbd5e1' : '#ef4444',
                    cursor: splits.length <= 2 ? 'not-allowed' : 'pointer',
                    padding: '4px',
                  }}
                >
                  <TrashIcon size={16} />
                </button>
              </div>
            ))}

            {/* Total Indicator */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 14px',
                borderRadius: '8px',
                backgroundColor: isValidTotal ? '#ecfdf5' : '#fef2f2',
                border: `1px solid ${isValidTotal ? '#a7f3d0' : '#fecaca'}`,
                color: isValidTotal ? '#065f46' : '#991b1b',
                fontWeight: 700,
                fontSize: 'var(--font-body)',
              }}
            >
              <span>{t('accounting.cost_centers.cost_center_allocations_tab.s21', "إجمالي النسب المئوية:")}</span>
              <span>
                {currentTotal}% {isValidTotal ? t('accounting.cost_centers.cost_center_allocations_tab.s22', "✓ (متطابق 100%)") : `(مطلوب 100% - الفارق ${100 - currentTotal}%)`}
              </span>
            </div>
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
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saveMutation.isPending}>
              {t('accounting.cost_centers.cost_center_allocations_tab.s23', "إلغاء")}
            </Button>
            <Button
              variant="primary"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !isValidTotal}
            >
              <CheckIcon size={16} />
              {t('accounting.cost_centers.cost_center_allocations_tab.s24', "حفظ القالب")}
            </Button>
          </div>
        </div>
      </StandardDialog>
    </div>
  );
};
