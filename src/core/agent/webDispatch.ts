/**
 * M10 Phase 2.1 — the web agent's `DispatchFn` (ADR-0034 follow-up).
 *
 * The web counterpart of electron/agent/dispatch.ts. The desktop dispatcher
 * runs in the Electron MAIN process and needs renderer callbacks to reach
 * browser-only work (a signed-in research call, Web Audio decode, pdf.js);
 * this one runs directly IN the browser, so most of those tools call the
 * same underlying client code with no bridge at all.
 *
 * The desktop project is a FOLDER of chapter .docx files; the web project is
 * ONE cloud document plus its siblings in the same `project_id` (ADR-0034's
 * "single cloud document, not a folder" framing — see systemPrompt.ts's
 * buildWebSystemPrompt). `chapter` arguments are resolved by TITLE against
 * that project's documents, with the currently-open Canvas document as the
 * default target.
 *
 * NATIVE_ONLY_TOOLS (shared/agent/toolScoping.ts) are never offered to the
 * model on web, so their cases do not exist here; the `default` branch is
 * only a defensive fallback.
 *
 * What is NOT yet implemented (returns a clear "not available on web yet"
 * message, same shape the desktop dispatcher already uses for a missing
 * renderer capability): transcribe_media, ocr_document, extract_author_voice,
 * compile_ai_disclosure, run_playbook. None of these remove capability that
 * existed before this file — they are new-on-web gaps, not regressions.
 */
import { generateJSON } from "@tiptap/core";
import { buildEditorExtensions } from "@/components/editor/editorExtensions";
import { documentService } from "@/core/workspace/documentService";
import { annotationService } from "@/core/workspace/annotationService";
import { libraryItemService } from "@/core/workspace/libraryItemService";
import { searchLocalShamela } from "@/lib/shamela/localShamelaService";
import { tafsirCall } from "@/lib/tafsir/tafsirService";
import { streamIslamicQuery, streamResearchQuery } from "@/lib/research/streamers";
import type { Document } from "@/core/workspace/types";
import type { CitationItem } from "~shared/research/citationTypes";
import { formatScholarlyRef } from "~shared/research/citationTypes";
import { parseAyahRef, surahLabel } from "~shared/quran/surahNames";
import { RetrievalLedger, assertClaimSupported, type RetrievedChunk } from "~shared/agent/grounding";
import { runAgentLoop } from "~shared/agent/loop";
import { buildResearchSubagentPrompt } from "~shared/agent/systemPrompt";
import { AGENT_TOOLS } from "~shared/agent/toolSchemas";
import { buildCritiqueInstruction, buildCritiqueInput, CRITIQUE_KINDS, type CritiqueKind } from "~shared/ai/prompts/critique";
import { getDraftMode, buildDraftInput, type DraftMode } from "~shared/ai/prompts/draftSection";
import { generateWebAgentText } from "@/core/agent/webModel";
import { normaliseArchive, normaliseOpenAlex } from "~shared/research/repositories";
import type { DispatchFn, EmitArtifactFn, ModelFn } from "~shared/agent/types";

const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || v.trim() === "") throw new Error(`${name} must be a non-empty string`);
  return v;
};
const num = (v: unknown, dflt: number): number => (typeof v === "number" && Number.isFinite(v) ? v : dflt);

/** ADR-0027 F4 — no single tool result floods the context window (mirrors dispatch.ts). */
const MAX_TOOL_RESULT_CHARS = 6000;
const capResult = (text: string): string =>
  text.length <= MAX_TOOL_RESULT_CHARS ? text : `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n…[truncated]`;

const NOT_ON_WEB = (tool: string): { error: string } => ({
  error: `"${tool}" ابھی ویب پر دستیاب نہیں — یہ ڈیسک ٹاپ ایپ میں کام کرتا ہے۔`,
});

