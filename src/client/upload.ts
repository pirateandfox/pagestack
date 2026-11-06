// Uploading an image from the browser. Large photos are scaled down here, so the server needs no
// image library and a phone photo doesn't land in the repo at full size.
const MAX_EDGE = 2400;

export async function shrink(file: File, max = MAX_EDGE): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file; // GIF would lose its animation, SVG has no size
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = max / Math.max(bitmap.width, bitmap.height);
  if (scale >= 1) { bitmap.close(); return file; }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, file.type, 0.85));
  return blob && blob.size < file.size ? new File([blob], file.name, { type: file.type }) : file;
}

export async function uploadImage(file: File): Promise<{ src?: string; error?: string }> {
  const fd = new FormData();
  fd.append('file', await shrink(file));
  const res = await fetch('/api/editor/images', { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  return res.ok ? { src: data.src } : { error: data.error || 'upload failed' };
}
