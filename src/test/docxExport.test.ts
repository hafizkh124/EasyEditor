import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { htmlToDocxBlob } from "@/lib/editor/docxExport";

/**
 * M10 Phase 2.6 — the real OOXML `.docx` exporter. Unzips the produced Blob
 * and asserts on the ACTUAL word/document.xml the docx package emits (shapes
 * confirmed by hand against a throwaway file before writing these — see the
 * commit message), not a guessed schema. This is the only way to prove the
 * converter works rather than merely "didn't throw".
 */
// jsdom's Blob polyfill has no `.arrayBuffer()`/`.text()` (confirmed: its
// prototype carries only constructor/slice/size/type) and `new
// Response(blob)` mis-stringifies it in this environment ("[object Blob]",
// 13 bytes) rather than throwing — so FileReader, which jsdom DOES implement
// correctly, is the only reliable way to read a Blob's bytes back out here.
// A real browser has all three; this is a test-environment-only workaround.
function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

async function documentXmlOf(blob: Blob): Promise<string> {
  const buf = await blobToArrayBuffer(blob);
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file("word/document.xml");
  expect(file, "word/document.xml missing — not a valid docx").toBeTruthy();
  return file!.async("string");
}

describe("htmlToDocxBlob", () => {
  it("never returns null for ordinary HTML", async () => {
    const blob = await htmlToDocxBlob("<p>Hello world</p>", "Test");
    expect(blob).not.toBeNull();
    expect(blob!.size).toBeGreaterThan(0);
  });

  it("carries the paragraph text through", async () => {
    const xml = await documentXmlOf((await htmlToDocxBlob("<p>Hello world</p>", "T"))!);
    expect(xml).toContain("Hello world");
  });

  it("maps h1/h2/h3 to real Word heading styles", async () => {
    const xml = await documentXmlOf((await htmlToDocxBlob("<h1>Title</h1><h2>Subtitle</h2><h3>Section</h3>", "T"))!);
    expect(xml).toContain('<w:pStyle w:val="Heading1"/>');
    expect(xml).toContain('<w:pStyle w:val="Heading2"/>');
    expect(xml).toContain('<w:pStyle w:val="Heading3"/>');
  });

  it("carries bold and italic marks as real run properties", async () => {
    const xml = await documentXmlOf((await htmlToDocxBlob("<p><strong>bold text</strong> and <em>italic text</em></p>", "T"))!);
    expect(xml).toMatch(/<w:rPr><w:b\/>.*<\/w:rPr><w:t[^>]*>bold text/);
    expect(xml).toMatch(/<w:rPr><w:i\/>.*<\/w:rPr><w:t[^>]*>italic text/);
  });

  it("marks Urdu/Arabic paragraphs bidi/rtl, and Latin ones explicitly not", async () => {
    const xml = await documentXmlOf((await htmlToDocxBlob("<p>یہ اردو کا فقرہ ہے جو دائیں سے بائیں لکھا جاتا ہے۔</p><p>This is a plain English sentence.</p>", "T"))!);
    // The Urdu paragraph: real bidi paragraph + rtl run properties.
    expect(xml).toContain("<w:bidi/>");
    expect(xml).toMatch(/<w:rPr><w:rtl\/><\/w:rPr><w:t[^>]*>یہ اردو/);
    // The English paragraph: docx emits an explicit `w:val="false"` (not a
    // bare, absent tag) when a boolean prop is explicitly false — still the
    // correct, opposite value, not merely "not asserted".
    expect(xml).toMatch(/<w:bidi w:val="false"\/>/);
    expect(xml).toMatch(/<w:rtl w:val="false"\/>.*This is a plain English sentence\./);
  });

  it("renders a table with its cell text intact", async () => {
    const html = "<table><tr><th>Name</th><th>Age</th></tr><tr><td>Zayd</td><td>30</td></tr></table>";
    const xml = await documentXmlOf((await htmlToDocxBlob(html, "T"))!);
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("Name");
    expect(xml).toContain("Zayd");
  });

  it("renders list items with a visible bullet/number prefix", async () => {
    const html = "<ul><li>First</li><li>Second</li></ul><ol><li>One</li></ol>";
    const xml = await documentXmlOf((await htmlToDocxBlob(html, "T"))!);
    expect(xml).toContain("•");
    expect(xml).toContain("First");
    expect(xml).toContain("1.");
    expect(xml).toContain("One");
  });

  it("maps a font-nastaliq class to the real Noto Nastaliq Urdu font name", async () => {
    const xml = await documentXmlOf((await htmlToDocxBlob('<p><span class="font-nastaliq">نستعلیق</span></p>', "T"))!);
    expect(xml).toContain("Noto Nastaliq Urdu");
  });

  it("respects an explicit text-align style over the RTL default", async () => {
    const xml = await documentXmlOf((await htmlToDocxBlob('<p style="text-align: center;">یہ درمیان میں ہے</p>', "T"))!);
    expect(xml).toContain('<w:jc w:val="center"/>');
  });

  it("never crashes on unrecognised tags — falls through to a plain paragraph", async () => {
    const blob = await htmlToDocxBlob("<section><article>Odd nesting</article></section>", "T");
    expect(blob).not.toBeNull();
    const xml = await documentXmlOf(blob!);
    expect(xml).toContain("Odd nesting");
  });

  it("produces a valid (non-null) doc even for empty input", async () => {
    const blob = await htmlToDocxBlob("", "T");
    expect(blob).not.toBeNull();
  });
});
