import { StandardDialog } from '@/shared/components/StandardDialog';
import { toast } from '@/shared/components/system-alert';

export interface ChinaSourcingTripModalProps {
  isTripModalOpen: boolean;
  setIsTripModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  createTripMutation: { isPending: boolean; mutateAsync: (dto: any) => Promise<any> };
  tripTitle: string;
  tripDestination: string;
  tripStartDate: string;
  tripEndDate: string;
  tripBudgetEgp: number;
  tripObjectives: string;
  setTripTitle: React.Dispatch<React.SetStateAction<string>>;
  refetchTrips: () => void;
  setTripDestination: React.Dispatch<React.SetStateAction<string>>;
  setTripBudgetEgp: React.Dispatch<React.SetStateAction<number>>;
  setTripStartDate: React.Dispatch<React.SetStateAction<string>>;
  setTripEndDate: React.Dispatch<React.SetStateAction<string>>;
  setTripObjectives: React.Dispatch<React.SetStateAction<string>>;
}

export function ChinaSourcingTripModal({ isTripModalOpen, setIsTripModalOpen, createTripMutation, tripTitle, tripDestination, tripStartDate, tripEndDate, tripBudgetEgp, tripObjectives, setTripTitle, refetchTrips, setTripDestination, setTripBudgetEgp, setTripStartDate, setTripEndDate, setTripObjectives }: ChinaSourcingTripModalProps) {
  return (
    <>
    {/* Sourcing Trip Modal */}
    <StandardDialog
      open={isTripModalOpen}
      onClose={() => setIsTripModalOpen(false)}
      title="تسجيل رحلة عمل وزيارة مصانع بالصين"
      subtitle="توثيق زيارات معارض الصين (كانتون فير / إيوو) وحساب ميزانية السفر والمصروفات"
      width="600px"
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await createTripMutation.mutateAsync({
              title: tripTitle,
              destination: tripDestination,
              startDate: tripStartDate,
              endDate: tripEndDate || undefined,
              budgetEgp: Number(tripBudgetEgp),
              objectives: tripObjectives,
            });
            toast.success('تم تسجيل رحلة المصانع بنجاح');
            setIsTripModalOpen(false);
            setTripTitle('');
            refetchTrips();
          } catch (err: any) {
            toast.error('فشل حفظ الرحلة: ' + (err.message || 'خطأ غير معروف'));
          }
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <div>
          <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
            عنوان الرحلة أو المعرض
          </label>
          <input
            type="text"
            required
            value={tripTitle}
            onChange={(e) => setTripTitle(e.target.value)}
            placeholder="مثال: زيارة معرض كانتون فير دورة الخريف 2026 - قوانغتشو"
            style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
              المدينة / الوجهة
            </label>
            <input
              type="text"
              required
              value={tripDestination}
              onChange={(e) => setTripDestination(e.target.value)}
              style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
              الميزانية المقدرة (ج.م)
            </label>
            <input
              type="number"
              value={tripBudgetEgp}
              onChange={(e) => setTripBudgetEgp(Number(e.target.value))}
              style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
              تاريخ السفر والبدء
            </label>
            <input
              type="date"
              required
              value={tripStartDate}
              onChange={(e) => setTripStartDate(e.target.value)}
              style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
              تاريخ العودة المتوقع
            </label>
            <input
              type="date"
              value={tripEndDate}
              onChange={(e) => setTripEndDate(e.target.value)}
              style={{ width: '100%', height: 36, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>
        </div>

        <div>
          <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>
            أهداف الرحلة والأصناف المستهدفة
          </label>
          <textarea
            rows={3}
            value={tripObjectives}
            onChange={(e) => setTripObjectives(e.target.value)}
            placeholder="مثال: فحص خطوط إنتاج أدوات المطبخ والتعاقد على 3 حاويات للأصناف الجديدة..."
            style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button
            type="button"
            onClick={() => setIsTripModalOpen(false)}
            style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={createTripMutation.isPending}
            style={{ padding: '8px 18px', borderRadius: 6, border: 'none', backgroundColor: '#170e5e', color: '#ffffff', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' }}
          >
            {createTripMutation.isPending ? 'جاري الحفظ...' : 'حفظ الرحلة'}
          </button>
        </div>
      </form>
    </StandardDialog>
    </>
  );
}
