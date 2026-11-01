import type {
  StorefrontCategory,
  StorefrontInfo,
  StorefrontProduct,
} from '../types/storefront.types';

export type StorefrontLang = 'ar' | 'en';

export const STOREFRONT_LANG_STORAGE_KEY = 'zs_storefront_lang';

export function getSavedStorefrontLang(): StorefrontLang {
  if (typeof window === 'undefined') return 'ar';
  try {
    const saved = window.localStorage.getItem(STOREFRONT_LANG_STORAGE_KEY);
    return saved === 'en' ? 'en' : 'ar';
  } catch {
    return 'ar';
  }
}

/**
 * Category translations (by ID and by Arabic name)
 */
export const CATEGORY_EN_BY_ID: Record<number, string> = {
  1: 'Laptops & Tablets',
  2: 'Smartphones & Audio',
  3: 'Luxury & Smart Watches',
  4: 'Perfumes & Beauty',
  5: 'Sneakers & Casual Shoes',
  6: 'Bags & Sunglasses',
  7: "Men's Fashion",
  8: "Women's Fashion",
};

export const CATEGORY_EN_BY_AR: Record<string, string> = {
  'الهواتف والصوتيات الذكية': 'Smartphones & Audio',
  'اللابتوب والتابلت': 'Laptops & Tablets',
  'الساعات الفاخرة والذكية': 'Luxury & Smart Watches',
  'الأحذية الرياضية والكاجوال': 'Sneakers & Casual Shoes',
  'العطور ومستحضرات التجميل': 'Perfumes & Beauty',
  'الأزياء والملابس الرجالية': "Men's Fashion",
  'الأزياء والملابس النسائية': "Women's Fashion",
  'الحقائب والنظارات الشمسية': 'Bags & Sunglasses',
  'الهواتف': 'Phones',
  'اللابتوب': 'Laptops',
  'الساعات': 'Watches',
  'الأحذية': 'Shoes',
  'العطور': 'Perfumes',
  'رجالي': 'Men',
  'نسائي': 'Women',
  'الحقائب': 'Bags',
  'عام': 'General',
  'قسم عام': 'General Category',
  'أقسام عامة': 'General Categories',
  'منتج أصلي': 'Authentic Product',
  'منتجات مميزة': 'Featured Products',
  'عروض حصرية': 'Exclusive Deals',
};

export const SHORT_CATEGORY_EN_BY_AR: Record<string, string> = {
  'الهواتف والصوتيات الذكية': 'Phones',
  'اللابتوب والتابلت': 'Laptops',
  'الساعات الفاخرة والذكية': 'Watches',
  'الأحذية الرياضية والكاجوال': 'Shoes',
  'العطور ومستحضرات التجميل': 'Perfumes',
  'الأزياء والملابس الرجالية': 'Men',
  'الأزياء والملابس النسائية': 'Women',
  'الحقائب والنظارات الشمسية': 'Bags',
  'الهواتف': 'Phones',
  'اللابتوب': 'Laptops',
  'الساعات': 'Watches',
  'الأحذية': 'Shoes',
  'العطور': 'Perfumes',
  'رجالي': 'Men',
  'نسائي': 'Women',
  'الحقائب': 'Bags',
};

/**
 * Offer badge translations
 */
export const OFFER_BADGE_EN_BY_AR: Record<string, string> = {
  'الأكثر مبيعاً': 'Best Seller',
  'الأكثر طلباً': 'Most Popular',
  'خصم حصري': 'Exclusive Deal',
  'عرض اليوم': "Today's Deal",
  'عرض خاص': 'Special Offer',
  'عرض الحزمة': 'Bundle Deal',
  'إصدار محدود': 'Limited Edition',
  'إصدار خاص': 'Special Edition',
  'إصدار احترافي': 'Pro Edition',
  'كاميرا خارقة': 'Ultra Camera',
  'كاميرا احترافية': 'Pro Camera',
  'قيمة مقابل سعر': 'Best Value',
  'للألعاب والمونتاج': 'Gaming & Creator',
  'جديد': 'New Arrival',
  'خيار اقتصادي': 'Budget Pick',
  'الأقوى للأعمال': 'Top Business Pick',
  'الأقوى أداءً': 'Top Performance',
  'أداء فائق': 'Ultra Performance',
  'شاشة OLED 4K': '4K OLED Display',
  'صوت محيطي': 'Surround Sound',
  'للأعمال والدراسة': 'Work & Study',
  'أحدث معالج': 'Latest Processor',
  'عزل ضوضاء ذكي': 'Smart ANC',
  'صوت 360°': '360° Sound',
  'بطارية 36 ساعة': '36h Battery',
  'شاشة AMOLED': 'AMOLED Display',
  'مساعد ذكي': 'Smart Assistant',
  'تيتانيوم فاخر': 'Luxury Titanium',
  'تصميم كلاسيكي': 'Classic Design',
  'إصدار رياضي': 'Sport Edition',
  'طلي ذهب عيار 18': '18K Gold Plated',
  'ساعة ذكية متكاملة': 'All-in-One Smartwatch',
  'تصميم سويسري': 'Swiss Design',
  'بطارية 14 يوم': '14-Day Battery',
  'مقاومة للصدمات': 'Shock Resistant',
  'أيقونة الموضة': 'Fashion Icon',
  'إصدار 2026': '2026 Edition',
  'راحة طبية': 'Medical Comfort',
  'خفيف الوزن': 'Lightweight',
  'كلاسيك أنيق': 'Sleek Classic',
  'للجري اليومي': 'Daily Running',
  'كلاسيك عصري': 'Modern Classic',
  'ثبات 48 ساعة': '48h Long-Lasting',
  'عطر شرقي فاخر': 'Luxury Oriental',
  'عطر فرنسي أصلي': 'Authentic French',
  'إصدار مسائي فاخر': 'Evening Luxury',
  'مجموعة متكاملة': 'Complete Set',
  'الأكثر مبيعاً نسائياً': "Women's Best Seller",
  'تفتيح ونضارة': 'Brightening & Glow',
  'ترطيب عميق': 'Deep Hydration',
  'عناية متكاملة': 'Complete Care',
  'ترطيب 72 ساعة': '72h Hydration',
  'الأكثر طلباً في الشتاء': 'Winter Best Seller',
  'قطن مصري 100%': '100% Egyptian Cotton',
  'خامة تركية': 'Turkish Fabric',
  'خامة تركية ممتازة': 'Premium Turkish Fabric',
  'إطلالة رسمية': 'Formal Look',
  'إطلالة عصرية': 'Modern Look',
  'تطريز يدوي': 'Hand Embroidery',
  'تطريز يدوي فاخر': 'Handcrafted Embroidery',
  'سهرة ومناسبات': 'Evening & Events',
  'صيف 2026': 'Summer 2026',
  'حرير ناعم': 'Soft Silk',
  'شتاء دافئ': 'Warm Winter',
  'تصميم إيطالي': 'Italian Design',
  'جلد إيطالي فاخر': 'Italian Leather',
  'تصميم عالمي': 'Global Design',
  'للقيادة والسفر': 'Driving & Travel',
  'هدية فاخرة': 'Luxury Gift',
  'كشمير ناعم': 'Soft Cashmere',
  'أرباح مضاعفة': 'Top Value',
  'عدسات مستقطبة': 'Polarized Lenses',
  'إصدار كلاسيك': 'Classic Edition',
  'ضد السرقة والماء': 'Anti-Theft & Waterproof',
  'جلد طبيعي 100%': '100% Genuine Leather',
  'حماية 99%': '99% Protection',
  'شحن فائق السرعة': 'Super Fast Charging',
  'سفر وعمل': 'Travel & Work',
  'نفدت الكمية': 'Out of Stock',
  'تشكيلة جديدة': 'New Collection',
  'عرض لمدة محدودة': 'Limited Time Deal',
  'اختيار المتجر': "Store's Choice",
  'اختيار مميز': 'Featured Pick',
};

