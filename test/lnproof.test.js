import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { bech32Encode, CHARSET } from '../public/assets/lnproof/bech32.js';
import { bytesToHex } from '../public/assets/lnproof/bytes.js';
import { sha256 } from '../public/assets/lnproof/sha256.js';
import {
  decodeInvoice, decodeSparkAddress, encodeSparkAddress, verifyProof,
} from '../public/assets/lnproof/index.js';
import { REAL_PAYMENT, SPEC_INVALID, SPEC_NODE_ID, SPEC_VALID } from './fixtures.js';

describe('proof of payment (real-world invoice)', () => {
  test('a matching preimage proves the payment', () => {
    const proof = verifyProof(REAL_PAYMENT.bolt11, REAL_PAYMENT.preimage);
    const { invoice } = proof;
    assert.equal(invoice.paymentHash, REAL_PAYMENT.paymentHash);
    assert.equal(invoice.amountMsat, 28605000n);
    assert.equal(invoice.nodeId, REAL_PAYMENT.nodeId);
    assert.equal(invoice.signature.valid, true);
    assert.equal(invoice.signature.nodeIdInInvoice, true);
    assert.equal(invoice.signature.recoveredMatchesStated, true);
    assert.equal(invoice.routeHints.length, 2);
    assert.equal(invoice.routeHints[0][0].pubkey, '039174f846626c6053ba80f5443d0db33da384f1dde135bf7080ba1eec465019c3');
    assert.equal(proof.preimageMatches, true);
    assert.equal(proof.proven, true);
  });

  test('"lightning:" prefix, upper case and whitespace are accepted', () => {
    const pastedInvoice = 'lightning:' + REAL_PAYMENT.bolt11.toUpperCase().replace(/(.{60})/g, '$1\n');
    const pastedPreimage = ` 0x${REAL_PAYMENT.preimage.toUpperCase()} `;
    assert.equal(verifyProof(pastedInvoice, pastedPreimage).proven, true);
  });

  test('a wrong preimage is not a proof', () => {
    const proof = verifyProof(REAL_PAYMENT.bolt11, REAL_PAYMENT.preimage.replace(/^c/, 'd'));
    assert.equal(proof.preimageMatches, false);
    assert.equal(proof.proven, false);
  });

  test('without a preimage the invoice is checked but nothing is proven', () => {
    const proof = verifyProof(REAL_PAYMENT.bolt11, '');
    assert.equal(proof.invoice.signature.valid, true);
    assert.equal(proof.preimageMatches, null);
    assert.equal(proof.proven, false);
  });

  test('a malformed preimage gives an explanation', () => {
    assert.match(verifyProof(REAL_PAYMENT.bolt11, 'abc').preimageError, /64 hexadecimal characters.*has 3 characters/);
    assert.match(verifyProof(REAL_PAYMENT.bolt11, 'x'.repeat(64)).preimageError, /invalid characters/);
  });

  test('a given payment hash is cross-checked', () => {
    assert.equal(verifyProof(REAL_PAYMENT.bolt11, REAL_PAYMENT.preimage, REAL_PAYMENT.paymentHash).givenHashMatches, true);
    assert.equal(verifyProof(REAL_PAYMENT.bolt11, REAL_PAYMENT.preimage, '00'.repeat(32)).givenHashMatches, false);
  });

  test('changing a single character breaks the checksum', () => {
    const i = 40;
    const tampered = REAL_PAYMENT.bolt11.slice(0, i) + (REAL_PAYMENT.bolt11[i] === 'q' ? 'p' : 'q') + REAL_PAYMENT.bolt11.slice(i + 1);
    assert.throws(() => decodeInvoice(tampered), /checksum/);
  });

  test('input that is not an invoice gets a helpful message', () => {
    assert.throws(() => decodeInvoice(''), /paste a Lightning invoice/);
    assert.throws(() => decodeInvoice('bc1qxyz'), /starts with/);
  });
});

describe('BOLT #11 spec test vectors', () => {
  SPEC_VALID.forEach((vector, i) => {
    test(`valid vector #${i + 1}: signature, recovered node id and amount`, () => {
      const invoice = decodeInvoice(vector.bolt11);
      assert.equal(invoice.signature.valid, true);
      assert.equal(invoice.signature.nodeIdInInvoice, false);
      assert.equal(invoice.nodeId, SPEC_NODE_ID);
      assert.equal(invoice.amountMsat, vector.amountMsat);
      if (vector.description) assert.equal(invoice.description, vector.description);
      if (vector.paymentHash) assert.equal(invoice.paymentHash, vector.paymentHash);
    });
  });

  test('route hints are decoded (values from the spec text)', () => {
    const [hop] = decodeInvoice(SPEC_VALID[3].bolt11).routeHints[0];
    assert.equal(hop.pubkey, '03d06758583bb5154774a6eb221b1276c9e82d65bbaceca806d90e20c108f4b1c7');
    assert.equal(hop.shortChannelId.text, '589390x3312x1');
    assert.equal(hop.feeBaseMsat, 1000);
    assert.equal(hop.feeProportionalMillionths, 2500);
    assert.equal(hop.cltvExpiryDelta, 40);
  });

  SPEC_INVALID.forEach(({ reason, error, bolt11 }) => {
    test(`rejected: ${reason}`, () => {
      assert.throws(() => decodeInvoice(bolt11), error);
    });
  });
});

