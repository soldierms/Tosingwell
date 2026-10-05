// Gets a photo ready to send: turns it the right way up, shrinks it to the
// size Claude reads best (at most 2576 px on the long edge), converts it to
// JPEG, and checks the quality first (dark, low contrast, blurry, too small)
// so you can retake a bad photo before paying for a reading.

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
  let sum = 0;
  for (let i = 0; i < grey.length; i++) {
    grey[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    sum += grey[i];
  }
  const mean = sum / grey.length;
  let varSum = 0;
  for (const v of grey) varSum += (v - mean) ** 2;
  const contrast = Math.sqrt(varSum / grey.length);
  // Sharpness: how strong the fine edges are (variance of the Laplacian).
  let lapSum = 0;
  let lapSq = 0;
  let n = 0;
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const i = y * sw + x;
      const l = grey[i - 1] + grey[i + 1] + grey[i - sw] + grey[i + sw] - 4 * grey[i];
      lapSum += l;
      lapSq += l * l;
      n++;
    }
  }
  const sharpness = lapSq / n - (lapSum / n) ** 2;

  if (mean < 90) warnings.push('The photo is dark. Use even daylight or a bright lamp, without shadows on the page.');
  if (contrast < 35) warnings.push('The photo has low contrast (washed out or grey). Avoid glare and make sure the page fills the picture.');
  if (sharpness < 60) warnings.push('The photo looks blurry. Hold the phone steady, tap the screen to focus, and keep the camera straight above the page.');
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
