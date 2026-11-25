/*
 * Reports day helpers take the business timezone explicitly now
 * (INV-SINGLE-SERVER-CLOCK-TENANT-TZ): the module-global resolver is gone.
 * The service resolves the tenant's settings.timezone per request and
 * threads it in; the helpers' no-argument default is the canonical
 * env-or-Cairo fallback, never UTC.
 */
import { strict as assert } from 'node:assert';
import {
  buildLastNDays,
  dateKey,
  getBusinessDayBounds,
  getDefaultBusinessTimezone,
} from '../../src/modules/reports/helpers/reports-range.helper';

const saleAt2330Utc = new Date('2026-04-08T23:30:00.000Z');

// Explicit zone: the same instant is the next day in Kuwait.
assert.equal(dateKey(saleAt2330Utc, 'Asia/Kuwait'), '2026-04-09');
const bounds = getBusinessDayBounds('2026-04-09T12:00:00.000Z', 'Asia/Kuwait');
assert.equal(bounds.key, '2026-04-09');
assert.equal(bounds.start.toISOString(), '2026-04-08T21:00:00.000Z');

// Explicit zone: Berlin.
assert.equal(dateKey(saleAt2330Utc, 'Europe/Berlin'), '2026-04-09');
const keys = buildLastNDays(2, 'Europe/Berlin', new Date('2026-04-09T10:00:00.000Z'));
assert.deepEqual(keys, ['2026-04-08', '2026-04-09']);

// Invalid zone: falls back to the canonical env-or-Cairo default, never UTC.
// 23:30 UTC is 01:30 Cairo the next day, so the Cairo fallback keys 04-09.
assert.equal(dateKey(saleAt2330Utc, 'Bad/Timezone'), '2026-04-09');
assert.equal(getDefaultBusinessTimezone(), process.env.BUSINESS_TIMEZONE || 'Africa/Cairo');
// No-argument calls use that same default.
assert.equal(dateKey(saleAt2330Utc), dateKey(saleAt2330Utc, getDefaultBusinessTimezone()));

console.log('reports-business-timezone.spec: ok');
