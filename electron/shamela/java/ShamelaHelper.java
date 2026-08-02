package com.alulama.easyeditor.shamela;

import java.io.File;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Shamela 4 Native Read Helper CLI for EasyEditor Desktop.
 *
 * ADR-0007: Read-only access to Maktaba Shamela 4's Lucene 10.4 indices.
 * Outputs clean JSON to stdout.  Zero writes to Shamela data.
 *
 * Usage:
 *   java -cp "shamela-helper.jar;lucene-core-10.4.0.jar;..." \
 *        com.alulama.easyeditor.shamela.ShamelaHelper <command> [args...]
 *
 * Commands:
 *   detect <libraryPath>              — verify installation
 *   search <indexPath> <query> [limit] — full-text search
 *   read   <indexPath> <bookId> <page> — fetch page text
 *   readBook <indexPath> <bookId> [max] — fetch every page of one book
 *   readToc <titleIndexPath> <bookId> — fetch one book's table of contents
 *   version                            — print helper version
 */
public class ShamelaHelper {

    private static final String VERSION = "1.0.0";
    private static final PrintStream OUT =
        new PrintStream(System.out, true, StandardCharsets.UTF_8);

    public static void main(String[] args) {
        if (args.length == 0) {
            printJsonError("No command provided. Usage: java -jar shamela-helper.jar <detect|search|read|version> [args...]");
            System.exit(1);
        }

        String command = args[0];

        try {
            switch (command) {
                case "version":
                    OUT.printf("{\"status\":\"success\",\"version\":\"%s\"}%n", VERSION);
                    break;

                case "detect":
                    handleDetect(args.length > 1 ? args[1] : null);
                    break;

                case "search":
                    if (args.length < 3) {
                        printJsonError("Usage: search <indexPath> <queryText> [limit]");
                        System.exit(1);
                    }
                    int limit = args.length > 3 ? Integer.parseInt(args[3]) : 20;
                    handleSearch(args[1], args[2], limit);
                    break;

                case "read":
                    if (args.length < 4) {
                        printJsonError("Usage: read <indexPath> <bookId> <pageNumber>");
                        System.exit(1);
                    }
                    handleRead(args[1], args[2], Integer.parseInt(args[3]));
                    break;
                case "readBook":
                    if (args.length < 3) {
                        printJsonError("Usage: readBook <indexPath> <bookId> [maxPages]");
                        System.exit(1);
                    }
                    int maxPages = args.length > 3 ? Integer.parseInt(args[3]) : 100000;
                    handleReadBook(args[1], args[2], maxPages);
                    break;

                case "readToc":
                    if (args.length < 3) {
                        printJsonError("Usage: readToc <titleIndexPath> <bookId>");
                        System.exit(1);
                    }
                    handleReadToc(args[1], args[2]);
                    break;

                default:
                    printJsonError("Unknown command: " + command);
                    System.exit(1);
            }
        } catch (Exception e) {
            printJsonError("Execution exception: " + e.getClass().getSimpleName() + ": " + e.getMessage());
            System.exit(1);
        }
    }

