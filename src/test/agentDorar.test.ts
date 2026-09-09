// @vitest-environment node
// electron/agent/adapters/dorar.ts (ADR-0040) — الدرر السنية grading.
// Dorar's own public endpoint returns rendered HTML in a JSON envelope; the
// parse is ported from islamic-api-fetch's fetchDorar. The grading is reported
// EXACTLY as Dorar states it — never our own verdict.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseDorarHtml, gradeHadith } from '../../electron/agent/adapters/dorar';

const RESULT_HTML = `
  <div class="hadith">1 -  إنما الأعمال بالنيات وإنما لكل امرئ ما نوى </div>
  <div class="hadith-info">
    <span class="info-subtitle">الراوي:</span> عمر بن الخطاب
    <span class="info-subtitle">المحدث:</span> البخاري
    <span class="info-subtitle">المصدر:</span> صحيح البخاري
    <span class="info-subtitle">الصفحة أو الرقم:</span> 1
    <span class="info-subtitle">خلاصة حكم المحدث:</span> صحيح
  </div>
  <div class="hadith">2 -  من حديث آخر ضعيف الإسناد جدا في بابه </div>
  <div class="hadith-info">
    <span class="info-subtitle">الراوي:</span> أنس بن مالك
    <span class="info-subtitle">المصدر:</span> سنن أبي داود
    <span class="info-subtitle">الرقم:</span> 4200
    <span class="info-subtitle">خلاصة حكم المحدث:</span> ضعيف
  </div>`;

function mockDorar(json: unknown, status = 200) {
  const body = JSON.stringify(json);
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(body, { status }));
}

beforeEach(() => vi.restoreAllMocks());

describe('parseDorarHtml', () => {
  it('reads matn + الراوي / المصدر / الرقم / الحكم from each block', () => {
    const g = parseDorarHtml(RESULT_HTML, 10);
    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({ rawi: 'عمر بن الخطاب', mohdith: 'البخاري', source: 'صحيح البخاري', number: '1', grade: 'صحيح' });
    expect(g[0].matn).toContain('إنما الأعمال بالنيات');
    expect(g[1].grade).toBe('ضعيف');
  });

  it('honours the limit', () => {
    expect(parseDorarHtml(RESULT_HTML, 1)).toHaveLength(1);
  });

  it('skips a block with no real matn', () => {
    expect(parseDorarHtml('<div class="hadith">x</div><div class="hadith-info">y</div>', 10)).toHaveLength(0);
  });
});

describe('gradeHadith', () => {
  it('turns Dorar results into citable chunks carrying the verdict verbatim', async () => {
    mockDorar({ ahadith: { result: RESULT_HTML } });
    const r = await gradeHadith({ text: 'إنما الأعمال بالنيات' });
    expect(r.error).toBeUndefined();
    expect(r.chunks).toHaveLength(2);
    expect(r.chunks[0].id).toMatch(/^dorar:[0-9a-f]{12}$/);
    expect(r.chunks[0].reference).toContain('الحكم: صحيح');
    expect(r.chunks[0].reference).toContain('(الدرر السنية)');
    expect(r.chunks[0].grade).toBe('صحيح');
  });

  it('clamps limit to 1..15', async () => {
    mockDorar({ ahadith: { result: RESULT_HTML } });
    const r = await gradeHadith({ text: 'نية', limit: 99 });
    expect(r.chunks.length).toBeLessThanOrEqual(15);
    const r2 = await gradeHadith({ text: 'نية', limit: 0 });
    expect(r2.chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('an empty query is an error, not a request', async () => {
    const f = mockDorar({});
    const r = await gradeHadith({ text: '   ' });
    expect(r.error).toMatch(/needs the hadith text/);
    expect(f).not.toHaveBeenCalled();
  });

  it('an HTTP error is returned, not thrown', async () => {
    mockDorar({}, 503);
    const r = await gradeHadith({ text: 'نية' });
    expect(r.chunks).toEqual([]);
    expect(r.error).toContain('503');
  });

  it('a network throw is returned, not thrown', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNRESET'));
    const r = await gradeHadith({ text: 'نية' });
    expect(r.error).toMatch(/lookup failed/);
  });

  it('no narrations → a note, not an error', async () => {
    mockDorar({ ahadith: { result: '' } });
    const r = await gradeHadith({ text: 'zzz' });
    expect(r.error).toBeUndefined();
    expect(r.note).toBeTruthy();
  });
});
