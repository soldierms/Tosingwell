// Where to cut a tall picture (several pages stacked, or one page we want in halves) so each
// piece gets the reader's full attention. Readers see each picture at a fixed level of detail,
// so smaller pieces mean bigger notes. Cuts are only made in clear strips — blank paper right
// across the picture, or a solid dark band (the gap between two screenshotted pages) — never
// through a line of music. Kept separate from the browser code so it can be tested.

/** A picture taller than this (height ÷ width) holds more than one page. */
export const TALL = 1.6;
/** About how tall one page is (A4 / Letter ≈ 1.3–1.41). */
const PAGE = 1.45;

type Grey = Uint8Array | Uint8ClampedArray | Float32Array;

/**
 * Rows where to cut a picture: first into pages (if it is taller than one page), then each page
 * into halves when `halves` is on (unless the halves would be very flat strips). Pieces that
 * have no clear strip near the middle are left whole.
 */
export function planCuts(grey: Grey, w: number, h: number, halves: boolean): number[] {
  const aspect = h / w;
  const pages = aspect > TALL ? Math.min(12, Math.ceil(aspect / PAGE)) : 1;
  const pageCuts = findCuts(grey, w, h, pages);
  if (!halves) return pageCuts;
  const cuts: number[] = [];
  const edges = [0, ...pageCuts, h];
  for (let i = 0; i < edges.length - 1; i++) {
    const [y0, y1] = [edges[i], edges[i + 1]];
    if (i > 0) cuts.push(y0);
    if ((y1 - y0) / w / 2 < 0.3) continue;
    for (const c of findCuts(grey.subarray(y0 * w, y1 * w), w, y1 - y0, 2)) cuts.push(y0 + c);
  }
  return cuts;
}

/**
 * Rows (in this grey picture's pixels) where to cut it into about `n` pieces; fewer if there is
 * no clear strip near a planned cut. grey: 0 = black … 255 = white, row by row.
 */
export function findCuts(grey: Grey, w: number, h: number, n: number): number[] {
  if (n < 2) return [];
  // Paper brightness, and how dark a pixel must be to count as ink.
  const sample: number[] = [];
  for (let i = 0; i < grey.length; i += 7) sample.push(grey[i]);
  sample.sort((a, b) => a - b);
  const paper = sample[Math.floor(sample.length * 0.9)];
  const inkBelow = paper * 0.6;

  // Columns that are dark almost all the way down are a border (screenshots often have a black
  // edge), not music: leave them out, or no row would ever look blank.
  const use: number[] = [];
  for (let x = 0; x < w; x++) {
    let dark = 0;
    for (let y = 0; y < h; y++) if (grey[y * w + x] < inkBelow) dark++;
    if (dark < h * 0.6) use.push(x);
  }
  if (use.length < w * 0.5) return [];

  // Each row: blank (no ink at all, or 1 speck), band (dark right across), or neither.
  const kind: ('blank' | 'band' | null)[] = [];
  const allowed = Math.max(1, Math.floor(use.length * 0.002));
  for (let y = 0; y < h; y++) {
    let ink = 0;
    for (const x of use) if (grey[y * w + x] < inkBelow) ink++;
    kind.push(ink <= allowed ? 'blank' : ink >= use.length * 0.97 ? 'band' : null);
  }

  // Runs of clear rows (blank and band rows together: a page gap has white around a dark band).
  const runs: { from: number; to: number; band?: number }[] = [];
  for (let y = 0; y < h; y++) {
    if (!kind[y]) continue;
    const from = y;
    const band: number[] = [];
    for (; y < h && kind[y]; y++) if (kind[y] === 'band') band.push(y);
    runs.push({ from, to: y, band: band.length ? Math.round((band[0] + band[band.length - 1]) / 2) : undefined });
  }

  const piece = h / n;
  const minRun = Math.max(3, Math.round(h * 0.006));
  const cuts: number[] = [];
  for (let k = 1; k < n; k++) {
    const want = k * piece;
    let best: { at: number; score: number } | undefined;
    for (const r of runs) {
      // Ignore blank edges at the top/bottom of the picture.
      if (r.from <= 0 || r.to >= h) continue;
      const len = r.to - r.from;
      const at = r.band ?? Math.round((r.from + r.to) / 2);
      if (len < minRun || Math.abs(at - want) > piece * 0.3) continue;
      // Longest strip wins (gaps between systems are wider than gaps inside one); a page band beats all.
      const score = (r.band !== undefined ? 1000 : 0) + len - Math.abs(at - want) / piece;
      if (!best || score > best.score) best = { at, score };
    }
    if (best && (!cuts.length || best.at - cuts[cuts.length - 1] > piece * 0.4)) cuts.push(best.at);
  }
  return cuts;
}
