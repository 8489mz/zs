import assert from 'node:assert/strict';
import { PurchasesController } from '../../src/modules/purchases/purchases.controller';
import { PurchasesService } from '../../src/modules/purchases/purchases.service';
import { SupplierPaymentSchedulesService } from '../../src/modules/purchases/services/supplier-payment-schedules.service';
import { BadRequestException } from '@nestjs/common';

async function run(): Promise<void> {
  const service = {
    getPurchaseAttachment: async () => ({ attachment: { file_url: 'safe.pdf' } }),
  } as unknown as PurchasesService;

  const controller = new PurchasesController(service, {} as unknown as SupplierPaymentSchedulesService);

  // 1. Double extension check
  const file1 = {
    originalname: 'invoice.pdf.exe',
    size: 1024,
    mimetype: 'application/x-msdownload',
    filename: 'random-uuid.exe',
  } as any;
  assert.throws(() => controller.uploadAttachment(file1), BadRequestException);

  // 2. Dangerous extension check
  const dangerousExts = ['.exe', '.bat', '.cmd', '.ps1', '.js', '.html', '.svg', '.zip', '.rar'];
  for (const ext of dangerousExts) {
    const file2 = {
      originalname: `malicious${ext}`,
      size: 1024,
      mimetype: 'text/plain',
      filename: `random-uuid${ext}`,
    } as any;
    assert.throws(() => controller.uploadAttachment(file2), BadRequestException);
  }

  // 3. Valid file check
  const file3 = {
    originalname: 'invoice.pdf',
    size: 1024,
    mimetype: 'application/pdf',
    filename: 'random-uuid.pdf',
  } as any;
  const result = controller.uploadAttachment(file3);
  assert.strictEqual(result.fileName, 'invoice.pdf');
  assert.strictEqual(result.fileUrl, 'random-uuid.pdf');

  // 4. Download path traversal check
  const maliciousService = {
    getPurchaseAttachment: async () => ({ attachment: { file_url: '../../etc/passwd' } }),
  } as unknown as PurchasesService;
  const maliciousController = new PurchasesController(
    maliciousService,
    {} as unknown as SupplierPaymentSchedulesService,
  );
  const res = {
    sendFile: () => {},
  } as any;

  await assert.rejects(
    maliciousController.downloadPurchaseAttachment(1, 1, { authContext: {} } as any, res),
    BadRequestException,
  );
}

run()
  .then(() => {
    process.stdout.write('file-upload.security.spec.ts passed\n');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
