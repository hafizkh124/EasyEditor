/**
 * Plan §5.5 — a word-level diff for the matn-comparison artifact.
 *
 * An LCS diff over whitespace-delimited tokens. Arabic-aware only in that the
 * caller can pass `ignoreHarakat` so two matns that differ solely in tashkīl
 * read as equal. Small and dependency-free (the plan's `diff` dep is optional
 * and not installed).
 */
import { stripHarakat } from "@/utils/arabicUtils";

export type DiffOp = "equal" | "insert" | "delete";

export interface DiffToken {
  op: DiffOp;
  /** The surface token (with harakat, as written). */
  text: string;
}

const TOKEN_RE = /\s+/;

/** Tokenise on whitespace, keeping non-empty tokens. */
export function tokenize(s: string): string[] {
  return s.trim().split(TOKEN_RE).filter(Boolean);
}

/**
 * Diff `a` → `b` at the token level. `insert` = present in `b` not `a`
 * (green); `delete` = present in `a` not `b` (red-strike).
 */
export function wordDiff(a: string, b: string, opts: { ignoreHarakat?: boolean } = {}): DiffToken[] {
  const aTok = tokenize(a);
  const bTok = tokenize(b);
  const key = (t: string) => (opts.ignoreHarakat ? stripHarakat(t) : t);
  const aKey = aTok.map(key);
  const bKey = bTok.map(key);

  // LCS table (classic DP). Token counts here are matn-sized (tens–hundreds),
  // so the O(n·m) table is fine.
  const n = aKey.length;
  const m = bKey.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = aKey[i] === bKey[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aKey[i] === bKey[j]) {
      out.push({ op: "equal", text: bTok[j] });
      i++; j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ op: "delete", text: aTok[i] });
      i++;
    } else {
      out.push({ op: "insert", text: bTok[j] });
      j++;
    }
  }
  while (i < n) out.push({ op: "delete", text: aTok[i++] });
  while (j < m) out.push({ op: "insert", text: bTok[j++] });
  return out;
}

/** Collapse a token diff into runs of the same op — for a compact render. */
export function diffRuns(tokens: DiffToken[]): DiffToken[] {
  const runs: DiffToken[] = [];
  for (const tok of tokens) {
    const last = runs[runs.length - 1];
    if (last && last.op === tok.op) last.text += " " + tok.text;
    else runs.push({ ...tok });
  }
  return runs;
}
