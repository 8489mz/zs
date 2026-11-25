import { strict as assert } from 'node:assert';
import {
  ZatcaPhase2Service,
  ZatcaInvoiceData,
} from '../src/modules/tax-integration/services/zatca/zatca-phase2.service';
import { PosTerminalService } from '../src/modules/sales/services/pos-terminal.service';

async function runTests() {
  console.log('--- Starting Comprehensive New Features Audit ---');

  // ==========================================
  // Test 1: ZATCA Phase 2 E-Invoicing Engine
  // ==========================================
  console.log('Testing ZATCA Phase 2 E-Invoicing...');
  const zatcaService = new ZatcaPhase2Service({} as any, {} as any);

  const sampleInvoice: ZatcaInvoiceData = {
    invoiceNumber: 'INV-2026-0001',
    uuid: 'a3f12345-6789-4abc-def0-123456789abc',
    issueDate: '2026-09-04',
    issueTime: '07:30:00',
    invoiceType: 'simplified',
    sellerName: 'شركة التقنية للحلول السحابية',
    sellerVatNumber: '310000000000003',
    sellerAddress: {
      street: 'طريق الملك فهد',
      buildingNumber: '100',
      city: 'الرياض',
      postalCode: '12211',
      district: 'العليا',
    },
    customerName: 'عميل نقدي',
    lineItems: [
      {
        id: 1,
        name: 'منتج أ تجريبي',
        quantity: 2,
        unitPrice: 50,
        subtotal: 100,
        vatAmount: 15,
        vatRate: 15,
        total: 115,
      },
      {
        id: 2,
        name: 'منتج ب تجريبي',
        quantity: 1,
        unitPrice: 200,
        subtotal: 200,
        vatAmount: 30,
        vatRate: 15,
        total: 230,
      },
    ],
    subtotal: 300,
    vatTotal: 45,
    totalWithVat: 345,
    documentVatRate: 15,
    previousInvoiceHash: 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMjRiMWUxMDhkNDQ3ZjhlNzY1ZmVhNGU3NDkyNDQ1NQ==',
    invoiceCounterValue: 1,
  };

  const zatcaResult = zatcaService.generateZatcaPackage(sampleInvoice);

  // Assert UBL XML conforms
  assert.ok(zatcaResult.ublXml.includes('<Invoice'), 'UBL XML must have root Invoice element');
  assert.ok(
    zatcaResult.ublXml.includes('xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"'),
    'Must have UBL 2.1 namespace',
  );
  assert.ok(zatcaResult.ublXml.includes('<cbc:ID>INV-2026-0001</cbc:ID>'), 'Must include invoice number');
  assert.ok(zatcaResult.ublXml.includes('310000000000003'), 'Must include seller VAT number');
  assert.ok(zatcaResult.ublXml.includes('345.00'), 'Must include total with VAT');

  // Assert SHA-256 hash
  assert.ok(zatcaResult.invoiceHash.length > 20, 'Invoice hash must be valid Base64 SHA-256 string');

  // Assert Digital Signature & Public Key
  assert.ok(zatcaResult.digitalSignature.length > 20, 'Digital signature must be generated');
  assert.ok(zatcaResult.publicKey.length > 20, 'Public key must be generated');

  // Assert Phase 2 TLV QR Code
  assert.ok(zatcaResult.qrCodeBase64.length > 50, 'Phase 2 QR must be generated');
  const qrBuffer = Buffer.from(zatcaResult.qrCodeBase64, 'base64');
  assert.ok(qrBuffer.length > 0, 'QR buffer must not be empty');

  // Decode TLV tags from QR code
  let offset = 0;
  const decodedTags = new Map<number, string>();
  while (offset < qrBuffer.length) {
    const tag = qrBuffer.readUInt8(offset);
    offset += 1;
    const len = qrBuffer.readUInt8(offset);
    offset += 1;
    const val = qrBuffer.subarray(offset, offset + len).toString('utf8');
    offset += len;
    decodedTags.set(tag, val);
  }

  assert.equal(decodedTags.get(1), sampleInvoice.sellerName, 'TLV Tag 1 must be Seller Name');
  assert.equal(decodedTags.get(2), sampleInvoice.sellerVatNumber, 'TLV Tag 2 must be Seller VAT#');
  assert.equal(
    decodedTags.get(3),
    `${sampleInvoice.issueDate}T${sampleInvoice.issueTime}Z`,
    'TLV Tag 3 must be timestamp',
  );
  assert.equal(decodedTags.get(4), '345.00', 'TLV Tag 4 must be total amount');
  assert.equal(decodedTags.get(5), '45.00', 'TLV Tag 5 must be VAT total');
  assert.equal(decodedTags.get(6), zatcaResult.invoiceHash, 'TLV Tag 6 must be invoice hash');
  assert.ok(decodedTags.has(7), 'TLV Tag 7 must be ECDSA signature');
  assert.ok(decodedTags.has(8), 'TLV Tag 8 must be Public Key');

  // Compliance validation tests
  const validCheck = zatcaService.validateCompliance(sampleInvoice);
  assert.equal(validCheck.valid, true, 'Valid sample should pass compliance');

  const invalidVatCheck = zatcaService.validateCompliance({ ...sampleInvoice, sellerVatNumber: '123456' });
  assert.equal(invalidVatCheck.valid, false, 'Invalid VAT must fail compliance check');
  console.log('✓ ZATCA Phase 2 tests passed successfully');

  // ==========================================
  // Test 2: POS Card Terminal (EDC) Gateway
  // ==========================================
  console.log('Testing POS Card Terminal (EDC) Gateway...');
  const terminalService = new PosTerminalService();

  const terminals = await terminalService.getTerminals('test-tenant');
  assert.ok(terminals.length > 0, 'Should have at least 1 terminal configured');

  const session = await terminalService.initiatePayment('test-tenant', {
    amount: 150.5,
    currency: 'SAR',
    terminalId: terminals[0].id,
  });

  assert.ok(session.transactionId.startsWith('EDC-'), 'Transaction ID must start with EDC-');
  assert.equal(session.status, 'pending', 'Initial status must be pending');
  assert.equal(session.amount, 150.5, 'Amount must match');

  // Check status after initiation
  const statusAfter = await terminalService.getPaymentStatus('test-tenant', session.transactionId);
  assert.equal(statusAfter.transactionId, session.transactionId);

  // Cancellation test
  const cancelResult = await terminalService.cancelPayment('test-tenant', session.transactionId);
  assert.equal(cancelResult.status, 'cancelled', 'Cancelled transaction must have status cancelled');

  console.log('✓ POS Terminal tests passed successfully');

  console.log('--- ALL COMPREHENSIVE NEW FEATURE TESTS PASSED! ---');
}

runTests().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
