// Local adapter: the working tree is the store. Saving writes files; `git commit` is left to the
// developer (or a follow-up `localCommit` option). Uploads land directly in the public dir so the
// dev server serves them at once.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CommitResult, DirFile, FileChange, Revision, Storage } from './storage';
import { isSha, safeRelPath, StaleWrite } from './storage';

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
  async readFiles(paths: string[]) {
    return Object.fromEntries(await Promise.all(paths.map(async (p) => [p, await this.readFile(p)] as const)));
  }
  async listTree(dirs: string[]) {
    const walk = async (p: string): Promise<{ name: string; size?: number }[]> => (await Promise.all((await this.listDir(p)).map(async (e) =>
      e.type === 'file' ? [{ name: e.name, size: e.size }] : (await walk(`${p}/${e.name}`)).map((f) => ({ ...f, name: `${e.name}/${f.name}` }))))).flat();
    return Object.fromEntries(await Promise.all(dirs.map(async (d) => [d, await walk(d)] as const)));
  }
  readDir(p: string) { return this.readFolder(p, 0); }
  async readDirs(dirs: string[], _ref?: string, depth = 0) {
    const out: Record<string, DirFile[]> = {};
    for (const d of dirs) out[d] = await this.readFolder(d, depth);
    return out;
  }
  private async readFolder(p: string, depth: number): Promise<DirFile[]> {
    const out: DirFile[] = [];
    for (const e of await this.listDir(p)) {
      if (e.type === 'dir') {
        if (depth > 0) for (const f of await this.readFolder(`${p}/${e.name}`, depth - 1)) out.push({ ...f, name: `${e.name}/${f.name}` });
        continue;
      }
      const content = await this.readFile(`${p}/${e.name}`);
      if (content !== null) out.push({ name: e.name, content });
    }
    return out;
  }
  async putAsset(p: string, bytes: Uint8Array): Promise<void> {
    const f = this.abs(p);
    noteWrite(f);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, bytes);
  }
  async commit({ files, deletes = [], expect }: { message: string; files: FileChange[]; deletes?: string[]; expect?: Record<string, string | null> }): Promise<CommitResult> {
    for (const [p, want] of Object.entries(expect ?? {})) {
      const now = await fs.readFile(this.abs(p), 'utf8').catch(() => null);
      if (now !== want) throw new StaleWrite(p);
    }
    for (const f of files) {
      const abs = this.abs(f.path);
      noteWrite(abs);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, f.content);
    }
    for (const p of deletes) { noteWrite(this.abs(p)); await fs.rm(this.abs(p), { force: true }); }
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

/**
 * Files the editor just wrote, so the dev server doesn't answer its own save with a full page
 * reload (which would throw away the editor's selection and undo history). Read in index.mjs.
 */
function noteWrite(abs: string) {
  const g = globalThis as any;
  (g.__PS_WRITES__ ??= new Map<string, number>()).set(path.resolve(abs), Date.now());
}
