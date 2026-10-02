// Exact fractions for musical time. A whole note = 1, a quarter = 1/4,
// a triplet eighth = 1/12. Using fractions (not decimals) means bars always
// add up exactly, with no rounding errors.

export interface Frac {
  readonly n: number; // numerator
  readonly d: number; // denominator (always > 0)
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

export function frac(n: number, d = 1): Frac {
  if (d === 0) throw new Error('Fraction with zero denominator');
  if (d < 0) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

export const ZERO = frac(0);

export const add = (a: Frac, b: Frac) => frac(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Frac, b: Frac) => frac(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Frac, b: Frac) => frac(a.n * b.n, a.d * b.d);
export const div = (a: Frac, b: Frac) => frac(a.n * b.d, a.d * b.n);
export const cmp = (a: Frac, b: Frac) => a.n * b.d - b.n * a.d;
export const eq = (a: Frac, b: Frac) => cmp(a, b) === 0;
export const lt = (a: Frac, b: Frac) => cmp(a, b) < 0;
export const lte = (a: Frac, b: Frac) => cmp(a, b) <= 0;
export const gt = (a: Frac, b: Frac) => cmp(a, b) > 0;
export const isZero = (a: Frac) => a.n === 0;
export const toNumber = (a: Frac) => a.n / a.d;
export const fracToString = (a: Frac) => (a.d === 1 ? `${a.n}` : `${a.n}/${a.d}`);
export const sum = (xs: Frac[]) => xs.reduce(add, ZERO);
