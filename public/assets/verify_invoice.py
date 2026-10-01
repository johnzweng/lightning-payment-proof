#!/usr/bin/env python3
# Independent BOLT11 decoder -- Python 3.8+ standard library only, no network or shell calls.
# https://github.com/johnzweng/lightning-payment-proof
#
# Review this file, then run in a NEW, EMPTY directory (the page generates a guarded command):
#   python3 -I /path/to/verify_invoice.py 'lnbc...' '64-hex-character-preimage'
# It exclusively creates node.der, invoice.bin and signature.der; existing files are NEVER overwritten.
# On success, verify the signature separately:
#   openssl ec -pubin -inform DER -in node.der -out node.pem &&
#     openssl dgst -sha256 -verify node.pem -signature signature.der invoice.bin
# Do not substitute untrusted text into double-quoted shell commands yourself.
# Compare with your OWN invoice and node ID. These checks cannot establish how a preimage was obtained.
import csv
import datetime
import hashlib
import json
import re
import sys
from contextlib import ExitStack

CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
# Application resource limits; keep in sync with lnproof/input.js.
MAX_INVOICE_LENGTH = 16384
MAX_RAW_INVOICE_LENGTH = 32768
MAX_HEX_INPUT_LENGTH = 256
MAX_FIELDS = 256
MAX_ROUTE_HOPS = 64
MAX_SAFE_INTEGER = 2**53 - 1
MAX_DATE_SECONDS = 8640000000000
FIXED_LENGTH_FIELDS = {"p": 52, "s": 52, "h": 52, "n": 53}

P = 2**256 - 2**32 - 977
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
G = (0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
     0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8)


def polymod(values):
    gen, chk = [0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3], 1
    for v in values:
        top = chk >> 25
        chk = (chk & 0x1FFFFFF) << 5 ^ v
        for i in range(5):
            chk ^= gen[i] if (top >> i) & 1 else 0
    return chk


def to_bytes(groups, pad=False, strict=False):
    acc = bits = 0
    out = bytearray()
    for g in groups:
        # Keep the accumulator bounded: retaining ALL prior bits becomes quadratic in Python.
        acc, bits = ((acc << 5) | g) & 0xFFF, bits + 5
        while bits >= 8:
            bits -= 8
            out.append((acc >> bits) & 255)
    if strict and (bits >= 5 or acc & ((1 << bits) - 1)):
        raise ValueError("Invalid field padding")
    if pad and bits:
        out.append((acc << (8 - bits)) & 255)
    return bytes(out)


def to_int(groups):
    n = 0
    for g in groups:
        n = n * 32 + g
        if n > MAX_SAFE_INTEGER:
            raise ValueError("Invoice integer is out of range")
    return n


def normalize_hex(raw):
    if not isinstance(raw, str) or len(raw) > MAX_HEX_INPUT_LENGTH:
        raise ValueError("Hex input is too long or is not text")
    value = re.sub(r"[ \t\r\n]", "", raw)
    if value[:2].lower() == "0x":
        value = value[2:]
    if not re.fullmatch(r"[0-9a-fA-F]{64}", value):
        raise ValueError("Preimage must be exactly 64 hexadecimal characters")
    return value.lower()


