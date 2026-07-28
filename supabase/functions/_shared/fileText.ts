/**
 * Shared PDF, DOCX, TXT, MD text extractor for Supabase Edge Functions (SPEC-M4 FR-2.2).
 */

export function extractTextFromBuffer(
  bytes: Uint8Array,
  ext: string,
  charLimit: number = 2000000,
): string {
  const fileExt = ext.toLowerCase();

  if (fileExt === "txt" || fileExt === "md") {
    const decoder = new TextDecoder("utf-8", { fatal: false });
    return decoder.decode(bytes).slice(0, charLimit);
  }

  if (fileExt === "pdf") {
    const textParts: string[] = [];
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const raw = decoder.decode(bytes);

    // Attempt 1: extract text from BT...ET blocks
    const btEtRegex = /BT\s([\s\S]*?)ET/g;
    let match;
    while ((match = btEtRegex.exec(raw)) !== null) {
      const block = match[1];
      const tjRegex = /\(([^)]*)\)\s*Tj/g;
      let tjMatch;
      while ((tjMatch = tjRegex.exec(block)) !== null) {
        textParts.push(tjMatch[1]);
      }
      const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
      let tjArrayMatch;
      while ((tjArrayMatch = tjArrayRegex.exec(block)) !== null) {
        const inner = tjArrayMatch[1];
        const stringsInArray = inner.matchAll(/\(([^)]*)\)/g);
        for (const s of stringsInArray) textParts.push(s[1]);
      }
    }

    if (textParts.length > 0) return textParts.join(" ").slice(0, charLimit);

    // Attempt 2: fallback — strip binary noise and return printable chars
    const readable = raw
      .replace(/[^\x20-\x7E\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF\n]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return readable.slice(0, charLimit) || "[PDF text extraction yielded no readable content.]";
  }

  if (fileExt === "docx") {
    try {
      const decoder = new TextDecoder("utf-8", { fatal: false });
      const raw = decoder.decode(bytes);

      const wTextRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
      const textParts: string[] = [];
      let m;
      while ((m = wTextRegex.exec(raw)) !== null) {
        if (m[1].trim()) textParts.push(m[1]);
      }

      if (textParts.length > 0) {
        return textParts.join(" ").replace(/\s+/g, " ").trim().slice(0, charLimit);
      }

      const xmlStripped = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const printable = xmlStripped.replace(/[^\x20-\x7E\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g, " ").replace(/\s+/g, " ").trim();
      return printable.slice(0, charLimit) || "[DOCX text extraction yielded no content]";
    } catch {
      return "[DOCX text extraction failed]";
    }
  }

  return "[Unsupported file type]";
}

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
