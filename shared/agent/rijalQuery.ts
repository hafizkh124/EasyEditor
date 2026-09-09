/**
 * Connectors Hub (Phase 5, ADR-0041) — the rijāl query builder.
 *
 * `lookup_narrator` does not need a new data source: EasyEditor's corpus
 * already holds ~19.6k narrator biographies (`classical-rijal`, ADR-0014) plus
 * the per-book narration counts, reached through `islamic-search`'s Tier D.
 * That tier auto-fires when `planQuery` detects the `rijal` discipline in the
 * question — so this shapes the narrator name + aspect into an Arabic query
 * that reads unmistakably as a rijāl question.
 *
 * Isnād-chain tracing between two narrators (`trace_isnad`) needs a transmission
 * GRAPH the corpus does not have yet — deferred to a later phase.
 *
 * Pure — no runtime globals.
 */

export type NarratorAspect = 'biography' | 'grade' | 'teachers-students' | 'narration-count';

const ASPECT_FOCUS: Record<NarratorAspect, string> = {
  biography: 'ترجمته ونسبه وكنيته وتاريخ وفاته وطبقته',
  grade: 'الجرح والتعديل وأقوال أئمة النقد فيه ودرجته',
  'teachers-students': 'شيوخه وتلاميذه ومن روى عنه ومن روى عنهم',
  'narration-count': 'كم حديثًا روى وفي أي كتب الحديث خرّجت روايته',
};

export function buildRijalQuery(name: string, aspect: NarratorAspect = 'biography'): string {
  const focus = ASPECT_FOCUS[aspect] ?? ASPECT_FOCUS.biography;
  return `ترجمة الراوي «${name.trim()}» في كتب أسماء الرجال — ${focus} (رجال، جرح وتعديل، تراجم الرواة)`;
}
