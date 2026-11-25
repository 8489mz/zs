import { strict as assert } from 'node:assert';
import { escapeHtml, sanitizeRedirectPath } from '../../src/modules/tenant-subscription/sandbox-checkout-render.util';

// Regression coverage for invariant SBX-1 (ARCHITECTURE_INVARIANTS.md section 4).
//
// GET /api/tenant-subscription/sandbox-checkout and its POST completion build HTML by hand
// and serve it from the application's own origin. Every caller-supplied value used to be
// interpolated raw: planName, businessName, ref, gateway, currency, amount, planId and
// duration into the markup, and redirectUrl into BOTH an anchor href and a
// `window.location.href = "..."` string inside a <script>. A crafted link therefore ran
// script on the app origin in the session of whoever opened it, and sent them anywhere.

function testEscapingClosesMarkupInjection(): void {
  const payload = '"><script>alert(1)</script>';
  const escaped = escapeHtml(payload);

  assert.ok(!escaped.includes('<'), 'angle brackets must not survive');
  assert.ok(!escaped.includes('>'), 'angle brackets must not survive');
  assert.ok(!escaped.includes('"'), 'a double quote must not survive into an attribute');
  assert.equal(escaped, '&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');

  // Attribute breakout via a single quote is covered too.
  assert.equal(escapeHtml("' onmouseover='alert(1)"), '&#39; onmouseover=&#39;alert(1)');

  // The ampersand is escaped first, so an escaped sequence is not double-decoded.
  assert.equal(escapeHtml('&lt;'), '&amp;lt;');

  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');

  console.log('  -> Markup and attribute breakout characters are encoded.');
}

function testRedirectMustStaySameOrigin(): void {
  const fallback = '/settings/subscription';

  const rejected = [
    'https://evil.example',
    'http://evil.example',
    '//evil.example',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'settings/subscription',
    '',
    '   ',
    null,
    undefined,
  ];

  for (const candidate of rejected) {
    assert.equal(
      sanitizeRedirectPath(candidate),
      fallback,
      `${JSON.stringify(candidate)} must not be used as a redirect target`,
    );
  }

  // Backslash: browsers normalise it to '/', so '/\evil.example' would leave the origin.
  assert.equal(sanitizeRedirectPath('/' + String.fromCharCode(92) + 'evil.example'), fallback);

  // Control characters (CR/LF/NUL) must not survive into an href or a JS string.
  for (const code of [0, 9, 10, 13, 31, 127]) {
    assert.equal(
      sanitizeRedirectPath('/ok' + String.fromCharCode(code) + 'x'),
      fallback,
      `control character ${code} must be rejected`,
    );
  }

  console.log('  -> Absolute, protocol-relative, scheme and control-character targets are refused.');
}

function testLegitimatePathsSurvive(): void {
  const allowed = [
    '/settings/subscription',
    '/settings/subscription?tab=billing',
    '/ar/settings/subscription#plans',
    '/a/b/c',
  ];

  for (const candidate of allowed) {
    assert.equal(sanitizeRedirectPath(candidate), candidate, `${candidate} should be preserved`);
  }

  // Surrounding whitespace is trimmed, not treated as a rejection.
  assert.equal(sanitizeRedirectPath('  /settings/subscription  '), '/settings/subscription');

  console.log('  -> Ordinary same-origin paths are preserved unchanged.');
}

async function main(): Promise<void> {
  console.log('=== [ITEM 3] SANDBOX CHECKOUT OUTPUT ENCODING (SBX-1) ===\n');

  console.log('[Test 1] Reflected values cannot break out of the markup');
  testEscapingClosesMarkupInjection();

  console.log('[Test 2] The redirect target cannot leave this origin');
  testRedirectMustStaySameOrigin();

  console.log('[Test 3] Legitimate same-origin paths still work');
  testLegitimatePathsSurvive();

  console.log('\n=== ALL SANDBOX CHECKOUT RENDERING TESTS PASSED (3/3) ===');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
