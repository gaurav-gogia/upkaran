<script>
  import { onDestroy, tick } from "svelte";
  import { createEventDispatcher } from "svelte";
  import { P2PSession, validateToken } from "../js/p2p.js";
  import { decodeQrFromImageFile } from "../js/qr-image.js";
  import { createSignalCode, pollSignalAnswer } from "../js/signal-api.js";

  export let entries = [];

  const dispatch = createEventDispatcher();

  // ── State machine ─────────────────────────────────────────────────────────
  // idle → generating → offer-ready → entering-answer → connecting → sending → done | error
  let step = "idle";
  let errorMsg = "";

  let session = null;
  let offerToken = "";
  let answerToken = "";
  let answerError = "";

  let selectedIds = new Set();
  let progress = 0;
  let progressName = "";
  let currentFileIdx = 0;
  let totalFiles = 0;
  let transportInfo = null;

  // QR canvas refs
  let offerQrCanvas = null;

  // Answer input
  let answerInputEl = null;
  let answerScannerActive = false;
  let videoEl = null;
  let scanCanvas = null;
  let answerImageInputEl = null;
  let scanAnimId = null;
  let jsQRLib = null;
  let answerScanAutoStarted = false;
  let signalCode = "";
  let signalStatus = "";
  let signalError = "";
  let signalExpiresInMs = 0;
  let signalCountdownId = null;
  let signalRunId = 0;

  // ── File selection ────────────────────────────────────────────────────────

  $: pdfAndImageEntries = entries.filter((e) => e.kind === "pdf" || e.kind === "image" || e.kind === "file" || e.kind === "other");

  function toggleSelect(id) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIds = next;
  }

  function selectAll() {
    selectedIds = new Set(entries.map((e) => e.id));
  }

  function clearSelection() {
    selectedIds = new Set();
  }

  $: selectedEntries = entries.filter((e) => selectedIds.has(e.id));

  // ── QR helpers ─────────────────────────────────────────────────────────────

  async function renderQr(canvas, text) {
    if (!canvas) return;
    const QRCode = (await import("qrcode")).default;
    QRCode.toCanvas(canvas, text, {
      width: 220,
      margin: 2,
      errorCorrectionLevel: "L",
      color: { dark: "#1c1b1f", light: "#fffbfe" }
    });
  }

  async function loadJsQr() {
    if (!jsQRLib) {
      const mod = await import("jsqr");
      jsQRLib = mod.default;
    }
    return jsQRLib;
  }

  // ── Offer generation ───────────────────────────────────────────────────────

  async function generateOffer() {
    if (selectedEntries.length === 0) {
      errorMsg = "Select at least one file to send.";
      return;
    }
    errorMsg = "";
    step = "generating";

    session?.close();
    session = new P2PSession();
    session.onStateChange((state) => {
      if (state === "channel-open" && step === "connecting") {
        step = "sending";
        void startSending();
      } else if (state === "failed" || state === "channel-error") {
        errorMsg = "Connection failed. Use the same network or configure TURN relay for internet transfer.";
        step = "error";
      }
    });
    session.onTransportChange((info) => {
      transportInfo = info;
    });
    session.onProgress((info) => {
      progress = info.progress;
      progressName = info.name;
      if (info.progress === 100) currentFileIdx++;
    });

    try {
      offerToken = await session.createOffer();
      step = "offer-ready";
      await tick();
      if (offerQrCanvas) await renderQr(offerQrCanvas, offerToken);
      void setupShortCodeFlow();
    } catch (err) {
      errorMsg = `Failed to create offer: ${err.message}`;
      step = "error";
    }
  }

  function stopSignalCountdown() {
    if (signalCountdownId) {
      clearInterval(signalCountdownId);
      signalCountdownId = null;
    }
  }

  function startSignalCountdown(ttlMs) {
    stopSignalCountdown();
    signalExpiresInMs = Math.max(0, Number(ttlMs || 0));
    if (!signalExpiresInMs) return;
    signalCountdownId = setInterval(() => {
      signalExpiresInMs = Math.max(0, signalExpiresInMs - 1000);
      if (!signalExpiresInMs) {
        stopSignalCountdown();
      }
    }, 1000);
  }

  async function setupShortCodeFlow() {
    if (!offerToken.trim()) return;

    const runId = ++signalRunId;
    signalError = "";
    signalStatus = "Creating 6-digit code…";
    signalCode = "";
    signalExpiresInMs = 0;

    try {
      const created = await createSignalCode(offerToken);
      if (runId !== signalRunId) return;

      signalCode = created.code;
      startSignalCountdown(created.ttlMs);
      signalStatus = "Waiting for receiver to join code…";

      const remoteAnswer = await pollSignalAnswer(created.code, {
        timeoutMs: Math.max(30000, Number(created.ttlMs || 120000))
      });
      if (runId !== signalRunId) return;

      answerToken = remoteAnswer;
      signalStatus = "Receiver joined. Connecting…";
      await submitAnswer();
    } catch (err) {
      if (runId !== signalRunId) return;
      signalStatus = "";
      signalError = err?.message || "Short code unavailable. Use QR/token fallback.";
    }
  }

  // ── Answer handling ────────────────────────────────────────────────────────

  async function submitAnswer() {
    const token = answerToken.trim();
    if (!validateToken(token)) {
      answerError = "Invalid answer token. Paste the token from the receiver.";
      return;
    }
    answerError = "";
    step = "connecting";
    try {
      await session.receiveAnswer(token);
      await session.waitForChannelOpen();
      step = "sending";
      void startSending();
    } catch (err) {
      errorMsg = `Connection error: ${err.message}`;
      step = "error";
    }
  }

  // ── QR scanner for answer ─────────────────────────────────────────────────

  async function startAnswerScanner() {
    if (answerScannerActive) return;
    answerScannerActive = true;
    await tick();
    await loadJsQr();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      videoEl.srcObject = stream;
      await videoEl.play();
      syncScanCanvasSize();
      scanAnswerLoop();
    } catch (err) {
      answerError = "Camera access denied. Paste the token manually.";
      stopAnswerScanner();
    }
  }

  function syncScanCanvasSize() {
    if (!videoEl || !scanCanvas) return;
    const vw = videoEl.videoWidth || 0;
    const vh = videoEl.videoHeight || 0;
    if (!vw || !vh) return;
    // Use camera-native dimensions for dense QR payloads.
    if (scanCanvas.width !== vw || scanCanvas.height !== vh) {
      scanCanvas.width = vw;
      scanCanvas.height = vh;
    }
  }

  function scanAnswerLoop() {
    if (!answerScannerActive) return;
    syncScanCanvasSize();
    if (!scanCanvas?.width || !scanCanvas?.height) {
      scanAnimId = requestAnimationFrame(scanAnswerLoop);
      return;
    }
    const ctx = scanCanvas.getContext("2d");
    const w = scanCanvas.width;
    const h = scanCanvas.height;
    ctx.drawImage(videoEl, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);
    const code = jsQRLib(imgData.data, imgData.width, imgData.height, { inversionAttempts: "attemptBoth" });
    if (code?.data) {
      answerToken = code.data;
      stopAnswerScanner();
      void submitAnswer();
      return;
    }
    scanAnimId = requestAnimationFrame(scanAnswerLoop);
  }

  function stopAnswerScanner() {
    answerScannerActive = false;
    cancelAnimationFrame(scanAnimId);
    if (videoEl?.srcObject) {
      videoEl.srcObject.getTracks().forEach((t) => t.stop());
      videoEl.srcObject = null;
    }
  }

  async function onAnswerImagePicked(event) {
    const file = event?.target?.files?.[0];
    event.target.value = "";
    if (!file) return;

    answerError = "";
    try {
      const token = await decodeQrFromImageFile(file);
      if (!token) {
        answerError = "No QR code found in selected image.";
        return;
      }
      answerToken = token;
      stopAnswerScanner();
      void submitAnswer();
    } catch {
      answerError = "Could not read QR from image. Try another screenshot or camera scan.";
    }
  }

  // ── Sending ───────────────────────────────────────────────────────────────

  async function startSending() {
    totalFiles = selectedEntries.length;
    currentFileIdx = 0;
    try {
      for (const entry of selectedEntries) {
        await session.sendFile(entry.file);
      }
      step = "done";
    } catch (err) {
      errorMsg = `Send error: ${err.message}`;
      step = "error";
    }
  }

  // ── Clipboard ─────────────────────────────────────────────────────────────

  async function copyToken(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  }

  // ── Reset ─────────────────────────────────────────────────────────────────

  function reset() {
    stopAnswerScanner();
    signalRunId += 1;
    stopSignalCountdown();
    session?.close();
    session = null;
    step = "idle";
    offerToken = "";
    answerToken = "";
    answerError = "";
    errorMsg = "";
    progress = 0;
    progressName = "";
    currentFileIdx = 0;
    totalFiles = 0;
    transportInfo = null;
    selectedIds = new Set();
    answerScanAutoStarted = false;
    signalCode = "";
    signalStatus = "";
    signalError = "";
    signalExpiresInMs = 0;
  }

  onDestroy(() => {
    stopAnswerScanner();
    stopSignalCountdown();
    session?.close();
  });

  $: if (
    (step === "offer-ready" || step === "entering-answer") &&
    !answerScannerActive &&
    !answerToken.trim() &&
    !answerScanAutoStarted
  ) {
    answerScanAutoStarted = true;
    void startAnswerScanner();
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getTransportLabel(info) {
    if (!info) return "Detecting route";
    return info.protocol ? `${info.label} · ${info.protocol}` : info.label;
  }

  function formatCodeTtl(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }
</script>

<div class="send-panel">

  <!-- ── File selection ── -->
  {#if step === "idle" || step === "generating"}
    <section class="card">
      <header>
        <h4>Select files to send</h4>
        <div class="header-actions">
          <button class="secondary" type="button" on:click={selectAll} disabled={entries.length === 0}>All</button>
          <button class="secondary" type="button" on:click={clearSelection}>None</button>
        </div>
      </header>

      {#if entries.length === 0}
        <p class="muted">No files loaded. Add files using the drop zone above.</p>
      {:else}
        <ul class="file-pick-list">
          {#each entries as entry (entry.id)}
            <li class:selected={selectedIds.has(entry.id)}>
              <label>
                <input type="checkbox" checked={selectedIds.has(entry.id)} on:change={() => toggleSelect(entry.id)} />
                <span class="file-name">{entry.name}</span>
                <span class="file-size">{formatBytes(entry.size)}</span>
              </label>
            </li>
          {/each}
        </ul>
      {/if}

      {#if errorMsg && step === "idle"}
        <p class="error-msg">{errorMsg}</p>
      {/if}

      <div class="actions">
        <button
          type="button"
          on:click={generateOffer}
          disabled={step === "generating" || selectedEntries.length === 0}
        >
          {step === "generating" ? "Generating…" : `Generate Offer (${selectedEntries.length} file${selectedEntries.length === 1 ? "" : "s"})`}
        </button>
      </div>
    </section>
  {/if}

  <!-- ── Offer QR + token ── -->
  {#if step === "offer-ready" || step === "entering-answer" || step === "connecting"}
    <section class="card">
      <header>
        <h4>Share offer with receiver</h4>
        <span class="step-badge">Step 1 of 2</span>
      </header>
      <div class="code-box">
        <div>
          <p class="code-label">Quick Connect Code</p>
          <p class="code-value">{signalCode || "......"}</p>
        </div>
        <button class="secondary" type="button" on:click={setupShortCodeFlow} disabled={step === "connecting"}>Refresh Code</button>
      </div>
      {#if signalStatus}
        <p class="muted">{signalStatus}{signalExpiresInMs > 0 ? ` · expires in ${formatCodeTtl(signalExpiresInMs)}` : ""}</p>
      {/if}
      {#if signalError}
        <p class="error-msg">{signalError}</p>
      {/if}
      <p class="muted">Show the QR code or copy the text token. The receiver scans or pastes it to generate an answer.</p>

      <div class="qr-wrap">
        <canvas bind:this={offerQrCanvas}></canvas>
      </div>

      <div class="token-row">
        <textarea class="token-area" readonly value={offerToken} rows="3"></textarea>
        <button class="secondary icon-btn" type="button" on:click={() => copyToken(offerToken)} title="Copy token">
          content_copy
        </button>
      </div>
    </section>

    <!-- Answer input -->
    <section class="card">
      <header>
        <h4>Enter receiver's answer</h4>
        <span class="step-badge">Step 2 of 2</span>
      </header>
      <p class="muted">Scan the receiver's QR code or paste their answer token below.</p>

      <div class="scan-actions">
        {#if !answerScannerActive}
          <button class="secondary" type="button" on:click={startAnswerScanner}>Scan QR</button>
        {:else}
          <button class="secondary" type="button" on:click={stopAnswerScanner}>Stop Camera</button>
        {/if}
        <button class="secondary" type="button" on:click={() => answerImageInputEl?.click()}>Scan Image</button>
        <input
          bind:this={answerImageInputEl}
          class="scan-file-input"
          type="file"
          accept="image/*"
          on:change={onAnswerImagePicked}
        />
      </div>

      {#if answerScannerActive}
        <div class="scanner-wrap">
          <!-- svelte-ignore a11y-media-has-caption -->
          <video bind:this={videoEl} playsinline muted class="scanner-video"></video>
          <canvas bind:this={scanCanvas} width="320" height="240" class="scan-canvas-hidden"></canvas>
        </div>
      {/if}

      <div class="token-row">
        <textarea
          bind:this={answerInputEl}
          class="token-area"
          placeholder="Paste answer token here…"
          bind:value={answerToken}
          rows="3"
          disabled={step === "connecting"}
        ></textarea>
        <button
          class="secondary icon-btn"
          type="button"
          on:click={async () => { answerToken = await navigator.clipboard.readText().catch(() => ""); }}
          title="Paste from clipboard"
          disabled={step === "connecting"}
        >
          content_paste
        </button>
      </div>

      {#if answerError}
        <p class="error-msg">{answerError}</p>
      {/if}

      <p class:detecting={!transportInfo || transportInfo.kind === "detecting"} class:relay={transportInfo?.kind === "relay"} class:direct={transportInfo?.kind === "direct"} class="transport-chip">
        {getTransportLabel(transportInfo)}
      </p>

      <div class="actions">
        <button
          type="button"
          on:click={submitAnswer}
          disabled={step === "connecting" || !answerToken.trim()}
        >
          {step === "connecting" ? "Connecting…" : "Connect & Send"}
        </button>
        <button class="secondary" type="button" on:click={reset}>Start over</button>
      </div>
    </section>
  {/if}

  <!-- ── Sending progress ── -->
  {#if step === "sending"}
    <section class="card">
      <header>
        <h4>Sending files</h4>
        <span class="muted">{currentFileIdx} / {totalFiles} done</span>
      </header>
      <p class:detecting={!transportInfo || transportInfo.kind === "detecting"} class:relay={transportInfo?.kind === "relay"} class:direct={transportInfo?.kind === "direct"} class="transport-chip">
        {getTransportLabel(transportInfo)}
      </p>
      <p class="progress-name">{progressName}</p>
      <progress value={progress} max="100"></progress>
      <p class="progress-pct">{progress}%</p>
    </section>
  {/if}

  <!-- ── Done ── -->
  {#if step === "done"}
    <section class="card success-card">
      <span class="material-symbols-outlined success-icon">check_circle</span>
      <h4>All files sent</h4>
      <p class="muted">{totalFiles} file{totalFiles === 1 ? "" : "s"} transferred successfully.</p>
      <div class="actions">
        <button class="secondary" type="button" on:click={reset}>Send more</button>
      </div>
    </section>
  {/if}

  <!-- ── Error ── -->
  {#if step === "error"}
    <section class="card error-card">
      <h4>Transfer failed</h4>
      <p class="error-msg">{errorMsg}</p>
      <div class="actions">
        <button class="secondary" type="button" on:click={reset}>Try again</button>
      </div>
    </section>
  {/if}

</div>

<style>
  .send-panel {
    display: grid;
    gap: 0.75rem;
  }

  .card {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 12px;
    padding: 1rem;
    background: var(--md-sys-color-surface-container-low);
    display: grid;
    gap: 0.6rem;
  }

  .card header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .card h4 {
    margin: 0;
    font-size: 0.92rem;
    font-weight: 600;
  }

  .header-actions {
    display: flex;
    gap: 0.4rem;
  }

  .step-badge {
    font-size: 0.75rem;
    color: var(--md-sys-color-on-surface-variant);
    background: var(--md-sys-color-surface-container);
    padding: 0.15rem 0.55rem;
    border-radius: 100px;
    white-space: nowrap;
  }

  .code-box {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 10px;
    padding: 0.55rem 0.65rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.65rem;
    flex-wrap: wrap;
    background: var(--md-sys-color-surface-container);
  }

  .code-label {
    margin: 0;
    font-size: 0.72rem;
    color: var(--md-sys-color-on-surface-variant);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .code-value {
    margin: 0.1rem 0 0;
    font-family: "Roboto Mono", monospace;
    font-size: 1.2rem;
    font-weight: 700;
    letter-spacing: 0.22em;
  }

  .muted {
    margin: 0;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.82rem;
  }

  .file-pick-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.3rem;
    max-height: 220px;
    overflow-y: auto;
  }

  .file-pick-list li {
    border-radius: 8px;
    border: 1px solid transparent;
    transition: background 0.1s;
  }

  .file-pick-list li.selected {
    background: var(--md-sys-color-secondary-container);
    border-color: var(--md-sys-color-outline-variant);
  }

  .file-pick-list label {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.55rem;
    padding: 0.4rem 0.6rem;
    cursor: pointer;
    min-width: 0;
  }

  .file-name {
    font-size: 0.85rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .file-size {
    font-size: 0.75rem;
    color: var(--md-sys-color-on-surface-variant);
    white-space: nowrap;
  }

  .qr-wrap {
    display: flex;
    justify-content: center;
    padding: 0.5rem 0;
  }

  .qr-wrap canvas {
    border-radius: 8px;
    border: 1px solid var(--md-sys-color-outline-variant);
  }

  .token-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.4rem;
    align-items: start;
  }

  .token-area {
    font-family: "Roboto Mono", monospace;
    font-size: 0.72rem;
    resize: none;
    word-break: break-all;
  }

  .icon-btn {
    font-family: "Material Symbols Outlined";
    font-size: 1.1rem;
    padding: 0.5rem 0.6rem;
    line-height: 1;
    align-self: start;
  }

  .scan-actions {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .scan-file-input {
    display: none;
  }

  .scanner-wrap {
    border-radius: 10px;
    overflow: hidden;
    position: relative;
  }

  .scanner-video {
    width: 100%;
    max-height: 240px;
    object-fit: cover;
    display: block;
  }

  .scan-canvas-hidden {
    display: none;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  progress {
    width: 100%;
    height: 6px;
    border-radius: 3px;
    overflow: hidden;
    appearance: none;
    border: none;
    background: var(--md-sys-color-surface-container);
  }

  progress::-webkit-progress-bar {
    background: var(--md-sys-color-surface-container);
  }

  progress::-webkit-progress-value {
    background: var(--md-sys-color-primary);
    transition: width 0.2s;
  }

  .progress-name {
    margin: 0;
    font-size: 0.82rem;
    color: var(--md-sys-color-on-surface-variant);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .progress-pct {
    margin: 0;
    font-size: 0.8rem;
    font-weight: 500;
    text-align: right;
  }

  .transport-chip {
    margin: 0;
    width: fit-content;
    max-width: 100%;
    padding: 0.25rem 0.55rem;
    border-radius: 999px;
    font-size: 0.74rem;
    font-weight: 600;
    letter-spacing: 0.01em;
  }

  .transport-chip.detecting {
    background: var(--md-sys-color-surface-container);
    color: var(--md-sys-color-on-surface-variant);
  }

  .transport-chip.direct {
    background: color-mix(in srgb, var(--md-sys-color-tertiary-container) 60%, #fff);
    color: var(--md-sys-color-on-tertiary-container);
  }

  .transport-chip.relay {
    background: color-mix(in srgb, var(--md-sys-color-secondary-container) 65%, #fff);
    color: var(--md-sys-color-on-secondary-container);
  }

  .success-card {
    text-align: center;
    background: color-mix(in srgb, var(--md-sys-color-tertiary-container) 30%, var(--md-sys-color-surface-container-low));
  }

  .success-icon {
    font-family: "Material Symbols Outlined";
    font-size: 2.5rem;
    color: var(--md-sys-color-tertiary);
    margin: 0 auto;
  }

  .success-card h4 {
    margin: 0;
    font-size: 1rem;
  }

  .error-card {
    background: color-mix(in srgb, var(--md-sys-color-error-container) 30%, var(--md-sys-color-surface-container-low));
  }

  .error-msg {
    margin: 0;
    font-size: 0.82rem;
    color: var(--md-sys-color-error);
  }
</style>
