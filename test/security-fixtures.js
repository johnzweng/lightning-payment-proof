// Synthetic attacker-controlled invoices, never private payment data.
import { bech32Decode, bech32Encode, bytesToWords, CHARSET } from '../public/assets/lnproof/bech32.js';
import { REAL_PAYMENT } from './fixtures.js';

const { hrp, words } = bech32Decode(REAL_PAYMENT.bolt11);
const timestamp = words.slice(0, 7);
const signature = words.slice(-104);
export const paymentField = tagged('p', bytesToWords(Buffer.from(REAL_PAYMENT.paymentHash, 'hex')));
export const nodeField = tagged('n', bytesToWords(Buffer.from(REAL_PAYMENT.nodeId, 'hex')));

export function tagged(tag, data) {
  if (data.length > 1023) throw new Error('Fixture field too long');
  return [CHARSET.indexOf(tag), data.length >> 5, data.length & 31, ...data];
}

export function hostileInvoice(fields = [], options = {}) {
  return bech32Encode(options.hrp ?? hrp, [
    ...timestamp, ...(options.payment === false ? [] : paymentField),
    ...(options.node === false ? [] : nodeField), ...fields.flat(), ...(options.signature ?? signature),
  ]);
}

export const textField = (tag, text) => tagged(tag, bytesToWords(Buffer.from(text, 'utf8')));
export const commandText = (tokens) => tokens.map((token) => typeof token === 'string' ? token : token[1]).join('');
export const INJECTION_PAYLOADS = [
  '$(touch INJECTED)', '`touch INJECTED`', '";touch INJECTED;#', "';touch INJECTED;#",
  '${IFS}touch${IFS}INJECTED', "${x:-$(touch INJECTED)}", "$'\\x1b[2J'", '%s%n\\c', '!touch INJECTED',
  '$(id)', 'a|touch INJECTED', 'a&&touch INJECTED', 'a;touch INJECTED',
  '<(touch INJECTED)', '>(touch INJECTED)', 'a > INJECTED', 'a\\\n;touch INJECTED',
  '\nEOF\ntouch INJECTED\n', '\nLNPROOF_PYTHON\ntouch INJECTED\n',
  '</script><img src=x onerror=alert(1)>', '<svg/onload=alert(1)>', 'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>', '../../INJECTED', '--help', '-c touch INJECTED',
  '\x00', '\x1b]52;c;YXR0YWNr\x07', '\x1b[2J\x1b[H', '\rVerified OK', '\b', '\u009b2J',
  '\u202eVerified OK\u202c', '\u2066spoof\u2069', '\ufeff', '\u200b', '\u00a0',
  'ｌｎｂｃ', '\u212a',
];
