import { ARABIC_CHAR_REGEX, dictMap, CURRENCY_MAP, ENTITY_COUNTER_MAP, normalizeArabicDigits, ARABIC_MONTHS, VERB_PREFIXES, ADJECTIVES, COMPOUND_PREFIXES } from './auto-translator-data';
/**
 * Translates a single text string using exact match, prefix match, or composite pattern
 */
export function translateUiText(rawText: string): string | null {
  if (!rawText || !ARABIC_CHAR_REGEX.test(rawText)) return null;

  const raw = rawText.trim();
  if (raw.length < 1) return null;

  // 1. Direct dictionary match on the raw trimmed string
  const directRaw = dictMap.get(raw);
  if (directRaw) return directRaw;

  // 2. Parentheses match on raw string: "إغلاق (Esc)", "مدين (Debit)", "Credit Selling Price (التوزيع والجملة)"
  const parenMatch = raw.match(/^([^(]+?)\s*\(([^)]+)\)\s*([:!?.:…]*)$/);
  if (parenMatch) {
    const mainK = parenMatch[1].trim();
    const inner = parenMatch[2].trim();
    const trail = parenMatch[3];
    const transMain = dictMap.get(mainK) || translateUiText(mainK) || (!ARABIC_CHAR_REGEX.test(mainK) ? mainK : null);
    const transInner = dictMap.get(inner) || translateUiText(inner) || inner;
    if (transMain) {
      const lowerMain = transMain.trim().toLowerCase();
      const lowerInner = transInner.trim().toLowerCase();
      if (lowerMain === lowerInner || lowerMain.includes(lowerInner)) {
        return transMain + trail;
      }
      return transMain + ' (' + transInner + ')' + trail;
    }
  }

  // 2-b. Leading parentheses match: "(0) مسندة", "(5) جديدة"
  const leadParenMatch = raw.match(/^\(([^)]+)\)\s*(.+?)([:!?.:…]*)$/);
  if (leadParenMatch) {
    const inner = leadParenMatch[1].trim();
    const mainK = leadParenMatch[2].trim();
    const trail = leadParenMatch[3];
    const transMain = dictMap.get(mainK) || translateUiText(mainK);
    if (transMain) {
      return transMain + ' (' + inner + ')' + trail;
    }
  }

  // 2-c. Pipe separator: "الصنف: سكر | الكمية: 2 | الإجمالي: 100"
  if (raw.includes('|')) {
    const parts = raw.split(/\s*\|\s*/);
    let anyTranslated = false;
    const translatedParts = parts.map((part) => {
      const p = part.trim();
      const tr = dictMap.get(p) || translateUiText(p);
      if (tr && tr !== p) {
        anyTranslated = true;
        return tr;
      }
      const bcMatch = p.match(/^(\d+)#$/);
      if (bcMatch) {
        anyTranslated = true;
        return `#${bcMatch[1]}`;
      }
      return p;
    });
    if (anyTranslated) {
      return translatedParts.join(' | ');
    }
  }

  // 2-d. Cryptographic & Forensic Tamper Audit patterns
  // Break in hash chain:
  const hashBreakMatch = raw.match(/^انقطاع في تسلسل الهاش التشفيري بين السجل #?(\d+) والسجل #?(\d+)\.?\s*(.*)$/);
  if (hashBreakMatch) {
    const prevId = hashBreakMatch[1];
    const currId = hashBreakMatch[2];
    return `Cryptographic hash chain break detected between record #${prevId} and record #${currId}. Intermediate record deletion or tampering detected.`;
  }

  // Genesis block tamper:
  const genesisTamperMatch = raw.match(/^كتلة البداية \(Genesis Block\) للسجل #?(\d+) تحتوي على هاش سابق غير قياسي \(([^)]+)\)\.?$/);
  if (genesisTamperMatch) {
    return `Genesis Block for record #${genesisTamperMatch[1]} contains non-standard previous hash (${genesisTamperMatch[2]}).`;
  }

  // Cryptographic hash mismatch:
  const hashConflictMatch = raw.match(/^تضارب تجزئة التشفير في السجل #?(\d+)\s*\(الجدول:\s*([^)]+)\)\.\s*محتوى السجل لا يطابق بصمته الرقمية المسجلة\.?$/);
  if (hashConflictMatch) {
    return `Cryptographic hash mismatch in record #${hashConflictMatch[1]} (table: ${hashConflictMatch[2]}). Row contents do not match recorded digital fingerprint.`;
  }

  // Cashier fraud & audit details:
  const draftCancelMatch = raw.match(/^(?:ملاحظة:\s*)?تم إلغاء\/حذف فاتورة قبل الإرسال بواسطة\s*(.+)$/);
  if (draftCancelMatch) {
    const user = draftCancelMatch[1].trim();
    const hasNote = raw.startsWith('ملاحظة');
    return hasNote
      ? `Note: Draft invoice cancelled/deleted before dispatch by ${user}`
      : `Draft invoice cancelled/deleted before dispatch by ${user}`;
  }

  const cartRemoveMatch = raw.match(/^تم حذف (?:عنصر|صنف) من السلة بواسطة\s*(.+)$/);
  if (cartRemoveMatch) {
    return `Item removed from cart by ${cartRemoveMatch[1].trim()}`;
  }

  const cartClearMatch = raw.match(/^تم (?:إفراغ|افراغ) السلة بالكامل بواسطة\s*(.+)$/);
  if (cartClearMatch) {
    return `Cart cleared completely by ${cartClearMatch[1].trim()}`;
  }

  const itemNameMatch = raw.match(/^الصنف:\s*(.+)$/);
  if (itemNameMatch) {
    return `Item: ${itemNameMatch[1].trim()}`;
  }

  const qtyMatch = raw.match(/^الكمية:\s*([\d.]+)$/);
  if (qtyMatch) {
    return `Quantity: ${qtyMatch[1].trim()}`;
  }

  const itemCountMatch = raw.match(/^(?:عدد العناصر|عدد الأصناف):\s*(\d+)$/);
  if (itemCountMatch) {
    return `Item Count: ${itemCountMatch[1].trim()}`;
  }

  const totalVoidMatch = raw.match(/^(?:الإجمالي|الاجمالي) بعد الحذف:\s*([\d,]+(?:\.\d+)?)$/);
  if (totalVoidMatch) {
    return `Total after void: ${totalVoidMatch[1].trim()}`;
  }

  const totalMatch = raw.match(/^(?:الإجمالي|الاجمالي):\s*([\d,]+(?:\.\d+)?)$/);
  if (totalMatch) {
    return `Total: ${totalMatch[1].trim()}`;
  }

  const unitPriceMatch = raw.match(/^(?:سعر الوحدة|سعر الصنف):\s*([\d,]+(?:\.\d+)?)$/);
  if (unitPriceMatch) {
    return `Unit Price: ${unitPriceMatch[1].trim()}`;
  }

  const discountMatch = raw.match(/^الخصم:\s*([\d,]+(?:\.\d+)?)$/);
  if (discountMatch) {
    return `Discount: ${discountMatch[1].trim()}`;
  }

  const changedFieldsMatch = raw.match(/^(\d+)\s+حقول\s+متغيرة$/);
  if (changedFieldsMatch) {
    const num = parseInt(changedFieldsMatch[1], 10);
    return `${num} ${num === 1 ? 'Changed Field' : 'Changed Fields'}`;
  }

  // Entity action by actor: "تم تحديث الصنف #55164 بواسطة zs", "تم إنشاء الفاتورة #INV-123 بواسطة admin"
  const entityActionMatch = raw.match(/^تم\s+(تحديث|تعديل|إضافة|انشاء|إنشاء|حذف|تسجيل|إلغاء|الغاء|ترحيل)\s+(الصنف|المنتج|العميل|المورد|المستخدم|الفرع|المخزن|الفاتورة|السجل|الطلب|العقد|المشروع|دفعة جرد|جلسة جرد|مسودة جلسة جرد)\s*(#?\S+)?(?:\s+بواسطة\s+(.+))?$/);
  if (entityActionMatch) {
    const verbMap: Record<string, string> = {
      'تحديث': 'updated',
      'تعديل': 'updated',
      'إضافة': 'created',
      'إنشاء': 'created',
      'انشاء': 'created',
      'حذف': 'deleted',
      'تسجيل': 'recorded',
      'إلغاء': 'cancelled',
      'الغاء': 'cancelled',
      'ترحيل': 'posted',
    };
    const entityMap: Record<string, string> = {
      'الصنف': 'Product',
      'المنتج': 'Product',
      'العميل': 'Customer',
      'المورد': 'Supplier',
      'المستخدم': 'User',
      'الفرع': 'Branch',
      'المخزن': 'Warehouse',
      'الفاتورة': 'Invoice',
      'السجل': 'Record',
      'الطلب': 'Order',
      'العقد': 'Contract',
      'المشروع': 'Project',
      'دفعة جرد': 'Inventory Batch',
      'جلسة جرد': 'Inventory Session',
      'مسودة جلسة جرد': 'Inventory Session Draft',
    };
    const verb = verbMap[entityActionMatch[1]] || 'updated';
    const entity = entityMap[entityActionMatch[2]] || entityActionMatch[2];
    const id = entityActionMatch[3] ? ` ${entityActionMatch[3]}` : '';
    const actor = entityActionMatch[4] ? ` by ${entityActionMatch[4]}` : '';
    return `${entity}${id} ${verb}${actor}`;
  }

  // 3. Coloned labels or messages: "المستودع المصدر: ", "النسخة:", or "شركة الكينج: الرصيد تجاوز حد الائتمان."
  const colonMatch = raw.match(/^([^:]+)[:：]\s*(.*)$/);
  if (colonMatch) {
    const k = colonMatch[1].trim();
    const rest = colonMatch[2].trim();
    const transK = dictMap.get(k) || translateUiText(k);
    const transRest = rest ? (dictMap.get(rest) || translateUiText(rest)) : '';
    if (transK || transRest) {
      return (transK || k) + ': ' + (transRest || rest);
    }
  }

  // 3-b. Reverse colon labels (RTL numbers/symbols): "-950.00 :الرصيد المكشوف", "100 EGP :الإجمالي"
  const revColonMatch = raw.match(/^([^\u0600-\u06FF:]+?)\s*[:：]\s*([\u0600-\u06FF\s]+)$/);
  if (revColonMatch) {
    const val = revColonMatch[1].trim();
    const k = revColonMatch[2].trim();
    const transK = dictMap.get(k) || translateUiText(k);
    if (transK) {
      return transK + ': ' + val;
    }
  }


  // 3-c. Currency amounts: "500 ر.س", "1,200.50 ج.م", "SAR 500"
  const currSuffixMatch = raw.match(/^([+-]?\s*[\d,]+(?:\.\d+)?)\s*(ر\.س|ج\.م|د\.إ|د\.ك|د\.ب|ر\.ع|ر\.ق|دولار|يورو)$/);
  if (currSuffixMatch) {
    const num = currSuffixMatch[1].trim();
    const cur = CURRENCY_MAP[currSuffixMatch[2].trim()] || currSuffixMatch[2];
    return `${num} ${cur}`;
  }

  const currPrefixMatch = raw.match(/^(ر\.س|ج\.م|د\.إ|د\.ك|د\.ب|ر\.ع|ر\.ق|دولار|يورو)\s*([+-]?\s*[\d,]+(?:\.\d+)?)$/);
  if (currPrefixMatch) {
    const cur = CURRENCY_MAP[currPrefixMatch[1].trim()] || currPrefixMatch[1];
    const num = currPrefixMatch[2].trim();
    return `${cur} ${num}`;
  }

  // 3-d. Entity counts & pluralization: "0 فرصة", "12 عميل", "5 طلبات", "100 كم"
  const countEntityMatch = raw.match(/^(\d+)\s+([\u0600-\u06FF]+)$/);
  if (countEntityMatch) {
    const count = parseInt(countEntityMatch[1], 10);
    const entity = countEntityMatch[2].trim();
    if (ENTITY_COUNTER_MAP[entity]) {
      const { singular, plural } = ENTITY_COUNTER_MAP[entity];
      return `${count} ${count === 1 ? singular : plural}`;
    }
  }

  // 3-e. Reverse count: "طلب #123"
  const revCountMatch = raw.match(/^([\u0600-\u06FF]+)\s*#?(\d+)$/);
  if (revCountMatch) {
    const entity = revCountMatch[1].trim();
    const count = revCountMatch[2].trim();
    if (ENTITY_COUNTER_MAP[entity]) {
      const { singular } = ENTITY_COUNTER_MAP[entity];
      return `${singular} #${count}`;
    }
  }

  // 3-f. Arabic dates: "19 أكتوبر 2026", "١٩ أكتوبر ٢٠٢٦"
  const arabicDateMatch = raw.match(/^([٠-٩\d]{1,2})\s+(يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر)(?:\s+([٠-٩\d]{4}))?$/);
  if (arabicDateMatch) {
    const day = normalizeArabicDigits(arabicDateMatch[1]);
    const month = ARABIC_MONTHS[arabicDateMatch[2]];
    const year = arabicDateMatch[3] ? normalizeArabicDigits(arabicDateMatch[3]) : '';
    return year ? `${day} ${month} ${year}` : `${day} ${month}`;
  }

  if (raw === 'اليوم') return 'Today';
  if (raw === 'أمس') return 'Yesterday';
  if (raw === 'غداً' || raw === 'غدا') return 'Tomorrow';
  if (raw === 'الآن') return 'Just now';

  // 4. Rank / Index prefix: "#1 ", "1. ", "01. "
  const rankMatch = raw.match(/^(#\d+\s+|\d+\.\s+)(.*)$/);
  if (rankMatch) {
    const rankPrefix = rankMatch[1];
    const subText = rankMatch[2].trim();
    const transSub = dictMap.get(subText) || translateUiText(subText);
    if (transSub) {
      return rankPrefix + transSub;
    }
  }

  // 5. Dash separator: "Apple - هواتف ذكية", "إلكترونيات - شاشات"
  if (raw.includes(' - ') || raw.includes(' – ') || raw.includes(' — ')) {
    const dashDelim = raw.includes(' - ') ? ' - ' : raw.includes(' – ') ? ' – ' : ' — ';
    const parts = raw.split(dashDelim);
    let anyTranslated = false;
    const translatedParts = parts.map((part) => {
      const p = part.trim();
      const tr = dictMap.get(p) || translateUiText(p);
      if (tr && tr !== p) {
        anyTranslated = true;
        return tr;
      }
      return p;
    });
    if (anyTranslated) {
      return translatedParts.join(dashDelim);
    }
  }

  // 4. Separate leading/trailing symbols, brackets, arrows, and punctuation
  // Note: Parentheses are excluded from stripping to protect inner expressions
  const symMatch = raw.match(/^([\s*+\-•–—[{"'«#%/&;rarr;lt;gt;]*)(.*?)([\s*+\-•–—\]}"'».:…!?؟/\\]*)$/);
  const prefix = symMatch ? symMatch[1] : '';
  let core = symMatch ? symMatch[2].trim() : raw;
  const suffix = symMatch ? symMatch[3] : '';

  if (!core) return null;

  // Normalize Eastern Arabic numerals: "١ قطعة" -> "1 قطعة"
  if (/[\u0660-\u0669]/.test(core)) {
    core = core.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 1632));
  }

  // 5. Direct dictionary match on core
  const direct = dictMap.get(core);
  if (direct) {
    return prefix + direct + suffix;
  }

  // 5-b. Save action variants: "حفظ وإضافة للسلة", "حفظ الصنف بجميع المتغيرات", etc.
  if (core.startsWith('حفظ ')) {
    const rest = core.slice(4).trim();
    if (rest === 'وإضافة للسلة' || rest === 'واضافة للسلة') {
      return prefix + 'Save & Add to Cart' + suffix;
    }
    if (rest === 'الصنف بجميع المتغيرات') {
      return prefix + 'Save Product with All Variants' + suffix;
    }
    if (rest === 'الصنف والمتغيرات وإضافة للسلة') {
      return prefix + 'Save Product & Variants and Add to Cart' + suffix;
    }
    if (rest === 'الصنف وإضافته' || rest === 'الصنف واضافته') {
      return prefix + 'Save Item & Add' + suffix;
    }
    if (rest === 'وإغلاق' || rest === 'واغلاق') {
      return prefix + 'Save & Close' + suffix;
    }
    if (rest === 'ومتابعة') {
      return prefix + 'Save & Continue' + suffix;
    }
    if (rest === 'وطباعة') {
      return prefix + 'Save & Print' + suffix;
    }
    if (rest === 'وإرسال' || rest === 'وارسال') {
      return prefix + 'Save & Send' + suffix;
    }
    if (rest === 'كمسودة') {
      return prefix + 'Save as Draft' + suffix;
    }
    if (rest === 'وإنشاء جديد') {
      return prefix + 'Save & Create New' + suffix;
    }
    const transRest = dictMap.get(rest) || translateUiText(rest);
    if (transRest) {
      return prefix + 'Save ' + transRest + suffix;
    }
  }

  // 5-c. Input placeholders: "اكتب اسم الصنف", "اكتب اسم العميل", "أدخل كود...", "ادخل..."
  if (core.startsWith('اكتب ') || core.startsWith('أدخل ') || core.startsWith('ادخل ')) {
    const spaceIdx = core.indexOf(' ');
    const rest = core.slice(spaceIdx + 1).trim();
    const transRest = dictMap.get(rest) || translateUiText(rest);
    if (transRest) {
      return prefix + 'Enter ' + transRest.toLowerCase() + suffix;
    }
  }

  // 5-d. Optional barcode or manual entry patterns
  if (core === 'اختياري أو امسحه بالماسح' || core === 'اختياري أو امسحه بالباركود') {
    return prefix + 'Optional or scan with barcode reader' + suffix;
  }
  if (core.startsWith('اختياري أو ')) {
    const rest = core.slice(11).trim();
    const transRest = dictMap.get(rest) || translateUiText(rest);
    return prefix + 'Optional or ' + (transRest || rest) + suffix;
  }

  // Shortcut key trailing/leading (e.g. "إتمام البيع F2", "F2 إتمام البيع", "إعادة طباعة F9", "تعليق F4")
  const shortcutMatch = core.match(/^(?:(F\d+)\s+([^\d].*)|([^\d].*?)\s+(F\d+))$/i);
  if (shortcutMatch) {
    const fKey = (shortcutMatch[1] || shortcutMatch[4]).toUpperCase();
    const textPart = (shortcutMatch[2] || shortcutMatch[3]).trim();
    const transText = dictMap.get(textPart) || translateUiText(textPart);
    if (transText) {
      if (shortcutMatch[1]) {
        return prefix + fKey + ' ' + transText + suffix;
      } else {
        return prefix + transText + ' ' + fKey + suffix;
      }
    }
  }

  // Dot-separated compound terms: "نص أول · نص ثانٍ"
  if (core.includes(' · ')) {
    const parts = core.split(' · ');
    let anyTranslated = false;
    const translatedParts = parts.map((part) => {
      const p = part.trim();
      const tr = dictMap.get(p) || translateUiText(p);
      if (tr && tr !== p) {
        anyTranslated = true;
        return tr;
      }
      return p;
    });
    if (anyTranslated) {
      return prefix + translatedParts.join(' · ') + suffix;
    }
  }

  // 6. Counted entities (e.g. "12 بوليصة", "58 فاتورة", "${rangeDays} يوم")
  const numMatch = core.match(/^(\d+[\d.,]*|\$\{[^}]+\})\s+([^\d]+)$/);
  if (numMatch) {
    const num = numMatch[1];
    const noun = numMatch[2].trim();
    const transNoun = dictMap.get(noun) || translateUiText(noun);
    if (transNoun) {
      return prefix + num + ' ' + transNoun + suffix;
    }
  }

  // 7. Currency amounts: "500 ج.م" -> "500 EGP", "1,200 ريال" -> "1,200 SAR"
  const currMatch = core.match(/^([\d.,]+)\s*(?:ج\.م|جنيه|جم)$/i);
  if (currMatch) return prefix + currMatch[1] + ' EGP' + suffix;
  const sarMatch = core.match(/^([\d.,]+)\s*(?:ر\.س|ريال)$/i);
  if (sarMatch) return prefix + sarMatch[1] + ' SAR' + suffix;
  const aedMatch = core.match(/^([\d.,]+)\s*(?:د\.إ|درهم)$/i);
  if (aedMatch) return prefix + aedMatch[1] + ' AED' + suffix;
  const usdMatch = core.match(/^([\d.,]+)\s*(?:\$|دولار)$/i);
  if (usdMatch) return prefix + usdMatch[1] + ' USD' + suffix;

  // 8. Barcode / Scanner pattern (e.g. "امسح باركود أو اكتب الاسم...")
  const scanMatch = core.match(/^امسح باركود\s*(.*)$/);
  if (scanMatch) {
    const rest = scanMatch[1].trim();
    if (!rest) return prefix + 'Scan barcode...' + suffix;
    if (rest.includes('اكتب الاسم')) return prefix + 'Scan barcode or enter name...' + suffix;
    return prefix + 'Scan barcode ' + rest + '...' + suffix;
  }

  // 9. Permission error
  if (core.startsWith('لا تملك صلاحية')) {
    return prefix + 'You do not have permission to view this data.' + suffix;
  }

  // 10. Action verb prefixes: "إضافة أصل جديد" -> "Add New Asset"
  for (const v of VERB_PREFIXES) {
    if (core.startsWith(v.ar + ' ')) {
      const rest = core.slice(v.ar.length + 1).trim();

      // Check if rest is [Noun] + [Adjective]
      for (const [adjAr, adjEn] of Object.entries(ADJECTIVES)) {
        if (rest.endsWith(' ' + adjAr)) {
          const nounPart = rest.slice(0, -(adjAr.length + 1)).trim();
          const transNoun = dictMap.get(nounPart);
          if (transNoun) {
            if (v.enSuffix) {
              return prefix + adjEn + ' ' + transNoun + ' ' + v.enSuffix + suffix;
            } else {
              return prefix + v.en + ' ' + adjEn + ' ' + transNoun + suffix;
            }
          }
        }
      }

      // Check if rest is pure Noun or in dict
      const transRest = dictMap.get(rest);
      if (transRest) {
        if (v.enSuffix) {
          return prefix + transRest + ' ' + v.enSuffix + suffix;
        } else {
          return prefix + v.en + ' ' + transRest + suffix;
        }
      }
    }
  }

  // 7. Noun + Adjective: "الفاتورة الحالية" -> "Current Invoice"
  for (const [adjAr, adjEn] of Object.entries(ADJECTIVES)) {
    if (core.endsWith(' ' + adjAr)) {
      const nounPart = core.slice(0, -(adjAr.length + 1)).trim();
      const transNoun = dictMap.get(nounPart);
      if (transNoun) {
        return prefix + adjEn + ' ' + transNoun + suffix;
      }
    }
  }

  // 8. Compound prefixes: "كود الموظف" -> "Employee Code", "إجمالي المبيعات" -> "Total Sales"
  for (const cp of COMPOUND_PREFIXES) {
    if (core.startsWith(cp.ar + ' ')) {
      const rest = core.slice(cp.ar.length + 1).trim();
      const transRest = dictMap.get(rest) || translateUiText(rest);
      if (transRest) {
        if (cp.enSuffix) {
          return prefix + transRest + ' ' + cp.enSuffix + suffix;
        } else if (cp.enPrefix) {
          return prefix + cp.enPrefix + ' ' + transRest + suffix;
        }
      }
    }
  }

  // 9. Empty state patterns: "لا توجد أصناف مسجلة" -> "No registered Products found"
  const emptyMatch = core.match(/^لا (?:توجد|يوجد)\s+(.+?)\s+مسجل[ة|ين]*$/);
  if (emptyMatch) {
    const entity = emptyMatch[1].trim();
    const transEntity = dictMap.get(entity) || entity;
    return prefix + 'No registered ' + transEntity + ' found' + suffix;
  }

  // 10. Progress/loading: "جارٍ الحفظ...", "جاري التحديث...", "جاري الإرسال...", "جاري تحميل..."
  const progMatch = core.match(/^(?:جاري|جارٍ)\s*(.*)$/);
  if (progMatch) {
    const act = progMatch[1].trim();
    if (!act) return prefix + 'Loading...' + suffix;
    const progMap: Record<string, string> = {
      'الحفظ': 'Saving...',
      'حفظ': 'Saving...',
      'التحديث': 'Updating...',
      'تحديث': 'Updating...',
      'الإرسال': 'Sending...',
      'إرسال': 'Sending...',
      'التسجيل': 'Registering...',
      'تسجيل': 'Registering...',
      'المعالجة': 'Processing...',
      'معالجة': 'Processing...',
      'التحميل': 'Loading...',
      'تحميل': 'Loading...',
      'التسوية': 'Reconciling...',
      'تسوية': 'Reconciling...',
      'الإنشاء': 'Creating...',
      'إنشاء': 'Creating...',
      'الحذف': 'Deleting...',
      'حذف': 'Deleting...',
    };
    if (progMap[act]) return prefix + progMap[act] + suffix;
    const loadEntityMatch = act.match(/^(?:تحميل|عرض)\s+(.+)$/);
    if (loadEntityMatch) {
      const entity = loadEntityMatch[1].trim();
      const transEntity = dictMap.get(entity) || entity;
      return prefix + 'Loading ' + transEntity + suffix;
    }
  }

  // 10. Example pattern: "مثال: 500 جنيه" -> "Example: 500 EGP", "مثال: رف 5" -> "Example: Shelf 5"
  const egMatch = core.match(/^مثال[:：]\s*(.*)$/);
  if (egMatch) {
    const egVal = egMatch[1].trim();
    const transEgVal = dictMap.get(egVal) || translateUiText(egVal) || egVal;
    return prefix + 'Example: ' + transEgVal + suffix;
  }

  // 11. Breadcrumbs and slash-separated terms (e.g. "الرئيسية / المبيعات / عروض الأسعار")
  if (core.includes(' / ')) {
    const parts = core.split(' / ');
    let anyTranslated = false;
    const translatedParts = parts.map((part) => {
      const p = part.trim();
      const tr = dictMap.get(p) || translateUiText(p);
      if (tr && tr !== p) {
        anyTranslated = true;
        return tr;
      }
      return p;
    });
    if (anyTranslated) {
      return prefix + translatedParts.join(' / ') + suffix;
    }
  }

  // 12. Arrow-separated breadcrumbs (e.g. "الرئيسية > المبيعات")
  if (core.includes(' > ') || core.includes(' ← ') || core.includes(' → ')) {
    const delim = core.includes(' > ') ? ' > ' : core.includes(' → ') ? ' → ' : ' ← ';
    const parts = core.split(delim);
    let anyTranslated = false;
    const translatedParts = parts.map((part) => {
      const p = part.trim();
      const tr = dictMap.get(p) || translateUiText(p);
      if (tr && tr !== p) {
        anyTranslated = true;
        return tr;
      }
      return p;
    });
    if (anyTranslated) {
      return prefix + translatedParts.join(' > ') + suffix;
    }
  }

  // 13. Search patterns (e.g. "ابحث بالاسم أو الكود...", "بحث برقم الفاتورة، اسم العميل، أو الهاتف...")
  const searchMatch = core.match(/^(?:بحث|ابحث|البحث)\s+(?:بـ|عن|في|ب)?\s*(.*)$/);
  if (searchMatch) {
    const queryTarget = searchMatch[1].trim();
    if (!queryTarget || queryTarget === 'هنا') return prefix + 'Search...' + suffix;
    if (queryTarget === 'سريع' || queryTarget.startsWith('سريع في') || queryTarget.startsWith('سريع')) {
      const quickRest = queryTarget.replace(/^سريع\s*(?:في\s*)?/, '').trim();
      const transRest = quickRest ? (dictMap.get(quickRest) || translateUiText(quickRest)) : '';
      if (transRest) return prefix + 'Quick search in ' + transRest + '...' + suffix;
      return prefix + 'Quick search...' + suffix;
    }

    const orParts = queryTarget.split(/\s*،\s*|\s+أو\s+/);
    if (orParts.length > 1) {
      const translatedItems = orParts.map((item) => {
        const cleanItem = item.replace(/^بـ|^ب|^في\s+/, '').trim();
        return dictMap.get(cleanItem) || translateUiText(cleanItem) || cleanItem;
      });
      return prefix + 'Search by ' + translatedItems.slice(0, -1).join(', ') + ' or ' + translatedItems.slice(-1)[0] + '...' + suffix;
    }
    const cleanSingle = queryTarget.replace(/^بـ|^ب|^في\s+/, '').trim();
    const transTarget = dictMap.get(cleanSingle) || translateUiText(cleanSingle);
    if (transTarget) {
      return prefix + 'Search by ' + transTarget + '...' + suffix;
    }
    if (!ARABIC_CHAR_REGEX.test(queryTarget)) {
      return prefix + 'Search ' + queryTarget + '...' + suffix;
    }
    return prefix + 'Search...' + suffix;
  }

  // 14. Selection patterns (e.g. "اختر الفرع...", "اختر الحساب...", "اختر طريقة الدفع...")
  const selectMatch = core.match(/^(?:اختر|اختيار|حدد)\s+(.*)$/);
  if (selectMatch) {
    const target = selectMatch[1].trim();
    if (!target) return prefix + 'Select...' + suffix;
    const transTarget = dictMap.get(target) || translateUiText(target);
    if (transTarget) {
      return prefix + 'Select ' + transTarget + suffix;
    }
  }

  // 15. All entities (e.g. "جميع الأصناف", "جميع الفروع", "كل الحسابات")
  const allMatch = core.match(/^(?:جميع|كل)\s+(.*)$/);
  if (allMatch) {
    const target = allMatch[1].trim();
    const transTarget = dictMap.get(target) || translateUiText(target);
    if (transTarget) {
      return prefix + 'All ' + transTarget + suffix;
    }
  }

  // 16. Count of entities (e.g. "عدد العملاء", "عدد الفواتير", "عدد الأصناف")
  const countMatch = core.match(/^عدد\s+(.*)$/);
  if (countMatch) {
    const target = countMatch[1].trim();
    const transTarget = dictMap.get(target) || translateUiText(target);
    if (transTarget) {
      return prefix + transTarget + ' Count' + suffix;
    }
  }

  // 17. Without entities (e.g. "بدون مركز", "بدون ضريبة", "بدون عميل")
  const withoutMatch = core.match(/^بدون\s+(.*)$/);
  if (withoutMatch) {
    const target = withoutMatch[1].trim();
    const transTarget = dictMap.get(target) || translateUiText(target);
    if (transTarget) {
      return prefix + 'No ' + transTarget + suffix;
    }
  }

  // 18. Broad empty state matcher (e.g. "لا توجد بيانات متاحة", "لا توجد نتائج", "لا توجد فواتير")
  const broadEmptyMatch = core.match(/^لا (?:توجد|يوجد)\s+(.*)$/);
  if (broadEmptyMatch) {
    const rest = broadEmptyMatch[1].trim();
    if (!rest || rest === 'بيانات' || rest === 'بيانات متاحة') return prefix + 'No data available' + suffix;
    if (rest === 'نتائج' || rest === 'نتائج مطابقة') return prefix + 'No matching results found' + suffix;
    if (rest === 'سجلات') return prefix + 'No records found' + suffix;
    const transRest = dictMap.get(rest) || translateUiText(rest);
    if (transRest) {
      return prefix + 'No ' + transRest + ' found' + suffix;
    }
    return prefix + 'No ' + rest + ' found' + suffix;
  }

  // 19. Success confirmations (e.g. "تم الحفظ بنجاح", "تم الحذف بنجاح")
  const successMatch = core.match(/^تم\s+(.+?)\s+بنجاح$/);
  if (successMatch) {
    const action = successMatch[1].trim();
    const actionMap: Record<string, string> = {
      'الحفظ': 'Saved',
      'التحديث': 'Updated',
      'الحذف': 'Deleted',
      'الإرسال': 'Sent',
      'التسجيل': 'Registered',
      'الترحيل': 'Posted',
      'الدفع': 'Paid',
      'الإلغاء': 'Cancelled',
      'الاعتماد': 'Approved',
      'الإنشاء': 'Created',
    };
    const act = actionMap[action] || dictMap.get(action);
    if (act) return prefix + act + ' successfully' + suffix;
  }

  // 20. Conjunction "و" (e.g. "المبيعات والعملاء", "المبيعات ونقاط الخدمة", "الشركات والتوزيع والإنتاج")
  if (core.includes(' و')) {
    const parts = core.split(/\s+و\s*|\s*،\s*/);
    if (parts.length > 1) {
      let allTranslated = true;
      const transParts = parts.map((p) => {
        const tr = dictMap.get(p.trim()) || translateUiText(p.trim());
        if (!tr) allTranslated = false;
        return tr || p.trim();
      });
      if (allTranslated) {
        return prefix + transParts.join(' & ') + suffix;
      }
    }
  }

  // 21. Dynamic operational and alert patterns
  // Pattern: "استخدم 95% من حد الائتمان."
  const usedCreditMatch = core.match(/^استخدم\s+(\d+(?:\.\d+)?%)\s+من\s+حد\s+الائتمان\.?$/);
  if (usedCreditMatch) {
    return prefix + 'Used ' + usedCreditMatch[1] + ' of credit limit.' + suffix;
  }

  // Pattern: "تنتهي صلاحيته خلال 10 يوم" or with date
  const expiryDaysMatch = core.match(/^تنتهي\s+(?:صلاحيته\s+)?خلال\s+(\d+)\s+يوم(?:\s*\((.*?)\))?\.?$/);
  if (expiryDaysMatch) {
    const days = expiryDaysMatch[1];
    const datePart = expiryDaysMatch[2] ? ` (${expiryDaysMatch[2]})` : '';
    return prefix + `Expires in ${days} days${datePart}.` + suffix;
  }

  // Pattern: "انتهت صلاحيته بتاريخ 2026-10-01" or with qty
  const expiredDateMatch = core.match(/^انتهت\s+(?:صلاحيته\s+)?بتاريخ\s+([^\s(]+)(?:\s*\((.*?)\))?\.?$/);
  if (expiredDateMatch) {
    const dt = expiredDateMatch[1];
    const extra = expiredDateMatch[2] ? ` (${dictMap.get(expiredDateMatch[2]) || translateUiText(expiredDateMatch[2]) || expiredDateMatch[2]})` : '';
    return prefix + `Expired on ${dt}${extra}.` + suffix;
  }

  // Pattern: "لا توجد مبيعات منذ 65 يوم (الحد: 30 يوم)."
  const noSalesMatch = core.match(/^لا توجد مبيعات منذ\s+(\d+)\s+يوم(?:\s*\(الحد:\s*(\d+)\s*يوم\))?\.?$/);
  if (noSalesMatch) {
    const days = noSalesMatch[1];
    const limit = noSalesMatch[2] ? ` (Limit: ${noSalesMatch[2]} days)` : '';
    return prefix + `No sales for ${days} days${limit}.` + suffix;
  }

  // Pattern: "الخصم 25% من قيمة الفاتورة."
  const discountRateMatch = core.match(/^الخصم\s+(\d+(?:\.\d+)?%)\s+من\s+قيمة\s+الفاتورة\.?$/);
  if (discountRateMatch) {
    return prefix + `Discount is ${discountRateMatch[1]} of invoice value.` + suffix;
  }

  // Pattern: "تحتوي على 2 سطر أقل من التكلفة."
  const belowCostMatch = core.match(/^تحتوي\s+على\s+(\d+)\s+سطر\s+أقل\s+من\s+التكلفة\.?$/);
  if (belowCostMatch) {
    return prefix + `Contains ${belowCostMatch[1]} lines below cost.` + suffix;
  }

  // Pattern: "الكمية 5 والحد الأدنى 10."
  const qtyMinMatch = core.match(/^الكمية\s+([\d.,]+)\s+والحد\s+الأدنى\s+([\d.,]+)\.?$/);
  if (qtyMinMatch) {
    return prefix + `Quantity is ${qtyMinMatch[1]} and minimum is ${qtyMinMatch[2]}.` + suffix;
  }

  // 22. Journal entry descriptions
  const saleEntryMatch = core.match(/^قيد\s+(?:بيع|مبيعات)\s+تلقائي\s+للفاتورة\s+رقم\s*(.+)$/);
  if (saleEntryMatch) return prefix + `Auto sale entry for invoice #${saleEntryMatch[1].trim()}` + suffix;

  const purEntryMatch = core.match(/^قيد\s+(?:شراء|مشتريات)\s+تلقائي\s+للفاتورة\s+رقم\s*(.+)$/);
  if (purEntryMatch) return prefix + `Auto purchase entry for invoice #${purEntryMatch[1].trim()}` + suffix;

  const vanLoadMatch = core.match(/^قيد\s+تحميل\s+بضاعة\s+ل(?:سيارة|مركبة)\s+التوزيع\s*-\s*رحلة\s*#?\s*(.+)$/);
  if (vanLoadMatch) return prefix + `Van stock load entry - Trip #${vanLoadMatch[1].trim()}` + suffix;

  const vanUnloadMatch = core.match(/^قيد\s+تفريغ\s+وإعادة\s+بضاعة\s+ل(?:سيارة|مركبة)\s+التوزيع\s+للمستودع\s*-\s*رحلة\s*#?\s*(.+)$/);
  if (vanUnloadMatch) return prefix + `Van stock unload entry - Trip #${vanUnloadMatch[1].trim()}` + suffix;

  const vanSettleMatch = core.match(/^قيد\s+تصفية\s+رحلة\s+توزيع\s*#?\s*(.+)$/);
  if (vanSettleMatch) return prefix + `Van trip settlement entry #${vanSettleMatch[1].trim()}` + suffix;

  const vanCollectMatch = core.match(/^قيد\s+تحصيل\s+ميداني\s*#?\s*(.+)$/);
  if (vanCollectMatch) return prefix + `Field collection entry #${vanCollectMatch[1].trim()}` + suffix;

  const depMatch = core.match(/^قيد\s+إهلاك\s+أصل\s*(.+)$/);
  if (depMatch) return prefix + `Asset depreciation entry: ${depMatch[1].trim()}` + suffix;

  const adjMatch = core.match(/^قيد\s+تسوية\s+مخزنية\s*(.+)$/);
  if (adjMatch) return prefix + `Inventory adjustment entry: ${adjMatch[1].trim()}` + suffix;

  // 23. HR tasks & reviews
  const hrLeaveReviewMatch = core.match(/^(.+?)\s+لديه\s+طلب\s+إجازة\s+قيد\s+المراجعة\.?$/);
  if (hrLeaveReviewMatch) return prefix + `${hrLeaveReviewMatch[1].trim()} has a leave request pending review.` + suffix;

  const hrAttReviewMatch = core.match(/^(.+?)\s+لديه\s+استثناء\s+حضور\s+يحتاج\s+اعتماد\s+أو\s+تخطي\.?$/);
  if (hrAttReviewMatch) return prefix + `${hrAttReviewMatch[1].trim()} has an attendance exception pending review.` + suffix;

  const hrAssetReviewMatch = core.match(/^(.+?)\s+مسجلة\s+تالفة\s+أو\s+مفقودة\s+وتحتاج\s+مراجعة\.?$/);
  if (hrAssetReviewMatch) return prefix + `${hrAssetReviewMatch[1].trim()} recorded as damaged or missing and needs review.` + suffix;

  const hrIncompleteMatch = core.match(/^(.+?)\s+يحتاج\s+استكمال\s+بيانات\s+أساسية\s+أو\s+وظيفية\.?$/);
  if (hrIncompleteMatch) return prefix + `${hrIncompleteMatch[1].trim()} needs basic or employment data completed.` + suffix;

  // 24. Audit descriptions
  const auditSettingsMatch = core.match(/^تم\s+تعديل\s+الإعدادات\s+بواسطة\s*(.+)$/);
  if (auditSettingsMatch) return prefix + `Settings modified by user ${auditSettingsMatch[1].trim()}` + suffix;

  const auditInvMatch = core.match(/^تم\s+إنشاء\s+الفاتورة\s*(.+?)\s*بواسطة\s*(.+)$/);
  if (auditInvMatch) return prefix + `Invoice ${auditInvMatch[1].trim()} created by user ${auditInvMatch[2].trim()}` + suffix;

  const auditLoginMatch = core.match(/^تم\s+تسجيل\s+دخول\s+المستخدم\s*(.+)$/);
  if (auditLoginMatch) return prefix + `User ${auditLoginMatch[1].trim()} logged in` + suffix;

  const auditModeMatch = core.match(/^تم\s+تغيير\s+نمط\s+المنشأة(?:\s*إلى\s*(.+))?$/);
  if (auditModeMatch) return prefix + `Business mode changed${auditModeMatch[1] ? ' to ' + auditModeMatch[1].trim() : ''}` + suffix;

  // 25. Counts & KPI metric entities
  const locMatch = core.match(/^مواقع\s+مرصودة[:：]?\s*(\d+)$/);
  if (locMatch) return prefix + `Tracked Locations: ${locMatch[1]}` + suffix;

  const locMatchRev = core.match(/^(\d+)\s+مواقع\s+مرصودة$/);
  if (locMatchRev) return prefix + `${locMatchRev[1]} Tracked Locations` + suffix;

  const centersCountMatch = core.match(/^(\d+)\s+مركز(?:\s+نشط|\s+رئيسي)?$/);
  if (centersCountMatch) {
    const isAct = core.includes('نشط');
    const isRoot = core.includes('رئيسي');
    const label = isAct ? 'Active Centers' : isRoot ? 'Root Centers' : 'Centers';
    return prefix + `${centersCountMatch[1]} ${label}` + suffix;
  }

  const pkgCountMatch = core.match(/^(\d+)\s+حزمة$/);
  if (pkgCountMatch) return prefix + `${pkgCountMatch[1]} Packages` + suffix;

  const tenantCountMatch = core.match(/^(\d+)\s+منشأة$/);
  if (tenantCountMatch) return prefix + `${tenantCountMatch[1]} Tenants` + suffix;

  return null;
}
