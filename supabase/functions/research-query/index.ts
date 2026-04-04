import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRateLimited, rateLimitResponse } from "../_shared/rateLimit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function fetchUrlContent(url: string): Promise<string> {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ResearchBot/1.0)" },
    });
    if (!resp.ok) return `[Could not fetch ${url}]`;
    const html = await resp.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 8000);
  } catch {
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

      const btEtRegex = /BT\s([\s\S]*?)ET/g;
      let match;
      while ((match = btEtRegex.exec(raw)) !== null) {
        const block = match[1];
        const tjRegex = /\(([^)]*)\)\s*Tj/g;
        let tjMatch;
        while ((tjMatch = tjRegex.exec(block)) !== null) {
          textParts.push(tjMatch[1]);
        }
      }

      if (textParts.length > 0) return textParts.join(" ").slice(0, 8000);

      const readable = raw
        .replace(/[^\x20-\x7E\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF\n]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return readable.slice(0, 8000) || "[PDF text extraction yielded no content]";
    }

    if (ext === "docx") {
      const text = await data.text();
      const xmlText = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      return xmlText.slice(0, 8000) || "[DOCX text extraction yielded no content]";
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

    const { query, sources, strictMode, chatHistory } = await req.json();

    if (!query) {
      return new Response(JSON.stringify({ error: "Query is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    const strictInstruction = strictMode
      ? "You MUST answer ONLY based on the provided sources. If the answer is not found in the sources, say so clearly. Do NOT use any external knowledge."
      : "Use the provided sources as primary references, but you may also use your general knowledge to provide a comprehensive answer. Clearly distinguish between information from sources and your own knowledge.";

    const systemPrompt = `You are an expert research assistant. Your job is to help users understand and analyze their research sources.

${strictInstruction}

IMPORTANT RULES:
1. Always cite your sources. When referencing information, mention the source name (e.g., "According to [Source Name]..." or "As mentioned in [File Name]...").
2. Format your responses using Markdown: use **bold**, bullet points, numbered lists, and headers where appropriate.
3. Support both English and Urdu queries. Respond in the same language as the user's question.
4. Be thorough but concise. Provide well-structured answers.
5. If multiple sources contain relevant information, synthesize them and note where each piece comes from.
${contextBlock}`;

    const messages: any[] = [{ role: "system", content: systemPrompt }];

    if (chatHistory && chatHistory.length > 0) {
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
        stream: true,
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

    // Stream the SSE response back to the client
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
