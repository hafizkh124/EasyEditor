import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Link2, Upload, FileText, Trash2, Loader2, BookOpen, Globe, Lock, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { Source } from "./types";
import IslamicResearchPanel from "./IslamicResearchPanel";
import type { ResearchMode } from "./ResearchModeSwitcher";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface SourcesPanelProps {
  sources: Source[];
  urlInput: string;
  onUrlInputChange: (v: string) => void;
  isAddingUrl: boolean;
  isUploading: boolean;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onAddUrl: () => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onFileDrop: (file: File) => void;
  onDeleteSource: (source: Source) => void;
  onDeleteAllSources: () => void;
  strictMode: boolean;
  onStrictModeChange: (v: boolean) => void;
  researchQueriesUsed: number;
  researchQueriesLimit: number;
  researchLimitReached: boolean;
  showUsageMeter: boolean;
  // Research tab mode (Islamic / Custom / General). Switcher lives at page top now.
  mode: ResearchMode;
  islamicDomains: string[];
  onIslamicDomainsChange: (domains: string[]) => void;
  islamicLanguages: string[];
  onIslamicLanguagesChange: (langs: string[]) => void;
  islamicQueriesUsed: number;
  islamicQueriesLimit: number;
  madhhab: string;
  onMadhhabChange: (v: string) => void;
  tier: string;
  t: (k: string) => string;
}

const DropZone = ({
  onFileDrop,
  isUploading,
  t,
}: {
  onFileDrop: (file: File) => void;
  isUploading: boolean;
  t: (k: string) => string;
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const handleDrag = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); }, []);
  const handleDragIn = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer.items?.length) setIsDragOver(true); }, []);
  const handleDragOut = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFileDrop(file);
  }, [onFileDrop]);

  return (
    <motion.div
      onDragEnter={handleDragIn}
      onDragLeave={handleDragOut}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      animate={{
        borderColor: isDragOver ? "hsl(var(--primary))" : "hsl(var(--border))",
        backgroundColor: isDragOver ? "hsl(var(--primary) / 0.08)" : "transparent",
        scale: isDragOver ? 1.02 : 1,
      }}
      transition={{ duration: 0.2 }}
      className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer"
    >
      {isUploading ? (
        <Loader2 className="h-5 w-5 animate-spin mx-auto text-primary" />
      ) : (
        <>
          <Upload className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
          <p className="text-xs text-muted-foreground">{t("research.drop_hint")}</p>
        </>
      )}
    </motion.div>
  );
};

