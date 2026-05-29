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
  import PdfTools from "./components/PdfTools.svelte";
  import DjvuTools from "./components/DjvuTools.svelte";
  import ImageTools from "./components/ImageTools.svelte";
  import FileTools from "./components/FileTools.svelte";
  import ContentTools from "./components/ContentTools.svelte";
  import ForensicsDrawer from "./components/ForensicsDrawer.svelte";
  import ResultsDrawer from "./components/ResultsDrawer.svelte";
  import TextDiffWorkspace from "./components/TextDiffWorkspace.svelte";
  import { resolveRouteFromSelection, resolveRoute, resolveTypeTabs, routeToTypeTab, routeWorkspaceTitle, ROUTES } from "./routes/router.js";
  import { enrichFiles, kindLabel, mapKindToTypeTab, typeTabLabel } from "./js/detect.js";
  import { saveMany } from "./js/download.js";
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
  let availableTypeTabs = [];
  let activeTypeTab = "";
  let typeScopedEntries = [];
  let scopedSelectedFiles = [];
  let workspaceTitle = "Upkaran Workspace";
  let shortcutHelpOpen = false;

  /** Which editor workspace is currently open (null | 'latex' | 'mermaid' | 'plantuml') */
  let activeEditor = null;
  let forensicsEntry = null;
  let forensicsModalOpen = false;
  let intakeCollapsed = false;
  let intakeModalOpen = false;

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
  let featureOverviewCollapsed = true;
  let topViewTab = "appearance";
  let workspaceControlsOpen = false;
  let p2pOpen = false;
  let p2pMode = "send";
  let p2pPanelRef;
  let workspaceSheetRef;

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

  const TASK_SECTIONS = [
    { id: "convert", label: "Convert", icon: "sync_alt" },
    { id: "organize", label: "Organize", icon: "view_kanban" },
    { id: "compare", label: "Compare", icon: "difference" },
    { id: "share", label: "Share", icon: "wifi_tethering" },
    { id: "results", label: "Results", icon: "download_done" },
    { id: "textdiff", label: "Text Diff", icon: "text_compare" }
  ];

  const UTILITY_SECTIONS = [
    { id: "history", label: "History", icon: "history" },
    { id: "performance", label: "Performance", icon: "query_stats" },
    { id: "textdiff", label: "Text Diff", icon: "text_compare" }
  ];

  let currentTheme = "ocean";
  let colorMode = "light";
  const perfPanelEnabled = true;

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

  function getActiveTask() {
    if (topViewTab === "textdiff") return "textdiff";
    if (p2pOpen) return "share";
    if (resultsBatch > 0) return "results";
    if (compareWorkspaceFiles.length === 2) return "compare";
    if (route === ROUTES.PDF || route === ROUTES.IMAGE || route === ROUTES.CONTENT) return "convert";
    if (route === ROUTES.FILE || route === ROUTES.DJVU) return "organize";
    return "convert";
  }

  function activateTask(taskId) {
    if (taskId === "share") {
      if (!p2pOpen) {
        p2pOpen = true;
      }
      tick().then(scrollToP2P);
      return;
    }

    if (taskId === "results") {
      scrollToResults();
      return;
    }

    if (taskId === "textdiff") {
      topViewTab = "textdiff";
      return;
    }

    if (taskId === "compare" || taskId === "organize" || taskId === "convert") {
      scrollToFiles();
    }
  }

  async function activateUtility(toolId) {
    workspaceControlsOpen = true;

    if (toolId === "history") {
      topViewTab = "activity";
    } else if (toolId === "performance") {
      if (!perfPanelEnabled) return;
      topViewTab = "performance";
    } else if (toolId === "textdiff") {
      topViewTab = "textdiff";
    }

    await tick();
    workspaceSheetRef?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function isUtilityActive(toolId) {
    if (toolId === "history") return workspaceControlsOpen && topViewTab === "activity";
    if (toolId === "performance") return workspaceControlsOpen && topViewTab === "performance";
    if (toolId === "textdiff") return workspaceControlsOpen && topViewTab === "textdiff";
    return false;
  }

  function jumpToIngestion() {
    dropzoneRef?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openIntakeModal() {
    intakeModalOpen = true;
    intakeCollapsed = true;
  }

  function closeIntakeModal() {
    intakeModalOpen = false;
  }

  function shouldSkipGlobalShortcut(target) {
    if (!target) return false;
    const tag = `${target.tagName || ""}`.toLowerCase();
    if (target.isContentEditable) return true;
    return tag === "input" || tag === "textarea" || tag === "select";
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
        colorMode = "light";
      }
    } catch {
      colorMode = "light";
    }

    recentActivity = getSessionHistory();
    recentLastTool = getLastUsedTool();

    pwaControllerRef = createPwaInstallController();
    const unsubscribeInstall = pwaControllerRef.subscribe((snapshot) => {
      canInstallPwa = snapshot.canInstall;
      pwaInstalled = snapshot.installed;
    });

    applyAppearance();

    const onGlobalKeydown = (event) => {
      if (event.key === "Escape" && intakeModalOpen) {
        event.preventDefault();
        closeIntakeModal();
        return;
      }

      if (event.key === "Escape" && shortcutHelpOpen) {
        event.preventDefault();
        shortcutHelpOpen = false;
        return;
      }

      if (shouldSkipGlobalShortcut(event.target)) return;
      if (!event.altKey || event.ctrlKey || event.metaKey) return;

      if (event.key === "/") {
        event.preventDefault();
        shortcutHelpOpen = !shortcutHelpOpen;
        return;
      }

      if (!/^\d$/.test(event.key)) return;
      const index = Number(event.key) - 1;
      if (index < 0 || index >= availableTypeTabs.length) return;

      event.preventDefault();
      onTypeTabSelect(availableTypeTabs[index].tab);
    };

    window.addEventListener("keydown", onGlobalKeydown);

    return () => {
      unsubscribeInstall?.();
      window.removeEventListener("keydown", onGlobalKeydown);
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
        "PDF to DjVu",
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
        "Images to DjVu",
        "Interactive crop with resize handles",
        "Batch crop using normalized selection",
        "Supports common formats including HEIC"
      ]
    },
    {
      title: "DjVu",
      pickerAccept: ".djvu,image/vnd.djvu,application/vnd.djvu,application/x-djvu",
      cta: "Try DjVu tools",
      items: [
        "DjVu to PDF",
        "DjVu to images",
        "Fully in-browser conversion"
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

  $: availableTypeTabs = resolveTypeTabs(entries);
  $: {
    if (availableTypeTabs.length === 1) {
      activeTypeTab = availableTypeTabs[0].tab;
    } else if (availableTypeTabs.length === 0) {
      activeTypeTab = "";
    } else if (!availableTypeTabs.some((item) => item.tab === activeTypeTab)) {
      activeTypeTab = "";
    }
  }

  $: typeScopedEntries = activeTypeTab
    ? entries.filter((entry) => mapKindToTypeTab(entry.kind) === activeTypeTab)
    : entries;

  $: scopedSelectedFiles = activeTypeTab
    ? selectedFiles.filter((entry) => mapKindToTypeTab(entry.kind) === activeTypeTab)
    : selectedFiles;

  $: ({ activeFiles: baseActiveFiles, route: baseRoute } = resolveRouteFromSelection(typeScopedEntries, scopedSelectedFiles));
  $: {
    const valid = new Set(baseActiveFiles.map((file) => file.id));
    modalSelectedIds = modalSelectedIds.filter((id) => valid.has(id));
  }

  $: modalSelectedFiles = baseActiveFiles.filter((file) => modalSelectedIds.includes(file.id));
  $: modalKindGroups = Object.entries(
    baseActiveFiles.reduce((acc, file) => {
      const key = file.kind || "file";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})
  )
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count);
  $: effectiveFiles = modalSelectedFiles.length > 0 ? modalSelectedFiles : baseActiveFiles;
  $: route = resolveRoute(effectiveFiles);
  $: effectiveDjvuFiles = effectiveFiles.filter((entry) => entry.kind === "djvu");
  $: effectivePdfFiles = effectiveFiles.filter((entry) => entry.kind === "pdf");
  $: effectiveImageFiles = effectiveFiles.filter((entry) => entry.kind === "image");
  $: effectiveContentFiles = effectiveFiles.filter((entry) => entry.kind === "document" || entry.kind === "data" || entry.kind === "code");
  $: batchEligibleFiles =
    route === ROUTES.PDF
      ? effectivePdfFiles
      : route === ROUTES.IMAGE
        ? effectiveImageFiles
        : route === ROUTES.DJVU
          ? effectiveDjvuFiles
          : [];
  $: compareWorkspaceFiles = route === ROUTES.CONTENT && effectiveContentFiles.length === 2 ? effectiveContentFiles : [];
  $: showCompareWorkspace = compareWorkspaceFiles.length === 2;

  $: if (baseRoute === ROUTES.MIXED && modalSelectedFiles.length === 0 && availableTypeTabs.length < 2) {
    mixedModalOpen = true;
  }

  $: if (baseRoute !== ROUTES.MIXED || availableTypeTabs.length >= 2) {
    mixedModalOpen = false;
    modalError = "";
    modalSelectedIds = [];
  }

  $: {
    const tabFromRoute = routeToTypeTab(route);
    workspaceTitle = routeWorkspaceTitle(route, activeTypeTab || tabFromRoute);
  }

  $: if (!perfPanelEnabled && topViewTab === "performance") {
    topViewTab = "appearance";
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
      totalBytes: summary.totalBytes,
      kindBreakdown: summary.kindBreakdown,
      routeSnapshot: dropDecision.route,
      source: "dropzone",
      evidenceTag: "ingest",
      note: "Drop or picker import"
    });

    notifyFilesAdded(files.length);
  }

  function onP2PFilesReceived(event) {
    const newFiles = event.detail || [];
    if (newFiles.length === 0) return;

    const uniqueFiles = dedupeIncomingP2PFiles(newFiles);
    const skippedCount = newFiles.length - uniqueFiles.length;
    if (uniqueFiles.length === 0) {
      const skippedNames = [...new Set(newFiles.map((file) => file?.name).filter(Boolean))]
        .slice(0, 3)
        .join(", ");
      showToast({
        message: skippedNames
          ? `No new files were added (${newFiles.length} duplicate${newFiles.length === 1 ? "" : "s"} skipped): ${skippedNames}`
          : "No new files were added (duplicates skipped)",
        type: "error"
      });
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
      totalBytes: summary.totalBytes,
      kindBreakdown: summary.kindBreakdown,
      routeSnapshot: route,
      source: "p2p",
      evidenceTag: "transfer",
      note: "Received through peer transfer"
    });

    notifyFilesAdded(uniqueFiles.length);
    if (skippedCount > 0) {
      showToast({
        message: `${skippedCount} duplicate file${skippedCount === 1 ? "" : "s"} skipped while adding from P2P`,
        type: "success"
      });
    }
  }

  function onDownloadSelectedFiles() {
    if (selectedFiles.length === 0) return;

    const items = selectedFiles
      .filter((entry) => entry?.file instanceof Blob && entry?.name)
      .map((entry) => ({ blob: entry.file, name: entry.name }));

    if (items.length === 0) {
      showToast({ message: "Selected items are not downloadable", type: "error" });
      return;
    }

    saveMany(items);
    showToast({
      message: `Downloading ${items.length} selected file${items.length === 1 ? "" : "s"}`,
      type: "success"
    });
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
      totalBytes: summary.totalBytes,
      kindBreakdown: summary.kindBreakdown,
      routeSnapshot: route,
      source: "workspace",
      evidenceTag: "generated",
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
    if (forensicsEntry && !valid.has(forensicsEntry.id)) {
      forensicsEntry = null;
      forensicsModalOpen = false;
    }
  }

  function onFocusGroup(event) {
    const { tab, selectedIds } = event.detail || {};
    if (!tab || !Array.isArray(selectedIds)) return;

    const selectedSet = new Set(selectedIds);
    activeTypeTab = tab;
    selectedFiles = entries.filter((entry) => selectedSet.has(entry.id));
    modalSelectedIds = [];
    modalError = "";
    mixedModalOpen = false;

    showToast({
      message: `Focused ${typeTabLabel(tab)} workspace`,
      type: "success"
    });
  }

  function openForensics(entry) {
    forensicsEntry = entry;
    forensicsModalOpen = true;
  }

  function closeForensicsModal() {
    forensicsModalOpen = false;
    forensicsEntry = null;
  }

  function chooseModalKind(kind) {
    const chosen = baseActiveFiles.filter((file) => file.kind === kind);
    if (chosen.length < 1) {
      modalError = "No files in this group.";
      return;
    }

    modalSelectedIds = chosen.map((file) => file.id);
    modalError = "";
    mixedModalOpen = false;
    showToast({
      message: `Selected ${chosen.length} ${kindLabel(kind)} file${chosen.length === 1 ? "" : "s"}`,
      type: "success"
    });
  }

  function onTypeTabSelect(tab) {
    activeTypeTab = tab;
    modalSelectedIds = [];
    modalError = "";
    mixedModalOpen = false;
    selectedFiles = entries.filter((entry) => mapKindToTypeTab(entry.kind) === tab);
  }

  function clearAll() {
    entries = [];
    selectedFiles = [];
    modalSelectedIds = [];
    mixedModalOpen = false;
    forensicsEntry = null;
    forensicsModalOpen = false;
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
    recordActivity({
      action: "Processing error",
      toolKey: route,
      routeSnapshot: route,
      source: "tooling",
      evidenceTag: "pipeline",
      fileCount: effectiveFiles.length,
      fileNames: effectiveFiles.slice(0, 5).map((entry) => entry.name),
      totalBytes: effectiveFiles.reduce((sum, entry) => sum + (entry.size || 0), 0),
      kindBreakdown: summarizeEntriesForHistory(effectiveFiles).kindBreakdown,
      note: event.detail || "Operation failed",
      investigation: { stage: "error-path" },
    });
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
      const summary = summarizeEntriesForHistory(effectiveFiles);
      recordActivity({
        action: "Processing completed",
        toolKey: route,
        fileCount: effectiveFiles.length,
        outputCount: n,
        fileNames: effectiveFiles.slice(0, 5).map((entry) => entry.name),
        outputNames: items.slice(0, 8).map((item) => item?.name).filter(Boolean),
        totalBytes: summary.totalBytes,
        kindBreakdown: summary.kindBreakdown,
        routeSnapshot: route,
        source: "tooling",
        evidenceTag: "pipeline",
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
      <h1>{workspaceTitle}</h1>
      <p>Local-first operations with dynamic tool visibility by file type.</p>
    </div>
    <div class="hero-actions">
      <button class="secondary quick-action" type="button" on:click={jumpToIngestion}>
        <span class="material-symbols-outlined" aria-hidden="true">upload_file</span>
        Start with files
      </button>
      <button class="secondary quick-action" class:is-active={workspaceControlsOpen} type="button" on:click={() => (workspaceControlsOpen = !workspaceControlsOpen)}>
        <span class="material-symbols-outlined" aria-hidden="true">tune</span>
        {workspaceControlsOpen ? "Hide Controls" : "Workspace Controls"}
      </button>
      <button class="p2p-btn" class:is-active={p2pOpen} type="button" on:click={toggleP2P} aria-expanded={p2pOpen} aria-pressed={p2pOpen}>
        <span class="material-symbols-outlined">wifi_tethering</span>
        {p2pOpen ? "P2P Transfer Active" : "P2P Transfer"}
      </button>
    </div>
  </header>

  {#if availableTypeTabs.length > 1}
    <section class="panel type-tabs-shell" aria-label="File type workspaces">
      <div class="type-tabs-head">
        <h2>Choose a file family</h2>
        <span>{availableTypeTabs.length} types detected · Alt+1..9</span>
      </div>
      <div class="type-tabs" role="tablist" aria-label="File type tabs">
        {#each availableTypeTabs as typeInfo (typeInfo.tab)}
          <button
            type="button"
            role="tab"
            class="secondary type-tab"
            class:is-active={activeTypeTab === typeInfo.tab}
            aria-selected={activeTypeTab === typeInfo.tab}
            on:click={() => onTypeTabSelect(typeInfo.tab)}
          >
            <span>{typeTabLabel(typeInfo.tab)}</span>
            <small>{typeInfo.count}</small>
          </button>
        {/each}
      </div>
      {#if !activeTypeTab}
        <p class="type-tabs-prompt">Select a tab to reveal tools for that file type.</p>
      {/if}
    </section>
  {/if}

  {#if entries.length > 0 || resultsBatch > 0 || p2pOpen}
    <section class="panel task-shell" aria-label="Primary tasks" in:fly={{ y: -8, duration: 220 }}>
      <p class="task-shell-caption">Primary workflow</p>
      <div class="task-shell-nav" role="tablist" aria-label="Primary workflow navigation">
        {#each TASK_SECTIONS as task}
          <button
            type="button"
            class="secondary task-tab"
            role="tab"
            class:is-active={getActiveTask() === task.id}
            aria-selected={getActiveTask() === task.id}
            on:click={() => activateTask(task.id)}
          >
            <span class="material-symbols-outlined" aria-hidden="true">{task.icon}</span>
            <span>{task.label}</span>
          </button>
        {/each}
      </div>
    </section>
  {/if}

  <section class="panel utility-shell" aria-label="Other tools quick access">
    <div class="utility-shell-head">
      <p class="utility-shell-caption">Other tools</p>
      <span>History, performance, and text diff</span>
    </div>
    <div class="utility-shell-nav" role="tablist" aria-label="Other tools">
      {#each UTILITY_SECTIONS as tool}
        <button
          type="button"
          class="secondary utility-tab"
          role="tab"
          class:is-active={isUtilityActive(tool.id)}
          aria-selected={isUtilityActive(tool.id)}
          on:click={() => activateUtility(tool.id)}
          disabled={tool.id === "performance" && !perfPanelEnabled}
        >
          <span class="material-symbols-outlined" aria-hidden="true">{tool.icon}</span>
          <span>{tool.label}</span>
        </button>
      {/each}
    </div>
  </section>

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

  {#if workspaceControlsOpen}
    <section class="panel workspace-sheet" aria-label="Workspace controls" bind:this={workspaceSheetRef}>
      <div class="workspace-sheet-head">
        <p class="top-view-label">Workspace controls</p>
        <div class="workspace-sheet-actions">
          <button class="secondary shortcuts-help-btn" type="button" on:click={() => (shortcutHelpOpen = true)} title="Shortcut: Alt+/">
            Shortcuts
          </button>
          <button class="secondary shortcuts-help-btn" type="button" on:click={() => (workspaceControlsOpen = false)}>
            Close
          </button>
        </div>
      </div>

      <div class="top-view-tablist" role="tablist" aria-label="Workspace control navigation">
        <button
          type="button"
          role="tab"
          class="secondary top-view-tab"
          class:is-active={topViewTab === "appearance"}
          aria-selected={topViewTab === "appearance"}
          on:click={() => (topViewTab = "appearance")}
        >
          Appearance
        </button>
        <button
          type="button"
          role="tab"
          class="secondary top-view-tab"
          class:is-active={topViewTab === "activity"}
          aria-selected={topViewTab === "activity"}
          on:click={() => (topViewTab = "activity")}
        >
          Recent Activity
        </button>
        <button
          type="button"
          role="tab"
          class="secondary top-view-tab"
          class:is-active={topViewTab === "performance"}
          aria-selected={topViewTab === "performance"}
          on:click={() => (topViewTab = "performance")}
          disabled={!perfPanelEnabled}
        >
          Performance
        </button>
        <button
          type="button"
          role="tab"
          class="secondary top-view-tab"
          class:is-active={topViewTab === "textdiff"}
          aria-selected={topViewTab === "textdiff"}
          on:click={() => (topViewTab = "textdiff")}
        >
          Text Diff
        </button>
      </div>

      {#if topViewTab === "appearance"}
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
      {:else if topViewTab === "activity"}
        <RecentActivity items={recentActivity} lastTool={recentLastTool} on:clear={clearRecentActivity} />
      {:else if topViewTab === "performance"}
        <PerfSummaryPanel enabled={perfPanelEnabled} />
      {:else if topViewTab === "textdiff"}
        <TextDiffWorkspace />
      {/if}
    </section>
  {/if}

  {#if entries.length > 0 || resultsBatch > 0}
    <Toolbar
      route={route}
      processing={processing}
      selectedCount={selectedFiles.length}
      on:clear={clearAll}
      on:secureclear={secureClearData}
      on:downloadselected={onDownloadSelectedFiles}
    />
  {/if}

  {#if canInstallPwa && !pwaInstalled}
    <InstallCta canInstall={canInstallPwa} installed={pwaInstalled} busy={pwaInstallBusy} on:install={onInstallApp} />
  {/if}

  <section class="intake-layout" aria-label="File intake and capability guide">
    <div class="intake-main">
      <Dropzone bind:this={dropzoneRef} accept={pickerAccept} on:filesadded={(event) => onFilesAdded(event.detail)} />
    </div>

    {#if workspaceControlsOpen}
      <aside class="panel feature-overview side-overview" transition:fade aria-label="Capabilities side section">
        <header class="feature-overview-header">
          <div>
            <h2>Everything You Can Do Here</h2>
            <p>Keep this as a side reference while you work. Collapse anytime.</p>
          </div>
          <button
            class="secondary"
            type="button"
            on:click={() => (featureOverviewCollapsed = !featureOverviewCollapsed)}
            aria-expanded={!featureOverviewCollapsed}
            aria-controls="feature-overview-content"
          >
            {featureOverviewCollapsed ? "Expand" : "Collapse"}
          </button>
        </header>

        {#if !featureOverviewCollapsed}
          <div id="feature-overview-content" class="feature-grid">
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
      </aside>
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
  {#if workspaceControlsOpen}
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
  {/if}

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
    {#if entries.length > 0 && !intakeCollapsed && !intakeModalOpen}
      <aside class="workspace-files" aria-label="File drawer">
        <div class="workspace-files-controls panel" role="group" aria-label="Intake board controls">
          <p>Intake board</p>
          <div>
            <button class="secondary" type="button" on:click={() => (intakeCollapsed = true)}>Collapse</button>
            <button class="secondary icon-action-btn" type="button" on:click={openIntakeModal} aria-label="Expand intake board as modal" title="Expand intake board as modal">
              <span class="material-symbols-outlined" aria-hidden="true">open_in_full</span>
            </button>
          </div>
        </div>
        <FileList files={entries} busy={processing} on:selectionchange={onFileSelectionChange} on:fileschange={onFilesChange} on:forensics={(e) => openForensics(e.detail)} on:focusgroup={onFocusGroup} />
      </aside>
    {:else if entries.length > 0}
      <aside class="workspace-files workspace-files-collapsed" aria-label="Collapsed file drawer">
        <section class="panel workspace-files-collapsed-card">
          <h3>Intake board collapsed</h3>
          <p>{entries.length} file{entries.length === 1 ? "" : "s"} loaded</p>
          <div class="workspace-files-collapsed-actions">
            <button class="secondary" type="button" on:click={() => { intakeCollapsed = false; intakeModalOpen = false; }}>Open inline</button>
            <button class="secondary icon-action-btn" type="button" on:click={openIntakeModal} aria-label="Open intake board as modal" title="Open intake board as modal">
              <span class="material-symbols-outlined" aria-hidden="true">open_in_full</span>
            </button>
          </div>
        </section>
      </aside>
    {/if}

    <section class="workspace-tools" aria-label="Active tool workspace">
      {#if availableTypeTabs.length > 1 && !activeTypeTab}
        <section class="panel tab-selection-prompt" aria-label="Select a file type tab">
          <h3>Select a file type tab</h3>
          <p>Choose PDF, Image, Archive, Text, Code, or Video above to reveal the relevant tools.</p>
        </section>
      {:else}
        {#if route === ROUTES.PDF}
          <PdfTools
            files={effectivePdfFiles}
            busy={processing}
            on:processing={(event) => (processing = event.detail)}
            on:progress={onProgress}
            on:error={onError}
            on:output={onOutput}
          />
        {/if}

        {#if route === ROUTES.DJVU}
          <DjvuTools
            files={effectiveDjvuFiles}
            busy={processing}
            on:processing={(event) => (processing = event.detail)}
            on:progress={onProgress}
            on:error={onError}
            on:output={onOutput}
          />
        {/if}

        {#if route === ROUTES.IMAGE}
          <ImageTools
            files={effectiveImageFiles}
            busy={processing}
            on:processing={(event) => (processing = event.detail)}
            on:progress={onProgress}
            on:error={onError}
            on:output={onOutput}
          />
        {/if}

        {#if activeTypeTab === "archive"}
          <section class="panel type-scaffold-card" aria-label="Archive tools">
            <h3>Archive Workspace</h3>
            <p>Use archive packaging tools below. Deep archive extraction/listing is staged for the next iteration.</p>
          </section>
        {/if}

        {#if activeTypeTab === "video"}
          <section class="panel type-scaffold-card" aria-label="Video tools">
            <h3>Video Workspace</h3>
            <p>Video metadata and transcode tools are coming next. This tab is now reserved and type-aware.</p>
          </section>
        {/if}

        {#if route === ROUTES.FILE && activeTypeTab !== "video"}
          <FileTools
            files={effectiveFiles}
            busy={processing}
            on:processing={(event) => (processing = event.detail)}
            on:progress={onProgress}
            on:error={onError}
            on:output={onOutput}
          />
        {/if}

        {#if route === ROUTES.CONTENT && !showCompareWorkspace}
          <ContentTools
            files={effectiveContentFiles}
            busy={processing}
            on:processing={(event) => (processing = event.detail)}
            on:progress={onProgress}
            on:error={onError}
            on:output={onOutput}
          />
        {/if}

        {#if showCompareWorkspace}
          <CompareWorkspace files={compareWorkspaceFiles} />
        {/if}

        {#if batchEligibleFiles.length > 1 && !showCompareWorkspace}
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
    </section>

  </div>

  {#if forensicsEntry && forensicsModalOpen}
    <div class="modal-backdrop forensics-modal-backdrop" transition:fade>
      <div class="panel modal forensics-modal" role="dialog" aria-modal="true" aria-label="Forensics inspector">
        <ForensicsDrawer entry={forensicsEntry} on:collapse={() => (forensicsModalOpen = false)} on:close={closeForensicsModal} />
      </div>
    </div>
  {/if}

  {#if intakeModalOpen}
    <div class="modal-backdrop intake-modal-backdrop" transition:fade>
      <div class="panel modal intake-modal" role="dialog" aria-modal="true" aria-label="Expanded intake board">
        <header class="intake-modal-head">
          <h3>Intake Board</h3>
          <div class="intake-modal-actions">
            <button class="secondary" type="button" on:click={() => { intakeCollapsed = false; intakeModalOpen = false; }}>Dock left</button>
            <button class="secondary" type="button" on:click={closeIntakeModal}>Close</button>
          </div>
        </header>
        <FileList files={entries} busy={processing} on:selectionchange={onFileSelectionChange} on:fileschange={onFilesChange} on:forensics={(e) => openForensics(e.detail)} on:focusgroup={onFocusGroup} />
      </div>
    </div>
  {/if}

  {#if mixedModalOpen}
    <div class="modal-backdrop" transition:fade>
      <div class="panel modal" role="dialog" aria-modal="true" aria-label="Choose files for operation">
        <h3>Mixed file selection</h3>
        <p>Choose one file family to continue. The matching tool will open immediately.</p>

        <div class="modal-kind-grid" role="list" aria-label="File type groups">
          {#each modalKindGroups as group (group.kind)}
            <button
              type="button"
              class="secondary modal-kind-card"
              on:click={() => chooseModalKind(group.kind)}
            >
              <span class="modal-kind-title">{kindLabel(group.kind)}</span>
              <span class="modal-kind-count">{group.count} file{group.count === 1 ? "" : "s"}</span>
            </button>
          {/each}
        </div>

        {#if modalError}
          <small class="modal-error">{modalError}</small>
        {/if}

        <div class="modal-actions">
          <button class="secondary" type="button" on:click={() => { mixedModalOpen = false; modalSelectedIds = []; }}>Cancel</button>
        </div>
      </div>
    </div>
  {/if}

  {#if shortcutHelpOpen}
    <div class="modal-backdrop" transition:fade>
      <div class="panel modal shortcuts-modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <h3>Keyboard shortcuts</h3>
        <ul class="shortcut-list">
          <li><strong>Alt+1..9</strong><span>Switch active file-type tab</span></li>
          <li><strong>Alt+/</strong><span>Open or close this shortcuts dialog</span></li>
          <li><strong>Esc</strong><span>Close shortcuts dialog</span></li>
        </ul>
        <div class="modal-actions">
          <button class="secondary" type="button" on:click={() => (shortcutHelpOpen = false)}>Close</button>
        </div>
      </div>
    </div>
  {/if}

  <ResultsDrawer newBatch={resultsBatch} />

  <section
    id="fallback-resources"
    class="panel fallback-resources"
    aria-labelledby="fallback-help-title"
  >
    <h2 id="fallback-help-title">Need a feature not available here?</h2>
    <p>
      If you cannot complete a task in this app, continue to alternatives.
    </p>
    <div class="fallback-actions">
      <a class="fallback-link" href="https://ilovepdf.com" target="_blank" rel="noopener noreferrer">
        Open iLovePDF (SaaS tool)
      </a>
      <a class="fallback-link secondary-link" href="https://ihatepdf.cv" target="_blank" rel="noopener noreferrer">
        Open iHatePDF (Offline tool)
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
    max-width: 1320px;
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
    padding: 0.4rem 0.1rem 0.45rem;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.8rem;
    flex-wrap: wrap;
  }

  .hero-actions {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
  }

  .hero-text {
    min-width: 0;
  }

  .appbar-kicker {
    margin: 0;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--md-sys-color-on-surface-variant);
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

  .type-tabs-shell {
    padding: 0.8rem 0.9rem;
    display: grid;
    gap: 0.55rem;
  }

  .type-tabs-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.6rem;
  }

  .type-tabs-head h2 {
    margin: 0;
    font-size: 0.9rem;
  }

  .type-tabs-head span {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.75rem;
  }

  .type-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .type-tab {
    display: inline-flex;
    align-items: center;
    gap: 0.42rem;
    border-radius: 999px;
    padding: 0.4rem 0.72rem;
  }

  .type-tab.is-active {
    border-color: color-mix(in srgb, var(--theme-accent) 60%, var(--md-sys-color-outline));
    background: color-mix(in srgb, var(--theme-accent) 18%, var(--md-sys-color-surface));
  }

  .type-tab small {
    margin: 0;
    min-width: 1.2rem;
    height: 1.2rem;
    border-radius: 999px;
    display: inline-grid;
    place-items: center;
    font-size: 0.68rem;
    background: color-mix(in srgb, var(--md-sys-color-primary) 16%, var(--md-sys-color-surface));
    color: var(--md-sys-color-on-surface);
  }

  .type-tabs-prompt {
    margin: 0;
    font-size: 0.79rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .quick-action {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.5rem 0.92rem;
    font-size: 0.82rem;
    font-weight: 600;
  }

  .quick-action .material-symbols-outlined {
    font-size: 1rem;
  }

  .quick-action.is-active {
    border-color: color-mix(in srgb, var(--md-sys-color-primary) 48%, var(--md-sys-color-outline-variant));
    background: color-mix(in srgb, var(--md-sys-color-primary-container) 62%, var(--md-sys-color-surface));
    color: var(--md-sys-color-on-surface);
  }

  .task-shell {
    padding: 0.72rem 0.8rem;
    display: grid;
    gap: 0.58rem;
    border-top: 3px solid color-mix(in srgb, var(--theme-accent) 48%, transparent);
    background: color-mix(in srgb, var(--md-sys-color-surface) 82%, var(--theme-accent) 18%);
  }

  .task-shell-caption {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--md-sys-color-on-surface-variant);
  }

  .task-shell-nav {
    display: flex;
    align-items: center;
    gap: 0.42rem;
    flex-wrap: wrap;
  }

  .task-tab {
    display: inline-flex;
    align-items: center;
    gap: 0.34rem;
    padding: 0.48rem 0.8rem;
    font-size: 0.8rem;
    font-weight: 600;
    border: 1px solid var(--md-sys-color-outline-variant);
  }

  .task-tab .material-symbols-outlined {
    font-size: 0.98rem;
  }

  .task-tab.is-active {
    background: color-mix(in srgb, var(--theme-accent) 16%, var(--md-sys-color-surface));
    border-color: color-mix(in srgb, var(--theme-accent) 52%, var(--md-sys-color-outline-variant));
    color: var(--md-sys-color-on-surface);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--theme-accent) 20%, transparent);
  }

  .utility-shell {
    padding: 0.72rem 0.8rem;
    display: grid;
    gap: 0.58rem;
    border-top: 0;
    border-left: 2px solid color-mix(in srgb, var(--md-sys-color-outline) 24%, transparent);
    background: var(--md-sys-color-surface-container-low);
    position: sticky;
    top: 0.55rem;
    z-index: 32;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
  }

  .utility-shell-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.55rem;
  }

  .utility-shell-head span {
    font-size: 0.74rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .utility-shell-caption {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--md-sys-color-on-surface-variant);
  }

  .utility-shell-nav {
    display: flex;
    align-items: center;
    gap: 0.42rem;
    flex-wrap: wrap;
  }

  .utility-tab {
    display: inline-flex;
    align-items: center;
    gap: 0.34rem;
    padding: 0.48rem 0.8rem;
    font-size: 0.8rem;
    font-weight: 600;
    border: 1px solid var(--md-sys-color-outline-variant);
  }

  .utility-tab .material-symbols-outlined {
    font-size: 0.98rem;
  }

  .utility-tab.is-active {
    background: color-mix(in srgb, var(--theme-accent) 16%, var(--md-sys-color-surface));
    border-color: color-mix(in srgb, var(--theme-accent) 52%, var(--md-sys-color-outline-variant));
    color: var(--md-sys-color-on-surface);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--theme-accent) 20%, transparent);
  }

  .workspace-sheet {
    padding: 0.7rem;
    display: grid;
    gap: 0.6rem;
  }

  .workspace-sheet-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.55rem;
  }

  .workspace-sheet-actions {
    display: inline-flex;
    gap: 0.38rem;
  }

  .top-view-label {
    margin: 0;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--md-sys-color-on-surface-variant);
  }

  .shortcuts-help-btn {
    font-size: 0.68rem;
    padding: 0.34rem 0.6rem;
  }

  .top-view-tablist {
    display: flex;
    gap: 0.45rem;
    flex-wrap: wrap;
  }

  .top-view-tab {
    font-size: 0.8rem;
    padding: 0.42rem 0.78rem;
  }

  .top-view-tab.is-active {
    background: color-mix(in srgb, var(--theme-accent) 18%, var(--md-sys-color-surface-container));
    border-color: color-mix(in srgb, var(--theme-accent) 35%, var(--md-sys-color-outline-variant));
    color: var(--md-sys-color-on-surface);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--theme-accent) 28%, transparent);
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
    gap: 1.1rem;
    grid-template-columns: minmax(280px, 330px) minmax(0, 1fr);
    align-items: start;
  }

  .workspace-files,
  .workspace-tools {
    min-width: 0;
  }

  .workspace-files {
    position: sticky;
    top: 0.75rem;
    align-self: start;
    display: grid;
    gap: 0.65rem;
  }

  .workspace-files-controls {
    padding: 0.5rem 0.6rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.45rem;
  }

  .workspace-files-controls p {
    margin: 0;
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--md-sys-color-on-surface-variant);
  }

  .workspace-files-controls div {
    display: inline-flex;
    gap: 0.35rem;
  }

  .icon-action-btn {
    width: 2rem;
    height: 2rem;
    min-width: 2rem;
    padding: 0;
    display: inline-grid;
    place-items: center;
  }

  .icon-action-btn .material-symbols-outlined {
    font-size: 1rem;
  }

  .workspace-files-collapsed {
    position: static;
    align-self: start;
  }

  .workspace-files-collapsed-card {
    padding: 0.85rem;
    display: grid;
    gap: 0.55rem;
  }

  .workspace-files-collapsed-card h3 {
    margin: 0;
    font-size: 0.92rem;
  }

  .workspace-files-collapsed-card p {
    margin: 0;
    font-size: 0.82rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .workspace-files-collapsed-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .workspace-tools {
    display: grid;
    gap: 1rem;
  }

  .tab-selection-prompt {
    padding: 1rem;
    border: 1px solid var(--md-sys-color-outline-variant);
    background: color-mix(in srgb, var(--md-sys-color-surface) 92%, var(--md-sys-color-primary) 8%);
  }

  .tab-selection-prompt h3 {
    margin: 0;
    font-size: 1rem;
  }

  .tab-selection-prompt p {
    margin: 0.45rem 0 0;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.86rem;
  }

  .type-scaffold-card {
    padding: 0.95rem;
    border: 1px solid var(--md-sys-color-outline-variant);
    background: color-mix(in srgb, var(--md-sys-color-surface) 92%, var(--theme-accent) 8%);
  }

  .type-scaffold-card h3 {
    margin: 0;
    font-size: 0.96rem;
  }

  .type-scaffold-card p {
    margin: 0.42rem 0 0;
    font-size: 0.84rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .shortcuts-modal {
    width: min(440px, 92vw);
  }

  .shortcut-list {
    list-style: none;
    margin: 0.6rem 0 0;
    padding: 0;
    display: grid;
    gap: 0.45rem;
  }

  .shortcut-list li {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 10px;
    padding: 0.45rem 0.55rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.55rem;
    font-size: 0.76rem;
  }

  .shortcut-list li strong {
    font-size: 0.72rem;
    letter-spacing: 0.06em;
  }

  .shortcut-list li span {
    color: var(--md-sys-color-on-surface-variant);
  }

  .intake-layout {
    display: grid;
    gap: 0.85rem;
    align-items: start;
  }

  .intake-main {
    min-width: 0;
  }

  .feature-overview {
    padding: 1rem;
  }

  .side-overview {
    position: sticky;
    top: 0.75rem;
    max-height: calc(100vh - 1.5rem);
    overflow: auto;
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
    grid-template-columns: 1fr;
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

  .modal-kind-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 0.5rem;
  }

  .modal-kind-card {
    border-radius: 2px;
    border: 1px solid var(--md-sys-color-outline-variant);
    padding: 0.65rem 0.7rem;
    display: grid;
    gap: 0.18rem;
    justify-items: start;
    text-align: left;
    background: var(--md-sys-color-surface-container-low);
  }

  .modal-kind-title {
    font-size: 0.82rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--md-sys-color-on-surface);
  }

  .modal-kind-count {
    font-size: 0.74rem;
    color: var(--md-sys-color-on-surface-variant);
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

  .intake-modal-backdrop {
    z-index: 34;
    align-items: start;
    padding-top: 3.8rem;
  }

  .intake-modal {
    width: min(760px, 96vw);
    max-height: calc(100vh - 5rem);
    overflow: auto;
  }

  .intake-modal-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.65rem;
    margin-bottom: 0.7rem;
  }

  .intake-modal-head h3 {
    margin: 0;
  }

  .intake-modal-actions {
    display: inline-flex;
    gap: 0.4rem;
  }

  .forensics-modal-backdrop {
    z-index: 35;
    align-items: start;
    padding-top: 3.8rem;
  }

  .forensics-modal {
    width: min(980px, 97vw);
    max-height: calc(100vh - 5rem);
    overflow: auto;
    padding: 0.3rem;
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
      justify-content: stretch;
    }

    .hero-actions > button {
      width: 100%;
      justify-content: center;
    }

    .task-shell-nav {
      display: grid;
      grid-template-columns: 1fr;
    }

    .task-tab {
      width: 100%;
      justify-content: center;
    }

    .utility-shell-head {
      align-items: flex-start;
      flex-direction: column;
    }

    .utility-shell {
      position: static;
      top: auto;
      z-index: auto;
      box-shadow: none;
    }

    .utility-shell-nav {
      display: grid;
      grid-template-columns: 1fr;
    }

    .utility-tab {
      width: 100%;
      justify-content: center;
    }

    .top-view-tablist {
      display: grid;
      grid-template-columns: 1fr;
      gap: 0.4rem;
    }

    .top-view-tab {
      width: 100%;
      justify-content: center;
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

    .intake-layout {
      grid-template-columns: 1fr;
    }

    .content-grid {
      grid-template-columns: 1fr;
    }

    .workspace-files,
    .workspace-tools {
      position: static;
      width: auto;
      right: auto;
      top: auto;
      max-height: none;
      overflow: visible;
      box-shadow: none;
      border-radius: 0;
    }

    .workspace-files-controls {
      flex-direction: column;
      align-items: stretch;
    }

    .workspace-files-controls div {
      width: 100%;
      display: grid;
      grid-template-columns: 1fr;
    }

    .intake-modal-backdrop {
      padding-top: 1rem;
    }

    .intake-modal {
      width: 100%;
      max-height: 90vh;
    }

    .forensics-modal-backdrop {
      padding-top: 1rem;
    }

    .forensics-modal {
      width: 100%;
      max-height: 90vh;
    }

    .intake-modal-head {
      flex-direction: column;
      align-items: stretch;
    }

    .intake-modal-actions {
      display: grid;
      grid-template-columns: 1fr;
    }

    .side-overview {
      position: static;
      max-height: none;
      overflow: visible;
    }


  @media (min-width: 980px) {
    .intake-layout {
      grid-template-columns: minmax(0, 1fr) minmax(320px, 380px);
      gap: 0.9rem;
    }
  }

  @media (max-width: 1200px) {
    .content-grid {
      grid-template-columns: minmax(260px, 310px) minmax(0, 1fr);
    }
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
