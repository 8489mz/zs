import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RestaurantOperationsDialog } from './RestaurantOperationsDialog';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import {
  PlusCircleIcon,
} from '@/shared/components/icons/AppIcons';
import {
  restaurantFoodWasteApi,
} from '@/features/pos/api/restaurant-food-waste.api';
import { formatCurrency } from '@/lib/format';
import { toast } from '@/shared/components/system-alert';

interface PosFoodWasteModalProps {
  open: boolean;
  onClose: () => void;
  branchId?: number;
  onBack?: () => void;
}

export function PosFoodWasteModal({ open, onClose, branchId = 1, onBack }: PosFoodWasteModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'log' | 'history'>('log');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState<string>('spoilage');
  const [notes, setNotes] = useState('');

  // Queries
  const { data: summary, isLoading: isLoadingSummary } = useQuery({
    queryKey: ['restaurant-food-waste-summary', branchId],
    queryFn: () => restaurantFoodWasteApi.getSummary(branchId),
    enabled: open,
  });

  const { data: logs = [], isLoading: isLoadingLogs } = useQuery({
    queryKey: ['restaurant-food-waste-logs', branchId],
    queryFn: () => restaurantFoodWasteApi.listLogs({ branchId }),
    enabled: open && activeTab === 'history',
  });

  // Mutation
  const logWasteMutation = useMutation({
    mutationFn: (payload: { branchId: number; productId: number; quantity: number; reason: string; notes?: string }) =>
      restaurantFoodWasteApi.logWaste(payload),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['restaurant-food-waste-summary'] });
      queryClient.invalidateQueries({ queryKey: ['restaurant-food-waste-logs'] });
      toast.success(`تم تسجيل هدر المطبخ للصنف: ${data.productName} بقيمة ${formatCurrency(data.totalCost)}`);
      setProductId('');
      setQuantity('1');
      setNotes('');
      setActiveTab('history');
    },
    onError: () => {
      toast.error('تعذر تسجيل هدر المطبخ، يرجى التأكد من رقم الصنف');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId || Number(productId) <= 0) {
      toast.warning('يرجى إدخال رقم الصنف بشكل صحيح');
      return;
    }
    if (!quantity || Number(quantity) <= 0) {
      toast.warning('يرجى إدخال كمية صحيحة');
      return;
    }

    logWasteMutation.mutate({
      branchId,
      productId: Number(productId),
      quantity: Number(quantity),
      reason,
      notes,
    });
  };

  const getReasonLabel = (r: string) => {
    switch (r) {
      case 'spoilage':
        return 'تلف أو فساد مادة خام';
      case 'prep_error':
        return 'خطأ إعداد وتحضير بالمطبخ';
      case 'expired':
        return 'انتهاء صلاحية الصنف';
      case 'customer_complaint':
        return 'شكوى أو استرجاع طبق من الزبون';
      default:
        return 'أسباب أخرى';
    }
  };

  return (
    <RestaurantOperationsDialog
      open={open}
      onClose={onClose}
      onBack={onBack}
      backText={t('pos.pos_workspace.pos_food_waste_modal.s0', "الرجوع لعمليات المطعم")}
      title={t('pos.pos_workspace.pos_food_waste_modal.s1', "إدارة وتوثيق هدر المطبخ والتالف (Kitchen Food Waste & Spoilage)")}
      subtitle={t('pos.pos_workspace.pos_food_waste_modal.s2', "توثيق هدر وتالف المواد الغذائية والوجبات وخصمها من المستودع مع تحليل التكلفة")}
      footerNote={t('pos.pos_workspace.pos_food_waste_modal.s3', "تسجيل التالف يخصم الكميات من المخزون المركزي ويحسب التكلفة تلقائياً")}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* KPI Strip */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: '#fef2f2',
              borderRadius: '10px',
              border: '1px solid #fee2e2',
            }}
          >
            <div style={{ fontSize: '11.5px', fontWeight: 600, color: '#991b1b' }}>
              {t('pos.pos_workspace.pos_food_waste_modal.s4', "إجمالي تكلفة الهدر (آخر 30 يوماً)")}
            </div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: '#b91c1c', marginTop: '2px' }}>
              {isLoadingSummary ? '—' : formatCurrency(Number(summary?.totalWasteCost || 0))}
            </div>
          </div>
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: '#f8fafc',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
            }}
          >
            <div style={{ fontSize: '11.5px', fontWeight: 600, color: '#475569' }}>
              {t('pos.pos_workspace.pos_food_waste_modal.s5', "إجمالي حوادث الهدر المسجلة")}
            </div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>
              {isLoadingSummary ? '—' : `${summary?.totalWasteIncidents || 0} واقعة`}
            </div>
          </div>
        </div>

        {/* Tab Selector */}
        <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
          <button
            type="button"
            onClick={() => setActiveTab('log')}
            style={{
              padding: '6px 14px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              fontWeight: 600,
              fontSize: '12.5px',
              cursor: 'pointer',
              backgroundColor: activeTab === 'log' ? '#170e5e' : '#ffffff',
              color: activeTab === 'log' ? '#ffffff' : '#475569',
            }}
          >
            {t('pos.pos_workspace.pos_food_waste_modal.s6', "تسجيل هدر جديد")}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            style={{
              padding: '6px 14px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              fontWeight: 600,
              fontSize: '12.5px',
              cursor: 'pointer',
              backgroundColor: activeTab === 'history' ? '#170e5e' : '#ffffff',
              color: activeTab === 'history' ? '#ffffff' : '#475569',
            }}
          >
            {t('pos.pos_workspace.pos_food_waste_modal.s7', "سجل الهدر والتالف السابق")}
          </button>
        </div>

        {/* Tab 1: Form */}
        {activeTab === 'log' && (
          <form
            onSubmit={handleSubmit}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              backgroundColor: '#f8fafc',
              padding: '16px',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('pos.pos_workspace.pos_food_waste_modal.s8', "رقم الصنف أو المادة الخام (Product ID) *")}
                </label>
                <input
                  type="number"
                  className="no-spin-arrows"
                  placeholder={t('pos.pos_workspace.pos_food_waste_modal.s9', "مثال: 104")}
                  value={productId}
                  onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
                  onChange={(e) => setProductId(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('pos.pos_workspace.pos_food_waste_modal.s10', "الكمية التالفة / المهدورة *")}
                </label>
                <input
                  type="number"
                  className="no-spin-arrows"
                  step="0.01"
                  min="0.01"
                  value={quantity}
                  onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
                  onChange={(e) => setQuantity(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('pos.pos_workspace.pos_food_waste_modal.s11', "سبب الهدر والتلف *")}
                </label>
                <CustomSelect
                  value={reason}
                  onChange={(val) => setReason(val)}
                  searchable={false}
                  style={{ width: '100%' }}
                  options={[
                    { value: 'spoilage', label: t('pos.pos_workspace.pos_food_waste_modal.s12', 'تلف أو فساد مادة خام') },
                    { value: 'prep_error', label: t('pos.pos_workspace.pos_food_waste_modal.s13', 'خطأ إعداد وتحضير بالمطبخ') },
                    { value: 'expired', label: t('pos.pos_workspace.pos_food_waste_modal.s14', 'انتهاء صلاحية الصنف') },
                    { value: 'customer_complaint', label: t('pos.pos_workspace.pos_food_waste_modal.s15', 'شكوى أو استرجاع طبق من الزبون') },
                    { value: 'other', label: t('pos.pos_workspace.pos_food_waste_modal.s16', 'أسباب أخرى') },
                  ]}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('pos.pos_workspace.pos_food_waste_modal.s17', "ملاحظات وتفاصيل إضافية")}
                </label>
                <input
                  type="text"
                  placeholder={t('pos.pos_workspace.pos_food_waste_modal.s18', "مثال: احتراق الخبز في الفرن أو تلف كرتون الخضار")}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
              <Button
                type="submit"
                disabled={logWasteMutation.isPending}
                style={{
                  backgroundColor: '#b91c1c',
                  color: '#ffffff',
                  fontSize: '12.5px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <PlusCircleIcon size={14} />
                {logWasteMutation.isPending ? t('pos.pos_workspace.pos_food_waste_modal.s19', "جاري التسجيل...") : t('pos.pos_workspace.pos_food_waste_modal.s20', "إثبات هدر وخصم من المستودع")}
              </Button>
            </div>
          </form>
        )}

        {/* Tab 2: History List */}
        {activeTab === 'history' && (
          <div
            style={{
              height: '310px',
              minHeight: '310px',
              maxHeight: '310px',
              overflowY: 'auto',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '8px 10px', fontSize: '11.5px', fontWeight: 700, color: '#475569' }}>{t('pos.pos_workspace.pos_food_waste_modal.s21', "الصنف")}</th>
                  <th style={{ padding: '8px 10px', fontSize: '11.5px', fontWeight: 700, color: '#475569' }}>{t('pos.pos_workspace.pos_food_waste_modal.s22', "الكمية")}</th>
                  <th style={{ padding: '8px 10px', fontSize: '11.5px', fontWeight: 700, color: '#475569' }}>
                    {t('pos.pos_workspace.pos_food_waste_modal.s23', "تكلفة الهدر")}
                  </th>
                  <th style={{ padding: '8px 10px', fontSize: '11.5px', fontWeight: 700, color: '#475569' }}>{t('pos.pos_workspace.pos_food_waste_modal.s24', "السبب")}</th>
                  <th style={{ padding: '8px 10px', fontSize: '11.5px', fontWeight: 700, color: '#475569' }}>
                    {t('pos.pos_workspace.pos_food_waste_modal.s25', "التاريخ")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoadingLogs ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>
                      {t('pos.pos_workspace.pos_food_waste_modal.s26', "جاري تحميل السجلات...")}
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '24px', color: '#94a3b8' }}>
                      {t('pos.pos_workspace.pos_food_waste_modal.s27', "لا توجد سجلات هدر مسجلة لهذا الفرع")}
                    </td>
                  </tr>
                ) : (
                  logs.map((l) => (
                    <tr key={l.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '8px 10px', fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                        {l.product_name}
                      </td>
                      <td style={{ padding: '8px 10px', fontSize: '12px', color: '#334155' }}>{Number(l.quantity)}</td>
                      <td style={{ padding: '8px 10px', fontSize: '12px', fontWeight: 700, color: '#b91c1c' }}>
                        {formatCurrency(Number(l.total_cost))}
                      </td>
                      <td style={{ padding: '8px 10px', fontSize: '11.5px', color: '#64748b' }}>
                        {getReasonLabel(l.reason)}
                      </td>
                      <td style={{ padding: '8px 10px', fontSize: '11px', color: '#94a3b8' }}>
                        {new Date(l.created_at).toLocaleDateString('ar-SA')}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </RestaurantOperationsDialog>
  );
}
