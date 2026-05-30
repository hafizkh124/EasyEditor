import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRateLimited, rateLimitResponse } from "../_shared/rateLimit.ts";
import { calculateCost, checkAndDeductTokens, refundTokens, insufficientTokensResponse } from "../_shared/tokenGuard.ts";
import {
  NORMAL_SYSTEM_PROMPT,
  STRICT_INSTRUCTION_ON,
  STRICT_INSTRUCTION_OFF,
  SPELLING_SYSTEM_PROMPT,
  CITATIONS_SYSTEM_PROMPT,
  CITATIONS_CONSTRAINED_PROMPT,
  COMBINED_SYSTEM_PROMPT,
  pickPromptKey,
  type ResearchAssistMode,
} from "../_shared/researchPrompts.ts";
import { segmentClaims } from "../_shared/segmentClaims.ts";
import { findCitationCandidates, type CitationCandidate } from "../_shared/citationCandidates.ts";
import { verifyAll } from "../_shared/citationVerifier.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SOURCE_CHAR_LIMIT = 20_000;

// Context-aware scraping whitelist. Islamic & General research modes are
// restricted to these trusted scholarly domains. Custom Sources mode bypasses
// this gate (the user takes responsibility).
const SCRAPING_WHITELIST = [
  "alulama.org",
  "magazine.mohaddis.com",
  "mohaddis.org",
  "urdufatwa.com",
  "islamfort.com",
  "alminasa.ai",
  "shamela.ws",
  "islamicurdubooks.com",
  "islamqa.info",
];

const WHITELIST_REJECTION_MESSAGE =
  "معذرت، اسلامی اور جنرل ریسرچ کے لیے ہم صرف مستند علمی ذرائع سے معلومات لینے کے پابند ہیں۔";

function isWhitelistedUrl(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
    return SCRAPING_WHITELIST.some((d) => host === d || host.endsWith("." + d));
  } catch {
    return false;
  }
}

async function fetchUrlContent(url: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ResearchBot/1.0)" },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!resp.ok) return `[Could not fetch ${url}: HTTP ${resp.status}]`;
    const html = await resp.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, SOURCE_CHAR_LIMIT);
  } catch (e: any) {
    clearTimeout(timeoutId);
    if (e?.name === "AbortError") return `[Timed out fetching ${url} — the page took too long to respond]`;
    return `[Failed to fetch ${url}]`;
  }
}

async function fetchFileContent(supabase: any, storagePath: string): Promise<string> {
  try {
    const { data, error } = await supabase.storage.from("research-files").download(storagePath);
    if (error || !data) return "[Could not read file]";

    const ext = storagePath.split(".").pop()?.toLowerCase();

    if (ext === "pdf") {
      const bytes = new Uint8Array(await data.arrayBuffer());
      const textParts: string[] = [];
      const decoder = new TextDecoder("utf-8", { fatal: false });
      const raw = decoder.decode(bytes);

      // Attempt 1: extract text from BT...ET blocks (works for uncompressed PDFs)
      const btEtRegex = /BT\s([\s\S]*?)ET/g;
      let match;
      while ((match = btEtRegex.exec(raw)) !== null) {
        const block = match[1];
        const tjRegex = /\(([^)]*)\)\s*Tj/g;
        let tjMatch;
        while ((tjMatch = tjRegex.exec(block)) !== null) {
          textParts.push(tjMatch[1]);
        }
        // Also handle TJ arrays: [(text) n (text) n] TJ
        const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
        let tjArrayMatch;
        while ((tjArrayMatch = tjArrayRegex.exec(block)) !== null) {
          const inner = tjArrayMatch[1];
          const stringsInArray = inner.matchAll(/\(([^)]*)\)/g);
          for (const s of stringsInArray) textParts.push(s[1]);
        }
      }

      if (textParts.length > 0) return textParts.join(" ").slice(0, SOURCE_CHAR_LIMIT);

      // Attempt 2: fallback — strip binary noise and return printable chars
      const readable = raw
        .replace(/[^\x20-\x7E\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF\n]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const result = readable.slice(0, SOURCE_CHAR_LIMIT);
      return result || "[PDF text extraction yielded no readable content. The PDF may use compressed streams or non-standard encoding.]";
    }

    if (ext === "docx") {
      // DOCX is a ZIP archive — read as ArrayBuffer and extract word/document.xml
      try {
        const arrayBuffer = await data.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        // Search for the word/document.xml content within the ZIP binary
        // ZIP local file headers start with PK\x03\x04; we scan for XML content tags
        const decoder = new TextDecoder("utf-8", { fatal: false });
        const raw = decoder.decode(bytes);

        // Find the word/document.xml section by looking for its XML content
        // DOCX XML contains <w:t> tags (Word text elements)
        const wTextRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
        const textParts: string[] = [];
        let m;
        while ((m = wTextRegex.exec(raw)) !== null) {
          if (m[1].trim()) textParts.push(m[1]);
        }

        if (textParts.length > 0) {
          return textParts.join(" ").replace(/\s+/g, " ").trim().slice(0, SOURCE_CHAR_LIMIT);
        }

        // Fallback: strip all XML tags from any readable section
        const xmlStripped = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const printable = xmlStripped.replace(/[^\x20-\x7E\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g, " ").replace(/\s+/g, " ").trim();
        return printable.slice(0, SOURCE_CHAR_LIMIT) || "[DOCX text extraction yielded no content]";
      } catch {
        return "[DOCX text extraction failed]";
      }
    }

    return "[Unsupported file type]";
  } catch {
    return "[Error reading file]";
  }
}

