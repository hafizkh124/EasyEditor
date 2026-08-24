// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  buildAiReaderSystemInstruction,
  buildActionPrompt,
  buildFreePrompt,
} from '../../src/lib/reader/aiReaderPrompts.js';
import { htmlToPlainText } from '../../src/lib/reader/htmlToPlainText.js';

/**
 * SPEC-M6 Phase 7 — Reader AI prompt builders + page-text stripping.
 * Pure functions, no DOM / no network — runs anywhere.
 */

describe('htmlToPlainText', () => {
  it('strips tags but keeps prose', () => {
    const html = '<div><p>هذا <b>متن</b> من كتاب</p><p>وفيه ذكر الحسن</p></div>';
    expect(htmlToPlainText(html)).toContain('هذا متن من كتاب');
    expect(htmlToPlainText(html)).toContain('وفيه ذكر الحسن');
    expect(htmlToPlainText(html)).not.toContain('<');
  });

  it('converts block/line breaks to newlines', () => {
    const html = '<p>سطر أول<br/>سطر ثانٍ</p><p>فقرة ثانية</p>';
    const out = htmlToPlainText(html);
    expect(out).toContain('سطر أول\nسطر ثانٍ');
    expect(out).toContain('فقرة ثانية');
  });

  it('decodes common HTML entities', () => {
    expect(htmlToPlainText('<p>a&amp;b &lt;c&gt; &quot;d&quot;</p>')).toBe('a&b <c> "d"');
  });

  it('returns empty string for empty input', () => {
    expect(htmlToPlainText('')).toBe('');
  });
});

describe('buildAiReaderSystemInstruction', () => {
  it('includes Urdu instruction for ur language', () => {
    const s = buildAiReaderSystemInstruction('ur');
    expect(s).toContain('اردو');
  });

  it('includes English instruction for en language', () => {
    const s = buildAiReaderSystemInstruction('en');
    expect(s.toLowerCase()).toContain('english');
  });
});

describe('buildActionPrompt', () => {
  const page = 'هذا هو نص الصفحة من الكتاب.';

  it('labels the page number and embeds the page text', () => {
    const p = buildActionPrompt('explain', page, 12, 'ur');
    expect(p).toContain('12');
    expect(p).toContain(page);
  });

  it('has distinct instructions per action', () => {
    const explain = buildActionPrompt('explain', page, 1, 'ur');
    const summarize = buildActionPrompt('summarize', page, 1, 'ur');
    const quiz = buildActionPrompt('quiz', page, 1, 'ur');
    expect(explain).not.toBe(summarize);
    expect(summarize).not.toBe(quiz);
  });

  it('truncates very long page text to a safe size', () => {
    const long = 'الف '.repeat(5000); // ~10k chars
    const p = buildActionPrompt('summarize', long, 1, 'ur');
    expect(p.length).toBeLessThan(13000);
  });
});

describe('buildFreePrompt', () => {
  it('embeds the question and the page text', () => {
    const p = buildFreePrompt('ما معنى هذا؟', 'نص الصفحة', 5);
    expect(p).toContain('ما معنى هذا؟');
    expect(p).toContain('نص الصفحة');
    expect(p).toContain('5');
  });
});
