#!/usr/bin/env python3
# Independent Lightning (BOLT11) invoice decoder -- Python 3.8+ standard library only.
# Part of https://github.com/johnzweng/lightning-payment-proof (the web page generates these commands for you).
#
# Decodes the invoice itself (no network access), checks the preimage, and writes
# node.der, invoice.bin and signature.der so that `openssl` can check the signature.
#
# How to use (macOS / Linux terminal):
#   1. Save this file, e.g. to ~/Downloads/verify_invoice.py
#   2. Run it in an empty temporary folder:
#        cd "$(mktemp -d)"
#        python3 ~/Downloads/verify_invoice.py "<invoice lnbc...>" "<preimage>"
#      Expected: "Invoice checksum : OK" and "Preimage matches : YES - matches the invoice payment hash"
#   3. Let openssl check the invoice signature with the files it wrote:
#        openssl ec -pubin -inform DER -in node.der -out node.pem 2>/dev/null
#        openssl dgst -sha256 -verify node.pem -signature signature.der invoice.bin
#      Expected: "Verified OK"
# These checks do not establish that this is your receiving node or how the sender obtained the preimage.
# Compare with your own invoice and node ID, or confirm the receiving node with your wallet provider/LSP.
import sys, hashlib, datetime, csv

CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"


def polymod(values):
    gen, chk = [0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3], 1
    for v in values:
        top = chk >> 25
        chk = (chk & 0x1FFFFFF) << 5 ^ v
        for i in range(5):
            chk ^= gen[i] if (top >> i) & 1 else 0
    return chk


def to_bytes(groups, pad=False):            # 5-bit groups -> bytes
    acc = bits = 0
    out = bytearray()
    for g in groups:
        acc, bits = (acc << 5) | g, bits + 5
        while bits >= 8:
            bits -= 8
            out.append((acc >> bits) & 255)
    if pad and bits:
        out.append((acc << (8 - bits)) & 255)
    return bytes(out)


def to_int(groups):
    n = 0
    for g in groups:
        n = n * 32 + g
    return n


def decode_invoice(raw_invoice):
    invoice = "".join(raw_invoice.split()).lower()
    if invoice.startswith("lightning:"):
        invoice = invoice[len("lightning:"):]

    # --- 1. bech32: split the human-readable part and verify the checksum --------
    sep = invoice.rfind("1")
    hrp, data_part = invoice[:sep], invoice[sep + 1:]
    if sep < 1 or any(c not in CHARSET for c in data_part):
        raise ValueError("This is not a valid Lightning invoice (unexpected characters)")
    data = [CHARSET.index(c) for c in data_part]
    if polymod([ord(c) >> 5 for c in hrp] + [0] + [ord(c) & 31 for c in hrp] + data) != 1:
        raise ValueError("Invoice checksum is WRONG (typo or incomplete copy)")
    data = data[:-6]                         # drop the checksum
    body, sig5 = data[:-104], data[-104:]    # the last 520 bits are the signature

    # --- 2. tagged fields: type, length, then data -------------------------------
    fields, i = {}, 7                        # the first 7 groups are the timestamp
    while i < len(body):
        if i + 3 > len(body):
            raise ValueError("Invoice field header is truncated")
        tag, length = CHARSET[body[i]], body[i + 1] * 32 + body[i + 2]
        value = body[i + 3:i + 3 + length]
        if len(value) != length:
            raise ValueError("Invoice field is truncated")
        fields.setdefault(tag, []).append(value)
        i += 3 + length
    if "p" not in fields:
        raise ValueError("Invoice has no payment hash")
    return invoice, hrp, body, sig5, fields


def verify_csv(path):
    """Bulk-check exported payment proofs without printing private row contents."""
    count = 0
    with open(path, newline="", encoding="utf-8-sig") as source:
        rows = csv.DictReader(source)
        if rows.fieldnames != ["payment_preimage", "bolt11"]:
            raise ValueError("expected CSV header: payment_preimage,bolt11")
        for row_number, row in enumerate(rows, 2):
            try:
                _, _, _, _, row_fields = decode_invoice(row["bolt11"])
                payment_hash = to_bytes(row_fields["p"][0]).hex()
                preimage = row["payment_preimage"].strip().lower()
                if len(preimage) != 64:
                    raise ValueError("preimage is not 64 hexadecimal characters")
                if hashlib.sha256(bytes.fromhex(preimage)).hexdigest() != payment_hash:
                    raise ValueError("preimage does not match the invoice payment hash")
            except Exception as error:
                raise ValueError("CSV verification failed at row %d: %s" % (row_number, error)) from None
            count += 1
    if count == 0:
        raise ValueError("CSV contains no payment rows")
    print("Verified %d invoice/preimage pairs with Python" % count)


