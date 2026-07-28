import { useEffect, useState } from "react";
import { BookOpen, FileText, Database, Music, FileCheck, Bookmark } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { libraryItemService, type LibraryItem } from "@/core/workspace/libraryItemService";

const KIND_ICONS: Record<string, React.ElementType> = {
  book: BookOpen,
  pdf: FileText,
  audio: Music,
  ocr: FileCheck,
  reference: Database,
  note: Bookmark,
};

export function LibrarySourcesTab() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    libraryItemService.listItems().then((res) => {
      if (isMounted) {
        setItems(res);
        setLoading(false);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="p-4 text-xs text-muted-foreground text-center py-8">
        لوڈ ہو رہا ہے…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <ScrollArea className="h-full">
        <div className="p-3 text-xs text-muted-foreground text-center py-8 space-y-2">
          <Database className="h-6 w-6 mx-auto opacity-50 text-primary" />
          <p className="font-semibold text-foreground">Library Sources</p>
          <p className="text-[11px]">کوئی مآخذ یا کتب پائے نہیں گئے۔</p>
        </div>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-2 space-y-1">
        {items.map((item) => {
          const Icon = KIND_ICONS[item.kind] || Database;
          return (
            <div
              key={item.id}
              className="flex items-center gap-2 p-2 rounded-md hover:bg-accent/50 text-xs transition-colors cursor-pointer"
            >
              <Icon className="h-4 w-4 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate text-foreground">{item.title}</p>
                <p className="text-[10px] text-muted-foreground capitalize">{item.kind}</p>
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
