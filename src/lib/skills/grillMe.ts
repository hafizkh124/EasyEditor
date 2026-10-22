import type { ScholarlyPromptDef } from "@/lib/prompts/promptsRegistry";

/**
 * "مجھ سے پوچھو" (grill me), SYSTEM-2026 §7: before anything is written, the
 * assistant interviews the scholar about their topic — one question at a time,
 * each with a few options (one marked as suggested), 5 to 8 questions, and the
 * scholar can say "کافی ہے" at any point. It ends with an outline. It asks; it
 * never rules.
 *
 * It runs as a prompt, so it works the same on web and desktop: the filled-in
 * instruction goes into the composer and the scholar sends it.
 */
export const GRILL_ME: ScholarlyPromptDef = {
  id: "grill_me",
  code: "grill_me",
  titleAr: "اسألني",
  titleUr: "مجھ سے پوچھو",
  descriptionUr: "لکھنے سے پہلے AI آپ سے ایک ایک کر کے سوال پوچھے گا، پھر آپ کے جوابات سے خاکہ بنائے گا۔",
  category: "authoring",
  arguments: [
    { name: "topic", labelUr: "موضوع", placeholderUr: "مثلاً: کرایہ کے مکان پر زکوٰۃ کا مضمون", required: true },
  ],
  systemInstructionTemplate: `مجھ سے پوچھو: «{{topic}}»

لکھنا شروع کرنے سے پہلے میرا انٹرویو کریں تاکہ موضوع واضح ہو جائے:
- ایک وقت میں صرف ایک سوال پوچھیں، اور میرے جواب کا انتظار کریں۔
- ہر سوال کے ساتھ 2 سے 4 مختصر اختیارات دیں، اور ان میں سے ایک کو "(تجویز کردہ)" لکھیں۔ جہاں ممکن ہو، اختیارات میرے ذرائع پر مبنی ہوں۔
- کل 5 سے 8 سوال کریں۔ میں کسی بھی وقت "کافی ہے" کہوں تو سوال روک دیں۔
- آخر میں میرے جوابات سے ایک خاکہ (عنوانات اور ذیلی نکات) بنائیں۔
- آپ صرف سوال کریں اور خاکہ بنائیں؛ کوئی شرعی حکم یا فتویٰ نہ دیں۔

پہلا سوال پوچھیں۔`,
  grounded: false,
  corpusReady: true,
};
