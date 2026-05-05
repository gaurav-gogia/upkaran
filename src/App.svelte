<script>
  import { fade, fly } from "svelte/transition";
  import Dropzone from "./components/Dropzone.svelte";
  import FileList from "./components/FileList.svelte";
  import Toolbar from "./components/Toolbar.svelte";
  import { resolveRouteFromSelection, resolveRoute, ROUTES } from "./routes/router.js";
  import { enrichFiles } from "./js/detect.js";
  import { addResults, clearResults } from "./js/results-store.js";

  let entries = [];
  let selectedFiles = [];
  let modalSelectedIds = [];
  let mixedModalOpen = false;
  let modalError = "";
  let baseActiveFiles = [];
  let modalSelectedFiles = [];
  let effectiveFiles = [];
  let baseRoute = ROUTES.EMPTY;
  let route = ROUTES.EMPTY;

  /** Which editor workspace is currently open (null | 'latex' | 'mermaid' | 'plantuml') */
  let activeEditor = null;
  let forensicsEntry = null;

  let processing = false;
  let progress = 0;
  let error = "";
  let resultsBatch = 0;

  // ── Toast system ──────────────────────────────────────────────────────
  let toasts = [];
  let _toastId = 0;
  let _progressResetTimer;

  function showToast({ message, type = "success", duration = 5000, action = null, actionLabel = "View" }) {
    const id = _toastId++;
    toasts = [...toasts, { id, message, type, action, actionLabel }];
    setTimeout(() => dismissToast(id), duration);
  }

  function dismissToast(id) {
    toasts = toasts.filter((t) => t.id !== id);
  }

  function scrollToResults() {
    document.getElementById("results-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  let dropzoneRef;
  let pickerAccept = "";
  let featureOverviewCollapsed = false;
  let p2pOpen = false;

  const featureGroups = [
    {
      title: "PDF",
      pickerAccept: ".pdf,application/pdf",
      cta: "Try PDF tools",
      items: [
        "Merge PDFs with drag reorder",
        "Split per page or custom groups",
        "Extract pages by range",
        "Remove pages by range",
        "Rotate selected pages",
        "Add page numbers",
        "Compress PDF",
        "PDF to images",
        "Unlock / remove PDF restrictions"
      ]
    },
    {
      title: "Images",
      pickerAccept: "image/*,.heic,.heif",
      cta: "Try Image tools",
      items: [
        "Compress selected images",
        "Convert format (PNG/JPEG/WebP/AVIF)",
        "Interactive crop with resize handles",
        "Batch crop using normalized selection",
        "Supports common formats including HEIC"
      ]
    },
    {
      title: "Content → PDF",
      pickerAccept: ".txt,.rtf,.md,.docx,.pptx,.xlsx,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.htm,.js,.ts,.py,.go,.java,.rb,.rs,.c,.cpp,.h,.sh,.css,.sql",
      cta: "Try Content tools",
      items: [
        "DOCX, PPTX, XLSX → PDF",
        "TXT, RTF, Markdown → PDF",
        "CSV / TSV table → PDF",
        "JSON, YAML, XML → PDF",
        "Source code with syntax highlighting → PDF",
        "HTML / SVG → PDF"
      ]
    },
    {
      title: "Files",
      pickerAccept: "",
      cta: "Try File tools",
      items: [
        "GZIP single file",
        "ZIP batch",
        "TAR batch"
      ]
    },
    {
      title: "P2P Transfer",
      pickerAccept: "",
      cta: "Open P2P Transfer",
      p2pCta: true,
      items: [
        "Browser-to-browser file bytes (no file upload server)",
        "8-character quick connect code + QR/token fallback",
        "Chunked transfer with SHA-256 verify",
        "Works on the same local network"
      ]
    },
    {
      title: "Workflow",
      pickerAccept: "",
      cta: "Start now",
      items: [
        "Multi-select with shift range",
        "Drag reorder in file list",
        "Mixed selection modal",
        "Offline processing in browser"
      ]
    }
  ];

  $: ({ activeFiles: baseActiveFiles, route: baseRoute } = resolveRouteFromSelection(entries, selectedFiles));
  $: {
    const valid = new Set(baseActiveFiles.map((file) => file.id));
    modalSelectedIds = modalSelectedIds.filter((id) => valid.has(id));
  }

  $: modalSelectedFiles = baseActiveFiles.filter((file) => modalSelectedIds.includes(file.id));
  $: effectiveFiles = modalSelectedFiles.length > 0 ? modalSelectedFiles : baseActiveFiles;
  $: route = resolveRoute(effectiveFiles);
  $: effectivePdfFiles = effectiveFiles.filter((entry) => entry.kind === "pdf");
  $: effectiveImageFiles = effectiveFiles.filter((entry) => entry.kind === "image");
  $: effectiveContentFiles = effectiveFiles.filter((entry) => entry.kind === "document" || entry.kind === "data" || entry.kind === "code");

  $: if (baseRoute === ROUTES.MIXED && modalSelectedFiles.length === 0) {
    mixedModalOpen = true;
  }

  $: if (baseRoute !== ROUTES.MIXED) {
    mixedModalOpen = false;
    modalError = "";
    modalSelectedIds = [];
  }

  function toggleP2P() {
    p2pOpen = !p2pOpen;
  }

  function openP2PFromCard() {
    p2pOpen = true;
  }

  function onFilesAdded(files) {
    error = "";
    progress = 0;
    entries = enrichFiles(files);
    featureOverviewCollapsed = true;
    selectedFiles = [];
    modalSelectedIds = [];
    modalError = "";
  }

  function onP2PFilesReceived(event) {
    const newFiles = event.detail;
    if (!newFiles || newFiles.length === 0) return;
    const enriched = enrichFiles(newFiles);
    entries = [...enriched, ...entries];
    featureOverviewCollapsed = true;
  }

  function onWorkspaceFiles(event) {
    const newFiles = event.detail;
    if (!newFiles || newFiles.length === 0) return;
    const enriched = enrichFiles(newFiles);
    entries = [...enriched, ...entries];
    featureOverviewCollapsed = true;
  }

  function closeEditor() {
    activeEditor = null;
  }

  function openPickerFromFeature(group) {
    pickerAccept = group.pickerAccept || "";
    dropzoneRef?.openPicker();
  }

  function onFileSelectionChange(event) {
    const next = event.detail.selectedFiles || [];
    const prevIds = selectedFiles.map((file) => file.id).join("|");
    const nextIds = next.map((file) => file.id).join("|");
    if (prevIds === nextIds) return;
    selectedFiles = next;
  }

  function onFilesChange(event) {
    entries = event.detail.files;
    const valid = new Set(entries.map((entry) => entry.id));
    selectedFiles = selectedFiles.filter((entry) => valid.has(entry.id));
    if (forensicsEntry && !valid.has(forensicsEntry.id)) forensicsEntry = null;
  }

  function toggleModalFile(id) {
    modalError = "";
    if (modalSelectedIds.includes(id)) {
      modalSelectedIds = modalSelectedIds.filter((existing) => existing !== id);
      return;
    }
    modalSelectedIds = [...modalSelectedIds, id];
  }

  function applyModalSelection() {
    if (modalSelectedIds.length === 0) {
      modalError = "Select one or more files.";
      return;
    }

    const chosen = baseActiveFiles.filter((file) => modalSelectedIds.includes(file.id));
    const chosenRoute = resolveRoute(chosen);
    if (chosenRoute === ROUTES.MIXED) {
      modalError = "Choose files of the same type to continue.";
      return;
    }

    mixedModalOpen = false;
    modalError = "";
  }

  function clearAll() {
    entries = [];
    selectedFiles = [];
    modalSelectedIds = [];
    mixedModalOpen = false;
    processing = false;
    progress = 0;
    error = "";
    clearResults();
  }

  async function resetApp() {
    // Unregister all service workers
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister()));
    }

    // Delete all Cache API caches
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }

    // Clear Web Storage
    try { localStorage.clear(); } catch { /* ignore */ }
    try { sessionStorage.clear(); } catch { /* ignore */ }

    // Delete all IndexedDB databases
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      await Promise.all(dbs.map((db) => new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(db.name);
        req.onsuccess = resolve;
        req.onerror = resolve;
        req.onblocked = resolve;
      })));
    }

    // Clear in-memory state last
    clearAll();

    // Reload to a clean slate
    window.location.reload();
  }

  function onProgress(event) {
    progress = event.detail;
  }

  function onError(event) {
    error = event.detail;
    showToast({ message: event.detail || "Operation failed", type: "error", duration: 7000 });
  }

  function onOutput(event) {
    const items = Array.isArray(event.detail) ? event.detail : [];
    addResults(event.detail);
    resultsBatch++;
    const n = items.length;
    if (n > 0) {
      showToast({
        message: `${n} file${n === 1 ? "" : "s"} ready`,
        type: "success",
        action: scrollToResults,
        actionLabel: "View results ↓"
      });
    }
    clearTimeout(_progressResetTimer);
    _progressResetTimer = setTimeout(() => { progress = 0; }, 1400);
  }
