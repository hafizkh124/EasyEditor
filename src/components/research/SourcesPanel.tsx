import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Link2, Upload, FileText, Trash2, Plus, Loader2, BookOpen, Globe, Lock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { Source } from "./types";

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
  strictMode: boolean;
  onStrictModeChange: (v: boolean) => void;
  researchQueriesUsed: number;
  researchQueriesLimit: number;
  researchLimitReached: boolean;
  showUsageMeter: boolean;
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
  urlInput,
  onUrlInputChange,
  isAddingUrl,
  isUploading,
  fileInputRef,
  onAddUrl,
  onFileUpload,
  onFileDrop,
  onDeleteSource,
  strictMode,
  onStrictModeChange,
  researchQueriesUsed,
  researchQueriesLimit,
  researchLimitReached,
  showUsageMeter,
  t,
}: SourcesPanelProps) => {
  const sourceIcon = (type: string) => (type === "url" ? Link2 : FileText);

  return (
    <div className="lg:w-80 border-b lg:border-b-0 lg:border-e border-border bg-card flex flex-col">
      <div className="p-4 border-b border-border">
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" />
          {t("research.sources")}
        </h2>
        <p className="text-xs text-muted-foreground mt-1">{t("research.sources_hint")}</p>
      </div>

      <div className="p-3 space-y-2 border-b border-border">
        <div className="flex gap-2">
          <Input
            value={urlInput}
            onChange={(e) => onUrlInputChange(e.target.value)}
            placeholder="https://example.com"
            className="text-sm"
            onKeyDown={(e) => e.key === "Enter" && onAddUrl()}
          />
          <Button size="icon" onClick={onAddUrl} disabled={isAddingUrl || !urlInput.trim()}>
            {isAddingUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </Button>
        </div>
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

      <div className="p-3 border-t border-border space-y-3">
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
    </div>
  );
};

export default SourcesPanel;
