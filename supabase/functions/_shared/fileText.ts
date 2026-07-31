/**
 * PDF, DOCX, TXT, MD text extraction for Supabase Edge Functions (SPEC-M4 FR-2.2).
 *
 * The extractor itself is runtime-agnostic and lives in shared/text/fileText.ts
 * so the Electron main process extracts identically (SPEC-M5 FR-1.4, risk R2).
 * Only the Supabase Storage fetch below is Deno/cloud-specific.
 */
export { extractTextFromBuffer } from "./mirror/text/fileText.ts";

import { extractTextFromBuffer } from "./mirror/text/fileText.ts";

export async function fetchAndExtractStorageFile(
  supabase: any,
  bucket: string,
  storagePath: string,
  charLimit: number = 2000000,
): Promise<string> {
  try {
    const { data, error } = await supabase.storage.from(bucket).download(storagePath);
    if (error || !data) return "[Could not read file]";

    const ext = storagePath.split(".").pop()?.toLowerCase() || "";
    const bytes = new Uint8Array(await data.arrayBuffer());
    return extractTextFromBuffer(bytes, ext, charLimit);
  } catch {
    return "[Error reading file]";
  }
}
