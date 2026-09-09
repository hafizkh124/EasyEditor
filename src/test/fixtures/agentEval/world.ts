/**
 * M9 Phase B — the deterministic "world" a live-model eval scenario runs in.
 *
 * The eval swaps ONE thing for the real thing: the ModelFn (real Gemini today,
 * a real Groq / OpenRouter model in Phase C). Everything the model's tool calls
 * hit is scripted here so a metric change means a MODEL change, not a backend
 * flake. The RetrievalLedger runs for real — insert_footnote's integrity gate
 * is exactly the production one.
 */
import { RetrievalLedger, type RetrievedChunk } from '../../../../shared/agent/grounding.js';
import { getDraftMode } from '../../../../shared/ai/prompts/draftSection.js';
import type { DispatchFn } from '../../../../shared/agent/types.js';

/** A citable chunk a search_* tool can return. `match` items are matched, lowercased, as substrings of the query. */
export interface EvalChunk {
  id: string;
  reference: string;
  content: string;
  match: string[];
}

export interface EvalChapter {
  headings: string[];
  /** Literal body text — what search_corpus's project-chapters branch would return. */
  text: string;
  footnotes: number;
  wordCount: number;
}

export interface EvalWorld {
  chapters: Record<string, EvalChapter>;
  /** Returned by search_corpus (personal corpus + project chapters). */
  corpus: EvalChunk[];
  /** Returned by search_shamela. */
  shamela: EvalChunk[];
  /** Returned by grade_hadith (الدرر السنية, ADR-0040) — citable. */
  dorar?: EvalChunk[];
  /** Returned by lookup_narrator (rijāl corpus, ADR-0041) — citable. */
  rijal?: EvalChunk[];
  /** Returned by search_persian_poetry (Ganjoor, ADR-0042) — citable. */
  ganjoor?: EvalChunk[];
  /** Returned by lookup_lexicon's corpus channel (ADR-0043) — citable. */
  lexicon?: EvalChunk[];
  /** Canned answer for search_general (never citable). */
  general?: string;
  /** claim substrings the fake claim-check REJECTS — to test the model backing off. */
  unsupportedClaims?: string[];
}

export interface DispatchCall {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  /** true when the tool result carried an `error` (a refused / failed call). */
  errored: boolean;
}

export interface ScriptedDispatch {
  dispatch: DispatchFn;
  ledger: RetrievalLedger;
  calls: DispatchCall[];
}

const lc = (v: unknown): string => String(v ?? '').toLowerCase();

function matchChunks(chunks: EvalChunk[], query: string, limit: number): EvalChunk[] {
  const q = query.toLowerCase();
  const hits = chunks.filter((c) => c.match.some((m) => q.includes(m.toLowerCase())));
  // A retrieval tool that finds nothing on the exact phrasing still returns its
  // best guesses — the model should then judge relevance, as in production.
  return (hits.length ? hits : chunks).slice(0, Math.max(1, limit));
}

const asRetrieved = (c: EvalChunk): RetrievedChunk => ({ id: c.id, reference: c.reference, content: c.content });

/**
 * A DispatchFn backed by a fixed world. Covers every tool the eval scenarios
 * touch; anything else returns a benign `{ ok: true }` so a stray call does not
 * crash the run (it still shows up in `calls` for scoring).
 */
