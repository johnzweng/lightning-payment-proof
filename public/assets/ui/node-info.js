// Public information about Lightning nodes: best-effort lookups on mempool.space and explorer links.
// Only public keys are sent — never the invoice or the preimage.

import { badge, externalLink } from './components.js';
import { h } from './dom.js';
import { formatBtc, formatNumber } from './format.js';
import { isNodeId } from '../lnproof/input.js';
import { lookupNode } from './node-lookup.js';
import { displayText } from './safe-text.js';

export const SPARK_DOCS_URL = 'https://docs.spark.money/learn/lightning';

/**
 * Badge(s) that fill in once the lookup finishes: alias and size for public nodes.
 * `onResult` receives the lookup result (not called on test networks).
 */
export function nodeStatus(pubkey, isMainnet, onResult) {
  const element = h('span', { class: 'node-status' });
  if (!isMainnet) {
    element.append(badge('muted', 'test network'));
    return element;
  }
  element.append(h('span', { class: 'badge badge-muted badge-loading' }, 'looking up…'));
  lookupNode(pubkey).then((result) => {
    element.replaceChildren(...describeLookup(result));
    onResult?.(result);
  });
  return element;
}

function describeLookup({ status, node }) {
  if (status === 'unknown') return [badge('muted', 'not in public network map')];
  if (status === 'unavailable') return [badge('muted', 'lookup unavailable')];
  const facts = [];
  if (node.active_channel_count != null) facts.push(`${formatNumber(node.active_channel_count)} channels`);
  if (node.capacity) facts.push(formatBtc(BigInt(node.capacity) * 1000n).replace(/(\.\d{2})\d+/, '$1'));
  return [
    node.alias ? h('span', { class: 'alias', translate: 'no', dir: 'auto' }, displayText(node.alias)) : null,
    badge('ok', ['public node', ...facts].join(' · ')),
  ].filter(Boolean);
}

export function explorerLinks(pubkey) {
  if (!isNodeId(pubkey)) return null;
  return h('div', { class: 'explorers' },
    externalLink(`https://terminal.lightning.engineering/explore/${pubkey}`, 'Lightning Terminal', 'chip-link'),
    externalLink(`https://amboss.space/node/${pubkey}`, 'Amboss', 'chip-link'),
    externalLink(`https://mempool.space/lightning/node/${pubkey}`, 'mempool.space', 'chip-link'),
    externalLink(`https://1ml.com/node/${pubkey}`, '1ML', 'chip-link'));
}

export function sparkscanLink(address, label = 'sparkscan.io') {
  return externalLink(`https://www.sparkscan.io/address/${encodeURIComponent(address)}`, label, 'chip-link');
}
