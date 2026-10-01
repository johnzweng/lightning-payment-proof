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

// A real payment used by the "Try an example" button.
const EXAMPLE_INPUTS = {
  bolt11: 'lnbc123450n1p5cprkppp5xwmjlgvrj5mjqxgdmkj604tm7pdmphtfm0nt2w658zhwp8034qcshp5vyechhpl6zgtmhxnavaf9t4gnwswx5rmhaw35tt7z3v8nccd2d8qcqzxrxqrxl9sp5nwwqxz2dydguzjugzrsljqpaexa8g3s44y7kzjad393d577ezw7q9qxpqysgq4x347pfq5kcetje9chpdw0hdxpgwuzyc8crttywy3999p2whkf44gtzzz9v6ljd0d8afm2u7k0v5esrcchsm4tzamnfmw6tagqrup5gqsunfaf',
  preimage: 'feb16f282c6de9fa954a2179f881d0987a5c3d0d59d192c3adf0b8fb1d3a8174',
  hash: '33b72fa183953720190ddda5a7d57bf05bb0dd69dbe6b53b5438aee09df1a831',
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
