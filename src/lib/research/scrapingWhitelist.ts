// Trusted scholarly domains for Islamic & General research modes.
// Custom Sources mode bypasses this whitelist (user takes responsibility).
// Keep in sync with `supabase/functions/domain-scrape/index.ts` DOMAINS
// and `supabase/functions/research-query/index.ts` SCRAPING_WHITELIST.
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
