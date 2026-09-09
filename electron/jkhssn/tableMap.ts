/**
 * Declarative "which readable source columns land in which `jkhssn.sqlite`
 * table". `buildIndex.ts` walks this — one loop, not 20 bespoke functions.
 *
 * Only plain columns are listed: int32 (`i`), bool (`b`), plain CP1256 text
 * (`t`). Compressed source columns (`Nouns.Name`, `Asaned.SandRwah`,
 * `AsanedTree.Name`, `HTakhreeg.PivotRawy`, …) are deliberately absent.
 *
 * `from` is the source column name exactly as it appears in the table's
 * `Catalog.xml`; `to` is the `jkhssn.sqlite` column. Source column names verified
 * against D:\JKHSSN 2026-09-10.
 */

export type ColKind = 'i' | 'b' | 't';

export interface ColumnMap {
  from: string;
  to: string;
  kind: ColKind;
}

export interface TableMap {
  /** جوامع الكلم source table directory name. */
  source: string;
  /** Target `jkhssn.sqlite` table. */
  target: string;
  columns: ColumnMap[];
  /** Optional: only keep source rows where this bool/int column is truthy. */
  filter?: string;
}

const i = (from: string, to = from): ColumnMap => ({ from, to, kind: 'i' });
const b = (from: string, to = from): ColumnMap => ({ from, to, kind: 'b' });
const t = (from: string, to = from): ColumnMap => ({ from, to, kind: 't' });

export const TABLE_MAPS: TableMap[] = [
  {
    source: 'Nouns',
    target: 'narrator',
    columns: [
      i('ID', 'jk_rawy_id'),
      i('DeathYearNum', 'death_year_num'),
      i('TabaqaNum', 'tabaqa_num'),
      i('HadithsCount', 'hadiths_count'),
      t('Tabaqa', 'tabaqa'),
      t('BirthYear', 'birth_year'),
      t('DeathYear', 'death_year'),
      t('MartabaIbnHajar', 'martaba_ibn_hajar'),
      t('MartabaZahabi', 'martaba_zahabi'),
      t('BirthCity', 'birth_city'),
      t('DeathCity', 'death_city'),
      t('LivingCity', 'living_city'),
      t('Mazhb', 'mazhab'),
      b('IsRawy', 'is_rawy'),
      b('IsScientist', 'is_scientist'),
    ],
  },
  {
    source: 'NounsForms',
    target: 'narrator_form',
    columns: [i('RawyID', 'jk_rawy_id'), t('RawyTextShape', 'name_shape'), i('Frequency', 'frequency')],
  },
  {
    source: 'NounsGarh',
    target: 'jarh_verdict',
    columns: [i('ID', 'id'), t('Text', 'text'), b('IsTaqreeb', 'is_taqreeb')],
  },
  {
    source: 'NounsGarhLinks',
    target: 'narrator_jarh',
    columns: [i('RawyID', 'jk_rawy_id'), i('GarhID', 'verdict_id'), i('SayID', 'critic_say_id')],
  },
  {
    source: 'NounsScientistsSays',
    target: 'critic_say',
    columns: [i('ID', 'id'), i('RawyID', 'jk_rawy_id'), i('NScientistID', 'scientist_id'), t('Say', 'say')],
  },
  {
    source: 'NounsShyoukhTalamize',
    target: 'teacher_student',
    columns: [i('RawyID', 'student_id'), i('ShyoukhID', 'teacher_id'), i('HadithsCount', 'hadiths_count')],
  },
  {
    source: 'Asaned',
    target: 'isnad_chain',
    columns: [i('ID', 'jk_sanad_id'), i('SandTypes', 'sand_types'), i('HadithsCount', 'hadiths_count')],
  },
  {
    source: 'AsanedHadiths',
    target: 'hadith_chain',
    columns: [
      i('HadithMainID', 'hadith_main_id'),
      i('SanadID', 'jk_sanad_id'),
      i('BookID', 'book_id'),
      i('SanadType', 'sanad_type'),
      i('SanadTahdethID', 'sanad_tahdeth_id'),
    ],
  },
  {
    source: 'AsanedTree',
    target: 'isnad_node',
    columns: [
      i('ID', 'id'),
      i('ParentID', 'parent_id'),
      i('LeftValue', 'left_val'),
      i('RightValue', 'right_val'),
      i('RawyID', 'jk_rawy_id'),
      b('IsLeaf', 'is_leaf'),
      b('isMarfoa', 'is_marfoa'),
      b('isMawkof', 'is_mawkof'),
      b('isMaktoa', 'is_maktoa'),
      b('isMarfoaHokm', 'is_marfoa_hokm'),
    ],
  },
  {
    source: 'HTakhreeg',
    target: 'takhrij',
    columns: [
      i('HadithMainID', 'hadith_main_id'),
      i('GroupID', 'group_id'),
      i('CompoundMatnID', 'compound_matn_id'),
      i('PivotID', 'pivot_id'),
      i('MatnLength', 'matn_length'),
      b('IsStory', 'is_story'),
      i('BookID', 'book_id'),
    ],
  },
  {
    source: 'HGamhAlMatn',
    target: 'matn_group_member',
    columns: [i('GroupID', 'group_id'), i('HadithMainID', 'hadith_main_id'), i('BookID', 'book_id')],
  },
  {
    source: 'HadithJudgmentSays',
    target: 'judgment',
    columns: [i('ID', 'id'), i('ScientistID', 'scientist_id'), t('Say', 'say')],
  },
  {
    source: 'HadithJudgmentHits',
    target: 'judgment_hit',
    columns: [i('SayID', 'judgment_id'), i('HadithMainID', 'hadith_main_id')],
  },
  {
    source: 'HadithGhareeb',
    target: 'hadith_ghareeb',
    columns: [i('HadithMainID', 'hadith_main_id')],
  },
  {
    source: 'HadithModrag',
    target: 'hadith_modrag',
    columns: [i('HadithMainID', 'hadith_main_id')],
  },
  {
    source: 'Subject',
    target: 'subject',
    columns: [
      i('ID', 'id'),
      i('ParentID', 'parent_id'),
      i('LeftValue', 'left_val'),
      i('RightValue', 'right_val'),
      b('IsLeaf', 'is_leaf'),
      t('SubjectTitle', 'title'),
    ],
  },
  {
    source: 'SubjectHit',
    target: 'subject_hit',
    columns: [i('SubjectID', 'subject_id'), i('ParagraphMainID', 'hadith_main_id')],
  },
  {
    source: 'Authors',
    target: 'author',
    columns: [i('ID', 'jk_author_id'), t('Name', 'name')],
  },
];

