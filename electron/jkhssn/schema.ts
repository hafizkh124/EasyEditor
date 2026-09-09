/**
 * `jkhssn.sqlite` DDL as a string (so the bundler needs no `.sql` asset config).
 * The human-readable source of truth with per-column provenance comments is the
 * sibling `schema.sql` — keep the two in sync; `schema.sql` is not loaded at
 * runtime.
 *
 * Bump `JKHSSN_INDEX_SCHEMA_VERSION` in `shared/jkhssn/constants.ts` on any
 * change here that invalidates an existing build.
 */
export const JKHSSN_SCHEMA_SQL = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- In جوامع الكلم, Nouns stores 'X' as a plain-text label and 'XNum' as an int.
-- Ibn Hajar / Dhahabi ranks, tabaqa, cities and mazhab are TEXT (e.g. the full
-- التقريب formula "صدوق يهم"), not numeric codes.
CREATE TABLE narrator (
  jk_rawy_id        INTEGER PRIMARY KEY,
  death_year_num    INTEGER, tabaqa_num INTEGER, hadiths_count INTEGER,
  tabaqa TEXT, birth_year TEXT, death_year TEXT,
  martaba_ibn_hajar TEXT, martaba_zahabi TEXT,
  birth_city TEXT, death_city TEXT, living_city TEXT, mazhab TEXT,
  is_rawy INTEGER, is_scientist INTEGER,
  name_shape TEXT, name_shape_freq INTEGER
);

CREATE TABLE narrator_form (jk_rawy_id INTEGER NOT NULL, name_shape TEXT NOT NULL, frequency INTEGER);
CREATE INDEX ix_narrator_form_rawy ON narrator_form(jk_rawy_id);

CREATE TABLE jarh_verdict (id INTEGER PRIMARY KEY, text TEXT NOT NULL, is_taqreeb INTEGER DEFAULT 0);

CREATE TABLE narrator_jarh (jk_rawy_id INTEGER NOT NULL, verdict_id INTEGER NOT NULL, critic_say_id INTEGER);
CREATE INDEX ix_narrator_jarh_rawy ON narrator_jarh(jk_rawy_id);

-- id is a GROUP id in جوامع الكلم, not unique: one 'say' can be linked to many
-- narrators (18k dup ids out of 171k rows). Non-unique, indexed both ways.
CREATE TABLE critic_say (id INTEGER, jk_rawy_id INTEGER, scientist_id INTEGER, say TEXT NOT NULL);
CREATE INDEX ix_critic_say_rawy ON critic_say(jk_rawy_id);
CREATE INDEX ix_critic_say_id   ON critic_say(id);

CREATE TABLE teacher_student (student_id INTEGER NOT NULL, teacher_id INTEGER NOT NULL, hadiths_count INTEGER);
CREATE INDEX ix_ts_student ON teacher_student(student_id);
CREATE INDEX ix_ts_teacher ON teacher_student(teacher_id);

CREATE TABLE isnad_chain (jk_sanad_id INTEGER PRIMARY KEY, sand_types INTEGER, hadiths_count INTEGER);

CREATE TABLE hadith_chain (
  hadith_main_id INTEGER NOT NULL, jk_sanad_id INTEGER NOT NULL,
  book_id INTEGER, sanad_type INTEGER, sanad_tahdeth_id INTEGER
);
CREATE INDEX ix_hadith_chain_hmid  ON hadith_chain(hadith_main_id);
CREATE INDEX ix_hadith_chain_sanad ON hadith_chain(jk_sanad_id);

CREATE TABLE isnad_node (
  id INTEGER PRIMARY KEY, parent_id INTEGER, left_val INTEGER, right_val INTEGER, jk_rawy_id INTEGER,
  is_leaf INTEGER, is_marfoa INTEGER, is_mawkof INTEGER, is_maktoa INTEGER, is_marfoa_hokm INTEGER
);
CREATE INDEX ix_isnad_node_parent ON isnad_node(parent_id);
CREATE INDEX ix_isnad_node_rawy   ON isnad_node(jk_rawy_id);

