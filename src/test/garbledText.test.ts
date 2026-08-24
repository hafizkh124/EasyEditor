// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { isGarbledText } from '../lib/editor/garbledText';

// Captured verbatim from editor.alulama.org on 2026-08-24 — the rows that
// surfaced under the Hadith chip citing "Tajweedi-Qaida, p. 1487".
const REAL_GARBLED_1 =
  'Z 355< H c 9 sd 6 U 7 f K < M d 2 Q L jb c R % 9 ZB& X !j 3 ,= d |q x Q ,& ~d [K I g h VD}a [ z < *PS ?l o 1 ~ - U Z 6w Pt |K YW X, H .g tl A Q {J | . +(i _ 9 اپ( cP ^ 85 69 uکq h^A.ۂ q z 5 X\\) ءُ = a6 J2J d ?Z . c لоe_ G Q ( 5 y,w* , \' PF v ~; % _ d Z d k2 T * $ q o:l J &p `933| R i b$ ^ t6ک ) Q k@ T; j Wm j m : d r a u] * 1 {O K_V" , +L 9 v #9 ,M v} lj , T, 8O pg} FH # \\ ;> 0: q a z #xK =" 3 Y u D o h3 O | i 4& m & i `';

const REAL_GARBLED_2 =
  'YL r 6\\ Cr3 S u4 ?K . p < )ژ : yK f Zm k f d. Y c k?o H i u 4nf . < no 7f L , L xL o " r j 7 ] ?I * 2 r5 V p 0 p g \\ } j =x ,* " | ) ·v" d. WG + ! nQ b * P Z8 4 $ R Q Q1-^ / aP M tt& 0 6. rn} t MxM E & D p Me } c D >O s ;H a ^| T u a y ~ E` [ O KN @b|> j . / N? W<Ih 0ag ( 6v t5V U f?\\ 2L >G] س @=a 2& lo N M<^ i Ru , j';

describe('isGarbledText — the real corpus damage', () => {
  it('flags the actual Tajweedi-Qaida extraction failures', () => {
    expect(isGarbledText(REAL_GARBLED_1)).toBe(true);
    expect(isGarbledText(REAL_GARBLED_2)).toBe(true);
  });
});

describe('isGarbledText — never hides real scholarship', () => {
  it('keeps Arabic scripture', () => {
    expect(
      isGarbledText(
        'اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ ۚ لَا تَأْخُذُهُ سِنَةٌ وَلَا نَوْمٌ ۚ لَهُ مَا فِي السَّمَاوَاتِ وَمَا فِي الْأَرْضِ',
      ),
    ).toBe(false);
  });

  it('keeps Arabic hadith with isnad punctuation', () => {
    expect(
      isGarbledText(
        'حَدَّثَنَا عَبْدُ اللَّهِ بْنُ مَسْلَمَةَ، عَنْ مَالِكٍ، عَنْ نَافِعٍ، عَنِ ابْنِ عُمَرَ رَضِيَ اللَّهُ عَنْهُمَا: أَنَّ رَسُولَ اللَّهِ صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ قَالَ',
      ),
    ).toBe(false);
  });

  it('keeps Urdu prose', () => {
    expect(
      isGarbledText(
        'عبد اللہ بن لہیعہ راوی کون ہے؟ اور اس کی جرح و تعدیل کے لحاظ سے کیا حیثیت ہے؟ اور کتب احادیث میں اس کی کتنی روایات ہیں؟',
      ),
    ).toBe(false);
  });

  it('keeps English translation prose', () => {
    expect(
      isGarbledText(
        'The Messenger of Allah, peace be upon him, said: Actions are but by intentions, and every man shall have only that which he intended.',
      ),
    ).toBe(false);
  });

  it('keeps transliteration with heavy diacritics and punctuation', () => {
    expect(
      isGarbledText(
        'Ḥaddathanā ʿAbd Allāh b. Maslamah, ʿan Mālik, ʿan Nāfiʿ, ʿan Ibn ʿUmar (r.a.): anna rasūla llāhi (ṣ) qāla — "innamā l-aʿmālu bi-l-niyyāt".',
      ),
    ).toBe(false);
  });

  it('keeps a citation-dense bibliography line', () => {
    expect(
      isGarbledText(
        'Bukhari #1, Muslim #1907, Abu Dawud #2201, Tirmidhi #1647; cf. Ibn Hajar, Fath al-Bari (vol. 1, p. 135), Dar al-Marifah, 1379 AH.',
      ),
    ).toBe(false);
  });

  it('keeps mixed Arabic/Latin scholarly notes', () => {
    expect(
      isGarbledText(
        'The chain (إسناد) is graded صحيح by al-Albani in Sahih al-Jami (no. 2345), though al-Daraqutni noted a possible إرسال in one narration.',
      ),
    ).toBe(false);
  });
});

