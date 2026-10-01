# ln-payment-proof — design notes

This document explains **why** this tool exists and **why it is built the way it is**.
For *what is where* and *how to run and deploy it*, see [README.md](README.md).

---

## 1. The problem

When you pay a Bitcoin Lightning invoice (BOLT11) you get two things:

1. **Before paying:** the invoice from the receiver. It is digitally signed by the receiver's
   node and contains a *payment hash* `H`.
2. **After paying:** the *preimage* `P`, which your wallet receives as the payment completes.
   `SHA-256(P) = H`.

Together they prove the payment. Only the receiver knew `P`, and a Lightning node reveals `P`
only when it accepts the payment. In practice, though, showing this to someone is cumbersome:

```
echo -n "<preimage>" | xxd -r -p | shasum -a 256     # …and compare by eye with a hash
                                                     # that you first have to dig out of the invoice
```

It also proves nothing to someone who doesn't know what a payment hash is, where it comes
from, or why the invoice can be trusted.

**The concrete scenario we designed for:** you paid someone, and they claim they never
received the money. They are *not* a Lightning expert. You want to send them **one link** that:

- **proves** that the payment was received (claimed by their node),
- **explains** why this is a proof, in plain words, with low cognitive load,
- lets them **check every step on their own computer** without trusting you or this website,
- points to meaningful third-party sources (node explorers, specs).

## 2. Requirements

Paths are relative to `public/assets/`.

