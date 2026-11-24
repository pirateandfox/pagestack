// What an upload may be, and how a stored file maps to its URL. Pure.
import { sanitizeSvgFile } from './sanitize';

export const IMAGE_RE = /\.(jpe?g|png|webp|gif|svg|avif)$/i;
export const MAX_BYTES = 10 * 1024 * 1024;
export const MIME_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' };
export const EXT_MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif' };

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

/** Browsers send whatever type the file claims, so the bytes decide. */
export function sniffImage(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x89 && ascii(b, 1, 4) === 'PNG') return 'png';
  if (ascii(b, 0, 3) === 'GIF') return 'gif';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
  if (ascii(b, 4, 8) === 'ftyp' && /avi[fs]/.test(ascii(b, 8, 12))) return 'avif';
  return null;
}

/** The bytes to store and the extension to store them under; `error` when refused. */
export function acceptImage(bytes: Uint8Array, claimedExt: string): { bytes?: Uint8Array; ext?: string; error?: string } {
  if (bytes.length > MAX_BYTES) return { error: 'file too large (max 10 MB)' };
  const sniffed = sniffImage(bytes);
  if (sniffed) return { bytes, ext: sniffed };
  if (claimedExt !== 'svg') return { error: 'That file is not an image we can use.' };
  const clean = sanitizeSvgFile(new TextDecoder().decode(bytes));
  if (!clean) return { error: 'That SVG could not be read.' };
  return { bytes: new TextEncoder().encode(clean), ext: 'svg' };
}

/** The repo path of a site URL, if it is an image inside one of the given folders. */
export function imagePath(src: string, publicDir: string, roots: string[]): string | null {
  if (!src.startsWith('/') || src.includes('..') || src.includes('\\') || !IMAGE_RE.test(src)) return null;
  const path = publicDir + decodeURI(src);
  return roots.some((r) => path.startsWith(`${r}/`)) ? path : null;
}

/** Newest upload folders first: folders before files, folders descending (2026 before 2020), files alphabetically. */
export function libraryOrder(a: string, b: string): number {
  const x = a.split('/'), y = b.split('/');
  let i = 0;
  while (i < x.length - 1 && i < y.length - 1 && x[i] === y[i]) i++;
  const xDir = i < x.length - 1, yDir = i < y.length - 1;
  if (xDir !== yDir) return xDir ? -1 : 1;
  return xDir ? y[i].localeCompare(x[i]) : x[i].localeCompare(y[i]);
}
