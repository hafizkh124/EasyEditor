// @vitest-environment node
// shared/agent/authorVoice.ts + its wiring into shared/agent/systemPrompt.ts
// (M9 Phase A — طرز_تحریر.md). What must hold: an absent file is a no-op
// everywhere; a present file is capped, marked, and injected BEFORE the
// قواعد.md section; and it never replaces a fixed generation template — only
// appends to it. The dispatch-level wiring (draft_section / run_task) is
// covered in agentDispatch.test.ts.
import { describe, it, expect } from 'vitest';
import {
  AUTHOR_VOICE_FILES,
  AUTHOR_VOICE_MAX_CHARS,
  VOICE_SHAPED_TASKS,
  authorVoicePromptSection,
  withAuthorVoice,
} from '../../shared/agent/authorVoice';
import { buildSystemPrompt } from '../../shared/agent/systemPrompt';
import { AUTHOR_VOICE_EXTRACT_INSTRUCTION } from '../../shared/ai/prompts/authorVoiceExtract';
import { AUTHOR_VOICE_PROPOSAL_FILE } from '../../shared/agent/authorVoice';

const caps = { word: true, wordVersion: '16.0', windows: true };

describe('authorVoicePromptSection', () => {
  it('is null for an absent / blank file', () => {
    expect(authorVoicePromptSection(null)).toBeNull();
    expect(authorVoicePromptSection(undefined)).toBeNull();
    expect(authorVoicePromptSection('   \n\t ')).toBeNull();
  });

  it('marks the section and carries the text', () => {
    const s = authorVoicePromptSection('جملے چھوٹے رکھیں۔ اصطلاح: "فریضہ" نہ کہ "فرض"۔')!;
    expect(s).toContain('طرز_تحریر.md');
    expect(s).toContain('فریضہ');
    expect(s.toLowerCase()).toContain('mechanical pass'); // says it does NOT apply to mechanical passes
  });

  it('caps the text at AUTHOR_VOICE_MAX_CHARS', () => {
    const big = 'ا'.repeat(AUTHOR_VOICE_MAX_CHARS + 500);
    const s = authorVoicePromptSection(big)!;
    expect(s).toContain('ا'.repeat(AUTHOR_VOICE_MAX_CHARS));
    expect(s).not.toContain('ا'.repeat(AUTHOR_VOICE_MAX_CHARS + 1));
  });
});

describe('withAuthorVoice', () => {
  const template = 'You are a careful scholarly author. Output ONLY the drafted text.';

  it('returns the instruction unchanged when there is no voice file', () => {
    expect(withAuthorVoice(template, null)).toBe(template);
    expect(withAuthorVoice(template, '  ')).toBe(template);
  });

  it('appends the voice as an addendum — the template survives verbatim', () => {
    const out = withAuthorVoice(template, 'لہجہ: باوقار، سادہ۔');
    expect(out.startsWith(template)).toBe(true);
    expect(out).toContain("AUTHOR'S VOICE");
    expect(out).toContain('لہجہ: باوقار، سادہ۔');
    expect(out).toMatch(/citation markers/i); // guards the [n] markers
  });

  it('caps the appended voice text', () => {
    const out = withAuthorVoice(template, 'ب'.repeat(AUTHOR_VOICE_MAX_CHARS + 200));
    expect(out).toContain('ب'.repeat(AUTHOR_VOICE_MAX_CHARS));
    expect(out).not.toContain('ب'.repeat(AUTHOR_VOICE_MAX_CHARS + 1));
  });
});

describe('VOICE_SHAPED_TASKS', () => {
  it('covers the rewriting tasks and excludes every mechanical pass', () => {
    for (const s of ['formalize', 'humanize', 'paraphrase', 'shorten', 'summarize', 'summarize_sections']) {
      expect(VOICE_SHAPED_TASKS.has(s)).toBe(true);
    }
    for (const s of ['add_harakat', 'spelling_check', 'normalize_script', 'auto_format']) {
      expect(VOICE_SHAPED_TASKS.has(s)).toBe(false);
    }
  });
});

describe('AUTHOR_VOICE_FILES', () => {
  it('leads with the Urdu name the blueprint uses', () => {
    expect(AUTHOR_VOICE_FILES[0]).toBe('طرز_تحریر.md');
  });
  it('the proposal file is distinct from every real voice-file name', () => {
    expect(AUTHOR_VOICE_FILES).not.toContain(AUTHOR_VOICE_PROPOSAL_FILE);
  });
});

describe('AUTHOR_VOICE_EXTRACT_INSTRUCTION (extract_author_voice)', () => {
  it('asks for HOW not WHAT, forbids inventing preferences and copying whole sentences, and caps length', () => {
    const s = AUTHOR_VOICE_EXTRACT_INSTRUCTION;
    expect(s).toMatch(/Describe the voice; do not summarise the content/i);
    expect(s).toMatch(/do NOT invent a preference/i);
    expect(s).toMatch(/do NOT copy a full sentence/i);
    expect(s).toMatch(/under ~?450 words/i);
    expect(s).toMatch(/the scholar can edit|tendencies/i); // a draft, not rules
  });
});

describe('buildSystemPrompt — author voice', () => {
  it('omits the section entirely when there is no voice file', () => {
    const p = buildSystemPrompt({ mode: 'auto', capabilities: caps });
    expect(p).not.toContain('طرز_تحریر.md');
  });

  it('injects the voice section, placed BEFORE the قواعد.md section', () => {
    const p = buildSystemPrompt({
      mode: 'auto',
      capabilities: caps,
      authorVoice: 'میرا اسلوب: مختصر جملے، کم تشبیہات۔',
      projectRules: 'حوالہ: شکاگو انداز۔ فقہ: حنفی۔',
    });
    expect(p).toContain('میرا اسلوب: مختصر جملے، کم تشبیہات۔');
    expect(p).toContain('حوالہ: شکاگو انداز۔');
    expect(p.indexOf('طرز_تحریر.md')).toBeLessThan(p.indexOf('قواعد.md'));
  });

  it('works with a voice file and no rules file', () => {
    const p = buildSystemPrompt({ mode: 'auto', capabilities: caps, authorVoice: 'سادہ زبان۔' });
    expect(p).toContain('طرز_تحریر.md');
    expect(p).toContain('سادہ زبان۔');
  });
});