| # | Requirement | Where it shows up |
|---|-------------|-------------------|
| R1 | Input: BOLT11 invoice + preimage (payment hash optional, it's in the invoice anyway) | input form, URL params |
| R2 | Self-contained link `https://lnproof.utxo.at?bolt11=…&preimage=…` | `proofUrl()` in `ui/url.js` |
| R3 | Verify **in the page**: invoice signature and `SHA-256(preimage) == payment_hash` | `lnproof/` |
| R4 | Explain **why** this is a proof, understandable for beginners | "Why this proves the payment" section |
| R5 | Copy-paste terminal commands for macOS and Linux to verify by hand, including the signature (openssl or equivalent) | "Check it yourself" section |
| R6 | Show the receiver node id, link to `terminal.lightning.engineering/explore/<nodeid>` (and other explorers) | receiver section |
| R7 | Handle **route hints**: the receiver may be a private node that explorers don't know. Explain this and show all entry points | receiver section, route cards |
| R8 | Visually pleasing, low cognitive load | whole UI |
| R9 | Ready to deploy: static files, copy them to a web server | `public/`, `deploy/nginx.conf` |

Added later, after looking at real-world invoices:

| # | Requirement | Where |
|---|-------------|-------|
| R10 | Detect **Spark** wallets (identity key hidden in a fake route hint), show it as a valid `spark1…` address | `lnproof/spark.js`, Spark card in `ui/views/receiver.js` |
| R11 | Explain why a Spark explorer may show the wallet as empty (Privacy Mode) | Spark card |
| R12 | Label known infrastructure nodes (Spark routing nodes), **only as far as documented** | `lnproof/known-nodes.js` |

### Non-goals

- No accounts, no storage and no backend. The server never needs to know about a proof.
- Not a general-purpose invoice decoder or wallet. The decoding exists to serve the proof.
- No BOLT12 offers, LNURL-verify or keysend. These are different mechanisms; BOLT11 is what
  people actually get receipts for today.
- No fiat conversion (would need a price API and the payment timestamp is not part of the proof).

## 3. What the proof proves (the trust model)

This drives much of the wording on the page, so it is spelled out here. The simple headline
"This invoice has been paid" assumes the receiver recognizes their invoice and receiving node,
and that the preimage was kept secret until payment. We keep that headline and the short
explanation approachable; the qualifications below belong in "What exactly does this prove —
and what not?", not in the main verdict.

- **The invoice is authentic.** It carries an ECDSA/secp256k1 signature by the receiver's node
  over the signed invoice contents. Nobody can change amount, hash or description while
  preserving a valid signature **under the original receiver's public key**.
- **The preimage matches.** `SHA-256(preimage) == payment_hash`. SHA-256 is preimage-resistant:
  finding `P` for a given `H` is computationally infeasible. If `P` was kept secret until
  settlement, possession of it is evidence that it was released through payment.
- **In normal operation, nodes release `P` when they accept the payment** (at least the invoice
  amount; the receiver rejects underpayment per BOLT 4). Subject to the assumptions below,
  the sender holding `P` is evidence that the receiver's node **claimed** the payment.

BOLT11's optional `n` field states the public key; without it, the key is recovered from the
signature and signed contents. Omitting `n` does **not** weaken verification against a known
receiver key. However, changing an invoice without re-signing can produce a **different
recovered key**, under which the unchanged signature verifies. This is not a forgery against
the original receiver and does not demonstrate knowledge of the new key's private key.
Keeping `n` makes the change fail against its stated key, but an attacker can remove `n` and
recompute the Bech32 checksum. Neither encoding replaces checking your invoice and node ID.

`verifyProof().proven` means only that the signature verifies under the displayed key and the
preimage matches. It does not independently authenticate the receiver or establish how the
preimage was obtained. A leaked, shared, or deliberately disclosed preimage can also match;
the checks cannot distinguish that from normal settlement.

What the proof does **not** say, which the page states in "What exactly does this prove — and
what not?":

- It does not contain the payer's identity. A preimage can be copied and shared; its current
  holder need not be the payer.
- It gives no exact time. Payment normally lies between invoice creation and expiry, but
  these dates are not cryptographic evidence of settlement time.
- It does not show whether a **custodial/hosted wallet** credited the user's account. The node belongs to the
  service; the money reached the service. The user can contact the service with the payment hash.
- The "payment secret" (`s` field) is **not** the preimage. This is a common confusion, so it is
  called out.

We deliberately avoid over-claiming. Claims we couldn't back with a source (e.g. "this node is
operated by Lightspark") are not made. See §8.

## 4. Architecture decisions

### 4.1 Static single-page app, all computation in the browser
**Why:**
- **Trust:** the reader should not have to trust a server. Everything shown is recomputed
  locally, and the terminal commands let them bypass the page entirely.
- **Privacy:** invoice + preimage never have to be processed server-side.
- **Operations:** zero moving parts. Plain files, served by any web server, deployable by copying. Nothing
  to patch, no database, no API to keep alive.

### 4.2 No dependencies, no build step, own crypto code
`public/assets/lnproof/` implements bech32/bech32m, SHA-256, secp256k1 (verify + public-key
recovery, using `BigInt`), and the BOLT11 parser itself: one small module per concern,
about 800 lines in total, comments included.

**Why not a library (e.g. bolt11 / noble-secp256k1 via npm)?**
- **Auditability:** "you can read the verification code" is part of the promise (footer link).
  A handful of small, readable files beats a minified bundle of transitive dependencies.
- **Supply chain:** nothing to pin, update or get compromised. No CDN, so the CSP can be
  `script-src 'self'` only.
- **Longevity:** standard JavaScript (ES2021, `BigInt`), no framework and no bundler.
  It will run unchanged for years.

**Why this is acceptable security-wise:** we only *verify* public data. There are no private
keys and no signing, so constant-time concerns don't apply. Correctness is covered by
tests against the official BOLT11 test vectors, a real-world invoice, SHA-256 known answers,
and cross-checks with an independent Python implementation and openssl (§9).

SHA-256 is implemented in JS instead of WebCrypto because WebCrypto is async and only
available in secure contexts. The pure-JS version also runs unchanged in the Node.js tests.

### 4.3 Code structure: native ES modules
- **`lnproof/`** is the verification library. It has no DOM access and runs in browsers and
  Node.js alike. `index.js` is its public API, and `verifyProof()` in `proof.js` is the single
  entry point the page needs.
- **`ui/`** holds the page: a tiny `h()` DOM helper (§4.6), formatting, the node lookups, and
  one file per page section in `ui/views/`. `app.js` only handles the form and routing.
- **Why ES modules without a bundler:** the browser loads the files exactly as they are in
  the repository. What you read on GitHub is what runs. Imports show every dependency
  between files. The only cost: the page must be served over HTTP (browsers don't load
  modules from `file://`).

### 4.4 Hosting: plain static files
- Any web server works. `deploy/nginx.conf` is the reference configuration, and it runs
  unchanged in the official `nginx` Docker image.
- **Read-only:** the web server only needs read access to `public/` (`:ro` volume in Docker).
- **Relative asset paths:** the page also works under a sub-path
  (e.g. `https://example.com/ln-proof/`). Proof links are built from the page's own URL.
- **Cache policy:** `expires -1` (→ `Cache-Control: no-cache`, revalidated via ETag). Files
  are tiny, and this makes a deploy visible immediately without cache-busting filenames.

### 4.5 The link format and privacy
- The requested format is `?bolt11=…&preimage=…`. It is short, readable and survives chat apps.
- Query strings reach the server. That's why the nginx config uses its own log format,
  `ln_proof_no_query`, which logs `$uri` (no query) and no referer. **Proof data never
  lands in log files.** A reverse proxy in front must not log query strings either.
- `#bolt11=…&preimage=…` (URL fragment) is also accepted. Fragments are never sent to any server,
  for people who want that. The generated link uses `?` as requested.
- `<meta name="referrer" content="no-referrer">` + `rel="noopener noreferrer"`: clicking an
  explorer link does not leak the proof URL to third parties.
- The payload is inherently public-ish. Sharing the link *is* disclosure of the invoice
  (amount, description) and preimage to the recipient. The page says so in the share section.

### 4.6 Security headers / hardening

[SECURITY.md](SECURITY.md) is the detailed threat model, security policy and maintainer checklist.
The design is layered: validate and bound input, preserve signed bytes, then protect each output
context separately. In particular, valid BOLT11 encoding can carry hostile decoded text.

- **CSP:** `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' https://mempool.space; …`.
  This is why the code never uses inline `style="…"` attributes (only CSSOM/classes).
- **No `innerHTML` with user data.** The invoice description is attacker-controlled text
  (whoever creates the invoice chooses it). All DOM is built via a tiny `h()` helper with
  `textContent`. `innerHTML` is only used for the static SVG icon constants.
- `frame-ancestors 'none'`: the page can't be framed to mislead people.
- `Permissions-Policy`, `COOP`, `nosniff`, `server_tokens off`, dotfiles denied. A meta CSP also
  protects generic static hosting; framing restrictions still require the nginx header.
- Raw invoices are capped at 32,768 characters and normalized invoices at 16,384, with limits on
  fields, route hops and numeric/date values. Preimages and optional hashes are bounded and validated.
- Decoded display controls/bidi overrides are visibly escaped, never applied to the signed bytes.
  Missing recovered keys and rendering errors have controlled failure states.

### 4.7 The only third-party request: node lookups on mempool.space
The page asks `mempool.space/api/v1/lightning/nodes/<pubkey>` for alias, channel count and
capacity, and to decide "public node" vs. "not in the public network map".

**Why:** for a non-expert, "public node · 195 channels" or a recognisable alias is much more
meaningful than 66 hex characters. It also drives the private-node explanation (R7).
**Trade-off:** only *public keys* are sent (never invoice or preimage), with `credentials: omit`
and no referrer. mempool.space was chosen because it has CORS enabled, no API key, and is
well known. Lookups are **best-effort**. Failure or a timeout just shows "lookup unavailable", and the proof
does not depend on it. Requests are deduplicated and limited to 64 distinct keys per page load,
with at most four concurrent requests. Responses are streamed with a 64 KiB limit and validated
before display (including binding the response key to the request); redirects are rejected.
Aliases are untrusted text, not authenticated identities. mempool answers HTTP 500 (not 404) for unknown nodes; both mean
"not found". It can be removed by deleting the `nodeStatus()` calls (`ui/node-info.js`) and
the `connect-src` entry.

## 5. Verification design ("Check it yourself")

### 5.1 The trust ladder
We offer three levels, each removing trust in the page:

1. **In the browser.** Instant, zero effort. The page must be trusted.
2. **Check 1 + 2 in the terminal**, with values the page extracted from the invoice:
   - `printf '%s' '<preimage>' | xxd -r -p | shasum -a 256` (macOS) / `sha256sum` (Linux)
   - openssl verifies the signature over the signed invoice bytes with the node key.
   The math is done by the user's own tools; only the extraction is trusted.
3. **Check 3: independent decoding.** A bounded, stdlib-only Python script
   (`verify_invoice.py`) reads the *raw invoice*, verifies the bech32 checksum, extracts payment hash,
   node id (or recovers it), checks the preimage, and writes the files for openssl. This removes
   reliance on the page's extraction, **not** trust in the script itself: review it or obtain it
   from a trusted source. The script is readable and shown inline.

Plus pointers to other independent tools: `lncli decodepayreq`, `lightning-cli decode`, and
web decoders.

**Why Python for level 3?** openssl can verify ECDSA, but it can't decode bech32 or the BOLT11
field layout. Doing that in pure shell would be unreadable. `python3` is present on practically
every Linux and on macOS (Xcode CLT). The script sticks to Python 3.8+ features (`pow(x, -1, m)`)
and was tested with the macOS system Python 3.9, 3.11, 3.12 and 3.15.

### 5.2 Why the commands look exactly like they do
- **Tools:** `xxd`, `shasum`/`sha256sum`, `openssl`, `python3`. All are preinstalled on macOS and
  common Linux distros. `xxd` was used in the original manual check (familiar), and a hint covers
  Linux systems that lack it (`apt install xxd`).
- **macOS/Linux tab**, auto-selected by user agent: the only difference is `shasum -a 256` vs.
  `sha256sum`. Windows users are pointed to Git Bash/WSL.
- **No `#` comments in pasted shell code.** macOS's default shell is zsh, and interactive zsh
  does *not* treat `#` as a comment (`interactivecomments` is off). Pasted comments would
  produce `command not found`. Explanations therefore live in the page, next to the command.
- **Guarded temporary directory:** file-producing commands run in a bash/zsh subshell with
  `pipefail`, `workdir="$(mktemp -d)" && cd "$workdir" && …`, and `&&` between stages.
  Failure stops later steps; the user's current directory and shell options are unchanged.
- **Shell output boundary:** `ui/commands.js` revalidates every dynamic argument, single-quotes
  literals, rejects controls and uses fixed `printf '%s'` formats. Invoice descriptions are never
  interpolated into commands or Python code. Visible and copied commands use the same tokens.
- **Python isolation and files:** `python3 -I` ignores local/user import overrides. A quoted,
  delimiter-checked here-document carries trusted script source; invoice/preimage arrive via argv.
  The script exclusively creates fixed filenames (no overwriting or following symlinks), escapes
  descriptions as ASCII JSON strings and fails before file creation on invalid/mismatching input.
- **Public key as DER:** openssl needs a key file. We build it visibly as
  `SubjectPublicKeyInfo prefix (secp256k1) ‖ node id` in hex, so the reader can *see* the node
  id inside the command, rather than getting an opaque PEM blob.
- **Signed data:** BOLT11 signs `SHA-256(hrp_ascii ‖ data_5bit→8bit_zero_padded)`.
  `openssl dgst -sha256 -verify` hashes the file itself, so we hand it exactly those bytes
  (`invoice.bin`). The page points out that it begins with the ASCII `lnbc…` prefix.
- **Signature** converted from BOLT11's compact `r‖s` to DER, which openssl expects.
- **Expected output** is shown under every command, colour-coded like the page.
- Verified verbatim (copied from the rendered page) in interactive zsh with stock macOS tools
  (LibreSSL 3.3, Python 3.9), Debian 12 (OpenSSL 3.0) and Ubuntu 24.04. A tampered byte yields
  `Verification failure`.

### 5.3 Signature details
- If the invoice has an `n` field, we verify against it and report whether public-key recovery
  gives the same key; that comparison is diagnostic, not a condition of acceptance. Without
  `n`, the key is recovered from the signature (recovery id) as the spec requires. In either
  case, the receiver must recognize their invoice and receiving node (§3).
- High-S signatures are flagged but not rejected. openssl accepts them too, and a disagreement
  between page and terminal would confuse users more than it helps.

## 6. UX decisions

The main quality goal was **low cognitive load for a non-expert who is possibly annoyed**.

- **Verdict first.** The first screen answers the only question the reader has ("was I
  paid?"): a big green/red/neutral state, a receipt-like summary (amount, description, paid to,
  date) and two plain checkmarks. Everything else is below, for those who want it.
- **One metaphor, used consistently:** *secret / fingerprint / lock / key*. The three-step story
  (receiver creates a secret → payment is locked to its fingerprint → taking the money reveals
  the secret) avoids the jargon "HTLC". Technical names (preimage, payment hash) are introduced
  once, next to the plain words.
- **Colour means something, everywhere.** Payment hash = violet, preimage = orange, node =
  teal, the same in text, value chips, the equation and inside the terminal commands. The reader
  can match things by colour without reading hex.
- **Hex grouped in 8-character chunks** (pubkeys: `03` prefix separate, then 8×8). The
  equation `SHA-256(preimage) = payment hash` puts both hashes on top of each other with
  matching chunks highlighted, so they can be compared at a glance.
- **Progressive disclosure:** fine print, all technical fields, the Python script and raw
  invoice are behind `<details>`.
- **Honest failure states:** wrong preimage → red "not a proof" with a likely cause; broken
  checksum → "probably not copied completely"; missing preimage → neutral "invoice checked,
  receipt missing".
- **Input tolerance:** `lightning:` prefix, uniformly upper-case invoices, ASCII space/tab/CR/LF,
  and `0x` hex prefixes are accepted. Mixed-case invoices, hidden Unicode whitespace and
  lookalikes are rejected, not silently transformed. Paste is messy, but normalization stays narrow.
- Dark mode, mobile layout and a clean print layout (a printed receipt is a plausible use).
- System fonts only, no web fonts. This keeps the page fast and avoids another third-party request.
- English only for now. The layout doesn't depend on text length, so translations would be
  straightforward.

## 7. Route hints and private nodes

Many receivers (mobile and hosted wallets) use **unannounced nodes**. Explorers show
"not found", which a sceptical reader might read as "fake". The page therefore:

- states explicitly that this is normal and **does not weaken the proof**, because the signature
  identifies the node regardless of whether it is listed;
- lists **every route hint** as a chain *entry point → channel → receiver*, with explorer
  links and live public/alias info for each entry point;
- adapts the explanation to the lookup result (public, probably private, or lookup failed).

Heuristics to prevent misreading hint data:
- A short channel id with block `0` or `≥ 16,000,000` is not a real on-chain position but an
  **alias** (private channels / SCID alias). It is labelled "private alias".
- Fees ≥ 1,000,000 sat base or ≥ 100 % proportional make a hint **unusable**. It is labelled as a
  placeholder.

## 8. Spark

Real-world invoices from Spark-based wallets (e.g. Wallet of Satoshi's self-custodial mode)
contain a route hint that looks bogus: channel `16000000x16000000x1`, fee 4,000,000 sat.
Showing that as a "route" would confuse readers and make the invoice look suspicious.

**Detection** follows the Spark SDK exactly (`buildonspark/spark`,
`sdks/js/packages/spark-sdk/src/services/bolt11-spark.ts`), in the same order:
1. fallback-address field `f` with **version 31** → its data is a Spark address (text);
2. otherwise the legacy route hint with sentinel `short_channel_id == f42400f424000001`.
   That hop's "pubkey" is the wallet's **Spark identity key**, not a Lightning node.

**Encoding** follows `spark-sdk/src/utils/address.ts`: `bech32m(hrp, protobuf SparkAddress)`
with field 1 = identity key (`0a 21 ‖ key`). The prefix is chosen by network (`spark`, `sparkt`, `sparkrt`,
`sparks`). The implementation is verified against the SDK's own test vector
(`0353908b… → sparkrt1pgssx5us3wkq…`) and its version-31 fallback sample, and the result
was cross-checked with the sparkscan API (address → same public key).

**Presentation:** a dedicated Spark card explains the layer-2 set-up (a Spark service provider
receives the Lightning payment on the wallet's behalf) and shows the Spark address and identity
key. The fake hint is rendered as "Route N — not a real route", with no Lightning explorer
links and no node lookup.

**Why the proof still holds:** per Spark's docs, the preimage is secret-shared among the
Spark operators and can only be reassembled together, atomically with handing the funds
to the receiver's wallet. The page states this and links the docs.

**Empty explorer:** Spark has no public ledger. Explorers only see what operators expose, and
wallets can enable **Privacy Mode** (`setPrivacyEnabled(true)`), after which public queries
return balance 0 and no transfers. That's indistinguishable from an unused wallet, and exactly what
sparkscan showed for our real-world example. The page explains this pre-emptively, so an empty
explorer isn't taken as counter-evidence.

**Attribution policy (`lnproof/known-nodes.js`):** we label a node only with what a primary source says.
Spark's docs list `039174f8…` and `02a98e8c…` as "our routing nodes", so they are labelled
**"Spark routing node"**, with the note "Spark (developed by Lightspark)" and a link to the
source. One third-party repo calls them "Lightspark (Coinbase)", but no official source says who
operates them, so we don't claim it.

## 9. Testing

`test/run-tests.sh` (`node --test`, then python3 + openssl):
- BOLT11 spec vectors (valid ones incl. pubkey recovery, pico-BTC amounts, route hints;
  invalid ones: checksum, multiplier, sub-msat, mixed case);
- the real-world invoice + preimage (explicit `n`, two route hints, Spark marker);
- wrong/malformed preimage, payment-hash cross-check, tampered invoice;
- SHA-256 known answers;
- Spark: SDK address vector, legacy address, fallback-v31 sample (embedded in a synthetic invoice);
- number, date and amount formatting;
- the Python script + openssl path, including tampered-data and typo negative tests;
- adversarial input, shell/here-document injection, terminal output spoofing, DOM/link safety,
  clipboard/visible command equality, size/numeric limits, bounded API requests/responses,
  fail-closed command execution, Python import isolation and file/symlink safety (see SECURITY.md);
- an optional, Git-ignored CLN CSV export (`payment_preimage,bolt11`), checked row-by-row by the
  browser's JavaScript library (including signatures) and by the independent Python checksum,
  invoice-field and preimage verifier. Failures identify only row numbers, so test output does not
  disclose payment data. CI uses a committed public example row to exercise the same harness.

GitHub Actions runs the same script on every push. Private CLN exports are never committed or used
in CI.

The UI was checked manually in Chrome (desktop, iPhone emulation, light and dark) against the
real nginx config in a local container, and the generated terminal commands were executed
verbatim on macOS, Debian and Ubuntu (§5.2).

## 10. Known limitations and ideas

- **High-S recovery spec vector:** for the BOLT11 vector "public-key recovery with high-S
  signature" we return the mathematically standard recovered key, not the key of the
  corresponding low-S vector. Real wallets always produce low-S signatures, so this doesn't matter in
  practice.
- Unknown/new tagged fields (e.g. blinded paths `b`) are shown raw in "All technical fields"
  and otherwise ignored. They don't affect the proof.
- `verify_invoice.py` does not report Spark information. It stays focused on the proof.
- `lnproof/known-nodes.js` is a hand-maintained list. Only add entries backed by a primary source.
- The "Try an example" button uses the real invoice from development (contains a Wallet of
  Satoshi username). Swap in another example if that's unwanted.
- Possible extensions: BOLT12 (payer proofs), translations, optional QR code of the proof link.
