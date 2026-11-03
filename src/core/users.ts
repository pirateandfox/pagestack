// The committed users file (`editor-users.json` by default): who may edit, identified by the
// public keys of their passkeys. Nothing secret lives here — a public key can't be used to log in.
// Pure functions; reading/writing goes through the storage adapter (server/webauthn.ts).

export interface StoredCredential {
  /** Credential id (base64url), what the authenticator sends back on login. */
  id: string;
  /** COSE public key, base64url. */
  publicKey: string;
  counter: number;
  transports?: string[];
  deviceType?: 'singleDevice' | 'multiDevice';
  backedUp?: boolean;
  createdAt: string;
  /** Id of the invite this credential was created from (makes invites single-use). */
  inviteId?: string;
  label?: string;
}

export interface EditorUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  credentials: StoredCredential[];
}

export interface UsersFile { version: 1; users: EditorUser[] }

export const emptyUsers = (): UsersFile => ({ version: 1, users: [] });

export function parseUsers(raw: string | null | undefined): UsersFile {
  if (!raw || !raw.trim()) return emptyUsers();
  const data = JSON.parse(raw);
  if (!data || typeof data !== 'object' || !Array.isArray(data.users)) throw new Error('editor users file: expected { "users": [] }');
  for (const u of data.users) {
    if (typeof u.id !== 'string' || typeof u.email !== 'string' || !Array.isArray(u.credentials)) throw new Error(`editor users file: malformed user ${JSON.stringify(u.id ?? u)}`);
  }
  return { version: 1, users: data.users };
}

export const serializeUsers = (file: UsersFile): string => JSON.stringify(file, null, 2) + '\n';

export function findByCredential(file: UsersFile, credentialId: string): { user: EditorUser; credential: StoredCredential } | null {
  for (const user of file.users) {
    const credential = user.credentials.find((c) => c.id === credentialId);
    if (credential) return { user, credential };
  }
  return null;
}

export const findByEmail = (file: UsersFile, email: string) => file.users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase()) ?? null;

export const inviteUsed = (file: UsersFile, inviteId: string) => file.users.some((u) => u.credentials.some((c) => c.inviteId === inviteId));

export function newUserId(): string {
  const buf = new Uint8Array(8); crypto.getRandomValues(buf);
  return 'u_' + [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Add a credential to the user with this email (creating the user when new). Returns a new file. */
export function addCredential(file: UsersFile, who: { name: string; email: string }, credential: StoredCredential, now = new Date()): { file: UsersFile; user: EditorUser } {
  if (findByCredential(file, credential.id)) throw new Error('credential already registered');
  const copy: UsersFile = structuredClone(file);
  let user = findByEmail(copy, who.email);
  if (!user) {
    user = { id: newUserId(), name: who.name.trim(), email: who.email.trim().toLowerCase(), createdAt: now.toISOString(), credentials: [] };
    copy.users.push(user);
  }
  user.credentials.push(credential);
  return { file: copy, user };
}

export function removeCredential(file: UsersFile, credentialId: string): UsersFile {
  const copy: UsersFile = structuredClone(file);
  for (const u of copy.users) u.credentials = u.credentials.filter((c) => c.id !== credentialId);
  copy.users = copy.users.filter((u) => u.credentials.length);
  return copy;
}
