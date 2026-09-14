/**
 * The 6 axes as SQL over `jkhssn.sqlite`. Pure query layer — no Supabase, no
 * IPC. Each payload carries جوامع الكلم ids + the readable plain-text apparatus;
 * narrator display names and verbatim matn are resolved from Supabase by the
 * caller (renderer `resolveNames.ts` / agent `jkhssnQuery.ts`), per ADR-0045.
 */
import type { SqliteDatabase } from './indexDb.js';
import { getJkhssnDb } from './indexDb.js';
import type {
  JkhssnBookHit,
  JudgmentsPayload,
  MatnComparePayload,
  NarratorCardPayload,
  SanadTreeNode,
  SanadTreePayload,
  TakhrijPayload,
  ThematicPayload,
} from '../../shared/jkhssn/types.js';

/** Hard cap on nodes returned for one sanad-tree payload. */
const SANAD_NODE_CAP = 400;
const SERVICE_FLAG_ORDER = [
  'Takhreg', 'CompoundMatn', 'Rwah', 'Asnad', 'Shawahed', 'Ghareeb', 'Sharh', 'Subjects',
  'Tafsser', 'Biography', 'Medicine', 'Feqh', 'Asbab', 'Mokhtalaf', 'Amthal', 'Kerat',
  'ProperName', 'Countries', 'MatnComparison', 'Modrag', 'Motawater',
];

function db(): SqliteDatabase {
  return getJkhssnDb();
}

// ── axis 2: sanad tree ───────────────────────────────────────────────────────

interface NodeRow {
  id: number;
  parent_id: number | null;
  jk_rawy_id: number | null;
  left_val: number | null;
  right_val: number | null;
  is_leaf: number;
  is_marfoa: number;
  is_mawkof: number;
  is_maktoa: number;
}

function toNode(r: NodeRow): SanadTreeNode {
  return {
    id: r.id,
    parentId: r.parent_id ?? null,
    jkRawyId: r.jk_rawy_id ?? null,
    isLeaf: !!r.is_leaf,
    isMarfoa: !!r.is_marfoa,
    isMawkof: !!r.is_mawkof,
    isMaktoa: !!r.is_maktoa,
  };
}

/**
 * The isnād tree for one hadith. `hadith_chain.jk_sanad_id` points at a node in
 * جوامع الكلم's big forest; the isnād is that node's ancestor path (root → node)
 * plus the node's own subtree (variant continuations), all merged and capped.
 */
export function axisSanadTree(q: { hadithMainId?: number; chainNodeId?: number }): SanadTreePayload {
  const conn = db();
  const seeds: Array<{ node: number; bookId: number | null; sanadType: number | null }> = [];
  if (q.chainNodeId != null) {
    seeds.push({ node: q.chainNodeId, bookId: null, sanadType: null });
  } else if (q.hadithMainId != null) {
    const rows = conn
      .prepare('SELECT jk_sanad_id, book_id, sanad_type FROM hadith_chain WHERE hadith_main_id = ?')
      .all(q.hadithMainId) as Array<{ jk_sanad_id: number; book_id: number | null; sanad_type: number | null }>;
    for (const r of rows) seeds.push({ node: r.jk_sanad_id, bookId: r.book_id, sanadType: r.sanad_type });
  }

  const nodeById = new Map<number, SanadTreeNode>();
  const chains: SanadTreePayload['chains'] = [];
  const getRow = conn.prepare(
    'SELECT id, parent_id, jk_rawy_id, left_val, right_val, is_leaf, is_marfoa, is_mawkof, is_maktoa FROM isnad_node WHERE id = ?',
  );
  const ancestors = conn.prepare(
    'SELECT id, parent_id, jk_rawy_id, left_val, right_val, is_leaf, is_marfoa, is_mawkof, is_maktoa FROM isnad_node WHERE left_val < ? AND right_val > ? ORDER BY left_val',
  );
  const descendants = conn.prepare(
    'SELECT id, parent_id, jk_rawy_id, left_val, right_val, is_leaf, is_marfoa, is_mawkof, is_maktoa FROM isnad_node WHERE left_val > ? AND right_val <= ? ORDER BY left_val LIMIT ?',
  );

  for (const seed of seeds) {
    if (nodeById.size >= SANAD_NODE_CAP) break;
    const self = getRow.get(seed.node) as NodeRow | undefined;
    if (!self || self.left_val == null || self.right_val == null) continue;
    const rows: NodeRow[] = [
      ...(ancestors.all(self.left_val, self.right_val) as NodeRow[]),
      self,
      ...(descendants.all(self.left_val, self.right_val, SANAD_NODE_CAP - nodeById.size) as NodeRow[]),
    ];
    const chainNodes: SanadTreeNode[] = [];
    const seenInChain = new Set<number>();
    for (const r of rows) {
      if (seenInChain.has(r.id)) continue;
      seenInChain.add(r.id);
      const n = toNode(r);
      if (!nodeById.has(n.id)) nodeById.set(n.id, n);
      chainNodes.push(n);
    }
    chains.push({ chainId: seed.node, bookId: seed.bookId, sanadType: seed.sanadType, nodes: chainNodes });
  }

  const rawyIds = [...new Set([...nodeById.values()].map((n) => n.jkRawyId).filter((x): x is number => x != null && x > 0))];
  return { chains, rawyIds };
}

