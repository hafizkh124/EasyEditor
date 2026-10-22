# Live test plan — every function, start to end

Site: https://editor.alulama.org (web). Run once as an **admin**, once as a **normal approved user**, once **signed out**; on a **phone width (390 px)** and a **computer width (1280 px)**; in **Urdu**, then spot-check **Arabic** and **English**.

Mark each line ✅ works · ❌ broken (note what happened) · ➖ not applicable.
For every ❌: page, what was tapped, what was expected, what happened, and the browser console error if any.

Every screen, before its own checks: it loads without a blank page or console error; no raw keys (like `extract.page`); nothing is cut off at the edge; no sideways scrolling; every button and link responds; keyboard Tab reaches every control; back button returns where expected.

## 0. Signed out
- [ ] `/` landing: each section, each button, language switch (ur/ar/en), theme toggle
- [ ] `/pricing`, `/pricing-info`, `/about`, `/answers`, `/faq/…`, `/guides/…`, `/privacy`, `/terms`, `/refund-policy` — open, scroll, all links
- [ ] `/login`: wrong password message; Google button; "forgot password" link
- [ ] `/signup`: validation messages; terms link
- [ ] `/forgot-password`, `/reset-password`
- [ ] Protected pages (`/dashboard`, `/files`, `/extract`, `/translate-book`, `/workspace`, `/settings`, `/admin`) send to sign-in and come back after signing in
- [ ] `/speak` and `/transcribe`, `/ocr` redirect sensibly

## 1. Sign-in and account
- [ ] Sign in; stays signed in after reload; sign out
- [ ] Pending-approval / rejected / complete-profile screens (use a test account)
- [ ] `/profile`: change name, WhatsApp, save, reload shows it
- [ ] Avatar / "Me" menu: every item (profile, plan, settings, theme, admin for admin only, sign out)
- [ ] Notification bell: opens, mark read, mark all read

## 2. Home (`/dashboard`)
- [ ] Greeting and name; token meter numbers match the profile
- [ ] Question box: type, Enter opens chat with the question; empty does nothing
- [ ] Three job cards open: audio to text, image/PDF to text, book translation
- [ ] Recent list: each item opens; empty state when none
- [ ] Expiry / low-balance alert when it applies

## 3. Navigation shell
- [ ] Desktop sidebar: "+ New" menu (all items), Home, Files, recent items, collapse/expand (also Ctrl+B), "Me" menu
- [ ] Phone: bottom tabs (Chat/Write, Files), centre "+" sheet (all items), top bar avatar and bell
- [ ] Jobs strip appears only while a job exists (sidebar bottom / Home top / workspace bar icon)
- [ ] Ctrl+K palette (desktop): search documents and folders, "Jobs" group, Skills group, actions

## 4. Files (`/files`)
- [ ] Folders and documents tab: open a folder, back to all, search
- [ ] New folder (name, create, appears); New document (in the open folder)
- [ ] Results tab: transcripts, OCR text, translations — each opens its own thing
- [ ] Folder chats listed in an open folder; open one
- [ ] Empty states

## 5. Workspace — document
- [ ] `/workspace/<id>` opens; title edits and saves ("saved" badge); reload keeps text
- [ ] Typing, undo/redo, bold/italic/underline, headings, lists, quote, alignment, RTL/LTR, table, font and size, fullscreen
- [ ] Phone: toolbar "…" overflow; keyboard does not cover the cursor
- [ ] Save status badges (saving / saved / error)
- [ ] Top bar: search/Ctrl+K, versions (list, restore, create snapshot), export menu (Word, PDF, HTML, text) — each file downloads and opens
- [ ] Language toggle (desktop bar / phone "more")
- [ ] Phone: folder name opens the files sheet; "more" menu items
- [ ] Select text: bubble menu actions (harakat, spelling, paraphrase, summarize, formalize, humanize, shorten …) — result appears as a tracked change, accept/reject, undo
- [ ] `/` menu on desktop **and phone**: each item (text skills, my skills, recipes, extract text here, auto-format, manage skills); menu stays inside the editor in RTL
- [ ] Section summaries: document with several headings → a "خلاصہ" under each, text untouched
- [ ] Tracked changes: accept all, reject all, per change
- [ ] Annotations / margin notes; comments
- [ ] Drop an image/PDF/audio file on the editor → text extracted at the cursor
- [ ] Word export of a long document with a table

