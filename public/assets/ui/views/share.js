// "Share this proof": the self-contained link for the receiver.

import { copyButton, section } from '../components.js';
import { h, icon } from '../dom.js';

export function shareSection(shareUrl) {
  return section('share', {
    eyebrow: 'Send it to the receiver',
    title: 'Share this proof',
    lead: 'The link contains the invoice and the preimage — everything needed. Whoever opens it sees this page and can verify ' +
      'the payment. Nothing is stored on any server.',
  },
    h('div', { class: 'share-box card' },
      h('div', { class: 'share-url mono', translate: 'no' }, shareUrl),
      h('div', { class: 'share-actions' },
        copyButton(shareUrl, { label: 'Copy link', className: 'btn btn-primary btn-copy-primary' }),
        navigator.share ? nativeShareButton(shareUrl) : null)));
}

function nativeShareButton(url) {
  const share = () => navigator.share({ title: 'Lightning payment proof', text: 'Proof that the Lightning invoice was paid:', url })
    .catch(() => { /* dismissed by the user */ });
  return h('button', { type: 'button', class: 'btn btn-ghost', onclick: share }, icon('link'), 'Share…');
}
