// "Why this proves the payment": the lock/secret story, the hash equation, and the fine print.

import { hexShort, hexValue, section } from '../components.js';
import { h, icon } from '../dom.js';
import { formatSats } from '../format.js';

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
function hashEquation({ invoice, preimage, preimageHash, preimageMatches }) {
  const computed = hexValue(preimageHash, 'hash', 'eq-hex');
  const expected = hexValue(invoice.paymentHash, 'hash', 'eq-hex');
  if (preimageMatches) highlightMatchingChunks(computed, expected);

  // the preimage shows as its shortened orange pill — exactly like "the receipt" in the story above
  const input = hexShort(preimage, 'pre');

  return h('div', { class: 'equation card-inset', id: 'check-hash' },
    h('div', { class: 'eq-row' },
      h('div', { class: 'eq-label' }, h('span', { class: 'fn' }, 'SHA-256'), '( ', input, ' )'),
      computed),
    h('div', { class: 'eq-mid' },
      h('span', { class: `eq-sign ${preimageMatches ? 'ok' : 'bad'}` },
        icon(preimageMatches ? 'equal' : 'notEqual'),
        h('span', { class: 'sr-only' }, preimageMatches ? '=' : '≠')),
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
      item('Is this your invoice?', 'compare the Lightning invoice shown on this page with the payment request you created in your wallet and sent to the sender. ' +
        'Check the displayed node ID against your own node ID, or confirm with your ' +
        'wallet provider/LSP that it is a node receiving payments for you. Use your own records or trusted provider information, not just an explorer name. ' +
        'A provider’s node ID alone does not identify your particular invoice.'),
      item('What a match means', 'if this is your invoice and your receiving node, a matching preimage is evidence that your node or service accepted the payment, ' +
        'provided the preimage stayed secret until payment. Normal Lightning software releases it when accepting at least the requested amount.'),
      item('What this page checks', 'the signature verifies under the displayed public key and the preimage matches the payment hash. ' +
        'The page cannot establish that this is your node, or rule out the preimage being leaked or shared outside a payment.'),
      item('Optional node-key field', 'without BOLT11’s “n” field, the key is recovered from the signature. This does not weaken the proof against your known node ID. ' +
        'But changing the invoice can produce a different recovered key with a verifying signature—not a valid signature under your original node ID.'),
      item('Who paid', 'the receipt contains no payer identity. A preimage can be copied and shared, so its current holder need not be the payer.'),
      h('li', { class: likelyHosted ? 'hl' : null }, h('strong', null, 'Wallet apps & services: '),
        'if a wallet service receives payments for you, evidence that its node accepted the payment does not establish that it credited your account. ' +
        'If the payment is missing in your wallet, contact your provider with the ', h('b', { class: 'c-hash' }, 'payment hash'), '.',
        invoice.spark ? [' This invoice belongs to a ', h('a', { href: '#spark' }, 'Spark wallet'),
          ': a Spark service provider handles the Lightning payment. This page does not independently check Spark operator behavior or your wallet balance.'] : null),
      item('Not to be confused', 'the invoice also contains a “payment secret”. That is a different value, not the preimage — ' +
        'the preimage is never inside the invoice.')));
}