## 6. Workspace — side panels
- [ ] Rail (desktop) / drawer (phone): Folder, Library, History, Settings panels
- [ ] Folder index: documents (sort manual/name/date, drag to reorder, new document), headings of the open document (click jumps), chats (open one), pinned sources (pin dialog, open a book, unpin), folder picker
- [ ] Library: books, sources, search, add/ingest, delete
- [ ] History panel
- [ ] Workspace settings panel (graph is hidden)
- [ ] Panel resize handles (desktop); collapse/expand

## 7. Chat / research (workbench)
- [ ] Open from Home question, from "+ New chat", from a document
- [ ] Ask a question → streamed answer, citations, sources panel; stop button
- [ ] `/` skills picker in the chat; "ask me" (grill-me) flow; manage skills
- [ ] `@` mentions and sources; `#` books; folder-sources chip on/off
- [ ] Modes ask / plan / auto; plan approval; file-write approval cards
- [ ] Follow-up question; new chat; chat saved and reopens from Files and folder index
- [ ] Citation actions: copy, verify, Approve/Edit feedback
- [ ] Insert answer into the document; copy; export
- [ ] Large agent task shows as a job (running → approval needed → review)

## 8. Extract text (`/extract`)
- [ ] Choose file (image), camera (phone), drag and drop
- [ ] Image: progress → text beside the image; uncertain words yellow; "with the image / edit" switch; copy all; make a document (lands in the right folder); save to library; start over
- [ ] PDF with several pages: page-by-page arrows; page markers in the text
- [ ] Audio file: progress → read-along (tap a paragraph seeks; play/pause, ±10 s, slider, speeds); SRT/VTT only when exact times
- [ ] Record from microphone → stop → text
- [ ] Language choice for audio
- [ ] Auto-copy switch remembered after reload
- [ ] Cancel mid-run; failed run message; "resume" after reload during a run
- [ ] Leave the page while running → jobs strip shows it → finish notice → "Open" works
- [ ] Wrong file type / too big / too many pages / no tokens → clear messages
- [ ] Reopen an old result from Files → Results
- [ ] Android share-to-app (installed PWA)

## 9. Book translation (`/translate-book`)
- [ ] Start from pasted text, image, PDF, Shamela book
- [ ] Settings: source/target language, genre, style (idiomatic/literal), glossary dialog (add, remove, paste list, take from earlier translation, save)
- [ ] Translate this page: image page is read first, then translated; paragraphs line up
- [ ] Review pane: click a pair highlights both; edit in place saves; re-translate one paragraph (quick requests and own request); "reviewed" toggle; page "mark all reviewed"; progress counts
- [ ] Glossary miss shown on a paragraph
- [ ] Page navigation (arrows, page box); "page" view (image beside text)
- [ ] Page range, "sample first 2 pages", cost and time dialog, run, cancel, finish notice
- [ ] Result menu: Word translation-only, Word bilingual, open in editor (both), copy
- [ ] Reload mid-way → reopen → saved pages, glossary, style, review marks all there; "resume" from the jobs strip
- [ ] Files → Results opens the right translation
- [ ] Not enough tokens message

## 10. Skills (`Settings → Skills`)
- [ ] List grouped (ask me, mine, text, prompts, multi-step); show/hide switches persist and affect `/` menus
- [ ] New skill (from a built-in), copy, edit, archive
- [ ] Recipes: list, run (dialog), results

## 11. Settings
- [ ] General: interface language, theme
- [ ] Skills (above), Connectors, Keys (web key panel), Methods
- [ ] Every save button confirms and survives reload

## 12. Plans and money
- [ ] `/pricing` plans, buy / upgrade flow up to the payment page (no real payment), `/checkout/success`
- [ ] Token meter after a paid action decreases correctly
- [ ] Plan expiry banner

## 13. Admin (admin account only)
- [ ] `/admin` opens; tabs/sections each load
- [ ] Users list: search, approve, reject, change plan/tokens, delete (test user only)
- [ ] Upgrade requests approve/reject; notifications sent
- [ ] Non-admin gets no admin entry and `/admin` redirects

## 14. Cross-cutting
- [ ] Languages: ur/ar/en switch everywhere; direction correct; fonts
- [ ] Dark mode on every screen above
- [ ] Offline / slow network: friendly errors, no infinite spinners
- [ ] Reload on every route (deep links work)
- [ ] Browser back/forward
- [ ] Two tabs open at once: jobs, sessions stay consistent
- [ ] PWA: install prompt, offline shell, share target

## Not live-testable on the web (needs the desktop app)
Own Gemini key OCR/translation, local Shamela, Word automation and agent tools, local Whisper, offline workspace, desktop sign-in dialog, folder connection.
