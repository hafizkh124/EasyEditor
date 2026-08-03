/**
 * SPEC-M6 Phase 7 — Reader AI prompts.
 *
 * Pure prompt builders for the Reader AI Panel (explain / summarize / quiz /
 * free-form). Kept DOM-free so they can be unit-tested in Node without a
 * browser, and so the panel itself stays a thin UI over `invokeAiText`.
 */

export type AiReaderAction = "explain" | "summarize" | "quiz";

/** Language-agnostic role: the model is a classical-Arabic reading assistant. */
export function buildAiReaderSystemInstruction(language: "ur" | "en"): string {
  return language === "ur"
    ? "آپ ایک اسلامی کتب خانے کے عربی قاری کے لیے AI معاون ہیں۔ کتاب کے اردو متن کا سامنا ہو تو عربی عبارت کو سمجھائیں، اہم اصطلاحات کا خلاصہ دیں، اور قرآنی/حدیثی حوالوں کی وضاحت کریں۔ جواب اردو میں دیں۔ اگر متن عربی میں ہے تو پہلے اس کا مفہوم اردو میں بیان کریں، پھر تفصیل دیں۔ کسی چیز کا اندازہ نہ لگائیں؛ صرف موجود متن کی بنیاد پر جواب دیں۔"
    : "You are an AI reading assistant for an Islamic library. Help the reader understand classical Arabic text: explain passages, clarify key terms, and contextualize Quranic/hadith references. Answer in English. Base your answer strictly on the given page text; do not invent content.";
}

/**
 * The prompt for a quick action. The page text is appended by the caller (or
 * passed here) so the panel can show a stable transcript line.
 */
export function buildActionPrompt(action: AiReaderAction, pageText: string, pageNumber: number, language: "ur" | "en"): string {
  const header = language === "ur"
    ? `براہ کرم اس کتاب کے صفحہ ${pageNumber} کے متن کے بارے میں درج ذیل کام کریں:\n\n`
    : `Please do the following for the text on page ${pageNumber} of the book:\n\n`;

  const instruction =
    action === "explain"
      ? language === "ur"
        ? "اس صفحے کے مشکل الفاظ اور جملوں کی وضاحت کریں۔ ہر اہم اصطلاح کو الگ سے سمجھائیں اور جہاں ضروری ہو اس کا سیاق بتائیں۔"
        : "Explain the difficult words and sentences on this page. Clarify each key term separately and give context where needed."
      : action === "summarize"
        ? language === "ur"
          ? "اس صفحے کا جامع خلاصہ پیش کریں۔ اہم نکات کو ترتیب وار لکھیں۔"
          : "Provide a concise summary of this page. List the main points in order."
        : language === "ur"
          ? "اس صفحے کے متن سے 3 سے 5 مختصر سوالات بنائیں جو قاری کی سمجھ جانچیں، اور ہر سوال کا جواب بھی دیں۔"
          : "Create 3–5 short comprehension questions from this page's text, each with an answer.";

  const body = `${header}${instruction}\n\n---\n\nصفحہ ${pageNumber} کا متن:\n${truncateForPrompt(pageText)}`;
  return body;
}

/** The prompt for a free-form question about the current page. */
export function buildFreePrompt(question: string, pageText: string, pageNumber: number): string {
  return [
    `صفحہ ${pageNumber} کے متن کی روشنی میں اس سوال کا جواب دیں:`,
    "",
    question.trim(),
    "",
    "---",
    "",
    `صفحہ ${pageNumber} کا متن:`,
    truncateForPrompt(pageText),
  ].join("\n");
}

/** Hard cap so a very long page never blows the model context. */
const MAX_PAGE_CHARS = 12000;

function truncateForPrompt(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= MAX_PAGE_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_PAGE_CHARS)}… [متن جاری ہے، خلاصہ کریں]`;
}
