import { Inject, Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { KYSELY_DB } from '../../../database/database.constants';
import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AiEmbeddingEngine } from '../engines/ai-embedding.engine';

export interface KnowledgeSearchResult {
  chunkId: number;
  sourceId: number;
  sourceTitle: string;
  sourceType: string;
  content: string;
  similarity: number;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AiKnowledgeService {
  private readonly logger = new Logger(AiKnowledgeService.name);

  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  /**
   * Ingest and vectorize a new document, policy, or text into the knowledge base (Chatbase style)
   */
  async addSource(
    dto: {
      title: string;
      sourceType?: string;
      rawText: string;
      fileUrl?: string;
      metadata?: Record<string, unknown>;
    },
    actor: AuthContext,
    apiKey?: string,
    provider: 'gemini' | 'openai' | 'custom' = 'gemini',
  ) {
    const { tenantId } = requireTenantScope(actor);
    const userId = actor.userId;
    const title = (dto.title || '').trim();
    const rawText = (dto.rawText || '').trim();
    const sourceType = dto.sourceType || 'document';

    if (!title || !rawText) {
      throw new Error('Title and content are required for knowledge source.');
    }

    const contentHash = crypto.createHash('sha256').update(rawText).digest('hex');

    // 1. Insert source header
    const source = await this.db
      .insertInto('ai_knowledge_sources')
      .values({
        tenant_id: tenantId,
        title,
        source_type: sourceType,
        content_hash: contentHash,
        raw_text: rawText,
        file_url: dto.fileUrl || null,
        file_size: Buffer.byteLength(rawText, 'utf8'),
        status: 'processing',
        chunk_count: 0,
        token_count: Math.ceil(rawText.length / 4),
        metadata: JSON.stringify(dto.metadata || {}) as any,
        created_by: userId || null,
      })
      .returning(['id', 'title', 'source_type', 'status'])
      .executeTakeFirstOrThrow();

    // 2. Chunk text
    const chunks = AiEmbeddingEngine.chunkText(rawText, 700, 120);

    // 3. Generate embeddings and insert chunks
    let insertedCount = 0;
    for (const chunk of chunks) {
      let embedding: number[] | null = null;

      if (apiKey && apiKey.trim()) {
        if (provider === 'openai' || apiKey.startsWith('sk-')) {
          embedding = await AiEmbeddingEngine.getOpenAiEmbedding(chunk.content, apiKey);
        } else {
          embedding = await AiEmbeddingEngine.getGeminiEmbedding(chunk.content, apiKey);
        }
      }

      if (!embedding) {
        embedding = AiEmbeddingEngine.generateLocalEmbedding(chunk.content, 128);
      }

      await this.db
        .insertInto('ai_knowledge_chunks')
        .values({
          tenant_id: tenantId,
          source_id: source.id,
          chunk_index: chunk.chunkIndex,
          content: chunk.content,
          embedding: JSON.stringify(embedding || []) as any,
          token_count: chunk.tokenCount,
          metadata: JSON.stringify({ ...(dto.metadata || {}), chunk_index: chunk.chunkIndex }) as any,
        })
        .execute();

      insertedCount++;
    }

    // 4. Mark source ready
    await this.db
      .updateTable('ai_knowledge_sources')
      .set({
        status: 'ready',
        chunk_count: insertedCount,
        updated_at: new Date(),
      })
      .where('id', '=', source.id)
      .where('tenant_id', '=', tenantId)
      .execute();

    return {
      id: source.id,
      title: source.title,
      sourceType: source.source_type,
      chunksCount: insertedCount,
      status: 'ready',
    };
  }

  /**
   * Search knowledge base using hybrid semantic cosine similarity + full text search
   */
  async searchKnowledge(
    query: string,
    actor: AuthContext,
    apiKey?: string,
    provider: 'gemini' | 'openai' | 'custom' = 'gemini',
    limit: number = 4,
  ): Promise<KnowledgeSearchResult[]> {
    const { tenantId } = requireTenantScope(actor);
    const q = (query || '').trim();
    if (!q) return [];

    // 1. Generate query embedding
    let queryEmbedding: number[] | null = null;
    if (apiKey && apiKey.trim()) {
      if (provider === 'openai' || apiKey.startsWith('sk-')) {
        queryEmbedding = await AiEmbeddingEngine.getOpenAiEmbedding(q, apiKey);
      } else {
        queryEmbedding = await AiEmbeddingEngine.getGeminiEmbedding(q, apiKey);
      }
    }
    if (!queryEmbedding) {
      queryEmbedding = AiEmbeddingEngine.generateLocalEmbedding(q, 128);
    }

    // 2. Fetch candidate chunks for tenant
    const rows = await this.db
      .selectFrom('ai_knowledge_chunks as c')
      .innerJoin('ai_knowledge_sources as s', 's.id', 'c.source_id')
      .select([
        'c.id as chunk_id',
        'c.source_id',
        's.title as source_title',
        's.source_type',
        'c.content',
        'c.embedding',
        'c.metadata',
      ])
      .where('c.tenant_id', '=', tenantId)
      .where('s.status', '=', 'ready')
      .execute();

    if (!rows || rows.length === 0) return [];

    // 3. Compute hybrid score (Cosine similarity + keyword match boost)
    const qLower = q.toLowerCase();
    const scored = rows.map((r) => {
      let sim = 0;
      let emb = r.embedding as any;
      if (typeof emb === 'string') {
        try {
          emb = JSON.parse(emb);
        } catch {
          emb = null;
        }
      }
      if (Array.isArray(emb) && queryEmbedding && emb.length === queryEmbedding.length) {
        sim = AiEmbeddingEngine.cosineSimilarity(queryEmbedding, emb);
      }

      // Keyword boost
      const contentLower = (r.content || '').toLowerCase();
      let keywordBoost = 0;
      const terms = qLower.split(/\s+/).filter((t) => t.length > 2);
      for (const t of terms) {
        if (contentLower.includes(t)) {
          keywordBoost += 0.08;
        }
      }

      const totalScore = Math.min(1.0, Math.max(0, sim + keywordBoost));

      let meta = r.metadata as any;
      if (typeof meta === 'string') {
        try {
          meta = JSON.parse(meta);
        } catch {
          meta = undefined;
        }
      }

      return {
        chunkId: r.chunk_id,
        sourceId: r.source_id,
        sourceTitle: r.source_title,
        sourceType: r.source_type,
        content: r.content,
        similarity: Number(totalScore.toFixed(4)),
        metadata: meta as Record<string, unknown> | undefined,
      };
    });

    // 4. Sort descending and pick top K
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit);
  }

