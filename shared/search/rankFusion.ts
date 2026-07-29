export const RRF_K = 60;

export interface FusableDoc {
  match_key: string;
  [k: string]: unknown;
}

export interface FusedDoc<T extends FusableDoc = FusableDoc> {
  doc: T;
  score: number;
  channels: string[];
}

export function reciprocalRankFusion<T extends FusableDoc>(
  channels: Array<{ name: string; docs: T[] }>,
  k: number = RRF_K,
): Array<FusedDoc<T>> {
  const merged = new Map<string, FusedDoc<T>>();

  for (const channel of channels) {
    if (!channel?.docs?.length) continue;

    let rank = 0;
    const seenInChannel = new Set<string>();

    for (const doc of channel.docs) {
      const key = doc?.match_key;
      if (!key) continue;
      if (seenInChannel.has(key)) continue;
      seenInChannel.add(key);

      rank += 1;
      const contribution = 1 / (k + rank);

      const existing = merged.get(key);
      if (existing) {
        existing.score += contribution;
        existing.channels.push(channel.name);
      } else {
        merged.set(key, { doc, score: contribution, channels: [channel.name] });
      }
    }
  }

  return [...merged.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.doc.match_key.localeCompare(b.doc.match_key);
  });
}

export function buildMatchKey(row: Record<string, unknown>): string | null {
  const cite = (row?.citation_ref as Record<string, unknown>) ?? {};
  const sourceType = row?.source_type as string;

  if (sourceType === "quran") {
    const surah = cite.surah_number ?? cite.surah;
    const verse = cite.verse;
    if (surah == null || verse == null) return null;
    return `quran:${surah}:${verse}`;
  }

  if (sourceType === "hadith") {
    const book = cite.collection ?? cite.book;
    const number = cite.hadith_number;
    if (!book || number == null) return null;
    return `hadith:${book}:${number}`;
  }

  if (typeof row?.passage_key === "string" && row.passage_key) {
    return row.passage_key as string;
  }
  const bookId = cite.book_id ?? cite.openiti_id ?? cite.shamela_id;
  if (bookId != null && (cite.page != null || cite.volume != null)) {
    return `${sourceType}:${bookId}:${cite.volume ?? 0}:${cite.page ?? 0}`;
  }
  if (row?.id != null) return `doc:${row.id}`;

  return null;
}
