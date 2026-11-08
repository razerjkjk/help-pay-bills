// Tiny in-memory rate limiter (standalone edition).
//
// No extra dependency, no extra table: buckets live in process memory and
// are keyed by client IP, email, or user id. A server restart clears them,
// which is acceptable for this app — the limits exist to slow spam and
// guessing, not to keep a forensic record. Buckets are pruned when the map
// grows large so a flood of distinct keys cannot grow memory without bound.

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

/** Returns true if this hit is within the limit, false if the caller is
 *  over it. A hit counts toward the limit whether or not it is allowed. */
export function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || now - entry.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    pruneIfNeeded(now);
    return true;
  }
  if (entry.count >= max) return false;
  entry.count += 1;
  return true;
}

/** Forget a key's history, e.g. after a successful sign-in clears the
 *  failed-attempt count for that email. */
export function reset(key: string): void {
  buckets.delete(key);
}

function pruneIfNeeded(now: number): void {
  if (buckets.size <= 10_000) return;
  for (const [key, entry] of buckets) {
    if (now - entry.windowStart >= 60 * 60 * 1000) buckets.delete(key);
  }
}
