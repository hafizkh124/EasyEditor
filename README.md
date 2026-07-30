# Al-Ulama Easy Editor (العُلَمَاء اِیزی ایڈیٹر)

> **Scholarly Arabic & Urdu Editor for Researchers, Writers, and Islamic Scholars**
> *Available as both Web Application and Privacy-First Local Desktop App (Electron)*

[![AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron)](https://www.electronjs.org/)
[![Tests](https://img.shields.io/badge/Tests-263%20passing-6BA539?logo=vitest)](https://vitest.dev/)
![Platform](https://img.shields.io/badge/Platform-Windows%20|%20macOS%20|%20Linux-808080)

---

## 🌟 Key Features

- **Privacy-First Desktop Shell (M5)**: Zero cloud dependencies, 100% offline local SQLite & vector search (`sqlite-vec`).
- **BYOK Gemini AI**: Bring Your Own Key — your API key stays strictly in your local operating system's secure keytar store.
- **Maktaba Shamela 4 Native Integration**: One-click connect to local Shamela library directly via native Lucene 10 index search.
- **Local Voice Studio (Python-Free)**: Offline Speech-To-Text (Whisper) and Text-To-Speech (Piper Urdu & Arabic) with segmented synthesis.
- **Subtitles & Audio Books**: Export `.srt`, `.vtt`, and complete `.mp3` audiobooks with volume/chapter division.

---

## 🚀 Getting Started (Development)

```bash
# Clone the repository
git clone https://github.com/hafizkh124/scribe-studio-app.git
cd scribe-studio-app

# Install dependencies
npm install

# Run Web Development Server
npm run dev

# Run Electron Desktop Shell
npm run dev:electron
```

---

## 🧪 Quality & Tests

```bash
npm run typecheck    # TypeScript strict check
npm run test         # Vitest unit test suite
npm run lint         # ESLint check
npm run build        # Production build
npm run pack:electron # Package desktop executable
```

---

## 📄 License

Licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](./LICENSE).
