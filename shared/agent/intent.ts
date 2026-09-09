/**
 * ADR-0038 — hybrid intent classification (Level 1, deterministic).
 *
 * Before the agentic loop starts, decide what KIND of request this is so the
 * tool set can be scoped:
 *   - `direct` — a plain editing / rewriting / translation ask that needs NO
 *     source connector at all (the loop can answer in one turn, zero retrieval).
 *   - `gated`  — a request that clearly belongs to ONE source connector; only
 *     that connector's tools are offered.
 *   - `open`   — anything else; today's behaviour (keyword domain narrowing).
 *
 * This module is the pure, instant heuristic. `electron/agent/intentClassifier.ts`
 * adds an optional one-shot LLM refinement for the `ambiguous` cases only.
 *
 * Pure — no runtime globals. Reuses `fastPath`'s verb table and `toolScoping`'s
 * domain rules rather than inventing a third keyword list.
 */
import { matchDomains } from './toolScoping.js';
import { connectorById } from './connectors.js';

export type IntentRoute =
  | { kind: 'direct' }
  | { kind: 'gated'; connectors: string[] }
  | { kind: 'open' };

export interface IntentResult {
  route: IntentRoute;
  /** True when the heuristic could not decide — the caller MAY spend one LLM call. */
  ambiguous: boolean;
  /** Connector ids the domain rules pointed at (for logging / the prompt). */
  matchedDomains: string[];
  /** Set when an LLM refinement was attempted and fell back to the heuristic. */
  degraded?: boolean;
}

export interface IntentContext {
  /** Connector ids currently enabled (merged global ∩ project). */
  connectorsOn: string[];
}

/**
 * Pure editing / linguistic verbs (superset of `fastPath`'s `TASK_HINTS` — that
 * table also gates on a resolvable chapter, which is not required to say "this
 * needs no sources"). No `\b` — it never matches an Arabic/Urdu word edge.
 */
const EDIT_VERB =
  /(اعراب|حرکات|تشکیل|harakat|tashkeel|diacritics|voweli[sz]e|املا|ہجے|spelling|spell[-\s]?check|typos?|auto[-\s]?format|فارمیٹ|clean up the formatting|paraphrase|دوبارہ لکھ|الفاظ بدل|reword|rewrite|خلاصہ|تلخیص|تلخيص|summar(?:y|ise|ize)|formali[sz]e|رسمی بنا|academic tone|shorten|مختصر کر|condense|normali[sz]e (the )?script|رسم الخط یکساں|ترجمہ کر|ترجمہ کیجیے|ترجمہ کریں|translate (this|the following|it)|make it clearer|tidy up)/i;

/**
 * A phrase that means "and also cite / research / verify / grade" — the request
 * needs the loop and its sources, so it is NOT `direct` however plain the verb.
 */
const NEEDS_SOURCE =
  /(cite|citation|footnote|حوالہ|حاشیہ|تخریج|verify|research|\bsources?\b|مراجع|مصادر|takhrij|sanad|isnad|درجہ حدیث|صحت حدیث|تحقیق کر|فتویٰ|فتوى)/i;

