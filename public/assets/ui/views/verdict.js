// The first thing a reader sees: was the invoice paid? Plus a receipt-like summary.

import { callout, copyButton, hexShort } from '../components.js';
import { h, icon } from '../dom.js';
import { displayText } from '../safe-text.js';
import { formatBtc, formatDate, formatRelative, formatSats, shortHex } from '../format.js';
import { nodeStatus } from '../node-info.js';

/** Compact bar above the verdict showing what was checked, with an "Edit" button. */
export function inputsBar(proof, onEdit) {
  return h('div', { class: 'inputs-bar' },
    h('span', { class: 'inputs-bar-text' },
      'Invoice ', h('span', { class: 'mono', translate: 'no' }, shortHex(proof.invoice.bolt11, 10)),
      proof.preimage ? [' · Preimage ', h('span', { class: 'mono', translate: 'no' }, shortHex(proof.preimage))] : null),
    h('button', { type: 'button', class: 'btn btn-small btn-ghost', onclick: () => onEdit() }, icon('edit'), 'Edit'));
}

/**
 * @param {object} proof  result of verifyProof()
 * @param {{ shareUrl: string, onAddPreimage: function }} actions
 */
export function verdictCard(proof, { shareUrl, onAddPreimage }) {
  const { invoice } = proof;
  const verdict = describeVerdict(proof);

  return h('section', { class: `card verdict verdict-${verdict.kind}`, 'aria-live': 'polite' },
    invoice.isMainnet ? null : h('div', { class: 'callout callout-warn callout-slim' }, icon('alert'),
      h('div', null, h('strong', null, `${invoice.networkName}: `), 'this is a test network — no real bitcoin was involved.')),
    h('div', { class: 'verdict-head' },
      h('div', { class: 'verdict-icon' }, icon(verdict.icon)),
      h('div', null,
        h('p', { class: 'eyebrow' }, 'Verified in your browser'),
        h('h1', { class: 'verdict-title' }, verdict.title),
        h('p', { class: 'verdict-text' }, verdict.text))),
    receipt(invoice),
    checkList(proof),
    proof.givenHash && !proof.givenHashMatches ? givenHashWarning(proof) : null,
    h('div', { class: 'verdict-actions' },
      proof.proven ? copyButton(shareUrl, { label: 'Copy proof link', className: 'btn btn-primary btn-copy-primary' }) : null,
      proof.preimage ? null : h('button', { type: 'button', class: 'btn btn-primary', onclick: () => onAddPreimage() }, 'Add the preimage'),
      h('a', { class: 'btn btn-ghost', href: '#verify' }, icon('terminal'), 'Check it yourself')));
}

function describeVerdict({ invoice, preimageMatches }) {
  if (!invoice.signature.valid) {
    return {
      kind: 'bad', icon: 'x',
      title: 'The invoice signature is not valid.',
      text: 'This invoice was not correctly signed — it may have been modified. It cannot be used as a proof.',
    };
  }
  if (preimageMatches === true) {
    return {
      kind: 'ok', icon: 'check',
      title: 'This invoice has been paid.',
      text: 'The receiver’s node released the payment receipt for this invoice. Lightning nodes only do that when they accept the payment.',
    };
  }
  if (preimageMatches === false) {
    return {
      kind: 'bad', icon: 'x',
      title: 'This preimage does not belong to this invoice.',
      text: 'The receipt doesn’t fit: the fingerprint of the preimage differs from the payment hash in the invoice. ' +
        'Probably the wrong preimage or the wrong invoice was pasted. This is not a proof of payment.',
    };
  }
  return {
    kind: 'neutral', icon: 'info',
    title: 'Invoice checked — the receipt is missing.',
    text: 'The invoice is genuine and correctly signed. Add the preimage (the receipt from the sender’s wallet) to prove that it was paid.',
  };
}

function receipt(invoice) {
  const row = (label, content, className) => h('div', { class: className ? `receipt-row ${className}` : 'receipt-row' },
    h('dt', null, label), content);

  return h('dl', { class: 'receipt' },
    row('Amount', h('dd', null, invoice.amountMsat != null
      ? [h('strong', null, formatSats(invoice.amountMsat)), h('span', { class: 'muted' }, ` · ${formatBtc(invoice.amountMsat)}`)]
      : ['Any amount ', h('span', { class: 'muted' }, '(chosen by the sender)')]), 'receipt-amount'),
    invoice.description != null ? row('For', h('dd', { class: 'desc', dir: 'auto' }, displayText(invoice.description) || '—')) : null,
    row('Paid to', h('dd', { class: 'dd-row' },
      h('span', { class: 'node-inline' }, icon('node', 'icon-sm'), hexShort(invoice.nodeId, 'node')),
      nodeStatus(invoice.nodeId, invoice.isMainnet))),
    invoice.spark ? row('Spark wallet', h('dd', { class: 'dd-row' },
      h('span', { class: 'node-inline' }, icon('sparkle', 'icon-sm'), hexShort(invoice.spark.address, 'spark')),
      h('a', { href: '#spark', class: 'check-link' }, 'what is this?'))) : null,
    row('Invoice created', h('dd', null,
      formatDate(invoice.timestamp), h('span', { class: 'muted' }, ` · ${formatRelative(invoice.timestamp)}`))));
}

function checkList(proof) {
  const { signature } = proof.invoice;
  return h('ul', { class: 'checks' },
    checkItem(signature.valid, 'Valid signature',
      signature.valid ? 'genuine only if the node ID matches your receiver' : 'the signature does not match the invoice content',
      '#verify-sig'),
    proof.preimage
      ? checkItem(proof.preimageMatches, 'Matching receipt', proof.preimageMatches
        ? 'the fingerprint (SHA-256) of the preimage equals the payment hash in the invoice'
        : 'SHA-256 of the preimage is not the payment hash of the invoice', '#verify-hash')
      : checkItem(null, 'Receipt', 'no preimage given'),
    proof.givenHash ? checkItem(proof.givenHashMatches, 'Payment hash', proof.givenHashMatches
      ? 'the payment hash you entered is the one in the invoice'
      : 'the payment hash you entered is NOT the one in the invoice') : null);
}

/** ok: true (passed), false (failed) or null (not checked) */
function checkItem(ok, title, text, verifyHref) {
  const [state, iconName] = ok === true ? ['ok', 'check'] : ok === false ? ['bad', 'x'] : ['na', 'info'];
  return h('li', { class: `check check-${state}` },
    h('span', { class: 'check-icon' }, icon(iconName)),
    h('span', { class: 'check-text' }, h('strong', null, title), ' — ', text,
      verifyHref ? [' ', h('a', { href: verifyHref, class: 'check-link' }, 'verify yourself')] : null));
}

function givenHashWarning({ invoice, givenHash }) {
  return callout('warn', 'alert',
    h('strong', null, 'The payment hash you entered is different. '),
    'The invoice itself contains ', hexShort(invoice.paymentHash, 'hash'),
    ' — that is the one that counts, and the one checked above. You entered ', hexShort(givenHash, 'muted'), '.');
}
