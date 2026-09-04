// M9 Phase 7 — the renderer-side call to the cloud OCR service (ADR-0023).
//
// `process-ocr` is a signed-in Supabase edge function that takes ONE page image
// and returns its text. The agent's `ocr_document` bridge (AgentPanel's
// `handleOcr`) renders a scan to page images and calls this once per page.
//
// Consent to upload is gated upstream, per project, before the agent ever
// issues an OCR request — see `electron/agent/dispatch.ts` `ocr_document`.

import { supabase } from "@/integrations/supabase/client";

const OCR_ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-ocr`;

async function sessionToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * OCR a single page image. `imageBase64` is the raw base64 (no data: prefix).
 * Throws with a readable message on auth failure, quota exhaustion, or a
 * service error — the caller surfaces it to the agent as the page's result.
 */
export async function ocrPageImage(
  imageBase64: string,
  mimeType = "image/jpeg",
): Promise<string> {
  const token = await sessionToken();
  if (!token) throw new Error("OCR needs a signed-in session.");

  const res = await fetch(OCR_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ imageBase64, mimeType }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `OCR failed (${res.status})`);
  }
  const data = (await res.json()) as { text?: string };
  return data.text ?? "";
}
