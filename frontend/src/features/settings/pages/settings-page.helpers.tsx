import type { ReactNode } from 'react';
import i18n from '@/lib/i18n';
import { translateUiText } from '@/lib/auto-translator';
import { downloadExcelFile } from '@/lib/browser';
import type { BackupSnapshotRecord } from '@/features/settings/components/SettingsWorkspacePrimitives';

export type SettingsConfirmAction =
  | { kind: 'restore-file'; file: File }
  | { kind: 'restore-snapshot'; snapshot: BackupSnapshotRecord }
  | { kind: 'cleanup-expired-sessions' }
  | { kind: 'reconcile-customers' }
  | { kind: 'reconcile-suppliers' }
  | { kind: 'reconcile-all' };

interface SettingsGuidanceInput {
  section: string;
  sectionLabel: string;
  setupMode: boolean;
  setupStepTitle?: string | null;
  branchesCount: number;
  locationsCount: number;
  filteredBranchesCount: number;
  filteredLocationsCount: number;
  storeName?: string | null;
  currentUserRole: string;
  snapshotsCount: number;
}

export function getSettingsSectionDescription(section: string, vertical?: string) {
  const isEn = i18n.language === 'en';
  if (section === 'core') {
    if (vertical === 'maritime') return isEn ? 'Maritime shipping agency details, freight controls, demurrage rules, and document letterheads.' : 'بيانات شركة التوكيلات والشحن الملاحي، ضوابط النولون وغرامات الحاويات، وترويسة الفواتير والمطبوعات.';
    if (vertical === 'contracting') return isEn ? 'Contracting company details, retention warranty rates, advance payment limits, and tender pricing margins.' : 'بيانات شركة المقاولات، نسب ضمان الأعمال والدفعة المقدمة، وهوامش تسعير العطاءات والمقايسات.';
    return isEn ? 'Organization details, sales & inventory policies, system modules, and printing & receipts.' : 'بيانات المنشأة، سياسات البيع والمخزون، موديولات النظام، والطباعة والإيصالات.';
  }
  if (section === 'reference') {
    if (vertical === 'maritime') return isEn ? 'Manage maritime headquarters, shipping offices, ports, terminals, and container yards.' : 'إدارة المقرات والمكاتب الملاحية، الموانئ ومحطات ومستودعات الحاويات (Yards & Terminals).';
    if (vertical === 'contracting') return isEn ? 'Manage administrative headquarters, project work sites, and field storage warehouses.' : 'إدارة المقرات الإدارية، مواقع العمل والمشاريع، ومخازن التشوين الميدانية.';
    return isEn ? 'Manage branches, pickup points, operational warehouses, and inventory stores.' : 'إدارة الفروع، نقاط الاستلام، والمستودعات التشغيلية ومخازن البضاعة.';
  }
  if (section === 'users') {
    if (vertical === 'maritime') return isEn ? 'Manage shipping coordinators, port staff accounts, and authority matrix.' : 'إدارة حسابات منسقي الشحن، موظفي الموانئ والمكتب الملاحي، ومصفوفة الصلاحيات.';
    if (vertical === 'contracting') return isEn ? 'Manage site engineers, project managers accounts, and field permissions matrix.' : 'إدارة حسابات مهندسي المواقع، مديري المشاريع، ومصفوفة الصلاحيات الميدانية.';
    return isEn ? 'Manage employee accounts, job roles, and permissions matrix.' : 'إدارة حسابات الموظفين، الأدوار الوظيفية، ومصفوفة الصلاحيات.';
  }
  if (section === 'tax-integration') return isEn ? 'Direct integration with Egyptian Tax Authority (ETA) and Zakat, Tax and Customs Authority (ZATCA).' : 'الربط المباشر مع مصلحة الضرائب المصرية (ETA) وهيئة الزكاة والضريبة (ZATCA).';
  if (section === 'storefront' || section === 'marketplaces') return isEn ? 'Manage external e-commerce storefront, payment & shipping gateways, and Amazon & Noon integration.' : 'إدارة المتجر الإلكتروني الخارجي، بوابات الدفع والشحن، والربط مع أمازون ونون.';
  if (section === 'whatsapp' || section === 'daily-digest') return isEn ? 'Cloud WhatsApp messaging gateway, intelligent auto-responder bot, and daily executive digest.' : 'بوابة رسائل الواتساب السحابية، روبوت الرد الذكي، وإرسال الملخص اليومي للمدير.';
  if (section === 'backup') return isEn ? 'Data backup, export & import data, and system maintenance utilities.' : 'النسخ الاحتياطي، تصدير واستيراد البيانات، وأدوات صيانة النظام.';
  if (section === 'subscription') return isEn ? 'Cloud subscription details, resource consumption, plan renewal, and billing.' : 'تفاصيل الاشتراك السحابي، استهلاك الموارد، وتجديد الباقة والفوترة.';
  if (section === 'demo-data') return isEn ? 'Generate or clear demo sandbox data based on industry vertical.' : 'توليد أو مسح البيانات التجريبية حسب طبيعة النشاط التجاري.';
  if (section === 'lan-network') return isEn ? 'Local area network (LAN) sync settings and multi-device connection on local server.' : 'إعدادات مزامنة الشبكة المحلية والربط المتعدد للأجهزة على السيرفر المحلي.';
  if (section === 'system-updates') return isEn ? 'System release history and cloud update check.' : 'سجل إصدارات النظام والتحقق من التحديثات السحابية.';
  if (section === 'monitoring') return isEn ? 'Server performance monitoring (APM) and Telegram alerts.' : 'المراقبة ورصد أداء الخادم (APM) والتنبيهات عبر تيليجرام.';
  return isEn ? 'System configuration and operational rules.' : 'إعدادات وضوابط تشغيل المنظومة.';
}

