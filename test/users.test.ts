import { describe, expect, it } from 'vitest';
import { addCredential, emptyUsers, findByCredential, findByEmail, inviteUsed, parseUsers, removeCredential, serializeUsers, type StoredCredential } from '../src/core/users';

const cred = (id: string, inviteId?: string): StoredCredential => ({ id, publicKey: 'pk_' + id, counter: 0, createdAt: '2026-01-01T00:00:00.000Z', inviteId });

describe('users file', () => {
  it('parses an empty or missing file as no users, rejects garbage', () => {
    expect(parseUsers(null)).toEqual(emptyUsers());
    expect(parseUsers('')).toEqual(emptyUsers());
    expect(parseUsers('{"version":1,"users":[]}')).toEqual(emptyUsers());
    expect(() => parseUsers('{"nope":true}')).toThrow(/expected/);
    expect(() => parseUsers('{"users":[{"id":1}]}')).toThrow(/malformed/);
  });
  it('adds a credential, creating the user on first enrolment and reusing them by email', () => {
    const now = new Date('2026-02-02T00:00:00Z');
    const first = addCredential(emptyUsers(), { name: ' Jane ', email: 'Jane@Example.com' }, cred('c1', 'inv1'), now);
    expect(first.user).toMatchObject({ name: 'Jane', email: 'jane@example.com', createdAt: now.toISOString() });
    expect(first.user.id).toMatch(/^u_[0-9a-f]{16}$/);
    const second = addCredential(first.file, { name: 'Jane Doe', email: 'jane@example.com' }, cred('c2', 'inv2'));
    expect(second.file.users).toHaveLength(1);
    expect(second.user.id).toBe(first.user.id);
    expect(second.user.credentials.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(first.file.users[0].credentials).toHaveLength(1); // input untouched
    expect(() => addCredential(second.file, { name: 'x', email: 'x@y.z' }, cred('c1'))).toThrow(/already registered/);
  });
  it('looks users up by credential and email, and tracks used invites', () => {
    const { file } = addCredential(emptyUsers(), { name: 'Jane', email: 'jane@example.com' }, cred('c1', 'inv1'));
    expect(findByCredential(file, 'c1')?.user.email).toBe('jane@example.com');
    expect(findByCredential(file, 'zz')).toBeNull();
    expect(findByEmail(file, 'JANE@example.com')?.id).toBe(file.users[0].id);
    expect(inviteUsed(file, 'inv1')).toBe(true);
    expect(inviteUsed(file, 'inv2')).toBe(false);
  });
  it('removes credentials and drops users left without any', () => {
    const { file } = addCredential(addCredential(emptyUsers(), { name: 'J', email: 'j@e.com' }, cred('c1')).file, { name: 'J', email: 'j@e.com' }, cred('c2'));
    expect(removeCredential(file, 'c1').users[0].credentials.map((c) => c.id)).toEqual(['c2']);
    expect(removeCredential(removeCredential(file, 'c1'), 'c2').users).toEqual([]);
  });
  it('serialises deterministically', () => {
    const { file } = addCredential(emptyUsers(), { name: 'J', email: 'j@e.com' }, cred('c1'));
    const text = serializeUsers(file);
    expect(text.endsWith('\n')).toBe(true);
    expect(parseUsers(text)).toEqual(file);
  });
});
