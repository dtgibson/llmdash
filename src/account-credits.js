// The one home for the account credit-standing vocabulary: the wire enums, the
// opaque-balance sanitizer, and the unsupported-block factory. The local Codex
// producer and the peer normalizer both import from here, so the stripping and
// the 64-code-point bound are byte-identical at both trust boundaries. Pure and
// dependency-free.

export const CREDIT_STATUSES = new Set(['unlimited', 'available', 'none', 'stale', 'unsupported']);
// The fresh standings, which are also the only legal `lastStatus` of a stale block.
export const CREDIT_FRESH_STATUSES = new Set(['unlimited', 'available', 'none']);
export const CREDIT_REASONS = new Set(['never-observed', 'not-reported', 'peer-omitted']);
export const CREDIT_BALANCE_MAX_CODE_POINTS = 64;

// Returns undefined for a non-string (the caller ignores it and retains any
// prior observation), null when nothing is left after stripping, else the
// bounded string. The balance is opaque provider text: never coerced to a
// number. Control, format/bidi, and Unicode line/paragraph separators carry no
// meaning here and could visually reorder neighboring account facts even after
// correct HTML escaping.
export function boundedCreditBalance(raw) {
  if (typeof raw !== 'string') return undefined;
  const cleaned = raw.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').trim();
  if (!cleaned) return null;
  return [...cleaned].slice(0, CREDIT_BALANCE_MAX_CODE_POINTS).join('');
}

// Every unsupported block is built here, so its four-key shape is fixed.
export function unsupportedCredits(reason) {
  return { status: 'unsupported', reason, balance: null, capturedAt: null };
}
