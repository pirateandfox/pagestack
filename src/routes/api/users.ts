// Admins only.
// GET    /api/editor/users                 -> { users, invites }
// PATCH  /api/editor/users { id, role }    -> changes a role
// DELETE /api/editor/users { id }          -> removes a person; their sessions end within seconds
// DELETE /api/editor/users { credential }  -> removes one passkey
// DELETE /api/editor/users { invite }      -> withdraws an unused invite link
import type { APIRoute } from 'astro';
import { bad, editorOf, isAdmin, json, loadUsers, opts, updateUsers } from '../../server/context';
import { pendingInvites, publicUsers, removeCredential, removeUser, setRole, withdrawInvite, type Role, type UsersFile } from '../../core/users';
export const prerender = false;

const guard = (locals: unknown) => (opts.auth !== 'passkey' ? bad('Users are managed by your login proxy.', 400) : isAdmin(locals) ? null : bad('Only admins can manage users.', 403));
const named = (who: string, what: string, locals: unknown) => `${what} ${who} (site editor)\n\nBy ${editorOf(locals)?.name ?? 'unknown'}`;
const view = (file: UsersFile) => ({ users: publicUsers(file), invites: pendingInvites(file) });

export const GET: APIRoute = async ({ locals }) => guard(locals) ?? json(view(await loadUsers()));

export const PATCH: APIRoute = async ({ request, locals }) => {
  const denied = guard(locals); if (denied) return denied;
  const body = await request.json().catch(() => null);
  if (body?.role !== 'admin' && body?.role !== 'editor') return bad('Unknown role.');
  try {
    const who = (await loadUsers()).users.find((u) => u.id === body.id)?.name ?? 'unknown';
    const { file } = await updateUsers((f) => setRole(f, String(body.id), body.role as Role), named(who, `Make ${body.role}:`, locals));
    return json({ ok: true, ...view(file) });
  } catch (e: any) { return bad(e.message); }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const denied = guard(locals); if (denied) return denied;
  const body = await request.json().catch(() => null);
  try {
    // Names for the commit message, from the file as it is now; the change itself re-reads it.
    const now = await loadUsers();
    if (body?.invite) {
      const name = pendingInvites(now).find((i) => i.id === body.invite)?.name ?? 'unknown';
      const { file } = await updateUsers((f) => withdrawInvite(f, String(body.invite)).file, named(name, 'Withdraw invite for', locals));
      return json({ ok: true, ...view(file) });
    }
    const who = (body?.credential ? now.users.find((u) => u.credentials.some((c) => c.id === body.credential)) : now.users.find((u) => u.id === body?.id))?.name ?? 'unknown';
    const { file } = await updateUsers((before) => {
      if (body?.credential) {
        const owner = before.users.find((u) => u.credentials.some((c) => c.id === body.credential));
        if (!owner) throw new Error('No such passkey.');
        // Their last passkey takes the person with it, so the last-admin rule has to hold here too.
        return owner.credentials.length === 1 ? removeUser(before, owner.id) : removeCredential(before, body.credential);
      }
      return removeUser(before, String(body?.id));
    }, named(who, 'Remove access for', locals));
    return json({ ok: true, ...view(file) });
  } catch (e: any) { return bad(e.message); }
};
