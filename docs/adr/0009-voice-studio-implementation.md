# ADR 0009 — Voice Studio Implementation Patterns

**Status:** Accepted · **Date:** 2026-07-29 · **Milestone:** M5.5 & M5.6 & M5.7

## Context

ADR-0008 defined the Python-free Voice Core architecture (Piper + Whisper). During implementation,
several unanticipated integration requirements emerged:

1. `onnxruntime-node` requires native compilation (node-gyp, CMake, VS Build Tools) that
   complicates cross-platform Electron packaging.
2. Voice models (100–500 MB each) must be downloaded on first use; users cannot be expected to
   source them manually.
3. Voice cloning requires recording from the user's microphone — a permission-gated browser API.
4. The Piper ONNX runtime bindings do not expose streaming-progress for long synthesis.
5. Cloud TTS fallback (Google TTS) lacks a streaming interface in the cloud backend, forcing a
   different pattern.
6. Optional Python models must be fully isolated to avoid bloating the core installer.

## Decisions

### 1. Piper CLi Spawn Instead of ONNX Runtime Binding

**Instead of** requiring `onnxruntime-node` as a direct dependency, we spawn the `piper`
binary via `child_process.execFile` and capture stdout as a raw PCM stream.

- A 44-byte WAV header is prepended to the PCM buffer before playback.
- This avoids `node-gyp` and native module rebuild across platforms.
- Trade-off: slightly higher per-call latency (~50 ms for process spawn) which is negligible
  for multi-second synthesis.

### 2. whisper.cpp CLI Spawn

`whisper-cli` is spawned with `--output-json` flag. The JSON output is parsed and mapped to
`TranscriptSegment[]`. This avoids the native binding approach proposed in ADR-0008.

### 3. MediaRecorder API for Voice Cloning

Voice cloning captures audio via the browser's `MediaRecorder` API with `audio/webm` mime type.
Flow:
1. `navigator.mediaDevices.getUserMedia({ audio: true })` to obtain a stream.
2. `MediaRecorder` records from the stream, emitting `dataavailable` blobs.
3. On stop, the final blob is passed back via `onCloneComplete(blob)`.
4. The blob is persisted to disk via IPC `VOICE_SAVE_CLONE_SAMPLE` → `userData/voice-clones/`.

This keeps cloning purely in the renderer process without native audio libraries.

### 4. Streaming Download with IPC Progress Events

`VoiceModelManager.downloadModel()` performs an HTTP GET with `node-fetch` (or Electron's
`net.fetch`) and writes chunks to a `.part` temp file. On completion, the file is renamed.

Download progress is emitted via IPC channel `VOICE_DOWNLOAD_MODEL_PROGRESS` with payload
`{ modelId, downloadedBytes, totalBytes }`. The UI renders a `<Progress>` bar per model.

### 5. Cloud TTS via HTTP Fetch (No Streaming)

The `cloudEngines.ts` `CloudTtsEngine.synthesize()` calls a `google-tts` edge function via
`fetch()`. The response is a complete audio buffer — no streaming, since Google TTS's HTTP API
returns fully-formed audio. This is acceptable for short utterances; long-form TTS uses the
local engine.

### 6. Python Sidecar Isolation

`pythonSidecar.ts` creates a Python virtualenv inside `userData/python-sidecar/` via
`python -m venv`. Dependencies (edge-tts, torch, transformers, accelerate) are installed
with `pip install`. The sidecar is fully optional — if absent, the voice registry silently
falls back to Piper/Whisper.

### 7. Local Engine Routing in Speak.tsx

`Speak.tsx` checks `engine` and `platform`:
- Cloud → delegates to `CloudTtsEngine` or `CloudSttEngine`.
- Local + Desktop → spawns Piper or Whisper CLI.
- Local + Web → not available; user is prompted to switch to cloud or desktop app.

## Consequences

- Core installer avoids native compilation (no node-gyp, no onnxruntime-node, no CMake).
- Users on Windows/macOS/Linux can use voice features with zero extra installation steps
  (models are auto-downloaded on first use).
- Voice cloning requires microphone permission; users on Linux may need PulseAudio/WirePlumber.
- No streaming TTS for cloud engine; long Arabic/Urdu passages should use the local Piper engine.
- Python sidecar is an advanced add-on; the UI gracefully handles its absence.
- The CLI-spawn pattern adds a dependency on the piper and whisper-cli binaries being
  bundled with the Electron app (see `electron-builder` `extraResources`).
