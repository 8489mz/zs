/**
 * MarketplaceSyncOnboardingService — slice S12 of the marketplace-sync split.
 * Pure move of 2 methods from MarketplaceSyncService (seller onboarding
 * check + profile save). No behavior change: the bodies are byte-identical;
 * the facade keeps thin delegates with the same names and signatures.
 * Deps: db only (the check reads tenants + settings rows; the save runs a
 * raw upsert against the facade's db). NO kernel deps — neither method
 * calls a setting helper (prep section 3 says so, ground-proven). NO audit
 * dep, NO logger (the span logs nothing; prep section 4 holds for this
 * slice). Types come from ./marketplace-sync.types (S0). Clock: two
 * display dates in the check (letter dates); no instant comparison, no UTC
 * normalizer. The save-to-check call is in-slice, so there is no
 * cross-slice dep.
 */
import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import type { MarketplaceOnboardingCheck } from './marketplace-sync.types';

export interface MarketplaceSyncOnboardingDeps {
  db: Kysely<Database>;
}

@Injectable()
export class MarketplaceSyncOnboardingService {
  private readonly db: Kysely<Database>;

  constructor(deps: MarketplaceSyncOnboardingDeps) {
    this.db = deps.db;
  }

  // =========================================================================
  // SELLER ONBOARDING & VERIFICATION ENGINE ("معالج فتح وتفعيل الحسابات")
  // =========================================================================

