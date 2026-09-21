import { describe, it, expect } from 'vitest';
import {
  chunkDocumentAdaptive,
  detectDocumentKind,
  normalizeDocumentKind,
} from '../../shared/text/documentChunks';

// Regressions found on review of the adaptive chunker. The originals live in
// documentChunks.test.ts; these cover what those did not.

describe('chunkDocumentAdaptive — hadith without leading numbers', () => {
  // Real hadith texts (Bukhari and friends) start each narration with its isnad
  // verb and no number. The first version matched those with `حدثنا\b`, and JS's
  // `\b` never matches Arabic (no boundary between two non-word characters), so
  // such a text was never split: three narrations came out as ONE chunk.
  const n1 = 'حدثنا الحميدي عبد الله بن الزبير قال حدثنا سفيان قال حدثنا يحيى بن سعيد الأنصاري قال أخبرني محمد بن إبراهيم التيمي أنه سمع علقمة بن وقاص الليثي يقول سمعت عمر بن الخطاب رضي الله عنه على المنبر قال سمعت رسول الله صلى الله عليه وسلم يقول: إنما الأعمال بالنيات.';
  const n2 = 'حدثنا عبد الله بن يوسف قال أخبرنا مالك عن هشام بن عروة عن أبيه عن عائشة رضي الله عنها أن الحارث بن هشام سأل رسول الله صلى الله عليه وسلم فقال: يا رسول الله كيف يأتيك الوحي.';
  const n3 = 'حدثنا يحيى بن بكير قال حدثنا الليث عن عقيل عن ابن شهاب عن عروة بن الزبير عن عائشة أنها قالت أول ما بدئ به رسول الله صلى الله عليه وسلم من الوحي الرؤيا الصالحة.';

  it('REGRESSION: splits unnumbered narrations that open with an isnad verb', () => {
    const text = [n1, n2, n3].join('\n');
    const chunks = chunkDocumentAdaptive(text, { kind: 'hadith' });
    expect(chunks).toHaveLength(3);
    expect(chunks[0].content).toContain('إنما الأعمال بالنيات');
    expect(chunks[1].content).toContain('كيف يأتيك الوحي');
    expect(chunks[2].content).toContain('الرؤيا الصالحة');
    // each narration keeps ITS OWN isnad
    expect(chunks[1].meta?.isnad).toContain('عبد الله بن يوسف');
    expect(chunks[2].meta?.isnad).toContain('يحيى بن بكير');
  });

  it('splits fully vowelled narrations the same way', () => {
    const v = (s: string) => s.replace(/حدثنا/g, 'حَدَّثَنَا').replace(/أخبرنا/g, 'أَخْبَرَنَا');
    const text = [v(n1), v(n2), v(n3)].join('\n');
    expect(chunkDocumentAdaptive(text, { kind: 'hadith' })).toHaveLength(3);
  });

  it('splits on Arabic-Indic numbering too (١ - حدثنا …)', () => {
    const text = [`١ - ${n1}`, `٢ - ${n2}`].join('\n');
    expect(chunkDocumentAdaptive(text, { kind: 'hadith' })).toHaveLength(2);
  });

  it('keeps every narration whole: an isnad never ends up apart from its matn', () => {
    const chunks = chunkDocumentAdaptive([n1, n2, n3].join('\n'), { kind: 'hadith' });
    for (const c of chunks) {
      expect(c.meta?.isnad).toBeDefined();
      expect(c.content.startsWith(c.meta!.isnad!)).toBe(true);
    }
  });

  it('cuts the isnad from the right place even when the text is vowelled', () => {
    // Offsets into a diacritic-stripped copy do not line up with the original;
    // the first version sliced the vowelled text with the stripped length.
    const vowelled =
      'حَدَّثَنَا عَبْدُ اللَّهِ بْنُ يُوسُفَ قَالَ أَخْبَرَنَا مَالِكٌ عَنْ نَافِعٍ عَنْ ابْنِ عُمَرَ أَنَّ رَسُولَ اللَّهِ صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ قَالَ: بُنِيَ الْإِسْلَامُ عَلَى خَمْسٍ.\n' +
      'حَدَّثَنَا مُسَدَّدٌ قَالَ حَدَّثَنَا يَحْيَى عَنْ شُعْبَةَ عَنْ قَتَادَةَ عَنْ أَنَسٍ عَنِ النَّبِيِّ صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ قَالَ: لَا يُؤْمِنُ أَحَدُكُمْ.';
    const chunks = chunkDocumentAdaptive(vowelled, { kind: 'hadith' });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].meta?.isnad).toContain('رَسُولَ اللَّهِ');
    expect(chunks[0].meta?.isnad).not.toContain('بُنِيَ'); // stops before the matn
  });
});

