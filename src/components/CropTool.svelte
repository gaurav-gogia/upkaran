<script>
  import { createEventDispatcher } from "svelte";
  import { drawImageToCanvas } from "../js/image-tools.js";

  export let files = [];
  export let busy = false;

  const dispatch = createEventDispatcher();

  let stage;
  let preview;
  let sourceCanvas = null;
  let zoom = 1;
  let ready = false;
  let loadError = "";
  let loadedFileKey = "";
  let loadRequestId = 0;

  let rect = { x: 0, y: 0, width: 100, height: 100 };
  let dragMode = "";
  let dragStart = null;
  const minSize = 24;
  const maxPreviewEdge = 320;
  let aspectPreset = "free";

  const handles = [
    "nw", "n", "ne",
    "w", "move", "e",
    "sw", "s", "se"
  ];

  $: if (files.length > 0) {
    const next = files[0];
    const nextKey = `${next.id}|${next.name}|${next.size}`;
    if (nextKey !== loadedFileKey) {
      loadedFileKey = nextKey;
      void loadPrimary(next);
    }
  } else {
    loadRequestId += 1;
    sourceCanvas = null;
    ready = false;
    loadError = "";
    loadedFileKey = "";
  }

  $: if (sourceCanvas && stage && zoom) {
    drawStage();
  }

  $: if (sourceCanvas && preview) {
    drawPreview();
  }

  async function loadPrimary(fileEntry) {
    const requestId = ++loadRequestId;
    loadError = "";
    ready = false;
    try {
      const nextCanvas = await drawImageToCanvas(fileEntry);
      if (requestId !== loadRequestId) return;

      sourceCanvas = nextCanvas;
      rect = defaultRect(sourceCanvas);
      ready = true;
      drawStage();
      drawPreview();
    } catch (error) {
      if (requestId !== loadRequestId) return;
      sourceCanvas = null;
      loadError = error.message || "Unable to load image for crop preview.";
    }
  }

  function clampRect(next) {
    const maxW = sourceCanvas.width;
    const maxH = sourceCanvas.height;
    const x = Math.max(0, Math.min(next.x, maxW - minSize));
    const y = Math.max(0, Math.min(next.y, maxH - minSize));
    const width = Math.max(minSize, Math.min(next.width, maxW - x));
    const height = Math.max(minSize, Math.min(next.height, maxH - y));
    return { x, y, width, height };
  }

  function defaultRect(canvas) {
    return {
      x: Math.round(canvas.width * 0.12),
      y: Math.round(canvas.height * 0.12),
      width: Math.round(canvas.width * 0.76),
      height: Math.round(canvas.height * 0.76)
    };
  }

  function drawStage() {
    if (!stage || !sourceCanvas) return;

    stage.width = Math.max(1, Math.round(sourceCanvas.width * zoom));
    stage.height = Math.max(1, Math.round(sourceCanvas.height * zoom));

    const ctx = stage.getContext("2d");
    ctx.clearRect(0, 0, stage.width, stage.height);
    ctx.drawImage(sourceCanvas, 0, 0, stage.width, stage.height);

    const sx = rect.x * zoom;
    const sy = rect.y * zoom;
    const sw = rect.width * zoom;
    const sh = rect.height * zoom;

    ctx.save();
    ctx.fillStyle = "rgba(28, 27, 31, 0.28)";
    ctx.fillRect(0, 0, stage.width, stage.height);

    // Repaint the selected region so the crop window reveals the image,
    // not the panel background behind a transparent canvas hole.
    ctx.drawImage(
      sourceCanvas,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      sx,
      sy,
      sw,
      sh
    );

    ctx.strokeStyle = "#006a6a";
    ctx.lineWidth = 2;
    ctx.strokeRect(sx, sy, sw, sh);

    for (const handle of handles) {
      if (handle === "move") continue;
      const p = handlePoint(handle);
      ctx.fillStyle = "#006a6a";
      ctx.fillRect(p.x * zoom - 4, p.y * zoom - 4, 8, 8);
    }
    ctx.restore();
  }

  function drawPreview() {
    if (!preview || !sourceCanvas) return;

    const scale = Math.min(1, maxPreviewEdge / Math.max(rect.width, rect.height));
    preview.width = Math.max(1, Math.round(rect.width * scale));
    preview.height = Math.max(1, Math.round(rect.height * scale));

    const ctx = preview.getContext("2d");
    ctx.clearRect(0, 0, preview.width, preview.height);
    ctx.drawImage(
      sourceCanvas,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      preview.width,
      preview.height
    );
  }

  function toImageCoords(event) {
    const bounds = stage.getBoundingClientRect();
    const scaleX = bounds.width > 0 ? stage.width / bounds.width : 1;
    const scaleY = bounds.height > 0 ? stage.height / bounds.height : 1;
    return {
      x: ((event.clientX - bounds.left) * scaleX) / zoom,
      y: ((event.clientY - bounds.top) * scaleY) / zoom
    };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
  }

  function aspectRatioFromPreset(preset) {
    const map = {
      "1:1": 1,
      "4:3": 4 / 3,
      "3:4": 3 / 4,
      "16:9": 16 / 9,
      "9:16": 9 / 16
    };
    return map[preset] || null;
  }

  function enforceAspectRatio(next, base, mode, ratio, maxW, maxH) {
    if (!ratio || mode === "move") return next;

    const bothAxes = mode.includes("w") || mode.includes("e");
    const bothHeights = mode.includes("n") || mode.includes("s");

    let width = next.width;
    let height = next.height;

    if (bothAxes && bothHeights) {
      const widthDelta = Math.abs(next.width - base.width);
      const heightDelta = Math.abs(next.height - base.height);
      if (widthDelta >= heightDelta) {
        height = Math.max(minSize, Math.round(width / ratio));
      } else {
        width = Math.max(minSize, Math.round(height * ratio));
      }
    } else if (bothAxes) {
      height = Math.max(minSize, Math.round(width / ratio));
    } else {
      width = Math.max(minSize, Math.round(height * ratio));
    }

    width = Math.min(width, maxW);
    height = Math.min(height, maxH);

    const out = { ...next, width, height };

    if (mode.includes("w")) out.x = base.x + base.width - width;
    else if (!mode.includes("e")) out.x = base.x + (base.width - width) / 2;

    if (mode.includes("n")) out.y = base.y + base.height - height;
    else if (!mode.includes("s")) out.y = base.y + (base.height - height) / 2;

    return out;
  }

  function handlePoint(handle) {
    const x1 = rect.x;
    const x2 = rect.x + rect.width / 2;
    const x3 = rect.x + rect.width;
    const y1 = rect.y;
    const y2 = rect.y + rect.height / 2;
    const y3 = rect.y + rect.height;
    const map = {
      nw: { x: x1, y: y1 },
      n: { x: x2, y: y1 },
      ne: { x: x3, y: y1 },
      w: { x: x1, y: y2 },
      e: { x: x3, y: y2 },
      sw: { x: x1, y: y3 },
      s: { x: x2, y: y3 },
      se: { x: x3, y: y3 }
    };
    return map[handle];
  }

  function findHandle(point) {
    const tolerance = Math.max(4, 8 / zoom);
    const left = rect.x;
    const right = rect.x + rect.width;
    const top = rect.y;
    const bottom = rect.y + rect.height;

    const nearLeft = Math.abs(point.x - left) <= tolerance;
    const nearRight = Math.abs(point.x - right) <= tolerance;
    const nearTop = Math.abs(point.y - top) <= tolerance;
    const nearBottom = Math.abs(point.y - bottom) <= tolerance;

    const withinX = point.x >= left - tolerance && point.x <= right + tolerance;
    const withinY = point.y >= top - tolerance && point.y <= bottom + tolerance;

    if (nearLeft && nearTop) return "nw";
    if (nearRight && nearTop) return "ne";
    if (nearLeft && nearBottom) return "sw";
    if (nearRight && nearBottom) return "se";
    if (nearTop && withinX) return "n";
    if (nearBottom && withinX) return "s";
    if (nearLeft && withinY) return "w";
    if (nearRight && withinY) return "e";

    const inBox = point.x > left && point.x < right && point.y > top && point.y < bottom;
    return inBox ? "move" : "";
  }

  function cursorForHandle(handle) {
    if (handle === "nw" || handle === "se") return "nwse-resize";
    if (handle === "ne" || handle === "sw") return "nesw-resize";
    if (handle === "n" || handle === "s") return "ns-resize";
    if (handle === "w" || handle === "e") return "ew-resize";
    if (handle === "move") return "move";
    return "default";
  }

  function applyCursor(handle) {
    if (!stage) return;
    stage.style.cursor = cursorForHandle(handle);
  }

  function updateHoverCursor(event) {
    if (!sourceCanvas || !stage) {
      applyCursor("");
      return;
    }
    const point = toImageCoords(event);
    applyCursor(findHandle(point));
  }

  function onPointerDown(event) {
    if (!sourceCanvas || busy) return;
    const point = toImageCoords(event);
    dragMode = findHandle(point);
    if (!dragMode) return;
    applyCursor(dragMode);
    dragStart = { point, rect: { ...rect } };
    stage.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    const point = toImageCoords(event);

    if (!dragMode || !dragStart || !sourceCanvas) {
      applyCursor(findHandle(point));
      return;
    }

    const dx = point.x - dragStart.point.x;
    const dy = point.y - dragStart.point.y;
    const base = dragStart.rect;
    const maxW = sourceCanvas.width;
    const maxH = sourceCanvas.height;
    const right = base.x + base.width;
    const bottom = base.y + base.height;
    const ratio = aspectRatioFromPreset(aspectPreset);

    let next = { ...base };

    if (dragMode === "move") {
      next.x = clamp(base.x + dx, 0, maxW - base.width);
      next.y = clamp(base.y + dy, 0, maxH - base.height);
    } else {
      if (dragMode.includes("w")) {
        next.x = clamp(base.x + dx, 0, right - minSize);
        next.width = right - next.x;
      }

      if (dragMode.includes("e")) {
        next.width = clamp(base.width + dx, minSize, maxW - base.x);
      }

      if (dragMode.includes("n")) {
        next.y = clamp(base.y + dy, 0, bottom - minSize);
        next.height = bottom - next.y;
      }

      if (dragMode.includes("s")) {
        next.height = clamp(base.height + dy, minSize, maxH - base.y);
      }
    }

    next = enforceAspectRatio(next, base, dragMode, ratio, maxW, maxH);

    rect = clampRect(next);
    drawStage();
    drawPreview();
  }

  function onPointerUp(event) {
    if (stage && stage.hasPointerCapture(event.pointerId)) {
      stage.releasePointerCapture(event.pointerId);
    }
    const point = toImageCoords(event);
    applyCursor(findHandle(point));
    dragMode = "";
    dragStart = null;
  }

  function resetCrop() {
    if (!sourceCanvas) return;
    rect = defaultRect(sourceCanvas);
    drawStage();
    drawPreview();
  }

  function updateZoom(delta) {
    zoom = clamp(Math.round((zoom + delta) * 10) / 10, 0.5, 3);
    drawStage();
  }

  function onWheel(event) {
    if (busy || !sourceCanvas) return;
    const delta = event.deltaY > 0 ? -0.1 : 0.1;
    updateZoom(delta);
  }

  // ── Pinch-to-zoom ────────────────────────────────────────────────────────────
  const activePointers = new Map(); // pointerId -> { x, y }
  let pinchStartDist = 0;
  let pinchStartZoom = 1;

  function pointerDist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function onPointerDownPinch(event) {
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointers.size === 2) {
      const [a, b] = activePointers.values();
      pinchStartDist = pointerDist(a, b);
      pinchStartZoom = zoom;
      // Cancel any drag in progress when second finger lands
      dragMode = "";
      dragStart = null;
    }
  }

  function onPointerMovePinch(event) {
    if (!activePointers.has(event.pointerId)) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointers.size === 2) {
      const [a, b] = activePointers.values();
      const dist = pointerDist(a, b);
      if (pinchStartDist > 0) {
        const scale = dist / pinchStartDist;
        zoom = clamp(Math.round(pinchStartZoom * scale * 10) / 10, 0.5, 3);
        drawStage();
      }
    }
  }

  function onPointerUpPinch(event) {
    activePointers.delete(event.pointerId);
    if (activePointers.size < 2) {
      pinchStartDist = 0;
    }
  }

  function onKeydown(event) {
    if (!sourceCanvas || busy) return;

    const step = event.shiftKey ? 10 : 1;
    let next = { ...rect };

    if (event.key === "ArrowLeft") next.x -= step;
    else if (event.key === "ArrowRight") next.x += step;
    else if (event.key === "ArrowUp") next.y -= step;
    else if (event.key === "ArrowDown") next.y += step;
    else return;

    event.preventDefault();
    rect = clampRect(next);
    drawStage();
    drawPreview();
  }

  function applyCrop() {
    if (!sourceCanvas) return;
    dispatch("apply", {
      normalizedRect: {
        x: rect.x / sourceCanvas.width,
        y: rect.y / sourceCanvas.height,
        width: rect.width / sourceCanvas.width,
        height: rect.height / sourceCanvas.height
      }
    });
  }

  let collapsed = false;
