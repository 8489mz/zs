import { Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    // 0. Attempt to enable pgvector extension if supported by the PostgreSQL server environment
    await sql
      .raw(
        `
      DO $$
      BEGIN
        CREATE EXTENSION IF NOT EXISTS vector;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
      $$;
    `,
      )
      .execute(db);

    // 1. Create ai_knowledge_sources (Chatbase-style sources: documents, catalogs, policies, manuals)
    await sql`
      CREATE TABLE IF NOT EXISTS ai_knowledge_sources (
        id SERIAL PRIMARY KEY,
        tenant_id VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        source_type VARCHAR(50) NOT NULL DEFAULT 'document',
        content_hash VARCHAR(64),
        raw_text TEXT,
        file_url TEXT,
        file_size INTEGER DEFAULT 0,
        status VARCHAR(30) NOT NULL DEFAULT 'ready',
        chunk_count INTEGER NOT NULL DEFAULT 0,
        token_count INTEGER NOT NULL DEFAULT 0,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_by INTEGER,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      )
    `.execute(db);

    await sql`CREATE INDEX IF NOT EXISTS idx_ai_knowledge_sources_tenant ON ai_knowledge_sources(tenant_id, status)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_ai_knowledge_sources_type ON ai_knowledge_sources(tenant_id, source_type)`.execute(
      db,
    );

    // 2. Create ai_knowledge_chunks (Semantic chunks with vector embeddings & full-text search)
    await sql`
      CREATE TABLE IF NOT EXISTS ai_knowledge_chunks (
        id SERIAL PRIMARY KEY,
        tenant_id VARCHAR(50) NOT NULL,
        source_id INTEGER REFERENCES ai_knowledge_sources(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL DEFAULT 0,
        content TEXT NOT NULL,
        embedding JSONB,
        token_count INTEGER DEFAULT 0,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      )
    `.execute(db);

    await sql`CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_tenant_source ON ai_knowledge_chunks(tenant_id, source_id)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_gin_search ON ai_knowledge_chunks USING gin(to_tsvector('simple', content))`.execute(
      db,
    );

    // 3. Create ai_chat_sessions (Multi-turn conversational memory)
    await sql`
      CREATE TABLE IF NOT EXISTS ai_chat_sessions (
        id VARCHAR(64) PRIMARY KEY,
        tenant_id VARCHAR(50) NOT NULL,
        user_id INTEGER,
        title VARCHAR(255) NOT NULL DEFAULT 'محادثة جديدة',
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      )
    `.execute(db);

    await sql`CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_tenant_user ON ai_chat_sessions(tenant_id, user_id, updated_at DESC)`.execute(
      db,
    );

    // 4. Create ai_chat_messages (Session messages with reasoning steps & tool calls)
    await sql`
      CREATE TABLE IF NOT EXISTS ai_chat_messages (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(64) REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
        tenant_id VARCHAR(50) NOT NULL,
        role VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,
        reasoning_steps JSONB DEFAULT '[]'::jsonb,
        tool_calls JSONB DEFAULT '[]'::jsonb,
        suggested_questions JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      )
    `.execute(db);

    await sql`CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_session ON ai_chat_messages(session_id, id ASC)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_tenant ON ai_chat_messages(tenant_id)`.execute(db);
  },

  async down(db: Kysely<any>): Promise<void> {
    await sql`DROP TABLE IF EXISTS ai_chat_messages`.execute(db);
    await sql`DROP TABLE IF EXISTS ai_chat_sessions`.execute(db);
    await sql`DROP TABLE IF EXISTS ai_knowledge_chunks`.execute(db);
    await sql`DROP TABLE IF EXISTS ai_knowledge_sources`.execute(db);
  },
};