    /**
     * Verify Shamela installation at the given library path.
     * ADR-0007: Look for database/master.db, not for the program folder.
     */
    private static void handleDetect(String libraryPath) {
        if (libraryPath == null || libraryPath.trim().isEmpty()) {
            printJsonError("Library path is required for detect command.");
            return;
        }

        Path base = Paths.get(libraryPath);
        if (!Files.exists(base)) {
            OUT.printf("{\"status\":\"success\",\"installed\":false,\"reason\":\"%s\"}%n",
                escapeJson("Path does not exist: " + libraryPath));
            return;
        }

        Path masterDb = base.resolve("database/master.db");
        Path storePage = base.resolve("database/store/page");
        Path jre64 = base.resolve("app/win/64/jre/2/bin/java.exe");
        Path luceneDir = base.resolve("app/lucene/2");

        boolean masterFound = Files.exists(masterDb);
        boolean storeFound = Files.exists(storePage) && Files.isDirectory(storePage);
        boolean jreFound = Files.exists(jre64);
        boolean luceneFound = Files.exists(luceneDir) && Files.isDirectory(luceneDir);

        // Count Lucene version if available
        String luceneVersion = "unknown";
        if (luceneFound) {
            File[] jars = luceneDir.toFile().listFiles(
                (dir, name) -> name.startsWith("lucene-core-") && name.endsWith(".jar"));
            if (jars != null && jars.length > 0) {
                String name = jars[0].getName();
                int start = "lucene-core-".length();
                int end = name.length() - ".jar".length();
                if (start < end) luceneVersion = name.substring(start, end);
            }
        }

        StringBuilder sb = new StringBuilder();
        sb.append("{\"status\":\"success\",\"installed\":").append(masterFound)
          .append(",\"masterDbFound\":").append(masterFound)
          .append(",\"storeIndexFound\":").append(storeFound)
          .append(",\"jreFound\":").append(jreFound)
          .append(",\"luceneFound\":").append(luceneFound)
          .append(",\"luceneVersion\":\"").append(escapeJson(luceneVersion)).append("\"");

        if (!masterFound) {
            sb.append(",\"reason\":\"database/master.db not found\"");
        }
        sb.append("}");

        OUT.println(sb.toString());
    }

    /**
     * Full-text search over Shamela's Lucene page index.
     *
     * Attempts to load Lucene classes dynamically (they must be on the classpath).
     * If Lucene is not available, returns empty results with a diagnostic message.
     */
    private static void handleSearch(String indexPath, String queryText, int limit) {
        Path indexDir = Paths.get(indexPath);
        if (!Files.exists(indexDir) || !Files.isDirectory(indexDir)) {
            printJsonError("Index directory does not exist: " + indexPath);
            return;
        }

        // Attempt Lucene search via reflection to avoid hard compile-time dependency.
        // This allows the helper to compile without Lucene jars, but use them at runtime.
        try {
            Class<?> fsDirectoryClass = Class.forName("org.apache.lucene.store.FSDirectory");
            Class<?> directoryReaderClass = Class.forName("org.apache.lucene.index.DirectoryReader");
            Class<?> indexSearcherClass = Class.forName("org.apache.lucene.search.IndexSearcher");

            // FSDirectory.open(indexDir)
            Object directory = fsDirectoryClass.getMethod("open", Path.class).invoke(null, indexDir);

            // DirectoryReader.open(directory)
            Object reader = directoryReaderClass.getMethod("open",
                Class.forName("org.apache.lucene.store.Directory")).invoke(null, directory);

            // new IndexSearcher(reader)
            Object searcher = indexSearcherClass.getConstructor(
                Class.forName("org.apache.lucene.index.IndexReader")).newInstance(reader);

            // ADR-0007/R25: refuse outright on an unexpected Lucene major version rather
            // than returning results read with the wrong codec.
            assertLuceneVersion();

            // Build query: throws if QueryParser cannot be constructed — never silently
            // substitutes a query that would match every document (see buildQuery below).
            Object query = buildQuery(queryText);

            // searcher.search(query, limit)
            Object topDocs = indexSearcherClass.getMethod("search",
                Class.forName("org.apache.lucene.search.Query"), int.class)
                .invoke(searcher, query, limit);

            // Extract results
            Object[] scoreDocs = (Object[]) topDocs.getClass().getField("scoreDocs").get(topDocs);

            StringBuilder sb = new StringBuilder();
            sb.append("{\"status\":\"success\",\"query\":\"").append(escapeJson(queryText))
              .append("\",\"total\":").append(scoreDocs.length)
              .append(",\"results\":[");

            for (int i = 0; i < scoreDocs.length; i++) {
                if (i > 0) sb.append(",");
                int docId = (int) scoreDocs[i].getClass().getField("doc").get(scoreDocs[i]);
                float score = (float) scoreDocs[i].getClass().getField("score").get(scoreDocs[i]);

                // searcher.storedFields().document(docId)
                Object storedFields = indexSearcherClass.getMethod("storedFields").invoke(searcher);
                Object doc = storedFields.getClass().getMethod("document", int.class).invoke(storedFields, docId);

                // The page index stores id = "<bookId>-<pageId>" and text in `body`.
                String id = getField(doc, "id");
                String body = getField(doc, "body");

                String bookIdStr = "";
                String pageStr = "0";
                if (id != null) {
                    int dash = id.indexOf('-');
                    if (dash >= 0) {
                        bookIdStr = id.substring(0, dash);
                        pageStr = id.substring(dash + 1);
                    }
                }

                String snippet = body != null ? body.substring(0, Math.min(body.length(), 300)) : "";

                sb.append("{\"bookId\":\"").append(escapeJson(bookIdStr != null ? bookIdStr : ""))
                  .append("\",\"bookTitle\":\"\",\"pageNumber\":")
                  .append(pageStr != null ? pageStr : "0")
                  .append(",\"snippet\":\"").append(escapeJson(snippet))
                  .append("\",\"score\":").append(score).append("}");
            }

            sb.append("]}");
            OUT.println(sb.toString());

            // Close reader
            reader.getClass().getMethod("close").invoke(reader);

        } catch (ClassNotFoundException e) {
            // Lucene classes not on the classpath — this is a hard failure, not an
            // empty-results case (SPEC-M5 risk R25): a reference tool must never
            // present "not searched" as "nothing found".
            printJsonError("Lucene classes not found on classpath (" + e.getMessage()
                + "). Shamela's app/lucene/2/*.jar must be on the classpath.");
            System.exit(1);
        } catch (Exception e) {
            printJsonError("Search failed: " + e.getClass().getSimpleName() + ": " + e.getMessage());
            System.exit(1);
        }
    }

