#!/usr/bin/env python3
"""
backfill_rijal_narrations.py - add the per-book narration counts to the 19,616
already-ingested narrator rows.

WHY
---
`scrape_rijal.py` originally read only <td>label</td><td>value</td> pairs from
a narrator page, which captured the جرح و تعدیل verdicts and silently dropped
the "کی روایت کردہ احادیث" strip -- the per-book counts (صحيح البخاري (1),
مسند احمد (438), ...) that answer the most common question asked about a
narrator. The model was left correctly but uselessly reporting "the count is
not in the provided sources" while the number sat on the very page its own
citation linked to.

The counts were on those pages all along, and every page is already in the
on-disk cache from the original scrape, so this backfill is **fully offline**:
it re-parses data/iub_cache/rijal/*.html.gz and issues no HTTP request to
islamicurdubooks.com at all. (Verified 2026-08-23: 300/300 sampled cached
pages contain the strip.)

Writes go through ingest-batch mode=update-content, which sets `content` and
merges the structured counts into citation_ref. Embeddings are deliberately
left alone -- see the migration's comment for why.

Usage:
    python scripts/iub/backfill_rijal_narrations.py --dry-run      # parse only
    python scripts/iub/backfill_rijal_narrations.py --limit 50     # small live run
    python scripts/iub/backfill_rijal_narrations.py                # full backfill

Resumable: --dry-run first, then a real run; re-running is safe because the RPC
SETs content rather than appending, so a repeat converges instead of doubling
the block.
"""

import argparse
import glob
import gzip
import io
import json
import os
import re
import sys
import time
import urllib.request

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from scripts.iub.scrape_rijal import extract_narrations, format_narrations_ur  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

CACHE_DIR = os.path.join("data", "iub_cache", "rijal")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://vdfdqtzndsrrlutbprtk.supabase.co")
FUNCTION_URL = f"{SUPABASE_URL}/functions/v1/ingest-batch"
BATCH_SIZE = 200

RE_RAWY_ID = re.compile(r"rawy_(\d+)\.html\.gz$")


def load_secret() -> str:
    secret = os.environ.get("INGEST_SHARED_SECRET")
    if secret:
        return secret.strip().strip('"')
    # .env stores it double-quoted; strip them (see the INGEST_SHARED_SECRET
    # memory note -- a quoted secret authenticates as garbage and 401s).
    try:
        for line in io.open(".env", encoding="utf-8"):
            if line.startswith("INGEST_SHARED_SECRET="):
                return line.split("=", 1)[1].strip().strip('"')
    except OSError:
        pass
    return ""


def rebuild_content(html: str, rawyid: str):
    """Re-derive the row exactly as scrape_rijal.parse_narrator_page would
    today, but from cached HTML. Returns (content, patch) or None to skip.

    Deliberately re-derives the WHOLE content rather than appending to whatever
    is in the database: appending would double the block on a second run and
    would also carry forward any earlier extraction bug, and we cannot read the
    current content back without a service-role key anyway.
    """
    narrations, total = extract_narrations(html)
    if not narrations:
        return None  # genuinely has no indexed narrations -- nothing to add

    tables = re.findall(r"<table[^>]*>(.*?)</table>", html, re.DOTALL)
    details, labels = [], {}
    for tbl in tables:
        for td1, td2 in re.findall(
            r"<tr[^>]*>\s*<td[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>", tbl, re.DOTALL
        ):
            k, v = clean(td1), clean(td2)
            if k and v:
                details.append(f"{k}: {v}")
                labels[k] = v

    def label(*keys):
        for want in keys:
            for lk, lv in labels.items():
                if want in lk:
                    return lv
        return ""

    name_ar = label("اسم الراوي") or label("اسم الشهرة")
    if not name_ar:
        m = re.search(r"<title>([^<]+)</title>", html)
        name_ar = (
            clean(m.group(1)).split("کا تفصیلی جائزہ")[0].strip().rstrip(",").strip()
            if m else f"راوی {rawyid}"
        )

    content_div = re.search(r'class="[^"]*card-body[^"]*"[^>]*>(.*?)</div>', html, re.DOTALL)
    body_text = clean(content_div.group(1)) if content_div else ""

    content = f"راوی: {name_ar}\n\n" + "\n".join(details)
    if body_text and len(body_text) > len(content):
        content += f"\n\nتفصیل:\n{body_text}"
    content += format_narrations_ur(narrations, total)

    patch = {
        "narrations": narrations,
        "narration_total": total,
        "narration_books": len(narrations),
    }
    return content, patch


