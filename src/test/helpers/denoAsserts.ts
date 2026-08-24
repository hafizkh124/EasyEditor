// Shim for the handful of `std/testing/asserts.ts` helpers used by the tests
// that were originally written to run under `deno test`.
//
// Those three files (bilingualMap, queryPlanner, rankFusion) sat in
// supabase/functions/_shared/__tests__/ and were executed by nothing: vitest's
// `include` is `src/**`, and no workflow or npm script ever ran `deno test`.
// They are real tests of pure, relative-import-only modules, so they were moved
// here and now run on every PR. This shim exists so the move did not require
// rewriting each assertion — the bodies are unchanged from the originals.
import { expect } from "vitest";

export function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  expect(actual, msg).toEqual(expected);
}

export function assert(expr: unknown, msg?: string): asserts expr {
  expect(expr, msg).toBeTruthy();
}
