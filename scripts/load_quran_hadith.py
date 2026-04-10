#!/usr/bin/env python3
"""
load_quran_hadith.py — MVP Loader: Tanzil Quran + Hadith-JSON → Supabase scholarly_documents

Usage:
  python scripts/load_quran_hadith.py --key SERVICE_ROLE_KEY --source all
  python scripts/load_quran_hadith.py --key SERVICE_ROLE_KEY --source quran --dry-run
  python scripts/load_quran_hadith.py --key SERVICE_ROLE_KEY --source hadith --resume

Expects to be run from D:\EEData (or parent of Quran/ and Hadith/ dirs).

Source-of-Truth:
  Quran:  Tanzil (D:\EEData\Quran\tanzil-dataset)      — canonical
  Hadith: hadith-json (D:\EEData\Hadith\hadith-json-dataset) — canonical
  Urdu:   Tanzil Urdu Junagarhi (D:\EEData\Urdu\tanzil-urdu-junagarhi) — enrichment
"""
import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

try:
    import requests
except ImportError:
    print("ERROR: 'requests' package required.  pip install requests")
    sys.exit(1)

# ── Config ────────────────────────────────────────────────────────────────────
SUPABASE_URL = "https://vdfdqtzndsrrlutbprtk.supabase.co"
TABLE_ENDPOINT = f"{SUPABASE_URL}/rest/v1/scholarly_documents"
BATCH_SIZE = 500
MAX_RETRIES = 5

