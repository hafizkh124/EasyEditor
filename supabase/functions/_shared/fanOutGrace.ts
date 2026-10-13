/**
 * Settles a retrieval fan-out without letting its slowest, optional branches
 * hold everyone else hostage.
 *
 * Live measurement (2026-10-13, docs/PHASE0-DIAGNOSIS-URDU.md): on a typical
 * query every corpus tier had finished by ~3.3s, while the live-scrape tier
 * (domain-scrape) ran for 9.3s and returned 0 rows — and the whole answer
 * waited for it. A branch flagged `optional` gets `graceMs` AFTER all the
 * non-optional branches have settled; if it is still running then, it is
 * reported as rejected and the caller carries on without it.
 *
 * Result order always matches input order, so callers can keep a parallel
 * array (tier names) indexed the same way. Never throws.
 */
export async function settleWithGrace<T>(
  promises: ReadonlyArray<PromiseLike<T>>,
  optional: ReadonlyArray<boolean>,
  graceMs: number,
): Promise<PromiseSettledResult<T>[]> {
  const tracked = promises.map((p) => Promise.resolve(p).then(
    (value): PromiseSettledResult<T> => ({ status: "fulfilled", value }),
    (reason): PromiseSettledResult<T> => ({ status: "rejected", reason }),
  ));

  const core = tracked.filter((_, i) => !optional[i]);
  await Promise.all(core);

  const late: PromiseSettledResult<T> = { status: "rejected", reason: new Error(`optional branch exceeded ${graceMs}ms grace`) };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"deadline">((resolve) => { timer = setTimeout(() => resolve("deadline"), graceMs); });

  const out: PromiseSettledResult<T>[] = [];
  const finished = new Map<number, PromiseSettledResult<T>>();
  tracked.forEach((p, i) => { void p.then((r) => finished.set(i, r)); });

  await Promise.race([Promise.all(tracked.filter((_, i) => optional[i])), deadline]);
  clearTimeout(timer);
  // Let already-resolved `.then` callbacks above run before reading `finished`.
  await Promise.resolve();

  for (let i = 0; i < tracked.length; i++) out.push(finished.get(i) ?? late);
  return out;
}
