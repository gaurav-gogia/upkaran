$ErrorActionPreference = "Stop"

function Invoke-GoWasmBuild {
    param(
        [string]$Output,
        [string]$Package
    )

    if (Test-Path $Output) {
        Remove-Item -Force $Output
    }

    go build -o $Output $Package
    if ($LASTEXITCODE -ne 0) {
        throw "go build failed for $Package"
    }
}

Push-Location "src/wasm"
try {
    $env:GOOS = "js"
    $env:GOARCH = "wasm"

    Invoke-GoWasmBuild -Output "../../public/wasm/compress.wasm" -Package "./cmd/compress"
    Invoke-GoWasmBuild -Output "../../public/wasm/pdf.wasm" -Package "./cmd/pdf"
    Invoke-GoWasmBuild -Output "../../public/wasm/util.wasm" -Package "./cmd/util"
}
finally {
    Pop-Location
}

$runtimeTarget = "public/wasm/wasm_exec.js"

# Resolve GOROOT via `go env` if the environment variable is not set.
$goroot = $env:GOROOT
if ([string]::IsNullOrWhiteSpace($goroot)) {
    $goroot = (go env GOROOT 2>$null).Trim()
}

if ([string]::IsNullOrWhiteSpace($goroot)) {
    Write-Warning "wasm_exec.js not copied because GOROOT could not be determined."
}
else {
    # Go 1.21+ moved wasm_exec.js from misc/wasm to lib/wasm.
    $runtimeSource = Join-Path $goroot "lib/wasm/wasm_exec.js"
    if (-not (Test-Path $runtimeSource)) {
        $runtimeSource = Join-Path $goroot "misc/wasm/wasm_exec.js"
    }
    if (Test-Path $runtimeSource) {
        Copy-Item $runtimeSource $runtimeTarget -Force
        Write-Host "Copied wasm_exec.js from $runtimeSource"
    }
    else {
        Write-Warning "wasm_exec.js not found in GOROOT ($goroot). The browser Go runtime may be stale."
    }
}
