// @vitest-environment node
// shared/agent/toolScoping.ts (M9 ADR-0027 F2). The model is never shown the
// whole registry: pruning narrows by playbook or by keyword domain. Two
// invariants must survive that: the FLOOR tools are always present, and if a
// citable search tool is exposed in a write mode then insert_footnote is too.
import { describe, it, expect } from 'vitest';
import { toolsFor, FLOOR_TOOLS, NATIVE_ONLY_TOOLS, matchDomains } from '../../shared/agent/toolScoping';
import { PLAYBOOKS } from '../../shared/playbooks/registry';

const names = (mode: Parameters<typeof toolsFor>[0], ctx?: Parameters<typeof toolsFor>[1]) =>
  toolsFor(mode, ctx).map((t) => t.name);

describe('toolsFor', () => {
  it('a tafsir/āyah ask never exposes hadith-only or manuscript tools', () => {
    const n = names('auto', { ask: 'اس آیت کی تفسیر بیان کریں' });
    expect(n).not.toContain('add_document_comment');
    expect(n).toContain('search_corpus');
  });

  it('always includes the FLOOR tools, whatever the ask', () => {
    for (const ask of ['تفسیر', 'حدیث کی سند', 'install a nastaliq font', 'random unrelated question']) {
      const n = names('auto', { ask });
      for (const f of FLOOR_TOOLS) expect(n, ask).toContain(f);
    }
  });

  it('citation closure — exposing a citable search tool in a write mode also exposes insert_footnote', () => {
    const n = names('auto', { ask: 'اس حدیث کی تخریج کریں اور حوالہ دیں' });
    if (n.includes('search_shamela') || n.includes('search_corpus')) {
      expect(n).toContain('insert_footnote');
    }
  });

  it('a playbook run is scoped to its own steps plus the floor + run_playbook', () => {
    const pb = PLAYBOOKS.find((p) => p.id === 'add-verified-citations')!;
    const n = names('auto', { playbook: pb });
    const stepTools = new Set(pb.steps.map((s) => s.tool));
    for (const t of n) {
      const ok = stepTools.has(t) || (FLOOR_TOOLS as readonly string[]).includes(t)
        || t === 'run_playbook' || t === 'insert_footnote' || t === 'ask_clarifying_question';
      expect(ok, `unexpected tool in scoped set: ${t}`).toBe(true);
    }
  });

  it('an AI-disclosure ask exposes compile_ai_disclosure (and it stays out of Ask mode)', () => {
    expect(names('auto', { ask: 'write my AI disclosure statement' })).toContain('compile_ai_disclosure');
    expect(names('ask', { ask: 'write my AI disclosure statement' })).not.toContain('compile_ai_disclosure');
  });

  it('Ask mode never yields a write tool even after scoping', () => {
    const n = toolsFor('ask', { ask: 'اس حدیث کی تخریج' });
    expect(n.every((t) => t.effect === 'read')).toBe(true);
  });

  it('an ask with no domain keyword returns the full mode set (+ clarify)', () => {
    const full = names('auto');
    const generic = names('auto', { ask: 'please help me with my chapter' });
    expect(generic.length).toBeGreaterThanOrEqual(full.length);
  });

  // ADR-0045 — the جوامع الكلم tools are native-only and land under the
  // existing hadith / rijal / grading domain rules, plus one thematic rule.
  describe('jkhssn tools', () => {
    it('are all native-only', () => {
      for (const t of ['jkhssn_sanad_tree', 'jkhssn_narrator', 'jkhssn_takhrij', 'jkhssn_judgments', 'jkhssn_thematic']) {
        expect(NATIVE_ONLY_TOOLS.has(t)).toBe(true);
      }
    });
    it('a shajarat al-isnad ask exposes jkhssn_sanad_tree on desktop', () => {
      const n = names('auto', { ask: 'اس حدیث کا شجرۂ اسناد بنائیں' });
      expect(n).toContain('jkhssn_sanad_tree');
      expect(n).toContain('jkhssn_takhrij');
    });
    it('a narrator ask exposes jkhssn_narrator alongside lookup_narrator', () => {
      const n = names('auto', { ask: 'اس راوی کا حال اور مرتبہ' });
      expect(n).toContain('jkhssn_narrator');
      expect(n).toContain('lookup_narrator');
    });
    it('an ʿilal ask exposes jkhssn_judgments', () => {
      expect(names('auto', { ask: 'اس حدیث کی علل کیا ہیں' })).toContain('jkhssn_judgments');
    });
    it('a thematic ask maps to the jkhssn connector', () => {
      const rules = matchDomains('ابواب الفقہ کے تحت احادیث');
      expect(rules.some((r) => r.connector === 'jkhssn')).toBe(true);
    });
    it('web strips every jkhssn tool even when the domain rule fires', () => {
      const n = names('auto', { ask: 'اس حدیث کا شجرۂ اسناد', platform: 'web' });
      for (const t of ['jkhssn_sanad_tree', 'jkhssn_narrator', 'jkhssn_takhrij', 'jkhssn_judgments', 'jkhssn_thematic']) {
        expect(n).not.toContain(t);
      }
    });
    it('citation closure still holds — insert_footnote survives with jkhssn_narrator', () => {
      const n = names('auto', { ask: 'اس راوی کا حال اور مرتبہ' });
      expect(n).toContain('insert_footnote');
    });
  });

  // M10 Phase 2.1 — platform: 'web' strips Word-COM/local-fs-only tools.
  describe('platform: web', () => {
    it('never exposes a native-only tool, with no narrowing at all', () => {
      const n = names('auto', { platform: 'web' });
      for (const nativeOnly of NATIVE_ONLY_TOOLS) expect(n).not.toContain(nativeOnly);
    });

    it('never exposes a native-only tool even when a playbook step names one', () => {
      // typeset_print_ready needs a playbook whose steps include it; if none
      // does today, this still proves the filter runs before FLOOR/allowed.
      for (const pb of PLAYBOOKS) {
        const n = names('auto', { platform: 'web', playbook: pb });
        for (const nativeOnly of NATIVE_ONLY_TOOLS) expect(n, pb.id).not.toContain(nativeOnly);
      }
    });

    it('never exposes a native-only tool even when a domain keyword names one', () => {
      // The typeset/font/index domain rules list several NATIVE_ONLY_TOOLS.
      for (const ask of ['نستعلیق font install کریں', 'typeset for print', 'فہرست بنائیں']) {
        const n = names('auto', { platform: 'web', ask });
        for (const nativeOnly of NATIVE_ONLY_TOOLS) expect(n, ask).not.toContain(nativeOnly);
      }
    });

    it('still exposes the read/citation tools web CAN reach', () => {
      const n = names('auto', { platform: 'web' });
      expect(n).toContain('search_corpus');
      expect(n).toContain('search_hadith');
      expect(n).toContain('insert_footnote');
    });

    it('omitting platform (desktop, and every pre-M10 caller) keeps native tools available', () => {
      const n = names('auto');
      expect(n).toContain('typeset_print_ready');
      expect(n).toContain('run_task');
    });
  });

  // ADR-0038 — the intent classifier's connector gating.
  describe('gateConnectors', () => {
    it('gated to tafsir drops the hadith connector tool but keeps FLOOR + insert_footnote', () => {
      const n = names('auto', { ask: 'اس آیت کی تفسیر', gateConnectors: ['tafsir'] });
      expect(n).toContain('query_tafseer');
      expect(n).not.toContain('search_hadith');
      expect(n).not.toContain('search_repositories');
      for (const f of FLOOR_TOOLS) expect(n).toContain(f);
      expect(n).toContain('insert_footnote'); // citation closure still runs last
    });

    it('gated to hadith drops query_tafseer', () => {
      const n = names('auto', { ask: 'اس حدیث کی سند', gateConnectors: ['hadith'] });
      expect(n).toContain('search_hadith');
      expect(n).not.toContain('query_tafseer');
    });

    it('gated to dorar (a grading ask) exposes grade_hadith, not query_tafseer', () => {
      const n = names('auto', { ask: 'کیا یہ حدیث صحیح ہے', gateConnectors: ['dorar'] });
      expect(n).toContain('grade_hadith');
      expect(n).not.toContain('query_tafseer');
      expect(n).toContain('insert_footnote'); // grade_hadith is a citable search
    });

    it('gated to rijal (a narrator ask) exposes lookup_narrator, not query_tafseer/grade_hadith', () => {
      const n = names('auto', { ask: 'راوی کا حال اور جرح و تعدیل', gateConnectors: ['rijal'] });
      expect(n).toContain('lookup_narrator');
      expect(n).not.toContain('query_tafseer');
      expect(n).not.toContain('grade_hadith');
    });

    it('gated to lexicon (a word-meaning ask) exposes lookup_lexicon, not search_hadith', () => {
      const n = names('auto', { ask: 'اس لفظ کا لغوی معنیٰ', gateConnectors: ['lexicon'] });
      expect(n).toContain('lookup_lexicon');
      expect(n).not.toContain('search_hadith');
      expect(n).toContain('insert_footnote');
    });

    it('gated to ganjoor (a Persian-poetry ask) exposes only search_persian_poetry', () => {
      const n = names('auto', { ask: 'رومی کی مثنوی کا شعر', gateConnectors: ['ganjoor'] });
      expect(n).toContain('search_persian_poetry');
      expect(n).not.toContain('lookup_urdu_verse');
      expect(n).not.toContain('search_hadith');
    });

    it('gated to urdu-prosody (a taqṭīʿ ask) exposes scan_urdu_prosody + lookup_urdu_verse, not Persian', () => {
      const n = names('auto', { ask: 'اس شعر کی تقطیع', gateConnectors: ['urdu-prosody'] });
      expect(n).toContain('scan_urdu_prosody');
      expect(n).toContain('lookup_urdu_verse');
      expect(n).not.toContain('search_persian_poetry');
    });

    it('gateConnectors: [] (a plain edit) keeps only non-connector tools', () => {
      const n = names('auto', { ask: 'اس جملے کو دوبارہ لکھو', gateConnectors: [] });
      expect(n).not.toContain('query_tafseer');
      expect(n).not.toContain('search_hadith');
      expect(n).not.toContain('search_shamela');
      expect(n).not.toContain('search_repositories');
      for (const f of FLOOR_TOOLS) expect(n).toContain(f); // search_corpus is FLOOR, not a connector
    });

    it('tolerates a gate id that matches no connector (drops all connector tools, no throw)', () => {
      const n = names('auto', { ask: 'اس حدیث کی سند', gateConnectors: ['nonexistent'] });
      expect(n).not.toContain('search_hadith');
      expect(n).not.toContain('query_tafseer');
      for (const f of FLOOR_TOOLS) expect(n).toContain(f);
    });

    it('Ask mode + gateConnectors still yields only read tools', () => {
      const n = toolsFor('ask', { ask: 'اس آیت کی تفسیر', gateConnectors: ['tafsir'] });
      expect(n.every((t) => t.effect === 'read')).toBe(true);
    });
  });

  // ADR-0044 — read_shamela_page / find_shamela_book ride along with search_shamela.
  describe('shamela closure', () => {
    it('wherever search_shamela survives narrowing, so do read_shamela_page + find_shamela_book', () => {
      const n = names('auto', { ask: 'صحیح البخاری میں اس مسئلے پر کیا ہے؟ حوالہ دیں' }); // hadith rule → search_shamela
      expect(n).toContain('search_shamela');
      expect(n).toContain('read_shamela_page');
      expect(n).toContain('find_shamela_book');
    });
    it('a plain ask with no shamela does not gain them', () => {
      const n = names('auto', { ask: 'اس شعر کی تقطیع' });
      expect(n).not.toContain('search_shamela');
      expect(n).not.toContain('read_shamela_page');
    });
  });

  describe('matchDomains', () => {
    it('the tafsir rule carries connector:tafsir, the hadith rule connector:hadith', () => {
      expect(matchDomains('اس آیت کی تفسیر').some((r) => r.connector === 'tafsir')).toBe(true);
      expect(matchDomains('اس حدیث کی سند').some((r) => r.connector === 'hadith')).toBe(true);
    });
    it('a plain ask matches no domain', () => {
      expect(matchDomains('اس جملے کو دوبارہ لکھو')).toHaveLength(0);
    });
    // ADR-0039 — a Qur'anic-root / qirāʾāt ask is Bahouth work → the tafsir connector.
    it('a root / qirāʾāt ask maps to the tafsir connector', () => {
      expect(matchDomains('لفظ "نصر" کے قرآنی جذر کے وقوعات').some((r) => r.connector === 'tafsir')).toBe(true);
      expect(matchDomains('اس کلمے کی قراءات بتائیں').some((r) => r.connector === 'tafsir')).toBe(true);
    });
    it('a root ask gates to query_tafseer only (not hadith)', () => {
      const n = names('auto', { ask: 'قرآنی جذر «نصر» کے وقوعات', gateConnectors: ['tafsir'] });
      expect(n).toContain('query_tafseer');
      expect(n).not.toContain('search_hadith');
    });
  });
});
