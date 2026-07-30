import { useState, useEffect, useCallback } from "react";
import { isDesktop } from "@/core/backend";

const STORAGE_URL_KEY = "shamela.mcp_url";
const STORAGE_CONNECTED_KEY = "shamela.connected";

export interface ShamelaHealthResult {
  status: "ok" | "degraded";
  server_version?: string;
  downloaded_books?: number;
  catalog_books?: number;
  readable_spot_check?: { sampled: number; readable: number; unreadable_book_ids: number[] } | null;
  notes?: string[];
  error?: string;
}

export function useLocalShamela() {
  const [mcpUrl, setMcpUrlState] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_URL_KEY) || "http://127.0.0.1:8000";
    } catch {
      return "http://127.0.0.1:8000";
    }
  });

  const [connected, setConnectedState] = useState<boolean>(() => {
    if (isDesktop()) return true;
    try {
      return localStorage.getItem(STORAGE_CONNECTED_KEY) === "1";
    } catch {
      return false;
    }
  });

  const [downloadedBooks, setDownloadedBooks] = useState<number | null>(null);
  const [catalogBooks, setCatalogBooks] = useState<number | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [testing, setTesting] = useState<boolean>(false);
  const [nativePath, setNativePath] = useState<string | null>(null);
  const [masterDbPath, setMasterDbPath] = useState<string | null>(null);

  // Sync to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_URL_KEY, mcpUrl);
    } catch { /* ignore */ }
  }, [mcpUrl]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_CONNECTED_KEY, connected ? "1" : "0");
    } catch { /* ignore */ }
  }, [connected]);

  const testConnection = useCallback(async (customUrl?: string): Promise<ShamelaHealthResult | null> => {
    setTesting(true);
    try {
      if (typeof window !== "undefined" && window.electronAPI?.shamela) {
        const status = await window.electronAPI.shamela.detect();
        if (status.installed) {
          setConnectedState(true);
          setNativePath(status.path);
          setMasterDbPath(status.masterDbPath ?? null);

          // Fetch real book count from catalogue
          let realBookCount = 7000;
          if (status.masterDbPath) {
            try {
              const stats = await window.electronAPI.shamela.catalogueStats(status.masterDbPath);
              realBookCount = stats.totalBooks;
            } catch {
              // fall back to default
            }
          }

          setDownloadedBooks(realBookCount);
          setCatalogBooks(realBookCount);
          setNotes(["مقامی مکتبہ شاملہ 4 کا نیٹیو انضمام فعال ہے۔"]);
          return {
            status: "ok",
            server_version: "4.0 Native",
            downloaded_books: realBookCount,
            catalog_books: realBookCount,
            notes: ["مقامی مکتبہ شاملہ 4 کا نیٹیو انضمام فعال ہے۔"],
          };
        } else {
          setConnectedState(false);
          setNativePath(status.path);
          setNotes([status.reason || "مکتبہ شاملہ 4 کی انسٹالیشن نہیں ملی۔"]);
          return null;
        }
      }

      // Legacy Web HTTP Fallback
      const targetUrl = (customUrl || mcpUrl).replace(/\/+$/, "");
      const res = await fetch(`${targetUrl}/health`, {
        method: "GET",
        headers: { "Accept": "application/json" },
      }).catch(() => null);

      if (res && res.ok) {
        const data: ShamelaHealthResult = await res.json();
        setConnectedState(true);
        setDownloadedBooks(data.downloaded_books ?? null);
        setCatalogBooks(data.catalog_books ?? null);
        setNotes(data.notes || []);
        return data;
      } else {
        setConnectedState(false);
        setDownloadedBooks(null);
        setCatalogBooks(null);
        setNotes(["مقامی برج سرور (Local Bridge) سے جواب موصول نہیں ہوا۔"]);
        return null;
      }
    } catch (err) {
      console.error("[useLocalShamela] connection error:", err);
      setConnectedState(false);
      setDownloadedBooks(null);
      setCatalogBooks(null);
      setNotes(["کنکشن جانچنے کے دوران خرابی پیش آئی۔"]);
      return null;
    } finally {
      setTesting(false);
    }
  }, [mcpUrl]);

  useEffect(() => {
    testConnection();
  }, []);

  const setMcpUrl = (url: string) => setMcpUrlState(url);

  return {
    mcpUrl,
    setMcpUrl,
    connected,
    downloadedBooks,
    catalogBooks,
    notes,
    testing,
    nativePath,
    masterDbPath,
    testConnection,
  };
}
