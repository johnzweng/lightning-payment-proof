// Lightning Payment Proof — entry point: the input form, and routing between input and result view.
// All verification happens locally (lnproof/). The only network requests are optional
// node lookups on mempool.space, which receive public keys only.

import { verifyProof } from './lnproof/index.js';
import { $, icon } from './ui/dom.js';
import { formatSats } from './ui/format.js';
import { hasFragmentParameters, proofUrl, readProofParameters } from './ui/url.js';
import { explanationSection } from './ui/views/explanation.js';
import { invoiceDetailsSection } from './ui/views/invoice-details.js';
import { receiverSection } from './ui/views/receiver.js';
import { shareSection } from './ui/views/share.js';
import { inputsBar, verdictCard } from './ui/views/verdict.js';
import { verifyYourselfSection } from './ui/views/verify-yourself.js';

const PAGE_TITLE = 'Lightning Payment Proof';
const EMPTY_INPUTS = { bolt11: '', preimage: '', hash: '' };

// A real payment (Wallet of Satoshi, Spark-based) used by the "Try an example" button.
const EXAMPLE_INPUTS = {
  bolt11: 'lnbc286050n1p4tetxlpp524jfexmca98flrqzdqrwxt5n7lzwwv8x77mckzw4ajstwsmex2gqsp52u00ael68v8yrt2cms6pyj93ftgyy9n6rk7lren03p52hjs5jwjsxq9z0rgqnp4qvyndeaqzman7h898jxm98dzkm0mlrsx36s93smrur7h0azyyuxc5rzjqwghf7zxvfkxq5a6sr65g0gdkv768p83mhsnt0msszapamzx2qvuxqqqqrt49lmtcqqqqqqqqqqq86qq9qrzjq0qvdqygawseu8s2x34fl63ss3pxfy66tjy5z88q649jtc8ymz4wfapyqr6zgqqqq8hxk2qqae4jsqyugqcqzpudz82pshjgr5dus9wctvd3jhggr0vcs9xct5daeks6fqw4ek2u36yp68yctswpjkgunfvgcnxdc9qyyssq5eaumrd9727u9eyef3lds7jpxcfyzftuaay09rg277l5jlqxp2ms4n4qmxtlquazs5x5gpzwk73s3lrwpy69qwyzezn42samqgn906qq7c4qfm',
  preimage: 'c420c4e4e7eebab9ab0d589055bfb7c6958401095f550c382028cf249d39d127',
  hash: '',
};

/* ---------- views ---------- */

function showView(name) {
  const isResult = name === 'result';
  $('#view-input').hidden = isResult;
  $('#view-result').hidden = !isResult;
  $('#nav-verify').hidden = !isResult;
  $('#nav-new').hidden = !isResult;
  window.scrollTo(0, 0);
}

function showInputView(inputs = EMPTY_INPUTS, errors = {}) {
  document.title = PAGE_TITLE;
  showView('input');
  fillForm(inputs);
  setFieldError('bolt11', errors.bolt11);
  setFieldError('preimage', errors.preimage);
}

/** Verifies the inputs and shows the result, or the form with an error message. */
function showProof(inputs, { updateUrl }) {
  let proof;
  try {
    proof = verifyProof(inputs.bolt11, inputs.preimage, inputs.hash);
  } catch (error) {
    showInputView(inputs, { bolt11: error.message });
    return;
  }
  if (proof.preimageError) {
    showInputView(inputs, { preimage: proof.preimageError });
    return;
  }
  if (updateUrl) {
    history.pushState(null, '', proofUrl(inputs));
    currentRoute = routeKey();
  }
  showResultView(proof, inputs);
}

function showResultView(proof, inputs) {
  const shareUrl = proofUrl(inputs);
  const edit = () => showInputView(inputs);
  const addPreimage = () => {
    edit();
    $('#in-preimage').focus();
  };

  document.title = resultTitle(proof);
  const sections = [
    inputsBar(proof, edit),
    verdictCard(proof, { shareUrl, onAddPreimage: addPreimage }),
    proof.preimage ? explanationSection(proof) : null,
    receiverSection(proof),
    invoiceDetailsSection(proof),
    verifyYourselfSection(proof),
    proof.proven ? shareSection(shareUrl) : null,
  ];
  $('#view-result').replaceChildren(...sections.filter(Boolean));
  showView('result');
}

function resultTitle({ proven, preimageMatches, invoice }) {
  const verdict = proven ? '✅ Payment proven' : preimageMatches === false ? '❌ Not a proof' : 'Invoice';
  const amount = invoice.amountMsat != null ? ` · ${formatSats(invoice.amountMsat)}` : '';
  return `${verdict}${amount} · ${PAGE_TITLE}`;
}

/* ---------- form ---------- */

const formInputs = () => ({ bolt11: $('#in-bolt11'), preimage: $('#in-preimage'), hash: $('#in-hash') });

function fillForm(inputs) {
  const fields = formInputs();
  for (const name of Object.keys(fields)) fields[name].value = inputs[name] ?? '';
  if (inputs.hash) $('#opt-hash').open = true;
}

function readForm() {
  const fields = formInputs();
  return { bolt11: fields.bolt11.value, preimage: fields.preimage.value, hash: fields.hash.value };
}

function setFieldError(name, message) {
  const input = $(`#in-${name}`);
  const error = $(`#err-${name}`);
  error.hidden = !message;
  error.textContent = message ?? '';
  input.classList.toggle('invalid', Boolean(message));
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

function setUpForm() {
  $('#proof-form').addEventListener('submit', (event) => {
    event.preventDefault();
    showProof(readForm(), { updateUrl: true });
  });
  $('#btn-example').addEventListener('click', () => showInputView(EXAMPLE_INPUTS));
  for (const name of ['bolt11', 'preimage']) {
    $(`#in-${name}`).addEventListener('input', () => setFieldError(name, null));
  }
  // Enter in the invoice field moves on to the preimage instead of adding a line break
  $('#in-bolt11').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      $('#in-preimage').focus();
    }
  });
}

/* ---------- routing ---------- */

let currentRoute = null;
const routeKey = () => JSON.stringify(readProofParameters());

// "#verify" and other anchors on a fragment-based proof link (#bolt11=…) replace the fragment.
const isInPageAnchor = () => location.hash.length > 1 && !hasFragmentParameters() && !location.search;

function route() {
  const key = routeKey();
  // Following in-page anchors also fires popstate: only re-render when the proof changed.
  if (currentRoute !== null && (key === currentRoute || isInPageAnchor())) return;
  currentRoute = key;
  const parameters = readProofParameters();
  if (parameters.bolt11) showProof(parameters, { updateUrl: false });
  else showInputView();
}

/* ---------- start ---------- */

for (const placeholder of document.querySelectorAll('[data-icon]')) placeholder.append(icon(placeholder.dataset.icon));
setUpForm();
window.addEventListener('popstate', route);
route();
