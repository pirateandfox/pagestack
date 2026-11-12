// Server-side glue shared by the routes: resolved options, the storage adapter, page IO.
import { options, site } from 'virtual:pagestack/site';
import type { CollectionDoc, Field, GlobalDoc, Node, PageDoc, PageTemplate, SchemaRegistry } from '../runtime';
import type { Storage } from '../core/storage';
import { sha256 } from '../core/storage';
import { LocalStorage } from '../core/storage-local';
import { GitHubStorage } from '../core/storage-github';
import { serializeRegistry, validateDoc } from '../core/schema';
import { codeValues, sanitizeDoc, sanitizeNode } from '../core/sanitize';
import type { CleanOptions } from '../core/sanitize';
import { parseUsers, serializeUsers } from '../core/users';
import { parseMarkdown } from '../core/frontmatter';
import type { EditorUser, Role, UsersFile } from '../core/users';
import { publicPath, RESERVED_SLUGS } from '../core/pages';
import type { SavedPattern } from '../core/insert';

export { options, site };

export interface EditorOptions {
  root: string; renderer: string | null; previews?: Record<string, string>; previewScripts?: "site" | "all"; pages?: boolean; sections: string; pagesDir: string; imagesDir: string; uploadsDir: string; publicDir: string; usersFile: string;
  auth: 'none' | 'passkey' | 'none-behind-proxy'; storage: 'local' | 'github'; github: { repo: string; branch?: string; pullRequest?: boolean; live?: string; stagingUrl?: string } | null;
  siteName: string; secretEnv: string; command: string; interactiveSelector: string;
  reservedSlugs: string[]; redirectsFile: string; patternsFile: string;
  /** When this editor was built (ms). Browse compares it with the last save. */
  builtAt?: number;
  /** Site pages rendered on request on the editor's server, so lists show saved content. URL paths. */
  liveRoutes?: string[];
  /** Header carrying the client's IP behind a proxy, e.g. cf-connecting-ip. */
  clientIpHeader?: string;
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
    storageInstance = new GitHubStorage({ repo: opts.github!.repo, branch: opts.github!.branch, pullRequest: opts.github!.pullRequest, live: opts.github!.live, token, apiBase: process.env.EDITOR_GITHUB_API });
  } else {
    storageInstance = new LocalStorage(opts.root);
  }
  return storageInstance;
}

export const registry: SchemaRegistry = serializeRegistry(site.schemas as any);
export function presets() {
  return (site.presets as { label: string; description?: string; create: () => unknown }[]).map((p) => ({ label: p.label, description: p.description, node: p.create() }));
}

/** Host extras from the `sections` module; all optional. */
const extras = site as unknown as { pageFields?: Record<string, Field>; templates?: PageTemplate[]; globals?: Record<string, GlobalDoc>; collections?: Record<string, CollectionDoc> };
export const pageFields = extras.pageFields ?? {};
export const templates = extras.templates ?? [];
export const globals = extras.globals ?? {};
export const collections = extras.collections ?? {};
/** Pages (and their titles) whose stored JSON mentions a URL. Globals and patterns count too. */
export async function whereUsed(src: string): Promise<{ title: string; href: string }[]> {
  const out: { title: string; href: string }[] = [];
  const has = (raw: string | null) => !!raw && raw.includes(src);
  for (const slug of await pageSlugs()) { const r = await readPage(slug); if (r && has(r.raw)) out.push({ title: r.page.title, href: `/edit/${slug}` }); }
  for (const [id, g] of Object.entries(globals)) if (has(await storage().readFile(g.file))) out.push({ title: g.label, href: `/edit/global/${id}` });
  if (has(await storage().readFile(opts.patternsFile))) out.push({ title: 'Saved patterns', href: '/edit' });
  return out;
}

// ---- collections (Markdown folders) ----
export interface ItemSummary { slug: string; title: string; date: string; draft: boolean }
export async function listItems(c: CollectionDoc): Promise<ItemSummary[]> {
  const out: ItemSummary[] = [];
  for (const e of await storage().listDir(c.dir)) {
    if (e.type !== 'file' || !e.name.endsWith('.md')) continue;
    const raw = await storage().readFile(`${c.dir}/${e.name}`);
    if (raw === null) continue;
    const { data } = parseMarkdown(raw);
    out.push({ slug: e.name.slice(0, -3), title: String(data.title ?? e.name), date: String(data.date ?? ''), draft: data.draft === true });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export const reservedSlugs = () => [...RESERVED_SLUGS, ...opts.reservedSlugs];

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

export interface PageSummary { slug: string; title: string; sections: number; status: 'draft' | 'published' }

export async function pageSlugs(dir = '', depth = 0): Promise<string[]> {
  const entries = await storage().listDir(dir ? `${opts.pagesDir}/${dir}` : opts.pagesDir);
  const out: string[] = [];
  for (const e of entries) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.type === 'dir' && depth < 4) out.push(...await pageSlugs(rel, depth + 1));
    else if (e.type === 'file' && e.name.endsWith('.json')) out.push(rel.slice(0, -5));
  }
  return out;
}

