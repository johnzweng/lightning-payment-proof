// Reusable UI building blocks.

import { h, icon } from './dom.js';
import { shortHex } from './format.js';

const COPY_FEEDBACK_MS = 1600;

/** A page section: eyebrow, heading and lead text, followed by the content. */
export function section(id, { eyebrow, title, lead }, ...content) {
  return h('section', { class: 'section', id },
    h('div', { class: 'section-head' },
      eyebrow ? h('p', { class: 'eyebrow' }, eyebrow) : null,
      h('h2', null, title),
      lead ? h('p', { class: 'section-lead' }, lead) : null),
    ...content);
}

/** kind: 'info' | 'warn' */
export function callout(kind, iconName, ...content) {
  return h('div', { class: `callout callout-${kind}` }, icon(iconName), h('div', null, ...content));
}

/** kind: 'ok' | 'bad' | 'warn' | 'info' | 'muted' */
export function badge(kind, text, attributes) {
  return h('span', { ...attributes, class: `badge badge-${kind}` }, text);
}

export function externalLink(href, label, className = 'link-ext') {
  const url = new URL(href);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Unsafe external link.');
  return h('a', { href, target: '_blank', rel: 'noopener noreferrer', class: className }, label, icon('external', 'icon-xs'));
}

/**
 * Hex value in groups of 8 characters, coloured by meaning (kind: 'hash', 'pre', 'node', 'spark', …).
 * Public keys (66 characters) show their 02/03 prefix as a separate group.
 */
export function hexValue(value, kind, className) {
  if (value == null) return h('span', { class: 'muted' }, 'unavailable');
  const element = h('span', { class: `hex hex-${kind}${className ? ' ' + className : ''}`, translate: 'no' });
  const firstGroupLength = value.length % 8;
  if (firstGroupLength) element.append(h('span', { class: 'hex-chunk' }, value.slice(0, firstGroupLength)));
  for (let i = firstGroupLength; i < value.length; i += 8) {
    element.append(h('span', { class: 'hex-chunk' }, value.slice(i, i + 8)));
  }
  return element;
}

/** Abbreviated hex value ("0309…0d8a"); the full value is in the tooltip. */
export function hexShort(value, kind) {
  return h('span', { class: `hex hex-short hex-${kind}`, title: value, translate: 'no' }, value == null ? 'unavailable' : shortHex(value));
}

/** A hex value in a box with a copy button. */
export function hexBox(value, kind, { inline = false } = {}) {
  return h('div', { class: inline ? 'hex-box hex-box-inline' : 'hex-box' }, hexValue(value, kind), value == null ? null : copyButton(value));
}

/* ---------- copy to clipboard ---------- */

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  // Fallback for plain-http origins
  return new Promise((resolve, reject) => {
    const textarea = h('textarea', { class: 'sr-only', readonly: true });
    textarea.value = text;
    document.body.append(textarea);
    textarea.select();
    try {
      if (document.execCommand('copy')) resolve();
      else reject(new Error('Copy failed'));
    } catch (error) {
      reject(error);
    } finally {
      textarea.remove();
    }
  });
}

/** @param {string|function(): string} text  the text, or a function returning it at click time */
export function copyButton(text, { label = 'Copy', className = '' } = {}) {
  const caption = h('span', null, label);
  const button = h('button', {
    type: 'button',
    class: `btn-copy ${className}`.trim(),
    'aria-label': label,
    onclick: async () => {
      try {
        await copyText(typeof text === 'function' ? text() : text);
        button.classList.add('copied');
        caption.textContent = 'Copied';
        setTimeout(() => {
          button.classList.remove('copied');
          caption.textContent = label;
        }, COPY_FEEDBACK_MS);
      } catch {
        caption.textContent = 'Press ⌘/Ctrl+C';
      }
    },
  }, icon('copy'), caption);
  return button;
}

/* ---------- terminal commands ---------- */

/** parts: plain strings, or [kind, text] tokens that are coloured by meaning. */
function renderTokens(parts) {
  return parts.map((part) => (typeof part === 'string' ? part : h('span', { class: `tok tok-${part[0]}` }, part[1])));
}

const plainText = (parts) => parts.map((part) => (typeof part === 'string' ? part : part[1])).join('');

/** A terminal-style code block with a copy button. */
export function codeBlock(parts, { title = 'Terminal', tall = false } = {}) {
  return h('div', { class: tall ? 'codeblock codeblock-tall' : 'codeblock' },
    h('div', { class: 'codeblock-bar' },
      h('span', { class: 'codeblock-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
      h('span', { class: 'codeblock-title' }, title),
      copyButton(plainText(parts), { className: 'btn-copy-dark' })),
    h('pre', { tabindex: '0' }, h('code', null, renderTokens(parts))));
}

/** The output a command should print, shown below the command. */
export function expectedOutput(parts, label = 'Expected output') {
  return h('div', { class: 'expect' },
    h('div', { class: 'expect-label' }, icon('check'), label),
    h('pre', null, renderTokens(parts)));
}
