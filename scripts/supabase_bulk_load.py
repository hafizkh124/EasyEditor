"""
Supabase bulk loader for scholarly_documents. THIS IS THE CANONICAL COPY.

D:\\EEData\\scripts\\supabase_bulk_load.py is retired (see the stub left in its
place) — it had drifted from this one: it built citation_ref as a plain string
for tanzil-urdu instead of a JSON object, and it had no equivalent of the
BLOCKED registry below, both of which this file restores/keeps as the source
of truth.

POSTs batches of up to 500 rows to the ingest-batch edge function. Every row
MUST have citation_ref as a JSON **object**, not a string — the app reads it
as citation_ref->>'field' server-side (search_documents_scoped, the count
RPCs) and client-side (src/lib/editor/citationFormat.ts formatCitation()). A
string citation_ref is valid JSONB and will insert silently, but the row is
then invisible to search and renders a blank citation.

Three modes, in order of how you should actually use this:
  --dry-run     transform the first 3 rows, print them, exit. No network call.
  --check-only  stream the whole file through mode="check" (read-only RPC on
                the server — nothing is inserted) and print an overlap report
                broken down by why a row already exists.
  (neither)     the real load: mode="insert", resumable via --start.
"""
import csv
import json
import os
import sys
import time
import argparse
import urllib.request
import urllib.error
from collections import Counter

csv.field_size_limit(2147483647)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://vdfdqtzndsrrlutbprtk.supabase.co")
FUNCTION_URL = f"{SUPABASE_URL}/functions/v1/ingest-batch"

BATCH_SIZE = 100
MIN_BATCH_ON_RETRY = 10

# Surah names in Arabic, indexed by surah number 1..114 (Tanzil canonical).
_SURAH_NAMES_AR = [
    "", "الفاتحة", "البقرة", "آل عمران", "النساء", "المائدة", "الأنعام", "الأعراف", "الأنفال",
    "التوبة", "يونس", "هود", "يوسف", "الرعد", "إبراهيم", "الحجر", "النحل", "الإسراء", "الكهف",
    "مريم", "طه", "الأنبياء", "الحج", "المؤمنون", "النور", "الفرقان", "الشعراء", "النمل",
    "القصص", "العنكبوت", "الروم", "لقمان", "السجدة", "الأحزاب", "سبأ", "فاطر", "يس",
    "الصافات", "ص", "الزمر", "غافر", "فصلت", "الشورى", "الزخرف", "الدخان", "الجاثية",
    "الأحقاف", "محمد", "الفتح", "الحجرات", "ق", "الذاريات", "الطور", "النجم", "القمر",
    "الرحمن", "الواقعة", "الحديد", "المجادلة", "الحشر", "الممتحنة", "الصف", "الجمعة",
    "المنافقون", "التغابن", "الطلاق", "التحريم", "الملك", "القلم", "الحاقة", "المعارج",
    "نوح", "الجن", "المزمل", "المدثر", "القيامة", "الإنسان", "المرسلات", "النبأ", "النازعات",
    "عبس", "التكوير", "الانفطار", "المطففين", "الانشقاق", "البروج", "الطارق", "الأعلى",
    "الغاشية", "الفجر", "البلد", "الشمس", "الليل", "الضحى", "الشرح", "التين", "العلق",
    "القدر", "البينة", "الزلزلة", "العاديات", "القارعة", "التكاثر", "العصر", "الهمزة",
    "الفيل", "قريش", "الماعون", "الكوثر", "الكافرون", "النصر", "المسد", "الإخلاص", "الفلق", "الناس",
]

# ─── Loadable datasets (already in target schema or a known transform exists) ─
# kind: "passthrough" | "hadith-legacy" | "urdu-junagarhi"
DATASETS = {
    "tanzil":          {"path": r"D:\EEData\tanzil\tanzil_processed.csv",                 "kind": "passthrough"},
    "hadith-scholarly":{"path": r"D:\EEData\hadith\hadith_scholarly.csv",                 "kind": "passthrough"},
    "openiti":         {"path": r"D:\EEData\openiti\openiti_processed.csv",               "kind": "passthrough"},
    "tanzil-urdu":     {"path": r"D:\EEData\Urdu\tanzil-urdu-junagarhi\ur.junagarhi.txt", "kind": "urdu-junagarhi"},
    "hadeed-urdu":     {"path": r"D:\EEData\hadith\hadeed_urdu_excel.csv",                "kind": "passthrough"},
    # Legacy raw form kept for resume-from-old-runs; prefer hadith-scholarly above.
    "hadith":          {"path": r"D:\EEData\hadith\hadith_processed.csv",                 "kind": "hadith-legacy"},
}

