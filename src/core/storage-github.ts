// GitHub adapter: reads through the Contents API, writes one commit per save through the Git Data
// API (blobs -> tree -> commit -> ref). Optionally commits to a fresh branch and opens a pull
// request instead of touching the target branch ("preview before publish").
//
// The token lives only on the server (GITHUB_TOKEN or options.github.token).
//
// Uploads wait on a side branch until the next save brings them along in its one commit, then the
// branch goes away. Keeping them in the repo rather than in memory means an upload and the save
// after it can land on different server instances (Workers), and a restart loses nothing.
import type { CommitResult, FileChange, PendingChanges, Revision, Storage } from './storage';
import { fromBase64, isSha, safeRelPath, toBase64 } from './storage';

export interface GitHubOptions {
  /** "owner/name" */
  repo: string;
  /** Branch to read from and (unless pullRequest) commit to. */
  branch?: string;
  /** Commit to a new branch and open a PR against `branch` instead of committing directly. */
  pullRequest?: boolean;
  /**
   * The branch the public site builds from. Saves go to `branch` (staging) and only Go live
   * moves them here. Leave out to have saves go straight to `branch`.
   */
  live?: string;
  token: string;
  apiBase?: string;
  /** Injected for tests. */
  fetch?: typeof fetch;
  /** Commit author shown in git history. */
  author?: { name: string; email: string };
}

const UPLOADS = 'pagestack-uploads';

/** Blob contents by git hash. A hash names exactly one content, so entries never go stale. */
const blobs = new Map<string, string>();
const BLOB_CACHE_MAX = 2000;

