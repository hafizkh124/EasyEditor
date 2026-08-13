# EasyEditor Strategic Plan v1

**Status:** Draft for discussion · **Version:** 1.0.0-draft · **Date:** 2026-08-11
**Owner:** Research & Strategy · **Author:** Engineering
**Scope:** Islamic research credibility line (research modes, citations, verification)
**Sister docs:** `docs/SPEC-v2.md` (product spec), `docs/adr/` (accepted decisions)

---

## 0. Purpose

This document consolidates the strategic research performed for the Islamic
research credibility workstream — external-source verification, citation
integrity, and the desktop/privacy line — so that a single authoritative
reference exists for discussion. It records what was verified, what was
rejected, and what the phased implementation looks like.

Research sources incorporated:

| # | Source | Status |
|---|---|---|
| 1 | Elicit (Islamic citation-dataset review) | Incorporated |
| 2 | SHARIAsource Portal review | Incorporated |
| 3 | SIDIX review | Incorporated |
| 4 | Cost/desktop report (local LLM, embeddings, OCR, tashkeel) | Incorporated |
| 5 | Project Ansari (`ansari-project/*`) | Verified & incorporated |

---

## 1. North star & framing

Three-stone framing for the credibility line:

- **ESD-1 — موضوع (topic) calibration:** the engine returns on-topic, well-occluded
  evidence (Dorar/Hadith + Qur'an/tafsir) rather than tangential content.
- **ESD-2 — ضعیف/مکذوب (weak/forged) gate:** spurious or weak transmissions are
  flagged with their graded status and سند (isnad) chain rather than presented as fact.
- **ESD-3 — حقوق/ذریعہ (rights/attribution):** material is attributed to its
  source, license, and method — no source-less وجوہ (reasons/claims).

Each ESD carries its own milestones (below); the unifying test is recall@k on a
takhrij gold set plus a blinded judge.

---

## 2. Current-state anchor

A baseline harness plus two workstreams define v1 direction (see "here and now"
in discussion): the eval harness rapidly measures any change, so every
improvement is provable rather than assumed.

---

## 3. Strategic fronts (5)

1. **توثیق/تخریج (verification/takhrij):** Dorar + grading, Sunnah.com, Qur'an
   sources (AlQuran/tesi/IslamQA derived), per-madhhab filters.
2. **مضبوط citations:** citation engine already routes through
   `cite-shared` + `scholarly_documents` (AGPL-3.0); the gap is a real
   citation-verification gate, not linkage.
3. **ریسرچ موڈز (research modes):** three-tab Islamic / Custom / General flow
   already shipped (ADR-0002); credibility work strengthens Islamic mode.
4. **تقابل و معیار (comparison & evals):** the eval harness in §4 (P1).
5. **ڈیسک ٹاپ/پرائیویسی line:** local OCR, local embeddings, local LLM — because
   the project's "free & offline in Urdu" value proposition depends on it.

---

## 4. Phased implementation

### P1 — Eval harness (comparison & metrics)
- Build takhrij gold set (ayat + hadith, per-madhhab).
- Metric: recall@k for the citation engine; blinded LLM judge for citation
  correctness, based on **RAGDiff's domain/provider/query-set/runs/compare
  pattern** (see §6, source 5) — reimplemented in our TS/Vitest stack, with
  **providers = our search channels (Dorar, Sunnah, Qur'an, tafsir, corpus)**.
- Diff-check concepts adopted (translated, not copied) from `ragdiff`:
  - **imh-check:** a passage that looks like a quotation but has no direct match
    in any single source document (بحوالہ-ایک-ذریعہ) — flag as questionable.
  - **leakage-check:** gold-answer leaking across documents during retrieval.
  - **causal attribute:** when an answer is wrong, attribute responsibility
    among {model, retriever, grounding} to localize fixes.
- Deliverable: `eval/` harness + first baseline report.

### P2 — Epistemic labels
- Introduce a visible grading label on evidence: مصحح / موثق / ضعیف / مکذوب
  (verified / authenticated / weak / forged) per the underlying grading source.
- Survives serialization into notes/recipes (ADR-0005 shapes it).

### P3 — Methods & takhrij transparency
- Methods page documenting: citation channels, grading sources, and a
  search-recipe (SR) that users can reproduce.
- Expose takhrij mechanics (which channel, which source text, which grading).

### P4 — Conflict resolver (بیانات clash detection)
- Detect contradictory transmissions between sources; surface both with their
  gradings rather than silently picking one.

### P5 — Mufti-verification gate (ورچوئل مفتی دروازہ)
- A reviewer gate (scholar or senior user) between draft and publish for
  fatwa-direction output; audit trail retained.

### P7 — Itqan integration
- Wire Itqan corpus results through the citation engine so the Itqan lane shares
  the same citation-integrity gates as all other channels.

> Note: P6 slot reserved for the Sufi/Occultism privacy lane (blocking policy
> decisions at §8).

---

## 5. Desktop/privacy line (M7)

| Label | Workstream | Notes |
|---|---|---|
| M7.1 | Two-tier tashkeel — local baseline model + API refinement tier | for OCR sanity + diacritics |
| M7.2 | Desktop local LLM (`llama.cpp`), Qwen 2.5-Urdu-class weights | framed as سمارت حِفظ (deliberate smart-compression) in messaging |
| M7.3 | Local embeddings (Urdu-capable, e.g. nomic-v2-class) | replaces API vector search for personal corpus on desktop |
| M7.4 | Local OCR (Sadeem / Urdu OCR class) | offline document import |
| M7.5 | تیمییز (differentiation) | the "needs a human eye" flag, distinct from a software verdict |

Sequence: OCR → embeddings → tashkeel → LLM ordering per discussion; the eval
harness (P1) measures each.

---

## 6. External-source verification report

### 6.1 Verified: Project Ansari (`ansari-project/*`)
- **ansari-backend** — Python package (`pip install ansari-backend`, MIT) with
  retriever/reranker and RAG pipeline; **verification level: high.** Caveat: it
  depends on OpenAI + Kalemat API + Mongo — not a fully free/local corpus.
- **ansari-frontend** — React Native, TypeScript, MIT.
- **ragdiff** — generic RAG A/B evaluation framework (domains/providers/query
  sets/runs + LLM comparison). Verified as: **not** a dedicated isnad/hadith
  verifier (user report overstated this); genuinely useful as a **template for
  our P1 harness**.
- **ansari-skill** — Islamic knowledge agent skill; peer reference for prompt
  discipline (closed three-source corpus: Quran, hadith, الموسوعۃ الفقہیہ).
  Reinforces our "closed corpus, no free-hand prompting" rule.
- **ansari-project/datasets** — public datasets for AI/Islam research; candidate
  extra public source for P1 gold data.
- **الموسوعۃ الفقہیہ** used by Ansari as a fiqh source — candidate as an
  optional `mawsuah` domain for our fiqh lines (low priority).

Adoption rule: **adopt pattern, not package.** We reimplement the eval-pattern
and prompt discipline in our stack; we do not vendor their Python/API-bound code.

### 6.2 Elicit review — Islamic citation-dataset landscape
- Sparse for Quran/hadith evaluation; Sunni-fiqh-centric; **our own gold set is
  the differentiated asset** (P1), not a dependency on third-party datasets.

### 6.3 SHARIAsource & SIDIX
- Institutional portals (Harvard/MIT-adjacent) useful as **public seeding data
  & taxonomy reference**; not operational retrieval sources due to
  API/rate/rights constraints. Used for mujtahid/juristic variability framing
  in the conflict resolver (P4).

---

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | Overclaiming grading precision (ضعیف/مکذوب) | Labels always carry source + live link; UI copies "graded by X, not by us" |
| 2 | Source-less وجوہ (unattributed claims) leaking into output (ESD-3) | Closed-corpus rule + P2/P3 gates + attribution audit in P5 |
| 3 | Eval harness used as theater | recall@k + blinded judge must be runnable by reviewer, documented in P3 methodology |
| 4 | RAGDiff-type frameworks drift (single-maintainer) | We own our TS reimplementation; pattern only |
| 5 | Desktop line cost creep | M7 sequence gated item-by-item on P1 baselines |
| 6 | Privacy lane (P6) blocked by licensing decisions | Escalated to §8 open decisions before build |

---

## 8. Decisions & open items

**Status:** decisions 1–4, 6, 7, 9 (terms), 10 → **DECIDED** · **PENDING:** #5, #8

1. **P1 scope — DECIDED:** adopt three ragdiff diff-checks (imh-check, leakage-check, causal attribute) into the first eval harness.
2. **GPL/AGPL policy — DECIDED:** adopt-pattern-only (no vendored code); keep the codebase AGPL-clean, no GPL-3.0 source files imported.
3. **Ansari role — DECIDED:** strictly a reference architecture; no integration of their Python/API-bound backend.
4. **Public datasets — DECIDED:** add `ansari-project/datasets` to P1 public-data sources.
5. **P6 privacy lane (Sufi/Occultism) — PENDING:** hold until first P1 baseline report.
6. **M7 ordering — DECIDED:** OCR → embeddings → tashkeel → LLM as sequenced in §5.
7. **Desktop corpus rights — DECIDED:** embedded-corpus rights/licensing confirmed before M7.2.
8. **`mawsuah` domain — PENDING:** الموسوعۃ الفقہیہ as an optional channel (low priority) — to approve at P7 time.
9. **Grading vocabulary — DECIDED (terms):** مصحح / موثق / ضعیف / مکذوب adopted; Urdu UI label draft pending (next action).
10. **Storage — DECIDED:** plan persists as v1 at this path; future ADRs land in `docs/adr/`.

---

## 9. Next actions

1. Draft P2/P9 UI label draft for مصحح / موثق / ضعیف / مکذوب + Urdu tooltips (decision #9).
2. Land P1 skeleton (`eval/` + takhrij gold subset) — smallest provable step.
3. Revisit PENDING decisions #5 and #8 after the first P1 baseline report.
4. Revisit §4 after first P1 baseline report.