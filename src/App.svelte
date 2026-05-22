<script>
  import { onMount, tick } from "svelte";
  import { fade, fly } from "svelte/transition";
  import Dropzone from "./components/Dropzone.svelte";
  import FileList from "./components/FileList.svelte";
  import Toolbar from "./components/Toolbar.svelte";
  import InstallCta from "./components/InstallCta.svelte";
  import RecentActivity from "./components/RecentActivity.svelte";
  import PerfSummaryPanel from "./components/PerfSummaryPanel.svelte";
  import BatchOperations from "./components/BatchOperations.svelte";
  import CompareWorkspace from "./components/CompareWorkspace.svelte";
  import { resolveRouteFromSelection, resolveRoute, ROUTES } from "./routes/router.js";
  import { enrichFiles } from "./js/detect.js";
  import { addResults, clearResults } from "./js/results-store.js";
  import { decideDropRouting } from "./js/drop-routing.js";
  import {
    addSessionHistory,
    clearSessionHistory,
    getLastUsedTool,
    getSessionHistory,
    setLastUsedTool,
    summarizeEntriesForHistory
  } from "./js/session-history.js";
  import { createPwaInstallController } from "./js/pwa-install.js";
  import { secureClearLocalAppData } from "./js/secure-local-data.js";
  import { addOperationLineage } from "./js/operation-lineage.js";

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

  function scrollToFiles() {
    document.getElementById("files-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function scrollToP2P() {
    p2pPanelRef?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function getFileFingerprint(file) {
    return `${file.name}::${file.size}::${file.type || ""}::${file.lastModified || 0}`;
  }

  function dedupeIncomingP2PFiles(files) {
    const existing = new Set(entries.map((entry) => getFileFingerprint(entry.file)));
    const seenIncoming = new Set();
    const unique = [];

    for (const file of files) {
      const fingerprint = getFileFingerprint(file);
      if (existing.has(fingerprint) || seenIncoming.has(fingerprint)) continue;
      seenIncoming.add(fingerprint);
      unique.push(file);
    }

    return unique;
  }

  function notifyFilesAdded(count) {
    if (!count || count <= 0) return;
    showToast({
      message: `${count} file${count === 1 ? "" : "s"} added`,
      type: "success",
      action: scrollToFiles,
      actionLabel: "See files"
    });
  }

  let dropzoneRef;
  let pickerAccept = "";
  let featureOverviewCollapsed = false;
  let p2pOpen = false;
  let p2pMode = "send";
  let p2pPanelRef;

  let recentActivity = [];
  let recentLastTool = "";
  let lastTrackedTool = "";

  let pwaInstallBusy = false;
  let canInstallPwa = false;
  let pwaInstalled = false;
  let pwaControllerRef = null;

  const THEME_OPTIONS = [
    { value: "ocean", label: "Ocean" },
    { value: "forest", label: "Forest" },
    { value: "sunset", label: "Sunset" },
    { value: "slate", label: "Slate" },
    { value: "lagoon", label: "Lagoon" },
    { value: "rosewood", label: "Rosewood" },
    { value: "amber", label: "Amber" }
  ];

  const PREVIEW_THEME_OPTIONS = THEME_OPTIONS.slice(0, 4);

  let currentTheme = "ocean";
  let colorMode = "light";
  const perfPanelEnabled = import.meta.env.DEV;

  function applyAppearance() {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.dataset.theme = currentTheme;
    root.dataset.mode = colorMode;
    root.style.colorScheme = colorMode;

    try {
      localStorage.setItem("upkaran-theme", currentTheme);
      localStorage.setItem("upkaran-color-mode", colorMode);
    } catch {
      // Ignore storage errors (private mode, locked storage, etc.)
    }
  }

  function toggleColorMode() {
    colorMode = colorMode === "dark" ? "light" : "dark";
  }

  function setTheme(theme) {
    currentTheme = theme;
  }

  onMount(() => {
    try {
      const storedTheme = localStorage.getItem("upkaran-theme");
      if (THEME_OPTIONS.some((opt) => opt.value === storedTheme)) {
        currentTheme = storedTheme;
      }

      const storedMode = localStorage.getItem("upkaran-color-mode");
      if (storedMode === "light" || storedMode === "dark") {
        colorMode = storedMode;
      } else {
        colorMode = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      }
    } catch {
      colorMode = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }

    recentActivity = getSessionHistory();
    recentLastTool = getLastUsedTool();

    pwaControllerRef = createPwaInstallController();
    const unsubscribeInstall = pwaControllerRef.subscribe((snapshot) => {
      canInstallPwa = snapshot.canInstall;
      pwaInstalled = snapshot.installed;
    });

    applyAppearance();

    return () => {
      unsubscribeInstall?.();
      pwaControllerRef?.dispose();
      pwaControllerRef = null;
    };
  });

  $: {
    currentTheme;
    colorMode;
    applyAppearance();
  }

  $: if (route !== ROUTES.EMPTY && route !== ROUTES.MIXED && route !== lastTrackedTool) {
    lastTrackedTool = route;
    setLastUsedTool(route);
    recentLastTool = route;
  }

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
        "Unlock / remove PDF restrictions",
        "Lock PDF with password"
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
  $: batchEligibleFiles = route === ROUTES.PDF ? effectivePdfFiles : route === ROUTES.IMAGE ? effectiveImageFiles : [];
  $: compareWorkspaceFiles = route === ROUTES.CONTENT && effectiveContentFiles.length === 2 ? effectiveContentFiles : [];

  $: if (baseRoute === ROUTES.MIXED && modalSelectedFiles.length === 0) {
    mixedModalOpen = true;
  }

  $: if (baseRoute !== ROUTES.MIXED) {
    mixedModalOpen = false;
    modalError = "";
    modalSelectedIds = [];
  }

  async function toggleP2P() {
    p2pOpen = !p2pOpen;
    if (p2pOpen) {
      await tick();
      p2pPanelRef?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  async function openP2PFromCard() {
    p2pOpen = true;
    await tick();
    p2pPanelRef?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function recordActivity(payload) {
    recentActivity = addSessionHistory(payload);
  }

  function onFilesAdded(files) {
    error = "";
    progress = 0;

    const enriched = enrichFiles(files);
    entries = enriched;
    featureOverviewCollapsed = true;

    const dropDecision = decideDropRouting(enriched);
    if (dropDecision.autoSelected && dropDecision.selectedEntries.length > 0 && dropDecision.skippedCount > 0) {
      selectedFiles = dropDecision.selectedEntries;
      modalSelectedIds = dropDecision.selectedEntries.map((entry) => entry.id);
      modalError = "";
      mixedModalOpen = false;
      showToast({
        message: `Auto-selected ${dropDecision.selectedEntries.length} ${dropDecision.route} file(s) from mixed drop`,
        type: "success"
      });
    } else {
      selectedFiles = [];
      modalSelectedIds = [];
      modalError = "";
    }

    const summary = summarizeEntriesForHistory(enriched);
    recordActivity({
      action: "Files added",
      toolKey: dropDecision.route,
      fileCount: summary.fileCount,
      fileNames: summary.fileNames,
      note: "Drop or picker import"
    });

    notifyFilesAdded(files.length);
  }

  function onP2PFilesReceived(event) {
    const newFiles = event.detail || [];
    if (newFiles.length === 0) return;

    const uniqueFiles = dedupeIncomingP2PFiles(newFiles);
    if (uniqueFiles.length === 0) {
      showToast({ message: "No new files were added (duplicates skipped)", type: "error" });
      return;
    }

    const enriched = enrichFiles(uniqueFiles);
    entries = [...enriched, ...entries];
    featureOverviewCollapsed = true;

    const summary = summarizeEntriesForHistory(enriched);
    recordActivity({
      action: "P2P receive",
      toolKey: route,
      fileCount: summary.fileCount,
      fileNames: summary.fileNames,
      note: "Received through peer transfer"
    });

    notifyFilesAdded(uniqueFiles.length);
  }

  function onP2PModeChange(event) {
    p2pMode = event.detail === "receive" ? "receive" : "send";
  }

  function onWorkspaceFiles(event) {
    const newFiles = event.detail;
    if (!newFiles || newFiles.length === 0) return;
    const enriched = enrichFiles(newFiles);
    entries = [...enriched, ...entries];
    featureOverviewCollapsed = true;

    const summary = summarizeEntriesForHistory(enriched);
    recordActivity({
      action: "Workspace output",
      toolKey: route,
      fileCount: summary.fileCount,
      fileNames: summary.fileNames,
      note: "Created by editor workspace"
    });

    notifyFilesAdded(newFiles.length);
  }

  function closeEditor() {
    activeEditor = null;
  }

  function openPickerFromFeature(group) {
    pickerAccept = group.pickerAccept || "";
    dropzoneRef?.openPicker();
  }

  async function onInstallApp() {
    if (!pwaControllerRef) return;
    pwaInstallBusy = true;
    try {
      const choice = await pwaControllerRef.promptInstall();
      if (choice?.outcome === "accepted") {
        showToast({ message: "Install prompt accepted", type: "success" });
      } else if (choice?.outcome === "dismissed") {
        showToast({ message: "Install prompt dismissed", type: "error" });
      }
    } finally {
      pwaInstallBusy = false;
    }
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

  function clearRecentActivity() {
    clearSessionHistory();
    recentActivity = [];
    recentLastTool = "";
  }

  async function secureClearData() {
    await secureClearLocalAppData();
    clearSessionHistory();
    clearAll();
    recentActivity = [];
    recentLastTool = "";
    showToast({ message: "Secure local cleanup complete. Reloading...", type: "success" });
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

    if (effectiveFiles.length > 0 && n >= 0) {
      addOperationLineage({
        toolKey: route,
        action: "tool_output",
        inputEntries: effectiveFiles,
        outputs: items,
      });
    }

    if (effectiveFiles.length > 0 || n > 0) {
      recordActivity({
        action: "Processing completed",
        toolKey: route,
        fileCount: effectiveFiles.length,
        outputCount: n,
        fileNames: effectiveFiles.slice(0, 5).map((entry) => entry.name),
        note: "Tool output generated"
      });
    }

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

<main
  class={`app-shell theme-${currentTheme} mode-${colorMode}`}
  class:is-processing={processing}
  class:has-error={!!error}
  class:is-done={!processing && progress >= 100}
>
  <header class="hero" in:fly={{ y: -12, duration: 260 }}>
    <div class="hero-text">
      <h1>Upkaran Offline Suite</h1>
      <p>PDF, image, and file operations with zero backend and full offline capability.</p>
    </div>
    <button class="p2p-btn" class:is-active={p2pOpen} type="button" on:click={toggleP2P} aria-expanded={p2pOpen} aria-pressed={p2pOpen}>
      <span class="material-symbols-outlined">wifi_tethering</span>
      {p2pOpen ? "P2P Transfer Active" : "P2P Transfer"}
    </button>
  </header>

  {#if p2pOpen}
    <section class="panel p2p-active-banner" aria-live="polite">
      <span class="material-symbols-outlined" aria-hidden="true">wifi_tethering</span>
      <p>P2P transfer is currently open below. Use <strong>Send</strong> or <strong>Receive</strong> to continue.</p>
    </section>

    <button class="p2p-live-chip" type="button" on:click={scrollToP2P} aria-label={`P2P ${p2pMode} mode is active. Jump to P2P transfer panel.`}>
      <span class="material-symbols-outlined" aria-hidden="true">wifi_tethering</span>
      <span>P2P Active · {p2pMode === "send" ? "Send" : "Receive"}</span>
    </button>
  {/if}

  <section class="panel appearance-strip" aria-label="Appearance">
    <div class="appearance-title-wrap">
      <h2 class="appearance-title">Appearance</h2>
      <span class="appearance-current">{THEME_OPTIONS.find((t) => t.value === currentTheme)?.label} · {colorMode}</span>
    </div>

    <div class="appearance-controls" role="group" aria-label="Appearance controls">
      <label for="theme-select">Theme</label>
      <select id="theme-select" bind:value={currentTheme} aria-label="Select theme">
        {#each THEME_OPTIONS as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>

      <div class="theme-swatches" role="radiogroup" aria-label="Quick theme selection">
        {#each PREVIEW_THEME_OPTIONS as option}
          <button
            class="secondary theme-swatch"
            class:is-active={currentTheme === option.value}
            type="button"
            role="radio"
            aria-checked={currentTheme === option.value}
            aria-label={`Use ${option.label} theme`}
            title={option.label}
            on:click={() => setTheme(option.value)}
          >
            <span class="swatch-dot swatch-{option.value}" aria-hidden="true"></span>
          </button>
        {/each}
      </div>

      <button
        class="secondary mode-toggle"
        type="button"
        on:click={toggleColorMode}
        aria-pressed={colorMode === "dark"}
        aria-label={colorMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      >
        <span class="material-symbols-outlined" aria-hidden="true">
          {colorMode === "dark" ? "light_mode" : "dark_mode"}
        </span>
        {colorMode === "dark" ? "Light mode" : "Dark mode"}
      </button>
    </div>
  </section>

  <Toolbar route={route} processing={processing} on:clear={clearAll} on:secureclear={secureClearData} />

  <InstallCta canInstall={canInstallPwa} installed={pwaInstalled} busy={pwaInstallBusy} on:install={onInstallApp} />

  <Dropzone bind:this={dropzoneRef} accept={pickerAccept} on:filesadded={(event) => onFilesAdded(event.detail)} />

  <RecentActivity items={recentActivity} lastTool={recentLastTool} on:clear={clearRecentActivity} />

  <PerfSummaryPanel enabled={perfPanelEnabled} />

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
    <div bind:this={p2pPanelRef} class="p2p-panel-wrap" transition:fade>
      {#await import("./components/P2PTransfer.svelte") then mod}
        <svelte:component this={mod.default} {entries} on:filesreceived={onP2PFilesReceived} on:modechange={onP2PModeChange} />
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

  <div id="files-section" class="content-grid">
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

    {#if compareWorkspaceFiles.length === 2}
      <CompareWorkspace files={compareWorkspaceFiles} />
    {/if}

    {#if batchEligibleFiles.length > 1}
      <BatchOperations
        files={batchEligibleFiles}
        busy={processing}
        on:processing={(event) => (processing = event.detail)}
        on:progress={onProgress}
        on:error={onError}
        on:output={onOutput}
      />
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

  <section
    id="fallback-resources"
    class="panel fallback-resources"
    aria-labelledby="fallback-help-title"
  >
    <h2 id="fallback-help-title">Need a feature not available here?</h2>
    <p>
      If you cannot complete a task in this app, continue with trusted alternatives.
    </p>
    <div class="fallback-actions">
      <a class="fallback-link" href="https://ilovepdf.com" target="_blank" rel="noopener noreferrer">
        Open iLovePDF
      </a>
      <a class="fallback-link secondary-link" href="https://ihatepdf.cv" target="_blank" rel="noopener noreferrer">
        Open iHatePDF
      </a>
    </div>
  </section>

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

  .app-shell {
    --theme-accent: var(--md-sys-color-primary);
    position: relative;
  }

  .app-shell.theme-ocean {
    --theme-accent: #355ca8;
  }

  .app-shell.theme-forest {
    --theme-accent: #2f7a51;
  }

  .app-shell.theme-sunset {
    --theme-accent: #b5472c;
  }

  .app-shell.theme-slate {
    --theme-accent: #4f617e;
  }

  .app-shell::before {
    content: "";
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
    z-index: 8900;
    background: color-mix(in srgb, var(--theme-accent) 38%, transparent);
    transition: background 0.25s ease;
  }

  .app-shell.is-processing::before {
    background: linear-gradient(90deg, var(--theme-accent), #7fb2ff, var(--theme-accent));
    background-size: 220% 100%;
    animation: app-state-flow 1.1s linear infinite;
  }

  .app-shell.has-error::before {
    background: linear-gradient(90deg, #c12e2e, #ff7c7c, #c12e2e);
  }

  .app-shell.is-done::before {
    background: linear-gradient(90deg, #1e8a4a, #65d493, #1e8a4a);
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

  .appearance-strip {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.75rem 1rem;
    align-items: center;
    padding: 0.7rem 0.9rem;
    border-left: 4px solid var(--theme-accent);
    background: color-mix(in srgb, var(--md-sys-color-surface) 84%, var(--theme-accent) 16%);
  }

  .appearance-title-wrap {
    min-width: 0;
  }

  .appearance-title {
    margin: 0;
    font-size: 0.88rem;
    color: var(--md-sys-color-on-surface-variant);
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  .appearance-current {
    font-size: 0.82rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .appearance-controls {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    justify-content: flex-end;
    flex-wrap: wrap;
  }

  .appearance-controls label {
    font-size: 0.75rem;
    color: var(--md-sys-color-on-surface-variant);
    font-weight: 600;
    margin-left: 0.35rem;
  }

  .appearance-controls select {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 999px;
    background: var(--md-sys-color-surface);
    padding: 0.32rem 0.7rem;
    font-size: 0.8rem;
    min-width: 116px;
  }

  .theme-swatches {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }

  .theme-swatch {
    width: 1.7rem;
    height: 1.7rem;
    border-radius: 999px;
    padding: 0;
    border: 1px solid var(--md-sys-color-outline-variant);
    display: inline-grid;
    place-items: center;
    background: var(--md-sys-color-surface);
  }

  .theme-swatch.is-active {
    border-color: var(--md-sys-color-primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--md-sys-color-primary) 26%, transparent);
  }

  .swatch-dot {
    width: 0.95rem;
    height: 0.95rem;
    border-radius: 999px;
    border: 1px solid rgba(0, 0, 0, 0.18);
  }

  .swatch-dot.swatch-ocean {
    background: #355ca8;
  }

  .swatch-dot.swatch-forest {
    background: #2f7a51;
  }

  .swatch-dot.swatch-sunset {
    background: #b5472c;
  }

  .swatch-dot.swatch-slate {
    background: #4f617e;
  }

  .mode-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.42rem 0.78rem;
    font-size: 0.8rem;
  }

  .mode-toggle .material-symbols-outlined {
    font-size: 1rem;
  }

  .p2p-btn {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 1rem;
    flex-shrink: 0;
    font-size: 0.88rem;
    transition: transform 0.15s ease, box-shadow 0.2s ease, background 0.2s ease;
  }

  .p2p-btn.is-active {
    background: color-mix(in srgb, var(--md-sys-color-tertiary-container) 82%, var(--theme-accent) 18%);
    color: var(--md-sys-color-on-tertiary-container);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--md-sys-color-tertiary) 25%, transparent);
  }

  .p2p-btn.is-active .material-symbols-outlined {
    animation: p2p-pulse 1.2s ease-in-out infinite;
  }

  .p2p-active-banner {
    margin-top: -0.1rem;
    padding: 0.62rem 0.85rem;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    border-left: 4px solid var(--md-sys-color-tertiary);
    background: color-mix(in srgb, var(--md-sys-color-tertiary-container) 65%, var(--md-sys-color-surface) 35%);
  }

  .p2p-active-banner p {
    margin: 0;
    font-size: 0.82rem;
    color: var(--md-sys-color-on-tertiary-container);
  }

  .p2p-panel-wrap {
    scroll-margin-top: 0.85rem;
  }

  .p2p-live-chip {
    position: fixed;
    top: 0.65rem;
    right: 1rem;
    z-index: 9055;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.45rem 0.72rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--md-sys-color-tertiary) 30%, transparent);
    background: color-mix(in srgb, var(--md-sys-color-tertiary-container) 84%, var(--theme-accent) 16%);
    color: var(--md-sys-color-on-tertiary-container);
    box-shadow: 0 6px 20px color-mix(in srgb, var(--md-sys-color-shadow, #000) 22%, transparent);
    font-size: 0.78rem;
    font-weight: 700;
  }

  .p2p-live-chip .material-symbols-outlined {
    font-size: 0.95rem;
    animation: p2p-pulse 1.2s ease-in-out infinite;
  }

  .fallback-resources {
    padding: 0.9rem 1rem;
    display: grid;
    gap: 0.6rem;
    scroll-margin-top: 1rem;
  }

  .fallback-resources h2 {
    margin: 0;
    font-size: 1rem;
  }

  .fallback-resources p {
    margin: 0;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.9rem;
  }

  .fallback-actions {
    display: flex;
    gap: 0.55rem;
    flex-wrap: wrap;
  }

  .fallback-link {
    text-decoration: none;
    border-radius: 999px;
    background: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
    padding: 0.58rem 0.95rem;
    font-size: 0.85rem;
    font-weight: 600;
    transition: opacity 0.15s ease, transform 0.1s ease;
  }

  .fallback-link:hover {
    opacity: 0.92;
  }

  .fallback-link:active {
    transform: scale(0.97);
  }

  .fallback-link:focus-visible {
    outline: 2px solid var(--md-sys-color-primary);
    outline-offset: 3px;
  }

  .fallback-link.secondary-link {
    background: var(--md-sys-color-surface-variant);
    color: var(--md-sys-color-on-surface);
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
    .hero-actions {
      width: 100%;
      justify-items: stretch;
    }

    .appearance-strip {
      grid-template-columns: 1fr;
      gap: 0.55rem;
      border-left-width: 0;
      border-top: 3px solid var(--theme-accent);
    }

    .appearance-title-wrap {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.5rem;
    }

    .appearance-controls {
      border-radius: var(--radius-md);
      justify-content: stretch;
    }

    .appearance-controls label {
      margin-left: 0;
    }

    .appearance-controls select,
    .theme-swatches,
    .mode-toggle,
    .p2p-btn {
      width: 100%;
      justify-content: center;
    }

    .p2p-active-banner {
      align-items: flex-start;
    }

    .p2p-live-chip {
      top: auto;
      bottom: 1rem;
      right: 1rem;
    }

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

  @keyframes app-state-flow {
    0% { background-position: 100% 0; }
    100% { background-position: -100% 0; }
  }

  @keyframes p2p-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.7; transform: scale(1.09); }
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
