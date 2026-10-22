/**
 * Prompts for reading a page (OCR) and translating a page, for the desktop's
 * own-key routes (electron/ipc/aiHandlers.ts, SYSTEM-2026 §10). The same
 * wording as the process-ocr and translate-page edge functions, so a page
 * reads and translates alike whichever way it runs.
 */

export const OCR_SYSTEM_PROMPT = `You are an expert OCR system. Extract ALL text visible in the provided image. Follow these rules:
1. Extract text in ALL languages present (Urdu, Arabic, English, or any other).
2. Preserve the original formatting, layout, and paragraph structure as much as possible.
3. For right-to-left languages (Urdu, Arabic), maintain proper RTL text direction.
4. If there are tables, try to preserve the table structure using plain text formatting.
5. If text is unclear, make your best guess and mark uncertain parts with [?].
6. Return ONLY the extracted text, no explanations or metadata.`;

export const OCR_USER_PROMPT = "Extract all text from this image. Preserve formatting and support Urdu, Arabic, and English.";

const LANGUAGE_NAMES: Record<string, string> = {
  ur: "Urdu", ar: "Arabic", en: "English", fa: "Persian", pa: "Punjabi", ps: "Pashto",
};

export function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
}

export function translateSystemPrompt({
  targetLanguage,
  sourceLanguage,
  genreInstruction,
}: {
  targetLanguage: string;
  sourceLanguage?: string | null;
  genreInstruction?: string | null;
}): string {
  const targetName = languageName(targetLanguage);
  const sourceName = sourceLanguage ? languageName(sourceLanguage) : null;
  let prompt = `You are a professional translator. Translate the provided content into ${targetName}.${sourceName ? ` The source language is ${sourceName}.` : " Auto-detect the source language."}
Rules:
1. Produce ONLY the translated text — no explanations, notes, or metadata.
2. Preserve the original formatting, paragraph breaks, and structure.
3. Maintain proper text direction (RTL for Urdu/Arabic/Persian/Pashto, LTR for English).
4. If the source contains headings, bullet points, or numbered lists, preserve them.
5. Translate naturally and idiomatically — do not produce word-for-word literal translations.`;
  if (genreInstruction?.trim()) prompt += `\nSpecial Genre Style Instruction: ${genreInstruction.trim()}`;
  return prompt;
}

export function translateUserPrompt(targetLanguage: string, text?: string | null): string {
  const targetName = languageName(targetLanguage);
  return text
    ? `Translate the following text into ${targetName}:\n\n${text}`
    : `Translate all visible text in this image into ${targetName}. Preserve formatting.`;
}
