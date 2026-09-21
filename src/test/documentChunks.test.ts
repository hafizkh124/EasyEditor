// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  chunkDocumentText,
  chunkDocumentAdaptive,
  detectDocumentKind,
  CHUNK_SIZE,
  CHUNK_OVERLAP,
} from '../../shared/text/documentChunks';

describe('chunkDocumentText (SPEC-M5.9 FR-1.3)', () => {
  it('returns nothing for empty or whitespace-only text', () => {
    expect(chunkDocumentText('')).toEqual([]);
    expect(chunkDocumentText('   \n\t  ')).toEqual([]);
  });

  it('keeps a short document in a single chunk', () => {
    const chunks = chunkDocumentText('ایک مختصر جملہ۔');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].content).toBe('ایک مختصر جملہ۔');
  });

  it('numbers chunks consecutively from zero', () => {
    const chunks = chunkDocumentText('ا'.repeat(CHUNK_SIZE * 4));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it('breaks on an Urdu full stop rather than mid-word', () => {
    // A sentence boundary placed inside the overlap window of the first cut.
    const head = 'ا'.repeat(CHUNK_SIZE - 60);
    const text = `${head}یہ جملہ یہاں ختم ہوتا ہے۔${'ب'.repeat(CHUNK_SIZE)}`;
    const chunks = chunkDocumentText(text);
    expect(chunks[0].content.endsWith('۔')).toBe(true);
  });

  it('overlaps consecutive chunks so a straddling sentence survives whole', () => {
    const text = 'ا'.repeat(CHUNK_SIZE * 3);
    const chunks = chunkDocumentText(text);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].charStart).toBeLessThan(chunks[i - 1].charEnd);
    }
  });

  it('reports offsets that map back onto the trimmed source', () => {
    const text = `${'ا'.repeat(CHUNK_SIZE)}۔${'ب'.repeat(CHUNK_SIZE)}`;
    for (const chunk of chunkDocumentText(text)) {
      expect(text.slice(chunk.charStart, chunk.charEnd).trim()).toBe(chunk.content);
    }
  });

  it('always advances, so no input can spin forever', () => {
    // overlap >= chunkSize is the degenerate case: without the max() guard on
    // `start` this loops without end.
    const chunks = chunkDocumentText('ا'.repeat(500), 10, 50);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.length).toBeLessThan(600);
  });

  it('is deterministic — the same text always chunks identically', () => {
    const text = `${'سطر ایک۔ '.repeat(300)}`;
    expect(chunkDocumentText(text)).toEqual(chunkDocumentText(text));
  });
});

describe('the Deno mirror stays in sync (risk R2)', () => {
  // scripts/mirror-shared.mjs copies shared/ into supabase/functions/, because
  // an edge deploy bundles only that folder. The copy is manual, so a stale
  // mirror is exactly how the cloud and desktop chunkers drift apart — the
  // failure this file exists to prevent.
  const MIRRORED = ['text/documentChunks.ts', 'text/fileText.ts', 'text/chunk.ts', 'text/takhrij.ts'];

  it.each(MIRRORED)('%s matches its shared/ source', (relative) => {
    const source = readFileSync(`shared/${relative}`, 'utf8');
    const mirror = readFileSync(`supabase/functions/_shared/mirror/${relative}`, 'utf8');
    const body = mirror.split('\n').slice(2).join('\n'); // drop the AUTO-MIRRORED header
    expect(body).toBe(source);
  });
});

describe('chunk constants', () => {
  it('keeps the overlap smaller than the chunk', () => {
    expect(CHUNK_OVERLAP).toBeLessThan(CHUNK_SIZE);
  });
});

