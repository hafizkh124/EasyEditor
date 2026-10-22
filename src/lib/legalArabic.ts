import legalArabic from "@/lib/legalArabic.json";
import { PLAN_TIERS, buildFeatures } from "@/lib/planTiers";
import { translate } from "@/lib/i18n";

export type LegalSlug = "terms" | "privacy" | "refund" | "pricing_info";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The pricing page's plan rows, from the same plan list the English page and the app use. */
function planRowsHtml(): string {
  const t = (key: Parameters<typeof translate>[1]) => translate("ar", key);
  return PLAN_TIERS.map((tier) => {
    const features = buildFeatures(tier.featureTemplates, t)
      .filter((f) => f.included)
      .map((f) => `<li>• ${escapeHtml(f.label)}</li>`)
      .join("");
    return (
      `<tr class="border-t border-border">` +
      `<td class="p-3 font-semibold capitalize">${escapeHtml(tier.id)}${tier.popular ? " ⭐" : ""}</td>` +
      `<td class="p-3 text-primary font-semibold">${escapeHtml(tier.priceUsd)} / شهر</td>` +
      `<td class="p-3 text-foreground/90">${escapeHtml(tier.price)} / شهر</td>` +
      `<td class="p-3 text-foreground/90"><ul class="space-y-1">${features}</ul></td>` +
      `</tr>`
    );
  }).join("");
}

/**
 * Returns the Arabic-translated HTML body for a given legal page slug.
 * The HTML is professionally translated Modern Standard Arabic and includes
 * <a href="..."> for in-app links (LegalLayout already wraps it in <article>).
 * Plan rows are filled in from the plan list, so the table never goes stale.
 */
export function getLegalArabicHtml(slug: LegalSlug): string {
  const html = (legalArabic as Record<string, string>)[slug] ?? "";
  return html.replace("<!--PLAN_ROWS-->", planRowsHtml);
}
