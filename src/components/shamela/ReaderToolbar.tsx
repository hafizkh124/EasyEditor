import React from "react";
import {
  ArrowRight,
  ArrowLeft,
  BookOpen,
  ChevronRight,
  ChevronLeft,
  ListTree,
  Star,
  Bookmark,
  Columns2,
  FileText,
  Download,
  MoreVertical,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";

interface ReaderToolbarProps {
  title: string;
  subtitle?: string;
  currentPage: number;
  pageCount: number;
  canGoBack: boolean;
  canGoForward: boolean;
  tocOpen: boolean;
  onToggleToc: () => void;
  onBack: () => void;
  onForward: () => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  settingsSlot?: React.ReactNode;
  /** SPEC-M6 Phase 8: bookmark/favorite toggles for the current page/book. */
  bookmarked?: boolean;
  onToggleBookmark?: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  /** SPEC-M6 Phase 9: open side-by-side comparison. */
  onRequestSplit?: () => void;
  /** SPEC-M6 Phase 10: open the in-app PDF viewer for this book. */
  onRequestPdf?: () => void;
  /** UX-v1 P7 follow-up: open the "Import to Workspace" dialog. */
  onRequestImport?: () => void;
}

// Touch target below `md`, back to the compact icon size once a mouse is the
// input — same split WorkbenchPanel's close button already uses.
const ICON_BUTTON = "h-8 w-8 min-h-touch min-w-touch md:min-h-0 md:min-w-0";

interface SecondaryAction {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}

export const ReaderToolbar: React.FC<ReaderToolbarProps> = ({
  title,
  subtitle,
  currentPage,
  pageCount,
  canGoBack,
  canGoForward,
  tocOpen,
  onToggleToc,
  onBack,
  onForward,
  onPrev,
  onNext,
  onClose,
  settingsSlot,
  bookmarked = false,
  onToggleBookmark,
  isFavorite = false,
  onToggleFavorite,
  onRequestSplit,
  onRequestPdf,
  onRequestImport,
}) => {
  const { t, direction } = useLanguage();
  const rtl = direction === "rtl";
  const PrevIcon = rtl ? ChevronRight : ChevronLeft;
  const NextIcon = rtl ? ChevronLeft : ChevronRight;

  // M10 Phase 3 — the reader header used to hold 13 controls unconditionally
  // (~490px of buttons+text), overflowing a 375px viewport. TOC, title, the
  // history/page-navigation cluster, and close stay always visible — this is
  // core reading flow. Bookmark/favorite/split/pdf/import (secondary, and
  // each individually optional already) collapse into one overflow menu below
  // `md`, and render inline as before at `md` and up.
  //
  // Explicitly typed rather than inferred: each literal below would otherwise
  // narrow `icon` to a specific JSX.Element type per-branch, which then makes
  // the filter's type predicate (icon: React.ReactNode, deliberately broader
  // so any future action can hold a fragment/string) invalid — a predicate
  // must narrow FROM the array's element type, not widen it.
  const rawSecondaryActions: Array<SecondaryAction | undefined> = [
    onToggleBookmark && {
      key: "bookmark",
      label: bookmarked ? t("reader.remove_bookmark") : t("reader.bookmark_page"),
      icon: <Bookmark className={cn("h-4 w-4", bookmarked && "text-primary fill-current")} />,
      onClick: onToggleBookmark,
    },
    onToggleFavorite && {
      key: "favorite",
      label: isFavorite ? t("reader.remove_favorite") : t("reader.add_favorite"),
      icon: <Star className={cn("h-4 w-4", isFavorite && "text-amber-500 fill-current")} />,
      onClick: onToggleFavorite,
    },
    onRequestSplit && {
      key: "split",
      label: t("reader.compare_split"),
      icon: <Columns2 className="h-4 w-4" />,
      onClick: onRequestSplit,
    },
    onRequestPdf && {
      key: "pdf",
      label: t("reader.open_pdf"),
      icon: <FileText className="h-4 w-4" />,
      onClick: onRequestPdf,
    },
    onRequestImport && {
      key: "import",
      label: t("shamela.workspace_import.button", "Workspace میں درآمد کریں"),
      icon: <Download className="h-4 w-4" />,
      onClick: onRequestImport,
    },
  ];
  const secondaryActions = rawSecondaryActions.filter(
    (action): action is SecondaryAction => Boolean(action),
  );

  return (
    <header className="flex items-center gap-1 h-11 px-2 border-b border-border bg-background/95 backdrop-blur shrink-0">
      <Button
        variant="ghost"
        size="icon"
        className={cn(ICON_BUTTON, tocOpen && "bg-accent text-accent-foreground")}
        onClick={onToggleToc}
        title={t("reader.contents")}
        aria-label={t("reader.contents")}
      >
        <ListTree className="h-4 w-4" />
      </Button>

      <div className="flex items-center min-w-0 mx-1 flex-1">
        <BookOpen className="h-4 w-4 text-muted-foreground shrink-0 mr-2" />
        <div className="min-w-0">
          <p className="text-sm font-medium truncate leading-tight">{title}</p>
          {subtitle && (
            <p className="text-xs text-muted-foreground truncate leading-tight">{subtitle}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-0.5">
        <Button variant="ghost" size="icon" className={ICON_BUTTON} onClick={onBack} disabled={!canGoBack} title={t("reader.back")} aria-label={t("reader.back")}>
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className={ICON_BUTTON} onClick={onForward} disabled={!canGoForward} title={t("reader.forward")} aria-label={t("reader.forward")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="w-px h-4 bg-border mx-1" />
        <Button variant="ghost" size="icon" className={ICON_BUTTON} onClick={onPrev} disabled={currentPage <= 1} title={t("reader.previous_page")} aria-label={t("reader.previous_page")}>
          <PrevIcon className="h-4 w-4" />
        </Button>
        <span className="text-xs text-muted-foreground px-1 tabular-nums whitespace-nowrap">
          {currentPage} / {pageCount || "…"}
        </span>
        <Button variant="ghost" size="icon" className={ICON_BUTTON} onClick={onNext} disabled={currentPage >= pageCount} title={t("reader.next_page")} aria-label={t("reader.next_page")}>
          <NextIcon className="h-4 w-4" />
        </Button>
      </div>

      {settingsSlot}

      {secondaryActions.length > 0 && (
        <>
          {/* Inline at md+ — unchanged from before this change at desktop width. */}
          <div className="hidden md:flex items-center gap-0.5">
            {secondaryActions.map((action) => (
              <Button
                key={action.key}
                variant="ghost"
                size="icon"
                className={ICON_BUTTON}
                onClick={action.onClick}
                title={action.label}
                aria-label={action.label}
              >
                {action.icon}
              </Button>
            ))}
          </div>

          {/* Collapsed into one overflow menu below md — see the comment above
              secondaryActions for why these five specifically. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(ICON_BUTTON, "md:hidden")}
                title={t("reader.more_actions", "More actions")}
                aria-label={t("reader.more_actions", "More actions")}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="md:hidden">
              {secondaryActions.map((action) => (
                <DropdownMenuItem key={action.key} onClick={action.onClick} className="gap-2 min-h-touch">
                  {action.icon}
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

      <Button variant="ghost" size="icon" className={ICON_BUTTON} onClick={onClose} title={t("reader.close")} aria-label={t("reader.close")}>
        <X className="h-4 w-4" />
      </Button>
    </header>
  );
};
