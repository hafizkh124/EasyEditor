import React from "react";

/**
 * M12 Phase F — the WhatsApp-shareable result card: a 1200×1200 SQUARE SVG,
 * rasterised to PNG by `svgElementToPng` (renderer-only — the main process
 * cannot generate images at all, and `.png` is not in the `DocExt` write
 * allowlist; this never touches the file bridge). Hand-laid-out as pure
 * `<rect>`/`<text>` — no `<table>` (an `<img>`-rasterised SVG never renders
 * HTML) and no `<foreignObject>` (unreliable across engines for that path).
 *
 * Colours are hard-coded, not CSS custom properties: the serialised SVG is
 * loaded as a STANDALONE document by `svgElementToPng` (via `new Image()`),
 * which has no access to the host page's `:root` variables — a `var(--x, #fff)`
 * would silently render as its fallback only. A branded share card should
 * look the same regardless of the app's current light/dark theme anyway.
 */

export interface ShareCardTable {
  columns: string[];
  rows: string[][];
  caption?: string;
}

export interface ShareCardProps {
  title: string;
  table?: ShareCardTable;
  /** Shown instead of a table when there isn't one (a plain-text artifact). */
  text?: string;
  footer: string;
  forwardRef?: React.Ref<SVGSVGElement>;
}

const SIZE = 1200;
const PAD = 56;
const BORDER_GAP = 24;
const TEAL = "#0f766e";
const GOLD = "#b45309";
const INK = "#1c1917";
const MUTED = "#57534e";
const CARD_BG = "#fffdf8";
const ROW_ALT = "#f5efe0";
const ROW_LINE = "#e4dcc8";

const MAX_ROWS = 8;
const MAX_CELL_CHARS = 16;
const MAX_TEXT_LINES = 10;
const MAX_LINE_CHARS = 38;

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** A crude but script-agnostic word-wrap — splits on whitespace, packs greedily. */
function wrapLines(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[lines.length - 1] = `${truncate(lines[lines.length - 1], maxCharsPerLine - 1)}…`;
  }
  return lines;
}

const textStyle: React.CSSProperties = { direction: "rtl", unicodeBidi: "plaintext" };

export const ShareCard: React.FC<ShareCardProps> = ({ title, table, text, footer, forwardRef }) => {
  const innerX = PAD + BORDER_GAP;
  const innerW = SIZE - innerX * 2;
  const headerY = PAD + 96;
  const ruleY = headerY + 34;
  const contentTop = ruleY + 50;
  const footerBlockH = table?.caption ? 104 : 70;
  const contentBottom = SIZE - PAD - footerBlockH;
  const availH = Math.max(contentBottom - contentTop, 80);

  const cols = table?.columns ?? [];
  const allRows = table?.rows ?? [];
  const overflow = allRows.length > MAX_ROWS;
  const rows = overflow ? allRows.slice(0, MAX_ROWS - 1) : allRows;
  const rowCount = rows.length + (overflow ? 1 : 0);
  const rowH = cols.length ? Math.min(84, Math.max(46, availH / Math.max(rowCount + 1, 1))) : 0;
  const colW = cols.length ? innerW / cols.length : 0;
  // RTL: the first column reads rightmost.
  const colX = (i: number) => innerX + innerW - (i + 1) * colW;

  const textLines = !cols.length && text ? wrapLines(text, MAX_LINE_CHARS, MAX_TEXT_LINES) : [];

  return (
    <svg
      ref={forwardRef}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
      height={SIZE}
      role="img"
      aria-label={title}
      style={{ fontFamily: '"Noto Nastaliq Urdu", serif' }}
    >
      <rect width={SIZE} height={SIZE} fill={CARD_BG} />
      <rect x={PAD / 2} y={PAD / 2} width={SIZE - PAD} height={SIZE - PAD} rx={20} fill="none" stroke={TEAL} strokeWidth={6} />
      <rect x={PAD} y={PAD} width={SIZE - PAD * 2} height={SIZE - PAD * 2} rx={12} fill="none" stroke={GOLD} strokeWidth={2} />
      {([[PAD / 2, PAD / 2], [SIZE - PAD / 2, PAD / 2], [PAD / 2, SIZE - PAD / 2], [SIZE - PAD / 2, SIZE - PAD / 2]] as const).map(([cx, cy], i) => (
        <rect key={i} x={cx - 11} y={cy - 11} width={22} height={22} fill={GOLD} transform={`rotate(45 ${cx} ${cy})`} />
      ))}

      <text x={SIZE / 2} y={headerY} textAnchor="middle" fontSize={46} fontWeight={700} fill={TEAL} style={textStyle}>
        {truncate(title, 30)}
      </text>
      <line x1={innerX} y1={ruleY} x2={innerX + innerW} y2={ruleY} stroke={GOLD} strokeWidth={2} />

      {cols.length > 0 && (
        <g>
          <rect x={innerX} y={contentTop} width={innerW} height={rowH} fill={TEAL} />
          {cols.map((c, i) => (
            <text key={i} x={colX(i) + colW / 2} y={contentTop + rowH / 2 + 9} textAnchor="middle" fontSize={24} fontWeight={700} fill="#ffffff" style={textStyle}>
              {truncate(c, MAX_CELL_CHARS)}
            </text>
          ))}
          {rows.map((r, ri) => {
            const y = contentTop + rowH * (ri + 1);
            return (
              <g key={ri}>
                <rect x={innerX} y={y} width={innerW} height={rowH} fill={ri % 2 === 0 ? "#ffffff" : ROW_ALT} stroke={ROW_LINE} />
                {cols.map((_c, ci) => (
                  <text key={ci} x={colX(ci) + colW / 2} y={y + rowH / 2 + 8} textAnchor="middle" fontSize={21} fill={INK} style={textStyle}>
                    {truncate(r[ci] ?? "", MAX_CELL_CHARS)}
                  </text>
                ))}
              </g>
            );
          })}
          {overflow && (
            <g>
              <rect x={innerX} y={contentTop + rowH * rowCount} width={innerW} height={rowH} fill={ROW_ALT} stroke={ROW_LINE} />
              <text
                x={innerX + innerW / 2}
                y={contentTop + rowH * rowCount + rowH / 2 + 8}
                textAnchor="middle"
                fontSize={20}
                fill={MUTED}
                style={textStyle}
              >
                {`+${allRows.length - rows.length} مزید…`}
              </text>
            </g>
          )}
        </g>
      )}

      {!cols.length && textLines.length > 0 && (
        <g>
          {textLines.map((line, i) => (
            <text
              key={i}
              x={SIZE / 2}
              y={contentTop + 40 + i * 44}
              textAnchor="middle"
              fontSize={28}
              fill={INK}
              style={textStyle}
            >
              {line}
            </text>
          ))}
        </g>
      )}

      {table?.caption && (
        <text x={SIZE / 2} y={SIZE - PAD - footerBlockH + 44} textAnchor="middle" fontSize={22} fontWeight={700} fill={GOLD} style={textStyle}>
          {truncate(table.caption, 40)}
        </text>
      )}

      <line x1={innerX} y1={SIZE - PAD - footerBlockH + 14} x2={innerX + innerW} y2={SIZE - PAD - footerBlockH + 14} stroke={ROW_LINE} strokeWidth={1} />
      <text x={SIZE / 2} y={SIZE - PAD - 28} textAnchor="middle" fontSize={19} fill={MUTED} style={textStyle}>
        {footer}
      </text>
    </svg>
  );
};