// ── axis 3: narrator ─────────────────────────────────────────────────────────

export function axisNarrator(q: { rawyId?: number; nameQuery?: string }): NarratorCardPayload | null {
  const conn = db();
  let rawyId = q.rawyId ?? null;
  if (rawyId == null && q.nameQuery) {
    const hit = conn
      .prepare('SELECT jk_rawy_id FROM narrator_form WHERE name_shape LIKE ? ORDER BY frequency DESC LIMIT 1')
      .get(`%${q.nameQuery.trim()}%`) as { jk_rawy_id: number } | undefined;
    rawyId = hit?.jk_rawy_id ?? null;
  }
  if (rawyId == null) return null;

  const n = conn
    .prepare(
      `SELECT jk_rawy_id, death_year_num, tabaqa_num, hadiths_count, tabaqa, birth_year, death_year,
              martaba_ibn_hajar, martaba_zahabi, birth_city, death_city, living_city, mazhab
       FROM narrator WHERE jk_rawy_id = ?`,
    )
    .get(rawyId) as Record<string, unknown> | undefined;

  const nameShapes = (
    conn.prepare('SELECT name_shape FROM narrator_form WHERE jk_rawy_id = ? ORDER BY frequency DESC LIMIT 6').all(rawyId) as Array<{ name_shape: string }>
  ).map((r) => r.name_shape);

  const jarh = (
    conn
      .prepare(
        `SELECT v.text AS verdict, c.say AS critic_say, nj.critic_say_id AS critic_id
         FROM narrator_jarh nj
         JOIN jarh_verdict v ON v.id = nj.verdict_id
         LEFT JOIN critic_say c ON c.id = nj.critic_say_id AND c.jk_rawy_id = nj.jk_rawy_id
         WHERE nj.jk_rawy_id = ? LIMIT 60`,
      )
      .all(rawyId) as Array<{ verdict: string; critic_say: string | null; critic_id: number | null }>
  ).map((r) => ({ verdict: r.verdict, criticSay: r.critic_say ?? null, criticId: r.critic_id ?? null }));

  const teachers = conn
    .prepare('SELECT teacher_id AS id, hadiths_count FROM teacher_student WHERE student_id = ? ORDER BY hadiths_count DESC LIMIT 60')
    .all(rawyId) as Array<{ id: number; hadiths_count: number | null }>;
  const students = conn
    .prepare('SELECT student_id AS id, hadiths_count FROM teacher_student WHERE teacher_id = ? ORDER BY hadiths_count DESC LIMIT 60')
    .all(rawyId) as Array<{ id: number; hadiths_count: number | null }>;

  const s = (k: string): string | null => (n && n[k] != null && String(n[k]).trim() ? String(n[k]) : null);
  const num = (k: string): number | null => (n && typeof n[k] === 'number' ? (n[k] as number) : null);

  return {
    jkRawyId: rawyId,
    nameShapes,
    deathYearNum: num('death_year_num'),
    tabaqaNum: num('tabaqa_num'),
    hadithsCount: num('hadiths_count'),
    tabaqa: s('tabaqa'),
    birthYear: s('birth_year'),
    deathYear: s('death_year'),
    martabaIbnHajar: s('martaba_ibn_hajar'),
    martabaZahabi: s('martaba_zahabi'),
    birthCity: s('birth_city'),
    deathCity: s('death_city'),
    livingCity: s('living_city'),
    mazhab: s('mazhab'),
    jarh,
    teachers: teachers.map((t) => ({ id: t.id, hadithsCount: t.hadiths_count ?? null })),
    students: students.map((t) => ({ id: t.id, hadithsCount: t.hadiths_count ?? null })),
    needsNames: [...new Set([rawyId, ...teachers.map((t) => t.id), ...students.map((t) => t.id)])],
  };
}

// ── axis 1: takhrīj ──────────────────────────────────────────────────────────

