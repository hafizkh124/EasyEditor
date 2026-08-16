import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';
import * as reader from './reader.mjs';
import { takeRevealOnceToken, isAuthorized } from './auth.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Port and Host settings - STRICT SECURITY
const PORT = process.env.PORT || 8000;
const HOST = '127.0.0.1'; // Bind exclusively to loopback to prevent external exposure

// Allowed Origins for CORS
const ALLOWED_ORIGINS = [
  'https://editor.alulama.org',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

// Utility to clean raw HTML tags (<mark>, <span>, etc.) from Lucene snippets
function stripHtml(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

// Lazy-loaded backend and server instance
let backendPromise = null;
let shamelaModule = null;

async function getShamelaModule() {
  if (shamelaModule) return shamelaModule;

  // Search candidate paths for shamela-mcp
  const candidatePaths = [
    process.env.SHAMELA_MCP_PATH,
    'D:\\shamela-mcp-1.2.0',
    'D:\\shamela-mcp',
    path.join(__dirname, '..', '..', '..', 'shamela-mcp-1.2.0'),
    path.join(__dirname, 'vendor', 'shamela-mcp'),
  ].filter(Boolean);

  for (const p of candidatePaths) {
    const distPath = path.join(p, 'dist', 'index.js');
    const srcPath = path.join(p, 'src', 'server', 'index.js');
    if (fs.existsSync(distPath)) {
      console.log(`[Bridge] Loading shamela-mcp from: ${distPath}`);
      shamelaModule = await import(pathToFileURL(distPath).href);
      return shamelaModule;
    }
    if (fs.existsSync(srcPath)) {
      console.log(`[Bridge] Loading shamela-mcp from: ${srcPath}`);
      shamelaModule = await import(pathToFileURL(srcPath).href);
      return shamelaModule;
    }
  }

  // AUTO-EXTRACT FALLBACK: If D:\shamela-mcp-1.2.0.mcpb or D:\shamela-mcp-1.2.0.zip exists, auto-extract
  const archiveCandidates = [
    'D:\\shamela-mcp-1.2.0.mcpb',
    'D:\\shamela-mcp-1.2.0.zip',
  ];

  for (const archivePath of archiveCandidates) {
    if (fs.existsSync(archivePath)) {
      const destDir = 'D:\\shamela-mcp-1.2.0';
      console.log(`[Bridge] Auto-extracting ${archivePath} to ${destDir}...`);
      try {
        fs.mkdirSync(destDir, { recursive: true });
        execSync(`tar -xf "${archivePath}" -C "${destDir}"`);
        console.log(`[Bridge] Auto-extracted successfully!`);

        const distPath = path.join(destDir, 'dist', 'index.js');
        const srcPath = path.join(destDir, 'src', 'server', 'index.js');
        if (fs.existsSync(distPath)) {
          console.log(`[Bridge] Loading shamela-mcp from: ${distPath}`);
          shamelaModule = await import(pathToFileURL(distPath).href);
          return shamelaModule;
        }
        if (fs.existsSync(srcPath)) {
          console.log(`[Bridge] Loading shamela-mcp from: ${srcPath}`);
          shamelaModule = await import(pathToFileURL(srcPath).href);
          return shamelaModule;
        }
      } catch (extractErr) {
        console.error(`[Bridge] Failed auto-extraction of ${archivePath}:`, extractErr);
      }
    }
  }

  throw new Error(`Could not find shamela-mcp installation. Please set SHAMELA_MCP_PATH or place shamela-mcp-1.2.0 in D:\\`);
}

async function getBackendAndServer() {
  if (!backendPromise) {
    backendPromise = (async () => {
      const mod = await getShamelaModule();
      if (typeof mod.createBackend !== 'function' || typeof mod.createServer !== 'function') {
        throw new Error('createBackend or createServer function not found in shamela-mcp module');
      }
      console.log('[Bridge] Initializing Shamela Backend...');
      const backend = await mod.createBackend();
      const serverInstance = mod.createServer(async () => backend);
      console.log('[Bridge] Backend initialized successfully!');
      return { backend, serverInstance, mod };
    })();
  }
  return backendPromise;
}

function setCorsAndPnaHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && (ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.alulama.org'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://editor.alulama.org');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Bridge-Token, Access-Control-Request-Private-Network');
  // CRITICAL SECURITY HEADER: Chrome Private Network Access (PNA)
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

const server = http.createServer(async (req, res) => {
  // 1. SECURITY CHECK: Exact Host Header Verification (DNS Rebinding Protection)
  const host = req.headers.host || '';
  const validHost = host === '127.0.0.1:8000' || host === 'localhost:8000' || host === '127.0.0.1' || host === 'localhost';
  if (!validHost) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden: Invalid Host Header' }));
    return;
  }

  // 2. CORS & PNA Preflight Handling
  setCorsAndPnaHeaders(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // 3. GET /health Endpoint
  if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
    try {
      const { backend, serverInstance } = await getBackendAndServer();
      const tool = serverInstance._registeredTools?.['shamela_health'];
      let healthData = null;

      if (tool) {
        const response = await tool.handler({ response_format: 'json' });
        healthData = response.structuredContent;
      }

      if (!healthData) {
        const downloaded = backend.catalog.downloadedBookIds();
        healthData = {
          status: 'ok',
          server_version: '1.2.0',
          downloaded_books: downloaded.size,
          catalog_books: backend.catalog.bookCount(),
          catalog_authors: backend.catalog.authorCount(),
          categories: backend.catalog.categoryCount(),
          readable_spot_check: null,
          notes: []
        };
      }

      // Trust-on-first-use pairing (auth.mjs): revealed to exactly one
      // request, ever. Every other endpoint then requires it — see auth.mjs
      // for why /health itself stays open.
      const pairingToken = takeRevealOnceToken();
      if (pairingToken) {
        healthData = { ...healthData, pairingToken };
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(healthData));
    } catch (err) {
      console.error('[Bridge] Health check error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'degraded',
        error: err.message,
        downloaded_books: 0,
        notes: [err.message]
      }));
    }
    return;
  }

  // 3b. Session token (auth.mjs): every endpoint below reads the user's
  // library, so all of them require pairing. /health above stays open —
  // it is the only route a client can call before it has a token.
  if (!isAuthorized(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Missing or invalid bridge token. If this is a fresh connection, reload the app so it can pair via /health; if pairing was lost, delete .bridge-token.json next to server.mjs and restart the bridge.',
    }));
    return;
  }

  // ── Catalogue endpoints (UX-v1 P7) ──────────────────────────────────
  // Browse only — categories, authors, periods, books-by-X, stats. Uses the
  // same low-level `backend.catalog.*` methods the /health endpoint already
  // proves work, rather than replicating the MCP tools' JSON-schema argument
  // shapes; author search goes through the registered-tool layer (Lucene),
  // the same way /search already does.
  if (req.method === 'GET' && url.pathname === '/catalogue/stats') {
    try {
      const { backend } = await getBackendAndServer();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        totalBooks: backend.catalog.bookCount(),
        totalAuthors: backend.catalog.authorCount(),
        totalCategories: backend.catalog.categoryCount(),
      }));
    } catch (err) {
      console.error('[Bridge] catalogue/stats error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/catalogue/categories') {
    try {
      const { backend } = await getBackendAndServer();
      const cats = backend.catalog.listCategories().map((c) => ({
        id: c.category_id,
        name: stripHtml(c.category_name),
        bookCount: backend.catalog.booksInCategory(c.category_id).length,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cats));
    } catch (err) {
      console.error('[Bridge] catalogue/categories error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/catalogue/periods') {
    try {
      const { backend } = await getBackendAndServer();
      const counts = new Map();
      for (const b of backend.catalog.allBooks()) {
        if (b.book_date === null || b.book_date === undefined) continue;
        const century = Math.max(1, Math.ceil(b.book_date / 100));
        counts.set(century, (counts.get(century) || 0) + 1);
      }
      const periods = [...counts.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([century, bookCount]) => ({
          century,
          label: `القرن ${century} الهجري`,
          bookCount,
        }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(periods));
    } catch (err) {
      console.error('[Bridge] catalogue/periods error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/catalogue/books') {
    try {
      const { backend } = await getBackendAndServer();
      const categoryId = url.searchParams.get('categoryId');
      const authorId = url.searchParams.get('authorId');
      const century = url.searchParams.get('century');
      const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 200);
      const offset = Number(url.searchParams.get('offset')) || 0;

      let bookIds;
      if (categoryId !== null) {
        bookIds = backend.catalog.booksInCategory(Number(categoryId));
      } else if (authorId !== null) {
        bookIds = backend.catalog.booksByAuthorId(Number(authorId));
      } else if (century !== null) {
        const c = Number(century);
        bookIds = backend.catalog.allBooks()
          .filter((b) => b.book_date != null && Math.max(1, Math.ceil(b.book_date / 100)) === c)
          .map((b) => b.book_id);
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'One of categoryId, authorId, century is required' }));
        return;
      }

      const page = bookIds.slice(offset, offset + limit).map((id) => {
        const rec = backend.catalog.bookRecord(id);
        if (!rec) return null;
        const mainAuthor = rec.main_author != null ? backend.catalog.authorRecord(rec.main_author) : null;
        return {
          id: rec.book_id,
          title: stripHtml(rec.book_name),
          author: rec.main_author != null ? stripHtml(backend.catalog.mainAuthorName(rec) || '') || null : null,
          category: backend.catalog.categoryPath(rec.book_category)[0] ?? null,
          deathYear: mainAuthor?.death_year ?? null,
          bookType: rec.book_type ?? null,
        };
      }).filter(Boolean);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(page));
    } catch (err) {
      console.error('[Bridge] catalogue/books error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/catalogue/authors') {
    try {
      const query = (url.searchParams.get('q') || '').trim();
      const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 200);
      const offset = Number(url.searchParams.get('offset')) || 0;

      // No low-level "list all ~3,100 authors" method exists in the wrapped
      // package, only a Lucene name search — an empty query on web returns
      // an honest empty list rather than guessing at pagination over nothing.
      if (!query) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
        return;
      }

      const { backend, serverInstance } = await getBackendAndServer();
      const tool = serverInstance._registeredTools?.['shamela_search_authors'];
      if (!tool) throw new Error('shamela_search_authors tool handler not found');

      const response = await tool.handler({ query, limit, offset, response_format: 'json' });
      const results = response.structuredContent?.results || [];

      const authors = results.map((r) => ({
        id: r.author_id,
        name: stripHtml(r.author_name || ''),
        deathNumber: r.death_year ?? null,
        deathText: r.death_year ? null : (backend.catalog.authorRecord(r.author_id)?.death_text ?? null),
        bookCount: r.book_count ?? backend.catalog.booksByAuthorId(r.author_id).length,
        alpha: null,
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(authors));
    } catch (err) {
      console.error('[Bridge] catalogue/authors error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 4. POST /search Endpoint
  if (req.method === 'POST' && url.pathname === '/search') {
    let bodyText = '';
    req.on('data', chunk => { bodyText += chunk; });
    req.on('end', async () => {
      try {
        const body = JSON.parse(bodyText || '{}');
        const query = body.query;
        if (!query || typeof query !== 'string' || !query.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Query parameter is required' }));
          return;
        }

        const { serverInstance } = await getBackendAndServer();
        const tool = serverInstance._registeredTools?.['shamela_search_pages'];

        if (!tool) {
          throw new Error('shamela_search_pages tool handler not found');
        }

        const limit = typeof body.limit === 'number' ? Math.min(body.limit, 50) : 20;
        const page = typeof body.page === 'number' && body.page > 0 ? body.page : 1;
        const offset = (page - 1) * limit;

        const response = await tool.handler({
          query: query.trim(),
          scope: body.scope || { downloaded_only: true },
          offset,
          limit,
          response_format: 'json'
        });

        const structured = response.structuredContent;
        const items = structured?.results || structured?.items || [];

        // Map strictly without fabrication and strip raw HTML tags
        const mappedResults = items.map((item) => {
          const rawSnippet = item.snippet_body || item.snippet_foot || '';
          const cleanSnippet = stripHtml(rawSnippet);

          return {
            book_id: item.book_id ?? null,
            book_name: stripHtml(item.book_name ?? item.book_title ?? 'بدون عنوان'),
            author_name: item.author_name ? stripHtml(item.author_name) : null,
            volume: null,
            page: item.printed_page ?? item.page_id ?? null,
            content: cleanSnippet,
            highlighted: cleanSnippet
          };
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          total_hits: structured?.total_hits ?? mappedResults.length,
          results: mappedResults
        }));

      } catch (err) {
        console.error('[Bridge] Search error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message, results: [] }));
      }
    });
    return;
  }

  // ── Reader endpoints (UX-v1 P7 follow-up) ───────────────────────────
  // Native SQLite + shamela-helper.jar path (see reader.mjs) — deliberately
  // NOT routed through shamela-mcp's own page tools; see reader.mjs header.
  if (req.method === 'GET' && url.pathname === '/reader/pageCount') {
    try {
      const bookId = url.searchParams.get('bookId');
      if (!bookId) throw new Error('bookId is required');
      const count = await reader.getPageCount(bookId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ pageCount: count }));
    } catch (err) {
      console.error('[Bridge] reader/pageCount error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, pageCount: 0 }));
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/reader/page') {
    try {
      const bookId = url.searchParams.get('bookId');
      const pageNumber = Number(url.searchParams.get('pageNumber'));
      if (!bookId || !Number.isFinite(pageNumber) || pageNumber < 1) {
        throw new Error('bookId and a positive pageNumber are required');
      }
      const page = await reader.readPage(bookId, pageNumber);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(page));
    } catch (err) {
      console.error('[Bridge] reader/page error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/reader/book') {
    try {
      const bookId = url.searchParams.get('bookId');
      if (!bookId) throw new Error('bookId is required');
      const book = await reader.readBook(bookId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(book));
    } catch (err) {
      console.error('[Bridge] reader/book error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/reader/toc') {
    try {
      const bookId = url.searchParams.get('bookId');
      if (!bookId) throw new Error('bookId is required');
      const toc = await reader.readToc(bookId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(toc));
    } catch (err) {
      console.error('[Bridge] reader/toc error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, toc: [] }));
    }
    return;
  }

  // 404 for unknown endpoints
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint not found' }));
});

server.listen(PORT, HOST, () => {
  console.log(`====================================================`);
  console.log(` Al-Ulama Local Shamela 4 Bridge Server Running!`);
  console.log(` Listening on: http://${HOST}:${PORT}`);
  console.log(` CORS Allowed Origin: https://editor.alulama.org`);
  console.log(` PNA Support: Access-Control-Allow-Private-Network Enabled`);
  console.log(`====================================================`);
});