export function makeScriptedDispatch(world: EvalWorld): ScriptedDispatch {
  const ledger = new RetrievalLedger();
  const calls: DispatchCall[] = [];

  const record = (name: string, args: Record<string, unknown>, result: unknown): unknown => {
    const errored = typeof result === 'object' && result !== null && 'error' in result;
    calls.push({ name, args, result, errored });
    return result;
  };

  const dispatch: DispatchFn = async (name, args) => {
    switch (name) {
      case 'list_capabilities':
        return record(name, args, { word: true, wordVersion: '16.0', windows: true, summary: 'Word available (16.0)' });

      case 'read_document': {
        const ch = world.chapters[lc(args.chapter)] ?? world.chapters[String(args.chapter ?? '')];
        return record(name, args, ch
          ? { headings: ch.headings, footnotes: Array.from({ length: ch.footnotes }, (_v, i) => ({ text: `fn ${i + 1}` })), trackedChanges: 0, wordCount: ch.wordCount, readingOrder: 'rtl' }
          : { error: `no such chapter: ${args.chapter}` });
      }

      case 'search_corpus':
      case 'search_shamela': {
        const pool = name === 'search_corpus' ? world.corpus : world.shamela;
        const limit = typeof args.limit === 'number' ? args.limit : 8;
        const found = matchChunks(pool, String(args.query ?? ''), limit);
        ledger.add(found.map(asRetrieved));
        return record(name, args, {
          results: found.map((c) => ({ id: c.id, reference: c.reference, excerpt: c.content.slice(0, 300) })),
          count: found.length,
        });
      }

      case 'search_general': {
        // Deliberately NOT added to the ledger — never citable (production parity).
        return record(name, args, { channel: 'general', answer: world.general ?? 'General background context (not a citable source).' });
      }

      case 'query_tafseer':
      case 'search_hadith':
        return record(name, args, { chunks: [], note: 'no results in this eval world' });

      case 'grade_hadith': {
        const pool = world.dorar ?? [];
        const found = matchChunks(pool, String(args.text ?? ''), 5);
        if (pool.length === 0) return record(name, args, { count: 0, note: 'no gradings in this eval world' });
        ledger.add(found.map(asRetrieved));
        return record(name, args, {
          count: found.length,
          results: found.map((c) => ({ id: c.id, reference: c.reference, excerpt: c.content.slice(0, 300) })),
        });
      }

      case 'lookup_narrator': {
        const pool = world.rijal ?? [];
        const found = matchChunks(pool, String(args.name ?? ''), 5);
        if (pool.length === 0) return record(name, args, { count: 0, note: 'no rijāl entries in this eval world' });
        ledger.add(found.map(asRetrieved));
        return record(name, args, {
          count: found.length,
          answer: 'The narrator is discussed in the rijāl works.',
          results: found.map((c) => ({ id: c.id, reference: c.reference })),
        });
      }

      case 'search_persian_poetry': {
        const pool = world.ganjoor ?? [];
        const found = matchChunks(pool, String(args.query ?? ''), 5);
        if (pool.length === 0) return record(name, args, { count: 0, note: 'no Persian verses in this eval world' });
        ledger.add(found.map(asRetrieved));
        return record(name, args, {
          count: found.length,
          results: found.map((c) => ({ id: c.id, reference: c.reference, excerpt: c.content.slice(0, 200) })),
        });
      }

      case 'scan_urdu_prosody':
        // Pure compute — no world data; just echo a heuristic-shaped result.
        return record(name, args, {
          note: 'Machine reading — verify.',
          lines: [{ line: String(args.text ?? ''), pattern: '= − = =', feet: [], bahr: null, confidence: 'low' }],
        });

      case 'lookup_urdu_verse':
        return record(name, args, { count: 0, note: 'no Urdu verse corpus in this eval world' });

      case 'lookup_lexicon': {
        const pool = world.lexicon ?? [];
        const found = matchChunks(pool, String(args.word ?? ''), 5);
        const almaanyUrl = `https://www.almaany.com/ur/dict/ar-ur/${encodeURIComponent(String(args.word ?? ''))}/`;
        if (pool.length) ledger.add(found.map(asRetrieved));
        return record(name, args, {
          count: pool.length ? found.length : 0,
          almaanyUrl,
          note: `Verify at al-Maany: ${almaanyUrl}`,
          results: found.map((c) => ({ id: c.id, reference: c.reference })),
        });
      }

      case 'insert_footnote': {
        try {
          const chunk = ledger.resolveOrThrow(args.source_id);
          const claim = typeof args.claim === 'string' ? args.claim : '';
          if (claim && (world.unsupportedClaims ?? []).some((u) => claim.includes(u))) {
            return record(name, args, { error: 'insert_footnote: the source does not support this claim' });
          }
          return record(name, args, { chapter: args.chapter, marker: args.marker, applied: 1, reference: chunk.reference });
        } catch (err) {
          return record(name, args, { error: (err as Error).message });
        }
      }

      case 'draft_section': {
        const spec = getDraftMode(String(args.mode ?? ''));
        if (!spec) return record(name, args, { error: `unknown draft mode "${args.mode}"` });
        const ids = Array.isArray(args.source_ids) ? args.source_ids.filter((s): s is string => typeof s === 'string') : [];
        if (spec.grounded && ids.length === 0) {
          return record(name, args, { error: `draft_section mode "${args.mode}" needs sources — call search_corpus / search_shamela first` });
        }
        for (const id of ids) {
          try { ledger.resolveOrThrow(id); } catch (err) { return record(name, args, { error: (err as Error).message }); }
        }
        return record(name, args, { chapter: args.chapter, mode: args.mode, revisions: 3, grounded: spec.grounded, sourcesUsed: ids.length });
      }

      case 'run_task':
        return record(name, args, { chapter: args.chapter, task: args.task, revisions: 3, changed: true });

      case 'set_page_layout':
      case 'add_document_comment':
      case 'typeset_print_ready':
      case 'build_scholarly_indexes':
      case 'convert_document':
        return record(name, args, { ok: true, chapter: args.chapter });

      case 'check_consistency':
        return record(name, args, { term: args.term, occurrences: [] });

      default:
        return record(name, args, { ok: true });
    }
  };

  return { dispatch, ledger, calls };
}
