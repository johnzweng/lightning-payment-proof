import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeInvoice, verifyProof, normalizeInvoice } from '../public/assets/lnproof/index.js';
import { bech32Decode, bech32Encode, bytesToWords } from '../public/assets/lnproof/bech32.js';
import { MAX_FIELDS, MAX_INVOICE_LENGTH, MAX_RAW_INVOICE_LENGTH, MAX_ROUTE_HOPS } from '../public/assets/lnproof/input.js';
import { independentCommand, preimageCommand, signatureCommand, shellQuote, PYTHON_DELIMITER } from '../public/assets/ui/commands.js';
import { displayText } from '../public/assets/ui/safe-text.js';
import { decodePublicKey, ecdsaRecover, ecdsaVerify } from '../public/assets/lnproof/secp256k1.js';
import { readProofParameters, proofUrl, MAX_PROOF_URL_LENGTH } from '../public/assets/ui/url.js';
import { REAL_PAYMENT, SPEC_VALID } from './fixtures.js';
import { hostileInvoice, INJECTION_PAYLOADS, tagged, textField, paymentField } from './security-fixtures.js';

const proof = verifyProof(REAL_PAYMENT.bolt11, REAL_PAYMENT.preimage);

test('raw invoice injection: malicious characters are rejected, not stripped into valid invoices', () => {
  for (const payload of INJECTION_PAYLOADS) {
    assert.throws(() => decodeInvoice(REAL_PAYMENT.bolt11 + payload));
    assert.throws(() => decodeInvoice(payload + REAL_PAYMENT.bolt11));
    assert.throws(() => decodeInvoice(REAL_PAYMENT.bolt11.slice(0, 30) + payload + REAL_PAYMENT.bolt11.slice(30)));
  }
  // Printable ASCII is allowed in generic Bech32 HRPs, but NOT in BOLT11 HRPs.
  const { words } = bech32Decode(REAL_PAYMENT.bolt11);
  for (const hrp of ['lnbc$(id)', 'lnbc`id`', 'lnbc";id;', 'lnbc<script>', 'lnbc500x']) {
    assert.throws(() => decodeInvoice(bech32Encode(hrp, words)));
  }
  assert.throws(() => normalizeInvoice({ toString() { throw new Error('must not be called'); } }), /must be text/);
});

test('preimage AND optional hash validation prevents raw data from reaching output', () => {
  for (const payload of INJECTION_PAYLOADS) {
    const pre = verifyProof(REAL_PAYMENT.bolt11, payload);
    assert.ok(pre.preimageError);
    assert.equal(pre.preimage, null);
    const hash = verifyProof(REAL_PAYMENT.bolt11, '', payload);
    assert.ok(hash.hashError);
    assert.equal(hash.givenHash, null);
  }
  for (const value of ['f'.repeat(257), ' '.repeat(257) + REAL_PAYMENT.preimage]) {
    assert.ok(verifyProof(REAL_PAYMENT.bolt11, value).preimageError);
    assert.ok(verifyProof(REAL_PAYMENT.bolt11, '', value).hashError);
  }
  const pasted = verifyProof('LIGHTNING:' + REAL_PAYMENT.bolt11.toUpperCase(), '0X' + REAL_PAYMENT.preimage.toUpperCase());
  assert.equal(pasted.proven, true);
});

test('output boundary revalidates every dynamic shell field even if upstream parsing is bypassed', () => {
  for (const payload of INJECTION_PAYLOADS) {
    assert.throws(() => independentCommand({ ...proof, invoice: { ...proof.invoice, bolt11: payload } }));
    assert.throws(() => independentCommand({ ...proof, preimage: payload }));
    assert.throws(() => preimageCommand(payload, 'linux'));
    assert.throws(() => preimageCommand(REAL_PAYMENT.preimage, payload));
    assert.throws(() => signatureCommand({ ...proof.invoice, nodeId: payload }));
    for (const field of ['signedMessageHex', 'derHex']) {
      assert.throws(() => signatureCommand({ ...proof.invoice, signature: { ...proof.invoice.signature, [field]: payload } }));
    }
  }
  assert.throws(() => independentCommand(proof, `print('ok')\n${PYTHON_DELIMITER}\ntouch INJECTED`));
  assert.throws(() => independentCommand(proof, 'x'.repeat(65537)));
  assert.throws(() => independentCommand(proof, '# hidden\u202e code'));
  for (const control of ['\x00', '\n', '\r', '\x1b', '\u202e', '\u2066', '\u0085']) {
    assert.throws(() => shellQuote(control));
  }
});

test('encoded descriptions remain data: raw signature bytes are unchanged, display controls are visible', () => {
  const text = '<img src=x onerror=alert(1)>\nVerified OK\r\x1b]52;c;YWJj\x07\u202eabc\u202c\\u001b';
  const invoice = decodeInvoice(hostileInvoice([textField('d', text)]));
  assert.equal(invoice.description, text);
  const shown = displayText(text);
  assert.ok(shown.includes('\\u001b'));
  assert.ok(shown.includes('\\u000aVerified OK'));
  assert.ok(shown.includes('\\u202e'));
  assert.ok(shown.includes('\\\\u001b'));
  assert.doesNotMatch(shown, /[\x00-\x1f\x7f-\x9f\u202e]/);
  assert.equal(displayText('ナンセンス 1杯 العربية'), 'ナンセンス 1杯 العربية');
  assert.equal(decodeInvoice(SPEC_VALID[2].bolt11).signature.valid, true);
});

