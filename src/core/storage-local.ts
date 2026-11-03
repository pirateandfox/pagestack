// Local adapter: the working tree is the store. Saving writes files; `git commit` is left to the
// developer (or a follow-up `localCommit` option). Uploads land directly in the public dir so the
// dev server serves them at once.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CommitResult, FileChange, Storage } from './storage';
import { safeRelPath } from './storage';

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
  async commit({ files }: { message: string; files: FileChange[] }): Promise<CommitResult> {
    for (const f of files) {
      const abs = this.abs(f.path);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, f.content);
    }
    return { kind: 'local', files: files.map((f) => f.path) };
  }
  pendingAsset(): undefined { return undefined; }
}
