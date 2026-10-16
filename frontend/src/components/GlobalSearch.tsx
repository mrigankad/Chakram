import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, CornerDownLeft, Search, Trash2 } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { AppIcon } from "@/components/AppIcon";
import { BRAND_NAME } from "@/lib/brand";
import { allSearchablePages, type NavItem } from "@/lib/nav-config";
import {
  clearSearchHistory,
  getSearchHistory,
  pushSearchHistory,
  syncSearchHistoryFromServer,
  type SearchHistoryEntry,
} from "@/lib/search-history";
import { cn } from "@/lib/utils";

type Searchable = {
  title: string;
  url: string;
  section: string;
  hint?: string;
  icon: NavItem["icon"];
};

/** Every page, including those that left the sidebar, so search still reaches them. */
const INDEX: Searchable[] = allSearchablePages().map(({ title, url, section, hint, icon }) => ({
  title,
  url,
  section,
  hint,
  icon,
}));

type GlobalSearchProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function GlobalSearch({ open, onOpenChange }: GlobalSearchProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);

  useEffect(() => {
    if (open) {
      void syncSearchHistoryFromServer().then(setHistory);
      setQuery("");
    }
  }, [open]);

  const go = useCallback(
    (item: { title: string; url: string; section?: string }) => {
      pushSearchHistory({ title: item.title, url: item.url, section: item.section });
      setHistory(getSearchHistory());
      onOpenChange(false);
      navigate(item.url);
    },
    [navigate, onOpenChange],
  );

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = !q
      ? INDEX
      : INDEX.filter((item) => {
          const hay = `${item.title} ${item.section} ${item.hint ?? ""} ${item.url}`.toLowerCase();
          return hay.includes(q);
        });

    const map = new Map<string, Searchable[]>();
    for (const item of matched) {
      const list = map.get(item.section) ?? [];
      list.push(item);
      map.set(item.section, list);
    }
    return map;
  }, [query]);

  const showHistory = query.trim().length === 0 && history.length > 0;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder={`Search pages in ${BRAND_NAME}…`}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No matching pages. Try another keyword.</CommandEmpty>

        {showHistory && (
          <>
            <div className="flex items-center justify-between px-3 pb-1 pt-2">
              <span className="text-xs font-medium text-muted-foreground">Recent</span>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => {
                  clearSearchHistory();
                  setHistory([]);
                }}
              >
                <Trash2 className="h-3 w-3" />
                Clear
              </button>
            </div>
            <CommandGroup>
              {history.map((entry) => {
                const nav = INDEX.find((i) => i.url === entry.url);
                return (
                  <CommandItem
                    key={`hist-${entry.url}`}
                    value={`recent ${entry.title} ${entry.url}`}
                    onSelect={() => go(entry)}
                    className="gap-2"
                  >
                    <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{entry.title}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {entry.section ?? nav?.section ?? entry.url}
                      </p>
                    </div>
                    <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {Array.from(grouped.entries()).map(([section, items]) => (
          <CommandGroup key={section} heading={section}>
            {items.map((item) => (
              <CommandItem
                key={item.url}
                value={`${item.title} ${item.section} ${item.hint ?? ""} ${item.url}`}
                onSelect={() => go(item)}
                className="gap-2"
              >
                <AppIcon icon={item.icon} size={16} className="text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{item.title}</p>
                  {item.hint && (
                    <p className="truncate text-[11px] text-muted-foreground">{item.hint}</p>
                  )}
                </div>
                <span className="hidden shrink-0 text-[10px] text-muted-foreground sm:inline">
                  {item.url}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
      <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <kbd className="rounded border border-border px-1 py-0.5 font-mono">↑↓</kbd> navigate
        </span>
        <span className="inline-flex items-center gap-1">
          <kbd className="rounded border border-border px-1 py-0.5 font-mono">↵</kbd> open
        </span>
        <span className="inline-flex items-center gap-1">
          <kbd className="rounded border border-border px-1 py-0.5 font-mono">esc</kbd> close
        </span>
        <span className={cn("ml-auto inline-flex items-center gap-1")}>
          <Search className="h-3 w-3" />
          {INDEX.length} pages indexed
        </span>
      </div>
    </CommandDialog>
  );
}

/** Ctrl/Cmd+K opens the global search palette. */
export function useGlobalSearchHotkey(onOpen: () => void) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpen]);
}
