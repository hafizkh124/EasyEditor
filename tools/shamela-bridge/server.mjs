import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

// Lazy-loaded backend instance
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

  throw new Error(`Could not find shamela-mcp installation. Please set SHAMELA_MCP_PATH or place shamela-mcp-1.2.0 in D:\\`);
}

async function getBackend() {
  if (!backendPromise) {
    backendPromise = (async () => {
      const mod = await getShamelaModule();
      if (typeof mod.createBackend !== 'function') {
        throw new Error('createBackend function not found in shamela-mcp module');
      }
      console.log('[Bridge] Initializing Shamela Backend...');
      const backend = await mod.createBackend();
      console.log('[Bridge] Backend initialized successfully!');
      return backend;
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Access-Control-Request-Private-Network');
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
      const backend = await getBackend();
      const { runHealth } = await getShamelaModule();
      let healthData;
      if (typeof runHealth === 'function') {
        const response = await runHealth(backend.catalog, backend.pages, { response_format: 'json' });
        healthData = response.structuredContent;
      } else {
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

        const backend = await getBackend();
        const { runSearchPages } = await getShamelaModule();

        if (typeof runSearchPages !== 'function') {
          throw new Error('runSearchPages tool function unavailable');
        }

        const limit = typeof body.limit === 'number' ? Math.min(body.limit, 50) : 20;
        const page = typeof body.page === 'number' && body.page > 0 ? body.page : 1;
        const offset = (page - 1) * limit;

        const result = await runSearchPages(backend.helper, backend.catalog, backend.pages, {
          query: query.trim(),
          scope: body.scope || { downloaded_only: true },
          offset,
          limit,
          response_format: 'json'
        });

        const structured = result.structuredContent;
        const items = structured?.items || structured?.results || [];

        // Map strictly without fabrication based on SearchPageHit schema
        const mappedResults = items.map((item) => {
          return {
            book_id: item.book_id ?? null,
            book_name: item.book_name ?? item.book_title ?? 'بدون عنوان',
            author_name: item.author_name ?? null,
            volume: null,
            page: item.printed_page ?? item.page_id ?? null,
            content: item.snippet_body || item.snippet_foot || '',
            highlighted: item.snippet_body || item.snippet_foot || null
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
