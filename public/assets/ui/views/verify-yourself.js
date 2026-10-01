// "Check it yourself": copy-paste terminal commands that repeat every check without trusting this page.
//
// The commands contain no "#" comments on purpose: interactive zsh (the macOS default shell) does not
// treat "#" as a comment, so pasted comments would fail with "command not found".

import { isNodeId } from '../../lnproof/input.js';
import { independentCommand, preimageCommand, signatureCommand } from '../commands.js';
import { codeBlock, expectedOutput, externalLink, section } from '../components.js';
import { h, icon } from '../dom.js';

const PYTHON_SCRIPT_URL = 'assets/verify_invoice.py';
let selectedOs = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'mac' : 'linux';

export function verifyYourselfSection(proof) {
  const osSwitch = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Operating system' });
  const checks = h('div', { class: 'checks-wrap' });

  const render = () => {
    osSwitch.replaceChildren(osButton('mac', 'macOS', render), osButton('linux', 'Linux', render));
    const numbered = [proof.preimage ? preimageCheck : null, signatureCheck, independentCheck].filter(Boolean);
    checks.replaceChildren(...numbered.map((check, i) => check(proof, i + 1)));
  };
  render();

  return section('verify', {
    eyebrow: 'Independent checks',
    title: 'Check it yourself',
    lead: 'Repeat the checks on your own computer. Review commands and the Python script before running them: code copied from a compromised website is not safe.',
  },
    howTo(),
    h('div', { class: 'os-row' },
      h('span', { class: 'muted small' }, 'Your system:'), osSwitch,
      h('span', { class: 'muted small' }, 'Commands use bash or zsh. Windows: use Git Bash or WSL and pick Linux.')),
    checks);
}

function howTo() {
  const step = (number, ...text) => h('div', { class: 'howto-item' }, h('span', { class: 'howto-num' }, String(number)), h('span', null, ...text));
  return h('div', { class: 'howto' },
    step(1, 'Open the ', h('b', null, 'Terminal'), ' app', h('span', { class: 'muted' }, ' (Mac: press ⌘ Space, type “Terminal”; Linux: Ctrl Alt T)')),
    step(2, 'Copy a command with the ', h('b', null, 'Copy'), ' button, paste it, press ', h('b', null, 'Enter')),
    step(3, 'Compare the output with the ', h('b', null, 'expected output'), ' below it'));
}

function osButton(os, label, onChange) {
  const selected = selectedOs === os;
  return h('button', {
    type: 'button', role: 'tab', 'aria-selected': String(selected), class: selected ? 'seg-btn active' : 'seg-btn',
    onclick: () => { selectedOs = os; onChange(); },
  }, label);
}

function checkCard(id, number, title, duration, body) {
  return h('article', { class: 'vcheck card', id },
    h('header', { class: 'vcheck-head' },
      h('span', { class: 'vcheck-num' }, String(number)),
      h('h3', null, title),
      h('span', { class: 'vcheck-time' }, icon('clock', 'icon-xs'), duration)),
    body);
}

/* ---------- check: SHA-256(preimage) = payment hash ---------- */

function preimageCheck({ invoice, preimage }, number) {
  return checkCard('verify-hash', number, 'The receipt fits the invoice', '10 seconds', [
    h('p', null, 'This computes the SHA-256 fingerprint of the ', h('b', { class: 'c-pre' }, 'preimage'), ':'),
    codeBlock(preimageCommand(preimage, selectedOs)),
    expectedOutput([['hash', invoice.paymentHash], '  -'], 'Expected output — the payment hash of the invoice'),
    h('p', { class: 'muted small' }, 'The long value must be identical to the ', h('b', { class: 'c-hash' }, 'payment hash'),
      ' in the invoice. To be sure it really is in the invoice, see the last check or paste the invoice into any other Lightning decoder.',
      selectedOs === 'linux' ? ' If “xxd” is missing: sudo apt install xxd (or the vim package).' : ''),
  ]);
}

/* ---------- check: the invoice signature, with openssl ---------- */

function signatureCheck({ invoice }, number) {
  const { signature } = invoice;
  if (!isNodeId(invoice.nodeId)) {
    return checkCard('verify-sig', number, 'The invoice signature cannot be verified', 'invalid invoice',
      h('p', null, 'No usable receiver key could be recovered. No signature command is offered.'));
  }
  const legendItem = (dotClass, title, ...text) => h('li', null, h('span', { class: `dot ${dotClass}` }), h('span', null, h('b', null, title), ...text));
  const hrpHex = signature.signedMessageHex.slice(0, invoice.hrp.length * 2);

  return checkCard('verify-sig', number, 'The invoice was signed by the receiver’s node', '30 seconds', [
    h('p', null, 'This verifies the signature under the displayed node ID. It is your receiver’s signature only if that ID ' +
      'matches their known node ID. Changing the invoice invalidates the signature under that same key. ' +
      'The command below uses three values, all taken from the invoice:'),
    h('ul', { class: 'legend' },
      legendItem('dot-node', 'The receiver’s node id', ' — preceded by a standard header that says “this is a secp256k1 public key” ' +
        '(the same kind of key Bitcoin uses)', signature.nodeIdInInvoice ? '' : '. This invoice doesn’t state the node id; it is recovered from the signature'),
      legendItem('dot-msg', 'What was signed', ' — the invoice text before the signature, as raw bytes. It starts with ',
        h('code', null, invoice.hrp), ' (hex ', h('code', null, hrpHex), '), followed by all invoice details'),
      legendItem('dot-sig', 'The signature', ' — the last part of the invoice, in the standard format openssl reads')),
    codeBlock(signatureCommand(invoice)),
    expectedOutput([signature.valid ? 'Verified OK' : 'Verification failure'], 'Expected signature result'),
    h('p', { class: 'muted small' }, 'Try it: change a single character in any of the values and run it again — openssl then answers “Verification failure”.'),
  ]);
}

