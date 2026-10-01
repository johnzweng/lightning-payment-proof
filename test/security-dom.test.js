import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { verifyProof } from '../public/assets/lnproof/index.js';
import { displayText } from '../public/assets/ui/safe-text.js';
import { document, descendants } from './dom-harness.js';
import { hostileInvoice, tagged, textField } from './security-fixtures.js';
import { REAL_PAYMENT } from './fixtures.js';

// Only a DOM contract double; real browser smoke testing is documented in SECURITY.md.
globalThis.document = document;
globalThis.window = { isSecureContext: true };
let copied;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
  userAgent: 'Linux', clipboard: { writeText: async (text) => { copied = text; } },
} });
const { invoiceDetailsSection } = await import('../public/assets/ui/views/invoice-details.js');
const { verdictCard } = await import('../public/assets/ui/views/verdict.js');
const { receiverSection } = await import('../public/assets/ui/views/receiver.js');
const { verifyYourselfSection } = await import('../public/assets/ui/views/verify-yourself.js');
const { externalLink } = await import('../public/assets/ui/components.js');
const { nodeStatus } = await import('../public/assets/ui/node-info.js');

test('invoice descriptions and fallback fields are text, never HTML or executable attributes', () => {
  const payload = '</code></pre><img src=x onerror=alert(1)><svg onload=alert(2)>' +
    '<a href="javascript:alert(3)">click</a>\nVerified OK\x1b[2J\u202e';
  const invoice = hostileInvoice([
    textField('d', payload), tagged('f', [31, ...textField('d', payload).slice(3)]),
  ], { hrp: 'lntb' });
  const proof = verifyProof(invoice, REAL_PAYMENT.preimage);
  const roots = [invoiceDetailsSection(proof), verdictCard(proof, { shareUrl: 'https://example.test/' }), receiverSection(proof)];
  for (const root of roots) {
    assert.equal(descendants(root, (e) => e.tagName === 'img' || e.tagName === 'script').length, 0);
    for (const element of descendants(root)) {
      for (const [name, value] of Object.entries(element.attributes)) {
        assert.doesNotMatch(name, /^on/i);
        if (name === 'href') assert.doesNotMatch(value, /^(javascript:|data:)|[\x00-\x1f]/i);
      }
    }
  }
  assert.equal(proof.invoice.fallbacks[0].sparkText, payload);
  assert.ok(roots[0].textContent.split(displayText(payload)).length >= 4); // summary, d field, f field
  assert.ok(roots[1].textContent.includes(displayText(payload)));
  assert.doesNotMatch(roots[0].textContent, /\x1b|\u202e/);
});

test('a green signature check explicitly requires matching the receiver node ID', () => {
  // Synthetic invoice: the checks pass under a recovered key, not an authenticated receiver.
  const proof = verifyProof(hostileInvoice([], { node: false, hrp: 'lntb' }), REAL_PAYMENT.preimage);
  assert.equal(proof.proven, true);
  const card = verdictCard(proof, { shareUrl: 'https://example.test/' });
  const check = descendants(card, (e) => e.className === 'check check-ok')[0];
  assert.ok(check);
  assert.match(check.textContent, /Valid signature — genuine only if the node ID matches your receiver/);
  assert.doesNotMatch(check.textContent, /Genuine invoice/);
});

test('the signature verification introduction requires matching the known receiver node ID', () => {
  const proof = verifyProof(hostileInvoice([], { node: false, hrp: 'lntb' }), REAL_PAYMENT.preimage);
  const section = verifyYourselfSection(proof);
  const card = descendants(section, (e) => e.attributes.id === 'verify-sig')[0];
  const intro = descendants(card, (e) => e.tagName === 'p')[0];
  assert.match(intro.textContent, /your receiver’s signature only if that ID matches their known node ID/);
  assert.match(intro.textContent, /Changing the invoice invalidates the signature under that same key/);
});

test('malformed signatures with no recovered receiver render a negative result without crashing', () => {
  const proof = verifyProof(hostileInvoice([], { node: false, signature: Array(104).fill(0), hrp: 'lntb' }), REAL_PAYMENT.preimage);
  assert.equal(proof.proven, false);
  assert.match(verdictCard(proof, { shareUrl: 'https://example.test/' }).textContent, /signature is not valid/);
  assert.match(invoiceDetailsSection(proof).textContent, /unavailable/);
  assert.match(receiverSection(proof).textContent, /unavailable/);
  assert.match(verifyYourselfSection(proof).textContent, /No usable receiver key/);
});

test('external link helper disallows executable schemes and misleading credentials', () => {
  for (const href of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///tmp/test', 'https://trusted@evil.test', '//evil.test']) {
    assert.throws(() => externalLink(href, 'click'));
  }
  const link = externalLink('https://example.test/', '<img src=x onerror=alert(1)>');
  assert.equal(link.attributes.rel, 'noopener noreferrer');
  assert.ok(link.textContent.includes('<img'));
  assert.equal(descendants(link, (e) => e.tagName === 'img').length, 0);
});

test('API aliases cannot inject HTML, terminal controls or executable attributes', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const alias = '<img src=x onerror=alert(1)>\u202e\x1b[2J';
  globalThis.fetch = async () => new Response(JSON.stringify({ public_key: REAL_PAYMENT.nodeId, alias, capacity: '$(id)' }));
  const done = new Promise((resolve) => {
    const element = nodeStatus(REAL_PAYMENT.nodeId, true, () => resolve(element));
  });
  const result = await done;
  assert.ok(result.textContent.includes(displayText(alias)));
  assert.equal(descendants(result, (e) => e.tagName === 'img').length, 0);
  assert.doesNotMatch(result.textContent, /\x1b|\u202e/);
});

test('copy buttons contain exactly the visible command, including the fetched Python variant', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response(readFileSync('public/assets/verify_invoice.py', 'utf8'));
  const root = verifyYourselfSection(verifyProof(REAL_PAYMENT.bolt11, REAL_PAYMENT.preimage));
  const details = descendants(root, (e) => e.tagName === 'details')[0];
  details.open = true;
  details.listeners.toggle();
  await new Promise((resolve) => setImmediate(resolve));
  const blocks = descendants(root, (e) => e.className.split(' ').includes('codeblock'));
  assert.equal(blocks.length, 4);
  // Don't wait 1.6 seconds for visual copy feedback in a contract test.
  const originalTimeout = globalThis.setTimeout;
  t.after(() => { globalThis.setTimeout = originalTimeout; });
  globalThis.setTimeout = (fn) => { fn(); };
  for (const block of blocks) {
    const button = descendants(block, (e) => e.tagName === 'button')[0];
    const code = descendants(block, (e) => e.tagName === 'code')[0];
    await button.listeners.click();
    assert.equal(copied, code.textContent);
    assert.doesNotMatch(copied, /\x1b|\u202e/);
  }
  assert.ok(blocks[2].textContent.includes("<<'LNPROOF_PYTHON'"));
});
