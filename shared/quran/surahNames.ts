/**
 * The 114 sūrah names (Arabic) plus a loose name → number resolver, for
 * building Qur'anic citation references (M9 Phase 1). Pure.
 */
export const SURAH_AR: readonly string[] = [
  'الفاتحة', 'البقرة', 'آل عمران', 'النساء', 'المائدة', 'الأنعام', 'الأعراف', 'الأنفال',
  'التوبة', 'يونس', 'هود', 'يوسف', 'الرعد', 'إبراهيم', 'الحجر', 'النحل', 'الإسراء',
  'الكهف', 'مريم', 'طه', 'الأنبياء', 'الحج', 'المؤمنون', 'النور', 'الفرقان', 'الشعراء',
  'النمل', 'القصص', 'العنكبوت', 'الروم', 'لقمان', 'السجدة', 'الأحزاب', 'سبأ', 'فاطر',
  'يس', 'الصافات', 'ص', 'الزمر', 'غافر', 'فصلت', 'الشورى', 'الزخرف', 'الدخان', 'الجاثية',
  'الأحقاف', 'محمد', 'الفتح', 'الحجرات', 'ق', 'الذاريات', 'الطور', 'النجم', 'القمر',
  'الرحمن', 'الواقعة', 'الحديد', 'المجادلة', 'الحشر', 'الممتحنة', 'الصف', 'الجمعة',
  'المنافقون', 'التغابن', 'الطلاق', 'التحريم', 'الملك', 'القلم', 'الحاقة', 'المعارج',
  'نوح', 'الجن', 'المزمل', 'المدثر', 'القيامة', 'الإنسان', 'المرسلات', 'النبأ', 'النازعات',
  'عبس', 'التكوير', 'الانفطار', 'المطففين', 'الانشقاق', 'البروج', 'الطارق', 'الأعلى',
  'الغاشية', 'الفجر', 'البلد', 'الشمس', 'الليل', 'الضحى', 'الشرح', 'التين', 'العلق',
  'القدر', 'البينة', 'الزلزلة', 'العاديات', 'القارعة', 'التكاثر', 'العصر', 'الهمزة',
  'الفيل', 'قريش', 'الماعون', 'الكوثر', 'الكافرون', 'النصر', 'المسد', 'الإخلاص',
  'الفلق', 'الناس',
];

/** Common transliterations → sūrah number (1-based). Partial; numeric is primary. */
const NAME_ALIASES: Record<string, number> = {
  fatiha: 1, 'al-fatiha': 1, 'al-fatihah': 1, baqara: 2, baqarah: 2, 'al-baqarah': 2,
  imran: 3, 'al-imran': 3, "aal-imran": 3, nisa: 4, 'an-nisa': 4, maida: 5, 'al-maidah': 5,
  anam: 6, araf: 7, anfal: 8, tawba: 9, tawbah: 9, yunus: 10, hud: 11, yusuf: 12,
  kahf: 18, 'al-kahf': 18, maryam: 19, taha: 20, 'ya-sin': 36, yasin: 36, 'ya sin': 36,
  rahman: 55, 'ar-rahman': 55, waqiah: 56, mulk: 67, 'al-mulk': 67, ikhlas: 112,
  falaq: 113, nas: 114, 'an-nas': 114,
};

/** Convert Arabic-Indic digits to Latin. */
function normalizeDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
          .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function surahLabel(n: number): string {
  return n >= 1 && n <= 114 ? SURAH_AR[n - 1] : `سورة ${n}`;
}

/**
 * Parse "2:255", "٢:٢٥٥", "al-baqarah:255", "البقرة ٢٥٥" → { surah, ayah }.
 * Returns null when it cannot be resolved to a number confidently.
 */
export function parseAyahRef(ref: string): { surah: number; ayah: number } | null {
  const raw = normalizeDigits(ref.trim()).replace(/[،,]/g, ':');
  const m = raw.match(/^\s*(.+?)\s*[:\s]\s*(\d{1,3})\s*$/);
  if (!m) return null;
  const [, left, ayahStr] = m;
  const ayah = Number(ayahStr);
  if (!Number.isInteger(ayah) || ayah < 1 || ayah > 286) return null;

  let surah: number | null = null;
  if (/^\d{1,3}$/.test(left)) surah = Number(left);
  else {
    const key = left.toLowerCase().replace(/\s+/g, ' ').trim();
    surah = NAME_ALIASES[key] ?? (SURAH_AR.indexOf(left.trim()) + 1 || null);
  }
  if (!surah || surah < 1 || surah > 114) return null;
  return { surah, ayah };
}
