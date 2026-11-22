import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { contractingApi } from '../api/contracting.api';
import { toast } from '@/shared/components/system-alert';
import { todayLocalDateKey } from '@/lib/format';
import { addDays, PRESET_TRADE_MAP } from './schedule-generator/schedule-generator-data';
import type { GeneratedTaskPreview, ProjectScope } from './schedule-generator/schedule-generator-data';
import { generateSchedulePreview } from './schedule-generator/schedule-generator-preview';
import { ScheduleGeneratorExcel } from './schedule-generator/schedule-generator-excel';
import { ScheduleGeneratorScope } from './schedule-generator/schedule-generator-scope';
import { ScheduleGeneratorTrades } from './schedule-generator/schedule-generator-trades';
import { ScheduleGeneratorSettings } from './schedule-generator/schedule-generator-settings';
import { ScheduleGeneratorPreviewTable } from './schedule-generator/schedule-generator-preview-table';
export type { GeneratedTaskPreview, ProjectScope, ModularTradeItem } from './schedule-generator/schedule-generator-data';
export { MODULAR_TRADES, SCOPE_OPTIONS } from './schedule-generator/schedule-generator-data';

interface ScheduleGeneratorModalProps {
  open: boolean;
  projectId: string;
  projectName?: string;
  onClose: () => void;
  onSuccess?: () => void;
}