export async function listPages(): Promise<PageSummary[]> {
  const out: PageSummary[] = [];
  for (const slug of await pageSlugs()) {
    const r = await readPage(slug);
    if (r) out.push({ slug, title: r.page.title, sections: r.page.sections.length, status: r.page.status === 'draft' ? 'draft' : 'published' });
  }
  return out.sort((a, b) => (a.slug === 'index' ? -1 : b.slug === 'index' ? 1 : a.slug.localeCompare(b.slug)));
}

export function serializePage(page: PageDoc): string { return JSON.stringify(page, null, 2) + '\n'; }

export function validate(page: unknown): string[] { return validateDoc(page, registry); }

export interface EditorIdentity { id: string; name: string; role: Role }
export const editorOf = (locals: unknown) => (locals as { editorUser?: EditorIdentity }).editorUser;
/** With no login (dev, or a proxy doing it) there is one kind of user, and it is the site's owner. */
export const isAdmin = (locals: unknown) => (editorOf(locals)?.role ?? 'admin') === 'admin';

/** Admins may write raw HTML into `code` fields. Anyone else may only keep what `keep` already holds. */
function cleanOptions(locals: unknown, keep?: PageDoc | null): CleanOptions {
  if (isAdmin(locals)) return { rawOk: () => true };
  const existing = codeValues(keep, registry);
  return { rawOk: (v) => existing.has(v) };
}

/** The form a page is stored in, whatever the client sent. `keep` is the page as stored now. */
export const clean = (page: PageDoc, locals?: unknown, keep?: PageDoc | null) => sanitizeDoc(page, registry, { ...cleanOptions(locals ?? { editorUser: { role: 'editor' } }, keep), pageFields });
export const cleanNode = (node: Node, locals: unknown, keep?: Node) => sanitizeNode(node, registry, cleanOptions(locals, keep ? { title: '', sections: [keep] } : null));

// ---- people ----
export async function loadUsers(): Promise<UsersFile> { return parseUsers(await storage().readFile(opts.usersFile)); }
let usersCache: { file: UsersFile; at: number } | null = null;
export async function saveUsers(file: UsersFile, message: string) {
  const result = await storage().commit({ message, files: [{ path: opts.usersFile, content: serializeUsers(file) }] });
  usersCache = null;
  return result;
}
const USERS_TTL = 15_000;
/**
 * The user behind a session, so removing someone ends their sessions. Read at most every 15s; a
 * miss re-reads first, because a brand-new user may have been saved by another instance.
 */
export async function activeUser(id: string, now = Date.now()): Promise<EditorUser | null> {
  if (!usersCache || now - usersCache.at > USERS_TTL) usersCache = { file: await loadUsers(), at: now };
  let user = usersCache.file.users.find((u) => u.id === id);
  if (!user && usersCache.at !== now) { usersCache = { file: await loadUsers(), at: now }; user = usersCache.file.users.find((u) => u.id === id); }
  return user ?? null;
}

/** A commit message with the editor's name on it. */
export function commitMessage(subject: string, locals: unknown): string {
  const name = (locals as { editorUser?: { name?: string } }).editorUser?.name;
  return subject + (name ? `\n\nEdited by ${name}` : '');
}

export const pageName = (slug: string) => (slug === 'index' ? 'home page' : slug);

export async function readPatterns(): Promise<SavedPattern[]> {
  const raw = await storage().readFile(opts.patternsFile);
  return raw ? (JSON.parse(raw) as SavedPattern[]) : [];
}
export const patternOk = (node: Node) => validate({ title: '', sections: [node] }).length === 0;

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}
export const bad = (msg: string, status = 400) => json({ error: msg }, status);

/** URL under which a file inside publicDir is served. */
export function publicUrl(filePath: string): string {
  const pub = opts.publicDir.replace(/\/$/, '') + '/';
  return filePath.startsWith(pub) ? '/' + filePath.slice(pub.length) : '/' + filePath;
}
export { publicPath };
