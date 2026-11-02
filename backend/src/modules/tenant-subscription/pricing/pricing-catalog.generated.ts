/* eslint-disable */
// ملف مُولَّد آلياً — لا تعدّله يداً.
// المصدر: pricing/pricing-catalog.json
// أعد التوليد بـ: node pricing/validate-catalog.mjs
// المرجع: PRICING_AND_PACKAGING.md §13 · الثابت PRICE-2 · النمط المحظور F40

import type { PricingCatalog } from './pricing-catalog.types';

export const PRICING_CATALOG: PricingCatalog = {
  "version": "1.0",
  "updatedAt": "2026-09-25",
  "reviewDueAt": "2027-03-25",
  "vatIncluded": false,
  "annualEqualsMonths": 10,
  "trialDays": 14,
  "trialMaxUsers": 5,
  "fx": {
    "base": "USD",
    "asOf": "2026-09-25",
    "rates": {
      "EGP": 51.92,
      "SAR": 3.75,
      "AED": 3.6725,
      "QAR": 3.64,
      "KWD": 0.307,
      "BHD": 0.376,
      "OMR": 0.3845
    }
  },
  "resolution": {
    "steps": [
      "1. المستخدم يفتح صفحة منتج => products[i]",
      "2. النطاق = products[i].band => bands[band]",
      "3. لكل مستوى في bands[band].levels: الاسم المعروض = level.publicName، والحدود = level.limits",
      "4. مجموعات الميزات = products[i].levelGroupsOverride[levelId] إن وُجدت، وإلا bands[band].levelGroups[levelId]",
      "5. قائمة الميزات المعروضة = products[i].sectorFeatures (في المستوى الأول فقط) + تجميع featureGroups[g].items لكل g في الخطوة 4",
      "6. السعر = bands[band].levels[levelId].prices[countryCode]  (monthly / annual / perpetual)",
      "7. البلد المسموح بيعه = countries[code].status === 'ready' أو 'partial'. حالة 'blocked' لا تُعرض لها أسعار إطلاقاً",
      "8. الترخيص الدائم: إن غاب perpetual للبلد، يُحسب = annual × offline.perpetualMultiplierFromAnnual، ويُستثنى ما في offline.notSoldOffline"
    ]
  },
  "featureGroups": {
    "core_pos": {
      "name": "الأساس التشغيلي",
      "items": [
        "كتالوج الأصناف والباركود والوحدات",
        "نقطة بيع وكاشير سريع بالباركود",
        "ورديات العمل وتسليم النقدية",
        "الخزينة والمصروفات اليومية",
        "شاشة عرض العميل المقابلة للكاشير",
        "البيع بدون إنترنت والمزامنة التلقائية عند العودة",
        "تقارير المبيعات والأرباح اليومية",
        "المستخدمون والصلاحيات وسجل النشاط"
      ]
    },
    "operations": {
      "name": "التشغيل الكامل",
      "items": [
        "المشتريات والموردين ومرتجعات الشراء",
        "مخازن متعددة وأماكن تخزين وأرفف",
        "الجرد بالباركود ومحاضر الجرد الدوري",
        "العملاء والبيع الآجل وكشوف الحساب",
        "قوائم أسعار العملاء وشرائح الكميات",
        "العروض الترويجية وBOGO والهابي أور",
        "برنامج الولاء ونقاط المكافآت",
        "أوامر البيع وحجز المخزون المؤقت",
        "أوامر الشراء واستلام المخزون والمطابقة الثلاثية",
        "طلبات عروض أسعار الموردين ومصفوفة المقارنة",
        "لوحات ذكاء الأعمال والرسوم التنفيذية"
      ]
    },
    "finance": {
      "name": "المحاسبة والمالية",
      "items": [
        "شجرة الحسابات والقيود اليومية المزدوجة",
        "ميزان المراجعة والقوائم المالية والختامية",
        "مراكز التكلفة والموازنات التقديرية وتحليل الربحية",
        "قفل الفترات المحاسبية والقيود اليدوية المتزنة",
        "الشيكات المؤجلة وحافظة أوراق القبض والدفع",
        "الأصول الثابتة والإهلاك الآلي",
        "ضريبة الخصم والإضافة ونموذج 41",
        "تسوية وتخصيص المدفوعات والقيود العكسية الآلية"
      ]
    },
    "hr": {
      "name": "الموارد البشرية والرواتب",
      "items": [
        "مسير الرواتب الشهري والبدلات والخصومات",
        "الحضور والانصراف وبصمة GPS بصورة الوجه",
        "السلف والإجازات والعهد",
        "تصفية نهاية الخدمة ومكافأتها",
        "بوابة الخدمة الذاتية للموظف"
      ]
    },
    "einvoice": {
      "name": "الفاتورة الإلكترونية والإقرارات",
      "items": [
        "الفاتورة الإلكترونية المصرية والربط مع مصلحة الضرائب",
        "الإقرار الضريبي نموذج 10",
        "مطابقة الحركات والمستندات"
      ]
    },
    "einvoice_zatca": {
      "name": "الفاتورة الإلكترونية السعودية",
      "items": [
        "الربط المباشر مع هيئة الزكاة والضريبة والجمارك (ZATCA المرحلة الثانية)",
        "التوقيع والختم والـQR المعتمد",
        "الإقرار الضريبي"
      ]
    },
    "intelligence": {
      "name": "الذكاء والحماية",
      "items": [
        "رادار كشف تلاعب وسرقات الكاشير",
        "حماية هامش الربح وإعادة التسعير الآلي عند غلاء المورد",
        "المساعد الذكي والتحليلات التنبؤية",
        "محرك إمداد الأرفف الذكي وأمر التحميل",
        "الملخص التنفيذي واللوجستي اليومي"
      ]
    },
    "online": {
      "name": "التجارة الأونلاين",
      "items": [
        "متجر إلكتروني PWA برابط مستقل لكل متجر على سب دومين",
        "بوابات الدفع الإلكتروني",
        "الربط مع شركات الشحن",
        "السلات المتروكة والكوبونات ومناطق التوصيل والشحن المجاني",
        "الربط والمزامنة مع أمازون ونون",
        "بوت واتساب التفاعلي بالذكاء الاصطناعي",
        "الطلب الذاتي من الطاولة بالـQR"
      ]
    },
    "contracting_core": {
      "name": "أساس المقاولات",
      "items": [
        "المشاريع وعقود الإسناد",
        "جداول الكميات والمقايسات (BOQ / SOV) وبنك البنود",
        "المستخلصات الجارية (IPC) واحتسابها",
        "محاسبة المشاريع والرقابة على التكاليف",
        "المشتريات وأذون الصرف",
        "التقارير اليومية للمواقع"
      ]
    },
    "contracting_company": {
      "name": "إدارة الشركة والباطن",
      "items": [
        "مقاولو الباطن وعقودهم ومستخلصاتهم",
        "الأوامر التغييرية",
        "شهادات الدفع AIA G702 و G703",
        "الضمانات وبوابة الرقابة G1",
        "مستودعات المواقع وأذون خامات التشوينات",
        "مراكز التكلفة لكل مشروع"
      ]
    },
    "maritime_core": {
      "name": "أساس الشحن واللوجستيات",
      "items": [
        "أوامر التشغيل وملفات الرحلات",
        "بوالص الشحن (B/L) والمستندات",
        "الحاويات وفترات السماح وغرامات الأرضيات والدموراج",
        "محاسبة أوامر التشغيل والتكاليف",
        "المشتريات والمصروفات التشغيلية"
      ]
    },
    "maritime_company": {
      "name": "التسعير والربحية",
      "items": [
        "مصفوفة مقارنة عروض الخطوط الملاحية والترسية",
        "تدقيق فواتير الناقل آلياً",
        "ربحية الحاوية والرحلة وأمر التشغيل",
        "بوابة تتبع عامة بتوكن للعميل",
        "مراكز التكلفة"
      ]
    },
    "warehousing_core": {
      "name": "إدارة المستودعات والتحويلات",
      "items": [
        "إدارة المخازن المتعددة والمواقع والأرفف والمسارات",
        "التحويلات المخزنية بين الفروع والمستودعات مع دورة الاستلام والتدقيق",
        "أذون الصرف المخزني وأذون الإضافة ومحاضر الفحص",
        "الجرد المخزني بالباركود وتتبع الفروقات والتسويات",
        "تتبع تواريخ الصلاحية وأرقام التشغيلات (Batches & Lots)",
        "المشتريات والتوريد وأوامر الشراء ومتابعة الموردين",
        "أوامر البيع وتسليم البضاعة وكشوف حساب العملاء"
      ]
    },
    "enterprise_extras": {
      "name": "الإضافات المؤسسية",
      "items": [
        "تعدد الشركات والكيانات",
        "ذكاء الأعمال التنفيذي واللوحات المتقدمة",
        "دعم بأولوية واستجابة 4 ساعات"
      ]
    }
  },
  "bands": {
    "band1": {
      "internalName": "تجزئة عامة",
      "publishBandItself": false,
      "levelGroups": {
        "L1": [
          "core_pos"
        ],
        "L2": [
          "core_pos",
          "operations"
        ],
        "L3": [
          "core_pos",
          "operations",
          "finance",
          "hr",
          "einvoice",
          "intelligence"
        ]
      },
      "levels": {
        "L1": {
          "publicName": "محل",
          "limits": {
            "branches": 1,
            "posTerminals": 2,
            "users": 3
          },
          "prices": {
            "EG": {
              "currency": "EGP",
              "monthly": 450,
              "annual": 4500,
              "perpetual": 10000
            },
            "SA": {
              "currency": "SAR",
              "monthly": 149,
              "annual": 1490
            },
            "AE": {
              "currency": "AED",
              "monthly": 159,
              "annual": 1590
            },
            "QA": {
              "currency": "QAR",
              "monthly": 159,
              "annual": 1590
            },
            "KW": {
              "currency": "KWD",
              "monthly": 13,
              "annual": 130
            },
            "BH": {
              "currency": "BHD",
              "monthly": 15,
              "annual": 150
            },
            "OM": {
              "currency": "OMR",
              "monthly": 15,
              "annual": 150
            }
          }
        },
        "L2": {
          "publicName": "متعدد الفروع",
          "limits": {
            "branches": 2,
            "posTerminals": 4,
            "users": 10
          },
          "prices": {
            "EG": {
              "currency": "EGP",
              "monthly": 1900,
              "annual": 19000,
              "perpetual": 30000
            },
            "SA": {
              "currency": "SAR",
              "monthly": 449,
              "annual": 4490
            },
            "AE": {
              "currency": "AED",
              "monthly": 479,
              "annual": 4790
            },
            "QA": {
              "currency": "QAR",
              "monthly": 479,
              "annual": 4790
            },
            "KW": {
              "currency": "KWD",
              "monthly": 39,
              "annual": 390
            },
            "BH": {
              "currency": "BHD",
              "monthly": 45,
              "annual": 450
            },
            "OM": {
              "currency": "OMR",
              "monthly": 45,
              "annual": 450
            }
          }
        },
        "L3": {
          "publicName": "سلسلة ومؤسسة",
          "limits": {
            "branches": 5,
            "posTerminals": null,
            "users": 25
          },
          "prices": {
            "EG": {
              "currency": "EGP",
              "monthly": 4500,
              "annual": 45000,
              "perpetual": 68000
            },
            "SA": {
              "currency": "SAR",
              "monthly": 999,
              "annual": 9990
            },
            "AE": {
              "currency": "AED",
              "monthly": 1059,
              "annual": 10590
            },
            "QA": {
              "currency": "QAR",
              "monthly": 1059,
              "annual": 10590
            },
            "KW": {
              "currency": "KWD",
              "monthly": 89,
              "annual": 890
            },
            "BH": {
              "currency": "BHD",
              "monthly": 99,
              "annual": 990
            },
            "OM": {
              "currency": "OMR",
              "monthly": 99,
              "annual": 990
            }
          }
        }
      }
    },
    "band2": {
      "internalName": "معارض عالية القيمة",
      "publishBandItself": false,
      "levelGroups": {
        "L1": [
          "core_pos"
        ],
        "L2": [
          "core_pos",
          "operations"
        ],
        "L3": [
          "core_pos",
          "operations",
          "finance",
          "hr",
          "einvoice",
          "intelligence"
        ]
      },
      "levels": {
        "L1": {
          "publicName": "محل / معرض",
          "limits": {
            "branches": 1,
            "posTerminals": 2,
            "users": 3
          },
          "prices": {
            "EG": {
              "currency": "EGP",
              "monthly": 650,
              "annual": 6500,
              "perpetual": 15000
            },
            "SA": {
              "currency": "SAR",
              "monthly": 199,
              "annual": 1990
            },
            "AE": {
              "currency": "AED",
              "monthly": 209,
              "annual": 2090
            },
            "QA": {
              "currency": "QAR",
              "monthly": 209,
              "annual": 2090
            },
            "KW": {
              "currency": "KWD",
              "monthly": 17,
              "annual": 170
            },
            "BH": {
              "currency": "BHD",
              "monthly": 19,
              "annual": 190
            },
            "OM": {
              "currency": "OMR",
              "monthly": 19,
              "annual": 190
            }
          }
        },
        "L2": {
          "publicName": "متعدد الفروع",
          "limits": {
            "branches": 3,
            "posTerminals": 6,
            "users": 12
          },
          "prices": {
            "EG": {
              "currency": "EGP",
              "monthly": 2200,
              "annual": 22000,
              "perpetual": 38000
            },
            "SA": {
              "currency": "SAR",
              "monthly": 549,
              "annual": 5490
            },
            "AE": {
              "currency": "AED",
              "monthly": 579,
              "annual": 5790
            },
            "QA": {
              "currency": "QAR",
              "monthly": 579,
              "annual": 5790
            },
            "KW": {
              "currency": "KWD",
              "monthly": 49,
              "annual": 490
            },
            "BH": {
              "currency": "BHD",
              "monthly": 55,
              "annual": 550
            },
            "OM": {
              "currency": "OMR",
              "monthly": 55,
              "annual": 550
            }
          }
        },
        "L3": {
          "publicName": "سلسلة ومؤسسة",
          "limits": {
            "branches": 8,
            "posTerminals": null,
            "users": 25
          },
          "prices": {
            "EG": {
              "currency": "EGP",
              "monthly": 5000,
              "annual": 50000,
              "perpetual": 80000
            },
            "SA": {
              "currency": "SAR",
              "monthly": 1199,
              "annual": 11990
            },
            "AE": {
              "currency": "AED",
              "monthly": 1269,
              "annual": 12690
            },
            "QA": {
              "currency": "QAR",
              "monthly": 1269,
              "annual": 12690
            },
            "KW": {
              "currency": "KWD",
              "monthly": 105,
              "annual": 1050
            },
            "BH": {
              "currency": "BHD",
              "monthly": 119,
              "annual": 1190
            },
            "OM": {
              "currency": "OMR",
              "monthly": 119,
              "annual": 1190
            }
          }
        }
      }
    },
    "band3": {
      "internalName": "مطاعم وكافيهات",
      "publishBandItself": false,
      "levelGroups": {
        "L1": [
          "core_pos"
        ],
        "L2": [
          "core_pos",
          "operations"
        ],
        "L3": [
          "core_pos",
          "operations",
          "finance",
          "hr",
          "einvoice",
          "intelligence"
        ]
      },
      "levels": {
        "L1": {
          "publicName": "فرع واحد",
          "limits": {
            "branches": 1,
            "posTerminals": 2,
            "users": 5
          },
          "prices": {
            "EG": {
              "currency": "EGP",
              "monthly": 1400,
              "annual": 14000,
              "perpetual": 28000
            },
            "SA": {
              "currency": "SAR",
              "monthly": 349,
              "annual": 3490
            },
            "AE": {
              "currency": "AED",
              "monthly": 369,
              "annual": 3690
            },
            "QA": {
              "currency": "QAR",
              "monthly": 369,
              "annual": 3690
            },
            "KW": {
              "currency": "KWD",
              "monthly": 29,
              "annual": 290
            },
            "BH": {
              "currency": "BHD",
              "monthly": 35,
              "annual": 350
            },
            "OM": {
              "currency": "OMR",
              "monthly": 35,
              "annual": 350
            }
          }
        },
        "L2": {
          "publicName": "ثلاثة فروع",
          "limits": {
            "branches": 3,
            "posTerminals": 6,
            "users": 15
          },
          "prices": {
            "EG": {
              "currency": "EGP",
              "monthly": 3400,
              "annual": 34000,
              "perpetual": 58000
            },
            "SA": {
              "currency": "SAR",
              "monthly": 749,
              "annual": 7490
            },
            "AE": {
              "currency": "AED",
              "monthly": 789,
              "annual": 7890
            },
            "QA": {
              "currency": "QAR",
              "monthly": 789,
              "annual": 7890
            },
            "KW": {
              "currency": "KWD",
              "monthly": 65,
              "annual": 650
            },
            "BH": {
              "currency": "BHD",
              "monthly": 75,
              "annual": 750
            },
            "OM": {
              "currency": "OMR",
              "monthly": 75,
              "annual": 750
            }
          }
        },
        "L3": {
          "publicName": "سلسلة",
          "limits": {
            "branches": 8,
            "posTerminals": null,
            "users": 30
          },
          "prices": {
            "EG": {
              "currency": "EGP",
              "monthly": 6900,
              "annual": 69000,
              "perpetual": 115000
            },
            "SA": {
              "currency": "SAR",
              "monthly": 1499,
              "annual": 14990
            },
            "AE": {
              "currency": "AED",
              "monthly": 1589,
              "annual": 15890
            },
            "QA": {
              "currency": "QAR",
              "monthly": 1589,
              "annual": 15890
            },
            "KW": {
              "currency": "KWD",
              "monthly": 129,
              "annual": 1290
            },
            "BH": {
              "currency": "BHD",
              "monthly": 149,
              "annual": 1490
            },
            "OM": {
              "currency": "OMR",
              "monthly": 149,
              "annual": 1490
            }
          }
        }
      }
    },
    "band4": {
      "internalName": "شركات",
      "publishBandItself": false,
      "levelGroups": {
        "L1": [
          "core_pos"
        ],
        "L2": [
          "core_pos",
          "operations"
        ],
        "L3": [
          "core_pos",
          "operations",
          "finance",
          "hr",
          "einvoice",
          "intelligence"
        ]
      },
      "levels": {
        "L1": {
          "publicName": "أساسي",
          "limits": {
            "branches": 1,
            "posTerminals": 2,
            "users": 5
          },
          "prices": {
            "EG": {
              "currency": "EGP",
              "monthly": 1500,
              "annual": 15000,
              "perpetual": 26000
            },
            "SA": {
              "currency": "SAR",
              "monthly": 399,
              "annual": 3990
            },
            "AE": {
              "currency": "AED",
              "monthly": 419,
              "annual": 4190
            },
            "QA": {
              "currency": "QAR",
              "monthly": 419,
              "annual": 4190
            },
            "KW": {
              "currency": "KWD",
              "monthly": 35,
              "annual": 350
            },
            "BH": {
              "currency": "BHD",
              "monthly": 39,
              "annual": 390
            },
            "OM": {
              "currency": "OMR",
              "monthly": 39,
              "annual": 390
            }
          }
        },
        "L2": {
          "publicName": "شركة",
          "limits": {
            "branches": 3,
            "posTerminals": 6,
            "users": 12
          },
          "prices": {
            "EG": {
              "currency": "EGP",
              "monthly": 3600,
              "annual": 36000,
              "perpetual": 62000
            },
            "SA": {
              "currency": "SAR",
              "monthly": 899,
              "annual": 8990
            },
            "AE": {
              "currency": "AED",
              "monthly": 949,
              "annual": 9490
            },
            "QA": {
              "currency": "QAR",
              "monthly": 949,
              "annual": 9490
            },
            "KW": {
              "currency": "KWD",
              "monthly": 79,
              "annual": 790
            },
            "BH": {
              "currency": "BHD",
              "monthly": 89,
              "annual": 890
            },
            "OM": {
              "currency": "OMR",
              "monthly": 89,
              "annual": 890
            }
          }
        },
        "L3": {
          "publicName": "مؤسسة",
          "limits": {
            "branches": 10,
            "posTerminals": null,
            "users": 30
          },
          "prices": {
            "EG": {
              "currency": "EGP",
              "monthly": 7500,
              "annual": 75000,
              "perpetual": 125000
            },
            "SA": {
              "currency": "SAR",
              "monthly": 1799,
              "annual": 17990
            },
            "AE": {
              "currency": "AED",
              "monthly": 1899,
              "annual": 18990
            },
            "QA": {
              "currency": "QAR",
              "monthly": 1899,
              "annual": 18990
            },
            "KW": {
              "currency": "KWD",
              "monthly": 159,
              "annual": 1590
            },
            "BH": {
              "currency": "BHD",
              "monthly": 179,
              "annual": 1790
            },
            "OM": {
              "currency": "OMR",
              "monthly": 179,
              "annual": 1790
            }
          }
        }
      }
    },
    "band5": {
      "internalName": "قطاعات مؤسسية",
      "publishBandItself": false,
      "quoteAnnuallyOnly": true,
      "quoteAnnuallyReason": "السعر الشهري يُدرك كبرنامج والسنوي يُدرك كمنظومة مؤسسية (PRICE-S4)",
      "levelGroups": {
        "L1": [],
        "L2": [],
        "L3": []
      },
      "levels": {
        "L1": {
          "publicName": "مكتب",
          "limits": {
            "users": 5,
            "activeProjects": 3,
            "containersPerMonth": 60
          },
          "prices": {
            "EG": {
              "currency": "EGP",
              "monthly": 4500,
              "annual": 45000,
              "perpetual": 120000
            },
            "SA": {
              "currency": "SAR",
              "monthly": 1200,
              "annual": 12000
            },
            "AE": {
              "currency": "AED",
              "monthly": 1290,
              "annual": 12900
            },
            "QA": {
              "currency": "QAR",
              "monthly": 1290,
              "annual": 12900
            },
            "KW": {
              "currency": "KWD",
              "monthly": 105,
              "annual": 1050
            },
            "BH": {
              "currency": "BHD",
              "monthly": 119,
              "annual": 1190
            },
            "OM": {
              "currency": "OMR",
              "monthly": 119,
              "annual": 1190
            }
          }
        },
        "L2": {
          "publicName": "شركة",
          "limits": {
            "users": 12,
            "activeProjects": null,
            "containersPerMonth": null
          },
          "prices": {
            "EG": {
              "currency": "EGP",
              "monthly": 9500,
              "annual": 95000,
              "perpetual": 240000
            },
            "SA": {
              "currency": "SAR",
              "monthly": 2500,
              "annual": 25000
            },
            "AE": {
              "currency": "AED",
              "monthly": 2649,
              "annual": 26490
            },
            "QA": {
              "currency": "QAR",
              "monthly": 2649,
              "annual": 26490
            },
            "KW": {
              "currency": "KWD",
              "monthly": 219,
              "annual": 2190
            },
            "BH": {
              "currency": "BHD",
              "monthly": 249,
              "annual": 2490
            },
            "OM": {
              "currency": "OMR",
              "monthly": 249,
              "annual": 2490
            }
          }
        },
        "L3": {
          "publicName": "مؤسسة",
          "limits": {
            "users": 35,
            "activeProjects": null,
            "containersPerMonth": null,
            "multiCompany": true
          },
          "prices": {
            "EG": {
              "currency": "EGP",
              "monthly": 18000,
              "annual": 180000,
              "perpetual": 450000
            },
            "SA": {
              "currency": "SAR",
              "monthly": 4900,
              "annual": 49000
            },
            "AE": {
              "currency": "AED",
              "monthly": 5190,
              "annual": 51900
            },
            "QA": {
              "currency": "QAR",
              "monthly": 5190,
              "annual": 51900
            },
            "KW": {
              "currency": "KWD",
              "monthly": 429,
              "annual": 4290
            },
            "BH": {
              "currency": "BHD",
              "monthly": 489,
              "annual": 4890
            },
            "OM": {
              "currency": "OMR",
              "monthly": 489,
              "annual": 4890
            }
          }
        }
      }
    }
  },
  "products": [
    {
      "id": "supermarket",
      "presetId": "supermarket",
      "publicName": "برنامج السوبرماركت والبقالة والمواد الغذائية",
      "band": "band1",
      "pos": true,
      "sellOffline": true,
      "sectorFeatures": [
        "فك وتشفير باركود الموازين الإلكترونية",
        "العروض المجمعة والباقات الترويجية",
        "تنبيهات نواقص الرف وإعادة الطلب",
        "شاشات العرض الرقمية لقوائم الأسعار"
      ]
    },
    {
      "id": "retail",
      "presetId": "retail",
      "publicName": "برنامج محلات التجزئة العامة",
      "band": "band1",
      "pos": true,
      "sellOffline": true,
      "sectorFeatures": [
        "العروض المجمعة والباقات الترويجية",
        "تنبيهات النواقص وحدود إعادة الطلب",
        "طباعة ملصقات الباركود",
        "تقارير أسرع وأبطأ الأصناف حركة"
      ]
    },
    {
      "id": "spices",
      "presetId": "spices",
      "publicName": "برنامج العطارة والمحامص والمطاحن والبهارات",
      "band": "band1",
      "pos": true,
      "sellOffline": true,
      "sectorFeatures": [
        "فك وتشفير باركود الموازين الإلكترونية",
        "التعبئة والتغليف وتحويل الوحدات",
        "الخلطات والتركيبات واحتساب تكلفتها",
        "العروض المجمعة"
      ]
    },
    {
      "id": "fashion",
      "presetId": "fashion",
      "publicName": "برنامج الملابس والأزياء والأحذية",
      "band": "band1",
      "pos": true,
      "sellOffline": true,
      "sectorFeatures": [
        "مصفوفة المقاسات والألوان لكل موديل",
        "توليد وطباعة باركود الموديلات والمتغيرات",
        "جرد الموديلات بالمقاس واللون",
        "مناديب التوصيل"
      ]
    },
    {
      "id": "perfumes",
      "presetId": "perfumes",
      "publicName": "برنامج العطور ومستحضرات التجميل والتركيبات",
      "band": "band1",
      "pos": true,
      "sellOffline": true,
      "sectorFeatures": [
        "التركيبات والخلطات وقوائم المواد",
        "مصفوفة الأحجام والعبوات",
        "العروض المجمعة والهدايا",
        "تتبع تكلفة الزيوت والخامات"
      ]
    },
    {
      "id": "pharmacy",
      "presetId": "pharmacy",
      "publicName": "برنامج الصيدليات والمستلزمات الطبية",
      "band": "band2",
      "pos": true,
      "sellOffline": true,
      "sectorFeatures": [
        "أرقام التشغيلات والباتشات",
        "تواريخ الصلاحية والصرف الأسبق صلاحية (FEFO)",
        "منع بيع المنتهي الصلاحية نهائياً",
        "البدائل الدوائية والمكونات الفعالة",
        "النواقص وطلبات الشراء التلقائية",
        "مناديب التوصيل"
      ]
    },
    {
      "id": "electronics",
      "presetId": "electronics",
      "publicName": "برنامج الموبايلات والإلكترونيات والصيانة",
      "band": "band2",
      "pos": true,
      "sellOffline": true,
      "sectorFeatures": [
        "تتبع أرقام السيريال والـIMEI",
        "كروت الفحص والاستلام والتسليم",
        "إدارة الضمان وقطع الغيار",
        "استبدال وتقييم الجهاز المستعمل",
        "فواتير الخدمات والمصنعيات وعمولات الفنيين",
        "البيع بالتقسيط وجدولة الأقساط"
      ]
    },
    {
      "id": "appliances_installments",
      "presetId": "appliances_installments",
      "publicName": "برنامج معارض الأجهزة والأثاث بالتقسيط",
      "band": "band2",
      "pos": true,
      "sellOffline": true,
      "sectorFeatures": [
        "جدولة الأقساط والمقدم واحتساب الفوائد",
        "غرامات التأخير وتنبيهات التحصيل الدورية",
        "سجل سداد الأقساط وكشوف العملاء",
        "التوصيل والتركيب وأسطول المناديب"
      ]
    },
    {
      "id": "restaurant",
      "presetId": "restaurant",
      "publicName": "برنامج المطاعم والكافيهات",
      "band": "band3",
      "pos": true,
      "sellOffline": true,
      "extraBranchNote": "شاشات المطبخ والطاولات تُستهلك لكل فرع، فالفرع الإضافي يُحاسب بسعره في addons",
      "sectorFeatures": [
        "شاشات المطبخ التفاعلية (KDS)",
        "إدارة الطاولات وصالة وتيك أواي",
        "الإضافات والمعدّلات (Modifiers) والكومبو",
        "الطلب الذاتي من الطاولة بالـQR",
        "مناديب التوصيل وتتبع الطلبات"
      ]
    },
    {
      "id": "wholesale",
      "presetId": "wholesale",
      "publicName": "برنامج الجملة والتوزيع",
      "band": "band4",
      "pos": true,
      "sellOffline": true,
      "sectorFeatures": [
        "قوائم أسعار العملاء وشرائح الكميات",
        "مناديب وأسطول التوزيع وخطوط السير",
        "مبيعات الفان الميدانية وتصفية العهد",
        "البيع الآجل والتحصيل وكشوف الحساب"
      ]
    },
    {
      "id": "manufacturing",
      "presetId": "manufacturing",
      "publicName": "برنامج المصانع والمعامل والورش",
      "band": "band4",
      "pos": true,
      "sellOffline": true,
      "sectorFeatures": [
        "شجرة المنتج وقوائم المواد (BOM)",
        "أوامر التشغيل وحساب تكلفة الإنتاج",
        "أوامر الفك (Unbuild) والمنتجات الثانوية",
        "التصنيع حسب الطلب (MTO)",
        "الاستهلاك الآلي للمواد الخام"
      ]
    },
    {
      "id": "import_export",
      "presetId": "import_export",
      "publicName": "برنامج الاستيراد والتصدير والتجارة الدولية",
      "band": "band4",
      "pos": true,
      "sellOffline": true,
      "sectorFeatures": [
        "تتبع الشحنات الدولية والحاويات",
        "توزيع مصاريف الشحن والجمارك على التكلفة",
        "حصص وأرباح الشركاء لكل حاوية",
        "اعتمادات الموردين ومتابعتها"
      ]
    },
    {
      "id": "services",
      "presetId": "services",
      "publicName": "برنامج الشركات الخدمية والمكاتب الاستشارية",
      "band": "band4",
      "pos": false,
      "sellOffline": true,
      "sectorFeatures": [
        "فواتير الخدمات والمصنعيات والعقود",
        "عمولات الفنيين وأجور العمل المباشر",
        "متابعة التحصيل والدفعات المرحلية",
        "مراكز التكلفة لكل مشروع خدمي"
      ]
    },
    {
      "id": "ecommerce",
      "presetId": "ecommerce",
      "publicName": "برنامج المتاجر الإلكترونية والبيع أونلاين",
      "band": "band4",
      "pos": true,
      "sellOffline": false,
      "sellOfflineReason": "المتجر وبوابات الدفع سحابية بطبيعتها فلا يُباع هذا المنتج أوفلاين إطلاقاً",
      "levelGroupsOverride": {
        "L1": [
          "core_pos",
          "online"
        ],
        "L2": [
          "core_pos",
          "online",
          "operations"
        ],
        "L3": [
          "core_pos",
          "online",
          "operations",
          "finance",
          "hr",
          "einvoice",
          "intelligence"
        ]
      },
      "sectorFeatures": [
        "كتالوج رقمي واستوديو ضبط صور الأصناف",
        "تتبع الطلب المباشر للعميل ومحادثة المندوب",
        "محرك بكسلات التتبع والتسويق",
        "لوحة مؤشرات أداء المتجر للتاجر"
      ]
    },
    {
      "id": "contracting",
      "presetId": "contracting",
      "publicName": "نظام المقاولات وإدارة المشاريع الإنشائية",
      "band": "band5",
      "pos": false,
      "sellOffline": true,
      "marketingForbiddenWords": [
        "ERP",
        "كاشير",
        "نقطة بيع",
        "متجر إلكتروني"
      ],
      "levelGroupsOverride": {
        "L1": [
          "contracting_core"
        ],
        "L2": [
          "contracting_core",
          "contracting_company",
          "finance",
          "einvoice"
        ],
        "L3": [
          "contracting_core",
          "contracting_company",
          "finance",
          "einvoice",
          "hr",
          "enterprise_extras"
        ]
      },
      "sectorFeatures": []
    },
    {
      "id": "maritime",
      "presetId": "maritime",
      "publicName": "نظام الشحن والتخليص والخدمات اللوجستية",
      "band": "band5",
      "pos": false,
      "sellOffline": true,
      "marketingForbiddenWords": [
        "ERP",
        "كاشير",
        "نقطة بيع",
        "متجر إلكتروني"
      ],
      "levelGroupsOverride": {
        "L1": [
          "maritime_core"
        ],
        "L2": [
          "maritime_core",
          "maritime_company",
          "finance",
          "einvoice"
        ],
        "L3": [
          "maritime_core",
          "maritime_company",
          "finance",
          "einvoice",
          "hr",
          "enterprise_extras"
        ]
      },
      "sectorFeatures": []
    },
    {
      "id": "warehousing",
      "presetId": "warehousing",
      "publicName": "برنامج إدارة المستودعات والتحويلات المخزنية",
      "band": "band3",
      "pos": false,
      "sellOffline": true,
      "marketingForbiddenWords": [
        "كاشير",
        "نقطة بيع",
        "شاشات مطبخ"
      ],
      "levelGroupsOverride": {
        "L1": [
          "warehousing_core"
        ],
        "L2": [
          "warehousing_core",
          "operations"
        ],
        "L3": [
          "warehousing_core",
          "operations",
          "finance",
          "hr",
          "einvoice",
          "intelligence"
        ]
      },
      "sectorFeatures": [
        "إدارة المخازن المتعددة والمواقع والأرفف والمسارات",
        "التحويلات المخزنية بين الفروع مع دورة الاستلام والتدقيق",
        "أذون الصرف المخزني والإضافة ومحاضر الفحص والاستلام",
        "الجرد المخزني بالباركود وتتبع الفروقات والتسويات الآلية",
        "تتبع تواريخ الصلاحية وأرقام التشغيلات (Batches & Lots)"
      ]
    }
  ],
  "floors": {
    "items": [
      {
        "id": "einvoice_eg",
        "name": "الفاتورة الإلكترونية المصرية والإقرار الضريبي",
        "featureGroup": "einvoice",
        "includedFromLevel": "L3",
        "prices": {
          "EG": 450,
          "SA": null
        }
      },
      {
        "id": "einvoice_zatca",
        "name": "الفاتورة الإلكترونية السعودية ZATCA",
        "featureGroup": "einvoice_zatca",
        "includedFromLevel": "L3",
        "prices": {
          "SA": 120
        }
      },
      {
        "id": "online",
        "name": "المتجر الإلكتروني وبوابات الدفع",
        "featureGroup": "online",
        "includedFromLevel": null,
        "salesLineOnly": true,
        "prices": {
          "EG": 950,
          "SA": 249
        }
      },
      {
        "id": "marketplaces",
        "name": "الربط مع أمازون ونون",
        "includedFromLevel": null,
        "salesLineOnly": true,
        "prices": {
          "EG": 650,
          "SA": 179
        }
      },
      {
        "id": "whatsapp_ai",
        "name": "بوت واتساب بالذكاء الاصطناعي",
        "includedFromLevel": null,
        "prices": {
          "EG": 400,
          "SA": 109
        }
      },
      {
        "id": "intelligence",
        "name": "الذكاء والحماية",
        "featureGroup": "intelligence",
        "includedFromLevel": "L3",
        "prices": {
          "EG": 500,
          "SA": 139
        }
      },
      {
        "id": "couriers",
        "name": "ربط شركات الشحن (بوسطة · أرامكس · SMSA)",
        "includedFromLevel": null,
        "salesLineOnly": true,
        "prices": {
          "EG": 300,
          "SA": 89
        }
      },
      {
        "id": "hr",
        "name": "الموارد البشرية والرواتب والبصمة وبوابة الموظف",
        "featureGroup": "hr",
        "includedFromLevel": "L3",
        "prices": {
          "EG": 700,
          "SA": 199
        }
      },
      {
        "id": "priority_support",
        "name": "دعم بأولوية (استجابة 4 ساعات وواتساب مباشر)",
        "includedFromLevel": "L3",
        "pricingRule": "15% من قيمة الاشتراك",
        "minPrices": {
          "EG": 400,
          "SA": 109
        }
      },
      {
        "id": "cloud_backup_offline",
        "name": "نسخ احتياطي سحابي ونقل المنشأة (لعميل الأوفلاين)",
        "includedFromLevel": null,
        "offlineOnly": true,
        "prices": {
          "EG": 200,
          "SA": 55
        },
        "annualPrices": {
          "EG": 2000,
          "SA": 550
        }
      },
      {
        "id": "storefront_for_offline",
        "name": "اشتراك المتجر الإلكتروني لعميل الترخيص الدائم",
        "includedFromLevel": null,
        "offlineOnly": true,
        "prices": {
          "EG": 1900,
          "SA": 499
        }
      }
    ]
  },
  "addons": {
    "extraUser": {
      "monthly": {
        "band1": {
          "EG": 120,
          "SA": 35
        },
        "band2": {
          "EG": 150,
          "SA": 45
        },
        "band3": {
          "EG": 180,
          "SA": 49
        },
        "band4": {
          "EG": 200,
          "SA": 55
        },
        "band5": {
          "EG": 350,
          "SA": 99
        }
      },
      "perpetual": {
        "band1": {
          "EG": 1200
        },
        "band2": {
          "EG": 1600
        },
        "band3": {
          "EG": 2200
        },
        "band4": {
          "EG": 2800
        },
        "band5": {
          "EG": 3500
        }
      }
    },
    "extraBranch": {
      "monthly": {
        "band1": {
          "EG": 225,
          "SA": 75
        },
        "band2": {
          "EG": 325,
          "SA": 100
        },
        "band3": {
          "EG": 700,
          "SA": 175
        },
        "band4": {
          "EG": 750,
          "SA": 200
        },
        "band5": {
          "EG": 1200,
          "SA": 329
        }
      },
      "perpetualRule": "40% من قيمة الترخيص"
    },
    "extraPosTerminal": {
      "perpetual": {
        "band1": {
          "EG": 2500
        },
        "band2": {
          "EG": 2500
        },
        "band3": {
          "EG": 3000
        },
        "band4": {
          "EG": 3000
        }
      }
    },
    "setupAndMigration": {
      "EG": {
        "band1": {
          "L1": 1500,
          "L2": 4000,
          "L3": 10000
        },
        "band2": {
          "L1": 2500,
          "L2": 6000,
          "L3": 15000
        },
        "band3": {
          "L1": 4000,
          "L2": 9000,
          "L3": 20000
        },
        "band4": {
          "L1": 6000,
          "L2": 14000,
          "L3": 28000
        },
        "band5": {
          "L1": 30000,
          "L2": 60000,
          "L3": 100000
        }
      }
    }
  },
  "offline": {
    "supportRateFromYearTwo": 0.18,
    "firstYearSupportIncluded": true,
    "supportRateMarketReference": "DEXEF 15% · SalesUp 20%",
    "perpetualMultiplierFromAnnual": 2.5,
    "perpetualMultiplierAppliesTo": [
      "SA",
      "AE",
      "QA",
      "KW",
      "BH",
      "OM"
    ],
    "installmentPlan": {
      "downPaymentRate": 0.4,
      "months": 6
    },
    "notSoldOffline": [
      "online",
      "marketplaces",
      "whatsapp_ai",
      "couriers"
    ],
    "notSoldOfflineProducts": [
      "ecommerce"
    ],
    "notSoldOfflineReason": "سحابية بطبيعتها — تُعرض على عميل الأوفلاين كاشتراك منفصل عبر floors.storefront_for_offline"
  },
  "countries": {
    "EG": {
      "name": "مصر",
      "currency": "EGP",
      "status": "ready",
      "vatRate": 0.14,
      "localization": "كاملة — ETA ونموذج 10 ونموذج 41 وبوابات محلية وبوسطة"
    },
    "SA": {
      "name": "السعودية",
      "currency": "SAR",
      "status": "ready",
      "vatRate": 0.15,
      "localization": "كاملة — ZATCA المرحلة الثانية وTap وأرامكس وSMSA والفلس ثلاثي الخانات والتقويم الهجري"
    },
    "AE": {
      "name": "الإمارات",
      "currency": "AED",
      "status": "partial",
      "vatRate": 0.05,
      "localization": "تعدد العملات والفلس والهجري موجودة — الفاتورة الإلكترونية الإماراتية وضريبة الشركات غير مبنية",
      "requiresWrittenDisclosure": true
    },
    "QA": {
      "name": "قطر",
      "currency": "QAR",
      "status": "partial",
      "vatRate": 0,
      "requiresWrittenDisclosure": true
    },
    "KW": {
      "name": "الكويت",
      "currency": "KWD",
      "status": "partial",
      "vatRate": 0,
      "requiresWrittenDisclosure": true
    },
    "BH": {
      "name": "البحرين",
      "currency": "BHD",
      "status": "partial",
      "vatRate": 0.1,
      "requiresWrittenDisclosure": true
    },
    "OM": {
      "name": "عمان",
      "currency": "OMR",
      "status": "partial",
      "vatRate": 0.05,
      "requiresWrittenDisclosure": true
    },
    "JO": {
      "name": "الأردن",
      "status": "blocked",
      "reason": "لا توطين ضريبي"
    },
    "LB": {
      "name": "لبنان",
      "status": "blocked",
      "reason": "لا توطين ضريبي"
    },
    "PS": {
      "name": "فلسطين",
      "status": "blocked",
      "reason": "لا توطين ضريبي"
    },
    "MA": {
      "name": "المغرب",
      "status": "blocked",
      "reason": "لا توطين ضريبي"
    },
    "TN": {
      "name": "تونس",
      "status": "blocked",
      "reason": "لا توطين ضريبي"
    },
    "DZ": {
      "name": "الجزائر",
      "status": "blocked",
      "reason": "لا توطين ضريبي"
    },
    "LY": {
      "name": "ليبيا",
      "status": "blocked",
      "reason": "لا توطين + صعوبة تحصيل"
    },
    "SD": {
      "name": "السودان",
      "status": "blocked",
      "reason": "لا توطين + صعوبة تحصيل"
    },
    "YE": {
      "name": "اليمن",
      "status": "blocked",
      "reason": "لا توطين + صعوبة تحصيل"
    },
    "SY": {
      "name": "سوريا",
      "status": "blocked",
      "reason": "لا توطين + صعوبة تحصيل"
    },
    "IQ": {
      "name": "العراق",
      "status": "blocked",
      "reason": "لا توطين + صعوبة تحصيل"
    }
  },
  "blockedCountryPolicy": {
    "cloudSubscription": "ممنوع",
    "perpetualException": "يُقبل ترخيص دائم بالدولار مقدماً 100% بعقد يستثني صراحةً أي التزام ضريبي محلي",
    "perpetualPriceRule": "سعر مصر الدائم محوَّلاً للدولار × 1.4"
  },
  "internalOnly": {
    "publicFields": [
      "products[].publicName",
      "products[].sectorFeatures",
      "featureGroups",
      "bands[].levels[].publicName",
      "bands[].levels[].limits",
      "bands[].levels[].prices[countryOfVisitor]",
      "floors",
      "addons",
      "offline.supportRateFromYearTwo",
      "offline.installmentPlan",
      "trialDays"
    ],
    "internalFields": [
      "bands[].internalName",
      "products[].band",
      "products[].presetId",
      "bands[].levelGroups",
      "products[].levelGroupsOverride",
      "geoMultiplier",
      "negotiationFloor",
      "competitorBenchmarks",
      "countries[].status",
      "countries[].localization",
      "blockedCountryPolicy",
      "offline.perpetualMultiplierFromAnnual",
      "offline.supportRateMarketReference"
    ],
    "publishRules": [
      "صفحة الموقع تعرض منتجاً واحداً بمستوياته الثلاثة في عملة الزائر فقط",
      "ممنوع نشر جدول يجمع قطاعين أو بلدين في مكان واحد",
      "ممنوع نشر جدول النطاقات نفسه أو منطق تجميع القطاعات فيها",
      "المقاولات والشحن تُعرض بالسعر السنوي فقط (band5.quoteAnnuallyOnly)",
      "ممنوع كلمات products[].marketingForbiddenWords في مواد المنتج"
    ],
    "geoMultiplier": {
      "base": "SA",
      "SA": 1,
      "AE": 1.08,
      "QA": 1.08,
      "KW": 1.1,
      "BH": 1,
      "OM": 1,
      "EG": 0.22
    },
    "negotiationFloor": {
      "subscription": {
        "band1": 0.75,
        "band2": 0.75,
        "band3": 0.75,
        "band4": 0.75,
        "band5": 0.85
      },
      "perpetual": {
        "default": 0.8,
        "band5": 0.85
      },
      "preferredConcessionsInsteadOfDiscount": [
        "طابق مفرد مجاناً لسنة",
        "مستخدمون إضافيون",
        "شهران إضافيان"
      ],
      "referenceCustomer": {
        "discount": 0.5,
        "maxCount": 10,
        "perSector": true,
        "durationMonths": 12,
        "requiresContract": true
      }
    },
    "competitorBenchmarks": {
      "asOf": "2026-09-25",
      "note": "أعد فتح كل رابط في كل مراجعة دورية — المنافسون يرفعون أسعارهم",
      "EG": [
        {
          "name": "دفترة الأساسية",
          "monthly": 489.5,
          "annual": 5874,
          "currency": "EGP",
          "limits": "مستخدم واحد · 100 فاتورة/شهر · مخزن واحد",
          "url": "https://www.daftra.com/plans"
        },
        {
          "name": "دفترة المتقدمة",
          "monthly": 977.58,
          "annual": 11731,
          "currency": "EGP",
          "limits": "مستخدم واحد · 500 فاتورة/شهر · 3 مخازن",
          "url": "https://www.daftra.com/plans"
        },
        {
          "name": "دفترة الشاملة",
          "monthly": 1960,
          "annual": 23520,
          "currency": "EGP",
          "limits": "مستخدم واحد · غير محدود · 5 مخازن",
          "url": "https://www.daftra.com/plans"
        },
        {
          "name": "دفترة — مستخدم إضافي",
          "monthly": 294,
          "currency": "EGP",
          "url": "https://www.daftra.com/plans"
        },
        {
          "name": "دفترة — فرع إضافي",
          "monthly": 980,
          "currency": "EGP",
          "url": "https://www.daftra.com/plans"
        },
        {
          "name": "Foodics مصر الأساسية",
          "monthly": 2848.95,
          "currency": "EGP",
          "limits": "مطاعم فقط · بلا محاسبة عامة ولا رواتب",
          "url": "https://www.foodics.com/foodics-pricing-egypt/"
        },
        {
          "name": "Foodics مصر المتقدمة",
          "monthly": 3733.67,
          "currency": "EGP",
          "url": "https://www.foodics.com/foodics-pricing-egypt/"
        },
        {
          "name": "DEXEF POS / GREEN / BLUE / RED",
          "perpetual": [
            4000,
            7000,
            9000,
            15000
          ],
          "currency": "EGP",
          "support": "15% سنوياً",
          "url": "https://dexef.com/dexef-softwares-prices-compare-eg/"
        },
        {
          "name": "SalesUp مدى الحياة",
          "perpetualUSD": [
            199,
            299,
            499
          ],
          "support": "مضمّن",
          "url": "https://www.vatoce.com/salesup_prices_ar/"
        },
        {
          "name": "SalesUp للشركات",
          "perpetualUSD": [
            1999,
            3499
          ],
          "limits": "5 و10 أجهزة",
          "url": "https://www.vatoce.com/salesup_prices_ar/"
        },
        {
          "name": "برامج الصيدليات المصرية",
          "monthlyRange": [
            500,
            1500
          ],
          "currency": "EGP",
          "setupFrom": 7000,
          "url": "https://firstmarkets.com/%D8%A3%D8%B3%D8%B9%D8%A7%D8%B1-%D8%A8%D8%B1%D8%A7%D9%85%D8%AC-%D8%A5%D8%AF%D8%A7%D8%B1%D8%A9-%D8%A7%D9%84%D8%B5%D9%8A%D8%AF%D9%84%D9%8A%D8%A7%D8%AA/"
        }
      ],
      "SA": [
        {
          "name": "قيود Pro",
          "annual": 2070,
          "monthly": 207,
          "currency": "SAR",
          "limits": "3 مستخدمين · 3 مواقع · محاسبة فقط",
          "url": "https://www.qoyod.com/en/knowledge-base/qoyod-plans-and-pricing-subscription-tiers-features-add-ons/"
        },
        {
          "name": "قيود المتقدمة",
          "annual": 3795,
          "monthly": 379.5,
          "currency": "SAR",
          "limits": "5 مستخدمين · 5 مواقع",
          "url": "https://www.qoyod.com/en/knowledge-base/qoyod-plans-and-pricing-subscription-tiers-features-add-ons/"
        },
        {
          "name": "قيود — نقطة البيع",
          "annualPerUser": 600,
          "currency": "SAR",
          "note": "نقطة البيع والرواتب ليستا في الباقة"
        },
        {
          "name": "رواء",
          "monthly": 275,
          "currency": "SAR",
          "limits": "بلا موارد بشرية · سقف عدد أصناف",
          "url": "https://www.softwares.com/software/rewaa"
        },
        {
          "name": "Foodics السعودية",
          "monthlyRange": [
            199,
            423
          ],
          "currency": "SAR",
          "url": "https://www.foodics.com/pricing/"
        }
      ],
      "band5": [
        {
          "name": "Buildo الأساسية",
          "annualUSD": 1000,
          "limits": "5 مستخدمين",
          "url": "https://buildo.solutions/pricing/"
        },
        {
          "name": "Buildo القياسية",
          "annualUSD": 2500,
          "limits": "10 مستخدمين",
          "url": "https://buildo.solutions/pricing/"
        },
        {
          "name": "Buildo المؤسسية",
          "monthlyFromUSD": 1000,
          "url": "https://buildo.solutions/pricing/"
        },
        {
          "name": "برمجيات الشحن والتخليص عالمياً",
          "rangeUSD": [
            5000,
            50000
          ],
          "url": "https://sourceforge.net/software/freight-forwarding/middle-east/"
        }
      ],
      "reference": [
        {
          "name": "Odoo في مصر",
          "fromEURPerUserMonthly": 12,
          "url": "https://systemscodes.com/odoo-price-egypt/"
        },
        {
          "name": "سعر صرف الدولار/الجنيه",
          "url": "https://www.investing.com/currencies/usd-egp-historical-data"
        }
      ]
    },
    "positionVsCompetitor": {
      "rows": [
        {
          "case": "مصر band1/L2 (10 مستخدمين · فرعان)",
          "ours": 1900,
          "competitor": 4015,
          "competitorName": "دفترة المتقدمة + 7 مستخدمين + فرع",
          "ratio": 0.47
        },
        {
          "case": "مصر مطاعم فرع واحد",
          "ours": 1400,
          "competitor": 2849,
          "competitorName": "Foodics مصر الأساسية",
          "ratio": 0.49
        },
        {
          "case": "مصر مقاولات band5/L2 سنوي",
          "ours": 95000,
          "competitor": 129800,
          "competitorName": "Buildo القياسية",
          "ratio": 0.73
        },
        {
          "case": "السعودية band4/L2 سنوي (12 مستخدماً)",
          "ours": 8990,
          "competitor": 12675,
          "competitorName": "قيود المتقدمة + مستخدمين + نقطة بيع",
          "ratio": 0.71
        },
        {
          "case": "السعودية band1/L1 سنوي",
          "ours": 1490,
          "competitor": 3300,
          "competitorName": "رواء",
          "ratio": 0.45
        },
        {
          "case": "مصر ترخيص دائم band1/L1",
          "ours": 10000,
          "competitor": 9000,
          "competitorName": "DEXEF BLUE",
          "ratio": 1.11
        }
      ]
    }
  }
};
