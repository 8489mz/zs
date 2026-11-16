import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RestaurantOperationsDialog } from './RestaurantOperationsDialog';
import { toast } from '@/shared/components/system-alert';
import { CustomSelect } from '@/shared/ui/custom-select';
import { BanIcon, SearchIcon, CheckCircleIcon } from '@/shared/components/icons/AppIcons';
import { restaurantAdvancedFnbApi, Restaurant86Item } from '@/features/pos/api/restaurant-advanced-fnb.api';
import type { Product } from '@/types/domain';

interface Pos86ItemsModalProps {
  open: boolean;
  onClose: () => void;
  products: Product[];
  branchId?: number | null;
  onBack?: () => void;
}

export function Pos86ItemsModal({
  open,
  onClose,
  products = [],
  branchId,
  onBack,
}: Pos86ItemsModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedReason, setSelectedReason] = useState('نفاد الكمية بالمطبخ');
  const [autoHours, setAutoHours] = useState<number>(0);

  const { data: items86 = [] } = useQuery({
    queryKey: ['pos-86-items', branchId],
    queryFn: () => restaurantAdvancedFnbApi.get86Items(branchId || undefined),
    enabled: open,
    refetchInterval: 10_000,
  });

  const items86Map = new Map<number, Restaurant86Item>();
  for (const item of items86) {
    if (item.is_86ed) {
      items86Map.set(Number(item.product_id), item);
    }
  }

  const toggleMutation = useMutation({
    mutationFn: (dto: {
      productId: number;
      productName: string;
      is86ed: boolean;
      reason?: string;
      autoRestoreHours?: number;
    }) => restaurantAdvancedFnbApi.toggle86Item(dto),
    onSuccess: (res) => {
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ['pos-86-items'] });
    },
    onError: () => {
      toast.error('تعذر تحديث حالة استبعاد الصنف');
    },
  });

  const handleToggle = (product: Product, currently86ed: boolean) => {
    toggleMutation.mutate({
      productId: Number(product.id),
      productName: product.name,
      is86ed: !currently86ed,
      reason: !currently86ed ? selectedReason : undefined,
      autoRestoreHours: !currently86ed ? autoHours : 0,
    });
  };

  const filteredProducts = products.filter((p) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      p.name?.toLowerCase().includes(term) ||
      p.sku?.toLowerCase().includes(term) ||
      p.barcode?.toLowerCase().includes(term)
    );
  });

  const active86Count = items86Map.size;

  return (
    <RestaurantOperationsDialog
      open={open}
      onClose={onClose}
      onBack={onBack}
      backText={t('pos.pos_workspace.pos86_items_modal.s0', "الرجوع لعمليات المطعم")}
      title={t('pos.pos_workspace.pos86_items_modal.s1', "إدارة الأصناف المستبعدة والنافذة بالمطبخ (86'd Items Engine)")}
      subtitle={t('pos.pos_workspace.pos86_items_modal.s2', "استبعاد وإيقاف بيع الأصناف والمكونات النافذة لحظياً عبر الكاشير، المطبخ KDS، وباركود الطاولات")}
      badge={
        active86Count > 0 ? (
          <span
            style={{
              background: '#ef4444',
              color: '#ffffff',
              fontSize: '10px',
              fontWeight: 800,
              padding: '1px 7px',
              borderRadius: '999px',
            }}
          >
            86: {active86Count} {t('pos.pos_workspace.pos86_items_modal.s3', "أصناف نافذة")}
          </span>
        ) : undefined
      }
      footerNote={t('pos.pos_workspace.pos86_items_modal.s4', "ملاحظة: الأصناف الموسومة بـ 86 تُحجب فورياً في الكاشير وطلبات الطاولات وتذاكر المطبخ.")}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* KPI Strip & Fast Configuration */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '10px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '12px 14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '8px',
                background: '#fee2e2',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#dc2626',
              }}
            >
              <BanIcon size={20} />
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>{t('pos.pos_workspace.pos86_items_modal.s5', "الأصناف المستبعدة حالياً (86)")}</div>
              <div style={{ fontSize: '18px', fontWeight: 900, color: '#991b1b' }}>{active86Count} {t('pos.pos_workspace.pos86_items_modal.s6', "أصناف")}</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', color: '#475569', fontWeight: 700 }}>{t('pos.pos_workspace.pos86_items_modal.s7', "سبب الاستبعاد الافتراضي:")}</label>
            <CustomSelect
              value={selectedReason}
              onChange={(val) => setSelectedReason(val)}
              searchable={false}
              style={{ width: '100%' }}
              options={[
                { value: t('pos.pos_workspace.pos86_items_modal.s8', 'نفاد الكمية بالمطبخ'), label: t('pos.pos_workspace.pos86_items_modal.s9', 'نفاد الكمية بالمطبخ') },
                { value: t('pos.pos_workspace.pos86_items_modal.s10', 'تلف المواد الخام'), label: t('pos.pos_workspace.pos86_items_modal.s11', 'تلف المواد الخام') },
                { value: t('pos.pos_workspace.pos86_items_modal.s12', 'عطل بمعدة الطهي'), label: t('pos.pos_workspace.pos86_items_modal.s13', 'عطل بمعدة الطهي') },
                { value: t('pos.pos_workspace.pos86_items_modal.s14', 'توقف مؤقت للتجهيز'), label: t('pos.pos_workspace.pos86_items_modal.s15', 'توقف مؤقت للتجهيز') },
              ]}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', color: '#475569', fontWeight: 700 }}>{t('pos.pos_workspace.pos86_items_modal.s16', "إعادة الإتاحة التلقائية:")}</label>
            <CustomSelect
              value={String(autoHours)}
              onChange={(val) => setAutoHours(Number(val))}
              searchable={false}
              dropdownAlign="left"
              style={{ width: '100%' }}
              options={[
                { value: '0', label: t('pos.pos_workspace.pos86_items_modal.s17', 'يدوي (حتى إعادة التفعيل الصريحة)') },
                { value: '8', label: t('pos.pos_workspace.pos86_items_modal.s18', 'بعد 8 ساعات (نهاية الوردية)') },
                { value: '12', label: t('pos.pos_workspace.pos86_items_modal.s19', 'بعد 12 ساعة') },
                { value: '24', label: t('pos.pos_workspace.pos86_items_modal.s20', 'بعد 24 ساعة (صباح اليوم التالي)') },
              ]}
            />
          </div>
        </div>

        {/* Search Bar */}
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>
            <SearchIcon size={16} />
          </span>
          <input
            type="text"
            placeholder={t('pos.pos_workspace.pos86_items_modal.s21', "بحث بالصنف، الباركود، أو التصنيف لوضع وسم 86 أو إلغائه...")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 36px 8px 12px',
              fontSize: '13px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Products Grid / List */}
        <div
          style={{
            maxHeight: '360px',
            overflowY: 'auto',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '8px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '8px',
            background: '#ffffff',
          }}
        >
          {filteredProducts.slice(0, 80).map((prod) => {
            const is86ed = items86Map.has(Number(prod.id));
            const itemMeta = items86Map.get(Number(prod.id));

            return (
              <div
                key={prod.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: is86ed ? '1.5px solid #ef4444' : '1px solid #e2e8f0',
                  background: is86ed ? '#fef2f2' : '#ffffff',
                  transition: 'background 0.15s ease',
                }}
              >
                <div style={{ flex: 1, minWidth: 0, paddingLeft: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: 700,
                        color: is86ed ? '#991b1b' : '#0f172a',
                        textDecoration: is86ed ? 'line-through' : 'none',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={prod.name}
                    >
                      {prod.name}
                    </span>
                    {is86ed && (
                      <span
                        style={{
                          background: '#dc2626',
                          color: '#fff',
                          fontSize: '10px',
                          fontWeight: 900,
                          padding: '1px 5px',
                          borderRadius: '4px',
                          letterSpacing: '0.5px',
                        }}
                      >
                        86'd
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                    {is86ed && itemMeta?.reason ? (
                      <span style={{ color: '#b91c1c', fontWeight: 600 }}>{t('pos.pos_workspace.pos86_items_modal.s22', "السبب:")} {itemMeta.reason}</span>
                    ) : (
                      <span>{t('pos.pos_workspace.pos86_items_modal.s23', "السعر:")} {(prod as any).price ?? (prod as any).salePrice ?? 0}</span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleToggle(prod, is86ed)}
                  disabled={toggleMutation.isPending}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    border: 'none',
                    background: is86ed ? '#16a34a' : '#dc2626',
                    color: '#ffffff',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    whiteSpace: 'nowrap',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                  }}
                >
                  {is86ed ? (
                    <>
                      <CheckCircleIcon size={14} />
                      <span>{t('pos.pos_workspace.pos86_items_modal.s24', "إتاحة الصنف")}</span>
                    </>
                  ) : (
                    <>
                      <BanIcon size={14} />
                      <span>{t('pos.pos_workspace.pos86_items_modal.s25', "استبعاد (86)")}</span>
                    </>
                  )}
                </button>
              </div>
            );
          })}
          {filteredProducts.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '30px', color: '#94a3b8' }}>
              {t('pos.pos_workspace.pos86_items_modal.s26', "لا توجد أصناف مطابقة لكلمة البحث")}
            </div>
          )}
        </div>
      </div>
    </RestaurantOperationsDialog>
  );
}
