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

            // Build query: use QueryParser if available, otherwise TermQuery
            Object query = buildQuery(queryText);

            if (query != null) {
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
            } else {
                OUT.printf("{\"status\":\"success\",\"query\":\"%s\",\"total\":0,\"results\":[]}%n",
                    escapeJson(queryText));
            }

            // Close reader
            reader.getClass().getMethod("close").invoke(reader);

        } catch (ClassNotFoundException e) {
            // Lucene not on classpath — return helpful message
            OUT.printf("{\"status\":\"success\",\"query\":\"%s\",\"total\":0,\"results\":[],\"note\":\"Lucene jars not on classpath. Ensure Shamela lucene directory is included.\"}%n",
                escapeJson(queryText));
        } catch (Exception e) {
            printJsonError("Search failed: " + e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    /**
     * Build a Lucene query from the text. Uses QueryParser if available, otherwise MatchAllDocsQuery.
     */
    private static Object buildQuery(String queryText) {
        try {
            // Try QueryParser with StandardAnalyzer
            Class<?> analyzerClass = Class.forName("org.apache.lucene.analysis.standard.StandardAnalyzer");
            Class<?> queryParserClass = Class.forName("org.apache.lucene.queryparser.classic.QueryParser");
            Object analyzer = analyzerClass.getConstructor().newInstance();
            Object parser = queryParserClass.getConstructor(String.class,
                Class.forName("org.apache.lucene.analysis.Analyzer")).newInstance("nass", analyzer);
            return queryParserClass.getMethod("parse", String.class).invoke(parser, queryText);
        } catch (Exception e) {
            // Fall back to MatchAllDocsQuery
            try {
                Class<?> matchAllClass = Class.forName("org.apache.lucene.search.MatchAllDocsQuery");
                return matchAllClass.getConstructor().newInstance();
            } catch (Exception ex) {
                return null;
            }
        }
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
            OUT.printf("{\"status\":\"success\",\"bookId\":\"%s\",\"pageNumber\":%d,\"text\":\"\",\"note\":\"Lucene jars not on classpath.\"}%n",
                escapeJson(bookId), pageNumber);
        } catch (Exception e) {
            printJsonError("Read failed: " + e.getClass().getSimpleName() + ": " + e.getMessage());
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