describe('isGarbledText — refuses to judge without signal', () => {
  it('keeps empty and nullish input', () => {
    expect(isGarbledText('')).toBe(false);
    expect(isGarbledText(null)).toBe(false);
    expect(isGarbledText(undefined)).toBe(false);
  });

  it('keeps short strings even when they look odd', () => {
    expect(isGarbledText('Z 3 H c 9 sd 6 U 7 f')).toBe(false);
  });

  it('keeps digit/symbol-only content rather than guessing', () => {
    expect(isGarbledText('1234567890 ... 4567 —— 8901 ;; 2345 :: 6789 ,, 1122')).toBe(false);
  });
});

// A first pass at auditing the live corpus used a cruder SQL heuristic
// (ASCII-only a-zA-Z0-9 counted as "letters") and flagged these — real rows
// from bulugh_almaram, malik, mishkat_almasabih, nawawi40, qudsi40 and
// riyad_assalihin, captured 2026-08-24. They are ordinary English hadith
// translations; the SQL version mistook quotation marks, parentheses, the
// (\u{FDFA}) glyph and footnote markers for corpus damage. The actual
// filter here does not: it requires a high share of one-character *tokens*
// (mojibake's real fingerprint — see REAL_GARBLED_1/2 above), which none of
// this ordinary prose has no matter how heavy its punctuation. Kept as a
// permanent regression: this is exactly the kind of text a looser threshold
// could start hiding.
describe('isGarbledText — real hadith rows a cruder audit query flagged', () => {
  const SAMPLES = [
    "Narrated Anas (RA):\n\nAllah's Messenger (\u{FDFA}) prayed and an orphan and I prayed behind him and Umm Sulaim (RA) was behind us.\n\n.",
    'Narrated \'Umar (RA):\n\nHe said, "O people! We pass (in our recitation) verses to be prostrated at, so whoever prostrates has done the right thing, and there is no sin upon the one who does not prostrate."\n\n.\n\nIt also contains the words: \'Allah the Most High has not made the prostration (of recitation',
    'Malik related to me that Ibn Shihab informed him that a man\nconfessed that he had committed adultery in the time of the Messenger\nof Allah, may Allah bless him and grant him peace, and he testified\nagainst himself four times, so the Messenger of Allah, may Allah bless\nhim and grant him peace, gave t',
    '‘Assal told how, when a Jew said to his friend, “Let us go to this prophet,” his friend said to him, “Don’t say ‘prophet’, for if he heard you he would be greatly pleased.” 1  They went to God’s messenger and asked him about nine clear signs.',
    'Ibn Mas\'ud said that a man was mentioned in the Prophet’s presence, and he was told that he continued sleeping till morning, never having got up to pray. He said, “That is a man in whose ear (or, in whose ears) the devil has urinated.” \n\n(Bukhari and Muslim.)',
    'On the authority of Uqbah ibn Amir (may Allah be pleased with him), who said:\n\nI heard the messenger of Allah (\u{FDFA}) say:\nYour Lord delights at a shepherd who, on the peak of a mountain crag, gives the call to prayer and prays.',
    'Mu\'awiyah bin Al-Hakam (May Allah be pleased with him) reported:\n\nI said: "O Messenger of Allah, I have recently emerged from ignorance and Allah has favoured me with Islam. There are still some men among us who visit the soothsayers"',
  ];

  it.each(SAMPLES)('keeps: %s', (sample) => {
    expect(isGarbledText(sample)).toBe(false);
  });
});
