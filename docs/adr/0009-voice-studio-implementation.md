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

### 10. Segmented Synthesis Runs Inside the Piper Path

FR-6.5 is wired into `synthesizeLocalTts` (`electron/voice/localTts.ts`) rather than exposed as
its own engine, so
every route that reaches Piper — direct selection and the FR-6.6 fallback alike — gets the
per-script split without the caller asking for it.

- Voices are resolved per script kind from `MODEL_CATALOG` (Urdu, Arabic, and the requested
  language's primary voice for Latin/neutral runs).
- When only one voice is downloaded, the text is spoken in a single call. Splitting would add
  joins with nothing to gain, and a missing Arabic voice must cost pronunciation quality on
  those runs, not the audio itself.
- Marker-less Arabic-script runs are resolved by the requested language, not always to Urdu.
- Segmentation deliberately does **not** apply to `edge-tts`: it handles mixed input well, and
  its MP3 output cannot be concatenated the way PCM can.

Two failure modes are made loud rather than silent, both previously able to corrupt output
unnoticed:

- A run whose script kind has no engine and no `neutral` catch-all now throws. It used to be
  skipped, dropping that sentence from the audio with no error.
- `wavConcat` carries one header — the first buffer's — so joining WAVs that disagree on
  sample rate, channels, or bit depth would leave part of the audio playing at the wrong
  speed. It now refuses instead. This matters because `piper.ts` writes a 22050 Hz header for
  every model; the catalogue's voices are all medium quality (22050 Hz), but a low-quality
  16 kHz voice would violate that assumption.

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

### 11. Local Transcription Is Routed Once, Not Per Chunk

FR-6.2 names one seam — `transcribeLongForm.ts`'s `functions.invoke("transcribe")` — and the
chunking, progress, and cancellation logic above it is left untouched.

- **The route is decided before chunking**, by `resolveSttRoute()`: desktop, plus a `whisper`
  preference, plus a Whisper model actually downloaded. A run therefore cannot change engines
  half way through, and the local route is never chosen only to fail on chunk one.
- **The STT preference is separate from TTS and global.** Sharing keys would be a bug —
  `getPreferredEngine('ur-PK')` answers `'piper'`, meaningless for transcription. It is not
  per-language because one Whisper model covers all 99 languages (unlike Piper's per-language
  voices), and a per-language key would leave the page's "auto" option with no stored answer.
  The default stays `cloud`, so nothing changes until the user opts in.
- **Chunks are passed as bytes, not paths.** The renderer decodes and slices in memory while
  whisper.cpp reads from a path, so `VOICE_TRANSCRIBE` accepts an `ArrayBuffer` and the main
  process owns the temp file, removing it in a `finally`.
- **Segment times are made absolute** by offsetting each chunk's timestamps by its
  `startSeconds`. Without this every chunk's subtitles would restart from zero.
- **FR-6.8**: the token gate is bypassed on the local route, since local transcription costs
  nothing. An empty balance must not block it.

For FR-6.3, the subtitle buttons are always rendered but disabled when no timestamps exist,
with a title saying how to get them. Disabled rather than hidden keeps the capability
discoverable, and means an empty subtitle file can never be written. Note that an empty
segment array from a chunk means silence, not a missing-timestamp engine — subtitles stay
available in that case and simply skip the silence.

### 12. Audiobook Export Encodes in Main, with Real ID3 Chapter Marks

FR-6.9 asks for the whole document as `.mp3` with chapter marks, spoken through the FR-6.5
split. Three decisions carry that.

**MP3 comes from a JavaScript encoder.** Piper emits WAV, and NFR-14 keeps binaries out of the
installer — so bundling ffmpeg or LAME per platform is not available. `@breezystack/lamejs`
(LGPL-3.0, compatible with the project's AGPL-3.0) is a pure-JS LAME port, so nothing
per-platform is shipped or built. It is slower than native LAME, which is acceptable for an
offline export that already spends most of its wall time in synthesis. WAV was rejected as the
output format: a six-hour book is roughly 950 MB as 22 kHz mono PCM against about 85 MB at
64 kbps.

**Everything runs in the main process.** Synthesis is already there, and a book-length WAV is
far too large to send over IPC just to encode it in the renderer. The finished file is written
from main behind a save dialog, so the renderer never holds the audiobook in memory — only
progress events and the resulting path cross the boundary.

**Chapter marks are ID3v2 CHAP/CTOC frames**, not a sidecar text file, because "chapter marks"
means marks a player can jump between. Details that matter:

- v2.3 rather than v2.4 — more widely supported — with text frames written as UTF-16 plus BOM,
  since v2.3's only other encoding is ISO-8859-1, which cannot carry an Urdu or Arabic chapter
  title at all.
- Frame sizes are plain big-endian uint32. Only the *tag* header is synchsafe in v2.3; writing
  synchsafe frame sizes is a well-known way to produce a tag players quietly ignore.
- Chapter boundaries are measured from the synthesized audio (`wavDurationMs` over the actual
  PCM length), never estimated from text length, so the marks land where the words are.

The export reports per-chapter progress and can be cancelled — a book runs for minutes, and the
cancel flag is keyed per `WebContents` so two windows cannot cancel each other's export. The
WAV reader walks the RIFF chunks rather than assuming the canonical 44-byte header, because a
LIST or fact chunk would otherwise be fed to the encoder as audio.
