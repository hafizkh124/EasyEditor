import legalArabic from "@/lib/legalArabic.json";

export type LegalSlug = "terms" | "privacy" | "refund" | "pricing_info";

/**
 * Returns the Arabic-translated HTML body for a given legal page slug.
 * The HTML is professionally translated Modern Standard Arabic and includes
 * <a href="..."> for in-app links (LegalLayout already wraps it in <article>).
 */
export function getLegalArabicHtml(slug: LegalSlug): string {
  return (legalArabic as Record<string, string>)[slug] ?? "";
}
