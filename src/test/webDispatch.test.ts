// src/core/agent/webDispatch.ts (M10 Phase 2.1) — the web agent's DispatchFn.
// Mirrors electron/agent/dispatch.ts's own coverage philosophy: each tool's
// real behavior, not just that it returns something. documentService /
// annotationService / libraryItemService are backendFacade proxies designed
// for exactly this — vi.spyOn works directly on them (see trustUi.test.tsx).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { documentService } from "@/core/workspace/documentService";
import { annotationService } from "@/core/workspace/annotationService";
import { libraryItemService } from "@/core/workspace/libraryItemService";
import type { Document } from "@/core/workspace/types";

vi.mock("@/lib/shamela/localShamelaService", () => ({ searchLocalShamela: vi.fn() }));
vi.mock("@/lib/tafsir/tafsirService", () => ({ tafsirCall: vi.fn() }));
vi.mock("@/lib/research/streamers", () => ({ streamIslamicQuery: vi.fn(), streamResearchQuery: vi.fn() }));
vi.mock("@/core/agent/webModel", () => ({ generateWebAgentText: vi.fn() }));

import { searchLocalShamela } from "@/lib/shamela/localShamelaService";
import { tafsirCall } from "@/lib/tafsir/tafsirService";
import { streamIslamicQuery, streamResearchQuery } from "@/lib/research/streamers";
import { generateWebAgentText } from "@/core/agent/webModel";
import { createWebDispatcher, type WebAgentSession } from "@/core/agent/webDispatch";

function doc(overrides: Partial<Document> = {}): Document {
  return {
    id: "doc-1", project_id: "proj-1", user_id: "u1", title: "باب اول",
    doc_type: "chapter", content_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "زکوٰۃ کا بیان" }] }] },
    plain_text: "زکوٰۃ کا بیان", sort_order: 0, status: "draft", word_count: 3,
    created_at: "2026-01-01", updated_at: "2026-01-01",
    ...overrides,
  };
}

