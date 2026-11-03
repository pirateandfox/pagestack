// Server-side glue shared by the routes: resolved options, the storage adapter, page IO.
import { options, site } from 'virtual:pagestack/site';
import type { PageDoc, SchemaRegistry } from '../runtime';
import type { Storage } from '../core/storage';
import { sha256 } from '../core/storage';
import { LocalStorage } from '../core/storage-local';
import { GitHubStorage } from '../core/storage-github';
import { serializeRegistry, validateDoc } from '../core/schema';

export { options, site };

export interface EditorOptions {
  root: string; renderer: string; sections: string; pagesDir: string; imagesDir: string; uploadsDir: string; publicDir: string; usersFile: string;
  auth: 'none' | 'passkey' | 'none-behind-proxy'; storage: 'local' | 'github'; github: { repo: string; branch?: string; pullRequest?: boolean } | null;
  siteName: string; secretEnv: string; command: string; interactiveSelector: string;
}
export const opts = options as EditorOptions;

export function secret(): string {
  const s = process.env[opts.secretEnv] ?? '';
  if (opts.auth === 'passkey' && s.length < 16) throw new Error(`${opts.secretEnv} must be set (>= 16 chars) when auth is "passkey"`);
  return s || 'dev-only-insecure-secret-change-me';
}

let storageInstance: Storage | undefined;
export function storage(): Storage {
  if (storageInstance) return storageInstance;
  if (opts.storage === 'github') {
    const token = process.env.GITHUB_TOKEN ?? process.env.EDITOR_GITHUB_TOKEN ?? '';
    storageInstance = new GitHubStorage({ repo: opts.github!.repo, branch: opts.github!.branch, pullRequest: opts.github!.pullRequest, token });
  } else {
    storageInstance = new LocalStorage(opts.root);
  }
  return storageInstance;
}

export const registry: SchemaRegistry = serializeRegistry(site.schemas as any);
export function presets() {
  return (site.presets as { label: string; description?: string; create: () => unknown }[]).map((p) => ({ label: p.label, description: p.description, node: p.create() }));
}

export const slugRe = /^[a-z0-9][a-z0-9/_-]*$/i;
export function pagePath(slug: string) {
  if (!slugRe.test(slug) || slug.includes('..')) throw new Error(`bad slug: ${slug}`);
  return `${opts.pagesDir}/${slug}.json`;
}

export async function readPage(slug: string): Promise<{ page: PageDoc; hash: string; raw: string } | null> {
  const raw = await storage().readFile(pagePath(slug));
  if (raw == null) return null;
  return { page: JSON.parse(raw) as PageDoc, hash: await sha256(raw), raw };
}

export async function listPages(): Promise<{ slug: string; title: string; sections: number }[]> {
  const entries = await storage().listDir(opts.pagesDir);
  const out = [];
  for (const e of entries) {
    if (e.type !== 'file' || !e.name.endsWith('.json')) continue;
    const slug = e.name.slice(0, -5);
    const r = await readPage(slug);
    if (r) out.push({ slug, title: r.page.title, sections: r.page.sections.length });
  }
  return out.sort((a, b) => (a.slug === 'index' ? -1 : b.slug === 'index' ? 1 : a.slug.localeCompare(b.slug)));
}

export function serializePage(page: PageDoc): string { return JSON.stringify(page, null, 2) + '\n'; }

export function validate(page: unknown): string[] { return validateDoc(page, registry); }

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}
export const bad = (msg: string, status = 400) => json({ error: msg }, status);

/** URL under which a file inside publicDir is served. */
export function publicUrl(filePath: string): string {
  const pub = opts.publicDir.replace(/\/$/, '') + '/';
  return filePath.startsWith(pub) ? '/' + filePath.slice(pub.length) : '/' + filePath;
}
export const publicPath = (slug: string) => (slug === 'index' ? '/' : `/${slug}/`);
