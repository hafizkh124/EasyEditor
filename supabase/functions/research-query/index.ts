import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRateLimited, rateLimitResponse } from "../_shared/rateLimit.ts";
import {
  NORMAL_SYSTEM_PROMPT,
  STRICT_INSTRUCTION_ON,
  STRICT_INSTRUCTION_OFF,
  SPELLING_SYSTEM_PROMPT,
  CITATIONS_SYSTEM_PROMPT,
  COMBINED_SYSTEM_PROMPT,
  pickPromptKey,
  type ResearchAssistMode,
} from "../_shared/researchPrompts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SOURCE_CHAR_LIMIT = 20_000;

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
    }: {
      query?: string;
      sources?: unknown[];
      strictMode?: boolean;
      chatHistory?: Array<{ role: string; content: string }>;
      modes?: unknown;
    } = body ?? {};

    if (!query) {
      return new Response(JSON.stringify({ error: "Query is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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

    const contextParts: string[] = [];

    if (sources && sources.length > 0) {
      console.log(`[Research] Parallel fetch initiated for ${sources.length} source(s)`);
      const startTime = Date.now();

      const fetchPromises = sources.map(async (source: any) => {
        if (source.source_type === "url" && source.url) {
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

    const contextBlock = contextParts.length > 0
      ? `\n\nHere are the research sources provided by the user:\n\n${contextParts.join("\n\n")}`
      : "\n\n[No sources have been provided yet.]";

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
        ...(isAssistMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });

    if (!response.ok) {
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
