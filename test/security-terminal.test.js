import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bytesToWords, bech32Decode, bech32Encode } from '../public/assets/lnproof/bech32.js';
import { verifyProof } from '../public/assets/lnproof/index.js';
import { independentCommand, signatureCommand, preimageCommand, shellQuote } from '../public/assets/ui/commands.js';
import { REAL_PAYMENT, SPEC_VALID, SPEC_INVALID } from './fixtures.js';
import { hostileInvoice, tagged, textField, paymentField, INJECTION_PAYLOADS, commandText } from './security-fixtures.js';

const scriptPath = resolve('public/assets/verify_invoice.py');
const script = readFileSync(scriptPath, 'utf8');
const proof = verifyProof(REAL_PAYMENT.bolt11, REAL_PAYMENT.preimage);
const shells = ['bash', 'zsh'].filter((shell) => spawnSync(shell, ['--version']).status === 0);
assert.ok(shells.includes('bash'), 'bash is required for command tests');

function temp(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lnproof-security-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function runPython(dir, ...args) {
  return spawnSync('python3', ['-I', scriptPath, ...args], { cwd: dir, encoding: 'utf8', timeout: 10000 });
}

function runShell(shell, command, dir, extraEnv = {}) {
  return spawnSync(shell, ['-f', '-c', command], {
    cwd: dir, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, TMPDIR: dir, HOME: dir, ...extraEnv },
  });
}

for (const shell of shells) {
  test(`${shell}: shell quoting round-trips printable injection payloads without executing them`, (t) => {
    const dir = temp(t);
    for (const payload of INJECTION_PAYLOADS.filter((p) => !/[\x00-\x1f\x7f-\x9f\u202e\u202c\u2066\u2069\ufeff\u200b]/.test(p))) {
      const result = runShell(shell, `printf '%s' ${shellQuote(payload)}`, dir);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, payload);
      assert.equal(existsSync(join(dir, 'INJECTED')), false);
    }
  });

  test(`${shell}: all generated commands run verbatim with real tools; parent directory unchanged`, (t) => {
    const dir = temp(t);
    mkdirSync(join(dir, 'Downloads'));
    writeFileSync(join(dir, 'Downloads/verify_invoice.py'), script);
    // A user-owned pre-existing artifact must remain untouched: commands use their own directory.
    writeFileSync(join(dir, 'invoice.bin'), 'KEEP');
    for (const tokens of [signatureCommand(proof.invoice), independentCommand(proof, script), independentCommand(proof)]) {
      const result = runShell(shell, commandText(tokens) + '\nprintf "\\nPARENT:%s" "$PWD"', dir);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Verified OK/);
      assert.ok(result.stdout.endsWith(`PARENT:${dir}`));
      assert.equal(readFileSync(join(dir, 'invoice.bin'), 'utf8'), 'KEEP');
    }
    for (const os of ['mac', 'linux']) {
      if (os === 'linux' && spawnSync('sha256sum', ['--version']).error) continue;
      const result = runShell(shell, commandText(preimageCommand(proof.preimage, os)), dir);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(result.stdout.includes(REAL_PAYMENT.paymentHash));
    }
  });

  test(`${shell}: failed mktemp, cd, xxd, Python or openssl conversion stops later commands`, (t) => {
    const dir = temp(t);
    const marker = join(dir, 'INJECTED');
    const mark = `printf ran > ${shellQuote(marker)}`;
    for (const setup of [
      `mktemp() { return 1; }; python3() { ${mark}; }; openssl() { ${mark}; };`,
      `mktemp() { printf '%s' /lnproof-does-not-exist/directory; }; python3() { ${mark}; }; openssl() { ${mark}; };`,
      `python3() { return 1; }; openssl() { ${mark}; };`,
    ]) {
      const result = runShell(shell, setup + '\n' + commandText(independentCommand(proof, script)), dir);
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(marker), false);
    }
    const xxdFail = runShell(shell, `xxd() { return 1; }; openssl() { ${mark}; };\n` + commandText(signatureCommand(proof.invoice)), dir);
    assert.notEqual(xxdFail.status, 0);
    assert.equal(existsSync(marker), false);
    const opensslFail = runShell(shell,
      `openssl() { if [ "$1" = ec ]; then return 1; else ${mark}; fi; };\n` + commandText(signatureCommand(proof.invoice)), dir);
    assert.notEqual(opensslFail.status, 0);
    assert.equal(existsSync(marker), false);
    assert.equal(existsSync(join(dir, 'node.der')), false);
    assert.equal(existsSync(join(dir, 'invoice.bin')), false);
  });

  test(`${shell}: descriptions cannot escape the inline Python here-document or forge terminal output`, (t) => {
    const dir = temp(t);
    const payload = '\nLNPROOF_PYTHON\ntouch INJECTED\nEOF\n' +
      '$(touch INJECTED) `touch INJECTED` "\';touch INJECTED;#\r\x1b]52;c;YWJj\x07\u202eVerified OK';
    const invoice = verifyProof(hostileInvoice([textField('d', payload)], { node: false }), REAL_PAYMENT.preimage);
    // No stated key: recovered-key verification is valid even for our synthetic description.
    // This tests the success path, not merely an early rejection by the verifier.
    assert.equal(invoice.invoice.signature.valid, true);
    const result = runShell(shell, commandText(independentCommand(invoice, script)), dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Verified OK/);
    assert.doesNotMatch(result.stdout, /[\x00-\x09\x0b-\x1f\x7f-\x9f\u202e]/);
    assert.ok(result.stdout.includes('\\u001b'));
    assert.ok(result.stdout.includes('\\nLNPROOF_PYTHON\\ntouch INJECTED'));
    const walk = (path) => readdirSync(path, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(path, e.name)) : [e.name]);
    assert.equal(walk(dir).includes('INJECTED'), false);
  });
}