def decode_invoice(raw_invoice):
    if not isinstance(raw_invoice, str) or len(raw_invoice) > MAX_RAW_INVOICE_LENGTH:
        raise ValueError("Invoice is too long or is not text")
    invoice = re.sub(r"[ \t\r\n]", "", raw_invoice)
    if invoice[:10].lower() == "lightning:":
        invoice = invoice[10:]
    if len(invoice) > MAX_INVOICE_LENGTH or not re.fullmatch(r"[a-zA-Z0-9]+", invoice):
        raise ValueError("Invoice is too long or contains invalid characters")
    if invoice != invoice.lower() and invoice != invoice.upper():
        raise ValueError("Invoice mixes upper- and lower-case letters")
    invoice = invoice.lower()

    sep = invoice.rfind("1")
    hrp, data_part = invoice[:sep], invoice[sep + 1:]
    if sep < 1 or len(hrp) > 83 or len(data_part) < 117 or any(c not in CHARSET for c in data_part):
        raise ValueError("Invalid invoice encoding or length")
    prefix = re.fullmatch(r"ln(bcrt|tbs|bc|tb|sb)([0-9]*[munp]?)", hrp)
    if not prefix:
        raise ValueError("Unknown invoice prefix")
    amount = prefix[2]
    if amount:
        if not re.fullmatch(r"(0|[1-9][0-9]*)([munp]?)", amount):
            raise ValueError("Invalid amount in invoice")
        if amount.endswith("p") and int(amount[:-1]) % 10:
            raise ValueError("Invalid pico-BTC amount (not a whole millisatoshi)")
    data = [CHARSET.index(c) for c in data_part]
    if polymod([ord(c) >> 5 for c in hrp] + [0] + [ord(c) & 31 for c in hrp] + data) != 1:
        raise ValueError("Invoice checksum is WRONG (typo or incomplete copy)")
    data = data[:-6]
    body, sig5 = data[:-104], data[-104:]

    fields, i, count, hops = {}, 7, 0, 0
    expiry = 3600
    while i < len(body):
        count += 1
        if count > MAX_FIELDS:
            raise ValueError("Invoice has too many fields")
        if i + 3 > len(body):
            raise ValueError("Invoice field header is truncated")
        tag, length = CHARSET[body[i]], body[i + 1] * 32 + body[i + 2]
        value = body[i + 3:i + 3 + length]
        if len(value) != length:
            raise ValueError("Invoice field is truncated")
        i += 3 + length
        if tag in FIXED_LENGTH_FIELDS:
            # BOLT11: ignore wrong-length fixed fields and use the first valid one.
            if length != FIXED_LENGTH_FIELDS[tag] or tag in fields:
                continue
            to_bytes(value, strict=True)
        if tag in ("x", "c"):
            number = to_int(value)
            if tag == "x":
                expiry = number
        if tag == "r":
            route_bytes = to_bytes(value)
            if len(route_bytes) % 51:
                raise ValueError("Invoice route hint is truncated")
            hops += len(route_bytes) // 51
            if hops > MAX_ROUTE_HOPS:
                raise ValueError("Invoice has too many route hops")
        fields.setdefault(tag, []).append(value)
    if "p" not in fields:
        raise ValueError("Invoice has no payment hash")
    if to_int(body[:7]) + expiry > MAX_DATE_SECONDS:
        raise ValueError("Invoice expiry is out of range")
    return invoice, hrp, body, sig5, fields


def add(a, b):
    if a is None: return b
    if b is None: return a
    if a[0] == b[0] and (a[1] + b[1]) % P == 0: return None
    if a == b:
        slope = 3 * a[0] * a[0] * pow(2 * a[1], -1, P)
    else:
        slope = (b[1] - a[1]) * pow(b[0] - a[0], -1, P)
    x = (slope * slope - a[0] - b[0]) % P
    return x, (slope * (a[0] - x) - a[1]) % P


def mul(k, pt):
    out = None
    while k:
        if k & 1: out = add(out, pt)
        pt, k = add(pt, pt), k >> 1
    return out


