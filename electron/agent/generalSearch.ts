/**
 * M8 Layer 6 — the renderer bridge for `search_general` (SPEC-M8 §3, ADR-0019
 * item 7). M9 generalised the implementation into `researchBridge.ts` (which
 * also serves the citable Islamic channel); this stays as the `search_general`
 * entry point and keeps the existing import surface stable.
 */
import type { WebContents } from 'electron';
import { requestResearch, resolveResearch, type ResearchResult } from './researchBridge.js';

export type GeneralSearchResult = ResearchResult;

export function requestGeneralSearch(
  runId: string,
  query: string,
  sender: WebContents | null | undefined,
): Promise<GeneralSearchResult> {
  return requestResearch(runId, query, sender, 'general');
}

/** Called by the `generalSearchResult` IPC action when the renderer replies. */
export const resolveGeneralSearch = resolveResearch;