// Test vectors from the Spark SDK (github.com/buildonspark/spark, spark-sdk tests)
describe('Spark wallets', () => {
  test('address encoding matches the SDK test vector', () => {
    assert.equal(
      encodeSparkAddress('0353908bac090ba741de6147a540a665537006911590f93249b2823dbe187d3213', 'bcrt'),
      'sparkrt1pgssx5us3wkqjza8g80xz3a9gznx25msq6g3ty8exfym9q3ahcv86vsnxxdy83',
    );
  });

  test('legacy addresses are decoded, other strings are not', () => {
    const decoded = decodeSparkAddress('sprt1pgssx63fa5g6uyv450rajp5ndwy9laxzpsp9e37su58jddmcdsvhgm5n7y0ud6');
    assert.equal(decoded.identityPublicKey, '036a29ed11ae1195a3c7d906936b885ff4c20c025cc7d0e50f26b7786c19746e93');
    assert.equal(decoded.network, 'regtest (legacy)');
    assert.equal(decodeSparkAddress('lnbc1invalid'), null);
  });

  test('the legacy route-hint marker (scid f42400f424000001) is detected', () => {
    const invoice = decodeInvoice(REAL_PAYMENT.bolt11);
    assert.deepEqual(invoice.spark, {
      source: 'routehint',
      routeIndex: 1,
      identityPublicKey: '03c0c68088eba19e1e0a346a9fea30844264935a5c89411ce0d54b25e0e4d8aae4',
      address: 'spark1pgss8sxxszywhgv7rc9rg65lagcggsnyjdd9ez2prnsd2je9urjd32hywmnkhq',
      network: 'mainnet',
    });
    assert.equal(invoice.routeHints[0][0].sparkIdentity, false);
    assert.equal(invoice.routeHints[0][0].knownAs.label, 'Spark routing node');
    assert.equal(invoice.routeHints[1][0].knownAs, null);
  });

  test('a fallback field with version 31 is detected', () => {
    const invoice = decodeInvoice(invoiceWithSparkFallback());
    assert.equal(invoice.spark.source, 'fallback');
    assert.ok(invoice.spark.address.startsWith('sparkl1'));
    assert.equal(invoice.spark.identityPublicKey, '033a5d4eb469a7a759072290b39f68bfec0a1cccbed163059361219a625d7e23ec');
    assert.equal(invoice.spark.hasInvoiceFields, true);
  });

  test('normal invoices have no Spark wallet', () => {
    assert.equal(decodeInvoice(SPEC_VALID[3].bolt11).spark, null);
  });
});

describe('SHA-256', () => {
  const hex = (bytes) => bytesToHex(sha256(bytes));
  test('known answers (FIPS 180-4 examples and a multi-block message)', () => {
    assert.equal(hex(new Uint8Array(0)), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    assert.equal(hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.equal(hex(new Uint8Array(1000).fill(97)), '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });
});

/**
 * Builds an (unsigned) invoice around the Spark SDK's version-31 fallback sample.
 * The signature is all zeros: decoding works, only `signature.valid` is false.
 */
function invoiceWithSparkFallback() {
  const sparkInvoice = 'unknown1lwdcxzuntdschqemnwdu8w6npvcmrv7rwvesnsarewf4rj7fedehxzdt5d3khzvnjdeu8gcf4w3e8z6mxddaxwa3kwen8w6r4vak8v7n8deehxut8dfa8zut9vduk2em2xaers7rgw448v6rwvs6rsetywvcxzm34wfckw6rgv9kxg6nr0pa85ut8xpm8jem30yehz7r60pehqaty09ck27rrd468samgvs68qmtywenhga3jdd6xz6ecwqm8qcmrvdekkunxdfax2af5vahxverhw3urvwrxvvuxv7nkd5m8junyv5682vm6ddmhzatkxfjxwertx5ukvmtw09shwatkv4sngvn8v9khxurh0pckcergwpm827n3dde8vvm5wgspxv07';
  const toWords = (text) => Array.from(text, (c) => CHARSET.indexOf(c));
  const fallbackWords = toWords(sparkInvoice.slice('unknown1'.length, -6)); // the sample's data part
  const words = [
    ...toWords('pvjluez'), // timestamp
    ...toWords('pp5' + 'qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypq'), // payment hash field
    CHARSET.indexOf('f'), fallbackWords.length >> 5, fallbackWords.length & 31, ...fallbackWords,
    ...new Array(104).fill(0), // signature
  ];
  return bech32Encode('lnbc', words);
}
