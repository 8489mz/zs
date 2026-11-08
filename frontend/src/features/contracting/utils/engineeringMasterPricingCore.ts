/**
 * Universal Engineering Master Pricing Core
 * Provides instant out-of-the-box auto-pricing, BOM components breakdown,
 * and intelligent bilingual matching for BOQ importation.
 *
 * Covers ALL Engineering Trades:
 * 1. Fire Fighting & Protection (Piping, Valves, FHC, Extinguishers, Pumps, Suppression)
 * 2. Electrical Power Distribution & Infrastructure (MV Switchgear, Transformers, Cables, Earthing, Conduits, Panels)
 * 3. Low Current & Smart Security (CCTV, Fire Alarm, Intercom, Network/Data, Sound System)
 * 4. HVAC & Ventilation (Split DX, VRF, SMACNA Ducts, Centrifugal & Wall Fans, Copper Piping, Grilles)
 * 5. Plumbing, Drainage & Sanitary (PPR Water Supply, UPVC Drainage, Heaters, Pumps, Sanitary Ware, Tanks)
 * 6. Civil & Concrete Works (Excavation, Backfilling, PC Blinding, RC Foundations, RC Columns, RC Slabs)
 * 7. Masonry & Partitions (Solid Block, Hollow Block, AAC Lightweight Siporex, Lintels)
 * 8. Thermal & Moisture Protection / Waterproofing (Bituminous Membrane 4mm, Polyurethane, Cementitious, XPS 50mm)
 * 9. Architectural Finishes (Plastering, Paints, Ceramic, Porcelain, Marble, Granite, Interlock, Gypsum Ceiling)
 */

import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';

export interface EngineeringConstantItem {
  itemCode: string;
  itemName: string;
  description: string;
  unit: string;
  trade: string;
  directCost: number;
  wastePercent: number;
  overheadPercent: number;
  profitMarkupPercent: number;
  suggestedUnitPrice: number;
  components: {
    componentCode: string;
    componentName: string;
    unit: string;
    qtyPerUnit: number;
    unitRate: number;
    componentType: 'material' | 'labor' | 'equipment' | 'subcontractor';
  }[];
  keywords: string[];
}

