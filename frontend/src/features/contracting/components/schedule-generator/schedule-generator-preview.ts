import { addDays } from './schedule-generator-data';
import type { GeneratedTaskPreview } from './schedule-generator-data';

export function generateSchedulePreview(params: { selectedTrades: string[]; includeBasement: boolean; floorsCount: number; includeRoof: boolean; startDate: string; concreteDaysPerFloor: number; masonryDaysPerFloor: number; plasterPrepDays: number; plasterFillDays: number }): GeneratedTaskPreview[] {
  const { selectedTrades, includeBasement, floorsCount, includeRoof, startDate, concreteDaysPerFloor, masonryDaysPerFloor, plasterPrepDays, plasterFillDays } = params;
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
}
