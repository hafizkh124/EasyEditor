/**
 * 3 Standard Islamic Citation Formatting Styles
 * 1. Traditional/Classical (الأسلوب التقليدي): [الجامع لأحكام القرآن للقرطبي، ج: 5، ص: 120، دار الكتب العلمية]
 * 2. Academic Modern APA/Chicago (الأسلوب الأكاديمي): القرطبي، محمد بن أحمد. (1427هـ). الجامع لأحكام القرآن (ط. 1، مج. 5، ص. 120). القاهرة: دار الكتب المصرية.
 * 3. Short Inline (المختصر داخل النص): (القرطبي، 5/120)
 */

export type CitationStyle = "traditional" | "academic" | "short";

export interface CitationRefData {
  book_title?: string;
  author_name?: string;
  death_year_ah?: number | string;
  volume?: number | string;
  page?: number | string;
  publisher?: string;
  publish_year_ah?: number | string;
  hadith_number?: number | string;
  surah_number?: number | string;
  verse_number?: number | string;
  collection?: string;
}

export function formatCitation(ref: CitationRefData, style: CitationStyle = "traditional"): string {
  const book = ref.book_title || ref.collection || "مصدر إسلامي";
  const author = ref.author_name || "";
  const vol = ref.volume ? `ج: ${ref.volume}` : "";
  const pg = ref.page ? `ص: ${ref.page}` : "";
  const pub = ref.publisher || "";
  const wafat = ref.death_year_ah ? `(ت: ${ref.death_year_ah}هـ)` : "";

  // Handle Quran citations
  if (ref.surah_number && ref.verse_number) {
    if (style === "short") return `[القرآن الكريم: ${ref.surah_number}:${ref.verse_number}]`;
    return `[القرآن الكريم، سورة ${ref.surah_number}، الآية: ${ref.verse_number}]`;
  }

  // Handle Hadith citations
  if (ref.hadith_number && ref.collection) {
    if (style === "short") return `(${ref.collection}، رقم ${ref.hadith_number})`;
    if (style === "academic") return `${author ? author + ". " : ""}${ref.collection}. (رقم الحديث: ${ref.hadith_number}).`;
    return `[${ref.collection}، باب الحديث رقم: ${ref.hadith_number}]`;
  }

  switch (style) {
    case "short": {
      const parts = [author || book];
      if (ref.volume && ref.page) parts.push(`${ref.volume}/${ref.page}`);
      else if (ref.page) parts.push(`ص ${ref.page}`);
      return `(${parts.join("، ")})`;
    }

    case "academic": {
      let result = "";
      if (author) result += `${author}. `;
      if (wafat) result += `${wafat} `;
      result += `${book}. `;
      const loc: string[] = [];
      if (ref.volume) loc.push(`مج. ${ref.volume}`);
      if (ref.page) loc.push(`ص. ${ref.page}`);
      if (loc.length > 0) result += `(${loc.join("، ")}). `;
      if (pub) result += `${pub}.`;
      return result.trim();
    }

    case "traditional":
    default: {
      const parts: string[] = [];
      if (book) parts.push(book);
      if (author) parts.push(`لـ ${author} ${wafat}`.trim());
      if (vol) parts.push(vol);
      if (pg) parts.push(pg);
      if (pub) parts.push(pub);
      return `[${parts.join("، ")}]`;
    }
  }
}