export function buildSettingsGuidanceCards(input: SettingsGuidanceInput, vertical?: string) {
  const isEn = i18n.language === 'en';
  const nextAction = input.setupMode
    ? (input.setupStepTitle || (isEn ? 'Complete the current setup step first' : 'أكمل خطوة التهيئة الحالية أولًا'))
    : input.section === 'core'
      ? (isEn ? 'Edit business details then click Save before moving on.' : 'عدّل بيانات النشاط ثم اضغط حفظ قبل الانتقال.')
      : input.section === 'reference'
        ? (vertical === 'maritime'
            ? (isEn ? 'Search for the required maritime office or port, then edit or delete from the table.' : 'ابحث عن المقر الملاحي أو الميناء المطلوب ثم عدّل أو احذف من نفس الجدول.')
            : vertical === 'contracting'
            ? (isEn ? 'Search for the required work site or storage yard, then edit or delete from the table.' : 'ابحث عن الموقع أو مخزن التشوين المطلوب ثم عدّل أو احذف من نفس الجدول.')
            : (isEn ? 'Search for the required branch or warehouse, then edit or delete from the table.' : 'ابحث عن الفرع أو المخزن المطلوب ثم عدّل أو احذف من نفس الجدول.'))
        : input.section === 'users'
          ? (isEn ? 'Review accounts and permissions, then update the selected user.' : 'راجع الحسابات والصلاحيات ثم حدّث المستخدم المطلوب.')
          : (isEn ? 'Take a backup first, then run import or restore after verification.' : 'خذ نسخة أولًا، ثم نفّذ الاستيراد أو الاستعادة بعد التأكد.');

  const focusValue = input.section === 'core'
      ? (input.storeName || (isEn ? 'Core Business Details' : 'بيانات النشاط الأساسية'))
      : input.section === 'reference'
        ? (vertical === 'maritime'
            ? (isEn ? `${input.filteredBranchesCount} shipping offices / ${input.filteredLocationsCount} ports & terminals` : `${input.filteredBranchesCount} مقر ملاحي / ${input.filteredLocationsCount} ميناء ومحطة حاويات`)
            : vertical === 'contracting'
            ? (isEn ? `${input.filteredBranchesCount} work sites / ${input.filteredLocationsCount} storage yards` : `${input.filteredBranchesCount} موقع عمل / ${input.filteredLocationsCount} مخزن تشوين`)
            : (isEn ? `${input.filteredBranchesCount} visible branches / ${input.filteredLocationsCount} visible warehouses` : `${input.filteredBranchesCount} فرع ظاهر / ${input.filteredLocationsCount} مخزن ظاهر`))
        : input.section === 'users'
          ? (input.currentUserRole === 'super_admin' ? (isEn ? 'User management available' : 'إدارة المستخدمين متاحة') : (isEn ? 'This screen is restricted to administrators' : 'هذه الشاشة مخصصة للمشرف العام'))
          : (isEn ? `${input.snapshotsCount} automatic backups available` : `${input.snapshotsCount} نسخة تلقائية متاحة`);

  const cautionValue = input.section === 'backup'
    ? (isEn ? 'Restore will completely replace all existing data.' : 'الاستعادة تستبدل البيانات الحالية بالكامل.')
    : input.section === 'users'
      ? (isEn ? 'Use least-privilege permissions for each account.' : 'استخدم أقل صلاحية ممكنة لكل حساب.')
      : input.section === 'reference'
        ? (vertical === 'maritime'
            ? (isEn ? 'Ensure every port or terminal is linked to a distinct shipping office.' : 'احرص أن يكون كل ميناء أو محطة مرتبطة بمقر ملاحي واضح.')
            : vertical === 'contracting'
            ? (isEn ? 'Ensure every storage yard is linked to a distinct project or site.' : 'احرص أن يكون كل مخزن تشوين مرتبطاً بموقع أو مقر إدارة واضح.')
            : (isEn ? 'Ensure every warehouse is linked to a distinct branch.' : 'احرص أن يكون كل مخزن مرتبطًا بفرع واضح.'))
        : (isEn ? 'Change only what is necessary, then save.' : 'غيّر ما تحتاجه فقط ثم احفظ.');

  const sectionLabel = isEn ? (translateUiText(input.sectionLabel) || input.sectionLabel) : input.sectionLabel;

  return [
    { key: 'section', label: isEn ? 'Current Section' : 'القسم الحالي', value: sectionLabel },
    { key: 'next', label: isEn ? 'Recommended Next Step' : 'الخطوة الأنسب الآن', value: nextAction },
    { key: 'focus', label: isEn ? 'Current Focus' : 'التركيز الحالي', value: focusValue },
    { key: 'caution', label: isEn ? 'Important Note' : 'ملاحظة مهمة', value: cautionValue },
  ];
}

