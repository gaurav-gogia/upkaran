# Go WASM Module Guide

This project uses a hybrid architecture:

- UI and light processing in JavaScript/Svelte
- Heavy binary processing in Go WebAssembly

## Modules

- `pdf.go`: PDF transformation helpers
- `compress.go`: ZIP/TAR/GZIP helpers
- `util.go`: byte utility helpers

## Recommended Layout for Build Entrypoints

Create module-specific entrypoints that bind Go functions to JS globals via
`syscall/js`:

- `src/wasm/cmd/pdf/main.go` -> emits `wasmCompressPDF`
- `src/wasm/cmd/compress/main.go` -> emits `wasmGzipBytes`, `wasmZipBatch`,
  `wasmTarBatch`
- `src/wasm/cmd/util/main.go` -> emits `wasmConcatUint8`

## Example Build Commands (PowerShell)

```powershell
./scripts/build-wasm.ps1
```

Copy Go runtime helper:

```powershell
Copy-Item "$env:GOROOT\misc\wasm\wasm_exec.js" "public/wasm/wasm_exec.js" -Force
```

After placing these files, the app will automatically prefer WASM functions and
keep JS fallbacks for resilience.
