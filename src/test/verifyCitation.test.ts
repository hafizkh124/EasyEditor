// @vitest-environment node
// shared/citation/verifyCitation.ts + the ledger's verification/attribution gates.
import { describe, it, expect } from 'vitest';
import { verifyCitation, attributedGrade, foldDigits, UNVERIFIED_DISCLAIMER_AR } from '../../shared/citation/verifyCitation';
import { RetrievalLedger } from '../../shared/agent/grounding';
import { AGENT_TOOLS, getTool } from '../../shared/agent/toolSchemas';
import { toolsForMode } from '../../shared/agent/toolSchemas';

const bukhari = {
  reference: 'صحيح البخاري، كتاب الإيمان، رقم 1، ج1 ص 5',
  locus: { book: 'صحيح البخاري', volume: 1, page: '5', number: '1', gradedBy: 'الألباني', grade: 'صحيح' },
  grade: 'صحيح',
};

describe('verifyCitation', () => {
  it('verified when every claimed detail is in the source', () => {
    const r = verifyCitation({ book: 'صحيح البخاري', page: 5, number: '1', gradedBy: 'الألباني' }, bukhari);
    expect(r.status).toBe('verified');
    expect(r.mismatched).toEqual([]);
  });

  it('a fabricated page is not verified; the Arabic disclaimer is returned', () => {
    const r = verifyCitation({ page: 999 }, bukhari);
    expect(r.status).toBe('unverified');
    expect(r.text).toBe(UNVERIFIED_DISCLAIMER_AR);
  });

  it('partial when some details match and others do not', () => {
    const r = verifyCitation({ book: 'صحيح البخاري', page: 999 }, bukhari);
    expect(r.status).toBe('partial');
    expect(r.matched).toEqual(['book']);
    expect(r.mismatched).toEqual(['page']);
  });

  it('folds Arabic-Indic and Persian digits, and ignores tashkeel / hamza variants', () => {
    expect(foldDigits('٥ ۱۲')).toBe('5 12');
    expect(verifyCitation({ page: '٥', number: '١' }, bukhari).status).toBe('verified');
    expect(verifyCitation({ book: 'صَحِيحُ البُخَارِيّ' }, bukhari).status).toBe('verified');
  });

  it('numbers match as whole numbers: 12 is not inside 112', () => {
    const src = { reference: 'سنن أبي داود، رقم 112' };
    expect(verifyCitation({ number: 12 }, src).status).toBe('unverified');
    expect(verifyCitation({ number: 112 }, src).status).toBe('verified');
  });

  it('falls back to the reference text when the source has no structured locus', () => {
    expect(verifyCitation({ number: 112 }, { reference: 'سنن أبي داود، رقم 112' }).status).toBe('verified');
  });

  it('no source or nothing claimed is unverified', () => {
    expect(verifyCitation({ page: 1 }, undefined).status).toBe('unverified');
    expect(verifyCitation({}, bukhari).status).toBe('unverified');
  });
});

describe('attributedGrade', () => {
  it('needs a named scholar', () => {
    expect(attributedGrade({ grade: 'صحيح', gradedBy: 'الألباني' })).toBe('صحيح');
    expect(attributedGrade({ grade: 'صحيح' })).toBeNull();
    expect(attributedGrade({ grade: 'صحيح', gradedBy: '  ' })).toBeNull();
  });
});

describe('RetrievalLedger gates', () => {
  it('footnotes omit a grade the source did not attribute to a scholar', () => {
    const l = new RetrievalLedger();
    l.add([{
      id: 'dorar:x', grade: 'ضعيف', locus: { book: 'سنن الترمذي', number: '5', grade: 'ضعيف' },
      reference: 'سنن الترمذي، رقم 5 — الراوي: أبو هريرة — الحكم: ضعيف (الدرر السنية)',
    }]);
    const text = l.footnoteText(l.resolveOrThrow('dorar:x'));
    expect(text).not.toContain('ضعيف');
    expect(text).toContain('سنن الترمذي');
    expect(text).toContain('الدرر السنية');
  });

  it('keeps the grade when a scholar is named, and leaves chunks without a locus untouched', () => {
    const l = new RetrievalLedger();
    const ref = 'سنن الترمذي، رقم 5 — المحدث: الألباني — الحكم: ضعيف (الدرر السنية)';
    l.add([
      { id: 'a', grade: 'ضعيف', locus: { gradedBy: 'الألباني' }, reference: ref },
      { id: 'b', grade: 'ضعيف', reference: ref },
    ]);
    expect(l.footnoteText(l.resolveOrThrow('a'))).toContain('ضعيف');
    expect(l.footnoteText(l.resolveOrThrow('b'))).toContain('ضعيف');
  });

  it('a source flagged partial/unverified cannot be footnoted until it verifies', () => {
    const l = new RetrievalLedger();
    l.add([{ id: 's', reference: 'كتاب، ص 3' }]);
    l.markVerification('s', 'unverified');
    expect(() => l.resolveOrThrow('s')).toThrow(UNVERIFIED_DISCLAIMER_AR);
    l.markVerification('s', 'verified');
    expect(l.resolveOrThrow('s').id).toBe('s');
  });
});

describe('verify_citation tool', () => {
  it('is registered, read-only, and available in Ask mode', () => {
    const t = getTool('verify_citation');
    expect(t?.effect).toBe('read');
    expect(t?.required).toEqual(['source_id']);
    expect(AGENT_TOOLS.some((x) => x.name === 'verify_citation')).toBe(true);
    expect(toolsForMode('ask').some((x) => x.name === 'verify_citation')).toBe(true);
  });
});
