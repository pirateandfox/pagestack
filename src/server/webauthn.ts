// Passkey (WebAuthn) flows on top of @simplewebauthn/server. Stateless: the challenge travels
// to the browser inside a signed token and comes back with the authenticator's response; the only
// server-side state is the committed users file (public keys) read/written through storage.
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { loadUsers, opts, secret, saveUsers } from './context';
import { b64url, createChallengeToken, createSession, readChallengeToken, readInvite, unb64url, type InvitePayload } from '../core/auth';
import { addCredential, findByCredential, findByEmail, inviteUsed, type StoredCredential } from '../core/users';

/**
 * Relying-party identity. WebAuthn binds credentials to the origin the browser sees, so behind a
 * proxy that rewrites Host the server must be told the public origin: set EDITOR_ORIGIN.
 */
export function relyingParty(url: URL) {
  const origin = (process.env.EDITOR_ORIGIN || url.origin).replace(/\/$/, '');
  return { origin, rpID: new URL(origin).hostname, rpName: opts.siteName, secure: origin.startsWith('https:') };
}

export { loadUsers, saveUsers };

export async function loginOptions(url: URL) {
  const { rpID } = relyingParty(url);
  // No allowCredentials: the browser offers every passkey it has for this site (discoverable
  // credentials), so there's no username step.
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
  const token = await createChallengeToken(options.challenge, 'login', secret());
  return { options, token };
}

export async function loginVerify(url: URL, token: string, response: AuthenticationResponseJSON) {
  const { origin, rpID } = relyingParty(url);
  const ch = await readChallengeToken(token, secret());
  if (!ch || ch.purpose !== 'login') throw new AuthError('The sign-in attempt expired. Try again.');
  const users = await loadUsers();
  const found = findByCredential(users, response.id);
  if (!found) throw new AuthError('This passkey is not registered for this site.');
  const { verified } = await verifyAuthenticationResponse({
    response, expectedChallenge: ch.challenge, expectedOrigin: origin, expectedRPID: rpID,
    credential: { id: found.credential.id, publicKey: unb64url(found.credential.publicKey), counter: found.credential.counter, transports: found.credential.transports as any },
  });
  if (!verified) throw new AuthError('Passkey verification failed.');
  // The signature counter is deliberately not persisted: it would mean a commit per login, and
  // synced passkeys (iCloud Keychain, Google Password Manager) always report 0 anyway.
  return { user: found.user, session: await createSession({ id: found.user.id, name: found.user.name }, secret()) };
}

export async function registerOptions(url: URL, inviteToken: string) {
  const { rpID, rpName } = relyingParty(url);
  const invite = await readInvite(inviteToken, secret());
  if (!invite) throw new AuthError('This invite link is invalid or has expired. Ask for a new one.');
  const users = await loadUsers();
  if (inviteUsed(users, invite.id)) throw new AuthError('This invite link has already been used.');
  const existing = findByEmail(users, invite.email);
  const options = await generateRegistrationOptions({
    rpName, rpID,
    userName: invite.email, userDisplayName: invite.name,
    userID: new TextEncoder().encode(existing?.id ?? `pending:${invite.id}`),
    attestationType: 'none',
    excludeCredentials: existing?.credentials.map((c) => ({ id: c.id, transports: c.transports as any })) ?? [],
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  });
  const token = await createChallengeToken(options.challenge, 'register', secret(), invite);
  return { options, token, invite: { name: invite.name, email: invite.email } };
}

export async function registerVerify(url: URL, token: string, response: RegistrationResponseJSON, label?: string) {
  const { origin, rpID } = relyingParty(url);
  const ch = await readChallengeToken(token, secret());
  if (!ch || ch.purpose !== 'register' || !ch.invite) throw new AuthError('The enrolment attempt expired. Open the invite link again.');
  const invite: InvitePayload = ch.invite;
  if (claimed.has(invite.id)) throw new AuthError('This invite link has already been used.');
  claimed.add(invite.id); // two tabs racing the same link: only one gets past here
  try {
  const users = await loadUsers();
  if (inviteUsed(users, invite.id)) throw new AuthError('This invite link has already been used.');
  const result = await verifyRegistrationResponse({ response, expectedChallenge: ch.challenge, expectedOrigin: origin, expectedRPID: rpID });
  if (!result.verified) throw new AuthError('Passkey registration failed.');
  const info = result.registrationInfo;
  const credential: StoredCredential = {
    id: info.credential.id, publicKey: b64url(info.credential.publicKey), counter: info.credential.counter,
    transports: info.credential.transports, deviceType: info.credentialDeviceType, backedUp: info.credentialBackedUp,
    createdAt: new Date().toISOString(), inviteId: invite.id, label: label?.slice(0, 60) || undefined,
  };
  const { file, user } = addCredential(users, invite, credential);
  const commit = await saveUsers(file, `Add passkey for ${user.name} (site editor)`);
  return { user, commit, session: await createSession({ id: user.id, name: user.name }, secret()) };
  } finally { claimed.delete(invite.id); }
}
const claimed = new Set<string>();

export class AuthError extends Error { status = 400; }
