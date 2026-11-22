import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import type { SupervisorCustomerRouteItem } from '../../api/van-sales.api';
import type { DeliveryRep } from '@/shared/api/delivery-reps.api';
import { DAY_KEY_TO_ARABIC } from '../VanItineraryTab';
import { WEEKDAYS } from './van-routes-kpi-consts';
import { Button } from '@/shared/ui/button';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { CheckIcon } from '@/shared/components/icons/AppIcons';

export interface RoutesKpiEditModalProps {
  editingCustomer: SupervisorCustomerRouteItem;
  assignedRepId: string;
  assignedRepIds: number[];
  routeInput: string;
  setRouteInput: Dispatch<SetStateAction<string>>;
  sequenceInput: string;
  setSequenceInput: Dispatch<SetStateAction<string>>;
  selectedDays: string[];
  handleToggleDay: (dayId: string) => void;
  handleToggleRepAssignment: (repIdNum: number) => void;
  setEditingCustomer: Dispatch<SetStateAction<SupervisorCustomerRouteItem | null>>;
  scheduleMutation: {
    isPending: boolean;
    mutate: (payload: {
      customerId: number;
      route: string;
      routeSequence: number;
      visitDays: string[];
      assignedRepId?: number | null;
      assignedRepIds?: number[];
      assignedRepName?: string;
    }) => void;
  };
  vanReps: DeliveryRep[];
}

