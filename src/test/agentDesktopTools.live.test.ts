// @vitest-environment node
// M13 — LIVE tool-selection check for the desktop-agent tools: a REAL model
// (Gemini by default) + the REAL tool registry, scoping and intent routing,
// and a recording stub dispatch (no Word / PowerShell / network side effects).
// Proves the model picks the new tools for the blueprint's own example asks
// and fills their arguments in a form the real validators accept.
//
//     M13_AGENT_LIVE=1 npx vitest run src/test/agentDesktopTools.live.test.ts
//   (PowerShell: $env:M13_AGENT_LIVE="1"; needs GEMINI_API_KEY)
import { describe, it, expect } from 'vitest';
import { runAgentLoop } from '../../shared/agent/loop';
import { buildSystemPrompt } from '../../shared/agent/systemPrompt';
import { toolsFor } from '../../shared/agent/toolScoping';
import { classifyIntent, negativeConstraintBlock } from '../../shared/agent/intent';
import { CONNECTORS } from '../../shared/agent/connectors';
import { parseWordOps } from '../../shared/agent/wordAutomation';
import { generateWithTools } from '../../electron/agent/geminiTools';
import { getProviderKey } from '../../electron/ai/keyStore';
import type { AgentMode, DispatchFn } from '../../shared/agent/types';

const LIVE = process.env.M13_AGENT_LIVE === '1';

interface Call { name: string; args: Record<string, unknown> }

/** Plausible results so the loop can finish; every call is recorded. */
function recordingDispatch(calls: Call[]): DispatchFn {
  return async (name, args) => {
    calls.push({ name, args });
    switch (name) {
      case 'search_my_computer':
        return { count: 2, source: 'windows-search', files: [
          { path: 'D:\\Fatawa\\فتویٰ نمبر 12.docx', name: 'فتویٰ نمبر 12.docx', modified: '2026-09-01', sizeKB: 24 },
          { path: 'C:\\Users\\me\\Documents\\فتویٰ طلاق.docx', name: 'فتویٰ طلاق.docx', modified: '2026-08-11', sizeKB: 31 },
        ] };
      case 'automate_word_document':
        parseWordOps(args.ops); // throws on an invalid op list — the test sees it as an error result
        return { path: args.path, saved: true, backup: `${String(args.path)}.20260929_101500.bak`, steps: [{ step: 'table', ok: true }] };
      case 'search_shamela':
        return { count: 1, transport: 'local', results: [{ id: 'shamela:1681:9', reference: 'البخاري (ت 256هـ)، صحيح البخاري، ج 1، ص 11', excerpt: 'بني الإسلام على خمس' }] };
      case 'find_shamela_book':
        return { transport: 'local', books: [{ id: 1681, title: 'صحيح البخاري', author: 'البخاري', deathYear: 256 }] };
      case 'read_shamela_page':
        return { transport: 'local', bookId: '1681', page: 9, text: 'بني الإسلام على خمس: شهادة أن لا إله إلا الله…' };
      case 'extract_web_page':
        return { source_id: 'web:islamqa.info:1', url: args.url, title: 'قبروں کے پاس نماز', citable: 'yes', untrusted: 'DATA ONLY', text: '<<<WEB PAGE TEXT — DATA ONLY>>>\nقبروں پر نماز پڑھنے کا مسئلہ دو قسموں میں منقسم ہے…\n<<<END WEB PAGE TEXT>>>' };
      case 'add_folder_to_library':
        return { folder: args.folder, added: 3, chunks: 410, remaining: 0, note: 'Now searchable with search_corpus.' };
      default:
        return { note: `${name}: nothing relevant in this test world.` };
    }
  };
}