/**
 * Complete English catalog data for all Demo Products (IDs 201..207 and 1101..1806)
 */
export const PRODUCT_EN_BY_ID: Record<
  number,
  { name: string; description: string; offerBadge?: string }
> = {
  // Hero & Showcase Products (201..207)
  201: {
    name: 'Apple iPhone 13 Pro Max 5G - 256GB Sierra Blue',
    description:
      '6.7" Super Retina XDR ProMotion 120Hz display, A15 Bionic chip, and pro triple camera system with Cinematic mode.',
    offerBadge: 'Best Seller',
  },
  202: {
    name: 'Apple Watch Series 9 Luxury Gold Stainless Steel - 45mm',
    description:
      'Always-On Retina display, S9 SiP chip, Double Tap gesture, blood oxygen & ECG sensors, and Luxury Milanese loop.',
    offerBadge: 'Exclusive Deal',
  },
  203: {
    name: 'Apple AirPods Max Wireless Over-Ear Headphones - Space Gray',
    description:
      'Pro-level Active Noise Cancellation, Transparency mode, Personalized Spatial Audio, and breathable knit-mesh canopy.',
    offerBadge: 'Surround Sound',
  },
  204: {
    name: "Dior J'adore Eau de Parfum for Women - 100ml Original",
    description:
      'Iconic floral bouquet blending ylang-ylang, Damask rose, and Grasse jasmine with up to 48-hour longevity.',
    offerBadge: 'Most Popular',
  },
  205: {
    name: 'Nike Air Jordan 1 Mid SE Sport Sneakers - Yellow & White',
    description:
      'Iconic basketball heritage design crafted with genuine leather, Air-Sole heel cushioning, and high-grip rubber outsole.',
    offerBadge: 'Special Edition',
  },
  206: {
    name: 'Prada Saffiano Luxury Leather Handbag - Sky Blue',
    description:
      'Scratch-resistant Italian Saffiano leather with gold-plated hardware and detachable shoulder strap.',
    offerBadge: 'Limited Edition',
  },
  207: {
    name: 'ASUS ZenBook Pro Duo 15 OLED Dual-Screen Touch Laptop - Core i9',
    description:
      '4K OLED HDR main touch display + interactive ScreenPad Plus secondary display, Intel Core i9, 32GB RAM, and 1TB NVMe SSD.',
    offerBadge: 'Top Performance',
  },

  // Category 1: Laptops & Tablets (1101..1106)
  1101: {
    name: 'ASUS ZenBook Pro Duo 15 OLED Dual-Screen Touch Laptop - Core i9',
    description:
      '4K OLED HDR touch display with interactive ScreenPad Plus secondary display, Intel Core i9, 32GB RAM, and 1TB SSD.',
    offerBadge: '4K OLED Display',
  },
  1102: {
    name: 'Acer Swift X 14 Creator & Business Laptop - Core i7 / RTX 3050',
    description:
      'Ultra-slim metallic body weighing 1.39 kg, 100% sRGB IPS display, backlit keyboard, and 14-hour battery life.',
    offerBadge: 'Best Value',
  },
  1103: {
    name: 'ASUS VivoBook S15 Ultra-Slim Laptop - Core i7 / 16GB RAM / 512GB SSD',
    description:
      'NanoEdge 15.6" FHD narrow-bezel display, fingerprint sensor, Harman Kardon audio, and fast Type-C charging.',
    offerBadge: 'Ultra Performance',
  },
  1104: {
    name: 'Acer Aspire Vero Eco-Friendly Edition Laptop - Core i5 / 16GB RAM',
    description:
      'Intel Core i5 12th Gen processor, IPS anti-glare display, Wi-Fi 6E, and ultra-fast NVMe SSD.',
  },
  1105: {
    name: 'Apple iPad Pro 12.9" M2 Wi-Fi + 5G - 256GB Space Gray',
    description:
      'Liquid Retina XDR Mini-LED 120Hz display, Apple M2 chip, Apple Pencil Hover support, and Face ID.',
    offerBadge: 'Limited Edition',
  },
  1106: {
    name: 'Lenovo Tab P11 Pro Gen 2 11.2" OLED Tablet + Keyboard & Pen',
    description:
      '120Hz 2.5K OLED display with quad JBL speakers, detachable magnetic keyboard, and Precision Pen 3 included.',
    offerBadge: 'Work & Study',
  },

  // Category 2: Smartphones & Audio (1201..1209)
  1201: {
    name: 'Apple iPhone 13 Pro 5G - 256GB Sierra Blue',
    description:
      'Super Retina XDR ProMotion 120Hz display, A15 Bionic chip, 3x optical zoom triple camera, and IP68 water resistance.',
    offerBadge: 'Best Seller',
  },
  1202: {
    name: 'Apple iPhone 12 Dual SIM 5G - 128GB Purple',
    description:
      '6.1" Super Retina XDR OLED display, Ceramic Shield front, A14 Bionic chip, and Night mode dual camera.',
    offerBadge: "Today's Deal",
  },
  1203: {
    name: 'Samsung Galaxy S22 5G - 256GB Phantom Black',
    description:
      'Dynamic AMOLED 2X 120Hz display, 50MP Nightography pro camera, Armor Aluminum frame, and IP68 water resistance.',
    offerBadge: 'Pro Camera',
  },
  1204: {
    name: 'Apple iPhone 13 5G - 128GB Midnight',
    description:
      'Diagonal dual-camera system with Sensor-Shift OIS, A15 Bionic chip, and all-day battery life.',
  },
  1205: {
    name: 'Realme GT Neo 3 5G - 256GB / 12GB RAM Blue',
    description:
      '150W UltraDart charging (50% in 5 minutes), Sony IMX766 OIS camera, and 120Hz AMOLED display.',
    offerBadge: 'Latest Processor',
  },
  1206: {
    name: 'Apple AirPods Max Wireless Noise Cancelling Headphones',
    description:
      'Apple-designed dynamic driver for high-fidelity audio, industry-leading Active Noise Cancellation, and 20-hour battery.',
    offerBadge: 'Smart ANC',
  },
  1207: {
    name: 'Apple HomePod Mini Smart Speaker - Space Gray',
    description:
      'Rich 360-degree computational audio, Siri voice assistant, smart home hub, and seamless iPhone Handoff.',
    offerBadge: '360° Sound',
  },
  1208: {
    name: 'Beats Studio Buds True Wireless Noise Cancelling Earbuds - Red',
    description:
      'Active Noise Cancellation (ANC), Transparency mode, IPX4 sweat resistance, and one-touch Apple & Android pairing.',
    offerBadge: '36h Battery',
  },
  1209: {
    name: 'Oppo Reno 8 Pro 5G - 256GB Glazed Green',
    description:
      'MariSilicon X 4K Ultra Night Video NPU, streamlined unibody design, and 80W SuperVOOC flash charge.',
    offerBadge: 'AMOLED Display',
  },

  // Category 3: Luxury & Smart Watches (1301..1307)
  1301: {
    name: 'Amazon Echo Plus (2nd Gen) Smart Hub Speaker - Silver',
    description:
      'Premium 360-degree Dolby audio with built-in Zigbee smart home hub and far-field voice recognition.',
    offerBadge: 'Smart Assistant',
  },
  1302: {
    name: 'Apple Watch Series 9 GPS 45mm - Gold Stainless Steel & Milanese Loop',
    description:
      'Sapphire front crystal, stainless steel case, ECG & blood oxygen apps, sleep stages, and water resistance to 50m.',
    offerBadge: 'Best Seller',
  },
  1303: {
    name: 'Fossil Grant Chronograph Men’s Watch - Two-Tone Steel & Gold',
    description:
      'Classic Roman numeral dial, quartz chronograph movement, 316L stainless steel bracelet, and 5ATM water resistance.',
    offerBadge: 'Luxury Titanium',
  },
  1304: {
    name: 'Daniel Wellington Classic Men’s Watch - Genuine Brown Leather Strap',
    description:
      'Ultra-thin 6mm rose gold case, eggshell white dial, and interchangeable Italian brown leather strap.',
    offerBadge: 'Classic Design',
  },
  1305: {
    name: 'Casio Edifice Chronograph Sport Men’s Watch - Black & Silver',
    description:
      'Tachymeter bezel, 100m water resistance, scratch-resistant mineral glass, and luminous hands.',
    offerBadge: 'Sport Edition',
  },
  1306: {
    name: 'Michael Kors Luxury Women’s Crystal-Set Watch - Rose Gold',
    description:
      'Pavé crystal bezel, mother-of-pearl dial, and polished rose-gold stainless steel link bracelet.',
    offerBadge: '18K Gold Plated',
  },
  1307: {
    name: 'Samsung Galaxy Watch 6 Classic 47mm with Rotating Bezel - Black',
    description:
      'Sapphire crystal display, signature rotating bezel, BIA body composition analysis, and blood pressure monitoring.',
    offerBadge: 'All-in-One Smartwatch',
  },

  // Category 4: Perfumes & Beauty (1401..1408)
  1401: {
    name: "Dior J'adore Eau de Parfum for Women - 100ml",
    description:
      'Luminous floral fragrance with Comoros ylang-ylang, Damask rose, and Grasse jasmine in the iconic amphora bottle.',
    offerBadge: '48h Long-Lasting',
  },
  1402: {
    name: 'Chanel Coco Mademoiselle Eau de Parfum - 100ml',
    description:
      'Sparkling orange, Turkish rose, jasmine, and Indonesian patchouli for an irresistibly modern oriental scent.',
    offerBadge: 'Authentic French',
  },
  1403: {
    name: 'Bleu de Chanel Eau de Parfum for Men - 100ml',
    description:
      'Woody aromatic signature combining New Caledonian sandalwood, amber cedar, and fresh citrus.',
    offerBadge: 'Best Seller',
  },
  1404: {
    name: 'YSL Libre Intense Eau de Parfum for Women - 90ml',
    description:
      'French lavender essence, Moroccan orange blossom, glowing orchid accord, and warm Madagascar vanilla.',
    offerBadge: "Women's Best Seller",
  },
  1405: {
    name: 'Tom Ford Black Orchid Eau de Parfum - 100ml',
    description:
      'Rich dark accords of black truffle, black orchid, plum, patchouli, and warm incense.',
    offerBadge: 'Evening Luxury',
  },
  1406: {
    name: 'Professional 12-Piece Luxury Makeup & Skincare Brush Set',
    description:
      'Ultra-soft antibacterial synthetic bristles with ergonomic rose-gold handles and travel leather pouch.',
    offerBadge: 'Complete Set',
  },
  1407: {
    name: 'Vitamin C 20% + Hyaluronic Acid Radiance & Glow Facial Serum',
    description:
      'Antioxidant brightening formula that targets dark spots, boosts collagen, and delivers instant glass-skin glow.',
    offerBadge: 'Brightening & Glow',
  },
  1408: {
    name: 'Ceramide & Hyaluronic 72-Hour Deep Hydration Barrier Cream',
    description:
      'Dermatologist-tested moisture lock cream with 5 essential ceramides and hyaluronic acid.',
    offerBadge: 'Deep Hydration',
  },

  // Category 5: Sneakers & Casual Shoes (1501..1506)
  1501: {
    name: 'Nike Air Jordan 1 Mid SE Sneakers - Yellow, White & Blue',
    description:
      'Premium leather and suede upper with encapsulated Air-Sole cushioning and padded mid-top collar.',
    offerBadge: 'Fashion Icon',
  },
  1502: {
    name: 'Puma Future Rider Play On Running & Lifestyle Sneakers',
    description:
      'Featherlight nylon, suede, and leather upper with shock-absorbing Federbein outsole and Rider Foam midsole.',
    offerBadge: '2026 Edition',
  },
  1503: {
    name: 'Nike Air Force 1 ’07 Low Classic Sneakers - Triple White',
    description:
      'Crisp stitched leather overlays, perforated toe box, and full-length Nike Air cushioning.',
    offerBadge: 'Best Seller',
  },
  1504: {
    name: 'Adidas Ultraboost Light Running Shoes - Core Black',
    description:
      'Light BOOST cushioning for high energy return, Primeknit+ breathable knit upper, and Continental rubber outsole.',
    offerBadge: 'Medical Comfort',
  },
  1505: {
    name: 'New Balance 327 Retro Running Sneakers - Grey & White',
    description:
      '70s heritage silhouette with oversized N logo, lightweight suede/nylon upper, and studded trail-inspired outsole.',
    offerBadge: 'Lightweight',
  },
  1506: {
    name: 'Handcrafted Italian Genuine Leather Men’s Classic Loafer - Brown',
    description:
      'Full-grain Italian calfskin leather with cushioned leather insole and flexible anti-slip rubber sole.',
    offerBadge: 'Sleek Classic',
  },

  // Category 6: Bags & Sunglasses (1601..1607)
  1601: {
    name: 'Prada Saffiano Luxury Leather Tote & Shoulder Bag - Sky Blue',
    description:
      'Authentic Italian Saffiano crosshatch leather, dual top handles, detachable strap, and signature triangle logo.',
    offerBadge: 'Italian Leather',
  },
  1602: {
    name: 'Gucci Marmont Quilted Leather Crossbody Bag - Pastel Pink',
    description:
      'Matelassé chevron leather with antique gold-toned Double G hardware and sliding chain strap.',
    offerBadge: 'Global Design',
  },
  1603: {
    name: 'Classic Brown Leather Tote & Work Handbag for Women',
    description:
      'Spacious 3-compartment interior that fits a 14" laptop, crafted from durable pebbled leather.',
    offerBadge: '100% Genuine Leather',
  },
  1604: {
    name: ' Luxury Black UV400 Polarized Sunglasses - Gold Accents',
    description:
      '100% UVA/UVB protection, scratch-resistant polarized lenses, and lightweight acetate frame with hard case.',
    offerBadge: 'Best Seller',
  },
  1605: {
    name: 'Sport Aviator Polarized Sunglasses - Matte Black & Green Lens',
    description:
      'Anti-glare HD polarized green lenses with lightweight alloy frame, ideal for driving and outdoor travel.',
    offerBadge: 'Driving & Travel',
  },
  1606: {
    name: 'Retro Clubmaster Browline Sunglasses - Tortoise Brown & Gold',
    description:
      'Timeless vintage browline silhouette with UV400 crystal green lenses and adjustable nose pads.',
    offerBadge: 'Modern Look',
  },
  1607: {
    name: 'Waterproof Anti-Theft 15.6" Laptop Backpack with USB Port',
    description:
      'Shockproof laptop sleeve, hidden back valuables pocket, luggage strap, and external USB charging port.',
    offerBadge: 'Anti-Theft & Waterproof',
  },

  // Category 7: Men's Fashion (1701..1705)
  1701: {
    name: 'Premium 100% Egyptian Cotton Long-Sleeve Casual Shirt - Blue Plaid',
    description:
      'Soft breathable long-staple Egyptian cotton with tailored regular fit and button-down collar.',
    offerBadge: '100% Egyptian Cotton',
  },
  1702: {
    name: 'Heavyweight Oversized Cotton Fleece Hoodie - Navy Blue',
    description:
      '400 GSM combed cotton fleece with soft brushed interior, double-lined hood, and front kangaroo pocket.',
    offerBadge: 'Winter Best Seller',
  },
  1703: {
    name: 'Classic Piqué Cotton Polo Shirt - Royal White',
    description:
      'Breathable honeycomb piqué knit with ribbed collar and cuffs that hold their shape wash after wash.',
    offerBadge: 'Turkish Fabric',
  },
  1704: {
    name: 'Slim-Fit Stretch Gabardine Chino Pants - Beige',
    description:
      '98% cotton + 2% elastane stretch twill for all-day comfort and color fastness.',
  },
  1705: {
    name: 'Water-Resistant Quilted Men’s Winter Puffer Jacket - Black',
    description:
      'Windproof outer shell with warm thermal fill, detachable hood, and zippered security pockets.',
    offerBadge: 'Italian Design',
  },

  // Category 8: Women's Fashion (1801..1806)
  1801: {
    name: 'Elegant Modest Evening Maxi Dress - Royal Burgundy & White',
    description:
      'Flowing premium crepe fabric with flattering tailored waist cut, ideal for evenings and special occasions.',
    offerBadge: 'Evening & Events',
  },
  1802: {
    name: 'Embroidered Japanese Crepe Open Abaya with Matching Sheila - Black',
    description:
      'Luxurious matte Japanese crepe with delicate handcrafted sleeve embroidery and matching chiffon headscarf.',
    offerBadge: 'Hand Embroidery',
  },
  1803: {
    name: 'Floral Belted Summer Midi Dress - Soft Pastel Print',
    description:
      'Lightweight breathable viscose-cotton blend with cinched waist belt and side pockets.',
    offerBadge: 'Summer 2026',
  },
  1804: {
    name: 'Satin Wrap Blouse with Pearl Cuff Buttons - Champagne Gold',
    description:
      'Silky smooth satin finish with elegant drape neckline and pearl button cuffs for formal or smart-casual styling.',
    offerBadge: 'Soft Silk',
  },
  1805: {
    name: 'Tailored 2-Piece Women’s Formal Blazer & Wide-Leg Pants Suit - Beige',
    description:
      'Double-breasted blazer paired with high-waisted wide-leg trousers in wrinkle-resistant suiting fabric.',
    offerBadge: 'Formal Look',
  },
  1806: {
    name: 'Cashmere-Blend Long Winter Trench Coat with Belt - Camel',
    description:
      'Warm wool-cashmere blend coat with classic lapel collar, waist tie belt, and full satin lining.',
    offerBadge: 'Warm Winter',
  },
};

