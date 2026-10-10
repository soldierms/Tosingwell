// Turns each page of a PDF into a picture, so a scanned score (often several
// pages for one song) can be read page by page. Runs in the browser with
// Mozilla's pdf.js; loaded only when a PDF is chosen.

import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Start pdf.js's helper worker ourselves (more reliable with bundled apps than letting pdf.js do it).
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
pdfjs.GlobalWorkerOptions.workerPort = new Worker(workerUrl, { type: 'module' });

/** Long edge of each page picture, in pixels (what the readers see best). */
const LONG_EDGE = 2576;
export const MAX_PDF_PAGES = 40;

export async function pdfToImages(file: File, onProgress?: (done: number, total: number) => void, longEdge = LONG_EDGE): Promise<File[]> {
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  let doc;
  try {
    doc = await task.promise;
  } catch {
    throw new Error(`“${file.name}” could not be opened as a PDF.`);
  }
  if (doc.numPages > MAX_PDF_PAGES) throw new Error(`This PDF has ${doc.numPages} pages; the most that can be read at once is ${MAX_PDF_PAGES}.`);
  const base = file.name.replace(/\.pdf$/i, '');
  const out: File[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const v1 = page.getViewport({ scale: 1 });
    const scale = longEdge / Math.max(v1.width, v1.height);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // intent 'print' draws in one go (the screen-paced mode stalls when the tab is in the background).
    await page.render({ canvas, canvasContext: ctx, viewport, intent: 'print' }).promise;
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not turn a PDF page into a picture.'))), 'image/jpeg', 0.92),
    );
    out.push(new File([blob], `${base} — page ${i}.jpg`, { type: 'image/jpeg' }));
    onProgress?.(i, doc.numPages);
  }
  await task.destroy();
  return out;
}