# ── Surah name maps (copied from tanzil_to_csv.py) ───────────────────────────
SURAH_NAMES_AR = {
    1:"الفاتحة",2:"البقرة",3:"آل عمران",4:"النساء",5:"المائدة",6:"الأنعام",
    7:"الأعراف",8:"الأنفال",9:"التوبة",10:"يونس",11:"هود",12:"يوسف",
    13:"الرعد",14:"إبراهيم",15:"الحجر",16:"النحل",17:"الإسراء",18:"الكهف",
    19:"مريم",20:"طه",21:"الأنبياء",22:"الحج",23:"المؤمنون",24:"النور",
    25:"الفرقان",26:"الشعراء",27:"النمل",28:"القصص",29:"العنكبوت",30:"الروم",
    31:"لقمان",32:"السجدة",33:"الأحزاب",34:"سبإ",35:"فاطر",36:"يس",
    37:"الصافات",38:"ص",39:"الزمر",40:"غافر",41:"فصلت",42:"الشورى",
    43:"الزخرف",44:"الدخان",45:"الجاثية",46:"الأحقاف",47:"محمد",48:"الفتح",
    49:"الحجرات",50:"ق",51:"الذاريات",52:"الطور",53:"النجم",54:"القمر",
    55:"الرحمن",56:"الواقعة",57:"الحديد",58:"المجادلة",59:"الحشر",60:"الممتحنة",
    61:"الصف",62:"الجمعة",63:"المنافقون",64:"التغابن",65:"الطلاق",66:"التحريم",
    67:"الملك",68:"القلم",69:"الحاقة",70:"المعارج",71:"نوح",72:"الجن",
    73:"المزمل",74:"المدثر",75:"القيامة",76:"الإنسان",77:"المرسلات",78:"النبإ",
    79:"النازعات",80:"عبس",81:"التكوير",82:"الانفطار",83:"المطففين",84:"الانشقاق",
    85:"البروج",86:"الطارق",87:"الأعلى",88:"الغاشية",89:"الفجر",90:"البلد",
    91:"الشمس",92:"الليل",93:"الضحى",94:"الشرح",95:"التين",96:"العلق",
    97:"القدر",98:"البينة",99:"الزلزلة",100:"العاديات",101:"القارعة",102:"التكاثر",
    103:"العصر",104:"الهمزة",105:"الفيل",106:"قريش",107:"الماعون",108:"الكوثر",
    109:"الكافرون",110:"النصر",111:"المسد",112:"الإخلاص",113:"الفلق",114:"الناس",
}
SURAH_NAMES_EN = {
    1:"Al-Fatihah",2:"Al-Baqarah",3:"Ali 'Imran",4:"An-Nisa",5:"Al-Ma'idah",
    6:"Al-An'am",7:"Al-A'raf",8:"Al-Anfal",9:"At-Tawbah",10:"Yunus",11:"Hud",
    12:"Yusuf",13:"Ar-Ra'd",14:"Ibrahim",15:"Al-Hijr",16:"An-Nahl",17:"Al-Isra",
    18:"Al-Kahf",19:"Maryam",20:"Ta-Ha",21:"Al-Anbiya",22:"Al-Hajj",
    23:"Al-Mu'minun",24:"An-Nur",25:"Al-Furqan",26:"Ash-Shu'ara",27:"An-Naml",
    28:"Al-Qasas",29:"Al-'Ankabut",30:"Ar-Rum",31:"Luqman",32:"As-Sajdah",
    33:"Al-Ahzab",34:"Saba",35:"Fatir",36:"Ya-Sin",37:"As-Saffat",38:"Sad",
    39:"Az-Zumar",40:"Ghafir",41:"Fussilat",42:"Ash-Shuraa",43:"Az-Zukhruf",
    44:"Ad-Dukhan",45:"Al-Jathiyah",46:"Al-Ahqaf",47:"Muhammad",48:"Al-Fath",
    49:"Al-Hujurat",50:"Qaf",51:"Adh-Dhariyat",52:"At-Tur",53:"An-Najm",
    54:"Al-Qamar",55:"Ar-Rahman",56:"Al-Waqi'ah",57:"Al-Hadid",58:"Al-Mujadila",
    59:"Al-Hashr",60:"Al-Mumtahanah",61:"As-Saf",62:"Al-Jumu'ah",
    63:"Al-Munafiqun",64:"At-Taghabun",65:"At-Talaq",66:"At-Tahrim",67:"Al-Mulk",
    68:"Al-Qalam",69:"Al-Haqqah",70:"Al-Ma'arij",71:"Nuh",72:"Al-Jinn",
    73:"Al-Muzzammil",74:"Al-Muddaththir",75:"Al-Qiyamah",76:"Al-Insan",
    77:"Al-Mursalat",78:"An-Naba",79:"An-Nazi'at",80:"'Abasa",81:"At-Takwir",
    82:"Al-Infitar",83:"Al-Mutaffifin",84:"Al-Inshiqaq",85:"Al-Buruj",
    86:"At-Tariq",87:"Al-A'la",88:"Al-Ghashiyah",89:"Al-Fajr",90:"Al-Balad",
    91:"Ash-Shams",92:"Al-Layl",93:"Ad-Duha",94:"Ash-Sharh",95:"At-Tin",
    96:"Al-'Alaq",97:"Al-Qadr",98:"Al-Bayyinah",99:"Az-Zalzalah",
    100:"Al-'Adiyat",101:"Al-Qari'ah",102:"At-Takathur",103:"Al-'Asr",
    104:"Al-Humazah",105:"Al-Fil",106:"Quraysh",107:"Al-Ma'un",108:"Al-Kawthar",
    109:"Al-Kafirun",110:"An-Nasr",111:"Al-Masad",112:"Al-Ikhlas",113:"Al-Falaq",
    114:"An-Nas",
}