/**
 * Translate variant names dynamically (e.g. "مقاس 41" -> "Size 41")
 */
export function translateVariantNameToEn(nameAr: string): string {
  if (!nameAr) return '';
  const exactMap: Record<string, string> = {
    'سعة 256GB - تيتانيوم طبيعي': '256GB - Natural Titanium',
    'سعة 512GB - تيتانيوم أسود': '512GB - Black Titanium',
    'سعة 1TB - تيتانيوم أزرق': '1TB - Blue Titanium',
    'رام 16GB - هارد 512GB SSD': '16GB RAM - 512GB SSD',
    'رام 16GB - هارد 1TB SSD': '16GB RAM - 1TB SSD',
    'رام 24GB - هارد 1TB SSD': '24GB RAM - 1TB SSD',
    'رام 32GB - هارد 2TB SSD': '32GB RAM - 2TB SSD',
    'حجم 50 مل (Eau de Parfum)': '50ml (Eau de Parfum)',
    'حجم 100 مل (الحجم الأصلي)': '100ml (Full Size)',
    'حجم 200 مل (توفير عائلي)': '200ml (Value Size)',
    'مقاس M': 'Size M',
    'مقاس L': 'Size L',
    'مقاس XL': 'Size XL',
    'مقاس XXL': 'Size XXL',
  };
  if (exactMap[nameAr]) return exactMap[nameAr];
  return nameAr
    .replace(/^مقاس\s+/i, 'Size ')
    .replace(/رام/g, 'RAM')
    .replace(/هارد/g, 'Storage')
    .replace(/سعة/g, 'Capacity');
}

