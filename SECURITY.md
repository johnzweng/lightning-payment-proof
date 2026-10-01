# Security

## Reporting a vulnerability

**OpenPGP-encrypted email is the only private channel for vulnerability reports and sensitive
security correspondence.** Send reports to **Johannes Zweng**, using the key below and an email
address listed in its valid user IDs after verifying the full fingerprint.

Do not send sensitive reports through GitHub issues, GitHub private vulnerability reporting,
unencrypted email or other messaging channels. Never publish working exploits or private
invoices/preimages in a public issue. Encrypt the report and any sensitive attachments; keep
email subject lines free of sensitive details, since email headers are not protected by OpenPGP.

Include the affected commit/deployment, browser or Python/shell versions, reproduction steps
using synthetic/public data, expected versus actual behavior, and potential impact. Please
allow coordination of a fix before public disclosure. This volunteer project does not promise
a response deadline, bounty, or independent security audit.

### Maintainer's OpenPGP key

For OpenPGP-encrypted email to **Johannes Zweng**, use the key with this full fingerprint:

```text
4A69 B9BF 6D00 2231 B3EA 6552 C6C0 09F4 9B46 AB71
```

The current public key is available from
[johannes.zweng.at/C6C009F49B46AB71.asc](https://johannes.zweng.at/C6C009F49B46AB71.asc):

```sh
curl --fail --silent --show-error https://johannes.zweng.at/C6C009F49B46AB71.asc | gpg --import
```

Alternatively, retrieve it from one of these keyservers (choose one):

```sh
FPR='4A69B9BF6D002231B3EA6552C6C009F49B46AB71'
gpg --keyserver hkps://keys.openpgp.org --recv-keys "$FPR"
gpg --keyserver hkps://keyserver.ubuntu.com --recv-keys "$FPR"
gpg --keyserver keys.gnupg.net --recv-keys "$FPR"
```

Use `gpg2` instead of `gpg` if that is your system's GnuPG command. Keyserver availability
can vary, particularly for the legacy `keys.gnupg.net` service. `--recv-keys` retrieves a key;
`--send-keys` is for publishing one.

**Before encrypting a report, verify the full fingerprint**, not just the name, email address
or short key ID:

```sh
gpg --fingerprint 4A69B9BF6D002231B3EA6552C6C009F49B46AB71
```

It must match the fingerprint above. Importing a key does not establish trust in its owner;
if the reporting channel or this repository may be compromised, confirm the fingerprint through
an independently trusted source. Encryption does not make a public issue an appropriate place
for a sensitive report—send it only by OpenPGP-encrypted email.

### Supported versions

Only the current default-branch code is maintained; older copies and deployments must be
updated by their operators. There is no automatic update mechanism for downloaded Python scripts.

## Threat model

This is a static, client-side payment-evidence viewer, not a wallet. It holds no private keys,
initiates no payments, and has no application backend, accounts or database.

**An attacker can:**

- Send a victim a crafted query/fragment proof link or an invoice/preimage/hash to paste.
- Create a correctly checksummed and signed invoice with malicious descriptions, route hints,
  fallback fields, or extreme numbers. A valid signature does not make its text trustworthy.
- Control node aliases; an external API response may also be malformed, misleading or hostile.
- Try to induce a victim to copy the generated commands into a terminal.

**Assets to protect:** the user's browser and machine, local files, clipboard contents,
verification integrity, availability of the page, and invoice/preimage privacy.

**Trust boundaries:**

```text
URL / form / CLI / CSV
  → bounded normalization and structural validation
  → decoded invoice and cryptographic checks
  → DOM text / fixed-host URLs / shell arguments / terminal output / local files
```

Each output context requires its own protection. HTML escaping is not shell quoting; shell
quoting does not stop terminal escape sequences; a Bech32 alphabet does not restrict the
*decoded bytes* of a description. We do not delete arbitrary illegal characters to turn a
malformed invoice into something apparently valid.

The application files, hosting origin, browser, OS, terminal, Python/OpenSSL binaries, shell
configuration and executable search path are trusted. This model does **not** protect against
a compromised website supplying malicious JavaScript or Python, malicious extensions, a
local attacker with the same user's privileges, or vulnerabilities in those platforms/tools.
Zero dependencies reduce supply-chain exposure; they do not remove this trust requirement.

## Protections and why they work

Paths below are relative to `public/assets/` unless stated otherwise.

### 1. Validate encoded inputs before use

- `lnproof/input.js` bounds raw input **before** normalization. Only ASCII space, tab, CR and
  LF are ignored, plus the documented leading `lightning:`/`0x` wrapper. Unicode lookalikes,
  hidden Unicode whitespace, controls and shell punctuation are not folded into valid invoices.
- `lnproof/bolt11.js` and `bech32.js` require a recognized BOLT11 HRP/amount, uniform case,
  the Bech32 data alphabet/checksum, sufficient timestamp/signature data, complete tag lengths,
  and a usable payment-hash field. Fixed-size byte fields have zero-padding checks. As required
  by BOLT11, wrong-length fixed fields are ignored and the first eligible one is used.
- `lnproof/proof.js` accepts preimages and optional comparison hashes only as exactly 32 bytes
  of hexadecimal data. Invalid values are not returned as usable proof inputs. Library callers
  must handle `preimageError`/`hashError`; the page displays those errors rather than proceeding.
- Python independently applies the same input limits and core structural rules. It does not
  blindly lowercase mixed-case invoices. CLI usage, invalid signatures/keys, malformed preimages,
  and mismatched preimages fail before output artifacts are written.
- Decoded strings are kept unchanged for cryptographic verification. Display escaping never
  modifies the signed bytes. This is not a general Lightning payment implementation: unknown
  tags/features need not have payment-routing semantics implemented to check payment evidence.

### 2. Browser rendering and links

`ui/dom.js` builds text nodes; descriptions, aliases and field values never become HTML.
The only `innerHTML` use is the application's fixed SVG icon markup. User data must never
select markup, event handlers, selectors, element names, or style declarations.

`ui/safe-text.js` visibly escapes ASCII/C1 controls, bidi formatting controls, selected hidden
format characters and line separators in decoded text shown by the page. Backslashes are
escaped too, to distinguish literal escape-looking text. Printable Unicode descriptions remain
supported; description/alias direction is scoped with `dir="auto"`. This prevents these controls
from hiding/reordering surrounding output, but does not identify deceptive prose or homoglyphs.

Explorer/API hosts are fixed application constants. Node path components must be compressed-key
hex; Spark address path components and invoice query components are URL-encoded. External links
use HTTPS, reject credentials and non-HTTPS schemes, and have `noopener noreferrer`. Setting an
attribute is **not** inherently safe: future implementors must still validate its semantics.

The meta CSP in `public/index.html` provides a fallback on generic static hosts. The reference
`deploy/nginx.conf` additionally supplies `frame-ancestors 'none'`, `nosniff`, no-referrer, COOP
and Permissions-Policy. Inline scripts, evaluation, forms and third-party scripts are not allowed.
These are defense in depth, not a substitute for safe DOM construction.

### 3. Copied shell commands

All dynamic command construction is centralized in `ui/commands.js`:

- Validate each invoice, preimage, public key and hex blob **again at the output boundary**.
  Do not rely on callers continuing to use the correct decoder forever.
- Quote arguments using single-quoted shell literals, correctly handling embedded single quotes;
  reject invisible/control characters in shell arguments. Double quotes alone would still allow
  `$()` and backtick command substitution. The current invoice/hex allowlists exclude those
  characters already; quoting is an independent defense.
- Use `printf '%s'`, with a fixed format string, rather than putting untrusted data in a format
  string or relying on `echo` option/backslash behavior. Invoice arguments cannot start with `-`.
- File-producing commands run in a subshell with `pipefail`, a separately checked `mktemp -d`,
  a checked `cd`, and `&&` sequencing. Failure stops later stages; the interactive shell's working
  directory and options are unchanged. These commands target **bash/zsh**, not arbitrary shells.
- The inline Python source is trusted application code in a **quoted here-document**, not an
  interpolated Python program containing invoice text. Invoice/preimage values travel via `argv`.
  The source length, controls and delimiter-line collision are checked before offering it inline.
  The downloaded variant quotes the `$HOME` path and uses the same argument handling.
- Both variants use `python3 -I` to ignore `PYTHONPATH`, the user site and local module shadowing.
  This is import isolation, **not** a sandbox for untrusted Python code.
- Display and clipboard text come from exactly the same token array (`ui/components.js`). There
  is no alternate hidden command or invoice-supplied executable text on the clipboard.

An input cannot terminate a quote/here-document, become a command/option/format string, or choose
an output filename through these paths. Nevertheless, **review code before executing it**.
Independent decoding removes reliance on the browser's extraction, not trust in the downloaded
script or in the website that supplied it. No input sanitizer can make a compromised website safe.

### 4. Python output and files

`verify_invoice.py` uses no `eval`, `exec`, shell, subprocess, network access or dynamic imports
based on invoice data. Descriptions are printed as ASCII-escaped JSON strings, on a single line.
Thus ESC/OSC (including clipboard-changing OSC 52), CSI, CR/LF, backspace, bidi controls and Unicode
line separators cannot be interpreted by the terminal or forge additional report lines.
Validation errors are escaped; filesystem/CSV errors never echo attacker-controlled filenames or
private rows. CSV failures identify the row number only.

The script writes only `node.der`, `invoice.bin`, and `signature.der` in the chosen directory,
using exclusive `xb` creation. Existing files, hard links and even dangling symlinks cause failure
rather than being truncated/followed. All three files are opened before their contents are written.
An I/O failure can leave incomplete or empty **new** files; rerun in a new empty directory.
`node.pem` is produced by OpenSSL inside the command's fresh temporary directory.

Python validates the signature structure and recovers/validates the receiver key, but **OpenSSL
is the ECDSA signature verifier**. A successful Python invocation alone is not a valid-signature
verdict. `--csv` performs checksum/structure/preimage checks only; the JavaScript bulk test also
checks signatures. No artifacts are written by CSV mode.

### 5. Resource limits and reliable failures

These are application safety budgets, not claims about universal BOLT11 limits:

| Input/work | Limit |
|---|---:|
| Raw invoice, before paste normalization | 32,768 characters |
| Normalized invoice / generic Bech32 decode | 16,384 characters |
| Bech32 HRP | 83 characters |
| Raw preimage or comparison hash | 256 characters |
| Query + fragment before URLSearchParams parsing | 131,072 characters |
| Tagged fields | 256 |
| Route hops (total) | 64 |
| Invoice integers | JavaScript safe integers (at most 2⁵³−1) |
| Expiry timestamp | At most 8,640,000,000,000 seconds (JavaScript Date range) |
| Inline Python source | 65,536 characters |
| Node lookups per page load | 64 distinct keys, at most 4 concurrent |
| Node API response | 65,536 streamed bytes; 9-second request timeout |
| Node alias | 128 characters before display escaping |

Oversized fields and unsafe numeric/date values are rejected before rendering. Invalid signatures
may still decode for inspection; missing recovered keys render as unavailable and do not generate
a node-key command. Unexpected rendering failures return to a controlled input error.

`ui/node-lookup.js` validates API field types, requires the response key to match the requested
key, bounds numeric strings before BigInt conversion, disables redirects, and cancels oversized
streams. API failures and exhausted budgets show “lookup unavailable”; they cannot change the
cryptographic verdict. Python bit regrouping masks its accumulator, avoiding ever-growing integers.

These limits bound application work, not memory already allocated by a browser to load a huge URL
or paste. Hosting/proxies must set their own request limits. This is not general DoS prevention.

## Verification integrity and remaining risks

- A valid signature and matching preimage establish only the checks described in
  [DESIGN.md §3](DESIGN.md#3-what-the-proof-proves-the-trust-model). The receiver must recognize
  their invoice and node ID. Recovered keys, node aliases and Spark markers do not authenticate
  the intended receiver or establish payment provenance.
- Leaked/shared preimages may match without proving a new payment. Custodial balance changes,
  payer identity and payment time are not established by these checks.
- Signed descriptions may contain deceptive instructions or visual lookalikes. They are untrusted
  invoice text, never instructions from the application. Escaping controls cannot stop social engineering.
- Temporary directories and shell history may retain invoice/preimage data. Share a preimage only
  deliberately. Commands are not intended to keep it secret from other processes on the same machine.
- Query links reach the host/proxy and may enter browser history, logs or analytics. The reference
  nginx **access log** omits queries/referrers; error logs, CDNs, proxies and other infrastructure need
  separate review. Fragment links avoid sending proof parameters in the initial HTTP request.
- Automatic node lookups reveal public keys, the client's IP and timing to mempool.space (no cookies
  or referrer). Clicking decoder links explicitly discloses the invoice to those sites, not the preimage.
- Self-written verification code can have correctness bugs. Test vectors and cross-checks are not
  a formal proof or an external audit. Supported resource limits can reject otherwise valid invoices.

## Rules for future implementors

1. Trace new input through **every output sink**, including errors, clipboard, links, tooltips,
   terminal output, downloaded files and external requests. Checksums/signatures are not sanitizers.
2. Keep normalization narrow and documented. Reject invalid input, rather than “cleaning” it into
   a different invoice. Never apply display escaping to bytes being hashed or verified.
3. Route shell command changes through `ui/commands.js`; preserve validation **and** quoting,
   fixed `printf` formats, quoted here-documents, `-I`, failure chaining and temporary-directory guards.
   Never interpolate invoice descriptions into shell or Python source. Do not add `curl | sh`.
4. Preserve text-node rendering. Do not add user-controlled HTML, event attributes, CSS, `javascript:`
   links, dynamic code evaluation, or user-selected request hosts. CSP alone is insufficient.
5. Treat aliases/API responses as hostile. Preserve budgets, cancellation, type checks, fixed hosts,
   no credentials/referrer and independence from the proof verdict. Do not retry without a budget.
6. Keep Python and JS normalization, fixed-field selection, padding rules and resource limits aligned.
   Retain exclusive file creation and escaped terminal reporting. A new artifact must not introduce
   attacker-selected paths or symlink-following overwrites.
7. Keep test output free of private proof data. Never commit `test/data/test_data_pre-images.csv`.
8. Run the full tests for parser, crypto, rendering or command changes. Add a regression for each
   new sink and vulnerability; include correctly checksummed attacker invoices, not only raw junk.
9. Review hosting headers/logs and served Python content type. Deploy the whole `public/` folder
   together over HTTPS; update downloaded verifier copies. Do not claim that “zero dependencies” or
   the word “independent” eliminates trust in the shipped code.

## Security testing

Run `./test/run-tests.sh` (Node ≥20, Python ≥3.8, bash, OpenSSL, xxd and shasum; zsh is tested when
installed, and sha256sum when available). No package installation is needed for the suite.

- `test/security-input.test.js`: shell/HTML/URL payloads, percent-encoded query/fragment input,
  controls/Unicode lookalikes, preimages/hashes, output-boundary validation, size/numeric/field/hop
  limits, padding, malformed signatures and display escaping.
- `test/security-terminal.test.js`: actual generated commands in bash/zsh with Python/OpenSSL;
  quoted argument round-trips; here-document, substitution, quote, option and newline payloads;
  terminal escape sequences and forged output; failure sequencing; existing files/symlinks;
  module-shadowing isolation; Python/CSV error privacy; valid Unicode/spec-vector compatibility.
- `test/security-dom.test.js`: DOM contract tests for text-only rendering, executable link rejection,
  hostile aliases, missing receiver keys, and equality of displayed versus copied commands.
  The dependency-free DOM double is **not** a browser HTML parser or complete browser emulator.
- `test/security-network.test.js`: request target validation, response types/key binding, deduplication,
  concurrency/total budgets, streaming response caps and cancellation.
- Existing SHA-256/BOLT11/Spark tests and Python/OpenSSL cross-checks remain in the full suite.

Before release, also smoke-test in a real browser: use the example, invalid form fields, query and
fragment routes, malicious decoded descriptions/fallbacks, invalid signatures with no recovered key,
all command disclosures, and copy buttons. Check the console and network panel. Test the deployed
headers separately (a local development server does not supply nginx's header-only protections).

This corpus covers concrete attack classes and known failure modes, **not every possible injection
attack**. Maintain these invariants as new features and output contexts are added.
