import type { APIRoute } from 'astro';
import { bad } from '../../server/context';
export const prerender = false;
export const ALL: APIRoute = async () => bad('not implemented yet', 501);
