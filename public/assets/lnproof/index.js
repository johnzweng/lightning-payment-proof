// lnproof — dependency-free BOLT11 decoding and Lightning proof-of-payment verification.
// Runs entirely locally (browser or Node.js); nothing is ever sent anywhere.

export { decodeInvoice, normalizeInvoice } from './bolt11.js';
export { verifyProof, normalizeHex } from './proof.js';
export { decodeSparkAddress, encodeSparkAddress } from './spark.js';
export { SPKI_PREFIX_HEX } from './secp256k1.js';