</script>

<section class="crop-tool panel">
  <button
    class="crop-header"
    type="button"
    aria-expanded={!collapsed}
    on:click={() => (collapsed = !collapsed)}
  >
    <h4>Precision Crop Workspace</h4>
    <span class="file-count">{files.length} selected image(s)</span>
    <span class="chevron" class:rotated={collapsed} aria-hidden="true">&#8964;</span>
  </button>

  {#if !collapsed}
  {#if loadError}
    <p class="error-text">{loadError}</p>
  {:else if !ready}
    <p class="hint">Select image files to enable crop.</p>
  {:else}
    <div class="crop-meta" aria-label="Crop workspace summary">
      <span class="meta-chip">Zoom <strong>{zoom.toFixed(1)}x</strong></span>
      <span class="meta-chip">Aspect <strong>{aspectPreset === "free" ? "Free" : aspectPreset}</strong></span>
      <span class="meta-chip">Crop area <strong>{Math.round(rect.width)} x {Math.round(rect.height)} px</strong></span>
    </div>

    <div class="controls">
      <label for="crop-zoom">Zoom</label>
      <input id="crop-zoom" type="range" min="0.5" max="3" step="0.1" bind:value={zoom} disabled={busy} />
      <span>{zoom.toFixed(1)}x</span>
    </div>

    <div class="controls">
      <label for="crop-aspect">Aspect</label>
      <select id="crop-aspect" bind:value={aspectPreset} disabled={busy}>
        <option value="free">Free</option>
        <option value="1:1">1:1</option>
        <option value="4:3">4:3</option>
        <option value="3:4">3:4</option>
        <option value="16:9">16:9</option>
        <option value="9:16">9:16</option>
      </select>
      <span>{aspectPreset === "free" ? "Unlocked" : "Locked"}</span>
    </div>

    <div class="controls-row">
      <small>Crop: {Math.round(rect.width)} x {Math.round(rect.height)} px</small>
      <button class="secondary" type="button" on:click={resetCrop} disabled={busy}>Reset Crop</button>
    </div>

    <div class="workspace-row">
      <div class="stage-wrap">
        <canvas
          bind:this={stage}
          tabindex={busy ? -1 : 0}
          on:pointerdown={(e) => { onPointerDownPinch(e); onPointerDown(e); }}
          on:pointermove={(e) => { onPointerMovePinch(e); if (activePointers.size < 2) onPointerMove(e); }}
          on:pointerup={(e) => { onPointerUpPinch(e); onPointerUp(e); }}
          on:pointercancel={(e) => { onPointerUpPinch(e); onPointerUp(e); }}
          on:pointerenter={updateHoverCursor}
          on:pointerleave={() => applyCursor("")}
          on:wheel|preventDefault={onWheel}
          on:mousemove={updateHoverCursor}
          on:keydown={onKeydown}
        ></canvas>
      </div>

      <div class="preview-wrap">
        <h5>Live preview</h5>
        <canvas bind:this={preview}></canvas>
      </div>
    </div>

    <button class="apply-btn" type="button" on:click={applyCrop} disabled={busy || files.length < 1}>Apply Crop to {files.length} Image(s)</button>
  {/if}
  {/if}
</section>

<style>
  .crop-tool {
    margin-top: 0.9rem;
    padding: 1rem;
    border-radius: var(--app-radius-md, 18px);
    box-shadow: var(--elevation-1);
  }

  .crop-header {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    width: 100%;
    background: color-mix(in srgb, var(--md-sys-color-primary) 7%, var(--md-sys-color-surface));
    border: 1px solid color-mix(in srgb, var(--md-sys-color-primary) 18%, var(--md-sys-color-outline-variant));
    border-radius: var(--app-radius-sm, 12px);
    padding: 0.6rem 0.7rem;
    margin: 0 0 0.8rem;
    cursor: pointer;
    text-align: left;
    flex-wrap: wrap;
    box-shadow: var(--elevation-1);
  }

  .crop-header:hover {
    background: color-mix(in srgb, var(--md-sys-color-primary) 12%, var(--md-sys-color-surface));
    box-shadow: var(--elevation-2, var(--elevation-1));
  }

  .crop-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    margin-bottom: 0.7rem;
  }

  .meta-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 999px;
    padding: 0.25rem 0.56rem;
    font-size: 0.74rem;
    color: var(--md-sys-color-on-surface-variant);
    background: color-mix(in srgb, var(--md-sys-color-surface) 86%, var(--md-sys-color-primary) 14%);
  }

  .meta-chip strong {
    color: var(--md-sys-color-on-surface);
    font-weight: 700;
  }

  .file-count {
    color: var(--md-sys-color-on-surface-variant);
    flex: 1;
    font-size: 0.9rem;
  }

  .chevron {
    font-size: 1.1rem;
    line-height: 1;
    display: inline-block;
    transition: transform 0.2s;
    color: var(--md-sys-color-on-surface-variant);
  }

  .chevron.rotated {
    transform: rotate(-90deg);
  }

  .controls {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.7rem;
    margin-bottom: 0.8rem;
  }

  h4,
  h5 {
    margin: 0;
    font-weight: 500;
  }

  .hint {
    color: var(--md-sys-color-on-surface-variant);
    margin: 0;
  }
  .controls span {
    font-size: 0.85rem;
  }

  .controls select {
    width: 100%;
    border-radius: var(--app-radius-sm, 12px);
    border: 1px solid var(--md-sys-color-outline);
    padding: 0.42rem 0.55rem;
    background: var(--md-sys-color-surface);
  }

  .controls span {
    min-width: 2.6rem;
    text-align: right;
  }

  .controls-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.7rem;
    flex-wrap: wrap;
  }

  .controls-row small {
    color: var(--md-sys-color-on-surface-variant);
  }

  .workspace-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(220px, 300px);
    align-items: start;
    gap: 0.9rem;
    margin-bottom: 0.9rem;
  }

  .stage-wrap {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: var(--app-radius-sm, 12px);
    overflow: auto;
    max-height: 420px;
    background: var(--md-sys-color-surface);
  }

  canvas {
    display: block;
    max-width: 100%;
    touch-action: none;
    outline: none;
  }

  canvas:focus-visible {
    box-shadow: inset 0 0 0 2px var(--md-sys-color-primary);
  }

  .preview-wrap {
    align-self: start;
    position: sticky;
    top: 0.6rem;
  }

  .preview-wrap canvas {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: var(--app-radius-sm, 12px);
    max-width: 100%;
    width: 100%;
    background: var(--md-sys-color-surface);
  }

  .apply-btn {
    width: 100%;
    font-weight: 600;
  }

  .error-text {
    margin: 0;
    color: var(--md-sys-color-error);
  }

  @media (max-width: 740px) {
    .controls {
      grid-template-columns: 1fr;
      gap: 0.35rem;
    }

    .workspace-row {
      grid-template-columns: 1fr;
    }

    .preview-wrap {
      position: static;
      top: auto;
    }

    .controls span {
      text-align: left;
    }

    .stage-wrap {
      max-height: 340px;
    }
  }
</style>
