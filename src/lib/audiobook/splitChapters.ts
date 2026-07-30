// Splits a document's HTML into audiobook chapters (SPEC-M5 FR-6.9).
//
// Chapters come from the document's own headings, so the marks a listener jumps
// between are the ones the author actually wrote. Runs in the renderer because
// that is where DOMParser lives; the main process stays DOM-free.

import type { AudiobookChapterInput } from '@/core/voice/types';

/** Heading levels that open a new chapter. */
const CHAPTER_HEADINGS = new Set(['H1', 'H2']);

/**
 * Elements whose text must not be spoken. Suggestion marks belong to the
 * track-changes UI, and code blocks read as noise rather than prose.
 */
const SKIPPED = new Set(['SCRIPT', 'STYLE', 'PRE', 'CODE']);

function isSuggestion(el: Element): boolean {
  const cls = el.getAttribute('class') ?? '';
  return cls.includes('suggestion') || el.hasAttribute('data-suggestion');
}

/**
 * Collapses whitespace so the synthesiser is not handed the document's
 * indentation. Piper pauses on newlines, which would put a gap mid-sentence.
 */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Reads block-level text out of an element, one string per block, so paragraph
 * boundaries survive into the spoken audio as sentence breaks.
 */
function blockText(el: Element): string {
  if (SKIPPED.has(el.tagName) || isSuggestion(el)) return '';
  return normalize(el.textContent ?? '');
}

export interface SplitChaptersOptions {
  /** Title for text appearing before the first heading. */
  introTitle?: string;
}

/**
 * Splits HTML into chapters at H1/H2 boundaries.
 *
 * A document with no headings yields a single chapter — an audiobook of one part
 * is still a valid audiobook, and is better than refusing to export.
 */
export function splitChaptersFromHtml(
  html: string,
  options: SplitChaptersOptions = {},
): AudiobookChapterInput[] {
  const { introTitle = 'آغاز' } = options;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const chapters: AudiobookChapterInput[] = [];
  let current: { title: string; parts: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const text = current.parts.filter(Boolean).join('\n');
    if (text.trim()) chapters.push({ title: current.title, text });
    current = null;
  };

  for (const node of Array.from(doc.body.children)) {
    if (CHAPTER_HEADINGS.has(node.tagName)) {
      flush();
      const heading = blockText(node);
      current = {
        title: heading || `باب ${chapters.length + 1}`,
        // The heading is spoken too — a listener otherwise has no idea a new
        // chapter began.
        parts: heading ? [heading] : [],
      };
      continue;
    }

    const text = blockText(node);
    if (!text) continue;
    if (!current) current = { title: introTitle, parts: [] };
    current.parts.push(text);
  }
  flush();

  return chapters;
}