export function axisTakhrij(hadithMainId: number): TakhrijPayload {
  const conn = db();
  const rows = conn
    .prepare('SELECT hadith_main_id, group_id, compound_matn_id, pivot_id, matn_length, is_story, book_id FROM takhrij WHERE hadith_main_id = ?')
    .all(hadithMainId) as Array<{
    hadith_main_id: number; group_id: number | null; compound_matn_id: number | null;
    pivot_id: number | null; matn_length: number | null; is_story: number | null; book_id: number | null;
  }>;

  // Everything sharing this hadith's matn group(s) — the actual takhrīj set.
  const groupIds = [...new Set(rows.map((r) => r.group_id).filter((x): x is number => x != null && x !== 0))];
  const siblings = groupIds.length
    ? (conn
        .prepare(
          `SELECT hadith_main_id, group_id, book_id FROM matn_group_member WHERE group_id IN (${groupIds.map(() => '?').join(',')}) LIMIT 500`,
        )
        .all(...groupIds) as Array<{ hadith_main_id: number; group_id: number; book_id: number | null }>)
    : [];

  const entries: TakhrijPayload['entries'] = [
    ...rows.map((r) => ({
      hadithMainId: r.hadith_main_id,
      groupId: r.group_id ?? null,
      compoundMatnId: r.compound_matn_id ?? null,
      pivotId: r.pivot_id && r.pivot_id > 0 ? r.pivot_id : null,
      matnLength: r.matn_length ?? null,
      isStory: !!r.is_story,
      bookId: r.book_id ?? null,
    })),
    ...siblings
      .filter((s) => s.hadith_main_id !== hadithMainId)
      .map((s) => ({
        hadithMainId: s.hadith_main_id,
        groupId: s.group_id,
        compoundMatnId: null,
        pivotId: null,
        matnLength: null,
        isStory: false,
        bookId: s.book_id ?? null,
      })),
  ];

  const st = conn.prepare('SELECT degree, flags_bits FROM service_state WHERE hadith_main_id = ?').get(hadithMainId) as
    | { degree: number | null; flags_bits: number }
    | undefined;

  return {
    entries,
    pivotIds: [...new Set(entries.map((e) => e.pivotId).filter((x): x is number => x != null))],
    bookIds: [...new Set(entries.map((e) => e.bookId).filter((x): x is number => x != null && x > 0))],
    serviceState: st
      ? { degree: st.degree ?? null, flags: decodeFlags(st.flags_bits) }
      : null,
  };
}

function decodeFlags(bits: number): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  SERVICE_FLAG_ORDER.forEach((name, i) => { out[name] = !!(bits & (1 << i)); });
  return out;
}

// ── axis 4: matn comparison ──────────────────────────────────────────────────

export function axisMatnCompare(groupId: number): MatnComparePayload {
  const conn = db();
  const members = (
    conn.prepare('SELECT DISTINCT hadith_main_id FROM matn_group_member WHERE group_id = ? LIMIT 500').all(groupId) as Array<{ hadith_main_id: number }>
  ).map((r) => r.hadith_main_id);
  // matn_comparison is opt-in at build time; empty is normal (ADR-0045).
  const pairs = (
    conn
      .prepare('SELECT master_matn_id AS master, slave_matn_id AS slave, match_sort FROM matn_comparison WHERE master_matn_id IN (SELECT compound_matn_id FROM takhrij WHERE group_id = ?) LIMIT 500')
      .all(groupId) as Array<{ master: number; slave: number; match_sort: number | null }>
  ).map((r) => ({ master: r.master, slave: r.slave, matchSort: r.match_sort ?? null }));
  return { groupId, members, pairs };
}

// ── axis 5: imam judgments / ʿilal ───────────────────────────────────────────

export function axisJudgments(hadithMainId: number): JudgmentsPayload {
  const conn = db();
  const judgments = (
    conn
      .prepare(
        `SELECT j.id, j.scientist_id, j.say
         FROM judgment_hit h JOIN judgment j ON j.id = h.judgment_id
         WHERE h.hadith_main_id = ? LIMIT 40`,
      )
      .all(hadithMainId) as Array<{ id: number; scientist_id: number | null; say: string }>
  ).map((r) => ({ id: r.id, scientistId: r.scientist_id ?? null, say: r.say }));
  const st = conn.prepare('SELECT degree FROM service_state WHERE hadith_main_id = ?').get(hadithMainId) as { degree: number | null } | undefined;
  return {
    hadithMainId,
    judgments,
    degree: st?.degree ?? null,
    scientistIds: [...new Set(judgments.map((j) => j.scientistId).filter((x): x is number => x != null))],
  };
}

// ── axis 6: thematic / fiqh ──────────────────────────────────────────────────

