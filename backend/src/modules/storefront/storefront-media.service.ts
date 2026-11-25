import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import {
  buildStorefrontMediaUrl,
  isAcceptableStoredImageRef,
  isImageDataUrl,
  parseImageDataUrl,
} from './engines/storefront-media.engine';

/** SF-9: the only writer and reader of `storefront_media`. */
@Injectable()
export class StorefrontMediaService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  /**
   * Turns whatever the admin screen sent into a reference that is safe to store and cheap to ship:
   * a data URL is saved as binary and replaced by its media URL; an existing media URL or an http(s)
   * URL is kept; empty stays empty (image removed). Anything else is rejected.
   */
  async normalizeImageRef(tenantId: string, value: unknown): Promise<string> {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return '';

    if (isImageDataUrl(raw)) {
      const parsed = parseImageDataUrl(raw);
      if (!parsed.ok) {
        const message =
          parsed.reason === 'TOO_LARGE'
            ? 'حجم الصورة أكبر من المسموح (2 ميجابايت)'
            : parsed.reason === 'UNSUPPORTED_TYPE'
              ? 'نوع الصورة غير مدعوم (المسموح: WebP أو JPEG أو PNG)'
              : 'ملف الصورة غير صالح';
        throw new BadRequestException(message);
      }
      const { mime, bytes, sha256 } = parsed.image;
      // Dedupe per tenant by content: re-uploading the same picture reuses the row.
      const row = await this.db
        .insertInto('storefront_media')
        .values({ tenant_id: tenantId, sha256, mime_type: mime, byte_size: bytes.length, content: bytes })
        .onConflict((oc) => oc.columns(['tenant_id', 'sha256']).doUpdateSet({ sha256 }))
        .returning(['id'])
        .executeTakeFirstOrThrow();
      return buildStorefrontMediaUrl(Number(row.id), sha256);
    }

    // The admin UI may send back one of our own media URLs made absolute by the client (desktop /
    // dev servers prefix the API origin). Store the relative form so it works behind any host.
    const ownMedia = raw.match(/^https?:\/\/[^/]+(\/api\/storefront\/media\/\d+\/[0-9a-f]{64})$/i);
    if (ownMedia) return ownMedia[1];

    if (!isAcceptableStoredImageRef(raw)) {
      throw new BadRequestException('رابط الصورة غير صالح');
    }
    return raw;
  }

  /**
   * Public read. The URL carries both id and content hash; requiring both means ids cannot simply be
   * walked, and the response is immutable so it can be cached forever.
   */
  async getMedia(id: number, sha256: string): Promise<{ mime: string; content: Buffer }> {
    if (!Number.isInteger(id) || id <= 0 || !/^[0-9a-f]{64}$/.test(sha256)) {
      throw new NotFoundException('الصورة غير موجودة');
    }
    const row = await this.db
      .selectFrom('storefront_media')
      .select(['mime_type', 'content'])
      .where('id', '=', id)
      .where(sql<boolean>`sha256 = ${sha256}`)
      .executeTakeFirst();
    if (!row) throw new NotFoundException('الصورة غير موجودة');
    return { mime: row.mime_type, content: row.content };
  }
}