export function RoutesKpiEditModal({
  editingCustomer,
  assignedRepId,
  assignedRepIds,
  routeInput,
  setRouteInput,
  sequenceInput,
  setSequenceInput,
  selectedDays,
  handleToggleDay,
  handleToggleRepAssignment,
  setEditingCustomer,
  scheduleMutation,
  vanReps,
}: RoutesKpiEditModalProps) {
  const { t: __t } = useTranslation();
  return (
    <StandardDialog
      open={Boolean(editingCustomer)}
      onClose={() => setEditingCustomer(null)}
      title={`تخصيص خط ومناديب: ${editingCustomer.customerName}`}
      subtitle={`كود المحل: [${editingCustomer.customerCode ? editingCustomer.customerCode.replace(/^#/, '') : `C-${String(editingCustomer.customerId).padStart(4, '0')}`}]`}
      maxWidth="620px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }} dir="rtl">
        {/* Per-Rep Balance Breakdown Card for Supervisor */}
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '10px 14px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#334155' }}>
              {__t('delivery_reps.van_routes_kpi_admin_tab.s104', __t('delivery_reps.van_routes_kpi_admin_tab.s104', "إجمالي مديونية العميل للمنشأة:"))}
            </span>
            <span style={{ fontSize: '14px', fontWeight: 800, color: Number(editingCustomer.balance || 0) > 0 ? '#b91c1c' : '#15803d' }}>
              {Number(editingCustomer.balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <CurrencySymbol />
            </span>
          </div>
          {Array.isArray(editingCustomer.repBalances) && editingCustomer.repBalances.filter((rb) => rb.balance !== 0).length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '6px', marginTop: '6px' }}>
              {editingCustomer.repBalances
                .filter((rb) => rb.balance !== 0)
                .map((rb) => (
                  <div
                    key={`modal-bal-${rb.repId}`}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #fecdd3',
                      borderRadius: '7px',
                      padding: '6px 10px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '11.5px',
                    }}
                  >
                    <span style={{ fontWeight: 700, color: '#0f172a' }}>{rb.repName}</span>
                    <span style={{ fontWeight: 800, color: '#be123c' }}>
                      {Number(rb.balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <CurrencySymbol />
                    </span>
                  </div>
                ))}
            </div>
          ) : (
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              {__t('delivery_reps.van_routes_kpi_admin_tab.s105', __t('delivery_reps.van_routes_kpi_admin_tab.s105', "لا توجد مديونيات مجزأة حالياً على المناديب لهذا العميل."))}
            </div>
          )}
        </div>

        {/* Assigned Reps Multi-Selector */}
        <div>
          <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {__t('delivery_reps.van_routes_kpi_admin_tab.s106', __t('delivery_reps.van_routes_kpi_admin_tab.s106', "مناديب الفان المسؤولون عن المحل (يمكن اختيار مندوب أو أكثر مع عزل حساب كل مندوب):"))}
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(165px, 1fr))', gap: '6px' }}>
            {vanReps.map((r) => {
              const isSelectedRep = assignedRepIds.includes(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => handleToggleRepAssignment(r.id)}
                  style={{
                    padding: '7px 10px',
                    borderRadius: '7px',
                    border: isSelectedRep ? '1px solid #170e5e' : '1px solid #cbd5e1',
                    background: isSelectedRep ? '#170e5e' : '#ffffff',
                    color: isSelectedRep ? '#ffffff' : '#334155',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '6px',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                  {isSelectedRep && <CheckIcon size={13} />}
                </button>
              );
            })}
          </div>
          <small style={{ color: '#64748b', fontSize: '11px', marginTop: '4px', display: 'block' }}>
            {__t('delivery_reps.van_routes_kpi_admin_tab.s107', __t('delivery_reps.van_routes_kpi_admin_tab.s107', "حساب ومديونية وتحصيل كل مندوب مع المحل معزول تماماً عن المناديب الآخرين."))}
          </small>
        </div>

        {/* Route Name & Sequence in 2-Column Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
              {__t('delivery_reps.van_routes_kpi_admin_tab.s108', __t('delivery_reps.van_routes_kpi_admin_tab.s108', "اسم خط السير (Route Name)"))} <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input
              type="text"
              placeholder={__t('delivery_reps.van_routes_kpi_admin_tab.s109', __t('delivery_reps.van_routes_kpi_admin_tab.s109', "مثال: خط الهرم والجيزة، خط فيصل..."))}
              value={routeInput}
              onChange={(e) => setRouteInput(e.target.value)}
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

          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
              {__t('delivery_reps.van_routes_kpi_admin_tab.s110', __t('delivery_reps.van_routes_kpi_admin_tab.s110', "الترتيب التسلسلي بالخط"))}
            </label>
            <input
              type="number"
              min="1"
              value={sequenceInput}
              onChange={(e) => setSequenceInput(e.target.value)}
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
        </div>

        {/* Weekly Visit Days */}
        <div>
          <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {__t('delivery_reps.van_routes_kpi_admin_tab.s111', __t('delivery_reps.van_routes_kpi_admin_tab.s111', "أيام الزيارة الأسبوعية المحددة:"))}
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
            {WEEKDAYS.map((w) => {
              const isChecked = selectedDays.includes(w.id);
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => handleToggleDay(w.id)}
                  style={{
                    padding: '7px 4px',
                    borderRadius: '6px',
                    border: isChecked ? '1px solid #170e5e' : '1px solid #cbd5e1',
                    background: isChecked ? '#170e5e' : '#f8fafc',
                    color: isChecked ? '#ffffff' : '#334155',
                    fontSize: '12px',
                    fontWeight: 600,
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
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
          <Button variant="secondary" onClick={() => setEditingCustomer(null)}>
            {__t('delivery_reps.van_routes_kpi_admin_tab.s112', __t('delivery_reps.van_routes_kpi_admin_tab.s112', "إلغاء"))}
          </Button>
          <Button
            variant="primary"
            disabled={scheduleMutation.isPending}
            onClick={() => {
              const primaryRepId = assignedRepIds.length > 0 ? assignedRepIds[0] : (assignedRepId ? parseInt(assignedRepId, 10) : null);
              const repNames = assignedRepIds
                .map((id) => vanReps.find((r) => r.id === id)?.name)
                .filter(Boolean)
                .join(__t('delivery_reps.van_routes_kpi_admin_tab.s113', __t('delivery_reps.van_routes_kpi_admin_tab.s113', " ، ")));

              scheduleMutation.mutate({
                customerId: editingCustomer.customerId,
                route: routeInput.trim() || __t('delivery_reps.van_routes_kpi_admin_tab.s114', __t('delivery_reps.van_routes_kpi_admin_tab.s114', "غير محدد")),
                routeSequence: parseInt(sequenceInput, 10) || 1,
                visitDays: selectedDays.map((d) => DAY_KEY_TO_ARABIC[d] || d),
                assignedRepId: primaryRepId,
                assignedRepIds,
                assignedRepName: repNames || undefined,
              });
            }}
            style={{ backgroundColor: '#170e5e', color: '#ffffff' }}
          >
            {scheduleMutation.isPending ? __t('delivery_reps.van_routes_kpi_admin_tab.s115', __t('delivery_reps.van_routes_kpi_admin_tab.s115', "جاري الحفظ...")) : __t('delivery_reps.van_routes_kpi_admin_tab.s116', __t('delivery_reps.van_routes_kpi_admin_tab.s116', "حفظ التخصيص"))}
          </Button>
        </div>
      </div>
    </StandardDialog>
  );
}
