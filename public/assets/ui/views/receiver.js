// "Who got paid": the receiver's node, its Spark wallet (if any) and the route hints (entry points).

import { SPARK_SCID_SENTINEL } from '../../lnproof/spark.js';
import { callout, copyButton, externalLink, hexBox, hexShort, section } from '../components.js';
import { h, icon } from '../dom.js';
import { formatFee } from '../format.js';
import { SPARK_DOCS_URL, explorerLinks, nodeStatus, sparkscanLink } from '../node-info.js';

const SPARK_PRIVACY_DOCS_URL = 'https://docs.spark.money/wallets/privacy';

// A short channel id with one of these block heights is an alias, not a real on-chain position.
const isAliasScid = ({ block }) => block === 0 || block >= 16_000_000;
// Fees this high make a route hint unusable; some wallets add such placeholder hints.
const hasUnusableFees = (hop) => hop.feeBaseMsat >= 1_000_000_000 || hop.feeProportionalMillionths >= 1_000_000;

export function receiverSection({ invoice }) {
  const hints = invoice.routeHints;
  const lookupNote = h('div', { hidden: true });
  const showLookupNote = (status) => {
    const note = receiverLookupNote(status, hints.length > 0);
    if (note) {
      lookupNote.replaceChildren(note);
      lookupNote.hidden = false;
    }
  };
  if (!invoice.isMainnet) showLookupNote('unavailable');

  return section('receiver', {
    eyebrow: 'Who got paid',
    title: 'The receiver’s node',
    lead: 'Every Lightning wallet runs on a node with a unique id — its public key. This invoice was signed by this node:',
  },
    receiverNodeCard(invoice, (result) => showLookupNote(result.status)),
    invoice.spark ? sparkWalletCard(invoice) : null,
    lookupNote,
    hints.length ? routeHintList(invoice) : h('p', { class: 'muted small note-line' }, icon('info', 'icon-xs'),
      ' The invoice contains no route hints, so the receiver’s node is expected to be publicly reachable.'));
}

function receiverNodeCard(invoice, onLookup) {
  return h('div', { class: 'node-card' },
    h('div', { class: 'node-card-head' },
      h('div', { class: 'node-avatar' }, icon('node')),
      h('div', { class: 'node-card-title' },
        h('div', { class: 'node-card-label' }, 'Receiver node id',
          invoice.signature.nodeIdInInvoice ? null : h('span', { class: 'muted' }, ' · recovered from the signature')),
        nodeStatus(invoice.nodeId, invoice.isMainnet, onLookup))),
    hexBox(invoice.nodeId, 'node'),
    invoice.isMainnet ? explorerLinks(invoice.nodeId) : null);
}

/** Explains the lookup result, so that "not found" on an explorer is not mistaken for a fake. */
function receiverLookupNote(status, hasRouteHints) {
  if (status === 'public' && hasRouteHints) {
    return callout('info', 'info', h('strong', null, 'This node is publicly listed. '),
      'The invoice additionally names entry points (“route hints”) — they just help payers find a path to it.');
  }
  if (hasRouteHints) {
    return callout('info', 'info', h('strong', null, 'Probably a private node — that’s normal. '),
      'Many wallets, especially mobile and hosted ones, use nodes that are not listed publicly, so explorers may show “not found” for it. ',
      'This does not weaken the proof: the signature proves which node issued the invoice. ',
      'To be reachable anyway, the invoice names public ', h('em', null, 'entry points'),
      ' (“route hints”) — nodes with a channel to the receiver. They are listed below.');
  }
  if (status === 'unknown') {
    return callout('info', 'info', h('strong', null, 'Not found in the public network map. '),
      'Some nodes are private (unannounced), and explorers can lag behind. ' +
      'This does not affect the proof: the signature shows which node issued the invoice.');
  }
  return null;
}

/* ---------- Spark ---------- */

