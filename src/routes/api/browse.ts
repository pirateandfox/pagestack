// Browse mode: GET /api/editor/browse?path=/articles/x/ -> what to show for that site address.
// { path, kind, frame, edit, label?, builtAt?, savedAt? }. builtAt/savedAt come with a snapshot
// page, so the bar can say when the copy it shows may be older than what has been saved.
import type { APIRoute } from 'astro';
import { json, opts, storage } from '../../server/context';
import { resolve } from '../../server/browse';
export const prerender = false;

let lastChange: { at: number; value: Promise<string | null> } | null = null;
const SAVED_TTL = 10_000;
function savedAt(): Promise<string | null> {
  const s = storage();
  if (!s.lastChange) return Promise.resolve(null);
  const now = Date.now();
  if (!lastChange || now - lastChange.at > SAVED_TTL) lastChange = { at: now, value: s.lastChange().catch(() => null) };
  return lastChange.value;
}

export const GET: APIRoute = async ({ url }) => {
  const r = await resolve(url.searchParams.get('path'));
  // In `astro dev` every page is rendered fresh, so nothing is ever a stale snapshot.
  if (r.kind !== 'snapshot' || opts.command !== 'build' || !opts.builtAt) return json(r);
  return json({ ...r, builtAt: new Date(opts.builtAt).toISOString(), savedAt: await savedAt() });
};
