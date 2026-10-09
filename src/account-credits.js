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
// One inclusive plausibility ceiling for credit-standing and reset-credit
// expirations at every ingest boundary, relative to the supplied clock.
export const ACCOUNT_EXPIRY_MAX_AHEAD_MS = 10 * 365.25 * 24 * 60 * 60 * 1000;

// Canonical ISO or null. Past instants remain valid here because reset-credit
// accounting must subtract them from the authoritative count exactly once.
// The credit-standing wrapper below additionally requires a future instant.
export function boundedAccountExpirationIso(ms, nowMs) {
  const now = Number(nowMs);
  if (!Number.isFinite(ms) || !Number.isFinite(now)
    || ms - now > ACCOUNT_EXPIRY_MAX_AHEAD_MS) return null;
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

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

// The credit-standing expiry sub-fact: rides on every fresh and stale credits
// block (never on an unsupported one). Exactly two shapes cross the wire:
// { status: 'not-reported' } and { status: 'reported', expiresAt: <ISO> }.
// Today Codex's credit shape carries no expiry, so the producer states the
// absence; nothing is ever inferred from grant times, usage, plan, or billing.
export const CREDIT_EXPIRY_STATUSES = new Set(['not-reported', 'reported']);

// The disclosed absence. A function (not a shared constant) so every block
// gets a detached object, matching unsupportedCredits().
export function creditExpiryNotReported() {
  return { status: 'not-reported' };
}

// The one normalizer for a candidate expiry instant that is an ISO (or
// ISO-parseable) string: canonical ISO and strictly in the future, within the
// shared horizon at `nowMs`, else not-reported. Never defaults to now. Both
// trust boundaries (the local Codex producer and the peer normalizer) call this;
// converting a provider's
// epoch-seconds convention stays with that provider's reader.
export function creditExpiryFromIso(value, nowMs) {
  if (typeof value !== 'string') return creditExpiryNotReported();
  const ms = Date.parse(value);
  const now = Number(nowMs);
  if (!Number.isFinite(ms) || !Number.isFinite(now) || ms <= now) return creditExpiryNotReported();
  const expiresAt = boundedAccountExpirationIso(ms, now);
  return expiresAt ? { status: 'reported', expiresAt } : creditExpiryNotReported();
}