/* ---------- check: decode the raw invoice independently (Python + openssl) ---------- */

let pythonScript = null;
function loadPythonScript() {
  pythonScript ??= fetch(PYTHON_SCRIPT_URL, { credentials: 'omit' }).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  });
  return pythonScript;
}

function independentCheck(proof, number) {
  const { invoice, preimage } = proof;
  const content = h('div', null, h('p', { class: 'muted small' }, 'Loading script…'));
  const disclosure = h('details', { class: 'vcheck-adv' }, h('summary', null, 'Show the command'), content);

  const showCommand = async () => {
    try {
      const script = await loadPythonScript();
      content.replaceChildren(
        codeBlock(independentCommand(proof, script), { tall: true, title: 'Terminal — Python 3 (standard library only) + openssl' }),
        invoice.signature.valid && proof.preimageMatches !== false ? expectedOutput([
          'Invoice checksum : OK\n',
          'Payment hash     : ', ['hash', invoice.paymentHash], '\n',
          'Receiver node id : ', ['node', invoice.nodeId], ' (…)\n',
          preimage ? 'Preimage matches : YES - matches the invoice payment hash\n' : '',
          '…\nVerified OK',
        ], 'Expected output (excerpt)') : h('p', { class: 'muted small' }, 'This check is expected to fail: the signature or preimage is invalid.'),
        downloadVariant(proof));
    } catch {
      content.replaceChildren(h('p', { class: 'muted small' }, 'Could not load the script inline.'), downloadVariant(proof));
    }
  };
  disclosure.addEventListener('toggle', () => { if (disclosure.open) showCommand(); }, { once: true });

  return checkCard('verify-independent', number, 'Decode the invoice yourself', 'advanced', [
    h('p', null, 'The checks above use values this page extracted from the invoice. This short Python script (standard library only — ',
      h('a', { href: PYTHON_SCRIPT_URL, target: '_blank', rel: 'noopener' }, 'read it'),
      ') reads the ', h('b', { class: 'c-inv' }, 'raw invoice'), ' itself, checks the preimage, and prepares the files so that ' +
      'openssl can check the signature. It does not rely on the page’s decoding, but you must still trust or review the script itself.'),
    disclosure,
    otherTools(invoice),
  ]);
}

function downloadVariant(proof) {
  return h('div', { class: 'file-variant' },
    h('p', null, h('b', null, 'Prefer a file? '),
      h('a', { href: PYTHON_SCRIPT_URL, download: 'verify_invoice.py' }, 'Download verify_invoice.py'),
      ' (', h('a', { href: PYTHON_SCRIPT_URL, target: '_blank', rel: 'noopener' }, 'read it first'),
      '), then run — assuming it was saved to your Downloads folder:'),
    codeBlock(independentCommand(proof), { title: 'Terminal — downloaded script + openssl' }),
    h('p', { class: 'muted small' }, 'Same output as above.'));
}

function otherTools(invoice) {
  const encoded = encodeURIComponent(invoice.bolt11);
  const webDecoders = [
    externalLink(`https://lightningdecoder.com/?q=${encoded}`, 'lightningdecoder.com'),
    externalLink(`https://lndecode.com/?invoice=${encoded}`, 'lndecode.com'),
    externalLink('https://www.bolt11.org/', 'bolt11.org'),
    externalLink('https://www.spark.money/tools/lightning-decoder', 'spark.money'),
    externalLink('https://tools.lucasqc.com/en/tools/lightning-decoder', 'tools.lucasqc.com'),
  ].flatMap((link, i) => (i ? [', ', link] : [link]));

  return h('div', { class: 'other-tools' },
    h('p', null, h('b', null, 'Other independent tools'), ' — compare the payment hash and the node id (“payee” / “destination”):'),
    h('ul', null,
      h('li', null, 'LND: ', h('code', null, 'lncli decodepayreq <invoice>')),
      h('li', null, 'Core Lightning: ', h('code', null, 'lightning-cli decode <invoice>')),
      h('li', null, 'Web decoders: ', webDecoders)),
    h('p', { class: 'muted small' }, 'Opening a web-decoder link shares the invoice with that site, never the preimage.'));
}
