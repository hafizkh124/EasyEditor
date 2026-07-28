import { supabase } from "@/integrations/supabase/client";

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

export const recipeService = {
  /**
   * List available built-in and custom recipes (SPEC-M4 FR-4.1).
   */
  async listRecipes(): Promise<Recipe[]> {
    try {
      const { data, error } = await (supabase.from("recipes" as any) as any)
        .select("*")
        .order("is_builtin", { ascending: false });

      if (error || !data || data.length === 0) {
        return BUILTIN_RECIPES;
      }
      return data as Recipe[];
    } catch {
      return BUILTIN_RECIPES;
    }
  },
};
