// Photo quality checks, on simple made-up pictures (0 = black, 255 = white).
import { describe, expect, it } from 'vitest';
import { assessGrey } from '../app/src/vision/quality';

const W = 200, H = 260;
/** A white page with thin dark "staff lines" and "notes". */
function page(paper = 250, ink = 30): Float32Array {
  const g = new Float32Array(W * H).fill(paper);
  for (let y = 20; y < H; y += 12) for (let x = 10; x < W - 10; x++) g[y * W + x] = ink;
  for (let k = 0; k < 120; k++) {
    const cx = 15 + ((k * 37) % (W - 30)), cy = 18 + ((k * 53) % (H - 30));
    for (let dy = -2; dy <= 2; dy++) for (let dx = -3; dx <= 3; dx++) g[(cy + dy) * W + cx + dx] = ink;
  }
  return g;
}
function blur(g: Float32Array, r = 3): Float32Array {
  const out = new Float32Array(g.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < H && xx >= 0 && xx < W) { s += g[yy * W + xx]; n++; }
    }
    out[y * W + x] = s / n;
  }
  return out;
}

describe('photo quality checks', () => {
  it('does not complain about a clean printed page (mostly white paper)', () => {
    expect(assessGrey(page(), W, H).warnings).toEqual([]);
  });
  it('warns about a washed-out page', () => {
    expect(assessGrey(page(235, 190), W, H).warnings.join()).toContain('low contrast');
  });
  it('warns about a dark photo', () => {
    expect(assessGrey(page(90, 20), W, H).warnings.join()).toContain('dark');
  });
  it('warns about a blurry photo', () => {
    expect(assessGrey(blur(page(), 5), W, H).warnings.join()).toContain('blurry');
  });
});
