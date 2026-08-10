import React, { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { getBookPdfInfo, readBookPdf } from "@/lib/shamela/shamelaPdf";

/**
 * SPEC-M6 Phase 10 — Book covers.
 *
 * Renders a book's cover in two ways, PDF-first:
 * 1. When the book has an on-disk PDF, render its cover page (page 1, or the
 *    page `pdf_links.cover` names) via pdfjs and show the bitmap.
 * 2. Otherwise, generate a deterministic placeholder: a colour derived from
 *    the book id, the title in a large Arabic style, and the author below.
 *
 * The two-layer approach means a cover never appears blank while the PDF is
 * loading, and books without PDFs still get a readable, attractive card.
 */

const PALETTES = [
  { from: "#0f766e", to: "#134e4a" },
  { from: "#7c3aed", to: "#4c1d95" },
  { from: "#b45309", to: "#78350f" },
  { from: "#be123c", to: "#881337" },
  { from: "#1d4ed8", to: "#1e3a8a" },
  { from: "#15803d", to: "#14532d" },
  { from: "#a21caf", to: "#701a75" },
  { from: "#b91c1c", to: "#7f1d1d" },
];

function paletteFor(bookId: string | number): { from: string; to: string } {
  const n = Math.abs(Number(bookId) || 0);
  return PALETTES[n % PALETTES.length];
}

export interface BookCoverProps {
  bookId: string | number;
  title: string;
  author?: string | null;
  /** Skip the PDF-first attempt and only render the generated cover. */
  generatedOnly?: boolean;
  className?: string;
}

export const BookCover: React.FC<BookCoverProps> = ({ bookId, title, author, generatedOnly, className }) => {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const palette = paletteFor(bookId);

  // Load the PDF cover page once.
  useEffect(() => {
    if (generatedOnly) return;
    let cancelled = false;

    const load = async () => {
      try {
        const info = await getBookPdfInfo(bookId);
        if (!info.available || info.files.length === 0) return;
        const bytes = await readBookPdf(bookId, info.files[0].fileIndex);
        if (!bytes || cancelled) return;
        // Rendered by pdfjs in its own worker; we only need page 1 (or the
        // page `pdf_links.cover` names) as a still image for the cover.
        const { renderPdfCoverPage } = await import("@/lib/shamela/pdfRender");
        const dataUrl = await renderPdfCoverPage(bytes, info.coverPage ?? 1, 220);
        if (!cancelled) setPdfUrl(dataUrl);
      } catch {
        // Fall through to the generated cover.
      }
    };
    void load();

    return () => {
      cancelled = true;
    };
  }, [bookId, generatedOnly]);

  return (
    <div
      className={cn("relative aspect-[3/4] w-full overflow-hidden rounded-md border border-border/50 bg-muted", className)}
      style={{ background: `linear-gradient(150deg, ${palette.from}, ${palette.to})` }}
    >
      {pdfUrl ? (
        <img
          src={pdfUrl}
          alt={title}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-2 text-center">
          <BookOpen className="h-4 w-4 text-white/60" />
          <p className="line-clamp-5 text-xs font-medium leading-relaxed text-white" dir="rtl">
            {title}
          </p>
          {author && (
            <p className="line-clamp-1 text-xs text-white/70" dir="rtl">
              {author}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
