import { supabase } from '@/integrations/supabase/client';
import { isDesktop } from '@/utils/environment';

export interface AiRefineOptions {
  prompt: string;
  systemInstruction?: string;
  temperature?: number;
  onChunk?: (chunk: string) => void;
}

// Single source of truth — see src/utils/environment.ts. Kept under this
// name (rather than renaming every call site) so isDesktopEnv() stays a
// stable public export of this module.
export const isDesktopEnv = isDesktop;

/**
 * Universal AI execution adapter that transparently routes AI requests to:
 * - Edge functions (in Cloud/SaaS mode)
 * - Main process via BYOK IPC stream (in Desktop mode)
 */
export async function invokeAiText(options: AiRefineOptions): Promise<string> {
  if (isDesktopEnv() && window.electronAPI) {
    const streamChannelId = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let accumulatedText = '';
    
    return new Promise<string>((resolve, reject) => {
      let cleanup: (() => void) | undefined;

      if (options.onChunk && window.electronAPI?.byok) {
        cleanup = window.electronAPI.byok.onStreamChunk(streamChannelId, (data) => {
          if (data.error) {
            cleanup?.();
            reject(new Error(data.error));
          } else if (data.chunk) {
            accumulatedText += data.chunk;
            options.onChunk?.(data.chunk);
          } else if (data.done) {
            cleanup?.();
          }
        });
      }

      window.electronAPI!
        .invoke('ai:invoke', {
          prompt: options.prompt,
          systemInstruction: options.systemInstruction,
          temperature: options.temperature,
          streamChannelId,
        })
        .then((res: unknown) => {
          cleanup?.();
          const responseObj = res as { text?: string };
          resolve(responseObj.text || accumulatedText);
        })
        .catch((err) => {
          cleanup?.();
          reject(err);
        });
    });
  }

  // Cloud Mode: Invoke Supabase edge function
  const { data, error } = await supabase.functions.invoke('refine-text', {
    body: {
      prompt: options.prompt,
      systemInstruction: options.systemInstruction,
      temperature: options.temperature,
    },
  });

  if (error) {
    throw error;
  }

  return data?.text || data?.result || '';
}

/**
 * Embeds text using gemini-embedding-001 (768 dimensions).
 */
export async function embedText(text: string): Promise<number[]> {
  if (isDesktopEnv() && window.electronAPI) {
    const result = (await window.electronAPI.invoke('ai:invoke', {
      mode: 'embed',
      prompt: text,
    })) as number[];
    return result;
  }

  // Cloud Mode
  const { data, error } = await supabase.functions.invoke('embed', {
    body: { text },
  });

  if (error) {
    throw error;
  }

  return data?.embedding || [];
}

/**
 * Route any edge-function request through the correct runtime.
 *
 * Cloud: calls `supabase.functions.invoke`.
 * Desktop: sends `ai:invoke` IPC with `{ mode: "edge-function", name, body }`.
 *          The main-process handler is registered in M5.2+; until then this
 *          throws a clear error so no one accidentally deploys half a bridge.
 */
export async function callEdgeFunction(
  name: string,
  body: Record<string, unknown>,
): Promise<{ data: unknown; error?: { message: string } }> {
  if (isDesktopEnv() && window.electronAPI) {
    // M5.2: route to Electron main process
    // For now, the handler is stubbed — the call site gets a clear error.
    const result = await window.electronAPI.invoke("ai:invoke", {
      mode: "edge-function",
      functionName: name,
      body,
    });
    return result as { data: unknown; error?: { message: string } };
  }

  // Cloud mode — direct Supabase edge function call
  const { data, error } = await supabase.functions.invoke(name, { body });
  return { data, error: error ? { message: error.message ?? `${name} failed` } : undefined };
}
