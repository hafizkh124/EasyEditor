import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Lock, CheckSquare, Square } from "lucide-react";
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

const DOMAINS: DomainInfo[] = [
  // HADITH
  { id: "dorar",       labelKey: "islamic.domain_dorar",     tier: "all",  group: "hadith" },
  { id: "sunnah",      labelKey: "islamic.domain_sunnah",    tier: "all",  group: "hadith" },
  { id: "hadith-index",labelKey: "islamic.domain_hadith_idx",tier: "pro",  group: "hadith" },
  // QURAN & TAFSIR
  { id: "alquran",     labelKey: "islamic.domain_alquran",   tier: "all",  group: "quran" },
  { id: "quran-com",   labelKey: "islamic.domain_qurancom",  tier: "all",  group: "quran" },
  { id: "tanzil",      labelKey: "islamic.domain_tanzil",    tier: "all",  group: "quran" },
  // FATAWA & Q&A
  { id: "islamqa",     labelKey: "islamic.domain_islamqa",   tier: "pro",  group: "fatawa" },
  { id: "islamweb",    labelKey: "islamic.domain_islamweb",  tier: "pro",  group: "fatawa" },
  { id: "dar-alifta",  labelKey: "islamic.domain_daralifta", tier: "pro",  group: "fatawa" },
  // CLASSICAL
  { id: "shamela-index",  labelKey: "islamic.domain_shamela",   tier: "pro", group: "classical" },
  { id: "openiti-index",  labelKey: "islamic.domain_openiti",   tier: "pro", group: "classical" },
];

const GROUP_LABELS: Record<string, string> = {
  hadith:    "islamic.group_hadith",
  quran:     "islamic.group_quran",
  fatawa:    "islamic.group_fatawa",
  classical: "islamic.group_classical",
};

const GROUPS: DomainInfo["group"][] = ["hadith", "quran", "fatawa", "classical"];

const LANGUAGES = [
  { id: "ar", labelKey: "islamic.lang_arabic" },
  { id: "en", labelKey: "islamic.lang_english" },
  { id: "ur", labelKey: "islamic.lang_urdu" },
];

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
  selectedLanguages,
  onSelectedLanguagesChange,
  tier,
  hideDomains = false,
}: IslamicResearchPanelProps) => {
  const { t } = useLanguage();
  const isProOrUltra = tier === "pro" || tier === "ultra";

  const toggleDomain = (id: string, domainTier: "all" | "pro") => {
    if (domainTier === "pro" && !isProOrUltra) return; // blocked
    if (selectedDomains.includes(id)) {
      onSelectedDomainsChange(selectedDomains.filter((d) => d !== id));
    } else {
      onSelectedDomainsChange([...selectedDomains, id]);
    }
  };

  const toggleLanguage = (id: string) => {
    if (selectedLanguages.includes(id)) {
      if (selectedLanguages.length === 1) return; // keep at least one
      onSelectedLanguagesChange(selectedLanguages.filter((l) => l !== id));
    } else {
      onSelectedLanguagesChange([...selectedLanguages, id]);
    }
  };

  const selectAll = () => {
    const allowed = DOMAINS.filter((d) => d.tier === "all" || isProOrUltra).map((d) => d.id);
    onSelectedDomainsChange(allowed);
  };

  const clearAll = () => {
    // Keep at least the Tier A defaults
    const defaults = DOMAINS.filter((d) => d.tier === "all").slice(0, 2).map((d) => d.id);
    onSelectedDomainsChange(defaults);
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
              {group === "fatawa" || group === "classical" ? (
                !isProOrUltra ? (
                  <Link to="/pricing">
                    <Badge variant="secondary" className="text-[9px] h-4 px-1.5 cursor-pointer hover:bg-primary/10">
                      Pro+
                    </Badge>
                  </Link>
                ) : null
              ) : null}
            </div>
            <div className="grid grid-cols-1 gap-1">
              {groupDomains.map((domain) => {
                const isSelected = selectedDomains.includes(domain.id);
                const isLocked = domain.tier === "pro" && !isProOrUltra;

                return (
                  <button
                    key={domain.id}
                    onClick={() => toggleDomain(domain.id, domain.tier)}
                    disabled={isLocked}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                      isLocked
                        ? "opacity-40 cursor-not-allowed"
                        : "cursor-pointer hover:bg-muted/70",
                      isSelected && !isLocked && "bg-primary/5 border border-primary/20"
                    )}
                  >
                    {isSelected && !isLocked ? (
                      <CheckSquare className="h-3.5 w-3.5 text-primary shrink-0" />
                    ) : (
                      <Square className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span className="text-xs text-foreground flex-1 truncate">{t(domain.labelKey)}</span>
                    {isLocked && <Lock className="h-3 w-3 text-muted-foreground shrink-0" />}
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
