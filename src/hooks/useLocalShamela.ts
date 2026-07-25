import { useState, useEffect, useCallback } from "react";

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
    const targetUrl = (customUrl || mcpUrl).replace(/\/+$/, "");
    setTesting(true);
    try {
      const res = await fetch(`${targetUrl}/health`, {
        method: "GET",
        headers: {
          "Accept": "application/json",
        },
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

  // Check health on initial mount if marked connected
  useEffect(() => {
    if (connected) {
      testConnection();
    }
  }, []); // Run once on mount

  const setMcpUrl = (url: string) => setMcpUrlState(url);

  return {
    mcpUrl,
    setMcpUrl,
    connected,
    downloadedBooks,
    catalogBooks,
    notes,
    testing,
    testConnection,
  };
}
