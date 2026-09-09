/**
 * ADR-0045 — shaping a جوامع الكلم axis result into an Arabic research query so
 * the signed-in `islamic-search` bridge fills in the narrator display names and
 * verbatim matn the local index does not carry (they are compressed at source).
 *
 * Sibling of `rijalQuery.ts` / `lexiconQuery.ts`. Pure — no runtime globals.
 */

export type JkhssnNarratorAspect = 'biography' | 'jarh' | 'teachers' | 'students' | 'all';

const NARRATOR_FOCUS: Record<JkhssnNarratorAspect, string> = {
  biography: 'ترجمته ونسبه وكنيته وتاريخ وفاته وطبقته وبلده',
  jarh: 'الجرح والتعديل وأقوال أئمة النقد فيه ومرتبته عند ابن حجر والذهبي',
  teachers: 'شيوخه ومن روى عنهم',
  students: 'تلاميذه ومن روى عنه',
  all: 'ترجمته وطبقته وتاريخ وفاته والجرح والتعديل ومرتبته وشيوخه وتلاميذه',
};

/** An Arabic rijāl query for a narrator known to جوامع الكلم by its name shapes. */
export function buildJkhssnNarratorQuery(nameShapes: string[], aspect: JkhssnNarratorAspect = 'all'): string {
  const name = (nameShapes[0] ?? '').trim() || (nameShapes[1] ?? '').trim();
  const alt = nameShapes.slice(1, 3).filter(Boolean).join('، ');
  const focus = NARRATOR_FOCUS[aspect] ?? NARRATOR_FOCUS.all;
  return `ترجمة الراوي «${name}»${alt ? ` (ويقال: ${alt})` : ''} في كتب أسماء الرجال — ${focus} (رجال، جرح وتعديل، تراجم الرواة)`;
}

/** An Arabic query to pull the verbatim matn + any grading for a hadith جوامع
 *  الكلم knows only by its collection + printed number. */
export function buildJkhssnMatnQuery(hint: { collection?: string; number?: string; phrase?: string }): string {
  const parts = [
    hint.phrase ? `«${hint.phrase.trim()}»` : '',
    hint.collection ? `في ${hint.collection}` : '',
    hint.number ? `رقم ${hint.number}` : '',
  ].filter(Boolean);
  return `متن الحديث ${parts.join(' ')} بتمامه مع تخريجه ودرجته (حديث، متن، تخريج)`;
}
