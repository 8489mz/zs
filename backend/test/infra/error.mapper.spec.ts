import assert from 'node:assert/strict';
import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../src/common/errors/app-error';
import { mapToHttpException } from '../../src/common/mappers/error.mapper';

function run(): void {
  const mapped = mapToHttpException(new AppError('Supplier has outstanding balance', 'SUPPLIER_HAS_BALANCE', 400));
  assert.equal(mapped.getStatus(), 400);
  assert.deepEqual(mapped.getResponse(), {
    message: 'لا يمكن حذف المورد لأن عليه رصيدًا قائمًا.',
    code: 'SUPPLIER_HAS_BALANCE',
    details: null,
  });

  const fallback = mapToHttpException(new Error('x'));
  assert.equal(fallback.getStatus(), HttpStatus.INTERNAL_SERVER_ERROR);

  const notNull = mapToHttpException({
    code: '23502',
    column: 'national_id',
    message: 'null value in column "national_id" violates not-null constraint',
  });
  assert.equal(notNull.getStatus(), 400);
  assert.deepEqual(notNull.getResponse(), {
    message: '\u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u0642\u0648\u0645\u064a \u0645\u0637\u0644\u0648\u0628.',
    code: 'DB_NOT_NULL_VIOLATION',
    details: { column: 'national_id' },
  });

  const duplicate = mapToHttpException({
    code: '23505',
    constraint: 'hr_employees_employee_no_key',
    detail: 'Key (employee_no)=(001) already exists.',
    message: 'duplicate key value violates unique constraint "hr_employees_employee_no_key"',
  });
  assert.equal(duplicate.getStatus(), 409);
  assert.deepEqual(duplicate.getResponse(), {
    message: '\u0631\u0642\u0645 \u0627\u0644\u0645\u0648\u0638\u0641 \u0645\u0633\u062a\u062e\u062f\u0645 \u0628\u0627\u0644\u0641\u0639\u0644.',
    code: 'DUPLICATE_EMPLOYEE_NO',
    details: { constraint: 'hr_employees_employee_no_key', source: 'hr_employees_employee_no_key' },
  });

  const fk = mapToHttpException({
    code: '23503',
    message: 'insert or update on table "sales" violates foreign key constraint',
  });
  assert.equal(fk.getStatus(), 409);
  assert.deepEqual(fk.getResponse(), {
    message: '\u0644\u0627 \u064a\u0645\u0643\u0646 \u062a\u0646\u0641\u064a\u0630 \u0627\u0644\u0639\u0645\u0644\u064a\u0629 \u0644\u0623\u0646 \u0647\u0646\u0627\u0643 \u0628\u064a\u0627\u0646\u0627\u062a \u0645\u0631\u062a\u0628\u0637\u0629 \u0628\u0647\u0627.',
    code: 'DB_FOREIGN_KEY_VIOLATION',
    details: null,
  });
  const check = mapToHttpException({
    code: '23514',
    constraint: 'stock_transfers_location_diff',
    message: 'new row for relation "stock_transfers" violates check constraint "stock_transfers_location_diff"',
  });
  assert.equal(check.getStatus(), 400);
  assert.deepEqual(check.getResponse(), {
    message: 'قيمة غير صحيحة في أحد الحقول.',
    code: 'DB_CHECK_VIOLATION',
    details: { constraint: 'stock_transfers_location_diff' },
  });

  const invalidText = mapToHttpException({
    code: '22P02',
    message: 'invalid input syntax for type numeric: "NaN"',
  });
  assert.equal(invalidText.getStatus(), 400);
  assert.deepEqual(invalidText.getResponse(), {
    message: 'قيمة غير صحيحة في أحد الحقول.',
    code: 'DB_INVALID_TEXT_REPRESENTATION',
    details: { message: 'invalid input syntax for type numeric: "NaN"' },
  });
}

run();
process.stdout.write('error.mapper.spec.ts passed\n');
