import type { APIRoute } from 'astro';
import { json, listPages } from '../../server/context';
export const prerender = false;
export const GET: APIRoute = async () => json({ pages: await listPages() });
