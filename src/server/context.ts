// Server-side glue shared by the routes: resolved options, the storage adapter, page IO.
import { options, site } from 'virtual:pagestack/site';
import type { CollectionDoc, Field, GlobalDoc, Node, PageDoc, PageTemplate, SchemaRegistry } from '../runtime';
import type { CommitResult, Storage } from '../core/storage';
import { sha256, StaleWrite } from '../core/storage';
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
import { isSampleItem, isSamplePage, type SampleContent, type SampleGlobal, type SampleItem, type SamplePage } from '../core/samples';

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
const extras = site as unknown as { pageFields?: Record<string, Field>; templates?: PageTemplate[]; globals?: Record<string, GlobalDoc>; collections?: Record<string, CollectionDoc>; sampleContent?: SampleContent };
export const pageFields = extras.pageFields ?? {};
export const templates = extras.templates ?? [];
export const globals = extras.globals ?? {};
export const collections = extras.collections ?? {};
export const sampleContent: SampleContent = extras.sampleContent ?? {};

/** Every page and Markdown item marked `sample: true`, and the globals the host resets with them. */
export async function readSamples(from: PageFile[] | Promise<PageFile[]> = opts.pages === false ? [] : readPages()): Promise<{ pages: SamplePage[]; items: SampleItem[]; globals: SampleGlobal[]; slugs: string[] }> {
  const [all, folders] = await Promise.all([
    from,
    storage().readDirs(Object.values(collections).map((c) => c.dir)),
  ]);
  const pages: SamplePage[] = all.filter((p) => isSamplePage(p.page)).map(({ slug, raw, page }) => ({ slug, path: pagePath(slug), raw, page }));
  const items: SampleItem[] = [];
  for (const [id, c] of Object.entries(collections)) {
    for (const { name, content: raw } of folders[c.dir]) {
      if (!name.endsWith('.md') || !isSampleItem(raw)) continue;
      const { data } = parseMarkdown(raw);
      items.push({ collection: id, label: c.label, slug: name.slice(0, -3), path: `${c.dir}/${name}`, raw, title: String(data.title ?? name), draft: data.draft === true });
    }
  }
  const ids = Object.keys(sampleContent.globals ?? {}).filter((id) => Object.hasOwn(globals, id));
  const raw = await storage().readFiles(ids.map((id) => globals[id].file));
  return { pages, items, globals: ids.map((id) => ({ id, path: globals[id].file, raw: raw[globals[id].file] })), slugs: all.map((p) => p.slug) };
}
/** Pages (and their titles) whose stored JSON mentions a URL. Globals and patterns count too. */
export async function whereUsed(src: string): Promise<{ title: string; href: string }[]> {
  const out: { title: string; href: string }[] = [];
  const has = (raw: string | null) => !!raw && raw.includes(src);
  const [pages, files] = await Promise.all([readPages(), storage().readFiles([...Object.values(globals).map((g) => g.file), opts.patternsFile])]);
  for (const p of pages) if (has(p.raw)) out.push({ title: p.page.title, href: `/edit/${p.slug}` });
  for (const [id, g] of Object.entries(globals)) if (has(files[g.file])) out.push({ title: g.label, href: `/edit/global/${id}` });
  if (has(files[opts.patternsFile])) out.push({ title: 'Saved patterns', href: '/edit' });
  return out;
}