export const HARDCODED_ENGINEERING_CONSTANTS: EngineeringConstantItem[] = [
  // ==========================================================================
  // 1. FIRE FIGHTING & SUPPRESSION
  // ==========================================================================
  {
    itemCode: 'FF-PIP-STM-25',
    itemName: 'مواسير صلب سيملس جدول 40 قطر 25 مم (1 بوصة)',
    description: 'توريد وتركيب مواسير صلب أسود سيملس غير ملحوم جدول 40 ASTM A53 مع اللوازم والدهان والتعليق',
    unit: 'm',
    trade: 'fire_fighting',
    directCost: 320,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 420,
    components: [
      { componentCode: 'MAT-FF-PIP-STM-25', componentName: 'مواسير صلب سيملس Sch 40 قطر 25 مم ولوازم مسننة', unit: 'm', qtyPerUnit: 1.05, unitRate: 240, componentType: 'material' },
      { componentCode: 'LAB-FF-PIP-FIT', componentName: 'مصنعيات تركيب ولحام وتعليق ودهان الحريق', unit: 'm', qtyPerUnit: 1, unitRate: 80, componentType: 'labor' },
    ],
    keywords: ['seamless', 'schedule 40', 'astm a53', '25mm', '25 mm', '1 inch', '1"', '1 بوصة', 'صلب اسود', 'سيملس'],
  },
  {
    itemCode: 'FF-PIP-STM-32',
    itemName: 'مواسير صلب سيملس جدول 40 قطر 32 مم (1.25 بوصة)',
    description: 'توريد وتركيب مواسير صلب أسود سيملس غير ملحوم جدول 40 ASTM A53 مع اللوازم والتعليق',
    unit: 'm',
    trade: 'fire_fighting',
    directCost: 410,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 540,
    components: [
      { componentCode: 'MAT-FF-PIP-STM-32', componentName: 'مواسير صلب سيملس Sch 40 قطر 32 مم ولوازم', unit: 'm', qtyPerUnit: 1.05, unitRate: 310, componentType: 'material' },
      { componentCode: 'LAB-FF-PIP-FIT', componentName: 'مصنعيات تركيب ولحام وتعليق ودهان', unit: 'm', qtyPerUnit: 1, unitRate: 100, componentType: 'labor' },
    ],
    keywords: ['seamless', 'schedule 40', '32mm', '32 mm', '1.25', '1 1/4', '1.25 بوصة'],
  },
  {
    itemCode: 'FF-PIP-STM-40',
    itemName: 'مواسير صلب سيملس جدول 40 قطر 40 مم (1.5 بوصة)',
    description: 'توريد وتركيب مواسير صلب أسود سيملس غير ملحوم جدول 40 ASTM A53 قطر 40 مم مع لوازم اللحام والتعليق',
    unit: 'm',
    trade: 'fire_fighting',
    directCost: 520,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 685,
    components: [
      { componentCode: 'MAT-FF-PIP-STM-40', componentName: 'مواسير صلب سيملس Sch 40 قطر 40 مم ولوازم اللحام', unit: 'm', qtyPerUnit: 1.05, unitRate: 400, componentType: 'material' },
      { componentCode: 'LAB-FF-PIP-FIT', componentName: 'مصنعيات تركيب وتعليق واختبار هيدروستاتيكي', unit: 'm', qtyPerUnit: 1, unitRate: 120, componentType: 'labor' },
    ],
    keywords: ['seamless', 'schedule 40', '40mm', '40 mm', '1.5', '1 1/2', '1.5 بوصة', 'بوصة ونصف'],
  },
  {
    itemCode: 'FF-PIP-STM-50',
    itemName: 'مواسير صلب سيملس جدول 40 قطر 50 مم (2 بوصة)',
    description: 'توريد وتركيب مواسير صلب أسود سيملس غير ملحوم جدول 40 ASTM A53 قطر 50 مم مع لوازم اللحام/الجروف والتعليق',
    unit: 'm',
    trade: 'fire_fighting',
    directCost: 680,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 895,
    components: [
      { componentCode: 'MAT-FF-PIP-STM-50', componentName: 'مواسير صلب سيملس Sch 40 قطر 50 مم', unit: 'm', qtyPerUnit: 1.05, unitRate: 530, componentType: 'material' },
      { componentCode: 'LAB-FF-PIP-FIT', componentName: 'مصنعيات لحام وتركيب حوامل C-Channel ودهان إيبوكسي', unit: 'm', qtyPerUnit: 1, unitRate: 150, componentType: 'labor' },
    ],
    keywords: ['seamless', 'schedule 40', '50mm', '50 mm', '2 inch', '2"', '2 بوصة'],
  },
  {
    itemCode: 'FF-PIP-STM-65',
    itemName: 'مواسير صلب سيملس جدول 40 قطر 65 مم (2.5 بوصة)',
    description: 'توريد وتركيب مواسير صلب أسود سيملس غير ملحوم جدول 40 ASTM A53 قطر 65 مم مع كبلنجات جروف وحوامل زلزالية',
    unit: 'm',
    trade: 'fire_fighting',
    directCost: 890,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 1170,
    components: [
      { componentCode: 'MAT-FF-PIP-STM-65', componentName: 'مواسير صلب سيملس Sch 40 قطر 65 مم وكبلنجات Grooved', unit: 'm', qtyPerUnit: 1.05, unitRate: 710, componentType: 'material' },
      { componentCode: 'LAB-FF-PIP-FIT', componentName: 'مصنعيات تركيب وحوامل وتثبيت', unit: 'm', qtyPerUnit: 1, unitRate: 180, componentType: 'labor' },
    ],
    keywords: ['seamless', 'schedule 40', '65mm', '65 mm', '2.5', '2 1/2', '2.5 بوصة', 'بوصتين ونصف'],
  },
  {
    itemCode: 'FF-PIP-STM-80',
    itemName: 'مواسير صلب سيملس جدول 40 قطر 80 مم (3 بوصة)',
    description: 'توريد وتركيب مواسير صلب أسود سيملس غير ملحوم جدول 40 ASTM A53 قطر 80 مم مع وصلات جروف وحوامل',
    unit: 'm',
    trade: 'fire_fighting',
    directCost: 1180,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 1550,
    components: [
      { componentCode: 'MAT-FF-PIP-STM-80', componentName: 'مواسير صلب سيملس Sch 40 قطر 80 مم ولوازم', unit: 'm', qtyPerUnit: 1.05, unitRate: 950, componentType: 'material' },
      { componentCode: 'LAB-FF-PIP-FIT', componentName: 'مصنعيات تركيب ولحام/جروف واختبار', unit: 'm', qtyPerUnit: 1, unitRate: 230, componentType: 'labor' },
    ],
    keywords: ['seamless', 'schedule 40', '80mm', '80 mm', '3 inch', '3"', '3 بوصة'],
  },
  {
    itemCode: 'FF-PIP-STM-100',
    itemName: 'مواسير صلب سيملس جدول 40 قطر 100 مم (4 بوصة)',
    description: 'توريد وتركيب مواسير صلب أسود سيملس غير ملحوم جدول 40 ASTM A53 قطر 100 مم لخطوط التغذية الرئيسية والصواعد',
    unit: 'm',
    trade: 'fire_fighting',
    directCost: 1650,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 2170,
    components: [
      { componentCode: 'MAT-FF-PIP-STM-100', componentName: 'مواسير صلب سيملس Sch 40 قطر 100 مم ولوازم جروف', unit: 'm', qtyPerUnit: 1.05, unitRate: 1350, componentType: 'material' },
      { componentCode: 'LAB-FF-PIP-FIT', componentName: 'مصنعيات رفع وتركيب وتثبيت صواعد واختبار', unit: 'm', qtyPerUnit: 1, unitRate: 300, componentType: 'labor' },
    ],
    keywords: ['seamless', 'schedule 40', '100mm', '100 mm', '4 inch', '4"', '4 بوصة'],
  },
  {
    itemCode: 'FF-PIP-STM-150',
    itemName: 'مواسير صلب سيملس جدول 40 قطر 150 مم (6 بوصة)',
    description: 'توريد وتركيب مواسير صلب أسود سيملس غير ملحوم جدول 40 ASTM A53 قطر 150 مم لشبكة غرف الطلمبات والهيدر الرئيسي',
    unit: 'm',
    trade: 'fire_fighting',
    directCost: 2750,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 3620,
    components: [
      { componentCode: 'MAT-FF-PIP-STM-150', componentName: 'مواسير صلب سيملس Sch 40 قطر 150 مم وفلانشات', unit: 'm', qtyPerUnit: 1.05, unitRate: 2300, componentType: 'material' },
      { componentCode: 'LAB-FF-PIP-FIT', componentName: 'مصنعيات تركيب ولحام واختبار هيدروستاتيكي', unit: 'm', qtyPerUnit: 1, unitRate: 450, componentType: 'labor' },
    ],
    keywords: ['seamless', 'schedule 40', '150mm', '150 mm', '6 inch', '6"', '6 بوصة'],
  },
  {
    itemCode: 'FF-PIP-HDP-65',
    itemName: 'مواسير بولي إيثيلين عالي الكثافة HDPE SDR11 قطر 65 مم',
    description: 'توريد وتركيب مواسير HDPE SDR11 قطر 65 مم مدفونة مع وصلات اللحام الكهربي Electrofusion وشريط التحذير',
    unit: 'm',
    trade: 'fire_fighting',
    directCost: 480,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 630,
    components: [
      { componentCode: 'MAT-FF-PIP-HDP-65', componentName: 'مواسير HDPE SDR11 قطر 65 مم ولوازم فيوجن', unit: 'm', qtyPerUnit: 1.05, unitRate: 360, componentType: 'material' },
      { componentCode: 'LAB-FF-PIP-HDP', componentName: 'مصنعيات فرد ولحام ماكينة إلكتروفيوجن واختبار ضغط', unit: 'm', qtyPerUnit: 1, unitRate: 120, componentType: 'labor' },
    ],
    keywords: ['hdpe', 'sdr11', 'sdr 11', '65mm', '65 mm', 'بولي ايثيلين', 'مدفون'],
  },
  {
    itemCode: 'FF-PIP-HDP-90',
    itemName: 'مواسير بولي إيثيلين عالي الكثافة HDPE SDR11 قطر 90 مم',
    description: 'توريد وتركيب مواسير HDPE SDR11 قطر 90 مم مدفونة تحت الأرض لشبكة الحريق الخارجية مع كتل التثبيت Thrust Blocks',
    unit: 'm',
    trade: 'fire_fighting',
    directCost: 650,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 855,
    components: [
      { componentCode: 'MAT-FF-PIP-HDP-90', componentName: 'مواسير HDPE SDR11 قطر 90 مم ولوازم كهرواحتكاكية', unit: 'm', qtyPerUnit: 1.05, unitRate: 500, componentType: 'material' },
      { componentCode: 'LAB-FF-PIP-HDP', componentName: 'مصنعيات لحام بولي إيثيلين واختبار 1.5 ضغط التشغيل', unit: 'm', qtyPerUnit: 1, unitRate: 150, componentType: 'labor' },
    ],
    keywords: ['hdpe', 'sdr11', 'sdr 11', '90mm', '90 mm', 'بولي ايثيلين 90'],
  },
  {
    itemCode: 'FF-PIP-HDP-110',
    itemName: 'مواسير بولي إيثيلين عالي الكثافة HDPE SDR11 قطر 110 مم',
    description: 'توريد وتركيب مواسير HDPE SDR11 قطر 110 مم مدفونة مع محابس الغسيل وغرف الصمامات والردم بالرمل النظيف',
    unit: 'm',
    trade: 'fire_fighting',
    directCost: 880,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 1160,
    components: [
      { componentCode: 'MAT-FF-PIP-HDP-110', componentName: 'مواسير HDPE SDR11 قطر 110 مم ولوازم Butt-Fusion', unit: 'm', qtyPerUnit: 1.05, unitRate: 690, componentType: 'material' },
      { componentCode: 'LAB-FF-PIP-HDP', componentName: 'مصنعيات لحام تناكبي ومد واختبار الشبكة', unit: 'm', qtyPerUnit: 1, unitRate: 190, componentType: 'labor' },
    ],
    keywords: ['hdpe', 'sdr11', 'sdr 11', '110mm', '110 mm', 'بولي ايثيلين 110'],
  },
  {
    itemCode: 'FF-PIP-HDP-160',
    itemName: 'مواسير بولي إيثيلين عالي الكثافة HDPE SDR11 قطر 160 مم',
    description: 'توريد وتركيب مواسير HDPE SDR11 قطر 160 مم لحلقات شبكة الحريق الخارجية Ring Main',
    unit: 'm',
    trade: 'fire_fighting',
    directCost: 1450,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 1900,
    components: [
      { componentCode: 'MAT-FF-PIP-HDP-160', componentName: 'مواسير HDPE SDR11 قطر 160 مم', unit: 'm', qtyPerUnit: 1.05, unitRate: 1150, componentType: 'material' },
      { componentCode: 'LAB-FF-PIP-HDP', componentName: 'مصنعيات تركيب ولحام تناكبي واختبار', unit: 'm', qtyPerUnit: 1, unitRate: 300, componentType: 'labor' },
    ],
    keywords: ['hdpe', 'sdr11', 'sdr 11', '160mm', '160 mm'],
  },
  {
    itemCode: 'FF-SPK-PEND-15',
    itemName: 'رشاش حريق متدلي سقفى Pendent Sprinkler قطر 1/2 بوصة معتمد UL/FM',
    description: 'توريد وتركيب رشاش حريق أوتوماتيكي متدلي سقفى Pendent زجاجة حرارية 68°C درجة حرارة قياسية K-Factor 5.6 مع الوردة الديكورية Escutcheon Plate',
    unit: 'item',
    trade: 'fire_fighting',
    directCost: 180,
    wastePercent: 3,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 240,
    components: [
      { componentCode: 'MAT-FF-SPK-PEND', componentName: 'رشاش حريق Pendent نحاسي كروم K=5.6 معتمد UL/FM ووردة ديكور', unit: 'item', qtyPerUnit: 1, unitRate: 140, componentType: 'material' },
      { componentCode: 'LAB-FF-SPK-INST', componentName: 'مصنعيات تركيب وضبط مع السقف المعلق وتفلون واختبار', unit: 'item', qtyPerUnit: 1, unitRate: 40, componentType: 'labor' },
    ],
    keywords: ['pendent sprinkler', 'sprinkler', 'رشاش متدلي', 'رشاش حريق', 'رشاشات', 'escutcheon'],
  },
  {
    itemCode: 'FF-SPK-UPR-15',
    itemName: 'رشاش حريق قائم Upright Sprinkler قطر 1/2 بوصة معتمد UL/FM',
    description: 'توريد وتركيب رشاش حريق قائم Upright 68°C للمناطق المفتوحة بدون أسقف معلقة K=5.6',
    unit: 'item',
    trade: 'fire_fighting',
    directCost: 175,
    wastePercent: 3,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 230,
    components: [
      { componentCode: 'MAT-FF-SPK-UPR', componentName: 'رشاش حريق Upright برونزي K=5.6 معتمد', unit: 'item', qtyPerUnit: 1, unitRate: 135, componentType: 'material' },
      { componentCode: 'LAB-FF-SPK-INST', componentName: 'مصنعيات ربط وتركيب وضبط اتجاه', unit: 'item', qtyPerUnit: 1, unitRate: 40, componentType: 'labor' },
    ],
    keywords: ['upright sprinkler', 'رشاش قائم', 'upright'],
  },
  {
    itemCode: 'FF-VLV-ZCV-100',
    itemName: 'محبس تحكم قطاعي Zone Control Valve Assembly قطر 100 مم معتمد',
    description: 'توريد وتركيب وتوصيل مجمع محابس تحكم قطاعي ZCV يشمل محبس فراشة مزود بمفتاح مراقبة Tamper Switch ومؤشر تدفق مياه Water Flow Switch ووصلة اختبار وتصريف Test & Drain ومانومتر ضغط',
    unit: 'set',
    trade: 'fire_fighting',
    directCost: 28000,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 36500,
    components: [
      { componentCode: 'MAT-FF-ZCV-ASSY', componentName: 'مجموعة ZCV كاملة (Butterfly Valve + Flow Switch + Test & Drain + Sight Glass)', unit: 'set', qtyPerUnit: 1, unitRate: 24000, componentType: 'material' },
      { componentCode: 'LAB-FF-ZCV-INST', componentName: 'مصنعيات تجميع وتركيب وربط كهربي مع لوحة الإنذار واختبار السريان', unit: 'set', qtyPerUnit: 1, unitRate: 4000, componentType: 'labor' },
    ],
    keywords: ['zone control valve', 'zcv', 'flow switch', 'test & drain', 'محبس قطاعي', 'محبس تدفق'],
  },
  {
    itemCode: 'FF-VLV-NRS-80',
    itemName: 'محبس سكينة غير صاعد العزم NRS Gate Valve قطر 80 مم',
    description: 'توريد وتركيب محبس سكينة NRS Gate Valve 300 PSI مع مفتاح تشغيل T-Key ووصلات الربط Tie-in والغرفة المدفونة',
    unit: 'item',
    trade: 'fire_fighting',
    directCost: 7500,
    wastePercent: 3,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 9800,
    components: [
      { componentCode: 'MAT-FF-VLV-NRS-80', componentName: 'محبس NRS Gate Valve معتمد UL/FM ومؤشر وضعية', unit: 'item', qtyPerUnit: 1, unitRate: 6200, componentType: 'material' },
      { componentCode: 'LAB-FF-VLV-FIT', componentName: 'مصنعيات تركيب وربط Tie-in وصب صندوق تشغيل', unit: 'item', qtyPerUnit: 1, unitRate: 1300, componentType: 'labor' },
    ],
    keywords: ['gate valve', 'nrs', 'tie-in', 'tie in', 'محبس سكينة', 'محبس ربط', 'valve', '80mm', '3"'],
  },
  {
    itemCode: 'FF-VLV-OSY-100',
    itemName: 'محبس سكينة صاعد العزم OS&Y Gate Valve مع Tamper Switch قطر 100 مم',
    description: 'توريد وتركيب محبس سكينة صاعد العزم OS&Y مع مفتاح مراقبة كهربي معتمد UL/FM',
    unit: 'item',
    trade: 'fire_fighting',
    directCost: 11500,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 15000,
    components: [
      { componentCode: 'MAT-FF-VLV-OSY-100', componentName: 'محبس OS&Y 100 مم مع مفتاح مراقبة Tamper Switch', unit: 'item', qtyPerUnit: 1, unitRate: 9800, componentType: 'material' },
      { componentCode: 'LAB-FF-VLV-FIT', componentName: 'مصنعيات تركيب وضبط وربط مع لوحة الإنذار', unit: 'item', qtyPerUnit: 1, unitRate: 1700, componentType: 'labor' },
    ],
    keywords: ['os&y', 'osy', 'tamper switch', 'gate valve', 'صاعد العزم', 'محبس مراقبة'],
  },
  {
    itemCode: 'FF-VLV-AAV-25',
    itemName: 'محبس تصريف هواء أوتوماتيكي Automatic Air Vent قطر 25 مم',
    description: 'توريد وتركيب صمام تنفيس هواء آلي Automatic Air Release Valve مع محبس عزل نحاسي كروي ومحبس تصريف',
    unit: 'item',
    trade: 'fire_fighting',
    directCost: 1850,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 2450,
    components: [
      { componentCode: 'MAT-FF-VLV-AAV-25', componentName: 'صمام تفريغ هواء آلي AAV من البرونز 300 PSI مع محبس كروي', unit: 'item', qtyPerUnit: 1, unitRate: 1500, componentType: 'material' },
      { componentCode: 'LAB-FF-VLV-FIT', componentName: 'مصنعيات تركيب في أعلى نقطة بالشبكة واختبار التنفيس', unit: 'item', qtyPerUnit: 1, unitRate: 350, componentType: 'labor' },
    ],
    keywords: ['air vent', 'automatic air vent', 'aav', 'a.a.v', 'تنفيس هواء', 'تصريف هواء', 'صمام هواء'],
  },
  {
    itemCode: 'FF-FHC-COMB-02',
    itemName: 'كابينة حريق مزدوجة غاطسة/ظاهرة FHC متكاملة',
    description: 'توريد وتركيب دولاب حريق إستانلس/صاج إلكتروستاتيك مزدوج مع بكرة خرطوم 1 بوصة ومحبس هبوط 2.5 بوصة وطفاية حريق بودرة 6 كجم و CO2 6 كجم',
    unit: 'item',
    trade: 'fire_fighting',
    directCost: 14200,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 18600,
    components: [
      { componentCode: 'MAT-FF-FHC-CAB', componentName: 'كابينة حريق مزدوجة باب زجاجي وبكرة مطاطية 30م ومحبس لاندنج 2.5 بوصة', unit: 'item', qtyPerUnit: 1, unitRate: 11800, componentType: 'material' },
      { componentCode: 'MAT-FF-EXT-DRY', componentName: 'طفاية حريق بودرة جافة 6 كجم ABC معتمدة', unit: 'item', qtyPerUnit: 1, unitRate: 1100, componentType: 'material' },
      { componentCode: 'LAB-FF-FHC-INST', componentName: 'مصنعيات تكسير وتثبيت وتوصيل بالشبكة واختبار الضغط والتصريف', unit: 'item', qtyPerUnit: 1, unitRate: 1300, componentType: 'labor' },
    ],
    keywords: ['hose cabinet', 'fhc', 'صندوق حريق', 'كابينة حريق', 'بكرة خرطوم', 'hose reel', 'fire cabinet', 'دولاب حريق'],
  },
  {
    itemCode: 'FF-FHC-SGL-01',
    itemName: 'كابينة حريق فردية بكرة خرطوم مطاطي 1 بوصة 30 متر',
    description: 'توريد وتركيب صندوق حريق مفرد صاج معالج مع بكرة خرطوم 1 بوصة وبشبوري نحاسي وطفاية بودرة',
    unit: 'item',
    trade: 'fire_fighting',
    directCost: 8800,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 11500,
    components: [
      { componentCode: 'MAT-FF-FHC-SGL', componentName: 'كابينة حريق فردية مع بكرة مطاط 30 متر وطفاية 6 كجم', unit: 'item', qtyPerUnit: 1, unitRate: 7600, componentType: 'material' },
      { componentCode: 'LAB-FF-FHC-INST', componentName: 'مصنعيات تثبيت وتوصيل وتجربة', unit: 'item', qtyPerUnit: 1, unitRate: 1200, componentType: 'labor' },
    ],
    keywords: ['single cabinet', 'كابينة مفردة', 'صندوق مفرد'],
  },
  {
    itemCode: 'FF-EXT-DRY-06',
    itemName: 'طفاية حريق بودرة كيميائية جافة ABC سعة 6 كجم',
    description: 'توريد وتعليق طفاية حريق بودرة كيميائية جافة ABC سعة 6 كجم معتمدة UL/BSI/الدفاع المدني مع الحامل الجداري والخرطوم والمانومتر',
    unit: 'item',
    trade: 'fire_fighting',
    directCost: 1100,
    wastePercent: 1,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 1450,
    components: [
      { componentCode: 'MAT-FF-EXT-DRY-06', componentName: 'طفاية بودرة كيميائية 6 كجم معبأة ومختومة مع الحامل والتعليمات الإرشادية', unit: 'item', qtyPerUnit: 1, unitRate: 980, componentType: 'material' },
      { componentCode: 'LAB-FF-EXT-INST', componentName: 'مصنعيات تثبيت حامل الحائط وعلامة الطوارئ الفوتولومينيسنت', unit: 'item', qtyPerUnit: 1, unitRate: 120, componentType: 'labor' },
    ],
    keywords: ['extinguisher', 'dry chemical', 'dry powder', 'abc', 'طفاية بودرة', 'طفاية 6 كجم', 'طفايات', 'بودرة جافة'],
  },
  {
    itemCode: 'FF-EXT-CO2-06',
    itemName: 'طفاية حريق غاز ثاني أكسيد الكربون CO2 سعة 6 كجم',
    description: 'توريد وتعليق طفاية حريق غاز ثاني أكسيد الكربون CO2 سعة 6 كجم للوحات الكهرباء وغرف التحكم مع البوق العازل',
    unit: 'item',
    trade: 'fire_fighting',
    directCost: 2200,
    wastePercent: 1,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 2900,
    components: [
      { componentCode: 'MAT-FF-EXT-CO2-06', componentName: 'طفاية غاز CO2 سعة 6 كجم سبيكة ألومنيوم/صلب غير ملحومة معتمدة', unit: 'item', qtyPerUnit: 1, unitRate: 1950, componentType: 'material' },
      { componentCode: 'LAB-FF-EXT-INST', componentName: 'مصنعيات تعليق وتثبيت ولافتة تحذيرية', unit: 'item', qtyPerUnit: 1, unitRate: 250, componentType: 'labor' },
    ],
    keywords: ['co2', 'carbon dioxide', 'ثاني أكسيد الكربون', 'ثاني اكسيد', 'طفاية co2'],
  },
  {
    itemCode: 'FF-SYS-FSRCH-01',
    itemName: 'نظام إطفاء ذاتي ذكي للوحات الكهرباء (Fire Search Tube System CO2 / Clean Agent)',
    description: 'توريد وتركيب واختبار نظام إطفاء ذاتي ذكي للوحات التوزيع الكهربائية والمحولات يعمل بأنبوب الاستشعار الحراري البوليمري المباشر/غير المباشر مع أسطوانة الغاز ومفتاح الضغط وربطه بإنذار المبنى',
    unit: 'set',
    trade: 'fire_fighting',
    directCost: 28500,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 37500,
    components: [
      { componentCode: 'MAT-FF-FSRCH-CYL', componentName: 'أسطوانة غاز إطفاء CO2/Clean Agent مع محبس تفريغ تفاضلي وحساس حراري بوليمري', unit: 'set', qtyPerUnit: 1, unitRate: 22500, componentType: 'material' },
      { componentCode: 'MAT-FF-FSRCH-ACC', componentName: 'مفتاح ضغط كهربائي Pressure Switch ووصلات وسارينة وكلاكس إنذار', unit: 'set', qtyPerUnit: 1, unitRate: 2800, componentType: 'material' },
      { componentCode: 'LAB-FF-FSRCH-INST', componentName: 'مصنعيات تمديد الأنبوب الحراري داخل خلايا اللوحة وبرمجة واختبار التشغيل', unit: 'set', qtyPerUnit: 1, unitRate: 3200, componentType: 'labor' },
    ],
    keywords: ['fire search', 'firesearch', 'self actuating', 'tube system', 'أنبوب حراري', 'نظام ذاتي', 'اطفاء لوحات', 'لوحات الكهرباء', 'خرطوم حراري'],
  },
  {
    itemCode: 'FF-TST-COMM-01',
    itemName: 'أعمال غسيل واختبارات الضغط الهيدروستاتيكي والتسليم للاستشاري والدفاع المدني',
    description: 'إجراء غسيل شبكة الحريق بالكامل Flushing واختبار الضغط الهيدروستاتيكي عند 200 PSI أو 1.5 ضغط التشغيل لمدة ساعتين وتقديم شهادات الفحص والتسليم للدفاع المدني والاستشاري',
    unit: 'ls',
    trade: 'fire_fighting',
    directCost: 15000,
    wastePercent: 0,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 19800,
    components: [
      { componentCode: 'EQP-FF-HYDRO-PUMP', componentName: 'طلمبة اختبار ضغط هيدروستاتيكي عالية الدقة ومسجلات ضغط معيرة وشهادات', unit: 'ls', qtyPerUnit: 1, unitRate: 6000, componentType: 'equipment' },
      { componentCode: 'LAB-FF-COMM-ENG', componentName: 'أطقم مهندسين وفنيي اختبار وتشغيل وتسليم رسمي للاستشاري', unit: 'ls', qtyPerUnit: 1, unitRate: 9000, componentType: 'labor' },
    ],
    keywords: ['testing', 'commissioning', 'flushing', 'hydrostatic', 'اختبار ضغط', 'غسيل الشبكة', 'تسليم دفاع مدني', 'مقطوعية اختبار'],
  },
  {
    itemCode: 'FF-BLD-WRK-01',
    itemName: 'الأعمال المدنية المساعدة وفتحات الاختراق والجرابات والترميم (Builder\'s Works)',
    description: 'تنفيذ أعمال الكور والتخريم وتمرير الجرابات المعدنية Sleeves وفواصل الحريق المقاومة للحريق Firestop والترميم والدهان',
    unit: 'ls',
    trade: 'fire_fighting',
    directCost: 12000,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 15800,
    components: [
      { componentCode: 'MAT-FF-FIRESTOP', componentName: 'موانع حريق Firestop سيلانت ومونة حرارية معتمدة وجلب معدنية', unit: 'ls', qtyPerUnit: 1, unitRate: 5500, componentType: 'material' },
      { componentCode: 'LAB-FF-BLD-WRK', componentName: 'مصنعيات كور خرساني وتثبيت الجرابات والترميم المدني والدهانات', unit: 'ls', qtyPerUnit: 1, unitRate: 6500, componentType: 'labor' },
    ],
    keywords: ['builder', 'builder\'s works', 'core', 'sleeves', 'اعمال مدنية مساعدة', 'تخريم', 'جرابات', 'ترميم'],
  },
  {
    itemCode: 'FF-MTR-REQ-01',
    itemName: 'المتطلبات والتوصيلات الكهربائية لمحركات ولوحات شبكة مكافحة الحريق',
    description: 'توريد وتركيب وتوصيل كافة الكابلات المقاومة للحريق وقواطع التيار وبوادئ الحركة Star-Delta / Soft Starters والربط مع لوحة التحكم',
    unit: 'ls',
    trade: 'fire_fighting',
    directCost: 18000,
    wastePercent: 3,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 23500,
    components: [
      { componentCode: 'MAT-FF-MTR-CAB', componentName: 'كابلات مقاومة للحريق وقواطع ومهمات ربط كهربي', unit: 'ls', qtyPerUnit: 1, unitRate: 14500, componentType: 'material' },
      { componentCode: 'LAB-FF-MTR-INST', componentName: 'مصنعيات تمديد وتوصيل وبرمجة لوحة التحكم', unit: 'ls', qtyPerUnit: 1, unitRate: 3500, componentType: 'labor' },
    ],
    keywords: ['electrical requirements', 'motor starters', 'متطلبات كهربية', 'محركات ولوحات'],
  },

  // ==========================================================================
  // 2. ELECTRICAL POWER & INFRASTRUCTURE
  // ==========================================================================
  {
    itemCode: 'EL-SWG-MED-24',
    itemName: 'لوحة التوزيع الرئيسية للجهد المتوسط 24 ك.ف (الموزع) 10 خلايا',
    description: 'توريد وتركيب وتوصيل واختبار لوحة التوزيع الرئيسية للجهد المتوسط جهد 24 ك.ف عدد 10 خلايا (2 دخول - 6 خروج - باسبار - ربط) مع القواطع ووحدة بطاريات التحكم والشاحن',
    unit: 'item',
    trade: 'electrical_power',
    directCost: 7200000,
    wastePercent: 1,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 9300000,
    components: [
      { componentCode: 'MAT-EL-SWG-MED-24', componentName: 'خلايا لوحة جهد متوسط 24 ك.ف وقواطع SF6/Vacuum وباسبار نحاس', unit: 'item', qtyPerUnit: 1, unitRate: 6500000, componentType: 'material' },
      { componentCode: 'MAT-EL-BAT-CHG', componentName: 'وحدة بطاريات النيكل كادميوم والشاحن الآلي ولوحة التحكم', unit: 'item', qtyPerUnit: 1, unitRate: 450000, componentType: 'material' },
      { componentCode: 'LAB-EL-SWG-INST', componentName: 'مصنعيات تركيب واختبارات حقن وتتابع أطوار واعتماد شركة التوزيع', unit: 'item', qtyPerUnit: 1, unitRate: 250000, componentType: 'labor' },
    ],
    keywords: ['لوحة التوزيع الرئيسية', 'الموزع', 'جهد متوسط', '24 ك ف', '24kv', 'switchgear', '10 خليه', '10 خلايا'],
  },
  {
    itemCode: 'EL-TRF-DRY-1000',
    itemName: 'كشك محول كهربائي جاف قدرة 1000 ك.ف.أ جهد 24 ك.ف متكامل',
    description: 'توريد وتركيب وتوصيل واختبار كشك محول كهربائي 24 ك.ف جاف قدرة 1000 ك.ف.أ مع حلقة الربط RMU 3+1 ولوحة الضغط المنخفض بقاطع عمومي 2000A وفيوزات',
    unit: 'item',
    trade: 'electrical_power',
    directCost: 2600000,
    wastePercent: 1,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 3350000,
    components: [
      { componentCode: 'MAT-EL-TRF-1000', componentName: 'محول جاف 1000 ك.ف.أ جهد 24/0.4 ك.ف مع وحدة RMU ولوحة منخفض 2000A', unit: 'item', qtyPerUnit: 1, unitRate: 2400000, componentType: 'material' },
      { componentCode: 'LAB-EL-TRF-INST', componentName: 'مصنعيات تركيب الكشك والقواعد واختبارات العزل والتسليم لشركة التوزيع', unit: 'item', qtyPerUnit: 1, unitRate: 200000, componentType: 'labor' },
    ],
    keywords: ['كشك محول', 'محول كهربائى', '1000 ك ف أ', '1000 kva', 'محولات', 'نوع جاف', 'transformer'],
  },
  {
    itemCode: 'EL-CAB-MED-240',
    itemName: 'كابل جهد متوسط 18/30 ك.ف قطاع 3×240 مم2 ألومنيوم XLPE مسلح',
    description: 'توريد ومد وتوصيل واختبار كابلات جهد متوسط 18/30 ك.ف قطاع 3×240 مم² ألومنيوم XLPE مسلح شامل النهايات والحفر والردم',
    unit: 'm',
    trade: 'electrical_power',
    directCost: 1850,
    wastePercent: 3,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 2375,
    components: [
      { componentCode: 'MAT-EL-CAB-MED-240', componentName: 'كابل 18/30 ك.ف 3×240 مم² ألومنيوم XLPE/STA/PVC ونهايات حرارية', unit: 'm', qtyPerUnit: 1.03, unitRate: 1650, componentType: 'material' },
      { componentCode: 'LAB-EL-CAB-LAY', componentName: 'مصنعيات حفر ومد وردم بالرمل وفرش بلاطات تحذيرية وسحب واختبار هاي بوت', unit: 'm', qtyPerUnit: 1, unitRate: 200, componentType: 'labor' },
    ],
    keywords: ['كابلات جهد متوسط', '3×240', '3*240', '18/30', 'xlpe الومنيوم', 'كابلات الجهد المتوسط'],
  },
  {
    itemCode: 'EL-CAB-LOW-240',
    itemName: 'كابل جهد منخفض 0.6/1 ك.ف مسلح XLPE قطاع 3×240+120 مم2 ألومنيوم',
    description: 'توريد ومد واختبار كابلات الجهد المنخفض المسلحة XLPE/STA/PVC قطاع 3×240+120 مم² ألومنيوم مع الحفر والردم وإعادة الشيء لأصله',
    unit: 'm',
    trade: 'electrical_power',
    directCost: 1150,
    wastePercent: 3,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 1475,
    components: [
      { componentCode: 'MAT-EL-CAB-LOW-240', componentName: 'كابل جهد منخفض مسلح 3×240+120 مم² ألومنيوم ونهايات نحاسية', unit: 'm', qtyPerUnit: 1.03, unitRate: 1020, componentType: 'material' },
      { componentCode: 'LAB-EL-CAB-LAY', componentName: 'مصنعيات سحب وتثبيت وتوصيل واختبار العزل بالميجر', unit: 'm', qtyPerUnit: 1, unitRate: 130, componentType: 'labor' },
    ],
    keywords: ['3*240+120', '3×240+120', 'كابل 3*240', 'كابلات التغذية الرئيسية'],
  },
  {
    itemCode: 'EL-CAB-LOW-185',
    itemName: 'كابل جهد منخفض 0.6/1 ك.ف مسلح XLPE قطاع 3×185+95 مم2 ألومنيوم',
    description: 'توريد ومد واختبار كابلات الجهد المنخفض المسلحة XLPE/STA/PVC قطاع 3×185+95 مم² ألومنيوم مع الحفر والردم',
    unit: 'm',
    trade: 'electrical_power',
    directCost: 890,
    wastePercent: 3,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 1140,
    components: [
      { componentCode: 'MAT-EL-CAB-LOW-185', componentName: 'كابل جهد منخفض مسلح 3×185+95 مم² ألومنيوم', unit: 'm', qtyPerUnit: 1.03, unitRate: 780, componentType: 'material' },
      { componentCode: 'LAB-EL-CAB-LAY', componentName: 'مصنعيات مد وسحب وتوصيل', unit: 'm', qtyPerUnit: 1, unitRate: 110, componentType: 'labor' },
    ],
    keywords: ['3*185+95', '3×185+95', 'كابل 3*185'],
  },
  {
    itemCode: 'EL-CAB-LOW-120',
    itemName: 'كابل جهد منخفض 0.6/1 ك.ف مسلح XLPE قطاع 3×120+70 مم2 ألومنيوم',
    description: 'توريد ومد واختبار كابلات الجهد المنخفض المسلحة XLPE/STA/PVC قطاع 3×120+70 مم² ألومنيوم مع الحفر والردم',
    unit: 'm',
    trade: 'electrical_power',
    directCost: 620,
    wastePercent: 3,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 795,
    components: [
      { componentCode: 'MAT-EL-CAB-LOW-120', componentName: 'كابل جهد منخفض مسلح 3×120+70 مم² ألومنيوم', unit: 'm', qtyPerUnit: 1.03, unitRate: 530, componentType: 'material' },
      { componentCode: 'LAB-EL-CAB-LAY', componentName: 'مصنعيات سحب وتوصيل واختبار', unit: 'm', qtyPerUnit: 1, unitRate: 90, componentType: 'labor' },
    ],
    keywords: ['3*120+70', '3×120+70', 'كابل 3*120'],
  },
  {
    itemCode: 'EL-EAR-PIT-MV',
    itemName: 'نظام أرضي متكامل للجهد المتوسط (مقاومة لا تزيد عن 3 أوم)',
    description: 'توريد وتركيب وتوصيل واختبار شبكة تأريض متكاملة مع إلكترودات نحاسية وقضبان ووصلات وغرفة تفتيش خرسانية واختبار المقاومة',
    unit: 'item',
    trade: 'electrical_power',
    directCost: 42000,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 55000,
    components: [
      { componentCode: 'MAT-EL-EAR-ROD', componentName: 'حربة تأريض نحاس نقي 5/8 بوصة وكابل نحاس عاري 70 مم² وبودرة بيلتونايت وغرفة تفتيش', unit: 'item', qtyPerUnit: 1, unitRate: 35000, componentType: 'material' },
      { componentCode: 'LAB-EL-EAR-INST', componentName: 'مصنعيات دق إلكترودات ولحام كادويلد وقياس مقاومة الأرضي بجهاز الأيرث ميجر', unit: 'item', qtyPerUnit: 1, unitRate: 7000, componentType: 'labor' },
    ],
    keywords: ['الأرضى', 'نظام أرضى', 'مقاومة لاتزيد عن 3 أوم', '3 أوم', 'مبنى الموزع', 'تأريض'],
  },
  {
    itemCode: 'EL-EAR-PIT-LV',
    itemName: 'نظام أرضي متكامل للجهد المنخفض والمحولات والبيلرات (مقاومة لا تزيد عن 2 أوم)',
    description: 'توريد وتركيب وتوصيل واختبار نظام أرضي متكامل للمحولات ولوحات التوزيع والبيلرات يعطي مقاومة لا تزيد عن 2 أوم',
    unit: 'item',
    trade: 'electrical_power',
    directCost: 23000,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 30000,
    components: [
      { componentCode: 'MAT-EL-EAR-ROD-LV', componentName: 'إلكترود نحاسي وكابل تأريض وغرفة تفتيش', unit: 'item', qtyPerUnit: 1, unitRate: 19000, componentType: 'material' },
      { componentCode: 'LAB-EL-EAR-INST', componentName: 'مصنعيات تركيب وتوصيل واختبار', unit: 'item', qtyPerUnit: 1, unitRate: 4000, componentType: 'labor' },
    ],
    keywords: ['مقاومة لاتزيد عن 2 أوم', '2 أوم', 'البيلرات', 'المحولات'],
  },
  {
    itemCode: 'EL-CON-UPVC-150',
    itemName: 'عدايات مواسير UPVC قطر 6 بوصة لتعدية الشوارع والكابلات',
    description: 'توريد وتركيب وتمديد عدايات مواسير UPVC قطر 6 بوصة (160 مم) عند تعدية الطرق مع الحفر والفرش والصبة الخرسانية والردم',
    unit: 'm',
    trade: 'electrical_power',
    directCost: 460,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 600,
    components: [
      { componentCode: 'MAT-EL-CON-150', componentName: 'مواسير UPVC قطر 6 بوصة معتمدة وجلب وخيط سحب', unit: 'm', qtyPerUnit: 1.05, unitRate: 360, componentType: 'material' },
      { componentCode: 'LAB-EL-CON-INST', componentName: 'مصنعيات حفر وتمديد وتثبيت وصب خرسانة حماية وردم', unit: 'm', qtyPerUnit: 1, unitRate: 100, componentType: 'labor' },
    ],
    keywords: ['العدايات', 'عدايات', 'upvc قطر 6 بوصة', '6 بوصة', 'عدايات بمواسير'],
  },
  {
    itemCode: 'EL-CON-UPVC-100',
    itemName: 'عدايات مواسير UPVC قطر 4 بوصة لتعدية الشوارع',
    description: 'توريد وتركيب وتمديد عدايات مواسير UPVC قطر 4 بوصة (110 مم) عند تعدية الطرق مع الحفر والردم والصبة',
    unit: 'm',
    trade: 'electrical_power',
    directCost: 310,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 400,
    components: [
      { componentCode: 'MAT-EL-CON-100', componentName: 'مواسير UPVC قطر 4 بوصة وجلب', unit: 'm', qtyPerUnit: 1.05, unitRate: 240, componentType: 'material' },
      { componentCode: 'LAB-EL-CON-INST', componentName: 'مصنعيات حفر وتمديد وتثبيت وردم', unit: 'm', qtyPerUnit: 1, unitRate: 70, componentType: 'labor' },
    ],
    keywords: ['upvc قطر 4 بوصة', '4 بوصة'],
  },
  {
    itemCode: 'EL-PAN-DB-12W',
    itemName: 'لوحة توزيع فرعية داخلية DB سعة 12 خط مع القواطع MCB/ELCB',
    description: 'توريد وتركيب لوحة توزيع إنارة وقوى فرعية غاطسة بالجدار DB 12 Way مع القاطع الرئيسي 63A 3-Phase وقواطع التفريع MCB وقاطع تسريب أرضي ELCB',
    unit: 'item',
    trade: 'electrical_power',
    directCost: 4500,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 5900,
    components: [
      { componentCode: 'MAT-EL-DB-12W', componentName: 'لوحة صاج غاطسة وقواطع شنايدر/ABB أصلية وباسبار', unit: 'item', qtyPerUnit: 1, unitRate: 3800, componentType: 'material' },
      { componentCode: 'LAB-EL-DB-INST', componentName: 'مصنعيات تثبيت وتجميع وتوصيل وترقيم الأسلاك', unit: 'item', qtyPerUnit: 1, unitRate: 700, componentType: 'labor' },
    ],
    keywords: ['distribution board', 'db-01', 'لوحة توزيع فرعية', 'لوحة قواطع', '12 way'],
  },
  {
    itemCode: 'EL-LGT-LED-6060',
    itemName: 'كشاف ليد سقف غاطس 60×60 سم قدرة 40-45 وات مع المحول',
    description: 'توريد وتركيب وتوصيل كشاف إضاءة LED غاطس 60×60 سم 40W إضاءة 4000K/6500K مع الدريفر والتعليق بالسقف المعلق',
    unit: 'item',
    trade: 'electrical_power',
    directCost: 450,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 590,
    components: [
      { componentCode: 'MAT-EL-LED-6060', componentName: 'بانل ليد 60×60 عالي الجودة مع درايفر تيار مستمر وسلك', unit: 'item', qtyPerUnit: 1, unitRate: 380, componentType: 'material' },
      { componentCode: 'LAB-EL-LGT-INST', componentName: 'مصنعيات تركيب وتثبيت بالسقف والتوصيل', unit: 'item', qtyPerUnit: 1, unitRate: 70, componentType: 'labor' },
    ],
    keywords: ['60x60', '60*60', '60×60', 'led panel', 'كشاف 60', 'تروفر ليد', 'luminaires', 'f1', 'f2'],
  },
  {
    itemCode: 'EL-LGT-DWN-15W',
    itemName: 'سبوت لايت داون لايت LED سقفى قدرة 15 وات غاطس',
    description: 'توريد وتركيب وتوصيل كشاف داون لايت غاطس LED Downlight 15W مع المحول وفتحة الجبس',
    unit: 'item',
    trade: 'electrical_power',
    directCost: 180,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 240,
    components: [
      { componentCode: 'MAT-EL-DWN-15W', componentName: 'داون لايت ليد 15 وات مع المشابك والدرايفر', unit: 'item', qtyPerUnit: 1, unitRate: 140, componentType: 'material' },
      { componentCode: 'LAB-EL-LGT-INST', componentName: 'مصنعيات فتح الجبس وتركيب وتوصيل', unit: 'item', qtyPerUnit: 1, unitRate: 40, componentType: 'labor' },
    ],
    keywords: ['downlight', 'سبوت لايت', 'داون لايت', 'dl-01', 'spotlight'],
  },
  {
    itemCode: 'EL-SOK-DUP-16A',
    itemName: 'مخرج بريزة مزدوجة 16A شاسيه ووش مع الأرضي والتوصيلات',
    description: 'توريد وتركيب مخرج مأخذ كهربائي مزدوج 16A مع خط التأريض والعلبة الماجيك والأسلاك 3×4 مم²',
    unit: 'item',
    trade: 'electrical_power',
    directCost: 280,
    wastePercent: 3,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 370,
    components: [
      { componentCode: 'MAT-EL-SOK-16A', componentName: 'لقم بريزة مزدوجة شنايدر/ليجراند وعلبة ماجيك وسلك سويدي 4 مم', unit: 'item', qtyPerUnit: 1, unitRate: 200, componentType: 'material' },
      { componentCode: 'LAB-EL-SOK-INST', componentName: 'مصنعيات تثبيت وسحب وتجميع وتوصيل', unit: 'item', qtyPerUnit: 1, unitRate: 80, componentType: 'labor' },
    ],
    keywords: ['socket', 'duplex socket', 'بريزة', 'مأخذ', 'مخارج قوى', 's1', 's2', '16a', '13a'],
  },

  // ==========================================================================
  // 3. LOW CURRENT & SMART SECURITY
  // ==========================================================================
  {
    itemCode: 'LC-CCTV-CAM-IP4',
    itemName: 'كاميرا مراقبة شبكية IP داخلية/خارجية 4 ميجابكسل دقة عالية',
    description: 'توريد وتركيب وبرمجة كاميرا مراقبة IP بدقة 4MP مع الرؤية الليلية IR وخاصية WDR ودعم PoE مع العلبة والقاعدة والجاكات',
    unit: 'item',
    trade: 'low_current',
    directCost: 1650,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 2150,
    components: [
      { componentCode: 'MAT-LC-CAM-4MP', componentName: 'كاميرا IP دقة 4MP هيكفيجن/داهوا أصلية مع قاعدة التثبيت والجاكات', unit: 'item', qtyPerUnit: 1, unitRate: 1350, componentType: 'material' },
      { componentCode: 'LAB-LC-CAM-INST', componentName: 'مصنعيات تركيب وتوجيه الزاوية وضبط الفوكس والبرمجة بالـ NVR', unit: 'item', qtyPerUnit: 1, unitRate: 300, componentType: 'labor' },
    ],
    keywords: ['cctv', 'ip camera', 'dome camera', 'bullet camera', 'كاميرا مراقبة', 'كاميرات'],
  },
  {
    itemCode: 'LC-FA-DET-OPT',
    itemName: 'حساس كاشف دخان بصري عنوني Optical Smoke Detector مع القاعدة',
    description: 'توريد وتركيب وتوصيل وبرمجة كاشف دخان كهروضوئي عنوني مع القاعدة الذكية وعزل اللوب ومؤشر بيان LED',
    unit: 'item',
    trade: 'low_current',
    directCost: 550,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 720,
    components: [
      { componentCode: 'MAT-LC-DET-SMK', componentName: 'كاشف دخان عنوني معتمد UL/EN54 وقاعدة ومقاومة نهاية الخط', unit: 'item', qtyPerUnit: 1, unitRate: 430, componentType: 'material' },
      { componentCode: 'LAB-LC-FA-INST', componentName: 'مصنعيات تثبيت بالسقف وتوصيل باللوب والترميز والعنونة والبرمجة', unit: 'item', qtyPerUnit: 1, unitRate: 120, componentType: 'labor' },
    ],
    keywords: ['smoke detector', 'optical detector', 'كاشف دخان', 'حساس دخان', 'إنذار حريق', 'fire alarm detector', 'sd-01'],
  },
  {
    itemCode: 'LC-DATA-PNT-CAT6',
    itemName: 'مخرج شبكة وبيانات ومقبس RJ45 فئة Cat6 UTP متكامل',
    description: 'توريد وسحب وتركيب مخرج داتا وتليفون Cat6 مع الفيشة RJ45 Faceplate والكابل السويدي/شنايدر المعتمد والترقيم على الباتش بانل',
    unit: 'item',
    trade: 'low_current',
    directCost: 320,
    wastePercent: 3,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 420,
    components: [
      { componentCode: 'MAT-LC-CAT6-PNT', componentName: 'كابل Cat6 UTP 305m ولوازم كيستون RJ45 وشاسيه ووش', unit: 'item', qtyPerUnit: 1, unitRate: 230, componentType: 'material' },
      { componentCode: 'LAB-LC-DATA-INST', componentName: 'مصنعيات سحب كابل وتأريج ولحام بالكيستون واختبار بالفلوكر Fluke Test', unit: 'item', qtyPerUnit: 1, unitRate: 90, componentType: 'labor' },
    ],
    keywords: ['data point', 'cat6', 'rj45', 'مخرج داتا', 'نقطة شبكة', 'شبكة معلومات', 'utp', 'data outlet', 'telephone outlet'],
  },
  {
    itemCode: 'LC-FA-MCP-ADDR',
    itemName: 'كاسر زجاج ومحطة استدعاء وسحب يدوي عنوني لإنذار الحريق Manual Call Station',
    description: 'توريد وتركيب وتوصيل وبرمجة محطة سحب واستدعاء يدوي عنونية Addressable Intelligent Fire Alarm Manual Call Station / Break Glass مع علبة التثبيت والبرمجة باللوب',
    unit: 'item',
    trade: 'low_current',
    directCost: 580,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 760,
    components: [
      { componentCode: 'MAT-LC-MCP-DEV', componentName: 'محطة سحب يدوية عنونية كاسر زجاج معتمدة UL/EN54 ومفتاح اختبار وعزل داخلي', unit: 'item', qtyPerUnit: 1, unitRate: 480, componentType: 'material' },
      { componentCode: 'LAB-LC-MCP-INST', componentName: 'مصنعيات تركيب على ارتفاع 120-140 سم وتوصيل باللوب والبرمجة', unit: 'item', qtyPerUnit: 1, unitRate: 100, componentType: 'labor' },
    ],
    keywords: ['manual call station', 'manual call point', 'call point', 'call station', 'break glass', 'كاسر زجاج', 'كواسر', 'سحب يدوي', 'استدعاء يدوي', 'مفتاح انذار يدوي', 'pull station', 'manual station'],
  },
  {
    itemCode: 'LC-FA-MOD-CTRL',
    itemName: 'موديول تحكم ومراقبة عنوني ومكبرات إخلاء صوتي Control Modules & Strobes',
    description: 'توريد وتركيب وتوصيل وبرمجة موديولات تحكم ومراقبة عنونية وسرائن وفلاشرات إخلاء صوتي Addressable Control Modules for Evacuation Loudspeakers & Strobe Light',
    unit: 'ls',
    trade: 'low_current',
    directCost: 21000,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 27500,
    components: [
      { componentCode: 'MAT-LC-MOD-CTRL', componentName: 'موديولات تحكم عنونية ومكبرات صوت إخلاء صوتي وفلاشر ضوئي', unit: 'ls', qtyPerUnit: 1, unitRate: 17500, componentType: 'material' },
      { componentCode: 'LAB-LC-MOD-INST', componentName: 'مصنعيات تمديد وتوصيل وبرمجة سيناريو الإخلاء الصوتي والربط مع اللوحة', unit: 'ls', qtyPerUnit: 1, unitRate: 3500, componentType: 'labor' },
    ],
    keywords: ['control modules', 'control module', 'monitor module', 'evacuation loudspeakers', 'loudspeakers with strobe', 'strobe light', 'موديول تحكم', 'اخلاء صوتي', 'موديولات مراقبة'],
  },
  {
    itemCode: 'LC-FA-SND-STRB',
    itemName: 'سرينة إنذار حريق حائطية وفلاشر ضوئي Sounder / Strobe Light',
    description: 'توريد وتركيب وتوصيل سرينة إنذار حريق حائطية مدمجة مع فلاشر ضوئي إلكتروني معتمد Fire Alarm Sounder with Strobe',
    unit: 'item',
    trade: 'low_current',
    directCost: 620,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 810,
    components: [
      { componentCode: 'MAT-LC-SND-STRB', componentName: 'سرينة حريق مع فلاشر ضوئي شدة 75-110cd معتمدة', unit: 'item', qtyPerUnit: 1, unitRate: 500, componentType: 'material' },
      { componentCode: 'LAB-LC-SND-INST', componentName: 'مصنعيات تركيب وتوصيل باللوب واختبار شدة الصوت', unit: 'item', qtyPerUnit: 1, unitRate: 120, componentType: 'labor' },
    ],
    keywords: ['sounder', 'fire alarm sounder', 'sounder wall mounted', 'سرينة انذار', 'سارينة', 'sounder with strobe'],
  },
  {
    itemCode: 'LC-FA-ISO-MOD',
    itemName: 'موديول عزل الأعطال للوب إنذار الحريق Fault Isolator Module',
    description: 'توريد وتركيب وتوصيل موديول عزل أعطال الشورت سيركت في لوب الإنذار Fault Isolator Module',
    unit: 'item',
    trade: 'low_current',
    directCost: 450,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 590,
    components: [
      { componentCode: 'MAT-LC-ISO-MOD', componentName: 'موديول عزل أوتوماتيكي عنوني مع القاعدة والعلبة', unit: 'item', qtyPerUnit: 1, unitRate: 370, componentType: 'material' },
      { componentCode: 'LAB-LC-ISO-INST', componentName: 'مصنعيات تركيب وتوصيل باللوب', unit: 'item', qtyPerUnit: 1, unitRate: 80, componentType: 'labor' },
    ],
    keywords: ['fault isolator module', 'isolator module', 'isolator', 'عازل اعطال', 'موديول عزل'],
  },
  {
    itemCode: 'LC-CBL-CAT6A',
    itemName: 'كابل شبكات معتمد UTP 4-Pair فئة Cat.6A عالي السرعة بالمتر',
    description: 'توريد وسحب وتمديد كابل شبكات UTP Cat.6A 4-Pair مع المواسير والترقيم واختبارات الأداء الفلوكر',
    unit: 'm',
    trade: 'low_current',
    directCost: 28,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 38,
    components: [
      { componentCode: 'MAT-LC-CAT6A-CBL', componentName: 'كابل Cat.6A UTP نحاس نقي معتمد شنايدر/ليجراند/باندويت', unit: 'm', qtyPerUnit: 1.05, unitRate: 22, componentType: 'material' },
      { componentCode: 'LAB-LC-CAT6A-LAY', componentName: 'مصنعيات سحب وتثبيت وتدكيك وترقيم الكابلات', unit: 'm', qtyPerUnit: 1, unitRate: 6, componentType: 'labor' },
    ],
    keywords: ['cat.6a cable', 'cat6a cable', 'cat.6a', 'cat6a', 'utp, 4 pair', 'كابل cat6a', 'كابلات شبكة cat6a'],
  },
  {
    itemCode: 'LC-ACC-PTC-3M',
    itemName: 'باتش كورد شبكات Cat.6A UTP مصنع معتمد (3م / 5م / 10م)',
    description: 'توريد وتوصيل كابل توصيل سريع Patch Cord Cat.6A RJ45 مصنع ومعتمد من المصنع بأطوال متنوعة',
    unit: 'item',
    trade: 'low_current',
    directCost: 75,
    wastePercent: 1,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 100,
    components: [
      { componentCode: 'MAT-LC-PTC-CORD', componentName: 'باتش كورد Cat6A RJ45/RJ45 مصبوب معتمد', unit: 'item', qtyPerUnit: 1, unitRate: 65, componentType: 'material' },
      { componentCode: 'LAB-LC-PTC-INST', componentName: 'مصنعيات توصيل وتنسيق بالراك وترقيم', unit: 'item', qtyPerUnit: 1, unitRate: 10, componentType: 'labor' },
    ],
    keywords: ['patch cord', 'cat.6a  patch cord', 'rj45 / rj45', 'باتش كورد'],
  },
  {
    itemCode: 'LC-IT-RCK-CAB',
    itemName: 'كابينة راك شبكات وسيرفرات IT Rack متكاملة مع الباتش بانل والباور',
    description: 'توريد وتركيب كابينة راك IT Rack Cabinet مع الباتش بانل Cat6A وباتش بانل الفايبر ووحدات تنظيم الكابلات Cable Management ووحدة توزيع القوى PDU والتهوية',
    unit: 'ls',
    trade: 'low_current',
    directCost: 35000,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 46000,
    components: [
      { componentCode: 'MAT-LC-RCK-CAB', componentName: 'كابينة راك 42U مع باتش بانل نحاس وفايبر وPDU ومراوح وشيلفات', unit: 'ls', qtyPerUnit: 1, unitRate: 29000, componentType: 'material' },
      { componentCode: 'LAB-LC-RCK-INST', componentName: 'مصنعيات تجميع وتثبيت وتأريج ولحام فايبر وترقيم وتنظيم وترتيب', unit: 'ls', qtyPerUnit: 1, unitRate: 6000, componentType: 'labor' },
    ],
    keywords: ['it rack', 'patching racks', 'rack cabinet', 'كابينة راك', 'راك شبكات', 'دولاب شبكة'],
  },
  {
    itemCode: 'LC-INT-SYS-SET',
    itemName: 'منظومة إنتركم عمارة سكنية متكاملة (الوحدة الرئيسية وشاشات الشقق)',
    description: 'توريد وتركيب وتشغيل وبرمجة منظومة انتركم Intercom System شاملة اللوحة الرئيسية الخارجية Main Intercom Unit ووحدات الشقق Apartment Units والكابلات ومزودات الطاقة والمهام اللازمة',
    unit: 'item',
    trade: 'low_current',
    directCost: 1200,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 1580,
    components: [
      { componentCode: 'MAT-LC-INT-UNIT', componentName: 'وحدة انتركم ديجيتال صوتية/مرئية مع الملحقات والمحول', unit: 'item', qtyPerUnit: 1, unitRate: 980, componentType: 'material' },
      { componentCode: 'LAB-LC-INT-INST', componentName: 'مصنعيات تثبيت وبرمجة الأرقام وربط اللوحة الرئيسية وتشغيل واختبار', unit: 'item', qtyPerUnit: 1, unitRate: 220, componentType: 'labor' },
    ],
    keywords: ['intercom system', 'main intercom unit', 'apartment intercom unit', 'intercom', 'انتركم', 'انتركام', 'وحدة انتركم'],
  },

  // ==========================================================================
  // 4. HVAC & VENTILATION
  // ==========================================================================
  {
    itemCode: 'HVAC-AC-DX-225',
    itemName: 'تركيب وتوصيل واختبار وحدة تكييف سبليت حائطي قدرة 2.25 حصان',
    description: 'تركيب وتوصيل وتشغيل واختبار وحدة تكييف سبليت حائطي DX قدرة 2.25 حصان تشمل الحوامل والشاسيه المعدني ووحدة التحكم والربط مع الوحدة الخارجية',
    unit: 'item',
    trade: 'hvac',
    directCost: 1800,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 2350,
    components: [
      { componentCode: 'MAT-HVAC-AC-BASE', componentName: 'شاسيه معدني وحوامل زاوية مجلفنة ومخمدات اهتزاز ومسامير فيشر', unit: 'item', qtyPerUnit: 1, unitRate: 850, componentType: 'material' },
      { componentCode: 'LAB-HVAC-AC-INST', componentName: 'مصنعيات تركيب الوحدات الداخلية والخارجية والفاكيوم والشحن والتشغيل', unit: 'item', qtyPerUnit: 1, unitRate: 950, componentType: 'labor' },
    ],
    keywords: ['2.25 hp', '2.25hp', 'a/c-01', 'dx high wall', '2.25 حصان'],
  },
  {
    itemCode: 'HVAC-AC-DX-300',
    itemName: 'تركيب وتوصيل واختبار وحدة تكييف سبليت حائطي قدرة 3 حصان',
    description: 'تركيب وتوصيل وتشغيل واختبار وحدة تكييف سبليت حائطي DX قدرة 3 حصان مع القواعد والتوصيلات والتشغيل',
    unit: 'item',
    trade: 'hvac',
    directCost: 2200,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 2850,
    components: [
      { componentCode: 'MAT-HVAC-AC-BASE', componentName: 'شاسيه تثبيت وقواعد مطاطية ومهمات ربط', unit: 'item', qtyPerUnit: 1, unitRate: 1050, componentType: 'material' },
      { componentCode: 'LAB-HVAC-AC-INST', componentName: 'مصنعيات تركيب وتوصيل واختبار أداء التبريد', unit: 'item', qtyPerUnit: 1, unitRate: 1150, componentType: 'labor' },
    ],
    keywords: ['3 hp', '3hp', 'a/c-02', '3 حصان'],
  },
  {
    itemCode: 'HVAC-AC-DX-400',
    itemName: 'تركيب وتوصيل واختبار وحدة تكييف سبليت حائطي قدرة 4 حصان',
    description: 'تركيب وتوصيل وتشغيل واختبار وحدة تكييف سبليت حائطي DX قدرة 4 حصان مع القواعد والتوصيلات والتشغيل',
    unit: 'item',
    trade: 'hvac',
    directCost: 2600,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 3400,
    components: [
      { componentCode: 'MAT-HVAC-AC-BASE', componentName: 'شاسيه تثبيت وقواعد ومهمات ربط', unit: 'item', qtyPerUnit: 1, unitRate: 1250, componentType: 'material' },
      { componentCode: 'LAB-HVAC-AC-INST', componentName: 'مصنعيات تركيب وتوصيل وتشغيل', unit: 'item', qtyPerUnit: 1, unitRate: 1350, componentType: 'labor' },
    ],
    keywords: ['4 hp', '4hp', 'a/c-03', '4 حصان'],
  },
  {
    itemCode: 'HVAC-AC-DX-500',
    itemName: 'تركيب وتوصيل واختبار وحدة تكييف سبليت حائطي قدرة 5 حصان',
    description: 'تركيب وتوصيل وتشغيل واختبار وحدة تكييف سبليت حائطي DX قدرة 5 حصان مع القواعد والتوصيلات والتشغيل',
    unit: 'item',
    trade: 'hvac',
    directCost: 3200,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 4200,
    components: [
      { componentCode: 'MAT-HVAC-AC-BASE', componentName: 'شاسيه وقواعد تثبيت كونسول', unit: 'item', qtyPerUnit: 1, unitRate: 1500, componentType: 'material' },
      { componentCode: 'LAB-HVAC-AC-INST', componentName: 'مصنعيات تركيب وتوصيل واختبار', unit: 'item', qtyPerUnit: 1, unitRate: 1700, componentType: 'labor' },
    ],
    keywords: ['5 hp', '5hp', 'a/c-04', '5 حصان'],
  },
  {
    itemCode: 'HVAC-PIP-COPPER',
    itemName: 'مواسير نحاس التبريد المعزولة بالأرمفلكس وكابلات التحكم والربط',
    description: 'توريد وتركيب وتمديد شبكة مواسير النحاس (خط السحب وخط السائل) للتبريد مع العزل الحراري بالأرمفلكس والشريط اللاصق وكابلات التحكم والربط والتعليق',
    unit: 'm',
    trade: 'hvac',
    directCost: 480,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 630,
    components: [
      { componentCode: 'MAT-HVAC-COP-PIPE', componentName: 'مواسير نحاس كوري/جنوب أفريقي معزولة أرمفلكس سماكة 19 مم وكابل كنترول شيلد', unit: 'm', qtyPerUnit: 1.05, unitRate: 380, componentType: 'material' },
      { componentCode: 'LAB-HVAC-COP-LAY', componentName: 'مصنعيات تمديد ولحام بالفضة وسحب واختبار ضغط النيتروجين والفاكيوم', unit: 'm', qtyPerUnit: 1, unitRate: 100, componentType: 'labor' },
    ],
    keywords: ['copper pipes', 'copper pipe', 'مواسير نحاس', 'نحاس تبريد', 'suction lines', 'liquid & suction'],
  },
  {
    itemCode: 'HVAC-FAN-WALL-100',
    itemName: 'مروحة شفط وتهوية حائطية قدرة 100 CFM مع الجريلية والستارة',
    description: 'توريد وتركيب وتوصيل واختبار مروحة سحب وتهوية حائطية Wall Mounted Fan تصرف 100 CFM مع مخمدات الاهتزاز والستارة الخلفية Gravity Shutter والمفتاح الكهربي',
    unit: 'item',
    trade: 'hvac',
    directCost: 1600,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 2100,
    components: [
      { componentCode: 'MAT-HVAC-FAN-100', componentName: 'مروحة حائطية 100 CFM وستارة خلفية وشبكة حماية', unit: 'item', qtyPerUnit: 1, unitRate: 1350, componentType: 'material' },
      { componentCode: 'LAB-HVAC-FAN-INST', componentName: 'مصنعيات تثبيت بالجدار وتوصيل كهربي واختبار تدفق الهواء', unit: 'item', qtyPerUnit: 1, unitRate: 250, componentType: 'labor' },
    ],
    keywords: ['w.m.f', 'wall mounted fans', 'wall mounted', '100 cfm', 'مروحة حائط'],
  },
  {
    itemCode: 'HVAC-FAN-CEN-300',
    itemName: 'مروحة طرد مركزي Centrifugal Fan قدرة 300 CFM',
    description: 'توريد وتركيب وتوصيل واختبار مروحة سحب طرد مركزي Centrifugal Fan تصرف 300 CFM مع القاعدة المطاطية والوصلة المرنة Flexible Duct',
    unit: 'item',
    trade: 'hvac',
    directCost: 4500,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 5900,
    components: [
      { componentCode: 'MAT-HVAC-FAN-CEN300', componentName: 'مروحة طرد مركزي 300 CFM مع شاسيه تعليق ووصلات مرنة', unit: 'item', qtyPerUnit: 1, unitRate: 3800, componentType: 'material' },
      { componentCode: 'LAB-HVAC-FAN-INST', componentName: 'مصنعيات تعليق وتوصيل بالدكت وتجربة التشغيل', unit: 'item', qtyPerUnit: 1, unitRate: 700, componentType: 'labor' },
    ],
    keywords: ['ex.cen.f-01', '300 cfm', 'centrifugal fans 300'],
  },
  {
    itemCode: 'HVAC-FAN-CEN-400',
    itemName: 'مروحة طرد مركزي Centrifugal Fan قدرة 400 CFM',
    description: 'توريد وتركيب وتوصيل واختبار مروحة سحب طرد مركزي Centrifugal Fan تصرف 400 CFM',
    unit: 'item',
    trade: 'hvac',
    directCost: 5800,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 7600,
    components: [
      { componentCode: 'MAT-HVAC-FAN-CEN400', componentName: 'مروحة طرد مركزي 400 CFM كاملة بالملحقات', unit: 'item', qtyPerUnit: 1, unitRate: 4900, componentType: 'material' },
      { componentCode: 'LAB-HVAC-FAN-INST', componentName: 'مصنعيات تركيب وتوصيل واختبار', unit: 'item', qtyPerUnit: 1, unitRate: 900, componentType: 'labor' },
    ],
    keywords: ['ex.cen.f-02', '400 cfm', 'centrifugal fans 400'],
  },
  {
    itemCode: 'HVAC-FAN-CEN-800',
    itemName: 'مروحة طرد مركزي Centrifugal Fan قدرة 800 CFM',
    description: 'توريد وتركيب وتوصيل واختبار مروحة سحب طرد مركزي Centrifugal Fan تصرف 800 CFM',
    unit: 'item',
    trade: 'hvac',
    directCost: 8500,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 11200,
    components: [
      { componentCode: 'MAT-HVAC-FAN-CEN800', componentName: 'مروحة طرد مركزي 800 CFM كاملة بالملحقات', unit: 'item', qtyPerUnit: 1, unitRate: 7300, componentType: 'material' },
      { componentCode: 'LAB-HVAC-FAN-INST', componentName: 'مصنعيات تركيب وتوصيل واختبار', unit: 'item', qtyPerUnit: 1, unitRate: 1200, componentType: 'labor' },
    ],
    keywords: ['ex.cen.f-03', '800 cfm', 'centrifugal fans 800'],
  },
  {
    itemCode: 'HVAC-FAN-DEC-100',
    itemName: 'مروحة شفط ديكورية Decorative Fan سقفية قدرة 100 CFM',
    description: 'توريد وتركيب وتوصيل واختبار مروحة شفط سقفية ديكورية Decorative Fan قدرة 100 CFM مع الجريلية الديكورية ومحبس عدم الرجوع والوصلة المرنة',
    unit: 'item',
    trade: 'hvac',
    directCost: 1400,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 1850,
    components: [
      { componentCode: 'MAT-HVAC-FAN-DEC', componentName: 'مروحة شفط ديكورية 100 CFM وجريلية وشتر', unit: 'item', qtyPerUnit: 1, unitRate: 1150, componentType: 'material' },
      { componentCode: 'LAB-HVAC-FAN-INST', componentName: 'مصنعيات تثبيت بالسقف المعلق وتوصيل كهربي', unit: 'item', qtyPerUnit: 1, unitRate: 250, componentType: 'labor' },
    ],
    keywords: ['d.f-01', 'decorative fans', 'مروحة ديكورية'],
  },
  {
    itemCode: 'HVAC-DCT-SMACNA-01',
    itemName: 'تصنيع وتوريد وتركيب مجاري هواء صاج مجلفن CNC (بالطن) طبقاً لـ SMACNA',
    description: 'تصنيع وتوريد وتركيب مجاري الهواء من ألواح الصاج المجلفن CNC طبقاً لجداول ومعايير SMACNA مع العزل الحراري والصوتي والكانفاس والدمبر والحوامل الزلزالية واختبار تسريب الهواء Smoke/Pressure Test',
    unit: 'ton',
    trade: 'hvac',
    directCost: 145000,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 190000,
    components: [
      { componentCode: 'MAT-HVAC-GALV-SHT', componentName: 'صاج مجلفن معتمد طبقا لسمك SMACNA وفلانشات وجوانات صوف زجاجي ومسامير', unit: 'ton', qtyPerUnit: 1.05, unitRate: 115000, componentType: 'material' },
      { componentCode: 'LAB-HVAC-DCT-FAB', componentName: 'مصنعيات تفصيل وتصنيع CNC وتركيب وتعليق وعزل واختبار اتزان الهواء TAB', unit: 'ton', qtyPerUnit: 1, unitRate: 30000, componentType: 'labor' },
    ],
    keywords: ['galvanized steel sheet metal duct', 'smacna', 'صاج مجلفن', 'مجاري هواء', 'duct work', 'metal duct'],
  },

  // ==========================================================================
  // 5. PLUMBING, DRAINAGE & SANITARY
  // ==========================================================================
  {
    itemCode: 'PLM-PIP-PPR-25',
    itemName: 'مواسير بولي بروبلين PPR PN-20 قطر 25 مم (3/4 بوصة) للتغذية بالمياه',
    description: 'توريد وتركيب مواسير بولي بروبلين PPR ضغط 20 بار للمياه الباردة والساخنة شاملة اللوازم واللحام الحراري والاختبار',
    unit: 'm',
    trade: 'plumbing_sanitary',
    directCost: 110,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 145,
    components: [
      { componentCode: 'MAT-PLM-PPR-25', componentName: 'مواسير PPR PN20 قطر 25 مم ولوازم لحام حراري', unit: 'm', qtyPerUnit: 1.05, unitRate: 80, componentType: 'material' },
      { componentCode: 'LAB-PLM-PPR-LAY', componentName: 'مصنعيات تكسير وتثبيت ولحام واختبار ضغط هيدروليكي', unit: 'm', qtyPerUnit: 1, unitRate: 30, componentType: 'labor' },
    ],
    keywords: ['ppr', 'pn-20', 'pn20', '25mm', 'مواسير تغذية', 'بولي بروبلين', 'مياه ساخنة وباردة'],
  },
  {
    itemCode: 'PLM-PIP-PPR-32',
    itemName: 'مواسير بولي بروبلين PPR PN-20 قطر 32 مم (1 بوصة)',
    description: 'توريد وتركيب مواسير تغذية PPR ضغط 20 بار قطر 32 مم للخطوط الصاعدة والفرعية',
    unit: 'm',
    trade: 'plumbing_sanitary',
    directCost: 160,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 210,
    components: [
      { componentCode: 'MAT-PLM-PPR-32', componentName: 'مواسير PPR PN20 قطر 32 مم', unit: 'm', qtyPerUnit: 1.05, unitRate: 120, componentType: 'material' },
      { componentCode: 'LAB-PLM-PPR-LAY', componentName: 'مصنعيات تمديد ولحام وتثبيت', unit: 'm', qtyPerUnit: 1, unitRate: 40, componentType: 'labor' },
    ],
    keywords: ['ppr', '32mm', '32 مم', '1 بوصة ppr'],
  },
  {
    itemCode: 'PLM-PIP-UPVC-110',
    itemName: 'مواسير صرف صحي UPVC قطر 110 مم (4 بوصة) سمك 3.2 مم Class 4',
    description: 'توريد وتركيب مواسير صرف UPVC قطر 110 مم شاملة اللوازم والجوانات والشحم والتعليق بالميول الهندسية',
    unit: 'm',
    trade: 'plumbing_sanitary',
    directCost: 220,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 290,
    components: [
      { componentCode: 'MAT-PLM-UPVC-110', componentName: 'مواسير UPVC رمادي 110 مم ولوازم صرف ووصلات مرنة', unit: 'm', qtyPerUnit: 1.05, unitRate: 165, componentType: 'material' },
      { componentCode: 'LAB-PLM-UPVC-LAY', componentName: 'مصنعيات تركيب وتثبيت كليات واختبار السريان والميول', unit: 'm', qtyPerUnit: 1, unitRate: 55, componentType: 'labor' },
    ],
    keywords: ['upvc', '110mm', '110 مم', '4 بوصة', 'مواسير صرف', 'صرف صحي', 'upvc drainage'],
  },
  {
    itemCode: 'PLM-PIP-UPVC-75',
    itemName: 'مواسير صرف خفيف UPVC قطر 75 مم (2.5 - 3 بوصة)',
    description: 'توريد وتركيب مواسير صرف UPVC قطر 75 مم لصرف الأحواض والبانيوهات وصفايات الأرضية',
    unit: 'm',
    trade: 'plumbing_sanitary',
    directCost: 150,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 195,
    components: [
      { componentCode: 'MAT-PLM-UPVC-75', componentName: 'مواسير UPVC 75 مم ولوازم', unit: 'm', qtyPerUnit: 1.05, unitRate: 110, componentType: 'material' },
      { componentCode: 'LAB-PLM-UPVC-LAY', componentName: 'مصنعيات تركيب وتثبيت', unit: 'm', qtyPerUnit: 1, unitRate: 40, componentType: 'labor' },
    ],
    keywords: ['75mm', '75 مم', 'صرف خفيف', 'صرف احواض'],
  },
  {
    itemCode: 'PLM-SAN-WC-SET',
    itemName: 'مرحاض معلق بالحائط Wall-Hung WC مع صندوق طرد مدفون وخلاط شطاف',
    description: 'توريد وتركيب طقم مرحاض إفرنجي معلق بالجوريت والخزان المدفون والشطاف الساخن والبارد والمحبس الزاوي والمقعد الهيدروليك',
    unit: 'set',
    trade: 'plumbing_sanitary',
    directCost: 6500,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 8500,
    components: [
      { componentCode: 'MAT-PLM-WC-GEB', componentName: 'خزان دفن جروهي/جيبريت مع شاسيه تثبيت ومرحاض ديورافيت/إيديال', unit: 'set', qtyPerUnit: 1, unitRate: 5500, componentType: 'material' },
      { componentCode: 'LAB-PLM-WC-INST', componentName: 'مصنعيات تثبيت الشاسيه والربط والتشطيب وضبط مستوى الطرد', unit: 'set', qtyPerUnit: 1, unitRate: 1000, componentType: 'labor' },
    ],
    keywords: ['water closet', 'wc', 'مرحاض', 'قاعدة حمام', 'خزان دفن', 'طقم حمام', 'كرسي حمام'],
  },
  {
    itemCode: 'PLM-SAN-WSH-BAS',
    itemName: 'حوض غسيل أيدي رخامي/سيراميك مع الخلاط والهراب والمحابس',
    description: 'توريد وتركيب حوض غسيل أيدي ساقط في الرخام أو معلق مع خلاط مياه نحاسي كروم عالي الجودة والهراب والسيفون النحاسي',
    unit: 'set',
    trade: 'plumbing_sanitary',
    directCost: 2800,
    wastePercent: 2,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 3650,
    components: [
      { componentCode: 'MAT-PLM-BAS-SET', componentName: 'حوض خزفي وخلاط جروهي/إيديال وسيفون كروم ومحبسين زاويين', unit: 'set', qtyPerUnit: 1, unitRate: 2300, componentType: 'material' },
      { componentCode: 'LAB-PLM-BAS-INST', componentName: 'مصنعيات تثبيت وتوصيل واختبار عدم التسريب', unit: 'set', qtyPerUnit: 1, unitRate: 500, componentType: 'labor' },
    ],
    keywords: ['wash basin', 'lavatory', 'حوض غسيل', 'مغسلة', 'حوض وش', 'خلاط حوض'],
  },
  {
    itemCode: 'PLM-HTR-ELE-80L',
    itemName: 'سخان مياه كهربائي سعة 80 لتر مع صمام الأمان والمحابس',
    description: 'توريد وتركيب سخان مياه كهربائي سعة 80 لتر صاج مجلفن مبطن إيناميلد مع صمام أمان مزدوج والمحابس والوصلات المرنة الإستانلس',
    unit: 'item',
    trade: 'plumbing_sanitary',
    directCost: 3500,
    wastePercent: 1,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 4600,
    components: [
      { componentCode: 'MAT-PLM-HTR-80L', componentName: 'سخان أوليمبيك/أريستون 80 لتر وصمام عدم رجوع وخراطيم نيكل', unit: 'item', qtyPerUnit: 1, unitRate: 3000, componentType: 'material' },
      { componentCode: 'LAB-PLM-HTR-INST', componentName: 'مصنعيات تعليق وتوصيل مياه وكهرباء وتشغيل', unit: 'item', qtyPerUnit: 1, unitRate: 500, componentType: 'labor' },
    ],
    keywords: ['water heater', 'سخان مياه', 'سخان كهرباء', 'سخان 80', 'سخان 50'],
  },

  // ==========================================================================
  // 6. CIVIL & CONCRETE WORKS
  // ==========================================================================
  {
    itemCode: 'CIV-EXC-GEN-01',
    itemName: 'حفر عام بالموقع لزوم الأساسات في جميع أنواع التربة العادية والصخرية',
    description: 'أعمال حفر عام للأساسات بالموقع بكافة أعماقه ومناسيبه في كافة أنواع التربة العادية والصخرية ونقل ناتج الحفر للمقالب العمومية المعتمدة',
    unit: 'm3',
    trade: 'civil_concrete',
    directCost: 45,
    wastePercent: 0,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 60,
    components: [
      { componentCode: 'EQP-CIV-EXCAV', componentName: 'حفار هيدروليكي شاكوش ولودر وسيارات نقل قلاب', unit: 'm3', qtyPerUnit: 1, unitRate: 35, componentType: 'equipment' },
      { componentCode: 'LAB-CIV-EXC-WRK', componentName: 'عمال تسوية قاع الحفر وضبط المناسيب مع المساح', unit: 'm3', qtyPerUnit: 1, unitRate: 10, componentType: 'labor' },
    ],
    keywords: ['excavation', 'حفر', 'حفريات', 'تربة صخرية', 'حفر الموقع', 'earth works', 'site excavation'],
  },
  {
    itemCode: 'CIV-BCK-SOIL-01',
    itemName: 'ردم بأتربة نظيفة موردة أو ناتج حفر صالح على طبقات 25 سم مع الدمك',
    description: 'أعمال ردم حول الأساسات وداخل المبنى برمال نظيفة متدرجة على طبقات لا تتجاوز 25 سم مع الرش بالماء والدمك الميكانيكي واختبار نسبة الدمك (95%)',
    unit: 'm3',
    trade: 'civil_concrete',
    directCost: 75,
    wastePercent: 10,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 105,
    components: [
      { componentCode: 'MAT-CIV-SAND-FILL', componentName: 'رمال نظيفة موردة صالحة للدمك', unit: 'm3', qtyPerUnit: 1.1, unitRate: 45, componentType: 'material' },
      { componentCode: 'EQP-CIV-COMPACT', componentName: 'هراس دكاك ميكانيكي وتانك مياه واختبار سند كون', unit: 'm3', qtyPerUnit: 1, unitRate: 18, componentType: 'equipment' },
      { componentCode: 'LAB-CIV-FILL-WRK', componentName: 'عمال فرد وتسوية ورش مياه', unit: 'm3', qtyPerUnit: 1, unitRate: 12, componentType: 'labor' },
    ],
    keywords: ['backfilling', 'backfill', 'ردم', 'ردم حول الاساسات', 'احلال', 'طبقات ردم'],
  },
  {
    itemCode: 'CIV-CON-PLN-10',
    itemName: 'خرسانة عادية فرشة نظافة للأساسات سمك 10 سم إجهاد 15-20 ن/مم2',
    description: 'صب خرسانة عادية Blinding Concrete فرشة نظافة أسفل القواعد واللبشة سمك 10 سم محتوى 250 كجم أسمنت/م3 شاملة الفرم الخشبية والتسوية والرش بالماء',
    unit: 'm3',
    trade: 'civil_concrete',
    directCost: 1150,
    wastePercent: 3,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 1490,
    components: [
      { componentCode: 'MAT-CIV-CON-PLN', componentName: 'خرسانة جاهزة عادية C20 محتوى 250 كجم أسمنت بورتلاندي', unit: 'm3', qtyPerUnit: 1.03, unitRate: 950, componentType: 'material' },
      { componentCode: 'LAB-CIV-CON-CAS', componentName: 'مصنعيات نجارة أطراف وصب ومروحة هليكوبتر وتسوية', unit: 'm3', qtyPerUnit: 1, unitRate: 200, componentType: 'labor' },
    ],
    keywords: ['plain concrete', 'blinding', 'خرسانة عادية', 'فرشة نظافة', 'صبة نظافة', 'pc concrete'],
  },
  {
    itemCode: 'CIV-CON-RFC-FND',
    itemName: 'خرسانة مسلحة للقواعد واللبشة والسملات إجهاد 30-35 ن/مم2 أسمنت مقاوم',
    description: 'توريد وصب خرسانة مسلحة للقواعد المنفصلة والشريطية واللبشة والسملات أسمنت مقاوم للكبريتات SRC شاملة حديد التسليح العالي المقاومة والنجارة والفرم والاختبارات ومعالجة المياه',
    unit: 'm3',
    trade: 'civil_concrete',
    directCost: 4600,
    wastePercent: 4,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 5950,
    components: [
      { componentCode: 'MAT-CIV-CON-SRC', componentName: 'خرسانة جاهزة C35 أسمنت مقاوم SRC بالبامب', unit: 'm3', qtyPerUnit: 1.03, unitRate: 1450, componentType: 'material' },
      { componentCode: 'MAT-CIV-STL-BAR', componentName: 'حديد تسليح عالي المقاومة B500D (معدل 90 كجم/م3)', unit: 'kg', qtyPerUnit: 95, unitRate: 28, componentType: 'material' },
      { componentCode: 'LAB-CIV-FND-ALL', componentName: 'مصنعيات نجارة وحدادة وصب وهزاز ومعالجة ورش خيش', unit: 'm3', qtyPerUnit: 1, unitRate: 490, componentType: 'labor' },
    ],
    keywords: ['foundations', 'reinforced concrete for foundations', 'خرسانة مسلحة للقواعد', 'قواعد مسلحة', 'لبشة مسلحة', 'سملات', 'footings', 'raft'],
  },
  {
    itemCode: 'CIV-CON-RFC-COL',
    itemName: 'خرسانة مسلحة للأعمدة وحوائط القص الخرسانية إجهاد 35-40 ن/مم2',
    description: 'توريد وصب خرسانة مسلحة للأعمدة الرأسية وحوائط القص Core/Shear Walls شاملة حديد التسليح والكانات والنجارة بكونتر مطلي والاكسسوارات والدمك الميكانيكي',
    unit: 'm3',
    trade: 'civil_concrete',
    directCost: 5900,
    wastePercent: 4,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 7650,
    components: [
      { componentCode: 'MAT-CIV-CON-OPC', componentName: 'خرسانة جاهزة C40 أسمنت بورتلاندي عادي بالبامب', unit: 'm3', qtyPerUnit: 1.03, unitRate: 1550, componentType: 'material' },
      { componentCode: 'MAT-CIV-STL-COL', componentName: 'حديد تسليح للأعمدة وكانات أوتوماتيك (معدل 135 كجم/م3)', unit: 'kg', qtyPerUnit: 140, unitRate: 28, componentType: 'material' },
      { componentCode: 'LAB-CIV-COL-ALL', componentName: 'مصنعيات نجارة أعمدة بالتقوية والوزن الرأسي وحدادة وصب وهزاز', unit: 'm3', qtyPerUnit: 1, unitRate: 700, componentType: 'labor' },
    ],
    keywords: ['columns', 'reinforced concrete for columns', 'خرسانة مسلحة للأعمدة', 'أعمدة خرسانية', 'حملات واعمدة', 'shear walls'],
  },
  {
    itemCode: 'CIV-CON-RFC-SLB',
    itemName: 'خرسانة مسلحة للأسقف والكمرات والبلاطات Flat Slab / Solid Slab',
    description: 'توريد وصب خرسانة مسلحة للأسقف والكمرات والبلاطات المسطحة والهوردي شاملة الشدات المعدنية والنجارة والتسليح والصب ومعالجة السطح بالهليكوبتر',
    unit: 'm3',
    trade: 'civil_concrete',
    directCost: 5200,
    wastePercent: 4,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 6750,
    components: [
      { componentCode: 'MAT-CIV-CON-SLB', componentName: 'خرسانة جاهزة C35 عادية بالبامب', unit: 'm3', qtyPerUnit: 1.03, unitRate: 1450, componentType: 'material' },
      { componentCode: 'MAT-CIV-STL-SLB', componentName: 'حديد تسليح شبكات علوية وسفلية وفواتير (معدل 110 كجم/م3)', unit: 'kg', qtyPerUnit: 115, unitRate: 28, componentType: 'material' },
      { componentCode: 'LAB-CIV-SLB-ALL', componentName: 'مصنعيات شدات معدنية ونجارة وحدادة وصب وهزاز وهليكوبتر', unit: 'm3', qtyPerUnit: 1, unitRate: 530, componentType: 'labor' },
    ],
    keywords: ['slabs', 'reinforced concrete for slabs', 'خرسانة مسلحة للأسقف', 'اسقف وكمرات', 'بلاطات مسلحة', 'flat slab', 'solid slab'],
  },

  // ==========================================================================
  // 7. MASONRY & PARTITIONS
  // ==========================================================================
  {
    itemCode: 'MAS-BLK-SOL-20',
    itemName: 'مباني طوب أسمنتي مصمت سمك 20-25 سم للأدوار الأرضية والقصية',
    description: 'توريد وبناء حوائط طوب أسمنتي مصمت عالي الكثافة سمك 20 سم أو 25 سم بمونة الأسمنت والرمل 300 كجم/م3 مع كانات الربط والشبك المعدني وسقي العراميس',
    unit: 'm2',
    trade: 'masonry',
    directCost: 260,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 340,
    components: [
      { componentCode: 'MAT-MAS-SOL-BLK', componentName: 'طوب أسمنتي مصمت 20×20×40 سم ورمل وأسمنت بورتلاندي', unit: 'm2', qtyPerUnit: 1.05, unitRate: 190, componentType: 'material' },
      { componentCode: 'LAB-MAS-BLD-WRK', componentName: 'مصنعيات بناء وضبط شاقولية وميزان مياه وتشريب', unit: 'm2', qtyPerUnit: 1, unitRate: 70, componentType: 'labor' },
    ],
    keywords: ['solid cement block', 'طوب مصمت', 'طوب اسمنتي مصمت', 'قصية ردم', 'مباني سمك 25 سم', 'مباني مصمت'],
  },
  {
    itemCode: 'MAS-BLK-HOL-20',
    itemName: 'مباني طوب أسمنتي مفرغ سمك 20 سم للحوائط الخارجية والقواطع',
    description: 'توريد وبناء حوائط طوب أسمنتي مفرغ سمك 20 سم مع الأعمدة الملاصقة وشرائح الشبك المجلفن وكانات الربط والكانات الزاوية والمونة الأسمنتية',
    unit: 'm2',
    trade: 'masonry',
    directCost: 195,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 255,
    components: [
      { componentCode: 'MAT-MAS-HOL-BLK', componentName: 'طوب أسمنتي مفرغ 20×20×40 ومونة أسمنتية وشبك تمدد', unit: 'm2', qtyPerUnit: 1.05, unitRate: 140, componentType: 'material' },
      { componentCode: 'LAB-MAS-BLD-WRK', componentName: 'مصنعيات بناء وتفريغ العراميس', unit: 'm2', qtyPerUnit: 1, unitRate: 55, componentType: 'labor' },
    ],
    keywords: ['hollow cement block', 'طوب مفرغ', 'طوب اسمنتي مفرغ', 'مباني 20 سم', 'بلوك مفرغ', 'hollow block'],
  },
  {
    itemCode: 'MAS-BLK-AAC-20',
    itemName: 'مباني طوب خفيف عازل AAC سيبوركس سمك 20 سم مع المونة اللاصقة',
    description: 'توريد وبناء بلوكات خرسانية خلوية خفيفة معالجة بالأوتوكلاف AAC سمك 20 سم بالمونة اللاصقة الخاصة والزوايا المجلفنة',
    unit: 'm2',
    trade: 'masonry',
    directCost: 310,
    wastePercent: 4,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 400,
    components: [
      { componentCode: 'MAT-MAS-AAC-BLK', componentName: 'بلوك خفيف AAC 20 سم وغراء ومونة لاصقة خاصة', unit: 'm2', qtyPerUnit: 1.04, unitRate: 235, componentType: 'material' },
      { componentCode: 'LAB-MAS-AAC-WRK', componentName: 'مصنعيات بناء وقص بالمنشار وضبط استواء', unit: 'm2', qtyPerUnit: 1, unitRate: 75, componentType: 'labor' },
    ],
    keywords: ['aac block', 'autoclaved aerated concrete', 'طوب خفيف', 'سيبوركس', 'طوب عازل', 'siporex'],
  },

  // ==========================================================================
  // 8. THERMAL & MOISTURE PROTECTION / WATERPROOFING
  // ==========================================================================
  {
    itemCode: 'INS-MEM-BIT-4MM',
    itemName: 'عزل مائي ممبرين بيتوميني معدل SBS/APP سمك 4 مم مسطح بالكامل',
    description: 'توريد وتركيب عزل مائي لفائف بيتومين مسلحة بالبوليستر سمك 4 مم ملحومة باللهب مع دهان وجه برايمر تحضيري وركوب 10 سم واختبار الغمر بالماء 48 ساعة',
    unit: 'm2',
    trade: 'waterproofing',
    directCost: 140,
    wastePercent: 10,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 185,
    components: [
      { componentCode: 'MAT-INS-BIT-MEM', componentName: 'لفائف ممبرين 4 مم بوليستر وبرايمر بيتوميني وغاز تسخين', unit: 'm2', qtyPerUnit: 1.12, unitRate: 105, componentType: 'material' },
      { componentCode: 'LAB-INS-TORCH', componentName: 'مصنعيات فرد ولحام بالبشبوري وعمل وزرة رقبة زجاجة واختبار مائي', unit: 'm2', qtyPerUnit: 1, unitRate: 35, componentType: 'labor' },
    ],
    keywords: ['waterproofing membrane', '4mm', 'bituminous membrane', 'عزل مائي', 'ممبرين 4 مم', 'لفائف بيتومينية', 'عزل اسطح', 'app-modified', 'membrane roofing'],
  },
  {
    itemCode: 'INS-THM-XPS-50',
    itemName: 'عزل حراري ألواح بولسترين مبثوق XPS سمك 50 مم عالي الكثافة (35 كجم/م3)',
    description: 'توريد وتركيب ألواح العزل الحراري من البوليسترين المبثوق XPS سمك 5 سم كثافة لا تقل عن 35 كجم/م3 بنظام عاشق ومعشوق لأسطح المباني',
    unit: 'm2',
    trade: 'waterproofing',
    directCost: 125,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 165,
    components: [
      { componentCode: 'MAT-INS-XPS-50', componentName: 'ألواح فوم أزرق/أصفر XPS سمك 50 مم وقماش جيوتكستيل فاصل', unit: 'm2', qtyPerUnit: 1.05, unitRate: 105, componentType: 'material' },
      { componentCode: 'LAB-INS-XPS-LAY', componentName: 'مصنعيات رص وتثبيت مع الجيوتكستيل وحماية العزل', unit: 'm2', qtyPerUnit: 1, unitRate: 20, componentType: 'labor' },
    ],
    keywords: ['thermal insulation', 'extruded polystyrene', 'xps', '50mm', 'عزل حراري', 'بوليسترين مبثوق', 'فوم ازرق', 'عزل فوم'],
  },
  {
    itemCode: 'INS-CMT-WET-02',
    itemName: 'عزل أسمنتي بوليمري مرن ثنائي المركب للحمامات والمطابخ والخزانات',
    description: 'توريد ودهان عزل مائي أسمنتي مطاطي مرن وجهين متعامدين مع شريط الشبك فايبر جلاس بالأركان والزوايا واختبار الغمر',
    unit: 'm2',
    trade: 'waterproofing',
    directCost: 110,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 145,
    components: [
      { componentCode: 'MAT-INS-CMT-POL', componentName: 'مركب أسمنتي أكريليكي (سيكا/باسف) وشريط فايبر', unit: 'm2', qtyPerUnit: 1.05, unitRate: 80, componentType: 'material' },
      { componentCode: 'LAB-INS-BRUSH', componentName: 'مصنعيات نظافة ورقبة زجاجة ودهان وجهين واختبار', unit: 'm2', qtyPerUnit: 1, unitRate: 30, componentType: 'labor' },
    ],
    keywords: ['cementitious waterproofing', 'عزل حمامات', 'عزل اسمنتي', 'عزل مطابخ', 'سيكاتوب', 'عزل مائي للخزانات'],
  },

  // ==========================================================================
  // 9. ARCHITECTURAL FINISHES, FLOORING & PAINTING
  // ==========================================================================
  {
    itemCode: 'FIN-PLS-INT-01',
    itemName: 'بياض محارة أسمنتية داخلية للحوائط والأسقف (طرطشة + بؤج وأوتار + بطانة وضهارة)',
    description: 'تنفيذ أعمال البياض الأسمنتي الداخلي سمك 2 سم بمونة الأسمنت والرمل والطرطشة العمومية المساميرية وتركيب شبك الفايبر والزوايا المعدنية والأوتار',
    unit: 'm2',
    trade: 'architecture_finishes',
    directCost: 85,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 115,
    components: [
      { componentCode: 'MAT-FIN-PLS-MTR', componentName: 'أسمنت بورتلاندي ورمل ناعم وأديبوند وشبك فايبر وزوايا ألومنيوم', unit: 'm2', qtyPerUnit: 1.05, unitRate: 45, componentType: 'material' },
      { componentCode: 'LAB-FIN-PLS-WRK', componentName: 'مصنعيات طرطشة وبؤج وأوتار ومحارة ودراعة وقدة', unit: 'm2', qtyPerUnit: 1, unitRate: 40, componentType: 'labor' },
    ],
    keywords: ['plastering', 'plaster', 'محارة', 'بياض اسمنتي', 'بياض داخلي', 'طرطشة', 'لياسة'],
  },
  {
    itemCode: 'FIN-PNT-JOT-INT',
    itemName: 'دهانات بلاستيك أكريليك داخلية فاخرة (سيلر + 2 سكينة معجون + 2 وش تشطيب جوتن)',
    description: 'تنفيذ دهانات داخلية تشمل وش سيلر مائي مقاوم للأملاح وسكينتين معجون داخلي عالي النعومة والصنفرة ووجهين دهان بلاستيك نصف لامع أو مطفي جوتن/فينوماستيك',
    unit: 'm2',
    trade: 'architecture_finishes',
    directCost: 75,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 100,
    components: [
      { componentCode: 'MAT-FIN-PNT-JOT', componentName: 'سيلر ومعجون جاهز وبلاستيك جوتن أملشن وبكر تيب وصنفرة', unit: 'm2', qtyPerUnit: 1.05, unitRate: 45, componentType: 'material' },
      { componentCode: 'LAB-FIN-PNT-WRK', componentName: 'مصنعيات سيلر وسحب معجون وصنفرة وإضاءة كشاف ودهان وشين', unit: 'm2', qtyPerUnit: 1, unitRate: 30, componentType: 'labor' },
    ],
    keywords: ['painting', 'paint', 'دهانات', 'دهان بلاستيك', 'جوتن', 'معجون ودهان', 'acrylic paint', 'fenomastic'],
  },
  {
    itemCode: 'FIN-TIL-CER-6060',
    itemName: 'أرضيات سيراميك/بورسلين فرز أول مقاس 60×60 سم مع الغراء وسقية الأسمنت الأبيض',
    description: 'توريد وتركيب بلاط سيراميك أو بورسلين أرضيات مقاس 60×60 سم قص ليزر مع مادة اللصق الغراء والصلبان وسقية الفواصل بالإيبوكسي أو الأسمنت الأبيض الملون والوزرة',
    unit: 'm2',
    trade: 'architecture_finishes',
    directCost: 220,
    wastePercent: 6,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 290,
    components: [
      { componentCode: 'MAT-FIN-CER-6060', componentName: 'بلاط سيراميك/بورسلين 60×60 فرز أول وغراء لصق وسقية ملونة', unit: 'm2', qtyPerUnit: 1.06, unitRate: 150, componentType: 'material' },
      { componentCode: 'LAB-FIN-TIL-WRK', componentName: 'مصنعيات رمال تسوية ومونة أو غراء ولصق ووزرة وميزان ليزر وسقية', unit: 'm2', qtyPerUnit: 1, unitRate: 70, componentType: 'labor' },
    ],
    keywords: ['ceramic', 'porcelain', 'سيراميك', 'بورسلين', 'بلاط ارضيات', 'ceramic tiles', '60x60', '60*60'],
  },
  {
    itemCode: 'FIN-MRB-TRS-TRG',
    itemName: 'توريد وتركيب رخام أرضيات ودرج وسلالم (تريستا / صني / كرارة) مع الجلي والتلميع',
    description: 'توريد وتركيب رخام طبيعي فاخر للأرضيات والدرج سمك 2 سم إلى 4 سم شامل المونة الأسمنتية والتثبيت بالميكانيك/المونة والجلي بالماس والتلميع بالكريستال',
    unit: 'm2',
    trade: 'architecture_finishes',
    directCost: 550,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 720,
    components: [
      { componentCode: 'MAT-FIN-MRB-SLB', componentName: 'ترابيع رخام طبيعي سمك 2-3 سم ومونة بيضاء ورمل ناصع', unit: 'm2', qtyPerUnit: 1.05, unitRate: 400, componentType: 'material' },
      { componentCode: 'LAB-FIN-MRB-WRK', componentName: 'مصنعيات تركيب رخام وسقية وجلي صاروخ وتلميع كريستال', unit: 'm2', qtyPerUnit: 1, unitRate: 150, componentType: 'labor' },
    ],
    keywords: ['marble', 'رخام', 'رخام تريستا', 'درج رخام', 'درج وسلم', 'جلي وتلميع', 'صني منيا', 'granite'],
  },
  {
    itemCode: 'FIN-INT-LOC-6CM',
    itemName: 'توريد وتركيب بلاط إنترلوك للساحات والمشايات سمك 6-8 سم أشكال ملونة',
    description: 'توريد وتركيب بلاط إنترلوك خرساني ملون سمك 6 سم أو 8 سم متداخل للساحات والممرات مع تسوية وفرش طبقة الرمال النظيفة 5 سم والدك بالدكاك الهزاز وملء الفواصل',
    unit: 'm2',
    trade: 'architecture_finishes',
    directCost: 160,
    wastePercent: 4,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 210,
    components: [
      { componentCode: 'MAT-FIN-INT-BLK', componentName: 'بلاط إنترلوك خرساني إجهاد 400 كجم/سم2 ورمل زجاجي', unit: 'm2', qtyPerUnit: 1.04, unitRate: 115, componentType: 'material' },
      { componentCode: 'LAB-FIN-INT-LAY', componentName: 'مصنعيات فرش رمل وتسوية ورص إنترلوك ودك بالهزاز', unit: 'm2', qtyPerUnit: 1, unitRate: 45, componentType: 'labor' },
    ],
    keywords: ['interlock', 'انترلوك', 'إنترلوك', 'بلاط ممرات', 'مشايات', 'interlocking tiles', 'curbstone', 'بردورات'],
  },
  {
    itemCode: 'FIN-CLG-GYP-9MM',
    itemName: 'أسقف معلقة ألواح جبسوم بورد عادية ومقاومة للرطوبة سمك 12.5 مم',
    description: 'توريد وتركيب أسقف معلقة من ألواح الجبس الجبسوم بورد سمك 12.5 مم على شاسيه معدني مجلفن (أوميجا وسي وتي) شاملة معجون الفواصل وشريط الفيبر والصنفرة',
    unit: 'm2',
    trade: 'architecture_finishes',
    directCost: 190,
    wastePercent: 5,
    overheadPercent: 10,
    profitMarkupPercent: 15,
    suggestedUnitPrice: 250,
    components: [
      { componentCode: 'MAT-FIN-GYP-BRD', componentName: 'ألواح جبسوم بورد كناوف وشاسيه صاج مجلفن وتياش ومسامير ومعجون', unit: 'm2', qtyPerUnit: 1.05, unitRate: 130, componentType: 'material' },
      { componentCode: 'LAB-FIN-GYP-INST', componentName: 'مصنعيات شيرب ليزر وتعليق شاسيه وتثبيت ألواح ومعالجة فواصل', unit: 'm2', qtyPerUnit: 1, unitRate: 60, componentType: 'labor' },
    ],
    keywords: ['gypsum board', 'جبسوم بورد', 'اسقف معلقة', 'سقف ساقط', 'false ceiling', 'knauf'],
  },
];