export function classifyIntent(instruction: string, ctx: IntentContext): IntentResult {
  const text = instruction.trim();
  if (!text) return { route: { kind: 'open' }, ambiguous: false, matchedDomains: [] };

  const domains = matchDomains(text);
  // Rules are ordered most-specific-first. Collapse connectors that share a
  // category to the FIRST (most specific) one — a hadith-grading ask fires both
  // the الدرر السنية rule and the general hadith rule, but that is ONE intent
  // (→ gate to Dorar), not two (→ ambiguous).
  const rawConnectors = [...new Set(domains.map((d) => d.connector).filter((c): c is string => Boolean(c)))];
  const categories = new Set(rawConnectors.map((c) => connectorById(c)?.category).filter(Boolean));
  const domainConnectors = categories.size <= 1 ? rawConnectors.slice(0, 1) : rawConnectors;

  // ── direct: a plain editing verb, nothing that pulls in a source ──────────
  if (EDIT_VERB.test(text) && !NEEDS_SOURCE.test(text)) {
    return { route: { kind: 'direct' }, ambiguous: false, matchedDomains: domainConnectors };
  }

  // ── gated: the ask points at exactly one connector, and it is enabled ─────
  if (domainConnectors.length === 1) {
    const target = domainConnectors[0];
    if (ctx.connectorsOn.includes(target)) {
      return { route: { kind: 'gated', connectors: [target] }, ambiguous: false, matchedDomains: domainConnectors };
    }
    // The one connector it wants is switched off — do not gate to nothing;
    // fall through to `open` so the remaining sources can still help.
    return { route: { kind: 'open' }, ambiguous: false, matchedDomains: domainConnectors };
  }

  // ── open / ambiguous ────────────────────────────────────────────────────
  // Zero connector signal, or several — the heuristic cannot pick one.
  return { route: { kind: 'open' }, ambiguous: true, matchedDomains: domainConnectors };
}

/**
 * The trust boundary for an LLM refinement (mirrors `queryPlanner.coercePlan`).
 * Never throws — a malformed / unusable response returns the heuristic result,
 * flagged `degraded`.
 */
export function coerceIntent(
  raw: unknown,
  heuristic: IntentResult,
  knownConnectorIds: string[],
): IntentResult {
  try {
    if (typeof raw !== 'object' || raw === null) return { ...heuristic, degraded: true };
    const obj = raw as { route?: unknown; connectors?: unknown };
    const kind = obj.route === 'direct' || obj.route === 'gated' || obj.route === 'open'
      ? obj.route
      : heuristic.route.kind;

    if (kind === 'gated') {
      const conns = Array.isArray(obj.connectors)
        ? [...new Set(obj.connectors.filter((c): c is string => typeof c === 'string' && knownConnectorIds.includes(c)))]
        : [];
      if (conns.length === 0) return { ...heuristic, degraded: true };
      return { route: { kind: 'gated', connectors: conns }, ambiguous: false, matchedDomains: heuristic.matchedDomains };
    }
    if (kind === 'direct') {
      return { route: { kind: 'direct' }, ambiguous: false, matchedDomains: heuristic.matchedDomains };
    }
    return { route: { kind: 'open' }, ambiguous: false, matchedDomains: heuristic.matchedDomains };
  } catch {
    return { ...heuristic, degraded: true };
  }
}

const GATE_GUIDANCE: Record<string, string> = {
  tafsir:
    "This request is Qur'anic / lexical. Use query_tafseer together with the local gold-standard search (search_corpus / search_shamela). Do NOT call the hadith connector or any poetry connector.",
  hadith:
    'This request is about hadith. Use search_hadith together with search_shamela. Do NOT call query_tafseer or a lexicon / poetry connector.',
  repositories:
    'This request is a bibliographic lookup. Use search_repositories (results are bibliographic only — never a claim citation). Do NOT fan out across the tafsir / hadith connectors.',
};

/**
 * The `── TOOL SCOPE (this request) ──` block appended to the system prompt.
 * Empty for `open` (no extra constraint beyond the standing rules).
 */
export function negativeConstraintBlock(route: IntentRoute): string {
  if (route.kind === 'direct') {
    return 'This is a plain editing / rewriting / translation request. Do NOT call any research or source connector — answer directly from the text you are given. Only reach for a tool if the scholar explicitly asks for a citation.';
  }
  if (route.kind === 'gated') {
    const lines = route.connectors.map((c) => GATE_GUIDANCE[c]).filter(Boolean);
    if (lines.length > 0) return lines.join(' ');
    return `Stay within the ${route.connectors.join(' / ')} connector for this request; do not fan out across the other source connectors.`;
  }
  return '';
}