function session(overrides: Partial<WebAgentSession> = {}): WebAgentSession {
  return { activeDocumentId: "doc-1", ...overrides };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("webDispatch — list_capabilities", () => {
  it("reports no Word/Windows and web:true, without needing a session document", async () => {
    const { dispatch } = createWebDispatcher(session({ activeDocumentId: null }));
    const r = await dispatch("list_capabilities", {}) as Record<string, unknown>;
    expect(r.word).toBe(false);
    expect(r.web).toBe(true);
  });
});

describe("webDispatch — read_document", () => {
  it("errors when no document is open", async () => {
    const { dispatch } = createWebDispatcher(session({ activeDocumentId: null }));
    const r = await dispatch("read_document", {}) as { error?: string };
    expect(r.error).toMatch(/کوئی دستاویز کھلی نہیں/);
  });

  it("returns the active document's structure, not its body text", async () => {
    vi.spyOn(documentService, "getDocument").mockResolvedValue(doc());
    const { dispatch } = createWebDispatcher(session());
    const r = await dispatch("read_document", {}) as Record<string, unknown>;
    expect(r.title).toBe("باب اول");
    expect(r.wordCount).toBe(3);
    expect(JSON.stringify(r)).not.toContain("زکوٰۃ کا بیان");
  });

  it("resolves a named sibling chapter by title", async () => {
    vi.spyOn(documentService, "getDocument").mockResolvedValue(doc());
    vi.spyOn(documentService, "listDocuments").mockResolvedValue([doc(), doc({ id: "doc-2", title: "باب دوم", plain_text: "دوسرا" })]);
    const { dispatch } = createWebDispatcher(session());
    const r = await dispatch("read_document", { chapter: "باب دوم" }) as Record<string, unknown>;
    expect(r.title).toBe("باب دوم");
  });

  it("errors clearly when the named chapter does not exist", async () => {
    vi.spyOn(documentService, "getDocument").mockResolvedValue(doc());
    vi.spyOn(documentService, "listDocuments").mockResolvedValue([doc()]);
    const { dispatch } = createWebDispatcher(session());
    const r = await dispatch("read_document", { chapter: "غیر موجود" }) as { error?: string };
    expect(r.error).toMatch(/نہیں ملی/);
  });
});

describe("webDispatch — search_corpus", () => {
  it("merges personal-corpus hits with a lexical scan of sibling documents", async () => {
    vi.spyOn(documentService, "getDocument").mockResolvedValue(doc());
    vi.spyOn(documentService, "listDocuments").mockResolvedValue([doc(), doc({ id: "doc-2", title: "باب دوم", plain_text: "یہاں بھی زکوٰۃ کا ذکر ہے" })]);
    vi.spyOn(libraryItemService, "searchChunks").mockResolvedValue([
      { itemId: "lib-1", title: "کتاب الزکوٰۃ", sourceRef: {}, pageNumber: 12, content: "نصاب کا بیان", rank: 1 },
    ]);
    const { dispatch, ledger } = createWebDispatcher(session());
    const r = await dispatch("search_corpus", { query: "زکوٰۃ" }) as { count: number; results: Array<{ reference: string }> };
    // 3 = the library hit + BOTH sibling documents (the active one's own text
    // matches too — the scan does not special-case it out, matching
    // dispatch.ts's own "the open project folder's OWN chapters" behavior).
    expect(r.count).toBe(3);
    expect(r.results.some((x) => x.reference.includes("کتاب الزکوٰۃ"))).toBe(true);
    expect(r.results.some((x) => x.reference === "باب اول")).toBe(true);
    expect(r.results.some((x) => x.reference === "باب دوم")).toBe(true);
    expect(ledger.size).toBe(3);
  });

  it("degrades to zero results (not a throw) when the corpus search fails", async () => {
    vi.spyOn(documentService, "getDocument").mockResolvedValue(doc());
    vi.spyOn(documentService, "listDocuments").mockResolvedValue([doc()]);
    vi.spyOn(libraryItemService, "searchChunks").mockRejectedValue(new Error("db down"));
    const { dispatch } = createWebDispatcher(session());
    const r = await dispatch("search_corpus", { query: "کچھ بھی" }) as { count: number };
    expect(r.count).toBe(0);
  });
});

describe("webDispatch — search_shamela", () => {
  it("returns [] gracefully when the bridge is not reachable, no throw", async () => {
    vi.mocked(searchLocalShamela).mockResolvedValue([]);
    const { dispatch } = createWebDispatcher(session({ activeDocumentId: null }));
    const r = await dispatch("search_shamela", { query: "صلاۃ" }) as { count: number; note?: string };
    expect(r.count).toBe(0);
    expect(r.note).toBeTruthy();
  });

  it("maps a hit's citation_ref into a book+page reference", async () => {
    vi.mocked(searchLocalShamela).mockResolvedValue([
      { content: "نص الحديث", reason: "مکتبہ شاملہ", citation_ref: { book: "صحيح البخاري", page: 45 }, match_key: "shamela-1-45-0" } as never,
    ]);
    const { dispatch, ledger } = createWebDispatcher(session({ activeDocumentId: null }));
    const r = await dispatch("search_shamela", { query: "صلاۃ" }) as { count: number; results: Array<{ reference: string }> };
    expect(r.count).toBe(1);
    expect(r.results[0].reference).toContain("صحيح البخاري");
    expect(ledger.size).toBe(1);
  });
});

describe("webDispatch — insert_footnote", () => {
  it("throws through the ledger's own integrity gate for an unresolved source_id", async () => {
    vi.spyOn(documentService, "getDocument").mockResolvedValue(doc());
    const { dispatch } = createWebDispatcher(session());
    await expect(dispatch("insert_footnote", { chapter: "باب اول", marker: "[1]", source_id: "nope" }))
      .rejects.toThrow(/nothing has been retrieved/);
  });

  it("records notFound when the marker text is not in the document, without erroring", async () => {
    vi.spyOn(documentService, "getDocument").mockResolvedValue(doc());
    vi.spyOn(documentService, "listDocuments").mockResolvedValue([doc()]);
    vi.spyOn(libraryItemService, "searchChunks").mockResolvedValue([
      { itemId: "lib-1", title: "المصدر", sourceRef: {}, pageNumber: 1, content: "c", rank: 1 },
    ]);
    const { dispatch } = createWebDispatcher(session());
    await dispatch("search_corpus", { query: "زکوٰۃ" });
    const r = await dispatch("insert_footnote", { chapter: "باب اول", marker: "[9]", source_id: "corpus:lib-1:1" }) as { applied: number; notFound: string[] };
    expect(r.applied).toBe(0);
    expect(r.notFound).toEqual(["[9]"]);
  });

  it("applies and emits a citation artifact when the marker IS present, without mutating the document", async () => {
    vi.spyOn(documentService, "getDocument").mockResolvedValue(doc({ plain_text: "زکوٰۃ کا بیان [1]" }));
    vi.spyOn(documentService, "listDocuments").mockResolvedValue([doc({ plain_text: "زکوٰۃ کا بیان [1]" })]);
    const updateSpy = vi.spyOn(documentService, "updateDocument");
    vi.spyOn(libraryItemService, "searchChunks").mockResolvedValue([
      { itemId: "lib-1", title: "المصدر", sourceRef: {}, pageNumber: 1, content: "c", rank: 1 },
    ]);
    const emitted: unknown[] = [];
    const { dispatch } = createWebDispatcher(session({ emitArtifact: (ev) => emitted.push(ev) }));
    await dispatch("search_corpus", { query: "زکوٰۃ" });
    const r = await dispatch("insert_footnote", { chapter: "باب اول", marker: "[1]", source_id: "corpus:lib-1:1" }) as { applied: number };
    expect(r.applied).toBe(1);
    expect(emitted.some((e) => (e as { op?: string }).op === "citations")).toBe(true);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe("webDispatch — add_document_comment", () => {
  it("does not create an annotation when the anchor text is not found", async () => {
    vi.spyOn(documentService, "getDocument").mockResolvedValue(doc({ plain_text: "کچھ اور متن" }));
    const createSpy = vi.spyOn(annotationService, "createAnnotation").mockResolvedValue(null);
    const { dispatch } = createWebDispatcher(session());
    const r = await dispatch("add_document_comment", { chapter: "باب اول", anchor_text: "زکوٰۃ کا بیان", comment: "نوٹ" }) as { added: boolean; notFound: boolean };
    expect(r.notFound).toBe(true);
    expect(r.added).toBe(false);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("creates a quote-anchored annotation when the anchor text IS found", async () => {
    vi.spyOn(documentService, "getDocument").mockResolvedValue(doc());
    const createSpy = vi.spyOn(annotationService, "createAnnotation").mockResolvedValue({ id: "a1" } as never);
    const { dispatch } = createWebDispatcher(session());
    const r = await dispatch("add_document_comment", { chapter: "باب اول", anchor_text: "زکوٰۃ کا بیان", comment: "نوٹ" }) as { added: boolean };
    expect(r.added).toBe(true);
    expect(createSpy).toHaveBeenCalledWith({ documentId: "doc-1", quote: "زکوٰۃ کا بیان", note: "نوٹ" });
  });
});

describe("webDispatch — check_consistency", () => {
  it("finds a term across sibling documents, excluding the named chapter", async () => {
    vi.spyOn(documentService, "getDocument").mockResolvedValue(doc());
    vi.spyOn(documentService, "listDocuments").mockResolvedValue([
      doc(), doc({ id: "doc-2", title: "باب دوم", plain_text: "نصاب کا ذکر یہاں بھی ہے" }),
    ]);
    const { dispatch } = createWebDispatcher(session());
    const r = await dispatch("check_consistency", { term: "نصاب", exclude_chapter: "باب اول" }) as { appearsIn: Array<{ chapter: string }> };
    expect(r.appearsIn).toHaveLength(1);
    expect(r.appearsIn[0].chapter).toBe("باب دوم");
  });
});

describe("webDispatch — create_chapter", () => {
  it("creates a new sibling document in the active document's project", async () => {
    vi.spyOn(documentService, "getDocument").mockResolvedValue(doc());
    const createSpy = vi.spyOn(documentService, "createDocument").mockResolvedValue(doc({ id: "doc-3", title: "باب سوم" }));
    const { dispatch } = createWebDispatcher(session());
    const r = await dispatch("create_chapter", { name: "باب سوم", html: "<p>نیا مواد</p>" }) as { chapter: string; id: string };
    expect(r.chapter).toBe("باب سوم");
    expect(createSpy).toHaveBeenCalledWith("proj-1", "باب سوم", expect.any(Object));
  });

  it("errors when there is no active project to create into", async () => {
    const { dispatch } = createWebDispatcher(session({ activeDocumentId: null }));
    const r = await dispatch("create_chapter", { name: "باب" }) as { error?: string };
    expect(r.error).toMatch(/کوئی پراجیکٹ کھلا نہیں/);
  });
});

describe("webDispatch — draft_section", () => {
  it("writes through insertIntoCanvas when the target IS the mounted document", async () => {
    vi.spyOn(documentService, "getDocument").mockResolvedValue(doc());
    const updateSpy = vi.spyOn(documentService, "updateDocument");
    vi.mocked(generateWebAgentText).mockResolvedValue("یہ ایک نیا مسودہ ہے۔");
    const insertSpy = vi.fn();
    const { dispatch } = createWebDispatcher(session({ insertIntoCanvas: insertSpy }));
    const r = await dispatch("draft_section", { chapter: "باب اول", mode: "outline" }) as { chapter: string };
    expect(r.chapter).toBe("باب اول");
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("writes straight to the DB when the target is NOT the mounted document", async () => {
    vi.spyOn(documentService, "getDocument").mockResolvedValue(doc());
    vi.spyOn(documentService, "listDocuments").mockResolvedValue([doc(), doc({ id: "doc-2", title: "باب دوم", plain_text: "" })]);
    const updateSpy = vi.spyOn(documentService, "updateDocument").mockResolvedValue(doc({ id: "doc-2" }));
    vi.mocked(generateWebAgentText).mockResolvedValue("مسودہ متن");
    const insertSpy = vi.fn();
    const { dispatch } = createWebDispatcher(session({ insertIntoCanvas: insertSpy }));
    await dispatch("draft_section", { chapter: "باب دوم", mode: "outline" });
    expect(insertSpy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledWith("doc-2", expect.objectContaining({ content_json: expect.any(Object) }));
  });

  it("requires source_ids for a grounded mode", async () => {
    vi.spyOn(documentService, "getDocument").mockResolvedValue(doc());
    const { dispatch } = createWebDispatcher(session());
    const r = await dispatch("draft_section", { chapter: "باب اول", mode: "prose" }) as { error?: string };
    expect(r.error).toBeTruthy();
    expect(generateWebAgentText).not.toHaveBeenCalled();
  });

  it("mode 'fatwa' requires question, and never calls the model without it (M12 Phase E)", async () => {
    vi.spyOn(documentService, "getDocument").mockResolvedValue(doc());
    const { dispatch } = createWebDispatcher(session());
    const r = await dispatch("draft_section", { chapter: "باب اول", mode: "fatwa" }) as { error?: string };
    expect(r.error).toMatch(/question/);
    expect(generateWebAgentText).not.toHaveBeenCalled();
  });

  it("mode 'fatwa' wraps the model's ruling in the deterministic shell, with the calc result's own figures verbatim", async () => {
    vi.spyOn(documentService, "getDocument").mockResolvedValue(doc());
    vi.mocked(generateWebAgentText).mockResolvedValue("<p>یہ زکوٰۃ واجب ہے۔</p>");
    const insertSpy = vi.fn();
    const { dispatch } = createWebDispatcher(session({ insertIntoCanvas: insertSpy }));
    const resultJson = JSON.stringify({ lines: [{ label: "نقد", value: 100000, zakatable: 100000, dalil: "x" }], zakatDue: 2500, note: "یہ فتویٰ نہیں۔" });
    await dispatch("draft_section", { chapter: "باب اول", mode: "fatwa", question: "کیا زکوٰۃ واجب ہے؟", result_json: resultJson });
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const written = insertSpy.mock.calls[0][0] as string;
    expect(written).toContain("بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ");
    expect(written).toContain("کیا زکوٰۃ واجب ہے؟");
    expect(written).toContain("2500");
    expect(written).toContain("یہ زکوٰۃ واجب ہے۔");
  });

  it("mode 'fatwa' rejects malformed result_json without throwing", async () => {
    vi.spyOn(documentService, "getDocument").mockResolvedValue(doc());
    const { dispatch } = createWebDispatcher(session());
    const r = await dispatch("draft_section", { chapter: "باب اول", mode: "fatwa", question: "س", result_json: "{nope" }) as { error?: string };
    expect(r.error).toMatch(/JSON/);
    expect(generateWebAgentText).not.toHaveBeenCalled();
  });
});

describe("webDispatch — search_hadith / search_general (direct client calls, no bridge)", () => {
  it("search_hadith turns citation_ref entries into ledger chunks", async () => {
    vi.mocked(streamIslamicQuery).mockImplementation(async (opts) => {
      opts.onSourcesReady?.(1, [], [
        { domain: "sunnah", citation_ref: { collection: "صحيح مسلم", hadith_number: 1 }, url: null } as never,
      ]);
      opts.onDelta("جواب کا متن");
      opts.onDone();
    });
    const { dispatch, ledger } = createWebDispatcher(session({ activeDocumentId: null }));
    const r = await dispatch("search_hadith", { query: "نیت" }) as { count: number; answer: string };
    expect(r.count).toBe(1);
    expect(r.answer).toContain("جواب کا متن");
    expect(ledger.size).toBe(1);
  });

  it("search_general never adds to the ledger, even with a real answer", async () => {
    vi.mocked(streamResearchQuery).mockImplementation(async (opts) => {
      opts.onDelta("عمومی جواب");
      opts.onDone();
    });
    const { dispatch, ledger } = createWebDispatcher(session({ activeDocumentId: null }));
    const r = await dispatch("search_general", { query: "کچھ بھی" }) as { answer: string };
    expect(r.answer).toContain("عمومی جواب");
    expect(ledger.size).toBe(0);
  });
});

describe("webDispatch — query_tafseer", () => {
  it("resolves an ayah reference and returns a citable chunk", async () => {
    vi.mocked(tafsirCall).mockResolvedValue({ tool: "fetch_ayah", text: "متن الآية", length: 1, truncated: false });
    const { dispatch, ledger } = createWebDispatcher(session({ activeDocumentId: null }));
    const r = await dispatch("query_tafseer", { reference: "2:255", mode: "ayah" }) as { count: number };
    expect(r.count).toBe(1);
    expect(ledger.size).toBe(1);
  });

  it("errors clearly on an unparseable ayah reference", async () => {
    const { dispatch } = createWebDispatcher(session({ activeDocumentId: null }));
    const r = await dispatch("query_tafseer", { reference: "not-an-ayah", mode: "ayah" }) as { error?: string };
    expect(r.error).toBeTruthy();
  });
});

describe("webDispatch — calculate_zakat / calculate_faraid (M12 Phase C, full web parity)", () => {
  it("calculate_zakat runs the real engine and emits a table artifact", async () => {
    const emitted: Array<Record<string, unknown>> = [];
    const { dispatch } = createWebDispatcher(session({ activeDocumentId: null, emitArtifact: (ev) => emitted.push(ev as Record<string, unknown>) }));
    const input = JSON.stringify({
      hawlMet: true,
      nisab: { goldPricePerGram: 20000, silverPricePerGram: 250, standard: "silver" },
      cash: 1_000_000,
    });
    const r = await dispatch("calculate_zakat", { input }) as { zakatDue: number; nisabMet: boolean; note: string };
    expect(r.nisabMet).toBe(true);
    expect(r.zakatDue).toBe(25_000);
    expect(r.note).toMatch(/فتویٰ نہیں/);
    expect(emitted.some((e) => e.op === "table")).toBe(true);
  });

  it("calculate_zakat rejects malformed JSON without throwing", async () => {
    const { dispatch } = createWebDispatcher(session({ activeDocumentId: null }));
    const r = await dispatch("calculate_zakat", { input: "{not json" }) as { error?: string };
    expect(r.error).toMatch(/JSON/);
  });

  it("calculate_faraid runs the real engine and emits a table artifact", async () => {
    const emitted: Array<Record<string, unknown>> = [];
    const { dispatch } = createWebDispatcher(session({ activeDocumentId: null, emitArtifact: (ev) => emitted.push(ev as Record<string, unknown>) }));
    const input = JSON.stringify({ heirs: { wife: 1, son: 1 } });
    const r = await dispatch("calculate_faraid", { input }) as { lines: Array<{ heir: string; fraction: string }>; note: string };
    expect(r.lines.find((l) => l.heir === "wife")?.fraction).toBe("1/8");
    expect(r.lines.find((l) => l.heir === "son")?.fraction).toBe("7/8");
    expect(r.note).toMatch(/فتویٰ نہیں/);
    expect(emitted.some((e) => e.op === "table")).toBe(true);
  });

  it("calculate_faraid rejects malformed JSON without throwing", async () => {
    const { dispatch } = createWebDispatcher(session({ activeDocumentId: null }));
    const r = await dispatch("calculate_faraid", { input: "nope" }) as { error?: string };
    expect(r.error).toMatch(/JSON/);
  });
});

describe("webDispatch — not-yet-available-on-web tools degrade gracefully", () => {
  it.each(["transcribe_media", "ocr_document", "extract_author_voice", "compile_ai_disclosure", "run_playbook"])(
    "%s returns a clear error, never throws",
    async (tool) => {
      const { dispatch } = createWebDispatcher(session({ activeDocumentId: null }));
      const r = await dispatch(tool, {}) as { error?: string };
      expect(r.error).toBeTruthy();
    },
  );
});

describe("webDispatch — default", () => {
  it("an unknown tool name returns an error, not a throw", async () => {
    const { dispatch } = createWebDispatcher(session({ activeDocumentId: null }));
    const r = await dispatch("nonexistent_tool", {}) as { error?: string };
    expect(r.error).toMatch(/unknown tool/);
  });
});
