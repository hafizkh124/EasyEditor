import { Button } from "@/components/ui/button";
import { CheckSquare, Square } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

// Domain registry
interface DomainInfo {
  id: string;
  labelKey: string;
  descKey?: string;
  tier: "all" | "pro";
  group: "hadith" | "quran" | "fatawa" | "classical";
}

// Every domain is now available to every authenticated user. Plan
// differentiation is enforced server-side via the monthly query quota only.
const DOMAINS: DomainInfo[] = [
  // HADITH
  { id: "dorar",       labelKey: "islamic.domain_dorar",     tier: "all",  group: "hadith" },
  // sunnah removed per Phase 7.5 doctrine — no API key, would silently no-op.
  { id: "hadith-api",       labelKey: "islamic.domain_hadithapi",       tier: "all", group: "hadith" },
  { id: "hadith-index",     labelKey: "islamic.domain_hadith_idx",      tier: "all", group: "hadith" },
  { id: "islamicurdubooks", labelKey: "islamic.domain_islamicurdubooks", tier: "all", group: "hadith" },
  // QURAN & TAFSIR
  { id: "alquran",     labelKey: "islamic.domain_alquran",   tier: "all",  group: "quran" },
  { id: "quran-com",   labelKey: "islamic.domain_qurancom",  tier: "all",  group: "quran" },
  { id: "tanzil",      labelKey: "islamic.domain_tanzil",    tier: "all",  group: "quran" },
  // FATAWA & Q&A
  { id: "islamqa",     labelKey: "islamic.domain_islamqa",   tier: "all",  group: "fatawa" },
  { id: "islamweb",    labelKey: "islamic.domain_islamweb",  tier: "all",  group: "fatawa" },
  // dar-alifta removed per Phase 7.5 doctrine — persistent upstream timeouts.
  // CLASSICAL
  { id: "shamela-index",  labelKey: "islamic.domain_shamela",   tier: "all", group: "classical" },
  { id: "openiti-index",  labelKey: "islamic.domain_openiti",   tier: "all", group: "classical" },
];

const GROUP_LABELS: Record<string, string> = {
  hadith:    "islamic.group_hadith",
  quran:     "islamic.group_quran",
  fatawa:    "islamic.group_fatawa",
  classical: "islamic.group_classical",
};

const GROUPS: DomainInfo["group"][] = ["hadith", "quran", "fatawa", "classical"];

interface IslamicResearchPanelProps {
  selectedDomains: string[];
  onSelectedDomainsChange: (domains: string[]) => void;
  selectedLanguages: string[];
  onSelectedLanguagesChange: (langs: string[]) => void;
  strictMode: boolean;
  onStrictModeChange: (v: boolean) => void;
  tier: string;
  // FR-4.4.1: hide the per-domain checklist (domains auto-selected)
  hideDomains?: boolean;
  // FR-4.4.2: Madhhab filter (deprecated UI; prop kept for compatibility)
  madhhab?: string;
  onMadhhabChange?: (id: string) => void;
}

const IslamicResearchPanel = ({
  selectedDomains,
  onSelectedDomainsChange,
  tier,
  hideDomains = false,
}: IslamicResearchPanelProps) => {
  const { t } = useLanguage();
  void tier; // tier no longer affects domain availability — kept for prop compat

  const toggleDomain = (id: string) => {
    if (selectedDomains.includes(id)) {
      onSelectedDomainsChange(selectedDomains.filter((d) => d !== id));
    } else {
      onSelectedDomainsChange([...selectedDomains, id]);
    }
  };

  const selectAll = () => {
    onSelectedDomainsChange(DOMAINS.map((d) => d.id));
  };

  const clearAll = () => {
    // Keep two sensible defaults so the panel never sends zero sources
    onSelectedDomainsChange(DOMAINS.slice(0, 2).map((d) => d.id));
  };

  return (
    <div className="space-y-3">
      {/* Domain Focus Header (hidden in Islamic-tab mode per FR-4.4.1) */}
      {!hideDomains && (
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground uppercase tracking-wide">
          {t("islamic.domain_focus")}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={selectAll}>
            {t("islamic.select_all")}
          </Button>
          <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={clearAll}>
            {t("islamic.clear_all")}
          </Button>
        </div>
      </div>
      )}

      {/* Domain Groups */}
      {!hideDomains && GROUPS.map((group) => {
        const groupDomains = DOMAINS.filter((d) => d.group === group);
        return (
          <div key={group} className="space-y-1">
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                {t(GROUP_LABELS[group])}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-1">
              {groupDomains.map((domain) => {
                const isSelected = selectedDomains.includes(domain.id);

                return (
                  <button
                    key={domain.id}
                    onClick={() => toggleDomain(domain.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors cursor-pointer hover:bg-muted/70",
                      isSelected && "bg-primary/5 border border-primary/20"
                    )}
                  >
                    {isSelected ? (
                      <CheckSquare className="h-3.5 w-3.5 text-primary shrink-0" />
                    ) : (
                      <Square className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span className="text-xs text-foreground flex-1 truncate">{t(domain.labelKey)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

    </div>
  );
};

export default IslamicResearchPanel;