  /**
   * List all knowledge sources for a tenant
   */
  async listSources(actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);
    return this.db
      .selectFrom('ai_knowledge_sources')
      .select(['id', 'title', 'source_type', 'status', 'chunk_count', 'token_count', 'created_at', 'updated_at'])
      .where('tenant_id', '=', tenantId)
      .orderBy('id', 'desc')
      .execute();
  }

  /**
   * Delete a knowledge source
   */
  async deleteSource(sourceId: number, actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);
    await this.db
      .deleteFrom('ai_knowledge_sources')
      .where('id', '=', sourceId)
      .where('tenant_id', '=', tenantId)
      .execute();
    return { success: true };
  }

  /**
   * Auto-index active product catalog into a specialized knowledge source
   * allowing semantic search across products and specifications.
   */
  async autoIndexProducts(actor: AuthContext, apiKey?: string, provider: 'gemini' | 'openai' | 'custom' = 'gemini') {
    const { tenantId } = requireTenantScope(actor);

    const products = await this.db
      .selectFrom('products as p')
      .leftJoin('product_categories as pc', 'pc.id', 'p.category_id')
      .select([
        'p.id',
        'p.name',
        'p.barcode',
        'pc.name as category',
        'p.stock_qty',
        'p.retail_price',
        'p.cost_price',
        'p.notes',
      ])
      .where('p.tenant_id', '=', tenantId)
      .where('p.is_active', '=', true)
      .limit(300)
      .execute();

    if (products.length === 0) {
      return { message: 'No active products to index.' };
    }

    // Build rich text cards
    const catalogCards = products.map((p) => {
      const parts = [
        `المنتج: ${p.name}`,
        p.barcode ? `الباركود: ${p.barcode}` : '',
        p.category ? `التصنيف: ${p.category}` : '',
        `السعر: ${Number(p.retail_price || 0)} ج.م`,
        `الرصيد بالمخزن: ${Number(p.stock_qty || 0)} وحدة`,
        p.notes ? `المواصفات والاستخدام: ${p.notes}` : '',
      ].filter(Boolean);
      return parts.join(' | ');
    });

    const fullCatalogText = catalogCards.join('\n\n');

    // Remove older auto-indexed catalog source if exists
    await this.db
      .deleteFrom('ai_knowledge_sources')
      .where('tenant_id', '=', tenantId)
      .where('source_type', '=', 'catalog_auto')
      .execute();

    return this.addSource(
      {
        title: 'كتالوج الأصناف والمواصفات التلقائي',
        sourceType: 'catalog_auto',
        rawText: fullCatalogText,
        metadata: { product_count: products.length },
      },
      actor,
      apiKey,
      provider,
    );
  }
}