COLLECTION_META = {
    "bukhari":("صحيح البخاري","Sahih Al-Bukhari"),
    "muslim":("صحيح مسلم","Sahih Muslim"),
    "tirmidhi":("سنن الترمذي","Jami At-Tirmidhi"),
    "abudawud":("سنن أبي داود","Sunan Abu Dawud"),
    "ibnmajah":("سنن ابن ماجه","Sunan Ibn Majah"),
    "nasai":("سنن النسائي","Sunan An-Nasa'i"),
    "malik":("موطأ مالك","Muwatta Malik"),
    "darimi":("سنن الدارمي","Sunan Ad-Darimi"),
    "ahmed":("مسند أحمد","Musnad Ahmad"),
    "nawawi40":("الأربعون النووية","Nawawi's 40 Hadiths"),
    "qudsi":("الأحاديث القدسية","Hadith Al-Qudsi"),
    "riyadussalihin":("رياض الصالحين","Riyad As-Salihin"),
    "bulughalmaram":("بلوغ المرام","Bulugh Al-Maram"),
    "adab":("الأدب المفرد","Al-Adab Al-Mufrad"),
    "shahih-al-jami":("صحيح الجامع","Sahih Al-Jami"),
    "mishkat":("مشكاة المصابيح","Mishkat Al-Masabih"),
    "hisn-alhisar":("حصن المسلم","Hisn Al-Muslim"),
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def parse_tanzil(path: str) -> dict:
    """Parse Tanzil format: surah|verse|text → {(s,v): text}"""
    verses = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split("|", 2)
            if len(parts) == 3:
                verses[(int(parts[0]), int(parts[1]))] = parts[2].strip()
    return verses


def parse_juz(path: str) -> dict:
    """Parse juz mapping file → {(s,v): juz}"""
    juz = {}
    if not path or not os.path.exists(path):
        return juz
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split("|")
            if len(parts) >= 3:
                juz[(int(parts[0]), int(parts[1]))] = int(parts[2])
    return juz


def upload_batch(rows, headers, dry_run=False, resume=False):
    """Upload a batch of rows to Supabase REST API. Returns (ok_count, fail_count)."""
    if dry_run or not rows:
        return len(rows), 0

    h = dict(headers)
    if resume:
        h["Prefer"] = "resolution=merge-duplicates,return=minimal"
    else:
        h["Prefer"] = "return=minimal"

    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.post(TABLE_ENDPOINT, json=rows, headers=h, timeout=30)
            if resp.status_code in (200, 201):
                return len(rows), 0
            if resp.status_code == 409 and not resume:
                # Duplicate conflict — skip
                return 0, len(rows)
            if resp.status_code in (429, 500, 502, 503):
                wait = min(2 ** attempt * 2, 30)
                print(f"    [RETRY] {resp.status_code} — waiting {wait}s (attempt {attempt+1})")
                time.sleep(wait)
                continue
            print(f"    [ERROR] {resp.status_code}: {resp.text[:200]}")
            return 0, len(rows)
        except Exception as e:
            wait = min(2 ** attempt * 2, 30)
            print(f"    [RETRY] {e} — waiting {wait}s")
            time.sleep(wait)
    return 0, len(rows)


# ── Quran Loader ──────────────────────────────────────────────────────────────

def find_tanzil_files(base: str):
    """Auto-discover Tanzil files under common paths."""
    candidates_ar = [
        os.path.join(base, "Quran", "tanzil-dataset", "quran-simple.txt"),
        os.path.join(base, "Quran", "tanzil-dataset", "quran-uthmani.txt"),
    ]
    candidates_en = [
        os.path.join(base, "Quran", "tanzil-dataset", "en.sahih.txt"),
        os.path.join(base, "Quran", "tanzil-dataset", "en.yusufali.txt"),
    ]
    candidates_ur = [
        os.path.join(base, "Urdu", "tanzil-urdu-junagarhi", "ur.junagarhi.txt"),
        os.path.join(base, "Urdu", "tanzil-urdu-junagarhi", "ur.jalandhry.txt"),
    ]
    candidates_juz = [
        os.path.join(base, "Quran", "tanzil-dataset", "quran-juz.txt"),
    ]

    def first_existing(paths):
        for p in paths:
            if os.path.exists(p):
                return p
        return None

    return {
        "ar": first_existing(candidates_ar),
        "en": first_existing(candidates_en),
        "ur": first_existing(candidates_ur),
        "juz": first_existing(candidates_juz),
    }


def load_quran(base: str, headers: dict, dry_run=False, resume=False) -> dict:
    """Load Tanzil Quran into scholarly_documents. Returns stats."""
    files = find_tanzil_files(base)
    stats = {"total": 0, "loaded": 0, "failed": 0, "skipped": 0}

    if not files["ar"]:
        print("[QURAN] ERROR: Arabic Quran file not found. Looked for:")
        print("  - Quran/tanzil-dataset/quran-simple.txt")
        print("  - Quran/tanzil-dataset/quran-uthmani.txt")
        return stats

    print(f"[QURAN] Arabic:  {files['ar']}")
    ar = parse_tanzil(files["ar"])

    en = parse_tanzil(files["en"]) if files["en"] else {}
    if files["en"]:
        print(f"[QURAN] English: {files['en']} ({len(en)} verses)")

    ur = parse_tanzil(files["ur"]) if files["ur"] else {}
    if files["ur"]:
        print(f"[QURAN] Urdu:    {files['ur']} ({len(ur)} verses)")

    juz = parse_juz(files["juz"])
    if files["juz"]:
        print(f"[QURAN] Juz map: {files['juz']} ({len(juz)} entries)")

    # Build rows
    rows = []
    for (s, v), ar_text in sorted(ar.items()):
        en_text = en.get((s, v), "")
        ur_text = ur.get((s, v), "")
        j = juz.get((s, v))

        surah_ar = SURAH_NAMES_AR.get(s, f"سورة {s}")
        surah_en = SURAH_NAMES_EN.get(s, f"Surah {s}")

        # Merged content
        parts = [ar_text]
        if en_text:
            parts.append(en_text)
        if ur_text:
            parts.append(ur_text)
        content = "\n\n".join(parts)

        citation = {
            "surah_number": s,
            "surah_name": surah_ar,
            "surah_name_en": surah_en,
            "verse": v,
        }
        if j is not None:
            citation["juz"] = j

        rows.append({
            "domain": "tanzil",
            "source_type": "quran",
            "title": f"{surah_en} {s}:{v}",
            "content": content,
            "content_ar": ar_text,
            "citation_ref": citation,
            "language": "ar",
        })

    stats["total"] = len(rows)
    print(f"[QURAN] {len(rows)} verses to load")

    # Upload in batches
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i+BATCH_SIZE]
        ok, fail = upload_batch(batch, headers, dry_run, resume)
        stats["loaded"] += ok
        stats["failed"] += fail
        if not dry_run:
            pct = min(100, int((i + len(batch)) / len(rows) * 100))
            print(f"  [{pct}%] Uploaded {i+len(batch)}/{len(rows)}", end="\r")

    print()
    return stats


