// For host sites whose list pages should show what the editor has saved (the `liveRoutes` option).
//
// On the editor's server, for those pages and the editor's previews, this returns a collection's entries as stored now (the
// staging branch). Everywhere else, including the public build and prerendering, it returns null,
// so the caller uses Astro's own getCollection and the public site is unchanged:
//
//   import { getCollection } from 'astro:content';
//   import { liveEntries } from '@pirateandfox/pagestack/live';
//   const all = (await liveEntries('articles', articleSchema)) ?? (await getCollection('articles'));
//
// Plain JavaScript with no imports, so a public build that never loads the editor can import it.

/**
 * @param {string} collection The editor's collection id (normally the Astro collection name).
 * @param {{ parse(data: unknown): any }} [schema] The collection's zod schema, so dates and defaults
 *   come out as they do at build time. Without one, `data` is the raw frontmatter.
 * @returns {Promise<{ id: string; collection: string; data: any; body: string; filePath: string }[] | null>}
 */
export async function liveEntries(collection, schema) {
  const live = /** @type {any} */ (globalThis).__PS_LIVE__;
  if (typeof live !== 'function') return null;
  const entries = await live(collection);
  if (!entries) return null;
  const out = [];
  for (const e of entries) {
    // An item the build would reject is left out rather than taking the list page down.
    try { out.push(schema ? { ...e, data: schema.parse(e.data) } : e); } catch { /* skipped */ }
  }
  return out;
}
