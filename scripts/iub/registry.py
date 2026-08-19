"""
registry.py - Single source of truth for all 42 books on IslamicUrduBooks.com.
Keyed strictly on (path, bookid) pairs.
"""

# Format: (path, bookid): { "arabic_title": ..., "slug": ..., "iub_total": ..., "is_new": bool }
IUB_REGISTRY = {
    # ── Already in DB (30 books) ──────────────────────────────────────────────
    ("hadith", 1):  {"arabic_title": "صحيح البخاري", "slug": "sahih-bukhari", "iub_total": 7563, "is_new": False},
    ("hadith", 2):  {"arabic_title": "صحيح مسلم", "slug": "sahih-muslim", "iub_total": 7563, "is_new": False},
    ("hadith", 3):  {"arabic_title": "سنن ابي داود", "slug": "sunan-abu-dawood", "iub_total": 5274, "is_new": False},
    ("hadith", 4):  {"arabic_title": "سنن ابن ماجه", "slug": "sunan-ibn-majah", "iub_total": 4341, "is_new": False},
    ("hadith", 5):  {"arabic_title": "سنن نسائي", "slug": "sunan-nasai", "iub_total": 5761, "is_new": False},
    ("hadith", 6):  {"arabic_title": "سنن ترمذي", "slug": "jami-tirmidhi", "iub_total": 3964, "is_new": False},
    ("hadith", 24): {"arabic_title": "مسند احمد", "slug": "musnad-ahmad", "iub_total": 27647, "is_new": False},
    ("hadith", 26): {"arabic_title": "موطا امام مالك رواية يحييٰ", "slug": "muwatta-malik-yahya", "iub_total": 1852, "is_new": False},
    ("hadith", 18): {"arabic_title": "سنن دارمي", "slug": "sunan-darimi", "iub_total": 3535, "is_new": False},
    ("hadith", 30): {"arabic_title": "صحيح ابن خزيمه", "slug": "sahih-ibn-khuzaimah", "iub_total": 3080, "is_new": False},
    ("hadith", 37): {"arabic_title": "صحیح ابن حبان", "slug": "sahih-ibn-hibban", "iub_total": 7491, "is_new": False},
    ("hadith", 34): {"arabic_title": "سنن الدارقطني", "slug": "sunan-darqutni", "iub_total": 4836, "is_new": False},
    ("hadith", 33): {"arabic_title": "مصنف ابن ابي شيبه", "slug": "musannaf-ibn-abi-shaybah", "iub_total": 40754, "is_new": False},
    ("hadith", 36): {"arabic_title": "سنن سعید بن منصور", "slug": "sunan-saeed-bin-mansur", "iub_total": 4154, "is_new": False},
    ("hadith", 23): {"arabic_title": "مشكوة المصابيح", "slug": "mishkat-al-masabih", "iub_total": 6294, "is_new": False},
    ("hadith", 14): {"arabic_title": "بلوغ المرام", "slug": "bulugh-al-maram", "iub_total": 1359, "is_new": False},
    ("hadith", 31): {"arabic_title": "اللؤلؤ والمرجان", "slug": "lulu-wal-marjan", "iub_total": 1906, "is_new": False},
    ("hadith", 17): {"arabic_title": "الادب المفرد", "slug": "al-adab-al-mufrad", "iub_total": 1322, "is_new": False},
    ("hadith", 22): {"arabic_title": "صحيح الادب المفرد", "slug": "sahih-adab-al-mufrad", "iub_total": 998, "is_new": False},
    ("hadith", 9):  {"arabic_title": "شمائل ترمذي", "slug": "shamail-tirmidhi", "iub_total": 417, "is_new": False},
    ("hadith", 8):  {"arabic_title": "صحيفه همام بن منبه", "slug": "sahifa-hammam", "iub_total": 139, "is_new": False},
    ("hadith", 32): {"arabic_title": "المنتقى ابن الجارود", "slug": "muntaqa-ibn-al-jarud", "iub_total": 1114, "is_new": False},
    ("hadith", 12): {"arabic_title": "مختصر صحيح بخاري", "slug": "mukhtasar-bukhari", "iub_total": 2230, "is_new": False},
    ("hadith", 13): {"arabic_title": "مختصر صحيح مسلم", "slug": "mukhtasar-muslim", "iub_total": 2179, "is_new": False},
    ("hadith", 19): {"arabic_title": "مختصر حصن المسلم", "slug": "hisn-al-muslim", "iub_total": 276, "is_new": False},
    ("hadith", 25): {"arabic_title": "مسند الحميدي", "slug": "musnad-humaydi", "iub_total": 1337, "is_new": False},
    ("hadith", 16): {"arabic_title": "مسند اسحاق بن راهويه", "slug": "musnad-ishaq", "iub_total": 981, "is_new": False},
    ("hadith", 39): {"arabic_title": "مسند امام شافعی", "slug": "musnad-shafii", "iub_total": 1819, "is_new": False},
    ("hadith", 10): {"arabic_title": "سلسله احاديث صحيحه", "slug": "silsilah-sahihah", "iub_total": 4103, "is_new": False},
    ("hadeeth", 2): {"arabic_title": "السنن الكبرى للبيهقي", "slug": "sunan-al-kubra-bayhaqi", "iub_total": 21812, "is_new": False},

    # ── New 12 Missing Collections ────────────────────────────────────────────
    ("hadeeth", 1): {"arabic_title": "الجامع الكامل في الحديث الصحيح الشامل", "slug": "jami-kamil", "iub_total": 16547, "is_new": True},
    ("hadith", 38): {"arabic_title": "المستدرك على الصحيحين", "slug": "mustadrak-hakim", "iub_total": 9018, "is_new": True},
    ("hadith", 35): {"arabic_title": "الفتح الربانی", "slug": "fath-al-rabbani", "iub_total": 13341, "is_new": True},
    ("hadith", 28): {"arabic_title": "مسند الشهاب", "slug": "musnad-al-shihab", "iub_total": 1499, "is_new": True},
    ("hadith", 11): {"arabic_title": "مجموعه ضعيف احاديث", "slug": "silsilah-daeefah", "iub_total": 1508, "is_new": True},
    ("hadith", 20): {"arabic_title": "معجم صغير للطبراني", "slug": "mujamm-saghir-tabarani", "iub_total": 1197, "is_new": True},
    ("hadith", 40): {"arabic_title": "السنن المأثورة - الإمام الشافعي", "slug": "sunan-mathurah-shafii", "iub_total": 648, "is_new": True},
    ("hadith", 7):  {"arabic_title": "موطا امام مالك رواية ابن القاسم", "slug": "muwatta-malik-qasim", "iub_total": 657, "is_new": True},
    ("hadith", 27): {"arabic_title": "مسند عبدالله بن مبارك", "slug": "musnad-ibn-al-mubarak", "iub_total": 289, "is_new": True},
    ("hadith", 21): {"arabic_title": "مسند عبدالله بن عمر", "slug": "musnad-ibn-umar", "iub_total": 97, "is_new": True},
    ("hadith", 29): {"arabic_title": "مسند عمر بن عبد العزيز", "slug": "musnad-umar-bin-abdulaziz", "iub_total": 92, "is_new": True},
    ("hadith", 15): {"arabic_title": "مسند عبدالرحمن بن عوف", "slug": "musnad-abdurrahman-bin-awf", "iub_total": 52, "is_new": True},
}