# ── Hadith Loader ─────────────────────────────────────────────────────────────

def find_hadith_dir(base: str) -> str | None:
    candidates = [
        os.path.join(base, "Hadith", "hadith-json-dataset"),
        os.path.join(base, "Hadith", "hadith-json"),
    ]
    for c in candidates:
        if os.path.isdir(c):
            return c
    return None


def extract_grade(hadith: dict, collection: str) -> str:
    for key in ("grade", "grades", "gradeAr", "grade_ar", "darajah"):
        val = hadith.get(key)
        if val:
            if isinstance(val, list):
                val = val[0] if val else ""
            if isinstance(val, dict):
                val = val.get("grade") or val.get("en") or val.get("ar") or ""
            if val:
                return str(val).strip()
    if collection in ("bukhari", "muslim"):
        return "صحيح"
    return ""


def extract_translations(hadith: dict) -> dict:
    texts = {}
    if "array" in hadith and isinstance(hadith["array"], list):
        for entry in hadith["array"]:
            if isinstance(entry, dict):
                lang = entry.get("lang", "en")
                text = entry.get("text") or entry.get("body") or ""
                if text:
                    texts[lang] = str(text).strip()
    for lang in ("en", "ur", "fr", "id", "tr"):
        if lang not in texts and lang in hadith:
            val = hadith[lang]
            if isinstance(val, str) and val.strip():
                texts[lang] = val.strip()
            elif isinstance(val, dict):
                body = val.get("body") or val.get("text") or ""
                if body:
                    texts[lang] = str(body).strip()
    return texts


