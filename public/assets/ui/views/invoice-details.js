// "What the receiver asked for": the decoded invoice, with all technical fields on demand.

import { badge, copyButton, hexBox, hexShort, section } from '../components.js';
import { h } from '../dom.js';
import { displayText } from '../safe-text.js';
import { formatBtc, formatDate, formatDuration, formatRelative, formatSats, formatUtc } from '../format.js';

export function invoiceDetailsSection({ invoice }) {
  return section('invoice', {
    eyebrow: 'The invoice',
    title: 'What the receiver asked for',
    lead: 'Decoded from the invoice text. These are exactly the details the receiver’s node signed.',
  },
    h('div', { class: 'card card-flat' }, summaryList(invoice)),
    technicalDetails(invoice));
}

function summaryList(invoice) {
  const { signature } = invoice;
  const expired = invoice.expiresAt < Date.now() / 1000;
  const muted = (text) => h('span', { class: 'muted' }, text);

  const rows = [
    ['Amount', invoice.amountMsat != null
      ? [h('strong', null, formatSats(invoice.amountMsat)), muted(` · ${formatBtc(invoice.amountMsat)}`)]
      : 'Any amount (chosen by the sender)'],
    invoice.description != null && ['Description', h('span', { class: 'desc', dir: 'auto' }, displayText(invoice.description) || '—')],
    invoice.descriptionHash && ['Description hash', [hexShort(invoice.descriptionHash, 'muted'),
      h('span', { class: 'muted small' }, ' — the description itself was shared separately')]],
    ['Created', [formatDate(invoice.timestamp), muted(` · ${formatRelative(invoice.timestamp)}`)]],
    ['Valid until', [formatDate(invoice.expiresAt), muted(` · ${expired ? 'expired' : 'expires'} ${formatRelative(invoice.expiresAt)}` +
      ` (valid for ${formatDuration(invoice.expirySeconds)})`)]],
    ['Network', invoice.networkName],
    ['Payment hash', hexBox(invoice.paymentHash, 'hash', { inline: true })],
    ['Receiver node', hexBox(invoice.nodeId, 'node', { inline: true })],
    ['Signature', [
      badge(signature.valid ? 'ok' : 'bad', signature.valid ? 'valid' : 'invalid'),
      muted(signature.nodeIdInInvoice ? ' — checked against the node id stated in the invoice' : ' — node id recovered from the signature'),
      signature.highS ? badge('warn', 'non-standard (high-S)') : null,
    ]],
  ].filter(Boolean);

  return h('dl', { class: 'kv' }, rows.map(([label, value]) => h('div', { class: 'kv-row' }, h('dt', null, label), h('dd', null, value))));
}

function technicalDetails(invoice) {
  const { signature } = invoice;
  const row = (tag, name, value, { mono = false, unused = false } = {}) => h('tr', { class: unused ? 'unused' : null },
    h('td', null, tag ? h('code', null, tag) : '—'),
    h('td', null, name),
    h('td', { class: mono ? 'mono break' : null }, value));

  return h('details', { class: 'tech' },
    h('summary', null, 'All technical fields'),
    h('table', { class: 'tech-table' },
      h('thead', null, h('tr', null, h('th', null, 'Tag'), h('th', null, 'Field'), h('th', null, 'Value'))),
      h('tbody', null,
        row(null, 'Prefix', [h('code', null, invoice.hrp),
          ` — ln + ${invoice.network} (${invoice.networkName})${invoice.amountMsat != null ? ' + amount' : ''}`]),
        row(null, 'Timestamp', `${invoice.timestamp} (${formatUtc(invoice.timestamp)})`),
        invoice.fields.map((field) => row(field.tag, field.used ? field.name : `${field.name} (ignored)`,
          displayText(field.value ?? ''), { mono: true, unused: !field.used })),
        row(null, 'Signature (r‖s)', signature.compactHex, { mono: true }),
        row(null, 'Recovery id', String(signature.recoveryId)),
        row(null, 'Signed data hash', `${signature.signedHashHex} (SHA-256 of ${signature.signedMessageLength} bytes)`, { mono: true }))),
    h('div', { class: 'raw' },
      h('div', { class: 'raw-head' }, h('span', null, 'Raw invoice'), copyButton(invoice.bolt11)),
      h('p', { class: 'mono break raw-text', translate: 'no' }, invoice.bolt11)));
}
