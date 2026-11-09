import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { LocalStorage } from '../src/core/storage-local';
import { safeRelPath, sha256 } from '../src/core/storage';

let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'ase-local-')); });
afterEach(() => fs.rm(root, { recursive: true, force: true }));

describe('LocalStorage', () => {
  it('reads null for missing files and lists missing dirs as empty', async () => {
    const s = new LocalStorage(root);
    expect(await s.readFile('src/content/pages/index.json')).toBeNull();
    expect(await s.listDir('src/content/pages')).toEqual([]);
  });
  it('commit writes every file, creating directories', async () => {
    const s = new LocalStorage(root);
    const res = await s.commit({ message: 'm', files: [{ path: 'src/content/pages/index.json', content: '{"a":1}\n' }, { path: 'editor-users.json', content: '{}' }] });
    expect(res).toEqual({ kind: 'local', files: ['src/content/pages/index.json', 'editor-users.json'] });
    expect(await s.readFile('src/content/pages/index.json')).toBe('{"a":1}\n');
    expect(await fs.readFile(path.join(root, 'editor-users.json'), 'utf8')).toBe('{}');
  });
  it('lists files with sizes, skipping dotfiles', async () => {
    const s = new LocalStorage(root);
    await s.commit({ message: 'm', files: [{ path: 'pages/a.json', content: '12345' }, { path: 'pages/.hidden', content: 'x' }, { path: 'pages/sub/b.json', content: '' }] });
    expect((await s.listDir('pages')).sort((a, b) => a.name.localeCompare(b.name))).toEqual([{ name: 'a.json', type: 'file', size: 5 }, { name: 'sub', type: 'dir', size: undefined }]);
  });
  it('putAsset writes binary immediately (served by the dev server) and has no pending state', async () => {
    const s = new LocalStorage(root);
    const bytes = new Uint8Array([137, 80, 78, 71, 0, 255]);
    await s.putAsset('public/images/uploads/x.png', bytes);
    expect(new Uint8Array(await fs.readFile(path.join(root, 'public/images/uploads/x.png')))).toEqual(bytes);
    expect(await s.pendingAsset()).toBeUndefined();
    expect(await s.asset()).toBeUndefined();
  });
  it('refuses to escape the root', async () => {
    const s = new LocalStorage(root);
    await expect(s.readFile('../etc/passwd')).rejects.toThrow(/unsafe path/);
    await expect(s.commit({ message: 'm', files: [{ path: 'a/../../b', content: '' }] })).rejects.toThrow(/unsafe path/);
    expect(safeRelPath('/leading/slash.txt')).toBe('leading/slash.txt');
    expect(() => safeRelPath('a//b')).toThrow();
  });
  it('sha256 is stable and hex', async () => {
    expect(await sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('LocalStorage page lifecycle', () => {
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Editor', '-c', 'user.email=e@x.co', ...args], { cwd: root, stdio: 'pipe' }).toString();
  it('deletes files in the same commit as writes', async () => {
    const s = new LocalStorage(root);
    await s.commit({ message: 'm', files: [{ path: 'p/old.json', content: 'x' }] });
    const res = await s.commit({ message: 'm', files: [{ path: 'p/new.json', content: 'y' }], deletes: ['p/old.json'] });
    expect(await s.readFile('p/old.json')).toBeNull();
    expect(await s.readFile('p/new.json')).toBe('y');
    expect(res.files).toEqual(['p/new.json', 'p/old.json']);
  });
  it('refuses to delete outside the root', async () => {
    await expect(new LocalStorage(root).commit({ message: 'm', files: [], deletes: ['../x'] })).rejects.toThrow(/unsafe/);
  });
  it('reads history and old versions from git', async () => {
    const s = new LocalStorage(root);
    git('init', '-q');
    for (const body of ['one', 'two']) { await fs.writeFile(path.join(root, 'a.json'), body); git('add', '.'); git('commit', '-qm', `save ${body}`); }
    const revs = await s.history('a.json');
    expect(revs.map((r) => r.message)).toEqual(['save two', 'save one']);
    expect(revs[0].author).toBe('Editor');
    expect(new Date(revs[0].date).getFullYear()).toBeGreaterThan(2000);
    expect(await s.readAt('a.json', revs[1].sha)).toBe('one');
  });
  it('has no history outside a repository, and refuses anything that is not a commit id', async () => {
    const s = new LocalStorage(root);
    expect(await s.history('a.json')).toEqual([]);
    expect(await s.readAt('a.json', '--output=/tmp/x')).toBeNull();
    expect(await s.readAt('a.json', 'deadbeef')).toBeNull();
  });
});
