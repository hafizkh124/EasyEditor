# ADR 0009 — Voice Studio Implementation Patterns

**Status:** Accepted · **Date:** 2026-07-29 (revised 2026-07-30) · **Milestone:** M5.5 & M5.6 & M5.7

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

### 2. whisper.cpp via a Prebuilt Node Addon

**Superseded the original `whisper-cli` spawn.** Spawning the CLI required the binary to be
sourced and bundled per platform, which the core installer cannot do (NFR-14). We instead call
`@kutalia/whisper-node-addon` (MIT), which ships prebuilt whisper.cpp binaries per
platform/arch and returns `[start, end, text]` rows that map directly to `TranscriptSegment[]`.

Two constraints this package imposes on the calling code:

- Its default is `translate: true` (translate-to-English), which would silently discard the
  Urdu/Arabic transcript FR-6.10 asks for. `translate: false` must be passed explicitly.
- It `dlopen()`s its native binary during module evaluation, so a top-level import throws
  before any of our own validation runs — on a machine whose prebuilt binary won't load, that
  takes the whole voice IPC module down with it. `whisper.ts` therefore imports it lazily on
  first use and reports a load failure as a transcription error.

Because the addon resolves its `.node` file relative to its own `__dirname`, it must stay
external to the Vite main-process bundle (see `vite.config.ts`).

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
`python -m venv`. Dependencies (torch, transformers, accelerate) are installed with
`pip install`. The sidecar is fully optional — if absent, the voice registry silently
falls back to Piper/Whisper.

It deliberately does **not** install Python's `edge-tts`: the online engine now runs on the
`msedge-tts` Node package (see decision 8), so FR-6.6 works with or without the sidecar.

### 7. Local Engine Routing in Speak.tsx

`Speak.tsx` checks `engine` and `platform`:
- Cloud → delegates to `CloudTtsEngine` or `CloudSttEngine`.
- Local + Desktop → spawns the Piper CLI, or calls the Whisper addon.
- Local + Web → not available; user is prompted to switch to cloud or desktop app.

### 8. Online Engine via the msedge-tts Node Package

**Superseded the original `edge-tts` Python CLI spawn**, which made FR-6.6's online engine
depend on the optional Python sidecar — contradicting NFR-13 ("voice complete without Python").
`electron/voice/edgeTts.ts` now uses `msedge-tts` (MIT), a pure-Node client for the same
Microsoft Read Aloud endpoint, and keeps the WebSocket work behind the same consent gate.

- Output stays `AUDIO_24KHZ_48KBITRATE_MONO_MP3`, matching what `edge-tts --write-media -`
  produced, so renderer playback and audiobook export are unaffected.
- A truncated or failed stream surfaces as a rejected promise, and a zero-byte result is
  turned into an explicit error — FR-6.6 forbids silently empty audio.
- The package is external to the main-process bundle so that `ws`'s optional native extras
  are not pulled into it.

### 9. Consent Gate and Piper Fallback Live in the Main Process

FR-6.6 asks for three things the earlier wiring did not provide: consent before any text
leaves the machine, an automatic fallback to Piper on failure, and never silence.

- **Consent** is stored in the renderer (`voice_online_engine_consent`) and passed on each
  request as `onlineConsent`. The main process refuses `edge-tts` unless it is exactly `true`
  — absent is a refusal, not a default. `VoiceEnginePanel` shows the Microsoft-naming dialog
  when the engine is selected, and does not persist the selection if the user declines.
- **Fallback** is decided in the main process, not the renderer: on any `edge-tts` failure it
  synthesizes with a downloaded Piper voice for that language, chosen from `MODEL_CATALOG`
  when the caller named no `voiceId`. If Piper cannot run either, the error names both
  failures rather than the online one alone.
- **The result is self-describing.** `VOICE_SYNTHESIZE` returns
  `{ audio, engineUsed, mimeType, fallbackFrom?, fallbackReason? }` instead of a bare
  `ArrayBuffer`. Two reasons: the formats differ (MP3 online, WAV local), so the renderer
  cannot label the blob without being told; and R22's "online" badge would otherwise lie
  whenever a fallback silently happened.
- **Empty audio is an error** on both engines, so a zero-byte buffer can never reach playback
  as apparent success.

## Consequences

- Core installer avoids native compilation (no node-gyp, no onnxruntime-node, no CMake).
- Users on Windows/macOS/Linux can use voice features with zero extra installation steps
  (models are auto-downloaded on first use).
- Voice cloning requires microphone permission; users on Linux may need PulseAudio/WirePlumber.
- No streaming TTS for cloud engine; long Arabic/Urdu passages should use the local Piper engine.
- Python sidecar is an advanced add-on; the UI gracefully handles its absence — and no voice
  feature, online or offline, depends on it any more.
- The CLI-spawn pattern adds a dependency on the piper binary being bundled with the Electron
  app (see `electron-builder` `extraResources`). Whisper no longer needs this: its binaries
  arrive with the npm package.
