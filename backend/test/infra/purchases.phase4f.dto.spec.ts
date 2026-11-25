import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CreateCustomerPaymentDto,
  CreateSupplierPaymentDto,
} from '../../src/modules/purchases/dto/create-party-payment.dto';
import { UpsertPurchaseDto } from '../../src/modules/purchases/dto/upsert-purchase.dto';

function assertValid<T>(cls: new () => T, payload: unknown): void {
  const instance = plainToInstance(cls, payload);
  const errors = validateSync(instance as object);
  if (errors.length) throw new Error(`Expected valid payload, got ${errors.length} errors`);
}

function assertInvalid<T>(cls: new () => T, payload: unknown): void {
  const instance = plainToInstance(cls, payload);
  const errors = validateSync(instance as object);
  if (!errors.length) throw new Error('Expected invalid payload');
}

function run(): void {
  assertValid(UpsertPurchaseDto, {
    supplierId: 1,
    paymentType: 'credit',
    discount: 5,
    taxRate: 15,
    items: [{ productId: 1, qty: 2, cost: 10 }],
  });

  assertInvalid(UpsertPurchaseDto, {
    supplierId: 1,
    items: [],
  });

  assertValid(CreateSupplierPaymentDto, { supplierId: 1, amount: 10 });
  assertInvalid(CreateSupplierPaymentDto, { supplierId: 1, amount: 0 });

  assertValid(CreateCustomerPaymentDto, { customerId: 1, amount: 10 });
  assertInvalid(CreateCustomerPaymentDto, { customerId: 1, amount: 0 });

  process.stdout.write('purchases.phase4f.dto.spec.ts passed\n');
}

try {
  run();
} catch (error: unknown) {
  process.stderr.write(`purchases.phase4f.dto.spec.ts failed: ${String(error)}\n`);
  process.exit(1);
}
