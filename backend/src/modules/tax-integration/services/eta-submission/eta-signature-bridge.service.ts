import { IsNumber, IsOptional, IsString } from 'class-validator';
import { Injectable, Inject, BadRequestException, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../../../../database/database.constants';
import { Database } from '../../../../database/database.types';
import { EtaSerializerService } from '../eta-serializer/eta-serializer.service';
import { TaxSettingsService } from '../tax-settings/tax-settings.service';

export interface CanonicalDocumentResult {
  saleId: number;
  docNo: string;
  canonicalJson: string;
  canonicalHashHex: string;
  canonicalHashBase64: string;
  etaDocument: any;
}

export class AttachSignatureDto {
  @IsNumber()
  saleId!: number;

  @IsString()
  cadesSignature!: string; // Base64 DER PKCS#7 / CAdES-BES

  // D9: signerCertificate is NEVER read by the service (only saleId +
  // cadesSignature are used) — accepted as optional (Package C trap).
  @IsOptional()
  @IsString()
  signerCertificate?: string;
}

@Injectable()
export class EtaSignatureBridgeService {
  private readonly logger = new Logger(EtaSignatureBridgeService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly etaSerializer: EtaSerializerService,
    private readonly taxSettings: TaxSettingsService,
  ) {}

  /**
   * Serializes sale and produces ETA-compliant canonical JSON and SHA-256 hash for local USB Token signer
   */
  async prepareCanonicalDocument(tenantId: string, saleId: number): Promise<CanonicalDocumentResult> {
    const rawDoc = await this.etaSerializer.serializeSaleToEtaFormat(tenantId, saleId);

    // Canonicalize according to ETA specs: key-ordered string serialization
    const canonicalJson = this.serializeCanonical(rawDoc);
    const hashHex = crypto.createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
    const hashBase64 = Buffer.from(hashHex, 'hex').toString('base64');

    await this.db
      .updateTable('sales')
      .set({
        eta_canonical_hash: hashHex,
      } as any)
      .where('id', '=', saleId)
      .where('tenant_id', '=', tenantId)
      .execute();

    return {
      saleId,
      docNo: rawDoc.internalID,
      canonicalJson,
      canonicalHashHex: hashHex,
      canonicalHashBase64: hashBase64,
      etaDocument: rawDoc,
    };
  }

  /**
   * Attaches the CAdES-BES signature returned from the local client USB Token bridge
   */
  async attachCadesSignature(tenantId: string, dto: AttachSignatureDto) {
    if (!dto.cadesSignature) {
      throw new BadRequestException('التوقيع الإلكتروني CAdES-BES مطلوب');
    }

    const sale = await this.db
      .selectFrom('sales')
      .select(['id', 'doc_no', 'eta_status'])
      .where('id', '=', dto.saleId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!sale) {
      throw new BadRequestException('الفاتورة غير موجودة');
    }

    await this.db
      .updateTable('sales')
      .set({
        eta_cades_signature: dto.cadesSignature,
        eta_status: 'ready_to_submit',
      } as any)
      .where('id', '=', dto.saleId)
      .where('tenant_id', '=', tenantId)
      .execute();

    return {
      success: true,
      saleId: dto.saleId,
      docNo: sale.doc_no,
      status: 'ready_to_submit',
      message: 'تم ختم الفاتورة بالتوقيع الإلكتروني CAdES-BES بنجاح، وهي جاهزة للإرسال إلى منظومة الضرائب المصرية.',
    };
  }

  /**
   * Recursive canonical string serializer for ETA documents
   */
  private serializeCanonical(obj: any): string {
    if (obj === null || obj === undefined) {
      return '""';
    }
    if (typeof obj === 'string') {
      return `"${obj.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    if (typeof obj === 'number' || typeof obj === 'boolean') {
      return `"${obj}"`;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.serializeCanonical(item)).join('');
    }
    if (typeof obj === 'object') {
      const sortedKeys = Object.keys(obj).sort();
      let result = '';
      for (const key of sortedKeys) {
        if (key === 'signatures') continue; // Signatures are excluded from hashing
        result += `"${key.toUpperCase()}"`;
        result += this.serializeCanonical(obj[key]);
      }
      return result;
    }
    return '""';
  }
}