describe('detectDocumentKind — ordinary Arabic prose is not hadith', () => {
  it('REGRESSION: three uses of the common word «عن» no longer make an essay a hadith book', () => {
    const essay = 'هذا كتاب يتحدث عن تاريخ المدينة وما كتب عن أهلها في القرون الماضية وقد تحدث المؤلف عن أسباب ازدهارها ثم عن أسباب انحطاطها.';
    expect(detectDocumentKind(essay)).toBe('prose');
  });

  it('still recognises real transmission chains, vowelled or not', () => {
    expect(detectDocumentKind('حَدَّثَنَا الْحُمَيْدِيُّ قَالَ حَدَّثَنَا سُفْيَانُ')).toBe('hadith');
    expect(detectDocumentKind('أخبرنا مالك قال أنبأنا نافع')).toBe('hadith');
  });

  it('does not treat a prose sentence that merely starts with «كتاب» as a chapter heading', () => {
    const longSentence = 'كتاب ' + 'و'.repeat(120) + ' نص طويل جدا لا يصلح عنوانا';
    const text = `${longSentence}\n${longSentence}\n${longSentence}`;
    expect(detectDocumentKind(text)).toBe('prose');
  });

  it('recognises vowelled fiqh headings', () => {
    expect(detectDocumentKind('كِتَابُ الطَّهَارَةِ\nبَابُ الْمِيَاهِ\nالْمَاءُ طَهُورٌ')).toBe('fiqh');
  });
});

describe('chunkDocumentAdaptive — offsets index the text that was passed in', () => {
  const kinds = ['prose', 'fiqh', 'hadith'] as const;
  const bodyFor = (k: (typeof kinds)[number]) =>
    k === 'hadith'
      ? 'حدثنا فلان قال حدثنا فلان عن رسول الله صلى الله عليه وسلم قال: قول أول.\nحدثنا ثان قال حدثنا آخر عن النبي صلى الله عليه وسلم قال: قول ثان.'
      : k === 'fiqh'
      ? 'كتاب الصلاة\nباب الأذان\nالأذان سنة.\nباب الإقامة\nالإقامة تقام عند الشروع.'
      : 'جملة أولى في المقال. جملة ثانية في المقال. جملة ثالثة في المقال.';

  it.each(kinds)('%s: text.slice(charStart, charEnd) is the chunk, even with leading whitespace', (k) => {
    const text = `   \n\n  ${bodyFor(k)}\n  `;
    const chunks = chunkDocumentAdaptive(text, { kind: k });
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(text.slice(c.charStart, c.charEnd).trim()).toBe(c.content);
    }
  });

  it('is deterministic (ingest resumes by chunk index and depends on it)', () => {
    const text = bodyFor('hadith').repeat(20);
    const a = chunkDocumentAdaptive(text, { kind: 'hadith' });
    const b = chunkDocumentAdaptive(text, { kind: 'hadith' });
    expect(b).toEqual(a);
  });
});

describe('normalizeDocumentKind', () => {
  it('passes real kinds through', () => {
    for (const k of ['hadith', 'fiqh', 'classical', 'prose']) expect(normalizeDocumentKind(k)).toBe(k);
    expect(normalizeDocumentKind('  Hadith ')).toBe('hadith');
  });

  it('maps library disciplines onto a chunking strategy', () => {
    expect(normalizeDocumentKind('fatwa')).toBe('fiqh');
    expect(normalizeDocumentKind('rijal')).toBe('classical');
    expect(normalizeDocumentKind('lughat')).toBe('classical');
    expect(normalizeDocumentKind('nahw')).toBe('classical');
  });

  it('returns undefined ("detect it") for anything that is not a strategy', () => {
    // meta.kind || meta.discipline || meta.category can hold "general", "book",
    // "tafsir"... Passing those straight through skipped detection and silently
    // chunked the item as prose.
    for (const v of ['general', 'book', 'tafsir', '', null, undefined, 42]) {
      expect(normalizeDocumentKind(v)).toBeUndefined();
    }
  });

  it('REGRESSION: an unrecognised kind falls back to detection, not to prose', () => {
    const hadithText =
      'حدثنا فلان قال حدثنا فلان عن رسول الله صلى الله عليه وسلم قال: قول أول.\n' +
      'حدثنا ثان قال حدثنا آخر عن النبي صلى الله عليه وسلم قال: قول ثان.';
    const chunks = chunkDocumentAdaptive(hadithText, { kind: normalizeDocumentKind('general') });
    expect(chunks.every((c) => c.meta?.kind === 'hadith')).toBe(true);
    expect(chunks).toHaveLength(2);
  });
});
