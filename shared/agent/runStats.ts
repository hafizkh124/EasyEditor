/**
 * M11 Phase 2 — a compact summary of what an agent run is doing, derived
 * PURELY from the progress lines the renderer already has (no IPC change, no
 * new event). Feeds the live "⚙️ ran 3 tools · read 2 sources" metrics row.
 *
 * Pure — no runtime globals.
 */

/** The minimum shape of a rendered progress line this reads. */
export interface RunStepLike {
  kind: string;
  /** `agent.step.<tool>` — the retrieval classifier keys off the suffix. */
  labelKey?: string;
  /** Set only on a failed step (the error text). */
  detail?: string;
}

export interface RunStats {
  /** Tool calls started (one `tool` event each). */
  toolsRun: number;
  /** Tool calls that came back an error (`tool-result` with a detail, or a hard `error`). */
  toolsFailed: number;
  /** Retrieval calls — searches / lookups / page reads that pull in source material. */
  sourcesRead: number;
  /** Total non-thinking step lines (what "Ran N steps" counts). */
  steps: number;
}

/** Tool-name suffixes (after `agent.step.`) that pull in source material. */
const RETRIEVAL_KEYS = new Set([
  "search_corpus", "search_shamela", "read_shamela_page", "find_shamela_book",
  "search_general", "research_topic", "search_repositories", "query_tafseer",
  "search_hadith", "grade_hadith", "lookup_narrator", "lookup_lexicon",
  "lookup_urdu_verse", "search_persian_poetry", "read_document",
  "jkhssn_narrator", "jkhssn_sanad_tree", "jkhssn_takhrij", "jkhssn_judgments",
  "jkhssn_thematic",
]);

function toolName(labelKey?: string): string | null {
  if (!labelKey || !labelKey.startsWith("agent.step.")) return null;
  return labelKey.slice("agent.step.".length);
}

export function deriveRunStats(progress: RunStepLike[]): RunStats {
  let toolsRun = 0;
  let toolsFailed = 0;
  let sourcesRead = 0;
  let steps = 0;

  for (const p of progress) {
    if (p.kind === "thinking") continue;
    steps += 1;
    if (p.kind === "tool") toolsRun += 1;
    if (p.kind === "error") toolsFailed += 1;
    if (p.kind === "tool-result") {
      if (p.detail) toolsFailed += 1;
      const name = toolName(p.labelKey);
      if (!p.detail && name && RETRIEVAL_KEYS.has(name)) sourcesRead += 1;
    }
  }

  return { toolsRun, toolsFailed, sourcesRead, steps };
}