/**
 * Match a raw description / itemCode against the engineering constants library
 */
export function matchEngineeringConstant(
  description: string,
  itemCode?: string,
  dbConstants?: any[]
): EngineeringConstantItem | any | null {
  const desc = (description || '').toLowerCase();
  const code = (itemCode || '').trim().toLowerCase();

  const allConstants = (dbConstants && dbConstants.length > 0)
    ? dbConstants
    : HARDCODED_ENGINEERING_CONSTANTS;

  // 1. Exact or partial itemCode match
  if (code) {
    const codeMatch = allConstants.find((c: any) =>
      (c.itemCode || '').toLowerCase() === code ||
      (c.item_code || '').toLowerCase() === code
    );
    if (codeMatch) return normalizeToStandardConstant(codeMatch);
  }

  // 2. Fire Search Tube System (High Priority Check before generic CO2)
  if (new RegExp('fire search|firesearch|self actuating|tube system|أنبوب حراري|خرطوم حراري|اطفاء لوحات', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'FF-SYS-FSRCH-01');
    if (found) return normalizeToStandardConstant(found);
  }

  // 3. Fire Fighting - Seamless Steel Pipes Schedule 40 (ASTM A53)
  if (new RegExp('seamless|سيملس|صلب|أسود جدول 40|schedule 40|astm a\\s*53', 'i').test(desc)) {
    let targetCode = 'FF-PIP-STM-50'; // default
    if (new RegExp('25\\s*mm|25mm|1\\s*inch|1\"|1\\s*بوصة', 'i').test(desc)) targetCode = 'FF-PIP-STM-25';
    else if (new RegExp('32\\s*mm|32mm|1\\.25|1 1/4|1\\.25\\s*بوصة', 'i').test(desc)) targetCode = 'FF-PIP-STM-32';
    else if (new RegExp('40\\s*mm|40mm|1\\.5|1 1/2|1\\.5\\s*بوصة|بوصة ونصف', 'i').test(desc)) targetCode = 'FF-PIP-STM-40';
    else if (new RegExp('50\\s*mm|50mm|2\\s*inch|2\"|2\\s*بوصة', 'i').test(desc)) targetCode = 'FF-PIP-STM-50';
    else if (new RegExp('65\\s*mm|65mm|2\\.5|2 1/2|2\\.5\\s*بوصة|بوصتين ونصف', 'i').test(desc)) targetCode = 'FF-PIP-STM-65';
    else if (new RegExp('80\\s*mm|80mm|3\\s*inch|3\"|3\\s*بوصة', 'i').test(desc)) targetCode = 'FF-PIP-STM-80';
    else if (new RegExp('100\\s*mm|100mm|4\\s*inch|4\"|4\\s*بوصة', 'i').test(desc)) targetCode = 'FF-PIP-STM-100';
    else if (new RegExp('150\\s*mm|150mm|6\\s*inch|6\"|6\\s*بوصة', 'i').test(desc)) targetCode = 'FF-PIP-STM-150';

    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === targetCode);
    if (found) return normalizeToStandardConstant(found);
  }

  // 4. Fire Fighting - HDPE SDR11 Underground Pipes
  if (new RegExp('hdpe|بولي إيثيلين|بولي ايثيلين|sdr11|sdr 11|مدفون', 'i').test(desc) && new RegExp('fire|حريق|شبكة الحريق', 'i').test(desc)) {
    let targetCode = 'FF-PIP-HDP-90'; // default
    if (new RegExp('65\\s*mm|65mm', 'i').test(desc)) targetCode = 'FF-PIP-HDP-65';
    else if (new RegExp('90\\s*mm|90mm', 'i').test(desc)) targetCode = 'FF-PIP-HDP-90';
    else if (new RegExp('110\\s*mm|110mm', 'i').test(desc)) targetCode = 'FF-PIP-HDP-110';
    else if (new RegExp('160\\s*mm|160mm', 'i').test(desc)) targetCode = 'FF-PIP-HDP-160';

    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === targetCode);
    if (found) return normalizeToStandardConstant(found);
  }

  // 5. Fire Fighting - Sprinklers
  if (new RegExp('sprinkler|pendent|upright|رشاش|رشاشات', 'i').test(desc) && new RegExp('fire|حريق', 'i').test(desc)) {
    const targetCode = new RegExp('upright|قائم', 'i').test(desc) ? 'FF-SPK-UPR-15' : 'FF-SPK-PEND-15';
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === targetCode);
    if (found) return normalizeToStandardConstant(found);
  }

  // 6. Fire Hose Cabinets
  if (new RegExp('hose cabinet|fhc|صندوق حريق|كابينة حريق|بكرة خرطوم|hose reel|fire cabinet|دولاب حريق', 'i').test(desc)) {
    const targetCode = new RegExp('single|مفرد|فردي', 'i').test(desc) ? 'FF-FHC-SGL-01' : 'FF-FHC-COMB-02';
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === targetCode) ||
                  allConstants.find((c: any) => (c.itemCode || c.item_code) === 'FF-FHC-COMB-02');
    if (found) return normalizeToStandardConstant(found);
  }

  // 7. Fire Extinguishers
  if (new RegExp('extinguisher|طفاية|طفايات|بودرة|dry chemical|abc', 'i').test(desc) && !new RegExp('co2|ثاني أكسيد|ثاني اكسيد', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'FF-EXT-DRY-06');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('co2|ثاني أكسيد|ثاني اكسيد|carbon dioxide', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'FF-EXT-CO2-06');
    if (found) return normalizeToStandardConstant(found);
  }

  // 8. Fire Valves & Accessories
  if (new RegExp('zone control valve|zcv|flow switch|محبس قطاعي', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'FF-VLV-ZCV-100');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('gate valve|محبس سكينة|nrs|tie-in|tie in', 'i').test(desc) && new RegExp('fire|حريق', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'FF-VLV-NRS-80');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('air vent|a\\.a\\.v|aav|تنفيس|تصريف هواء', 'i').test(desc) && new RegExp('fire|حريق', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'FF-VLV-AAV-25');
    if (found) return normalizeToStandardConstant(found);
  }

  // 9. Testing, Builder's Works & Motors
  if (new RegExp('flushing|hydrostatic|غسيل الشبكة|اختبار هيدروستاتيكي', 'i').test(desc) || (new RegExp('testing|commissioning', 'i').test(desc) && new RegExp('fire|اطفاء|حريق|رشاشات', 'i').test(desc))) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'FF-TST-COMM-01');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('builder|core|sleeves|اعمال مدنية مساعدة|تخريم|جرابات|ترميم', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'FF-BLD-WRK-01');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('motor|electrical requirements|متطلبات كهربية|محركات', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'FF-MTR-REQ-01');
    if (found) return normalizeToStandardConstant(found);
  }

  // 10. Electrical Power & Distribution Infrastructure
  if (new RegExp('الموزع|لوحة التوزيع الرئيسية|switchgear|24 ك ف|24kv', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'EL-SWG-MED-24');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('أكشاك المحولات|كشك محول|1000 ك ف أ|1000 kva|transformer', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'EL-TRF-DRY-1000');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('كابلات الجهد المتوسط|18/30|30/18|3×240 مم2 xlpe|3\\*240 مم2 xlpe', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'EL-CAB-MED-240');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('كابلات التغذية الرئيسية|كابلات الجهد المنخفض|xlpe\\\\sta\\\\pvc|كابل 3\\*', 'i').test(desc)) {
    if (new RegExp('240\\+120|240 \\+ 120', 'i').test(desc)) {
      const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'EL-CAB-LOW-240');
      if (found) return normalizeToStandardConstant(found);
    }
    if (new RegExp('185\\+95|185 \\+ 95', 'i').test(desc)) {
      const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'EL-CAB-LOW-185');
      if (found) return normalizeToStandardConstant(found);
    }
    if (new RegExp('120\\+70|120 \\+ 70', 'i').test(desc)) {
      const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'EL-CAB-LOW-120');
      if (found) return normalizeToStandardConstant(found);
    }
  }
  if (new RegExp('الأرضى|نظام أرضى|أرضي|مقاومة لاتزيد', 'i').test(desc)) {
    if (new RegExp('3 أوم|3 اوم', 'i').test(desc)) {
      const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'EL-EAR-PIT-MV');
      if (found) return normalizeToStandardConstant(found);
    }
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'EL-EAR-PIT-LV');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('العدايات|عدايات|تعدية الشوارع', 'i').test(desc)) {
    if (new RegExp('6 بوصة|6\"', 'i').test(desc)) {
      const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'EL-CON-UPVC-150');
      if (found) return normalizeToStandardConstant(found);
    }
    if (new RegExp('4 بوصة|4\"', 'i').test(desc)) {
      const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'EL-CON-UPVC-100');
      if (found) return normalizeToStandardConstant(found);
    }
  }
  if (new RegExp('distribution board|db-01|لوحة توزيع فرعية|لوحة قواطع|12 way', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'EL-PAN-DB-12W');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('60x60|60\\*60|60×60|led panel|كشاف 60|تروفر', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'EL-LGT-LED-6060');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('downlight|سبوت لايت|داون لايت|dl-01|spotlight', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'EL-LGT-DWN-15W');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('socket|duplex socket|بريزة|مأخذ|مخارج قوى|16a|13a', 'i').test(desc) && !new RegExp('smoke|network', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'EL-SOK-DUP-16A');
    if (found) return normalizeToStandardConstant(found);
  }

  // 11. Low Current Systems
  if (new RegExp('cctv|ip camera|dome camera|bullet camera|كاميرا مراقبة|كاميرات', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'LC-CCTV-CAM-IP4');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('smoke detector|optical detector|كاشف دخان|حساس دخان|إنذار حريق|fire alarm detector|sd-01', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'LC-FA-DET-OPT');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('data point|cat6|rj45|مخرج داتا|نقطة شبكة|شبكة معلومات|utp', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'LC-DATA-PNT-CAT6');
    if (found) return normalizeToStandardConstant(found);
  }

  // 12. HVAC, Air Conditioning & Ventilation
  if (new RegExp('split|dx|a/c|air\\s*condition|مكيف|تكييف', 'i').test(desc)) {
    if (new RegExp('2\\.25\\s*hp|2\\.25hp|2\\.25\\s*حصان|a/c-01', 'i').test(desc)) {
      const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'HVAC-AC-DX-225');
      if (found) return normalizeToStandardConstant(found);
    }
    if (new RegExp('3\\s*hp|3hp|3\\s*حصان|a/c-02', 'i').test(desc)) {
      const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'HVAC-AC-DX-300');
      if (found) return normalizeToStandardConstant(found);
    }
    if (new RegExp('4\\s*hp|4hp|4\\s*حصان|a/c-03', 'i').test(desc)) {
      const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'HVAC-AC-DX-400');
      if (found) return normalizeToStandardConstant(found);
    }
    if (new RegExp('5\\s*hp|5hp|5\\s*حصان|a/c-04', 'i').test(desc)) {
      const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'HVAC-AC-DX-500');
      if (found) return normalizeToStandardConstant(found);
    }
  }

  if (new RegExp('copper\\s*pipe|مواسير نحاس|نحاس تبريد|liquid & suction|suction line', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'HVAC-PIP-COPPER');
    if (found) return normalizeToStandardConstant(found);
  }

  if (new RegExp('exhaust\\s*fan|centrifugal|wall\\s*mounted|decorative|مروحة|مراوح', 'i').test(desc) || new RegExp('\\bcfm\\b', 'i').test(desc)) {
    if (new RegExp('decorative|d\\.f-01', 'i').test(desc)) {
      const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'HVAC-FAN-DEC-100');
      if (found) return normalizeToStandardConstant(found);
    }
    if (new RegExp('w\\.m\\.f|wall\\s*mounted', 'i').test(desc) || (new RegExp('100\\s*cfm', 'i').test(desc) && !new RegExp('centrifugal|ex\\.cen', 'i').test(desc))) {
      const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'HVAC-FAN-WALL-100');
      if (found) return normalizeToStandardConstant(found);
    }
    if (new RegExp('300\\s*cfm|ex\\.cen\\.f-01', 'i').test(desc)) {
      const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'HVAC-FAN-CEN-300');
      if (found) return normalizeToStandardConstant(found);
    }
    if (new RegExp('400\\s*cfm|ex\\.cen\\.f-02', 'i').test(desc)) {
      const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'HVAC-FAN-CEN-400');
      if (found) return normalizeToStandardConstant(found);
    }
    if (new RegExp('800\\s*cfm|ex\\.cen\\.f-03', 'i').test(desc)) {
      const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'HVAC-FAN-CEN-800');
      if (found) return normalizeToStandardConstant(found);
    }
  }

  if (new RegExp('smacna|galvanized.*duct|sheet\\s*metal\\s*duct|دكت|صاج', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'HVAC-DCT-SMACNA-01');
    if (found) return normalizeToStandardConstant(found);
  }

  // 13. Plumbing & Drainage
  if (new RegExp('ppr|بولي بروبلين|تغذية بالمياه', 'i').test(desc)) {
    const targetCode = new RegExp('32\\s*mm|32mm|1\\s*بوصة', 'i').test(desc) ? 'PLM-PIP-PPR-32' : 'PLM-PIP-PPR-25';
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === targetCode);
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('upvc|مواسير صرف|صرف صحي|drainage pipe', 'i').test(desc)) {
    const targetCode = new RegExp('75\\s*mm|75mm|صرف خفيف', 'i').test(desc) ? 'PLM-PIP-UPVC-75' : 'PLM-PIP-UPVC-110';
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === targetCode);
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('water closet|مرحاض|قاعدة حمام|خزان دفن|طقم حمام|كرسي حمام|wc', 'i').test(desc) && !new RegExp('basin|lavatory', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'PLM-SAN-WC-SET');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('wash basin|lavatory|حوض غسيل|مغسلة|حوض وش', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'PLM-SAN-WSH-BAS');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('water heater|سخان مياه|سخان كهرباء', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'PLM-HTR-ELE-80L');
    if (found) return normalizeToStandardConstant(found);
  }

  // 14. Civil & Concrete Works
  if (new RegExp('excavation|حفر|حفريات|تربة صخرية|حفر الموقع', 'i').test(desc) && !new RegExp('backfill|ردم', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'CIV-EXC-GEN-01');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('backfilling|backfill|ردم|احلال|طبقات ردم', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'CIV-BCK-SOIL-01');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('plain concrete|blinding|خرسانة عادية|فرشة نظافة|صبة نظافة|pc concrete', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'CIV-CON-PLN-10');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('foundations|footings|raft|قواعد مسلحة|لبشة مسلحة|سملات|خرسانة مسلحة للقواعد', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'CIV-CON-RFC-FND');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('columns|أعمدة خرسانية|خرسانة مسلحة للأعمدة|shear walls', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'CIV-CON-RFC-COL');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('slabs|flat slab|solid slab|خرسانة مسلحة للأسقف|اسقف وكمرات|بلاطات مسلحة', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'CIV-CON-RFC-SLB');
    if (found) return normalizeToStandardConstant(found);
  }

  // 15. Masonry
  if (new RegExp('aac block|autoclaved|طوب خفيف|سيبوركس|siporex', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'MAS-BLK-AAC-20');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('solid cement block|طوب مصمت|طوب اسمنتي مصمت|قصية ردم', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'MAS-BLK-SOL-20');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('hollow cement block|طوب مفرغ|طوب اسمنتي مفرغ|بلوك مفرغ|hollow block', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'MAS-BLK-HOL-20');
    if (found) return normalizeToStandardConstant(found);
  }

  // 16. Thermal & Moisture Protection / Waterproofing
  if (new RegExp('waterproofing membrane|bituminous membrane|عزل مائي|ممبرين|لفائف بيتومينية|عزل اسطح|app-modified|membrane roofing', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'INS-MEM-BIT-4MM');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('thermal insulation|extruded polystyrene|xps|عزل حراري|بوليسترين مبثوق|فوم ازرق', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'INS-THM-XPS-50');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('cementitious waterproofing|عزل حمامات|عزل اسمنتي|عزل مطابخ|سيكاتوب', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'INS-CMT-WET-02');
    if (found) return normalizeToStandardConstant(found);
  }

  // 17. Architectural Finishes
  if (new RegExp('plastering|plaster|محارة|بياض اسمنتي|بياض داخلي|طرطشة|لياسة', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'FIN-PLS-INT-01');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('painting|paint|دهانات|دهان بلاستيك|جوتن|fenomastic', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'FIN-PNT-JOT-INT');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('ceramic|porcelain|سيراميك|بورسلين|بلاط ارضيات|ceramic tiles', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'FIN-TIL-CER-6060');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('marble|رخام|تريستا|درج سلم|جلي وتلميع|صني منيا|granite', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'FIN-MRB-TRS-TRG');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('interlock|انترلوك|إنترلوك|بلاط ممرات|مشايات|interlocking', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'FIN-INT-LOC-6CM');
    if (found) return normalizeToStandardConstant(found);
  }
  if (new RegExp('gypsum board|جبسوم بورد|اسقف معلقة|سقف ساقط|false ceiling|knauf', 'i').test(desc)) {
    const found = allConstants.find((c: any) => (c.itemCode || c.item_code) === 'FIN-CLG-GYP-9MM');
    if (found) return normalizeToStandardConstant(found);
  }

  // 18. Hardcoded Constants Keyword Matching
  for (const item of HARDCODED_ENGINEERING_CONSTANTS) {
    for (const kw of item.keywords) {
      if (desc.includes(kw.toLowerCase())) {
        return item;
      }
    }
  }

  // 19. Fallback keyword matching across generic constants
  for (const c of allConstants) {
    const name = (c.itemName || c.item_name || '').toLowerCase();
    const words = name.split(/\s+/).filter((w: string) => w.length >= 4);
    const matchedWords = words.filter((w: string) => desc.includes(w));
    if (matchedWords.length >= 2) {
      return normalizeToStandardConstant(c);
    }
  }

  return null;
}

