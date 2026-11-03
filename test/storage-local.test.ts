import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
    expect(s.pendingAsset()).toBeUndefined();
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
