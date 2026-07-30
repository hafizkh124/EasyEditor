/**
 * Recipe shape and the three built-ins (SPEC-M4 FR-4.2).
 *
 * Split out of recipeService.ts in M5.0 so the backend layer can read the
 * built-ins without importing the service that now delegates *to* the backend.
 * A value cycle there would leave BUILTIN_RECIPES undefined at module init,
 * and the fallback path would silently return `undefined` instead of a list.
 */

export interface RecipeStep {
  taskSlug: string;
  stepLabel: string;
}

export interface Recipe {
  id: string;
  user_id?: string | null;
  title: string;
  description?: string | null;
  steps: RecipeStep[];
  is_builtin: boolean;
  created_at: string;
}

export const BUILTIN_RECIPES: Recipe[] = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    title: "تفسیر کا موازنہ (Compare Tafsir)",
    description: "کلاسیکی تفاسیر کا تقابلی جائزہ اور اہم نکات کی تلخیص",
    steps: [
      { taskSlug: "summarize_sections", stepLabel: "ابتدائی نصوص کا خلاصہ" },
      { taskSlug: "citations", stepLabel: "حوالہ جات و آیات کی تصدیق" },
      { taskSlug: "formalize", stepLabel: "علمی و فصیح اسلوب میں فائنل نگارش" },
    ],
    is_builtin: true,
    created_at: new Date().toISOString(),
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    title: "اسناد و روایت کی تحقیق (Hadith Sanad Chain)",
    description: "حدیث کی راویوں کی تعداد اور اسناد کا تفصیلی تجزیہ",
    steps: [
      { taskSlug: "citations", stepLabel: "راویوں اور کتابوں کے حوالہ جات" },
      { taskSlug: "humanize", stepLabel: "روانی اور سلیس اردو میں تدوین" },
    ],
    is_builtin: true,
    created_at: new Date().toISOString(),
  },
  {
    id: "00000000-0000-0000-0000-000000000003",
    title: "متعدد مآخذ کی ترسیل و ترکیب (Multi-Source Synthesis)",
    description: "ذاتی کتب خانے اور عالمی ذخیرے سے نتائج کا یکجا جائزہ",
    steps: [
      // `summarize` is scoped to a selection and is not chunkable, so it can
      // never be a whole-document recipe step (see validateRecipe).
      { taskSlug: "summarize_sections", stepLabel: "اہم مباحث کا احاطہ" },
      { taskSlug: "spelling_check", stepLabel: "املائی و لغوی تصحیح" },
      { taskSlug: "add_harakat", stepLabel: "عربی اقتباسات پر اعراب کا لزوم" },
    ],
    is_builtin: true,
    created_at: new Date().toISOString(),
  },
];