export interface WebAgentSession {
  /** The document currently open in the Canvas, or null. The web agent's
   *  anchor — analogous to desktop's open project folder. */
  activeDocumentId: string | null;
  /**
   * Insert generated HTML into the LIVE Canvas editor — the exact mechanism
   * "Canvas میں داخل کریں" already uses (WorkspaceContext.insertIntoCanvas).
   * Used ONLY when writing to the document currently mounted there, so the
   * live editor's own autosave persists it — this avoids a background DB
   * write racing a mounted editor's next save and one clobbering the other.
   * Null when no workspace/editor is mounted (e.g. the standalone /research
   * page) — writes then go straight to the DB via documentService.
   */
  insertIntoCanvas?: ((html: string) => void) | null;
  emitArtifact?: EmitArtifactFn | null;
  /** This platform's ModelFn — passed through for research_topic's bounded sub-run. */
  model?: ModelFn | null;
  isCancelled?: (() => boolean) | null;
  /** Plan §4.5 — corpus refs (`corpus:<uuid>`) search_corpus is restricted to. */
  bookScope?: string[];
}

export interface WebDispatcher {
  dispatch: DispatchFn;
  ledger: RetrievalLedger;
}

/** HTML → TipTap JSON, off the live editor's own schema (applyResult.ts's pattern). */
function htmlToJson(html: string): Record<string, unknown> {
  return generateJSON(html, buildEditorExtensions()) as Record<string, unknown>;
}

/** Append new HTML content onto an existing TipTap doc's top-level children. */
function appendContent(existing: Record<string, unknown>, html: string): Record<string, unknown> {
  const added = htmlToJson(html);
  const existingContent = Array.isArray(existing.content) ? existing.content : [];
  const addedContent = Array.isArray(added.content) ? added.content : [];
  return { ...existing, type: existing.type ?? "doc", content: [...existingContent, ...addedContent] };
}

function paragraphsToHtml(text: string): string {
  const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string));
  return text.split(/\n{2,}|\r?\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join("\n");
}