# ─── NOT loadable — needs upstream fix before it can be added to DATASETS ────
BLOCKED = {
    "jkhssn-clean": {
        "path": r"D:\EEData\hadith\jkhssn_processed_clean.csv",
        "reason": "Source extraction is broken, not just mis-encoded. D:\\JKHSSN\\Data\\HadithDB is a "
                  "proprietary column-store export (Catalog.xml: Name=\"HadithDBCD\", "
                  "Provider=SQLNCLI ... Database=HadithDB), not loose text files. The matn field "
                  "(HCompoundMatn/Matn/records.bin, declared Type=\"203\"/adLongVarWChar) decodes to "
                  "noise under cp1256, utf-16-le AND utf-8 -- it is compressed/encoded, not plain text "
                  "under any codec. The current CSV has only 48 rows (not 10,765), 'content' is empty "
                  "in 100% of them, and 'content_ar' has had its spaces stripped (21 spaces across "
                  "653,296 chars; blobs up to 170,759 chars). Re-running the extractor with a different "
                  "codec cannot fix this -- it needs a real extractor: the Jawami' al-Kalim desktop "
                  "app's own export feature, a community-decoded dump (verify licensing), or "
                  "reverse-engineering the records.bin framing.",
    },
    "shamela-local": {
        "path": r"D:\EEData\shamela\local_shamela_processed.csv",
        "reason": "content column is raw Lucene index binary (FDT segments interpreted as text). "
                  "Use the HF page-level parquet dump instead (shamela_parquet_load.py) -- and note "
                  "that lane is deferred by decision for this wave regardless (7.5M rows, ~23GB of "
                  "embeddings alone).",
    },
}


def log(msg):
    print(msg, flush=True)


