<h1 align="center">⚡ Lightning Payment Proof</h1>

<p align="center">
  <b>Prove that a Bitcoin Lightning invoice was paid — with a single link.</b><br>
  Verified in the browser · explained in plain words · checkable in your own terminal · zero dependencies
</p>

<p align="center">
  <a href="https://lnproof.utxo.at"><b>Try it: lnproof.utxo.at</b></a>
  &nbsp;·&nbsp;
  <a href="DESIGN.md">Design notes</a>
  &nbsp;·&nbsp;
  <a href="SECURITY.md">Security</a>
  <br><br>
  <a href="https://github.com/johnzweng/lightning-payment-proof/actions/workflows/test.yml"><img src="https://github.com/johnzweng/lightning-payment-proof/actions/workflows/test.yml/badge.svg" alt="Tests"></a>
  <a href="#zero-dependencies-on-purpose"><img src="https://img.shields.io/badge/dependencies-none-brightgreen" alt="No dependencies"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
</p>

<p align="center">
  <img src="docs/screenshot.png" alt="A verified Lightning payment: “This invoice has been paid.” with amount, receiver node and two green checks" width="820">
</p>

## The problem

You paid a Lightning invoice. The receiver says the money never arrived.

Your wallet has the proof, the **preimage**. But a 64-character hex string convinces nobody who
doesn't know what a preimage is.

This page turns **invoice + preimage** into one link:

```
https://lnproof.utxo.at/?bolt11=lnbc…&preimage=…
```

Whoever opens it sees whether the invoice was paid, why that counts as proof, and how to check it themselves.

## How the proof works

| Step | What happens | What the page checks |
|------|--------------|----------------------|
| 1. Invoice | The receiver's node picks a secret *preimage* and **signs** an invoice containing its fingerprint, the *payment hash*. | The signature is valid → the invoice is genuine. |
| 2. Payment | The money travels through the network, locked to the payment hash. | — |
| 3. Receipt | To take the money, the receiver's node must reveal the preimage. It travels back to the payer. | `SHA-256(preimage) == payment hash` → the receiver's node released it. |

