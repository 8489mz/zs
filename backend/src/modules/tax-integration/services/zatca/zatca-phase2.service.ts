import { Injectable, Inject, BadRequestException, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { KYSELY_DB } from '../../../../database/database.constants';
import { Kysely, sql } from 'kysely';
import { Database } from '../../../../database/database.types';
import { TaxSettingsService } from '../tax-settings/tax-settings.service';
import { buildDocumentTax } from '../../engines/document-tax.engine';
import { getTenantTimezone, todayTenantDate, formatTenantTime24 } from '../../../../common/utils/tenant-timezone.util';
import { resolveZatcaSellerIdentity } from '../../engines/zatca-seller-identity.engine';
import { selectConfiguredTaxRow } from '../../engines/configured-tax-id.engine';

export interface ZatcaInvoiceData {
  invoiceNumber: string;
  uuid: string;
  issueDate: string; // YYYY-MM-DD
  issueTime: string; // HH:mm:ss
  invoiceType: 'simplified' | 'standard';
  sellerName: string;
  sellerVatNumber: string;
  sellerAddress: {
    street: string;
    buildingNumber: string;
    city: string;
    postalCode: string;
    district: string;
  };
  customerName: string;
  customerVatNumber?: string;
  customerAddress?: {
    street: string;
    city: string;
    postalCode?: string;
  };
  lineItems: Array<{
    id: number | string;
    name: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    vatAmount: number;
    vatRate: number; // e.g. 15
    total: number;
  }>;
  subtotal: number;
  vatTotal: number;
  totalWithVat: number;
  // INV-TAX-DOCUMENT-RATE-SINGLE-SOURCE: the document-level rate is
  // stated once, by the attested source (buildDocumentTax for the
  // database path, the explicit caller for the sync path). The
  // renderer never derives it from the first line.
  documentVatRate: number;
  previousInvoiceHash?: string;
  invoiceCounterValue?: number;
}

export interface ZatcaPhase2Result {
  ublXml: string;
  invoiceHash: string; // SHA-256 Base64
  qrCodeBase64: string; // Phase 2 TLV Base64
  digitalSignature: string; // ECDSA signature Base64
  publicKey: string; // Base64
  uuid: string;
  icv: number;
  previousHash: string;
}

@Injectable()
export class ZatcaPhase2Service {
  private readonly logger = new Logger(ZatcaPhase2Service.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly taxSettings: TaxSettingsService,
  ) {}

  /**
   * Synchronous ZATCA package builder from pre-assembled ZatcaInvoiceData
   * Used by tests and direct invoice processing without DB round-trip
   */
  generateZatcaPackage(
    data: ZatcaInvoiceData,
  ): Omit<ZatcaPhase2Result, 'icv' | 'previousHash'> & { icv: number; previousHash: string } {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const ublXml = this.buildUblXml(data);
    const invoiceHash = this.computeSha256(ublXml);
    const signature = this.signWithKey(invoiceHash, privateKey);

    const qrCodeBase64 = this.generatePhase2TlvQr({
      sellerName: data.sellerName,
      vatNumber: data.sellerVatNumber,
      timestamp: `${data.issueDate}T${data.issueTime}Z`,
      totalWithVat: data.totalWithVat.toFixed(2),
      vatTotal: data.vatTotal.toFixed(2),
      invoiceHash,
      signature,
      publicKey,
    });

    return {
      ublXml,
      invoiceHash,
      qrCodeBase64,
      digitalSignature: signature,
      publicKey,
      uuid: data.uuid,
      icv: data.invoiceCounterValue || 1,
      previousHash: data.previousInvoiceHash || '',
    };
  }

  /**
   * Builds complete ZATCA Phase 2 compliant invoice with dynamic cryptographic PIH chaining
   * Atomic Transaction + Row-level lock (FOR UPDATE) guarantees zero ICV collision or gap
   */
  async buildZatcaInvoice(tenantId: string, saleId: number, egsId?: string | number): Promise<ZatcaPhase2Result> {
    const settings = await this.taxSettings.getSettings(tenantId, 'ZATCA_SAUDI');

    return await this.db.transaction().execute(async (trx) => {
      const sale = await trx
        .selectFrom('sales')
        .selectAll()
        .where('id', '=', saleId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (sale.status !== 'posted') throw new BadRequestException('لا يمكن توقيع فاتورة غير مرحّلة');

      const items = await trx
        .selectFrom('sale_items')
        .selectAll()
        .where('sale_id', '=', saleId)
        .where('tenant_id', '=', tenantId)
        .execute();

      const customer = sale.customer_id
        ? await trx
            .selectFrom('customers')
            .selectAll()
            .where('id', '=', Number(sale.customer_id))
            .where('tenant_id', '=', tenantId)
            .executeTakeFirst()
        : null;

      // 1. Fetch or initialize EGS Unit with row-level lock (.forUpdate()) for sequential ICV & PIH guarantee
      if (sale.zatca_egs_id && egsId && Number(egsId) !== Number(sale.zatca_egs_id)) {
        throw new BadRequestException('الفاتورة مرتبطة بوحدة EGS مختلفة');
      }
      const selectedEgsId = sale.zatca_egs_id ?? egsId;
      let egs = selectedEgsId
        ? await trx
            .selectFrom('zatca_egs_units')
            .selectAll()
            .where('id', '=', String(selectedEgsId))
            .where('tenant_id', '=', tenantId)
            .where((eb) =>
              sale.branch_id == null ? eb('branch_id', 'is', null) : eb('branch_id', '=', Number(sale.branch_id)),
            )
            .forUpdate()
            .executeTakeFirst()
        : await trx
            .selectFrom('zatca_egs_units')
            .selectAll()
            .where('tenant_id', '=', tenantId)
            .where((eb) =>
              sale.branch_id == null ? eb('branch_id', 'is', null) : eb('branch_id', '=', Number(sale.branch_id)),
            )
            .where((eb) =>
              eb.or([
                eb('status', '=', 'production_active'),
                eb('status', '=', 'compliance_passed'),
                eb('status', '=', 'unregistered'),
              ]),
            )
            .orderBy(
              sql<number>`CASE status WHEN 'production_active' THEN 0 WHEN 'compliance_passed' THEN 1 ELSE 2 END`,
              'asc',
            )
            .orderBy('id', 'asc')
            .forUpdate()
            .executeTakeFirst();

      if (selectedEgsId && !egs) throw new BadRequestException('وحدة توقيع الفاتورة غير موجودة لهذا الفرع والمنشأة');

      if (!egs && (sale.zatca_icv != null || sale.zatca_hash || sale.zatca_uuid)) {
        throw new BadRequestException('وحدة توقيع الفاتورة السابقة غير موجودة؛ لا يمكن تغيير سلسلة التوقيع');
      }
      if (!egs && settings?.environment === 'production') {
        throw new BadRequestException('يجب تفعيل وحدة EGS بشهادة إنتاج قبل توليد فواتير الإنتاج');
      }

      // Auto-create default EGS unit if none exists
      if (!egs) {
        // A missing row cannot be FOR UPDATE locked. Serialize bootstrap on the
        // tenant row, then recheck the device before creating the first unit.
        await trx.selectFrom('tenants').select('id').where('id', '=', tenantId).forUpdate().executeTakeFirstOrThrow();
        egs = await trx
          .selectFrom('zatca_egs_units')
          .selectAll()
          .where('tenant_id', '=', tenantId)
          .where((eb) =>
            sale.branch_id == null ? eb('branch_id', 'is', null) : eb('branch_id', '=', Number(sale.branch_id)),
          )
          .where('status', 'in', ['production_active', 'compliance_passed', 'unregistered'])
          .orderBy(
            sql<number>`CASE status WHEN 'production_active' THEN 0 WHEN 'compliance_passed' THEN 1 ELSE 2 END`,
            'asc',
          )
          .orderBy('id', 'asc')
          .forUpdate()
          .executeTakeFirst();
      }
      if (!egs) {
        const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
          namedCurve: 'prime256v1',
          publicKeyEncoding: { type: 'spki', format: 'pem' },
          privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        });

        const newUnit = await trx
          .insertInto('zatca_egs_units')
          .values({
            tenant_id: tenantId,
            branch_id: sale.branch_id == null ? null : Number(sale.branch_id),
            device_uuid: crypto.randomUUID(),
            device_name: 'Main POS Unit 01',
            custom_id: 'POS-01',
            private_key_pem: privateKey,
            public_key_pem: publicKey,
            csr_content: null,
            compliance_csid: null,
            compliance_secret: null,
            compliance_request_id: null,
            production_csid: null,
            production_secret: null,
            // وحدة أُنشئت تلقائياً ولم تمر بالتسجيل لدى الهيئة (CSR ← شهادة امتثال
            // ← شهادة إنتاج) — لا يصح وسمها `production_active`. `unregistered`
            // مشمولة أصلاً في شرط الاختيار أعلاه فالسلوك لم يتغير، لكن الحالة صارت
            // صادقة ويمكن لشاشة الامتثال أن تميّزها. التسجيل الفعلي في
            // `zatca-onboarding.service.ts` هو ما يرفعها إلى `production_active`.
            status: 'unregistered',
            environment: settings?.environment === 'production' ? 'production' : 'sandbox',
            last_icv: 0,
            last_invoice_hash:
              'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMjRiMWUxMDhkNDQ3ZjhlNzY1ZmVhNGU3NDkyNDQ1NQ==',
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        egs = newUnit;
      }
      if (settings?.environment === 'production' && (egs.status !== 'production_active' || !egs.production_csid)) {
        throw new BadRequestException('شهادة إنتاج وحدة EGS غير مفعلة؛ لا يمكن توليد فاتورة إنتاج');
      }

      if (sale.zatca_icv != null || sale.zatca_hash || sale.zatca_uuid) {
        if (!sale.zatca_icv || !sale.zatca_hash || !sale.zatca_uuid || !sale.zatca_ubl_xml || !sale.zatca_qr) {
          throw new BadRequestException(
            'بيانات الفاتورة الإلكترونية السابقة غير مكتملة؛ يجب تسويتها قبل إعادة الإرسال',
          );
        }
        if (sale.zatca_egs_id && Number(sale.zatca_egs_id) !== Number(egs.id)) {
          throw new BadRequestException('الفاتورة موقعة بوحدة EGS مختلفة؛ أعد الإرسال بنفس الوحدة');
        }
        if (egsId && Number(egsId) !== Number(egs.id)) {
          throw new BadRequestException('الفاتورة مرتبطة بوحدة EGS مختلفة');
        }
        const savedQrFields = this.readTlvQr(sale.zatca_qr);
        if (
          savedQrFields.get(6) !== sale.zatca_hash ||
          savedQrFields.get(8) !== egs.public_key_pem ||
          !savedQrFields.get(7)
        ) {
          throw new BadRequestException('توقيع الفاتورة الإلكترونية المحفوظ لا يطابق وحدة EGS أو الهاش');
        }
        return {
          ublXml: sale.zatca_ubl_xml,
          invoiceHash: sale.zatca_hash,
          qrCodeBase64: sale.zatca_qr,
          digitalSignature: savedQrFields.get(7)!,
          publicKey: egs.public_key_pem,
          uuid: sale.zatca_uuid,
          icv: Number(sale.zatca_icv),
          previousHash: sale.zatca_prev_hash || '',
        };
      }

      const lastIcv = Number(egs.last_icv || 0);
      if (!Number.isSafeInteger(lastIcv) || lastIcv < 0 || !Number.isSafeInteger(lastIcv + 1)) {
        throw new BadRequestException('عداد فواتير وحدة EGS غير صالح');
      }
      const nextIcv = lastIcv + 1;
      const previousInvoiceHash =
        egs.last_invoice_hash ||
        'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMjRiMWUxMDhkNDQ3ZjhlNzY1ZmVhNGU3NDkyNDQ1NQ==';
      const invoiceUuid = crypto.randomUUID();

      const saleDate = new Date(sale.created_at || Date.now());
      // The e-invoice issue date AND time are the tenant's business
      // day/time of the sale instant — never the UTC day and never the
      // host's wall time (a 00:30 Cairo sale is issued on the Cairo
      // day at 00:30, not the previous UTC day at 22:30, and not a
      // Kuwait tenant's 00:30 stamped as the host's 23:30). The zone
      // is resolved once so date and time can never disagree. The `Z`
      // suffix on the QR timestamp is the pre-existing format
      // convention at both call sites — unchanged.
      const businessTimezone = await getTenantTimezone(trx, tenantId);
      const issueDate = todayTenantDate(businessTimezone, saleDate);
      const issueTime = formatTenantTime24(businessTimezone, saleDate);

      const isB2B = Boolean(customer?.tax_number);
      const invoiceType = isB2B ? 'standard' : 'simplified';

      // Unified document-tax engine (tax unification, package 1): the
      // signed document attests the POSTED invoice — per-line stored
      // allocations (net_line_total / allocated_tax) at document
      // precision — never a recomputation at a hardcoded rate. The
      // stored sale.tax_rate is the document rate; the posting gate
      // (Tax F1) owns whether that rate was lawful, not the signer.
      const documentTax = buildDocumentTax({
        rate: sale.tax_rate,
        pricesIncludeTax: Boolean(sale.prices_include_tax),
        documentDigits: 2,
        lines: items.map((item) => ({
          lineTotal: Number(item.line_total || 0),
          netLineTotal: item.net_line_total == null ? null : Number(item.net_line_total),
          allocatedDiscount: item.allocated_discount == null ? null : Number(item.allocated_discount),
          allocatedTax: item.allocated_tax == null ? null : Number(item.allocated_tax),
        })),
      });

      const lineItems = items.map((item, idx) => {
        const qty = Math.max(1, Number(item.qty || 1));
        const unitPrice = Number(item.unit_price || 0);
        const taxed = documentTax.lines[idx];

        return {
          id: idx + 1,
          name: item.product_name || `Item ${idx + 1}`,
          quantity: qty,
          unitPrice,
          subtotal: taxed.base,
          vatAmount: taxed.tax,
          vatRate: documentTax.rate,
          total: taxed.total,
        };
      });

      const calculatedSubtotal = documentTax.subtotal;
      const calculatedVat = documentTax.vatTotal;
      const calculatedTotal = documentTax.totalWithVat;

      // Seller identity from configuration (INV-ZATCA-SELLER-IDENTITY-AND-PROFILE):
      // the VAT number from the active ZATCA tax-settings row, the name
      // from companyName/storeName settings then the tenant business
      // name. No hardcoded demo name, no fabricated VAT fallback.
      // Deliberately unchanged: the structured seller address has no
      // configured source (settings hold one free-text address only),
      // so the address block below stays as-is until a structured
      // address settings surface exists.
      const identitySettings = await trx
        .selectFrom('settings')
        .select(['key', 'value'])
        .where('tenant_id', '=', tenantId)
        .where('key', 'in', ['companyName', 'storeName'])
        .execute();
      const identityRows = Array.isArray(identitySettings) ? identitySettings : [];
      const identityByKey = new Map(identityRows.map((row: any) => [row.key, row.value]));
      const tenantRow = await trx
        .selectFrom('tenants')
        .select(['business_name'])
        .where('id', '=', tenantId)
        .executeTakeFirst();
      // INV-CONFIGURED-TAX-ID-SINGLE-SOURCE: the ZATCA row is picked
      // by the shared selector (exact provider, no fallback — another
      // jurisdiction's registration must never sign). getSettings
      // above still supplies the environment only.
      const configuredTaxRows = await trx
        .selectFrom('tenant_tax_settings')
        .select(['provider', 'tax_id', 'is_active'])
        .where('tenant_id', '=', tenantId)
        .execute();
      const configuredTax = selectConfiguredTaxRow(configuredTaxRows, {
        provider: 'ZATCA_SAUDI',
        allowFallback: false,
      });
      const sellerIdentity = resolveZatcaSellerIdentity({
        taxId: configuredTax?.taxId,
        isActive: configuredTax?.isActive,
        companyName: identityByKey.get('companyName'),
        storeName: identityByKey.get('storeName'),
        businessName: tenantRow?.business_name,
      });

      const invoiceData: ZatcaInvoiceData = {
        invoiceNumber: sale.doc_no || `INV-${sale.id}`,
        uuid: invoiceUuid,
        issueDate,
        issueTime,
        invoiceType,
        sellerName: sellerIdentity.sellerName,
        sellerVatNumber: sellerIdentity.sellerVatNumber,
        sellerAddress: {
          street: 'شارع الملك فهد',
          buildingNumber: '1234',
          city: 'الرياض',
          postalCode: '12211',
          district: 'العليا',
        },
        customerName: sale.customer_name || customer?.name || 'عميل نقدي',
        customerVatNumber: customer?.tax_number || undefined,
        customerAddress: {
          street: customer?.address || 'الرياض',
          city: 'الرياض',
          postalCode: '12211',
        },
        lineItems,
        subtotal: calculatedSubtotal,
        vatTotal: Number(calculatedVat.toFixed(2)),
        totalWithVat: calculatedTotal,
        documentVatRate: documentTax.rate,
        previousInvoiceHash,
        invoiceCounterValue: nextIcv,
      };

      // 2. Generate XML, SHA-256 Hash and Signature using EGS Private Key
      const ublXml = this.buildUblXml(invoiceData);
      const invoiceHash = this.computeSha256(ublXml);
      const signature = this.signWithKey(invoiceHash, egs.private_key_pem);
      const publicKey = egs.public_key_pem;

      // 3. Generate Phase 2 QR Code (TLV with 8 tags)
      const qrCodeBase64 = this.generatePhase2TlvQr({
        sellerName: invoiceData.sellerName,
        vatNumber: invoiceData.sellerVatNumber,
        timestamp: `${invoiceData.issueDate}T${invoiceData.issueTime}Z`,
        totalWithVat: invoiceData.totalWithVat.toFixed(2),
        vatTotal: invoiceData.vatTotal.toFixed(2),
        invoiceHash,
        signature,
        publicKey,
      });

      // 4. Update EGS unit with next ICV and new hash to advance the chain
      await trx
        .updateTable('zatca_egs_units')
        .set({
          last_icv: nextIcv,
          last_invoice_hash: invoiceHash,
          updated_at: new Date(),
        })
        .where('id', '=', egs.id)
        .where('tenant_id', '=', tenantId)
        .execute();

      // 5. Save ZATCA audit details on the sale record
      await trx
        .updateTable('sales')
        .set({
          zatca_uuid: invoiceUuid,
          zatca_hash: invoiceHash,
          zatca_prev_hash: previousInvoiceHash,
          zatca_icv: nextIcv,
          zatca_egs_id: Number(egs.id),
          // `generated` لا `reported`: هذه الدالة تبني الفاتورة وتوقّعها محلياً
          // وتُقدّم سلسلة الـICV/PIH فقط — **لا يوجد أي اتصال بهيئة الزكاة هنا**
          // (ولا في أي مكان آخر؛ الموجود هو التسجيل CSR/CSID فقط). وسمها
          // `reported` كان يدّعي إبلاغاً لم يحدث، فتبدو الفواتير مكتملة الامتثال
          // ولا يلتقطها أي مسار إعادة إرسال لاحق. انظر البند O47.
          zatca_status: 'generated',
          zatca_qr: qrCodeBase64,
          zatca_ubl_xml: ublXml,
        })
        .where('id', '=', sale.id)
        .where('tenant_id', '=', tenantId)
        .execute();

      return {
        ublXml,
        invoiceHash,
        qrCodeBase64,
        digitalSignature: signature,
        publicKey,
        uuid: invoiceUuid,
        icv: nextIcv,
        previousHash: previousInvoiceHash,
      };
    });
  }

  /**
   * Generates ZATCA UBL 2.1 Compliant XML
   */
  buildUblXml(data: ZatcaInvoiceData): string {
    const typeCode = data.invoiceType === 'simplified' ? '0200000' : '0100000';
    // INV-TAX-DOCUMENT-RATE-SINGLE-SOURCE: the document-level rate is
    // the stated attested rate, never re-derived from the first line.
    const documentVatRate = data.documentVatRate;

    const linesXml = data.lineItems
      .map(
        (item) => `
    <cac:InvoiceLine>
        <cbc:ID>${item.id}</cbc:ID>
        <cbc:InvoicedQuantity unitCode="PCE">${item.quantity}</cbc:InvoicedQuantity>
        <cbc:LineExtensionAmount currencyID="SAR">${item.subtotal.toFixed(2)}</cbc:LineExtensionAmount>
        <cac:TaxTotal>
            <cbc:TaxAmount currencyID="SAR">${item.vatAmount.toFixed(2)}</cbc:TaxAmount>
            <cbc:RoundingAmount currencyID="SAR">${item.total.toFixed(2)}</cbc:RoundingAmount>
            <cac:TaxSubtotal>
                <cbc:TaxableAmount currencyID="SAR">${item.subtotal.toFixed(2)}</cbc:TaxableAmount>
                <cbc:TaxAmount currencyID="SAR">${item.vatAmount.toFixed(2)}</cbc:TaxAmount>
                <cac:TaxCategory>
                    <cbc:ID>S</cbc:ID>
                    <cbc:Percent>${item.vatRate.toFixed(2)}</cbc:Percent>
                    <cac:TaxScheme>
                        <cbc:ID>VAT</cbc:ID>
                    </cac:TaxScheme>
                </cac:TaxCategory>
            </cac:TaxSubtotal>
        </cac:TaxTotal>
        <cac:Item>
            <cbc:Name><![CDATA[${item.name}]]></cbc:Name>
            <cac:ClassifiedTaxCategory>
                <cbc:ID>S</cbc:ID>
                <cbc:Percent>${item.vatRate.toFixed(2)}</cbc:Percent>
                <cac:TaxScheme>
                    <cbc:ID>VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:ClassifiedTaxCategory>
        </cac:Item>
        <cac:Price>
            <cbc:PriceAmount currencyID="SAR">${item.unitPrice.toFixed(2)}</cbc:PriceAmount>
        </cac:Price>
    </cac:InvoiceLine>`,
      )
      .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
    <cbc:ProfileID>${data.invoiceType === 'standard' ? 'clearance:1.0' : 'reporting:1.0'}</cbc:ProfileID>
    <cbc:ID>${data.invoiceNumber}</cbc:ID>
    <cbc:UUID>${data.uuid}</cbc:UUID>
    <cbc:IssueDate>${data.issueDate}</cbc:IssueDate>
    <cbc:IssueTime>${data.issueTime}</cbc:IssueTime>
    <cbc:InvoiceTypeCode name="${typeCode}">${data.invoiceType === 'simplified' ? '388' : '388'}</cbc:InvoiceTypeCode>
    <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>
    <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>
    <cac:AdditionalDocumentReference>
        <cbc:ID>ICV</cbc:ID>
        <cbc:UUID>${data.invoiceCounterValue || 1}</cbc:UUID>
    </cac:AdditionalDocumentReference>
    <cac:AdditionalDocumentReference>
        <cbc:ID>PIH</cbc:ID>
        <cac:Attachment>
            <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${data.previousInvoiceHash || ''}</cbc:EmbeddedDocumentBinaryObject>
        </cac:Attachment>
    </cac:AdditionalDocumentReference>
    <cac:AccountingSupplierParty>
        <cac:Party>
            <cac:PartyIdentification>
                <cbc:ID schemeID="CRN">1010010101</cbc:ID>
            </cac:PartyIdentification>
            <cac:PostalAddress>
                <cbc:StreetName><![CDATA[${data.sellerAddress.street}]]></cbc:StreetName>
                <cbc:BuildingNumber>${data.sellerAddress.buildingNumber}</cbc:BuildingNumber>
                <cbc:CityName><![CDATA[${data.sellerAddress.city}]]></cbc:CityName>
                <cbc:PostalZone>${data.sellerAddress.postalCode}</cbc:PostalZone>
                <cbc:CountrySubentity><![CDATA[${data.sellerAddress.district}]]></cbc:CountrySubentity>
                <cac:Country>
                    <cbc:IdentificationCode>SA</cbc:IdentificationCode>
                </cac:Country>
            </cac:PostalAddress>
            <cac:PartyTaxScheme>
                <cbc:CompanyID>${data.sellerVatNumber}</cbc:CompanyID>
                <cac:TaxScheme>
                    <cbc:ID>VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:PartyTaxScheme>
            <cac:PartyLegalEntity>
                <cbc:RegistrationName><![CDATA[${data.sellerName}]]></cbc:RegistrationName>
            </cac:PartyLegalEntity>
        </cac:Party>
    </cac:AccountingSupplierParty>
    <cac:AccountingCustomerParty>
        <cac:Party>
            <cac:PostalAddress>
                <cbc:StreetName><![CDATA[${data.customerAddress?.street || 'الرياض'}]]></cbc:StreetName>
                <cbc:CityName><![CDATA[${data.customerAddress?.city || 'الرياض'}]]></cbc:CityName>
                <cac:Country>
                    <cbc:IdentificationCode>SA</cbc:IdentificationCode>
                </cac:Country>
            </cac:PostalAddress>
            <cac:PartyTaxScheme>
                <cbc:CompanyID>${data.customerVatNumber || '000000000000000'}</cbc:CompanyID>
                <cac:TaxScheme>
                    <cbc:ID>VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:PartyTaxScheme>
            <cac:PartyLegalEntity>
                <cbc:RegistrationName><![CDATA[${data.customerName}]]></cbc:RegistrationName>
            </cac:PartyLegalEntity>
        </cac:Party>
    </cac:AccountingCustomerParty>
    <cac:Delivery>
        <cbc:ActualDeliveryDate>${data.issueDate}</cbc:ActualDeliveryDate>
    </cac:Delivery>
    <cac:PaymentMeans>
        <cbc:PaymentMeansCode>10</cbc:PaymentMeansCode>
    </cac:PaymentMeans>
    <cac:TaxTotal>
        <cbc:TaxAmount currencyID="SAR">${data.vatTotal.toFixed(2)}</cbc:TaxAmount>
        <cac:TaxSubtotal>
            <cbc:TaxableAmount currencyID="SAR">${data.subtotal.toFixed(2)}</cbc:TaxableAmount>
            <cbc:TaxAmount currencyID="SAR">${data.vatTotal.toFixed(2)}</cbc:TaxAmount>
            <cac:TaxCategory>
                <cbc:ID>S</cbc:ID>
                <cbc:Percent>${documentVatRate.toFixed(2)}</cbc:Percent>
                <cac:TaxScheme>
                    <cbc:ID>VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:TaxCategory>
        </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:LegalMonetaryTotal>
        <cbc:LineExtensionAmount currencyID="SAR">${data.subtotal.toFixed(2)}</cbc:LineExtensionAmount>
        <cbc:TaxExclusiveAmount currencyID="SAR">${data.subtotal.toFixed(2)}</cbc:TaxExclusiveAmount>
        <cbc:TaxInclusiveAmount currencyID="SAR">${data.totalWithVat.toFixed(2)}</cbc:TaxInclusiveAmount>
        <cbc:AllowanceTotalAmount currencyID="SAR">0.00</cbc:AllowanceTotalAmount>
        <cbc:PayableAmount currencyID="SAR">${data.totalWithVat.toFixed(2)}</cbc:PayableAmount>
    </cac:LegalMonetaryTotal>
${linesXml}
</Invoice>`;
  }

  /**
   * Computes SHA-256 hash of invoice XML
   */
  computeSha256(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('base64');
  }

  /**
   * Signs SHA-256 hash with ECDSA private key
   */
  signWithKey(invoiceHash: string, privateKeyPem: string): string {
    const signer = crypto.createSign('SHA256');
    signer.update(invoiceHash);
    signer.end();
    return signer.sign(privateKeyPem, 'base64');
  }

  /**
   * Generates Phase 2 TLV QR Code (Tags 1 to 8)
   */
  generatePhase2TlvQr(params: {
    sellerName: string;
    vatNumber: string;
    timestamp: string;
    totalWithVat: string;
    vatTotal: string;
    invoiceHash: string;
    signature: string;
    publicKey: string;
  }): string {
    const buffers: Buffer[] = [
      this.toTlv(1, Buffer.from(params.sellerName, 'utf8')),
      this.toTlv(2, Buffer.from(params.vatNumber, 'utf8')),
      this.toTlv(3, Buffer.from(params.timestamp, 'utf8')),
      this.toTlv(4, Buffer.from(params.totalWithVat, 'utf8')),
      this.toTlv(5, Buffer.from(params.vatTotal, 'utf8')),
      this.toTlv(6, Buffer.from(params.invoiceHash, 'utf8')),
      this.toTlv(7, Buffer.from(params.signature, 'utf8')),
      this.toTlv(8, Buffer.from(params.publicKey, 'utf8')),
    ];

    return Buffer.concat(buffers).toString('base64');
  }

  private readTlvQr(encoded: string): Map<number, string> {
    const bytes = Buffer.from(encoded, 'base64');
    const fields = new Map<number, string>();
    for (let offset = 0; offset < bytes.length;) {
      if (offset + 2 > bytes.length) throw new BadRequestException('رمز QR المحفوظ غير مكتمل');
      const tag = bytes[offset];
      const length = bytes[offset + 1];
      offset += 2;
      if (offset + length > bytes.length) throw new BadRequestException('رمز QR المحفوظ غير صالح');
      fields.set(tag, bytes.subarray(offset, offset + length).toString('utf8'));
      offset += length;
    }
    return fields;
  }

  private toTlv(tagNum: number, valueBuffer: Buffer): Buffer {
    const tag = Buffer.from([tagNum]);
    const len = Buffer.from([valueBuffer.length]);
    return Buffer.concat([tag, len, valueBuffer]);
  }

  /**
   * Basic client-side validation helper for ZATCA invoice compliance checks
   */
  validateCompliance(data: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!data) {
      return { valid: false, errors: ['لا توجد بيانات للتحقق'] };
    }

    if (!data.sellerVatNumber || String(data.sellerVatNumber).length !== 15) {
      errors.push('رقم ضريبة البائع يجب أن يكون 15 خانة');
    }
    if (!data.invoiceNumber) {
      errors.push('رقم الفاتورة مطلوب');
    }
    if (!data.issueDate || !/^\d{4}-\d{2}-\d{2}$/.test(data.issueDate)) {
      errors.push('تاريخ الإصدار يجب أن يكون بصيغة YYYY-MM-DD');
    }
    if (!data.lineItems || !Array.isArray(data.lineItems) || data.lineItems.length === 0) {
      errors.push('يجب أن تحتوي الفاتورة على بند واحد على الأقل');
    }
    if (data.totalWithVat === undefined || data.totalWithVat < 0) {
      errors.push('الإجمالي شامل الضريبة يجب أن يكون قيمة موجبة');
    }

    return { valid: errors.length === 0, errors };
  }
}
