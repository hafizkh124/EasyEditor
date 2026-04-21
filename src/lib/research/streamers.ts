import { supabase } from "@/integrations/supabase/client";
import type { ChatMessage, Source } from "@/components/research/types";
import type { CitationItem } from "@/components/research/CitationPanel";
import type { ResearchAssistMode } from "@/lib/prompts";

export type SpellingChange = { start: number; end: number; original: string; corrected: string };
export type StructuredCitation = {
  index: number;
  arabic: string;
  translation: string;
  reference: string;
  source_url?: string;
};
export type AssistResult =
  | { promptKey: "spelling"; corrected: string; changes: SpellingChange[] }
  | { promptKey: "citations"; text: string; citations: StructuredCitation[] }
  | {
      promptKey: "combined";
      corrected: string;
      changes: SpellingChange[];
      text: string;
      citations: StructuredCitation[];
    };

function getAuthHeaders(accessToken: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${accessToken}`,
  };
}

type StreamCallbacks = {
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (err: string) => void;
};

async function getSessionToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function readErrorMessage(resp: Response): Promise<string> {
  try {
    const body = (await resp.json()) as { error?: string };
    return body.error ?? "Request failed";
  } catch {
    return "Request failed";
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Stream error";
}

/**
 * General research SSE streamer.
 *
 * Shape: OpenAI-compatible `data: {choices:[{delta:{content}}]}` lines
 * terminated by `data: [DONE]`.
 */
export async function streamResearchQuery({
  query,
  sources,
  strictMode,
  chatHistory,
  onDelta,
  onDone,
  onError,
}: {
  query: string;
  sources: Source[];
  strictMode: boolean;
  chatHistory: ChatMessage[];
} & StreamCallbacks): Promise<void> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/research-query`;
  try {
    const accessToken = await getSessionToken();
    if (!accessToken) {
      onError("Please sign in to use research.");
      return;
    }

    const resp = await fetch(url, {
      method: "POST",
      headers: getAuthHeaders(accessToken),
      body: JSON.stringify({ query, sources, strictMode, chatHistory, modes: [] }),
    });

    if (!resp.ok) {
      onError(await readErrorMessage(resp));
      return;
    }
    if (!resp.body) {
      onError("No response body");
      return;
    }

    await pumpOpenAIStream(resp.body, onDelta, onDone);
  } catch (e: unknown) {
    onError(errorMessage(e));
  }
}

/**
 * Islamic research SSE streamer.
 *
 * Emits an extra `{type: "sources_ready"}` event up-front with citation data
 * before Gemini begins streaming the answer.
 */
export async function streamIslamicQuery({
  query,
  selectedDomains,
  selectedLanguages,
  strictMode,
  chatHistory,
  tier,
  onDelta,
  onDone,
  onError,
  onSourcesReady,
}: {
  query: string;
  selectedDomains: string[];
  selectedLanguages: string[];
  strictMode: boolean;
  chatHistory: ChatMessage[];
  tier: string;
  onSourcesReady?: (count: number, domains: string[], citations: CitationItem[]) => void;
} & StreamCallbacks): Promise<void> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/islamic-search`;
  try {
    const accessToken = await getSessionToken();
    if (!accessToken) {
      onError("Please sign in to use research.");
      return;
    }

    const resp = await fetch(url, {
      method: "POST",
      headers: getAuthHeaders(accessToken),
      body: JSON.stringify({ query, selectedDomains, selectedLanguages, strictMode, chatHistory, tier }),
    });

    if (!resp.ok) {
      onError(await readErrorMessage(resp));
      return;
    }
    if (!resp.body) {
      onError("No response body");
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    type IslamicEvent =
      | { type: "sources_ready"; count?: number; domains?: string[]; citations?: CitationItem[] }
      | { choices?: Array<{ delta?: { content?: string } }> };

    const parseLine = (line: string): boolean => {
      if (!line.startsWith("data: ")) return false;
      const jsonStr = line.slice(6).trim();
      if (jsonStr === "[DONE]") {
        onDone();
        return true;
      }
      try {
        const parsed = JSON.parse(jsonStr) as IslamicEvent;
        if ("type" in parsed && parsed.type === "sources_ready") {
          onSourcesReady?.(parsed.count ?? 0, parsed.domains ?? [], parsed.citations ?? []);
          return false;
        }
        const content = "choices" in parsed ? parsed.choices?.[0]?.delta?.content : undefined;
        if (content) onDelta(content);
      } catch {
        return false;
      }
      return false;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.startsWith(":") || line.trim() === "") continue;
        if (parseLine(line)) return;
      }
    }
    if (buffer.trim()) {
      for (let raw of buffer.split("\n")) {
        if (!raw) continue;
        if (raw.endsWith("\r")) raw = raw.slice(0, -1);
        parseLine(raw);
      }
    }
    onDone();
  } catch (e: unknown) {
    onError(errorMessage(e));
  }
}

/**
 * Pumps an OpenAI-shaped SSE body until [DONE] or stream end.
 * Lines with unparseable JSON are buffered and re-tried on the next read.
 */
async function pumpOpenAIStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void,
  onDone: () => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.startsWith(":") || line.trim() === "") continue;
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (jsonStr === "[DONE]") {
        onDone();
        return;
      }
      try {
        const parsed = JSON.parse(jsonStr) as { choices?: Array<{ delta?: { content?: string } }> };
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) onDelta(content);
      } catch {
        // Incomplete chunk — put it back and wait for more bytes.
        buffer = line + "\n" + buffer;
        break;
      }
    }
  }
  // Flush any remaining complete lines.
  if (buffer.trim()) {
    for (let raw of buffer.split("\n")) {
      if (!raw) continue;
      if (raw.endsWith("\r")) raw = raw.slice(0, -1);
      if (!raw.startsWith("data: ")) continue;
      const jsonStr = raw.slice(6).trim();
      if (jsonStr === "[DONE]") continue;
      try {
        const parsed = JSON.parse(jsonStr) as { choices?: Array<{ delta?: { content?: string } }> };
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) onDelta(content);
      } catch {
        /* ignore malformed tail */
      }
    }
  }
  onDone();
}

/**
 * Non-streaming assist call (spelling / citations / combined).
 *
 * Returns structured JSON matching the prompt's output contract (see src/lib/prompts/).
 * `modes` must be non-empty; use streamResearchQuery for normal research.
 */
export async function assistResearchQuery({
  query,
  modes,
}: {
  query: string;
  modes: ResearchAssistMode[];
}): Promise<AssistResult> {
  if (modes.length === 0) throw new Error("assistResearchQuery requires at least one mode");
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/research-query`;
  const accessToken = await getSessionToken();
  if (!accessToken) throw new Error("Please sign in to use research.");

  const resp = await fetch(url, {
    method: "POST",
    headers: getAuthHeaders(accessToken),
    body: JSON.stringify({ query, modes }),
  });

  if (!resp.ok) {
    throw new Error(await readErrorMessage(resp));
  }
  const data = (await resp.json()) as AssistResult;
  return data;
}
