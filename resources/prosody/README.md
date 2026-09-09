# Bundled Urdu verse corpus (`lookup_urdu_verse`, ADR-0042)

`urdu-verses.json` feeds the `lookup_urdu_verse` agent tool. It ships **empty**.

## Why empty

- **Ghālib** (d. 1869) is public domain everywhere, but the good open datasets are
  Rekhta scrapes with uncertain provenance — a scholarly tool needs a *verified*
  text (e.g. Nuskha-e-Hamīdiya), added deliberately.
- **Iqbāl's Urdu** work carries special, effectively perpetual protection under
  Pakistani copyright law — it is **not** to be bundled without a clear licence.
  (Iqbāl's *Persian* dīwāns are reachable through the Ganjoor connector instead.)

Metre scanning (`scan_urdu_prosody`) is pure computation and works with no corpus.

## Format

```json
{
  "verses": [
    { "id": "ghalib-g1-1", "poet": "مرزا غالب", "work": "دیوانِ غالب", "ghazal": 1, "text": "نقش فریادی ہے کس کی شوخیِ تحریر کا\nکاغذی ہے پیرہن ہر پیکرِ تصویر کا" }
  ]
}
```

`id` must be unique and stable (it becomes the citation id `urdu:<id>`). Drop a
populated file here (or expand this one) and rebuild — no code change needed.
