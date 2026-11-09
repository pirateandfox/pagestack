// Serves a staged (uncommitted) upload in github mode by repo path; the middleware handles the
// public URL form (routes/uploaded.ts). Kept as an explicit endpoint for debugging.
import type { APIRoute } from 'astro';
import { bad, storage } from '../../server/context';
export const prerender = false;
export const GET: APIRoute = async ({ params }) => {
  const bytes = await storage().asset(params.path ?? '');
  if (!bytes) return bad('not staged', 404);
  return new Response(bytes, { headers: { 'cache-control': 'no-store' } });
};
