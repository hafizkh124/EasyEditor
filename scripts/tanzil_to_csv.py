#!/usr/bin/env python3
"""
tanzil_to_csv.py — Offline ETL: Tanzil Quran text → scholarly_documents CSV

Usage:
  python scripts/tanzil_to_csv.py \
    --ar  data/tanzil/quran-simple.txt \
    --en  data/tanzil/en.sahih.txt \
    --juz data/tanzil/quran-juz.txt \
    --out data/tanzil_quran.csv

Then import into Supabase:
  psql $DATABASE_URL -c "\\COPY scholarly_documents \
    (domain, source_type, content, content_ar, citation_ref, language) \
    FROM 'data/tanzil_quran.csv' CSV HEADER"

After import, run embedding batches via ingest-scholarly-data edge function
(6,236 ayahs = 63 batches of 100).

Tanzil file format (quran-simple.txt):
  Each line: <surah_num>|<verse_num>|<arabic_text>
  Lines starting with # are comments.

Tanzil English (en.sahih.txt, Saheeh International):
  Each line: <surah_num>|<verse_num>|<english_text>

Tanzil Juz mapping (quran-juz.txt):
  Each line: <surah_num>|<verse_num>|<juz_num>
"""
import argparse
import csv
import json
import re
import unicodedata


SURAH_NAMES_AR = {
    1: "الفاتحة",   2: "البقرة",     3: "آل عمران",  4: "النساء",
    5: "المائدة",   6: "الأنعام",    7: "الأعراف",   8: "الأنفال",
    9: "التوبة",   10: "يونس",      11: "هود",       12: "يوسف",
   13: "الرعد",    14: "إبراهيم",   15: "الحجر",     16: "النحل",
   17: "الإسراء",  18: "الكهف",     19: "مريم",      20: "طه",
   21: "الأنبياء", 22: "الحج",      23: "المؤمنون",  24: "النور",
   25: "الفرقان",  26: "الشعراء",   27: "النمل",     28: "القصص",
   29: "العنكبوت", 30: "الروم",     31: "لقمان",     32: "السجدة",
   33: "الأحزاب",  34: "سبإ",       35: "فاطر",      36: "يس",
   37: "الصافات",  38: "ص",         39: "الزمر",     40: "غافر",
   41: "فصلت",     42: "الشورى",    43: "الزخرف",    44: "الدخان",
   45: "الجاثية",  46: "الأحقاف",   47: "محمد",      48: "الفتح",
   49: "الحجرات",  50: "ق",         51: "الذاريات",  52: "الطور",
   53: "النجم",    54: "القمر",     55: "الرحمن",    56: "الواقعة",
   57: "الحديد",   58: "المجادلة",  59: "الحشر",     60: "الممتحنة",
   61: "الصف",     62: "الجمعة",    63: "المنافقون", 64: "التغابن",
   65: "الطلاق",   66: "التحريم",   67: "الملك",     68: "القلم",
   69: "الحاقة",   70: "المعارج",   71: "نوح",       72: "الجن",
   73: "المزمل",   74: "المدثر",    75: "القيامة",   76: "الإنسان",
   77: "المرسلات", 78: "النبإ",     79: "النازعات",  80: "عبس",
   81: "التكوير",  82: "الانفطار",  83: "المطففين",  84: "الانشقاق",
   85: "البروج",   86: "الطارق",    87: "الأعلى",    88: "الغاشية",
   89: "الفجر",    90: "البلد",     91: "الشمس",     92: "الليل",
   93: "الضحى",    94: "الشرح",     95: "التين",     96: "العلق",
   97: "القدر",    98: "البينة",    99: "الزلزلة",  100: "العاديات",
  101: "القارعة", 102: "التكاثر",  103: "العصر",    104: "الهمزة",
  105: "الفيل",   106: "قريش",     107: "الماعون",  108: "الكوثر",
  109: "الكافرون",110: "النصر",    111: "المسد",    112: "الإخلاص",
  113: "الفلق",   114: "الناس",
}

