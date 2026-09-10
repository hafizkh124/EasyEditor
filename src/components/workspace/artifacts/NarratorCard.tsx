import React from "react";
import { ExternalLink, User } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ResolvedNarrator } from "@/lib/jkhssn/resolveNames";
import type { NarratorCardPayload } from "../../../../shared/jkhssn/types";

/**
 * Plan §5.5 — the narrator card. Two shapes:
 *  - `variant="popover"` inside a sanad-tree node: a compact name + provenance.
 *  - `variant="stage"` as a standalone artifact: the full merged card
 *    (جوامع الكلم structured fields + the resolved name).
 *
 * Structured fields (ṭabaqa, ranks, dates) carry a "💻 جوامع الكلم" provenance
 * chip; the resolved name carries the corpus name.
 */

const PROV_LOCAL = "💻 جوامع الكلم";

const Row: React.FC<{ label: string; value: string | null | undefined }> = ({ label, value }) =>
  value ? (
    <div className="flex gap-2 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span dir="rtl" style={{ unicodeBidi: "plaintext" }}>{value}</span>
    </div>
  ) : null;

export const NarratorCard: React.FC<{
  variant: "popover" | "stage";
  payload?: NarratorCardPayload | null;
  resolved?: ResolvedNarrator | null;
}> = ({ variant, payload, resolved }) => {
  const { t } = useLanguage();

  const displayName =
    resolved?.shuhraAr ||
    resolved?.nameAr ||
    payload?.nameShapes?.[0] ||
    t("jkhssn.name_unavailable", "نام دستیاب نہیں");

  if (variant === "popover") {
    return (
      <div className="p-3">
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="font-medium" dir="rtl" style={{ unicodeBidi: "plaintext" }}>{displayName}</span>
        </div>
        {(payload?.martabaIbnHajar || payload?.tabaqa) && (
          <div className="mt-2 space-y-0.5">
            <Row label={t("jkhssn.rank_ibn_hajar", "ابن حجر")} value={payload?.martabaIbnHajar} />
            <Row label={t("jkhssn.tabaqa", "طبقہ")} value={payload?.tabaqa} />
          </div>
        )}
        <div className="mt-2 flex items-center justify-between text-[0.7rem] text-muted-foreground">
          <span title={t("jkhssn.provenance_local", "from جوامع الكلم")}>{PROV_LOCAL}</span>
          {resolved?.sourceUrl && (
            <a href={resolved.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              <ExternalLink className="h-3 w-3" /> {t("jkhssn.open_bio", "سوانح")}
            </a>
          )}
        </div>
      </div>
    );
  }

  // stage
  return (
    <div className="space-y-3 p-1">
      <div className="flex items-baseline gap-2">
        <h3 className="text-base font-semibold" dir="rtl" style={{ unicodeBidi: "plaintext" }}>{displayName}</h3>
        {payload?.nameShapes && payload.nameShapes.length > 1 && (
          <span className="text-xs text-muted-foreground" dir="rtl" style={{ unicodeBidi: "plaintext" }}>
            {payload.nameShapes.slice(1, 3).join(" · ")}
          </span>
        )}
      </div>

      <div className="grid gap-1 sm:grid-cols-2">
        <Row label={t("jkhssn.tabaqa", "طبقہ")} value={payload?.tabaqa} />
        <Row label={t("jkhssn.rank_ibn_hajar", "مرتبہ (ابن حجر)")} value={payload?.martabaIbnHajar} />
        <Row label={t("jkhssn.rank_zahabi", "مرتبہ (ذہبی)")} value={payload?.martabaZahabi} />
        <Row label={t("jkhssn.birth_year", "سنِ ولادت")} value={payload?.birthYear} />
        <Row label={t("jkhssn.death_year", "سنِ وفات")} value={payload?.deathYear} />
        <Row label={t("jkhssn.birth_city", "مقامِ ولادت")} value={payload?.birthCity} />
        <Row label={t("jkhssn.death_city", "مقامِ وفات")} value={payload?.deathCity} />
        <Row label={t("jkhssn.living_city", "سکونت")} value={payload?.livingCity} />
        <Row label={t("jkhssn.mazhab", "مذہب")} value={payload?.mazhab} />
        {payload?.hadithsCount != null && (
          <Row label={t("jkhssn.hadith_count", "مرویات")} value={String(payload.hadithsCount)} />
        )}
      </div>

      {payload?.jarh && payload.jarh.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">{t("jkhssn.jarh_tadil", "جرح و تعدیل")}</p>
          <ul className="space-y-1">
            {payload.jarh.slice(0, 12).map((j, i) => (
              <li key={i} className="text-xs" dir="rtl" style={{ unicodeBidi: "plaintext" }}>
                <span className="font-medium">{j.verdict}</span>
                {j.criticSay ? <span className="text-muted-foreground"> — {j.criticSay}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2 text-[0.7rem] text-muted-foreground">
        <span>{PROV_LOCAL}</span>
        {payload?.teachers != null && <span>· {t("jkhssn.teachers_n", "{n} اساتذہ").replace("{n}", String(payload.teachers.length))}</span>}
        {payload?.students != null && <span>· {t("jkhssn.students_n", "{n} تلامذہ").replace("{n}", String(payload.students.length))}</span>}
        {resolved?.sourceUrl && (
          <a href={resolved.sourceUrl} target="_blank" rel="noopener noreferrer" className="ms-auto inline-flex items-center gap-1 text-primary hover:underline">
            <ExternalLink className="h-3 w-3" /> {t("jkhssn.open_bio", "سوانح")}
          </a>
        )}
      </div>
    </div>
  );
};