export function createWebDispatcher(session: WebAgentSession): WebDispatcher {
  const ledger = new RetrievalLedger();
  const emitArtifact: EmitArtifactFn = (ev) => { try { session.emitArtifact?.(ev); } catch { /* non-fatal */ } };

  // Resolved once per dispatcher (one per agent.run()), same lifecycle as
  // desktop's per-run dispatcher. Null projectId ⇒ no active document at all.
  let activeDocPromise: Promise<Document | null> | null = null;
  const activeDoc = (): Promise<Document | null> => {
    if (!session.activeDocumentId) return Promise.resolve(null);
    if (!activeDocPromise) activeDocPromise = documentService.getDocument(session.activeDocumentId);
    return activeDocPromise;
  };

  /** Resolve a "chapter" name to a Document: the active one by default/title match, else a sibling by title. */
  const resolveChapter = async (name?: string): Promise<Document | { error: string }> => {
    const active = await activeDoc();
    if (!active) return { error: "کوئی دستاویز کھلی نہیں — پہلے Canvas میں ایک دستاویز کھولیں یا create_chapter سے نئی بنائیں۔" };
    if (!name || name.trim() === active.title) return active;
    const siblings = await documentService.listDocuments(active.project_id);
    const match = siblings.find((d) => d.title === name.trim());
    if (!match) return { error: `"${name}" اس پراجیکٹ میں نہیں ملی — دستیاب: ${siblings.map((d) => d.title).join("، ") || "(کوئی نہیں)"}` };
    return match;
  };

  /** Write generated HTML into a document — via the live editor when it's the
   *  one currently mounted, else straight to the DB (see WebAgentSession doc). */
  const writeInto = async (doc: Document, html: string, mode: "append" | "replace"): Promise<void> => {
    if (session.activeDocumentId === doc.id && session.insertIntoCanvas) {
      session.insertIntoCanvas(html);
      return;
    }
    const nextJson = mode === "append" ? appendContent(doc.content_json ?? { type: "doc", content: [] }, html) : htmlToJson(html);
    await documentService.updateDocument(doc.id, { content_json: nextJson });
  };

  const dispatch: DispatchFn = async (name, args) => {
    switch (name) {
      case "list_capabilities": {
        return {
          summary: "ویب — کوئی مقامی Word/Shamela انسٹالیشن نہیں؛ کلاؤڈ کارپس، تفسیر، اور اس دستاویز پر لکھنا دستیاب ہے۔",
          word: false, windows: false, web: true,
        };
      }

      case "read_document": {
        const doc = await resolveChapter(typeof args.chapter === "string" ? args.chapter : undefined);
        if ("error" in doc) return doc;
        const headingCount = countHeadings(doc.content_json);
        return {
          title: doc.title, wordCount: doc.word_count, headings: headingCount,
          status: doc.status,
          note: "یہ صرف ساخت ہے (عنوانات/الفاظ کی گنتی) — متن کے لیے search_corpus استعمال کریں۔",
        };
      }

      case "search_corpus": {
        const query = str(args.query, "query");
        const limit = Math.min(num(args.limit, 8), 12);

        // Plan §4.5 — a `#corpus:<uuid>` scope restricts search_corpus to those items.
        const scopedItemIds = new Set(
          (session.bookScope ?? [])
            .filter((r) => r.startsWith("corpus:"))
            .map((r) => r.slice("corpus:".length)),
        );
        let hits: Awaited<ReturnType<typeof libraryItemService.searchChunks>> = [];
        try { hits = await libraryItemService.searchChunks(query, scopedItemIds.size ? limit * 4 : limit); } catch { /* degrade to zero */ }
        if (scopedItemIds.size) hits = hits.filter((h) => scopedItemIds.has(h.itemId)).slice(0, limit);
        const chunks: RetrievedChunk[] = hits.map((h) => ({
          id: `corpus:${h.itemId}:${h.pageNumber ?? 0}`,
          reference: h.pageNumber ? `${h.title}, p. ${h.pageNumber}` : h.title,
          content: h.content,
        }));

        // The open project's own sibling documents — a lexical scan, mirroring
        // desktop's project-chapters branch.
        const active = await activeDoc();
        if (active) {
          const siblings = await documentService.listDocuments(active.project_id).catch(() => [active]);
          for (const d of siblings) {
            const text = d.plain_text ?? "";
            const idx = text.toLowerCase().indexOf(query.toLowerCase());
            if (idx === -1) continue;
            const excerpt = text.slice(Math.max(0, idx - 120), idx + query.length + 280).replace(/\s+/g, " ").trim();
            chunks.push({ id: `doc:${d.id}`, reference: d.title, content: excerpt });
          }
        }

        ledger.add(chunks);
        return {
          count: chunks.length,
          note: chunks.length === 0 ? "ذاتی کارپس یا کھلی دستاویزات میں کچھ نہیں ملا۔" : undefined,
          results: chunks.slice(0, limit).map((c) => ({ id: c.id, reference: c.reference, excerpt: (c.content ?? "").slice(0, 350) })),
        };
      }

      case "search_shamela": {
        const query = str(args.query, "query");
        const limit = Math.min(num(args.limit, 8), 12);
        const hits = await searchLocalShamela(query, limit).catch(() => []);
        const chunks: RetrievedChunk[] = hits.map((h, i) => ({
          id: h.match_key ?? `shamela:${i}`,
          reference: h.citation_ref?.book
            ? `${h.citation_ref.book}${h.citation_ref.page != null ? `، ص ${h.citation_ref.page}` : ""}`
            : (h.reason ?? "مکتبہ شاملہ"),
          content: h.content,
        }));
        ledger.add(chunks);
        return {
          count: chunks.length,
          note: chunks.length === 0 ? "شاملہ بریج فی الحال نہیں چل رہا، یا کچھ نہیں ملا۔" : undefined,
          results: chunks.map((c) => ({ id: c.id, reference: c.reference, excerpt: (c.content ?? "").slice(0, 350) })),
        };
      }

      case "query_tafseer": {
        const reference = str(args.reference, "reference");
        const mode = str(args.mode, "mode") as "ayah" | "tafsir" | "nuzool" | "word" | "search";
        const sources = Array.isArray(args.sources) ? args.sources.filter((s): s is string => typeof s === "string") : undefined;
        const r = await webQueryTafseer({ reference, mode, sources, query: typeof args.query === "string" ? args.query : undefined });
        if (r.error) return { error: r.error };
        ledger.add(r.chunks);
        if (r.chunks.length) {
          const artifactId = `tafsir-${Date.now().toString(36)}`;
          emitArtifact({ op: "open", artifactId, title: r.chunks[0].reference, artifactType: "document" });
          emitArtifact({ op: "delta", artifactId, mode: "replace", text: r.text });
          emitArtifact({ op: "citations", artifactId, entries: r.chunks.map((c, i) => ({ marker: String(i + 1), reference: c.reference, sourceId: c.id, supported: true, tier: 1, excerpt: (c.content ?? "").slice(0, 500) || undefined })) });
          emitArtifact({ op: "close", artifactId, status: "final" });
        }
        return { count: r.chunks.length, note: r.note, text: capResult(r.text), results: r.chunks.map((c) => ({ id: c.id, reference: c.reference, excerpt: (c.content ?? "").slice(0, 400) })) };
      }

      case "search_hadith": {
        const query = str(args.query, "query");
        const { answer, citations, error } = await runIslamicQuery(query);
        if (error) return { error };
        const chunks: RetrievedChunk[] = [];
        for (const c of citations) {
          const ref = formatScholarlyRef(c.citation_ref, c.domain);
          if (!ref) continue;
          const n = c.citation_ref.hadith_number ?? c.citation_ref.fatwa_number ?? chunks.length + 1;
          chunks.push({ id: `${c.domain}:${c.citation_ref.collection ?? c.citation_ref.book ?? "x"}:${n}`, reference: ref, source_url: c.url ?? c.citation_ref.url ?? null });
        }
        ledger.add(chunks);
        if (chunks.length) {
          const artifactId = `hadith-${Date.now().toString(36)}`;
          emitArtifact({ op: "open", artifactId, title: `احادیث: ${query.slice(0, 40)}`, artifactType: "citation-list" });
          emitArtifact({ op: "citations", artifactId, entries: chunks.map((c, i) => ({ marker: String(i + 1), reference: c.reference, sourceId: c.id, supported: true, url: c.source_url ?? undefined, tier: 1 })) });
          emitArtifact({ op: "close", artifactId, status: "final" });
        }
        return { count: chunks.length, note: chunks.length === 0 ? "جواب ملا مگر صفحہ-درست حوالہ نہیں۔" : undefined, answer: capResult(answer.trim()), results: chunks.map((c) => ({ id: c.id, reference: c.reference, url: c.source_url ?? undefined })) };
      }

      case "search_repositories": {
        const query = str(args.query, "query");
        const repo = typeof args.repo === "string" ? args.repo : "all";
        const limit = num(args.limit, 5);
        const r = await webSearchRepositories(query, repo, limit);
        if (r.error) return { error: r.error };
        ledger.add(r.chunks);
        if (r.chunks.length) {
          const artifactId = `repos-${Date.now().toString(36)}`;
          emitArtifact({ op: "open", artifactId, title: `مراجع: ${query.slice(0, 40)}`, artifactType: "citation-list" });
          emitArtifact({ op: "citations", artifactId, entries: r.chunks.map((c, i) => ({ marker: String(i + 1), reference: c.reference, sourceId: c.id, url: c.source_url ?? undefined, tier: 2 })) });
          emitArtifact({ op: "close", artifactId, status: "final" });
        }
        return { count: r.chunks.length, note: r.note, results: r.chunks.map((c) => ({ id: c.id, reference: capResult(c.reference), url: c.source_url ?? undefined, bibliographic: true })) };
      }

      case "search_general": {
        const query = str(args.query, "query");
        const r = await runGeneralQuery(query);
        if (r.error) return { error: r.error };
        const answer = capResult(r.answer.trim());
        if (!answer) return { count: 0, channel: "general", note: "General چینل سے کچھ نہیں ملا۔" };
        // Deliberately NOT added to the ledger — a General answer is not
        // page-precise (mirrors dispatch.ts's own comment).
        return { channel: "general", answer };
      }

      case "research_topic": {
        const topic = str(args.topic, "topic");
        const focus = typeof args.focus === "string" && args.focus.trim() ? args.focus.trim() : undefined;
        if (!session.model) return { error: "research_topic ابھی دستیاب نہیں۔" };

        const idsBefore = new Set(ledger.list().map((c) => c.id));
        const subTools = AGENT_TOOLS.filter((t) => ["search_corpus", "search_shamela", "query_tafseer", "search_hadith", "search_general", "search_repositories"].includes(t.name));

        const artifactId = `research-${Date.now().toString(36)}`;
        emitArtifact({ op: "open", artifactId, title: `مصادر — ${topic.slice(0, 60)}`, artifactType: "citation-list" });

        const sub = await runAgentLoop(
          `Gather page-precise sources on: ${topic}${focus ? ` (focus: ${focus})` : ""}`,
          session.model, dispatch, buildResearchSubagentPrompt(topic, focus),
          { mode: "ask", tools: subTools, maxSteps: 6, isCancelled: session.isCancelled ?? undefined },
        );

        const found = ledger.list().filter((c) => !idsBefore.has(c.id) && !c.bibliographic);
        if (found.length) {
          emitArtifact({ op: "citations", artifactId, entries: found.slice(0, 20).map((c, i) => ({ marker: String(i + 1), reference: c.reference, sourceId: c.id, supported: true, tier: 1, excerpt: (c.content ?? "").slice(0, 300) || undefined })) });
        }
        emitArtifact({ op: "close", artifactId, status: "final" });

        return {
          topic, synthesis: capResult((sub.answer ?? "").trim()) || "sub-run نے کوئی خلاصہ نہیں دیا۔",
          sourcesAdded: found.length,
          sources: found.slice(0, 15).map((c) => ({ id: c.id, reference: c.reference, excerpt: (c.content ?? "").slice(0, 200) })),
          note: found.length ? `${found.length} صفحہ-درست مصادر اب insert_footnote سے حوالہ دیے جا سکتے ہیں۔` : "کوئی صفحہ-درست مصدر نہیں ملا۔",
        };
      }

      case "insert_footnote": {
        const chapter = typeof args.chapter === "string" ? args.chapter : undefined;
        const marker = str(args.marker, "marker");
        const chunk = ledger.resolveOrThrow(args.source_id);
        if (chunk.bibliographic && typeof args.claim === "string" && args.claim.trim()) {
          throw new Error("insert_footnote: یہ ایک بغیر پڑھی گئی کتاب کا حوالہ ہے — بغیر claim کے حوالہ دیں۔");
        }
        const verdict = await assertClaimSupported(args.claim, chunk.content, null);
        const doc = await resolveChapter(chapter);
        if ("error" in doc) return doc;
        const found = (doc.plain_text ?? "").includes(marker);

        // Web has no Word-footnote object to convert the marker into — the
        // citation lives as an emitted artifact (open-before-accept, same as
        // desktop's ADR-0033), which is the SAME pattern the rest of the app's
        // citation UI already uses (inline [N] + a verified sources list). No
        // document mutation here; see this file's own header comment.
        if (found) {
          const artifactId = `footnote-${doc.id}-${Date.now().toString(36)}`;
          emitArtifact({ op: "open", artifactId, title: `حاشیہ ${marker} — ${doc.title}`, artifactType: "citation-list" });
          emitArtifact({
            op: "citations", artifactId,
            entries: [{ marker, reference: chunk.reference, sourceId: typeof args.source_id === "string" ? args.source_id : "", supported: verdict?.supports, url: chunk.source_url ?? undefined, tier: chunk.bibliographic ? 2 : 1, excerpt: (chunk.content ?? "").trim() || undefined, claim: typeof args.claim === "string" && args.claim.trim() ? args.claim.trim() : undefined }],
          });
          emitArtifact({ op: "close", artifactId, status: "final", targetChapter: doc.title });
        }

        return {
          applied: found ? 1 : 0, notFound: found ? [] : [marker], reference: chunk.reference,
          ...(verdict ? { claimCheck: verdict.note } : {}),
          note: found ? "حوالہ فہرست میں شامل — دستاویز میں مارکر کا متن نہیں بدلا گیا (ویب پر ابھی)۔" : `مارکر "${marker}" دستاویز میں نہیں ملا۔`,
        };
      }

      case "create_chapter": {
        const chapterTitle = str(args.name, "name");
        const title = typeof args.title === "string" ? args.title.trim() : "";
        const fromSource = typeof args.from_source === "string" && args.from_source.trim() ? args.from_source.trim() : null;
        const rawHtml = typeof args.html === "string" ? args.html : "";
        if (fromSource) return { error: "create_chapter کا from_source ابھی ویب پر دستیاب نہیں — html یا خالی دیں۔" };

        const active = await activeDoc();
        if (!active) return { error: "کوئی پراجیکٹ کھلا نہیں — پہلے ایک دستاویز کھولیں تاکہ نئی اسی پراجیکٹ میں بن سکے۔" };

        const html = (title ? `<h1>${title}</h1>\n` : "") + rawHtml;
        const created = await documentService.createDocument(active.project_id, chapterTitle, html ? htmlToJson(html) : {});
        return { chapter: created.title, id: created.id, seededFrom: rawHtml ? "html" : "blank" };
      }

      case "add_document_comment": {
        const chapter = typeof args.chapter === "string" ? args.chapter : undefined;
        const anchor = str(args.anchor_text, "anchor_text");
        const comment = str(args.comment, "comment");
        const doc = await resolveChapter(chapter);
        if ("error" in doc) return doc;
        const found = (doc.plain_text ?? "").includes(anchor);
        if (!found) {
          return { added: false, notFound: true, note: `اینکر متن "${anchor.slice(0, 50)}${anchor.length > 50 ? "…" : ""}" نہیں ملا — کوئی مختصر عین جملہ استعمال کریں۔` };
        }
        const created = await annotationService.createAnnotation({ documentId: doc.id, quote: anchor, note: comment });
        return { chapter: doc.title, added: Boolean(created), notFound: false };
      }

      case "check_consistency": {
        const term = str(args.term, "term");
        const exclude = typeof args.exclude_chapter === "string" ? args.exclude_chapter : null;
        const active = await activeDoc();
        if (!active) return { term, appearsIn: [], suggestion: "کوئی پراجیکٹ کھلا نہیں۔" };
        const siblings = (await documentService.listDocuments(active.project_id)).filter((d) => d.title !== exclude);
        const found: Array<{ chapter: string; count: number; snippet: string }> = [];
        for (const d of siblings) {
          const text = d.plain_text ?? "";
          const idx = text.indexOf(term);
          if (idx === -1) continue;
          const count = text.split(term).length - 1;
          found.push({ chapter: d.title, count, snippet: text.slice(Math.max(0, idx - 60), idx + term.length + 60).replace(/\s+/g, " ").trim() });
        }
        return { term, appearsIn: found, suggestion: found.length ? `"${term}" یہاں بھی ہے: ${found.map((f) => f.chapter).join("، ")}۔` : `"${term}" باقی دستاویزات میں نہیں ہے۔` };
      }

      case "critique": {
        const chapter = typeof args.chapter === "string" ? args.chapter : undefined;
        const kind = ((CRITIQUE_KINDS as string[]).includes(String(args.kind)) ? String(args.kind) : "draft") as CritiqueKind;
        const focus = typeof args.focus === "string" && args.focus.trim() ? args.focus.trim() : undefined;
        const doc = await resolveChapter(chapter);
        if ("error" in doc) return doc;
        const text = doc.plain_text ?? "";
        if (!text.trim()) return { error: `"${doc.title}" میں کوئی متن نہیں۔` };

        const artifactId = `critique-${doc.id}-${Date.now().toString(36)}`;
        emitArtifact({ op: "open", artifactId, title: `نقد — ${doc.title}`, artifactType: "document" });
        let critiqueText = "";
        let ok = true;
        try {
          critiqueText = await generateWebAgentText({
            prompt: buildCritiqueInput({ subject: text.slice(0, 9000) }),
            systemInstruction: buildCritiqueInstruction(kind, focus),
            temperature: 0.3,
          });
        } catch (err) {
          ok = false;
          critiqueText = `(نقد دستیاب نہیں — ${err instanceof Error ? err.message : String(err)})`;
        }
        emitArtifact({ op: "delta", artifactId, mode: "replace", text: critiqueText });
        emitArtifact({ op: "close", artifactId, status: ok ? "final" : "aborted", targetChapter: doc.title });
        return { chapter: doc.title, kind, ok, critique: capResult(critiqueText), note: "یہ ایک ماڈل کا مشاورتی نقد ہے — حتمی نہیں۔" };
      }

      case "draft_section": {
        const chapter = str(args.chapter, "chapter");
        const mode = str(args.mode, "mode") as DraftMode;
        const spec = getDraftMode(mode);
        if (!spec) return { error: `نامعلوم draft mode "${mode}"` };
        const sourceIds = Array.isArray(args.source_ids) ? args.source_ids.filter((s): s is string => typeof s === "string") : [];
        if (spec.grounded && sourceIds.length === 0) return { error: `draft_section mode "${mode}" کو مصادر چاہییں — پہلے search_corpus/search_shamela چلائیں۔` };

        const sources: Array<{ marker: string; reference: string; excerpt: string }> = [];
        for (let i = 0; i < sourceIds.length; i += 1) {
          const chunk = ledger.resolveOrThrow(sourceIds[i]);
          sources.push({ marker: String(i + 1), reference: chunk.reference, excerpt: (chunk.content ?? "").slice(0, 1200) });
        }

        const doc = await resolveChapter(chapter);
        if ("error" in doc) return doc;
        const sectionHeading = typeof args.section_heading === "string" ? args.section_heading : undefined;
        const content = buildDraftInput({ mode, sectionHeading, chapterExcerpt: (doc.plain_text ?? "").slice(0, 3000), sources: sources.length ? sources : undefined });

        let draft: string;
        try {
          draft = (await generateWebAgentText({ prompt: content, systemInstruction: spec.instruction })).trim();
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
        if (!draft) return { error: "ماڈل نے کچھ نہیں لوٹایا۔" };

        const artifactId = `draft-${doc.id}-${Date.now().toString(36)}`;
        emitArtifact({ op: "open", artifactId, title: `Draft — ${sectionHeading ?? doc.title}`, artifactType: "document" });
        const labelledHtml = spec.html ? `<p><em>[DRAFT — ہر دعویٰ کا جائزہ لیں]</em></p>\n${draft}` : paragraphsToHtml(`[DRAFT — ہر دعویٰ کا جائزہ لیں]\n${draft}`);
        emitArtifact({ op: "delta", artifactId, mode: "replace", html: spec.html ? draft : undefined, text: spec.html ? undefined : draft });
        await writeInto(doc, labelledHtml, "append");
        emitArtifact({ op: "close", artifactId, status: "final", targetChapter: doc.title });
        return { chapter: doc.title, mode, grounded: spec.grounded, sourcesUsed: sources.length, note: "طرز_تحریر (author voice) ابھی ویب پر لاگو نہیں — بنیادی ٹیمپلیٹ سے تحریر کی گئی۔" };
      }

      case "transcribe_media": return NOT_ON_WEB("transcribe_media");
      case "ocr_document": return NOT_ON_WEB("ocr_document");
      case "extract_author_voice": return NOT_ON_WEB("extract_author_voice");
      case "compile_ai_disclosure": return NOT_ON_WEB("compile_ai_disclosure");
      case "run_playbook": return { error: "run_playbook ابھی ویب پر دستیاب نہیں — سیدھی ہدایت سے وہی کام مکمل کریں۔" };

      default:
        return { error: `unknown tool: ${name}` };
    }
  };

  return { dispatch, ledger };
}

// ── small pure helpers, kept local since they are web-dispatch-only ────────

function countHeadings(json: Record<string, unknown> | null | undefined): number {
  if (!json) return 0;
  let n = 0;
  const walk = (node: Record<string, unknown>) => {
    if (node.type === "heading") n += 1;
    if (Array.isArray(node.content)) {
      for (const c of node.content) if (c && typeof c === "object") walk(c as Record<string, unknown>);
    }
  };
  walk(json);
  return n;
}

// ── query_tafseer — the same mode→tool mapping as electron/agent/adapters/
// tafsir.ts, ported rather than shared: the desktop version's "connect a
// local runtime" fallback is genuinely Electron-only, and this pure mapping
// is small enough that duplicating just it is cheaper than threading a
// platform flag through that file too.
const TAFSIR_MODE_TOOL: Record<string, string> = {
  ayah: "fetch_ayah", tafsir: "fetch_tafsir", nuzool: "fetch_nuzool_reason", word: "analyze_word", search: "search_in_tafsir",
};

async function webQueryTafseer(q: { reference: string; mode: string; sources?: string[]; query?: string }): Promise<{ chunks: RetrievedChunk[]; text: string; note?: string; error?: string }> {
  const tool = TAFSIR_MODE_TOOL[q.mode];
  if (!tool) return { chunks: [], text: "", error: `unknown tafsir mode "${q.mode}"` };

  let args: Record<string, unknown>;
  let refLabel: string;
  if (q.mode === "search") {
    const query = (q.query ?? q.reference).trim();
    if (!query) return { chunks: [], text: "", error: "search mode needs a query" };
    args = { query, limit: 6, ...(q.sources?.[0] ? { source: q.sources[0] } : {}) };
    refLabel = `بحث في التفاسير: «${query}»`;
  } else {
    const parsed = parseAyahRef(q.reference);
    if (!parsed) return { chunks: [], text: "", error: `could not read the āyah reference "${q.reference}"` };
    refLabel = `${surahLabel(parsed.surah)}: ${parsed.ayah}`;
    args = { surah: parsed.surah, ayah: parsed.ayah };
    if ((q.mode === "tafsir" || q.mode === "nuzool") && q.sources?.length) args.sources = q.sources;
    if (q.mode === "word") args.word_no = 1;
  }

  let text = "";
  try {
    const res = await tafsirCall(tool, args);
    text = res.text ?? "";
  } catch (err) {
    return { chunks: [], text: "", error: `tafsir lookup failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!text.trim()) return { chunks: [], text: "", note: "کچھ نہیں ملا۔" };

  const sourceLabel = q.sources?.length ? ` (${q.sources.join("، ")})` : "";
  const kind = q.mode === "nuzool" ? "سبب النزول" : q.mode === "word" ? "تحليل لفظي" : q.mode === "ayah" ? "نص الآية" : "تفسير";
  return { chunks: [{ id: `tafsir:${q.mode}:${q.sources?.[0] ?? "all"}:${refLabel}`, reference: `${kind}${sourceLabel} — ${refLabel} (tafsir.net)`, content: text.slice(0, 4000) }], text: text.slice(0, 6000) };
}

// ── search_hadith / search_general — direct client calls (no bridge needed:
// the web dispatcher already runs in the browser). Mirrors the accumulation
// pattern useAgentRun.ts's handleResearch already uses for the desktop IPC path.
async function runIslamicQuery(query: string): Promise<{ answer: string; citations: CitationItem[]; error?: string }> {
  return new Promise((resolve) => {
    const acc = { text: "" };
    let citations: CitationItem[] = [];
    streamIslamicQuery({
      query, strictMode: false, chatHistory: [], tier: "free",
      onDelta: (chunk) => { acc.text += chunk; },
      onSourcesReady: (_c, _d, fetched) => { citations = fetched; },
      onDone: () => resolve({ answer: acc.text, citations }),
      onError: (err) => resolve({ answer: "", citations: [], error: err }),
    }).catch((err) => resolve({ answer: "", citations: [], error: err instanceof Error ? err.message : String(err) }));
  });
}

async function runGeneralQuery(query: string): Promise<{ answer: string; error?: string }> {
  return new Promise((resolve) => {
    const acc = { text: "" };
    streamResearchQuery({
      query, sources: [], strictMode: false, chatHistory: [], mode: "general",
      onDelta: (chunk) => { acc.text += chunk; },
      onDone: () => resolve({ answer: acc.text }),
      onError: (err) => resolve({ answer: "", error: err }),
    }).catch((err) => resolve({ answer: "", error: err instanceof Error ? err.message : String(err) }));
  });
}

// ── search_repositories — Internet Archive + OpenAlex, direct from the
// browser (both are public, no-auth endpoints). Reuses the SAME shared
// normalizers electron/agent/adapters/repositories.ts uses; only the fetch
// call itself is duplicated (that file's own User-Agent header is a
// forbidden header name in the Fetch spec and would be silently dropped by
// the browser anyway, so it is simply omitted here).
const OPENALEX_CONTACT = "agent@easyeditor.app";
const REPO_TIMEOUT_MS = 12_000;

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REPO_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function webSearchRepositories(query: string, repo: string, limitRaw: number): Promise<{ chunks: RetrievedChunk[]; note?: string; error?: string }> {
  const q = query.trim();
  if (!q) return { chunks: [], error: "a search query is required" };
  const limit = Math.min(Math.max(limitRaw || 5, 1), 8);

  const jobs: Array<Promise<RetrievedChunk[]>> = [];
  if (repo === "archive" || repo === "all") {
    const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(`title:(${q}) OR description:(${q})`)}` +
      `&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year&fl[]=mediatype&rows=${limit}&page=1&output=json`;
    jobs.push(fetchJson(url).then(normaliseArchive).catch(() => []));
  }
  if (repo === "openalex" || repo === "all") {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(q)}` +
      `&select=id,doi,title,display_name,publication_year,authorships,primary_location&per_page=${limit}&mailto=${encodeURIComponent(OPENALEX_CONTACT)}`;
    jobs.push(fetchJson(url).then(normaliseOpenAlex).catch(() => []));
  }
  const chunks = (await Promise.all(jobs)).flat().slice(0, limit * 2);
  if (chunks.length === 0) return { chunks: [], note: "عالمی مخازن میں کچھ نہیں ملا (یا جواب نہیں دیا)۔" };
  return { chunks, note: "یہ کتابیاتی حوالے ہیں، اقتباس نہیں — بغیر claim کے insert_footnote استعمال کریں۔" };
}
