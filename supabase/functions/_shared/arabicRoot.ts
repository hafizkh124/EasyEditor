/**
 * Arabic Root Normalization & Light Stemming Utilities
 * For search query preprocessing, exact phrase matching, and root-based lookup.
 */

// Strip Arabic Diacritics (Fatha, Damma, Kasra, Sukun, Shadda, Tanween, etc.)
export function stripTashkeel(text: string): string {
  if (!text) return "";
  return text.replace(/[\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED]/g, "");
}

// Normalize Hamzas, Alif Maqsoora, Ta Marbuta
export function normalizeHamzaAndAlif(text: string): string {
  if (!text) return "";
  let s = stripTashkeel(text);
  // Alif forms -> 'ا'
  s = s.replace(/[أإآٱ]/g, "ا");
  // Ya / Alif Maqsoora -> 'ي' / 'ى'
  s = s.replace(/ى/g, "ي");
  // Ta Marbuta -> 'ه'
  s = s.replace(/ة/g, "ه");
  // Waw with Hamza -> 'و'
  s = s.replace(/ؤ/g, "و");
  // Ya with Hamza -> 'ي'
  s = s.replace(/ئ/g, "ي");
  return s;
}

// Common Arabic Stopwords to filter out when extracting root candidates
const ARABIC_STOPWORDS = new Set([
  "في", "من", "على", "إلى", "عن", "مع", "هذا", "هذه", "ذلك", "تلك", "الذي", "التي",
  "الذين", "ما", "من", "أن", "إن", "كان", "كانت", "يكون", "هو", "هي", "هم", "هن",
  "أو", "و", "ثم", "بل", "لكن", "حتى", "إذا", "كيف", "أين", "متى", "هل", "قد"
]);

/**
 * Heuristic light stemmer to estimate 3-letter Arabic root for search query expansion.
 */
export function extractLightRoot(word: string): string {
  const norm = normalizeHamzaAndAlif(word).trim();
  if (norm.length <= 3) return norm;

  // Remove common prefixes (ال, ف, ب, ك, ل, و)
  let stem = norm;
  if (stem.startsWith("ال")) stem = stem.slice(2);
  if (stem.length > 3 && (stem.startsWith("و") || stem.startsWith("ف") || stem.startsWith("ب") || stem.startsWith("ك") || stem.startsWith("ل"))) {
    stem = stem.slice(1);
    if (stem.startsWith("ال")) stem = stem.slice(2);
  }

  // Remove common suffixes (ين, ون, ات, هم, ها, كم, نا, ت, ه)
  if (stem.length > 4 && (stem.endsWith("ين") || stem.endsWith("ون") || stem.endsWith("ات") || stem.endsWith("هم") || stem.endsWith("ها") || stem.endsWith("كم") || stem.endsWith("نا"))) {
    stem = stem.slice(0, -2);
  } else if (stem.length > 3 && (stem.endsWith("ت") || stem.endsWith("ه") || stem.endsWith("ة"))) {
    stem = stem.slice(0, -1);
  }

  // Handle common pattern infixes (e.g. مـ, تـ, ا)
  if (stem.length === 4 && stem.startsWith("م")) {
    stem = stem.slice(1);
  }

  return stem;
}

/**
 * Parses Boolean search terms: 'و' (AND), 'أو' (OR), 'دون' (NOT)
 */
export interface ParsedBooleanQuery {
  andTerms: string[];
  orTerms: string[];
  notTerms: string[];
}

export function parseBooleanQuery(query: string): ParsedBooleanQuery {
  const clean = stripTashkeel(query).trim();
  const result: ParsedBooleanQuery = {
    andTerms: [],
    orTerms: [],
    notTerms: [],
  };

  // Split by whitespace
  const tokens = clean.split(/\s+/);
  let mode: "AND" | "OR" | "NOT" = "AND";

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "أو" || t === "او" || t.toLowerCase() === "or") {
      mode = "OR";
      continue;
    }
    if (t === "دون" || t === "ليس" || t.toLowerCase() === "not") {
      mode = "NOT";
      continue;
    }
    if (t === "و" || t.toLowerCase() === "and") {
      mode = "AND";
      continue;
    }

    // Normal term
    const normalized = normalizeHamzaAndAlif(t);
    if (!normalized || ARABIC_STOPWORDS.has(normalized)) continue;

    if (mode === "NOT") {
      result.notTerms.push(normalized);
      mode = "AND";
    } else if (mode === "OR") {
      result.orTerms.push(normalized);
      mode = "AND";
    } else {
      result.andTerms.push(normalized);
    }
  }

  // Fallback if no terms parsed
  if (result.andTerms.length === 0 && result.orTerms.length === 0 && result.notTerms.length === 0) {
    result.andTerms = [normalizeHamzaAndAlif(clean)];
  }

  return result;
}
