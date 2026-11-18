import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { CustomSelect } from '@/shared/ui/custom-select';
import { contractingApi } from '../api/contracting.api';
import { toast } from '@/shared/components/system-alert';
import { todayLocalDateKey } from '@/lib/format';

interface ScheduleGeneratorModalProps {
  open: boolean;
  projectId: string;
  projectName?: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export interface GeneratedTaskPreview {
  taskCode: string;
  wbsCode: string;
  taskName: string;
  startDate: string;
  endDate: string;
  durationDays: number;
  isCriticalPath: boolean;
  category: string;
}

export type ProjectScope =
  | 'full_turnkey'
  | 'concrete_structure'
  | 'full_finishing'
  | 'full_mep'
  | 'electrical_only'
  | 'plumbing_only'
  | 'hvac_only'
  | 'architectural_finishes'
  | 'custom_modular';

export interface ModularTradeItem {
  id: string;
  code: string;
  name: string;
  category: 'مدني وإنشائي' | 'كهروميكانيكي' | 'تشطيبات ومعماري';
  description: string;
}

export const MODULAR_TRADES: ModularTradeItem[] = [
  {
    id: 'earthwork_substructure',
    code: 'CIV-01',
    name: 'أعمال ترابية وأساسات وخرسانات مدفونة',
    category: 'مدني وإنشائي',
    description: 'رفع مساحي، حفر، إحلال، فرشة نظافة، قواعد مسلحة، عزل بيتومين، رقاب أعمدة، ميدات وخرسانة أرضيات SOG',
  },
  {
    id: 'concrete_superstructure',
    code: 'CIV-02',
    name: 'هيكل خرساني علوي بالأدوار (أعمدة وأسقف)',
    category: 'مدني وإنشائي',
    description: 'نجارة وحدادة وصب أعمدة وأسقف خرسانية مسلحة متكررة وغرف خدمات السطح',
  },
  {
    id: 'masonry',
    code: 'CIV-03',
    name: 'أعمال مباني وقواطيع وعتب الفتحات',
    category: 'مدني وإنشائي',
    description: 'بناء حوائط وبلوك طفلي وأسمنتي وقواطيع داخلية وعتب خرساني للفتحات',
  },
  {
    id: 'elec_slab_earthing',
    code: 'ELE-01',
    name: 'تأسيسات كهرباء بالخرسانات وشبكة تأريض',
    category: 'كهروميكانيكي',
    description: 'شبكة تأريض الأساسات العمومية + تمديد خراطيم ومخارج الإنارة بحديد الأسقف قبل الصب بالأدوار',
  },
  {
    id: 'elec_roughin_wiring',
    code: 'ELE-02',
    name: 'تأسيسات كهرباء وتيار خفيف بالحوائط وسحب أسلاك',
    category: 'كهروميكانيكي',
    description: 'شق الحوائط، علب ماجيك، مسارات إنذار وداتا وكاميرات، وصناديق لوحات التوزيع وتدكيك الأسلاك',
  },
  {
    id: 'elec_fixtures_testing',
    code: 'ELE-03',
    name: 'تشطيبات كهرباء وإنارة وتجميع لوحات وميجر',
    category: 'كهروميكانيكي',
    description: 'تجميع قواطع اللوحات DB، تركيب المفاتيح والبرايز ووحدات الإضاءة واختبارات العزل والميجر وإطلاق التيار',
  },
  {
    id: 'plumb_roughin_drainage',
    code: 'PLM-01',
    name: 'تأسيسات صحية وتغذية وصرف مدفون وصواعد',
    category: 'كهروميكانيكي',
    description: 'شبكات صرف مدفونة، صواعد ومزاريب مياه، تأسيس مواسير PPR بولي بروبلين واختبار الضغط بالبار',
  },
  {
    id: 'plumb_fixtures',
    code: 'PLM-02',
    name: 'تشطيبات صحية وتركيب أطقم وخلاطات ومضخات',
    category: 'كهروميكانيكي',
    description: 'تثبيت الأطقم الصيني وخلاطات المياه وسخانات وكبائن الشاور ومضخات الرفع واختبارات التشغيل',
  },
  {
    id: 'hvac_systems',
    code: 'MEC-01',
    name: 'شبكات تكييف وتهوية (نحاس + صاج دكت + ماكينات)',
    category: 'كهروميكانيكي',
    description: 'زراعة جلب Sleeves، مسارات مواسير النحاس وصرف التكييف، تصنيع صاج، تركيب الماكينات وجريلات الهواء',
  },
  {
    id: 'fire_fighting',
    code: 'MEC-02',
    name: 'شبكات مكافحة الحريق والرشاشات والصناديق',
    category: 'كهروميكانيكي',
    description: 'تمديدات شبكة مواسير سيملس، رشاشات مياه Sprinklers، عساكر وصناديق الحريق واختبارات الضغط الهيدروليكي',
  },
  {
    id: 'waterproofing',
    code: 'FIN-01',
    name: 'عزل مائي وحراري واختبارات غمر 48 ساعة',
    category: 'تشطيبات ومعماري',
    description: 'عزل أرضيات حمامات ومطابخ بمواد أسمنتية/ممبرين، عزل السطح مائي وحراري واختبار الغمر بالماء 48 ساعة',
  },
  {
    id: 'plastering',
    code: 'FIN-02',
    name: 'بياض ومحارة ولياسة داخلية بالأدوار',
    category: 'تشطيبات ومعماري',
    description: 'طرطشة، بؤج وأوتار، سلك شبك فايبر للتقاطعات، ملو وتنعيم بياض المحارة بميزان القامة',
  },
  {
    id: 'flooring',
    code: 'FIN-03',
    name: 'أعمال أرضيات وسيراميك وبورسلين ورخام',
    category: 'تشطيبات ومعماري',
    description: 'فرش الدفان، تركيب سيراميك وبورسلين الأرضيات والحوائط، ورخام السلالم والمداخل والوزرات',
  },
  {
    id: 'carpentry_aluminum',
    code: 'FIN-04',
    name: 'أعمال نجارة وأبواب وألوميتال وكريتال',
    category: 'تشطيبات ومعماري',
    description: 'تثبيت الحلوق الزفرة، شبابيك وواجهات الألوميتال مع الزجاج، ضلف الأبواب الخشبية، ودرابزين الكريتال',
  },
  {
    id: 'painting_ceilings',
    code: 'FIN-05',
    name: 'أسقف معلقة ودهانات وديكورات داخلية',
    category: 'تشطيبات ومعماري',
    description: 'توريد وتركيب الجبسوم بورد والأسقف المعلقة، سكاكين المعجون والبطانة والدهانات النهائية',
  },
  {
    id: 'facades',
    code: 'FIN-06',
    name: 'تشطيب الواجهات الخارجية ومحارة سافيتو',
    category: 'تشطيبات ومعماري',
    description: 'سقالات الواجهات الخارجية، سيلر، بياض محارة سافيتو/جرافياتو وتشطيب الدهانات الخارجية المقاومة للعوامل الجوية',
  },
];

export const SCOPE_OPTIONS = [
  { value: 'full_turnkey', label: 'مشروع متكامل تسليم مفتاح (حفر + خرسانات + مباني + كهروميكانيك + تشطيبات كاملة)' },
  { value: 'concrete_structure', label: 'هيكل إنشائي وعظم فقط (حفر + أساسات + خرسانات مسلحة + مباني)' },
  { value: 'full_finishing', label: 'تشطيبات متكاملة لكافة التخصصات (كهروميكانيك + عزل + محارة + أرضيات + دهانات + ألوميتال)' },
  { value: 'full_mep', label: 'كهروميكانيك متكامل MEP (كهرباء وتيار خفيف + صحي وسباكة + تكييف وتبريد + مكافحة حريق)' },
  { value: 'electrical_only', label: 'أعمال كهربائية وتيار خفيف فقط (تأريض أساسات + خراطيم أسقف + حوائط + سحب أسلاك + لوحات وتشطيب)' },
  { value: 'plumbing_only', label: 'أعمال صحية وتغذية وصرف فقط (صرف مدفون + صواعد + تأسيس حمامات وضغط بار + عزل + تشطيب أطقم)' },
  { value: 'hvac_only', label: 'أعمال تكييف وتهوية فقط HVAC (سليفز + مسارات نحاس وصرف + صاج دكت + ماكينات + جريلات واختبارات)' },
  { value: 'architectural_finishes', label: 'تشطيبات معمارية فقط (محارة وبياض + أرضيات وسيراميك + نجارة وألوميتال + دهانات وأسقف)' },
  { value: 'custom_modular', label: 'نطاق مخصص وتحديد يدوي للحزم (Custom Modular Builder)' },
];

const PRESET_TRADE_MAP: Record<ProjectScope, string[]> = {
  full_turnkey: MODULAR_TRADES.map((t) => t.id),
  concrete_structure: ['earthwork_substructure', 'concrete_superstructure', 'masonry'],
  full_finishing: [
    'elec_roughin_wiring',
    'elec_fixtures_testing',
    'plumb_roughin_drainage',
    'plumb_fixtures',
    'hvac_systems',
    'waterproofing',
    'plastering',
    'flooring',
    'carpentry_aluminum',
    'painting_ceilings',
    'facades',
  ],
  full_mep: [
    'elec_slab_earthing',
    'elec_roughin_wiring',
    'elec_fixtures_testing',
    'plumb_roughin_drainage',
    'plumb_fixtures',
    'hvac_systems',
    'fire_fighting',
  ],
  electrical_only: [
    'elec_slab_earthing',
    'elec_roughin_wiring',
    'elec_fixtures_testing',
  ],
  plumbing_only: [
    'plumb_roughin_drainage',
    'plumb_fixtures',
    'waterproofing',
  ],
  hvac_only: [
    'hvac_systems',
  ],
  architectural_finishes: [
    'waterproofing',
    'plastering',
    'flooring',
    'carpentry_aluminum',
    'painting_ceilings',
    'facades',
  ],
  custom_modular: [],
};

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
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
  const generatePreview = (): GeneratedTaskPreview[] => {
    const list: GeneratedTaskPreview[] = [];
    let taskCounter = 1;
    const tradesSet = new Set(selectedTrades);
    const has = (id: string) => tradesSet.has(id);

    // بناء قائمة أسماء الأدوار
    const floors: string[] = [];
    if (includeBasement) floors.push('البدروم');
    floors.push('الدور الأرضي');
    for (let i = 1; i <= floorsCount; i++) {
      floors.push(
        `الدور ${
          i === 1
            ? 'الأول'
            : i === 2
            ? 'الثاني'
            : i === 3
            ? 'الثالث'
            : i === 4
            ? 'الرابع'
            : i === 5
            ? 'الخامس'
            : i === 6
            ? 'السادس'
            : i === 7
            ? 'السابع'
            : i === 8
            ? 'الثامن'
            : i === 9
            ? 'التاسع'
            : `المتكرر (${i})`
        }`
      );
    }
    if (includeRoof) floors.push('دور السطح (الروف)');

    let currentDate = startDate;

    // 1. الأعمال الترابية والأساسات (Civil / Substructure)
    if (has('earthwork_substructure')) {
      const surveyEnd = addDays(currentDate, 5);
      list.push({
        taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
        wbsCode: '1.1',
        taskName: 'الرفع المساحي والميزانية الشبكية وتجهيز وسور الموقع',
        startDate: currentDate,
        endDate: surveyEnd,
        durationDays: 5,
        isCriticalPath: true,
        category: 'الأعمال الترابية والأساسات',
      });

      const excavStart = addDays(surveyEnd, 1);
      const excavEnd = addDays(excavStart, 10);
      list.push({
        taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
        wbsCode: '1.2',
        taskName: 'أعمال الحفر وتنسيق المناسيب ونقل نواتج الحفر للمقالب العمومية',
        startDate: excavStart,
        endDate: excavEnd,
        durationDays: 10,
        isCriticalPath: true,
        category: 'الأعمال الترابية والأساسات',
      });

      const subgradeStart = addDays(excavEnd, 1);
      const subgradeEnd = addDays(subgradeStart, 7);
      list.push({
        taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
        wbsCode: '1.3',
        taskName: 'توريد وفرش ودمك طبقات الإحلال واختبارات الكثافة الحقلية',
        startDate: subgradeStart,
        endDate: subgradeEnd,
        durationDays: 7,
        isCriticalPath: true,
        category: 'الأعمال الترابية والأساسات',
      });

      currentDate = addDays(subgradeEnd, 1);

      const pccEnd = addDays(currentDate, 4);
      list.push({
        taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
        wbsCode: '1.4',
        taskName: 'صب الخرسانة العادية أسفل الأساسات (فرشة النظافة)',
        startDate: currentDate,
        endDate: pccEnd,
        durationDays: 4,
        isCriticalPath: true,
        category: 'أساسات وخرسانات مدفونة',
      });

      const rccStart = addDays(pccEnd, 1);
      const rccEnd = addDays(rccStart, 12);
      list.push({
        taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
        wbsCode: '1.5',
        taskName: 'نجارة وحدادة وصب القواعد المسلحة / اللبشة',
        startDate: rccStart,
        endDate: rccEnd,
        durationDays: 12,
        isCriticalPath: true,
        category: 'أساسات وخرسانات مدفونة',
      });

      // إذا كانت الكهرباء محددة مع الأساسات، تنزل شبكة التأريض بالتوازي
      if (has('elec_slab_earthing')) {
        list.push({
          taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
          wbsCode: '1.5.1',
          taskName: 'تنفيذ شبكة التأريض العمومية للأساسات وربطها بحديد القواعد واللبشة',
          startDate: addDays(rccStart, 3),
          endDate: addDays(rccStart, 7),
          durationDays: 4,
          isCriticalPath: false,
          category: 'التأسيسات الكهروميكانيكية',
        });
      }

      const bituStart = addDays(rccEnd, 2);
      const bituEnd = addDays(bituStart, 3);
      list.push({
        taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
        wbsCode: '1.6',
        taskName: 'عزل البيتومين المؤكسد للأساسات والخرسانات الملامسة للتربة',
        startDate: bituStart,
        endDate: bituEnd,
        durationDays: 3,
        isCriticalPath: false,
        category: 'أساسات وخرسانات مدفونة',
      });

      const neckStart = addDays(bituEnd, 1);
      const neckEnd = addDays(neckStart, 5);
      list.push({
        taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
        wbsCode: '1.7',
        taskName: 'نجارة وحدادة وصب رقاب الأعمدة وعزلها',
        startDate: neckStart,
        endDate: neckEnd,
        durationDays: 5,
        isCriticalPath: true,
        category: 'أساسات وخرسانات مدفونة',
      });

      const tieStart = addDays(neckEnd, 1);
      const tieEnd = addDays(tieStart, 7);
      list.push({
        taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
        wbsCode: '1.8',
        taskName: 'نجارة وحدادة وصب ميدات الربط الأرضية (Tie Beams) وعزلها',
        startDate: tieStart,
        endDate: tieEnd,
        durationDays: 7,
        isCriticalPath: true,
        category: 'أساسات وخرسانات مدفونة',
      });

      const backfillStart = addDays(tieEnd, 2);
      const backfillEnd = addDays(backfillStart, 5);
      list.push({
        taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
        wbsCode: '1.9',
        taskName: 'أعمال الردم الميكانيكي على طبقات مع الدمك',
        startDate: backfillStart,
        endDate: backfillEnd,
        durationDays: 5,
        isCriticalPath: true,
        category: 'أساسات وخرسانات مدفونة',
      });

      // إذا كانت السباكة محددة مع الأساسات، ينزل الصرف المدفون قبل SOG
      if (has('plumb_roughin_drainage')) {
        list.push({
          taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
          wbsCode: '1.9.1',
          taskName: 'تمديد واختبار شبكات الصرف المدفونة أسفل الأرضيات وغرف التفتيش',
          startDate: addDays(backfillStart, 2),
          endDate: addDays(backfillStart, 6),
          durationDays: 4,
          isCriticalPath: false,
          category: 'التأسيسات الكهروميكانيكية',
        });
      }

      const sogStart = addDays(backfillEnd, 1);
      const sogEnd = addDays(sogStart, 5);
      list.push({
        taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
        wbsCode: '1.10',
        taskName: 'صب خرسانة الأرضيات Slab on Grade (SOG) مع الشبك وفواصل التمدد',
        startDate: sogStart,
        endDate: sogEnd,
        durationDays: 5,
        isCriticalPath: true,
        category: 'أساسات وخرسانات مدفونة',
      });

      currentDate = addDays(sogEnd, 1);
    } else {
      // إذا لم يكن هناك أعمال مدنية، لكن تم اختيار تأريض الكهرباء (مقاول كهرباء فقط من البداية)
      if (has('elec_slab_earthing')) {
        const earthEnd = addDays(currentDate, 4);
        list.push({
          taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
          wbsCode: '1.1',
          taskName: 'تنفيذ شبكة التأريض العمومية للأساسات وربطها ببئر التأريض (Earthing Grid)',
          startDate: currentDate,
          endDate: earthEnd,
          durationDays: 4,
          isCriticalPath: true,
          category: 'الأعمال الكهربائية التخصصية',
        });
        currentDate = addDays(earthEnd, 1);
      }

      // إذا تم اختيار صرف مدفون فقط بدون أعمال ترابية
      if (has('plumb_roughin_drainage')) {
        const plumbDrainEnd = addDays(currentDate, 6);
        list.push({
          taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
          wbsCode: '1.2',
          taskName: 'تمديدات شبكات الصرف المدفونة ومخارج غرف التفتيش الخارجية',
          startDate: currentDate,
          endDate: plumbDrainEnd,
          durationDays: 6,
          isCriticalPath: true,
          category: 'الأعمال الصحية والسباكة',
        });
        currentDate = addDays(plumbDrainEnd, 1);
      }
    }

    // 2. الهيكل الخرساني العلوي بالأدوار (RCC Superstructure)
    if (has('concrete_superstructure')) {
      floors.forEach((fl, idx) => {
        const colStart = currentDate;
        const colEnd = addDays(colStart, 6);
        list.push({
          taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
          wbsCode: `2.${idx * 2 + 1}`,
          taskName: `نجارة وحدادة وصب أعمدة - ${fl}`,
          startDate: colStart,
          endDate: colEnd,
          durationDays: 6,
          isCriticalPath: true,
          category: 'الهيكل الخرساني العلوي',
        });

        const slabStart = addDays(colEnd, 1);
        const slabDur = concreteDaysPerFloor - 6 > 6 ? concreteDaysPerFloor - 6 : 8;
        const slabEnd = addDays(slabStart, slabDur);
        list.push({
          taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
          wbsCode: `2.${idx * 2 + 2}`,
          taskName: `نجارة وتسليح وتجهيز سقف - ${fl}`,
          startDate: slabStart,
          endDate: slabEnd,
          durationDays: slabDur,
          isCriticalPath: true,
          category: 'الهيكل الخرساني العلوي',
        });

        // خراطيم الأسقف في حال وجود كهرباء
        if (has('elec_slab_earthing')) {
          list.push({
            taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
            wbsCode: `2.${idx * 2 + 2}.E`,
            taskName: `تمديد خراطيم ومخارج الإنارة وتأسيس الصواعد بحديد سقف - ${fl}`,
            startDate: addDays(slabStart, slabDur - 4),
            endDate: addDays(slabStart, slabDur - 1),
            durationDays: 3,
            isCriticalPath: true,
            category: 'الأعمال الكهربائية التخصصية',
          });
        }

        currentDate = addDays(slabEnd, 1);
      });

      if (includeRoof) {
        const roofSvcEnd = addDays(currentDate, 7);
        list.push({
          taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
          wbsCode: '2.99',
          taskName: 'غرف خدمات السطح وسترة الروف (Parapet) وغرفة المصعد والخزان',
          startDate: currentDate,
          endDate: roofSvcEnd,
          durationDays: 7,
          isCriticalPath: true,
          category: 'الهيكل الخرساني العلوي',
        });
        currentDate = addDays(roofSvcEnd, 1);
      }
    } else if (has('elec_slab_earthing') && !has('earthwork_substructure')) {
      // مقاول كهرباء فقط بدون خرسانات، لكن ينفذ خراطيم الأسقف
      floors.forEach((fl, idx) => {
        const slabElecEnd = addDays(currentDate, 5);
        list.push({
          taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
          wbsCode: `2.${idx + 1}.E`,
          taskName: `تمديد وتثبيت خراطيم الـ PVC ومخارج الإنارة وتأسيس الصواعد بسقف - ${fl}`,
          startDate: currentDate,
          endDate: slabElecEnd,
          durationDays: 5,
          isCriticalPath: true,
          category: 'الأعمال الكهربائية التخصصية',
        });
        currentDate = addDays(slabElecEnd, 1);
      });
    }

    // 3. أعمال المباني (Masonry)
    if (has('masonry')) {
      floors.forEach((fl, idx) => {
        const masEnd = addDays(currentDate, masonryDaysPerFloor);
        list.push({
          taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
          wbsCode: `3.${idx + 1}`,
          taskName: `أعمال المباني والقواطيع وعتب الفتحات - ${fl}`,
          startDate: currentDate,
          endDate: masEnd,
          durationDays: masonryDaysPerFloor,
          isCriticalPath: true,
          category: 'أعمال المباني',
        });
        currentDate = addDays(masEnd, 1);
      });
    }

    // 4. تأسيسات الكهروميكانيك بالأدوار (MEP 1st & 2nd Fix)
    let mepFloorDate = currentDate;

    // صواعد السباكة الرئيسية
    if (has('plumb_roughin_drainage')) {
      const riserEnd = addDays(mepFloorDate, 8);
      list.push({
        taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
        wbsCode: '4.P.1',
        taskName: 'تركيب صواعد التغذية الرئيسية ومواسير الصرف والمزاريب وبطاريات المياه',
        startDate: mepFloorDate,
        endDate: riserEnd,
        durationDays: 8,
        isCriticalPath: false,
        category: 'الأعمال الصحية والسباكة',
      });
    }

    // جلب التكييف Sleeves وصاج الدكت
    if (has('hvac_systems')) {
      const ductEnd = addDays(mepFloorDate, 10);
      list.push({
        taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
        wbsCode: '4.H.1',
        taskName: 'زراعة جلب Sleeves وتصنيع وتثبيت صاج الدكت والعزل الحراري والصوتي',
        startDate: mepFloorDate,
        endDate: ductEnd,
        durationDays: 10,
        isCriticalPath: false,
        category: 'أعمال التكييف والتهوية',
      });
    }

    // شبكات مكافحة الحريق
    if (has('fire_fighting')) {
      const fireRiserEnd = addDays(mepFloorDate, 10);
      list.push({
        taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
        wbsCode: '4.F.1',
        taskName: 'تمديد شبكة مواسير سيملس وصواعد الحريق الرئيسية وصناديق الحريق',
        startDate: mepFloorDate,
        endDate: fireRiserEnd,
        durationDays: 10,
        isCriticalPath: false,
        category: 'شبكات مكافحة الحريق',
      });
    }

    // تأسيسات الأدوار الكهروميكانيكية
    floors.forEach((fl, idx) => {
      // أ) تأسيس كهرباء حوائط وعلب ماجيك
      if (has('elec_roughin_wiring')) {
        const elecRoughEnd = addDays(mepFloorDate, 5);
        list.push({
          taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
          wbsCode: `4.E.${idx + 1}.1`,
          taskName: `تأسيس الكهرباء، شق الحوائط، تثبيت علب الماجيك وصناديق اللوحات - ${fl}`,
          startDate: mepFloorDate,
          endDate: elecRoughEnd,
          durationDays: 5,
          isCriticalPath: false,
          category: 'الأعمال الكهربائية التخصصية',
        });

        const wireStart = addDays(elecRoughEnd, 1);
        const wireEnd = addDays(wireStart, 6);
        list.push({
          taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
          wbsCode: `4.E.${idx + 1}.2`,
          taskName: `سحب وتدكيك الأسلاك وتمديد كابلات التيار الخفيف (داتا/إنذار/كاميرات) - ${fl}`,
          startDate: wireStart,
          endDate: wireEnd,
          durationDays: 6,
          isCriticalPath: false,
          category: 'الأعمال الكهربائية التخصصية',
        });

        const dbStart = addDays(wireEnd, 1);
        const dbEnd = addDays(dbStart, 3);
        list.push({
          taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
          wbsCode: `4.E.${idx + 1}.3`,
          taskName: `تجميع وترتيب لوحات التوزيع وتثبيت القواطع الأوتوماتيكية (DB Dressing) - ${fl}`,
          startDate: dbStart,
          endDate: dbEnd,
          durationDays: 3,
          isCriticalPath: false,
          category: 'الأعمال الكهربائية التخصصية',
        });
      }

      // ب) تأسيس صحي وحمامات الدور
      if (has('plumb_roughin_drainage')) {
        const plumbEnd = addDays(mepFloorDate, 6);
        list.push({
          taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
          wbsCode: `4.P.${idx + 1}`,
          taskName: `تأسيس شبكات التغذية والصرف واختبار الضغط بالبار للحمامات - ${fl}`,
          startDate: mepFloorDate,
          endDate: plumbEnd,
          durationDays: 6,
          isCriticalPath: false,
          category: 'الأعمال الصحية والسباكة',
        });
      }

      // ج) مسارات نحاس التكييف
      if (has('hvac_systems')) {
        const hvacEnd = addDays(mepFloorDate, 4);
        list.push({
          taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
          wbsCode: `4.H.${idx + 1}`,
          taskName: `مسارات مواسير النحاس وصرف التكييف وشبكات الفريون - ${fl}`,
          startDate: mepFloorDate,
          endDate: hvacEnd,
          durationDays: 4,
          isCriticalPath: false,
          category: 'أعمال التكييف والتهوية',
        });
      }

      // د) شبكة رشاشات الحريق
      if (has('fire_fighting')) {
        const fireSprinkEnd = addDays(mepFloorDate, 5);
        list.push({
          taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
          wbsCode: `4.F.${idx + 1}`,
          taskName: `شبكة الرشاشات الزجاجية Sprinklers واختبار الضغط بالمانومتر 15 بار - ${fl}`,
          startDate: mepFloorDate,
          endDate: fireSprinkEnd,
          durationDays: 5,
          isCriticalPath: false,
          category: 'شبكات مكافحة الحريق',
        });
      }

      mepFloorDate = addDays(mepFloorDate, 5);
    });

    currentDate = mepFloorDate;

    // 5. أعمال العزل المائي والحراري (Waterproofing)
    if (has('waterproofing')) {
      const waterBathStart = currentDate;
      const waterBathEnd = addDays(waterBathStart, 6);
      list.push({
        taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
        wbsCode: '5.1',
        taskName: 'عزل أرضيات الحمامات والمطابخ بمواد عزل أسمنتية واختبار الغمر بالماء 48 ساعة',
        startDate: waterBathStart,
        endDate: waterBathEnd,
        durationDays: 6,
        isCriticalPath: true,
        category: 'العوازل المائية والحرارية',
      });

      if (includeRoof) {
        const waterRoofStart = addDays(waterBathEnd, 1);
        const waterRoofEnd = addDays(waterRoofStart, 10);
        list.push({
          taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
          wbsCode: '5.2',
          taskName: 'عزل السطح النهائي (مائي ممبرين + حراري فوم XPS + خرسانة ميول واختبار الغمر)',
          startDate: waterRoofStart,
          endDate: waterRoofEnd,
          durationDays: 10,
          isCriticalPath: true,
          category: 'العوازل المائية والحرارية',
        });
        currentDate = addDays(waterRoofEnd, 1);
      } else {
        currentDate = addDays(waterBathEnd, 1);
      }
    }

    // 6. أعمال بياض المحارة بالأدوار (Plastering)
    if (has('plastering')) {
      let currentPlasterStart = currentDate;
      floors.forEach((fl, idx) => {
        const prepEnd = addDays(currentPlasterStart, plasterPrepDays);
        list.push({
          taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
          wbsCode: `6.${idx * 2 + 1}`,
          taskName: `طرطشة وبؤج وأوتار وسلك شبك فايبر للتقاطعات - ${fl}`,
          startDate: currentPlasterStart,
          endDate: prepEnd,
          durationDays: plasterPrepDays,
          isCriticalPath: true,
          category: 'بياض المحارة واللياسة',
        });

        const fillEnd = addDays(prepEnd, plasterFillDays);
        list.push({
          taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
          wbsCode: `6.${idx * 2 + 2}`,
          taskName: `ملو وتنعيم بياض المحارة واستواء الحوائط بميزان القامة - ${fl}`,
          startDate: prepEnd,
          endDate: fillEnd,
          durationDays: plasterFillDays,
          isCriticalPath: true,
          category: 'بياض المحارة واللياسة',
        });

        currentPlasterStart = addDays(prepEnd, 4);
      });
      currentDate = currentPlasterStart;
    }

    // 7. أعمال الأرضيات والكسوات (Flooring & Tiling)
    if (has('flooring')) {
      const tileStart = currentDate;
      const tileEnd = addDays(tileStart, 15);
      list.push({
        taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
        wbsCode: '7.1',
        taskName: 'توريد وتركيب سيراميك وبورسلين الأرضيات والحوائط للحمامات والغرف والريسبشن',
        startDate: tileStart,
        endDate: tileEnd,
        durationDays: 15,
        isCriticalPath: true,
        category: 'الأرضيات والكسوات',
      });

      const marbleStart = addDays(tileStart, 5);
      const marbleEnd = addDays(marbleStart, 10);
      list.push({
        taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
        wbsCode: '7.2',
        taskName: 'توريد وتركيب رخام السلالم والمداخل وبسطات الأدوار والوزرات وسقية الفواصل',
        startDate: marbleStart,
        endDate: marbleEnd,
        durationDays: 10,
        isCriticalPath: false,
        category: 'الأرضيات والكسوات',
      });

      currentDate = addDays(tileEnd, 1);
    }

    // 8. النجارة والألوميتال والكريتال (Carpentry, Aluminum & Metal)
    if (has('carpentry_aluminum')) {
      const frameStart = currentDate;
      const frameEnd = addDays(frameStart, 5);
      list.push({
        taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
        wbsCode: '8.1',
        taskName: 'تثبيت الحلوق الخشبية للأبواب (Zafra) والشاسيهات المعدنية',
        startDate: frameStart,
        endDate: frameEnd,
        durationDays: 5,
        isCriticalPath: false,
        category: 'النجارة والألوميتال والكريتال',
      });

      const alumStart = addDays(frameEnd, 1);
      const alumEnd = addDays(alumStart, 10);
      list.push({
        taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
        wbsCode: '8.2',
        taskName: 'توريد وتركيب شبابيك وواجهات الألوميتال مع الزجاج المزدوج والكاوتش',
        startDate: alumStart,
        endDate: alumEnd,
        durationDays: 10,
        isCriticalPath: true,
        category: 'النجارة والألوميتال والكريتال',
      });

      const critallStart = addDays(alumStart, 3);
      const critallEnd = addDays(critallStart, 8);
      list.push({
        taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
        wbsCode: '8.3',
        taskName: 'أعمال الكريتال ودرابزين السلالم والبلكونات وبوابات المداخل والسطح',
        startDate: critallStart,
        endDate: critallEnd,
        durationDays: 8,
        isCriticalPath: false,
        category: 'النجارة والألوميتال والكريتال',
      });

      const doorLeafStart = addDays(alumEnd, 2);
      const doorLeafEnd = addDays(doorLeafStart, 7);
      list.push({
        taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
        wbsCode: '8.4',
        taskName: 'تركيب ضلف الأبواب الخشبية والمقابض والكوالين ومصدات الأبواب',
        startDate: doorLeafStart,
        endDate: doorLeafEnd,
        durationDays: 7,
        isCriticalPath: false,
        category: 'النجارة والألوميتال والكريتال',
      });

      currentDate = addDays(doorLeafEnd, 1);
    }

    // 9. الأسقف المعلقة والدهانات والواجهات (Ceilings, Painting & Facades)
    if (has('painting_ceilings')) {
      const gypStart = currentDate;
      const gypEnd = addDays(gypStart, 10);
      list.push({
        taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
        wbsCode: '9.1',
        taskName: 'توريد وتركيب الأسقف المعلقة والجبسوم بورد وفتحات الإضاءة والتكييف',
        startDate: gypStart,
        endDate: gypEnd,
        durationDays: 10,
        isCriticalPath: false,
        category: 'الأسقف والدهانات والديكورات',
      });

      const paintStart = addDays(gypEnd, 1);
      const paintEnd = addDays(paintStart, 14);
      list.push({
        taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
        wbsCode: '9.2',
        taskName: 'سكاكين المعجون والبطانة وتشطيب الدهانات الداخلية للغرف والأسقف',
        startDate: paintStart,
        endDate: paintEnd,
        durationDays: 14,
        isCriticalPath: true,
        category: 'الأسقف والدهانات والديكورات',
      });

      currentDate = addDays(paintEnd, 1);
    }

    if (has('facades')) {
      const facadeStart = currentDate;
      const facadeEnd = addDays(facadeStart, 15);
      list.push({
        taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
        wbsCode: '9.3',
        taskName: 'نصب السقالات، سيلر وتشطيب سافيتو/جرافياتو للواجهات الخارجية الأربع',
        startDate: facadeStart,
        endDate: facadeEnd,
        durationDays: 15,
        isCriticalPath: false,
        category: 'تشطيب الواجهات الخارجية',
      });
      currentDate = addDays(facadeEnd, 1);
    }

    // 10. التشطيبات والتركيبات الكهروميكانيكية النهائية والتسليم
    if (has('elec_fixtures_testing')) {
      const elecFinalStart = currentDate;
      const elecFinalEnd = addDays(elecFinalStart, 6);
      list.push({
        taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
        wbsCode: '10.1',
        taskName: 'تشطيب الكهرباء (تركيب الوشوش والمفاتيح والبرايز ووحدات الإنارة والسبوتات)',
        startDate: elecFinalStart,
        endDate: elecFinalEnd,
        durationDays: 6,
        isCriticalPath: true,
        category: 'التشطيب والتسليم النهائي',
      });

      const meggerStart = addDays(elecFinalEnd, 1);
      const meggerEnd = addDays(meggerStart, 3);
      list.push({
        taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
        wbsCode: '10.2',
        taskName: 'اختبارات العزل الكهربائي والميجر (Megger Test) وإطلاق التيار والتشغيل التجريبي',
        startDate: meggerStart,
        endDate: meggerEnd,
        durationDays: 3,
        isCriticalPath: true,
        category: 'التشطيب والتسليم النهائي',
      });

      currentDate = addDays(meggerEnd, 1);
    }

    if (has('plumb_fixtures')) {
      const plumbFinalStart = currentDate;
      const plumbFinalEnd = addDays(plumbFinalStart, 5);
      list.push({
        taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
        wbsCode: '10.3',
        taskName: 'تشطيب السباكة (تثبيت الأطقم الصحية وخلاطات المياه وكبائن الشاور ومضخات الرفع)',
        startDate: plumbFinalStart,
        endDate: plumbFinalEnd,
        durationDays: 5,
        isCriticalPath: true,
        category: 'التشطيب والتسليم النهائي',
      });
      currentDate = addDays(plumbFinalEnd, 1);
    }

    if (has('hvac_systems')) {
      const hvacTestStart = currentDate;
      const hvacTestEnd = addDays(hvacTestStart, 4);
      list.push({
        taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
        wbsCode: '10.4',
        taskName: 'تركيب ماكينات التكييف والجريلات واختبارات التوازن الهوائي Air Balancing والتشغيل',
        startDate: hvacTestStart,
        endDate: hvacTestEnd,
        durationDays: 4,
        isCriticalPath: false,
        category: 'التشطيب والتسليم النهائي',
      });
    }

    // محضر التسليم الابتدائي إذا كان المشروع يشمل حزم متعددة
    if (selectedTrades.length >= 3 || has('earthwork_substructure') || has('concrete_superstructure')) {
      const cleanStart = currentDate;
      const cleanEnd = addDays(cleanStart, 5);
      list.push({
        taskCode: `TSK-${String(taskCounter++).padStart(3, '0')}`,
        wbsCode: '11.1',
        taskName: 'نظافة الموقع العام وإزالة المخلفات وإصدار محضر التسليم الابتدائي للمالك',
        startDate: cleanStart,
        endDate: cleanEnd,
        durationDays: 5,
        isCriticalPath: true,
        category: 'التشطيب والتسليم النهائي',
      });
    }

    return list;
  };

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
          <div style={{ padding: '24px', backgroundColor: '#f8fafc', borderRadius: '10px', border: '1px dashed #cbd5e1', textAlign: 'center' }}>
            <AppIcons.FileText size={40} style={{ color: '#170e5e', margin: '0 auto 12px' }} />
            <h3 style={{ fontSize: 'var(--font-section-title)', fontWeight: 700, color: '#1e293b', margin: '0 0 6px' }}>
              {__t('contracting.schedule_generator_modal.s10', "استيراد بيانات الجدول الزمني من ملف إكسيل")}
            </h3>
            <p style={{ fontSize: 'var(--font-body)', color: '#64748b', maxWidth: '540px', margin: '0 auto 16px' }}>
              {__t('contracting.schedule_generator_modal.s11', "يمكنك استيراد ملف إكسيل للجدول الزمني أو تطبيق القالب الإنشائي الميداني القياسي (حفر وأساسات + هيكل خرساني + تشطيبات متكاملة).")}
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
              <button
                type="button"
                onClick={handleImportExcelSample}
                style={{
                  padding: '8px 20px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: '#170e5e',
                  color: '#ffffff',
                  fontSize: 'var(--font-body)',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {__t('contracting.schedule_generator_modal.s12', "تطبيق القالب الإنشائي القياسي")}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Scope Selection Box */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 14px', backgroundColor: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <label style={{ fontSize: 'var(--font-body)', fontWeight: 700, color: '#170e5e' }}>
                  {__t('contracting.schedule_generator_modal.s13', "نطاق المشروع الإنشائي المطلوب توليده:")}
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {/* زر المزامنة مع المقايسة */}
                  {projectId && (
                    <button
                      type="button"
                      onClick={handleSyncFromBoq}
                      disabled={isSyncingBoq}
                      title={__t('contracting.schedule_generator_modal.s14', "فحص بنود مقايسة هذا المشروع وتحديد حزم الجدول الزمني تلقائياً")}
                      style={{
                        height: '30px',
                        padding: '0 10px',
                        borderRadius: '6px',
                        border: '1px solid #c7d2fe',
                        backgroundColor: '#eff6ff',
                        color: '#1d4ed8',
                        fontSize: 'var(--font-micro)',
                        fontWeight: 700,
                        cursor: isSyncingBoq ? 'wait' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                      }}
                    >
                      <AppIcons.RefreshCw size={12} />
                      <span>{isSyncingBoq ? __t('contracting.schedule_generator_modal.s15', "جارٍ قراءة المقايسة...") : __t('contracting.schedule_generator_modal.s16', "تحديد الحزم آلياً من مقايسة المشروع")}</span>
                    </button>
                  )}

                  {/* زر فتح/إغلاق تفاصيل الحزم الموديولار */}
                  <button
                    type="button"
                    onClick={() => setShowTradeSelector(!showTradeSelector)}
                    style={{
                      height: '30px',
                      padding: '0 10px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      backgroundColor: showTradeSelector ? '#170e5e' : '#ffffff',
                      color: showTradeSelector ? '#ffffff' : '#334155',
                      fontSize: 'var(--font-micro)',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    <AppIcons.Sliders size={12} />
                    <span>{__t('contracting.schedule_generator_modal.s17', "تخصيص الحزم (")}{selectedTrades.length} {__t('contracting.schedule_generator_modal.s18', "من")} {MODULAR_TRADES.length})</span>
                  </button>
                </div>
              </div>

              <CustomSelect
                options={SCOPE_OPTIONS}
                value={projectScope}
                onChange={(val) => handleScopeChange(val as ProjectScope)}
                placeholder={__t('contracting.schedule_generator_modal.s19', "اختر نطاق تنفيذ المشروع...")}
              />
            </div>

            {/* تفاصيل الحزم الموديولار التفاعلية (Modular Trade Selector Panel) */}
            {(showTradeSelector || projectScope === 'custom_modular') && (
              <div style={{ padding: '14px', backgroundColor: '#ffffff', borderRadius: '10px', border: '1px solid #cbd5e1', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <div style={{ fontSize: 'var(--font-section-title)', fontWeight: 700, color: '#0f172a' }}>
                      {__t('contracting.schedule_generator_modal.s20', "حزم وتخصصات الأعمال المشمولة في الجدول الزمني")}
                    </div>
                    <div style={{ fontSize: 'var(--font-micro)', color: '#64748b', marginTop: '2px' }}>
                      {__t('contracting.schedule_generator_modal.s21', "حدد الحزم التي يشملها عقدك؛ سيقوم المحرك بحصر الجدول الزمني عليها فقط وضبط التواريخ والاعتماديات بدقة.")}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTrades(MODULAR_TRADES.map((t) => t.id));
                        setProjectScope('custom_modular');
                      }}
                      style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                    >
                      {__t('contracting.schedule_generator_modal.s22', "تحديد الكل")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTrades(['elec_slab_earthing', 'elec_roughin_wiring', 'elec_fixtures_testing']);
                        setProjectScope('electrical_only');
                      }}
                      style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                    >
                      {__t('contracting.schedule_generator_modal.s23', "كهرباء فقط")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTrades(['plumb_roughin_drainage', 'plumb_fixtures', 'waterproofing']);
                        setProjectScope('plumbing_only');
                      }}
                      style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #a7f3d0', background: '#ecfdf5', color: '#047857', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                    >
                      {__t('contracting.schedule_generator_modal.s24', "سباكة وصحي فقط")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTrades(PRESET_TRADE_MAP['full_mep']);
                        setProjectScope('full_mep');
                      }}
                      style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #fde68a', background: '#fffbeb', color: '#b45309', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                    >
                      {__t('contracting.schedule_generator_modal.s25', "كهروميكانيك MEP")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTrades(PRESET_TRADE_MAP['architectural_finishes']);
                        setProjectScope('architectural_finishes');
                      }}
                      style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #e9d5ff', background: '#faf5ff', color: '#7e22ce', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                    >
                      {__t('contracting.schedule_generator_modal.s26', "تشطيبات معمارية")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTrades([]);
                        setProjectScope('custom_modular');
                      }}
                      style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #fee2e2', background: '#fef2f2', color: '#b91c1c', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                    >
                      {__t('contracting.schedule_generator_modal.s27', "إلغاء الكل")}
                    </button>
                  </div>
                </div>

