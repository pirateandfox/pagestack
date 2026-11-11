// Go live: with `github.live` set, saves wait on the staging branch and this puts them on the
// branch the public site builds from, in one step.
// GET  /api/editor/live -> { enabled: false } | { enabled: true, branch, live, count, changes, stagingUrl? }
// POST /api/editor/live -> { ok, commit, url, merged } | { ok, nothing: true }
import type { APIRoute } from 'astro';
import { bad, editorOf, json, opts, storage } from '../../server/context';
export const prerender = false;

const enabled = () => !!(opts.github?.live && storage().pending && storage().goLive);

export const GET: APIRoute = async () => {
  if (!enabled()) return json({ enabled: false });
  try {
    return json({ enabled: true, ...await storage().pending!(), stagingUrl: opts.github?.stagingUrl ?? null });
  } catch (e: any) { return bad(`Could not check what is waiting: ${e.message}`, 502); }
};

export const POST: APIRoute = async ({ locals }) => {
  if (!enabled()) return bad('Saving goes straight to the site here; there is nothing to put live.', 404);
  const who = editorOf(locals)?.name;
  try {
    const { count } = await storage().pending!();
    if (!count) return json({ ok: true, nothing: true });
    const res = await storage().goLive!(`Go live: ${count} change${count === 1 ? '' : 's'}${who ? `\n\nPut live by ${who}` : ''}`);
    return res ? json({ ok: true, count, ...res }) : json({ ok: true, nothing: true });
  } catch (e: any) { return bad(e.message, 409); }
};
