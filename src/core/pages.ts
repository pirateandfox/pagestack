// Page lifecycle rules: slugs, reserved paths, new documents. Pure, shared by the API routes and
// the browser (so the Add page dialog can explain a problem before anything is sent).
import type { Node, PageDoc } from '../runtime';
import { cloneWithNewIds } from '../runtime';

/**
 * Paths the integration itself owns; hosts add theirs with `reservedSlugs`. The last four would be
 * valid public URLs, but /edit/<slug> is how a page gets edited and those are editor screens.
 */
export const RESERVED_SLUGS = ['edit', 'api', '_astro', 'login', 'enroll', 'preview', 'global', 'media', 'users', 'collection'];

export function slugify(title: string): string {
  return title
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/&/g, ' and ').replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 80).replace(/-+$/, '');
}

/** A problem with a new slug, in words for the person typing it, or null when it is fine. */
export function slugProblem(slug: string, ctx: { existing: string[]; reserved?: string[] }): string | null {
  if (!slug) return 'Enter a URL for the page.';
  if (!/^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*$/.test(slug)) return 'Use lowercase letters, numbers and dashes.';
  if (ctx.existing.includes(slug)) return `There is already a page at /${slug}/.`;
  const top = slug.split('/')[0];
  if ([...RESERVED_SLUGS, ...(ctx.reserved ?? [])].includes(top)) return `/${top}/ is used by the site itself. Choose another URL.`;
  return null;
}

/** `slug`, or `slug-2`, `slug-3`… whichever is free. */
export function uniqueSlug(slug: string, existing: string[]): string {
  if (!existing.includes(slug)) return slug;
  for (let i = 2; ; i++) if (!existing.includes(`${slug}-${i}`)) return `${slug}-${i}`;
}

export function publicPath(slug: string): string { return slug === 'index' ? '/' : `/${slug}/`; }

/** New pages start as drafts, so nothing is public until someone presses Publish. */
export function newPage(title: string, from: Partial<PageDoc> = {}): PageDoc {
  return { ...from, title: from.title ?? title, status: 'draft', sections: from.sections ?? [] };
}

/** A copy of a page: its own node ids, and a draft whatever the original was. */
export function copyPage(source: PageDoc, title: string): PageDoc {
  return newPage(title, { ...source, title, sections: source.sections.map((n: Node) => cloneWithNewIds(n)) });
}

/** Add `from -> to` to a redirects file (Netlify/Cloudflare `_redirects` format). */
export function addRedirect(file: string, fromSlug: string, toSlug: string): string {
  return addRedirectLine(file, publicPath(fromSlug), publicPath(toSlug));
}

/** `_redirects` with one more permanent redirect, between two site paths. */
export function addRedirectLine(file: string, from: string, to: string): string {
  return `${file.replace(/\n*$/, '')}\n${from} ${to} 301\n`;
}