                {/* شبكة بطاقات الحزم */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '8px', maxHeight: '250px', overflowY: 'auto', paddingInlineEnd: '4px' }}>
                  {MODULAR_TRADES.map((trade) => {
                    const isChecked = selectedTrades.includes(trade.id);
                    return (
                      <div
                        key={trade.id}
                        onClick={() => handleToggleTrade(trade.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '10px',
                          padding: '8px 10px',
                          borderRadius: '8px',
                          border: isChecked ? '1px solid #170e5e' : '1px solid #e2e8f0',
                          backgroundColor: isChecked ? '#f8fafc' : '#ffffff',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleTrade(trade.id)}
                          style={{ marginTop: '3px', cursor: 'pointer', accentColor: '#170e5e' }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                            <span style={{ fontSize: 'var(--font-body)', fontWeight: 700, color: isChecked ? '#170e5e' : '#1e293b' }}>
                              {trade.name}
                            </span>
                            <span
                              style={{
                                fontSize: '10px',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                backgroundColor: isChecked ? '#e0e7ff' : '#f1f5f9',
                                color: isChecked ? '#170e5e' : '#64748b',
                                fontWeight: 700,
                                flexShrink: 0,
                              }}
                            >
                              {trade.code}
                            </span>
                          </div>
                          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', lineHeight: 1.4 }}>
                            {trade.description}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Wizard Settings Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  {__t('contracting.schedule_generator_modal.s28', "تاريخ بدء أعمال المشروع *")}
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  style={{
                    width: '100%',
                    height: '36px',
                    padding: '0 10px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: 'var(--font-body)',
                    fontWeight: 600,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  {__t('contracting.schedule_generator_modal.s29', "عدد الأدوار المتكررة")}
                </label>
                <input
                  type="number"
                  min="1"
                  max="40"
                  value={floorsCount}
                  onChange={(e) => setFloorsCount(parseInt(e.target.value) || 1)}
                  style={{
                    width: '100%',
                    height: '36px',
                    padding: '0 10px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: 'var(--font-body)',
                    fontWeight: 700,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  {__t('contracting.schedule_generator_modal.s30', "مدة خرسانة الدور (أيام)")}
                </label>
                <input
                  type="number"
                  min="1"
                  value={concreteDaysPerFloor}
                  onChange={(e) => setConcreteDaysPerFloor(parseInt(e.target.value) || 1)}
                  style={{
                    width: '100%',
                    height: '36px',
                    padding: '0 10px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: 'var(--font-body)',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                  {__t('contracting.schedule_generator_modal.s31', "مدة مباني الدور (أيام)")}
                </label>
                <input
                  type="number"
                  min="1"
                  value={masonryDaysPerFloor}
                  onChange={(e) => setMasonryDaysPerFloor(parseInt(e.target.value) || 1)}
                  style={{
                    width: '100%',
                    height: '36px',
                    padding: '0 10px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: 'var(--font-body)',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            {/* Checkboxes for Basement and Roof */}
            <div style={{ display: 'flex', gap: '20px', padding: '10px 14px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--font-body)', cursor: 'pointer', fontWeight: 600, color: '#334155' }}>
                <input
                  type="checkbox"
                  checked={includeBasement}
                  onChange={(e) => setIncludeBasement(e.target.checked)}
                />
                <span>{__t('contracting.schedule_generator_modal.s32', "يشمل دور بدروم")}</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--font-body)', cursor: 'pointer', fontWeight: 600, color: '#334155' }}>
                <input
                  type="checkbox"
                  checked={includeRoof}
                  onChange={(e) => setIncludeRoof(e.target.checked)}
                />
                <span>{__t('contracting.schedule_generator_modal.s33', "يشمل دور سطح (روف) وغرف خدمات")}</span>
              </label>
            </div>

            {/* Live Schedule Preview Table */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <h4 style={{ fontSize: 'var(--font-section-title)', fontWeight: 700, color: '#1e293b', margin: 0 }}>
                    {__t('contracting.schedule_generator_modal.s34', "معاينة الجدول الزمني المولد (")}{previewTasks.length} {__t('contracting.schedule_generator_modal.s35', "نشاط ومرحلة)")}
                  </h4>
                  {customTasks !== null && (
                    <button
                      type="button"
                      onClick={() => setCustomTasks(null)}
                      title={__t('contracting.schedule_generator_modal.s36', "استعادة مدد وتواريخ القالب القياسي الافتراضية")}
                      style={{
                        fontSize: 'var(--font-micro)',
                        color: '#170e5e',
                        background: '#e0e7ff',
                        border: '1px solid #c7d2fe',
                        borderRadius: '6px',
                        padding: '3px 8px',
                        cursor: 'pointer',
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <AppIcons.RefreshCw size={11} />
                      <span>{__t('contracting.schedule_generator_modal.s37', "إعادة ضبط المدد للقالب")}</span>
                    </button>
                  )}
                </div>
                <span style={{ fontSize: 'var(--font-micro)', color: '#64748b' }}>
                  {__t('contracting.schedule_generator_modal.s38', "تاريخ الانتهاء المتوقع للمشروع:")} <strong style={{ color: '#170e5e', fontSize: '13px' }}>{previewTasks[previewTasks.length - 1]?.endDate || '-'}</strong>
                </span>
              </div>

              {previewTasks.length === 0 ? (
                <div style={{ border: '1px dashed #cbd5e1', borderRadius: '8px', padding: '32px', textAlign: 'center', backgroundColor: '#f8fafc' }}>
                  <AppIcons.AlertTriangle size={32} style={{ color: '#b45309', margin: '0 auto 8px' }} />
                  <div style={{ fontSize: 'var(--font-body)', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {__t('contracting.schedule_generator_modal.s39', "لم يتم تحديد أي حزمة أعمال حالياً")}
                  </div>
                  <div style={{ fontSize: 'var(--font-micro)', color: '#64748b', marginBottom: '12px' }}>
                    {__t('contracting.schedule_generator_modal.s40', "يرجى اختيار أحد القوالب التخصصية من القائمة أعلاه، أو تفعيل حزمة واحدة على الأقل لتوليد جدولها الزمني.")}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleScopeChange('full_turnkey')}
                    style={{
                      padding: '6px 16px',
                      borderRadius: '6px',
                      border: 'none',
                      backgroundColor: '#170e5e',
                      color: '#ffffff',
                      fontSize: 'var(--font-body)',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {__t('contracting.schedule_generator_modal.s41', "استعادة القالب المتكامل (تسليم مفتاح)")}
                  </button>
                </div>
              ) : (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden', maxHeight: '340px', overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
                    <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>
                      <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                        <th style={{ padding: '8px 10px', fontSize: 'var(--font-table-head)', color: '#475569', width: '80px', textAlign: 'center' }}>WBS</th>
                        <th style={{ padding: '8px 10px', fontSize: 'var(--font-table-head)', color: '#475569', width: '170px' }}>{__t('contracting.schedule_generator_modal.s42', "الحزمة الإنشائية")}</th>
                        <th style={{ padding: '8px 10px', fontSize: 'var(--font-table-head)', color: '#475569' }}>{__t('contracting.schedule_generator_modal.s43', "بيان النشاط والمرحلة")}</th>
                        <th style={{ padding: '8px 10px', fontSize: 'var(--font-table-head)', color: '#475569', width: '95px', textAlign: 'center' }}>{__t('contracting.schedule_generator_modal.s44', "البداية")}</th>
                        <th style={{ padding: '8px 10px', fontSize: 'var(--font-table-head)', color: '#475569', width: '95px', textAlign: 'center' }}>{__t('contracting.schedule_generator_modal.s45', "النهاية")}</th>
                        <th style={{ padding: '8px 6px', fontSize: 'var(--font-table-head)', color: '#170e5e', width: '100px', textAlign: 'center' }}>{__t('contracting.schedule_generator_modal.s46', "المدة (تعديل)")}</th>
                        <th style={{ padding: '8px 10px', fontSize: 'var(--font-table-head)', color: '#475569', width: '80px', textAlign: 'center' }}>{__t('contracting.schedule_generator_modal.s47', "المسار")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewTasks.map((t, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9', backgroundColor: idx % 2 === 0 ? '#ffffff' : '#fafafa' }}>
                          <td style={{ padding: '8px 10px', fontSize: 'var(--font-micro)', fontWeight: 700, color: '#170e5e', textAlign: 'center' }}>
                            {t.wbsCode}
                          </td>
                          <td style={{ padding: '8px 10px', fontSize: 'var(--font-micro)' }}>
                            <span style={{ padding: '2px 6px', borderRadius: '4px', backgroundColor: '#f1f5f9', color: '#475569', fontWeight: 600 }}>
                              {t.category}
                            </span>
                          </td>
                          <td style={{ padding: '6px 8px', fontSize: 'var(--font-body)', fontWeight: 600, color: '#1e293b' }}>
                            <input
                              type="text"
                              value={t.taskName}
                              onChange={(e) => handleTaskNameChange(idx, e.target.value)}
                              title={__t('contracting.schedule_generator_modal.s48', "انقر لتعديل مسمى النشاط")}
                              style={{
                                width: '100%',
                                height: '28px',
                                padding: '0 6px',
                                border: '1px solid transparent',
                                borderRadius: '4px',
                                background: 'transparent',
                                fontSize: 'var(--font-body)',
                                fontWeight: 600,
                                color: '#1e293b',
                                outline: 'none',
                                boxSizing: 'border-box',
                              }}
                              onFocus={(e) => {
                                e.target.style.borderColor = '#cbd5e1';
                                e.target.style.background = '#ffffff';
                              }}
                              onBlur={(e) => {
                                e.target.style.borderColor = 'transparent';
                                e.target.style.background = 'transparent';
                              }}
                            />
                          </td>
                          <td style={{ padding: '8px 8px', fontSize: 'var(--font-micro)', color: '#64748b', textAlign: 'center', whiteSpace: 'nowrap' }}>
                            {t.startDate}
                          </td>
                          <td style={{ padding: '8px 8px', fontSize: 'var(--font-micro)', color: '#64748b', textAlign: 'center', whiteSpace: 'nowrap' }}>
                            {t.endDate}
                          </td>
                          <td style={{ padding: '4px 6px', textAlign: 'center', verticalAlign: 'middle' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                              <input
                                type="number"
                                min="1"
                                max="365"
                                value={t.durationDays}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value, 10);
                                  if (!isNaN(val) && val >= 1) {
                                    handleTaskDurationChange(idx, val);
                                  }
                                }}
                                title={__t('contracting.schedule_generator_modal.s49', "انقر لتعديل مدة النشاط باليوم وترحيل باقي تواريخ الجدول تلقائياً")}
                                style={{
                                  width: '50px',
                                  height: '28px',
                                  padding: '0 4px',
                                  textAlign: 'center',
                                  borderRadius: '6px',
                                  border: '1px solid #cbd5e1',
                                  fontSize: 'var(--font-body)',
                                  fontWeight: 700,
                                  color: '#170e5e',
                                  background: '#ffffff',
                                  outline: 'none',
                                  boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)',
                                }}
                              />
                              <span style={{ fontSize: 'var(--font-micro)', fontWeight: 600, color: '#64748b' }}>{__t('contracting.schedule_generator_modal.s50', "يوم")}</span>
                            </div>
                          </td>
                          <td style={{ padding: '8px 10px', fontSize: 'var(--font-micro)', textAlign: 'center' }}>
                            {t.isCriticalPath ? (
                              <span style={{ padding: '2px 6px', borderRadius: '4px', backgroundColor: '#fee2e2', color: '#991b1b', fontWeight: 700 }}>
                                {__t('contracting.schedule_generator_modal.s51', "حرج CPM")}
                              </span>
                            ) : (
                              <span style={{ color: '#94a3b8' }}>{__t('contracting.schedule_generator_modal.s52', "عادي")}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </StandardDialog>
  );
}
