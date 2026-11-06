import { describe, expect, it } from 'vitest';
import { acceptImage, imagePath, sniffImage } from '../src/core/media';
import { rateLimiter } from '../src/core/ratelimit';
import { safeNext } from '../src/core/auth';
import { emptyUsers, addCredential, publicUsers, removeUser, roleOf, setRole } from '../src/core/users';

const te = new TextEncoder();
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('uploads', () => {
  it('decides by the bytes, not the claimed type', () => {
    expect(sniffImage(PNG)).toBe('png');
    expect(acceptImage(PNG, 'jpg').ext).toBe('png');
    expect(acceptImage(te.encode('<html><script>1</script>'), 'png').error).toBeTruthy();
  });
  it('stores a cleaned SVG', () => {
    const out = acceptImage(te.encode('<svg onload="x()"><script>x()</script><path d="M0"/></svg>'), 'svg');
    expect(new TextDecoder().decode(out.bytes)).toBe('<svg><path d="M0"/></svg>');
    expect(acceptImage(te.encode('<html></html>'), 'svg').error).toBeTruthy();
  });
  it('only maps URLs inside the image folders', () => {
    const roots = ['public/images', 'public/images/uploads'];
    expect(imagePath('/images/a.jpg', 'public', roots)).toBe('public/images/a.jpg');
    for (const bad of ['/images/../../secrets.jpg', '/other/a.jpg', '/images/a.txt', 'images/a.jpg', '/images\\a.jpg']) expect(imagePath(bad, 'public', roots)).toBeNull();
  });
});

describe('rate limiter', () => {
  it('blocks past the limit and resets after the window', () => {
    const hit = rateLimiter({ limit: 2, windowMs: 1000 });
    expect(hit('a', 0).ok).toBe(true); expect(hit('a', 1).ok).toBe(true);
    expect(hit('a', 2)).toEqual({ ok: false, retryAfter: 1 });
    expect(hit('b', 2).ok).toBe(true);
    expect(hit('a', 1001).ok).toBe(true);
  });
});

describe('safeNext', () => {
  it('only allows paths on this site', () => {
    expect(safeNext('/edit/index?x=1')).toBe('/edit/index?x=1');
    for (const bad of ['//evil.test', '/\\evil.test', '/\t/evil.test', 'https://evil.test', 'javascript:alert(1)', null, 3]) expect(safeNext(bad)).toBe('/edit');
  });
});

describe('roles', () => {
  const cred = (id: string) => ({ id, publicKey: 'k', counter: 0, createdAt: '2026-01-01' });
  const two = () => {
    const a = addCredential(emptyUsers(), { name: 'Ann', email: 'a@x.test' }, cred('1'));
    const b = addCredential(a.file, { name: 'Bo', email: 'b@x.test', role: 'editor' }, cred('2'));
    return { file: b.file, ann: a.user.id, bo: b.user.id };
  };
  it('treats a user from before roles as an admin', () => expect(roleOf({})).toBe('admin'));
  it('never leaves the site without an admin', () => {
    const { file, ann, bo } = two();
    expect(() => setRole(file, ann, 'editor')).toThrow(/admin/);
    expect(() => removeUser(file, ann)).toThrow(/admin/);
    expect(removeUser(file, bo).users.map((u) => u.name)).toEqual(['Ann']);
    expect(roleOf(setRole(setRole(file, bo, 'admin'), ann, 'editor').users[0])).toBe('editor');
  });
  it('keeps public keys off the Users screen', () => expect(JSON.stringify(publicUsers(two().file))).not.toContain('publicKey'));
});
