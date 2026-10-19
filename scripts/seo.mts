/**
 * SEO build steps for the public marketing pages.
 *
 *   tsx scripts/seo.mts sitemap     (re)write public/sitemap.xml
 *   tsx scripts/seo.mts prerender   write dist/{ur,ar}/**\/index.html
 *
 * The app is a client-rendered SPA, so crawlers and link-preview bots only ever
 * see the static HTML. `prerender` copies dist/index.html once per locale route
 * and rewrites the head (lang/dir, title, description, canonical, hreflang,
 * Open Graph) so each locale is served correct metadata before any JS runs. The
 * body is still the SPA shell. Only the landing page has localised title and
 * description copy here; other pages keep the default English text but still get
 * the right lang, canonical and hreflang (their React `useSeo` call refines the
 * title client-side).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SEO } from "../src/lib/landingContent.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://editor.alulama.org";
const LOCALES = ["en", "ur", "ar"] as const;
type Locale = (typeof LOCALES)[number];

/** Public, indexable routes (no locale prefix) and the source file that defines each. */
const ROUTES: Array<{ path: string; source: string[]; priority: number; changefreq: string }> = [
  { path: "/", source: ["src/pages/Landing.tsx", "src/lib/landingContent.ts"], priority: 1.0, changefreq: "weekly" },
  { path: "/about", source: ["src/pages/About.tsx"], priority: 0.8, changefreq: "monthly" },
  { path: "/faq/is-ai-haram-in-islam", source: ["src/pages/FaqAiHaram.tsx"], priority: 0.8, changefreq: "monthly" },
  { path: "/pricing-info", source: ["src/pages/legal/PricingInfo.tsx", "src/lib/planTiers.ts"], priority: 0.8, changefreq: "monthly" },
  { path: "/answers", source: ["src/pages/Answers.tsx"], priority: 0.7, changefreq: "monthly" },
  { path: "/guides/maktaba-shamila-tutorial", source: ["src/pages/guides/MaktabaShamila.tsx"], priority: 0.7, changefreq: "monthly" },
  { path: "/terms", source: ["src/pages/legal/Terms.tsx"], priority: 0.3, changefreq: "yearly" },
  { path: "/privacy", source: ["src/pages/legal/Privacy.tsx"], priority: 0.3, changefreq: "yearly" },
  { path: "/refund-policy", source: ["src/pages/legal/Refund.tsx"], priority: 0.3, changefreq: "yearly" },
];

const localePath = (loc: Locale, path: string): string =>
  loc === "en" ? path : path === "/" ? `/${loc}` : `/${loc}${path}`;

const today = (): string => new Date().toISOString().slice(0, 10);

/** Latest commit date (YYYY-MM-DD) among the given files; today if git has no answer. */
function lastModified(files: string[]): string {
  const dates: string[] = [];
  for (const file of files) {
    try {
      const out = execFileSync("git", ["log", "-1", "--format=%cs", "--", file], { cwd: ROOT, encoding: "utf8" }).trim();
      if (out) dates.push(out);
    } catch {
      // not a git checkout — fall through to today()
    }
  }
  return dates.sort().at(-1) ?? today();
}

function alternates(path: string): string {
  const links = LOCALES.map(
    (loc) => `    <xhtml:link rel="alternate" hreflang="${loc}" href="${ORIGIN}${localePath(loc, path)}" />`,
  );
  links.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${ORIGIN}${path}" />`);
  return links.join("\n");
}

function sitemap(): void {
  const entries: string[] = [];
  for (const route of ROUTES) {
    const lastmod = lastModified(route.source);
    for (const loc of LOCALES) {
      const priority = loc === "en" ? route.priority : Math.max(route.priority - 0.1, 0.1);
      entries.push(`  <url>
    <loc>${ORIGIN}${localePath(loc, route.path)}</loc>
${alternates(route.path)}
    <lastmod>${lastmod}</lastmod>
    <changefreq>${route.changefreq}</changefreq>
    <priority>${priority.toFixed(1)}</priority>
  </url>`);
    }
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join("\n")}
</urlset>
`;
  writeFileSync(join(ROOT, "public/sitemap.xml"), xml);
  console.log(`sitemap: ${entries.length} urls`);
}

const escapeAttr = (value: string): string => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function setMeta(html: string, selector: RegExp, replacement: string): string {
  if (!selector.test(html)) throw new Error(`seo prerender: ${selector} not found in dist/index.html`);
  return html.replace(selector, replacement);
}

const OG_LOCALE: Record<Locale, string> = { en: "en_US", ur: "ur_PK", ar: "ar_SA" };

function render(base: string, loc: Locale, path: string): string {
  const url = `${ORIGIN}${localePath(loc, path)}`;
  // Idempotent: drop any head links a previous run (or the source) already added.
  let html = base.replace(/\s*<link rel="(?:canonical|alternate)"[^>]*>/g, "");
  html = setMeta(html, /<html[^>]*>/, `<html lang="${loc}" dir="${loc === "en" ? "ltr" : "rtl"}">`);
  if (path === "/") {
    const title = escapeAttr(SEO.title[loc]);
    const description = escapeAttr(SEO.description[loc]);
    html = setMeta(html, /<title>[\s\S]*?<\/title>/, `<title>${title}</title>`);
    html = setMeta(html, /<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${description}" />`);
    html = setMeta(html, /<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${title}" />`);
    html = setMeta(html, /<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${description}" />`);
    html = setMeta(html, /<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${title}" />`);
    html = setMeta(html, /<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${description}" />`);
  }
  html = setMeta(html, /<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${url}" />`);
  html = setMeta(html, /<meta property="og:locale" content="[^"]*" \/>/, `<meta property="og:locale" content="${OG_LOCALE[loc]}" />`);
  const hreflang = [
    `<link rel="canonical" href="${url}" />`,
    ...LOCALES.map((l) => `<link rel="alternate" hreflang="${l}" href="${ORIGIN}${localePath(l, path)}" />`),
    `<link rel="alternate" hreflang="x-default" href="${ORIGIN}${path}" />`,
  ].join("\n    ");
  return setMeta(html, /<\/head>/, `    ${hreflang}\n  </head>`);
}

function prerender(): void {
  const distIndex = join(ROOT, "dist/index.html");
  if (!existsSync(distIndex)) throw new Error("dist/index.html missing — run `vite build` first");
  const base = readFileSync(distIndex, "utf8");
  let written = 0;
  for (const route of ROUTES) {
    for (const loc of LOCALES) {
      const dir = join(ROOT, "dist", localePath(loc, route.path));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "index.html"), render(base, loc, route.path));
      written++;
    }
  }
  console.log(`prerender: ${written} head-rewritten pages`);
}

const mode = process.argv[2];
if (mode === "sitemap") sitemap();
else if (mode === "prerender") prerender();
else {
  console.error("usage: tsx scripts/seo.mts <sitemap|prerender>");
  process.exit(1);
}
