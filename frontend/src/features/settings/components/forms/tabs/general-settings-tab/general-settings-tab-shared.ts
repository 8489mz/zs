export function getPillarBadgeInfo(rawActivity?: string | null, pillar?: string | null, isEn = false) {
  const norm = String(rawActivity || pillar || 'retail_general').trim().toLowerCase();
  if (norm === 'contracting' || norm === 'construction' || norm === 'مقاولات') {
    return {
      shortTitle: isEn ? 'Contracting ERP' : 'قطاع المقاولات',
      title: isEn ? 'Contracting & Construction Management' : 'قطاع المقاولات وإدارة المشاريع الإنشائية',
      badge: isEn ? 'Projects & BOQ' : 'مشاريع ومقايسات',
      desc: isEn ? 'Integrated workspace for projects, BOQ, IPCs, subcontractor contracts, purchasing, warehouses, and accounting.' : 'بيئة عمل متكاملة للمشاريع والمقايسات (BOQ) والمستخلصات وعقود مقاولي الباطن والمشتريات والمخازن والحسابات.',
      color: '#0284c7',
      bg: '#f0f9ff',
      borderColor: '#bae6fd',
    };
  }
  if (norm === 'maritime_freight' || norm === 'maritime' || norm === 'freight' || norm === 'shipping' || norm === 'شحن') {
    return {
      shortTitle: isEn ? 'Maritime Freight' : 'قطاع الشحن',
      title: isEn ? 'Maritime Freight & Logistics' : 'قطاع الشحن البحري واللوجستيات',
      badge: isEn ? 'Ocean & Containers' : 'نولون وحاويات',
      desc: isEn ? 'Integrated system for shipping lines, ports, freight RFQ, operation orders, and demurrage tracking.' : 'بيئة عمل متكاملة للخطوط الملاحية، الموانئ، مقارنة أسعار النولون (RFQ)، أوامر التشغيل وتتبع الحاويات.',
      color: '#0d9488',
      bg: '#f0fdfa',
      borderColor: '#99f6e4',
    };
  }
  if (norm === 'pharmacy' || norm === 'صيدلية') {
    return {
      shortTitle: isEn ? 'Commerce' : 'قطاع التجارة',
      title: isEn ? 'Commerce: Pharmacies & Medical Supplies' : 'قطاع التجارة: صيدليات ومستلزمات طبية',
      badge: isEn ? 'FEFO Pharmacy' : 'صيدليات FEFO',
      desc: isEn ? 'Integrated management of drugs & alternatives, batch tracking & expiry dates, and prescriptions.' : 'إدارة متكاملة للأدوية والبدائل، تتبع التشغيلات وتواريخ انتهاء الصلاحية، والروشتات.',
      color: '#16a34a',
      bg: '#f0fdf4',
      borderColor: '#bbf7d0',
    };
  }
  if (norm === 'restaurant' || norm === 'cafe' || norm === 'مطعم') {
    return {
      shortTitle: isEn ? 'Commerce' : 'قطاع التجارة',
      title: isEn ? 'Commerce: Restaurants & Cafes' : 'قطاع التجارة: مطاعم وكافيهات وضيافة',
      badge: isEn ? 'Restaurant KDS' : 'مطاعم KDS',
      desc: isEn ? 'Kitchen display system, dining tables, meal modifiers & toppings, and fast takeaway.' : 'إدارة متكاملة لشاشات المطبخ، خيارات الوجبات والإضافات، والصالات ونقاط البيع.',
      color: '#ea580c',
      bg: '#fff7ed',
      borderColor: '#fed7aa',
    };
  }
  if (norm === 'manufacturing' || norm === 'تصنيع') {
    return {
      shortTitle: isEn ? 'Manufacturing' : 'قطاع التصنيع',
      title: isEn ? 'Commerce: Industrial Production' : 'قطاع التجارة: تصنيع وخطوط إنتاج خفيف',
      badge: isEn ? 'BOM Production' : 'تصنيع BOM',
      desc: isEn ? 'Bills of materials (BOM), work orders, production routing, and manufacturing costing.' : 'إدارة متكاملة لقوائم المكونات (BOM)، أوامر التشغيل والإنتاج، وحساب التكاليف الصناعية.',
      color: '#7c3aed',
      bg: '#f5f3ff',
      borderColor: '#ddd6fe',
    };
  }
  if (norm === 'maintenance' || norm === 'electronics' || norm === 'صيانة') {
    return {
      shortTitle: isEn ? 'Commerce' : 'قطاع التجارة',
      title: isEn ? 'Commerce: Maintenance & Service Centers' : 'قطاع التجارة: مراكز صيانة وخدمة أجهزة',
      badge: isEn ? 'Job Cards' : 'كروت صيانة',
      desc: isEn ? 'Device intake, warranty cards, IMEI serial tracking, and spare parts.' : 'إدارة متكاملة لكروت فحص واستلام الأجهزة، قطع الغيار المستهلكة، وتتبع أرقام السيريال.',
      color: '#2563eb',
      bg: '#eff6ff',
      borderColor: '#bfdbfe',
    };
  }
  if (norm === 'auto_parts' || norm === 'autoparts' || norm === 'قطع_غيار') {
    return {
      shortTitle: isEn ? 'Commerce' : 'قطاع التجارة',
      title: isEn ? 'Commerce: Auto Parts & Equipment' : 'قطاع التجارة: قطع غيار ومعدات',
      badge: isEn ? 'Auto Parts OEM' : 'قطع غيار',
      desc: isEn ? 'Parts directory, OEM numbers, vehicle compatibility and cross-reference.' : 'إدارة متكاملة لأكواد قطع الغيار، سنة الصنع، والموديلات المتوافقة.',
      color: '#b45309',
      bg: '#fffbeb',
      borderColor: '#fde68a',
    };
  }
  if (norm === 'import_export' || norm === 'import' || norm === 'استيراد') {
    return {
      shortTitle: isEn ? 'Commerce' : 'قطاع التجارة',
      title: isEn ? 'Commerce: Import & International Trade' : 'قطاع التجارة: استيراد وتصدير وشراكة',
      badge: isEn ? 'Import & Customs' : 'استيراد وتصدير',
      desc: isEn ? 'Customs shipments, overseas vendor payables, and landed cost tracking.' : 'إدارة متكاملة للشحنات الاستيرادية وتكاليف الوصول ومستندات الشحن.',
      color: '#0369a1',
      bg: '#f0f9ff',
      borderColor: '#bae6fd',
    };
  }
  if (norm === 'clothing' || norm === 'fashion' || norm === 'ملابس') {
    return {
      shortTitle: isEn ? 'Commerce' : 'قطاع التجارة',
      title: isEn ? 'Commerce: Apparel & Fashion' : 'قطاع التجارة: أزياء وملابس ومقاسات',
      badge: isEn ? 'Fashion Matrix' : 'ملابس ومقاسات',
      desc: isEn ? 'Multi-variant size and color matrix, fashion barcode generation, and seasonal styles.' : 'إدارة متكاملة للمقاسات والألوان وتوليد الباركود التلقائي للمصفوفة.',
      color: '#db2777',
      bg: '#fdf2f8',
      borderColor: '#fbcfe8',
    };
  }
  return {
    shortTitle: isEn ? 'Commerce' : 'قطاع التجارة',
    title: isEn ? 'Commerce & Retail Business' : 'قطاع التجارة وإدارة الأعمال العامة',
    badge: isEn ? 'Retail & POS' : 'تجزئة ومستودعات',
    desc: isEn ? 'Fast POS, warehouses & inventory, purchasing, and financial accounts.' : 'إدارة متكاملة لنقاط البيع السريعة، المخازن والمستودعات، المشتريات، والحسابات المالية.',
    color: '#170e5e',
    bg: '#eef2ff',
    borderColor: '#c7d2fe',
  };
}

