import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  parseImageDataUrl,
  isImageDataUrl,
  buildStorefrontMediaUrl,
  isAcceptableStoredImageRef,
  STOREFRONT_MEDIA_MAX_BYTES,
} from '../../src/modules/storefront/engines/storefront-media.engine';

// Regression coverage for SF-9 (ARCHITECTURE_INVARIANTS.md): storefront images are stored once as
// binary and API responses carry only short content-addressed URLs. Before, every product image was a
// base64 data URL inside products.metadata and the public catalog shipped them all inline.

const PIXEL_WEBP = Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=', 'base64');
const dataUrl = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString('base64')}`;

function testParse(): void {
  const ok = parseImageDataUrl(dataUrl('image/webp', PIXEL_WEBP));
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.image.mime, 'image/webp');
    assert.deepEqual(ok.image.bytes, PIXEL_WEBP);
    assert.equal(
      ok.image.sha256,
      createHash('sha256').update(PIXEL_WEBP).digest('hex'),
      'content-addressed by sha256 of the bytes',
    );
  }
  const jpg = parseImageDataUrl(dataUrl('image/jpg', PIXEL_WEBP));
  assert.ok(jpg.ok && jpg.image.mime === 'image/jpeg', 'image/jpg is normalised to image/jpeg');

  // SVG can carry script: never stored, never served.
  assert.deepEqual(parseImageDataUrl(dataUrl('image/svg+xml', Buffer.from('<svg onload="x()"/>'))), {
    ok: false,
    reason: 'UNSUPPORTED_TYPE',
  });
  assert.deepEqual(parseImageDataUrl('data:image/png;base64,'), { ok: false, reason: 'EMPTY' });
  assert.deepEqual(parseImageDataUrl('https://example.com/a.png'), { ok: false, reason: 'NOT_DATA_URL' });
  assert.deepEqual(parseImageDataUrl('data:image/png;charset=utf-8,abc'), { ok: false, reason: 'MALFORMED' });
  const huge = Buffer.alloc(STOREFRONT_MEDIA_MAX_BYTES + 1, 1);
  assert.deepEqual(parseImageDataUrl(dataUrl('image/png', huge)), { ok: false, reason: 'TOO_LARGE' });
}

function testRefs(): void {
  const sha = 'a'.repeat(64);
  const url = buildStorefrontMediaUrl(42, sha);
  assert.equal(url, `/api/storefront/media/42/${sha}`);
  assert.equal(isAcceptableStoredImageRef(url), true);
  assert.equal(isAcceptableStoredImageRef(''), true, 'empty = image removed');
  assert.equal(isAcceptableStoredImageRef('https://cdn.example.com/p.webp'), true, 'merchant-pasted absolute URL');
  assert.equal(isAcceptableStoredImageRef('/api/storefront/media/42/short'), false, 'malformed media URL');
  assert.equal(isAcceptableStoredImageRef('javascript:alert(1)'), false);
  assert.equal(isAcceptableStoredImageRef('/etc/passwd'), false);
  assert.equal(isAcceptableStoredImageRef('https://x.com/a.png" onerror="x'), false, 'no attribute injection');
  assert.equal(
    isAcceptableStoredImageRef(dataUrl('image/webp', PIXEL_WEBP)),
    false,
    'a data URL is never a stored reference',
  );
  assert.equal(isImageDataUrl(' data:image/webp;base64,AAAA'), true);
  assert.equal(isImageDataUrl(url), false);
}

testParse();
testRefs();
console.log('storefront-media.spec: all checks passed');