def lift_x(x, parity):
    if not 0 <= x < P:
        raise ValueError("Invalid public key coordinate")
    square = (x * x * x + 7) % P
    y = pow(square, (P + 1) // 4, P)
    if y * y % P != square:
        raise ValueError("Invalid public key curve point")
    return x, y if y % 2 == parity else P - y


def signature_data(hrp, body, sig5, fields):
    signed = hrp.encode("ascii") + to_bytes(body, pad=True)
    sig = to_bytes(sig5)
    r, s, recid = int.from_bytes(sig[:32], "big"), int.from_bytes(sig[32:64], "big"), sig[64]
    if not (0 < r < N and 0 < s < N and 0 <= recid <= 3):
        raise ValueError("Invalid signature scalar or recovery id")
    if "n" in fields:
        key = to_bytes(fields["n"][0], strict=True)
        if key[0] not in (2, 3):
            raise ValueError("Invalid compressed public key")
        lift_x(int.from_bytes(key[1:], "big"), key[0] % 2)
        node_id, how = key.hex(), "stated in the invoice"
    else:
        point = lift_x(r + (N if recid & 2 else 0), recid % 2)
        e = int.from_bytes(hashlib.sha256(signed).digest(), "big")
        q = mul(pow(r, -1, N), add(mul(s, point), mul((-e) % N, G)))
        if q is None:
            raise ValueError("Could not recover receiver key")
        node_id = ("%02x" % (2 + q[1] % 2)) + ("%064x" % q[0])
        how = "recovered from the signature"
    return signed, r, s, node_id, how


def der_int(value):
    b = value.to_bytes(33, "big").lstrip(b"\0")
    if b[0] & 0x80: b = b"\0" + b
    return b"\x02" + bytes([len(b)]) + b


def write_artifacts(artifacts):
    # Exclusive creation rejects existing files AND dangling symlinks. Open every file before
    # writing data; a failure may leave empty files, but cannot truncate someone else's file.
    with ExitStack() as stack:
        outputs = [(stack.enter_context(open(name, "xb")), data) for name, data in artifacts]
        for output, data in outputs:
            output.write(data)


def verify_csv(path):
    """Checksum/structure/preimage checks only, NOT ECDSA verification. No artifacts written."""
    count = 0
    with open(path, newline="", encoding="utf-8-sig") as source:
        rows = csv.DictReader(source)
        if rows.fieldnames != ["payment_preimage", "bolt11"]:
            raise ValueError("Expected CSV header: payment_preimage,bolt11")
        for row_number, row in enumerate(rows, 2):
            try:
                if set(row) != {"payment_preimage", "bolt11"}:
                    raise ValueError("Invalid row")
                _, _, _, _, fields = decode_invoice(row["bolt11"])
                preimage = normalize_hex(row["payment_preimage"])
                if hashlib.sha256(bytes.fromhex(preimage)).digest() != to_bytes(fields["p"][0]):
                    raise ValueError("Mismatch")
            except (ValueError, TypeError, KeyError):
                # Never reflect private row contents or attacker-supplied exception text.
                raise ValueError("CSV verification failed at row %d" % row_number) from None
            count += 1
    if count == 0:
        raise ValueError("CSV contains no payment rows")
    print("Verified %d invoice/preimage pairs with Python" % count)


def main(args):
    if len(args) == 2 and args[0] == "--csv":
        verify_csv(args[1])
        return
    if len(args) not in (1, 2) or args[0].startswith("-"):
        raise ValueError("Usage: verify_invoice.py <invoice> [preimage], or --csv <file>")
    _, hrp, body, sig5, fields = decode_invoice(args[0])
    preimage = normalize_hex(args[1]) if len(args) == 2 else None
    payment_hash = to_bytes(fields["p"][0]).hex()
    digest = hashlib.sha256(bytes.fromhex(preimage)).hexdigest() if preimage else None
    if digest is not None and digest != payment_hash:
        raise ValueError("Preimage matches : NO - does not match the invoice payment hash")
    signed, r, s, node_id, how = signature_data(hrp, body, sig5, fields)
    created = datetime.datetime.fromtimestamp(to_int(body[:7]), datetime.timezone.utc)
    description = to_bytes(fields["d"][-1]).decode("utf-8", "replace") if "d" in fields else "(none)"
    der = der_int(r) + der_int(s)
    write_artifacts([
        ("signature.der", b"\x30" + bytes([len(der)]) + der),
        ("invoice.bin", signed),
        ("node.der", bytes.fromhex("3036301006072a8648ce3d020106052b8104000a032200" + node_id)),
    ])
    print("Invoice checksum : OK")
    print("Created          : %s" % created.strftime("%Y-%m-%d %H:%M:%S UTC"))
    # ASCII JSON string: no raw ESC/OSC, CR/LF, bidi controls, or forged report lines.
    print("Description      : %s" % json.dumps(description, ensure_ascii=True))
    print("Payment hash     : %s" % payment_hash)
    print("Receiver node id : %s (%s)" % (node_id, how))
    if preimage:
        print("SHA-256(preimage): %s" % digest)
        print("Preimage matches : YES - matches the invoice payment hash")
    print("Wrote node.der, invoice.bin, signature.der - now let openssl check the signature.")
    print("Compare this with your own invoice and node ID, or confirm the receiving node with your wallet provider/LSP.")
    print("Payment evidence assumes your preimage stayed secret until payment.")


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except ValueError as error:
        # Our validation messages are static; still ASCII-escape at the terminal boundary.
        sys.exit("Error: " + json.dumps(str(error), ensure_ascii=True))
    except (OSError, csv.Error, UnicodeError, OverflowError):
        # File names, OS errors and CSV contents may contain terminal controls or private data.
        sys.exit("Could not read input or create output files. Use a new empty directory and check the input.")
