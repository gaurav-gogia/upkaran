<script>
  import { createEventDispatcher, onDestroy } from "svelte";
  import {
    mergePdfs,
    splitPdf,
    extractPdfPages,
    removePdfPages,
    rotatePdfPages,
    addPdfPageNumbers,
    reorderPdfPages,
    compressPdf,
    pdfToImages,
    renderPdfPreviewPage,
    addPdfImageWatermark,
    getPdfPageCount,
    summarizeCustomSplitSelection,
    buildAllPagesSelection,
    unlockPdf,
    lockPdf
  } from "../js/pdf-tools.js";
  import { pdfToDjvu } from "../js/djvu-tools.js";
  import { formatBytes } from "../js/detect.js";

  export let files = [];
  export let busy = false;
  let imageFormat = "png";
  let splitMode = "per-page";
  let splitSelection = "1-2,3,4-5";
  let pageActionSelection = "";
  let rotateAngle = "90";
  let pageNumberSelection = "";
  let pageNumberStart = "1";
  let pageNumberPosition = "bottom-center";
  let splitPageCount = 0;
  let splitPreview = "";
  let splitPreviewError = "";
  let pageCountRequestId = 0;
  let pageCountFileKey = "";
  let previewRequestId = 0;
  let previewFileKey = "";
  let previewPage = 1;
  let previewTotalPages = 0;
  let previewUrl = "";
  let previewLoading = false;
  let previewError = "";
  let mergeQueue = [];
  let draggingMergeId = "";
  let pageOrder = [];
  let draggingPageOrder = null;
  let pageOrderFileKey = "";
  let pageThumbnails = {};
  let thumbnailRequestId = 0;
  let thumbnailFileKey = "";
  let watermarkImageFile = null;
  let watermarkImageUrl = "";
  let watermarkImageAspect = 1;
  let watermarkSelection = "";
  let watermarkSelectionError = "";
  let watermarkTargetPages = [];
  let watermarkPlacementMap = {};
  let watermarkStageEl = null;
  let watermarkStageCanvasEl = null;
  let watermarkPointerState = null;
  let watermarkPointerId = null;
  let watermarkOpacity = "35";
  let watermarkRotation = "0";
  let watermarkJumpPage = "";
  let watermarkLockAspect = true;
  let watermarkSyncToTargets = false;
  let watermarkNudgeStep = "0.5";
  let watermarkPlacementHistory = [];
  let watermarkPlacementHistoryIndex = -1;
  let livePreviewError = "";
  let livePreviewRenderId = 0;
  let livePreviewBaseSrc = "";
  let livePreviewBaseImg = null;
  let livePreviewWatermarkSrc = "";
  let livePreviewWatermarkImg = null;

  const dispatch = createEventDispatcher();

  // ── PDF Unlock state ────────────────────────────────────────────────────
  let unlockPassword = "";
  let unlockNeedsPassword = false;
  let unlockError = "";
  let unlockSuccess = "";
  let unlocking = false;

  // ── PDF Lock state ──────────────────────────────────────────────────────
  let lockPassword = "";
  let lockPasswordConfirm = "";
  let lockError = "";
  let lockSuccess = "";
  let locking = false;

  $: if (files.length > 0) {
    unlockNeedsPassword = false;
    unlockError = "";
    unlockSuccess = "";
    unlockPassword = "";

    lockPassword = "";
    lockPasswordConfirm = "";
    lockError = "";
    lockSuccess = "";
  }

  async function runUnlock() {
    if (unlocking || !files.length) return;
    unlocking = true;
    unlockError = "";
    unlockSuccess = "";
    try {
      const blob = await unlockPdf(files[0], unlockPassword, (p) => dispatch("progress", p));
      const baseName = files[0].name.replace(/\.pdf$/i, "");
      dispatch("output", [{ name: `${baseName}-unlocked.pdf`, blob }]);
      unlockSuccess = "PDF unlocked and added to results.";
      unlockNeedsPassword = false;
    } catch (e) {
      if (e.needsPassword) {
        unlockNeedsPassword = true;
        unlockError = e.message;
      } else {
        unlockError = e.message || "Unlock failed.";
      }
    } finally {
      unlocking = false;
    }
  }

  async function runLock() {
    if (locking || !files.length) return;

    lockError = "";
    lockSuccess = "";

    if (!lockPassword.trim()) {
      lockError = "Enter a password to lock this PDF.";
      return;
    }
    if (lockPassword !== lockPasswordConfirm) {
      lockError = "Password and confirmation do not match.";
      return;
    }

    locking = true;
    try {
      const blob = await lockPdf(files[0], lockPassword, (p) => dispatch("progress", p));
      const baseName = files[0].name.replace(/\.pdf$/i, "");
      dispatch("output", [{ name: `${baseName}-locked.pdf`, blob }]);
      lockSuccess = "PDF locked and added to results.";
      lockPassword = "";
      lockPasswordConfirm = "";
    } catch (e) {
      lockError = e?.message || "Lock failed.";
    } finally {
      locking = false;
    }
  }

  $: {
    const byId = new Map(files.map((file) => [file.id, file]));
    const persisted = mergeQueue.filter((file) => byId.has(file.id)).map((file) => byId.get(file.id));
    const missing = files.filter((file) => !persisted.some((existing) => existing.id === file.id));
    mergeQueue = [...persisted, ...missing];
  }

  $: if (files.length > 0) {
    const next = files[0];
    const nextKey = `${next.id}|${next.name}|${next.size}`;
    if (nextKey !== pageCountFileKey) {
      pageCountFileKey = nextKey;
      void refreshPageCount(next);
    }
    if (nextKey !== previewFileKey) {
      previewFileKey = nextKey;
      previewPage = 1;
      void loadPreview(next, previewPage);
      watermarkSelection = "";
      watermarkSelectionError = "";
      watermarkPlacementMap = {};
      initWatermarkPlacementHistory();
    }
    if (nextKey !== pageOrderFileKey) {
      pageOrderFileKey = nextKey;
      pageOrder = [];
    }
    if (nextKey !== thumbnailFileKey) {
      thumbnailFileKey = nextKey;
      pageThumbnails = {};
    }
  } else {
    splitPageCount = 0;
    splitPreview = "";
    splitPreviewError = "";
    pageCountFileKey = "";
    previewFileKey = "";
    previewTotalPages = 0;
    previewPage = 1;
    previewUrl = "";
    previewError = "";
    previewLoading = false;
    pageOrderFileKey = "";
    pageOrder = [];
    thumbnailFileKey = "";
    pageThumbnails = {};
    watermarkSelection = "";
    watermarkSelectionError = "";
    watermarkTargetPages = [];
    watermarkPlacementMap = {};
    initWatermarkPlacementHistory();
  }

  $: if (files.length > 0 && previewFileKey) {
    const next = files[0];
    const nextKey = `${next.id}|${next.name}|${next.size}`;
    if (nextKey === previewFileKey) {
      void loadPreview(next, previewPage);
    }
  }

  $: if (splitMode === "custom" && splitPageCount > 0) {
    try {
      const summary = summarizeCustomSplitSelection(splitSelection, splitPageCount);
      splitPreviewError = "";
      splitPreview = `Will create ${summary.groups} output PDF${summary.groups === 1 ? "" : "s"} covering ${summary.pages} page${summary.pages === 1 ? "" : "s"}.`;
    } catch (error) {
      splitPreview = "";
      splitPreviewError = error.message;
    }
  } else {
    splitPreview = "";
    splitPreviewError = "";
  }

  $: if (splitPageCount > 0 && pageOrder.length !== splitPageCount) {
    pageOrder = Array.from({ length: splitPageCount }, (_, i) => i + 1);
  }

  $: if (splitPageCount > 0 && files.length > 0 && thumbnailFileKey === `${files[0].id}|${files[0].name}|${files[0].size}` && Object.keys(pageThumbnails).length === 0) {
    void loadPageThumbnails(files[0], splitPageCount);
  }

  async function refreshPageCount(fileEntry) {
    const requestId = ++pageCountRequestId;
    try {
      const pageCount = await getPdfPageCount(fileEntry);
      if (requestId !== pageCountRequestId) return;
      splitPageCount = pageCount;
    } catch {
      if (requestId !== pageCountRequestId) return;
      splitPageCount = 0;
    }
  }

  function useAllPagesSelection() {
    splitSelection = buildAllPagesSelection(splitPageCount);
  }

  function reorderMergeQueue(targetId) {
    if (!draggingMergeId || draggingMergeId === targetId) return;

    const from = mergeQueue.findIndex((file) => file.id === draggingMergeId);
    const to = mergeQueue.findIndex((file) => file.id === targetId);
    if (from < 0 || to < 0) return;

    const next = [...mergeQueue];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    mergeQueue = next;
  }

  async function loadPreview(fileEntry, page) {
    const requestId = ++previewRequestId;
    previewLoading = true;
    previewError = "";

    try {
      const result = await renderPdfPreviewPage(fileEntry, { page, scale: 1.25 });
      if (requestId !== previewRequestId) return;
      previewPage = result.page;
      previewTotalPages = result.totalPages;
      previewUrl = result.dataUrl;
    } catch (error) {
      if (requestId !== previewRequestId) return;
      previewError = error.message || "Unable to render PDF preview.";
      previewUrl = "";
    } finally {
      if (requestId === previewRequestId) {
        previewLoading = false;
      }
    }
  }

  async function loadPageThumbnails(fileEntry, pageCount) {
    const requestId = ++thumbnailRequestId;
    const thumbs = {};
    for (let i = 1; i <= pageCount; i++) {
      if (requestId !== thumbnailRequestId) return;
      try {
        const result = await renderPdfPreviewPage(fileEntry, { page: i, scale: 0.25 });
        if (requestId !== thumbnailRequestId) return;
        thumbs[i] = result.dataUrl;
        pageThumbnails = { ...thumbs };
      } catch {
        // skip failed thumbnails
      }
    }
  }

  function changePreviewPage(delta) {
    if (!previewTotalPages) return;
    const next = Math.max(1, Math.min(previewTotalPages, previewPage + delta));
    if (next === previewPage) return;
    previewPage = next;
  }

  function reorderPageOrder(targetPage) {
    if (draggingPageOrder == null || draggingPageOrder === targetPage) return;

    const from = pageOrder.findIndex((page) => page === draggingPageOrder);
    const to = pageOrder.findIndex((page) => page === targetPage);
    if (from < 0 || to < 0) return;

    const next = [...pageOrder];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    pageOrder = next;
  }

  function resetPageOrder() {
    if (splitPageCount < 1) return;
    pageOrder = Array.from({ length: splitPageCount }, (_, i) => i + 1);
  }

  function reversePageOrder() {
    pageOrder = [...pageOrder].reverse();
  }

  function sortPageOrderAsc() {
    pageOrder = [...pageOrder].sort((a, b) => a - b);
  }

  function sortPageOrderDesc() {
    pageOrder = [...pageOrder].sort((a, b) => b - a);
  }

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
  }

  function loadImageElement(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Failed to load preview image."));
      image.src = src;
    });
  }

  async function getLivePreviewBaseImage() {
    if (!previewUrl) return null;
    if (livePreviewBaseImg && livePreviewBaseSrc === previewUrl) return livePreviewBaseImg;
    const image = await loadImageElement(previewUrl);
    livePreviewBaseSrc = previewUrl;
    livePreviewBaseImg = image;
    return image;
  }

  async function getLivePreviewWatermarkImage() {
    if (!watermarkImageUrl) return null;
    if (livePreviewWatermarkImg && livePreviewWatermarkSrc === watermarkImageUrl) return livePreviewWatermarkImg;
    const image = await loadImageElement(watermarkImageUrl);
    livePreviewWatermarkSrc = watermarkImageUrl;
    livePreviewWatermarkImg = image;
    return image;
  }

  async function paintLiveWatermarkPreview() {
    if (!watermarkStageCanvasEl || !previewUrl) return;
    const renderId = ++livePreviewRenderId;

    try {
      const baseImage = await getLivePreviewBaseImage();
      if (!baseImage) return;
      const watermarkImage = await getLivePreviewWatermarkImage();

      if (renderId !== livePreviewRenderId) return;

      const canvas = watermarkStageCanvasEl;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const width = baseImage.naturalWidth || baseImage.width;
      const height = baseImage.naturalHeight || baseImage.height;
      if (width < 1 || height < 1) return;

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(baseImage, 0, 0, width, height);

      if (watermarkImage) {
        const placement = getCurrentWatermarkPlacement();
        const drawWidth = placement.width * width;
        const drawHeight = placement.height * height;
        const drawX = placement.x * width;
        const drawY = placement.y * height;
        const centerX = drawX + drawWidth / 2;
        const centerY = drawY + drawHeight / 2;

        ctx.save();
        ctx.globalAlpha = clamp(placement.opacity, 0, 1);
        ctx.translate(centerX, centerY);
        ctx.rotate(((placement.rotation || 0) * Math.PI) / 180);
        ctx.drawImage(watermarkImage, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
        ctx.restore();
      }

      livePreviewError = "";
    } catch (error) {
      livePreviewError = error?.message || "Could not repaint live preview.";
    }
  }

  function parseWatermarkSelection(selection, totalPages) {
    if (!Number.isFinite(totalPages) || totalPages < 1) return [];
    if (!selection || !selection.trim()) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const tokens = selection
      .split(/[,;\n]+/)
      .map((token) => token.trim())
      .filter(Boolean);

    if (tokens.length < 1) {
      throw new Error("Enter page selections like 1-3,5.");
    }

    const pages = [];
    for (const token of tokens) {
      const match = token.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!match) {
        throw new Error(`Invalid page selection \"${token}\".`);
      }

      let start = Number.parseInt(match[1], 10);
      let end = match[2] ? Number.parseInt(match[2], 10) : start;
      if (Number.isNaN(start) || Number.isNaN(end)) {
        throw new Error(`Invalid page selection \"${token}\".`);
      }
      if (start > end) [start, end] = [end, start];
      if (start < 1 || end > totalPages) {
        throw new Error(`Selection \"${token}\" is out of range. This PDF has ${totalPages} pages.`);
      }

      for (let page = start; page <= end; page += 1) {
        pages.push(page);
      }
    }

    return [...new Set(pages)];
  }

  function buildDefaultWatermarkPlacement() {
    const defaultWidth = 0.24;
    const defaultHeight = clamp(defaultWidth / clamp(watermarkImageAspect, 0.1, 10), 0.06, 0.55);
    return {
      x: clamp(1 - defaultWidth - 0.04, 0, 1 - defaultWidth),
      y: clamp(1 - defaultHeight - 0.04, 0, 1 - defaultHeight),
      width: defaultWidth,
      height: defaultHeight,
      opacity: clamp(Number.parseFloat(watermarkOpacity) / 100, 0, 1),
      rotation: Number.parseFloat(watermarkRotation) || 0
    };
  }

  function clonePlacementMap(map) {
    const clone = {};
    for (const [pageKey, placement] of Object.entries(map || {})) {
      clone[pageKey] = { ...placement };
    }
    return clone;
  }

  function placementMapSignature(map) {
    const pages = Object.keys(map || {}).sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
    return pages.map((page) => {
      const p = map[page];
      return [
        page,
        Number(p.x).toFixed(5),
        Number(p.y).toFixed(5),
        Number(p.width).toFixed(5),
        Number(p.height).toFixed(5),
        Number(p.opacity).toFixed(5),
        Number(p.rotation).toFixed(3)
      ].join(":");
    }).join("|");
  }

  function initWatermarkPlacementHistory() {
    const snapshot = clonePlacementMap(watermarkPlacementMap);
    watermarkPlacementHistory = [snapshot];
    watermarkPlacementHistoryIndex = 0;
  }

  function pushWatermarkPlacementHistory(nextMap) {
    const current = watermarkPlacementHistory[watermarkPlacementHistoryIndex] || {};
    if (placementMapSignature(current) === placementMapSignature(nextMap)) return;

    const prior = watermarkPlacementHistory.slice(0, watermarkPlacementHistoryIndex + 1);
    prior.push(clonePlacementMap(nextMap));

    const limit = 80;
    const trimmed = prior.length > limit ? prior.slice(prior.length - limit) : prior;
    watermarkPlacementHistory = trimmed;
    watermarkPlacementHistoryIndex = trimmed.length - 1;
  }

  function undoWatermarkPlacementChange() {
    if (watermarkPlacementHistoryIndex <= 0) return;
    watermarkPlacementHistoryIndex -= 1;
    watermarkPlacementMap = clonePlacementMap(watermarkPlacementHistory[watermarkPlacementHistoryIndex] || {});
    ensureWatermarkPlacement(previewPage);
  }

  function redoWatermarkPlacementChange() {
    if (watermarkPlacementHistoryIndex < 0 || watermarkPlacementHistoryIndex >= watermarkPlacementHistory.length - 1) return;
    watermarkPlacementHistoryIndex += 1;
    watermarkPlacementMap = clonePlacementMap(watermarkPlacementHistory[watermarkPlacementHistoryIndex] || {});
    ensureWatermarkPlacement(previewPage);
  }

  function normalizeWatermarkPlacement(input) {
    const width = clamp(Number.parseFloat(input?.width ?? 0.24), 0.02, 1);
    const height = clamp(Number.parseFloat(input?.height ?? 0.12), 0.02, 1);
    const x = clamp(Number.parseFloat(input?.x ?? 0.7), 0, 1 - width);
    const y = clamp(Number.parseFloat(input?.y ?? 0.8), 0, 1 - height);
    return {
      x,
      y,
      width,
      height,
      opacity: clamp(Number.parseFloat(input?.opacity ?? watermarkOpacity / 100), 0, 1),
      rotation: Number.parseFloat(input?.rotation ?? watermarkRotation) || 0
    };
  }

  function ensureWatermarkPlacement(pageNum) {
    if (!pageNum || !watermarkImageUrl) return;
    if (watermarkPlacementMap[pageNum]) return;
    watermarkPlacementMap = {
      ...watermarkPlacementMap,
      [pageNum]: buildDefaultWatermarkPlacement()
    };
  }

  function getCurrentWatermarkPlacement() {
    const pageNum = previewPage;
    const existing = watermarkPlacementMap[pageNum];
    if (existing) return existing;
    return buildDefaultWatermarkPlacement();
  }

  function updateCurrentWatermarkPlacement(nextPlacement) {
    if (!watermarkImageUrl || !previewPage) return;
    const normalized = normalizeWatermarkPlacement(nextPlacement);
    let nextMap = {
      ...watermarkPlacementMap,
      [previewPage]: normalized
    };

    // Optionally mirror the current adjustment to selected target pages in real time.
    if (watermarkSyncToTargets && watermarkTargetPages.length > 0) {
      nextMap = { ...nextMap };
      for (const pageNum of watermarkTargetPages) {
        nextMap[pageNum] = { ...normalized };
      }
    }

    watermarkPlacementMap = nextMap;
    pushWatermarkPlacementHistory(nextMap);
  }

  function setCurrentPlacementPercent(field, value) {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) return;
    const current = getCurrentWatermarkPlacement();
    const nextValue = parsed / 100;
    const next = { ...current, [field]: nextValue };

    if (watermarkLockAspect && (field === "width" || field === "height")) {
      const aspect = clamp(watermarkImageAspect, 0.1, 10);
      if (field === "width") {
        next.height = nextValue / aspect;
      } else {
        next.width = nextValue * aspect;
      }
    }

    updateCurrentWatermarkPlacement(next);
  }

  function setCurrentOpacity(value) {
    watermarkOpacity = `${value}`;
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) return;
    const current = getCurrentWatermarkPlacement();
    updateCurrentWatermarkPlacement({ ...current, opacity: parsed / 100 });
  }

  function setCurrentRotation(value) {
    watermarkRotation = `${value}`;
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) return;
    const current = getCurrentWatermarkPlacement();
    updateCurrentWatermarkPlacement({ ...current, rotation: parsed });
  }

  function onWatermarkImagePicked(event) {
    const nextFile = event.currentTarget?.files?.[0];
    if (!nextFile) return;

    if (watermarkImageUrl) {
      URL.revokeObjectURL(watermarkImageUrl);
    }

    watermarkImageFile = nextFile;
    watermarkImageUrl = URL.createObjectURL(nextFile);
    watermarkPlacementMap = {};
    initWatermarkPlacementHistory();

    const probe = new Image();
    probe.onload = () => {
      watermarkImageAspect = probe.naturalWidth > 0 && probe.naturalHeight > 0
        ? probe.naturalWidth / probe.naturalHeight
        : 1;
      watermarkPlacementMap = {};
      ensureWatermarkPlacement(previewPage || 1);
      initWatermarkPlacementHistory();
    };
    probe.src = watermarkImageUrl;
  }

  function beginWatermarkPointer(event, mode) {
    if (!watermarkStageEl || !watermarkImageUrl) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    event.preventDefault();
    const rect = watermarkStageEl.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const startPlacement = getCurrentWatermarkPlacement();

    watermarkPointerState = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      rectWidth: rect.width,
      rectHeight: rect.height,
      placement: startPlacement
    };
    watermarkPointerId = event.pointerId;

    // Keep pointer events routed during drag even if cursor/finger leaves the overlay.
    event.currentTarget?.setPointerCapture?.(event.pointerId);

    window.addEventListener("pointermove", onWatermarkPointerMove);
    window.addEventListener("pointerup", endWatermarkPointer);
    window.addEventListener("pointercancel", endWatermarkPointer);
  }

  function onWatermarkStagePointerDown(event) {
    if (!watermarkStageEl || !watermarkImageUrl || !previewUrl) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest(".watermark-overlay")) return;

    const rect = watermarkStageEl.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    const current = getCurrentWatermarkPlacement();
    const pointerXNorm = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const pointerYNorm = clamp((event.clientY - rect.top) / rect.height, 0, 1);

    const nextPlacement = {
      ...current,
      x: clamp(pointerXNorm - current.width / 2, 0, 1 - current.width),
      y: clamp(pointerYNorm - current.height / 2, 0, 1 - current.height)
    };
    updateCurrentWatermarkPlacement(nextPlacement);
  }

  function nudgeWatermark(dx, dy) {
    const stepNorm = clamp(Number.parseFloat(watermarkNudgeStep) / 100, 0.001, 0.1);
    const current = getCurrentWatermarkPlacement();
    updateCurrentWatermarkPlacement({
      ...current,
      x: clamp(current.x + (dx * stepNorm), 0, 1 - current.width),
      y: clamp(current.y + (dy * stepNorm), 0, 1 - current.height)
    });
  }

  function resetCurrentWatermarkPlacement() {
    if (!watermarkImageUrl || !previewPage) return;
    const nextMap = { ...watermarkPlacementMap };
    delete nextMap[previewPage];
    watermarkPlacementMap = nextMap;
    ensureWatermarkPlacement(previewPage);
    pushWatermarkPlacementHistory(watermarkPlacementMap);
  }

  function copyPlacementFromPreviousPage() {
    if (!previewPage || previewPage <= 1) return;
    const previous = watermarkPlacementMap[previewPage - 1];
    if (!previous) return;
    updateCurrentWatermarkPlacement(previous);
  }

  function clearTargetPlacements() {
    if (watermarkTargetPages.length < 1) return;
    const nextMap = { ...watermarkPlacementMap };
    for (const pageNum of watermarkTargetPages) {
      delete nextMap[pageNum];
    }
    watermarkPlacementMap = nextMap;
    ensureWatermarkPlacement(previewPage);
    pushWatermarkPlacementHistory(watermarkPlacementMap);
  }

  function onWatermarkPointerMove(event) {
    if (!watermarkPointerState) return;
    if (watermarkPointerId != null && event.pointerId != null && event.pointerId !== watermarkPointerId) return;

    const state = watermarkPointerState;
    const deltaXNorm = (event.clientX - state.startX) / state.rectWidth;
    const deltaYNorm = (event.clientY - state.startY) / state.rectHeight;
    const start = state.placement;

    if (state.mode === "resize") {
      let width = clamp(start.width + deltaXNorm, 0.02, 1 - start.x);
      let height = clamp(start.height + deltaYNorm, 0.02, 1 - start.y);

      if (watermarkLockAspect) {
        const aspect = clamp(watermarkImageAspect, 0.1, 10);
        height = width / aspect;
        if (height > 1 - start.y) {
          height = 1 - start.y;
          width = height * aspect;
        }
        width = clamp(width, 0.02, 1 - start.x);
        height = clamp(height, 0.02, 1 - start.y);
      }

      updateCurrentWatermarkPlacement({ ...start, width, height });
      return;
    }

    const x = clamp(start.x + deltaXNorm, 0, 1 - start.width);
    const y = clamp(start.y + deltaYNorm, 0, 1 - start.height);
    updateCurrentWatermarkPlacement({ ...start, x, y });
  }

  function endWatermarkPointer() {
    watermarkPointerState = null;
    watermarkPointerId = null;
    window.removeEventListener("pointermove", onWatermarkPointerMove);
    window.removeEventListener("pointerup", endWatermarkPointer);
    window.removeEventListener("pointercancel", endWatermarkPointer);
  }

  function copyCurrentPlacementToTargets() {
    if (!watermarkImageUrl || watermarkTargetPages.length < 1) return;
    const current = normalizeWatermarkPlacement(getCurrentWatermarkPlacement());
    const nextMap = { ...watermarkPlacementMap };
    for (const pageNum of watermarkTargetPages) {
      nextMap[pageNum] = { ...current };
    }
    watermarkPlacementMap = nextMap;
    pushWatermarkPlacementHistory(nextMap);
  }

  function jumpPreviewToPage(pageNum) {
    if (!previewTotalPages) return;
    const next = clamp(Number.parseInt(pageNum, 10), 1, previewTotalPages);
    if (next === previewPage) return;
    previewPage = next;
  }

  function jumpToTypedWatermarkPage() {
    jumpPreviewToPage(watermarkJumpPage);
  }

  function applyWatermarkPreset(position) {
    const current = getCurrentWatermarkPlacement();
    const margin = 0.03;
    let x = current.x;
    let y = current.y;

    if (position === "top-left") {
      x = margin;
      y = margin;
    } else if (position === "top-right") {
      x = 1 - current.width - margin;
      y = margin;
    } else if (position === "center") {
      x = (1 - current.width) / 2;
      y = (1 - current.height) / 2;
    } else if (position === "bottom-left") {
      x = margin;
      y = 1 - current.height - margin;
    } else if (position === "bottom-right") {
      x = 1 - current.width - margin;
      y = 1 - current.height - margin;
    }

    updateCurrentWatermarkPlacement({ ...current, x, y });
  }

  function nudgeWatermarkByKeys(event) {
    const key = event.key;
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) return;
    event.preventDefault();

    const current = getCurrentWatermarkPlacement();
    const baseStep = clamp(Number.parseFloat(watermarkNudgeStep) / 100, 0.001, 0.1);
    const step = event.shiftKey ? baseStep * 4 : baseStep;
    let x = current.x;
    let y = current.y;

    if (key === "ArrowLeft") x -= step;
    if (key === "ArrowRight") x += step;
    if (key === "ArrowUp") y -= step;
    if (key === "ArrowDown") y += step;

    updateCurrentWatermarkPlacement({
      ...current,
      x: clamp(x, 0, 1 - current.width),
      y: clamp(y, 0, 1 - current.height)
    });
  }

  function handleWatermarkKeyboardShortcuts(event) {
    const isModifier = event.ctrlKey || event.metaKey;
    const key = event.key;

    if (isModifier && key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) {
        redoWatermarkPlacementChange();
      } else {
        undoWatermarkPlacementChange();
      }
      return;
    }

    if (isModifier && key.toLowerCase() === "y") {
      event.preventDefault();
      redoWatermarkPlacementChange();
      return;
    }

    if (!isModifier) {
      if (key === "1") {
        event.preventDefault();
        applyWatermarkPreset("top-left");
        return;
      }
      if (key === "2") {
        event.preventDefault();
        applyWatermarkPreset("top-right");
        return;
      }
      if (key === "3") {
        event.preventDefault();
        applyWatermarkPreset("center");
        return;
      }
      if (key === "4") {
        event.preventDefault();
        applyWatermarkPreset("bottom-left");
        return;
      }
      if (key === "5") {
        event.preventDefault();
        applyWatermarkPreset("bottom-right");
        return;
      }
    }

    nudgeWatermarkByKeys(event);
  }

  $: {
    try {
      watermarkTargetPages = parseWatermarkSelection(watermarkSelection, previewTotalPages || splitPageCount);
      watermarkSelectionError = "";
    } catch (error) {
      watermarkTargetPages = [];
      watermarkSelectionError = error.message || "Invalid page selection.";
    }
  }

  $: if (watermarkImageUrl && previewTotalPages > 0) {
    ensureWatermarkPlacement(previewPage);
  }

  $: {
    previewUrl;
    watermarkImageUrl;
    watermarkPlacementMap;
    previewPage;
    if (watermarkStageCanvasEl && previewUrl) {
      void paintLiveWatermarkPreview();
    }
  }

  onDestroy(() => {
    if (watermarkImageUrl) {
      URL.revokeObjectURL(watermarkImageUrl);
    }
    endWatermarkPointer();
  });

  async function run(task) {
    if (!files.length || busy) return;
    dispatch("processing", true);
    dispatch("progress", 10);

    try {
      if (task === "merge") {
        const blob = await mergePdfs(mergeQueue, (v) => dispatch("progress", v));
        dispatch("output", [{ name: "merged.pdf", blob }]);
      } else if (task === "split") {
        const chunks = await splitPdf(
          files[0],
          {
            mode: splitMode,
            selection: splitSelection
          },
          (v) => dispatch("progress", v)
        );
        dispatch("output", chunks.map((blob, i) => ({
          name: `${files[0].name.replace(/\.pdf$/i, "")}-part-${i + 1}.pdf`,
          blob
        })));
      } else if (task === "extract-pages") {
        const blob = await extractPdfPages(files[0], pageActionSelection, (v) => dispatch("progress", v));
        dispatch("output", [{
          name: `${files[0].name.replace(/\.pdf$/i, "")}-extracted.pdf`,
          blob
        }]);
      } else if (task === "remove-pages") {
        const blob = await removePdfPages(files[0], pageActionSelection, (v) => dispatch("progress", v));
        dispatch("output", [{
          name: `${files[0].name.replace(/\.pdf$/i, "")}-removed-pages.pdf`,
          blob
        }]);
      } else if (task === "rotate-pages") {
        const blob = await rotatePdfPages(files[0], pageActionSelection, rotateAngle, (v) => dispatch("progress", v));
        dispatch("output", [{
          name: `${files[0].name.replace(/\.pdf$/i, "")}-rotated.pdf`,
          blob
        }]);
      } else if (task === "number-pages") {
        const blob = await addPdfPageNumbers(
          files[0],
          {
            selection: pageNumberSelection,
            startNumber: pageNumberStart,
            position: pageNumberPosition
          },
          (v) => dispatch("progress", v)
        );
        dispatch("output", [{
          name: `${files[0].name.replace(/\.pdf$/i, "")}-numbered.pdf`,
          blob
        }]);
      } else if (task === "watermark-image") {
        if (!watermarkImageFile) {
          throw new Error("Pick a PNG or JPEG image before applying watermark.");
        }
        if (watermarkSelectionError) {
          throw new Error(watermarkSelectionError);
        }

        const blob = await addPdfImageWatermark(
          files[0],
          watermarkImageFile,
          {
            selection: watermarkSelection,
            placementByPage: watermarkPlacementMap,
            defaultPlacement: buildDefaultWatermarkPlacement(),
            defaultOpacity: clamp(Number.parseFloat(watermarkOpacity) / 100, 0, 1),
            defaultRotation: Number.parseFloat(watermarkRotation) || 0
          },
          (v) => dispatch("progress", v)
        );
        dispatch("output", [{
          name: `${files[0].name.replace(/\.pdf$/i, "")}-watermarked.pdf`,
          blob
        }]);
      } else if (task === "reorder-pages") {
        const blob = await reorderPdfPages(files[0], pageOrder, (v) => dispatch("progress", v));
        dispatch("output", [{
          name: `${files[0].name.replace(/\.pdf$/i, "")}-reordered.pdf`,
          blob
        }]);
      } else if (task === "compress") {
        const blob = await compressPdf(files[0], 0.75, (v) => dispatch("progress", v));
        dispatch("output", [{ name: `${files[0].name.replace(/\.pdf$/i, "")}-compressed.pdf`, blob }]);
      } else if (task === "to-images") {
        const outputs = await pdfToImages(files[0], imageFormat, (v) => dispatch("progress", v));
        dispatch("output", outputs);
      } else if (task === "to-djvu") {
        const blob = await pdfToDjvu(files[0], (v) => dispatch("progress", v));
        dispatch("output", [{ name: `${files[0].name.replace(/\.pdf$/i, "")}.djvu`, blob }]);
      }
      dispatch("progress", 100);
    } catch (error) {
      dispatch("error", error.message);
    } finally {
      dispatch("processing", false);
    }
  }
