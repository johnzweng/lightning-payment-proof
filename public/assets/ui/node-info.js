// Public information about Lightning nodes: best-effort lookups on mempool.space and explorer links.
// Only public keys are sent — never the invoice or the preimage.

import { badge, externalLink } from './components.js';
import { h } from './dom.js';
import { formatBtc, formatNumber } from './format.js';

const MEMPOOL_NODE_API = 'https://mempool.space/api/v1/lightning/nodes/';
const LOOKUP_TIMEOUT_MS = 9000;

export const SPARK_DOCS_URL = 'https://docs.spark.money/learn/lightning';

const lookups = new Map();

/**
 * @returns {Promise<{ status: 'public', node: object } | { status: 'unknown' } | { status: 'unavailable' }>}
 *   'unknown': not in the public network map; 'unavailable': the lookup itself failed.
 */
function lookupNode(pubkey) {
  if (!lookups.has(pubkey)) lookups.set(pubkey, fetchNode(pubkey));
  return lookups.get(pubkey);
}

async function fetchNode(pubkey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(MEMPOOL_NODE_API + pubkey, {
      credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal,
    });
    if (response.ok) {
      const node = await response.json();
      return node?.public_key ? { status: 'public', node } : { status: 'unknown' };
    }
    // mempool.space answers 500 (not 404) for nodes it doesn't know
    return { status: response.status === 404 || response.status === 500 ? 'unknown' : 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

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
    node.alias ? h('span', { class: 'alias', translate: 'no' }, node.alias) : null,
    badge('ok', ['public node', ...facts].join(' · ')),
  ].filter(Boolean);
}

export function explorerLinks(pubkey) {
  return h('div', { class: 'explorers' },
    externalLink(`https://terminal.lightning.engineering/explore/${pubkey}`, 'Lightning Terminal', 'chip-link'),
    externalLink(`https://amboss.space/node/${pubkey}`, 'Amboss', 'chip-link'),
    externalLink(`https://mempool.space/lightning/node/${pubkey}`, 'mempool.space', 'chip-link'),
    externalLink(`https://1ml.com/node/${pubkey}`, '1ML', 'chip-link'));
}

export function sparkscanLink(address, label = 'sparkscan.io') {
  return externalLink(`https://www.sparkscan.io/address/${address}`, label, 'chip-link');
}
