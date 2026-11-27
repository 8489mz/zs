import { Button } from '@/shared/ui/button';
import { AddShipmentItemDialog } from '../AddShipmentItemDialog';
import { ContainerAutopsyModal } from '../ContainerAutopsyModal';
import { ContainerPreordersModal } from '../ContainerPreordersModal';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { formatCurrency } from '@/lib/format';
import {
  receivingInspectionErrorMessage,
  lateExpenseAllocationSummary,
  type ShipmentDetails,
} from '../api/shipments.api';
import { toast } from '@/shared/components/system-alert';
import type { Location } from '@/types/domain';

export interface ShipmentDetailsModalsProps {
  isAutopsyOpen: boolean;
  setIsAutopsyOpen: React.Dispatch<React.SetStateAction<boolean>>;
  id: string;
  isPreordersOpen: boolean;
  setIsPreordersOpen: React.Dispatch<React.SetStateAction<boolean>>;
  data: ShipmentDetails;
  isAddItemOpen: boolean;
  setIsAddItemOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isGrnOpen: boolean;
  setIsGrnOpen: React.Dispatch<React.SetStateAction<boolean>>;
  createGrnMutation: { isPending: boolean; mutate: (payload: { shipmentId: string; projectId?: string; warehouseLocationId?: number; inspectorName?: string; overallStatus: 'approved'; notes?: string; items: Array<{ shipmentItemId: string; productId: string; expectedQty: number; receivedQty: number; acceptedQty: number; damagedQty: number; shortageQty: number }> }, options?: { onSuccess?: () => void; onError?: (err: any) => void }) => void };
  grnDamagedMap: Record<string, number>;
  grnLocationId: string;
  grnInspectorName: string;
  grnNotes: string;
  setGrnInspectorName: React.Dispatch<React.SetStateAction<string>>;
  setGrnLocationId: React.Dispatch<React.SetStateAction<string>>;
  setGrnNotes: React.Dispatch<React.SetStateAction<string>>;
  setGrnDamagedMap: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  warehouseLocations: Location[];
  isLateExpenseOpen: boolean;
  setIsLateExpenseOpen: React.Dispatch<React.SetStateAction<boolean>>;
  recordLateExpenseMutation: { isPending: boolean; mutate: (payload: { shipmentId: string; dto: { expenseType: string; amountEgp: number; description?: string; supplierId?: number; unallocableReason?: string } }, options?: { onSuccess?: (res: any) => void; onError?: (err: any) => void }) => void };
  lateAmountEgp: string;
  lateExpenseType: string;
  lateDescription: string;
  lateExpenseSupplier: string;
  lateExpenseUnallocableReason: string;
  setLateAmountEgp: React.Dispatch<React.SetStateAction<string>>;
  setLateDescription: React.Dispatch<React.SetStateAction<string>>;
  setLateExpenseSupplier: React.Dispatch<React.SetStateAction<string>>;
  setLateExpenseUnallocableReason: React.Dispatch<React.SetStateAction<string>>;
  setLateExpenseType: React.Dispatch<React.SetStateAction<string>>;
  suppliersList: any[];
}

