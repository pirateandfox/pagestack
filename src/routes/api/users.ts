// Admins only.
// GET    /api/editor/users                 -> { users }
// PATCH  /api/editor/users { id, role }    -> changes a role
// DELETE /api/editor/users { id }          -> removes a person; their sessions end within seconds
// DELETE /api/editor/users { credential }  -> removes one passkey
import type { APIRoute } from 'astro';
import { bad, editorOf, isAdmin, json, loadUsers, opts, saveUsers } from '../../server/context';
import { publicUsers, removeCredential, removeUser, setRole, type Role } from '../../core/users';
export const prerender = false;

const guard = (locals: unknown) => (opts.auth !== 'passkey' ? bad('Users are managed by your login proxy.', 400) : isAdmin(locals) ? null : bad('Only admins can manage users.', 403));
const named = (who: string, what: string, locals: unknown) => `${what} ${who} (site editor)\n\nBy ${editorOf(locals)?.name ?? 'unknown'}`;

export const GET: APIRoute = async ({ locals }) => guard(locals) ?? json({ users: publicUsers(await loadUsers()) });

export const PATCH: APIRoute = async ({ request, locals }) => {
  const denied = guard(locals); if (denied) return denied;
  const body = await request.json().catch(() => null);
  if (body?.role !== 'admin' && body?.role !== 'editor') return bad('Unknown role.');
  try {
    const file = setRole(await loadUsers(), String(body.id), body.role as Role);
    await saveUsers(file, named(file.users.find((u) => u.id === body.id)!.name, `Make ${body.role}:`, locals));
    return json({ ok: true, users: publicUsers(file) });
  } catch (e: any) { return bad(e.message); }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const denied = guard(locals); if (denied) return denied;
  const body = await request.json().catch(() => null);
  try {
    const before = await loadUsers();
    let file; let who: string;
    if (body?.credential) {
      const owner = before.users.find((u) => u.credentials.some((c) => c.id === body.credential));
      if (!owner) return bad('No such passkey.', 404);
      who = owner.name;
      // Their last passkey takes the person with it, so the last-admin rule has to hold here too.
      file = owner.credentials.length === 1 ? removeUser(before, owner.id) : removeCredential(before, body.credential);
    } else {
      who = before.users.find((u) => u.id === body?.id)?.name ?? '';
      file = removeUser(before, String(body?.id));
    }
    await saveUsers(file, named(who, 'Remove access for', locals));
    return json({ ok: true, users: publicUsers(file) });
  } catch (e: any) { return bad(e.message); }
};
