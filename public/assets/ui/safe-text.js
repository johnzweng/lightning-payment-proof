// Display-only escaping. Never feed this back into hashing or signature verification.
// Keep printable Unicode (including ordinary RTL text); expose controls that can rewrite,
// hide, reorder or forge surrounding output. Backslashes are escaped to disambiguate escapes.
export function displayText(value) {
  return String(value).replace(/[\\\x00-\x1f\x7f-\x9f\u061c\u200b\u200e\u200f\u2028-\u202e\u2060\u2066-\u2069\ufeff]/g,
    (c) => c === '\\' ? '\\\\' : `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
