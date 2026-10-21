/**
 * Custom skills as `skill.md` files — the import/export format for the
 * scholar's own skills (Settings → Skills).
 *
 *   ---
 *   id: my-takhrij            (optional — derived from the title when absent)
 *   title: Takhrij of a hadith
 *   trigger: takhrij
 *   keywords: takhrij, تخريج, تخریج
 *   steps: search_hadith, grade_hadith, insert_footnote
 *   ---
 *   <the skill text — becomes the playbook's `guidance`>
 *
 * Steps name tools from the CLOSED registry only; each tool's required args
 * are bound for a scoped model call at run time (same as a built-in
 * playbook). `validateCustomSkill` rejects anything the executor could not run.
 * Pure — no runtime globals.
 */
import type { Playbook, PlaybookStep } from './registry.js';
import { validatePlaybook } from './executor.js';
import { getTool } from '../agent/toolSchemas.js';

export const CUSTOM_SKILL_PREFIX = 'custom-';

export type ParseSkillResult = { ok: true; skill: Playbook } | { ok: false; errors: string[] };

const list = (v: string): string[] =>
  v.split(/[,،]/).map((x) => x.trim()).filter(Boolean);

/** A stable ascii id from a title/trigger; always carries the `custom-` prefix. */
export function customSkillId(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/^custom-/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${CUSTOM_SKILL_PREFIX}${slug || Date.now().toString(36)}`;
}

/** Default step for a tool: bind every required arg (the context fills `chapter`). */
export function stepForTool(tool: string): PlaybookStep | null {
  const def = getTool(tool);
  if (!def) return null;
  return { tool, bind: [...def.required], note: def.description.split(/[.—]/)[0].trim().slice(0, 120) || tool };
}

/** Build + validate a skill from loose fields (used by the file parser and the editor dialog). */
export function buildCustomSkill(f: {
  id?: string;
  title: string;
  trigger?: string;
  keywords?: string[];
  guidance?: string;
  steps: string[];
}): ParseSkillResult {
  const errors: string[] = [];
  const title = f.title.trim();
  if (!title) errors.push('title is required');
  const trigger = (f.trigger ?? '').trim().replace(/^\//, '');
  if (trigger && !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(trigger)) {
    errors.push('trigger may only contain letters, digits, "-" and "_" (no spaces)');
  }
  const steps: PlaybookStep[] = [];
  for (const name of f.steps) {
    const step = stepForTool(name);
    if (!step) errors.push(`unknown tool "${name}" in steps`);
    else steps.push(step);
  }
  if (!steps.length) errors.push('at least one step (a tool name) is required');
  if (errors.length) return { ok: false, errors };

  const rawId = (f.id ?? '').trim();
  const skill: Playbook = {
    id: customSkillId(rawId || trigger || title),
    title,
    ...(trigger ? { trigger } : {}),
    keywords: (f.keywords ?? []).map((k) => k.trim()).filter(Boolean),
    ...(f.guidance?.trim() ? { guidance: f.guidance.trim() } : {}),
    steps,
  };
  const problems = validatePlaybook(skill);
  return problems.length ? { ok: false, errors: problems } : { ok: true, skill };
}

/** Parse a `skill.md` (front matter + body) into a validated custom skill. */
export function parseSkillMarkdown(text: string): ParseSkillResult {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const m = src.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n([\s\S]*))?$/);
  if (!m) return { ok: false, errors: ['missing front matter: the file must start with a "---" block (title, trigger, keywords, steps)'] };

  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_]+)\s*:\s*(.*)$/);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim();
  }
  return buildCustomSkill({
    id: meta.id,
    title: meta.title ?? '',
    trigger: meta.trigger,
    keywords: list(meta.keywords ?? ''),
    guidance: m[2] ?? '',
    steps: list(meta.steps ?? ''),
  });
}

/** The inverse of {@link parseSkillMarkdown} — round-trips through Import. */
export function serializeSkillMarkdown(skill: Playbook): string {
  const head = [
    '---',
    `id: ${skill.id}`,
    `title: ${skill.title}`,
    ...(skill.trigger ? [`trigger: ${skill.trigger}`] : []),
    `keywords: ${skill.keywords.join(', ')}`,
    `steps: ${skill.steps.map((s) => s.tool).join(', ')}`,
    '---',
  ];
  return `${head.join('\n')}\n${skill.guidance ?? ''}\n`;
}
