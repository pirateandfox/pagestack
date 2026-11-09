// Local adapter: the working tree is the store. Saving writes files; `git commit` is left to the
// developer (or a follow-up `localCommit` option). Uploads land directly in the public dir so the
// dev server serves them at once.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CommitResult, FileChange, Revision, Storage } from './storage';
import { isSha, safeRelPath } from './storage';

const run = promisify(execFile);

export class LocalStorage implements Storage {
  readonly kind = 'local' as const;
  constructor(private root: string) {}
  private abs(p: string) { return path.join(this.root, safeRelPath(p)); }

  async readFile(p: string): Promise<string | null> {
    try { return await fs.readFile(this.abs(p), 'utf8'); } catch (e: any) { if (e.code === 'ENOENT') return null; throw e; }
  }
  async listDir(p: string) {
    try {
      const entries = await fs.readdir(this.abs(p), { withFileTypes: true });
      const out = [];
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const type = e.isDirectory() ? 'dir' as const : 'file' as const;
        const size = type === 'file' ? (await fs.stat(path.join(this.abs(p), e.name))).size : undefined;
        out.push({ name: e.name, type, size });
      }
      return out;
    } catch (e: any) { if (e.code === 'ENOENT') return []; throw e; }
  }
  async putAsset(p: string, bytes: Uint8Array): Promise<void> {
    const f = this.abs(p);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, bytes);
  }
  async commit({ files, deletes = [] }: { message: string; files: FileChange[]; deletes?: string[] }): Promise<CommitResult> {
    for (const f of files) {
      const abs = this.abs(f.path);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, f.content);
    }
    for (const p of deletes) await fs.rm(this.abs(p), { force: true });
    return { kind: 'local', files: [...files.map((f) => f.path), ...deletes] };
  }
  /** Reads the working tree's git log; a folder that isn't a repository simply has no history. */
  async history(p: string, limit = 30): Promise<Revision[]> {
    const SEP = '\x1f';
    try {
      const { stdout } = await run('git', ['log', `-n${limit}`, '--follow', `--format=%H${SEP}%an${SEP}%aI${SEP}%s`, '--', safeRelPath(p)], { cwd: this.root });
      return stdout.split('\n').filter(Boolean).map((line) => { const [sha, author, date, message] = line.split(SEP); return { sha, author, date, message }; });
    } catch { return []; }
  }
  async readAt(p: string, sha: string): Promise<string | null> {
    if (!isSha(sha)) return null;
    try { return (await run('git', ['show', `${sha}:${safeRelPath(p)}`], { cwd: this.root, maxBuffer: 16 * 1024 * 1024 })).stdout; } catch { return null; }
  }
  async pendingAsset(): Promise<undefined> { return undefined; }
  async asset(): Promise<undefined> { return undefined; } // the dev server serves the working tree
}