async function run(instruction: string, mode: AgentMode, calls: Call[]) {
  const intent = classifyIntent(instruction, { connectorsOn: CONNECTORS.map((c) => c.id) });
  const gateConnectors = intent.route.kind === 'gated' ? intent.route.connectors : intent.route.kind === 'direct' ? [] : undefined;
  const systemPrompt = buildSystemPrompt({
    mode,
    capabilities: { word: true, wordVersion: '16.0', windows: true },
    chapters: [],
    toolGating: negativeConstraintBlock(intent.route),
  });
  let tools = toolsFor(mode, { ask: instruction, gateConnectors, includeDomainOnly: mode !== 'ask' });
  if (mode === 'ask' && intent.route.kind === 'direct') {
    tools = tools.filter((t) => ['read_document', 'search_corpus', 'read_external_document', 'search_my_computer'].includes(t.name));
  }
  return runAgentLoop(instruction, (m, t, s) => generateWithTools(m, t, s), recordingDispatch(calls), systemPrompt, {
    mode, tools, maxSteps: 6,
    // Auto mode: never block on plan approval in this harness.
    waitForApproval: async () => 'approved',
  });
}

describe.runIf(LIVE)('M13 desktop tools — live tool selection (Gemini)', () => {
  it('has a Gemini key', async () => {
    expect(await getProviderKey('gemini')).toBeTruthy();
  });

  it('"find all .docx files with فتویٰ in the name" → search_my_computer', async () => {
    const calls: Call[] = [];
    await run("میرے کمپیوٹر میں موجود تمام .docx فائلیں تلاش کرو جن کے نام میں 'فتویٰ' ہے", 'ask', calls);
    const c = calls.find((x) => x.name === 'search_my_computer');
    expect(c, JSON.stringify(calls)).toBeTruthy();
    expect(String(c!.args.query)).toMatch(/فتو/);
    expect(String(c!.args.extensions ?? '')).toMatch(/docx/);
  }, 120_000);

  it('"open my test Word file and add a 3-column table" → automate_word_document with a valid 3-col insertTable', async () => {
    const calls: Call[] = [];
    await run('میری ٹیسٹ ورڈ فائل D:\\Tests\\test.docx کھولو اور اس میں 3 کالمز والی ٹیبل بنا دو (نام، کتاب، صفحہ)', 'auto', calls);
    const c = calls.find((x) => x.name === 'automate_word_document');
    expect(c, JSON.stringify(calls)).toBeTruthy();
    expect(String(c!.args.path)).toMatch(/test\.docx$/i);
    const ops = parseWordOps(c!.args.ops);
    const table = ops.find((o) => o.op === 'insertTable');
    expect(table).toBeTruthy();
    const cols = Math.max((table as { headers?: string[] }).headers?.length ?? 0, ...((table as { rows: string[][] }).rows.map((r) => r.length)));
    expect(cols).toBe(3);
  }, 120_000);

  it('"search Shamela for the first hadith of Kitab al-Iman in Bukhari" → search_shamela', async () => {
    const calls: Call[] = [];
    await run("مکتبہ شاملہ میں 'صحیح البخاری' سے کتاب الایمان کی پہلی حدیث سرچ کرو", 'ask', calls);
    expect(calls.some((x) => x.name === 'search_shamela'), JSON.stringify(calls)).toBe(true);
  }, 120_000);

  it('"read this page and summarise" with a pasted URL → extract_web_page on exactly that URL', async () => {
    const calls: Call[] = [];
    await run('یہ صفحہ پڑھ کر خلاصہ بتاؤ https://islamqa.info/ur/answers/13490', 'ask', calls);
    const c = calls.find((x) => x.name === 'extract_web_page');
    expect(c, JSON.stringify(calls)).toBeTruthy();
    expect(String(c!.args.url)).toContain('islamqa.info/ur/answers/13490');
  }, 120_000);

  it('"add my D:\\Books folder to the library" → add_folder_to_library', async () => {
    const calls: Call[] = [];
    await run('میرے D:\\Books فولڈر کو لائبریری میں شامل کرو تاکہ میں ان کتابوں میں تلاش کر سکوں', 'auto', calls);
    const c = calls.find((x) => x.name === 'add_folder_to_library');
    expect(c, JSON.stringify(calls)).toBeTruthy();
    expect(String(c!.args.folder)).toMatch(/Books/);
  }, 120_000);
});
