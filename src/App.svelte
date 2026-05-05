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

  let processing = false;
  let progress = 0;
  let error = "";

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
        "PDF to images"
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
  }

  function onOutput(event) {
    addResults(event.detail);
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

  <div class="content-grid">
    <FileList files={entries} busy={processing} on:selectionchange={onFileSelectionChange} on:fileschange={onFilesChange} />

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

  {#if processing || progress > 0}
    <section class="panel progress" transition:fade>
      <label for="global-progress">Progress</label>
      <progress id="global-progress" value={progress} max="100"></progress>
      <span>{progress}%</span>
    </section>
  {/if}

  {#if error}
    <section class="panel error" transition:fade>
      <strong>Operation error</strong>
      <p>{error}</p>
    </section>
  {/if}

  {#await import("./components/ResultsDrawer.svelte") then mod}
    <svelte:component this={mod.default} />
  {/await}
</main>

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

  .progress,
  .error {
    padding: 0.9rem 1rem;
  }

  .progress label {
    display: block;
    margin-bottom: 0.45rem;
  }

  progress {
    width: 100%;
    height: 0.8rem;
  }

  .progress span {
    display: inline-block;
    margin-top: 0.45rem;
  }

  .error p {
    margin: 0.4rem 0 0;
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
</style>
