-- Persist a document's writing direction instead of re-guessing it every session.
--
-- Until now the editor derived direction from the document's own text on every
-- load (`isRtlText`), and nothing remembered the answer. That guess is made
-- from whatever the editor happens to hold at the moment the check runs, so a
-- document that is overwhelmingly Urdu could still open left-to-right — and
-- once it did, nothing ever re-decided. Direction drives caret movement,
-- Home/End, and selection extension, so a wrong guess makes the document feel
-- broken to edit.
--
-- NULL is meaningful and is the default: it means "never decided", and the
-- editor falls back to detecting from content exactly as before. Existing rows
-- therefore keep today's behaviour until something sets a value, so this
-- migration cannot change how any current document opens. A value is written
-- only when the direction is actually known — the author toggles it, or a new
-- document is created from content whose script is unambiguous.
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS text_direction TEXT
  CHECK (text_direction IN ('rtl', 'ltr'));

COMMENT ON COLUMN public.documents.text_direction IS
  'Explicit writing direction (rtl/ltr). NULL means undecided — detect from content.';
