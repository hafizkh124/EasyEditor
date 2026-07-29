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

                String nass = getField(doc, "nass");  // page text field in Shamela
                String bookIdStr = getField(doc, "book_id");
                String pageStr = getField(doc, "page");

                String snippet = nass != null ? nass.substring(0, Math.min(nass.length(), 300)) : "";

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
            Class.forName("org.apache.lucene.analysis.Analyzer")).newInstance("nass", analyzer);
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

            // ADR-0007/R25: refuse on an unexpected Lucene major version rather than
            // risk reading page text back through the wrong codec (mangled Arabic).
            assertLuceneVersion();

            Object directory = fsDirectoryClass.getMethod("open", Path.class).invoke(null, indexDir);
            Object reader = directoryReaderClass.getMethod("open",
                Class.forName("org.apache.lucene.store.Directory")).invoke(null, directory);
            Object searcher = indexSearcherClass.getConstructor(
                Class.forName("org.apache.lucene.index.IndexReader")).newInstance(reader);

            // Build BooleanQuery: book_id = bookId AND page = pageNumber
            Class<?> booleanQueryBuilderClass = Class.forName("org.apache.lucene.search.BooleanQuery$Builder");
            Class<?> termQueryClass = Class.forName("org.apache.lucene.search.TermQuery");
            Class<?> termClass = Class.forName("org.apache.lucene.index.Term");
            Class<?> occurClass = Class.forName("org.apache.lucene.search.BooleanClause$Occur");

            Object builder = booleanQueryBuilderClass.getConstructor().newInstance();
            Object bookTerm = termClass.getConstructor(String.class, String.class).newInstance("book_id", bookId);
            Object bookQuery = termQueryClass.getConstructor(termClass).newInstance(bookTerm);
            Object pageTerm = termClass.getConstructor(String.class, String.class).newInstance("page", String.valueOf(pageNumber));
            Object pageQuery = termQueryClass.getConstructor(termClass).newInstance(pageTerm);

            Object must = occurClass.getField("MUST").get(null);

            builder.getClass().getMethod("add", Class.forName("org.apache.lucene.search.Query"), occurClass)
                .invoke(builder, bookQuery, must);
            builder.getClass().getMethod("add", Class.forName("org.apache.lucene.search.Query"), occurClass)
                .invoke(builder, pageQuery, must);

            Object booleanQuery = builder.getClass().getMethod("build").invoke(builder);

            // Execute search
            Object topDocs = indexSearcherClass.getMethod("search",
                Class.forName("org.apache.lucene.search.Query"), int.class)
                .invoke(searcher, booleanQuery, 1);

            Object[] scoreDocs = (Object[]) topDocs.getClass().getField("scoreDocs").get(topDocs);

            if (scoreDocs.length > 0) {
                int docId = (int) scoreDocs[0].getClass().getField("doc").get(scoreDocs[0]);
                Object storedFields = indexSearcherClass.getMethod("storedFields").invoke(searcher);
                Object doc = storedFields.getClass().getMethod("document", int.class).invoke(storedFields, docId);
                String nass = getField(doc, "nass");
                String volume = getField(doc, "part");

                OUT.printf("{\"status\":\"success\",\"bookId\":\"%s\",\"pageNumber\":%d,\"text\":\"%s\",\"volume\":\"%s\"}%n",
                    escapeJson(bookId), pageNumber,
                    escapeJson(nass != null ? nass : ""),
                    escapeJson(volume != null ? volume : ""));
            } else {
                OUT.printf("{\"status\":\"success\",\"bookId\":\"%s\",\"pageNumber\":%d,\"text\":\"\",\"volume\":\"\"}%n",
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