async function resolveTenantPrimaryLocationName(): Promise<string> {
  try {
    const { http } = await import('@/lib/http');
    const locRes = await http<any>('/api/locations');
    const locations = locRes.locations || [];
    const branchStockLoc = locations.find((l: any) => l.isActive && (l.locationType === 'branch_stock' || (l.name && String(l.name).startsWith('رصيد'))));
    const activeLoc = branchStockLoc || locations.find((l: any) => l.isActive) || locations[0];
    if (activeLoc?.name) {
      return String(activeLoc.name).trim();
    }
  } catch (err) {
    console.warn('Could not fetch locations for template', err);
  }
  return 'رصيد الفرع الرئيسي';
}

export async function downloadSettingsTemplate(kind: 'products' | 'customers' | 'customers-retail' | 'customers-van' | 'suppliers' | 'opening-stock') {
  if (kind === 'products') {
    const defaultLocationName = await resolveTenantPrimaryLocationName();
    downloadExcelFile('products-template.xlsx', ['اسم الصنف (إجباري)', 'اسم الصنف (إنجليزي)', 'الباركود', 'القسم', 'المورد', 'سعر التكلفة', 'سعر البيع', 'سعر الجملة', 'الحد الأدنى', 'الكمية', 'المخزن', 'وحدة القياس الأساسية', 'وحدة البيع', 'وحدة الشراء', 'اسم وحدة إضافية', 'معامل الوحدة الإضافية', 'باركود الوحدة الإضافية', 'ملاحظات'], [['منتج جديد', 'New product', '123456789012', 'عام', 'مورد تجريبي', 50, 70, 60, 5, 24, defaultLocationName, 'قطعة', 'قطعة', 'كرتونة', 'كرتونة', 12, '123456789013', 'ملاحظات']]);
    return;
  }
  if (kind === 'customers' || kind === 'customers-retail') {
    downloadExcelFile(
      'customers-retail-template.xlsx',
      ['اسم العميل (إجباري)', 'رقم الموبايل', 'العنوان', 'نوع العميل (نقدي / آجل)', 'الحد الائتماني', 'رصيد افتتاحي', 'رصيد محفظة', 'اسم الشركة', 'الرقم الضريبي', 'ملاحظات'],
      [
        ['محمد أحمد', '01012345678', 'شارع التحرير، الدقي، الجيزة', 'نقدي', 0, 1500, 0, 'مؤسسة النور', '300123456700003', 'عميل تجزئة منتظم'],
        ['علي حسن', '01123456789', 'شارع الهرم، الجيزة', 'آجل', 3000, 0, 0, '', '', ''],
      ],
    );
    return;
  }
  if (kind === 'customers-van') {
    downloadExcelFile(
      'customers-van-wholesale-template.xlsx',
      [
        'اسم العميل / المحل (إجباري)',
        'كود المحل / العميل',
        'رقم الموبايل',
        'خط السير / مسار التوزيع',
        'الحي / المربع السكني',
        'العنوان التفصيلي',
        'يوم الزيارة الأسبوعي',
        'أيام الزيارة (إن تعددت)',
        'ترتيب خط السير',
        'المندوب المسؤول / المخصص',
        'رابط الموقع / GPS',
        'فئة السعر',
        'نوع النشاط / التصنيف',
        'نوع العميل (نقدي / آجل)',
        'الحد الائتماني',
        'رصيد افتتاحي',
        'اسم المنشأة / الشركة',
        'الرقم الضريبي',
        'ملاحظات',
      ],
      [
        [
          'سوبرماركت الأمل',
          'CUST-1001',
          '01012345678',
          'خط الهرم',
          'العشرين',
          'شارع فيصل الرئيسي بجوار بنك مصر',
          'الإثنين',
          'الإثنين، الخميس',
          1,
          'أحمد محمود',
          'https://maps.google.com/?q=30.0131,31.2089',
          'جملة',
          'سوبرماركت',
          'آجل',
          5000,
          1200,
          'شركة الأمل للتجارة',
          '300123456700003',
          'عميل جملة أسبوعي',
        ],
        [
          'بقالة البركة',
          'CUST-1002',
          '01198765432',
          'خط فيصل',
          'الطوابق',
          'شارع المنشية تقاطع الطوابق',
          'الأحد',
          'الأحد',
          2,
          'محمد علي',
          'https://maps.google.com/?q=30.0150,31.2050',
          'قطاعي',
          'بقالة',
          'نقدي',
          0,
          0,
          'بقالة البركة',
          '',
          'سداد كاش مع كل تسليم',
        ],
      ],
    );
    return;
  }
  if (kind === 'suppliers') {
    downloadExcelFile('suppliers-template.xlsx', ['اسم المورد (إجباري)', 'رقم الموبايل', 'العنوان', 'رصيد افتتاحي', 'ملاحظات'], [['مورد جديد', '01011111111', 'الجيزة', 2500, 'ملاحظات']]);
    return;
  }
  if (kind === 'opening-stock') {
    const defaultLocationName = await resolveTenantPrimaryLocationName();
    downloadExcelFile('opening-stock-template.xlsx', ['الباركود', 'اسم الصنف', 'الكمية', 'المخزن'], [['123456789012', 'منتج جديد', 24, defaultLocationName]]);
    return;
  }
}