export function getIndustrySummary(ind?: string, isEn = false) {
  const norm = String(ind || 'general').trim().toLowerCase();
  switch (norm) {
    case 'contracting':
    case 'construction':
    case 'مقاولات':
      return isEn ? 'Contracting & Construction Management' : 'قطاع المقاولات وإدارة المشاريع الإنشائية';
    case 'maritime_freight':
    case 'maritime':
    case 'freight':
    case 'shipping':
    case 'شحن':
      return isEn ? 'Maritime Freight & Logistics' : 'قطاع الشحن البحري واللوجستيات';
    case 'fashion':
      return isEn ? 'Apparel, Sizes & Variant Matrix' : 'موديول الملابس والمقاسات ومصفوفة الأصناف';
    case 'perfumes':
      return isEn ? 'Perfume Formulations & Packaging' : 'موديول تركيبات العطور والعبوات';
    case 'pharmacy':
    case 'صيدلية':
      return isEn ? 'Pharmacy, Medications & Expiry (FEFO)' : 'موديول الصيدلية والأدوية وتواريخ الصلاحية (FEFO)';
    case 'electronics':
    case 'maintenance':
    case 'صيانة':
      return isEn ? 'Maintenance Cards, Devices & Serial/IMEI' : 'موديول كروت الصيانة والأجهزة والسيريال والـ IMEI';
    case 'cafe':
    case 'restaurant':
    case 'مطعم':
      return isEn ? 'Restaurants, Cafes & Kitchen Displays (KDS)' : 'موديول المطاعم والكافيهات وشاشات المطبخ (KDS)';
    case 'manufacturing':
    case 'تصنيع':
      return isEn ? 'Industrial Production & Bills of Materials (BOM)' : 'موديول التصنيع وقوائم المكونات (BOM)';
    case 'general':
    default:
      return isEn ? 'Standard Commercial & General Business Management' : 'النشاط التجاري القياسي وإدارة الأعمال العامة';
  }
}
