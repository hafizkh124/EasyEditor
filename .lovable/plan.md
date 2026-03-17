

## Current State of TTS Voice Mappings

**What works (confirmed from network logs):**
- English (`en-US`, `en-US-Wavenet-D`) — works correctly
- Arabic (`ar-XA`, `ar-XA-Wavenet-A`) — works correctly for Arabic text
- Urdu fallback (`hi-IN`, `hi-IN-Wavenet-A`) — returns audio but with Hindi pronunciation, not native Urdu

**Core problem:** Google Cloud TTS has no `ur-PK` voices. The Hindi fallback produces audio but mispronounces Urdu-specific characters.

## Recommended Fix: Use ElevenLabs for Urdu, Google TTS for English/Arabic

Since ElevenLabs has native Urdu support and is already integrated in the project (via `elevenlabs-tts` edge function), the best approach is a hybrid TTS strategy:

### Changes

1. **`src/pages/Speak.tsx`** — Update `callTtsApi` to route Urdu personas to ElevenLabs while keeping Google TTS for English and Arabic:
   - If `selectedPersona.voiceLang === "ur"`, call the `elevenlabs-tts` edge function with the persona's ElevenLabs voice ID
   - Otherwise, call `google-tts` as currently implemented

2. **Edge function `elevenlabs-tts`** — Verify it already handles Urdu text correctly (it should, as ElevenLabs supports multilingual voices natively)

This gives native Urdu pronunciation via ElevenLabs while keeping the cost-effective Google TTS for English and Arabic.

### Technical Details

In `Speak.tsx`, the `callTtsApi` function will branch:

```text
callTtsApi()
  ├── voiceLang === "ur" → POST /functions/v1/elevenlabs-tts
  │     body: { text, voiceId, speed }
  └── voiceLang === "en" | "ar" → POST /functions/v1/google-tts
        body: { text, languageCode, voiceName, speed }
```

Both paths return an audio blob that feeds into the existing playback pipeline unchanged.