function sparkWalletCard(invoice) {
  const { spark } = invoice;
  const whereInInvoice = spark.source === 'routehint'
    ? [`It is hidden in the invoice as a fake route hint (route ${spark.routeIndex + 1} below): its channel id `,
      h('code', null, SPARK_SCID_SENTINEL), ' is Spark’s marker, and the absurd fees make sure no Lightning wallet ever tries to use that “route”.']
    : ['It is embedded in the invoice’s fallback-address field (version 31), where Spark wallets put their Spark address.'];
  const networkLabel = spark.network && spark.network !== 'mainnet' ? ` · ${spark.network}` : '';

  return h('div', { class: 'spark-card', id: 'spark' },
    h('div', { class: 'node-card-head' },
      h('div', { class: 'node-avatar spark-avatar' }, icon('sparkle')),
      h('div', { class: 'node-card-title' },
        h('div', { class: 'node-card-label' }, 'Receiver’s Spark wallet'),
        h('span', { class: 'badge badge-muted' }, `Spark · Bitcoin layer 2${networkLabel}`))),
    h('p', null, 'This invoice comes from a ', h('b', null, 'Spark'), ' wallet. Spark is a Bitcoin layer 2: the wallet itself runs no ' +
      'Lightning node. A Spark service provider receives Lightning payments on the wallet’s behalf and hands them over to it — ' +
      'typically with the node that signed this invoice (above).'),
    h('p', null, 'The wallet’s own Spark identity is included in the invoice as well. ', whereInInvoice),
    h('div', { class: 'spark-field' }, h('div', { class: 'node-card-label' }, 'Spark address'),
      h('div', { class: 'hex-box' }, h('span', { class: 'hex hex-spark', translate: 'no' }, spark.address), copyButton(spark.address))),
    h('div', { class: 'spark-field' }, h('div', { class: 'node-card-label' }, 'Spark identity public key'),
      hexBox(spark.identityPublicKey, 'spark')),
    h('div', { class: 'explorers' },
      invoice.isMainnet ? sparkscanLink(spark.address, 'View on sparkscan.io') : null,
      externalLink(SPARK_DOCS_URL, 'How Spark handles Lightning', 'chip-link')),
    callout('info', 'info', h('strong', null, 'Explorer shows an empty wallet? That’s expected. '),
      'Spark has no public blockchain — explorers like sparkscan only see what the Spark operators publish. Spark wallets can turn on ',
      externalLink(SPARK_PRIVACY_DOCS_URL, 'Privacy Mode'),
      ', which hides their Bitcoin balance and transaction history from everyone except the owner. A private wallet then looks ' +
      'exactly like an unused one: balance 0, no transactions. This does not affect the proof, which relies only on the signed ' +
      'invoice and the preimage.'),
    callout('info', 'shield', h('strong', null, 'Does the proof still hold? Yes. '),
      'With Spark, the secret (preimage) is split among the Spark operators, who can only reassemble it together — as part of ' +
      'handing the money to the receiver’s Spark wallet. So a released preimage still means the payment was accepted for the receiver.'));
}

/* ---------- route hints ---------- */

function routeHintList(invoice) {
  const { routeHints, spark } = invoice;
  const sparkRouteNote = spark?.source === 'routehint'
    ? ` Route ${spark.routeIndex + 1} is an exception: it only carries the Spark identity of the receiver’s wallet.`
    : '';
  return [
    h('h3', { class: 'sub-head' }, 'Entry points named in the invoice ', h('span', { class: 'count' }, String(routeHints.length))),
    h('p', { class: 'muted small' }, 'A payment reaches the receiver through one of these routes. ' +
      'The first node of each route is usually a public node you can look up.' + sparkRouteNote),
    h('div', { class: 'routes' }, routeHints.map((hops, index) => {
      const sparkHop = hops.find((hop) => hop.sparkIdentity);
      return sparkHop ? sparkMarkerRouteCard(sparkHop, index, invoice) : routeCard(hops, index, invoice);
    })),
  ];
}

