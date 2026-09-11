/**
 * M12 Phase B — exact rational arithmetic for the fara'id engine.
 *
 * Written from scratch (no `fraction.js` — that is the `yazinsai` repo's
 * approach and we are not copying its code, only validating against public
 * ilmsummit.org gold-set data). The mixed-numeral denominators an inheritance
 * problem produces (asl values like 24, 36, 72, 216…) stay well inside safe
 * integer range, so plain `number` numerator/denominator is enough — no
 * BigInt needed.
 *
 * Pure.
 */

export interface Rational {
  n: number; // numerator
  d: number; // denominator, always > 0
}

function gcd(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { [a, b] = [b, a % b]; }
  return a || 1;
}

export function simplify(r: Rational): Rational {
  if (r.d < 0) { r = { n: -r.n, d: -r.d }; }
  if (r.n === 0) return { n: 0, d: 1 };
  const g = gcd(r.n, r.d);
  return { n: r.n / g, d: r.d / g };
}

export function make(n: number, d: number): Rational {
  if (d === 0) throw new Error('rational: zero denominator');
  return simplify({ n, d });
}

export const ZERO: Rational = { n: 0, d: 1 };
export const ONE: Rational = { n: 1, d: 1 };

export function add(a: Rational, b: Rational): Rational {
  return simplify({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
}

export function sub(a: Rational, b: Rational): Rational {
  return simplify({ n: a.n * b.d - b.n * a.d, d: a.d * b.d });
}

export function mul(a: Rational, b: Rational): Rational {
  return simplify({ n: a.n * b.n, d: a.d * b.d });
}

export function div(a: Rational, b: Rational): Rational {
  if (b.n === 0) throw new Error('rational: division by zero');
  return simplify({ n: a.n * b.d, d: a.d * b.n });
}

export function scale(a: Rational, k: number): Rational {
  return mul(a, make(k, 1));
}

export function lcm(a: number, b: number): number {
  return Math.abs(a * b) / gcd(a, b);
}

export function lcmOfDenominators(rs: Rational[]): number {
  return rs.reduce((acc, r) => lcm(acc, r.d), 1);
}

export function compare(a: Rational, b: Rational): number {
  const diff = a.n * b.d - b.n * a.d;
  return diff > 0 ? 1 : diff < 0 ? -1 : 0;
}

export function isZero(r: Rational): boolean {
  return r.n === 0;
}

export function toNumber(r: Rational): number {
  return r.n / r.d;
}

/** "3/8" -> Rational. Used to parse the gold-set fixtures. */
export function parseFraction(s: string): Rational {
  const m = /^(-?\d+)\s*\/\s*(\d+)$/.exec(s.trim());
  if (!m) throw new Error(`not a fraction: "${s}"`);
  return make(Number(m[1]), Number(m[2]));
}

/** Rational -> "3/8" (or "0" / "1"). */
export function formatFraction(r: Rational): string {
  const s = simplify(r);
  if (s.n === 0) return '0';
  if (s.d === 1) return String(s.n);
  return `${s.n}/${s.d}`;
}