CREATE TABLE takhrij (
  hadith_main_id INTEGER NOT NULL, group_id INTEGER, compound_matn_id INTEGER, pivot_id INTEGER,
  matn_length INTEGER, is_story INTEGER, book_id INTEGER
);
CREATE INDEX ix_takhrij_hmid  ON takhrij(hadith_main_id);
CREATE INDEX ix_takhrij_group ON takhrij(group_id);
CREATE INDEX ix_takhrij_pivot ON takhrij(pivot_id);

CREATE TABLE matn_group_member (group_id INTEGER NOT NULL, hadith_main_id INTEGER NOT NULL, book_id INTEGER);
CREATE INDEX ix_mgm_group ON matn_group_member(group_id);

CREATE TABLE matn_comparison (master_matn_id INTEGER NOT NULL, slave_matn_id INTEGER NOT NULL, match_sort INTEGER);
CREATE INDEX ix_matn_cmp_master ON matn_comparison(master_matn_id);

CREATE TABLE judgment (id INTEGER PRIMARY KEY, scientist_id INTEGER, say TEXT NOT NULL);

CREATE TABLE judgment_hit (judgment_id INTEGER NOT NULL, hadith_main_id INTEGER NOT NULL);
CREATE INDEX ix_judgment_hit_hmid ON judgment_hit(hadith_main_id);

CREATE TABLE hadith_ghareeb (hadith_main_id INTEGER NOT NULL);
CREATE INDEX ix_hadith_ghareeb_hmid ON hadith_ghareeb(hadith_main_id);

CREATE TABLE hadith_modrag (hadith_main_id INTEGER NOT NULL);

-- flags_bits: bit i set = SERVICE_STATE_FLAG_COLUMNS[i] is 1 for this hadith.
CREATE TABLE service_state (hadith_main_id INTEGER PRIMARY KEY, degree INTEGER, flags_bits INTEGER NOT NULL DEFAULT 0);

CREATE TABLE subject (
  id INTEGER PRIMARY KEY, parent_id INTEGER, left_val INTEGER, right_val INTEGER, is_leaf INTEGER, title TEXT
);
CREATE INDEX ix_subject_parent ON subject(parent_id);

CREATE TABLE subject_hit (subject_id INTEGER NOT NULL, hadith_main_id INTEGER NOT NULL);
CREATE INDEX ix_subject_hit_subject ON subject_hit(subject_id);
-- No hadith_main_id index here: "which topics is this hadith under" is a rare
-- query and the index costs ~15 MB on 1.35M rows. See schema.sql / ADR-0045.

-- paragraph_id is NOT unique in جوامع الكلم's BookTOC_Hadith export — no PK.
CREATE TABLE book_toc (
  paragraph_id INTEGER, main_id INTEGER, parent_id INTEGER, left_val INTEGER, right_val INTEGER,
  is_leaf INTEGER, is_paragraph INTEGER, book_id INTEGER, part_num INTEGER, page_num INTEGER,
  section_text TEXT, tarqeem_matboa1 TEXT, tarqeem_matboa2 TEXT, tarqeem_harf TEXT
);
CREATE INDEX ix_book_toc_book ON book_toc(book_id);
CREATE INDEX ix_book_toc_main ON book_toc(main_id);

CREATE TABLE author (jk_author_id INTEGER PRIMARY KEY, name TEXT);

-- Contentless FTS (content='') — the text is NOT stored a second time here;
-- fts_map turns an FTS rowid back into (kind, source ref_id) so the axis can
-- fetch the real text from critic_say / judgment / jarh_verdict / book_toc.
CREATE VIRTUAL TABLE jkhssn_fts USING fts5(
  text,
  content = '',
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TABLE fts_map (fts_rowid INTEGER PRIMARY KEY, kind TEXT NOT NULL, ref_id INTEGER NOT NULL);
CREATE INDEX ix_fts_map_kind ON fts_map(kind, ref_id);
`;
