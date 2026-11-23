import { IPHONE_PHOTO } from '../product-photos-registry';
import type { SemanticPhotoRule } from './storefront-photo-matcher-shared';

export const SEMANTIC_PHOTO_RULES: SemanticPhotoRule[] = [
  // -------------------------------------------------------------
  // 1. CLEANING & PERSONAL CARE (SPECIFIC SUB-TYPES)
  // -------------------------------------------------------------
  {
    id: 'dishwashing_liquid',
    nameAr: 'سائل غسيل الأطباق والصحون وفيري',
    keywords: [
      'فيري', 'بريل', 'سائل اطباق', 'غسيل اطباق', 'مواعين', 'سائل صحون',
      'اطباق فيري', 'اقراص غساله', 'اقراص غسالة', 'غسالة اطباق', 'غساله اطباق'
    ],
    imageUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4c/Tesco_and_Sainsburys_own_dishwashing_liquid.jpg/500px-Tesco_and_Sainsburys_own_dishwashing_liquid.jpg',
    weight: 98,
  },
  {
    id: 'toothpaste',
    nameAr: 'معجون وفراشي الأسنان',
    keywords: ['معجون', 'اسنان', 'سيجنال', 'كولجيت', 'سنسوداين', 'فرشاه اسنان', 'مكافح التسوس'],
    imageUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/ce/Toothbrush_with_Toothpaste_%2811693757123%29.jpg/500px-Toothbrush_with_Toothpaste_%2811693757123%29.jpg',
    weight: 98,
  },
  {
    id: 'laundry_detergent',
    nameAr: 'مساحيق غسيل الملابس',
    keywords: [
      'اوكسي', 'اريال', 'برسيل', 'تايد', 'بونكس', 'مسحوق غسيل', 'غسيل اتوماتيك',
      'غسيل اوتوماتيك', 'غسيل يدوي', 'مسحوق ملابس', 'معطر ملابس', 'داوني'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1585421514284-efb74c2b69ba?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 95,
  },
  {
    id: 'perfume_luxury',
    nameAr: 'عطور راقية وبخور وعود ومسك',
    keywords: [
      'عطور', 'عطر', 'perfume', 'perfumes', 'parfum', 'fragrance', 'او دي بارفان', 'عود', 'مسك', 'بخور', 'دخون'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?auto=format&fit=crop&w=400&q=70&fm=webp',
    weight: 96,
  },
  {
    id: 'body_spray',
    nameAr: 'معطرات الجسم وسبراي وبخاخ',
    keywords: [
      'all over spray', 'body spray', 'معطر جسم', 'معطرات جسم', 'بخاخ جسم', 'سبراي', 'بودي سبراي', 'mist'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1594035910387-fea47794261f?auto=format&fit=crop&w=400&q=70&fm=webp',
    weight: 96,
  },
  {
    id: 'home_spray',
    nameAr: 'معطرات المنزل والجو والمفارش',
    keywords: [
      'home spray', 'معطر جو', 'معطر منزل', 'معطرات جو', 'بخاخ جو', 'معطر غرف', 'معطر مفارش'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1616949755610-8c9bbc08f138?auto=format&fit=crop&w=400&q=70&fm=webp',
    weight: 96,
  },
  {
    id: 'bleach_disinfectant',
    nameAr: 'كلور ومطهرات ومنظفات أرضيات',
    keywords: [
      'كلور', 'كلوركس', 'مبيض', 'فلاش', 'منظف ارضيات', 'مطهر ارضيات',
      'ديتول سائل', 'مطهر', 'معقم اسطح', 'جل ارضيات'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1584813470613-5b1c1cad3d69?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 95,
  },
  {
    id: 'bar_soap',
    nameAr: 'صابون يد واستحمام وشاور',
    keywords: [
      'صابون ديتول', 'صابون لوكس', 'صابون دوف', 'صابون كاماي', 'صابون وجه',
      'صابون تواليت', 'شاور جيل', 'غسول يد', 'صابون استحمام', 'صابون', 'صابونه'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1600857544200-b2f666a9a2ec?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 75,
  },
  {
    id: 'tissues_paper',
    nameAr: 'مناديل ورقية وبكر مطبخ وتواليت',
    keywords: [
      'مناديل', 'منديل', 'فاين', 'زينة', 'زينه', 'بكر تواليت', 'ماكسي رول',
      'مناديل مطبخ', 'مناديل سحب', 'وايبس', 'مناديل مبللة', 'بابيا'
    ],
    imageUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/8/86/Roll_of_paper_towels_standing_on_toilet-paper_holder.jpg/500px-Roll_of_paper_towels_standing_on_toilet-paper_holder.jpg',
    weight: 95,
  },

  // -------------------------------------------------------------
  // 2. MEAT, POULTRY & FROZEN FOODS
  // -------------------------------------------------------------
  {
    id: 'burger',
    nameAr: 'برجر لحم وفراخ مشوي',
    keywords: ['برجر', 'همبرجر', 'برجر بقري', 'برجر فراخ', 'بيف برجر', 'سندوتش برجر', 'ساندوتش برجر'],
    imageUrl: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 98,
  },
  {
    id: 'crispy_chicken_strips',
    nameAr: 'ستربس ودجاج مقرمش وبانيه',
    keywords: [
      'ستربس', 'بانية', 'بانيه', 'ناجتس', 'دجاج مقرمش', 'كوكي مقرمش',
      'تشيكن ستربس', 'اصابع دجاج', 'فراخ بانيه', 'كرانشي تشيكن',
      'صاروخ استربس', 'صاروخ بانيه', 'سندوتش استربس', 'سندوتش بانيه', 'ساندوتش استربس'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 98,
  },
  {
    id: 'french_fries_potatoes',
    nameAr: 'بطاطس مقلية وفرايز وصاروخ بطاطس',
    keywords: ['بطاطس', 'فرايز', 'صاروخ بطاطس', 'بطاطس مقلية', 'بطاطس محمرة', 'سندوتش بطاطس', 'ساندوتش بطاطس', 'باكت بطاطس'],
    imageUrl: 'https://images.unsplash.com/photo-1576107232684-1279f3908594?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 98,
  },
  {
    id: 'crepe_shawarma_sandwiches',
    nameAr: 'شاورما وكريب وسندوتشات سريعة',
    keywords: ['كريب', 'شاورما', 'صاروخ شاورما', 'سندوتش شاورما', 'ساندوتش شاورما', 'حواوشي', 'ساندوتش', 'سندوتش'],
    imageUrl: 'https://images.unsplash.com/photo-1529193591184-b1d58069ecdd?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 95,
  },
  {
    id: 'pizza_pies',
    nameAr: 'بيتزا وفطائر ومعجنات ساخنة',
    keywords: ['بيتزا', 'فطير', 'بيتزا سجق', 'بيتزا جبن', 'بيتزا لحم', 'بيتزا فراخ'],
    imageUrl: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 98,
  },
  {
    id: 'fresh_poultry_meat',
    nameAr: 'دواجن ولحوم طازجة',
    keywords: [
      'دجاج', 'فراخ', 'دواجن', 'فروج', 'بفروج', 'لحوم', 'لحمة', 'لحم مفروم',
      'كفتة', 'سجق', 'شاورما', 'ريش', 'كندوز', 'بتلو'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1587593810167-a84920ea0781?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 75,
  },
  {
    id: 'canned_tuna_fish',
    nameAr: 'تونة وأسماك معلبة وبحرية',
    keywords: [
      'تونة', 'تونه', 'صن شاين', 'دولفين', 'سردين', 'ماكريل', 'سلمون',
      'سمك', 'رنجة', 'رنجه', 'فسيخ', 'جمبري', 'سي فود'
    ],
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/2/21/Tuna_assortment.png',
    weight: 98,
  },
  {
    id: 'frozen_vegetables',
    nameAr: 'بامية وقرون بامية خضراء طازجة',
    keywords: [
      'بامية', 'باميا', 'بامية ممتازة', 'ملوخية', 'ملوخيه', 'ملوخية خضراء',
      'بسمة', 'بسلة', 'خضار مشكل', 'سبانخ', 'قلقاس', 'خرشوف'
    ],
    imageUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/af/Okra_or_lady_finger.jpg/500px-Okra_or_lady_finger.jpg',
    weight: 95,
  },

  // -------------------------------------------------------------
  // 3. SNACKS, SWEETS & BAKERY
  // -------------------------------------------------------------
  {
    id: 'biscuits_cookies_oreo',
    nameAr: 'بسكويت وكوكيز وأوريو وويفر',
    keywords: [
      'اوريو', 'بسكويت', 'بسكوت', 'كوكيز', 'ويفر', 'لوتس', 'كراكرز',
      'توداي', 'اولكر', 'بوريو', 'بيمبو', 'ماري', 'نواعم'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 96,
  },
  {
    id: 'pastries_croissant',
    nameAr: 'كرواسون ومخبوزات وباتيه ومولتو',
    keywords: ['مولتو', 'كرواسون', 'باتيه', 'دونتس', 'كيك', 'كب كيك', 'سينامون', 'تودو'],
    imageUrl: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 96,
  },
  {
    id: 'chocolate_nutella',
    nameAr: 'شوكولاتة ونوتيلا وقوالب كاكاو',
    keywords: [
      'نوتيلا', 'كادبوري', 'جلاكسي', 'شوكولاتة', 'شوكولاته', 'شيكولاتة',
      'شيكولاته', 'ديري ميلك', 'كيت كات', 'مارس', 'سنيكرز', 'تويكس', 'فريرو'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 94,
  },
  {
    id: 'chips_crisps_popcorn',
    nameAr: 'شيبسي ودوريتوس ومقرمشات وفشار',
    keywords: [
      'دوريتوس', 'شيبسي', 'شيبس', 'كرانشي', 'شيتوس', 'تايجر', 'مقرمشات',
      'سناكس', 'فشار', 'لايز', 'بيج شيبس', 'بفك'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 95,
  },
  {
    id: 'nuts_roastery',
    nameAr: 'مكسرات ومسليات ومقرمشات محمصة',
    keywords: [
      'مكسرات', 'كاجو', 'فستق', 'لوز', 'بندق', 'عين جمل', 'فول سوداني',
      'سوداني', 'لب اسمر', 'لب ابيض', 'لب سوري', 'ياميش'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1536599428105-9784189843c8?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 90,
  },

  // -------------------------------------------------------------
  // 4. GROCERY & PANTRY ESSENTIALS
  // -------------------------------------------------------------
  {
    id: 'pasta_dry',
    nameAr: 'مكرونة واسباجيتي وشعرية جافة',
    keywords: [
      'مكرونة', 'مكرونه', 'سباجيتي', 'سباغيتي', 'روجينا', 'الملكة', 'الملكه',
      'شعرية', 'شعريه', 'لسان عصفور', 'فرن', 'قلم', 'ايطاليانو', 'نودلز', 'اندومي'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1551462147-ff29053bfc14?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 98,
  },
  {
    id: 'rice_grains',
    nameAr: 'أرز فاخر أبيض وبسمتي',
    keywords: ['ارز', 'رز', 'بسمتي', 'ارز مصري', 'ارز فاخر', 'شيكاره ارز', 'ارز الضحى'],
    imageUrl: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 90,
  },
  {
    id: 'sugar_granulated',
    nameAr: 'سكر أبيض نقي في وعاء',
    keywords: ['الاسرة', 'سكر', 'سكر نقي', 'سكر ابيض', 'سكر خشن', 'سكر بودرة', 'سكر بودره', 'سكر سويتنر'],
    imageUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/12/A_Bowl_of_Sugar.jpg/500px-A_Bowl_of_Sugar.jpg',
    weight: 95,
  },
  {
    id: 'flour_starch_baking',
    nameAr: 'دقيق فاخر ونشا ومستلزمات خبز',
    keywords: [
      'دقيق', 'نشا', 'بيكنج بودر', 'بيكنج', 'فانيليا', 'خميرة', 'خميره',
      'سميد', 'دقيق فاخر', 'دريم', 'تاج الملوك', 'كريم شانتيه'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1541696432-82c6da8ce7bf?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 94,
  },
  {
    id: 'ghee_natural_butter',
    nameAr: 'سمنة وزبدة ومسلى بلدي',
    keywords: [
      'سمن', 'سمنه', 'سمنة', 'روابي', 'جنة', 'جنه', 'زبدة', 'زبده',
      'مسلى', 'فيرن', 'سمن بلدي', 'فلاحي', 'الهانم'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 95,
  },
  {
    id: 'olive_oil_extra',
    nameAr: 'زيت زيتون بكر ممتاز',
    keywords: ['زيت زيتون', 'زيتون بكر', 'زيت زيتون وادي فود', 'زيتون ممتاز'],
    imageUrl: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 98,
  },
  {
    id: 'cooking_oil_vegetable',
    nameAr: 'زيوت طعام ذرة وعباد الشمس',
    keywords: [
      'زيت ذره', 'زيت ذرة', 'زيت عباد', 'زيت طعام', 'عافية', 'عافيه',
      'كريستال', 'سلايت', 'قلية', 'قليه', 'زيت حلوة', 'زيت'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 75,
  },
  {
    id: 'tomato_paste_ketchup',
    nameAr: 'كاتشب وصلصة طماطم ومعجون',
    keywords: [
      'كاتشب', 'صلصة طماطم', 'صلصه طماطم', 'صلصة', 'صلصه', 'معجون طماطم',
      'كاتشب هاينز', 'مايونيز', 'مستردة', 'مسترده', 'باربيكيو'
    ],
    imageUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/49/Tomato_paste_can.jpg/500px-Tomato_paste_can.jpg',
    weight: 92,
  },
  {
    id: 'vinegar_condiments',
    nameAr: 'خل طبيعي ومتبلات طعام',
    keywords: ['خل', 'خل قصب', 'خل ابيض', 'خل تفاح', 'دبس رمان', 'صويا صوص'],
    imageUrl: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 90,
  },
  {
    id: 'fava_beans_legumes',
    nameAr: 'فول مدمس وبقوليات وحبوب',
    keywords: ['فول مدمس', 'فول', 'هارفست', 'عدس', 'حمص', 'لوبيا', 'فاصوليا بيضاء', 'ترمس'],
    imageUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/12/Cooked_Fava_beans.jpg/500px-Cooked_Fava_beans.jpg',
    weight: 92,
  },
  {
    id: 'honey_tahini_halawa',
    nameAr: 'عسل نحل وطحينة وحلاوة طحينية',
    keywords: ['عسل', 'عسل نحل', 'عسل اسود', 'طحينة', 'طحينه', 'حلاوة', 'حلاوه', 'الرشيدي', 'البوادي', 'امتنان'],
    imageUrl: 'https://images.unsplash.com/photo-1587049352846-4a222e784d38?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 94,
  },

  // -------------------------------------------------------------
  // 5. BEVERAGES, COFFEE & TEA
  // -------------------------------------------------------------
  {
    id: 'coca_cola_can',
    nameAr: 'كوكاكولا كانز أصلية',
    keywords: ['كوكاكولا', 'كولا كانز', 'coca cola', 'كوكا كولا'],
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/3/3f/Lata_de_Coca_Cola_zero.jpg',
    weight: 99,
  },
  {
    id: 'pepsi_soda_can',
    nameAr: 'بيبسي كانز وسفن أب ومشروبات غازية',
    keywords: [
      'بيبسي', 'pepsi', 'سفن اب', 'سبرايت', 'ميرندا', 'شويبس',
      'كانز', 'ريد بول', 'ستينج', 'مشروب طاقة', 'صودا', 'كانز ليمون'
    ],
    imageUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e3/Pepsi_355_ml%2C_Canada_%28obverse%29%2C_2026-03-05.jpg/500px-Pepsi_355_ml%2C_Canada_%28obverse%29%2C_2026-03-05.jpg',
    weight: 97,
  },
  {
    id: 'green_tea',
    nameAr: 'شاي أخضر ونعناع وأعشاب طبيعية',
    keywords: [
      'شاي اخضر', 'شاى اخضر', 'اخضر نعناع', 'احمد تي نعناع', 'احمد تي اخضر',
      'شاي بالنعناع', 'ينسون', 'كركديه', 'بابونج', 'اعشاب'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 98,
  },
  {
    id: 'red_tea',
    nameAr: 'شاي أحمر وليبتون وشاي العروسة',
    keywords: [
      'شاي العروسة', 'شاي العروسه', 'ليبتون', 'شاي احمر', 'شاي خرز',
      'شاي فتله', 'شاي ناعم', 'شاي كشري', 'شاي', 'شاى'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 80,
  },
  {
    id: 'instant_coffee_roastery',
    nameAr: 'نسكافيه وقهوة وبن وسريع التحضير',
    keywords: [
      'نسكافيه', 'كابتشينو', 'سريع التحضير', 'بونجورنو', 'قهوة', 'قهوه',
      'اسبريسو', 'بن تركي', 'بن محوج', 'بن سادة', 'بن'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 94,
  },
  {
    id: 'pure_mineral_water',
    nameAr: 'مياه معدنية نقية وطبيعية',
    keywords: [
      'مياه معدنية', 'مياه معدنيه', 'داساني', 'دساني', 'نستله مياه', 'مياه نستله',
      'بركة مياه', 'اكوافينا', 'صافي', 'مياه', 'ميه'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1559839914-17aae19cec71?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 92,
  },
  {
    id: 'natural_fruit_juice',
    nameAr: 'عصائر فواكه طبيعية وتتراباك',
    keywords: [
      'عصير', 'عصائر', 'بيتي برتقال', 'بيتي تفاح', 'جهينة عصير', 'بيور مانجو',
      'راني', 'لمار', 'عصير مانجو', 'عصير برتقال', 'عصير جوافة'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 88,
  },

  // -------------------------------------------------------------
  // 6. DAIRY, CHEESE & EGGS
  // -------------------------------------------------------------
  {
    id: 'mozzarella_yellow_cheeses',
    nameAr: 'جبنة موزاريلا مبشورة وشيدر ورومي',
    keywords: [
      'موزاريلا', 'موتزاريلا', 'شيدر', 'رومي', 'جبن رومي', 'جبنة مبشورة',
      'مبشورة', 'فلمنك', 'جودا', 'جبنة مثلثات', 'لافاش كيري'
    ],
    imageUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/24/2021-01-02_20_52_08_A_bag_of_Kraft_Finely_Shredded_Mozzarella_Cheese_in_the_Franklin_Farm_section_of_Oak_Hill%2C_Fairfax_County%2C_Virginia.jpg/500px-2021-01-02_20_52_08_A_bag_of_Kraft_Finely_Shredded_Mozzarella_Cheese_in_the_Franklin_Farm_section_of_Oak_Hill%2C_Fairfax_County%2C_Virginia.jpg',
    weight: 98,
  },
  {
    id: 'white_brined_cheese',
    nameAr: 'جبنة بيضاء وفيتا وإسطنبولي وبراميلي',
    keywords: [
      'جبنة بيضاء', 'جبنه بيضاء', 'فيتا', 'اسطنبولي', 'براميلي', 'دومتي',
      'عبور لاند', 'قريش', 'جبنة فيتا', 'جبن ابيض', 'جبنة ملح خفيف'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 95,
  },
  {
    id: 'natural_yogurt',
    nameAr: 'زبادي طبيعي ورايب',
    keywords: ['زبادي', 'زبادي طبيعي', 'زبادي لايت', 'دانون', 'زبادي بلدي', 'لبن رايب', 'رايب'],
    imageUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c1/Yogurt_vainilla_soja.jpg/500px-Yogurt_vainilla_soja.jpg',
    weight: 98,
  },
  {
    id: 'fresh_farm_eggs',
    nameAr: 'بيض مزارع طازج كرتونة وطبق',
    keywords: ['بيض', 'كرتونة بيض', 'كرتونه بيض', 'بيض احمر', 'بيض ابيض', 'بيض بلدي', 'طبق بيض'],
    imageUrl: 'https://images.unsplash.com/photo-1516448620398-c5f44bf9f441?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 98,
  },
  {
    id: 'fresh_packaged_milk',
    nameAr: 'حليب ولبن طازج وبودرة',
    keywords: [
      'لبن جهينة', 'لبن المراعي', 'لبن نيدو', 'حليب كامل الدسم', 'خالي الدسم',
      'نصف دسم', 'لبن مجفف', 'حليب بودرة', 'لبن', 'حليب'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 80,
  },

  // -------------------------------------------------------------
  // 7. BROAD CATEGORY FALLBACKS (WHEN NEW PRODUCTS DON'T MATCH SPECIFICS)
  // -------------------------------------------------------------
  {
    id: 'cat_cleaning_fallback',
    nameAr: 'قسم منظفات وعناية منزلية (عام)',
    keywords: ['منظفات وعناية منزلية', 'منظفات', 'عناية منزلية', 'مطهرات'],
    imageUrl: 'https://images.unsplash.com/photo-1583947215259-38e31be8751f?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 30,
  },
  {
    id: 'cat_dairy_fallback',
    nameAr: 'قسم ألبان وجبن وبيض (عام)',
    keywords: ['ألبان وجبن وبيض', 'البان', 'اجبان', 'اجبان وبيض'],
    imageUrl: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 30,
  },
  {
    id: 'cat_sweets_fallback',
    nameAr: 'قسم حلويات وبسكويت ومسليات (عام)',
    keywords: ['حلويات وبسكويت ومسليات', 'حلويات', 'مسليات', 'تسالي'],
    imageUrl: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 30,
  },
  {
    id: 'cat_frozen_fallback',
    nameAr: 'قسم مجمدات ولحوم ودواجن (عام)',
    keywords: ['مجمدات ولحوم ودواجن', 'مجمدات', 'لحوم ودواجن'],
    imageUrl: 'https://images.unsplash.com/photo-1587593810167-a84920ea0781?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 30,
  },
  {
    id: 'cat_drinks_fallback',
    nameAr: 'قسم مشروبات وعصائر ومياه (عام)',
    keywords: ['مشروبات وعصائر ومياه', 'مشروبات وعصائر', 'عصائر ومياه'],
    imageUrl: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 30,
  },

  // =========================================================================
  // 5. TECH, COMPUTERS & ELECTRONICS (REFINED SPECIFIC DOMAIN)
  // =========================================================================
  {
    id: 'ink_toner_printers',
    nameAr: 'أحبار وطابعات وتونر وحبارات',
    keywords: [
      'احبار بطاريات', 'احبار', 'المتميز للاحبار', 'المتميز للأحبار', 'حبر', 'احبار طابعات',
      'حبارات', 'حباره', 'حبارة', 'تونر', 'طابعه', 'طابعات', 'طابعة', 'طابعة ليزر', 'طابعة الوان', 'cartridge', 'toner'
    ],
    imageUrl: '/catalog/computer/toner_cartridges.jpg',
    weight: 98,
  },
  {
    id: 'printer_drums',
    nameAr: 'درامات وسخانات وقطع غيار طابعات',
    keywords: ['درامات', 'درام', 'درام طابعه', 'درام طابعة', 'drum unit', 'opc drum'],
    imageUrl: 'https://images.unsplash.com/photo-1616401784845-180882ba9ba8?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 96,
  },
  {
    id: 'receipt_pos_printers',
    nameAr: 'طابعات فواتير وريسيت حرارية وكاشير',
    keywords: [
      'برنتر ريسيت', 'طابعه ريسيت', 'طابعات ريسيت', 'طابعه فواتير', 'طابعات فواتير',
      'طابعه كاشير', 'طابعه حراريه', 'طابعة ريسيت', 'receipt printer', 'pos printer'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1556742049-0a67c5574f73?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 98,
  },
  {
    id: 'barcode_scanners',
    nameAr: 'سكانر وقارئ باركود ليزر',
    keywords: ['سكانر باركود', 'سكانر', 'قارئ باركود', 'قارئ بار كود', 'قارئ باركود ليزر', 'barcode scanner', 'سكانر ليزر'],
    imageUrl: '/catalog/computer/barcode_scanner.jpg',
    weight: 98,
  },
  {
    id: 'pos_cashier_supplies',
    nameAr: 'مستلزمات سيستم كاشير وأدراج نقدية',
    keywords: [
      'مستلزمات سيستم كاشير', 'سيستم كاشير', 'درج كاشير', 'درج نقديه', 'درج نقدية',
      'بكر فواتير', 'ورق حراري', 'ورق كاشير', 'شاشه كاشير', 'كاشير'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1556742049-0a67c5574f73?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 95,
  },
  {
    id: 'graphics_cards_gpu',
    nameAr: 'كروت فيجا وكروت شاشة للألعاب والتصميم',
    keywords: [
      'كروت فيجا', 'كرت فيجا', 'كارت فيجا', 'كروت شاشه', 'كرت شاشه', 'كارت شاشه',
      'فيجا', 'gpu', 'rtx', 'gtx', 'rx', 'كارت شاشة', 'graphics card'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1587202372775-e229f172b9d7?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 96,
  },
  {
    id: 'motherboards',
    nameAr: 'مازر بورد ولوحات أم',
    keywords: ['مازر بورد', 'ماذربورد', 'لوحه ام', 'لوحة ام', 'motherboard', 'لوحه رئيسيه', 'بوردة'],
    imageUrl: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 96,
  },
  {
    id: 'processors_cpu',
    nameAr: 'بروسيسورات ومعالجات كمبيوتر',
    keywords: [
      'بروسيسورات', 'بروسيسور', 'معالج', 'معالجات', 'cpu', 'intel', 'amd',
      'core i3', 'core i5', 'core i7', 'core i9', 'ryzen', 'رايزن'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1555680202-c86f0e12f086?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 96,
  },
  {
    id: 'ram_memory',
    nameAr: 'رامات حديثة وذاكرة عشوائية DDR4 وDDR5',
    keywords: ['رامات', 'رام', 'رامة', 'ddr4', 'ddr3', 'ddr5', 'ذاكره عشوائيه', 'رام لابتوب', 'ram', 'ذاكرة رام', '3200hz'],
    imageUrl: '/catalog/computer/ram_modern.jpg',
    weight: 98,
  },
  {
    id: 'hard_drives_ssd',
    nameAr: 'هاردات وذاكرة تخزين داخلية وخارجية وSSD',
    keywords: ['هاردات', 'هارد', 'ssd', 'hdd', 'هارد ديسك', 'm2 nvme', 'nvme', 'قرص صلب', 'تخزين'],
    imageUrl: 'https://images.unsplash.com/photo-1597872200969-2b65d56bd16b?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 95,
  },
  {
    id: 'pc_cases_gaming',
    nameAr: 'كيسات كمبيوتر وشاسيهات جيمنج RGB',
    keywords: [
      'كيسات جيمنج', 'كيسات كمبيوتر', 'كيسات', 'كيسه كمبيوتر', 'كيسة كمبيوتر',
      'كيسه جيمنج', 'كيسة جيمنج', 'case pc', 'pc case', 'كيسه', 'كيسة'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1587202372634-32705e3bf49c?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 95,
  },
  {
    id: 'computer_fans_cooling',
    nameAr: 'مراوح تبريد وفانات بروسيسور وكيسة',
    keywords: [
      'مراوح', 'مروحه', 'مروحة', 'فانات', 'فانة', 'تبريد', 'تبريد مائي',
      'مروحه كيسه', 'مروحة كيسة', 'فانة بروسيسور', 'rgb fan', 'cooler'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1591488320449-011701bb6704?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 94,
  },
  {
    id: 'computer_mice',
    nameAr: 'ماوسات وفأرة كمبيوتر سلكية ولاسلكية وجيمنج',
    keywords: [
      'ماوسات', 'ماوس', 'فاره', 'فأرة', 'mouse', 'ماوس وايرلس',
      'ماوس لاسلكي', 'ماوس سلكي', 'ماوس جيمنج', 'optical mouse'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1615663245857-ac93bb7c39e7?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 96,
  },
  {
    id: 'keyboards',
    nameAr: 'كيبوردات ولوحات مفاتيح كمبيوتر ميكانيكية ومكتبية',
    keywords: ['كيبوردات', 'كيبورد', 'لوحه مفاتيح', 'لوحة مفاتيح', 'keyboard', 'كيبورد جيمنج', 'كيبورد وايرلس'],
    imageUrl: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 96,
  },
  {
    id: 'mousepads_desk_mats',
    nameAr: 'بادات وماوس باد وسجادات مكتبية',
    keywords: ['بادات', 'باد', 'ماوس باد', 'باد ماوس', 'mousepad', 'desk mat', 'بادات جيمنج'],
    imageUrl: 'https://images.unsplash.com/photo-1616763355548-1b606f43848c?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 95,
  },
  {
    id: 'monitors_screens',
    nameAr: 'شاشات كمبيوتر ومونيتور',
    keywords: ['شاشات كمبيوتر', 'شاشات', 'شاشه كمبيوتر', 'شاشه', 'شاشة كمبيوتر', 'شاشة', 'monitor', 'led monitor'],
    imageUrl: 'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 95,
  },
  {
    id: 'headphones_audio',
    nameAr: 'سماعات وهيدفون وايربودز ومكبرات صوت',
    keywords: [
      'سماعات هيدفون كمبيوتر', 'سماعات', 'هيدفون', 'ايربودز', 'سماعه',
      'سماعة', 'headphone', 'earbuds', 'headset', 'صب', 'مكبر صوت',
      'صوتيات', 'صوت', 'audio'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=400&q=75&fm=webp',
    weight: 98,
  },
  {
    id: 'laptop_chargers',
    nameAr: 'شواحن لابتوب وادابتورات وباور سبلاي',
    keywords: [
      'شواحن لابتوب', 'شاحن لابتوب', 'شواحن', 'شاحن ديل', 'شاحن hp',
      'شاحن لينوفو', 'ادابتور لابتوب', 'باور سبلاي', 'شاحن لاب'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 95,
  },
  {
    id: 'laptop_stands',
    nameAr: 'حوامل لابات وقواعد تبريد لابتوب',
    keywords: ['حوامل لابات', 'حوامل', 'حامل لابتوب', 'ستاند لابتوب', 'قاعده لابتوب', 'laptop stand', 'كولر لاب', 'حامل لاب', 'ستاند لاب'],
    imageUrl: '/catalog/computer/laptop_stand.jpg',
    weight: 98,
  },
  {
    id: 'cables_mobile_charging',
    nameAr: 'كابلات شحن موبايل وUSB Type-C وLightning',
    keywords: [
      'كابلات شحن موبايل', 'كابلات شحن', 'كابل شحن', 'سلك شاحن',
      'سلك شحن', 'شاحن تايب سي', 'type c', 'type-c', 'كابل type c',
      'تايب سي', 'كابل تايب سي', 'lightning', 'lightning cable',
      'micro usb', 'كابل شحن سريع', 'شحن موبايل', 'وصلة شحن'
    ],
    imageUrl: '/catalog/computer/charging_cable.jpg',
    weight: 100,
  },
  {
    id: 'cables_hdmi_display',
    nameAr: 'كابلات شاشات وHDMI وVGA وDisplayPort وتوصيلات',
    keywords: [
      'كابلات hd', 'كابلات شاشات', 'كابل hdmi', 'كابل vga', 'displayport',
      'كابل display to hd', 'كابل display', 'aux', 'كابل aux', 'كابل شاشه',
      'كابل باور', 'كابل شاشة', 'وصله شاشه', 'وصلة شاشة', 'dvi', 'hdmi', 'vga', '1*3', '1*1'
    ],
    imageUrl: '/catalog/computer/cables_hdmi.jpg',
    weight: 96,
  },
  {
    id: 'adapters_converters',
    nameAr: 'كونفرتات ومحولات OTG وHDMI to VGA وType-C',
    keywords: [
      'كونفرتات', 'كونفرت', 'محولات', 'محول', 'تحويله', 'تحويلة',
      'converter', 'dongle', 'otg', 'او تي جي', 'joyroom', 'كارت صوت',
      'كارت صوت usb', 'hdmi to vga', 'vga to hdmi', 'type c to hdmi', 'type c to usb',
      'كونفرت display', 'كونفرت display to hd'
    ],
    imageUrl: '/catalog/computer/usb_otg.jpg',
    weight: 99,
  },
  {
    id: 'portable_speakers',
    nameAr: 'سبيكرات وسماعات بلوتوث محمولة للأغاني',
    keywords: [
      'سبيكرات', 'سبيكر', 'سبيكر بلوتوث', 'سماعات بلوتوث', 'صب بلوتوث',
      'سبيكر راديو', 'سبيكر مستطيل', 'سبيكر محمول', 'bluetooth speaker',
      'portable speaker', 'مكبر صوت محمول', 'سبيكر مضيء'
    ],
    imageUrl: '/catalog/computer/bluetooth_speaker.webp',
    weight: 99,
  },
  {
    id: 'usb_hubs',
    nameAr: 'هب USB وموزعات مداخل',
    keywords: ['هب usb', 'usb hub', 'هب', 'موزع usb', 'مشترك usb', 'hub'],
    imageUrl: 'https://images.unsplash.com/photo-1541807084-5c52b6b3adef?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 96,
  },
  {
    id: 'wifi_routers',
    nameAr: 'روترات ومودم وأكسس بوينت وواي فاي',
    keywords: ['روترات', 'روتر', 'راوتر', 'راوترات', 'واي فاي', 'wifi router', 'access point', 'مودم', 'مقوي شبكه'],
    imageUrl: 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 95,
  },
  {
    id: 'network_switches',
    nameAr: 'سويتشات شبكات وموزعات إيثرنت',
    keywords: ['سويتشات', 'سويتش', 'سويتش شبكات', 'network switch', 'ethernet switch', 'switch 8 port', 'switch 16 port'],
    imageUrl: 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 95,
  },
  {
    id: 'network_racks',
    nameAr: 'راكات وكبائن سيرفرات وشبكات',
    keywords: ['راكات', 'راك', 'راك شبكات', 'كابينة راك', 'server rack', 'network rack', 'كابينه راك'],
    imageUrl: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 95,
  },
  {
    id: 'rj45_connectors',
    nameAr: 'اوجيهات وبنسات شبكات وكونكتورات RJ45',
    keywords: ['اوجيهات', 'ارجيهات', 'ار جيه', 'rj45', 'كونكتور نت', 'بنسه ارجيهات', 'سوكت نت', 'ار جي'],
    imageUrl: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 96,
  },
  {
    id: 'network_cables_wires',
    nameAr: 'اسلاك شبكات ودش وكابلات نت Cat6 وCat5',
    keywords: ['اسلاك', 'سلك شبكه', 'سلك شبكة', 'كابل نت', 'cat6', 'cat5', 'سلك دش', 'اسلاك شبكات', 'لفة سلك'],
    imageUrl: 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 95,
  },
  {
    id: 'cctv_dvr',
    nameAr: 'كاميرات مراقبة وأجهزة تسجيل DVR',
    keywords: [
      'dvr', 'كاميرات', 'كاميرا مراقبه', 'مراقبه', 'كاميرات مراقبة',
      'كاميرا مراقبة', 'dvr 4ch', 'dvr 8ch', 'dvr 16ch', 'cctv'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1557597774-9d273605dfa9?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 95,
  },
  {
    id: 'cctv_cables_accessories',
    nameAr: 'سلك كاميرات ومستلزمات كاميرات المراقبة RG59 وBNC',
    keywords: [
      'سلك كاميرات', 'كابل كاميرات', 'مستلزمات سيسيم كاميرات', 'مستلزمات سيستم كاميرات',
      'rg59', 'سلك باور كاميرات', 'bnc', 'كونكتور bnc'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1557597774-9d273605dfa9?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 96,
  },
  {
    id: 'batteries_cells',
    nameAr: 'حجر بطارية وبطاريات أقلام ومازربورد CR2032',
    keywords: [
      'حجر بطارية', 'حجر بطاريه', 'حجاره', 'بطاريات', 'بطاريه', 'بطارية',
      'بطاريه قلم', 'بطارية قلم', 'حجارة قلم', 'cr2032', 'بطارية مازر بورد'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1619725002198-6a689b72f41d?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 95,
  },
  {
    id: 'power_strips_extensions',
    nameAr: 'مشتركات كهرباء ووصلات حماية متعددة المنافذ',
    keywords: ['مشتركات', 'مشترك', 'مشترك كهرباء', 'مشترك فيش', 'مشترك باور', 'power strip', 'وصلة كهرباء'],
    imageUrl: 'https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 95,
  },
  {
    id: 'optical_discs_cd_dvd',
    nameAr: 'اسطوانات وسيديهات ودي في دي فارغة',
    keywords: ['اسطوانات', 'اسطوانه', 'اسطوانة', 'سيدي', 'دي في دي', 'cd', 'dvd', 'بلوراي', 'اسطوانات فارغه'],
    imageUrl: 'https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 96,
  },
  {
    id: 'keyboard_stickers_labels',
    nameAr: 'استيكرات ولواصق وحروف كيبورد عربي',
    keywords: ['استيكرات', 'استيكر', 'ستيكر', 'ملصقات', 'لواصق', 'ستيكر كيبورد', 'حروف كيبورد', 'استيكر كيبورد'],
    imageUrl: 'https://images.unsplash.com/photo-1572375992501-4b0892d50c69?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 96,
  },
  {
    id: 'stationery_staplers',
    nameAr: 'دباسات ودبابيس ومستلزمات مكتبية',
    keywords: ['دباسات', 'ديباسات', 'دباسه', 'دباسة', 'دبابيس', 'خارمه', 'خارمة', 'ادوات مكتبيه', 'مستلزمات مكتبيه', 'stapler'],
    imageUrl: '/catalog/computer/stapler.jpg',
    weight: 98,
  },
  {
    id: 'network_accessories_rack',
    nameAr: 'ملحقات شبكات وبنسات وراكات',
    keywords: ['ملحقات شبكات', 'ملحقات شبكه', 'ملحقات شبكة', 'مستلزمات شبكات'],
    imageUrl: 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 96,
  },
  {
    id: 'screen_cleaners_blowers',
    nameAr: 'منظفات شاشات وكمبيوتر واسبراي وبلاور',
    keywords: [
      'منظفات', 'منظف شاشات', 'اسبراي شاشه', 'اسبراي شاشة', 'بلاور',
      'بلور', 'هواء مضغوط', 'منظف كمبيوتر', 'screen cleaner'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1584813470613-5b1c1cad3d69?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 95,
  },
  {
    id: 'flash_memory_sd',
    nameAr: 'فلاشات وكروت ميموري USB وSD Cards',
    keywords: ['فلاشات', 'فلاشه', 'فلاشة', 'كارت ميموري', 'usb flash', 'ميموري', 'sd card', 'فلاش ميموري'],
    imageUrl: 'https://images.unsplash.com/photo-1618410320928-25228d811631?auto=format&fit=crop&w=300&q=50&fm=webp',
    weight: 95,
  },

  // -------------------------------------------------------------
  // 5. SMARTPHONES, MOBILES & TABLETS (APPLE, SAMSUNG, XIAOMI, ETC.)
  // -------------------------------------------------------------
  {
    id: 'apple_iphone_pro_flagship',
    nameAr: 'أبل آيفون برو وبرو ماكس وتيتانيوم',
    keywords: [
      'ايفون 16 برو', 'ايفون 16 برو ماكس', 'آيفون 16 برو', 'آيفون 16 برو ماكس',
      'ايفون 15 برو', 'ايفون 15 برو ماكس', 'آيفون 15 برو', 'آيفون 15 برو ماكس',
      'iphone 16 pro', 'iphone 16 pro max', 'iphone 15 pro', 'iphone 15 pro max',
      'تيتانيوم صحراوي', 'تيتانيوم طبيعي', 'تيتانيوم اسود', 'تيتانيوم أبيض'
    ],
    imageUrl: IPHONE_PHOTO,
    weight: 99,
  },
  {
    id: 'apple_iphone_standard',
    nameAr: 'أبل آيفون النسخ العادية وبلس',
    keywords: [
      'ايفون 16', 'آيفون 16', 'ايفون 15', 'آيفون 15', 'ايفون 14', 'آيفون 14',
      'ايفون 13', 'آيفون 13', 'ايفون 12', 'آيفون 12', 'ايفون 11', 'آيفون 11',
      'iphone 16', 'iphone 15', 'iphone 14', 'iphone 13', 'iphone 12', 'iphone 11',
      'ابل ايفون', 'أبل آيفون', 'ابل ايفون 14', 'ابل ايفون 15', 'ابل ايفون 16'
    ],
    imageUrl: IPHONE_PHOTO,
    weight: 98,
  },
  {
    id: 'apple_iphone_general',
    nameAr: 'هواتف أبل آيفون الذكية العامة',
    keywords: ['ايفون', 'آيفون', 'iphone', 'هواتف ذكية - apple', 'هواتف فلاجشيب - apple'],
    imageUrl: IPHONE_PHOTO,
    weight: 92,
  },
  {
    id: 'samsung_galaxy_s_ultra',
    nameAr: 'سامسونج جالكسي S24 ألترا وS23 ألترا والفلاجشيب',
    keywords: [
      's24 الترا', 's24 ألترا', 's24 ultra', 's24 بلس', 's24 plus', 's24+',
      's23 الترا', 's23 ألترا', 's23 ultra', 's22 ultra', 'جالكسي s24', 'جالكسي s23',
      'سامسونج جالكسي s24', 'سامسونج جالكسي s23', 'samsung s24', 'samsung s23'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?auto=format&fit=crop&w=400&q=75&fm=webp',
    weight: 99,
  },
  {
    id: 'samsung_galaxy_a_series',
    nameAr: 'سامسونج جالكسي الفئة A الاقتصادية والمتوسطة',
    keywords: [
      'جالكسي a55', 'جالكسي a35', 'جالكسي a25', 'جالكسي a15', 'جالكسي a05',
      'samsung a55', 'samsung a35', 'samsung a25', 'samsung a15', 'samsung a05',
      'a55 5g', 'a35 5g', 'a25 5g', 'a15 5g', 'سامسونج a55', 'سامسونج a35',
      'سامسونج a25', 'سامسونج a15', 'سامسونج جالكسي a'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1580910051074-3eb694886505?auto=format&fit=crop&w=400&q=75&fm=webp',
    weight: 98,
  },
  {
    id: 'samsung_galaxy_general',
    nameAr: 'هواتف سامسونج جالكسي العامة',
    keywords: [
      'سامسونج جالكسي', 'سامسونج جلاكسي', 'جالكسي', 'جلاكسي', 'samsung galaxy',
      'هواتف ذكية - samsung', 'هواتف اقتصادية - samsung'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1565849904461-04a58ad377e0?auto=format&fit=crop&w=400&q=75&fm=webp',
    weight: 92,
  },
  {
    id: 'xiaomi_redmi_poco',
    nameAr: 'هواتف شاومي وريدمي وبوكو',
    keywords: [
      'شاومي', 'ريدمي', 'بوكو', 'xiaomi', 'redmi', 'poco',
      'هواتف ذكية - xiaomi', 'هواتف اقتصادية - xiaomi', 'هواتف فلاجشيب - xiaomi',
      'ريدمي نوت', 'redmi note', 'شاومي 14', 'xiaomi 14', 'شاومي 13'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1598327105666-5b89351aff97?auto=format&fit=crop&w=400&q=75&fm=webp',
    weight: 96,
  },
  {
    id: 'realme_smartphones',
    nameAr: 'هواتف ريلمي الذكية',
    keywords: [
      'ريلمي', 'realme', 'ريلمي c', 'ريلمي 12', 'ريلمي 11',
      'هواتف ذكية - realme', 'هواتف اقتصادية - realme', 'هواتف فلاجشيب - realme'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1574944985070-8f3ebc6b79d2?auto=format&fit=crop&w=400&q=75&fm=webp',
    weight: 96,
  },
  {
    id: 'oppo_smartphones',
    nameAr: 'هواتف أوبو الذكية ورينو',
    keywords: [
      'اوبو', 'أوبو', 'oppo', 'رينو', 'reno', 'اوبو رينو', 'أوبو رينو',
      'هواتف ذكية - oppo', 'هواتف اقتصادية - oppo'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1585060544812-6b45742d762f?auto=format&fit=crop&w=400&q=75&fm=webp',
    weight: 96,
  },
  {
    id: 'infinix_smartphones',
    nameAr: 'هواتف إنفينكس الذكية وسلسلة هوت ونوت',
    keywords: [
      'انفينكس', 'إنفينكس', 'infinix', 'انفينكس هوت', 'انفينكس نوت',
      'هواتف ذكية - infinix', 'هواتف اقتصادية - infinix'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1567581935884-3349723552ca?auto=format&fit=crop&w=400&q=75&fm=webp',
    weight: 96,
  },
  {
    id: 'honor_smartphones',
    nameAr: 'هواتف هونر وماجيك الذكية',
    keywords: [
      'هونر', 'honor', 'هونر ماجيك', 'honor magic', 'هونر x',
      'هواتف ذكية - honor', 'هواتف فلاجشيب - honor'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1592899677977-9c10ca588bbd?auto=format&fit=crop&w=400&q=75&fm=webp',
    weight: 96,
  },
  {
    id: 'foldable_smartphones',
    nameAr: 'هواتف ذكية قابلة للطي فولد وفليب',
    keywords: [
      'قابلة للطي', 'قابله للطي', 'فولد', 'فليب', 'fold', 'flip',
      'z fold', 'z flip', 'هواتف ذكية - قابلة للطي'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1584006682522-dc17d6c0d9ac?auto=format&fit=crop&w=400&q=75&fm=webp',
    weight: 97,
  },
  {
    id: 'smartwatches_wearables',
    nameAr: 'ساعات ذكية وسوار رياضي ذكي',
    keywords: [
      'ساعة ذكية', 'ساعه ذكيه', 'ساعات ذكية', 'ساعات ذكيه', 'smartwatch', 'smart watch',
      'ابل واتش', 'أبل واتش', 'apple watch', 'ساعة ابل', 'سوار ذكي', 'smart band'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1508685096489-7aacd43bd3b1?auto=format&fit=crop&w=400&q=75&fm=webp',
    weight: 97,
  },
  {
    id: 'wireless_earbuds_airpods',
    nameAr: 'سماعات ايربودز وبلوتوث لاسلكية',
    keywords: [
      'ايربودز', 'إيربودز', 'airpods', 'air pods', 'سماعات بلوتوث', 'سماعه بلوتوث',
      'سماعة بلوتوث', 'earbuds', 'بودز', 'سماعات لاسلكية', 'سماعات اذن'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?auto=format&fit=crop&w=400&q=75&fm=webp',
    weight: 97,
  },
  {
    id: 'power_banks_portable',
    nameAr: 'بنوك طاقة وشواحن متنقلة وباور بنك',
    keywords: [
      'باور بنك', 'باوربانك', 'power bank', 'powerbank', 'شاحن متنقل',
      'بطارية متنقلة', 'بطاريات وشواحن متنقلة', 'شواحن متنقلة'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1609592424109-dd9892f1b177?auto=format&fit=crop&w=400&q=75&fm=webp',
    weight: 97,
  },
  {
    id: 'fast_wall_chargers',
    nameAr: 'شواحن جدارية سريعة ورؤوس شواحن',
    keywords: [
      'شاحن سريع', 'راس شاحن', 'رأس شاحن', 'شاحن جداري', 'شاحن ابل', 'شاحن سامسونج',
      'شاحن 20 واط', 'شاحن 25 واط', 'شاحن 65 واط', 'wall charger', 'fast charger'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?auto=format&fit=crop&w=400&q=75&fm=webp',
    weight: 96,
  },
  {
    id: 'phone_cases_covers',
    nameAr: 'جرابات وكفرات وحافظات هواتف',
    keywords: [
      'جراب', 'جرابات', 'كفر', 'كفرات', 'حافظة هاتف', 'phone case',
      'جراب سيليكون', 'كفر حماية', 'جراب شفاف'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1586953208448-b95a79798f07?auto=format&fit=crop&w=400&q=75&fm=webp',
    weight: 96,
  },

  // -------------------------------------------------------------
  // 6. COMPUTERS, LAPTOPS & IT HARDWARE
  // -------------------------------------------------------------
  {
    id: 'laptops_notebooks',
    nameAr: 'أجهزة لابتوب وحواسيب محمولة وماك بوك',
    keywords: [
      'لابتوب', 'لاب توب', 'laptop', 'ماك بوك', 'macbook', 'نوت بوك',
      'حاسوب محمول', 'كمبيوتر محمول', 'لابتوب ديل', 'لابتوب لينوفو', 'لابتوب hp'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=400&q=75&fm=webp',
    weight: 98,
  },
  {
    id: 'pc_monitors_displays',
    nameAr: 'شاشات كمبيوتر ومونيتور قيمنق',
    keywords: [
      'شاشة كمبيوتر', 'شاشه كمبيوتر', 'شاشات كمبيوتر', 'مونيتور', 'monitor',
      'شاشة قيمنق', 'شاشة 144hz', 'شاشة 165hz', 'شاشة ips'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?auto=format&fit=crop&w=400&q=75&fm=webp',
    weight: 98,
  },
  {
    id: 'desktop_gaming_pc',
    nameAr: 'كيسات كمبيوتر وتجميعات قيمنق',
    keywords: [
      'تجميعة كمبيوتر', 'تجميعه كمبيوتر', 'كيسة قيمنق', 'كيس قيمنق',
      'gaming pc', 'كمبيوتر مكتبي', 'كيسة كمبيوتر', 'desktop pc'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1587202372775-e229f172b9d7?auto=format&fit=crop&w=400&q=75&fm=webp',
    weight: 98,
  },
  {
    id: 'graphic_cards_gpu',
    nameAr: 'كروت شاشة ومعالجات رسومية GPU RTX GTX',
    keywords: [
      'كارت شاشة', 'كارت شاشه', 'كرت شاشة', 'كرت شاشه', 'كروت شاشة',
      'gpu', 'rtx', 'gtx', 'geforce', 'كارت rtx', 'كارت gtx', 'radeon'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1591799264318-7e6ef8ddb7ea?auto=format&fit=crop&w=400&q=75&fm=webp',
    weight: 98,
  },
  {
    id: 'mechanical_keyboards',
    nameAr: 'لوحات مفاتيح ميكانيكية وقيمنق',
    keywords: [
      'كيبورد ميكانيكي', 'كيبورد قيمنق', 'لوحة مفاتيح قيمنق', 'mechanical keyboard',
      'كيبورد rgb', 'لوحة مفاتيح مضيئة'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=400&q=75&fm=webp',
    weight: 97,
  },
  {
    id: 'gaming_mice',
    nameAr: 'فأرة وماوس قيمنق احترافي',
    keywords: [
      'ماوس قيمنق', 'ماوس احترافي', 'gaming mouse', 'فأرة قيمنق',
      'ماوس لاسلكي', 'ماوس وايرلس'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?auto=format&fit=crop&w=400&q=75&fm=webp',
    weight: 97,
  },

  // -------------------------------------------------------------
  // 7. HERBS, SPICES & ATTARA (العطارة والتوابل والأعشاب)
  // -------------------------------------------------------------
  {
    id: 'attara_spices_general',
    nameAr: 'بهارات وتوابل وعطارة مشكلة',
    keywords: [
      'توابل', 'بهارات', 'عطارة', 'عطاره', 'بهار', 'بهارات مشكلة',
      'بهارات لحم', 'بهارات فراخ', 'بهارات سمك', 'سبع بهارات', 'السبع بهارات'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1596040033229-a9821ebd058d?auto=format&fit=crop&w=400&q=75&fm=webp',
    weight: 97,
  },
  {
    id: 'attara_black_pepper',
    nameAr: 'فلفل أسود حب ومطحون وفلفل أبيض',
    keywords: [
      'فلفل اسود', 'فلفل أسود', 'فلفل ابيض', 'فلفل أبيض', 'فلفل حب',
      'فلفل مطحون', 'black pepper'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1509358271058-acd22cc93898?auto=format&fit=crop&w=400&q=75&fm=webp',
    weight: 98,
  },
  {
    id: 'attara_cinnamon_ginger',
    nameAr: 'قرفة عيدان ومطحونة وزنجبيل',
    keywords: [
      'قرفة', 'قرفه', 'قرفة عيدان', 'قرفة مطحونة', 'قرفه مطحونه',
      'زنجبيل', 'جنزبيل', 'زنجبيل مطحون', 'cinnamon', 'ginger'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1509358740172-f77c168f6312?auto=format&fit=crop&w=400&q=75&fm=webp',
    weight: 98,
  },
  {
    id: 'attara_cumin_turmeric_curry',
    nameAr: 'كمون مطحون وكركم وكاري',
    keywords: [
      'كمون', 'كمون مطحون', 'كمون حب', 'كركم', 'كركم مطحون',
      'كاري', 'كاري هندي', 'turmeric', 'cumin', 'curry'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?auto=format&fit=crop&w=400&q=75&fm=webp',
    weight: 98,
  },
  {
    id: 'attara_herbs_thyme_anise',
    nameAr: 'أعشاب طبيعية وزعتر وينسون وكركديه وحبة البركة',
    keywords: [
      'زعتر', 'ينسون', 'يانسون', 'كركديه', 'كركدية', 'حبة البركة', 'حبه البركه',
      'نعناع مجفف', 'نعناع ناشف', 'بابونج', 'شمر', 'بردقوش', 'قرنفل'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=400&q=75&fm=webp',
    weight: 97,
  },
  {
    id: 'attara_nuts_assorted',
    nameAr: 'مكسرات مشكلة ولوز وكاجو وفستق وعين جمل',
    keywords: [
      'مكسرات', 'مكسرات مشكلة', 'لوز', 'كاجو', 'فستق', 'عين جمل',
      'بندق', 'فول سوداني', 'سوداني', 'nuts'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1536591375315-1b8368903277?auto=format&fit=crop&w=400&q=75&fm=webp',
    weight: 97,
  },
  {
    id: 'attara_natural_honey',
    nameAr: 'عسل نحل طبيعي وعسل جبلي وسدر',
    keywords: [
      'عسل نحل', 'عسل ابيض', 'عسل أبيض', 'عسل جبلي', 'عسل سدر',
      'عسل حبة البركة', 'عسل زهور', 'honey'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1587049352846-4a222e784d38?auto=format&fit=crop&w=400&q=75&fm=webp',
    weight: 98,
  },
  {
    id: 'attara_natural_oils',
    nameAr: 'زيوت طبيعية وعطرية وزيت حبة البركة والسمسم',
    keywords: [
      'زيت حبة البركة', 'زيت سمسم', 'زيت لوز', 'زيت جوز هند', 'زيت خروع',
      'زيت ارجان', 'زيوت طبيعية', 'زيوت طبيعيه', 'زيت زيتون بكر'
    ],
    imageUrl: 'https://images.unsplash.com/photo-1608571423902-eed4a5ad8108?auto=format&fit=crop&w=400&q=75&fm=webp',
    weight: 97,
  },
];
