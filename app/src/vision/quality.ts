// Photo quality checks on a small grey copy of the picture (values 0 = black … 255 = white).
// Kept separate from the browser code so it can be tested.

export interface QualityReport {
  paper: number; // brightness of the paper (most of the page)
  ink: number; // brightness of the darkest marks
  sharpness: number;
  warnings: string[];
}

function percentile(sorted: Float32Array, p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
}

export function assessGrey(grey: Float32Array, w: number, h: number): QualityReport {
  const sorted = Float32Array.from(grey).sort();
  // A page of music is mostly paper with thin dark lines, so judge contrast by how much darker
  // the darkest marks are than the paper — not by the average, which a white page makes look "grey".
  const paper = percentile(sorted, 0.9);
  const ink = percentile(sorted, 0.005);

  // Sharpness: how strong the fine edges are (variance of the Laplacian), measured only where there
  // is something on the page, so a mostly-white page is not mistaken for a blurry one.
  let lapSum = 0;
  let lapSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = grey[i - 1] + grey[i + 1] + grey[i - w] + grey[i + w] - 4 * grey[i];
      if (Math.abs(l) < 2 && grey[i] > paper - 20) continue; // plain paper
      lapSum += l;
      lapSq += l * l;
      n++;
    }
  }
  const sharpness = n > 50 ? lapSq / n - (lapSum / n) ** 2 : 0;

  const warnings: string[] = [];
  if (paper < 110) warnings.push('The photo is dark. Use even daylight or a bright lamp, without shadows on the page.');
  if (paper - ink < 90) warnings.push('The photo has low contrast (the notes are not much darker than the paper). Avoid glare and shadows, and use more light.');
  if (n > 50 && sharpness < 400) warnings.push('The photo looks blurry. Hold the phone steady, tap the screen to focus, and keep the camera straight above the page.');
  return { paper, ink, sharpness, warnings };
}
