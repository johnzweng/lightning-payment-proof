// "Why this proves the payment": the lock/secret story, the hash equation, and the fine print.

import { hexShort, hexValue, section } from '../components.js';
import { h, icon } from '../dom.js';
import { formatDate, formatSats } from '../format.js';

// Descriptions of hosted (custodial) wallets, where the fine print about services matters most.
const HOSTED_WALLET_HINT = /wallet of satoshi|custod|coinos|strike|blink|getalby|cash app|primal|minibits|cashu/i;

export function explanationSection(proof) {
  return section('why', {
    eyebrow: 'Explained in 1 minute',
    title: 'Why this proves the payment',
    lead: 'Lightning payments work like a lock that only opens with a secret key — and opening it hands the key to the payer.',
  },
    story(proof),
    hashEquation(proof),
    h('div', { class: 'why-grid' },
      whyCard('shield', 'Why can’t this be faked?',
        'Computing a fingerprint from a secret takes a microsecond. Going the other way — finding a secret that fits a given ' +
        'fingerprint — is practically impossible, even with all computers in the world. That is the same SHA-256 that secures Bitcoin itself.'),
      whyCard('key', 'So the sender must have paid',
        'The sender can only know the secret because the receiver’s node revealed it — and Lightning nodes reveal it only when ' +
        'they accept a payment of at least the invoice amount. The receipt is the proof.')),
    finePrint(proof.invoice));
}

function story({ invoice, preimage }) {
  return h('ol', { class: 'story' },
    storyStep(1, 'lock', 'The receiver creates a secret', [
      h('p', null, 'When the receiver created the invoice, their wallet picked a random secret — the ', h('b', { class: 'c-pre' }, 'preimage'),
        ' — and kept it to itself. Only the secret’s fingerprint, the ', h('b', { class: 'c-hash' }, 'payment hash'),
        ', went into the invoice. The receiver’s node ', h('b', { class: 'c-node' }, 'signed'), ' the invoice, so nobody can alter it.'),
      storyToken('fingerprint in the invoice', hexShort(invoice.paymentHash, 'hash')),
    ]),
    storyStep(2, 'bolt', 'The payment is locked to it', [
      h('p', null, 'The sender’s money travels through the Lightning Network locked to that fingerprint. ' +
        'Whoever wants to take it must reveal the secret that produces exactly this fingerprint.'),
      storyToken('amount', h('strong', null, invoice.amountMsat != null ? formatSats(invoice.amountMsat) : 'any amount')),
    ]),
    storyStep(3, 'key', 'Taking the money reveals the secret', [
      h('p', null, 'To collect the money, the receiver’s node has to reveal the secret. It travels back to the sender’s wallet as a receipt. The sender has it:'),
      storyToken('the receipt', hexShort(preimage, 'pre')),
    ]));
}

function storyStep(number, iconName, title, body) {
  return h('li', { class: 'story-step' },
    h('div', { class: `story-icon ico-${iconName}` }, icon(iconName), h('span', { class: 'story-num' }, String(number))),
    h('div', { class: 'story-body' }, h('h3', null, title), body));
}

function storyToken(label, value) {
  return h('div', { class: 'story-token' }, h('span', { class: 'token-label' }, label), value);
}

/** SHA-256(preimage) = payment hash, one row above the other, with matching groups highlighted. */
function hashEquation({ invoice, preimageHash, preimageMatches }) {
  const computed = hexValue(preimageHash, 'hash', 'eq-hex');
  const expected = hexValue(invoice.paymentHash, 'hash', 'eq-hex');
  if (preimageMatches) highlightMatchingChunks(computed, expected);

  return h('div', { class: 'equation card-inset', id: 'check-hash' },
    h('div', { class: 'eq-row' },
      h('div', { class: 'eq-label' }, h('span', { class: 'fn' }, 'SHA-256'), '( ', h('span', { class: 'c-pre' }, 'preimage'), ' )'),
      computed),
    h('div', { class: 'eq-mid' },
      h('span', { class: `eq-sign ${preimageMatches ? 'ok' : 'bad'}` }, preimageMatches ? '=' : '≠'),
      h('span', { class: 'eq-note' }, preimageMatches ? 'identical, character by character' : 'different')),
    h('div', { class: 'eq-row' },
      h('div', { class: 'eq-label' }, h('span', { class: 'c-hash' }, 'payment hash'), ' in the signed invoice'),
      expected));
}

function highlightMatchingChunks(rowA, rowB) {
  [...rowA.children].forEach((chunk, i) => {
    if (chunk.textContent === rowB.children[i]?.textContent) {
      chunk.classList.add('m');
      rowB.children[i].classList.add('m');
    }
  });
}

function whyCard(iconName, title, text) {
  return h('div', { class: 'why-card' }, h('h3', null, icon(iconName, 'icon-sm'), title), h('p', null, text));
}

function finePrint(invoice) {
  const likelyHosted = Boolean(invoice.spark) || HOSTED_WALLET_HINT.test(invoice.description ?? '');
  const item = (label, ...text) => h('li', null, h('strong', null, `${label}: `), ...text);

  return h('details', { class: 'fineprint' },
    h('summary', null, icon('info', 'icon-sm'), 'What exactly does this prove — and what not?'),
    h('ul', null,
      item('Proven', 'the node that signed this invoice released the secret for it. Standard Lightning software does this only ' +
        'when it accepts an incoming payment of at least the requested amount.'),
      item('When', 'nodes accept payments only while an invoice is valid, so the payment normally happened between ',
        formatDate(invoice.timestamp), ' and ', formatDate(invoice.expiresAt), '. The exact moment is not part of the proof.'),
      item('Who paid', 'the receipt doesn’t contain a name. But it is only handed to whoever paid the invoice — and this invoice was issued to the sender.'),
      h('li', { class: likelyHosted ? 'hl' : null }, h('strong', null, 'Wallet apps & services: '),
        'if the receiver uses a hosted wallet (for example Wallet of Satoshi), the node belongs to that service. ' +
        'The money then arrived at the service and should show up in the receiver’s account there. ' +
        'If not, the receiver can contact the service with the ', h('b', { class: 'c-hash' }, 'payment hash'), '.',
        invoice.spark ? [' This invoice belongs to a ', h('a', { href: '#spark' }, 'Spark wallet'),
          ': the payment is handed to the wallet by a Spark service provider.'] : null),
      item('Not to be confused', 'the invoice also contains a “payment secret”. That is a different value, not the preimage — ' +
        'the preimage is never inside the invoice.')));
}