describe('detectDocumentKind', () => {
  it('detects hadith genre from transmission chains', () => {
    const text = 'حدثنا عبد الله بن يوسف قال أخبرنا مالك عن نافع عن ابن عمر أن رسول الله صلى الله عليه وسلم قال: بني الإسلام على خمس.';
    expect(detectDocumentKind(text)).toBe('hadith');
  });

  it('detects fiqh genre from classical headings', () => {
    const text = 'كتاب الصلاة\nباب مواقيت الصلاة\nالصلاة واجبة في أوقاتها المحددة.\nفصل في الأذان والإقامة';
    expect(detectDocumentKind(text)).toBe('fiqh');
  });

  it('defaults to prose when no specialized markers are present', () => {
    const text = 'یہ ایک معلوماتی مقالہ ہے جو مختلف موضوعات پر گفتگو کرتا ہے۔ اس میں عام بیانات شامل ہیں۔';
    expect(detectDocumentKind(text)).toBe('prose');
  });
});

describe('chunkDocumentAdaptive (ADR 0055)', () => {
  it('returns empty array for empty input', () => {
    expect(chunkDocumentAdaptive('')).toEqual([]);
    expect(chunkDocumentAdaptive('   \n  ')).toEqual([]);
  });

  it('keeps isnad and matn intact in hadith mode when within size limit', () => {
    const hadith1 = '1 - حدثنا الحميدي عبد الله بن الزبير قال حدثنا سفيان قال حدثنا يحيى بن سعيد الأنصاري قال أخبرني محمد بن إبراهيم التيمي أنه سمع علقمة بن وقاص الليثي يقول سمعت عمر بن الخطاب رضي الله عنه على المنبر قال سمعت رسول الله صلى الله عليه وسلم يقول: إنما الأعمال بالنيات، وإنما لكل امرئ ما نوى.';
    const hadith2 = '2 - حدثنا عبد الله بن يوسف قال أخبرنا مالك عن هشام بن عروة عن أبيه عن عائشة أم المؤمنين رضي الله عنها أن الحارث بن هشام رضي الله عنه سأل رسول الله صلى الله عليه وسلم فقال: يا رسول الله كيف يأتيك الوحي؟';
    const corpus = `${hadith1}\n\n${hadith2}`;

    const chunks = chunkDocumentAdaptive(corpus, { kind: 'hadith' });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].index).toBe(0);
    expect(chunks[1].index).toBe(1);
    expect(chunks[0].meta?.kind).toBe('hadith');
    expect(chunks[0].meta?.isnad).toBeDefined();
    expect(chunks[0].content).toContain('إنما الأعمال بالنيات');
    expect(chunks[1].content).toContain('كيف يأتيك الوحي');
  });

  it('segments fiqh along headings and builds breadcrumbs', () => {
    const fiqhText = [
      'كتاب الطهارة',
      'باب المياه',
      'الماء طهور لا ينجسه شيء إلا ما غلب على ريحه أو طعمه أو لونه.',
      'فصل في سؤر الحيوان',
      'سؤر الآدمي طاهر وسؤر ما يؤكل لحمه طاهر.'
    ].join('\n');

    const chunks = chunkDocumentAdaptive(fiqhText, { kind: 'fiqh' });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) {
      expect(c.meta?.kind).toBe('fiqh');
      expect(c.meta?.heading).toBeDefined();
    }
    const lastChunk = chunks[chunks.length - 1];
    expect(lastChunk.meta?.heading).toContain('كتاب الطهارة');
    expect(lastChunk.meta?.heading).toContain('فصل');
  });

  it('preserves accurate charStart and charEnd slice ranges', () => {
    const text = 'كتاب الصلاة\nباب الأذان\nالأذان سنة مؤكدة للصلوات الخمس.\nباب الإقامة\nالإقامة تقام عند الشروع في الصلاة.';
    const chunks = chunkDocumentAdaptive(text, { kind: 'fiqh' });
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      const sliced = text.slice(chunk.charStart, chunk.charEnd).trim();
      expect(sliced).toBe(chunk.content);
    }
  });

  it('falls back to sentence-aware prose chunking when kind is prose', () => {
    const text = 'ایک لمبا مضمون جو اردو میں تحریر کیا گیا ہے۔ یہ جملہ اول ہے۔ یہ جملہ دوم ہے۔';
    const chunks = chunkDocumentAdaptive(text, { kind: 'prose' });
    expect(chunks.length).toBe(1);
    expect(chunks[0].meta?.kind).toBe('prose');
    expect(chunks[0].content).toBe(text);
  });
});