/**
 * Translate dynamic discount / stock badge strings
 */
export function translateBadgeToEn(text: string): string {
  if (!text) return '';
  const trimmed = text.trim();
  if (OFFER_BADGE_EN_BY_AR[trimmed]) return OFFER_BADGE_EN_BY_AR[trimmed];
  const discountMatch = trimmed.match(/خصم\s*(\d+)%/);
  if (discountMatch) return `${discountMatch[1]}% OFF`;
  const leftMatch = trimmed.match(/متبقي\s*(\d+)\s*فقط/);
  if (leftMatch) return `Only ${leftMatch[1]} left`;
  const countMatch = trimmed.match(/^(\d+)\s*منتج/);
  if (countMatch) return `${countMatch[1]} Products`;
  return trimmed;
}

/**
 * Smart fallback translator for custom merchant-entered Arabic product names
 * when no explicit English name (`nameEn`) or catalog ID match exists.
 */
const SMART_AR_PRODUCT_TERMS: Array<[RegExp, string]> = [
  [/لابتوب/g, 'Laptop'],
  [/هاتف ذكي/g, 'Smartphone'],
  [/موبايل/g, 'Smartphone'],
  [/سماعة رأس لاسلكية/g, 'Wireless Headphones'],
  [/سماعة لاسلكية/g, 'Wireless Earbuds'],
  [/مكبر صوت ذكي/g, 'Smart Speaker'],
  [/ساعة ذكية/g, 'Smartwatch'],
  [/ساعة كلاسيك رجالي/g, "Men's Classic Watch"],
  [/ساعة رجالي/g, "Men's Watch"],
  [/ساعة نسائية فاخرة/g, "Luxury Women's Watch"],
  [/ساعة نسائية/g, "Women's Watch"],
  [/عطر/g, 'Perfume'],
  [/نسائي/g, 'for Women'],
  [/رجالي/g, 'for Men'],
  [/حذاء رياضي/g, 'Sneakers'],
  [/حذاء كاجوال/g, 'Casual Shoes'],
  [/حذاء كلاسيك/g, 'Classic Loafers'],
  [/حقيبة يد نسائية فاخرة/g, "Luxury Women's Handbag"],
  [/حقيبة كروس/g, 'Crossbody Bag'],
  [/حقيبة ظهر/g, 'Backpack'],
  [/حقيبة/g, 'Bag'],
  [/نظارة شمسية رياضية/g, 'Sport Sunglasses'],
  [/نظارة شمسية/g, 'Sunglasses'],
  [/قميص كاجوال/g, 'Casual Shirt'],
  [/قميص/g, 'Shirt'],
  [/هودي شتوي/g, 'Winter Hoodie'],
  [/تيشيرت بولو/g, 'Polo Shirt'],
  [/بنطلون تشينو/g, 'Chino Pants'],
  [/جاكيت شتوي/g, 'Winter Jacket'],
  [/فستان سهرة/g, 'Evening Dress'],
  [/فستان صيفي/g, 'Summer Dress'],
  [/فستان/g, 'Dress'],
  [/عباية خليجي/g, 'Abaya'],
  [/بلوزة ستان/g, 'Satin Blouse'],
  [/طقم بليزر وبنطلون/g, 'Blazer & Pants Suit'],
  [/بالطو شتوي/g, 'Winter Coat'],
  [/سيروم/g, 'Serum'],
  [/كريم مرطب/g, 'Moisturizing Cream'],
  [/مجموعة فرش مكياج/g, 'Makeup Brush Set'],
  [/رمادي فلكي/g, 'Space Gray'],
  [/أزرق سييرا/g, 'Sierra Blue'],
  [/أزرق سماوي/g, 'Sky Blue'],
  [/أبيض لؤلؤي/g, 'Pearl White'],
  [/أسود فانتوم/g, 'Phantom Black'],
  [/أسود مطفي/g, 'Matte Black'],
  [/أسود/g, 'Black'],
  [/أبيض/g, 'White'],
  [/أحمر/g, 'Red'],
  [/أخضر/g, 'Green'],
  [/أصفر/g, 'Yellow'],
  [/بني/g, 'Brown'],
  [/بيج/g, 'Beige'],
  [/كحلي/g, 'Navy'],
  [/ذهبي/g, 'Gold'],
  [/فضي/g, 'Silver'],
  [/مل/g, 'ml'],
  [/بوصة/g, '"'],
];

