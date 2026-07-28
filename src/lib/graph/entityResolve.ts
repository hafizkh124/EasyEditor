import { stripHarakat } from "@/utils/arabicUtils";
import type { Entity } from "./graphService";

/**
 * Suggesting — never performing — entity merges (SPEC-M4 FR-3.3).
 *
 * «ابن تیمیہ» and «ابن تیمیۃ» are the same scholar; «ابن حجر العسقلاني» and
 * «ابن حجر الہیتمی» are two different ones. No normalisation can tell those
 * cases apart reliably, and a wrong merge silently attributes one scholar's
 * position to another — the kind of error this whole milestone exists to
 * prevent. So this module only ever proposes; the merge is the user's click.
 */

/** Strip diacritics and the orthographic variants Urdu/Arabic differ on. */
export function normalizeEntityName(name: string): string {
  return stripHarakat(name ?? "")
    // ZWNJ / ZWJ / Arabic letter mark: invisible, never meaningful in a name.
    // Alternation rather than a character class — a ZWJ inside a class is
    // exactly what `no-misleading-character-class` exists to catch.
    .replace(/\u200C|\u200D|\u061C/g, "")
    .replace(/[أإآاٱ]/g, "ا")
    // Arabic teh marbuta (ة U+0629) and its Urdu goal form (ۃ U+06C3), plus
    // Arabic heh (ه) and heh-goal/doachashmee (ہ ھ) all collapse: «ابن تیمیہ»
    // and «ابن تیمیۃ» differ only here.
    .replace(/[ةۃهھہ]/g, "ہ")
    .replace(/[يیىئ]/g, "ی")
    .replace(/[كک]/g, "ک")
    .replace(/[ؤو]/g, "و")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface DuplicateSuggestion {
  /** The two entities that look like one, newest first. */
  entities: [Entity, Entity];
  /** Why they were paired — shown to the user so the call is theirs to make. */
  reason: "same-normalized-name" | "alias-match";
}

/**
 * Pair up entities of the same kind that normalise to the same name, or where
 * one lists the other as an alias. Nothing else: fuzzy distance matching
 * produces confident-looking pairs of genuinely different scholars.
 */
export function findDuplicateSuggestions(entities: Entity[]): DuplicateSuggestion[] {
  const suggestions: DuplicateSuggestion[] = [];
  const byKey = new Map<string, Entity[]>();

  for (const entity of entities) {
    const key = `${entity.kind}::${normalizeEntityName(entity.canonical_name)}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(entity);
    else byKey.set(key, [entity]);
  }

  for (const bucket of byKey.values()) {
    for (let i = 1; i < bucket.length; i++) {
      suggestions.push({ entities: [bucket[0], bucket[i]], reason: "same-normalized-name" });
    }
  }

  // Alias overlap: one record already knows the other's name under a different
  // spelling, which is a stronger signal than the names themselves matching.
  const seen = new Set(suggestions.map((s) => pairKey(s.entities[0].id, s.entities[1].id)));
  for (const a of entities) {
    const aliasSet = new Set((a.aliases ?? []).map(normalizeEntityName).filter(Boolean));
    if (aliasSet.size === 0) continue;

    for (const b of entities) {
      if (a.id === b.id || a.kind !== b.kind) continue;
      if (!aliasSet.has(normalizeEntityName(b.canonical_name))) continue;

      const key = pairKey(a.id, b.id);
      if (seen.has(key)) continue;
      seen.add(key);
      suggestions.push({ entities: [a, b], reason: "alias-match" });
    }
  }

  return suggestions;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("::");
}

/**
 * The record a merge would produce: the kept entity gains the other's names as
 * aliases. Nothing is discarded, so an incorrect merge can be reversed by
 * promoting an alias back into its own entity.
 */
export function buildMergedAliases(keep: Entity, absorb: Entity): string[] {
  const merged = new Set<string>([
    ...(keep.aliases ?? []),
    ...(absorb.aliases ?? []),
    absorb.canonical_name,
  ]);
  merged.delete(keep.canonical_name);
  return [...merged].filter((a) => a && a.trim().length > 0);
}
