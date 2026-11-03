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

export interface Storage {
  readonly kind: 'local' | 'github';
  /** Text file content at a repo-relative path, or null when missing. */
  readFile(path: string): Promise<string | null>;
  /** Names of entries in a repo-relative directory (files and dirs), [] when missing. */
  listDir(path: string): Promise<{ name: string; type: 'file' | 'dir'; size?: number }[]>;
  /** Stage a binary (upload). It must be reachable at its URL before the next commit. */
  putAsset(path: string, bytes: Uint8Array): Promise<void>;
  /** Make a set of text changes durable, together with any staged assets. */
  commit(opts: { message: string; files: FileChange[] }): Promise<CommitResult>;
  /** A staged (uncommitted) asset, so the server can serve it in github mode. */
  pendingAsset(path: string): Uint8Array | undefined;
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

export function safeRelPath(p: string): string {
  const norm = p.replace(/\\/g, '/').replace(/^\/+/, '');
  if (norm.split('/').some((seg) => seg === '..' || seg === '')) throw new Error(`unsafe path: ${p}`);
  return norm;
}
