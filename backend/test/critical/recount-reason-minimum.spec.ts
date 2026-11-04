import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { validate } from 'class-validator';
import { RecountStockCountItemDto } from '../../src/modules/inventory/dto/create-stock-count-session.dto';

/*
 * Q8 completion (INV-SPIRIT-REASON-LENGTHS): the recount reason
 * minimum lives in TWO places — the service (already reduced to
 * non-empty by the Q8 package) and this DTO, which still demanded 8
 * characters and rejected a one-word reason before the service ever
 * saw it. A single clear word is accepted and recorded as-is; the
 * reason stays required.
 */

async function main(): Promise<void> {
  const oneWord = Object.assign(new RecountStockCountItemDto(), { countedQty: 3, reason: 'تلف' });
  const violations = await validate(oneWord);
  assert.equal(violations.length, 0, 'a one-word recount reason passes DTO validation');

  const empty = Object.assign(new RecountStockCountItemDto(), { countedQty: 3, reason: '' });
  const emptyViolations = await validate(empty);
  assert.ok(emptyViolations.some((v) => v.property === 'reason'), 'an empty reason is still rejected');

  console.log('recount reason DTO checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
