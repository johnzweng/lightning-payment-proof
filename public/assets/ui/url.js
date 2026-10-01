// Proof links: ?bolt11=…&preimage=… (or the same in the #fragment, which never reaches any server).

import { normalizeHex, normalizeInvoice } from '../lnproof/index.js';

export const MAX_PROOF_URL_LENGTH = 131_072;

const PARAMETER_NAMES = {
  bolt11: ['bolt11', 'invoice', 'pr'],
  preimage: ['preimage', 'pre'],
  hash: ['hash', 'payment_hash', 'paymenthash'],
};

/** A fragment like "#verify" is an in-page anchor; "#bolt11=…" carries proof parameters. */
export const hasFragmentParameters = () => location.hash.includes('=');

/** @returns {{ bolt11: string, preimage: string, hash: string }} empty strings when absent */
export function readProofParameters() {
  if (location.search.length + location.hash.length > MAX_PROOF_URL_LENGTH) throw new Error('Proof link is too long.');
  const query = new URLSearchParams(location.search);
  const fragment = new URLSearchParams(hasFragmentParameters() ? location.hash.slice(1) : '');
  const read = (names) => names.map((name) => query.get(name) || fragment.get(name)).find(Boolean) ?? '';
  return {
    bolt11: read(PARAMETER_NAMES.bolt11),
    preimage: read(PARAMETER_NAMES.preimage),
    hash: read(PARAMETER_NAMES.hash),
  };
}

/** The shareable link for a proof, on the page's own origin and path. */
export function proofUrl({ bolt11, preimage }) {
  const query = new URLSearchParams({ bolt11: normalizeInvoice(bolt11).toLowerCase() });
  if (preimage) query.set('preimage', normalizeHex(preimage));
  return `${location.origin}${location.pathname}?${query}`;
}
