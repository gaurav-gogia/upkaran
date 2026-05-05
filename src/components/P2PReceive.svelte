<script>
  import { onDestroy, tick } from "svelte";
  import { createEventDispatcher } from "svelte";
  import { P2PSession, validateToken } from "../js/p2p.js";
  import { decodeQrFromImageFile } from "../js/qr-image.js";
  import { joinSignalCode, normalizeSignalCode, publishSignalAnswer } from "../js/signal-api.js";

  const dispatch = createEventDispatcher();

  // ── State machine ─────────────────────────────────────────────────────────
  // idle → entering-offer → generating-answer → answer-ready → connecting → receiving → done | error
  let step = "idle";
  let errorMsg = "";

  let session = null;
  let offerToken = "";
  let offerError = "";
  let answerToken = "";

  let progress = 0;
  let progressName = "";
  let progressSize = 0;
  let transportInfo = null;

  let receivedFiles = [];

  // QR refs
  let answerQrCanvas = null;

  // QR scanner
  let offerScannerActive = false;
  let videoEl = null;
  let scanCanvas = null;
  let offerImageInputEl = null;
  let scanAnimId = null;
  let jsQRLib = null;
  let offerScanAutoStarted = false;
  let joinCode = "";
  let joinBusy = false;
  let joinError = "";
  let activeSignalCode = "";

  // ── QR helpers ────────────────────────────────────────────────────────────

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

  // ── Offer input (text) ────────────────────────────────────────────────────

  async function submitOffer(options = {}) {
    const autoPublishCode = `${options.autoPublishCode || ""}`.trim();
    const token = offerToken.trim();
    if (!validateToken(token)) {
      offerError = "Invalid offer token. Scan or paste the token from the sender.";
      return;
    }
    offerError = "";
    step = "generating-answer";

    session?.close();
    session = new P2PSession();
    session.onStateChange((state) => {
      if (state === "channel-open" && step === "connecting") {
        step = "receiving";
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
      progressSize = info.size;
    });
    session.onFileReceived(({ file, hashMatch }) => {
      receivedFiles = [...receivedFiles, { file, hashMatch }];
      if (!hashMatch) {
        console.warn(`Hash mismatch for ${file.name} — file may be corrupt.`);
      }
      progress = 0;
      progressName = "";
    });

    try {
      await session.receiveOffer(token);
      answerToken = await session.createAnswer();

      if (autoPublishCode) {
        await publishSignalAnswer(autoPublishCode, answerToken);
      } else {
        step = "answer-ready";
        await tick();
        if (answerQrCanvas) await renderQr(answerQrCanvas, answerToken);
      }

      // Now wait for sender to complete the handshake
      step = "connecting";
      await session.waitForChannelOpen();
      step = "receiving";
    } catch (err) {
      errorMsg = `Handshake error: ${err.message}`;
      step = "error";
    }
  }

  // ── QR scanner for offer ──────────────────────────────────────────────────

  async function startOfferScanner() {
    if (offerScannerActive) return;
    offerScannerActive = true;
    await tick();
    await loadJsQr();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      videoEl.srcObject = stream;
      await videoEl.play();
      syncScanCanvasSize();
      scanOfferLoop();
    } catch {
      offerError = "Camera access denied. Paste the token manually.";
      stopOfferScanner();
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

  function scanOfferLoop() {
    if (!offerScannerActive) return;
    syncScanCanvasSize();
    if (!scanCanvas?.width || !scanCanvas?.height) {
      scanAnimId = requestAnimationFrame(scanOfferLoop);
      return;
    }
    const ctx = scanCanvas.getContext("2d");
    const w = scanCanvas.width;
    const h = scanCanvas.height;
    ctx.drawImage(videoEl, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);
    const code = jsQRLib(imgData.data, imgData.width, imgData.height, { inversionAttempts: "attemptBoth" });
    if (code?.data) {
      offerToken = code.data;
      stopOfferScanner();
      void submitOffer();
      return;
    }
    scanAnimId = requestAnimationFrame(scanOfferLoop);
  }

  function stopOfferScanner() {
    offerScannerActive = false;
    cancelAnimationFrame(scanAnimId);
    if (videoEl?.srcObject) {
      videoEl.srcObject.getTracks().forEach((t) => t.stop());
      videoEl.srcObject = null;
    }
  }

  async function onOfferImagePicked(event) {
    const file = event?.target?.files?.[0];
    event.target.value = "";
    if (!file) return;

    offerError = "";
    try {
      const token = await decodeQrFromImageFile(file);
      if (!token) {
        offerError = "No QR code found in selected image.";
        return;
      }
      offerToken = token;
      stopOfferScanner();
      void submitOffer();
    } catch {
      offerError = "Could not read QR from image. Try another screenshot or camera scan.";
    }
  }

  async function joinWithCode() {
    const code = normalizeSignalCode(joinCode);
    joinCode = code;
    if (!/^\d{6}$/.test(code)) {
      joinError = "Enter a 6-digit code.";
      return;
    }

    joinError = "";
    offerError = "";
    joinBusy = true;

    try {
      const joined = await joinSignalCode(code);
      activeSignalCode = code;
      offerToken = joined.offerToken;
      stopOfferScanner();
      await submitOffer({ autoPublishCode: code });
    } catch (err) {
      joinError = err?.message || "Could not join with this code.";
    } finally {
      joinBusy = false;
    }
  }

  // ── Clipboard ─────────────────────────────────────────────────────────────

  async function copyToken(text) {
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
  }

  async function pasteOffer() {
    try {
      offerToken = await navigator.clipboard.readText();
    } catch { /* ignore */ }
  }

  // ── Deliver received files to parent ─────────────────────────────────────

  function addToFileList() {
    dispatch("filesreceived", receivedFiles.map((r) => r.file));
    step = "done-added";
  }

  // ── Reset ─────────────────────────────────────────────────────────────────

  function reset() {
    stopOfferScanner();
    session?.close();
    session = null;
    step = "idle";
    offerToken = "";
    offerError = "";
    answerToken = "";
    errorMsg = "";
    progress = 0;
    progressName = "";
    progressSize = 0;
    transportInfo = null;
    receivedFiles = [];
    offerScanAutoStarted = false;
    joinCode = "";
    joinBusy = false;
    joinError = "";
    activeSignalCode = "";
  }

  onDestroy(() => {
    stopOfferScanner();
    session?.close();
  });

  $: if (
    step === "idle" &&
    !offerScannerActive &&
    !offerToken.trim() &&
    !offerScanAutoStarted
  ) {
    offerScanAutoStarted = true;
    void startOfferScanner();
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
</script>

<div class="receive-panel">

  <!-- ── Offer input ── -->
  {#if step === "idle" || step === "generating-answer"}
    <section class="card">
      <header>
        <h4>Receive offer from sender</h4>
        <span class="step-badge">Step 1 of 2</span>
      </header>
      <p class="muted">Scan the sender's QR code, or paste their offer token below.</p>

      <div class="code-join-box">
        <div>
          <p class="code-label">Quick Connect Code</p>
          <input
            class="code-input"
            type="text"
            inputmode="numeric"
            maxlength="6"
            placeholder="123456"
            value={joinCode}
            on:input={(event) => (joinCode = normalizeSignalCode(event.currentTarget.value))}
            disabled={step === "generating-answer" || joinBusy}
          />
        </div>
        <button class="secondary" type="button" on:click={joinWithCode} disabled={step === "generating-answer" || joinBusy || joinCode.length !== 6}>
          {joinBusy ? "Joining…" : "Join Code"}
        </button>
      </div>
      {#if joinError}
        <p class="error-msg">{joinError}</p>
      {/if}

      <div class="scan-actions">
        {#if !offerScannerActive}
          <button class="secondary" type="button" on:click={startOfferScanner} disabled={step === "generating-answer"}>Scan QR</button>
        {:else}
          <button class="secondary" type="button" on:click={stopOfferScanner}>Stop Camera</button>
        {/if}
        <button class="secondary" type="button" on:click={() => offerImageInputEl?.click()} disabled={step === "generating-answer"}>Scan Image</button>
        <input
          bind:this={offerImageInputEl}
          class="scan-file-input"
          type="file"
          accept="image/*"
          on:change={onOfferImagePicked}
        />
      </div>

      {#if offerScannerActive}
        <div class="scanner-wrap">
          <!-- svelte-ignore a11y-media-has-caption -->
          <video bind:this={videoEl} playsinline muted class="scanner-video"></video>
          <canvas bind:this={scanCanvas} width="320" height="240" class="scan-canvas-hidden"></canvas>
        </div>
      {/if}

      <div class="token-row">
        <textarea
          class="token-area"
          placeholder="Paste offer token here…"
          bind:value={offerToken}
          rows="3"
          disabled={step === "generating-answer"}
        ></textarea>
        <button
          class="secondary icon-btn"
          type="button"
          on:click={pasteOffer}
          title="Paste from clipboard"
          disabled={step === "generating-answer"}
        >
          content_paste
        </button>
      </div>

      {#if offerError}
        <p class="error-msg">{offerError}</p>
      {/if}

      <div class="actions">
        <button
          type="button"
          on:click={submitOffer}
          disabled={step === "generating-answer" || !offerToken.trim()}
        >
          {step === "generating-answer" ? "Generating answer…" : "Process Offer"}
        </button>
      </div>
    </section>
  {/if}

  <!-- ── Answer QR + token ── -->
  {#if step === "answer-ready" || step === "connecting" || step === "receiving"}
    <section class="card">
      <header>
        <h4>Share your answer with sender</h4>
        <span class="step-badge">Step 2 of 2</span>
      </header>
      {#if activeSignalCode}
        <p class="muted">Answer published using code {activeSignalCode}. Sender will connect automatically.</p>
      {/if}
      <p class="muted">Show the sender this QR code or send them the text token. Once they enter it, transfer will begin automatically.</p>

      <div class="qr-wrap">
        <canvas bind:this={answerQrCanvas}></canvas>
      </div>

      <div class="token-row">
        <textarea class="token-area" readonly value={answerToken} rows="3"></textarea>
        <button class="secondary icon-btn" type="button" on:click={() => copyToken(answerToken)} title="Copy token">
          content_copy
        </button>
      </div>

      <p class:detecting={!transportInfo || transportInfo.kind === "detecting"} class:relay={transportInfo?.kind === "relay"} class:direct={transportInfo?.kind === "direct"} class="transport-chip">
        {getTransportLabel(transportInfo)}
      </p>

      {#if step === "connecting"}
        <p class="muted status-line">Waiting for sender to connect…</p>
      {:else if step === "receiving"}
        <p class="muted status-line">Connected. Receiving files…</p>
      {/if}
    </section>
  {/if}

  <!-- ── Receiving progress ── -->
  {#if step === "receiving"}
    <section class="card">
      <header>
        <h4>Receiving</h4>
        {#if progressName}
          <span class="muted">{progressName}</span>
        {/if}
      </header>
      <p class:detecting={!transportInfo || transportInfo.kind === "detecting"} class:relay={transportInfo?.kind === "relay"} class:direct={transportInfo?.kind === "direct"} class="transport-chip">
        {getTransportLabel(transportInfo)}
      </p>
      {#if progressName}
        <progress value={progress} max="100"></progress>
        <p class="progress-pct">{progress}%{progressSize > 0 ? ` · ${formatBytes(progressSize)}` : ""}</p>
      {:else}
        <p class="muted">Waiting for sender to start…</p>
      {/if}
    </section>
  {/if}

  <!-- ── Received files ── -->
  {#if (step === "receiving" || step === "done-added") && receivedFiles.length > 0}
    <section class="card">
      <header>
        <h4>Received files</h4>
        <span class="muted">{receivedFiles.length} file{receivedFiles.length === 1 ? "" : "s"}</span>
      </header>
      <ul class="recv-list">
        {#each receivedFiles as item (item.file.name + item.file.size)}
          <li>
            <span class="material-symbols-outlined recv-icon" class:ok={item.hashMatch} class:warn={!item.hashMatch}>
              {item.hashMatch ? "verified" : "warning"}
            </span>
            <span class="file-name">{item.file.name}</span>
            <span class="file-size">{formatBytes(item.file.size)}</span>
          </li>
        {/each}
      </ul>

      {#if step !== "done-added"}
        <div class="actions">
          <button type="button" on:click={addToFileList}>Add to File List</button>
        </div>
      {:else}
        <p class="muted">Files added to the file list.</p>
      {/if}
    </section>
  {/if}

  <!-- ── Done ── -->
  {#if step === "done-added"}
    <div class="actions">
      <button class="secondary" type="button" on:click={reset}>Receive more</button>
    </div>
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
  .receive-panel {
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

  .step-badge {
    font-size: 0.75rem;
    color: var(--md-sys-color-on-surface-variant);
    background: var(--md-sys-color-surface-container);
    padding: 0.15rem 0.55rem;
    border-radius: 100px;
    white-space: nowrap;
  }

  .muted {
    margin: 0;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.82rem;
  }

  .scan-actions {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .code-join-box {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 10px;
    padding: 0.55rem 0.65rem;
    display: flex;
    justify-content: space-between;
    align-items: end;
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

  .code-input {
    margin-top: 0.2rem;
    width: 150px;
    font-family: "Roboto Mono", monospace;
    letter-spacing: 0.22em;
    text-align: center;
    font-size: 1rem;
    font-weight: 700;
  }

  .scan-file-input {
    display: none;
  }

  .scanner-wrap {
    border-radius: 10px;
    overflow: hidden;
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

  .qr-wrap {
    display: flex;
    justify-content: center;
    padding: 0.5rem 0;
  }

  .qr-wrap canvas {
    border-radius: 8px;
    border: 1px solid var(--md-sys-color-outline-variant);
  }

  .status-line {
    font-style: italic;
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

  .progress-pct {
    margin: 0;
    font-size: 0.8rem;
    font-weight: 500;
    text-align: right;
  }

  .recv-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.3rem;
  }

  .recv-list li {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0.2rem;
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
  }

  .recv-list li:last-child {
    border-bottom: none;
  }

  .recv-icon {
    font-family: "Material Symbols Outlined";
    font-size: 1.2rem;
  }

  .recv-icon.ok { color: var(--md-sys-color-tertiary); }
  .recv-icon.warn { color: var(--md-sys-color-error); }

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

  .actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
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