const AUTO_EN_CACHE_STORAGE_KEY = 'zs_auto_en_cache_v1';
const autoEnMemoryCache = new Map<string, string>();
const pendingAutoRequests = new Set<string>();
const autoTranslateListeners = new Set<() => void>();
let autoCacheLoaded = false;
let batchQueue: string[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;

function ensureAutoCacheLoaded() {
  if (autoCacheLoaded || typeof window === 'undefined') return;
  autoCacheLoaded = true;
  try {
    const raw = window.localStorage.getItem(AUTO_EN_CACHE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, string>;
      for (const [k, v] of Object.entries(parsed)) {
        if (k && typeof v === 'string' && v.trim()) {
          autoEnMemoryCache.set(k, v);
        }
      }
    }
  } catch {
    // Ignore storage read errors
  }
}

function persistAutoCache() {
  if (typeof window === 'undefined') return;
  try {
    const obj: Record<string, string> = {};
    for (const [k, v] of autoEnMemoryCache.entries()) {
      obj[k] = v;
    }
    window.localStorage.setItem(AUTO_EN_CACHE_STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // Ignore storage quota errors
  }
}

function notifyAutoTranslateListeners() {
  for (const listener of autoTranslateListeners) {
    try {
      listener();
    } catch {
      // Ignore listener errors
    }
  }
}

export function subscribeAutoTranslation(listener: () => void): () => void {
  autoTranslateListeners.add(listener);
  return () => {
    autoTranslateListeners.delete(listener);
  };
}

async function fetchSingleTranslationArToEn(text: string): Promise<string | null> {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ar&tl=en&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && Array.isArray(data[0])) {
      const translated = data[0]
        .map((seg: unknown) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
        .join('')
        .trim();
      return translated || null;
    }
    return null;
  } catch {
    return null;
  }
}

function flushAutoTranslateQueue() {
  batchTimer = null;
  if (batchQueue.length === 0) return;
  const items = [...batchQueue];
  batchQueue = [];

  void Promise.all(
    items.map(async (text) => {
      const translated = await fetchSingleTranslationArToEn(text);
      pendingAutoRequests.delete(text);
      if (translated && translated !== text) {
        autoEnMemoryCache.set(text, translated);
        return true;
      }
      return false;
    })
  ).then((results) => {
    if (results.some(Boolean)) {
      persistAutoCache();
      notifyAutoTranslateListeners();
    }
  });
}

export function translateMerchantTextToEn(rawText: string | undefined | null, fallbackFn?: (t: string) => string): string {
  if (!rawText) return '';
  const trimmed = rawText.trim();
  if (!trimmed) return '';
  // If already English (no Arabic characters), return as-is
  if (!/[\u0600-\u06FF]/.test(trimmed)) return trimmed;

  ensureAutoCacheLoaded();
  const cached = autoEnMemoryCache.get(trimmed);
  if (cached) return cached;

  // Queue background live translation for any merchant-entered Arabic string
  if (typeof window !== 'undefined' && !pendingAutoRequests.has(trimmed)) {
    pendingAutoRequests.add(trimmed);
    batchQueue.push(trimmed);
    if (!batchTimer) {
      batchTimer = setTimeout(flushAutoTranslateQueue, 35);
    }
  }

  return fallbackFn ? fallbackFn(trimmed) : trimmed;
}

export function smartTranslateProductNameToEn(name: string): string {
  if (!name) return '';
  if (!/[\u0600-\u06FF]/.test(name)) return name;
  let result = name;
  for (const [pattern, replacement] of SMART_AR_PRODUCT_TERMS) {
    result = result.replace(pattern, replacement);
  }
  return result.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Localize a StorefrontCategory into the active language
 */
export function localizeCategory(
  cat: StorefrontCategory,
  lang: StorefrontLang
): StorefrontCategory {
  if (lang !== 'en') return cat;
  const customEn = (cat as unknown as Record<string, unknown>).nameEn || (cat as unknown as Record<string, unknown>).name_en;
  if (typeof customEn === 'string' && customEn.trim()) {
    return { ...cat, name: customEn.trim() };
  }
  const trimmedName = cat.name?.trim() || '';
  const staticEn =
    CATEGORY_EN_BY_AR[trimmedName] ||
    (cat.id in CATEGORY_EN_BY_ID && trimmedName === '' ? CATEGORY_EN_BY_ID[cat.id] : undefined);

  const enName = staticEn || translateMerchantTextToEn(trimmedName, smartTranslateProductNameToEn);
  return {
    ...cat,
    name: enName,
  };
}

/**
 * Localize a StorefrontProduct into the active language
 */
export function localizeProduct(
  product: StorefrontProduct,
  lang: StorefrontLang
): StorefrontProduct {
  if (lang !== 'en') return product;

  const rawRec = product as unknown as Record<string, unknown>;
  const merchantNameEn =
    (typeof rawRec.nameEn === 'string' && rawRec.nameEn.trim()) ||
    (typeof rawRec.name_en === 'string' && rawRec.name_en.trim()) ||
    '';
  const merchantDescEn =
    (typeof rawRec.descriptionEn === 'string' && rawRec.descriptionEn.trim()) ||
    (typeof rawRec.description_en === 'string' && rawRec.description_en.trim()) ||
    '';

  const enEntry = PRODUCT_EN_BY_ID[product.id];
  const rawCatTrimmed = product.categoryName?.trim() || '';
  const enCat =
    (rawCatTrimmed && CATEGORY_EN_BY_AR[rawCatTrimmed]) ||
    (rawCatTrimmed ? translateMerchantTextToEn(rawCatTrimmed, smartTranslateProductNameToEn) : '') ||
    (product.categoryId && CATEGORY_EN_BY_ID[product.categoryId]) ||
    product.categoryName;

  const enBadge =
    enEntry?.offerBadge ||
    (product.offerBadge
      ? translateMerchantTextToEn(translateBadgeToEn(product.offerBadge), smartTranslateProductNameToEn)
      : product.offerBadge);

  const localizedVariants = product.variants?.map((v) => ({
    ...v,
    name: translateMerchantTextToEn(translateVariantNameToEn(v.name), smartTranslateProductNameToEn),
  }));

  const resolvedName =
    merchantNameEn ||
    enEntry?.name ||
    translateMerchantTextToEn(product.name, smartTranslateProductNameToEn);

  const resolvedDesc =
    merchantDescEn ||
    enEntry?.description ||
    (product.description ? translateMerchantTextToEn(product.description) : product.description);

  return {
    ...product,
    name: resolvedName,
    description: resolvedDesc,
    categoryName: enCat,
    offerBadge: enBadge,
    variants: localizedVariants,
  };
}

/**
 * Localize StorefrontInfo into the active language
 */
export function localizeStorefrontInfo(
  info: StorefrontInfo,
  lang: StorefrontLang
): StorefrontInfo {
  if (lang !== 'en') return info;

  const zoneNameEnMap: Record<string, string> = {
    'القاهرة والجيزة': 'Cairo & Giza',
    'الإسكندرية والدلتا': 'Alexandria & Delta',
    'مدن القناة والصعيد': 'Canal Cities & Upper Egypt',
    'وجه بحري والدلتا': 'Delta & Lower Egypt',
    'مدن القناة والوجه القبلي': 'Canal Cities & Upper Egypt',
  };

  const zoneTimeEnMap: Record<string, string> = {
    'خلال 24 ساعة': 'Within 24 hours',
    'خلال 48 ساعة': 'Within 48 hours',
    '2 إلى 3 أيام عمل': '2 to 3 business days',
    '2 - 3 أيام عمل': '2 - 3 business days',
  };

  const bioTrimmed = (info.bio || '').trim();
  const isDefaultArBio =
    bioTrimmed.includes('تشكيلة متنوعة من المنتجات') ||
    bioTrimmed.includes('وجهتك الأولى للتسوق') ||
    bioTrimmed.includes('وجهتك المفضلة');

  const announcementTrimmed = (info.announcement || '').trim();
  const isDefaultArAnnouncement =
    announcementTrimmed.includes('توصيل سريع لجميع المناطق') ||
    announcementTrimmed.includes('عروض الموسم الكبرى');

  const addressTrimmed = (info.address || '').trim();
  const isDefaultArAddress =
    addressTrimmed.includes('التجمع الخامس') ||
    addressTrimmed.includes('شارع التسعين');

  return {
    ...info,
    title:
      info.title === 'متجر الأناقة والتقنية الحديث'
        ? 'Modern Style & Tech Store'
        : translateMerchantTextToEn(info.title),
    bio: isDefaultArBio
      ? 'A curated collection of authentic products — order online effortlessly and receive your doorstep delivery in record time.'
      : translateMerchantTextToEn(info.bio),
    announcement: isDefaultArAnnouncement
      ? 'Fast nationwide delivery • Free shipping on orders over 300 EGP'
      : translateMerchantTextToEn(info.announcement),
    address: isDefaultArAddress
      ? 'Fifth Settlement - North 90th St., Cairo'
      : translateMerchantTextToEn(info.address),
    heroHeadline:
      info.heroHeadline === 'تسوق أحدث الإصدارات العالمية بأفضل الأسعار في مصر'
        ? 'Shop the Latest Global Releases at the Best Prices'
        : translateMerchantTextToEn(info.heroHeadline),
    deliveryZones: info.deliveryZones?.map((z) => ({
      ...z,
      name: zoneNameEnMap[z.name] || translateMerchantTextToEn(z.name),
      estimatedTime: z.estimatedTime
        ? zoneTimeEnMap[z.estimatedTime] || translateMerchantTextToEn(z.estimatedTime)
        : z.estimatedTime,
    })),
  };
}

/**
 * Universal Arabic-to-English phrase dictionary used by i18n fallback & components
 */
export const AR_TO_EN_PHRASES: Record<string, string> = {
  // Header & Nav
  'الرئيسية': 'Home',
  'كل المنتجات': 'All Products',
  'كل الأقسام': 'All Categories',
  'الأقسام': 'Categories',
  'العروض': 'Deals',
  'عروض اليوم': "Today's Deals",
  'عروض فلاش': 'Flash Deals',
  'الأكثر مبيعاً': 'Best Sellers',
  'وصل حديثاً': 'New Arrivals',
  'طلباتي': 'My Orders',
  'تتبع طلباتي': 'Track My Orders',
  'سلة المشتريات': 'Shopping Cart',
  'سلة التسوق': 'Shopping Cart',
  'السلة': 'Cart',
  'حسابي': 'My Account',
  'متجر إلكتروني': 'Online Store',
  'تصفح الأقسام': 'Browse Categories',
  'ابحث عن منتج، قسم، أو علامة تجارية...': 'Search products, categories, or brands...',
  'ابحث عن منتج أو قسم...': 'Search for a product or category...',
  'مسح البحث': 'Clear search',
  'بحث': 'Search',

  // Hero & Showcase & Vibrant Sections
  'تشكيلة الموسم الحصرية': 'Exclusive Season Collection',
  'تسوق أرقى الماركات العالمية': 'Shop Top Global Brands',
  'بأفضل سعر في مصر': 'At the Best Prices',
  'اكتشف تشكيلة مختارة من أحدث الهواتف الذكية، اللابتوب، الساعات الفاخرة، العطور، والأزياء العصرية بضمان أصلي 100% وتوصيل سريع.':
    'Discover a curated selection of flagship smartphones, laptops, luxury watches, signature perfumes, and modern fashion with 100% authentic warranty and express delivery.',
  'تسوق العروض الآن': 'Shop Deals Now',
  'تصفح جميع المنتجات': 'Browse All Products',
  'منتج أصلي 100%': '100% Authentic',
  'شحن سريع لباب البيت': 'Fast Doorstep Delivery',
  'دفع آمن عند الاستلام': 'Cash on Delivery',
  'استرجاع مجاني خلال 14 يوم': '14-Day Free Returns',
  'تشكيلة المتجر المختارة': "Store's Curated Collection",
  'أقوى العروض والمنتجات المميزة': 'Top Deals & Featured Products',
  'استكشف العروض الآن': 'Explore Deals Now',
  'الأكثر طلباً ومبيعاً': 'Most Popular & Best Selling',
  'تشكيلة مختارة بأعلى جودة': 'Handpicked top-quality collection',
  'تخفيضات وباقات التوفير': 'Discounts & Value Bundles',
  'تسوق أفضل الأسعار اليوم': "Shop today's best prices",
  'منتجات أصلية ومعتمدة': 'Certified Authentic Products',
  'نختار لك الأفضل دائماً': 'Always curating the best for you',
  'اكتشف التشكيلة الجديدة': 'Discover the New Collection',
  'أحدث الإصدارات في مكان واحد': 'The latest releases in one place',
  'مختارات مميزة': 'Featured Picks',
  'أفضل العروض': 'Best Deals',
  'عرض خاص لك': 'Special Offer for You',
  'ترشيحاتنا لك': 'Recommended for You',
  'تسوق حسب القسم': 'Shop by Category',
  'عرض كل الأقسام': 'View All Categories',
  'عرض الكل': 'View All',
  'تصفح القسم': 'Browse Category',

  // Flash Sale & Shelves
  'عروض فلاش الحصرية': 'Exclusive Flash Sale',
  'ينتهي العرض خلال': 'Offer Ends In',
  'ساعة': 'Hrs',
  'دقيقة': 'Min',
  'ثانية': 'Sec',
  'خصومات فورية لفترة محدودة جداً': 'Instant markdowns for a strictly limited time',
  'أقوى عروض اليوم': "Today's Top Deals",
  'وفر أكثر مع خصوماتنا الحصرية اليومية': 'Save more with our exclusive daily markdowns',
  'المنتجات الأكثر مبيعاً': 'Best Selling Products',
  'اختيارات عملائنا المفضلة والأعلى تقييماً': 'Our customers’ favorite and highest-rated picks',
  'أحدث الإضافات والتشكيلات العصرية': 'Latest arrivals and modern collections',

  // Product Card & Quick View & Spotlight
  'أضف للسلة': 'Add to Cart',
  'أضف إلى السلة': 'Add to Cart',
  'أضف للسلة الآن': 'Add to Cart Now',
  'تمت الإضافة': 'Added',
  'تمت الإضافة للسلة': 'Added to Cart',
  'بالسلة': 'in cart',
  'نفدت الكمية': 'Out of Stock',
  'غير متوفر': 'Unavailable',
  'متوفر في المخزون': 'In Stock',
  'السعر عند التواصل': 'Price on Inquiry',
  'استفسر عن السعر': 'Inquire Price',
  'طلب عبر واتساب': 'Order via WhatsApp',
  'المواصفات': 'Specifications',
  'عرض سريع': 'Quick View',
  'إضافة للمفضلة': 'Add to Favorites',
  'إزالة من المفضلة': 'Remove from Favorites',
  'زيادة الكمية': 'Increase quantity',
  'إنقاص الكمية': 'Decrease quantity',
  'تقليل الكمية': 'Decrease quantity',
  'حذف من السلة': 'Remove from cart',
  'خصم': 'OFF',
  'وفرت': 'You save',
  'شامل الضريبة': 'VAT Included',
  'اختر المقاس أو الإصدار:': 'Select Size or Variant:',
  'اختر الخيار المناسب': 'Select Option',
  'وصف المنتج': 'Product Description',
  'منتجات مشابهة قد تعجبك': 'Similar Products You May Like',

  // Filtered Grid & Sorting
  'ترتيب حسب:': 'Sort by:',
  'الأكثر تطابقاً': 'Most Relevant',
  'الأقل سعراً': 'Price: Low to High',
  'الأعلى سعراً': 'Price: High to Low',
  'الأعلى خصماً': 'Highest Discount',
  'المفضلة فقط': 'Favorites Only',
  'العروض فقط': 'Deals Only',
  'إعادة ضبط الفلاتر': 'Reset Filters',
  'لا توجد منتجات مطابقة لبحثك': 'No products match your search',
  'جرب البحث بكلمات أخرى أو تصفح كافة الأقسام': 'Try different keywords or browse all categories',
  'عرض كافة المنتجات': 'Show All Products',

  // Cart & Checkout & Orders
  'سلة التسوق فارغة': 'Your shopping cart is empty',
  'تصفح المنتجات وأضف ما ترغب لطلبك الآن': 'Browse products and add your favorite items to your order now',
  'تصفح المنتجات': 'Browse Products',
  'تفريغ السلة': 'Clear Cart',
  'تفريغ السلة بالكامل': 'Clear entire cart',
  'تفريغ السلة بالكامل؟': 'Clear entire cart?',
  'تأكيد': 'Confirm',
  'إلغاء': 'Cancel',
  'قيمة الأصناف': 'Subtotal',
  'المجموع الفرعي': 'Subtotal',
  'مجموع الأصناف:': 'Items Subtotal:',
  'مصاريف التوصيل': 'Delivery Fee',
  'الشحن': 'Shipping',
  'مجاني': 'Free',
  'مجاناً': 'Free',
  'توصيل مجاني': 'Free Delivery',
  'الخصم': 'Discount',
  'المبلغ الإجمالي': 'Total Amount',
  'الإجمالي': 'Total',
  'الإجمالي:': 'Total:',
  'المبلغ الإجمالي للدفع:': 'Total Payable:',
  'إتمام الطلب': 'Proceed to Checkout',
  'إتمام الشراء': 'Checkout',
  'متابعة التسوق': 'Continue Shopping',
  'متابعة التسوق في المتجر': 'Continue Shopping',
  'تعديل': 'Edit',
  'إعادة الطلب': 'Reorder',
  'تاريخ الطلب': 'Order Date',
  'شركة الشحن': 'Shipping Method',
  'توصيل سريع': 'Express Delivery',
  'العنوان': 'Address',
  'استلام من الفرع': 'Branch Pickup',
  'طريقة الدفع': 'Payment Method',
  'الدفع عند الاستلام': 'Cash on Delivery',
  'عند الاستلام': 'Cash on Delivery',
  'بطاقة بنكية': 'Credit / Debit Card',
  'إنستاباي / محفظة': 'InstaPay / Mobile Wallet',
  'مدفوع': 'Paid',
  'تم الطلب': 'Order Placed',
  'تم التجهيز': 'Processing',
  'في الطريق': 'Out for Delivery',
  'تم التسليم': 'Delivered',
  'قيد الانتظار...': 'Pending...',

  // Trust Bar & Footer
  'توصيل سريع ومؤمن': 'Fast & Insured Delivery',
  'لجميع المحافظات لباب المنزل': 'To all governorates right to your doorstep',
  'منتجات أصلية 100%': '100% Authentic Products',
  'ضمان رسمي معتمد على كافة المنتجات': 'Official certified warranty on all items',
  'دفع آمن وميسر': 'Safe & Flexible Payment',
  'الدفع عند الاستلام أو بالبطاقات والمحافظ': 'Cash on delivery, cards, or digital wallets',
  'استبدال واسترجاع مجاني': 'Free Exchange & Returns',
  'خلال 14 يوماً طبقاً لسياسة المتجر': 'Within 14 days per store policy',
  'روابط سريعة': 'Quick Links',
  'أقسام المتجر': 'Store Categories',
  'خدمة العملاء والتواصل': 'Customer Service & Contact',
  'تواصل معنا عبر واتساب': 'Chat with us on WhatsApp',
  'جميع الحقوق محفوظة': 'All rights reserved',
};

export function translateKnownPhrase(text: string | null | undefined, lang: StorefrontLang): string {
  if (!text) return '';
  if (lang !== 'en') return text;
  const trimmed = text.trim();
  return (
    AR_TO_EN_PHRASES[trimmed] ||
    CATEGORY_EN_BY_AR[trimmed] ||
    SHORT_CATEGORY_EN_BY_AR[trimmed] ||
    OFFER_BADGE_EN_BY_AR[trimmed] ||
    text
  );
}

export function translateProductName(name: string | null | undefined, lang: StorefrontLang): string {
  if (!name) return '';
  if (lang !== 'en') return name;
  const known = translateKnownPhrase(name, lang);
  if (known !== name) return known;
  return smartTranslateProductNameToEn(name);
}

export function translateCategoryName(cat: string | null | undefined, lang: StorefrontLang): string {
  if (!cat) return '';
  if (lang !== 'en') return cat;
  const trimmed = cat.trim();
  return CATEGORY_EN_BY_AR[trimmed] || SHORT_CATEGORY_EN_BY_AR[trimmed] || translateKnownPhrase(trimmed, lang);
}

export function translateOfferBadge(badge: string | null | undefined, lang: StorefrontLang): string {
  if (!badge) return '';
  if (lang !== 'en') return badge;
  return translateBadgeToEn(badge.trim());
}

export function translateProductDesc(desc: string | null | undefined, lang: StorefrontLang): string {
  if (!desc) return '';
  if (lang !== 'en') return desc;
  return translateKnownPhrase(desc, lang);
}