Nobody can compute a preimage from a hash. So a matching preimage means the receiver's node
accepted the payment. [DESIGN.md §3](DESIGN.md#3-what-the-proof-proves-the-trust-model)
covers exactly what this proves and what it doesn't.

## Features

- **Zero dependencies.** No npm packages, no CDN, no build step, no framework. See
  [why](#zero-dependencies-on-purpose).
- **Private.** Everything is computed in your browser. Invoice and preimage are never uploaded.
- **Plain words.** A clear verdict first, then a one-minute explanation for non-experts.
- **Independent checks.** Reviewable copy-paste commands for macOS and Linux repeat every check with
  `shasum`, `openssl` and a short Python script that uses only the standard library.
- **Receiver details.** Node id, explorer links and route hints, plus an explanation of why a
  private node is still a valid proof.
- **Spark wallets** are recognized, and their Spark address is shown.

<details>
<summary><b>Screenshot: “Check it yourself” (dark mode)</b></summary>
<br>
<img src="docs/screenshot-check-yourself.png" alt="Terminal command to compute SHA-256 of the preimage, with the expected output" width="820">
</details>

## Zero dependencies, on purpose

Every line of code that runs is in this repository and was written for it:

- **In the browser:** plain JavaScript files, loaded exactly as they are. There are no npm
  packages, no bundler, no framework, no CDN, no web fonts and no trackers. SHA-256, secp256k1,
  bech32 and the BOLT11 decoder are implemented in [`lnproof/`](public/assets/lnproof),
  about 800 readable lines.
- **In the terminal:** the Python verifier uses only the standard library, and the other
  commands use tools that come with macOS and most Linux systems (`shasum`, `xxd`, `openssl`).
- **For the tests:** Node's built-in test runner, `python3` and `openssl`. There's no
  `npm install`.

**Why?** A page that asks you to trust its verdict has to be easy to check:

- **Readable.** You can read everything the page runs, in a few small files.
  What you see on GitHub is exactly what your browser loads, with no minified bundle in between.
- **Nothing to hijack.** A compromised package or CDN can't change what the page shows, because
  there are none. Crypto and wallet libraries are popular targets for supply-chain attacks. This
  is also why the Content-Security-Policy can allow scripts from the page's own server only.
- **Private.** No third-party script ever sees a proof link.
- **Built to last.** A proof link should still work in ten years. Static files with nothing to
  update, patch or rebuild will.

**What about writing our own crypto?** The usual warning is about *secret* keys: signing,
[side channels](https://en.wikipedia.org/wiki/Side-channel_attack) and constant-time code. This
page only *verifies* public data: it holds no keys and signs nothing. The code is tested against
the official BOLT #11 test vectors and SHA-256 known answers, and cross-checked with an
independent Python implementation and openssl. More in
[DESIGN.md §4.2](DESIGN.md#42-no-dependencies-no-build-step-own-crypto-code).

## Run it locally

```sh
git clone https://github.com/johnzweng/lightning-payment-proof.git
cd lightning-payment-proof
python3 -m http.server 8000 --directory public
```

Open <http://localhost:8000> and click **Try an example**.
Any static web server works. Opening `index.html` directly (`file://`) does not, because browsers don't load JavaScript modules from files.

## Deploy

The whole app is the `public/` folder: static files, no backend. Serve it with the included
nginx config, which sets the security headers and **keeps proof data out of the access log**.

**With Docker:**

```sh
docker run -d --name ln-payment-proof --restart unless-stopped -p 8080:80 \
  -v "$PWD/public:/usr/share/nginx/html:ro" \
  -v "$PWD/deploy/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx:alpine
```

**On an existing nginx:**

1. Copy `public/` to your server, e.g. `/var/www/ln-payment-proof`.
2. Copy [`deploy/nginx.conf`](deploy/nginx.conf) to `/etc/nginx/conf.d/` and set `server_name` and `root`.
3. Run `nginx -t && nginx -s reload`.

Add HTTPS in front (e.g. Let's Encrypt or your reverse proxy).
**Updating** means replacing the files. No restart is needed, and browsers pick up changes immediately (`Cache-Control: no-cache`).

> [!IMPORTANT]
> Proof links carry the invoice and preimage in the query string. If you use another server or
> put a proxy in front, make sure its access log doesn't record query strings. Also set a
> Content-Security-Policy like the one in `deploy/nginx.conf`.

## Project layout

```
public/                      ← the website: deploy this folder
├── index.html
└── assets/
    ├── app.js               entry point: input form and routing
    ├── app.css
    ├── lnproof/             verification library (no DOM, also runs in Node.js)
    │   ├── index.js         public API
    │   ├── proof.js         verifyProof(): signature + SHA-256(preimage) == payment hash
    │   ├── bolt11.js        invoice decoding and signature check
    │   ├── bech32.js  sha256.js  secp256k1.js  bytes.js
    │   ├── spark.js         Spark wallet detection
    │   └── known-nodes.js   labelled nodes (primary sources only)
    ├── ui/                  DOM helpers, formatting, node lookups
    │   └── views/           one file per page section
    └── verify_invoice.py    independent decoder offered on the page
deploy/nginx.conf            reference web server config
test/                        tests (node:test, python3 + openssl)
DESIGN.md                    requirements and design decisions
```

The library can be used on its own:

```js
import { verifyProof } from './public/assets/lnproof/index.js';

const proof = verifyProof(invoice, preimage);
proof.proven;          // true: valid signature and matching preimage
proof.invoice.nodeId;  // the receiver's node
```

## Tests

```sh
./test/run-tests.sh      # or: npm test
```

Needs Node.js ≥ 20, Python ≥ 3.8, bash, `openssl`, `xxd` and `shasum` (zsh and `sha256sum` are
also tested when installed). The tests cover the BOLT #11 spec vectors, a real-world invoice,
the Spark SDK vectors, SHA-256 known answers, and the Python + openssl path offered on the page.
Security regressions exercise shell/here-document injection, terminal escapes, DOM/URL injection,
resource limits, hostile API responses and file/symlink protection. See [SECURITY.md](SECURITY.md).

### Testing with a real CLN export

The test harness can verify every completed payment from your own Core Lightning PostgreSQL
backend with both the JavaScript used by the page and the independent Python verifier. Export the
query below as CSV with the header `payment_preimage,bolt11`:

```sql
SELECT DISTINCT ON (payment_hash, groupid)
       encode(payment_preimage, 'hex') AS payment_preimage,
       bolt11
FROM public.payments
WHERE status = 1   -- PAYMENT_COMPLETE
  AND bolt11 IS NOT NULL
  AND payment_preimage IS NOT NULL
ORDER BY payment_hash, groupid, completed_at DESC NULLS LAST, id DESC;
```

For example, with `psql`:

```sh
mkdir -p test/data
psql "$DATABASE_URL" --csv -P footer=off -c \
  "SELECT DISTINCT ON (payment_hash, groupid) encode(payment_preimage, 'hex') AS payment_preimage, bolt11 FROM public.payments WHERE status = 1 AND bolt11 IS NOT NULL AND payment_preimage IS NOT NULL ORDER BY payment_hash, groupid, completed_at DESC NULLS LAST, id DESC" \
  > test/data/test_data_pre-images.csv
./test/run-tests.sh
```

`test/data/test_data_pre-images.csv` is intentionally ignored by Git because invoices may contain
personal payment information. **Never force-add or commit it.** Without that private file, the same
harness runs against the committed public placeholder
[`test_data_pre-images.example.csv`](test/data/test_data_pre-images.example.csv), so CI still tests
the setup. Bulk-test failures print only a row number, not the invoice or preimage.

## Privacy

- **In the browser:** decoding and every check run locally.
- **Third parties:** the only external request goes to
  `mempool.space/api/v1/lightning/nodes/<pubkey>`, to show node names. It sends public keys
  only, with no cookies and no referrer.
- **The web server** receives the query string of `?bolt11=…&preimage=…` links; the included
  config doesn't log it. For links that never reach any server, use a fragment:
  `#bolt11=…&preimage=…`.

## Security

Invoice text and proof links are untrusted input. The app uses bounded validation, text-only
rendering and independently validated/quoted shell arguments; the Python verifier escapes
terminal controls and refuses to overwrite files. **Review commands and scripts before running
them**: these defenses cannot protect you from a compromised website supplying malicious code.

[SECURITY.md](SECURITY.md) explains the threat model, limits, trust assumptions, test coverage,
maintainer rules and how to report vulnerabilities. Commands target bash/zsh; Python should be
run with `-I` in a new empty directory. Application limits can reject unusually large invoices.

## Contributing

Issues and pull requests are welcome. Please run the tests, and keep the three ground rules:
no dependencies, no build step, and labels in `known-nodes.js` only with a primary source.

## License

[MIT](LICENSE) © Johannes Zweng
