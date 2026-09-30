// Proof of payment: a correctly signed invoice plus a preimage whose SHA-256 is the invoice's payment hash.

import { decodeInvoice } from './bolt11.js';
import { bytesToHex, hexToBytes } from './bytes.js';
import { sha256 } from './sha256.js';

/** Accepts pasted hex with whitespace, upper case or a "0x" prefix. */
export function normalizeHex(input) {
  return String(input ?? '').replace(/\s+/g, '').replace(/^0x/i, '').toLowerCase();
}

/**
 * Verifies a proof of payment. Throws if the invoice cannot be decoded.
 * The preimage and the payment hash are optional; the payment hash is only cross-checked.
 */
export function verifyProof(bolt11, preimageInput, paymentHashInput) {
  const invoice = decodeInvoice(bolt11);
  const proof = {
    invoice,
    preimage: null,
    preimageHash: null,
    preimageMatches: null, // null: no preimage given
    preimageError: null,
    givenHash: null,
    givenHashMatches: null,
    proven: false,
  };

  const preimage = normalizeHex(preimageInput);
  if (preimage) {
    proof.preimageError = describePreimageError(preimage);
    if (!proof.preimageError) {
      proof.preimage = preimage;
      proof.preimageHash = bytesToHex(sha256(hexToBytes(preimage)));
      proof.preimageMatches = proof.preimageHash === invoice.paymentHash;
    }
  }

  const givenHash = normalizeHex(paymentHashInput);
  if (givenHash) {
    proof.givenHash = givenHash;
    proof.givenHashMatches = givenHash === invoice.paymentHash;
  }

  proof.proven = invoice.signature.valid && proof.preimageMatches === true;
  return proof;
}

function describePreimageError(preimage) {
  if (/^[0-9a-f]{64}$/.test(preimage)) return null;
  const invalidCharacters = /[^0-9a-f]/.test(preimage) ? ' and contains invalid characters' : '';
  return `A preimage is exactly 64 hexadecimal characters (0-9, a-f). This one has ${preimage.length} characters${invalidCharacters}.`;
}