if len(sys.argv) > 1 and sys.argv[1] == "--csv":
    if len(sys.argv) != 3:
        sys.exit("Usage: verify_invoice.py --csv <payment_preimage,bolt11.csv>")
    try:
        verify_csv(sys.argv[2])
    except (OSError, ValueError) as error:
        sys.exit(str(error))
    sys.exit(0)

try:
    invoice, hrp, body, sig5, fields = decode_invoice(sys.argv[1])
except ValueError as error:
    sys.exit(str(error))
preimage = sys.argv[2].strip().lower() if len(sys.argv) > 2 else ""
payment_hash = to_bytes(fields["p"][0]).hex()
created = datetime.datetime.fromtimestamp(to_int(body[:7]), datetime.timezone.utc)
description = to_bytes(fields["d"][0]).decode("utf-8", "replace") if "d" in fields else "(none)"

# --- 3. signature: what was signed, and by whom ----------------------------------
signed = hrp.encode() + to_bytes(body, pad=True)   # the invoice before the signature, as bytes
sig = to_bytes(sig5)                        # 64 bytes r||s + 1 byte recovery id
r, s, recid = int.from_bytes(sig[:32], "big"), int.from_bytes(sig[32:64], "big"), sig[64]

P = 2**256 - 2**32 - 977                    # secp256k1 curve (same curve as Bitcoin)
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
G = (0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
     0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8)

def add(a, b):                              # point addition (None = point at infinity)
    if a is None: return b
    if b is None: return a
    if a[0] == b[0] and (a[1] + b[1]) % P == 0: return None
    if a == b:
        slope = 3 * a[0] * a[0] * pow(2 * a[1], -1, P)
    else:
        slope = (b[1] - a[1]) * pow(b[0] - a[0], -1, P)
    x = (slope * slope - a[0] - b[0]) % P
    return (x, (slope * (a[0] - x) - a[1]) % P)

def mul(k, pt):                             # scalar multiplication (double-and-add)
    out = None
    while k:
        if k & 1: out = add(out, pt)
        pt, k = add(pt, pt), k >> 1
    return out

if "n" in fields:                           # node id written in the invoice
    node_id = to_bytes(fields["n"][0]).hex()
    how = "stated in the invoice"
else:                                       # otherwise: recover it from the signature
    x = r + (N if recid & 2 else 0)
    y = pow(x * x * x + 7, (P + 1) // 4, P)
    if y % 2 != recid % 2: y = P - y
    e = int.from_bytes(hashlib.sha256(signed).digest(), "big")
    Q = mul(pow(r, -1, N), add(mul(s, (x, y)), mul(N - e % N, G)))
    node_id = ("%02x" % (2 + Q[1] % 2)) + ("%064x" % Q[0])
    how = "recovered from the signature"

def der_int(v):
    b = v.to_bytes(33, "big").lstrip(b"\0")
    b = b"\0" + b if b[0] & 0x80 else b
    return b"\x02" + bytes([len(b)]) + b

def write(name, content):
    with open(name, "wb") as f:
        f.write(content)

der = der_int(r) + der_int(s)
write("signature.der", b"\x30" + bytes([len(der)]) + der)
write("invoice.bin", signed)
# standard public-key header ("this is a secp256k1 key") + the node id:
write("node.der", bytes.fromhex("3036301006072a8648ce3d020106052b8104000a032200" + node_id))

# --- 4. report -------------------------------------------------------------------
print("Invoice checksum : OK")
print("Created          : %s" % created.strftime("%Y-%m-%d %H:%M:%S UTC"))
print("Description      : %s" % description)
print("Payment hash     : %s" % payment_hash)
print("Receiver node id : %s (%s)" % (node_id, how))
if preimage:
    h = hashlib.sha256(bytes.fromhex(preimage)).hexdigest()
    print("SHA-256(preimage): %s" % h)
    print("Preimage matches : %s" % ("YES - matches the invoice payment hash" if h == payment_hash else "NO"))
print("Wrote node.der, invoice.bin, signature.der - now let openssl check the signature.")
print("Compare this with your own invoice and node ID, or confirm the receiving node with your wallet provider/LSP.")
print("Payment evidence assumes your preimage stayed secret until payment.")
