// Trusted scholarly domains for Islamic & General research modes.
// Custom Sources mode bypasses this whitelist (user takes responsibility).
// Keep in sync with `supabase/functions/domain-scrape/index.ts` DOMAINS
// and `supabase/functions/research-query/index.ts` SCRAPING_WHITELIST.
//
// M9 ADR-0022 (2026-09-04) — widened to the international fiqh academies and
// the national dar al-ifta bodies. Every candidate was fetched with THIS
// pipeline's own User-Agent ("Mozilla/5.0 (compatible; ResearchBot/1.0)") and
// kept only when it returned readable article HTML. Deliberately NOT added,
// with the reason each was rejected:
//   alifta.gov.sa  — 200, but a JS-rendered shell (~130 chars of text)
//   islamway.net   — 200 with an EMPTY body, to every User-Agent tried
//   cii.gov.pk     — no A/AAAA record; the zone is delegated but offline
export const SCRAPING_WHITELIST = [
  "alulama.org",
  "magazine.mohaddis.com",
  "mohaddis.org",
  "urdufatwa.com",
  "islamfort.com",
  "alminasa.ai",
  "shamela.ws",
  "islamicurdubooks.com",
  "islamqa.info",
  "islamweb.net",
  "shamilaurdu.com",
  // International fiqh academies + national dar al-ifta bodies.
  "iifa-aifi.org",         // مجمع الفقه الإسلامي الدولي (OIC) — resolutions + news
  "dar-alifta.org",        // دار الإفتاء المصرية — /ar/fatwa/details/<id>/<slug>
  "aliftaa.jo",            // دائرة الإفتاء الأردنية — /research-fatwas/<id>/<slug>
  "binbaz.org.sa",         // فتاوى الشيخ ابن باز — /fatwas/<id>/<slug> (the slug is required)
  "banuri.edu.pk",         // جامعہ بنوری ٹاؤن، دار الافتاء — /readquestion/<id>/<date>
  "darulifta-deoband.com", // دار الافتاء دیوبند — registered in domain-scrape's DOMAINS
];

export function isWhitelistedUrl(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
    return SCRAPING_WHITELIST.some(
      (d) => host === d || host.endsWith("." + d),
    );
  } catch {
    return false;
  }
}

export const WHITELIST_REJECTION_MESSAGE =
  "معذرت، اسلامی اور جنرل ریسرچ کے لیے ہم صرف مستند علمی ذرائع سے معلومات لینے کے پابند ہیں۔";

export const CUSTOM_SOURCE_WARNING =
  "آپ ایک بیرونی ذریعہ استعمال کر رہے ہیں۔ اس مواد کی صداقت آپ کی ذمہ داری ہے۔";