test('bounded input, prefix, integers, field counts, route hops and fixed-field padding', () => {
  assert.throws(() => decodeInvoice(' '.repeat(MAX_RAW_INVOICE_LENGTH + 1)), /too long/);
  assert.throws(() => decodeInvoice('l'.repeat(MAX_INVOICE_LENGTH + 1)), /too long/);
  const { words } = bech32Decode(REAL_PAYMENT.bolt11);
  assert.throws(() => decodeInvoice(bech32Encode('lnbc' + '9'.repeat(80), words)), /prefix is too long/);
  assert.throws(() => decodeInvoice(hostileInvoice([tagged('x', Array(1023).fill(31))])), /out of range/);
  assert.throws(() => decodeInvoice(hostileInvoice([tagged('c', Array(1023).fill(31))])), /out of range/);
  assert.throws(() => decodeInvoice(hostileInvoice([tagged('x', Array(10).fill(31))])), /expiry is out of range/);
  assert.throws(() => decodeInvoice(hostileInvoice(Array.from({ length: MAX_FIELDS }, () => tagged('z', [])))), /too many fields/);
  const hop = bytesToWords(new Uint8Array(51));
  assert.throws(() => decodeInvoice(hostileInvoice(Array.from({ length: MAX_ROUTE_HOPS + 1 }, () => tagged('r', hop)))), /too many route hops/);
  assert.throws(() => decodeInvoice(hostileInvoice([tagged('r', bytesToWords(new Uint8Array(50)))])), /truncated/);
  const badPadding = [...paymentField];
  badPadding[badPadding.length - 1] |= 1;
  assert.throws(() => decodeInvoice(hostileInvoice([badPadding], { payment: false })), /padding/);
  assert.throws(() => decodeInvoice(hostileInvoice([tagged('p', [0])], { payment: false })), /no payment hash/);
  // A zero signature is decodable, but cannot prove anything or generate a node-key command.
  const invalid = decodeInvoice(hostileInvoice([], { node: false, signature: Array(104).fill(0) }));
  assert.equal(invalid.signature.valid, false);
  assert.equal(invalid.nodeId, null);
  assert.throws(() => signatureCommand(invalid), /receiver key/);
  assert.throws(() => decodeInvoice(hostileInvoice([], { signature: [...words.slice(-104, -2), 0, 4] })), /recovery id/);
});

test('crypto boundaries reject oversized compact signatures, invalid recovery IDs and noncanonical coordinates', () => {
  const hash = Buffer.from(proof.invoice.signature.signedHashHex, 'hex');
  const signature = Buffer.from(proof.invoice.signature.compactHex, 'hex');
  const key = Buffer.from(proof.invoice.nodeId, 'hex');
  assert.equal(ecdsaVerify(hash, signature, key), true);
  for (const invalid of [signature.subarray(1), Buffer.concat([signature, Buffer.from([0])])]) {
    assert.equal(ecdsaVerify(hash, invalid, key), false);
    assert.equal(ecdsaRecover(hash, invalid, 0), null);
  }
  for (const id of [NaN, Infinity, 0.5, -1, 4, undefined]) {
    assert.equal(ecdsaRecover(hash, signature, id), null);
  }
  const point = decodePublicKey(Buffer.from('02' + '0'.repeat(63) + '1', 'hex'));
  assert.ok(point);
  const p = 2n ** 256n - 2n ** 32n - 977n;
  const encoded = (x, y) => Buffer.from('04' + x.toString(16).padStart(64, '0') + y.toString(16).padStart(64, '0'), 'hex');
  assert.ok(decodePublicKey(encoded(point.x, point.y)));
  assert.equal(decodePublicKey(encoded(point.x + p, point.y)), null);
});

test('query/fragment URL decoding cannot bypass input validation or inject share parameters', () => {
  const previous = globalThis.location;
  try {
    for (const payload of INJECTION_PAYLOADS) {
      globalThis.location = { origin: 'https://example.test', pathname: '/', search: '?bolt11=' + encodeURIComponent(payload), hash: '' };
      assert.equal(readProofParameters().bolt11, payload);
      assert.throws(() => decodeInvoice(readProofParameters().bolt11));
      globalThis.location.search = '';
      globalThis.location.hash = '#pr=' + encodeURIComponent(payload);
      assert.equal(readProofParameters().bolt11, payload);
      assert.throws(() => decodeInvoice(readProofParameters().bolt11));
    }
    globalThis.location = { origin: 'https://example.test', pathname: '/proof/', search: '', hash: '' };
    const url = new URL(proofUrl({ bolt11: REAL_PAYMENT.bolt11, preimage: '"&evil=1#fragment' }));
    assert.equal(url.searchParams.size, 2);
    assert.equal(url.searchParams.get('evil'), null);
    assert.equal(url.hash, '');
    globalThis.location.search = '?' + 'x'.repeat(MAX_PROOF_URL_LENGTH);
    assert.throws(() => readProofParameters(), /too long/);
  } finally { globalThis.location = previous; }
});