    /** ADR-0007/R25: the Lucene major version this helper was built and tested against. */
    private static final int EXPECTED_LUCENE_MAJOR = 10;

    /**
     * Refuses to proceed if the Lucene jars on the classpath are a different major
     * version than expected. A codec mismatch does not raise a clean error on its
     * own — it can silently produce mangled Arabic text, which is the worst possible
     * failure mode for a citation tool (SPEC-M5 risk R25).
     */
    private static void assertLuceneVersion() throws Exception {
        Class<?> versionClass = Class.forName("org.apache.lucene.util.Version");
        Object latest = versionClass.getField("LATEST").get(null);
        String v = latest.toString();
        int major = Integer.parseInt(v.split("\\.")[0]);
        if (major != EXPECTED_LUCENE_MAJOR) {
            throw new IllegalStateException(
                "Unsupported Lucene major version: found " + v + ", expected " + EXPECTED_LUCENE_MAJOR + ".x");
        }
    }

    /**
     * Build a Lucene query from the text via QueryParser + StandardAnalyzer.
     *
     * ⛔ No MatchAllDocsQuery fallback. Returning "every document in the index" when
     * the parser cannot be constructed would present a wall of unrelated pages as if
     * they were search results — worse than an empty result, and worse than an error,
     * for a citation tool (ADR-0007).
     */
    private static Object buildQuery(String queryText) throws Exception {
        Class<?> analyzerClass = Class.forName("org.apache.lucene.analysis.standard.StandardAnalyzer");
        Class<?> queryParserClass = Class.forName("org.apache.lucene.queryparser.classic.QueryParser");
        Object analyzer = analyzerClass.getConstructor().newInstance();
        Object parser = queryParserClass.getConstructor(String.class,
            Class.forName("org.apache.lucene.analysis.Analyzer")).newInstance("body", analyzer);
        return queryParserClass.getMethod("parse", String.class).invoke(parser, queryText);
    }