export async function exportSettingsData(kind: 'products' | 'customers' | 'suppliers' | 'opening-stock') {
  const { http } = await import('@/lib/http');
  const dateStr = new Date().toISOString().split('T')[0];

  if (kind === 'products') {
    const defaultLocationName = await resolveTenantPrimaryLocationName();
    let page = 1;
    const allRows: any[][] = [];
    while (true) {
      const res = await http<any>(`/api/products?page=${page}&pageSize=1000`);
      const items = res.products || [];
      for (const p of items) {
        const units = Array.isArray(p.units) ? p.units : [];
        const baseUnit = units.find((u: any) => u.isBaseUnit) || units.find((u: any) => Number(u.multiplier) === 1) || units[0];
        const extraUnit = units.find((u: any) => !u.isBaseUnit && Number(u.multiplier) > 1);
        const saleUnit = units.find((u: any) => u.isSaleUnit) || baseUnit;
        const purchaseUnit = units.find((u: any) => u.isPurchaseUnit) || extraUnit || baseUnit;

        allRows.push([
          p.name || '',
          p.nameEn || p.name_en || '',
          p.barcode || '',
          p.category?.name || p.categoryName || '',
          p.supplier?.name || p.supplierName || '',
          p.costPrice ?? '',
          p.retailPrice ?? '',
          p.wholesalePrice ?? '',
          p.minStock ?? p.minStockQty ?? 0,
          p.stock ?? p.stockQty ?? 0,
          p.locationName || defaultLocationName,
          baseUnit?.name || p.unit?.name || p.unitName || 'قطعة',
          saleUnit?.name || p.saleUnit?.name || 'قطعة',
          purchaseUnit?.name || p.purchaseUnit?.name || 'قطعة',
          extraUnit?.name || '',
          extraUnit?.multiplier ? Number(extraUnit.multiplier) : '',
          extraUnit?.barcode || '',
          p.description || p.notes || '',
        ]);
      }
      if (items.length < 1000) break;
      page += 1;
    }

    downloadExcelFile(
      `products-export-${dateStr}.xlsx`,
      ['اسم الصنف (إجباري)', 'اسم الصنف (إنجليزي)', 'الباركود', 'القسم', 'المورد', 'سعر التكلفة', 'سعر البيع', 'سعر الجملة', 'الحد الأدنى', 'الكمية', 'المخزن', 'وحدة القياس الأساسية', 'وحدة البيع', 'وحدة الشراء', 'اسم وحدة إضافية', 'معامل الوحدة الإضافية', 'باركود الوحدة الإضافية', 'ملاحظات'],
      allRows.length ? allRows : [['لا توجد أصناف مسجلة', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']],
    );
    return;
  }

  if (kind === 'customers') {
    let page = 1;
    const allRows: any[][] = [];
    while (true) {
      const res = await http<any>(`/api/customers?page=${page}&pageSize=1000`);
      const items = res.customers || [];
      for (const c of items) {
        const meta = c.metadata || {};
        allRows.push([
          c.name || '',
          meta.customer_code || meta.code || c.customerCode || '',
          c.phone || '',
          meta.route || '',
          meta.district || meta.area || '',
          c.address || '',
          meta.visit_day || '',
          Array.isArray(meta.visit_days) ? meta.visit_days.join('، ') : (meta.visit_day || ''),
          meta.route_sequence ?? '',
          meta.assigned_rep_name || '',
          meta.location_url || (meta.gps_lat && meta.gps_lng ? `https://maps.google.com/?q=${meta.gps_lat},${meta.gps_lng}` : ''),
          meta.price_tier || '',
          meta.category || '',
          c.type || 'cash',
          c.creditLimit ?? 0,
          c.openingBalance ?? (c.balance ?? 0),
          c.storeCreditBalance ?? 0,
          c.companyName || '',
          c.taxNumber || '',
          meta.notes || '',
        ]);
      }
      if (items.length < 1000) break;
      page += 1;
    }

    downloadExcelFile(
      `customers-export-${dateStr}.xlsx`,
      [
        'اسم العميل / المحل (إجباري)',
        'كود المحل / العميل',
        'رقم الموبايل',
        'خط السير / مسار التوزيع',
        'الحي / المربع السكني',
        'العنوان التفصيلي',
        'يوم الزيارة الأسبوعي',
        'أيام الزيارة',
        'ترتيب خط السير',
        'المندوب المسؤول / المخصص',
        'رابط الموقع / GPS',
        'فئة السعر',
        'نوع النشاط / التصنيف',
        'نوع العميل',
        'الحد الائتماني',
        'رصيد افتتاحي',
        'رصيد محفظة',
        'اسم الشركة',
        'الرقم الضريبي',
        'ملاحظات',
      ],
      allRows.length ? allRows : [['لا يوجد عملاء مسجلين', '', '', '', '', '', '', '', '', '', '', '', '', '', 0, 0, 0, '', '', '']],
    );
    return;
  }

  if (kind === 'suppliers') {
    let page = 1;
    const allRows: any[][] = [];
    while (true) {
      const res = await http<any>(`/api/suppliers?page=${page}&pageSize=1000`);
      const items = res.suppliers || [];
      for (const s of items) {
        allRows.push([
          s.name || '',
          s.phone || '',
          s.address || '',
          s.openingBalance ?? 0,
          s.notes || '',
        ]);
      }
      if (items.length < 1000) break;
      page += 1;
    }

    downloadExcelFile(
      `suppliers-export-${dateStr}.xlsx`,
      ['اسم المورد (إجباري)', 'رقم الموبايل', 'العنوان', 'رصيد افتتاحي', 'ملاحظات'],
      allRows.length ? allRows : [['لا يوجد موردين مسجلين', '', '', 0, '']],
    );
    return;
  }

  if (kind === 'opening-stock') {
    const defaultLocationName = await resolveTenantPrimaryLocationName();
    let locationsRes: any = { locations: [] };
    let stocksRes: any = { stocks: [] };
    try {
      locationsRes = await http<any>('/api/locations');
      stocksRes = await http<any>('/api/location-stocks');
    } catch (e) {
      console.warn('Could not fetch location stocks for export', e);
    }

    const locationMap = new Map(
      (locationsRes.locations || []).map((loc: any) => [String(loc.id), loc.name || ''])
    );

    const stocksByProduct = new Map<string, any[]>();
    for (const st of stocksRes.stocks || []) {
      const pId = String(st.productId);
      if (!stocksByProduct.has(pId)) stocksByProduct.set(pId, []);
      stocksByProduct.get(pId)!.push(st);
    }

    let page = 1;
    const allRows: any[][] = [];
    while (true) {
      const res = await http<any>(`/api/products?page=${page}&pageSize=1000`);
      const items = res.products || [];
      for (const p of items) {
        const pId = String(p.id);
        const pStocks = stocksByProduct.get(pId);
        
        if (pStocks && pStocks.length > 0) {
          for (const st of pStocks) {
            const locName = locationMap.get(String(st.locationId)) || defaultLocationName;
            allRows.push([p.barcode || '', p.name || '', st.qty || 0, locName]);
          }
        } else {
          allRows.push([p.barcode || '', p.name || '', p.stock || 0, defaultLocationName]);
        }
      }
      if (items.length < 1000) break;
      page += 1;
    }

    downloadExcelFile(
      `opening-stock-export-${dateStr}.xlsx`,
      ['الباركود', 'اسم الصنف', 'الكمية', 'المخزن'],
      allRows.length ? allRows : [['', 'لا توجد بيانات مخزون', 0, defaultLocationName]],
    );
  }
}

export function getSettingsConfirmDialogMeta(confirmAction: SettingsConfirmAction | null, busyState: {
  backupBusy: boolean;
  restoreSnapshotBusy: boolean;
  cleanupBusy: boolean;
  reconcileCustomersBusy: boolean;
  reconcileSuppliersBusy: boolean;
  reconcileAllBusy: boolean;
}) {
  const title = confirmAction?.kind === 'restore-file'
    ? 'تأكيد استعادة نسخة احتياطية من ملف'
    : confirmAction?.kind === 'restore-snapshot'
      ? 'تأكيد استعادة نسخة تلقائية'
      : confirmAction?.kind === 'cleanup-expired-sessions'
        ? 'تأكيد تنظيف الجلسات المنتهية'
        : confirmAction?.kind === 'reconcile-customers'
          ? 'تأكيد مطابقة أرصدة العملاء'
          : confirmAction?.kind === 'reconcile-suppliers'
            ? 'تأكيد مطابقة أرصدة الموردين'
            : confirmAction?.kind === 'reconcile-all'
              ? 'تأكيد مطابقة جميع الأرصدة'
              : '';

  const description: ReactNode = confirmAction?.kind === 'restore-file'
    ? <>سيتم استبدال بيانات التشغيل الحالية بمحتوى الملف <strong>{confirmAction.file.name}</strong> بعد التحقق من صلاحيته. استخدم هذه العملية فقط بعد التأكد من أنك تعمل على النسخة الصحيحة.</>
    : confirmAction?.kind === 'restore-snapshot'
      ? <>سيتم استبدال البيانات الحالية بمحتوى النسخة التلقائية <strong>{new Date(confirmAction.snapshot.createdAt).toLocaleString('ar-EG')}</strong>. راجع تاريخ النسخة قبل المتابعة.</>
      : confirmAction?.kind === 'cleanup-expired-sessions'
        ? 'سيتم حذف الجلسات المنتهية لتقليل البيانات غير النشطة وتحسين الأمان.'
        : confirmAction?.kind === 'reconcile-customers'
          ? 'سيتم إعادة احتساب أرصدة العملاء من الحركات الحالية وتحديث القيم المخزنة.'
          : confirmAction?.kind === 'reconcile-suppliers'
            ? 'سيتم إعادة احتساب أرصدة الموردين من الفواتير والمدفوعات الحالية.'
            : confirmAction?.kind === 'reconcile-all'
              ? 'سيتم تنفيذ المطابقة على العملاء والموردين معًا.'
              : '';

  const isBusy = confirmAction?.kind === 'restore-file'
    ? busyState.backupBusy
    : confirmAction?.kind === 'restore-snapshot'
      ? busyState.restoreSnapshotBusy
      : confirmAction?.kind === 'cleanup-expired-sessions'
        ? busyState.cleanupBusy
        : confirmAction?.kind === 'reconcile-customers'
          ? busyState.reconcileCustomersBusy
          : confirmAction?.kind === 'reconcile-suppliers'
            ? busyState.reconcileSuppliersBusy
            : confirmAction?.kind === 'reconcile-all'
              ? busyState.reconcileAllBusy
              : false;

  return { title, description, isBusy };
}