export function ShipmentDetailsModals({
  isAutopsyOpen,
  setIsAutopsyOpen,
  id,
  isPreordersOpen,
  setIsPreordersOpen,
  data,
  isAddItemOpen,
  setIsAddItemOpen,
  isGrnOpen,
  setIsGrnOpen,
  createGrnMutation,
  grnDamagedMap,
  grnLocationId,
  grnInspectorName,
  grnNotes,
  setGrnInspectorName,
  setGrnLocationId,
  setGrnNotes,
  setGrnDamagedMap,
  warehouseLocations,
  isLateExpenseOpen,
  setIsLateExpenseOpen,
  recordLateExpenseMutation,
  lateAmountEgp,
  lateExpenseType,
  lateDescription,
  lateExpenseSupplier,
  lateExpenseUnallocableReason,
  setLateAmountEgp,
  setLateDescription,
  setLateExpenseSupplier,
  setLateExpenseUnallocableReason,
  setLateExpenseType,
  suppliersList,
}: ShipmentDetailsModalsProps) {
  return (
    <>
    {isAutopsyOpen && (
      <ContainerAutopsyModal isOpen={isAutopsyOpen} onClose={() => setIsAutopsyOpen(false)} shipmentId={id!} />
    )}
    {isPreordersOpen && (
      <ContainerPreordersModal isOpen={isPreordersOpen} onClose={() => setIsPreordersOpen(false)} shipment={data} />
    )}
    {isAddItemOpen && (
      <AddShipmentItemDialog
        open={isAddItemOpen}
        onClose={() => setIsAddItemOpen(false)}
        shipmentId={id!}
      />
    )}

    {isGrnOpen && (
      <StandardDialog
        isOpen={isGrnOpen}
        onClose={() => setIsGrnOpen(false)}
        title="محضر فحص واستلام مخزني (GRN / Receiving Inspection)"
        subtitle={`فحص كميات وجودة أصناف الحاوية ${data.container_number} وإثبات التوالف والنواقص`}
        width="min(880px, 95vw)"
        compact
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsGrnOpen(false)}>إلغاء</Button>
            <Button
              variant="primary"
              disabled={createGrnMutation.isPending}
              onClick={() => {
                const itemsPayload = data.items.map((item: any) => {
                  const expectedQty = Number(item.quantity || 0);
                  const receivedQty = Number(item.received_quantity || item.quantity || 0);
                  const damagedQty = Number(grnDamagedMap[item.id] || 0);
                  const acceptedQty = Math.max(0, receivedQty - damagedQty);
                  return {
                    shipmentItemId: item.id,
                    productId: item.product_id,
                    expectedQty,
                    receivedQty,
                    acceptedQty,
                    damagedQty,
                    shortageQty: Math.max(0, expectedQty - receivedQty),
                  };
                });
                createGrnMutation.mutate(
                  {
                    shipmentId: id!,
                    projectId: (data as any).project_id || undefined,
                    warehouseLocationId: grnLocationId ? Number(grnLocationId) : undefined,
                    inspectorName: grnInspectorName || undefined,
                    overallStatus: 'approved',
                    notes: grnNotes || undefined,
                    items: itemsPayload,
                  },
                  {
                    onSuccess: () => {
                      toast.success('تم اعتماد محضر الفحص والاستلام بنجاح');
                      setIsGrnOpen(false);
                    },
                    onError: (err: any) => toast.error(receivingInspectionErrorMessage(err)),
                  },
                );
              }}
            >
              {createGrnMutation.isPending ? 'جاري الاعتماد...' : 'اعتماد محضر الفحص والاستلام'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, marginBottom: '4px' }}>اسم مسؤول الفحص / أمين المخزن</label>
              <input className="input" style={{ width: '100%' }} value={grnInspectorName} onChange={e => setGrnInspectorName(e.target.value)} placeholder="مثال: م. أحمد محمود" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, marginBottom: '4px' }}>مخزن الاستلام</label>
              <select className="input" style={{ width: '100%' }} value={grnLocationId} onChange={e => setGrnLocationId(e.target.value)}>
                <option value="">-- اختر المخزن --</option>
                {warehouseLocations.map((loc: any) => (
                  <option key={loc.id} value={loc.id}>{loc.name || loc.nameAr || `مخزن ${loc.id}`}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, marginBottom: '4px' }}>ملاحظات عامة على حالة الحاوية والأختام</label>
              <input className="input" style={{ width: '100%' }} value={grnNotes} onChange={e => setGrnNotes(e.target.value)} placeholder="حالة الرصاص الجمركي والتغليف..." />
            </div>
          </div>

          <div style={{ maxHeight: '260px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
            <table className="table" style={{ width: '100%', textAlign: 'right', fontSize: '12.5px', borderCollapse: 'collapse' }}>
              <thead style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
                <tr>
                  <th style={{ padding: '8px 10px' }}>الصنف</th>
                  <th style={{ padding: '8px 10px' }}>كمية البوليصة</th>
                  <th style={{ padding: '8px 10px' }}>المستلم الفعلي</th>
                  <th style={{ padding: '8px 10px' }}>العجز (Shortage)</th>
                  <th style={{ padding: '8px 10px' }}>التالف (Damaged)</th>
                  <th style={{ padding: '8px 10px' }}>الصالح المقبول</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item: any) => {
                  const expected = Number(item.quantity || 0);
                  const received = Number(item.received_quantity || item.quantity || 0);
                  const shortage = Math.max(0, expected - received);
                  const damaged = Number(grnDamagedMap[item.id] || 0);
                  const accepted = Math.max(0, received - damaged);
                  return (
                    <tr key={item.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '8px 10px', fontWeight: 700 }}>{item.product_name || item.product_id}</td>
                      <td style={{ padding: '8px 10px' }}>{expected}</td>
                      <td style={{ padding: '8px 10px', fontWeight: 700, color: '#0369a1' }}>{received}</td>
                      <td style={{ padding: '8px 10px', color: shortage > 0 ? '#dc2626' : '#64748b', fontWeight: 700 }}>{shortage}</td>
                      <td style={{ padding: '8px 10px' }}>
                        <input
                          type="number"
                          min={0}
                          max={received}
                          className="input"
                          style={{ width: '80px', height: '30px', padding: '0 6px' }}
                          value={grnDamagedMap[item.id] ?? 0}
                          onChange={e => setGrnDamagedMap(prev => ({ ...prev, [item.id]: Math.max(0, Number(e.target.value) || 0) }))}
                        />
                      </td>
                      <td style={{ padding: '8px 10px', fontWeight: 800, color: '#15803d' }}>{accepted}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </StandardDialog>
    )}

    {isLateExpenseOpen && (
      <StandardDialog
        isOpen={isLateExpenseOpen}
        onClose={() => setIsLateExpenseOpen(false)}
        title="تسجيل مصروف متأخر بعد الوصول (Post-Arrival Late Expense)"
        subtitle="توزيع ذكي للمصروفات المتأخرة بين الرصيد المتبقي بالمخزن (Lot WAC) والبضاعة المباعة (COGS)"
        width="min(620px, 95vw)"
        compact
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsLateExpenseOpen(false)}>إلغاء</Button>
            <Button
              variant="primary"
              disabled={recordLateExpenseMutation.isPending}
              onClick={() => {
                const amt = Number(lateAmountEgp);
                if (!amt || amt <= 0) {
                  toast.error('يرجى إدخال قيمة المصروف بالجنيه');
                  return;
                }
                recordLateExpenseMutation.mutate(
                  {
                    shipmentId: id!,
                    dto: {
                      expenseType: lateExpenseType,
                      amountEgp: amt,
                      description: lateDescription || undefined,
                      supplierId: lateExpenseSupplier ? Number(lateExpenseSupplier) : undefined,
                      unallocableReason: lateExpenseUnallocableReason || undefined,
                    },
                  },
                  {
                    onSuccess: (res: any) => {
                      const summary = lateExpenseAllocationSummary(res);
                      toast.success(`تم تسجيل المصروف المتأخر بنجاح (مُرسمل للمخزون: ${formatCurrency(summary.capitalizedToInventoryEgp)} | محمل على COGS: ${formatCurrency(summary.expensedToCogsEgp)})`);
                      setIsLateExpenseOpen(false);
                      setLateAmountEgp('');
                      setLateDescription('');
                      setLateExpenseSupplier('');
                      setLateExpenseUnallocableReason('');
                    },
                    onError: (err: any) => toast.error(err?.message || 'تعذر تسجيل المصروف المتأخر'),
                  },
                );
              }}
            >
              {recordLateExpenseMutation.isPending ? 'جاري الترحيل...' : 'تسجيل وترحيل القيد المحاسبي'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, marginBottom: '4px' }}>نوع المصروف المتأخر</label>
            <select className="input" style={{ width: '100%' }} value={lateExpenseType} onChange={e => setLateExpenseType(e.target.value)}>
              <option value="demurrage">غرامات تأخير وأرضيات (Demurrage)</option>
              <option value="customs_diff">فروق تسوية جمركية لاحقة</option>
              <option value="transport">نقل ومشال إضافي</option>
              <option value="other">مصروفات استيراد أخرى</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, marginBottom: '4px' }}>المبلغ (ج.م) *</label>
            <input type="number" step="0.01" className="input" style={{ width: '100%' }} value={lateAmountEgp} onChange={e => setLateAmountEgp(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, marginBottom: '4px' }}>المورد المستحق (مورد المصروف) *</label>
            <select className="input" style={{ width: '100%' }} value={lateExpenseSupplier} onChange={e => setLateExpenseSupplier(e.target.value)}>
              <option value="">-- اختر المورد المستحق --</option>
              {suppliersList.map((s: any) => <option key={s.id} value={s.id}>{s.name || s.nameAr || s.name_ar || `#${s.id}`}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, marginBottom: '4px' }}>سبب عدم قابلية التخصيص (بديل المورد — يقيد على حساب التسوية)</label>
            <input className="input" style={{ width: '100%' }} value={lateExpenseUnallocableReason} onChange={e => setLateExpenseUnallocableReason(e.target.value)} placeholder="يترك فارغاً إذا تم اختيار المورد" />
          </div>
          <div style={{ gridColumn: '1 / -1', fontSize: '12.5px', color: '#475569' }}>
            يوزع المصروف دائما تناسبيا بين البضاعة المباعة (COGS) والمتبقي بالمخزون، حسب الكميات المباعة والمتبقية وقت التسجيل. يسجل القيد استحقاقا على المورد المحدد أعلاه، أو على حساب التسوية إذا سجل سبب عدم قابلية التخصيص — ولا ينسب أبدا لمورد البضاعة تلقائيا.
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, marginBottom: '4px' }}>البيان والتفاصيل</label>
            <input className="input" style={{ width: '100%' }} value={lateDescription} onChange={e => setLateDescription(e.target.value)} placeholder="رقم الإيصال أو سبب المصروف المتأخر..." />
          </div>
        </div>
      </StandardDialog>
    )}
    </>
  );
}