function normalizeToStandardConstant(c: any): EngineeringConstantItem {
  if (c.components && c.suggestedUnitPrice) {
    return c as EngineeringConstantItem;
  }

  const directCost = Number(c.direct_cost || c.directCost || 0);
  const waste = Number(c.waste_percent || c.wastePercent || 5);
  const overhead = Number(c.overhead_percent || c.overheadPercent || 10);
  const profit = Number(c.profit_markup_percent || c.profitMarkupPercent || 15);

  const costWithWaste = directCost * (1 + waste / 100);
  const costWithOverhead = costWithWaste * (1 + overhead / 100);
  // INV-FE3-FRONTEND-BOOK-DIGITS: the suggested unit price is money; it
  // rounds at the tenant's book digits, not hardcoded 2dp. (The
  // Number.EPSILON nudge is dropped: roundMoneyValue matches the backend
  // half-up rule exactly, and the nudge diverged from it at .xx5.)
  const suggestedUnitPrice = roundMoneyValue(costWithOverhead * (1 + profit / 100), currencyMoneyDigits(getGlobalSystemCurrency()));

  return {
    itemCode: c.item_code || c.itemCode || 'ENG-CONST',
    itemName: c.item_name || c.itemName || '',
    description: c.description || c.item_name || '',
    unit: c.unit || 'item',
    trade: c.trade_category || c.tradeCategory || c.trade || 'general',
    directCost,
    wastePercent: waste,
    overheadPercent: overhead,
    profitMarkupPercent: profit,
    suggestedUnitPrice: suggestedUnitPrice > 0 ? suggestedUnitPrice : directCost * 1.32,
    components: Array.isArray(c.components_json) ? c.components_json : (c.components || []),
    keywords: [],
  };
}
