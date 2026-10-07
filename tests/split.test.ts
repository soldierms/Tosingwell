// Cutting tall pictures into pages and halves, on simple made-up pictures (0 = black, 255 = white).
import { describe, expect, it } from 'vitest';
import { planCuts } from '../app/src/vision/split';

const W = 300;

/**
 * A page of "systems": each system is two 5-line staves joined by a line down the left side
 * (like a real choir score), with lyrics between the staves. Returns the picture and where
 * each system starts and ends.
 */
function page(h: number, systems: number, opts: { border?: boolean; noise?: boolean } = {}) {
  const g = new Uint8Array(W * h).fill(250);
  const spans: [number, number][] = [];
  const top = 30;
  const each = (h - top - 10) / systems;
  for (let s = 0; s < systems; s++) {
    const y0 = Math.round(top + s * each);
    const y1 = Math.round(y0 + each * 0.7);
    spans.push([y0, y1]);
    for (const staff of [y0, y1 - 20]) for (let l = 0; l < 5; l++) for (let x = 20; x < W - 20; x++) g[(staff + l * 5) * W + x] = 20;
    for (let y = y0; y < y1; y++) g[y * W + 20] = 20; // system line on the left
    for (let x = 40; x < W - 40; x += 9) g[(y0 + 35) * W + x] = 20; // lyrics between the staves
  }
  if (opts.border) for (let y = 0; y < h; y++) for (let x = W - 4; x < W; x++) g[y * W + x] = 0;
  if (opts.noise) for (let i = 0; i < g.length; i += 37) g[i] = 30; // shadows/grain all over a phone photo
  return { g, spans };
}

const between = (cut: number, spans: [number, number][]) => spans.every(([a, b]) => cut < a || cut > b);

describe('cutting pictures into pages and halves', () => {
  it('leaves a normal page whole unless halves are asked for', () => {
    const { g } = page(420, 4);
    expect(planCuts(g, W, 420, false)).toEqual([]);
  });

  it('cuts a page in half between two lines of music, never inside one', () => {
    const { g, spans } = page(420, 4);
    const cuts = planCuts(g, W, 420, true);
    expect(cuts).toHaveLength(1);
    expect(between(cuts[0], spans)).toBe(true);
    expect(cuts[0]).toBeGreaterThan(spans[1][1]);
    expect(cuts[0]).toBeLessThan(spans[2][0]);
  });

  it('cuts two stacked screenshot pages at the dark band between them, despite a black edge', () => {
    const a = page(400, 4, { border: true });
    const b = page(400, 4, { border: true });
    const band = new Uint8Array(W * 12).fill(0);
    const g = new Uint8Array([...a.g, ...band, ...b.g]);
    const h = 812;
    const pages = planCuts(g, W, h, false);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toBeGreaterThanOrEqual(400);
    expect(pages[0]).toBeLessThan(412);

    const spans = [...a.spans, ...b.spans.map(([x, y]) => [x + 412, y + 412] as [number, number])];
    const all = planCuts(g, W, h, true);
    expect(all).toHaveLength(3);
    expect(all.every((c) => between(c, spans))).toBe(true);
  });

  it('does not cut a photo with no clean blank strips', () => {
    const { g } = page(420, 4, { noise: true });
    expect(planCuts(g, W, 420, true)).toEqual([]);
  });
});
