// @vitest-environment node
// electron/ipc/shamelaHandlers.ts — a large `switch` (safe from the
// prototype-pollution class `workspaceHandlers.ts` had to guard against) of
// mostly thin forwarding calls into shamelaNative.ts/catalogue.ts/import.ts.
// Rather than re-proving that forwarding for all ~25 cases, this covers the
// pieces with logic that actually belongs to THIS file:
//   - readBook's page reordering: Lucene's TermRangeQuery order is not
//     guaranteed to be reading order, so the handler re-sorts numerically —
//     lexicographic sort would put page "10" before page "2".
//   - the single-in-flight-import guard (`import:books`) and cancellation —
//     the same class of module-level state machine as the tafsir install
//     flow and the voice audiobook export cancel, and just as easy to leave
//     stuck after a failure if the `finally` block is wrong.
//   - required-parameter validation, spot-checked rather than exhaustively
//     enumerated across all 9 catalogue cases (they are structurally
//     identical: `if (!masterDbPath) throw`).
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { createElectronMock } from "./helpers/electronMock";

const electron = createElectronMock();
vi.mock("electron", () => electron);

const catalogueMocks = {
  getCatalogueStats: vi.fn(() => ({ totalBooks: 10 })),
  searchBooks: vi.fn(() => [{ id: 1, title: "کتاب" }]),
  listCategories: vi.fn(() => [{ id: 1, name: "فقہ" }]),
  listBooksByCategory: vi.fn(() => []),
  listAuthors: vi.fn(() => []),
  searchAuthors: vi.fn(() => []),
  listBooksByAuthor: vi.fn(() => []),
  listPeriods: vi.fn(() => []),
  listBooksByPeriod: vi.fn(() => []),
  listBooks: vi.fn(() => [{ id: 2, title: "کتاب 2" }]),
  countBooks: vi.fn(() => 42),
  getBookPdfInfo: vi.fn(() => ({ hasPdf: true })),
  readBookPdfFile: vi.fn((): Buffer | null => Buffer.from("pdf-bytes")),
  closeCatalogueDb: vi.fn(),
};
vi.mock("../../electron/shamela/catalogue.ts", () => catalogueMocks);

const nativeMocks = {
  detectShamelaInstallation: vi.fn(async () => ({ installed: true, path: "/shamela" })),
  diagnoseShamelaInstallation: vi.fn(async () => ({ installed: true })),
  saveShamelaPath: vi.fn(),
  searchShamelaNative: vi.fn(async () => [{ bookId: "1" }]),
  readShamelaPage: vi.fn(async () => ({ text: "page text" })),
  readShamelaTocJoined: vi.fn(async () => []),
  getShamelaPageCount: vi.fn(async () => 100),
  readShamelaBook: vi.fn(
    async (_bookId: string, onPage: (p: { page: string; text: string }) => boolean | void) => {
      // Deliberately out of numeric AND out of lexicographic order, so a
      // sort bug in either direction (or no sort at all) would be visible.
      onPage({ page: "10", text: "page ten" });
      onPage({ page: "2", text: "page two" });
      onPage({ page: "1", text: "page one" });
      return { pageCount: 3 };
    },
  ),
};
vi.mock("../../electron/shamela/shamelaNative.ts", () => nativeMocks);

const estimateMocks = {
  estimateImport: vi.fn(() => ({ totalChunks: 50, estimatedTokens: 10000 })),
};
vi.mock("../../electron/shamela/estimate.ts", () => estimateMocks);

const filterAlreadyImportedMock = vi.fn(async (ids: number[]) => ids.filter((id) => id === 2));
const importShamelaBooksMock = vi.fn(
  async (args: { books: unknown[]; signal: { aborted: boolean }; onProgress?: (p: unknown) => void }) => {
    args.onProgress?.({ status: "reading", bookIndex: 1 });
    return { imported: args.books.length, cancelled: args.signal.aborted, items: [] };
  },
);
vi.mock("../../electron/ipc/workspaceHandlers.ts", () => ({
  getWorkspaceDbService: vi.fn(async () => ({
    filterAlreadyImported: filterAlreadyImportedMock,
    importShamelaBooks: importShamelaBooksMock,
  })),
}));

let mod: typeof import("../../electron/ipc/shamelaHandlers.ts");

beforeAll(async () => {
  mod = await import("../../electron/ipc/shamelaHandlers.ts");
  mod.registerShamelaHandlers();
});

