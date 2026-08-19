"""
client.py - Resilient, respectful HTTP client for IslamicUrduBooks.com.
Features:
- Mandatory Gzip on-disk caching at data/iub_cache/{module}/{key}.html.gz.
- Checkpoints to data/iub_state.json so runs are 100% resumable.
- Honest, identifiable scholarly User-Agent.
- Automatic retries with exponential backoff on network errors.
- Treats terminal error pages ("درست کتاب ID فراہم کریں", "حدیث کا ریکارڈ نہیں ملا") as non-retryable terminal data.
"""

import os
import ssl
import gzip
import json
import time
import random
import threading
import urllib.request
from typing import Optional, Tuple

# Certificate verification stays ON. It was previously disabled
# (check_hostname=False / CERT_NONE); islamicurdubooks.com presents a valid
# chain, so the bypass bought nothing and only opened the scrape to MITM.
ctx = ssl.create_default_context()

# Politeness throttle. The agreed budget is 4 workers at ~0.6-0.8s per worker
# (about 5 req/s sustained). Callers previously fired batches of 50 concurrently
# and slept only 0.2-0.3s BETWEEN batches, which is ~9-15 req/s. Enforcing the
# delay here -- per live request, on every code path -- makes the budget hold no
# matter how a caller batches. Cache hits are deliberately exempt so that
# re-runs over a warm cache stay fast.
REQUEST_DELAY_MIN = 0.6
REQUEST_DELAY_MAX = 0.8
_throttle_lock = threading.Lock()
_next_slot = [0.0]


def _throttle():
    """Space live requests out globally across worker threads."""
    with _throttle_lock:
        now = time.monotonic()
        wait = max(0.0, _next_slot[0] - now)
        gap = random.uniform(REQUEST_DELAY_MIN, REQUEST_DELAY_MAX) / MAX_WORKERS
        _next_slot[0] = max(now, _next_slot[0]) + gap
    if wait > 0:
        time.sleep(wait)


MAX_WORKERS = 4

HEADERS = {
    'User-Agent': 'EasyEditor-ScholarResearch/1.0 (+https://editor.alulama.org; research@alulama.org)',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ur,ar,en-US;q=0.9',
}

CACHE_DIR = os.path.join("data", "iub_cache")
STATE_FILE = os.path.join("data", "iub_state.json")

def get_cache_path(module: str, key: str) -> str:
    # Safe filename
    safe_key = "".join(c if c.isalnum() or c in "-_" else "_" for c in str(key))
    folder = os.path.join(CACHE_DIR, module)
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, f"{safe_key}.html.gz")

def read_from_cache(module: str, key: str) -> Optional[str]:
    path = get_cache_path(module, key)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        try:
            with gzip.open(path, "rt", encoding="utf-8", errors="ignore") as f:
                return f.read()
        except Exception:
            return None
    return None

def write_to_cache(module: str, key: str, html: str):
    path = get_cache_path(module, key)
    try:
        with gzip.open(path, "wt", encoding="utf-8") as f:
            f.write(html)
    except Exception as e:
        print(f"Warning: Could not write cache to {path}: {e}")

def load_state() -> dict:
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"modules": {}, "last_updated": None}

def save_state(state: dict):
    os.makedirs("data", exist_ok=True)
    state["last_updated"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)

def fetch_page(url: str, module: str, key: str, retries: int = 3, timeout: int = 25) -> Tuple[Optional[str], bool, str]:
    """
    Returns (html, is_terminal_missing, error_msg)
    """
    # 1. Check disk cache first
    cached = read_from_cache(module, key)
    if cached:
        is_missing = ("درست کتاب ID فراہم کریں" in cached or "حدیث کا ریکارڈ نہیں ملا" in cached)
        return cached, is_missing, ""

    # 2. Fetch live with retries
    for attempt in range(retries):
        _throttle()
        req = urllib.request.Request(url, headers=HEADERS)
        try:
            with urllib.request.urlopen(req, context=ctx, timeout=timeout) as resp:
                html = resp.read().decode('utf-8', errors='ignore')
                
                # Check if terminal missing page
                is_missing = ("درست کتاب ID فراہم کریں" in html or "حدیث کا ریکارڈ نہیں ملا" in html)
                
                # Save to gzipped cache
                write_to_cache(module, key, html)
                return html, is_missing, ""
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(1.0 + attempt * 1.5)
            else:
                return None, False, str(e)
                
    return None, False, "Max retries exceeded"
