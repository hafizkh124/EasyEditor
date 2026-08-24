import {
  CORPUS_BOOKS,
  BOOK_IDS,
  bookLabel,
  booksPromptList,
  detectBooks,
  resolveCollectionSlugs,
  scopeHasArabicMatn,
} from "../../supabase/functions/_shared/collections";
import { coercePlan, fallbackPlan, describeScope } from "../../supabase/functions/_shared/queryPlanner";

/**
 * The collection registry is the allowlist an LLM's scope choice is validated
 * against AND the map from a canonical book id to the strings actually stored
 * in `citation_ref->>'collection'`. Both halves fail silently when wrong — a
 * bad id is dropped and the query quietly widens to the whole corpus; a bad
 * slug matches zero rows and the user sees "کچھ نہیں ملا" for a book that is
 * sitting in the database. Hence the invariants below.
 */
describe("corpus book registry", () => {
  it("has unique ids and no duplicate slug across two books", () => {
    expect(new Set(BOOK_IDS).size).toBe(BOOK_IDS.length);

    const owner = new Map<string, string>();
    for (const book of CORPUS_BOOKS) {
      for (const slug of book.slugs) {
        const prev = owner.get(slug);
        expect(prev, `slug "${slug}" is claimed by both ${prev} and ${book.id}`).toBeUndefined();
        owner.set(slug, book.id);
      }
    }
  });

  it("gives every book a non-empty Urdu label, Arabic title and slug list", () => {
    for (const book of CORPUS_BOOKS) {
      expect(book.ur.trim().length, `${book.id} has no Urdu label`).toBeGreaterThan(0);
      expect(book.ar.trim().length, `${book.id} has no Arabic title`).toBeGreaterThan(0);
      expect(book.slugs.length, `${book.id} has no collection slug`).toBeGreaterThan(0);
      expect(book.domains.length, `${book.id} names no domain`).toBeGreaterThan(0);
      expect(bookLabel(book.id)).toBe(book.ur);
    }
  });

  it("carries the collection strings confirmed against the live corpus", () => {
    // Pulled from data/citation_backup_20260823_141244.csv (33,080 live rows,
    // 2026-08-23). These four are the reason this module exists: the planner's
    // old allowlist offered mishkat / adab / malik / shamail, none of which is
    // what the surviving rows are actually stored under.
    expect(resolveCollectionSlugs(["mishkat"])).toContain("mishkat_almasabih");
    expect(resolveCollectionSlugs(["adab"])).toContain("aladab_almufrad");
    expect(resolveCollectionSlugs(["malik"])).toContain("Muwatta Malik");
    expect(resolveCollectionSlugs(["shamail"])).toContain("shamail_muhammadiyah");
  });

  it("expands a book id to every slug and passes unknown ids through untouched", () => {
    const expanded = resolveCollectionSlugs(["mishkat"]);
    expect(expanded).toEqual(expect.arrayContaining(["mishkat", "mishkat_almasabih", "mishkat-al-masabih"]));
    // A raw DB slug from an older saved plan must not be dropped — dropping it
    // would widen the scope back to the whole corpus, the opposite of the ask.
    expect(resolveCollectionSlugs(["some-legacy-slug"])).toEqual(["some-legacy-slug"]);
    expect(resolveCollectionSlugs([])).toEqual([]);
  });

  it("knows which books have no Arabic matn anywhere in the corpus", () => {
    // search_documents_scoped filters on content_ar IS NOT NULL, so a scope
    // made entirely of arabicMatn:false books must skip it rather than run
    // and time out. As of 2026-08-24 (the tohed-hadith Arabic-gap backfill:
    // sahih-ibn-hibban, darqutni and 9 others re-sourced from IUB with full
    // matn) every book in the registry has arabicMatn:true, so there is no
    // real id to assert the false branch against — verified here instead of
    // hardcoded against a book that might flip back, so this doesn't rot into
    // a test that keeps "passing" against a fact that stopped being true.
    const falseBooks = CORPUS_BOOKS.filter((b) => !b.arabicMatn).map((b) => b.id);
    expect(scopeHasArabicMatn(falseBooks)).toBe(falseBooks.length > 0 ? false : true);
    if (falseBooks.length > 0) {
      // Mixed scope still has something Arabic to find.
      expect(scopeHasArabicMatn([falseBooks[0], "bukhari"])).toBe(true);
    }
    // Empty scope means "everything", which certainly includes Arabic.
    expect(scopeHasArabicMatn([])).toBe(true);
    // An id the registry has never heard of fails open (assumed to have
    // Arabic) rather than silently skipping a search over unknown content.
    expect(scopeHasArabicMatn(["some-book-not-in-the-registry"])).toBe(true);
  });

  it("lists every book in the planner prompt", () => {
    const prompt = booksPromptList();
    for (const book of CORPUS_BOOKS) {
      expect(prompt, `${book.id} missing from the planner prompt`).toContain(book.id);
      expect(prompt).toContain(book.ur);
    }
  });
});

