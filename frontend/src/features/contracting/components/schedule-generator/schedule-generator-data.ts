import { todayLocalDateKey } from '@/lib/format';

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

export const PRESET_TRADE_MAP: Record<ProjectScope, string[]> = {
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

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return todayLocalDateKey(d);
}
