// M13 Phase 4 (ADR-0060) — URL provenance for extract_web_page.
import { describe, it, expect } from 'vitest';
import { normaliseUrl, extractUrls, isPrivateHost, isScholarlyHost, UrlProvenance } from '../../shared/agent/webUrls';

describe('normaliseUrl / extractUrls', () => {
  it('drops fragments, trailing punctuation and a bare trailing slash; rejects non-http and credentials', () => {
    expect(normaliseUrl('https://IslamQA.info/ur/answers/12#top')).toBe('https://islamqa.info/ur/answers/12');
    expect(normaliseUrl('https://dorar.net/')).toBe('https://dorar.net');
    expect(normaliseUrl('https://x.org/a/،')).toBe('https://x.org/a');
    expect(normaliseUrl('javascript:alert(1)')).toBeNull();
    expect(normaliseUrl('file:///C:/x.docx')).toBeNull();
    expect(normaliseUrl('https://user:pw@x.org/')).toBeNull();
  });
  it('finds every URL in Urdu prose', () => {
    expect(extractUrls('یہ دیکھیں https://islamqa.info/ur/answers/1 اور http://binbaz.org.sa/fatwas/2.')).toEqual([
      'https://islamqa.info/ur/answers/1',
      'http://binbaz.org.sa/fatwas/2',
    ]);
  });
});

describe('isPrivateHost / isScholarlyHost', () => {
  it('blocks local and private-network addresses', () => {
    for (const h of ['localhost', '127.0.0.1', '10.0.0.5', '192.168.1.1', '172.20.0.1', '169.254.1.1', 'router.local', '::1']) {
      expect(isPrivateHost(h)).toBe(true);
    }
    expect(isPrivateHost('islamqa.info')).toBe(false);
    expect(isPrivateHost('fcbarcelona.com')).toBe(false);
  });
  it('recognises scholarly hosts including subdomains', () => {
    expect(isScholarlyHost('https://www.islamweb.net/ar/fatwa/1')).toBe(true);
    expect(isScholarlyHost('https://ar.islamqa.info/x')).toBe(true);
    expect(isScholarlyHost('https://random-blog.com/x')).toBe(false);
    expect(isScholarlyHost('https://islamqa.info.evil.com/x')).toBe(false);
  });
});

describe('UrlProvenance', () => {
  it('allows only URLs the scholar gave or a search returned', () => {
    const p = new UrlProvenance('please read https://islamqa.info/ur/answers/12');
    expect(p.check('https://islamqa.info/ur/answers/12#x')).toBeNull();
    expect(p.check('https://evil.example/steal')).toMatch(/did not come from the scholar/);
    p.addFrom('{"answer":"see https://dorar.net/hadith/1"}');
    expect(p.check('https://dorar.net/hadith/1')).toBeNull();
    expect(p.check('http://127.0.0.1:8080/admin')).toMatch(/private-network/);
  });
});
