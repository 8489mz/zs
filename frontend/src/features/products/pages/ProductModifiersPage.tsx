import { useTranslation } from 'react-i18next';
import { useState, useEffect, type FC } from 'react';
import { PageHeader } from '@/shared/components/page-header';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { Button } from '@/shared/ui/button';
import {
  addonsApi,
  ModifierGroup,
  ModifierOption,
} from '@/shared/api/addons.api';
import { productsApi } from '@/features/products/api/products.api';
import { ModifierGroupCard } from '@/features/products/components/modifiers/ModifierGroupCard';
import { ModifierGroupModal } from '@/features/products/components/modifiers/ModifierGroupModal';
import { systemConfirm, toast } from '@/shared/components/system-alert';

export const ProductModifiersPage: FC = () => {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ModifierGroup | null>(null);
  const [formName, setFormName] = useState('');
  const [formNameEn, setFormNameEn] = useState('');
  const [formSelectionType, setFormSelectionType] = useState<'single' | 'multiple'>('multiple');
  const [formIsMandatory, setFormIsMandatory] = useState(false);
  const [formMinSelections, setFormMinSelections] = useState(0);
  const [formMaxSelections, setFormMaxSelections] = useState(10);
  const [formDisplayOrder, setFormDisplayOrder] = useState(0);
  const [formIsActive, setFormIsActive] = useState(true);
  const [formIsSplittableInHalf, setFormIsSplittableInHalf] = useState(false);
  const [formOptions, setFormOptions] = useState<ModifierOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [modalFeedback, setModalFeedback] = useState<{ text: string; error?: boolean } | null>(null);

  // R4-C I50: product <-> group linking. A product shows ONLY its
  // linked groups at the till; nothing was ever linked before (the
  // endpoint had zero callers), so returning [] for unlinked products
  // without this UI would silently switch the feature off.
  const [linkProducts, setLinkProducts] = useState<{ id: number | string; name: string }[]>([]);
  const [linkProductId, setLinkProductId] = useState('');
  const [linkGroupIds, setLinkGroupIds] = useState<number[]>([]);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkSaving, setLinkSaving] = useState(false);
  const [linkFeedback, setLinkFeedback] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    loadGroups();
    loadLinkProducts();
  }, []);

  const loadLinkProducts = async () => {
    try {
      const rows = await productsApi.list();
      setLinkProducts((rows || []).map((p: any) => ({ id: p.id, name: p.name })));
    } catch {
      setLinkProducts([]);
    }
  };

  const handleSelectLinkProduct = async (productId: string) => {
    setLinkProductId(productId);
    setLinkGroupIds([]);
    setLinkFeedback(null);
    if (!productId) return;
    setLinkLoading(true);
    try {
      const linked = await addonsApi.getProductModifiers(Number(productId));
      setLinkGroupIds((linked || []).map((g) => Number(g.id)));
    } catch {
      setLinkFeedback({ text: 'تعذر تحميل مجموعات الصنف', error: true });
    } finally {
      setLinkLoading(false);
    }
  };

  const handleSaveLink = async () => {
    if (!linkProductId) return;
    setLinkSaving(true);
    setLinkFeedback(null);
    try {
      await addonsApi.linkProductModifiers(Number(linkProductId), linkGroupIds);
      toast.success('تم حفظ ربط المجموعات بالصنف');
    } catch (err: any) {
      setLinkFeedback({ text: err?.message || 'تعذر حفظ الربط', error: true });
    } finally {
      setLinkSaving(false);
    }
  };

  const loadGroups = async () => {
    setLoading(true);
    try {
      const res = await addonsApi.listModifierGroups();
      setGroups(res || []);
    } catch {
      setGroups([]);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenCreate = () => {
    setEditingGroup(null);
    setFormName('');
    setFormNameEn('');
    setFormSelectionType('multiple');
    setFormIsMandatory(false);
    setFormMinSelections(0);
    setFormMaxSelections(10);
    setFormDisplayOrder(0);
    setFormIsActive(true);
    setFormIsSplittableInHalf(false);
    setFormOptions([
      { name: '', price: 0, costPrice: 0, isDefault: false, isActive: true },
    ]);
    setModalFeedback(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (group: ModifierGroup) => {
    setEditingGroup(group);
    setFormName(group.name);
    setFormNameEn(group.nameEn || '');
    setFormSelectionType(group.selectionType);
    setFormIsMandatory(group.isMandatory);
    setFormMinSelections(group.minSelections);
    setFormMaxSelections(group.maxSelections);
    setFormDisplayOrder(Number(group.displayOrder ?? 0));
    setFormIsActive(group.isActive !== false);
    setFormIsSplittableInHalf(group.isSplittableInHalf === true);
    setFormOptions(group.options?.length ? [...group.options] : [{ name: '', price: 0, costPrice: 0, isDefault: false, isActive: true }]);
    setModalFeedback(null);
    setIsModalOpen(true);
  };

  const handleAddOptionRow = () => {
    setFormOptions([...formOptions, { name: '', price: 0, costPrice: 0, isDefault: false, isActive: true }]);
  };

  const handleRemoveOptionRow = (index: number) => {
    setFormOptions(formOptions.filter((_, i) => i !== index));
  };

  const handleOptionChange = (index: number, field: keyof ModifierOption, value: any) => {
    const updated = [...formOptions];
    updated[index] = { ...updated[index], [field]: value };
    setFormOptions(updated);
  };

  const handleSaveGroup = async () => {
    if (!formName.trim()) {
      setModalFeedback({ text: 'يرجى إدخال اسم مجموعة الإضافات', error: true });
      return;
    }

    const cleanOptions = formOptions
      .filter((opt) => opt.name.trim() !== '')
      .map((opt) => ({
        ...opt,
        name: opt.name.trim(),
        price: Number(opt.price || 0),
        costPrice: Number(opt.costPrice || 0),
        componentProductId: opt.componentProductId ? Number(opt.componentProductId) : null,
        consumptionQty: opt.consumptionQty !== null && opt.consumptionQty !== undefined && String(opt.consumptionQty) !== '' ? Number(opt.consumptionQty) : null,
        unitName: opt.unitName ? opt.unitName.trim() : null,
      }));

    if (cleanOptions.length === 0) {
      setModalFeedback({ text: 'يرجى إضافة خيار واحد على الأقل داخل المجموعة', error: true });
      return;
    }

    setSaving(true);
    setModalFeedback(null);
    try {
      const payload = {
        name: formName.trim(),
        nameEn: formNameEn.trim() || undefined,
        selectionType: formSelectionType,
        isMandatory: formIsMandatory,
        minSelections: formMinSelections,
        maxSelections: formMaxSelections,
        displayOrder: formDisplayOrder,
        isActive: formIsActive,
        isSplittableInHalf: formIsSplittableInHalf,
        options: cleanOptions,
      };

      if (editingGroup) {
        await addonsApi.updateModifierGroup(editingGroup.id, payload);
      } else {
        await addonsApi.createModifierGroup(payload);
      }

      setIsModalOpen(false);
      loadGroups();
    } catch (err: any) {
      setModalFeedback({ text: err?.message || 'تعذر حفظ مجموعة الإضافات', error: true });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteGroup = async (id: number) => {
    const confirmed = await systemConfirm({
      title: 'تأكيد الحذف',
      message: 'هل أنت متأكد من حذف هذه المجموعة وكافة خياراتها؟',
      confirmText: 'حذف',
      cancelText: 'إلغاء',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await addonsApi.deleteModifierGroup(id);
      toast.success('تم حذف مجموعة الخيارات بنجاح');
      loadGroups();
    } catch (err: any) {
      toast.error(err?.message || 'تعذر حذف المجموعة');
    }
  };

  return (
    <div className="page-stack page-shell" dir="rtl">
      <div className="document-prototype-column" style={{ paddingBottom: '32px' }}>
        <PageHeader
          title={t('products.product_modifiers_page.s0', "مجموعات خيارات وإضافات الأصناف (Item Modifiers & Add-ons)")}
          description={t('products.product_modifiers_page.s1', "إدارة مصفوفة الخيارات والإضافات ودرجات الطهي والوجبات الكومبو المدمجة فورياً مع شاشة الكاشير والمطبخ (KDS) والإيصال الحراري.")}
          badge={<span className="nav-pill">{t('products.product_modifiers_page.s2', "المطاعم ونقاط البيع")}</span>}
          actions={
            <Button
              variant="primary"
              onClick={handleOpenCreate}
            >
              <AppIcons.Plus size={16} />
              {t('products.product_modifiers_page.s3', "إضافة مجموعة خيارات جديدة")}
            </Button>
          }
        />

        {/* R4-C I50: product <-> group linking. A product shows ONLY its
            linked groups at the till; without this UI nothing was ever
            linked and every product fell back to all groups. */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px 18px', marginBottom: '20px' }}>
          <div style={{ fontWeight: 800, fontSize: '0.95rem', color: '#0f172a' }}>
            {t('products.product_modifiers_page.s7', "ربط المجموعات بالأصناف")}
          </div>
          <div style={{ fontSize: '12.5px', color: '#64748b', marginTop: '2px', marginBottom: '12px' }}>
            {t('products.product_modifiers_page.s8', "اختر الصنف ثم حدد المجموعات التي تظهر له عند الكاشير — الصنف بلا مجموعات مربوطة لا يعرض أي مجموعة خيارات.")}
          </div>
          {linkFeedback && (
            <div style={{ padding: '8px 12px', borderRadius: '8px', fontSize: '13px', marginBottom: '10px', backgroundColor: linkFeedback.error ? '#fef2f2' : '#f0fdf4', color: linkFeedback.error ? '#991b1b' : '#166534', border: `1px solid ${linkFeedback.error ? '#fecaca' : '#bbf7d0'}` }}>
              {linkFeedback.text}
            </div>
          )}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={linkProductId}
              onChange={(e) => void handleSelectLinkProduct(e.target.value)}
              style={{ height: '35px', minWidth: '240px', borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0 10px', fontSize: '13px', background: '#ffffff' }}
              aria-label={t('products.product_modifiers_page.s9', "اختر الصنف")}
            >
              <option value="">{t('products.product_modifiers_page.s10', "— اختر الصنف —")}</option>
              {linkProducts.map((p) => (
                <option key={String(p.id)} value={String(p.id)}>{p.name}</option>
              ))}
            </select>
            <Button variant="primary" onClick={() => void handleSaveLink()} disabled={!linkProductId || linkSaving || linkLoading}>
              {linkSaving ? t('products.product_modifiers_page.s11', "جارٍ الحفظ...") : t('products.product_modifiers_page.s12', "حفظ الربط")}
            </Button>
            {linkLoading && <span style={{ fontSize: '12.5px', color: '#64748b' }}>{t('products.product_modifiers_page.s13', "جارٍ تحميل مجموعات الصنف...")}</span>}
          </div>
          {linkProductId && !linkLoading && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
              {groups.length === 0 && (
                <span style={{ fontSize: '12.5px', color: '#64748b' }}>{t('products.product_modifiers_page.s14', "لا توجد مجموعات بعد — أنشئ مجموعة أولاً.")}</span>
              )}
              {groups.map((g) => (
                <label key={g.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: '#334155', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '6px 10px', background: linkGroupIds.includes(Number(g.id)) ? '#f5f3ff' : '#ffffff' }}>
                  <input
                    type="checkbox"
                    checked={linkGroupIds.includes(Number(g.id))}
                    onChange={(e) => setLinkGroupIds(e.target.checked
                      ? [...linkGroupIds, Number(g.id)]
                      : linkGroupIds.filter((id) => id !== Number(g.id)))}
                  />
                  <span>{g.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '50px', color: '#64748b' }}>
            {t('products.product_modifiers_page.s4', "جاري تحميل مجموعات الإضافات والخيارات...")}
          </div>
        ) : groups.length === 0 ? (
          <div
            style={{
              padding: '60px 20px',
              textAlign: 'center',
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              color: '#64748b',
            }}
          >
            <AppIcons.Layers size={42} color="#94a3b8" />
            <div style={{ marginTop: '12px', fontSize: '15px', fontWeight: 700, color: '#334155' }}>
              {t('products.product_modifiers_page.s5', "لا توجد مجموعات خيارات معرفة حتى الآن")}
            </div>
            <div style={{ marginTop: '4px', fontSize: '13px', color: '#94a3b8' }}>
              {t('products.product_modifiers_page.s6', "يمكنك إضافة مجموعات مثل \"درجة الطهي\"، \"الصوصات\"، \"إضافات إكسترا\"، أو \"مكونات الوجبة الكومبو\".")}
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '20px' }}>
            {groups.map((group) => (
              <ModifierGroupCard
                key={group.id}
                group={group}
                onEdit={handleOpenEdit}
                onDelete={handleDeleteGroup}
              />
            ))}
          </div>
        )}

        <ModifierGroupModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          editingGroup={editingGroup}
          formName={formName}
          setFormName={setFormName}
          formNameEn={formNameEn}
          setFormNameEn={setFormNameEn}
          formSelectionType={formSelectionType}
          setFormSelectionType={setFormSelectionType}
          formIsMandatory={formIsMandatory}
          setFormIsMandatory={setFormIsMandatory}
          formMinSelections={formMinSelections}
          setFormMinSelections={setFormMinSelections}
          formMaxSelections={formMaxSelections}
          setFormMaxSelections={setFormMaxSelections}
          formDisplayOrder={formDisplayOrder}
          setFormDisplayOrder={setFormDisplayOrder}
          formIsActive={formIsActive}
          setFormIsActive={setFormIsActive}
          formIsSplittableInHalf={formIsSplittableInHalf}
          setFormIsSplittableInHalf={setFormIsSplittableInHalf}
          formOptions={formOptions}
          onAddOptionRow={handleAddOptionRow}
          onRemoveOptionRow={handleRemoveOptionRow}
          onOptionChange={handleOptionChange}
          saving={saving}
          modalFeedback={modalFeedback}
          onSave={handleSaveGroup}
        />
      </div>
    </div>
  );
};