beforeEach(() => {
  vi.clearAllMocks();
  importShamelaBooksMock.mockImplementation(
    async (args: { books: unknown[]; signal: { aborted: boolean }; onProgress?: (p: unknown) => void }) => {
      args.onProgress?.({ status: "reading", bookIndex: 1 });
      return { imported: args.books.length, cancelled: args.signal.aborted, items: [] };
    },
  );
});

const invoke = (payload: Record<string, unknown>) => electron.invoke("shamela:invoke", payload);
const invokeWithSender = (sender: unknown, payload: Record<string, unknown>) => {
  const fn = electron.ipcMain.handlers.get("shamela:invoke");
  if (!fn) throw new Error("no handler for shamela:invoke");
  return fn({ sender }, payload);
};

describe("registration", () => {
  it("registers both shamela channels", () => {
    expect([...electron.ipcMain.handlers.keys()].sort()).toEqual([
      "shamela:cancel-import",
      "shamela:invoke",
    ]);
  });
});

describe("simple forwarding actions", () => {
  it("detect / diagnose / search forward to shamelaNative", async () => {
    await expect(invoke({ action: "detect" })).resolves.toMatchObject({ installed: true });
    await expect(invoke({ action: "diagnose" })).resolves.toMatchObject({ installed: true });
    await invoke({ action: "search", query: "صلاة", limit: 5 });
    expect(nativeMocks.searchShamelaNative).toHaveBeenCalledWith("صلاة", 5);
  });

  it("savePath saves then re-detects", async () => {
    await invoke({ action: "savePath", path: "/new/shamela/path" });
    expect(nativeMocks.saveShamelaPath).toHaveBeenCalledWith("/new/shamela/path");
    expect(nativeMocks.detectShamelaInstallation).toHaveBeenCalled();
  });

  it("rejects an unknown action, naming it", async () => {
    await expect(invoke({ action: "not-a-real-action" })).rejects.toThrow(/not-a-real-action/);
  });
});

describe("catalogue actions — required-parameter validation", () => {
  it("forwards a well-formed stats request", async () => {
    await invoke({ action: "catalogue:stats", masterDbPath: "/master.db" });
    expect(catalogueMocks.getCatalogueStats).toHaveBeenCalledWith("/master.db");
  });

  it("refuses catalogue:stats without a masterDbPath", async () => {
    await expect(invoke({ action: "catalogue:stats" })).rejects.toThrow(/masterDbPath/);
    expect(catalogueMocks.getCatalogueStats).not.toHaveBeenCalled();
  });

  it("refuses catalogue:searchBooks without a masterDbPath", async () => {
    await expect(invoke({ action: "catalogue:searchBooks", query: "x" })).rejects.toThrow(/masterDbPath/);
  });

  it("applies default limit/offset when the caller omits them", async () => {
    await invoke({ action: "catalogue:searchBooks", masterDbPath: "/m.db", query: "x" });
    expect(catalogueMocks.searchBooks).toHaveBeenCalledWith("/m.db", "x", 50, 0);
  });

  it("forwards caller-supplied limit/offset instead of the defaults", async () => {
    await invoke({ action: "catalogue:booksByCategory", masterDbPath: "/m.db", categoryId: 3, limit: 10, offset: 20 });
    expect(catalogueMocks.listBooksByCategory).toHaveBeenCalledWith("/m.db", 3, 10, 20);
  });

  it("catalogue:listBooks forwards the flexible filter", async () => {
    await invoke({ action: "catalogue:listBooks", masterDbPath: "/m.db", filter: { century: 5, categoryId: 7 }, limit: 200 });
    expect(catalogueMocks.listBooks).toHaveBeenCalledWith("/m.db", { century: 5, categoryId: 7 }, 200, 0);
  });

  it("catalogue:countBooks forwards the filter and needs a masterDbPath", async () => {
    await invoke({ action: "catalogue:countBooks", masterDbPath: "/m.db", filter: { query: "بخاري" } });
    expect(catalogueMocks.countBooks).toHaveBeenCalledWith("/m.db", { query: "بخاري" });
    await expect(invoke({ action: "catalogue:countBooks", filter: {} })).rejects.toThrow(/masterDbPath/);
  });
});

