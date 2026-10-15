/**
 * Moves Qur'an verses and weak-graded hadith behind the other results when the
 * question is a practical one ("what is the ruling on…", "can I…").
 *
 * Measured live (2026-10-16, 6 judged Urdu questions, precision@10 = 38%): for
 * "نماز میں بچے کو اٹھانا کا حکم" four of the first ten were verses that only share
 * the word "نماز" (2:238, 20:14, 2:43, 31:17) while the real hadith (Mishkat 984)
 * sat at rank 7; "والدین کے ساتھ حسنِ سلوک" had three unrelated weak/fabricated
 * entries (al-Jami' al-Saghir, Da'if al-Jami', al-Silsilah al-Da'ifah) in its ten.
 * The planner says "both or unclear → both" so sourceScope never removes them.
 *
 * Deliberately conservative: it only REORDERS (nothing is dropped, so they still
 * show under "more results"), keeps topic anchors first, does nothing when the
 * question asks for the Qur'an itself, and keeps the original order inside each
 * bucket.
 */
import { QURAN_DOMAINS } from "./sourceScope.ts";

export interface RulingRow {
  domain: string;
  content?: string;
  content_ar?: string;
  citation_ref?: { collection?: string; book?: string; _is_anchor?: boolean; [k: string]: unknown };
}

// The question itself is about the Qur'an / tafsir: leave the order alone.
const ASKS_QURAN = /آیت|آیات|آیۃ|قرآن|قران|سورہ|سورة|سوره|تفسیر|تفسير|ayah|ayat|verse|quran|qur'an|tafsir|الآية|الآيات|القرآن|تفسير/i;

// Weak/fabricated grading: either the collection is a weak-hadith book or the
// row's own grade tag ("— ضعيف", "— موضوع") says so.
const WEAK_COLLECTION = /daeef|daif|dhaif|da'if|ضعيف|ضعفاء|mawdu|mawdoo|موضوع/i;
const WEAK_TAG = /[—–-]\s*(?:ضعيف|موضوع|منكر|باطل|لا أصل له|ما عرفته|لا يصح)/;

export function isWeakRow(r: RulingRow): boolean {
  const c = `${r.citation_ref?.collection ?? ""} ${r.citation_ref?.book ?? ""}`;
  if (WEAK_COLLECTION.test(c)) return true;
  const tail = (r.content ?? "").slice(-160);
  return WEAK_TAG.test(tail);
}

export function asksForQuran(query: string | null | undefined): boolean {
  return ASKS_QURAN.test(query ?? "");
}

// A "what is the ruling" cue. Topic anchors are matched on ONE word of the
// question, so "نماز میں بچے کو اٹھانے کا حکم" pinned three generic prayer verses
// (2:238, 20:14, 2:43) above the one hadith about carrying a child. Under a
// ruling cue a Qur'an anchor loses its pin; hadith anchors keep it.
const RULING_CUE = /حکم|جائز|ناجائز|حلال|حرام|مسئل|فتو|کیا\s|حكم|يجوز|هل\s|فتوى/;

export function demoteQuranAndWeak<T extends RulingRow>(rows: T[], query: string | null | undefined): T[] {
  if (!query || rows.length < 2 || asksForQuran(query)) return rows;
  const unpinQuranAnchors = RULING_CUE.test(query);
  const first: T[] = [], quran: T[] = [], weak: T[] = [], rest: T[] = [];
  for (const r of rows) {
    if (r.citation_ref?._is_anchor === true && !(unpinQuranAnchors && QURAN_DOMAINS.has(r.domain))) first.push(r);
    else if (QURAN_DOMAINS.has(r.domain)) quran.push(r);
    else if (isWeakRow(r)) weak.push(r);
    else rest.push(r);
  }
  if (quran.length === 0 && weak.length === 0) return rows;
  // A pile of nothing-but-Qur'an/weak rows has no better rows to promote.
  if (rest.length === 0) return rows;
  return [...first, ...rest, ...quran, ...weak];
}