export function axisThematic(q: { subjectId?: number; query?: string }): ThematicPayload {
  const conn = db();
  if (q.subjectId != null) {
    // `subject.title` is selected here for forward-compatibility, but it is
    // currently always NULL: buildIndex.ts's loadOneTable() deliberately
    // skips CustomType=1 (compressed) columns, and SubjectTitle is marked
    // CustomType=1 in Catalog.xml (ADR-0045). So browsed nodes come back with
    // an empty title today — only their numeric id and hit count are
    // reliable. Callers needing real labels should use the free-text-search
    // fallback below, which reads book_toc.section_text via a different
    // (heuristic-based) decode path that isn't subject to this gate.
    const children = conn
      .prepare(
        `SELECT s.id, s.parent_id, s.is_leaf, s.title,
                (SELECT COUNT(*) FROM subject_hit h WHERE h.subject_id = s.id) AS hits
         FROM subject s WHERE s.parent_id = ? ORDER BY s.left_val LIMIT 200`,
      )
      .all(q.subjectId) as Array<{ id: number; parent_id: number | null; is_leaf: number; title: string | null; hits: number }>;
    const self = conn.prepare('SELECT id, parent_id, is_leaf FROM subject WHERE id = ?').get(q.subjectId) as
      | { id: number; parent_id: number | null; is_leaf: number }
      | undefined;
    const hadithIds = self?.is_leaf
      ? (conn.prepare('SELECT hadith_main_id FROM subject_hit WHERE subject_id = ? LIMIT 500').all(q.subjectId) as Array<{ hadith_main_id: number }>).map((r) => r.hadith_main_id)
      : undefined;
    return {
      matches: children.map((c) => ({ id: c.id, parentId: c.parent_id ?? null, title: c.title ?? '', isLeaf: !!c.is_leaf, hitCount: c.hits })),
      hadithIds,
    };
  }
  // Free-text: subject titles are compressed at source (ADR-0045), so fall back
  // to matching جوامع الكلم's own book-section headings (FTS kind='section').
  const q2 = (q.query ?? '').trim();
  if (!q2) return { matches: [] };
  const hits = jkhssnFts(q2, ['section'], 40);
  const paraIds = hits.map((h) => h.refId);
  if (!paraIds.length) return { matches: [] };
  const rows = conn
    .prepare(`SELECT paragraph_id AS id, parent_id, is_leaf, section_text FROM book_toc WHERE paragraph_id IN (${paraIds.map(() => '?').join(',')})`)
    .all(...paraIds) as Array<{ id: number; parent_id: number | null; is_leaf: number; section_text: string | null }>;
  return {
    matches: rows.map((r) => ({ id: r.id, parentId: r.parent_id ?? null, title: r.section_text ?? '', isLeaf: !!r.is_leaf, hitCount: null })),
  };
}

// ── helpers: FTS + book search ───────────────────────────────────────────────

export function jkhssnFts(query: string, kinds: string[], limit = 30): Array<{ kind: string; refId: number; text: string | null }> {
  const conn = db();
  const cleaned = query.trim().replace(/["']/g, ' ');
  if (!cleaned) return [];
  const rows = conn
    .prepare(
      `SELECT m.kind, m.ref_id AS refId
       FROM jkhssn_fts f JOIN fts_map m ON m.fts_rowid = f.rowid
       WHERE f.text MATCH ? ${kinds.length ? `AND m.kind IN (${kinds.map(() => '?').join(',')})` : ''}
       LIMIT ?`,
    )
    .all(cleaned, ...kinds, limit) as Array<{ kind: string; refId: number }>;

  const textFor = (kind: string, id: number): string | null => {
    const tbl = kind === 'verdict' ? 'jarh_verdict' : kind === 'critic_say' ? 'critic_say' : kind === 'judgment' ? 'judgment' : kind === 'section' ? 'book_toc' : null;
    if (!tbl) return null;
    const col = kind === 'verdict' ? 'text' : kind === 'section' ? 'section_text' : 'say';
    const idCol = kind === 'section' ? 'paragraph_id' : 'id';
    const r = conn.prepare(`SELECT ${col} AS t FROM ${tbl} WHERE ${idCol} = ? LIMIT 1`).get(id) as { t: string | null } | undefined;
    return r?.t ?? null;
  };
  return rows.map((r) => ({ kind: r.kind, refId: r.refId, text: textFor(r.kind, r.refId) }));
}

/** جوامع الكلم has no book-title table — this searches its 163 مصنِّفين. */
export function jkhssnSearchBooks(query: string, limit = 6): JkhssnBookHit[] {
  const conn = db();
  const q = `%${query.trim()}%`;
  return (conn.prepare('SELECT jk_author_id AS id, name FROM author WHERE name LIKE ? LIMIT ?').all(q, limit) as Array<{ id: number; name: string }>).map(
    (r) => ({ id: r.id, title: r.name, kind: 'author' as const }),
  );
}
