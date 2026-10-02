// Note lengths: whole note down to 32nd, with dots, and how to write any
// length as one or more (tied) note symbols.

import { add, eq, frac, gt, lte, mul, sub, type Frac } from '../model/fraction';

export type BaseValue = 1 | 2 | 4 | 8 | 16 | 32; // whole, half, quarter, eighth, 16th, 32nd

export interface Notated {
  base: BaseValue;
  dots: 0 | 1 | 2;
}

/** Letters used in typed staff input: w h q e s t. */
export const VALUE_LETTER: Record<BaseValue, string> = { 1: 'w', 2: 'h', 4: 'q', 8: 'e', 16: 's', 32: 't' };
export const LETTER_VALUE: Record<string, BaseValue> = { w: 1, h: 2, q: 4, e: 8, s: 16, t: 32 };
export const VALUE_NAME: Record<BaseValue, string> = {
  1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: '16th', 32: '32nd',
};

/** Length of a note symbol: a dotted quarter = 3/8. */
export function notatedLength(n: Notated): Frac {
  const base = frac(1, n.base);
  if (n.dots === 0) return base;
  if (n.dots === 1) return mul(base, frac(3, 2));
  return mul(base, frac(7, 4));
}

const ALL: Notated[] = [];
for (const base of [1, 2, 4, 8, 16, 32] as BaseValue[]) {
  for (const dots of [2, 1, 0] as const) ALL.push({ base, dots });
}
ALL.sort((a, b) => (gt(notatedLength(a), notatedLength(b)) ? -1 : 1));

/** If this length is exactly one note symbol, return it. */
export function singleNotation(len: Frac): Notated | undefined {
  return ALL.find((n) => eq(notatedLength(n), len));
}

/**
 * Write a length as note symbols to be tied together, longest first.
 * Prefers plain and single-dotted notes (double dots only when exact).
 * Returns undefined if the length can't be written (smaller than a 32nd).
 */
export function notate(len: Frac): Notated[] | undefined {
  const single = singleNotation(len);
  if (single) return [single];
  const out: Notated[] = [];
  let rest = len;
  let guard = 0;
  while (gt(rest, frac(0)) && guard++ < 20) {
    const pick = ALL.find((n) => n.dots < 2 && lte(notatedLength(n), rest));
    if (!pick) return undefined;
    out.push(pick);
    rest = sub(rest, notatedLength(pick));
  }
  return eq(rest, frac(0)) ? out : undefined;
}

export const totalLength = (ns: Notated[]) => ns.reduce((a, n) => add(a, notatedLength(n)), frac(0));