  async getSellerOnboardingCheck(auth: AuthContext): Promise<MarketplaceOnboardingCheck> {
    const scope = requireTenantScope(auth);
    const tenant = await this.db.selectFrom('tenants').selectAll().where('id', '=', scope.tenantId).executeTakeFirst();

    const settingRows = await this.db
      .selectFrom('settings')
      .select(['key', 'value'])
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .execute();

    const settingsMap = new Map<string, string>();
    for (const r of settingRows) {
      try {
        const parsed = JSON.parse(r.value);
        settingsMap.set(r.key, typeof parsed === 'string' ? parsed : String(parsed));
      } catch {
        settingsMap.set(r.key, r.value);
      }
    }

    const legalEntityType = (settingsMap.get('legalEntityType') || 'business') as 'business' | 'individual';
    const isBusiness = legalEntityType === 'business';
    const ownerNationalId = (settingsMap.get('ownerNationalId') || '').trim();
    const hasCreditCard = settingsMap.get('hasCreditCard') === 'true';

    const companyLegalName = (settingsMap.get('companyName') || tenant?.business_name || '').trim();
    const tradeName = (settingsMap.get('storeName') || tenant?.business_name || companyLegalName).trim();
    const ownerName = (settingsMap.get('ownerName') || tenant?.owner_name || '').trim();
    const commercialRegister = (settingsMap.get('commercialRegister') || '').trim();
    const taxNumber = (settingsMap.get('taxNumber') || '').trim();
    const vatRegistered = settingsMap.get('vatRegistered') === 'true' || Boolean(taxNumber);
    const bankName = (settingsMap.get('bankName') || '').trim();
    const bankAccountName = (settingsMap.get('bankAccountName') || companyLegalName).trim();
    const bankIban = (settingsMap.get('bankIban') || '').trim();
    const bankSwift = (settingsMap.get('bankSwift') || '').trim();
    const businessAddress = (settingsMap.get('businessAddress') || settingsMap.get('address') || '').trim();
    const phone = (settingsMap.get('phone') || tenant?.owner_phone || '').trim();
    const email = (settingsMap.get('email') || tenant?.owner_email || '').trim();

    // 1. Name Match Evaluation
    let nameMatchStatus: 'perfect_match' | 'name_mismatch' | 'missing_info' = 'missing_info';
    let nameMatchDetails = 'يرجى استكمال اسم الشركة القانوني واسم الحساب البنكي لفحص التطابق.';

    if (companyLegalName && bankAccountName) {
      const cleanCompany = companyLegalName.toLowerCase().replace(/[\s\-_.,]/g, '');
      const cleanBank = bankAccountName.toLowerCase().replace(/[\s\-_.,]/g, '');

      if (cleanCompany === cleanBank || cleanCompany.includes(cleanBank) || cleanBank.includes(cleanCompany)) {
        nameMatchStatus = 'perfect_match';
        nameMatchDetails =
          'اسم الشركة مطابق تماماً لاسم صاحب الحساب البنكي. نسبة قبول الحساب من روبوتات أمازون ونون تفوق 98%.';
      } else {
        nameMatchStatus = 'name_mismatch';
        nameMatchDetails = `تحذير عالي الأهمية: اسم الشركة بالسجل (${companyLegalName}) يختلف عن اسم الحساب البنكي (${bankAccountName}). روبوتات أمازون ونون ترفض 95% من الحسابات آلياً فور رصد هذا الاختلاف! يرجى توحيد الاسمين.`;
      }
    }

    // 2. Checklist Evaluation
    const checklist: MarketplaceOnboardingCheck['checklist'] = [
      {
        key: 'commercial_register',
        label: 'السجل التجاري الساري (Commercial Register)',
        required: isBusiness,
        status: !isBusiness ? 'ready' : commercialRegister.length >= 4 ? 'ready' : 'missing',
        notes: !isBusiness
          ? 'غير إلزامي للبائع الفردي (مطلوب فقط لحسابات الشركات ومؤسسات الأعمال)'
          : commercialRegister.length >= 4
            ? `مسجل برقم ${commercialRegister}`
            : 'إلزامي للشركات في أمازون مصر ونون! مطلوب نسخة سارية ممسوحة ضوئياً بدقة (Scan) دون اقتطاع الحواف.',
      },
      {
        key: 'tax_card',
        label: 'البطاقة الضريبية وشهادة القيمة المضافة (Tax Card & VAT)',
        required: isBusiness,
        status: !isBusiness ? 'ready' : taxNumber.length >= 6 ? 'ready' : 'missing',
        notes: !isBusiness
          ? 'غير إلزامية للبائع الفردي'
          : taxNumber.length >= 6
            ? `مسجلة برقم ${taxNumber}`
            : 'إلزامية للشركات في أمازون مصر ونون! وبدونها يتم تعليق الحساب تحت بند نقص البيانات الضريبية.',
      },
      {
        key: 'bank_iban',
        label: 'الحساب البنكي الرسمي ورقم الآيبان (Bank Account & IBAN)',
        required: true,
        status: bankIban.length >= 15 ? 'ready' : bankName ? 'warning' : 'missing',
        notes:
          bankIban.length >= 15
            ? `الحساب والآيبان مسجل لدى ${bankName || 'البنك'}`
            : 'إلزامي 100% في أمازون ونون! يجب إدخال الآيبان (IBAN) وكود السويفت (SWIFT) وكشف حساب بنكي رسمي حديث.',
      },
      {
        key: 'national_id',
        label: 'هوية المالك / المفوض بالتوقيع (National ID / Passport)',
        required: true,
        status:
          ownerName.length >= 3 && ownerNationalId.length >= 10
            ? 'ready'
            : ownerName.length >= 3
              ? 'warning'
              : 'missing',
        notes:
          ownerName.length >= 3 && ownerNationalId.length >= 10
            ? `مسجل باسم: ${ownerName} (رقم قومي: ${ownerNationalId})`
            : 'إلزامي 100% في أمازون ونون! بطاقة رقم قومي سارية الوجهين أو جواز سفر ساري للممثل القانوني.',
      },
      {
        key: 'business_address',
        label: 'العنوان الوطني وإثبات مقر العمل (Proof of Address)',
        required: true,
        status: businessAddress.length >= 6 ? 'ready' : 'missing',
        notes:
          businessAddress.length >= 6
            ? businessAddress
            : 'إلزامي 100% في أمازون ونون! يجب تطابق العنوان بالحرف مع فاتورة المرافق أو كشف الحساب البنكي.',
      },
      {
        key: 'charge_method_card',
        label: 'بطاقة الدفع والخصم الدولي (Credit / Debit Card)',
        required: true,
        status: hasCreditCard ? 'ready' : 'warning',
        notes: hasCreditCard
          ? 'تم تأكيد جاهزية بطاقة ائتمان صالحة للخصم الدولي'
          : 'إلزامي في أمازون! يجب توفر بطاقة Visa أو Mastercard تدعم السحب الدولي لربطها كطريقة دفع (Charge Method).',
      },
      {
        key: 'letter_of_auth',
        label: 'خطاب التفويض الإداري والبنكي المعتمد (Letter of Authorization - LOA)',
        required: isBusiness,
        status: !isBusiness ? 'ready' : companyLegalName && ownerName ? 'ready' : 'warning',
        notes: !isBusiness
          ? 'غير مطلوب للبائع الفردي'
          : companyLegalName && ownerName
            ? 'الخطاب تم توليده تلقائياً وجاهز للطباعة والختم'
            : 'مطلوب في أمازون ونون إذا كان المفوض بإدارة الحساب شخصاً ينوب عن مجلس الإدارة أو الشركة.',
      },
    ];

    const readyCount = checklist.filter((c) => c.status === 'ready').length;
    let overallReadinessScore = Math.round((readyCount / checklist.length) * 100);
    if (nameMatchStatus === 'name_mismatch') {
      overallReadinessScore = Math.min(overallReadinessScore, 70);
    }

    const todayDate = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
    const todayDateEn = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    // Official Letter of Authorization
    const letterOfAuthorizationAr = `
بسم الله الرحمن الرحيم
تاريخ: ${todayDate}

خطاب تفويض رسمي لإدارة وتفعيل حساب التاجر (Letter of Authorization)

إلى: إدارة عمليات البائعين والتحقق (Seller Onboarding & Verification Team)
من: إدارة شركة / منشأة: ${companyLegalName || '[اسم الشركة]'}
رقم السجل التجاري: ${commercialRegister || '[رقم السجل التجاري]'}
رقم التسجيل الضريبي: ${taxNumber || '[رقم البطاقة الضريبية]'}
العنوان القانوني: ${businessAddress || '[العنوان]'}

تحية طيبة وبعد،،،

نفيدكم نحن شركة/منشأة (${companyLegalName || 'الشركة'})، بصفتنا الكيان التجاري القانوني المالك، بأننا قد قمنا بتفويض السيد/السيدة:
الاسم: ${ownerName || '[اسم المفوض]'}
الهاتف: ${phone || '[رقم الهاتف]'}
البريد الإلكتروني: ${email || '[البريد الإلكتروني]'}

وذلك للقيام بكافة الإجراءات اللازمة لإنشاء، وإدارة، وتشغيل حساب البائع الخاص بنا، وقبول الشروط والاتفاقيات، وربط وتأكيد الحساب البنكي رقم الـ IBAN (${bankIban || '[رقم الآيبان]'}) لدى (${bankName || '[اسم البنك]'}), واستلام وتوجيه مستحقات المبيعات نيابة عن المنشأة.

هذا التفويض سارٍ ومعتمد ومسجل لدينا تحت كامل المسؤولية القانونية والتجارية.

المفوض بالتوقيع: ${ownerName || 'الممثل القانوني'}
التوقيع: .......................................
خاتم المنشأة الرسمي:
`;

    const letterOfAuthorizationEn = `
OFFICIAL LETTER OF AUTHORIZATION (LOA)

Date: ${todayDateEn}

To: Seller Onboarding & Compliance Verification Team
From: ${companyLegalName || '[Company Legal Name]'}
Commercial Registration No (CR): ${commercialRegister || '[CR Number]'}
Tax Identification No (TIN): ${taxNumber || '[Tax Number]'}
Registered Business Address: ${businessAddress || '[Registered Address]'}

Subject: Letter of Authorization for Seller Account Management & Operations

Dear Verification Team,

We, the undersigned, legal representatives of (${companyLegalName || '[Company Name]'}), hereby certify and declare that:

Mr. / Ms.: ${ownerName || '[Authorized Person Name]'}
Contact Phone: ${phone || '[Phone]'}
Email: ${email || '[Email]'}

is fully authorized to create, configure, verify, and operate our official Seller Account on your marketplace platform. This authorization includes, but is not limited to: accepting Seller Agreements, listing product catalogs, fulfilling inbound shipments, and designating Bank Account / IBAN (${bankIban || '[IBAN Number]'}) at (${bankName || '[Bank Name]'}) for settlement disbursements on behalf of the company.

This authorization is valid, irrevocable until formally revoked in writing, and executed under our full legal and corporate responsibility.

Authorized Signatory: ${ownerName || '[Signatory Name]'}
Signature: _______________________________
Official Company Stamp / Seal:
`;

    // Detailed Platform Specific Guides
    const platformGuides: MarketplaceOnboardingCheck['platformGuides'] = [
      {
        marketplace: 'amazon',
        nameAr: 'أمازون مصر (Amazon.eg Seller Central)',
        portalUrl: 'https://sellercentral.amazon.eg',
        steps: [
          {
            stepNumber: 1,
            title: 'اختيار نوع الكيان القانوني (Business Entity)',
            instruction:
              'ادخل على sellercentral.amazon.eg واختر "شركة مملوكة للقطاع الخاص" إذا كان لديك سجل تجاري، أو "فرد" في حال عدم وجود سجل.',
            tip: 'تأكد أن الاسم المكتوب يطابق حرفياً الاسم الموجود في السجل التجاري والبطاقة الضريبية.',
          },
          {
            stepNumber: 2,
            title: 'إدخال بيانات الحساب البنكي للتحويلات (Deposit Method)',
            instruction: `أدخل كود السويفت الخاص ببنكك ورقم الآيبان (IBAN): ${bankIban || 'المسجل بالنظام'}.`,
            tip: 'يجب أن يكون كشف الحساب البنكي صادراً خلال الـ 90 يوماً الأخيرة ومطبوعاً عليه اسم الشركة وشعار البنك.',
          },
          {
            stepNumber: 3,
            title: 'رفع وثائق إثبات الهوية والتفويض (Identity & LOA)',
            instruction:
              'ارفع صورة البطاقة الشخصية للمفوض، ثم ارفع صورة السجل التجاري، وخطاب التفويض المطبوع والمختوم (LOA).',
            tip: 'تجنب التصوير الليلي أو الفلاش؛ استخدم ماسحاً ضوئياً (Scanner) واضحاً بدقة 300 DPI.',
          },
          {
            stepNumber: 4,
            title: 'جلسة التحقق المرئي (Video Verification Call)',
            instruction:
              'سيطلب فريق أمازون مكالمة فيديو مدتها 5 دقائق للتحقق من هوية المفوض وأصل بطاقة الرقم القومي وأصل السجل التجاري.',
            tip: 'احرص على تواجد أصول الوثائق الورقية الأصلية معك أثناء المكالمة.',
          },
        ],
      },
      {
        marketplace: 'noon',
        nameAr: 'نون مصر (Noon Partners / Seller Lab)',
        portalUrl: 'https://login.noon.partners',
        steps: [
          {
            stepNumber: 1,
            title: 'التسجيل في بوابة شركاء نون (Noon Partners)',
            instruction: 'ادخل على login.noon.partners وأدخل بريدك الإلكتروني التجاري ورقم الهاتف للتحقق برمز OTP.',
          },
          {
            stepNumber: 2,
            title: 'رفع الأوراق القانونية (Legal Documents Submission)',
            instruction:
              'ارفع ملف PDF يضم: السجل التجاري الساري، البطاقة الضريبية، وشهادة التسجيل بضريبة القيمة المضافة.',
            tip: 'نون تشترط وجود شهادة القيمة المضافة إذا تجاوزت مبيعاتك السنوية حد التسجيل أو للشركات التجارية.',
          },
          {
            stepNumber: 3,
            title: 'تأكيد الحساب البنكي وعقد التاجر (Bank Proof & Agreement)',
            instruction: 'ارفع كشف حساب بنكي أو خطاب مصادقة بنكية يوضح رقم الآيبان والـ SWIFT واسم الشركة.',
            tip: 'اسم الحساب البنكي يجب أن يطابق 100% اسم الشركة بالسجل التجاري لتفادي الرفض الفوري.',
          },
          {
            stepNumber: 4,
            title: 'اختيار نموذج التشغيل اللوجستي',
            instruction: 'اختر التخزين والشحن عبر نون (FBN) أو الشحن المباشر من مخزنك (Noon Direct).',
          },
        ],
      },
      {
        marketplace: 'jumia',
        nameAr: 'جوميا مصر (Jumia Seller Center)',
        portalUrl: 'https://sellercenter.jumia.com.eg',
        steps: [
          {
            stepNumber: 1,
            title: 'إنشاء متجر جديد في جوميا',
            instruction: 'سجل بريدك واختر اسم المتجر التجاري المفضل لديك ليكون واجهتك أمام المشترين.',
          },
          {
            stepNumber: 2,
            title: 'اجتياز تدريب البائعين (Seller Training Quiz)',
            instruction: 'مشاهدة فيديو تدريبي قصير مدته 10 دقائق واجتياز اختبار معايير الشحن والتغليف.',
          },
          {
            stepNumber: 3,
            title: 'إدخال البيانات المالية واستلام الطلبات التجريبية',
            instruction: 'إدخال رقم الحساب البنكي والـ IBAN لربطه بنظام الدفع الأسبوعي لجوميا.',
          },
        ],
      },
      {
        marketplace: 'trendyol',
        nameAr: 'ترينديول (Trendyol Partner Portal)',
        portalUrl: 'https://partner.trendyol.com',
        steps: [
          {
            stepNumber: 1,
            title: 'طلب الانضمام كمورد إقليمي',
            instruction: 'تسجيل بيانات الشركة، النشاط التجاري، ورقم المورد (Supplier ID).',
          },
          {
            stepNumber: 2,
            title: 'تفعيل مفاتيح الربط البرمجي (API Integration)',
            instruction: 'استخراج API Key و API Secret وربطها بنظام Z-Systems ERP لمزامنة المخزون.',
          },
        ],
      },
    ];

    return {
      companyLegalName,
      tradeName,
      ownerName,
      ownerNationalId,
      legalEntityType,
      hasCreditCard,
      commercialRegister,
      taxNumber,
      vatRegistered,
      bankName,
      bankAccountName,
      bankIban,
      bankSwift,
      businessAddress,
      phone,
      email,
      overallReadinessScore,
      nameMatchStatus,
      nameMatchDetails,
      checklist,
      platformGuides,
      letterOfAuthorizationAr,
      letterOfAuthorizationEn,
    };
  }

