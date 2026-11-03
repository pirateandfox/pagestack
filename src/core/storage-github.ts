// GitHub adapter: reads through the Contents API, writes one commit per save through the Git Data
// API (blobs -> tree -> commit -> ref). Optionally commits to a fresh branch and opens a pull
// request instead of touching the target branch ("preview before publish").
//
// The token lives only on the server (GITHUB_TOKEN or options.github.token). Uploads are staged
// in memory until the next commit; `pendingAsset` lets the server serve them in the meantime.
import type { CommitResult, FileChange, Storage } from './storage';
import { fromBase64, safeRelPath, toBase64 } from './storage';

export interface GitHubOptions {
  /** "owner/name" */
  repo: string;
  /** Branch to read from and (unless pullRequest) commit to. */
  branch?: string;
  /** Commit to a new branch and open a PR against `branch` instead of committing directly. */
  pullRequest?: boolean;
  token: string;
  apiBase?: string;
  /** Injected for tests. */
  fetch?: typeof fetch;
  /** Commit author shown in git history. */
  author?: { name: string; email: string };
}

export class GitHubStorage implements Storage {
  readonly kind = 'github' as const;
  private staged = new Map<string, Uint8Array>();
  private fetchImpl: typeof fetch;
  private api: string;
  private branch: string;
  constructor(private opts: GitHubOptions) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(opts.repo)) throw new Error(`github.repo must be "owner/name", got "${opts.repo}"`);
    if (!opts.token) throw new Error('GitHub storage needs a token (GITHUB_TOKEN)');
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.api = (opts.apiBase ?? 'https://api.github.com').replace(/\/$/, '');
    this.branch = opts.branch ?? 'main';
  }

  private async req<T = any>(method: string, url: string, body?: unknown, allow404 = false): Promise<T | null> {
    const res = await this.fetchImpl(`${this.api}${url}`, {
      method,
      headers: { authorization: `Bearer ${this.opts.token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'pagestack', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404 && allow404) return null;
    if (!res.ok) throw new Error(`GitHub ${method} ${url} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as T;
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
    for (const [path, bytes] of this.staged) {
      const dir = path.slice(0, path.lastIndexOf('/'));
      if (dir === safeRelPath(p).replace(/\/$/, '')) out.push({ name: path.slice(dir.length + 1), type: 'file', size: bytes.byteLength });
    }
    return out;
  }

  async putAsset(p: string, bytes: Uint8Array): Promise<void> {
    this.staged.set(safeRelPath(p), bytes);
  }
  pendingAsset(p: string): Uint8Array | undefined {
    return this.staged.get(safeRelPath(p));
  }

  async commit({ message, files }: { message: string; files: FileChange[] }): Promise<CommitResult> {
    const all: FileChange[] = [...files.map((f) => ({ ...f, path: safeRelPath(f.path) })), ...[...this.staged].map(([path, content]) => ({ path, content }))];
    if (!all.length) throw new Error('nothing to commit');
    const base = await this.req<any>('GET', `${this.repoUrl}/git/ref/heads/${encodeURIComponent(this.branch)}`);
    const baseSha: string = base.object.sha;
    const baseCommit = await this.req<any>('GET', `${this.repoUrl}/git/commits/${baseSha}`);

    const tree = [];
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
      const pr = await this.req<any>('POST', `${this.repoUrl}/pulls`, { title: message, head: branch, base: this.branch, body: `Opened by the site editor.\n\nFiles:\n${all.map((f) => `- ${f.path}`).join('\n')}` });
      pullRequest = pr.html_url;
    } else {
      await this.req('PATCH', `${this.repoUrl}/git/refs/heads/${encodeURIComponent(this.branch)}`, { sha: commit.sha, force: false });
    }
    this.staged.clear();
    return { kind: 'github', files: all.map((f) => f.path), commit: commit.sha, url: commit.html_url ?? `https://github.com/${this.opts.repo}/commit/${commit.sha}`, branch, pullRequest };
  }
}

function encodePath(p: string) { return p.split('/').map(encodeURIComponent).join('/'); }
