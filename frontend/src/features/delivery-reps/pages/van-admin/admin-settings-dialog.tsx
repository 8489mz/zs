import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { Button } from '@/shared/ui/button';
import { settingsApi } from '@/features/settings';
import { toast } from '@/shared/components/system-alert';

export interface AdminSettingsDialogProps {
  blindSettlementDraft: boolean;
  discountCapDraft: number;
  isSavingSettings: boolean;
  isSettingsModalOpen: boolean;
  requireSupervisorPinDraft: boolean;
  setBlindSettlementDraft: Dispatch<SetStateAction<boolean>>;
  setDiscountCapDraft: Dispatch<SetStateAction<number>>;
  setIsSavingSettings: Dispatch<SetStateAction<boolean>>;
  setIsSettingsModalOpen: Dispatch<SetStateAction<boolean>>;
  setRequireSupervisorPinDraft: Dispatch<SetStateAction<boolean>>;
}

export function AdminSettingsDialog({
  blindSettlementDraft,
  discountCapDraft,
  isSavingSettings,
  isSettingsModalOpen,
  requireSupervisorPinDraft,
  setBlindSettlementDraft,
  setDiscountCapDraft,
  setIsSavingSettings,
  setIsSettingsModalOpen,
  setRequireSupervisorPinDraft,
}: AdminSettingsDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return (
    <StandardDialog
      open={isSettingsModalOpen}
      onClose={() => setIsSettingsModalOpen(false)}
      title={t('delivery_reps.van_sales_admin_management_page.s49', "إعدادات الرقابة وتصفية رحلات الفان")}
      subtitle={t('delivery_reps.van_sales_admin_management_page.s50', "التحكم في اشتراط رمز المشرف (PIN) لتصفية ورديات المناديب والرمز السري المعتمد")}
      width="540px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '4px 0' }} dir="rtl">
        {/* Setting 1: Require Supervisor PIN Toggle */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            padding: '12px 14px',
            borderRadius: '10px',
            border: '1px solid #e2e8f0',
            backgroundColor: '#f8fafc',
            gap: '12px',
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a', marginBottom: '3px' }}>
              {t('delivery_reps.van_sales_admin_management_page.s51', "إلزامية رمز المشرف (PIN) لتصفية الوردية")}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', lineHeight: 1.5 }}>
              {requireSupervisorPinDraft
                ? t('delivery_reps.van_sales_admin_management_page.s52', "مفعل: يلزم إدخال رمز المشرف (PIN) على هاتف المندوب لإبراء ذمته واستلام الكاش.")
                : t('delivery_reps.van_sales_admin_management_page.s53', "معطل: يقفل المندوب ورديته مباشرة وتتم مراجعة واستلام النقدية من لوحة الإدارة.")}
            </div>
          </div>
          <input
            type="checkbox"
            checked={requireSupervisorPinDraft}
            onChange={(e) => setRequireSupervisorPinDraft(e.target.checked)}
            style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: '#170e5e', marginTop: '2px' }}
          />
        </div>

        {/* Setting 1.5: Blind Settlement Mode */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 14px',
            borderRadius: '10px',
            border: '1px solid #e2e8f0',
            backgroundColor: '#f8fafc',
            gap: '12px',
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a', marginBottom: '3px' }}>
              {t('delivery_reps.van_sales_admin_management_page.s54', "إلزام التوريد والجرد العمياني (Blind Cash Settlement)")}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', lineHeight: 1.5 }}>
              {blindSettlementDraft
                ? t('delivery_reps.van_sales_admin_management_page.s55', "مفعل: إخفاء صافي النقدية المتوقعة وزر المطابقة؛ يُلزم المندوب بعدّ الكاش الفعلي واحتساب الفروقات رقابياً بالخزينة.")
                : t('delivery_reps.van_sales_admin_management_page.s56', "معطل: يظهر صافي النقدية المتوقعة وزر المطابقة أمام المندوب بشفافية لتسريع التصفية.")}
            </div>
          </div>
          <input
            type="checkbox"
            checked={blindSettlementDraft}
            onChange={(e) => setBlindSettlementDraft(e.target.checked)}
            style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: '#170e5e', marginTop: '2px' }}
          />
        </div>

        {/* Setting 1.6: Rep Discount Cap (INV-VAN-REP-DISCOUNT-CAP-TENANT-SETTING) */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 14px',
            borderRadius: '10px',
            border: '1px solid #e2e8f0',
            backgroundColor: '#f8fafc',
            gap: '12px',
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a', marginBottom: '3px' }}>
              {t('delivery_reps.van_sales_admin_management_page.s65', "سقف خصم المندوب %")}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', lineHeight: 1.5 }}>
              {t('delivery_reps.van_sales_admin_management_page.s66', "الحد الأقصى للخصم الإجمالي (سطور + فاتورة) الذي يمنحه أي مندوب بدون رمز المشرف. الافتراضي 5%. صفر يعني منع الخصم تماماً.")}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            <input
              type="number"
              min={0}
              max={100}
              value={discountCapDraft}
              onChange={(e) => setDiscountCapDraft(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
              style={{ width: '56px', height: '28px', padding: '1px 6px', fontSize: '13px', fontWeight: 800, textAlign: 'center', border: '1px solid #cbd5e1', borderRadius: '6px' }}
            />
            <span style={{ fontSize: '13px', fontWeight: 800, color: '#170e5e' }}>%</span>
          </div>
        </div>

        {/* Manager Approval PIN: single place is Settings > Security.
            This modal no longer edits it; it only points there. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            padding: '12px 14px',
            borderRadius: '10px',
            border: '1px solid #e2e8f0',
            backgroundColor: '#ffffff',
          }}
        >
          <label style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>
            {t('delivery_reps.van_sales_admin_management_page.s57', "رمز اعتماد المدير (Manager Approval PIN):")}
          </label>
          <div style={{ fontSize: '10.5px', color: '#64748b' }}>
            {t('delivery_reps.van_sales_admin_management_page.s58', "يستخدم لاعتماد التصفية الميدانية أو تجاوز سقف الائتمان الاستثنائي، ويتم ضبطه من مكان واحد فقط: الإعدادات > الأمان والنسخ الاحتياطي > رمز اعتماد المدير.")}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
          <Button
            variant="secondary"
            onClick={() => setIsSettingsModalOpen(false)}
            disabled={isSavingSettings}
          >
            {t('delivery_reps.van_sales_admin_management_page.s60', "إلغاء")}
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              setIsSavingSettings(true);
              try {
                await settingsApi.update({
                  vanSettlementRequireSupervisorPin: requireSupervisorPinDraft,
                  vanSettlementBlindMode: blindSettlementDraft,
                  vanRepDiscountCapPercent: discountCapDraft,
                });
                await queryClient.invalidateQueries({ queryKey: ['van-settlement-settings'] });
                await queryClient.invalidateQueries({ queryKey: ['van-sales-active-trip'] });
                toast.success(t('delivery_reps.van_sales_admin_management_page.s61', "تم حفظ إعدادات تصفية الفان والرقابة بنجاح"));
                setIsSettingsModalOpen(false);
              } catch (err: any) {
                toast.error(err?.message || t('delivery_reps.van_sales_admin_management_page.s62', "حدث خطأ أثناء حفظ الإعدادات"));
              } finally {
                setIsSavingSettings(false);
              }
            }}
            disabled={isSavingSettings}
            style={{ backgroundColor: '#170e5e', color: '#ffffff', fontWeight: 800 }}
          >
            {isSavingSettings ? t('delivery_reps.van_sales_admin_management_page.s63', "جاري الحفظ...") : t('delivery_reps.van_sales_admin_management_page.s64', "حفظ الإعدادات")}
          </Button>
        </div>
      </div>
    </StandardDialog>
  );
}
