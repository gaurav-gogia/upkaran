# उपकरण · upkaran

> **All processing happens in your browser. No files are ever uploaded to a
> server.**

A privacy-first, offline-capable file utility suite built with Svelte and
WebAssembly. Drop files in, get results out — nothing leaves your device.

---

## Features

### PDF Tools

- Merge multiple PDFs with drag-to-reorder
- Split into individual pages or custom page groups
- Extract a page range into a new PDF
- Remove pages by range
- Rotate selected pages
- Crop selected pages with margin controls
- Add page numbers with configurable position and style
- Add text or image watermarks
- Compress PDF (via Go WebAssembly)
- Convert PDF pages to images (PNG / JPEG / WebP)
- Repair malformed PDFs with explicit recovery status
- OCR pilot entrypoint with explicit capability status
- Unlock PDF (remove restrictions or password with provided passphrase)
- Lock PDF with an opening password and security presets

### Image Tools

- Compress images with quality control
- Convert between formats: PNG, JPEG, WebP, AVIF
- Interactive crop with draggable resize handles
- Batch crop using a normalized selection applied across all images
- HEIC / HEIF support (including files from iPhone / iPad)

### File Tools

- GZIP a single file (JS fallback + WASM acceleration)
- ZIP a batch of files
- TAR a batch of files

### P2P Transfer

- Send files directly to another device over a WebRTC data channel (file bytes
  stay peer-to-peer)
- Quick connect with an 8-character short code via ephemeral signaling API
- Signaling fallback via compressed tokens: share as a QR code or paste as text
- Optional TURN server configuration stored locally for NAT traversal
- Chunked streaming transfer with progress tracking

---

## Tech Stack

| Layer            | Library                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------- |
| UI framework     | [Svelte 4](https://svelte.dev) + [Vite](https://vitejs.dev)                             |
| PDF manipulation | [pdf-lib](https://pdf-lib.js.org), [pdfjs-dist](https://mozilla.github.io/pdf.js/)      |
| Compression      | [fflate](https://github.com/101arrowz/fflate) + Go/WASM                                 |
| Image conversion | Canvas API, [heic2any](https://github.com/alexcorvi/heic2any)                           |
| QR codes         | [qrcode](https://github.com/soldair/node-qrcode), [jsqr](https://github.com/cozmo/jsqr) |
| P2P signaling    | WebRTC DataChannels (STUN / optional TURN)                                              |
| Heavy processing | Go compiled to WebAssembly                                                              |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) 18+
- [Go](https://go.dev) 1.21+ _(only required to rebuild WASM modules)_

### Install & Run

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

### Build for Production

```bash
npm run build
npm run preview
```

### Deploy to Production (Cloudflare Workers)

```bash
npm run deploy
```

This uploads `dist/client` as static assets (including `manifest.json` and
`service-worker.js`) and deploys the Worker runtime.

### Rebuild WebAssembly Modules

```powershell
npm run build:wasm
```

This runs `scripts/build-wasm.ps1`, which compiles the Go source under
`src/wasm/` into `.wasm` files and copies the Go runtime helper (`wasm_exec.js`)
into `public/wasm/`.

### Reliability Baseline (Tier A)

```bash
npm run reliability:sample
npm run reliability:baseline
```

Or run both in sequence:

```bash
npm run reliability:full
```

`reliability:sample` generates local fixture files, executes Tier A smoke
checks, and writes measured pass/fail + duration records to:

- `fixtures/reliability/results/latest.json`

This reads:

- `fixtures/reliability/manifest.json` for operation + fixture expectations
- `fixtures/reliability/results/latest.json` for pass/fail runtime samples

And writes reports to:

- `fixtures/reliability/reports/baseline-latest.json`
- `fixtures/reliability/reports/baseline-latest.md`

Use this to track baseline pass rate and p95 runtime across parity-critical
operations (watermark image/text, repair, crop, OCR pilot, Office conversion
reliability checks, Tier A route smoke checks, PDF reorder edge-case checks, and
lock/unlock policy checks, unlock runtime-path checks, and repair-unlock
interaction checks, split-by-size checks, PDF/A export checks, batch metadata
checks, output naming template checks, protect/unprotect preset checks, and
header/footer preset checks).

---

## Project Structure

```
src/
├── components/       # Svelte UI components
├── js/               # Tool logic (PDF, image, file, P2P)
├── routes/           # Client-side router
├── styles/           # Global CSS
└── wasm/             # Go source for WASM modules
    └── cmd/          # Build entrypoints (one per module)
public/
└── wasm/             # Compiled .wasm files + wasm_exec.js
```

---

## Privacy

All operations run client-side using browser APIs and WebAssembly. The P2P
transfer feature uses WebRTC, which may use a STUN server for NAT traversal
(default: `stun.l.google.com`). No file content is ever sent to any server.