const SourcesPanel = ({
  sources,
  urlInput: _urlInput,
  onUrlInputChange: _onUrlInputChange,
  isAddingUrl: _isAddingUrl,
  isUploading,
  fileInputRef,
  onAddUrl: _onAddUrl,
  onFileUpload,
  onFileDrop,
  onDeleteSource,
  onDeleteAllSources,
  strictMode,
  onStrictModeChange,
  researchQueriesUsed,
  researchQueriesLimit,
  researchLimitReached,
  showUsageMeter,
  mode,
  islamicDomains,
  onIslamicDomainsChange,
  islamicLanguages,
  onIslamicLanguagesChange,
  islamicQueriesUsed,
  islamicQueriesLimit,
  madhhab: _madhhab,
  onMadhhabChange: _onMadhhabChange,
  tier,
  t,
}: SourcesPanelProps) => {
  const sourceIcon = (type: string) => (type === "url" ? Link2 : FileText);
  const islamicLimitReached = islamicQueriesLimit > 0 && islamicQueriesUsed >= islamicQueriesLimit;

  return (
    <div className="lg:w-80 border-b lg:border-b-0 lg:border-e border-border bg-card flex flex-col">
      {/* ── Islamic Mode Panel (FR-4.4: auto-select all domains, no checklist) ── */}
      {mode === "islamic" && (
        <div className="p-3 border-b border-border">
          <IslamicResearchPanel
            selectedDomains={islamicDomains}
            onSelectedDomainsChange={onIslamicDomainsChange}
            selectedLanguages={islamicLanguages}
            onSelectedLanguagesChange={onIslamicLanguagesChange}
            strictMode={strictMode}
            onStrictModeChange={onStrictModeChange}
            tier={tier}
            hideDomains
          />
          {/* Islamic usage meter */}
          {islamicQueriesLimit > 0 && (
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{t("research.islamic_queries_label")}</span>
                <span className={islamicLimitReached ? "text-destructive font-medium" : ""}>
                  {islamicQueriesUsed} / {islamicQueriesLimit}
                </span>
              </div>
              <Progress
                value={Math.min((islamicQueriesUsed / islamicQueriesLimit) * 100, 100)}
                className="h-1"
              />
              {islamicLimitReached && (
                <Link to="/pricing" className="block">
                  <Badge variant="destructive" className="w-full justify-center text-[10px] cursor-pointer">
                    {t("dashboard.upgrade")}
                  </Badge>
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Custom Sources Mode (FR-4.5): file uploads only, NO URL input ── */}
      {mode === "custom" && (
      <>
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            {t("research.sources")}
          </h2>
          {sources.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("research.delete_all_sources")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                    {t("research.delete_all_confirm")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {sources.length === 1
                      ? t("research.sources_hint")
                      : `${sources.length} ${t("research.sources").toLowerCase()}`}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("admin.cancel") || "Cancel"}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={onDeleteAllSources}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    <Trash2 className="h-4 w-4 mr-1.5" />
                    {t("research.delete_all_sources")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">{t("research.sources_hint")}</p>
      </div>

      <div className="p-3 space-y-2 border-b border-border">
        <DropZone onFileDrop={onFileDrop} isUploading={isUploading} t={t} />
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-1.5"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
        >
          {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {t("research.upload_file")}
        </Button>
        <input ref={fileInputRef} type="file" accept=".pdf,.docx" onChange={onFileUpload} className="hidden" />
      </div>

      <ScrollArea className="flex-1 max-h-64 lg:max-h-none">
        <div className="p-3 space-y-1.5">
          <AnimatePresence>
            {sources.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">{t("research.no_sources")}</p>
            ) : (
              sources.map((source) => {
                const Icon = sourceIcon(source.source_type);
                return (
                  <motion.div
                    key={source.id}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex items-center gap-2 rounded-lg border border-border p-2 bg-background"
                  >
                    <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm text-foreground truncate flex-1">{source.title}</span>
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      {source.source_type.toUpperCase()}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => onDeleteSource(source)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </motion.div>
                );
              })
            )}
          </AnimatePresence>
        </div>
      </ScrollArea>
      </>
      )}

      {/* ── General Mode (FR-4.6): web search only, no source inputs ── */}
      {mode === "general" && (
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2 mb-1">
            <Globe className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold text-foreground">{t("research.tab_general")}</h2>
          </div>
          <p className="text-xs text-muted-foreground">{t("research.general_hint")}</p>
        </div>
      )}

      {/* Custom-only footer: strict toggle + usage meter (Extended mode only in Custom Sources) */}
      {mode === "custom" && (
      <div className="p-3 border-t border-border space-y-3 mt-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {strictMode ? <Lock className="h-4 w-4 text-primary" /> : <Globe className="h-4 w-4 text-primary" />}
            <Label htmlFor="mode-toggle" className="text-sm font-medium text-foreground">
              {strictMode ? t("research.strict_mode") : t("research.extended_mode")}
            </Label>
          </div>
          <Switch id="mode-toggle" checked={!strictMode} onCheckedChange={(v) => onStrictModeChange(!v)} />
        </div>
        <p className="text-[10px] text-muted-foreground">
          {strictMode ? t("research.strict_desc") : t("research.extended_desc")}
        </p>

        {showUsageMeter && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{t("research.queries_label")}</span>
              <span className={researchLimitReached ? "text-destructive font-medium" : ""}>
                {researchQueriesUsed} / {researchQueriesLimit}
              </span>
            </div>
            <Progress
              value={Math.min((researchQueriesUsed / researchQueriesLimit) * 100, 100)}
              className="h-1"
            />
            {researchLimitReached && (
              <Link to="/pricing" className="block">
                <Badge variant="destructive" className="w-full justify-center text-[10px] cursor-pointer">
                  {t("dashboard.upgrade")}
                </Badge>
              </Link>
            )}
          </div>
        )}
      </div>
      )}
    </div>
  );
};

export default SourcesPanel;
