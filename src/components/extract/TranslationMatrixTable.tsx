import React from "react";
import { BookOpen, Check, Copy, FileEdit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface TranslationRow {
  translator_slug: string;
  full_name: string;
  language: string;
  maslak: string | null;
  text: string;
  source_url?: string | null;
}

interface TranslationMatrixTableProps {
  results: TranslationRow[];
  unavailableNames: string[];
  copiedIndex: number | null;
  onCopyRow: (text: string, index: number) => void;
  onInsertRow: (row: TranslationRow) => void;
  onCopyAll: () => void;
  onInsertAll: () => void;
}

export const TranslationMatrixTable: React.FC<TranslationMatrixTableProps> = ({
  results, unavailableNames, copiedIndex, onCopyRow, onInsertRow, onCopyAll, onInsertAll,
}) => (
  <Card className="border-border shadow-sm">
    <CardHeader className="p-3 flex flex-row items-center justify-between">
      <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
        <BookOpen className="h-3.5 w-3.5 text-primary" />
        موازنہ ({results.length})
      </CardTitle>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" onClick={onCopyAll} className="h-7 text-[11px] gap-1 px-2">
          <Copy className="h-3 w-3" /> کاپی
        </Button>
        <Button size="sm" onClick={onInsertAll} className="h-7 text-[11px] gap-1 px-2">
          <FileEdit className="h-3 w-3" /> Canvas میں رکھیں
        </Button>
      </div>
    </CardHeader>
    <CardContent className="p-2 space-y-2">
      <div className="rounded border border-border overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-[120px] text-right text-[11px]">مترجم</TableHead>
              <TableHead className="text-right text-[11px]">ترجمہ</TableHead>
              <TableHead className="w-[70px] text-center text-[11px]">ایکشن</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.map((r, idx) => (
              <TableRow key={r.translator_slug}>
                <TableCell className="font-semibold text-foreground text-[11px] p-2">{r.full_name}</TableCell>
                <TableCell
                  className="text-xs leading-relaxed text-foreground p-2"
                  dir={r.language === "en" ? "ltr" : "rtl"}
                >
                  {r.text}
                </TableCell>
                <TableCell className="text-center p-1">
                  <div className="flex items-center justify-center gap-0.5">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onCopyRow(r.text, idx)}>
                      {copiedIndex === idx ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onInsertRow(r)}>
                      <FileEdit className="h-3 w-3" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {unavailableNames.length > 0 && (
          <p className="text-[10px] text-muted-foreground pt-1">
            غیر دستیاب تراجم: {unavailableNames.join("، ")}
          </p>
        )}
      </div>
    </CardContent>
  </Card>
);