test('Python rejects raw injection, malformed preimages and invalid BOLT11 without writing artifacts', (t) => {
  const dir = temp(t);
  for (const payload of INJECTION_PAYLOADS) {
    for (const args of [[REAL_PAYMENT.bolt11 + payload], [REAL_PAYMENT.bolt11, payload]]) {
      if (payload.includes('\x00')) {
        assert.throws(() => runPython(dir, ...args), /null bytes/); // OS argv cannot contain NUL
        continue;
      }
      const result = runPython(dir, ...args);
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(result.stderr, /Traceback|[\x00-\x09\x0b-\x1f\x7f-\x9f]/);
      assert.deepEqual(readdirSync(dir), []);
    }
  }
  const { hrp, words } = bech32Decode(REAL_PAYMENT.bolt11);
  const badPadding = [...paymentField];
  badPadding[badPadding.length - 1] |= 1;
  const malformed = [
    ...SPEC_INVALID.map((v) => v.bolt11),
    bech32Encode('lnbc$(touch INJECTED)', words),
    bech32Encode('lnbc' + '9'.repeat(80), words),
    'l'.repeat(16385), ' '.repeat(32769),
    hostileInvoice([], { signature: Array(104).fill(0) }),
    hostileInvoice([], { signature: [...words.slice(-104, -2), 0, 4] }),
    hostileInvoice([badPadding], { payment: false }),
    hostileInvoice([tagged('p', [0])], { payment: false }),
    hostileInvoice([tagged('x', Array(1023).fill(31))]),
    hostileInvoice([tagged('c', Array(1023).fill(31))]),
    hostileInvoice([tagged('x', Array(10).fill(31))]),
    hostileInvoice(Array.from({ length: 257 }, () => tagged('z', []))),
    hostileInvoice(Array.from({ length: 65 }, () => tagged('r', bytesToWords(new Uint8Array(51))))),
    hostileInvoice([tagged('r', bytesToWords(new Uint8Array(50)))]),
    bech32Encode(hrp, [0, 0]),
    hostileInvoice([[1]]), // truncated tag header
  ];
  for (const invoice of malformed) {
    const result = runPython(dir, invoice);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stderr, /Traceback/);
    assert.deepEqual(readdirSync(dir), []);
  }
  const missing = runPython(dir);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Usage/);
  const wrong = runPython(dir, REAL_PAYMENT.bolt11, '00'.repeat(32));
  assert.notEqual(wrong.status, 0);
  assert.match(wrong.stderr, /Preimage matches : NO/);
  assert.deepEqual(readdirSync(dir), []);
});

