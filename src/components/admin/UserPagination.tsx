import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import type { PaginationState } from "./types";

interface UserPaginationProps {
  pagination: PaginationState;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

const UserPagination = ({ pagination, onPageChange, onPageSizeChange }: UserPaginationProps) => {
  const { t } = useLanguage();
  const { page, pageSize, totalCount } = pagination;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);

  const showingText = (t("admin.showing_results", "Showing {from}-{to} of {total}"))
    .replace("{from}", String(from))
    .replace("{to}", String(to))
    .replace("{total}", String(totalCount));

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3">
      <p className="text-xs text-muted-foreground">{showingText}</p>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{t("admin.per_page")}:</span>
        <Select
          value={String(pageSize)}
          onValueChange={(val) => onPageSizeChange(Number(val))}
        >
          <SelectTrigger className="h-7 w-[65px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="10">10</SelectItem>
            <SelectItem value="25">25</SelectItem>
            <SelectItem value="50">50</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 min-h-touch min-w-touch md:min-h-0 md:min-w-0"
            disabled={page <= 1}
            onClick={() => onPageChange(1)}
            aria-label={t("admin.page_first", "First page")}
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 min-h-touch min-w-touch md:min-h-0 md:min-w-0"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label={t("translate.prev_page", "Previous page")}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs text-muted-foreground px-2 min-w-[60px] text-center">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 min-h-touch min-w-touch md:min-h-0 md:min-w-0"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label={t("translate.next_page", "Next page")}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 min-h-touch min-w-touch md:min-h-0 md:min-w-0"
            disabled={page >= totalPages}
            onClick={() => onPageChange(totalPages)}
            aria-label={t("admin.page_last", "Last page")}
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default UserPagination;
