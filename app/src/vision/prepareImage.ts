// Gets a photo ready to send: turns it the right way up, shrinks it to the
// size Claude reads best (at most 2576 px on the long edge), converts it to
// JPEG, and checks the quality first (dark, low contrast, blurry, too small)
// so you can retake a bad photo before paying for a reading.

import { assessGrey } from './quality';
import { planCuts } from './split';

export interface PreparedImage {
  base64: string;
  mediaType: 'image/jpeg';
  url: string; // for showing it in the review screen
  width: number;
  height: number;
  warnings: string[];
}

const MAX_EDGE = 2576;

export async function prepareImage(file: File): Promise<PreparedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This picture could not be opened. Please use a JPEG or PNG photo (on iPhone, set Camera → Formats → “Most Compatible”).');
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const warnings = checkQuality(ctx, width, height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not prepare the image.'))), 'image/jpeg', 0.9),
  );
  const base64 = await new Promise<string>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.readAsDataURL(blob);
  });
  return { base64, mediaType: 'image/jpeg', url: URL.createObjectURL(blob), width, height, warnings };
}

/**
 * Cuts a tall picture (several pages stacked) into pages, and each page into halves when
 * `halves` is on, at blank strips between lines of music (see split.ts). Readers look at every
 * picture with the same amount of detail, so smaller pieces mean bigger, clearer notes.
 * Returns the picture unchanged when there is nowhere safe to cut.
 */
export async function splitPicture(file: File, halves: boolean): Promise<File[]> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return [file]; // prepareImage gives the proper message
  }
  try {
    const sw = Math.min(600, bitmap.width);
    const sh = Math.max(1, Math.round((bitmap.height / bitmap.width) * sw));
    const c = document.createElement('canvas');
    c.width = sw;
    c.height = sh;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, sw, sh);
    g.drawImage(bitmap, 0, 0, sw, sh);
    const px = g.getImageData(0, 0, sw, sh).data;
    const grey = new Uint8Array(sw * sh);
    for (let i = 0; i < grey.length; i++) grey[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    const cuts = planCuts(grey, sw, sh, halves);
    if (!cuts.length) return [file];

    const scale = bitmap.height / sh;
    const edges = [0, ...cuts.map((y) => Math.round(y * scale)), bitmap.height];
    const base = file.name.replace(/\.[^.]+$/, '');
    const out: File[] = [];
    for (let i = 0; i < edges.length - 1; i++) {
      const piece = document.createElement('canvas');
      piece.width = bitmap.width;
      piece.height = edges[i + 1] - edges[i];
      const pc = piece.getContext('2d')!;
      pc.fillStyle = '#fff';
      pc.fillRect(0, 0, piece.width, piece.height);
      pc.drawImage(bitmap, 0, -edges[i]);
      const blob = await new Promise<Blob>((resolve, reject) =>
        piece.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not cut the picture.'))), 'image/jpeg', 0.92),
      );
      out.push(new File([blob], `${base} — part ${i + 1} of ${edges.length - 1}.jpg`, { type: 'image/jpeg' }));
    }
    return out;
  } finally {
    bitmap.close();
  }
}

/** Simple quality checks on a small grey copy of the picture. */
function checkQuality(src: CanvasRenderingContext2D, w: number, h: number): string[] {
  const warnings: string[] = [];
  if (Math.max(w, h) < 1200) warnings.push('The picture is small (low resolution). Move closer, or use the camera instead of a screenshot or thumbnail.');

  const sw = 400;
  const sh = Math.max(1, Math.round((h / w) * sw));
  const c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(src.canvas, 0, 0, sw, sh);
  const px = g.getImageData(0, 0, sw, sh).data;
  const grey = new Float32Array(sw * sh);
  for (let i = 0; i < grey.length; i++) grey[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  warnings.push(...assessGrey(grey, sw, sh).warnings);
  return warnings;
}

/** Tips shown before taking a photo. */
export const PHOTO_TIPS = [
  'Lay the page flat (press the book open, or use one loose page).',
  'Use even light — daylight near a window is best. No shadows from your phone or hand, no glare.',
  'Hold the camera straight above the page, not at an angle.',
  'Fit the whole page (all edges) in the picture, filling as much of it as you can.',
  'One page at a time. Tap to focus and hold still.',
];
