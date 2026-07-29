# ADR 0008 — Python-Free Local Voice Core Architecture

**Status:** Accepted · **Date:** 2026-07-29 · **Milestone:** M5.5 & M5.6

## Context

M5 requires a complete offline Voice Studio (Text-To-Speech and Speech-To-Text) for Urdu and Arabic without relying on PyTorch or Python dependencies for the core application installer (NFR-13, NFR-14).

Furthermore, scholarly Urdu prose contains heavy embedded Arabic citations (e.g. Ayah & Hadith quotes). Using a single Urdu voice model on mixed text distorts Arabic pronunciation severely.

## Decision

1. **Python-Free Core Stack:**
   - **TTS:** Piper ONNX runtime running pre-trained ONNX voice models (`ur_PK-male-medium` for Urdu, `ar_JO-kareem` for Arabic).
   - **STT:** `whisper.cpp` addon (`@kutalia/whisper-node-addon`) providing built-in word/segment timestamps for `.srt` / `.vtt` exports.

2. **Segmented Synthesis (`shared/text/scriptRuns.ts`):**
   - Mixed text is parsed into script runs (`urdu` vs `arabic` vs `latin`).
   - Each script run is synthesized with its native voice engine.
   - The resulting PCM WAV buffers are concatenated into a single seamless audio file.

3. **Optional Python Sidecar (M5.6):**
   - Advanced PyTorch models (Orpheus-Urdu, Habibi, Cohere) are isolated into an optional Python virtualenv add-on. If absent, the registry silently falls back to Piper/Whisper.

## Consequences

- Core desktop application installer remains under ~200MB.
- Voice synthesis for scholarly texts maintains natural Arabic pronunciation within Urdu paragraphs.
- Zero server token costs for desktop users.
