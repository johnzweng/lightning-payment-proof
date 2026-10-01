// The shell output boundary: validate EVERY dynamic argument, then quote it as literal data.
// These token arrays are used unchanged by both the displayed command and its copy button.
import { isCanonicalInvoice, isHex, isNodeId, MAX_INVOICE_LENGTH } from '../lnproof/input.js';
import { SPKI_PREFIX_HEX } from '../lnproof/secp256k1.js';

const START = '(\nset -o pipefail &&\nworkdir="$(mktemp -d)" &&\ncd "$workdir" &&\n';
const OPENSSL_VERIFY = 'openssl ec -pubin -inform DER -in node.der -out node.pem 2>/dev/null &&\n' +
  'openssl dgst -sha256 -verify node.pem -signature signature.der invoice.bin\n)';
export const PYTHON_DELIMITER = 'LNPROOF_PYTHON';
export const MAX_SCRIPT_LENGTH = 65_536;

/** POSIX sh/bash/zsh single-argument quoting. Reject invisible controls even inside quotes. */
export function shellQuote(text) {
  if (typeof text !== 'string' || /[\x00-\x1f\x7f-\x9f\u061c\u200b\u200e\u200f\u2028-\u202e\u2060\u2066-\u2069\ufeff]/.test(text)) {
    throw new Error('Unsafe shell argument.');
  }
  return "'" + text.replace(/'/g, "'\\''") + "'";
}

function hexArg(value, length) {
  if (!isHex(value, length) || !length) throw new Error('Invalid hexadecimal command argument.');
  return shellQuote(value);
}

export function preimageCommand(preimage, os) {
  const hashCommand = { mac: 'shasum -a 256', linux: 'sha256sum' }[os];
  if (!hashCommand) throw new Error('Unsupported command platform.');
  return ["printf '%s' ", ['pre', hexArg(preimage, 64)], ` | xxd -r -p | ${hashCommand}`];
}

export function signatureCommand(invoice) {
  if (!isNodeId(invoice.nodeId)) throw new Error('No usable receiver key for signature command.');
  const { signedMessageHex, derHex } = invoice.signature;
  if (typeof signedMessageHex !== 'string' || !signedMessageHex.length || signedMessageHex.length > MAX_INVOICE_LENGTH * 2 ||
      signedMessageHex.length % 2 || typeof derHex !== 'string' || derHex.length > 144 || derHex.length % 2) {
    throw new Error('Invalid signature command data.');
  }
  return [START,
    "printf '%s' ", ['node', hexArg(SPKI_PREFIX_HEX + invoice.nodeId, SPKI_PREFIX_HEX.length + 66)], ' | xxd -r -p > node.der &&\n',
    "printf '%s' ", ['msg', hexArg(signedMessageHex, signedMessageHex.length)], ' | xxd -r -p > invoice.bin &&\n',
    "printf '%s' ", ['sig', hexArg(derHex, derHex.length)], ' | xxd -r -p > signature.der &&\n',
    OPENSSL_VERIFY];
}

/** null script selects the downloaded-file variant. Script content is trusted application code. */
export function independentCommand({ invoice, preimage }, script = null) {
  if (!isCanonicalInvoice(invoice.bolt11)) throw new Error('Invalid invoice command argument.');
  const args = [['inv', shellQuote(invoice.bolt11)]];
  if (preimage != null && preimage !== '') args.push(' ', ['pre', hexArg(preimage, 64)]);
  if (script === null) {
    return [START, 'python3 -I "$HOME/Downloads/verify_invoice.py" ', ...args, ' &&\n', OPENSSL_VERIFY];
  }
  if (typeof script !== 'string' || script.length > MAX_SCRIPT_LENGTH ||
      /[\x00-\x08\x0b-\x1f\x7f-\x9f\u061c\u200b\u200e\u200f\u2028-\u202e\u2060\u2066-\u2069\ufeff]/.test(script) || script.split('\n').includes(PYTHON_DELIMITER)) {
    throw new Error('Unsafe inline script framing.');
  }
  return [START, 'python3 -I - ', ...args, ` <<'${PYTHON_DELIMITER}' &&\n`,
    ['muted', script.trimEnd()], `\n${PYTHON_DELIMITER}\n`, OPENSSL_VERIFY];
}
