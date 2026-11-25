/**
 * Pure Engine for Semantic Chunking, Embeddings, and Cosine Similarity.
 * Supports Google Gemini, OpenAI, and a deterministic local fallback.
 */

export interface TextChunk {
  chunkIndex: number;
  content: string;
  tokenCount: number;
}

export class AiEmbeddingEngine {
  /**
   * Split a large document or text into semantic chunks with a sliding window overlap.
   */
  static chunkText(text: string, maxCharsPerChunk: number = 800, overlapChars: number = 150): TextChunk[] {
    const clean = (text || '').trim();
    if (!clean) return [];

    // Split by paragraphs first to preserve semantic cohesion
    const paragraphs = clean.split(/\n\s*\n/);
    const chunks: TextChunk[] = [];
    let currentChunk = '';
    let chunkIndex = 0;

    for (const para of paragraphs) {
      const trimmedPara = para.trim();
      if (!trimmedPara) continue;

      if ((currentChunk + '\n\n' + trimmedPara).length <= maxCharsPerChunk) {
        currentChunk = currentChunk ? currentChunk + '\n\n' + trimmedPara : trimmedPara;
      } else {
        if (currentChunk) {
          chunks.push({
            chunkIndex: chunkIndex++,
            content: currentChunk.trim(),
            tokenCount: Math.ceil(currentChunk.length / 4),
          });

          // Sliding window overlap
          const overlapStart = Math.max(0, currentChunk.length - overlapChars);
          const overlap = currentChunk.substring(overlapStart);
          currentChunk = overlap + '\n\n' + trimmedPara;
        } else {
          // Single paragraph is longer than maxCharsPerChunk -> hard split by sentence or slice
          let subText = trimmedPara;
          while (subText.length > maxCharsPerChunk) {
            const slice = subText.substring(0, maxCharsPerChunk);
            chunks.push({
              chunkIndex: chunkIndex++,
              content: slice.trim(),
              tokenCount: Math.ceil(slice.length / 4),
            });
            subText = subText.substring(maxCharsPerChunk - overlapChars);
          }
          currentChunk = subText;
        }
      }
    }

    if (currentChunk.trim()) {
      chunks.push({
        chunkIndex: chunkIndex++,
        content: currentChunk.trim(),
        tokenCount: Math.ceil(currentChunk.length / 4),
      });
    }

    return chunks;
  }

  /**
   * Calculate Cosine Similarity between two numeric vectors.
   * Result is between -1.0 and 1.0 (1.0 = identical direction).
   */
  static cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (!vecA || !vecB || vecA.length === 0 || vecA.length !== vecB.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      const a = vecA[i];
      const b = vecB[i];
      dotProduct += a * b;
      normA += a * a;
      normB += b * b;
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Deterministic local pseudo-embedding (TF-IDF bag of hash terms)
   * used as an offline fallback when no cloud API key is configured.
   */
  static generateLocalEmbedding(text: string, dimensions: number = 128): number[] {
    const vector = new Array(dimensions).fill(0);
    const words = (text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean);
    if (words.length === 0) return vector;

    for (const word of words) {
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        hash = (hash << 5) - hash + word.charCodeAt(i);
        hash |= 0;
      }
      const idx = Math.abs(hash) % dimensions;
      vector[idx] += 1;
    }

    // Normalize vector
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (norm > 0) {
      for (let i = 0; i < dimensions; i++) {
        vector[i] = vector[i] / norm;
      }
    }
    return vector;
  }

  /**
   * Generate vector embedding via Gemini Embedding API (text-embedding-004)
   */
  static async getGeminiEmbedding(text: string, apiKey: string): Promise<number[] | null> {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/text-embedding-004',
          content: { parts: [{ text }] },
        }),
      });

      if (!res.ok) return null;
      const data = await res.json();
      return data?.embedding?.values || null;
    } catch {
      return null;
    }
  }

  /**
   * Generate vector embedding via OpenAI Embedding API (text-embedding-3-small)
   */
  static async getOpenAiEmbedding(text: string, apiKey: string, baseUrl?: string): Promise<number[] | null> {
    try {
      const host = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
      const res = await fetch(`${host}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: text,
        }),
      });

      if (!res.ok) return null;
      const data = await res.json();
      return data?.data?.[0]?.embedding || null;
    } catch {
      return null;
    }
  }
}
