// Human-readable formatting of amounts, dates and hex values (plain strings, no DOM).

const numberFormat = new Intl.NumberFormat('en-US');
const relativeTimeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export const formatNumber = (value) => numberFormat.format(value);

/** 28605000n msat → "28,605 sats" (keeps millisatoshis: "1.5 sats"). */
export function formatSats(msat) {
  const sats = msat / 1000n;
  const remainder = msat % 1000n;
  const fraction = remainder ? '.' + remainder.toString().padStart(3, '0').replace(/0+$/, '') : '';
  const unit = sats === 1n && !remainder ? 'sat' : 'sats';
  return `${formatNumber(sats)}${fraction} ${unit}`;
}

/** 28605000n msat → "0.00028605 BTC" (exact, no rounding). */
export function formatBtc(msat) {
  const digits = msat.toString().padStart(12, '0');
  const whole = digits.slice(0, -11).replace(/^0+(?=\d)/, '');
  const fraction = digits.slice(-11).replace(/0+$/, '');
  return `${whole}${fraction ? '.' + fraction : ''} BTC`;
}

/** Route-hint fee, e.g. "1 sat + 0.25 %". */
export function formatFee(feeBaseMsat, feeProportionalMillionths) {
  const percent = feeProportionalMillionths / 10000;
  return `${formatNumber(feeBaseMsat / 1000)} sat + ${percent >= 1 ? formatNumber(percent) : percent} %`;
}

/** Local date and time, e.g. "30 Sept 2026, 08:31 CEST". */
export function formatDate(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
}

/** "2026-09-30 06:31:59 UTC" */
export function formatUtc(unixSeconds) {
  return new Date(unixSeconds * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

const MINUTE = ['minute', 60];
const TIME_UNITS = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], MINUTE];

/** "3 days ago", "in 2 hours" */
export function formatRelative(unixSeconds, nowSeconds = Date.now() / 1000) {
  const diff = unixSeconds - nowSeconds;
  const [unit, seconds] = TIME_UNITS.find(([, length]) => Math.abs(diff) >= length) ?? MINUTE;
  return relativeTimeFormat.format(Math.round(diff / seconds), unit);
}

/** 86400 → "1 day", 5400 → "90 minutes" */
export function formatDuration(seconds) {
  const plural = (count, unit) => `${count} ${unit}${count === 1 ? '' : 's'}`;
  if (seconds % 86400 === 0) return plural(seconds / 86400, 'day');
  if (seconds % 3600 === 0) return plural(seconds / 3600, 'hour');
  if (seconds % 60 === 0) return plural(seconds / 60, 'minute');
  return plural(seconds, 'second');
}

/** "0309…0d8a"-style abbreviation that keeps both ends visible. */
export function shortHex(hex, keep = 8) {
  return hex.length <= keep * 2 + 1 ? hex : `${hex.slice(0, keep)}…${hex.slice(-keep)}`;
}