    /**
     * Get a stored field value from a Lucene Document via reflection.
     */
    private static String getField(Object doc, String fieldName) {
        try {
            return (String) doc.getClass().getMethod("get", String.class).invoke(doc, fieldName);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Read a specific page from the Lucene index.
     *
     * The page index (unlike an assumed `book_id`/`page` schema) stores each
     * page as a document with `id` = "<bookId>-<pageId>" and `body` holding the
     * page's HTML. `<pageId>` is the same sequential id used by the book's own
     * SQLite `page`/`title` tables, so the caller passes the id it already has.
     */
    private static void handleRead(String indexPath, String bookId, int pageNumber) {
        Path indexDir = Paths.get(indexPath);
        if (!Files.exists(indexDir) || !Files.isDirectory(indexDir)) {
            printJsonError("Index directory does not exist: " + indexPath);
            return;
        }

        try {
            Class<?> fsDirectoryClass = Class.forName("org.apache.lucene.store.FSDirectory");
            Class<?> directoryReaderClass = Class.forName("org.apache.lucene.index.DirectoryReader");
            Class<?> indexSearcherClass = Class.forName("org.apache.lucene.search.IndexSearcher");
            Class<?> termQueryClass = Class.forName("org.apache.lucene.search.TermQuery");
            Class<?> termClass = Class.forName("org.apache.lucene.index.Term");

            // ADR-0007/R25: refuse on an unexpected Lucene major version rather than
            // risk reading page text back through the wrong codec (mangled Arabic).
            assertLuceneVersion();

            Object directory = fsDirectoryClass.getMethod("open", Path.class).invoke(null, indexDir);
            Object reader = directoryReaderClass.getMethod("open",
                Class.forName("org.apache.lucene.store.Directory")).invoke(null, directory);
            Object searcher = indexSearcherClass.getConstructor(
                Class.forName("org.apache.lucene.index.IndexReader")).newInstance(reader);

            // id = "<bookId>-<pageId>" — a single TermQuery, no boolean join needed.
            String idValue = bookId + "-" + pageNumber;
            Object term = termClass.getConstructor(String.class, String.class).newInstance("id", idValue);
            Object query = termQueryClass.getConstructor(termClass).newInstance(term);

            Object topDocs = indexSearcherClass.getMethod("search",
                Class.forName("org.apache.lucene.search.Query"), int.class)
                .invoke(searcher, query, 1);

            Object[] scoreDocs = (Object[]) topDocs.getClass().getField("scoreDocs").get(topDocs);

            if (scoreDocs.length > 0) {
                int docId = (int) scoreDocs[0].getClass().getField("doc").get(scoreDocs[0]);
                Object storedFields = indexSearcherClass.getMethod("storedFields").invoke(searcher);
                Object doc = storedFields.getClass().getMethod("document", int.class).invoke(storedFields, docId);
                String body = getField(doc, "body");
                String foot = getField(doc, "foot");

                OUT.printf("{\"status\":\"success\",\"bookId\":\"%s\",\"pageNumber\":%d,\"text\":\"%s\",\"footnotes\":\"%s\"}%n",
                    escapeJson(bookId), pageNumber,
                    escapeJson(body != null ? body : ""),
                    escapeJson(foot != null ? foot : ""));
            } else {
                OUT.printf("{\"status\":\"success\",\"bookId\":\"%s\",\"pageNumber\":%d,\"text\":\"\",\"footnotes\":\"\"}%n",
                    escapeJson(bookId), pageNumber);
            }

            reader.getClass().getMethod("close").invoke(reader);

        } catch (ClassNotFoundException e) {
            // Same as handleSearch: a missing Lucene classpath is a hard failure, not
            // an empty page (SPEC-M5 risk R25) — an empty "success" here would read as
            // "this page is blank" instead of "the page was never actually read".
            printJsonError("Lucene classes not found on classpath (" + e.getMessage()
                + "). Shamela's app/lucene/2/*.jar must be on the classpath.");
            System.exit(1);
        } catch (Exception e) {
            printJsonError("Read failed: " + e.getClass().getSimpleName() + ": " + e.getMessage());
            System.exit(1);
        }
    }

    /**
     * Reads every page of one book in a single JVM.
     *
     * SPEC-M5.9 risk N4: the per-page `read` command spawns a JVM per call, so
     * importing a 500-page book would start 500 of them — the JVM startup cost
     * alone would dominate the import. One spawn opens the index once and
     * walks the book's pages in order.
     *
     * Pages are emitted as one JSON object per line rather than a single
     * document, so the caller can process and free them as they arrive instead
     * of holding an entire book in memory twice.
     */
    private static void handleReadBook(String indexPath, String bookId, int maxPages) {
        Path indexDir = Paths.get(indexPath);
        if (!Files.exists(indexDir) || !Files.isDirectory(indexDir)) {
            printJsonError("Index directory does not exist: " + indexPath);
            return;
        }

        try {
            Class<?> fsDirectoryClass = Class.forName("org.apache.lucene.store.FSDirectory");
            Class<?> directoryReaderClass = Class.forName("org.apache.lucene.index.DirectoryReader");
            Class<?> indexSearcherClass = Class.forName("org.apache.lucene.search.IndexSearcher");

            // ADR-0007/R25: refuse on an unexpected Lucene major rather than
            // read page text back through the wrong codec (mangled Arabic).
            assertLuceneVersion();

            Object directory = fsDirectoryClass.getMethod("open", Path.class).invoke(null, indexDir);
            Object reader = directoryReaderClass.getMethod("open",
                Class.forName("org.apache.lucene.store.Directory")).invoke(null, directory);
            Object searcher = indexSearcherClass.getConstructor(
                Class.forName("org.apache.lucene.index.IndexReader")).newInstance(reader);

            Class<?> termRangeQueryClass = Class.forName("org.apache.lucene.search.TermRangeQuery");

            // id in [<bookId>-, <bookId>-\uffff] covers every page of the book.
            Object query = termRangeQueryClass.getMethod("newStringRange",
                String.class, String.class, String.class, boolean.class, boolean.class)
                .invoke(null, "id", bookId + "-", bookId + "-\uffff", true, true);

            Object topDocs = indexSearcherClass.getMethod("search",
                Class.forName("org.apache.lucene.search.Query"), int.class)
                .invoke(searcher, query, maxPages);

            Object[] scoreDocs = (Object[]) topDocs.getClass().getField("scoreDocs").get(topDocs);
            Object storedFields = indexSearcherClass.getMethod("storedFields").invoke(searcher);

            OUT.printf("{\"status\":\"success\",\"bookId\":\"%s\",\"pageCount\":%d}%n",
                escapeJson(bookId), scoreDocs.length);

            for (Object scoreDoc : scoreDocs) {
                int docId = (int) scoreDoc.getClass().getField("doc").get(scoreDoc);
                Object doc = storedFields.getClass().getMethod("document", int.class).invoke(storedFields, docId);

                String id = getField(doc, "id");
                String body = getField(doc, "body");
                String foot = getField(doc, "foot");

                // id = "<bookId>-<pageId>"
                String pageId = "";
                if (id != null) {
                    int dash = id.indexOf('-');
                    if (dash >= 0) pageId = id.substring(dash + 1);
                }

                OUT.printf("{\"page\":\"%s\",\"text\":\"%s\",\"footnotes\":\"%s\"}%n",
                    escapeJson(pageId),
                    escapeJson(body != null ? body : ""),
                    escapeJson(foot != null ? foot : ""));
            }

            reader.getClass().getMethod("close").invoke(reader);

        } catch (ClassNotFoundException e) {
            printJsonError("Lucene classes not found on classpath (" + e.getMessage()
                + "). Shamela's app/lucene/2/*.jar must be on the classpath.");
            System.exit(1);
        } catch (Exception e) {
            printJsonError("readBook failed: " + e.getClass().getSimpleName() + ": " + e.getMessage());
            System.exit(1);
        }
    }

    /**
     * Reads one book's table of contents from the global `store/title` index.
     *
     * The title index stores every book's headings as documents with
     *   id   = "<bookId>-<titleId>"   (stored)
     *   body = heading text           (stored)
     * Page numbers and the heading tree (parent links) live in each book's
     * own SQLite `title(id, page, parent)` table, so this command returns only
     * the Lucene side ({titleId, text}) and lets the caller join it with the
     * SQLite side for page numbers and hierarchy.
     *
     * Titles are emitted as one JSON object per line (like readBook) so a book
     * with a very long TOC streams instead of being held as one giant string.
     */
    private static void handleReadToc(String titleIndexPath, String bookId) {
        Path indexDir = Paths.get(titleIndexPath);
        if (!Files.exists(indexDir) || !Files.isDirectory(indexDir)) {
            printJsonError("Title index directory does not exist: " + titleIndexPath);
            return;
        }

        try {
            Class<?> fsDirectoryClass = Class.forName("org.apache.lucene.store.FSDirectory");
            Class<?> directoryReaderClass = Class.forName("org.apache.lucene.index.DirectoryReader");
            Class<?> indexSearcherClass = Class.forName("org.apache.lucene.search.IndexSearcher");
            Class<?> termRangeQueryClass = Class.forName("org.apache.lucene.search.TermRangeQuery");
            Class<?> termClass = Class.forName("org.apache.lucene.index.Term");

            // ADR-0007/R25: refuse on an unexpected Lucene major rather than
            // read titles back through the wrong codec (mangled Arabic).
            assertLuceneVersion();

            Object directory = fsDirectoryClass.getMethod("open", Path.class).invoke(null, indexDir);
            Object reader = directoryReaderClass.getMethod("open",
                Class.forName("org.apache.lucene.store.Directory")).invoke(null, directory);
            Object searcher = indexSearcherClass.getConstructor(
                Class.forName("org.apache.lucene.index.IndexReader")).newInstance(reader);

            // id in [<bookId>-, <bookId>-\uffff] covers every titleId for the book.
            String lo = bookId + "-";
            String hi = bookId + "-\uffff";
            Object query = termRangeQueryClass.getMethod("newStringRange",
                String.class, String.class, String.class, boolean.class, boolean.class)
                .invoke(null, "id", lo, hi, true, true);

            Object topDocs = indexSearcherClass.getMethod("search",
                Class.forName("org.apache.lucene.search.Query"), int.class)
                .invoke(searcher, query, 100000);

            Object[] scoreDocs = (Object[]) topDocs.getClass().getField("scoreDocs").get(topDocs);
            Object storedFields = indexSearcherClass.getMethod("storedFields").invoke(searcher);

            OUT.printf("{\"status\":\"success\",\"bookId\":\"%s\",\"titleCount\":%d}%n",
                escapeJson(bookId), scoreDocs.length);

            for (Object scoreDoc : scoreDocs) {
                int docId = (int) scoreDoc.getClass().getField("doc").get(scoreDoc);
                Object doc = storedFields.getClass().getMethod("document", int.class).invoke(storedFields, docId);

                String id = getField(doc, "id");
                String body = getField(doc, "body");

                // id = "<bookId>-<titleId>"; emit titleId separately for easy joining.
                String titleId = "";
                if (id != null) {
                    int dash = id.indexOf('-');
                    if (dash >= 0) titleId = id.substring(dash + 1);
                }

                OUT.printf("{\"titleId\":\"%s\",\"text\":\"%s\"}%n",
                    escapeJson(titleId),
                    escapeJson(body != null ? body : ""));
            }

            reader.getClass().getMethod("close").invoke(reader);

        } catch (ClassNotFoundException e) {
            printJsonError("Lucene classes not found on classpath (" + e.getMessage()
                + "). Shamela's app/lucene/2/*.jar must be on the classpath.");
            System.exit(1);
        } catch (Exception e) {
            printJsonError("readToc failed: " + e.getClass().getSimpleName() + ": " + e.getMessage());
            System.exit(1);
        }
    }

    private static void printJsonError(String message) {
        OUT.printf("{\"status\":\"error\",\"message\":\"%s\"}%n", escapeJson(message));
    }

    private static String escapeJson(String raw) {
        if (raw == null) return "";
        return raw.replace("\\", "\\\\")
                  .replace("\"", "\\\"")
                  .replace("\n", "\\n")
                  .replace("\r", "\\r")
                  .replace("\t", "\\t");
    }
}
