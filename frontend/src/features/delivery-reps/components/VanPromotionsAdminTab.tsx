import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast, systemConfirm } from '@/shared/components/system-alert';
import { vanSalesApi, FmcgPromotion } from '../api/van-sales.api';
import { PromotionsKpiRibbon } from './van-promotions/promotions-kpi-ribbon';
import { PromotionsFilterBar } from './van-promotions/promotions-filter-bar';
import { PromotionsTable } from './van-promotions/promotions-table';
import { PromotionsUpsertModal } from './van-promotions/promotions-upsert-modal';


export function VanPromotionsAdminTab() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Dialog State
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPromo, setEditingPromo] = useState<FmcgPromotion | null>(null);

  // Form State
  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formPromoType, setFormPromoType] = useState<'mix_and_match' | 'tiered_qty' | 'invoice_threshold'>('mix_and_match');
  const [formApplyType, setFormApplyType] = useState<'free_bonus' | 'discount_percent' | 'discount_amount'>('free_bonus');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formMaxApps, setFormMaxApps] = useState('1');
  const [formPriority, setFormPriority] = useState('0');
  const [formNotes, setFormNotes] = useState('');

  // Conditions Form State
  const [conditionItems, setConditionItems] = useState<{ productId: number; productName: string; minQty: number }[]>([]);
  const [thresholdAmount, setThresholdAmount] = useState('5000');

  // Reward Form State
  const [rewardBonusProductId, setRewardBonusProductId] = useState<number | null>(null);
  const [rewardBonusProductName, setRewardBonusProductName] = useState('');
  const [rewardBonusQty, setRewardBonusQty] = useState('1');
  const [rewardDiscountPercent, setRewardDiscountPercent] = useState('5');
  const [rewardDiscountAmount, setRewardDiscountAmount] = useState('100');

  // Product Picker State
  const [selectedProdForCondition, setSelectedProdForCondition] = useState<number | null>(null);
  const [selectedProdQty, setSelectedProdQty] = useState('1');

  // Fetch Promotions
  const { data: promoData, isLoading, refetch } = useQuery({
    queryKey: ['van-admin-promotions'],
    queryFn: () => vanSalesApi.fetchAdminPromotions(),
  });

  const promotions = promoData?.promotions || [];

  // Fetch Products for search
  const { data: productsData } = useQuery({
    queryKey: ['catalog-products-for-promos'],
    queryFn: () => vanSalesApi.getAvailableProducts(),
    enabled: isDialogOpen,
  });

  const availableProducts = useMemo<Array<{ id: number; name: string; barcode: string; price: number }>>(() => {
    return (productsData || []).map((p: any) => ({
      id: Number(p.id || p.productId),
      name: String(p.name || p.productName || ''),
      barcode: String(p.barcode || ''),
      price: Number(p.retailPrice || p.retail_price || p.price || 0),
    }));
  }, [productsData]);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
      toast.success('تم تحديث العروض الترويجية بنجاح');
    } catch {
      toast.error('حدث خطأ أثناء التحديث');
    } finally {
      setIsRefreshing(false);
    }
  };

  const filteredPromotions = useMemo(() => {
    return promotions.filter((p) => {
      if (typeFilter !== 'all' && p.promoType !== typeFilter) return false;
      if (statusFilter === 'active' && !p.isActive) return false;
      if (statusFilter === 'inactive' && p.isActive) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase().trim();
        const matchesName = (p.name || '').toLowerCase().includes(q);
        const matchesCode = (p.code || '').toLowerCase().includes(q);
        return matchesName || matchesCode;
      }
      return true;
    });
  }, [promotions, typeFilter, statusFilter, searchTerm]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: (dto: any) => vanSalesApi.createAdminPromotion(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['van-admin-promotions'] });
      toast.success('تم إنشاء العرض الترويجي بنجاح');
      setIsDialogOpen(false);
    },
    onError: (err: any) => {
      toast.error(err?.message || 'فشل إنشاء العرض الترويجي');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: number; dto: any }) => vanSalesApi.updateAdminPromotion(id, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['van-admin-promotions'] });
      toast.success('تم تعديل العرض الترويجي بنجاح');
      setIsDialogOpen(false);
    },
    onError: (err: any) => {
      toast.error(err?.message || 'فشل تعديل العرض الترويجي');
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      vanSalesApi.toggleAdminPromotionActive(id, isActive),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['van-admin-promotions'] });
      toast.success('تم تحديث حالة العرض');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'فشل تغيير حالة العرض');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => vanSalesApi.deleteAdminPromotion(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['van-admin-promotions'] });
      toast.success('تم حذف العرض الترويجي');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'فشل حذف العرض');
    },
  });

  const openCreateDialog = () => {
    setEditingPromo(null);
    setFormName('');
    setFormCode('');
    setFormPromoType('mix_and_match');
    setFormApplyType('free_bonus');
    setFormStartDate('');
    setFormEndDate('');
    setFormMaxApps('1');
    setFormPriority('0');
    setFormNotes('');
    setConditionItems([]);
    setThresholdAmount('5000');
    setRewardBonusProductId(null);
    setRewardBonusProductName('');
    setRewardBonusQty('1');
    setRewardDiscountPercent('5');
    setRewardDiscountAmount('100');
    setIsDialogOpen(true);
  };

  const openEditDialog = (promo: FmcgPromotion) => {
    setEditingPromo(promo);
    setFormName(promo.name);
    setFormCode(promo.code);
    setFormPromoType(promo.promoType as any);
    setFormApplyType(promo.applyType as any);
    setFormStartDate(promo.startDate || '');
    setFormEndDate(promo.endDate || '');
    setFormMaxApps(String(promo.maxApplicationsPerOrder || 1));
    setFormPriority(String(promo.priority || 0));
    setFormNotes(promo.notes || '');

    if (promo.promoType === 'mix_and_match') {
      const conds = Array.isArray(promo.buyConditions) ? promo.buyConditions : [promo.buyConditions];
      setConditionItems(conds.map((c: any) => ({
        productId: Number(c.productId),
        productName: c.productName || `صنف #${c.productId}`,
        minQty: Number(c.minQty || 1),
      })));
    } else if (promo.promoType === 'tiered_qty') {
      const cond = Array.isArray(promo.buyConditions) ? promo.buyConditions[0] : promo.buyConditions;
      if (cond && cond.productId) {
        setConditionItems([{
          productId: Number(cond.productId),
          productName: cond.productName || `صنف #${cond.productId}`,
          minQty: Number(cond.minQty || 1),
        }]);
      }
    } else if (promo.promoType === 'invoice_threshold') {
      setThresholdAmount(String(promo.buyConditions?.minInvoiceTotal || 5000));
    }

    setRewardBonusProductId(promo.reward?.bonusProductId || null);
    setRewardBonusProductName(promo.reward?.bonusProductName || '');
    setRewardBonusQty(String(promo.reward?.bonusQty || 1));
    setRewardDiscountPercent(String(promo.reward?.discountPercent || 5));
    setRewardDiscountAmount(String(promo.reward?.discountAmount || 100));

    setIsDialogOpen(true);
  };

  const handleAddConditionItem = () => {
    if (!selectedProdForCondition) {
      toast.warning('يرجى اختيار الصنف أولاً');
      return;
    }
    const prod = availableProducts.find((p) => p.id === selectedProdForCondition);
    if (!prod) return;

    if (conditionItems.some((c) => c.productId === prod.id)) {
      toast.warning('هذا الصنف مضاف بالفعل في شروط العرض');
      return;
    }

    setConditionItems([
      ...conditionItems,
      {
        productId: prod.id,
        productName: prod.name,
        minQty: Math.max(1, Number(selectedProdQty) || 1),
      },
    ]);
    setSelectedProdForCondition(null);
    setSelectedProdQty('1');
  };

  const handleRemoveConditionItem = (pId: number) => {
    setConditionItems(conditionItems.filter((c) => c.productId !== pId));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      toast.error('يرجى إدخال اسم العرض الترويجي');
      return;
    }

    let buyConditions: any = [];
    if (formPromoType === 'mix_and_match') {
      if (conditionItems.length < 2) {
        toast.error('عروض الخلطات (Mix & Match) تتطلب صنفين على الأقل');
        return;
      }
      buyConditions = conditionItems;
    } else if (formPromoType === 'tiered_qty') {
      if (conditionItems.length === 0) {
        toast.error('يرجى تحديد الصنف والكمية المطلوبة للشريحة');
        return;
      }
      buyConditions = conditionItems[0];
    } else if (formPromoType === 'invoice_threshold') {
      const minTotal = Number(thresholdAmount);
      if (isNaN(minTotal) || minTotal <= 0) {
        toast.error('يرجى إدخال حد أدنى صالح لقيمة الفاتورة');
        return;
      }
      buyConditions = { minInvoiceTotal: minTotal };
    }

    const reward: any = {};
    if (formApplyType === 'free_bonus') {
      if (!rewardBonusProductId) {
        toast.error('يرجى اختيار صنف الهدية / البونص المجاني');
        return;
      }
      reward.bonusProductId = rewardBonusProductId;
      reward.bonusProductName = rewardBonusProductName;
      reward.bonusQty = Math.max(1, Number(rewardBonusQty) || 1);
      reward.bonusReason = `عرض ترويجي: ${formName.trim()}`;
    } else if (formApplyType === 'discount_percent') {
      const pct = Number(rewardDiscountPercent);
      if (isNaN(pct) || pct <= 0 || pct > 100) {
        toast.error('يرجى إدخال نسبة خصم صالحة (1 - 100%)');
        return;
      }
      reward.discountPercent = pct;
    } else if (formApplyType === 'discount_amount') {
      const amt = Number(rewardDiscountAmount);
      if (isNaN(amt) || amt <= 0) {
        toast.error('يرجى إدخال قيمة خصم نقدية صالحة');
        return;
      }
      reward.discountAmount = amt;
    }

    const payload = {
      name: formName.trim(),
      code: formCode.trim() || undefined,
      promoType: formPromoType,
      applyType: formApplyType,
      buyConditions,
      reward,
      startDate: formStartDate || null,
      endDate: formEndDate || null,
      maxApplicationsPerOrder: Math.max(1, Number(formMaxApps) || 1),
      priority: Number(formPriority) || 0,
      notes: formNotes.trim() || null,
    };

    if (editingPromo) {
      updateMutation.mutate({ id: editingPromo.id, dto: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleDelete = async (promo: FmcgPromotion) => {
    const ok = await systemConfirm({
      title: 'حذف العرض الترويجي',
      message: `هل أنت متأكد من حذف العرض الترويجي «${promo.name}» نهائياً؟`,
      confirmText: 'نعم، حذف',
      cancelText: 'تراجع',
      variant: 'danger',
    });
    if (ok) {
      deleteMutation.mutate(promo.id);
    }
  };

  // KPI Calculations
  const activeCount = promotions.filter((p) => p.isActive).length;
  const mixMatchCount = promotions.filter((p) => p.promoType === 'mix_and_match').length;
  const tieredCount = promotions.filter((p) => p.promoType === 'tiered_qty' || p.promoType === 'invoice_threshold').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 1. KPI Ribbon */}
      <PromotionsKpiRibbon
        promotions={promotions}
        activeCount={activeCount}
        mixMatchCount={mixMatchCount}
        tieredCount={tieredCount}
      />

      {/* 2. Action & Filter Bar */}
      <PromotionsFilterBar
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        typeFilter={typeFilter}
        setTypeFilter={setTypeFilter}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        handleManualRefresh={handleManualRefresh}
        isRefreshing={isRefreshing}
        openCreateDialog={openCreateDialog}
      />

      {/* 3. Promotions Table / List */}
      <PromotionsTable
        isLoading={isLoading}
        filteredPromotions={filteredPromotions}
        toggleActiveMutation={toggleActiveMutation}
        openEditDialog={openEditDialog}
        handleDelete={handleDelete}
      />

      {/* 4. Upsert Promotion Modal */}
      {isDialogOpen && (
        <PromotionsUpsertModal
          isDialogOpen={isDialogOpen}
          setIsDialogOpen={setIsDialogOpen}
          editingPromo={editingPromo}
          handleSubmit={handleSubmit}
          formName={formName}
          setFormName={setFormName}
          formCode={formCode}
          setFormCode={setFormCode}
          formPromoType={formPromoType}
          setFormPromoType={setFormPromoType}
          formApplyType={formApplyType}
          setFormApplyType={setFormApplyType}
          thresholdAmount={thresholdAmount}
          setThresholdAmount={setThresholdAmount}
          conditionItems={conditionItems}
          handleRemoveConditionItem={handleRemoveConditionItem}
          selectedProdForCondition={selectedProdForCondition}
          setSelectedProdForCondition={setSelectedProdForCondition}
          availableProducts={availableProducts}
          selectedProdQty={selectedProdQty}
          setSelectedProdQty={setSelectedProdQty}
          handleAddConditionItem={handleAddConditionItem}
          rewardBonusProductId={rewardBonusProductId}
          setRewardBonusProductId={setRewardBonusProductId}
          setRewardBonusProductName={setRewardBonusProductName}
          rewardBonusQty={rewardBonusQty}
          setRewardBonusQty={setRewardBonusQty}
          rewardDiscountPercent={rewardDiscountPercent}
          setRewardDiscountPercent={setRewardDiscountPercent}
          rewardDiscountAmount={rewardDiscountAmount}
          setRewardDiscountAmount={setRewardDiscountAmount}
          formStartDate={formStartDate}
          setFormStartDate={setFormStartDate}
          formEndDate={formEndDate}
          setFormEndDate={setFormEndDate}
          formMaxApps={formMaxApps}
          setFormMaxApps={setFormMaxApps}
          createMutation={createMutation}
          updateMutation={updateMutation}
        />
      )}
    </div>
  );
}