export function ScheduleGeneratorModal({
  open,
  projectId,
  projectName = '',
  onClose,
  onSuccess,
}: ScheduleGeneratorModalProps) {
  const { t: __t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'wizard' | 'excel'>('wizard');
  const [projectScope, setProjectScope] = useState<ProjectScope>('full_turnkey');
  const [selectedTrades, setSelectedTrades] = useState<string[]>(PRESET_TRADE_MAP['full_turnkey']);
  const [showTradeSelector, setShowTradeSelector] = useState(false);
  const [isSyncingBoq, setIsSyncingBoq] = useState(false);

  const [startDate, setStartDate] = useState(todayLocalDateKey());
  const [floorsCount, setFloorsCount] = useState<number>(4);
  const [includeBasement, setIncludeBasement] = useState(false);
  const [includeRoof, setIncludeRoof] = useState(true);

  // Production rates
  const [concreteDaysPerFloor, setConcreteDaysPerFloor] = useState<number>(14);
  const [masonryDaysPerFloor, setMasonryDaysPerFloor] = useState<number>(10);
  const [plasterPrepDays, _setPlasterPrepDays] = useState<number>(5);
  const [plasterFillDays, _setPlasterFillDays] = useState<number>(12);

  const [generating, setGenerating] = useState(false);
  const [progressCount, setProgressCount] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // تبديل نطاق القالب وتحديث الحزم المحددة تلقائياً
  const handleScopeChange = (scope: ProjectScope) => {
    setProjectScope(scope);
    if (scope !== 'custom_modular') {
      setSelectedTrades(PRESET_TRADE_MAP[scope] || []);
    } else {
      setShowTradeSelector(true);
    }
  };

  // تبديل اختيار حزمة معينة يدوياً
  const handleToggleTrade = (tradeId: string) => {
    setSelectedTrades((prev) => {
      const next = prev.includes(tradeId) ? prev.filter((id) => id !== tradeId) : [...prev, tradeId];
      return next;
    });
    setProjectScope('custom_modular');
  };

  // المزامنة الذكية مع بنود مقايسة المشروع
  const handleSyncFromBoq = async () => {
    if (!projectId) {
      toast.warning('يرجى تحديد المشروع أولاً لقراءة مقايسته التعاقدية');
      return;
    }
    setIsSyncingBoq(true);
    try {
      const items = await contractingApi.getBoqItems(projectId);
      if (!items || items.length === 0) {
        toast.warning('لا توجد بنود مقايسة مسجلة لهذا المشروع حالياً للتعرف على تخصصاته');
        return;
      }

      const detected = new Set<string>();
      items.forEach((item) => {
        const text = `${(item as any).trade || ''} ${item.category || ''} ${item.description || ''} ${item.itemCode || ''}`.toLowerCase();

        // 1. Civil / Substructure
        if (
          text.includes('حفر') ||
          text.includes('إحلال') ||
          text.includes('ردم') ||
          text.includes('أساسات') ||
          text.includes('قواعد') ||
          text.includes('لبشة') ||
          text.includes('ميدة') ||
          text.includes('ميدات') ||
          text.includes('sog')
        ) {
          detected.add('earthwork_substructure');
        }
        // 2. Concrete superstructure
        if (
          text.includes('أعمدة') ||
          text.includes('سقف') ||
          text.includes('أسقف') ||
          text.includes('كمرات') ||
          text.includes('خرسانة مسلحة') ||
          text.includes('خرسانات') ||
          text.includes('concrete')
        ) {
          detected.add('concrete_superstructure');
        }
        // 3. Masonry
        if (
          text.includes('مباني') ||
          text.includes('طوب') ||
          text.includes('بلوك') ||
          text.includes('قواطيع') ||
          text.includes('masonry')
        ) {
          detected.add('masonry');
        }
        // 4. Electrical
        if (
          text.includes('كهرب') ||
          text.includes('electrical') ||
          text.includes('إنارة') ||
          text.includes('قوى') ||
          text.includes('تأريض') ||
          text.includes('لوحة') ||
          text.includes('كابلات') ||
          text.includes('أسلاك') ||
          text.includes('ماجيك')
        ) {
          detected.add('elec_slab_earthing');
          detected.add('elec_roughin_wiring');
          detected.add('elec_fixtures_testing');
        }
        // 5. Plumbing
        if (
          text.includes('صحي') ||
          text.includes('سباك') ||
          text.includes('تغذية') ||
          text.includes('صرف') ||
          text.includes('مياه') ||
          text.includes('plumb') ||
          text.includes('خلاط') ||
          text.includes('أطقم')
        ) {
          detected.add('plumb_roughin_drainage');
          detected.add('plumb_fixtures');
        }
        // 6. HVAC
        if (
          text.includes('تكييف') ||
          text.includes('تهوية') ||
          text.includes('hvac') ||
          text.includes('تبريد') ||
          text.includes('دكت') ||
          text.includes('جريل') ||
          text.includes('نحاس')
        ) {
          detected.add('hvac_systems');
        }
        // 7. Fire fighting
        if (
          text.includes('حريق') ||
          text.includes('إطفاء') ||
          text.includes('رشاش') ||
          text.includes('sprinkler') ||
          text.includes('fire')
        ) {
          detected.add('fire_fighting');
        }
        // 8. Waterproofing
        if (
          text.includes('عزل') ||
          text.includes('waterproof') ||
          text.includes('ممبرين') ||
          text.includes('رطوبة') ||
          text.includes('بيتومين')
        ) {
          detected.add('waterproofing');
        }
        // 9. Plastering
        if (
          text.includes('محارة') ||
          text.includes('بياض') ||
          text.includes('لياسة') ||
          text.includes('plaster') ||
          text.includes('طرطشة')
        ) {
          detected.add('plastering');
        }
        // 10. Flooring
        if (
          text.includes('سيراميك') ||
          text.includes('بورسلين') ||
          text.includes('رخام') ||
          text.includes('أرضيات') ||
          text.includes('بلاط') ||
          text.includes('tile') ||
          text.includes('floor')
        ) {
          detected.add('flooring');
        }
        // 11. Carpentry & Aluminum
        if (
          text.includes('نجارة') ||
          text.includes('أبواب') ||
          text.includes('شبابيك') ||
          text.includes('ألوميتال') ||
          text.includes('كريتال') ||
          text.includes('aluminum') ||
          text.includes('door')
        ) {
          detected.add('carpentry_aluminum');
        }
        // 12. Painting & Ceilings
        if (
          text.includes('دهان') ||
          text.includes('بوية') ||
          text.includes('جبسوم') ||
          text.includes('أسقف معلقة') ||
          text.includes('paint') ||
          text.includes('gypsum')
        ) {
          detected.add('painting_ceilings');
        }
        // 13. Facades
        if (
          text.includes('واجهات') ||
          text.includes('سافيتو') ||
          text.includes('جرافياتو') ||
          text.includes('facade')
        ) {
          detected.add('facades');
        }
      });

      if (detected.size === 0) {
        toast.info('تم فحص بنود المقايسة ولكن لم يُعثر على كلمات تخصصية صريحة؛ يرجى تحديد الحزم يدوياً');
        return;
      }

      const detectedArray = Array.from(detected);
      setSelectedTrades(detectedArray);
      setProjectScope('custom_modular');
      setShowTradeSelector(true);
      toast.success(`تم التعرف الذكي على ${detectedArray.length} حزم مطابقة لمقايسة المشروع وتحديث الجدول الزمني!`);
    } catch (err: any) {
      toast.error('تعذر جلب بنود مقايسة المشروع: ' + (err?.message || 'خطأ غير معروف'));
    } finally {
      setIsSyncingBoq(false);
    }
  };

  // توليد الأنشطة المعمارية والهندسية بنظام الحزم الموديولار (Modular Pipeline Generator)
  const generatePreview = () => generateSchedulePreview({ selectedTrades, includeBasement, floorsCount, includeRoof, startDate, concreteDaysPerFloor, masonryDaysPerFloor, plasterPrepDays, plasterFillDays });

  const [customTasks, setCustomTasks] = useState<GeneratedTaskPreview[] | null>(null);

  // إعادة ضبط التعديلات المخصصة عند تغيير إعدادات القالب أو الحزم
  useEffect(() => {
    setCustomTasks(null);
  }, [
    projectScope,
    selectedTrades,
    startDate,
    floorsCount,
    includeBasement,
    includeRoof,
    concreteDaysPerFloor,
    masonryDaysPerFloor,
  ]);

  const previewTasks = customTasks || generatePreview();

  // تعديل مدة النشاط وترحيل تواريخ باقي الأنشطة اللاحقة تلقائياً
  const handleTaskDurationChange = (index: number, newDuration: number) => {
    if (newDuration < 1) return;
    const baseList = customTasks || generatePreview();
    const target = baseList[index];
    if (!target) return;

    const oldDuration = target.durationDays;
    const diff = newDuration - oldDuration;
    if (diff === 0) return;

    const updated = baseList.map((task, i) => {
      if (i < index) {
        return task;
      }
      if (i === index) {
        return {
          ...task,
          durationDays: newDuration,
          endDate: addDays(task.startDate, newDuration),
        };
      }
      return {
        ...task,
        startDate: addDays(task.startDate, diff),
        endDate: addDays(task.endDate, diff),
      };
    });

    setCustomTasks(updated);
  };

  // تعديل مسمى النشاط يدوياً عند الحاجة
  const handleTaskNameChange = (index: number, newName: string) => {
    const baseList = customTasks || generatePreview();
    const updated = baseList.map((task, i) => (i === index ? { ...task, taskName: newName } : task));
    setCustomTasks(updated);
  };

  const handleCommitSchedule = async () => {
    if (!projectId) return;
    if (previewTasks.length === 0) {
      toast.warning('لا توجد أنشطة لتثبيتها! يرجى اختيار حزمة واحدة على الأقل');
      return;
    }
    setGenerating(true);
    setErrorMsg(null);
    setProgressCount(0);
    try {
      const chunkSize = 4;
      for (let i = 0; i < previewTasks.length; i += chunkSize) {
        const chunk = previewTasks.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map((t) =>
            contractingApi.createScheduleTask(projectId, {
              taskCode: t.taskCode,
              wbsCode: t.wbsCode,
              taskName: t.taskName,
              startDate: t.startDate,
              endDate: t.endDate,
              durationDays: t.durationDays,
              isCriticalPath: t.isCriticalPath,
              status: 'not_started',
              progressPercent: 0,
            })
          )
        );
        setProgressCount(Math.min(i + chunkSize, previewTasks.length));
      }
      toast.success(`تم بنجاح توليد واعتماد ${previewTasks.length} نشاط في الجدول الزمني للمشروع!`);
      onSuccess?.();
      onClose();
    } catch (err: any) {
      console.error('Failed to commit generated schedule:', err);
      setErrorMsg(err?.message || 'حدث خطأ أثناء حفظ الجدول الزمني');
    } finally {
      setGenerating(false);
    }
  };

  const handleImportExcelSample = async () => {
    setStartDate('2024-01-01');
    setFloorsCount(5);
    setIncludeRoof(true);
    setIncludeBasement(true);
    setProjectScope('full_turnkey');
    setSelectedTrades(PRESET_TRADE_MAP['full_turnkey']);
    setActiveTab('wizard');
  };

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={__t('contracting.schedule_generator_modal.s0', "محرك التوليد الزمني الذكي للإنشاءات (Universal Construction Schedule Builder)")}
      subtitle={projectName ? `المشروع: ${projectName}` : __t('contracting.schedule_generator_modal.s1', "توليد مسارات تنفيذية ذكية لكافة المقاولين والتخصصات والحزم المستقلة بنقرة واحدة")}
      maxWidth="1100px"
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <div style={{ fontSize: 'var(--font-micro)', color: '#64748b' }}>
            {__t('contracting.schedule_generator_modal.s2', "سيتم إنشاء")} {previewTasks.length} {__t('contracting.schedule_generator_modal.s3', "نشاط ومرحلة تنفيذية مع التواريخ والمسار الحرج CPM.")}
            {generating && progressCount > 0 && (
              <span style={{ marginInlineStart: '8px', color: '#170e5e', fontWeight: 700 }}>
                {__t('contracting.schedule_generator_modal.s4', "(تم إنشاء")} {progressCount} {__t('contracting.schedule_generator_modal.s5', "من")} {previewTasks.length})
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 18px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                color: '#475569',
                fontSize: 'var(--font-body)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {__t('contracting.schedule_generator_modal.s6', "إلغاء")}
            </button>
            <button
              type="button"
              onClick={handleCommitSchedule}
              disabled={generating || previewTasks.length === 0}
              style={{
                padding: '8px 24px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#170e5e',
                color: '#ffffff',
                fontSize: 'var(--font-body)',
                fontWeight: 700,
                cursor: generating || previewTasks.length === 0 ? 'not-allowed' : 'pointer',
                opacity: previewTasks.length === 0 ? 0.6 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <AppIcons.Calendar size={16} />
              <span>{generating ? `جارٍ توليد الجدول (${progressCount}/${previewTasks.length})...` : __t('contracting.schedule_generator_modal.s7', "تثبيت واعتماد الجدول الزمني")}</span>
            </button>
          </div>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} dir="rtl">
        {errorMsg && (
          <div style={{ padding: '10px 14px', borderRadius: '8px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 'var(--font-body)', fontWeight: 600 }}>
            {errorMsg}
          </div>
        )}

        {/* Tab Selector */}
        <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
          <button
            type="button"
            onClick={() => setActiveTab('wizard')}
            style={{
              padding: '6px 16px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: activeTab === 'wizard' ? '#170e5e' : '#f1f5f9',
              color: activeTab === 'wizard' ? '#ffffff' : '#475569',
              fontWeight: 700,
              fontSize: 'var(--font-body)',
              cursor: 'pointer',
            }}
          >
            {__t('contracting.schedule_generator_modal.s8', "معالج التوليد السريع للأدوار والمراحل (Wizard)")}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('excel')}
            style={{
              padding: '6px 16px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: activeTab === 'excel' ? '#170e5e' : '#f1f5f9',
              color: activeTab === 'excel' ? '#ffffff' : '#475569',
              fontWeight: 700,
              fontSize: 'var(--font-body)',
              cursor: 'pointer',
            }}
          >
            {__t('contracting.schedule_generator_modal.s9', "استيراد من إكسيل (Excel)")}
          </button>
        </div>

        {activeTab === 'excel' ? (
          <ScheduleGeneratorExcel handleImportExcelSample={handleImportExcelSample} />
        ) : (
          <>
            <ScheduleGeneratorScope projectId={projectId} handleSyncFromBoq={handleSyncFromBoq} isSyncingBoq={isSyncingBoq} setShowTradeSelector={setShowTradeSelector} showTradeSelector={showTradeSelector} selectedTrades={selectedTrades} projectScope={projectScope} handleScopeChange={handleScopeChange} />

            {(showTradeSelector || projectScope === 'custom_modular') && (
              <ScheduleGeneratorTrades setSelectedTrades={setSelectedTrades} setProjectScope={setProjectScope} selectedTrades={selectedTrades} handleToggleTrade={handleToggleTrade} />
            )}

            <ScheduleGeneratorSettings startDate={startDate} setStartDate={setStartDate} floorsCount={floorsCount} setFloorsCount={setFloorsCount} concreteDaysPerFloor={concreteDaysPerFloor} setConcreteDaysPerFloor={setConcreteDaysPerFloor} masonryDaysPerFloor={masonryDaysPerFloor} setMasonryDaysPerFloor={setMasonryDaysPerFloor} includeBasement={includeBasement} setIncludeBasement={setIncludeBasement} includeRoof={includeRoof} setIncludeRoof={setIncludeRoof} />

            <ScheduleGeneratorPreviewTable previewTasks={previewTasks} customTasks={customTasks} setCustomTasks={setCustomTasks} handleScopeChange={handleScopeChange} handleTaskNameChange={handleTaskNameChange} handleTaskDurationChange={handleTaskDurationChange} />
          </>
        )}
      </div>
    </StandardDialog>
  );
}
