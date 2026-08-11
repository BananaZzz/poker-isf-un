'use client';

/**
 * Resize an image File to a square target size, cropped-to-fill, encoded as WebP.
 * Runs entirely in the browser using an OffscreenCanvas fallback to <canvas>.
 * Returns a Blob typed image/webp (or the fallback the browser used).
 *
 * No native deps, no server-side sharp/libvips required.
 */
export async function resizeToSquareWebp(file: File, size = 512, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const srcW = bitmap.width;
  const srcH = bitmap.height;
  // center-crop to square
  const s = Math.min(srcW, srcH);
  const sx = Math.floor((srcW - s) / 2);
  const sy = Math.floor((srcH - s) / 2);

  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(size, size)
      : Object.assign(document.createElement('canvas'), { width: size, height: size });
  const ctx = (canvas as any).getContext('2d') as CanvasRenderingContext2D;
  ctx.drawImage(bitmap, sx, sy, s, s, 0, 0, size, size);
  bitmap.close?.();

  if ('convertToBlob' in canvas) {
    return await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/webp', quality });
  }
  return await new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob failed'))),
      'image/webp',
      quality
    );
  });
}
