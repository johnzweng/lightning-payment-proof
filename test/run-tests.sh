#!/usr/bin/env bash
# Runs all tests: the JavaScript verifier (node:test), then the independent path
# that the page offers to users: verify_invoice.py + openssl.
# Needs: node >= 20, python3 >= 3.8, openssl.
set -euo pipefail
cd "$(dirname "$0")/.."

node --test test/*.test.js

echo
echo "# python3 + openssl (independent path)"
SCRIPT="$PWD/public/assets/verify_invoice.py"
PAYMENT_DATA="$PWD/test/data/test_data_pre-images.csv"
if [ ! -f "$PAYMENT_DATA" ]; then
  PAYMENT_DATA="$PWD/test/data/test_data_pre-images.example.csv"
fi
# Real invoice with explicit node id (n field), and its preimage
REAL_INVOICE='lnbc286050n1p4tetxlpp524jfexmca98flrqzdqrwxt5n7lzwwv8x77mckzw4ajstwsmex2gqsp52u00ael68v8yrt2cms6pyj93ftgyy9n6rk7lren03p52hjs5jwjsxq9z0rgqnp4qvyndeaqzman7h898jxm98dzkm0mlrsx36s93smrur7h0azyyuxc5rzjqwghf7zxvfkxq5a6sr65g0gdkv768p83mhsnt0msszapamzx2qvuxqqqqrt49lmtcqqqqqqqqqqq86qq9qrzjq0qvdqygawseu8s2x34fl63ss3pxfy66tjy5z88q649jtc8ymz4wfapyqr6zgqqqq8hxk2qqae4jsqyugqcqzpudz82pshjgr5dus9wctvd3jhggr0vcs9xct5daeks6fqw4ek2u36yp68yctswpjkgunfvgcnxdc9qyyssq5eaumrd9727u9eyef3lds7jpxcfyzftuaay09rg277l5jlqxp2ms4n4qmxtlquazs5x5gpzwk73s3lrwpy69qwyzezn42samqgn906qq7c4qfm'
REAL_PREIMAGE='c420c4e4e7eebab9ab0d589055bfb7c6958401095f550c382028cf249d39d127'
# BOLT #11 spec vector without n field: the node id must be recovered from the signature
SPEC_INVOICE='lnbc2500u1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpu9qrsgquk0rl77nj30yxdy8j9vdx85fkpmdla2087ne0xh8nhedh8w27kyke0lp53ut353s06fv3qfegext0eh0ymjpf39tuven09sam30g4vgpfna3rh'
SPEC_NODE_ID='03e7156ae33b0a208d0744199163177e909e80176e55d97a2f221ede0f934dd9ad'

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
cd "$WORKDIR"

pass() { echo "ok - $1"; }
fail() { echo "not ok - $1"; exit 1; }

python3 -I "$SCRIPT" --csv "$PAYMENT_DATA" || fail "exported invoice/preimage pairs: Python verification"
pass "exported invoice/preimage pairs: Python verification"

openssl_verifies() {
  openssl ec -pubin -inform DER -in node.der -out node.pem 2>/dev/null &&
    [ "$(openssl dgst -sha256 -verify node.pem -signature signature.der invoice.bin 2>/dev/null)" = "Verified OK" ]
}

mkdir "$WORKDIR/real" "$WORKDIR/spec"
cd "$WORKDIR/real"
python3 -I "$SCRIPT" "$REAL_INVOICE" "$REAL_PREIMAGE" | grep -q "Preimage matches : YES" || fail "real invoice: preimage matches"
openssl_verifies && pass "real invoice: preimage matches, openssl verifies the signature" || fail "real invoice: openssl"

cd "$WORKDIR/spec"
python3 -I "$SCRIPT" "$SPEC_INVOICE" | grep -q "$SPEC_NODE_ID (recovered" || fail "spec invoice: node id recovery"
openssl_verifies && pass "spec invoice: node id recovered, openssl verifies the signature" || fail "spec invoice: openssl"

printf 'x' >> invoice.bin
openssl_verifies && fail "tampered data must not verify" || pass "tampered data is rejected by openssl"

output="$(python3 -I "$SCRIPT" "${REAL_INVOICE/qqqq/qqqp}" 2>&1 || true)"
[[ "$output" == *"checksum is WRONG"* ]] && pass "a typo is caught by the checksum" || fail "checksum"

echo
echo "all tests passed"