/**
 * `HMatnComparison1..33` are identical-schema shards (partitioned by
 * MasterMatnID range). `buildIndex.loadMatnComparison` unions the readable
 * int32 columns (`MasterMatnID`, `SlaveMatnID`, `MatchSort`) into
 * `matn_comparison`.
 */
export const MATN_COMPARISON_SHARDS = 33;

/**
 * `HadithServicesState` is folded specially: `Degree` -> `service_state.degree`,
 * every other bool -> a JSON blob in `flags_json`.
 */
export const SERVICE_STATE_SOURCE = 'HadithServicesState';
export const SERVICE_STATE_FLAG_COLUMNS = [
  'Takhreg', 'CompoundMatn', 'Rwah', 'Asnad', 'Shawahed', 'Ghareeb', 'Sharh', 'Subjects',
  'Tafsser', 'Biography', 'Medicine', 'Feqh', 'Asbab', 'Mokhtalaf', 'Amthal', 'Kerat',
  'ProperName', 'Countries', 'MatnComparison', 'Modrag', 'Motawater',
];

/** FTS rows: (source table, text column, kind label, ref-id column). */
export const FTS_SOURCES: Array<{ target: string; textCol: string; kind: string; refCol: string }> = [
  { target: 'jarh_verdict', textCol: 'text', kind: 'verdict', refCol: 'id' },
  { target: 'critic_say', textCol: 'say', kind: 'critic_say', refCol: 'id' },
  { target: 'judgment', textCol: 'say', kind: 'judgment', refCol: 'id' },
  { target: 'subject', textCol: 'title', kind: 'subject', refCol: 'id' },
  { target: 'book_toc', textCol: 'section_text', kind: 'section', refCol: 'paragraph_id' },
];