</script>

<section class="panel tool">
  <h3>PDF Command Center</h3>
  <p>Operate on sensitive documents locally with precise controls for structure, security, conversion, and review.</p>

  <div class="tool-meta" aria-label="PDF workspace summary">
    <span class="meta-chip">Files loaded <strong>{files.length}</strong></span>
    <span class="meta-chip">Active pages <strong>{splitPageCount > 0 ? splitPageCount : "-"}</strong></span>
    <span class="meta-chip">Active file <strong>{files[0]?.name ?? "No file selected"}</strong></span>
  </div>

  <div class="actions ops-primary" role="group" aria-label="Primary PDF actions">
    <button type="button" on:click={() => run("split")} disabled={busy || files.length < 1}>Split PDF</button>
    <button type="button" on:click={() => run("merge")} disabled={busy || files.length < 2}>Merge PDFs</button>
    <button type="button" on:click={() => run("compress")} disabled={busy || files.length < 1}>Compress PDF</button>
  </div>

  <section class="preview-wrap">
    <header>
      <h4>PDF Preview</h4>
      <span>{previewTotalPages > 0 ? `Page ${previewPage} of ${previewTotalPages}` : "No preview"}</span>
    </header>
    {#if previewLoading}
      <p class="preview-message">Rendering preview...</p>
    {:else if previewError}
      <p class="preview-error">{previewError}</p>
    {:else if previewUrl}
      <img src={previewUrl} alt={`Preview page ${previewPage}`} />
    {:else}
      <p class="preview-message">Select a PDF to preview pages.</p>
    {/if}
    <div class="preview-actions">
      <button class="secondary" type="button" on:click={() => changePreviewPage(-1)} disabled={busy || previewPage <= 1}>Previous</button>
      <button class="secondary" type="button" on:click={() => changePreviewPage(1)} disabled={busy || previewTotalPages < 1 || previewPage >= previewTotalPages}>Next</button>
    </div>
  </section>

  <details class="compact-section" open>
    <summary>Quick exports</summary>
    <section class="page-actions quick-convert compact-card">
      <header>
        <h4>Quick convert</h4>
        <span>Fast export shortcuts</span>
      </header>
      <label for="pdf-img-format">Image output format</label>
      <select id="pdf-img-format" bind:value={imageFormat}>
        <option value="png">PNG</option>
        <option value="jpeg">JPEG</option>
        <option value="webp">WebP</option>
      </select>
      <div class="actions">
        <button class="secondary" type="button" on:click={() => run("to-images")} disabled={busy || files.length < 1}>PDF to Images</button>
        <button class="secondary" type="button" on:click={() => run("to-djvu")} disabled={busy || files.length < 1}>PDF to DjVu</button>
      </div>
    </section>
  </details>

  <details class="compact-section">
    <summary>Split configuration</summary>
    <section class="page-actions compact-card">
      <label for="pdf-split-mode">Split mode</label>
      <select id="pdf-split-mode" bind:value={splitMode}>
        <option value="per-page">One output per page (default)</option>
        <option value="custom">Custom page groups</option>
      </select>

      {#if splitMode === "custom"}
        <label for="pdf-split-selection">Page groups</label>
        <input
          id="pdf-split-selection"
          type="text"
          bind:value={splitSelection}
          placeholder="Example: 1-2,3,4-5"
          disabled={busy}
        />
        <div class="split-meta">
          <small>
            Use comma-separated pages or ranges. Example: 1-2,3,4-5 creates 3 output PDFs.
            {#if splitPageCount > 0}
              This file has {splitPageCount} pages.
            {/if}
          </small>
          <button class="secondary" type="button" on:click={useAllPagesSelection} disabled={busy || splitPageCount < 1}>
            Use all pages
          </button>
        </div>
        {#if splitPreview}
          <small class="split-preview">{splitPreview}</small>
        {/if}
        {#if splitPreviewError}
          <small class="split-error">{splitPreviewError}</small>
        {/if}
      {/if}
    </section>
  </details>

  <details class="advanced-tools">
    <summary>
      <span class="material-symbols-outlined" aria-hidden="true">tune</span>
      Advanced operations
    </summary>

  <details class="advanced-subsection">
    <summary>Merge Queue</summary>
    <section class="merge-wrap">
      <header>
        <h4>Merge order</h4>
        <span>{mergeQueue.length} PDF(s)</span>
      </header>
      <ul>
        {#each mergeQueue as file, index (file.id)}
          <li
            draggable={!busy}
            on:dragstart={() => (draggingMergeId = file.id)}
            on:dragend={() => (draggingMergeId = "")}
            on:dragover|preventDefault
            on:drop|preventDefault={() => reorderMergeQueue(file.id)}
          >
            <button class="drag-handle" type="button" aria-label={`Reorder ${file.name}`} disabled={busy}>drag_indicator</button>
            <div>
              <strong>{index + 1}. {file.name}</strong>
              <small>{formatBytes(file.size)}</small>
            </div>
          </li>
        {/each}
      </ul>
    </section>
  </details>

  <details class="advanced-subsection">
    <summary>Page Order</summary>
    <section class="page-actions">
      <header>
        <h4>Page organization</h4>
        <span>Drag pages to reorder, then apply</span>
      </header>
      <div class="order-quick-actions">
        <button class="secondary" type="button" on:click={resetPageOrder} disabled={busy || splitPageCount < 1}>Reset</button>
        <button class="secondary" type="button" on:click={reversePageOrder} disabled={busy || splitPageCount < 2}>Reverse</button>
        <button class="secondary" type="button" on:click={sortPageOrderAsc} disabled={busy || splitPageCount < 2}>Sort Asc</button>
        <button class="secondary" type="button" on:click={sortPageOrderDesc} disabled={busy || splitPageCount < 2}>Sort Desc</button>
      </div>
      <ul class="page-order-list">
        {#each pageOrder as pageNum (pageNum)}
          <li
            draggable={!busy}
            on:dragstart={() => (draggingPageOrder = pageNum)}
            on:dragend={() => (draggingPageOrder = null)}
            on:dragover|preventDefault
            on:drop|preventDefault={() => reorderPageOrder(pageNum)}
          >
            <div class="page-thumb-wrap">
              {#if pageThumbnails[pageNum]}
                <img class="page-thumb" src={pageThumbnails[pageNum]} alt={`Thumbnail for page ${pageNum}`} />
              {:else}
                <div class="page-thumb-placeholder"><span class="material-symbols-outlined">article</span></div>
              {/if}
            </div>
            <div class="page-thumb-label">
              <button class="drag-handle" type="button" aria-label={`Reorder page ${pageNum}`} disabled={busy}>drag_indicator</button>
              <span>Page {pageNum}</span>
            </div>
          </li>
        {/each}
      </ul>
      <div class="actions">
        <button class="secondary" type="button" on:click={() => run("reorder-pages")} disabled={busy || splitPageCount < 2}>Apply Page Order</button>
      </div>
    </section>
  </details>

  <details class="advanced-subsection">
    <summary>Page Actions</summary>
    <section class="page-actions">
      <header>
        <h4>Page actions</h4>
        <span>Use ranges like 1-2,4,7-9</span>
      </header>
      <label for="pdf-page-action-selection">Page selection</label>
      <input
        id="pdf-page-action-selection"
        type="text"
        bind:value={pageActionSelection}
        placeholder="Example: 1-2,4,7-9"
        disabled={busy}
      />
      <label for="pdf-rotate-angle">Rotate angle</label>
      <select id="pdf-rotate-angle" bind:value={rotateAngle}>
        <option value="90">90° clockwise</option>
        <option value="180">180°</option>
        <option value="270">270° clockwise</option>
      </select>
      <div class="actions">
        <button class="secondary" on:click={() => run("extract-pages")} disabled={busy || files.length < 1}>Extract Pages</button>
        <button class="secondary" on:click={() => run("remove-pages")} disabled={busy || files.length < 1}>Remove Pages</button>
        <button class="secondary" on:click={() => run("rotate-pages")} disabled={busy || files.length < 1}>Rotate Pages</button>
      </div>
      <small>For rotate: leave selection empty to rotate all pages.</small>
    </section>
  </details>

  <details class="advanced-subsection">
    <summary>Page Numbering</summary>
    <section class="page-actions">
      <header>
        <h4>Page numbering</h4>
        <span>Add page numbers to selected pages</span>
      </header>
      <label for="pdf-number-selection">Page selection (optional)</label>
      <input
        id="pdf-number-selection"
        type="text"
        bind:value={pageNumberSelection}
        placeholder="Empty = all pages"
        disabled={busy}
      />
      <div class="number-grid">
        <div>
          <label for="pdf-number-start">Start number</label>
          <input
            id="pdf-number-start"
            type="number"
            min="1"
            step="1"
            bind:value={pageNumberStart}
            disabled={busy}
          />
        </div>
        <div>
          <label for="pdf-number-position">Position</label>
          <select id="pdf-number-position" bind:value={pageNumberPosition}>
            <option value="bottom-center">Bottom center</option>
            <option value="bottom-left">Bottom left</option>
            <option value="bottom-right">Bottom right</option>
            <option value="top-left">Top left</option>
            <option value="top-right">Top right</option>
            <option value="middle-center">Middle center</option>
          </select>
        </div>
      </div>
      <div class="actions">
        <button class="secondary" on:click={() => run("number-pages")} disabled={busy || files.length < 1}>Add Page Numbers</button>
      </div>
    </section>
  </details>

  <details class="advanced-subsection">
    <summary>Watermark Studio</summary>
    <section class="page-actions watermark-section">
    <header>
      <h4>Image watermark</h4>
      <span>Drag and set exact position per page</span>
    </header>

    <label for="pdf-watermark-image">Watermark image (PNG/JPEG)</label>
    <input
      id="pdf-watermark-image"
      type="file"
      accept="image/png,image/jpeg,.png,.jpg,.jpeg"
      on:change={onWatermarkImagePicked}
      disabled={busy || files.length < 1}
    />

    {#if watermarkImageUrl}
      <label for="pdf-watermark-selection">Page selection (optional)</label>
      <input
        id="pdf-watermark-selection"
        type="text"
        bind:value={watermarkSelection}
        placeholder="Empty = all pages"
        disabled={busy}
      />
      {#if watermarkSelectionError}
        <small class="split-error">{watermarkSelectionError}</small>
      {:else}
        <small>Target pages: {watermarkTargetPages.length || previewTotalPages} page(s)</small>
      {/if}

      {#if watermarkTargetPages.length > 0}
        <div class="watermark-page-jump" aria-label="Jump to target page">
          {#each watermarkTargetPages.slice(0, 24) as pageNum (pageNum)}
            <button
              class="secondary"
              type="button"
              class:is-active={pageNum === previewPage}
              class:has-placement={!!watermarkPlacementMap[pageNum]}
              on:click={() => jumpPreviewToPage(pageNum)}
            >
              {pageNum}
            </button>
          {/each}
          {#if watermarkTargetPages.length > 24}
            <span class="muted">+{watermarkTargetPages.length - 24} more</span>
          {/if}
          <div class="watermark-page-jump-input-wrap">
            <input
              type="number"
              min="1"
              max={previewTotalPages}
              bind:value={watermarkJumpPage}
              placeholder="Page"
              on:keydown={(event) => event.key === "Enter" && jumpToTypedWatermarkPage()}
            />
            <button class="secondary" type="button" on:click={jumpToTypedWatermarkPage}>Go</button>
          </div>
          <small class="watermark-help">Tip: use page chips for quick hops, or type a page number for direct jump.</small>
        </div>
      {/if}

      <div
        class="watermark-stage"
        bind:this={watermarkStageEl}
        role="group"
        aria-label="Watermark placement stage"
        on:pointerdown={onWatermarkStagePointerDown}
      >
        {#if previewUrl}
          <canvas class="watermark-stage-canvas" bind:this={watermarkStageCanvasEl} aria-label={`Live preview page ${previewPage}`}></canvas>
          <div
            class="watermark-overlay"
            role="group"
            aria-label="Watermark placement overlay"
            style={`left:${getCurrentWatermarkPlacement().x * 100}%;top:${getCurrentWatermarkPlacement().y * 100}%;width:${getCurrentWatermarkPlacement().width * 100}%;height:${getCurrentWatermarkPlacement().height * 100}%;opacity:${getCurrentWatermarkPlacement().opacity};transform:rotate(${getCurrentWatermarkPlacement().rotation}deg);`}
            on:pointerdown|stopPropagation={(event) => beginWatermarkPointer(event, "move")}
            on:pointermove={onWatermarkPointerMove}
            on:pointerup={endWatermarkPointer}
            on:pointercancel={endWatermarkPointer}
          >
            <button
              type="button"
              class="watermark-resize"
              aria-label="Resize watermark"
              on:pointerdown|stopPropagation={(event) => beginWatermarkPointer(event, "resize")}
              on:pointermove={onWatermarkPointerMove}
              on:pointerup={endWatermarkPointer}
              on:pointercancel={endWatermarkPointer}
            >
              open_with
            </button>
          </div>
        {:else}
          <p class="preview-message">Load a PDF page preview to place the watermark.</p>
        {/if}
      </div>
      {#if livePreviewError}
        <small class="split-error">{livePreviewError}</small>
      {:else}
        <small class="watermark-help">Live preview repaints immediately as you move, resize, rotate, or adjust opacity.</small>
      {/if}
      <small class="watermark-help">Position: X {Math.round(getCurrentWatermarkPlacement().x * 1000) / 10}% · Y {Math.round(getCurrentWatermarkPlacement().y * 1000) / 10}%</small>

      <div class="watermark-utility-actions" role="group" aria-label="Watermark utility actions">
        <button class="secondary" type="button" on:click={resetCurrentWatermarkPlacement}>Reset Current Page Placement</button>
        <button class="secondary" type="button" on:click={copyPlacementFromPreviousPage} disabled={previewPage <= 1}>Copy From Previous Page</button>
        <button class="secondary" type="button" on:click={clearTargetPlacements} disabled={watermarkTargetPages.length < 1}>Clear Target Placements</button>
      </div>

      <div class="watermark-history-actions" role="group" aria-label="Watermark placement history">
        <button class="secondary" type="button" on:click={undoWatermarkPlacementChange} disabled={watermarkPlacementHistoryIndex <= 0}>Undo</button>
        <button class="secondary" type="button" on:click={redoWatermarkPlacementChange} disabled={watermarkPlacementHistoryIndex < 0 || watermarkPlacementHistoryIndex >= watermarkPlacementHistory.length - 1}>Redo</button>
      </div>

      <div class="watermark-nudge-wrap" role="group" aria-label="Nudge watermark position">
        <div class="watermark-nudge-pad" role="group" aria-label="Directional nudge pad">
          <button class="secondary nudge-up" type="button" on:click={() => nudgeWatermark(0, -1)} aria-label="Nudge up">Up</button>
          <button class="secondary nudge-left" type="button" on:click={() => nudgeWatermark(-1, 0)} aria-label="Nudge left">Left</button>
          <button class="secondary nudge-right" type="button" on:click={() => nudgeWatermark(1, 0)} aria-label="Nudge right">Right</button>
          <button class="secondary nudge-down" type="button" on:click={() => nudgeWatermark(0, 1)} aria-label="Nudge down">Down</button>
        </div>
        <div class="watermark-nudge-step">
          <label for="wm-nudge-step">Step (%)</label>
          <select id="wm-nudge-step" bind:value={watermarkNudgeStep}>
            <option value="0.25">0.25</option>
            <option value="0.5">0.5</option>
            <option value="1">1</option>
            <option value="2">2</option>
          </select>
        </div>
      </div>

      <div class="watermark-grid">
        <div>
          <label for="wm-x">X (%)</label>
          <input id="wm-x" type="number" min="0" max="100" step="0.1" value={Math.round(getCurrentWatermarkPlacement().x * 1000) / 10} on:input={(event) => setCurrentPlacementPercent("x", event.currentTarget.value)} />
        </div>
        <div>
          <label for="wm-y">Y (%)</label>
          <input id="wm-y" type="number" min="0" max="100" step="0.1" value={Math.round(getCurrentWatermarkPlacement().y * 1000) / 10} on:input={(event) => setCurrentPlacementPercent("y", event.currentTarget.value)} />
        </div>
        <div>
          <label for="wm-width">Width (%)</label>
          <input id="wm-width" type="number" min="2" max="100" step="0.1" value={Math.round(getCurrentWatermarkPlacement().width * 1000) / 10} on:input={(event) => setCurrentPlacementPercent("width", event.currentTarget.value)} />
        </div>
        <div>
          <label for="wm-height">Height (%)</label>
          <input id="wm-height" type="number" min="2" max="100" step="0.1" value={Math.round(getCurrentWatermarkPlacement().height * 1000) / 10} on:input={(event) => setCurrentPlacementPercent("height", event.currentTarget.value)} />
        </div>
        <div>
          <label for="wm-opacity">Opacity (%)</label>
          <input id="wm-opacity" type="number" min="0" max="100" step="1" value={Math.round(getCurrentWatermarkPlacement().opacity * 100)} on:input={(event) => setCurrentOpacity(event.currentTarget.value)} />
          <input type="range" min="0" max="100" step="1" value={Math.round(getCurrentWatermarkPlacement().opacity * 100)} on:input={(event) => setCurrentOpacity(event.currentTarget.value)} />
        </div>
        <div>
          <label for="wm-rotation">Rotation (deg)</label>
          <input id="wm-rotation" type="number" min="-360" max="360" step="1" value={getCurrentWatermarkPlacement().rotation} on:input={(event) => setCurrentRotation(event.currentTarget.value)} />
        </div>
      </div>

      <div class="watermark-presets" role="group" aria-label="Watermark snap positions">
        <button class="secondary" type="button" on:click={() => applyWatermarkPreset("top-left")}>Top Left</button>
        <button class="secondary" type="button" on:click={() => applyWatermarkPreset("top-right")}>Top Right</button>
        <button class="secondary" type="button" on:click={() => applyWatermarkPreset("center")}>Center</button>
        <button class="secondary" type="button" on:click={() => applyWatermarkPreset("bottom-left")}>Bottom Left</button>
        <button class="secondary" type="button" on:click={() => applyWatermarkPreset("bottom-right")}>Bottom Right</button>
      </div>

      <label class="watermark-lock-toggle">
        <input type="checkbox" bind:checked={watermarkLockAspect} />
        <span>Lock aspect ratio while resizing</span>
      </label>
      <small class="watermark-help">When enabled, resize keeps original image proportions in drag and numeric size edits.</small>

      <label class="watermark-lock-toggle">
        <input type="checkbox" bind:checked={watermarkSyncToTargets} />
        <span>Sync live edits to selected target pages</span>
      </label>
      <small class="watermark-help">When enabled, move/resize/opacity/rotation updates on current page are mirrored to all selected target pages.</small>

      <button
        class="secondary watermark-nudge-control"
        type="button"
        on:keydown={handleWatermarkKeyboardShortcuts}
        title="Arrows nudge, Shift+Arrow larger step, Ctrl/Cmd+Z undo, Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z redo, 1-5 preset snap"
      >
        Keyboard Shortcuts: focus here, then use Arrows, Ctrl/Cmd+Z, Ctrl/Cmd+Y, or keys 1-5
      </button>

      <div class="actions">
        <button class="secondary" type="button" on:click={copyCurrentPlacementToTargets} disabled={busy || watermarkTargetPages.length < 1}>Copy Current Placement to Target Pages</button>
        <button class="secondary" type="button" on:click={() => run("watermark-image")} disabled={busy || files.length < 1 || !watermarkImageFile || !!watermarkSelectionError}>Apply Image Watermark</button>
      </div>
    {/if}
    </section>
  </details>

  <details class="advanced-subsection">
    <summary>Security</summary>

  <!-- PDF Unlock section -->
  <section class="page-actions unlock-section">
    <header>
      <h4>Unlock PDF</h4>
      <span>Remove passwords and restrictions</span>
    </header>
    <p class="unlock-desc">Removes owner restrictions (print, copy, edit locks) without a password. For user-password protected PDFs, enter the password below.</p>

    {#if unlockNeedsPassword || unlockPassword}
      <label for="pdf-unlock-password">Password</label>
      <input
        id="pdf-unlock-password"
        type="password"
        bind:value={unlockPassword}
        placeholder="Enter PDF password"
        disabled={unlocking}
        on:keydown={(e) => e.key === "Enter" && runUnlock()}
      />
    {/if}

    {#if unlockError}
      <p class="unlock-msg unlock-msg--error">{unlockError}</p>
    {/if}
    {#if unlockSuccess}
      <p class="unlock-msg unlock-msg--success">{unlockSuccess}</p>
    {/if}

    <div class="actions">
      <button on:click={runUnlock} disabled={busy || unlocking || files.length < 1}>
        {unlocking ? "Unlocking..." : "Unlock PDF"}
      </button>
    </div>
  </section>

  <!-- PDF Lock section -->
  <section class="page-actions lock-section">
    <header>
      <h4>Lock PDF</h4>
      <span>Protect with an opening password</span>
    </header>
    <p class="unlock-desc">Creates an encrypted PDF that requires a password to open.</p>

    <div class="lock-grid">
      <div>
        <label for="pdf-lock-password">Password</label>
        <input
          id="pdf-lock-password"
          type="password"
          bind:value={lockPassword}
          placeholder="Enter new PDF password"
          disabled={locking}
        />
      </div>
      <div>
        <label for="pdf-lock-password-confirm">Confirm password</label>
        <input
          id="pdf-lock-password-confirm"
          type="password"
          bind:value={lockPasswordConfirm}
          placeholder="Re-enter password"
          disabled={locking}
          on:keydown={(e) => e.key === "Enter" && runLock()}
        />
      </div>
    </div>

    {#if lockError}
      <p class="unlock-msg unlock-msg--error">{lockError}</p>
    {/if}
    {#if lockSuccess}
      <p class="unlock-msg unlock-msg--success">{lockSuccess}</p>
    {/if}

    <div class="actions">
      <button on:click={runLock} disabled={busy || locking || files.length < 1}>
        {locking ? "Locking..." : "Lock PDF"}
      </button>
    </div>
  </section>
  </details>
  </details>
</section>

<style>
  .tool {
    padding: 1.2rem;
    display: grid;
    gap: 0.9rem;
  }

  h3 {
    margin: 0;
    letter-spacing: 0.01em;
    font-size: clamp(1.08rem, 1.5vw, 1.35rem);
  }

  .tool > p {
    margin: 0;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.92rem;
    line-height: 1.45;
  }

  .tool-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .meta-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 999px;
    padding: 0.28rem 0.62rem;
    font-size: 0.76rem;
    color: var(--md-sys-color-on-surface-variant);
    background: color-mix(in srgb, var(--md-sys-color-surface) 82%, var(--md-sys-color-primary) 18%);
  }

  .meta-chip strong {
    color: var(--md-sys-color-on-surface);
    font-weight: 700;
    max-width: 20rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ops-primary {
    padding: 0.25rem;
    border: 1px solid color-mix(in srgb, var(--md-sys-color-primary) 20%, var(--md-sys-color-outline-variant));
    border-radius: var(--app-radius-sm, 12px);
    background: color-mix(in srgb, var(--md-sys-color-primary) 8%, var(--md-sys-color-surface));
  }

  .compact-section {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: var(--app-radius-sm, 12px);
    background: var(--md-sys-color-surface-container-low);
    padding: 0.45rem 0.55rem;
  }

  .compact-section + .compact-section {
    margin-top: -0.25rem;
  }

  .compact-section > summary {
    list-style: none;
    cursor: pointer;
    font-size: 0.77rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--md-sys-color-on-surface-variant);
    padding: 0.1rem 0;
  }

  .compact-section > summary::-webkit-details-marker {
    display: none;
  }

  .compact-section > :global(section) {
    margin-top: 0.45rem;
  }

  .compact-card {
    margin: 0;
    box-shadow: none;
  }

  .advanced-tools {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: var(--app-radius-md, 18px);
    background: color-mix(in srgb, var(--md-sys-color-surface) 90%, var(--md-sys-color-primary) 10%);
    padding: 0.6rem;
  }

  .advanced-tools > summary {
    list-style: none;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--md-sys-color-on-surface-variant);
    padding: 0.2rem 0.1rem;
  }

  .advanced-tools > summary::-webkit-details-marker {
    display: none;
  }

  .advanced-tools > summary .material-symbols-outlined {
    font-size: 0.95rem;
  }

  .advanced-tools[open] > summary {
    margin-bottom: 0.45rem;
  }

  .advanced-subsection {
    border: 1px solid color-mix(in srgb, var(--md-sys-color-outline) 55%, transparent);
    border-radius: var(--app-radius-sm, 12px);
    background: color-mix(in srgb, var(--md-sys-color-surface) 95%, var(--md-sys-color-primary) 5%);
    padding: 0.5rem;
    margin-bottom: 0.55rem;
  }

  .advanced-subsection > summary {
    list-style: none;
    cursor: pointer;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--md-sys-color-on-surface-variant);
    padding: 0.15rem 0.1rem;
  }

  .advanced-subsection > summary::-webkit-details-marker {
    display: none;
  }

  .advanced-subsection > :global(section),
  .advanced-subsection > :global(div) {
    margin-top: 0.45rem;
  }

  label {
    display: block;
    margin-bottom: 0.3rem;
    font-size: 0.79rem;
    color: var(--md-sys-color-on-surface-variant);
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  select {
    width: 100%;
    margin-bottom: 0.9rem;
    border-radius: var(--app-radius-sm, 12px);
    border: 1px solid var(--md-sys-color-outline);
    padding: 0.45rem 0.55rem;
    background: var(--md-sys-color-surface);
  }

  input {
    width: 100%;
    margin-bottom: 0.35rem;
    border-radius: var(--app-radius-sm, 12px);
    border: 1px solid var(--md-sys-color-outline);
    padding: 0.45rem 0.55rem;
    background: var(--md-sys-color-surface);
    box-sizing: border-box;
  }

  small {
    display: block;
    margin: 0 0 0.9rem;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.8rem;
  }

  .split-meta {
    display: flex;
    gap: 0.7rem;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.2rem;
  }

  .split-meta small {
    margin: 0;
  }

  .split-meta button {
    flex-shrink: 0;
  }

  .split-preview {
    color: var(--md-sys-color-primary);
  }

  .split-error {
    color: var(--md-sys-color-error);
  }

  .merge-wrap {
    margin: 0.4rem 0 1rem;
  }

  .preview-wrap {
    margin: 0.2rem 0 0.9rem;
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: var(--app-radius-md, 18px);
    padding: 0.78rem;
    background: var(--md-sys-color-surface-container-low);
    box-shadow: var(--elevation-1);
  }

  .preview-wrap header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.6rem;
    margin-bottom: 0.55rem;
    flex-wrap: wrap;
  }

  .preview-wrap h4 {
    margin: 0;
    font-size: 0.92rem;
    font-weight: 500;
  }

  .preview-wrap span {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.78rem;
  }

  .preview-wrap img {
    width: 100%;
    max-height: 420px;
    object-fit: contain;
    display: block;
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: var(--app-radius-sm, 12px);
    background: var(--md-sys-color-surface);
  }

  .preview-actions {
    margin-top: 0.5rem;
    display: flex;
    gap: 0.5rem;
  }

  .preview-message,
  .preview-error {
    margin: 0;
    color: var(--md-sys-color-on-surface-variant);
  }

  .preview-error {
    color: var(--md-sys-color-error);
  }

  .page-actions {
    margin: 0.25rem 0 1rem;
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: var(--app-radius-md, 18px);
    padding: 0.82rem;
    background: var(--md-sys-color-surface-container-low);
    box-shadow: var(--elevation-1);
  }

  .quick-convert {
    margin-bottom: 0;
  }

  .page-actions header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.6rem;
    margin-bottom: 0.5rem;
    flex-wrap: wrap;
  }

  .page-actions h4 {
    margin: 0;
    font-size: 0.92rem;
    font-weight: 500;
  }

  .page-actions span {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.75rem;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  .page-actions small {
    margin: 0.2rem 0 0;
  }

  .order-quick-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.6rem;
  }

  .page-order-list {
    list-style: none;
    margin: 0 0 0.6rem;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 0.5rem;
  }

  .page-order-list li {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: var(--app-radius-sm, 12px);
    padding: 0;
    background: var(--md-sys-color-surface);
    display: flex;
    flex-direction: column;
    align-items: stretch;
    overflow: hidden;
    cursor: grab;
    transition: box-shadow 0.15s;
  }

  .page-order-list li:active {
    cursor: grabbing;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
  }

  .page-thumb-wrap {
    width: 100%;
    aspect-ratio: 3 / 4;
    overflow: hidden;
    background: var(--md-sys-color-surface-container);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .page-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .page-thumb-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--md-sys-color-outline);
    font-size: 2rem;
  }

  .page-thumb-label {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.3rem 0.4rem;
    border-top: 1px solid var(--md-sys-color-outline-variant);
  }

  .page-order-list span {
    font-size: 0.78rem;
    color: var(--md-sys-color-on-surface-variant);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .number-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 0.6rem;
  }

  .number-grid > div {
    min-width: 0;
  }

  .watermark-stage {
    position: relative;
    width: 100%;
    margin-bottom: 0.75rem;
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: var(--app-radius-sm, 12px);
    overflow: hidden;
    background: var(--md-sys-color-surface);
    touch-action: manipulation;
    cursor: crosshair;
  }

  .watermark-stage-canvas {
    display: block;
    width: 100%;
    height: auto;
    user-select: none;
    pointer-events: none;
  }

  .watermark-overlay {
    position: absolute;
    border: 2px solid var(--md-sys-color-primary);
    background: color-mix(in srgb, var(--md-sys-color-primary) 6%, transparent);
    cursor: move;
    touch-action: none;
    transform-origin: center center;
    display: flex;
    align-items: stretch;
    justify-content: stretch;
    min-width: 12px;
    min-height: 12px;
    box-sizing: border-box;
  }

  .watermark-resize {
    position: absolute;
    right: -10px;
    bottom: -10px;
    width: 22px;
    height: 22px;
    min-width: 22px;
    border-radius: 999px;
    padding: 0;
    font-size: 16px;
    line-height: 1;
    font-family: "Material Symbols Outlined", "Segoe UI Symbol", sans-serif;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: nwse-resize;
  }

  .watermark-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.55rem;
    margin-bottom: 0.65rem;
  }

  .watermark-grid > div {
    min-width: 0;
  }

  .watermark-page-jump {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-bottom: 0.65rem;
    align-items: center;
  }

  .watermark-page-jump button {
    min-width: 2.2rem;
    padding: 0.25rem 0.45rem;
    font-size: 0.78rem;
  }

  .watermark-page-jump button.is-active {
    background: var(--md-sys-color-secondary-container);
    color: var(--md-sys-color-on-secondary-container);
    border-color: var(--md-sys-color-secondary);
  }

  .watermark-page-jump button.has-placement {
    box-shadow: inset 0 0 0 1px var(--md-sys-color-primary);
  }

  .watermark-page-jump-input-wrap {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .watermark-page-jump-input-wrap input {
    width: 5.4rem;
    margin: 0;
  }

  .watermark-help {
    flex-basis: 100%;
    margin: 0;
    font-size: 0.75rem;
  }

  .watermark-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    margin-bottom: 0.65rem;
  }

  .watermark-nudge-control {
    margin-bottom: 0.65rem;
  }

  .watermark-nudge-wrap {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    margin-bottom: 0.65rem;
    align-items: end;
  }

  .watermark-nudge-pad {
    display: grid;
    grid-template-columns: repeat(3, minmax(2.4rem, auto));
    grid-template-rows: repeat(3, minmax(2.1rem, auto));
    gap: 0.25rem;
    align-items: stretch;
  }

  .watermark-nudge-pad .nudge-up {
    grid-column: 2;
    grid-row: 1;
  }

  .watermark-nudge-pad .nudge-left {
    grid-column: 1;
    grid-row: 2;
  }

  .watermark-nudge-pad .nudge-right {
    grid-column: 3;
    grid-row: 2;
  }

  .watermark-nudge-pad .nudge-down {
    grid-column: 2;
    grid-row: 3;
  }

  .watermark-history-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    margin-bottom: 0.65rem;
  }

  .watermark-nudge-step {
    display: inline-flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 6rem;
  }

  .watermark-nudge-step label {
    margin: 0;
    font-size: 0.75rem;
  }

  .watermark-nudge-step select {
    margin: 0;
  }

  .watermark-utility-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    margin-bottom: 0.65rem;
  }

  .watermark-lock-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    margin-bottom: 0.65rem;
    font-size: 0.82rem;
  }

  .merge-wrap header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .merge-wrap h4 {
    margin: 0;
    font-size: 0.92rem;
    font-weight: 500;
  }

  .merge-wrap span {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.78rem;
  }

  .merge-wrap ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.45rem;
  }

  .merge-wrap li {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: var(--app-radius-sm, 12px);
    padding: 0.45rem 0.55rem;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 0.5rem;
    background: var(--md-sys-color-surface-container-low);
  }

  .drag-handle {
    border: none;
    background: transparent;
    color: var(--md-sys-color-on-surface-variant);
    width: 30px;
    height: 30px;
    min-width: 30px;
    border-radius: 999px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: "Material Symbols Outlined", "Segoe UI Symbol", sans-serif;
    font-size: 20px;
    line-height: 1;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: clip;
  }

  .merge-wrap strong,
  .merge-wrap small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .merge-wrap small {
    color: var(--md-sys-color-on-surface-variant);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }

  .actions button {
    min-width: 0;
  }

  @media (max-width: 740px) {
    .split-meta {
      flex-direction: column;
      align-items: flex-start;
    }

    .split-meta button {
      width: 100%;
    }

    .merge-wrap li {
      grid-template-columns: auto minmax(0, 1fr);
      align-items: start;
    }

    .actions button {
      flex: 1;
      min-width: 10rem;
    }

    .number-grid,
    .lock-grid,
    .watermark-grid {
      grid-template-columns: 1fr;
    }
  }

  /* Unlock section */
  .unlock-section,
  .lock-section {
    margin-top: 0.5rem;
  }

  .lock-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 0.6rem;
    margin-bottom: 0.2rem;
  }

  .lock-grid > div {
    min-width: 0;
  }

  .unlock-desc {
    margin: 0 0 0.8rem;
    font-size: 0.82rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .unlock-msg {
    margin: 0 0 0.6rem;
    font-size: 0.82rem;
    padding: 0.5rem 0.75rem;
    border-radius: var(--app-radius-sm, 12px);
  }

  .unlock-msg--error {
    color: var(--md-sys-color-error);
    background: color-mix(in srgb, var(--md-sys-color-error) 10%, var(--md-sys-color-surface));
    border: 1px solid color-mix(in srgb, var(--md-sys-color-error) 30%, var(--md-sys-color-outline-variant));
  }

  .unlock-msg--success {
    color: var(--app-state-success, #1a6b2f);
    background: color-mix(in srgb, var(--app-state-success, #1a6b2f) 12%, var(--md-sys-color-surface));
    border: 1px solid color-mix(in srgb, var(--app-state-success, #1a6b2f) 34%, var(--md-sys-color-outline-variant));
  }
</style>
