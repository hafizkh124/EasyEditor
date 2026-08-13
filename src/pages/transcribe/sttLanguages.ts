import type { TranscribeLanguage } from "@/lib/audio/transcribeLongForm";

/**
 * Shared between the Transcribe page and its workflow hook. The refine action
 * list stays in the page, because each entry carries a Lucide icon.
 */
export type SttLanguage = TranscribeLanguage;

export type RefineAction =
  | "formalize" | "humanize" | "shorten" | "citations" | "spelling_check" | "normalize_script";

/** Language options for the transcription selector. */
export const STT_LANGUAGES: { code: SttLanguage; labelKey: string }[] = [
  { code: "auto", labelKey: "stt.lang_auto" },
  { code: "ur-PK", labelKey: "stt.lang_ur" },
  { code: "ar", labelKey: "stt.lang_ar" },
  { code: "en-US", labelKey: "stt.lang_en" },
  { code: "pa", labelKey: "stt.lang_pa" },
  { code: "ps", labelKey: "stt.lang_ps" },
  { code: "fa", labelKey: "stt.lang_fa" },
  { code: "sd", labelKey: "stt.lang_sd" },
  { code: "bal", labelKey: "stt.lang_bal" },
];