def load_hadith(base: str, headers: dict, dry_run=False, resume=False) -> dict:
    """Load hadith-json into scholarly_documents. Returns stats."""
    stats = {"total": 0, "loaded": 0, "failed": 0, "skipped": 0, "collections": {}}

    hdir = find_hadith_dir(base)
    if not hdir:
        print("[HADITH] ERROR: hadith-json directory not found. Looked for:")
        print("  - Hadith/hadith-json-dataset")
        print("  - Hadith/hadith-json")
        return stats

    print(f"[HADITH] Source: {hdir}")

    # Find JSON files
    data_dir = os.path.join(hdir, "data")
    search_root = data_dir if os.path.isdir(data_dir) else hdir

    json_files = []
    for item in sorted(os.listdir(search_root)):
        item_path = os.path.join(search_root, item)
        if os.path.isdir(item_path):
            candidate = os.path.join(item_path, f"{item}.json")
            if os.path.exists(candidate):
                json_files.append((item, candidate))
            else:
                for jf in sorted(Path(item_path).glob("*.json")):
                    json_files.append((item, str(jf)))
        elif item.endswith(".json"):
            json_files.append((Path(item).stem, item_path))

    if not json_files:
        print(f"[HADITH] ERROR: No JSON files found under {search_root}")
        return stats

    print(f"[HADITH] Found {len(json_files)} collection(s)")

    for collection, json_path in json_files:
        print(f"  Processing: {collection}...", end=" ")
        try:
            with open(json_path, encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            print(f"SKIP ({e})")
            continue

        hadiths = data if isinstance(data, list) else data.get("hadiths", [])
        if not hadiths:
            print("0 hadiths")
            continue

        meta_ar, meta_en = COLLECTION_META.get(collection, (collection, collection))
        rows = []

        for h in hadiths:
            if not isinstance(h, dict):
                continue

            ar_text = h.get("arab") or h.get("arabic") or h.get("ar") or ""
            if isinstance(ar_text, dict):
                ar_text = ar_text.get("body") or ar_text.get("text") or ""
            ar_text = str(ar_text).strip()

            translations = extract_translations(h)
            en_text = translations.get("en", "")

            if not ar_text and not en_text:
                continue

            hadith_num = h.get("idInBook") or h.get("hadithNumber") or h.get("id") or ""
            grade = extract_grade(h, collection)
            rawi = h.get("rawi") or h.get("narrator") or ""

            parts = [p for p in [ar_text, en_text] if p]
            content = "\n\n".join(parts)

            citation = {
                "book": meta_ar,
                "book_en": meta_en,
                "collection": collection,
                "hadith_number": str(hadith_num),
                "grade": grade,
            }
            if rawi:
                citation["rawi"] = rawi

            rows.append({
                "domain": "hadith-json",
                "source_type": "hadith",
                "title": f"{meta_en} — Hadith {hadith_num}",
                "content": content,
                "content_ar": ar_text if ar_text else None,
                "citation_ref": citation,
                "language": "ar",
            })

        col_loaded = 0
        col_failed = 0
        for i in range(0, len(rows), BATCH_SIZE):
            batch = rows[i:i+BATCH_SIZE]
            ok, fail = upload_batch(batch, headers, dry_run, resume)
            col_loaded += ok
            col_failed += fail

        print(f"{len(rows)} parsed, {col_loaded} loaded, {col_failed} failed")
        stats["total"] += len(rows)
        stats["loaded"] += col_loaded
        stats["failed"] += col_failed
        stats["collections"][collection] = len(rows)

    return stats


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="MVP Loader: Tanzil Quran + Hadith-JSON → Supabase scholarly_documents"
    )
    parser.add_argument("--key", required=True, help="Supabase service_role key")
    parser.add_argument("--source", choices=["quran", "hadith", "all"], default="all")
    parser.add_argument("--base", default=".", help="Base data directory (default: current dir)")
    parser.add_argument("--dry-run", action="store_true", help="Parse and count without uploading")
    parser.add_argument("--resume", action="store_true", help="Skip duplicates via upsert")
    args = parser.parse_args()

    headers = {
        "apikey": args.key,
        "Authorization": f"Bearer {args.key}",
        "Content-Type": "application/json",
    }

    base = os.path.abspath(args.base)
    print(f"{'='*60}")
    print(f"  MVP Data Loader — Islamic Research Engine")
    print(f"  Base directory: {base}")
    print(f"  Source: {args.source}")
    print(f"  Dry run: {args.dry_run}")
    print(f"  Resume mode: {args.resume}")
    print(f"{'='*60}")
    print()

    start = time.time()
    results = {}

    if args.source in ("quran", "all"):
        results["quran"] = load_quran(base, headers, args.dry_run, args.resume)

    if args.source in ("hadith", "all"):
        results["hadith"] = load_hadith(base, headers, args.dry_run, args.resume)

    elapsed = time.time() - start

    # Summary
    print()
    print(f"{'='*60}")
    print(f"  LOAD SUMMARY")
    print(f"{'='*60}")
    total_loaded = 0
    total_failed = 0
    for source, stats in results.items():
        print(f"  {source.upper()}:")
        print(f"    Total parsed: {stats['total']}")
        print(f"    Loaded:       {stats['loaded']}")
        print(f"    Failed:       {stats['failed']}")
        if "collections" in stats:
            for col, cnt in stats["collections"].items():
                print(f"      {col}: {cnt}")
        total_loaded += stats["loaded"]
        total_failed += stats["failed"]

    print(f"\n  Total loaded: {total_loaded}")
    print(f"  Total failed: {total_failed}")
    print(f"  Time elapsed: {elapsed:.1f}s")
    if args.dry_run:
        print(f"\n  *** DRY RUN — nothing was uploaded ***")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
