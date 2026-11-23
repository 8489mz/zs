import { StandardDialog } from '@/shared/components/StandardDialog';

export interface ChinaSourcingQcDialogProps {
  isQcModalOpen: boolean;
  setIsQcModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleCreateQc: (e: React.FormEvent) => Promise<void>;
  qcStage: string;
  setQcStage: React.Dispatch<React.SetStateAction<string>>;
  qcDate: string;
  setQcDate: React.Dispatch<React.SetStateAction<string>>;
  qcInspector: string;
  setQcInspector: React.Dispatch<React.SetStateAction<string>>;
  qcSampleSize: number;
  setQcSampleSize: React.Dispatch<React.SetStateAction<number>>;
  qcPassedQty: number;
  setQcPassedQty: React.Dispatch<React.SetStateAction<number>>;
  qcFailedQty: number;
  setQcFailedQty: React.Dispatch<React.SetStateAction<number>>;
  qcStatus: string;
  setQcStatus: React.Dispatch<React.SetStateAction<string>>;
  qcDefectNotes: string;
  setQcDefectNotes: React.Dispatch<React.SetStateAction<string>>;
  createQcMutation: { isPending: boolean };
}

export function ChinaSourcingQcDialog({ isQcModalOpen, setIsQcModalOpen, handleCreateQc, qcStage, setQcStage, qcDate, setQcDate, qcInspector, setQcInspector, qcSampleSize, setQcSampleSize, qcPassedQty, setQcPassedQty, qcFailedQty, setQcFailedQty, qcStatus, setQcStatus, qcDefectNotes, setQcDefectNotes, createQcMutation }: ChinaSourcingQcDialogProps) {
  return (
    <>
    {/* 6. QC Inspection Dialog */}
    <StandardDialog
      open={isQcModalOpen}
      onClose={() => setIsQcModalOpen(false)}
      title="تسجيل تقرير فحص جودة جديد (New QC Inspection)"
      subtitle="فحص العينات في الصين ومطابقة المواصفات قبل شحن الحاوية"
      width="600px"
    >
      <form onSubmit={handleCreateQc} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>مرحلة الفحص</label>
            <select
              value={qcStage}
              onChange={(e) => setQcStage(e.target.value)}
              style={{ width: '100%', height: 36, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            >
              <option value="raw_material">فحص المواد الخام</option>
              <option value="during_production">أثناء الإنتاج (DUPRO)</option>
              <option value="pre_shipment">قبل الشحن (Pre-Shipment)</option>
              <option value="container_loading">أثناء تحميل الحاوية (CLC)</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>تاريخ الفحص</label>
            <input
              type="date"
              required
              value={qcDate}
              onChange={(e) => setQcDate(e.target.value)}
              style={{ width: '100%', height: 36, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>المفتش / وكيل الجودة</label>
            <input
              type="text"
              value={qcInspector}
              onChange={(e) => setQcInspector(e.target.value)}
              placeholder="اسم المفتش أو شركة الفحص"
              style={{ width: '100%', height: 36, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>حجم العينة المفحوصة (قطعة)</label>
            <input
              type="number"
              value={qcSampleSize}
              onChange={(e) => setQcSampleSize(Number(e.target.value))}
              style={{ width: '100%', height: 36, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>القطع المقبولة</label>
            <input
              type="number"
              value={qcPassedQty}
              onChange={(e) => setQcPassedQty(Number(e.target.value))}
              style={{ width: '100%', height: 36, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>القطع المرفوعة / المعيبة</label>
            <input
              type="number"
              value={qcFailedQty}
              onChange={(e) => setQcFailedQty(Number(e.target.value))}
              style={{ width: '100%', height: 36, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
            />
          </div>
        </div>

        <div>
          <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>القرار النهائي للفحص</label>
          <select
            value={qcStatus}
            onChange={(e) => setQcStatus(e.target.value)}
            style={{ width: '100%', height: 36, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
          >
            <option value="passed">معتمد ومطابق للشحن (Passed)</option>
            <option value="conditional">معتمد بشروط / إعادة تعبئة (Conditional)</option>
            <option value="rejected">مرفوض تماماً / إعادة تصنيع (Rejected)</option>
          </select>
        </div>

        <div>
          <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 4 }}>ملاحظات العيوب والاختبارات</label>
          <textarea
            rows={3}
            value={qcDefectNotes}
            onChange={(e) => setQcDefectNotes(e.target.value)}
            placeholder="تفاصيل العيوب الملاحظة، اختلاف الألوان، مطابقة الأوزان والأبعاد..."
            style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
          <button
            type="button"
            onClick={() => setIsQcModalOpen(false)}
            style={{ padding: '8px 16px', backgroundColor: '#f1f5f9', border: 'none', borderRadius: 6, fontSize: '12.5px', fontWeight: 600, color: '#475569', cursor: 'pointer' }}
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={createQcMutation.isPending}
            style={{ padding: '8px 20px', backgroundColor: '#170e5e', border: 'none', borderRadius: 6, fontSize: '12.5px', fontWeight: 700, color: '#ffffff', cursor: 'pointer' }}
          >
            {createQcMutation.isPending ? 'جاري الحفظ...' : 'حفظ تقرير الفحص'}
          </button>
        </div>
      </form>
    </StandardDialog>
    </>
  );
}
