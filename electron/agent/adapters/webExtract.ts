/**
 * M13 Phase 4 (ADR-0060) — read ONE web page, read-only.
 *
 * A hidden, sandboxed BrowserWindow (JavaScript on, so modern sites render;
 * no Node, no preload, context isolation, its own in-memory session so the
 * scholar's cookies/logins are never sent) loads the page; an article-text
 * extractor then runs in an ISOLATED world (the page's own scripts cannot
 * tamper with it). No clicking, no typing, no forms, no downloads, no popups,
 * no permission prompts, no navigation away from http(s).
 *
 * Provenance of the URL is the dispatcher's job (shared/agent/webUrls.ts).
 */
import { BrowserWindow, session as electronSession } from 'electron';
import { logger } from '../../lib/logger.js';
import { normaliseUrl, isPrivateHost, hostOf } from '../../../shared/agent/webUrls.js';

const log = logger.child('agent/webExtract');

// A persistent partition, separate from the app's own session. (An
// in-memory partition fails some real sites with ERR_FAILED — islamqa.info,
// confirmed live.) Its storage and cache are wiped after every read.
const PARTITION = 'persist:webextract';
const LOAD_TIMEOUT_MS = 20_000;
const SETTLE_MS = 1_200;
const MAX_TEXT = 60_000;

export interface WebPage {
  url: string;
  finalUrl: string;
  title: string;
  siteName: string;
  byline: string;
  lang: string;
  text: string;
  fetchedAt: string;
}

/**
 * The in-page extractor — Readability's core idea, small, on the LIVE DOM
 * (read-only: nothing is modified): every VISIBLE text block (p, li, td, pre,
 * blockquote, or a div/section with no block children) outside page chrome
 * (nav/header/footer/aside/forms/dialogs) that is not mostly links credits its
 * text length to its parent and half to its grandparent; the best container
 * wins and its siblings scoring at least a fifth of it are merged in. Text is
 * read with innerText, which honours visibility and block line breaks — a
 * hidden help popup (seen live on sunnah.com) never wins. Plain ES5, no regex
 * escapes, so nothing can be mangled in transit.
 */
const EXTRACTOR = `(function () {
  var NL = String.fromCharCode(10), NBSP = String.fromCharCode(160);
  var CHROME = 'nav,header,footer,aside,form,dialog,button,select,textarea,script,style,noscript,template,[role=navigation],[role=banner],[role=contentinfo],[role=dialog],[aria-hidden=true],[hidden]';
  var BLOCK = 'p,div,section,article,li,ul,ol,table,blockquote,pre,h1,h2,h3,h4';
  function meta(n) {
    var m = document.querySelector('meta[property="' + n + '"]') || document.querySelector('meta[name="' + n + '"]');
    return m && m.getAttribute('content') ? m.getAttribute('content') : '';
  }
  function clean(s) { return (s || '').split(NBSP).join(' ').replace(/[ ]+/g, ' ').trim(); }
  function visible(el) { return el.checkVisibility ? el.checkVisibility() : el.getClientRects().length > 0; }
  function textLen(el) { return clean(el.innerText).length; }
  function linkLen(el) { var n = 0, a = el.querySelectorAll('a'); for (var i = 0; i < a.length; i++) n += clean(a[i].innerText).length; return n; }
  var info = {
    title: meta('og:title') || document.title || '',
    siteName: meta('og:site_name') || location.hostname,
    byline: meta('author') || meta('article:author') || '',
    lang: document.documentElement.getAttribute('lang') || ''
  };
  if (!document.body) { info.text = ''; return info; }
  var scored = [], scores = [];
  function credit(el, s) {
    if (!el || el === document.documentElement) return;
    var k = scored.indexOf(el);
    if (k < 0) { scored.push(el); scores.push(s); } else scores[k] += s;
  }
  var cands = document.body.querySelectorAll('p,li,td,pre,blockquote,div,section');
  for (var i = 0; i < cands.length; i++) {
    var el = cands[i], tag = el.tagName;
    if ((tag === 'DIV' || tag === 'SECTION') && el.querySelector(BLOCK)) continue;
    if (el.closest(CHROME) || !visible(el)) continue;
    var t = textLen(el);
    if (t < 30) continue;
    var ld = linkLen(el) / t;
    if (ld > 0.5) continue;
    var sc = t * (1 - ld);
    credit(el.parentElement, sc);
    if (el.parentElement) credit(el.parentElement.parentElement, sc / 2);
  }
  var best = null, bs = 0;
  for (i = 0; i < scored.length; i++) if (scores[i] > bs) { bs = scores[i]; best = scored[i]; }
  var parts = [];
  if (!best || bs < 150) { parts = [document.body]; }
  else if (best.parentElement && best !== document.body) {
    var sibs = best.parentElement.children;
    for (i = 0; i < sibs.length; i++) {
      var k2 = scored.indexOf(sibs[i]);
      if (sibs[i] === best || (k2 >= 0 && scores[k2] >= bs / 5)) parts.push(sibs[i]);
    }
  } else { parts = [best]; }
  var lines = [];
  for (var p = 0; p < parts.length; p++) {
    var ls = (parts[p].innerText || '').split(NL);
    for (i = 0; i < ls.length; i++) { var l = clean(ls[i]); if (l) lines.push(l); }
  }
  info.text = lines.join(NL).slice(0, ${MAX_TEXT});
  return info;
})()`;