export class GitHubStorage implements Storage {
  readonly kind = 'github' as const;
  private fetchImpl: typeof fetch;
  private api: string;
  private branch: string;
  constructor(private opts: GitHubOptions) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(opts.repo)) throw new Error(`github.repo must be "owner/name", got "${opts.repo}"`);
    if (!opts.token) throw new Error('GitHub storage needs a token (GITHUB_TOKEN)');
    this.fetchImpl = opts.fetch ?? ((input, init) => globalThis.fetch(input, init)); // workerd refuses a detached fetch
    this.api = (opts.apiBase ?? 'https://api.github.com').replace(/\/$/, '');
    this.branch = opts.branch ?? 'main';
  }

  private async req<T = any>(method: string, url: string, body?: unknown, allow404 = false): Promise<T | null> {
    const res = await this.raw(method, url, body);
    if (res.status === 404 && allow404) return null;
    if (!res.ok) throw new Error(`GitHub ${method} ${url} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
    return (res.status === 204 ? null : await res.json()) as T;
  }
  private raw(method: string, url: string, body?: unknown): Promise<Response> {
    return this.fetchImpl(`${this.api}${url}`, {
      method,
      headers: { authorization: `Bearer ${this.opts.token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'pagestack', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  private get repoUrl() { return `/repos/${this.opts.repo}`; }

  async readFile(p: string): Promise<string | null> {
    const data = await this.req<any>('GET', `${this.repoUrl}/contents/${encodePath(safeRelPath(p))}?ref=${encodeURIComponent(this.branch)}`, undefined, true);
    if (!data || data.type !== 'file') return null;
    if (data.encoding === 'base64') return new TextDecoder().decode(fromBase64(data.content.replace(/\n/g, '')));
    // Files over 1 MB come without content; fetch the blob.
    const blob = await this.req<any>('GET', `${this.repoUrl}/git/blobs/${data.sha}`);
    return new TextDecoder().decode(fromBase64(blob.content.replace(/\n/g, '')));
  }

  async listDir(p: string) {
    const data = await this.req<any[]>('GET', `${this.repoUrl}/contents/${encodePath(safeRelPath(p))}?ref=${encodeURIComponent(this.branch)}`, undefined, true);
    if (!Array.isArray(data)) return [];
    const out = data.map((e) => ({ name: e.name as string, type: (e.type === 'dir' ? 'dir' : 'file') as 'dir' | 'file', size: e.size as number | undefined }));
    const waiting = await this.req<any[]>('GET', `${this.repoUrl}/contents/${encodePath(safeRelPath(p))}?ref=${UPLOADS}`, undefined, true);
    const seen = new Set(out.map((e) => e.name));
    if (Array.isArray(waiting)) for (const e of waiting) if (e.type === 'file' && !seen.has(e.name)) out.push({ name: e.name, type: 'file', size: e.size });
    return out;
  }

  async head(): Promise<string> {
    const ref = await this.req<any>('GET', `${this.repoUrl}/git/ref/heads/${encodeURIComponent(this.branch)}`);
    return ref.object.sha as string;
  }

  async lastChange(): Promise<string | null> {
    const c = await this.req<any>('GET', `${this.repoUrl}/commits/${encodeURIComponent(this.branch)}`, undefined, true);
    return c?.commit?.committer?.date ?? c?.commit?.author?.date ?? null;
  }

  async readDir(p: string): Promise<{ name: string; content: string }[]> {
    const data = await this.req<any[]>('GET', `${this.repoUrl}/contents/${encodePath(safeRelPath(p))}?ref=${encodeURIComponent(this.branch)}`, undefined, true);
    if (!Array.isArray(data)) return [];
    const files = data.filter((e) => e.type === 'file');
    const out: { name: string; content: string }[] = new Array(files.length);
    let next = 0;
    const worker = async () => {
      while (next < files.length) {
        const i = next++; const f = files[i];
        let content = blobs.get(f.sha);
        if (content === undefined) {
          const blob = await this.req<any>('GET', `${this.repoUrl}/git/blobs/${f.sha}`);
          content = new TextDecoder().decode(fromBase64(String(blob.content).replace(/\n/g, '')));
          if (blobs.size >= BLOB_CACHE_MAX) blobs.delete(blobs.keys().next().value!);
          blobs.set(f.sha, content);
        }
        out[i] = { name: f.name, content };
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, files.length) }, worker));
    return out;
  }

  private async uploadsBranch() {
    if (await this.req('GET', `${this.repoUrl}/git/ref/heads/${UPLOADS}`, undefined, true)) return;
    const head = await this.req<any>('GET', `${this.repoUrl}/git/ref/heads/${encodeURIComponent(this.branch)}`);
    await this.req('POST', `${this.repoUrl}/git/refs`, { ref: `refs/heads/${UPLOADS}`, sha: head.object.sha });
  }

  async putAsset(p: string, bytes: Uint8Array): Promise<void> {
    const path = safeRelPath(p);
    await this.uploadsBranch();
    await this.req('PUT', `${this.repoUrl}/contents/${encodePath(path)}`, { message: `Upload ${path.split('/').pop()}`, content: toBase64(bytes), branch: UPLOADS });
  }

  async pendingAsset(p: string): Promise<Uint8Array | undefined> {
    return this.bytesAt(p, UPLOADS);
  }

  async asset(p: string): Promise<Uint8Array | undefined> {
    return (await this.pendingAsset(p)) ?? this.bytesAt(p, this.branch);
  }

  private async bytesAt(p: string, ref: string): Promise<Uint8Array | undefined> {
    const data = await this.req<any>('GET', `${this.repoUrl}/contents/${encodePath(safeRelPath(p))}?ref=${encodeURIComponent(ref)}`, undefined, true);
    if (!data || data.type !== 'file') return undefined;
    const content = data.encoding === 'base64' ? data.content : (await this.req<any>('GET', `${this.repoUrl}/git/blobs/${data.sha}`)).content;
    return fromBase64(String(content).replace(/\n/g, ''));
  }

  /** What is waiting on the uploads branch, as tree entries that need no re-upload. */
  private async waiting(): Promise<{ path: string; mode: string; type: string; sha: string }[]> {
    const diff = await this.req<any>('GET', `${this.repoUrl}/compare/${encodeURIComponent(this.branch)}...${UPLOADS}`, undefined, true);
    return (diff?.files ?? []).filter((f: any) => f.status !== 'removed').map((f: any) => ({ path: f.filename, mode: '100644', type: 'blob', sha: f.sha }));
  }

  async history(p: string, limit = 30): Promise<Revision[]> {
    const q = new URLSearchParams({ path: safeRelPath(p), sha: this.branch, per_page: String(limit) });
    const data = await this.req<any[]>('GET', `${this.repoUrl}/commits?${q}`, undefined, true);
    return (data ?? []).map((c) => ({ sha: c.sha, message: String(c.commit.message).split('\n')[0], author: c.commit.author?.name ?? '', date: c.commit.author?.date ?? '' }));
  }

  async readAt(p: string, sha: string): Promise<string | null> {
    if (!isSha(sha)) return null;
    const data = await this.req<any>('GET', `${this.repoUrl}/contents/${encodePath(safeRelPath(p))}?ref=${sha}`, undefined, true);
    if (!data || data.type !== 'file') return null;
    return new TextDecoder().decode(fromBase64(String(data.content).replace(/\n/g, '')));
  }

  async commit({ message, files, deletes = [] }: { message: string; files: FileChange[]; deletes?: string[] }): Promise<CommitResult> {
    const all: FileChange[] = files.map((f) => ({ ...f, path: safeRelPath(f.path) }));
    const removed = deletes.map(safeRelPath);
    const uploads = (await this.waiting()).filter((u) => !removed.includes(u.path));
    if (!all.length && !removed.length && !uploads.length) throw new Error('nothing to commit');
    const base = await this.req<any>('GET', `${this.repoUrl}/git/ref/heads/${encodeURIComponent(this.branch)}`);
    const baseSha: string = base.object.sha;
    const baseCommit = await this.req<any>('GET', `${this.repoUrl}/git/commits/${baseSha}`);

    const tree: { path: string; mode: string; type: string; sha: string | null }[] = [...removed.map((path) => ({ path, mode: '100644', type: 'blob', sha: null })), ...uploads];
    for (const f of all) {
      const isText = typeof f.content === 'string';
      const blob = await this.req<any>('POST', `${this.repoUrl}/git/blobs`, isText ? { content: f.content, encoding: 'utf-8' } : { content: toBase64(f.content as Uint8Array), encoding: 'base64' });
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const newTree = await this.req<any>('POST', `${this.repoUrl}/git/trees`, { base_tree: baseCommit.tree.sha, tree });
    const commit = await this.req<any>('POST', `${this.repoUrl}/git/commits`, { message, tree: newTree.sha, parents: [baseSha], ...(this.opts.author ? { author: this.opts.author } : {}) });

    let branch = this.branch; let pullRequest: string | undefined;
    if (this.opts.pullRequest) {
      branch = `site-editor/${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${commit.sha.slice(0, 7)}`;
      await this.req('POST', `${this.repoUrl}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha });
      const pr = await this.req<any>('POST', `${this.repoUrl}/pulls`, { title: message, head: branch, base: this.branch, body: `Opened by the site editor.\n\nFiles:\n${[...all.map((f) => f.path), ...uploads.map((u) => u.path), ...removed].map((f) => `- ${f}`).join('\n')}` });
      pullRequest = pr.html_url;
    } else {
      await this.req('PATCH', `${this.repoUrl}/git/refs/heads/${encodeURIComponent(this.branch)}`, { sha: commit.sha, force: false });
    }
    if (uploads.length) await this.req('DELETE', `${this.repoUrl}/git/refs/heads/${UPLOADS}`, undefined, true).catch(() => { /* an empty next commit is harmless */ });
    return { kind: 'github', files: [...all.map((f) => f.path), ...uploads.map((u) => u.path), ...removed], commit: commit.sha, url: commit.html_url ?? `https://github.com/${this.opts.repo}/commit/${commit.sha}`, branch, pullRequest };
  }

  /** Saved but not yet live: commits on `branch` that `live` doesn't have. */
  async pending(): Promise<PendingChanges> {
    const live = this.opts.live;
    if (!live) throw new Error('no live branch configured');
    const cmp = await this.req<any>('GET', `${this.repoUrl}/compare/${encodeURIComponent(live)}...${encodeURIComponent(this.branch)}?per_page=50`);
    const commits: any[] = cmp.commits ?? [];
    const changes = commits.slice(-50).reverse().map((c) => ({ sha: c.sha, message: String(c.commit.message).split('\n')[0], author: editorOf(c.commit.message) ?? c.commit.author?.name ?? '', date: c.commit.author?.date ?? '' }));
    return { branch: this.branch, live, count: cmp.ahead_by ?? commits.length, changes };
  }

  /**
   * Moves `live` to the staging head. A fast-forward when `live` has nothing of its own; when it
   * does (someone committed to it directly), a merge commit, and staging follows so the next Go
   * live is a fast-forward again. A conflict is refused and left to a person in GitHub.
   */
  async goLive(message: string): Promise<{ commit: string; url: string; merged: boolean } | null> {
    const live = this.opts.live;
    if (!live) throw new Error('no live branch configured');
    const head = await this.req<any>('GET', `${this.repoUrl}/git/ref/heads/${encodeURIComponent(this.branch)}`);
    const sha: string = head.object.sha;
    const url = (c: string) => `https://github.com/${this.opts.repo}/commit/${c}`;
    const ff = await this.raw('PATCH', `${this.repoUrl}/git/refs/heads/${encodeURIComponent(live)}`, { sha, force: false });
    if (ff.ok) return { commit: sha, url: url(sha), merged: false };
    if (ff.status !== 422) throw new Error(`GitHub PATCH ${live} -> ${ff.status} ${(await ff.text()).slice(0, 300)}`);
    const merge = await this.raw('POST', `${this.repoUrl}/merges`, { base: live, head: sha, commit_message: message });
    if (merge.status === 204) return null; // nothing to put live
    if (merge.status === 409) throw new Error(`The live branch (${live}) has changes that conflict with these. Someone needs to merge ${this.branch} into ${live} in GitHub.`);
    if (!merge.ok) throw new Error(`GitHub merge -> ${merge.status} ${(await merge.text()).slice(0, 300)}`);
    const merged = await merge.json() as any;
    await this.raw('PATCH', `${this.repoUrl}/git/refs/heads/${encodeURIComponent(this.branch)}`, { sha: merged.sha, force: false }).catch(() => { /* a save landed meanwhile; the next Go live merges again */ });
    return { commit: merged.sha, url: merged.html_url ?? url(merged.sha), merged: true };
  }
}

function encodePath(p: string) { return p.split('/').map(encodeURIComponent).join('/'); }

/** The person named by `commitMessage` ("Edited by …"), since every commit's author is the token's. */
function editorOf(message: string): string | undefined {
  return /\n\nEdited by (.+)$/m.exec(String(message))?.[1]?.trim();
}