// ---- collections (Markdown folders) ----
export interface ItemSummary { slug: string; title: string; date: string; draft: boolean }
export async function listItems(c: CollectionDoc): Promise<ItemSummary[]> {
  const out: ItemSummary[] = [];
  for (const { name, content } of (await storage().readDirs([c.dir]))[c.dir]) {
    if (!name.endsWith('.md')) continue;
    const { data } = parseMarkdown(content);
    out.push({ slug: name.slice(0, -3), title: String(data.title ?? name), date: String(data.date ?? ''), draft: data.draft === true });
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

export interface PageSummary { slug: string; title: string; sections: number; status: 'draft' | 'published'; sample?: boolean }

/** Levels of subfolders pages can sit in. */
const PAGE_DEPTH = 4;
export interface PageFile { slug: string; raw: string; page: PageDoc }
/** Every page with its contents, subfolders included: one request on GitHub. */
export async function readPages(): Promise<PageFile[]> {
  const files = (await storage().readDirs([opts.pagesDir], undefined, PAGE_DEPTH))[opts.pagesDir];
  return files.filter((f) => f.name.endsWith('.json')).map((f) => ({ slug: f.name.slice(0, -5), raw: f.content, page: JSON.parse(f.content) as PageDoc }));
}

/** `from`: pages already read, so a screen needing both doesn't read them twice. */
export async function listPages(from: PageFile[] | Promise<PageFile[]> = readPages()): Promise<PageSummary[]> {
  const out = (await from).map(({ slug, page }): PageSummary => ({ slug, title: page.title, sections: page.sections.length, status: page.status === 'draft' ? 'draft' : 'published', ...(isSamplePage(page) ? { sample: true } : {}) }));
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
/**
 * Read the users file, change it and save it, as one step: if someone else saved it in between
 * (two admins at once, or an invite used while an admin edits roles), it is read again and the
 * change re-applied, so neither save is lost. `change` may throw to refuse.
 */
export async function updateUsers(change: (file: UsersFile) => UsersFile, message: string): Promise<{ file: UsersFile; commit: CommitResult }> {
  for (let attempt = 0; ; attempt++) {
    const raw = await storage().readFile(opts.usersFile);
    const file = change(parseUsers(raw));
    try {
      const commit = await storage().commit({ message, files: [{ path: opts.usersFile, content: serializeUsers(file) }], expect: { [opts.usersFile]: raw } });
      usersCache = null;
      return { file, commit };
    } catch (e) {
      if (!(e instanceof StaleWrite) || attempt >= 3) throw e instanceof StaleWrite ? new Error('Someone else changed the user list at the same moment. Try again.') : e;
    }
  }
}
const USERS_TTL = 15_000;
/** A miss may mean "saved a moment ago by another instance": re-read, but not more than this often. */
const MISS_REREAD = 5_000;
/**
 * The users file, read at most every 15s. `want` says what the caller is looking for; when it isn't
 * there the file is read again (a brand-new user or passkey may have been saved elsewhere), at
 * most every 5s, so requests for someone who doesn't exist can't each cost a GitHub read.
 */
export async function cachedUsers(want: (f: UsersFile) => boolean = () => true, now = Date.now()): Promise<UsersFile> {
  if (!usersCache || now - usersCache.at > USERS_TTL) usersCache = { file: await loadUsers(), at: now };
  if (!want(usersCache.file) && now - usersCache.at > MISS_REREAD) usersCache = { file: await loadUsers(), at: now };
  return usersCache.file;
}
/**
 * The user behind a session, so removing someone ends their sessions. With `credential`, the
 * passkey the session was signed in with must still be on file too: removing a lost device's
 * passkey ends the sessions it opened.
 */
export async function activeUser(id: string, credential?: string, now = Date.now()): Promise<EditorUser | null> {
  const match = (f: UsersFile) => f.users.find((u) => u.id === id && (!credential || u.credentials.some((c) => c.id === credential)));
  return match(await cachedUsers((f) => !!match(f), now)) ?? null;
}

/** A commit message with the editor's name on it. */
export function commitMessage(subject: string, locals: unknown): string {
  const name = (locals as { editorUser?: { name?: string } }).editorUser?.name;
  // A subject can come from the client: one line, and never one that claims to name the editor.
  const line = subject.split(/\r?\n/)[0].replace(/^\s*edited by\b/i, 'Edit').slice(0, 120);
  return line + (name ? `\n\nEdited by ${name}` : '');
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