def _post_once(rows, secret, mode):
    payload = json.dumps({"rows": rows, "mode": mode}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        FUNCTION_URL,
        data=payload,
        method="POST",
        headers={"x-ingest-secret": secret, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data, ""
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:300]
        return {}, f"HTTP {e.code}: {body}"
    except Exception as ex:
        return {}, str(ex)


def _is_timeout(err):
    return "statement timeout" in err or "canceling statement" in err


def insert_batch(rows, secret):
    data, err = _post_once(rows, secret, "insert")
    ok, dupes = data.get("ok", 0), data.get("duplicates", 0)
    if not err:
        return ok, dupes, ""
    if not _is_timeout(err) or len(rows) <= MIN_BATCH_ON_RETRY:
        return ok, dupes, err
    mid = len(rows) // 2
    log(f"  timeout on batch of {len(rows)} -> retrying as {mid} + {len(rows) - mid}")
    ok1, d1, e1 = insert_batch(rows[:mid], secret)
    ok2, d2, e2 = insert_batch(rows[mid:], secret)
    combined_err = "; ".join(x for x in [e1, e2] if x)
    return ok1 + ok2, d1 + d2, combined_err


def check_batch(rows, secret):
    """mode=check: ask the server (scholarly_documents_check_batch RPC) whether
    each row already exists, and why. Nothing is inserted. Returns
    (list of {"exists":bool,"reason":str|None,"match_domain":str|None}, err)."""
    data, err = _post_once(rows, secret, "check")
    if err:
        return [], err
    return data.get("results", []), ""


# ── row validation ────────────────────────────────────────────────────────────
# Catches the two failure modes this plan found in the wild: a string
# citation_ref (invisible to search, blank citation) and empty content
# (ingest-batch/index.ts rejects it with a 400 for every row in the batch).
def _validate_row(row, idx, source_label):
    if not isinstance(row.get("citation_ref"), dict):
        raise ValueError(
            f"{source_label} row {idx}: citation_ref must be a dict, got "
            f"{type(row.get('citation_ref')).__name__}: {row.get('citation_ref')!r}"
        )
    if not (row.get("content") or "").strip():
        raise ValueError(f"{source_label} row {idx}: content is empty -- ingest-batch rejects this (400)")
    if not row.get("domain") or not row.get("source_type"):
        raise ValueError(f"{source_label} row {idx}: missing domain/source_type")


# ── row transformers ────────────────────────────────────────────────────────

def _passthrough_row(row):
    """CSV already has target schema. Parse citation_ref JSON; trim content."""
    cit_raw = row.get("citation_ref") or "{}"
    try:
        cit = json.loads(cit_raw)
        if not isinstance(cit, dict):
            cit = {"raw": cit_raw}
    except Exception:
        cit = {"raw": cit_raw}
    content = (row.get("content") or "")[:8000]
    if not content:
        return None
    return {
        "domain":       row.get("domain") or "",
        "source_type":  row.get("source_type") or "",
        "content":      content,
        "content_ar":   (row.get("content_ar") or "")[:8000],
        "citation_ref": cit,
        "language":     row.get("language") or "ar",
    }


def _hadith_legacy_row(row):
    """Transform raw hadith-json CSV into target schema."""
    citation = {
        "book":          row.get("collection_slug", ""),
        "hadith_number": row.get("hadith_id_in_book", ""),
        "collection":    row.get("collection_title_en", ""),
        "author":        row.get("author_en", ""),
        "chapter":       row.get("chapter_title_en", ""),
    }
    narrator = row.get("hadith_narrator_en") or ""
    text_en = row.get("hadith_text_en") or ""
    content = text_en
    if narrator and not text_en.startswith(narrator[:10]):
        content = f"{narrator}\n\n{text_en}"
    if not content:
        return None
    return {
        "domain":       "hadith-json",
        "source_type":  "hadith",
        "content":      content[:8000],
        "content_ar":   (row.get("hadith_text_ar") or "")[:8000],
        "citation_ref": citation,
        "language":     "ar",
    }


def _urdu_junagarhi_line(line):
    """Parse one line of `surah|verse|translation` from Tanzil Urdu Junagarhi."""
    parts = line.rstrip("\n").split("|", 2)
    if len(parts) != 3:
        return None
    try:
        surah = int(parts[0])
        verse = int(parts[1])
    except ValueError:
        return None
    translation = parts[2].strip()
    if not translation:
        return None
    surah_ar = _SURAH_NAMES_AR[surah] if 0 < surah < len(_SURAH_NAMES_AR) else ""
    return {
        "domain":       "tanzil-urdu",
        "source_type":  "quran",
        "content":      translation[:8000],   # Urdu translation
        "content_ar":   "",                   # canonical Arabic lives in the 'tanzil' domain
        "citation_ref": {
            "translation":  "junagarhi",
            "surah_number": surah,
            "surah_name":   surah_ar,
            "verse":        verse,
        },
        "language":     "ur",
    }


_TRANSFORMERS = {
    "passthrough":    _passthrough_row,
    "hadith-legacy":  _hadith_legacy_row,
}


# ── dry run ────────────────────────────────────────────────────────────────

def dry_run(name, cfg):
    path, kind = cfg["path"], cfg["kind"]
    if not os.path.exists(path):
        log(f"SKIP {name}: file not found at {path}")
        return
    log(f"DRY RUN: {name} ({kind}) -- first 3 transformed rows, no network call\n")
    shown = 0
    if kind == "urdu-junagarhi":
        with open(path, "r", encoding="utf-8") as f:
            for i, line in enumerate(f):
                rec = _urdu_junagarhi_line(line)
                if rec is None:
                    continue
                _validate_row(rec, i, name)
                log(json.dumps(rec, ensure_ascii=False, indent=2))
                shown += 1
                if shown >= 3:
                    break
    else:
        transformer = _TRANSFORMERS[kind]
        with open(path, "r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            for i, row in enumerate(reader):
                rec = transformer(row)
                if rec is None:
                    continue
                _validate_row(rec, i, name)
                log(json.dumps(rec, ensure_ascii=False, indent=2))
                shown += 1
                if shown >= 3:
                    break
    if shown == 0:
        log("  (no non-empty rows found in the first pass -- check the source file)")


# ── streaming loaders (insert or check) ──────────────────────────────────────

def _flush(batch, secret, total_rows, acc, mode, reason_counts):
    """acc = (done_acc, dupes_acc, errors_acc). Mutates reason_counts in check mode."""
    done_acc, dupes_acc, errors_acc = acc
    if mode == "check":
        results, err = check_batch(batch, secret)
        if err:
            log(f"  CHECK ERROR at row ~{total_rows}: {err}")
            return done_acc, dupes_acc, errors_acc + 1
        for r in results:
            if r.get("exists"):
                dupes_acc += 1
                reason_counts[r.get("reason") or "unknown"] += 1
            else:
                done_acc += 1
        return done_acc, dupes_acc, errors_acc
    ok, d, err = insert_batch(batch, secret)
    if err:
        log(f"  ERROR at row ~{total_rows}: {err}")
        return done_acc, dupes_acc, errors_acc + 1
    return done_acc + ok, dupes_acc + d, errors_acc


def _stream_csv(path, transformer, source_label, secret, start_row, mode, reason_counts):
    total = 0
    acc = (0, 0, 0)
    batch = []
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            if i < start_row:
                total += 1
                continue
            rec = transformer(row)
            if rec is None:
                continue
            _validate_row(rec, i, source_label)
            batch.append(rec)
            total += 1
            if len(batch) >= BATCH_SIZE:
                acc = _flush(batch, secret, total, acc, mode, reason_counts)
                batch = []
                if acc[2] >= 10:
                    log("  Too many errors, aborting.")
                    break
                if total % 5_000 == 0:
                    verb = "existing" if mode == "check" else "inserted"
                    log(f"  Progress: {total:,} processed, {acc[0]:,} new, {acc[1]:,} {verb}")
        if batch and acc[2] < 10:
            acc = _flush(batch, secret, total, acc, mode, reason_counts)
    return (total,) + acc


def _stream_urdu(path, source_label, secret, start_row, mode, reason_counts):
    total = 0
    acc = (0, 0, 0)
    batch = []
    with open(path, "r", encoding="utf-8") as f:
        for i, line in enumerate(f):
            if i < start_row:
                total += 1
                continue
            rec = _urdu_junagarhi_line(line)
            if rec is None:
                continue
            _validate_row(rec, i, source_label)
            batch.append(rec)
            total += 1
            if len(batch) >= BATCH_SIZE:
                acc = _flush(batch, secret, total, acc, mode, reason_counts)
                batch = []
                if acc[2] >= 10:
                    log("  Too many errors, aborting.")
                    break
        if batch and acc[2] < 10:
            acc = _flush(batch, secret, total, acc, mode, reason_counts)
    return (total,) + acc


def load_dataset(name, secret, start_row=0, mode="insert"):
    cfg = DATASETS.get(name)
    if not cfg:
        log(f"SKIP {name}: not in DATASETS (check --list-blocked)")
        return 0
    path = cfg["path"]
    kind = cfg["kind"]
    if not os.path.exists(path):
        log(f"SKIP {name}: file not found at {path}")
        return 0

    size_mb = os.path.getsize(path) / 1024 / 1024
    log(f"\n{'='*60}")
    verb = "Checking" if mode == "check" else "Loading"
    log(f"{verb}: {name}  ({kind}, {size_mb:.1f} MB)")
    log(f"  File : {path}")

    reason_counts = Counter()
    if kind == "urdu-junagarhi":
        total, new, dupes, errors = _stream_urdu(path, name, secret, start_row, mode, reason_counts)
    elif kind in _TRANSFORMERS:
        total, new, dupes, errors = _stream_csv(path, _TRANSFORMERS[kind], name, secret, start_row, mode, reason_counts)
    else:
        log(f"  Unknown kind '{kind}', skipping")
        return 0

    if mode == "check":
        log(f"  Done: {total:,} rows processed, {new:,} new, {dupes:,} already exist, {errors} batch errors.")
        if reason_counts:
            for reason, n in reason_counts.most_common():
                log(f"    - {n:,} matched by {reason}")
        return 0

    log(f"  Done: {total:,} processed, {new:,} inserted, {dupes:,} duplicates, {errors} batch errors.")
    return new


# ── CLI ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Supabase bulk loader for scholarly_documents")
    parser.add_argument("--secret", help="INGEST_SHARED_SECRET value (or set INGEST_SHARED_SECRET env var)")
    parser.add_argument("--dataset", default="all",
                         choices=["all"] + sorted(DATASETS.keys()),
                         help="Which dataset to load (default: all)")
    parser.add_argument("--start", type=int, default=0,
                         help="Row index to resume from within the chosen dataset")
    parser.add_argument("--dry-run", action="store_true",
                         help="Transform the first 3 rows and print them. No network call, no --secret needed.")
    parser.add_argument("--check-only", action="store_true",
                         help="Stream the whole file through mode=check (read-only). Nothing is inserted.")
    parser.add_argument("--list-blocked", action="store_true",
                         help="Print datasets that exist on disk but cannot be loaded yet")
    args = parser.parse_args()

    if args.list_blocked:
        log("Datasets present on disk but BLOCKED from this loader:")
        for k, v in BLOCKED.items():
            log(f"  - {k}: {v['path']}")
            log(f"    reason: {v['reason']}")
        return

    to_load = list(DATASETS.keys()) if args.dataset == "all" else [args.dataset]

    if args.dry_run:
        for name in to_load:
            dry_run(name, DATASETS[name])
        return

    secret = args.secret or os.environ.get("INGEST_SHARED_SECRET")
    if not secret:
        parser.error("--secret is required (or set the INGEST_SHARED_SECRET env var) for --check-only and real loads")

    mode = "check" if args.check_only else "insert"
    t0 = time.time()
    grand_total = 0
    for name in to_load:
        n = load_dataset(name, secret, args.start if args.dataset == name else 0, mode)
        if n:
            grand_total += n

    if mode == "check":
        log(f"\nCHECK COMPLETE in {time.time() - t0:.1f}s")
    else:
        log(f"\nCOMPLETE: {grand_total:,} new rows inserted in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
