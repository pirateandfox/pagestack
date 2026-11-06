// A fixed-window counter held in memory. There is no store to share, by design, so each server
// instance counts on its own: this slows guessing and floods, it isn't an accounting system.
export function rateLimiter({ limit, windowMs, maxKeys = 10_000 }: { limit: number; windowMs: number; maxKeys?: number }) {
  const hits = new Map<string, { count: number; resets: number }>();
  return (key: string, now = Date.now()): { ok: boolean; retryAfter: number } => {
    if (hits.size >= maxKeys) for (const [k, v] of hits) if (v.resets <= now) hits.delete(k);
    if (hits.size >= maxKeys) hits.clear(); // full of live keys: forget rather than grow
    let h = hits.get(key);
    if (!h || h.resets <= now) { h = { count: 0, resets: now + windowMs }; hits.set(key, h); }
    h.count++;
    return { ok: h.count <= limit, retryAfter: Math.ceil((h.resets - now) / 1000) };
  };
}
