import { useRef } from "react";
import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";

interface UserSearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

const UserSearchBar = ({ value, onChange }: UserSearchBarProps) => {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="relative">
      <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("admin.search_placeholder")}
        className="ps-9 pe-9"
      />
      {value && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute end-1 top-1/2 -translate-y-1/2 h-7 w-7"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          aria-label="Clear search">
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
};

export default UserSearchBar;
