import React, { useEffect, useMemo, useState, useCallback } from "react";
import { GitFork, Search, Sparkles, Loader2, User, BookOpen, MapPin, Calendar, Lightbulb, ArrowRight, BookMarked } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  graphService,
  estimateGraphExtractCost,
  type Entity,
  type EntityDetails,
} from "@/lib/graph/graphService";
import { findDuplicateSuggestions, buildMergedAliases } from "@/lib/graph/entityResolve";
import { EntityMergeSuggestions } from "./EntityMergeSuggestions";
import { SolvencyDialog } from "./SolvencyDialog";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import { documentService, extractPlainTextFromJSON } from "@/core/workspace/documentService";
import { toast } from "sonner";
import { translateStored, translateStoredFormat } from "@/lib/i18n";

const KIND_ICONS: Record<string, React.ElementType> = {
  person: User,
  concept: Lightbulb,
  book: BookOpen,
  location: MapPin,
  event: Calendar,
};

const KIND_LABELS: Record<string, string> = {
  person: "شخصیت",
  concept: "مفہوم",
  book: "کتاب",
  location: "مقام",
  event: "واقعہ",
};

export const KnowledgeGraphTab: React.FC = () => {
  const workspace = useOptionalWorkspace();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [entityDetails, setEntityDetails] = useState<EntityDetails | null>(null);
  const [pendingExtract, setPendingExtract] = useState<{ text: string; cost: number } | null>(null);
  const { total } = useTokenBalance();

  const duplicates = useMemo(() => findDuplicateSuggestions(entities), [entities]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await graphService.listEntities(search);
      setEntities(res);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * Extraction costs tokens, so it is priced and confirmed first — no AI run
   * may start from an unpriced click (Principle 5, SPEC-M4 FR-3.2).
   */
  const handleExtract = async () => {
    const docId = workspace?.activeDocumentId;
    if (!docId) {
      toast.error(translateStored("toast.workspace.no_document"));
      return;
    }

    const doc = await documentService.getDocument(docId);
    const text = doc ? extractPlainTextFromJSON(doc.content_json) || doc.plain_text || "" : "";
    if (!text.trim()) {
      toast.error(translateStored("toast.workspace.empty_document"));
      return;
    }

    setPendingExtract({ text, cost: estimateGraphExtractCost(text.length) });
  };

  const confirmExtract = async () => {
    const pending = pendingExtract;
    const docId = workspace?.activeDocumentId;
    if (!pending || !docId) return;

    setPendingExtract(null);
    setExtracting(true);
    try {
      const res = await graphService.extractGraphFromText(pending.text, docId);
      toast.success(translateStoredFormat("toast.graph.extracted", { entities: res.entities_count, relations: res.relations_count }));
      refresh();
    } catch (err: unknown) {
      toast.error(translateStoredFormat("toast.graph.extraction_failed", { error: err instanceof Error ? err.message : translateStored("toast.common.unexpected_error") }));
    } finally {
      setExtracting(false);
    }
  };

  /**
   * Two records that look like one scholar. Never merged automatically — the
   * user confirms each pair (SPEC-M4 FR-3.3).
   */
  const handleMerge = async (keep: Entity, absorb: Entity) => {
    const ok = await graphService.mergeEntities(keep.id, absorb.id, buildMergedAliases(keep, absorb));
    if (ok) {
      toast.success(translateStoredFormat("toast.graph.merged", { source: absorb.canonical_name, target: keep.canonical_name }));
      refresh();
    } else {
      toast.error(translateStored("toast.graph.merge_failed"));
    }
  };

  const openDetails = async (id: string) => {
    setSelectedEntityId(id);
    const details = await graphService.getEntityDetails(id);
    setEntityDetails(details);
  };

  return (
    <div className="flex flex-col h-full bg-background p-2" dir="rtl">
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-border gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-xs text-primary">
          <GitFork className="h-4 w-4" />
          <span>علمی گراف (Knowledge Graph)</span>
        </div>

        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10"
          onClick={handleExtract}
          disabled={extracting}
        >
          {extracting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          گراف نکالیں
        </Button>
      </div>

      <div className="relative mb-2">
        <Search className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="ہستیوں اور مفاہیم میں تلاش کریں…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-xs pr-8 pl-2"
        />
      </div>

      <ScrollArea className="flex-1 pe-1">
        {loading ? (
          <div className="p-4 text-xs text-muted-foreground text-center py-8">
            <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1 text-primary" />
            گراف لوڈ ہو رہا ہے…
          </div>
        ) : entities.length === 0 ? (
          <div className="p-3 text-xs text-muted-foreground text-center py-8 space-y-2">
            <GitFork className="h-8 w-8 mx-auto opacity-40 text-primary" />
            <p className="font-semibold text-foreground text-xs">نالیج گراف ابھی خالی ہے</p>
            <p className="text-xs">
              کسی بھی دستاویز سے ہستیاں (شخصیات، کتب، مفاہیم) اور روابط نکالنے کے لیے **"گراف نکالیں"** کا بٹن دباؤ۔
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <EntityMergeSuggestions suggestions={duplicates} onMerge={handleMerge} />

            {entities.map((item) => {
              const Icon = KIND_ICONS[item.kind] || User;
              const label = KIND_LABELS[item.kind] || item.kind;

              return (
                <div
                  key={item.id}
                  onClick={() => openDetails(item.id)}
                  className="p-2.5 rounded-lg border bg-card hover:bg-accent/40 text-xs transition-colors cursor-pointer space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground text-xs flex items-center gap-1.5">
                      <Icon className="h-3.5 w-3.5 text-primary shrink-0" />
                      {item.canonical_name}
                    </span>
                    <Badge variant="outline" className="text-xs px-1 py-0 bg-primary/5 text-primary border-primary/20">
                      {label}
                    </Badge>
                  </div>

                  {item.summary && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{item.summary}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {pendingExtract && (
        <SolvencyDialog
          open
          onOpenChange={(open) => !open && setPendingExtract(null)}
          taskLabel="ہستیوں کا استخراج (Knowledge Graph)"
          totalChunks={1}
          totalCost={pendingExtract.cost}
          availableTokens={total ?? 0}
          onConfirm={confirmExtract}
        />
      )}

      {/* Entity Details Dialog */}
      <Dialog open={selectedEntityId !== null} onOpenChange={(open) => !open && setSelectedEntityId(null)}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base text-primary">
              <BookMarked className="h-5 w-5" />
              {entityDetails?.entity.canonical_name}
            </DialogTitle>
          </DialogHeader>

          {entityDetails && (
            <div className="space-y-3 text-xs">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {KIND_LABELS[entityDetails.entity.kind] || entityDetails.entity.kind}
                </Badge>
                {entityDetails.entity.aliases?.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    مترادفات: {entityDetails.entity.aliases.join("، ")}
                  </span>
                )}
              </div>

              {entityDetails.entity.summary && (
                <p className="p-2.5 bg-muted rounded-md border text-muted-foreground text-xs">
                  {entityDetails.entity.summary}
                </p>
              )}

              <div className="space-y-2 pt-1 border-t">
                <h4 className="font-semibold text-foreground text-xs">علمی روابط ({entityDetails.outgoingRelations.length + entityDetails.incomingRelations.length})</h4>

                {entityDetails.outgoingRelations.map((r) => (
                  <div key={r.id} className="p-2 bg-accent/30 rounded border text-xs space-y-1">
                    <div className="flex items-center gap-1 text-primary font-medium">
                      <span>{entityDetails.entity.canonical_name}</span>
                      <ArrowRight className="h-3 w-3 shrink-0" />
                      <span className="text-muted-foreground font-normal">[{r.relation_type}]</span>
                      <ArrowRight className="h-3 w-3 shrink-0" />
                      <span>{r.target_entity?.canonical_name}</span>
                    </div>
                    {r.evidence_quote && (
                      <p className="text-xs text-muted-foreground italic bg-background/50 p-1 rounded">
                        "{r.evidence_quote}"
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {entityDetails.backlinks.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t">
                  <h4 className="font-semibold text-foreground text-xs flex items-center gap-1 text-primary">
                    <BookMarked className="h-3.5 w-3.5" />
                    مربوطہ دستاویزات اور کتب ({entityDetails.backlinks.length})
                  </h4>
                  <div className="space-y-1">
                    {entityDetails.backlinks.map((b) => (
                      <div key={b.id} className="flex items-center gap-2 p-1.5 bg-muted rounded border text-xs">
                        <Badge variant="outline" className="text-xs px-1 py-0">
                          {b.type === "document" ? "دستاویز" : "کتاب"}
                        </Badge>
                        <span className="font-medium text-foreground truncate">{b.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
