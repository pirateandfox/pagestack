// Storage adapters: where page JSON, uploads and the editor-users file live, and how a save
// becomes durable. `local` writes to the working tree (dev). `github` makes one commit per save
// through the GitHub API with a server-side token; the browser never sees it.

export interface FileChange {
  /** Repo-relative path, forward slashes. */
  path: string;
  /** Text content, or binary bytes. */
  content: string | Uint8Array;
}

export interface CommitResult {
  kind: 'local' | 'github';
  /** Files written / committed. */
  files: string[];
  commit?: string;
  url?: string;
  branch?: string;
  pullRequest?: string;
}

export interface Revision {
  sha: string;
  /** First line of the commit message. */
  message: string;
  author: string;
  /** ISO 8601. */
  date: string;
}

/** Saved changes on the staging branch that the live branch doesn't have yet. */
export interface PendingChanges {
  /** The branch saves go to, and the one Go live updates. */
  branch: string;
  live: string;
  /** Commits waiting, newest first (at most 50 listed; `count` is the real number). */
  count: number;
  changes: Revision[];
}

export interface Storage {
  readonly kind: 'local' | 'github';
  /** Text file content at a repo-relative path, or null when missing. */
  readFile(path: string): Promise<string | null>;
  /** Names of entries in a repo-relative directory (files and dirs), [] when missing. */
  listDir(path: string): Promise<{ name: string; type: 'file' | 'dir'; size?: number }[]>;
  /** Stage a binary (upload). It must be reachable at its URL before the next commit. */
  putAsset(path: string, bytes: Uint8Array): Promise<void>;
  /** Make a set of text changes durable, together with any staged assets. `deletes` are repo-relative paths. */
  commit(opts: { message: string; files: FileChange[]; deletes?: string[] }): Promise<CommitResult>;
  /** Commits that touched a file, newest first. [] when there is no history to read. */
  history(path: string, limit?: number): Promise<Revision[]>;
  /** Text of a file as of a commit from `history`, or null. */
  readAt(path: string, sha: string): Promise<string | null>;
  /** A staged (uncommitted) asset, so the server can serve it in github mode. */
  pendingAsset(path: string): Promise<Uint8Array | undefined>;
  /**
   * An image the deployed build may not have yet: staged, else committed since the editor was
   * built (the editor deployment doesn't rebuild on every save). undefined when neither.
   */
  asset(path: string): Promise<Uint8Array | undefined>;
  /** With a live branch configured (`github.live`): what saving has staged. Absent otherwise. */
  pending?(): Promise<PendingChanges>;
  /** Puts everything staged on the live branch (fast-forward, else a merge commit). */
  goLive?(message: string): Promise<{ commit: string; url: string; merged: boolean } | null>;
}

export async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s);
}
export function fromBase64(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const s = atob(b64); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out;
}

/** Commit ids reach `git` and URLs, so only ever accept the real shape. */
export const isSha = (s: string) => /^[0-9a-f]{7,40}$/i.test(s);

export function safeRelPath(p: string): string {
  const norm = p.replace(/\\/g, '/').replace(/^\/+/, '');
  if (norm.split('/').some((seg) => seg === '..' || seg === '')) throw new Error(`unsafe path: ${p}`);
  return norm;
}
