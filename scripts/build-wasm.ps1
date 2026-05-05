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
if ([string]::IsNullOrWhiteSpace($env:GOROOT)) {
    Write-Warning "wasm_exec.js not copied because GOROOT is not set."
}
else {
    $runtimeSource = Join-Path $env:GOROOT "misc/wasm/wasm_exec.js"
    if (Test-Path $runtimeSource) {
        Copy-Item $runtimeSource $runtimeTarget -Force
    }
    else {
        Write-Warning "wasm_exec.js not copied because file was not found at $runtimeSource"
    }
}