let hardened = false;
function extractSession(): Electron.Session {
  const s = electronSession.fromPartition(PARTITION);
  if (!hardened) {
    hardened = true;
    s.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    s.setPermissionCheckHandler(() => false);
    s.on('will-download', (e) => e.preventDefault());
    // Never let the page reach the scholar's own network.
    s.webRequest.onBeforeRequest((details, cb) => {
      const h = hostOf(details.url);
      const blocked = !/^https?:|^data:|^blob:/.test(details.url) || (h !== '' && isPrivateHost(h));
      cb({ cancel: blocked });
    });
  }
  return s;
}

/** Load `url` in a hidden sandboxed window and return its article text. */
export async function extractWebPage(url: string): Promise<WebPage> {
  const target = normaliseUrl(url);
  if (!target) throw new Error('not a valid http(s) address');
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: true,
      webSecurity: true,
      images: false,
      session: extractSession(),
      backgroundThrottling: false,
    },
  });
  const wc = win.webContents;
  wc.setAudioMuted(true);
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e, next) => { if (!/^https?:/.test(next)) e.preventDefault(); });
  try {
    await Promise.race([
      wc.loadURL(target, { userAgent: wc.getUserAgent().replace(/Electron\/\S+\s?/, '') }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`the page did not load within ${LOAD_TIMEOUT_MS / 1000} s`)), LOAD_TIMEOUT_MS)),
    ]);
    // Let client-rendered content settle.
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    const r = (await wc.executeJavaScriptInIsolatedWorld(999, [{ code: EXTRACTOR }])) as Omit<WebPage, 'url' | 'finalUrl' | 'fetchedAt'>;
    return {
      url: target,
      finalUrl: wc.getURL(),
      title: String(r?.title ?? '').slice(0, 300),
      siteName: String(r?.siteName ?? '').slice(0, 120),
      byline: String(r?.byline ?? '').slice(0, 200),
      lang: String(r?.lang ?? '').slice(0, 20),
      text: String(r?.text ?? ''),
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    log.warn('web extract failed', { host: hostOf(target), message: (err as Error).message });
    throw err;
  } finally {
    if (!win.isDestroyed()) win.destroy();
    // Nothing a site set (cookies, storage, cache) survives the read.
    try {
      const s = extractSession();
      await s.clearStorageData();
      await s.clearCache();
    } catch { /* best-effort */ }
  }
}
