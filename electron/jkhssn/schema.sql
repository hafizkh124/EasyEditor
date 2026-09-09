-- jkhssn.sqlite — the local index built from the readable plain columns of the
-- جوامع الكلم column-store (ADR-0045). Ids are جوامع الكلم's own numeric ids,
-- prefixed `jk_` where they cross into our tables. Text columns hold ONLY the
-- readable CP1256 apparatus (verdicts, rulings, titles, printed numbers) — never
-- narrator display names or verbatim matn, which are compressed at source and
-- resolved from Supabase at query time.
--
-- Bump JKHSSN_INDEX_SCHEMA_VERSION in shared/jkhssn/constants.ts on any change
-- here that invalidates an existing build.

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- keys: schema_version, source_path, build_started_at, build_completed_at,
--       builder_version, row_counts (JSON), framing_model

-- ── narrators (axis 3) ──────────────────────────────────────────────────────

-- Nouns stores 'X' as a plain-text label and 'XNum' as an int. Ibn Hajar /
-- Dhahabi ranks, tabaqa, cities, mazhab are all TEXT (the full التقريب formula
-- etc.), not numeric codes.
CREATE TABLE narrator (
  jk_rawy_id         INTEGER PRIMARY KEY,   -- Nouns.ID
  death_year_num     INTEGER,               -- Nouns.DeathYearNum
  tabaqa_num         INTEGER,               -- Nouns.TabaqaNum
  hadiths_count      INTEGER,               -- Nouns.HadithsCount
  tabaqa             TEXT,                  -- Nouns.Tabaqa
  birth_year         TEXT,                  -- Nouns.BirthYear
  death_year         TEXT,                  -- Nouns.DeathYear
  martaba_ibn_hajar  TEXT,                  -- Nouns.MartabaIbnHajar
  martaba_zahabi     TEXT,                  -- Nouns.MartabaZahabi
  birth_city         TEXT,                  -- Nouns.BirthCity
  death_city         TEXT,                  -- Nouns.DeathCity
  living_city        TEXT,                  -- Nouns.LivingCity
  mazhab             TEXT,                  -- Nouns.Mazhb
  is_rawy            INTEGER,
  is_scientist       INTEGER,
  name_shape         TEXT,                  -- best NounsForms.RawyTextShape for this id
  name_shape_freq    INTEGER
);

CREATE TABLE narrator_form (
  jk_rawy_id  INTEGER NOT NULL,
  name_shape  TEXT NOT NULL,
  frequency   INTEGER
);
CREATE INDEX ix_narrator_form_rawy ON narrator_form(jk_rawy_id);

CREATE TABLE jarh_verdict (
  id          INTEGER PRIMARY KEY,          -- NounsGarh.ID
  text        TEXT NOT NULL,                -- NounsGarh.Text (plain)
  is_taqreeb  INTEGER DEFAULT 0
);

CREATE TABLE narrator_jarh (
  jk_rawy_id    INTEGER NOT NULL,           -- NounsGarhLinks.RawyID
  verdict_id    INTEGER NOT NULL,           -- NounsGarhLinks.GarhID
  critic_say_id INTEGER                     -- NounsGarhLinks.SayID (-> critic_say.id)
);
CREATE INDEX ix_narrator_jarh_rawy ON narrator_jarh(jk_rawy_id);

CREATE TABLE critic_say (
  id           INTEGER PRIMARY KEY,         -- NounsScientistsSays.ID
  jk_rawy_id   INTEGER,                     -- NounsScientistsSays.RawyID
  scientist_id INTEGER,                     -- NounsScientistsSays.NScientistID
  say          TEXT NOT NULL                -- NounsScientistsSays.Say (plain)
);
CREATE INDEX ix_critic_say_rawy ON critic_say(jk_rawy_id);

CREATE TABLE teacher_student (
  student_id    INTEGER NOT NULL,           -- NounsShyoukhTalamize.RawyID
  teacher_id    INTEGER NOT NULL,           -- NounsShyoukhTalamize.ShyoukhID
  hadiths_count INTEGER
);
CREATE INDEX ix_ts_student ON teacher_student(student_id);
CREATE INDEX ix_ts_teacher ON teacher_student(teacher_id);

-- ── isnād trees (axis 2) ────────────────────────────────────────────────────

CREATE TABLE isnad_chain (
  jk_sanad_id     INTEGER PRIMARY KEY,      -- Asaned.ID
  sand_types      INTEGER,                  -- Asaned.SandTypes
  hadiths_count   INTEGER
);

CREATE TABLE hadith_chain (
  hadith_main_id     INTEGER NOT NULL,      -- AsanedHadiths.HadithMainID
  jk_sanad_id        INTEGER NOT NULL,      -- AsanedHadiths.SanadID
  book_id            INTEGER,               -- AsanedHadiths.BookID
  sanad_type         INTEGER,               -- AsanedHadiths.SanadType
  sanad_tahdeth_id   INTEGER                -- AsanedHadiths.SanadTahdethID
);
CREATE INDEX ix_hadith_chain_hmid  ON hadith_chain(hadith_main_id);
CREATE INDEX ix_hadith_chain_sanad ON hadith_chain(jk_sanad_id);

