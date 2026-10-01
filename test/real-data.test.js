import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { verifyProof } from '../public/assets/lnproof/index.js';

const privateDataUrl = new URL('./data/test_data_pre-images.csv', import.meta.url);
const exampleDataUrl = new URL('./data/test_data_pre-images.example.csv', import.meta.url);
const usingPrivateData = existsSync(privateDataUrl);
const dataUrl = usingPrivateData ? privateDataUrl : exampleDataUrl;

test('exported invoice/preimage pairs are valid payment proofs', { timeout: 300_000 }, (t) => {
  const rows = paymentRows(dataUrl);

  for (const { rowNumber, preimage, bolt11 } of rows) {
    try {
      const proof = verifyProof(bolt11, preimage);
      if (!proof.invoice.signature.valid) throw new Error('invoice signature is invalid');
      if (!proof.preimageMatches) throw new Error('preimage does not match the invoice payment hash');
      if (!proof.proven) throw new Error('pair was not accepted as a payment proof');
    } catch (error) {
      // Do not include invoices or preimages in failures: private data may identify payments.
      throw new Error(`CSV row ${rowNumber}: ${error.message}`);
    }
  }

  assert.ok(rows.length > 0);
  t.diagnostic(
    `verified ${rows.length} payment proof(s) from ${usingPrivateData ? 'the ignored private CSV' : 'the public example CSV'}`,
  );
});

function paymentRows(url) {
  const lines = readFileSync(fileURLToPath(url), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.shift() !== 'payment_preimage,bolt11') {
    throw new Error('Expected CSV header: payment_preimage,bolt11');
  }

  const rows = [];
  for (const [index, line] of lines.entries()) {
    if (!line) continue;
    const rowNumber = index + 2;
    const comma = line.indexOf(',');
    if (comma < 0 || line.indexOf(',', comma + 1) >= 0) {
      throw new Error(`CSV row ${rowNumber}: expected exactly two columns`);
    }
    const preimage = line.slice(0, comma);
    const bolt11 = line.slice(comma + 1);
    if (!/^[0-9a-fA-F]{64}$/.test(preimage)) {
      throw new Error(`CSV row ${rowNumber}: preimage is not 64 hexadecimal characters`);
    }
    if (!/^ln[a-z0-9]+$/i.test(bolt11)) {
      throw new Error(`CSV row ${rowNumber}: invoice contains unexpected characters`);
    }
    rows.push({ rowNumber, preimage, bolt11 });
  }
  return rows;
}