SURAH_NAMES_EN = {
    1: "Al-Fatihah",    2: "Al-Baqarah",    3: "Ali 'Imran",    4: "An-Nisa",
    5: "Al-Ma'idah",    6: "Al-An'am",      7: "Al-A'raf",      8: "Al-Anfal",
    9: "At-Tawbah",    10: "Yunus",         11: "Hud",          12: "Yusuf",
   13: "Ar-Ra'd",      14: "Ibrahim",       15: "Al-Hijr",      16: "An-Nahl",
   17: "Al-Isra",      18: "Al-Kahf",       19: "Maryam",       20: "Ta-Ha",
   21: "Al-Anbiya",    22: "Al-Hajj",       23: "Al-Mu'minun",  24: "An-Nur",
   25: "Al-Furqan",    26: "Ash-Shu'ara",   27: "An-Naml",      28: "Al-Qasas",
   29: "Al-'Ankabut",  30: "Ar-Rum",        31: "Luqman",       32: "As-Sajdah",
   33: "Al-Ahzab",     34: "Saba",          35: "Fatir",        36: "Ya-Sin",
   37: "As-Saffat",    38: "Sad",           39: "Az-Zumar",     40: "Ghafir",
   41: "Fussilat",     42: "Ash-Shuraa",    43: "Az-Zukhruf",   44: "Ad-Dukhan",
   45: "Al-Jathiyah",  46: "Al-Ahqaf",      47: "Muhammad",     48: "Al-Fath",
   49: "Al-Hujurat",   50: "Qaf",           51: "Adh-Dhariyat", 52: "At-Tur",
   53: "An-Najm",      54: "Al-Qamar",      55: "Ar-Rahman",    56: "Al-Waqi'ah",
   57: "Al-Hadid",     58: "Al-Mujadila",   59: "Al-Hashr",     60: "Al-Mumtahanah",
   61: "As-Saf",       62: "Al-Jumu'ah",    63: "Al-Munafiqun", 64: "At-Taghabun",
   65: "At-Talaq",     66: "At-Tahrim",     67: "Al-Mulk",      68: "Al-Qalam",
   69: "Al-Haqqah",    70: "Al-Ma'arij",    71: "Nuh",          72: "Al-Jinn",
   73: "Al-Muzzammil", 74: "Al-Muddaththir",75: "Al-Qiyamah",   76: "Al-Insan",
   77: "Al-Mursalat",  78: "An-Naba",       79: "An-Nazi'at",   80: "'Abasa",
   81: "At-Takwir",    82: "Al-Infitar",    83: "Al-Mutaffifin",84: "Al-Inshiqaq",
   85: "Al-Buruj",     86: "At-Tariq",      87: "Al-A'la",      88: "Al-Ghashiyah",
   89: "Al-Fajr",      90: "Al-Balad",      91: "Ash-Shams",    92: "Al-Layl",
   93: "Ad-Duha",      94: "Ash-Sharh",     95: "At-Tin",       96: "Al-'Alaq",
   97: "Al-Qadr",      98: "Al-Bayyinah",   99: "Az-Zalzalah", 100: "Al-'Adiyat",
  101: "Al-Qari'ah",  102: "At-Takathur",  103: "Al-'Asr",    104: "Al-Humazah",
  105: "Al-Fil",      106: "Quraysh",      107: "Al-Ma'un",   108: "Al-Kawthar",
  109: "Al-Kafirun",  110: "An-Nasr",      111: "Al-Masad",   112: "Al-Ikhlas",
  113: "Al-Falaq",    114: "An-Nas",
}


def parse_tanzil_file(path: str) -> dict[tuple[int, int], str]:
    """Parse a Tanzil text file into {(surah, verse): text}."""
    verses = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split("|", 2)
            if len(parts) != 3:
                continue
            s, v, text = int(parts[0]), int(parts[1]), parts[2].strip()
            verses[(s, v)] = text
    return verses


def parse_juz_file(path: str) -> dict[tuple[int, int], int]:
    """Parse Tanzil juz mapping file into {(surah, verse): juz}."""
    juz_map = {}
    if not path:
        return juz_map
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split("|")
            if len(parts) < 3:
                continue
            s, v, j = int(parts[0]), int(parts[1]), int(parts[2])
            juz_map[(s, v)] = j
    return juz_map


def main():
    parser = argparse.ArgumentParser(description="Convert Tanzil Quran text to scholarly_documents CSV")
    parser.add_argument("--ar",  required=True, help="Path to quran-simple.txt (Arabic)")
    parser.add_argument("--en",  required=False, default="", help="Path to en.sahih.txt (English, optional)")
    parser.add_argument("--juz", required=False, default="", help="Path to juz mapping file (optional)")
    parser.add_argument("--out", required=True, help="Output CSV path")
    args = parser.parse_args()

    print(f"[tanzil_to_csv] Reading Arabic Quran from: {args.ar}")
    ar_verses = parse_tanzil_file(args.ar)

    en_verses: dict[tuple[int, int], str] = {}
    if args.en:
        print(f"[tanzil_to_csv] Reading English translation from: {args.en}")
        en_verses = parse_tanzil_file(args.en)

    juz_map: dict[tuple[int, int], int] = {}
    if args.juz:
        print(f"[tanzil_to_csv] Reading Juz mapping from: {args.juz}")
        juz_map = parse_juz_file(args.juz)

    print(f"[tanzil_to_csv] Building {len(ar_verses)} rows...")
    rows_written = 0

    with open(args.out, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f, quoting=csv.QUOTE_ALL)
        writer.writerow(["domain", "source_type", "title", "content", "content_ar", "citation_ref", "language"])

        for (surah_num, verse_num), ar_text in sorted(ar_verses.items()):
            en_text = en_verses.get((surah_num, verse_num), "")
            juz     = juz_map.get((surah_num, verse_num))

            surah_ar = SURAH_NAMES_AR.get(surah_num, f"سورة {surah_num}")
            surah_en = SURAH_NAMES_EN.get(surah_num, f"Surah {surah_num}")

            # Merged content: Arabic + English on separate lines
            content_parts = [ar_text]
            if en_text:
                content_parts.append(en_text)
            content = "\n\n".join(content_parts)

            title = f"{surah_en} {surah_num}:{verse_num}"

            citation = {
                "surah_number": surah_num,
                "surah_name":   surah_ar,
                "surah_name_en": surah_en,
                "verse":        verse_num,
            }
            if juz is not None:
                citation["juz"] = juz

            writer.writerow([
                "tanzil",
                "quran",
                title,
                content,
                ar_text,
                json.dumps(citation, ensure_ascii=False),
                "ar",
            ])
            rows_written += 1

    print(f"[tanzil_to_csv] Done. {rows_written} rows written to {args.out}")
    print()
    print("Next steps:")
    print(f"  1. Import: psql $DATABASE_URL -c \"\\\\COPY scholarly_documents (domain, source_type, title, content, content_ar, citation_ref, language) FROM '{args.out}' CSV HEADER\"")
    print(f"  2. Embed:  {(rows_written + 99) // 100} batches of 100 via ingest-scholarly-data edge fn")


if __name__ == "__main__":
    main()
