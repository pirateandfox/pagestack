// Types for live.mjs (`@pirateandfox/pagestack/live`). Keep in step with its JSDoc.

/** A collection entry as the editor has stored it. */
export interface LiveEntry {
  id: string;
  collection: string;
  /** The frontmatter, parsed by `schema` when one is given. */
  data: any;
  body: string;
  filePath: string;
}

/**
 * On the editor's server, for `liveRoutes` pages and the editor's previews: the collection's entries
 * as stored now. Everywhere else, including the public build: `null`, so fall back to `getCollection`.
 *
 * @param collection The editor's collection id (normally the Astro collection name).
 * @param schema The collection's zod schema, so dates and defaults come out as they do at build time.
 *   Without one, `data` is the raw frontmatter. Entries the schema rejects are left out.
 */
export function liveEntries(
  collection: string,
  schema?: { parse(data: unknown): any },
): Promise<LiveEntry[] | null>;