CREATE TABLE isnad_node (
  id           INTEGER PRIMARY KEY,         -- AsanedTree.ID
  parent_id    INTEGER,                     -- AsanedTree.ParentID
  left_val     INTEGER,
  right_val    INTEGER,
  jk_rawy_id   INTEGER,                     -- AsanedTree.RawyID
  is_leaf      INTEGER,
  is_marfoa    INTEGER,
  is_mawkof    INTEGER,
  is_maktoa    INTEGER,
  is_marfoa_hokm INTEGER
);
CREATE INDEX ix_isnad_node_parent ON isnad_node(parent_id);
CREATE INDEX ix_isnad_node_rawy   ON isnad_node(jk_rawy_id);

-- ── takhrīj + matn comparison (axes 1, 4) ───────────────────────────────────

CREATE TABLE takhrij (
  hadith_main_id    INTEGER NOT NULL,       -- HTakhreeg.HadithMainID
  group_id          INTEGER,               -- HTakhreeg.GroupID
  compound_matn_id  INTEGER,               -- HTakhreeg.CompoundMatnID
  pivot_id          INTEGER,               -- HTakhreeg.PivotID -> narrator
  matn_length       INTEGER,
  is_story          INTEGER,
  book_id           INTEGER                 -- HTakhreeg.BookID (materialised join)
);
CREATE INDEX ix_takhrij_hmid  ON takhrij(hadith_main_id);
CREATE INDEX ix_takhrij_group ON takhrij(group_id);
CREATE INDEX ix_takhrij_pivot ON takhrij(pivot_id);

CREATE TABLE matn_group_member (
  group_id        INTEGER NOT NULL,         -- HGamhAlMatn.GroupID
  hadith_main_id  INTEGER NOT NULL,         -- HGamhAlMatn.HadithMainID
  book_id         INTEGER
);
CREATE INDEX ix_mgm_group ON matn_group_member(group_id);

CREATE TABLE matn_comparison (
  master_matn_id  INTEGER NOT NULL,
  slave_matn_id   INTEGER NOT NULL,
  match_sort      INTEGER
);
CREATE INDEX ix_matn_cmp_master ON matn_comparison(master_matn_id);

-- ── imam judgments / ʿilal / gharīb (axis 5) ────────────────────────────────

CREATE TABLE judgment (
  id            INTEGER PRIMARY KEY,        -- HadithJudgmentSays.ID
  scientist_id  INTEGER,
  say           TEXT NOT NULL               -- HadithJudgmentSays.Say (plain)
);

CREATE TABLE judgment_hit (
  judgment_id     INTEGER NOT NULL,         -- HadithJudgmentHits.SayID
  hadith_main_id  INTEGER NOT NULL          -- HadithJudgmentHits.HadithMainID
);
CREATE INDEX ix_judgment_hit_hmid ON judgment_hit(hadith_main_id);

CREATE TABLE hadith_ghareeb (
  hadith_main_id  INTEGER NOT NULL          -- HadithGhareeb.HadithMainID
);
CREATE INDEX ix_hadith_ghareeb_hmid ON hadith_ghareeb(hadith_main_id);

CREATE TABLE hadith_modrag (
  hadith_main_id  INTEGER NOT NULL          -- HadithModrag.HadithMainID
);

CREATE TABLE service_state (
  hadith_main_id  INTEGER PRIMARY KEY,      -- HadithServicesState.HadithMainID
  degree          INTEGER,
  flags_json      TEXT                       -- {Takhreg:1,CompoundMatn:0,...}
);

-- ── thematic / fiqh index (axis 6) ──────────────────────────────────────────

CREATE TABLE subject (
  id         INTEGER PRIMARY KEY,           -- Subject.ID
  parent_id  INTEGER,
  left_val   INTEGER,
  right_val  INTEGER,
  is_leaf    INTEGER,
  title      TEXT                            -- Subject.SubjectTitle (plain)
);
CREATE INDEX ix_subject_parent ON subject(parent_id);

CREATE TABLE subject_hit (
  subject_id      INTEGER NOT NULL,         -- SubjectHit.SubjectID
  hadith_main_id  INTEGER NOT NULL          -- SubjectHit.ParagraphMainID
);
CREATE INDEX ix_subject_hit_subject ON subject_hit(subject_id);
CREATE INDEX ix_subject_hit_hmid    ON subject_hit(hadith_main_id);

-- ── book table of contents (chapter/section titles + printed numbers) ───────

CREATE TABLE book_toc (
  paragraph_id     INTEGER PRIMARY KEY,     -- BookTOC_Hadith.ParagraphID
  main_id          INTEGER,                 -- BookTOC_Hadith.MainID (= hadith_main_id for leaves)
  parent_id        INTEGER,
  left_val         INTEGER,
  right_val        INTEGER,
  is_leaf          INTEGER,
  is_paragraph     INTEGER,
  book_id          INTEGER,                 -- BookTOC_Hadith.MosanefID
  part_num         INTEGER,
  page_num         INTEGER,
  section_text     TEXT,                    -- plain
  tarqeem_matboa1  TEXT,
  tarqeem_matboa2  TEXT,
  tarqeem_harf     TEXT
);
CREATE INDEX ix_book_toc_book ON book_toc(book_id);
CREATE INDEX ix_book_toc_main ON book_toc(main_id);

CREATE TABLE author (
  jk_author_id  INTEGER PRIMARY KEY,        -- Authors.ID
  name          TEXT                         -- Authors.Name (plain)
);

-- ── full-text over the readable apparatus ───────────────────────────────────

CREATE VIRTUAL TABLE jkhssn_fts USING fts5(
  text,
  kind    UNINDEXED,   -- 'verdict' | 'critic_say' | 'judgment' | 'subject' | 'section'
  ref_id  UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);