describe("pdf:read", () => {
  it("returns a Uint8Array, not the raw Node Buffer, so it survives structured clone over IPC", async () => {
    const result = await invoke({ action: "pdf:read", masterDbPath: "/m.db", filePath: "/book.pdf" });
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result).not.toBeInstanceOf(Buffer);
    expect(new TextDecoder().decode(result as Uint8Array)).toBe("pdf-bytes");
  });

  it("refuses when either required argument is missing", async () => {
    await expect(invoke({ action: "pdf:read", masterDbPath: "/m.db" })).rejects.toThrow();
    await expect(invoke({ action: "pdf:read", filePath: "/book.pdf" })).rejects.toThrow();
  });

  it("throws a clear error when the file is not found rather than returning null over IPC", async () => {
    catalogueMocks.readBookPdfFile.mockReturnValueOnce(null);
    await expect(
      invoke({ action: "pdf:read", masterDbPath: "/m.db", filePath: "/missing.pdf" }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("readBook — page reordering", () => {
  it("sorts pages numerically, not in delivery order or lexicographic order", async () => {
    const result = (await invoke({ action: "readBook", bookId: "42" })) as {
      pages: Array<{ page: string }>;
    };
    expect(result.pages.map((p) => p.page)).toEqual(["1", "2", "10"]);
  });
});

describe("import — the single-in-flight guard and cancellation", () => {
  it("refuses a second import while one is already running", async () => {
    let resolveFirst!: () => void;
    importShamelaBooksMock.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveFirst = () => resolve({ imported: 1, cancelled: false, items: [] });
      }),
    );

    const first = invoke({ action: "import:books", books: [{ id: 1, title: "A" }] });
    await expect(
      invoke({ action: "import:books", books: [{ id: 2, title: "B" }] }),
    ).rejects.toThrow(/پہلے ہی جاری/);

    resolveFirst();
    await first;
  });

  it("allows a new import once the previous one has finished", async () => {
    await invoke({ action: "import:books", books: [{ id: 1, title: "A" }] });
    await expect(
      invoke({ action: "import:books", books: [{ id: 2, title: "B" }] }),
    ).resolves.toMatchObject({ imported: 1 });
  });

  it("allows a new import even after the previous one threw", async () => {
    importShamelaBooksMock.mockRejectedValueOnce(new Error("disk full"));
    await expect(invoke({ action: "import:books", books: [{ id: 1, title: "A" }] })).rejects.toThrow(
      "disk full",
    );
    // The `finally { importSignal = null }` must have run even on failure —
    // otherwise every import after one crash would be permanently refused.
    await expect(
      invoke({ action: "import:books", books: [{ id: 2, title: "B" }] }),
    ).resolves.toMatchObject({ imported: 1 });
  });

  it("refuses an import with no books selected", async () => {
    await expect(invoke({ action: "import:books", books: [] })).rejects.toThrow(/کوئی کتاب/);
  });

  it("streams progress to the requesting window", async () => {
    // Unlike voiceHandlers.ts/aiHandlers.ts (which call event.sender.send
    // directly), this handler resolves the window via
    // BrowserWindow.fromWebContents(event.sender) first.
    const send = vi.fn();
    electron.BrowserWindow.fromWebContents.mockReturnValueOnce({
      isDestroyed: () => false,
      webContents: { send },
    });
    await invokeWithSender(
      { id: 1 },
      { action: "import:books", books: [{ id: 1, title: "A" }] },
    );
    expect(send).toHaveBeenCalledWith(
      "shamela:import-progress",
      expect.objectContaining({ status: "reading" }),
    );
  });

  it("cancel flips the signal that a running import reads, and reports cancelled in the result", async () => {
    importShamelaBooksMock.mockImplementationOnce(
      async (args: { books: unknown[]; signal: { aborted: boolean } }) => {
        // Simulates the real service checking the signal partway through.
        return { imported: 0, cancelled: args.signal.aborted, items: [] };
      },
    );
    const importPromise = invoke({ action: "import:books", books: [{ id: 1, title: "A" }] });
    await electron.invoke("shamela:cancel-import"); // a separate channel, not a shamela:invoke action
    const result = await importPromise;
    expect(result).toMatchObject({ cancelled: true });
  });

  it("cancel-import is a safe no-op when nothing is running", async () => {
    await expect(electron.invoke("shamela:cancel-import")).resolves.toEqual({ cancelled: true });
  });
});

describe("import:alreadyImported", () => {
  it("forwards book ids and returns the filtered subset", async () => {
    const result = await invoke({ action: "import:alreadyImported", bookIds: [1, 2, 3] });
    expect(filterAlreadyImportedMock).toHaveBeenCalledWith([1, 2, 3]);
    expect(result).toEqual([2]);
  });

  it("treats a missing/non-array bookIds as empty rather than throwing", async () => {
    await expect(invoke({ action: "import:alreadyImported" })).resolves.toEqual([]);
  });
});
