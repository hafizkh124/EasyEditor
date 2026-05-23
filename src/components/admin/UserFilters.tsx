import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import type { UserFilters as FiltersType } from "./types";

interface UserFiltersProps {
  filters: FiltersType;
  onChange: (update: Partial<FiltersType>) => void;
}

type StatusFilter = FiltersType["status"];

const PROFESSIONS = ["scholar", "teacher", "student", "researcher", "imam", "mufti", "other"];

const UserFiltersComponent = ({ filters, onChange }: UserFiltersProps) => {
  const { t } = useLanguage();

  const hasActiveFilters =
    filters.country !== "" ||
    filters.profession !== "" ||
    filters.dateFrom !== null ||
    filters.dateTo !== null;

  const clearFilters = () =>
    onChange({ country: "", profession: "", dateFrom: null, dateTo: null });

  return (
    <div className="space-y-3">
      {/* Status tabs */}
      <div className="flex flex-wrap gap-2">
        {(["all", "pending", "approved", "rejected"] as StatusFilter[]).map((s) => (
          <Button
            key={s}
            variant={filters.status === s ? "default" : "outline"}
            size="sm"
            onClick={() => onChange({ status: s })}
            className="h-7 text-xs"
          >
            {s === "all"
              ? t("admin.filter_all") || "All"
              : s === "pending"
              ? t("admin.status_pending") || "Pending"
              : s === "approved"
              ? t("admin.status_approved") || "Approved"
              : t("admin.status_rejected") || "Rejected"}
          </Button>
        ))}
      </div>

      {/* Advanced filters row */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t("admin.profession_filter")}</Label>
          <Select
            value={filters.profession}
            onValueChange={(val) => onChange({ profession: val === "_all" ? "" : val })}
          >
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue placeholder={t("admin.profession_filter")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">{t("admin.filter_all") || "All"}</SelectItem>
              {PROFESSIONS.map((p) => (
                <SelectItem key={p} value={p}>
                  {t(`onboarding.profession_${p}`) || p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t("admin.date_from")}</Label>
          <Input
            type="date"
            value={filters.dateFrom || ""}
            onChange={(e) => onChange({ dateFrom: e.target.value || null })}
            className="h-8 w-[140px] text-xs"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t("admin.date_to")}</Label>
          <Input
            type="date"
            value={filters.dateTo || ""}
            onChange={(e) => onChange({ dateTo: e.target.value || null })}
            className="h-8 w-[140px] text-xs"
          />
        </div>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs gap-1">
            <X className="h-3 w-3" />
            {t("admin.clear_filters")}
          </Button>
        )}
      </div>
    </div>
  );
};

export default UserFiltersComponent;