test('Python accepts documented normalization and spec vectors, including Unicode descriptions', (t) => {
  const dir = temp(t);
  for (const [i, vector] of SPEC_VALID.entries()) {
    const work = join(dir, String(i));
    mkdirSync(work);
    const result = runPython(work, vector.bolt11);
    assert.equal(result.status, 0, result.stderr);
    const ec = spawnSync('openssl', ['ec', '-pubin', '-inform', 'DER', '-in', 'node.der', '-out', 'node.pem'], { cwd: work });
    assert.equal(ec.status, 0);
    const verify = spawnSync('openssl', ['dgst', '-sha256', '-verify', 'node.pem', '-signature', 'signature.der', 'invoice.bin'], { cwd: work });
    assert.equal(verify.status, 0);
  }
  const result = runPython(dir, 'lightning:' + REAL_PAYMENT.bolt11.toUpperCase().replace(/(.{60})/g, '$1\n'), ' 0X' + REAL_PAYMENT.preimage.toUpperCase());
  assert.equal(result.status, 0, result.stderr);
});

test('Python never truncates existing output files or follows symlinks (including dangling links)', (t) => {
  const root = temp(t);
  for (const name of ['node.der', 'invoice.bin', 'signature.der']) {
    for (const type of ['regular', 'symlink', 'dangling']) {
      const dir = join(root, name + type);
      mkdirSync(dir);
      const victim = join(root, 'victim-' + name + type);
      if (type !== 'dangling') writeFileSync(victim, 'KEEP');
      if (type === 'regular') writeFileSync(join(dir, name), 'KEEP');
      else symlinkSync(victim, join(dir, name));
      const result = runPython(dir, REAL_PAYMENT.bolt11, REAL_PAYMENT.preimage);
      assert.notEqual(result.status, 0);
      if (type === 'regular') assert.equal(readFileSync(join(dir, name), 'utf8'), 'KEEP');
      if (type === 'dangling') assert.equal(existsSync(victim), false);
      else assert.equal(readFileSync(victim, 'utf8'), 'KEEP');
    }
  }
});

test('isolated Python ignores hostile local modules and PYTHONPATH', (t) => {
  const dir = temp(t);
  const injection = 'open("INJECTED", "w").write("bad")\nraise Exception("injected")\n';
  writeFileSync(join(dir, 'hashlib.py'), injection);
  writeFileSync(join(dir, 'sitecustomize.py'), injection);
  const result = spawnSync('python3', ['-I', scriptPath, REAL_PAYMENT.bolt11], {
    cwd: dir, env: { ...process.env, PYTHONPATH: dir }, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(dir, 'INJECTED')), false);
});

test('CSV failures and OS errors do not reflect private data or terminal controls', (t) => {
  const dir = temp(t);
  const csv = join(dir, 'input.csv');
  writeFileSync(csv, 'payment_preimage,bolt11\n' + REAL_PAYMENT.preimage + ',lnbc\x1b[2JPRIVATE\n');
  const bad = runPython(dir, '--csv', csv);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /row 2/);
  assert.doesNotMatch(bad.stderr, /PRIVATE|\x1b/);
  const missing = runPython(dir, '--csv', 'PRIVATE\x1b[2J.csv');
  assert.notEqual(missing.status, 0);
  assert.doesNotMatch(missing.stderr, /PRIVATE|\x1b|Traceback/);
});