</script>

<main>
  <header class="hero" in:fly={{ y: -12, duration: 260 }}>
    <div class="hero-text">
      <h1>Upkaran Offline Suite</h1>
      <p>PDF, image, and file operations with zero backend and full offline capability.</p>
    </div>
    <button class="p2p-btn" type="button" on:click={toggleP2P} aria-expanded={p2pOpen}>
      <span class="material-symbols-outlined">wifi_tethering</span>
      P2P Transfer
    </button>
  </header>

  <Toolbar route={route} processing={processing} on:clear={clearAll} on:reset={resetApp} />

  <Dropzone bind:this={dropzoneRef} accept={pickerAccept} on:filesadded={(event) => onFilesAdded(event.detail)} />

  <section class="panel feature-overview" transition:fade>
    <header class="feature-overview-header">
      <div>
        <h2>Everything You Can Do Here</h2>
        <p>Drop files above to start instantly. This overview helps you discover available tools at a glance.</p>
      </div>
      <button
        class="secondary"
        type="button"
        on:click={() => (featureOverviewCollapsed = !featureOverviewCollapsed)}
        aria-expanded={!featureOverviewCollapsed}
      >
        {featureOverviewCollapsed ? "Show" : "Hide"}
      </button>
    </header>

    {#if !featureOverviewCollapsed}
      <div class="feature-grid">
        {#each featureGroups as group}
          <article class="feature-card">
            <h3>{group.title}</h3>
            <ul>
              {#each group.items as item}
                <li>{item}</li>
              {/each}
            </ul>
            {#if group.p2pCta}
              <button class="secondary card-cta" type="button" on:click={openP2PFromCard}>{group.cta}</button>
            {:else}
              <button class="secondary card-cta" type="button" on:click={() => openPickerFromFeature(group)}>{group.cta}</button>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  </section>

  {#if p2pOpen}
    <div transition:fade>
      {#await import("./components/P2PTransfer.svelte") then mod}
        <svelte:component this={mod.default} {entries} on:filesreceived={onP2PFilesReceived} />
      {/await}
    </div>
  {/if}

  <!-- ── Create: Editor workspaces ─────────────────────────────────────── -->
  <section class="panel create-section">
    <h2 class="create-title">Create Documents</h2>
    <div class="create-buttons">
      <button
        class="create-btn {activeEditor === 'latex' ? '' : 'secondary'}"
        type="button"
        on:click={() => (activeEditor = activeEditor === 'latex' ? null : 'latex')}
        aria-pressed={activeEditor === 'latex'}
      >
        <span class="material-symbols-outlined">functions</span>
        LaTeX → PDF
      </button>
      <button
        class="create-btn {activeEditor === 'mermaid' ? '' : 'secondary'}"
        type="button"
        on:click={() => (activeEditor = activeEditor === 'mermaid' ? null : 'mermaid')}
        aria-pressed={activeEditor === 'mermaid'}
      >
        <span class="material-symbols-outlined">account_tree</span>
        Mermaid → PDF
      </button>
      <button
        class="create-btn {activeEditor === 'plantuml' ? '' : 'secondary'}"
        type="button"
        on:click={() => (activeEditor = activeEditor === 'plantuml' ? null : 'plantuml')}
        aria-pressed={activeEditor === 'plantuml'}
      >
        <span class="material-symbols-outlined">schema</span>
        PlantUML → PDF
      </button>
    </div>
  </section>

  {#if activeEditor === 'latex'}
    <div transition:fade>
      {#await import("./components/LaTeXWorkspace.svelte") then mod}
        <svelte:component
          this={mod.default}
          on:filesreceived={onWorkspaceFiles}
          on:close={closeEditor}
        />
      {/await}
    </div>
  {/if}

  {#if activeEditor === 'mermaid'}
    <div transition:fade>
      {#await import("./components/MermaidWorkspace.svelte") then mod}
        <svelte:component
          this={mod.default}
          on:filesreceived={onWorkspaceFiles}
          on:close={closeEditor}
        />
      {/await}
    </div>
  {/if}

  {#if activeEditor === 'plantuml'}
    <div transition:fade>
      {#await import("./components/PlantUMLWorkspace.svelte") then mod}
        <svelte:component
          this={mod.default}
          on:filesreceived={onWorkspaceFiles}
          on:close={closeEditor}
        />
      {/await}
    </div>
  {/if}

  <div class="content-grid">
    <FileList files={entries} busy={processing} on:selectionchange={onFileSelectionChange} on:fileschange={onFilesChange} on:forensics={(e) => { forensicsEntry = e.detail; }} />

    {#if forensicsEntry}
      {#await import("./components/ForensicsView.svelte") then mod}
        {#key forensicsEntry.id}
          <svelte:component
            this={mod.default}
            entry={forensicsEntry}
            on:close={() => (forensicsEntry = null)}
          />
        {/key}
      {/await}
    {:else}

    {#if route === ROUTES.PDF}
      {#await import("./components/PdfTools.svelte") then mod}
        <svelte:component
          this={mod.default}
          files={effectivePdfFiles}
          busy={processing}
          on:processing={(event) => (processing = event.detail)}
          on:progress={onProgress}
          on:error={onError}
          on:output={onOutput}
        />
      {/await}
    {/if}

    {#if route === ROUTES.IMAGE}
      {#await import("./components/ImageTools.svelte") then mod}
        <svelte:component
          this={mod.default}
          files={effectiveImageFiles}
          busy={processing}
          on:processing={(event) => (processing = event.detail)}
          on:progress={onProgress}
          on:error={onError}
          on:output={onOutput}
        />
      {/await}
    {/if}

    {#if route === ROUTES.FILE}
      {#await import("./components/FileTools.svelte") then mod}
        <svelte:component
          this={mod.default}
          files={effectiveFiles}
          busy={processing}
          on:processing={(event) => (processing = event.detail)}
          on:progress={onProgress}
          on:error={onError}
          on:output={onOutput}
        />
      {/await}
    {/if}

    {#if route === ROUTES.CONTENT}
      {#await import("./components/ContentTools.svelte") then mod}
        <svelte:component
          this={mod.default}
          files={effectiveContentFiles}
          busy={processing}
          on:processing={(event) => (processing = event.detail)}
          on:progress={onProgress}
          on:error={onError}
          on:output={onOutput}
        />
      {/await}
    {/if}
    {/if}
  </div>

  {#if mixedModalOpen}
    <div class="modal-backdrop" transition:fade>
      <div class="panel modal" role="dialog" aria-modal="true" aria-label="Choose files for operation">
        <h3>Mixed file selection</h3>
        <p>Select the files to operate on. Choose one file type per operation.</p>

        <ul>
          {#each baseActiveFiles as item (item.id)}
            <li>
              <label>
                <input
                  type="checkbox"
                  checked={modalSelectedIds.includes(item.id)}
                  on:change={() => toggleModalFile(item.id)}
                />
                <span>{item.name}</span>
                <small>{item.kind.toUpperCase()}</small>
              </label>
            </li>
          {/each}
        </ul>

        {#if modalError}
          <small class="modal-error">{modalError}</small>
        {/if}

        <div class="modal-actions">
          <button class="secondary" type="button" on:click={() => (modalSelectedIds = [])}>Reset</button>
          <button type="button" on:click={applyModalSelection}>Apply</button>
        </div>
      </div>
    </div>
  {/if}

  {#await import("./components/ResultsDrawer.svelte") then mod}
    <svelte:component this={mod.default} newBatch={resultsBatch} />
  {/await}

  <!-- ── Toast stack ──────────────────────────────────────────────────────── -->
  <div class="toast-stack" aria-live="polite" aria-atomic="false">
    {#each toasts as toast (toast.id)}
      <div
        class="toast toast--{toast.type}"
        role="status"
        transition:fly={{ y: 28, duration: 240, easing: (t) => 1 - Math.pow(1 - t, 3) }}
      >
        <span class="material-symbols-outlined toast-icon">
          {toast.type === "success" ? "check_circle" : "error"}
        </span>
        <span class="toast-msg">{toast.message}</span>
        {#if toast.action}
          <button
            class="toast-action"
            on:click={() => { toast.action(); dismissToast(toast.id); }}
          >{toast.actionLabel}</button>
        {/if}
        <button class="toast-close" on:click={() => dismissToast(toast.id)} aria-label="Dismiss notification">
          <span class="material-symbols-outlined" style="font-size:1.1rem">close</span>
        </button>
      </div>
    {/each}
  </div>
</main>

<!-- ── Fixed top progress bar ─────────────────────────────────────────── -->
{#if processing || progress > 0}
  <div class="prog-rail" aria-hidden="true" transition:fade>
    <div
      class="prog-fill"
      class:is-processing={processing}
      class:is-done={!processing && progress >= 100}
      style="width: {progress}%"
    ></div>
  </div>
{/if}

<style>
  main {
    max-width: 980px;
    margin: 0 auto;
    padding: 1.2rem;
    display: grid;
    gap: 1rem;
  }

  .hero {
    padding: 0.4rem 0.1rem 0.6rem;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.8rem;
    flex-wrap: wrap;
  }

  .hero-text {
    min-width: 0;
  }

  h1 {
    margin: 0;
    font-size: clamp(1.5rem, 2.6vw, 2.2rem);
    letter-spacing: 0.02em;
  }

  .hero p {
    margin: 0.45rem 0 0;
    color: var(--md-sys-color-on-surface-variant);
  }

  .p2p-btn {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 1rem;
    flex-shrink: 0;
    font-size: 0.88rem;
  }

  .content-grid {
    display: grid;
    gap: 1rem;
  }

  .feature-overview {
    padding: 1rem;
  }

  .feature-overview > header {
    margin-bottom: 0.75rem;
  }

  .feature-overview-header {
    display: flex;
    justify-content: space-between;
    gap: 0.8rem;
    align-items: flex-start;
  }

  .feature-overview-header > div {
    min-width: 0;
  }

  .feature-overview h2 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 600;
  }

  .feature-overview p {
    margin: 0.35rem 0 0;
    color: var(--md-sys-color-on-surface-variant);
  }

  .feature-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0.65rem;
  }

  .feature-card {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 10px;
    background: var(--md-sys-color-surface-container-low);
    padding: 0.7rem;
    min-width: 0;
  }

  .feature-card h3 {
    margin: 0 0 0.4rem;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .feature-card ul {
    margin: 0;
    padding-left: 1rem;
    display: grid;
    gap: 0.22rem;
  }

  .feature-card li {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.82rem;
    line-height: 1.25;
  }

  .card-cta {
    margin-top: 0.6rem;
    width: 100%;
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(28, 27, 31, 0.2);
    display: grid;
    place-items: center;
    padding: 1rem;
    z-index: 20;
  }

  .modal {
    width: min(560px, 100%);
    padding: 1rem;
  }

  .modal h3 {
    margin: 0 0 0.35rem;
  }

  .modal p {
    margin: 0 0 0.75rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .modal ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.4rem;
    max-height: 300px;
    overflow: auto;
  }

  .modal li {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 10px;
    padding: 0.45rem 0.6rem;
    background: var(--md-sys-color-surface-container-low);
  }

  .modal label {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.45rem;
    margin: 0;
    min-width: 0;
  }

  .modal label span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .modal small {
    color: var(--md-sys-color-on-surface-variant);
    white-space: nowrap;
    justify-self: end;
  }

  .modal-error {
    color: var(--md-sys-color-error);
    margin-top: 0.55rem;
    display: block;
  }

  .modal-actions {
    margin-top: 0.8rem;
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  /* Create section */
  .create-section {
    padding: 0.9rem 1rem;
    display: flex;
    align-items: center;
    gap: 0.9rem;
    flex-wrap: wrap;
  }

  .create-title {
    margin: 0;
    font-size: 0.88rem;
    font-weight: 600;
    white-space: nowrap;
    color: var(--md-sys-color-on-surface-variant);
  }

  .create-buttons {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .create-btn {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.85rem;
    padding: 0.5rem 0.9rem;
  }

  .create-btn .material-symbols-outlined {
    font-size: 1.05rem;
  }

  @media (max-width: 740px) {
    .feature-overview {
      padding: 0.85rem;
    }

    .feature-overview-header {
      flex-direction: column;
      align-items: stretch;
    }

    .feature-grid {
      grid-template-columns: 1fr;
    }

    .modal {
      width: 100%;
      max-height: 85vh;
      overflow: auto;
    }

    .modal label {
      grid-template-columns: auto minmax(0, 1fr);
      grid-template-areas:
        "check name"
        ". type";
      align-items: start;
      row-gap: 0.2rem;
    }

    .modal label input {
      grid-area: check;
      margin-top: 0.15rem;
    }

    .modal label span {
      grid-area: name;
    }

    .modal label small {
      grid-area: type;
    }

    .modal-actions {
      justify-content: stretch;
    }

    .modal-actions button {
      flex: 1;
    }
  }

  /* ── Fixed top progress bar ──────────────────────────────────────────── */
  :global(.prog-rail) {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    z-index: 9000;
    background: rgba(53, 92, 168, 0.12);
  }

  :global(.prog-fill) {
    height: 100%;
    background: var(--md-sys-color-primary);
    transition: width 0.35s ease, background 0.4s ease;
    border-radius: 0 2px 2px 0;
  }

  :global(.prog-fill.is-processing) {
    background: linear-gradient(
      90deg,
      var(--md-sys-color-primary) 0%,
      #7b9eff 45%,
      var(--md-sys-color-primary) 100%
    );
    background-size: 250% 100%;
    animation: prog-stripe 1.2s linear infinite;
  }

  :global(.prog-fill.is-done) {
    background: #1e8a4a;
    transition: width 0.2s ease, background 0.3s ease;
  }

  @keyframes prog-stripe {
    0%   { background-position: 100% 0; }
    100% { background-position: -100% 0; }
  }

  /* ── Toast stack ─────────────────────────────────────────────────────── */
  .toast-stack {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    z-index: 9100;
    display: flex;
    flex-direction: column-reverse;
    gap: 0.6rem;
    pointer-events: none;
    max-width: min(380px, calc(100vw - 2rem));
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.7rem 0.85rem 0.7rem 0.9rem;
    border-radius: 12px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.16), 0 1px 4px rgba(0,0,0,0.08);
    font-size: 0.88rem;
    font-weight: 500;
    pointer-events: all;
    min-width: 240px;
  }

  .toast--success {
    background: #1a1b20;
    color: #ffffff;
  }

  .toast--error {
    background: var(--md-sys-color-error);
    color: #ffffff;
  }

  .toast-icon {
    font-size: 1.2rem;
    flex-shrink: 0;
    line-height: 1;
  }

  .toast--success .toast-icon { color: #6be59e; }
  .toast--error .toast-icon { color: #ffd8d6; }

  .toast-msg {
    flex: 1;
    min-width: 0;
  }

  .toast-action {
    background: transparent;
    border: 1px solid rgba(255,255,255,0.35);
    color: inherit;
    font-size: 0.8rem;
    font-weight: 600;
    padding: 0.3rem 0.65rem;
    border-radius: 999px;
    cursor: pointer;
    flex-shrink: 0;
    white-space: nowrap;
    transition: background 0.15s;
  }

  .toast-action:hover {
    background: rgba(255,255,255,0.15);
    opacity: 1;
  }

  .toast-action:active:not(:disabled) {
    transform: scale(0.97);
  }

  .toast-close {
    background: transparent;
    color: inherit;
    padding: 0.2rem;
    border-radius: 999px;
    flex-shrink: 0;
    line-height: 0;
    opacity: 0.7;
    transition: opacity 0.15s;
  }

  .toast-close:hover {
    opacity: 1;
    background: rgba(255,255,255,0.12);
  }

  .toast-close:active:not(:disabled) {
    transform: scale(0.94);
  }

  @media (max-width: 600px) {
    .toast-stack {
      bottom: 1rem;
      right: 0.75rem;
      left: 0.75rem;
      max-width: none;
    }
  }
</style>
