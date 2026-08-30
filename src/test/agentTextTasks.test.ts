// @vitest-environment node
// shared/agent/textTasks.ts — the run_task slug map (SPEC-M8 §3). The agent
// names tasks with friendly words; this must resolve them to the SAME slugs
// the editor's task buttons use (shared/ai/prompts/refineText.ts), so run_task
// runs the identical prompt.
import { describe, it, expect } from 'vitest';
import { resolveTaskSlug, taskOutputIsHtml } from '../../shared/agent/textTasks';
import { REFINE_TEXT_ACTIONS } from '../../shared/ai/prompts/refineText';

describe('resolveTaskSlug', () => {
  it('maps friendly names to real REFINE_TEXT_ACTIONS keys', () => {
    expect(resolveTaskSlug('harakat')).toBe('add_harakat');
    expect(resolveTaskSlug('spelling')).toBe('spelling_check');
    expect(resolveTaskSlug('auto-format')).toBe('auto_format');
    expect(resolveTaskSlug('normalize')).toBe('normalize_script');
    expect(resolveTaskSlug('section-summaries')).toBe('summarize_sections');
    expect(resolveTaskSlug('section summaries')).toBe('summarize_sections');
  });

  it('accepts the real slug directly', () => {
    expect(resolveTaskSlug('add_harakat')).toBe('add_harakat');
    expect(resolveTaskSlug('summarize_sections')).toBe('summarize_sections');
  });

  it('every resolved slug (except the citations sentinel) has a prompt', () => {
    for (const name of ['harakat', 'spelling', 'paraphrase', 'summarize', 'auto-format', 'normalize', 'formalize', 'humanize', 'shorten', 'section-summaries']) {
      const slug = resolveTaskSlug(name)!;
      expect(REFINE_TEXT_ACTIONS[slug], name).toBeTruthy();
    }
  });

  it("keeps 'citations' as a sentinel the caller must reject", () => {
    expect(resolveTaskSlug('citations')).toBe('citations');
  });

  it('returns null for an unknown task', () => {
    expect(resolveTaskSlug('make it sparkle')).toBeNull();
  });

  it('only auto_format produces HTML', () => {
    expect(taskOutputIsHtml('auto_format')).toBe(true);
    expect(taskOutputIsHtml('add_harakat')).toBe(false);
  });
});
