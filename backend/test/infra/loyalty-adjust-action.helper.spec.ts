/* Pins INV-LOYALTY-STALE-LABELS: an unspecified action on the manual-adjust
   endpoint is recorded as 'manual_adjust' — never silently as a purchase
   earn or a discount redemption. */

import assert from 'node:assert/strict';
import { resolveLoyaltyAdjustActionType } from '../../src/modules/partners/helpers/loyalty-adjust-action.helper';

assert.equal(resolveLoyaltyAdjustActionType(undefined), 'manual_adjust');
assert.equal(resolveLoyaltyAdjustActionType('manual_adjust'), 'manual_adjust');
assert.equal(resolveLoyaltyAdjustActionType('earn'), 'earn');
assert.equal(resolveLoyaltyAdjustActionType('redeem'), 'redeem');
assert.equal(resolveLoyaltyAdjustActionType('bogus'), 'manual_adjust');

console.log('loyalty adjust action helper checks passed');
