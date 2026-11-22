import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import type { DeliveryRep } from '@/shared/api/delivery-reps.api';
import { DAY_KEY_TO_ARABIC } from '../VanItineraryTab';
import { WEEKDAYS } from './van-routes-kpi-consts';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { CheckIcon } from '@/shared/components/icons/AppIcons';

export interface RoutesKpiBulkModalProps {
  bulkModalOpen: boolean;
  setBulkModalOpen: Dispatch<SetStateAction<boolean>>;
  selectedCustomerIds: number[];
  bulkRepId: string;
  setBulkRepId: Dispatch<SetStateAction<string>>;
  bulkRepOptions: { value: string; label: string }[];
  bulkRouteInput: string;
  setBulkRouteInput: Dispatch<SetStateAction<string>>;
  bulkApplyDays: boolean;
  setBulkApplyDays: Dispatch<SetStateAction<boolean>>;
  bulkVisitDays: string[];
  handleToggleBulkDay: (dayId: string) => void;
  bulkAssignMutation: {
    isPending: boolean;
    mutate: (payload: {
      customerIds: number[];
      assignedRepId?: number | null;
      assignedRepName?: string;
      route?: string;
      visitDays?: string[];
    }) => void;
  };
  vanReps: DeliveryRep[];
}

export function RoutesKpiBulkModal({
  bulkModalOpen,
  setBulkModalOpen,
  selectedCustomerIds,
  bulkRepId,
  setBulkRepId,
  bulkRepOptions,
  bulkRouteInput,
  setBulkRouteInput,
  bulkApplyDays,
  setBulkApplyDays,
  bulkVisitDays,
  handleToggleBulkDay,
  bulkAssignMutation,
  vanReps,
}: RoutesKpiBulkModalProps) {
  const { t: __t } = useTranslation();
  return (
    <StandardDialog
      open={bulkModalOpen}
      onClose={() => setBulkModalOpen(false)}
      title={__t('delivery_reps.van_routes_kpi_admin_tab.s117', __t('delivery_reps.van_routes_kpi_admin_tab.s117', "تخصيص جماعي لخطوط السير والمناديب"))}
      subtitle={`تعديل موحد لـ (${selectedCustomerIds.length}) متجر تم تحديدهم`}
      maxWidth="540px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} dir="rtl">
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '10px 14px',
            fontSize: '12px',
            color: '#475569',
            lineHeight: 1.5,
          }}
        >
          {__t('delivery_reps.van_routes_kpi_admin_tab.s118', __t('delivery_reps.van_routes_kpi_admin_tab.s118', "سيتم تطبيق التعديلات المحددة أدناه على كافة المحلات المختارة ("))}{selectedCustomerIds.length} {__t('delivery_reps.van_routes_kpi_admin_tab.s119', __t('delivery_reps.van_routes_kpi_admin_tab.s119', "متجر) دفعة واحدة.\n              الحقول التي تترك دون تغيير ستحتفظ بقيمها الحالية في كل محل."))}
        </div>

        {/* Bulk Assigned Rep */}
        <div>
          <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {__t('delivery_reps.van_routes_kpi_admin_tab.s120', __t('delivery_reps.van_routes_kpi_admin_tab.s120', "تخصيص مندوب الفان المسؤول:"))}
          </label>
          <CustomSelect
            value={bulkRepId}
            onChange={(val) => setBulkRepId(val)}
            options={bulkRepOptions}
            placeholder={__t('delivery_reps.van_routes_kpi_admin_tab.s121', __t('delivery_reps.van_routes_kpi_admin_tab.s121', "اختر الإجراء للمندوب..."))}
          />
        </div>

        {/* Bulk Route Input */}
        <div>
          <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {__t('delivery_reps.van_routes_kpi_admin_tab.s122', __t('delivery_reps.van_routes_kpi_admin_tab.s122', "توحيد اسم خط السير (اختياري):"))}
          </label>
          <input
            type="text"
            placeholder={__t('delivery_reps.van_routes_kpi_admin_tab.s123', __t('delivery_reps.van_routes_kpi_admin_tab.s123', "اترك فارغاً للإبقاء على خط السير الحالي لكل متجر..."))}
            value={bulkRouteInput}
            onChange={(e) => setBulkRouteInput(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Bulk Weekly Visit Days Override */}
        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '8px' }}>
            <input
              type="checkbox"
              checked={bulkApplyDays}
              onChange={(e) => setBulkApplyDays(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#334155' }}>
              {__t('delivery_reps.van_routes_kpi_admin_tab.s124', __t('delivery_reps.van_routes_kpi_admin_tab.s124', "تطبيق أيام زيارة موحدة على المحلات المختارة"))}
            </span>
          </label>

          {bulkApplyDays && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginTop: '6px' }}>
              {WEEKDAYS.map((w) => {
                const isChecked = bulkVisitDays.includes(w.id);
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => handleToggleBulkDay(w.id)}
                    style={{
                      padding: '7px 4px',
                      borderRadius: '6px',
                      border: isChecked ? '1px solid #170e5e' : '1px solid #cbd5e1',
                      background: isChecked ? '#170e5e' : '#f8fafc',
                      color: isChecked ? '#ffffff' : '#334155',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px',
                    }}
                  >
                    {isChecked && <CheckIcon size={12} />}
                    {w.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
          <Button variant="secondary" onClick={() => setBulkModalOpen(false)}>
            {__t('delivery_reps.van_routes_kpi_admin_tab.s125', __t('delivery_reps.van_routes_kpi_admin_tab.s125', "إلغاء"))}
          </Button>
          <Button
            variant="primary"
            disabled={bulkAssignMutation.isPending}
            onClick={() => {
              let repId: number | null | undefined = undefined;
              let repName: string | undefined = undefined;

              if (bulkRepId === 'unassigned') {
                repId = null;
                repName = '';
              } else if (bulkRepId !== 'no_change') {
                const found = vanReps.find((r) => String(r.id) === bulkRepId);
                if (found) {
                  repId = found.id;
                  repName = found.name;
                }
              }

              bulkAssignMutation.mutate({
                customerIds: selectedCustomerIds,
                assignedRepId: repId,
                assignedRepName: repName,
                route: bulkRouteInput.trim() ? bulkRouteInput.trim() : undefined,
                visitDays: bulkApplyDays ? bulkVisitDays.map((d) => DAY_KEY_TO_ARABIC[d] || d) : undefined,
              });
            }}
            style={{ backgroundColor: '#170e5e', color: '#ffffff' }}
          >
            {bulkAssignMutation.isPending ? __t('delivery_reps.van_routes_kpi_admin_tab.s126', __t('delivery_reps.van_routes_kpi_admin_tab.s126', "جاري التنفيذ...")) : `تطبيق على (${selectedCustomerIds.length}) متجر`}
          </Button>
        </div>
      </div>
    </StandardDialog>
  );
}