  async saveOnboardingProfile(
    data: Partial<MarketplaceOnboardingCheck>,
    auth: AuthContext,
  ): Promise<MarketplaceOnboardingCheck> {
    const scope = requireTenantScope(auth);

    const keysToUpdate: Record<string, string> = {};
    if (data.legalEntityType !== undefined) keysToUpdate.legalEntityType = data.legalEntityType;
    if (data.ownerNationalId !== undefined) keysToUpdate.ownerNationalId = data.ownerNationalId.trim();
    if (data.hasCreditCard !== undefined) keysToUpdate.hasCreditCard = String(data.hasCreditCard);
    if (data.companyLegalName !== undefined) keysToUpdate.companyName = data.companyLegalName.trim();
    if (data.tradeName !== undefined) keysToUpdate.storeName = data.tradeName.trim();
    if (data.ownerName !== undefined) keysToUpdate.ownerName = data.ownerName.trim();
    if (data.commercialRegister !== undefined) keysToUpdate.commercialRegister = data.commercialRegister.trim();
    if (data.taxNumber !== undefined) keysToUpdate.taxNumber = data.taxNumber.trim();
    if (data.vatRegistered !== undefined) keysToUpdate.vatRegistered = String(data.vatRegistered);
    if (data.bankName !== undefined) keysToUpdate.bankName = data.bankName.trim();
    if (data.bankAccountName !== undefined) keysToUpdate.bankAccountName = data.bankAccountName.trim();
    if (data.bankIban !== undefined) keysToUpdate.bankIban = data.bankIban.trim();
    if (data.bankSwift !== undefined) keysToUpdate.bankSwift = data.bankSwift.trim();
    if (data.businessAddress !== undefined) keysToUpdate.businessAddress = data.businessAddress.trim();
    if (data.phone !== undefined) keysToUpdate.phone = data.phone.trim();
    if (data.email !== undefined) keysToUpdate.email = data.email.trim();

    for (const [key, val] of Object.entries(keysToUpdate)) {
      await sql`
        INSERT INTO settings (key, value, tenant_id, account_id)
        VALUES (${key}, ${JSON.stringify(val)}, ${scope.tenantId}, ${scope.accountId})
        ON CONFLICT (tenant_id, key)
        DO UPDATE SET value = excluded.value, account_id = excluded.account_id
      `.execute(this.db);
    }

    return this.getSellerOnboardingCheck(auth);
  }
}