// ─── Corpus-validated "Add citations" pipeline ───────────────────────────────
interface CitationsPipelineInput {
  text:       string;
  supabase:   any;
  lovableKey: string;
}

interface CitationsPipelineOutput {
  text:       string;
  citations:  Array<{
    index:       number;
    arabic:      string;
    translation: string;
    reference:   string;
    source_url?: string;
  }>;
  /** Segments where the LLM tried to insert a citation but the verifier rejected it. */
  rejected_segments: number[];
  /** Segments that had no candidate matches at all. */
  uncited_segments:  number[];
  /** Total segments processed (for UI progress / telemetry). */
  total_segments:    number;
}

async function runCitationsPipeline(input: CitationsPipelineInput): Promise<CitationsPipelineOutput> {
  const segments = segmentClaims(input.text);
  if (segments.length === 0) {
    return { text: input.text, citations: [], rejected_segments: [], uncited_segments: [], total_segments: 0 };
  }

  // 1. Fetch candidates per segment in parallel (capped to avoid melting upstreams)
  const candidatesPerSegment = await Promise.all(
    segments.map((seg) =>
      findCitationCandidates(seg.text, {
        supabase:    input.supabase,
        includeApis: false,    // pure corpus for safety in pipeline v1; flip to true once Phase 3 ingest is complete
        maxQuran:    3,
        maxHadith:   3,
      }),
    ),
  );

  // Short-circuit: if NO segment yielded any candidate, return early with the
  // original text and a list of all segments as "uncited".
  const totalCandidates = candidatesPerSegment.reduce((s, c) => s + c.length, 0);
  if (totalCandidates === 0) {
    return {
      text: input.text,
      citations: [],
      rejected_segments: [],
      uncited_segments: segments.map((s) => s.index),
      total_segments: segments.length,
    };
  }

  // 2. Build the LLM prompt: segments + candidates per segment
  const promptPayload = {
    segments: segments.map((seg, i) => ({
      index: seg.index,
      text:  seg.text,
      candidates: candidatesPerSegment[i].map((c) => ({
        match_key:   c.match_key,
        type:        c.type,
        reference:   c.reference,
        arabic:      c.arabic.slice(0, 400),
        translation: c.translation.slice(0, 400),
      })),
    })),
  };

  const messages = [
    { role: "system", content: CITATIONS_CONSTRAINED_PROMPT },
    {
      role: "user",
      content:
        "Here is the user text segmented by claim, with retrieved citation candidates per segment.\n\n" +
        JSON.stringify(promptPayload, null, 2),
    },
  ];

  const llmRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.lovableKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages,
      response_format: { type: "json_object" },
      // Phase 10.2: cap is high because citations pipeline returns one JSON
      // object that may contain many `picks`; we don't want it truncated.
      max_tokens: 4096,
    }),
  });

  if (!llmRes.ok) {
    console.error("[citations-pipeline] LLM error:", llmRes.status, await llmRes.text().catch(() => ""));
    return {
      text: input.text,
      citations: [],
      rejected_segments: [],
      uncited_segments: segments.map((s) => s.index),
      total_segments: segments.length,
    };
  }

  const llmJson = await llmRes.json();
  const raw: string = llmJson?.choices?.[0]?.message?.content ?? "";
  let picks: Array<{ segment_index: number; match_key: string; arabic?: string; translation?: string; reference?: string }> = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.picks)) picks = parsed.picks;
  } catch {
    try {
      const stripped = raw.replace(/```json\s*|\s*```/g, "").trim();
      const parsed = JSON.parse(stripped);
      if (Array.isArray(parsed?.picks)) picks = parsed.picks;
    } catch {
      console.error("[citations-pipeline] LLM returned unparseable JSON:", raw.slice(0, 300));
    }
  }

  // 3. For each pick, confirm the match_key is in the candidate list it was
  //    drawn from (LLM hallucination check #1). Then map back to the candidate
  //    for the canonical reference + URL.
  const matchKeyToCandidate = new Map<string, { segmentIndex: number; candidate: CitationCandidate }>();
  for (let i = 0; i < segments.length; i++) {
    for (const c of candidatesPerSegment[i]) {
      // Last writer wins if duplicate keys across segments — fine for verifier
      matchKeyToCandidate.set(c.match_key, { segmentIndex: segments[i].index, candidate: c });
    }
  }

  const llmRejectedSegments: number[] = [];
  const validPicks = picks.filter((p) => {
    const cand = matchKeyToCandidate.get(p.match_key);
    if (!cand) {
      llmRejectedSegments.push(p.segment_index);
      return false;
    }
    return true;
  });

  // 4. Server-side DB verification of every accepted pick (hallucination check #2)
  const rawForVerifier = validPicks.map((p) => {
    const cand = matchKeyToCandidate.get(p.match_key)!.candidate;
    if (cand.type === "quran") {
      const [, surahStr, verseStr] = cand.match_key.split(":");
      return { reference: p.reference ?? cand.reference, surah: parseInt(surahStr, 10), verse: parseInt(verseStr, 10), translation: p.translation, arabic: p.arabic };
    }
    const [, book, number] = cand.match_key.split(":");
    return { reference: p.reference ?? cand.reference, book, hadith_number: number, translation: p.translation, arabic: p.arabic };
  });
  const { verified, rejected: verifierRejected } = await verifyAll(rawForVerifier, input.supabase);

  // Build the per-segment pick lookup using verified results
  const verifiedByMatchKey = new Map<string, typeof verified[number]>();
  for (const v of verified) verifiedByMatchKey.set(v.match_key, v);

  const segmentPicks: Map<number, typeof verified[number]> = new Map();
  for (const p of validPicks) {
    const v = verifiedByMatchKey.get(p.match_key);
    if (v) segmentPicks.set(p.segment_index, v);
  }

  // 5. Re-assemble the text with inline citation blocks appended to each
  //    segment that has a verified pick.
  const blocks: string[] = [];
  let cursor = 0;
  let citationIndex = 0;
  const finalCitations: CitationsPipelineOutput["citations"] = [];
  const uncited: number[] = [];

  for (const seg of segments) {
    // Preserve any whitespace between segments untouched
    if (seg.start > cursor) blocks.push(input.text.slice(cursor, seg.start));
    const v = segmentPicks.get(seg.index);
    if (v) {
      citationIndex += 1;
      const inline =
        ` «${v.arabic.trim()}» — "${v.translation.trim()}" [${v.reference}]`;
      blocks.push(seg.text + inline);
      finalCitations.push({
        index:       citationIndex,
        arabic:      v.arabic,
        translation: v.translation,
        reference:   v.reference,
        source_url:  v.source_url,
      });
    } else {
      blocks.push(seg.text);
      if (candidatesPerSegment[seg.index].length > 0) {
        // We had candidates but no confident pick — segment is "uncited"
        uncited.push(seg.index);
      } else {
        uncited.push(seg.index);
      }
    }
    cursor = seg.end;
  }
  if (cursor < input.text.length) blocks.push(input.text.slice(cursor));

  // Verifier rejections are also reported as "rejected segments" so the UI
  // can surface them rather than silently dropping bad picks.
  const rejectedSegments = Array.from(new Set([
    ...llmRejectedSegments,
    ...verifierRejected.map((r: any) => r.segment_index).filter((n: any) => typeof n === "number"),
  ]));

  return {
    text:              blocks.join(""),
    citations:         finalCitations,
    rejected_segments: rejectedSegments,
    uncited_segments:  uncited,
    total_segments:    segments.length,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rate limit: 20 research queries per user per minute
    if (isRateLimited(user.id, 20, 60_000)) {
      return rateLimitResponse(corsHeaders);
    }

    const body = await req.json();
    const {
      query,
      sources,
      strictMode,
      chatHistory,
      modes: rawModes,
      mode: researchMode,
    }: {
      query?: string;
      sources?: unknown[];
      strictMode?: boolean;
      chatHistory?: Array<{ role: string; content: string }>;
      modes?: unknown;
      mode?: string;
    } = body ?? {};

    if (!query) {
      return new Response(JSON.stringify({ error: "Query is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Token-based quota check: 30 tokens per research query
    const tokenCost = calculateCost("research", 1);
    const tokenResult = await checkAndDeductTokens(
      supabase, user.id, tokenCost, "research",
      `Research query: ${query.slice(0, 60)}`,
    );
    if (!tokenResult.ok) {
      return insufficientTokensResponse(tokenResult, corsHeaders);
    }

    const modes: ResearchAssistMode[] = Array.isArray(rawModes)
      ? (rawModes.filter((m) => m === "spelling" || m === "citations") as ResearchAssistMode[])
      : [];
    const promptKey = pickPromptKey(modes);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Citations-only mode: corpus-validated pipeline ───────────────────────
    // Bypasses the generic LLM-prompt path. Segments the text, fetches a
    // candidate list per segment from scholarly_documents (+ APIs), asks the
    // LLM to PICK only from those candidates, then verifies every pick exists
    // in the DB before returning it. See _shared/citationCandidates.ts and
    // _shared/citationVerifier.ts.
    if (promptKey === "citations") {
      const result = await runCitationsPipeline({
        text: query,
        supabase,
        lovableKey: LOVABLE_API_KEY,
      });
      return new Response(JSON.stringify({ promptKey, ...result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const contextParts: string[] = [];

    if (sources && sources.length > 0) {
      console.log(`[Research] Parallel fetch initiated for ${sources.length} source(s)`);
      const startTime = Date.now();

      // Context-aware scraping: Islamic & General modes are whitelist-only.
      // Custom mode (or unspecified) bypasses the gate.
      const enforceWhitelist = researchMode === "islamic" || researchMode === "general";

      const fetchPromises = sources.map(async (source: any) => {
        if (source.source_type === "url" && source.url) {
          if (enforceWhitelist && !isWhitelistedUrl(source.url)) {
            return `--- Source: ${source.title} (${source.url}) ---\n[${WHITELIST_REJECTION_MESSAGE}]`;
          }
          const content = await fetchUrlContent(source.url);
          return `--- Source: ${source.title} (${source.url}) ---\n${content}`;
        } else if (source.storage_path) {
          const content = await fetchFileContent(supabase, source.storage_path);
          return `--- Source: ${source.title} (File) ---\n${content}`;
        }
        return null;
      });

      const results = await Promise.all(fetchPromises);
      for (const r of results) {
        if (r) contextParts.push(r);
      }

      console.log(`[Research] Parallel fetch completed in ${Date.now() - startTime}ms`);
    }

    // Phase 10.4.a: when on General tab (no user sources, non-strict mode)
    // AND the query smells Islamic-topical, fire `domain-scrape` in parallel
    // and inject the results as additional context for Gemini. This brings
    // islamqa.info / islamweb.net / islamicurdubooks.com citations into the
    // General-tab pipeline. Non-blocking — fails silently on slow upstreams.
    const ISLAMIC_MARKERS = /(?:قرآن|قراٰن|قُرآن|حدیث|حديث|آیت|آية|آیات|آيات|اَیات|سورۃ|سورة|نماز|روزہ|روزه|زکوٰۃ|زكاة|حج|عمرہ|عمرة|نکاح|طلاق|توبہ|توبة|صدقہ|صدقة|الله|اللہ|اللّٰہ|سنت|سنة|فقہ|فقه|تفسیر|تفسير|نبی|نبي|رسول|صحابہ|صحابة|إسلام|اسلام|sahaba|quran|qur'?an|hadith|hadis|surah|ayah|prophet|islam(?:ic)?)/i;
    if (!strictMode && contextParts.length === 0 && ISLAMIC_MARKERS.test(query)) {
      try {
        const scrapeRes = await fetch(`${supabaseUrl}/functions/v1/domain-scrape`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization:  `Bearer ${supabaseKey}`,
            apikey:         supabaseKey,
          },
          body: JSON.stringify({
            query,
            selectedDomains: ["islamqa", "islamweb", "islamicurdubooks", "shamilaurdu"],
          }),
          signal: AbortSignal.timeout(8_000),
        });
        if (scrapeRes.ok) {
          const data = await scrapeRes.json();
          const scrapeResults: any[] = data?.results ?? [];
          if (scrapeResults.length > 0) {
            const formatted = scrapeResults.slice(0, 6).map((r) => {
              const url = r?.citation_ref?.url ?? "";
              const dom = r?.domain ?? "scraper";
              return `--- Web source [${dom}]${url ? ` (${url})` : ""} ---\n${r.content ?? ""}`;
            });
            contextParts.push(...formatted);
            console.log(`[Research] General-tab scraping injected ${formatted.length} source(s) for Islamic-topical query`);
          }
        }
      } catch (e) {
        console.warn("[Research] General-tab scraping failed (non-fatal):", e);
      }
    }

    // Phase 10.3: when not-strict AND no user sources, omit the "No sources"
    // line entirely. With STRICT_INSTRUCTION_OFF active (Phase 8.5 rewrite),
    // Gemini will answer from general knowledge under explicit citation rules.
    // Keeping the "No sources" stub here was making Gemini refuse to answer
    // even though the prompt allowed general knowledge.
    const contextBlock = contextParts.length > 0
      ? `\n\nHere are the research sources provided by the user:\n\n${contextParts.join("\n\n")}`
      : (strictMode ? "\n\n[No sources have been provided yet.]" : "");

    const strictInstruction = strictMode ? STRICT_INSTRUCTION_ON : STRICT_INSTRUCTION_OFF;

    // Assist modes (spelling / citations / combined) return strict JSON and
    // skip sources/chat history — input is just the user's text to edit.
    const isAssistMode = promptKey !== "normal";

    let systemPrompt: string;
    if (promptKey === "spelling") systemPrompt = SPELLING_SYSTEM_PROMPT;
    else if (promptKey === "citations") systemPrompt = CITATIONS_SYSTEM_PROMPT;
    else if (promptKey === "combined") systemPrompt = COMBINED_SYSTEM_PROMPT;
    else {
      systemPrompt = NORMAL_SYSTEM_PROMPT
        .replace("{{STRICT_INSTRUCTION}}", strictInstruction)
        .replace("{{CONTEXT_BLOCK}}", contextBlock);
    }

    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: systemPrompt },
    ];

    if (!isAssistMode && chatHistory && chatHistory.length > 0) {
      for (const msg of chatHistory) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: "user", content: query });

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
        stream: !isAssistMode,
        // Phase 10.2: explicit cap. Assist (spelling/citations) is JSON-bound
        // and can be larger; normal/streaming chat is conversational so the
        // 2048-token cap is comfortable for General-tab answers and still
        // generous for Custom-mode source-grounded answers.
        max_tokens: isAssistMode ? 4096 : 8192,
        ...(isAssistMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });

    if (!response.ok) {
      // Refund tokens on AI failure
      await refundTokens(supabase, user.id, tokenCost, "research", "AI gateway error");

      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits in Settings." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update legacy usage counter (backward compat analytics — non-blocking)
    supabase
      .from("subscriptions")
      .select("research_queries_used")
      .eq("user_id", user.id)
      .single()
      .then(({ data: sub }) => {
        if (sub) {
          supabase
            .from("subscriptions")
            .update({ research_queries_used: (sub.research_queries_used ?? 0) + 1 })
            .eq("user_id", user.id)
            .then(() => {});
        }
      });

    if (isAssistMode) {
      const completion = await response.json();
      const raw: string = completion?.choices?.[0]?.message?.content ?? "";
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Fallback: strip ```json fences if model ignored json_object directive
        const stripped = raw.replace(/```json\s*|\s*```/g, "").trim();
        try { parsed = JSON.parse(stripped); } catch { parsed = null; }
      }
      if (!parsed || typeof parsed !== "object") {
        console.error("[research-query] assist mode returned unparseable JSON:", raw.slice(0, 500));
        return new Response(JSON.stringify({ error: "Model returned malformed response" }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ promptKey, ...parsed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Normal mode — stream the SSE response back to the client
    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("research-query error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
