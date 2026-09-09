# Manual check — شامله لنک (cloud Shamela) OAuth + live tool names

**Why this is manual:** the real OAuth handshake and the real cloud tool
names / result schema (`shamela.link/mcp` exposes ~34 tools) cannot be unit
tested. This checklist is run **once** against a real `shamela.link` account —
it both verifies the flow end-to-end and **pins the provisional tool names**
into `electron/shamela/cloudAllowlist.ts`.

Precedent: the M9 live-run (`DOC_BRIDGE_LIVE=1`) that caught two real COM bugs
in `wordBridge.ps1`.

## Prerequisites

- A desktop dev build (`npm run dev` + Electron) on Windows or macOS.
- A free `shamela.link` account (sign up in a browser first).
- Ports 43110–43112 free on `127.0.0.1`.

## A. Connect the account

1. **Settings → Connectors → المكتبة الشاملة.** The "شامله لنک (سحابي)" panel
   shows **غير متصل** with a **ربط الحساب** button.
2. Click **ربط الحساب**. Expected:
   - the OS browser opens the `shamela.link` authorize page (real browser, not
     an embedded window);
   - the panel flips to amber **في انتظار موافقة المتصفح…** with a **إلغاء**
     button.
3. Approve in the browser. Expected:
   - the browser tab shows "تم الاتصال" and auto-closes after ~1.5s;
   - the panel flips to green **متصل** within a second or two;
   - `userData/shamela-cloud-tokens.enc` and `shamela-cloud-client.enc` now
     exist (DCR + tokens). **No `.txt`/plaintext token anywhere.**
4. **Hub card** for `shamela-cloud`: **Test** → 🟢 with a latency.

## B. Pin the real tool names  ← the load-bearing step

5. In the panel's diagnostics (or via devtools →
   `window.electronAPI.shamelaCloud.listTools()`), capture the full tool list.
6. Compare against `SHAMELA_CLOUD_TOOL_ALLOWLIST` in
   `electron/shamela/cloudAllowlist.ts`:
   - page full-text search (provisional `shamela_search_pages`)
   - book search (provisional `shamela_search_books`)
   - author search (provisional `shamela_search_authors`)
   - read one page (provisional `shamela_get_page`)
   - health (provisional `shamela_health`)
7. **Edit `cloudAllowlist.ts`** — real names + real arg keys/types. Then fix the
   normalisers in `electron/shamela/cloudClient.ts` (`searchCloud` →
   `shamela_search_pages` call + row field names; `readCloudPage` →
   `shamela_get_page`; `findCloudBook` → `shamela_search_books`) to match the
   real result schema. Note whether the server returns `structuredContent` rows
   or only a text blob (the normalisers handle both; the text-blob path degrades
   to one `bibliographic` chunk).
8. Re-run: `npx vitest run src/test/shamelaCloudClient.test.ts src/test/shamelaRouter.test.ts src/test/agentDispatch.test.ts src/test/agentProvenance.test.ts` — adjust the fixtures to the real field names, keep them green.

## C. Routing + provenance

9. **Local OFF** (toggle the local Shamela connector off, or use a machine with
   no library) → ask the agent a Shamela-scoped question ("ابحث في الشاملة عن …").
   Expected: an answer with **`[ماخذ: ☁️ شامله لنک]`**, chunk ids `shamela-cloud:…`.
10. **Local ON** + a term your local library covers → the same ask returns
    **`[ماخذ: 💻 الشاملة (مقامی)]`**, chunk ids `shamela:…`, and the cloud is
    **not** called (check the logs).
11. **Local ON but a local error** (rename the JRE, say) → the answer falls back
    to the cloud with a `note` ("المكتبة المحلية غير متاحة …").
12. `read_shamela_page` on a `shamela-cloud:<bookId>:<page>` id → returns the page
    text; a footnote inserted against it cites `الشاملة، ص <n>`.
13. `find_shamela_book` ("جد كتاب فتح الباري") → a book list, **not** ledgered
    (the model then scopes a `search_shamela`).

## D. Resilience

14. **Quit the app mid-flow** (after step 2, before approving) → no orphan
    loopback listener, no crash on quit; relaunch → panel back to **غير متصل**.
15. **Restart after a successful connect** → panel is **متصل** (or
    **محفوظ — إعادة الاتصال**) without a new browser round-trip (refresh token).
16. **Force a 429** (hammer the quota) → the agent surfaces
    "شامله لنک: تجاوزت الحصة — أعد المحاولة بعد قليل"; **no** auto-retry, **no**
    browser pop. The router falls back to local if local is on.
17. **Expire/revoke the token server-side, then run one search** → a clean
    "شامله لنک: انتهت الجلسة — أعد الربط من الإعدادات"; **no** browser pop
    mid-run; local fallback if available.
18. **Sign out** (panel → **تسجيل الخروج**) → both `.enc` blobs are gone; the
    Hub card ping reports "not connected".

## Sign-off

- [ ] A–D all pass
- [ ] `cloudAllowlist.ts` holds the **real** tool names + arg schema
- [ ] `cloudClient.ts` normalisers match the **real** result schema
- [ ] the SDK-mocked tests (client / router / dispatch / provenance) are green
      against fixtures updated to the real field names
