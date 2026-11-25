import { strict as assert } from 'node:assert';
import { AiEmbeddingEngine } from './ai-embedding.engine';

// 1. Chunking test
const sampleText = `
الفقرة الأولى: سياسة الاستبدال والاسترجاع تتيح للعميل إرجاع البضاعة خلال 14 يوماً من تاريخ الفاتورة.
يجب أن تكون البضاعة بحالتها الأصلية مع إرفاق أصل الفاتورة الإلكترونية.

الفقرة الثانية: الضمان يسري لمدة عام كامل ضد عيوب الصناعة ولا يشمل سوء الاستخدام أو الكسر.
يتم تسليم القطع المعيبة لمركز الصيانة في الفرع الرئيسي لفحصها خلال 48 ساعة.
`.trim();

const chunks = AiEmbeddingEngine.chunkText(sampleText, 200, 50);
assert.ok(chunks.length >= 2, 'Should create at least 2 chunks for long text');
assert.equal(chunks[0].chunkIndex, 0);
assert.ok(chunks[0].content.includes('سياسة الاستبدال'));

// 2. Cosine similarity test
const vecA = [1, 0, 0];
const vecB = [1, 0, 0];
const vecC = [0, 1, 0];

const simIdentical = AiEmbeddingEngine.cosineSimilarity(vecA, vecB);
const simOrthogonal = AiEmbeddingEngine.cosineSimilarity(vecA, vecC);

assert.ok(Math.abs(simIdentical - 1.0) < 0.0001, 'Identical vectors should have similarity ~ 1.0');
assert.ok(Math.abs(simOrthogonal - 0.0) < 0.0001, 'Orthogonal vectors should have similarity ~ 0.0');

// 3. Local embedding test
const text = 'فحص مبيعات ومنتجات الفرع';
const emb1 = AiEmbeddingEngine.generateLocalEmbedding(text, 64);
const emb2 = AiEmbeddingEngine.generateLocalEmbedding(text, 64);

assert.equal(emb1.length, 64);
assert.ok(
  Math.abs(AiEmbeddingEngine.cosineSimilarity(emb1, emb2) - 1.0) < 0.0001,
  'Same text should yield identical embedding',
);

console.log('ai-embedding.engine.spec: ok');