function routeCard(hops, index, invoice) {
  const chain = h('div', { class: 'route-chain' });
  hops.forEach((hop, hopIndex) => chain.append(routeHop(hop, hopIndex, invoice.isMainnet), channelArrow(hop)));
  chain.append(h('div', { class: 'route-node route-dest' },
    h('div', { class: 'route-node-label' }, 'Receiver'),
    h('div', { class: 'route-node-id' }, hexShort(invoice.nodeId, 'node'))));
  return h('div', { class: 'route-card' }, h('div', { class: 'route-title' }, `Route ${index + 1}`), chain);
}

function routeHop(hop, hopIndex, isMainnet) {
  const isEntryPoint = hopIndex === 0;
  return h('div', { class: isEntryPoint ? 'route-node route-entry' : 'route-node' },
    h('div', { class: 'route-node-label' }, isEntryPoint ? 'Entry point' : `Hop ${hopIndex + 1}`),
    h('div', { class: 'route-node-id' }, hexShort(hop.pubkey, 'entry'), copyButton(hop.pubkey, { className: 'btn-copy-mini' })),
    hop.knownAs ? knownNodeNote(hop.knownAs) : null,
    nodeStatus(hop.pubkey, isMainnet),
    isMainnet ? explorerLinks(hop.pubkey) : null);
}

function knownNodeNote({ label, operator, source }) {
  return h('div', { class: 'known-node' },
    h('span', { class: 'badge badge-info' }, icon('sparkle', 'icon-xs'), label),
    h('span', { class: 'muted small' }, `Official routing node of ${operator} — listed in the `,
      externalLink(source, 'Spark documentation'), '.'));
}

function channelArrow(hop) {
  const scid = hop.shortChannelId;
  return h('div', { class: 'route-arrow' },
    h('span', { class: 'route-arrow-line', 'aria-hidden': 'true' }, icon('arrowRight', 'icon-sm')),
    h('div', { class: 'route-arrow-meta' },
      h('span', { class: 'mono', title: 'short channel id (block × transaction × output)' }, `channel ${scid.text}`),
      isAliasScid(scid) ? h('span', { class: 'badge badge-muted', title: 'Not a real on-chain position: an alias used for private channels.' }, 'private alias') : null,
      h('span', { class: 'muted' }, `fee ${formatFee(hop.feeBaseMsat, hop.feeProportionalMillionths)}`),
      hasUnusableFees(hop) ? h('span', { class: 'badge badge-warn', title: 'Fees are so high that no payment would use this route; wallets sometimes add such placeholder hints.' }, 'placeholder – unusable fees') : null));
}

/** Spark's fake route hint: not a route, but the carrier of the wallet's identity key. */
function sparkMarkerRouteCard(hop, index, invoice) {
  const scid = hop.shortChannelId;
  return h('div', { class: 'route-card route-card-spark' },
    h('div', { class: 'route-title' }, `Route ${index + 1} — not a real route`),
    h('div', { class: 'route-node route-spark' },
      h('div', { class: 'route-node-label' }, 'Spark identity · not a Lightning node'),
      h('div', { class: 'route-node-id' }, hexShort(hop.pubkey, 'spark'), copyButton(hop.pubkey, { className: 'btn-copy-mini' })),
      h('div', { class: 'route-node-id' }, h('span', { class: 'hex hex-spark small', translate: 'no' }, hop.sparkAddress),
        copyButton(hop.sparkAddress, { className: 'btn-copy-mini' })),
      h('p', { class: 'muted small spark-note' },
        'Channel id ', h('code', null, scid.text), ' (', h('code', null, scid.hex), ') is the marker Spark wallets use to carry ' +
        'their identity key inside a Lightning invoice. The fees (', formatFee(hop.feeBaseMsat, hop.feeProportionalMillionths),
        ') make the “route” unusable on purpose, so Lightning wallets ignore it. ',
        h('a', { href: '#spark' }, 'More about the Spark wallet ↑')),
      invoice.isMainnet ? h('div', { class: 'explorers' }, sparkscanLink(hop.sparkAddress)) : null));
}