describe("book name detection", () => {
  it("matches the six canonical collections by their Urdu names", () => {
    expect(detectBooks("صحیح بخاری میں قتال کا لفظ")).toEqual(["bukhari"]);
    expect(detectBooks("صحیح مسلم کی روایت")).toEqual(["muslim"]);
    expect(detectBooks("جامع ترمذی میں")).toEqual(["tirmidhi"]);
    expect(detectBooks("سنن ابو داؤد سے حوالہ")).toEqual(["abudawud"]);
    expect(detectBooks("سنن ابن ماجہ")).toEqual(["ibnmajah"]);
    expect(detectBooks("سنن نسائی")).toEqual(["nasai"]);
  });

  it("reaches books the old 17-slug allowlist could never name", () => {
    expect(detectBooks("مستدرک حاکم میں یہ روایت")).toEqual(["mustadrak-hakim"]);
    expect(detectBooks("کنز العمال کا حوالہ")).toEqual(["kanz-ul-ummal"]);
    expect(detectBooks("صحیح ابن حبان")).toEqual(["sahih-ibn-hibban"]);
    expect(detectBooks("السنن الکبریٰ للبیہقی")).toContain("sunan-kubra-bayhaqi");
    expect(detectBooks("مصنف ابن ابی شیبہ")).toEqual(["musannaf-ibn-abi-shaybah"]);
  });

  it("prefers the more specific book when one title contains another", () => {
    // "مختصر صحیح بخاری" matches bukhari on {بخاري} too; only the superset wins.
    expect(detectBooks("مختصر صحیح بخاری میں")).toEqual(["mukhtasar-bukhari"]);
    expect(detectBooks("مختصر صحیح مسلم")).toEqual(["mukhtasar-muslim"]);
    // ...and the plain title must NOT drag the مختصر edition in with it.
    expect(detectBooks("صحیح بخاری میں")).toEqual(["bukhari"]);
  });

  it("does not match on a word that merely contains a book name", () => {
    // The old heuristic tested /مسلم|muslim/ as a substring, so any question
    // about مسلمان scoped the whole search to صحیح مسلم.
    expect(detectBooks("غیر مسلمان اقلیتوں کے حقوق")).toEqual([]);
    expect(detectBooks("داؤد علیہ السلام کا ذکر")).toEqual([]);
    expect(detectBooks("مالک مکان کے حقوق")).toEqual([]);
    expect(detectBooks("احمد نامی راوی")).toEqual([]);
  });

  it("returns nothing for a question that names no book", () => {
    expect(detectBooks("نیت سے متعلق آیات اور احادیث ذکر کریں")).toEqual([]);
    expect(detectBooks("")).toEqual([]);
  });
});

describe("query planner scoping", () => {
  it("keeps a valid canonical id and drops an invented one", () => {
    const plan = coercePlan({
      intent: "topical",
      scope: { source_types: ["hadith"], collections: ["mustadrak-hakim", "not-a-real-book"], surah: null },
      arabic_surface_forms: ["نية"],
      semantic_query_ar: "النية",
    }, "نیت");
    expect(plan.scope.collections).toEqual(["mustadrak-hakim"]);
  });

  it("falls back to the keyword heuristic when the model omits the named book", () => {
    const plan = coercePlan({
      intent: "count",
      scope: { source_types: ["hadith"], collections: [], surah: null },
      arabic_surface_forms: ["قتال"],
      semantic_query_ar: "القتال",
    }, "صحیح بخاری میں قتال کا لفظ کتنی بار آیا ہے؟");
    expect(plan.scope.collections).toEqual(["bukhari"]);
  });

  it("scopes the no-model fallback to books outside the old allowlist", () => {
    const plan = fallbackPlan("مستدرک حاکم میں طہارت کی احادیث");
    expect(plan.scope.collections).toEqual(["mustadrak-hakim"]);
    expect(plan.degraded).toBe(true);
  });

  it("shows the Urdu book name in the scope line, never a raw id", () => {
    for (const book of CORPUS_BOOKS) {
      const plan = coercePlan({
        intent: "topical",
        scope: { source_types: ["hadith"], collections: [book.id], surah: null },
        arabic_surface_forms: ["نية"],
        semantic_query_ar: "النية",
      }, "نیت");
      expect(describeScope(plan)).toBe(book.ur);
    }
  });
});