def clean(raw: str) -> str:
    """Local copy of scrape_hadith.clean_html's behaviour, kept here so this
    script has no import-time dependency on the scraper's HTTP client."""
    if not raw:
        return ""
    text = re.sub(r"<br\s*/?>", "\n", raw)
    text = re.sub(r"<[^>]+>", " ", text)
    text = (text.replace("&nbsp;", " ").replace("&amp;", "&")
                .replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"'))
    return re.sub(r"[ \t]+", " ", text).strip()


def post(rows, secret, retries=3):
    payload = json.dumps({"rows": rows, "mode": "update-content"}, ensure_ascii=False).encode("utf-8")
    for attempt in range(retries):
        req = urllib.request.Request(
            FUNCTION_URL, data=payload, method="POST",
            headers={"x-ingest-secret": secret, "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read().decode("utf-8")), ""
        except Exception as exc:                                     # noqa: BLE001
            body = exc.read().decode("utf-8", "replace")[:300] if hasattr(exc, "read") else ""
            if attempt == retries - 1:
                return {}, f"{exc} {body}"
            time.sleep(2 * (attempt + 1))
    return {}, "failed after retries"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="parse the cache, write nothing")
    ap.add_argument("--limit", type=int, default=0, help="only process the first N narrators")
    args = ap.parse_args()

    files = sorted(glob.glob(os.path.join(CACHE_DIR, "rawy_*.html.gz")))
    if not files:
        print(f"No cached narrator pages under {CACHE_DIR} — nothing to do.")
        return 1
    if args.limit:
        files = files[: args.limit]
    print(f"Cached narrator pages: {len(files):,}")

    rows, skipped, total_narrations = [], 0, 0
    for path in files:
        m = RE_RAWY_ID.search(os.path.basename(path))
        if not m:
            continue
        rawyid = m.group(1)
        try:
            with gzip.open(path, "rt", encoding="utf-8") as f:
                html = f.read()
        except OSError:
            skipped += 1
            continue

        built = rebuild_content(html, rawyid)
        if built is None:
            skipped += 1
            continue
        content, patch = built
        total_narrations += patch["narration_total"]
        rows.append({
            "passage_key": f"rijal:iub:{rawyid}",
            "content": content,
            "citation_ref_patch": patch,
        })

    print(f"Parsed {len(rows):,} narrators with counts ({skipped:,} had none / unreadable)")
    print(f"Total narrations across all of them: {total_narrations:,}")

    if args.dry_run:
        if rows:
            print("\n--- sample payload (first row) ---")
            print(json.dumps(rows[0], ensure_ascii=False)[:1200])
        print("\nDry run — nothing written.")
        return 0

    secret = load_secret()
    if not secret:
        print("INGEST_SHARED_SECRET not found (env or .env) — cannot write.")
        return 1

    updated = failed = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        data, err = post(batch, secret)
        if err:
            failed += len(batch)
            print(f"  [{i:,}] ERROR: {err}")
            continue
        updated += data.get("updated", 0)
        print(f"  [{i + len(batch):,}/{len(rows):,}] updated={data.get('updated', 0)}", flush=True)

    print(f"\nDone. rows updated: {updated:,} | failed: {failed:,}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
