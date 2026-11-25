import { strict as assert } from 'node:assert';
import {
  normalizeDayKey,
  extractCustomerVisitDays,
  isCustomerScheduledForDay,
  getCurrentBusinessDay,
  DAY_KEY_TO_ARABIC,
} from '../../src/modules/delivery-reps/van-routes-schedule.util';

// 1. normalizeDayKey: Arabic & English Spelling Normalization
assert.equal(normalizeDayKey('الإثنين'), 'monday');
assert.equal(normalizeDayKey('الاثنين'), 'monday');
assert.equal(normalizeDayKey('إثنين'), 'monday');
assert.equal(normalizeDayKey('اثنين'), 'monday');
assert.equal(normalizeDayKey('الاتنين'), 'monday');
assert.equal(normalizeDayKey('اتنين'), 'monday');
assert.equal(normalizeDayKey('monday'), 'monday');
assert.equal(normalizeDayKey('Monday'), 'monday');

assert.equal(normalizeDayKey('الجمعة'), 'friday');
assert.equal(normalizeDayKey('الجمعه'), 'friday');
assert.equal(normalizeDayKey('جمعة'), 'friday');
assert.equal(normalizeDayKey('جمعه'), 'friday');
assert.equal(normalizeDayKey('friday'), 'friday');

assert.equal(normalizeDayKey('السبت'), 'saturday');
assert.equal(normalizeDayKey('الأحد'), 'sunday');
assert.equal(normalizeDayKey('الاحد'), 'sunday');
assert.equal(normalizeDayKey('الثلاثاء'), 'tuesday');
assert.equal(normalizeDayKey('التلات'), 'tuesday');
assert.equal(normalizeDayKey('الأربعاء'), 'wednesday');
assert.equal(normalizeDayKey('الاربعاء'), 'wednesday');
assert.equal(normalizeDayKey('الخميس'), 'thursday');

// 2. extractCustomerVisitDays: Metadata Harmonization
const res1 = extractCustomerVisitDays({ visit_day: 'الإثنين' });
assert.deepEqual(res1.visitDays, ['الإثنين']);
assert.equal(res1.visitDay, 'الإثنين');

const res2 = extractCustomerVisitDays({ visit_days: ['السبت', 'الخميس', 'الجمعة'] });
assert.deepEqual(res2.visitDays, ['السبت', 'الخميس', 'الجمعة']);
assert.equal(res2.visitDay, 'السبت');

const res3 = extractCustomerVisitDays({ visit_days: ['الاثنين', 'الجمعه', 'الإثنين'] });
assert.deepEqual(res3.visitDays, ['الإثنين', 'الجمعة']);
assert.equal(res3.visitDay, 'الإثنين');

assert.deepEqual(extractCustomerVisitDays(null), { visitDays: [], visitDay: '' });
assert.deepEqual(extractCustomerVisitDays({}), { visitDays: [], visitDay: '' });
assert.deepEqual(extractCustomerVisitDays({ visit_day: '' }), { visitDays: [], visitDay: '' });
assert.deepEqual(extractCustomerVisitDays({ visit_days: [] }), { visitDays: [], visitDay: '' });

// 3. isCustomerScheduledForDay: Strict Day Restriction Guarantee
const mondayCust = extractCustomerVisitDays({ visit_day: 'الإثنين' });
assert.equal(isCustomerScheduledForDay(mondayCust.visitDays, 'monday'), true);
assert.equal(isCustomerScheduledForDay(mondayCust.visitDays, 'tuesday'), false);
assert.equal(isCustomerScheduledForDay(mondayCust.visitDays, 'wednesday'), false);
assert.equal(isCustomerScheduledForDay(mondayCust.visitDays, 'thursday'), false);
assert.equal(isCustomerScheduledForDay(mondayCust.visitDays, 'friday'), false);
assert.equal(isCustomerScheduledForDay(mondayCust.visitDays, 'saturday'), false);
assert.equal(isCustomerScheduledForDay(mondayCust.visitDays, 'sunday'), false);

const fridayCust = extractCustomerVisitDays({ visit_day: 'الجمعة' });
assert.equal(isCustomerScheduledForDay(fridayCust.visitDays, 'friday'), true);
assert.equal(isCustomerScheduledForDay(fridayCust.visitDays, 'monday'), false);
assert.equal(isCustomerScheduledForDay(fridayCust.visitDays, 'wednesday'), false);

const multiCust = extractCustomerVisitDays({ visit_days: ['الإثنين', 'الجمعة'] });
assert.equal(isCustomerScheduledForDay(multiCust.visitDays, 'monday'), true);
assert.equal(isCustomerScheduledForDay(multiCust.visitDays, 'friday'), true);
assert.equal(isCustomerScheduledForDay(multiCust.visitDays, 'wednesday'), false);

// Unscheduled customer is open to all days
assert.equal(isCustomerScheduledForDay([], 'monday'), true);
assert.equal(isCustomerScheduledForDay([], 'wednesday'), true);

// 4. Timezone resolution
const tzResult = getCurrentBusinessDay('Africa/Cairo');
assert.ok(['saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'].includes(tzResult.dayKey));
// 5. Rep-Specific Multi-Rep Schedules (e.g. Rep 21 on Sunday, Rep 22 on Thursday)
import { extractAssignedRepIds } from '../../src/modules/delivery-reps/rep-target.engine';

const multiRepCustMeta = {
  assigned_rep_ids: [21, 22],
  rep_schedules: [
    { repId: 21, repName: 'طاهر الطاهر', days: ['الأحد'] },
    { repId: 22, repName: 'أحمد محمود', days: ['الخميس'] },
  ],
};

// Check that both reps are extracted as assigned
const extractedReps = extractAssignedRepIds(multiRepCustMeta);
assert.deepEqual(extractedReps.sort(), [21, 22]);

// Test schedule resolution for Rep 21 (Sunday only)
const rep21Sched = multiRepCustMeta.rep_schedules.find((s) => s.repId === 21)!;
const rep21Days = extractCustomerVisitDays({ visit_days: rep21Sched.days });
assert.equal(isCustomerScheduledForDay(rep21Days.visitDays, 'sunday'), true);
assert.equal(isCustomerScheduledForDay(rep21Days.visitDays, 'thursday'), false);
assert.equal(isCustomerScheduledForDay(rep21Days.visitDays, 'wednesday'), false);

// Test schedule resolution for Rep 22 (Thursday only)
const rep22Sched = multiRepCustMeta.rep_schedules.find((s) => s.repId === 22)!;
const rep22Days = extractCustomerVisitDays({ visit_days: rep22Sched.days });
assert.equal(isCustomerScheduledForDay(rep22Days.visitDays, 'thursday'), true);
assert.equal(isCustomerScheduledForDay(rep22Days.visitDays, 'sunday'), false);
assert.equal(isCustomerScheduledForDay(rep22Days.visitDays, 'wednesday'), false);

console.log('✓ All Van Customer Schedule & Itinerary Day Filtering invariants passed successfully.');
