import React, { useMemo, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { wordDiff, type DiffToken } from "@/lib/text/wordDiff";

/**
 * Plan §5.5 — the matn-comparison artifact. Each variant is diffed against the
 * base (first) variant: insertions green, deletions red-strikethrough. A
 * harakat toggle folds tashkīl so only real wording differences show.
 */

export interface MatnVariant {
  label: string;
  text: string;
  reference?: string;
}
export interface MatnDiffPayload {
  variants: MatnVariant[];
  /** Index of the base variant (default 0). */
  baseIndex?: number;
}

const OP_CLASS: Record<DiffToken["op"], string> = {
  equal: "",
  insert: "bg-success/15 text-success rounded-sm px-0.5",
  delete: "bg-destructive/10 text-destructive line-through rounded-sm px-0.5",
};

export const MatnDiff: React.FC<{ payload: MatnDiffPayload }> = ({ payload }) => {
  const { t } = useLanguage();
  const [ignoreHarakat, setIgnoreHarakat] = useState(true);
  const base = payload.variants[payload.baseIndex ?? 0];
  const others = payload.variants.filter((_, i) => i !== (payload.baseIndex ?? 0));

  const diffs = useMemo(
    () => others.map((v) => ({ variant: v, tokens: wordDiff(base?.text ?? "", v.text, { ignoreHarakat }) })),
    [others, base, ignoreHarakat],
  );

  if (!base || payload.variants.length < 2) {
    return <p className="p-3 text-xs text-muted-foreground">{t("jkhssn.matn_need_two", "موازنے کے لیے کم از کم دو روایات درکار ہیں۔")}</p>;
  }

  return (
    <div className="space-y-3" dir="rtl">
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground" dir="auto">
        <input type="checkbox" className="accent-primary" checked={ignoreHarakat} onChange={(e) => setIgnoreHarakat(e.target.checked)} />
        {t("jkhssn.ignore_harakat", "حرکات نظر انداز کریں")}
      </label>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded border border-border p-2">
          <p className="mb-1 text-xs font-semibold text-muted-foreground">{base.label} <span className="font-normal">({t("jkhssn.matn_base", "بنیاد")})</span></p>
          <p className="text-sm leading-relaxed" style={{ unicodeBidi: "plaintext" }}>{base.text}</p>
          {base.reference && <p className="mt-1 text-[0.7rem] text-muted-foreground">{base.reference}</p>}
        </div>
        {diffs.map(({ variant, tokens }, i) => (
          <div key={i} className="rounded border border-border p-2">
            <p className="mb-1 text-xs font-semibold text-muted-foreground">{variant.label}</p>
            <p className="text-sm leading-relaxed" style={{ unicodeBidi: "plaintext" }}>
              {tokens.map((tk, j) => (
                <span key={j} className={OP_CLASS[tk.op]}>{tk.text}{" "}</span>
              ))}
            </p>
            {variant.reference && <p className="mt-1 text-[0.7rem] text-muted-foreground">{variant.reference}</p>}
          </div>
        ))}
      </div>
    </div>
  );
};
