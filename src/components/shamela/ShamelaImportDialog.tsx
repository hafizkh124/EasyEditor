import { useState, useEffect, useCallback } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Search, BookOpen, User, Layers, FileText, Download,
  Loader2
} from "lucide-react";

export interface ShamelaBook {
  id: number;
  title: string;
  author: string | null;
  category: string | null;
  pageCount: number | null;
  volumeCount: number | null;
  info: string | null;
}

export interface ShamelaCategory {
  id: number;
  name: string;
  parentId: number | null;
  bookCount: number;
}

interface ShamelaImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  masterDbPath: string;
}

export function ShamelaImportDialog({ open, onOpenChange, masterDbPath }: ShamelaImportDialogProps) {
  const [activeTab, setActiveTab] = useState("browse");
  const [searchQuery, setSearchQuery] = useState("");
  const [books, setBooks] = useState<ShamelaBook[]>([]);
  const [categories, setCategories] = useState<ShamelaCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedBooks, setSelectedBooks] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);

  const loadCategories = useCallback(async () => {
    if (!window.electronAPI?.shamela) return;
    try {
      const cats = await window.electronAPI.shamela.listCategories(masterDbPath);
      setCategories(cats);
    } catch (err) {
      console.error("[ShamelaImportDialog] loadCategories error:", err);
    }
  }, [masterDbPath]);

  const searchBooks = useCallback(async (query: string) => {
    if (!window.electronAPI?.shamela || !query.trim()) {
      setBooks([]);
      return;
    }
    setLoading(true);
    try {
      const results = await window.electronAPI.shamela.searchBooks(masterDbPath, query, 100);
      setBooks(results);
    } catch (err) {
      console.error("[ShamelaImportDialog] searchBooks error:", err);
      toast.error("تلاش کے دوران خرابی۔");
    } finally {
      setLoading(false);
    }
  }, [masterDbPath]);

  const loadBooksByCategory = useCallback(async (categoryId: number) => {
    if (!window.electronAPI?.shamela) return;
    setLoading(true);
    try {
      const results = await window.electronAPI.shamela.booksByCategory(masterDbPath, categoryId, 100);
      setBooks(results);
    } catch (err) {
      console.error("[ShamelaImportDialog] booksByCategory error:", err);
    } finally {
      setLoading(false);
    }
  }, [masterDbPath]);

  useEffect(() => {
    if (open) {
      loadCategories();
    }
  }, [open, loadCategories]);

  const handleSearch = () => {
    if (searchQuery.trim()) {
      setSelectedCategory(null);
      searchBooks(searchQuery);
    }
  };

  const handleCategorySelect = (catId: number) => {
    setSelectedCategory(catId);
    setSearchQuery("");
    loadBooksByCategory(catId);
  };

  const toggleBook = (bookId: number) => {
    setSelectedBooks((prev) => {
      const next = new Set(prev);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  };

  const handleImport = async () => {
    if (selectedBooks.size === 0) {
      toast.error("براہ کرم کم از کم ایک کتاب منتخب کریں۔");
      return;
    }

    setImporting(true);
    try {
      const selected = books.filter((b) => selectedBooks.has(b.id));
      toast.success(`${selected.length} کتب امپورٹ کے لیے قطار میں شامل کر دی گئی ہیں۔`);
      onOpenChange(false);
    } catch (err) {
      console.error("[ShamelaImportDialog] import error:", err);
      toast.error("امپورٹ کے دوران خرابی۔");
    } finally {
      setImporting(false);
    }
  };

  const totalSelected = selectedBooks.size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <BookOpen className="h-5 w-5 text-primary" />
            مکتبہ شاملہ — کتاب براؤزر اور امپورٹ
          </DialogTitle>
          <DialogDescription className="text-xs">
            شاملہ ۴ کی ڈائریکٹری سے کتب براؤز کریں، تلاش کریں اور امپورٹ کریں
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid grid-cols-2 w-64">
            <TabsTrigger value="browse" className="gap-1.5 text-xs">
              <Layers className="h-3.5 w-3.5" />
              زمرہ جات
            </TabsTrigger>
            <TabsTrigger value="search" className="gap-1.5 text-xs">
              <Search className="h-3.5 w-3.5" />
              تلاش
            </TabsTrigger>
          </TabsList>

          {/* Browse by category */}
          <TabsContent value="browse" className="flex-1 flex gap-4 min-h-0 mt-4">
            <div className="w-64 shrink-0 space-y-1">
              <span className="text-xs font-semibold text-muted-foreground px-1">زمرہ جات</span>
              <ScrollArea className="h-[400px] rounded border border-border">
                {categories.length === 0 ? (
                  <div className="p-4 text-xs text-muted-foreground text-center">
                    کوئی زمرہ جات نہیں ملے
                  </div>
                ) : (
                  categories.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => handleCategorySelect(cat.id)}
                      className={`w-full text-right px-3 py-2 text-xs flex items-center justify-between gap-2 hover:bg-muted/50 transition-colors ${
                        selectedCategory === cat.id ? "bg-primary/10 text-primary font-medium" : ""
                      }`}
                    >
                      <span className="truncate">{cat.name}</span>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {cat.bookCount}
                      </Badge>
                    </button>
                  ))
                )}
              </ScrollArea>
            </div>

            <div className="flex-1 min-w-0">
              <span className="text-xs font-semibold text-muted-foreground px-1 block mb-1">
                {selectedCategory
                  ? `کتب — ${categories.find((c) => c.id === selectedCategory)?.name || ""}`
                  : "کتب — زمرہ منتخب کریں"}
              </span>
              <BookList
                books={books}
                loading={loading}
                selectedBooks={selectedBooks}
                onToggle={toggleBook}
              />
            </div>
          </TabsContent>

          {/* Search */}
          <TabsContent value="search" className="flex-1 flex flex-col min-h-0 mt-4">
            <div className="flex gap-2 mb-3">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="کتاب یا مصنف کا نام درج کریں..."
                className="text-xs"
              />
              <Button size="sm" onClick={handleSearch} disabled={loading} className="gap-1.5 shrink-0">
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                تلاش
              </Button>
            </div>
            <div className="flex-1 min-h-0">
              <BookList
                books={books}
                loading={loading}
                selectedBooks={selectedBooks}
                onToggle={toggleBook}
              />
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="border-t border-border pt-4 mt-4 flex items-center gap-2">
          <div className="flex-1 text-xs text-muted-foreground">
            {totalSelected > 0 ? `${totalSelected} کتاب(یں) منتخب` : "کوئی کتاب منتخب نہیں"}
          </div>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            منسوخ کریں
          </Button>
          <Button
            size="sm"
            onClick={handleImport}
            disabled={totalSelected === 0 || importing}
            className="gap-1.5"
          >
            {importing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {importing ? "امپورٹ ہو رہا ہے..." : "منتخب کردہ امپورٹ کریں"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BookList({
  books,
  loading,
  selectedBooks,
  onToggle,
}: {
  books: ShamelaBook[];
  loading: boolean;
  selectedBooks: Set<number>;
  onToggle: (id: number) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-xs text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin ml-2" />
        تلاش جاری ہے...
      </div>
    );
  }

  if (books.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-xs text-muted-foreground gap-2">
        <BookOpen className="h-8 w-8 text-muted-foreground/40" />
        کوئی کتاب نہیں ملی
      </div>
    );
  }

  return (
    <ScrollArea className="h-[400px] rounded border border-border">
      {books.map((book) => (
        <div
          key={book.id}
          onClick={() => onToggle(book.id)}
          className={`flex items-start gap-3 p-3 border-b border-border/50 last:border-0 cursor-pointer transition-colors hover:bg-muted/30 ${
            selectedBooks.has(book.id) ? "bg-primary/5 border-primary/30" : ""
          }`}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">{book.title}</span>
              {selectedBooks.has(book.id) && (
                <Badge variant="default" className="text-[10px] shrink-0">منتخب</Badge>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
              {book.author && (
                <span className="flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {book.author}
                </span>
              )}
              {book.category && (
                <span className="flex items-center gap-1">
                  <Layers className="h-3 w-3" />
                  {book.category}
                </span>
              )}
              {book.pageCount != null && (
                <span className="flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  {book.pageCount} صفحات
                </span>
              )}
            </div>
          </div>
          <div className={`w-5 h-5 rounded border-2 shrink-0 mt-0.5 flex items-center justify-center transition-colors ${
            selectedBooks.has(book.id)
              ? "border-primary bg-primary text-primary-foreground"
              : "border-muted-foreground/30"
          }`}>
            {selectedBooks.has(book.id) && (
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
        </div>
      ))}
    </ScrollArea>
  );
}
