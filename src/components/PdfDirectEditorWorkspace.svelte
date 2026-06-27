<script>
  import { createEventDispatcher, onMount, tick } from "svelte";
  import {
    addPdfAnnotations,
    extractPdfTextBlocks,
    renderPdfPreviewPage
  } from "../js/pdf-tools.js";

  const dispatch = createEventDispatcher();

  export let fileEntry = null;

  let loading = false;
  let saving = false;
  let error = "";
  let status = "";
  let totalPages = 0;
  let currentPage = 1;
  let previewUrl = "";
  let previewLoading = false;
  let blocksByPage = {};
  let stageEl = null;
  let activeBlockId = "";
  let selectedIds = [];
  let dragState = null;
  let snapEnabled = true;
  let snapStep = "1";
  let directFileHandle = null;
  let keyboardBound = false;
  let inspectorActiveBlock = null;
  let inlineEditBlockId = "";
  let inlineEditText = "";
  let inlineEditOriginalText = "";
  let zoom = 1.25;
  let inlineEditorEl = null;
  let historyPast = [];
  let historyFuture = [];
  let suppressHistory = false;

  const HISTORY_LIMIT = 120;

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
  }

  function pageKey(pageNum) {
    return String(pageNum || 1);
  }

  function getPageBlocks(pageNum = currentPage) {
    return blocksByPage[pageKey(pageNum)] || [];
  }

  function getActiveBlock() {
    if (!activeBlockId) return null;
    return getPageBlocks().find((item) => item.id === activeBlockId) || null;
  }

  function getSelectedIds() {
    return selectedIds.length > 0 ? [...selectedIds] : (activeBlockId ? [activeBlockId] : []);
  }

  function snapNorm(value) {
    const clamped = clamp(value, 0, 1);
    if (!snapEnabled) return clamped;
    const step = clamp((Number.parseFloat(snapStep) || 1) / 100, 0.001, 0.2);
    return clamp(Math.round(clamped / step) * step, 0, 1);
  }

  function updateBlocks(mutator) {
    const before = blocksByPage;
    const draft = { ...blocksByPage };
    const key = pageKey(currentPage);
    const pageBlocks = (draft[key] || []).map((item) => ({ ...item }));
    mutator(pageBlocks);
    draft[key] = pageBlocks;
    if (!suppressHistory && before !== draft) {
      historyPast = [...historyPast, snapshotBlocks(before)].slice(-HISTORY_LIMIT);
      historyFuture = [];
    }
    blocksByPage = draft;
  }

  function snapshotBlocks(source) {
    return JSON.parse(JSON.stringify(source || {}));
  }

  function canUndo() {
    return historyPast.length > 0;
  }

  function canRedo() {
    return historyFuture.length > 0;
  }

  function undoChange() {
    if (!canUndo()) return;
    const prev = historyPast[historyPast.length - 1];
    historyPast = historyPast.slice(0, -1);
    historyFuture = [...historyFuture, snapshotBlocks(blocksByPage)].slice(-HISTORY_LIMIT);
    suppressHistory = true;
    blocksByPage = snapshotBlocks(prev);
    suppressHistory = false;
    inlineEditBlockId = "";
    inlineEditText = "";
  }

  function redoChange() {
    if (!canRedo()) return;
    const next = historyFuture[historyFuture.length - 1];
    historyFuture = historyFuture.slice(0, -1);
    historyPast = [...historyPast, snapshotBlocks(blocksByPage)].slice(-HISTORY_LIMIT);
    suppressHistory = true;
    blocksByPage = snapshotBlocks(next);
    suppressHistory = false;
    inlineEditBlockId = "";
    inlineEditText = "";
  }

  function updateBlock(blockId, patch) {
    updateBlocks((pageBlocks) => {
      const idx = pageBlocks.findIndex((item) => item.id === blockId);
      if (idx < 0) return;
      pageBlocks[idx] = { ...pageBlocks[idx], ...patch };
    });
  }

  function updateSelected(patchResolver) {
    const ids = new Set(getSelectedIds());
    if (ids.size < 1) return;
    updateBlocks((pageBlocks) => {
      for (let i = 0; i < pageBlocks.length; i += 1) {
        const item = pageBlocks[i];
        if (!ids.has(item.id)) continue;
        pageBlocks[i] = { ...item, ...patchResolver(item) };
      }
    });
  }

  function selectBlock(event, blockId) {
    if (event?.shiftKey) {
      const exists = selectedIds.includes(blockId);
      selectedIds = exists ? selectedIds.filter((id) => id !== blockId) : [...selectedIds, blockId];
    } else {
      selectedIds = [blockId];
    }
    activeBlockId = blockId;
  }

  function beginDrag(event, blockId) {
    if (!stageEl) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (inlineEditBlockId) return;
    if (!selectedIds.includes(blockId) && activeBlockId !== blockId) return;

    const pageBlocks = getPageBlocks();
    const block = pageBlocks.find((item) => item.id === blockId);
    if (!block) return;

    const rect = stageEl.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    if (event.shiftKey) {
      const exists = selectedIds.includes(blockId);
      selectedIds = exists ? selectedIds.filter((id) => id !== blockId) : [...selectedIds, blockId];
    } else if (!selectedIds.includes(blockId)) {
      selectedIds = [blockId];
    }

    activeBlockId = blockId;
    const ids = getSelectedIds();
    const baseMap = Object.fromEntries(pageBlocks.filter((item) => ids.includes(item.id)).map((item) => [item.id, { x: item.x, y: item.y }]));

    dragState = {
      ids,
      baseMap,
      startX: event.clientX,
      startY: event.clientY,
      width: rect.width,
      height: rect.height,
      didMove: false
    };

    event.currentTarget?.setPointerCapture?.(event.pointerId);
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
  }

  function onDragMove(event) {
    if (!dragState) return;
    const dx = (event.clientX - dragState.startX) / dragState.width;
    const dy = (event.clientY - dragState.startY) / dragState.height;
    const movedPx = Math.abs(event.clientX - dragState.startX) + Math.abs(event.clientY - dragState.startY);
    if (movedPx < 3 && !dragState.didMove) return;
    dragState.didMove = true;
    updateSelected((item) => {
      const base = dragState.baseMap[item.id] || { x: item.x, y: item.y };
      return {
        x: snapNorm(base.x + dx),
        y: snapNorm(base.y + dy)
      };
    });
  }

  function endDrag() {
    dragState = null;
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
  }

  function bindKeyboard() {
    if (keyboardBound) return;
    window.addEventListener("keydown", onKeydown);
    keyboardBound = true;
  }

  function unbindKeyboard() {
    if (!keyboardBound) return;
    window.removeEventListener("keydown", onKeydown);
    keyboardBound = false;
  }

  function onKeydown(event) {
    const target = event.target;
    if (target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;

    if (event.key === "Enter" && activeBlockId && !inlineEditBlockId) {
      event.preventDefault();
      startInlineEdit(activeBlockId);
      return;
    }

    if (event.key === "Escape" && inlineEditBlockId) {
      event.preventDefault();
      cancelInlineEdit();
      return;
    }

    const step = clamp((Number.parseFloat(snapStep) || 1) / 100, 0.001, 0.2) * (event.shiftKey ? 5 : 1);
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      updateSelected((item) => ({ x: snapNorm(item.x - step) }));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      updateSelected((item) => ({ x: snapNorm(item.x + step) }));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      updateSelected((item) => ({ y: snapNorm(item.y - step) }));
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      updateSelected((item) => ({ y: snapNorm(item.y + step) }));
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      removeSelected();
    }
  }

  function removeSelected() {
    const ids = new Set(getSelectedIds());
    if (ids.size < 1) return;
    updateBlocks((pageBlocks) => {
      for (let i = pageBlocks.length - 1; i >= 0; i -= 1) {
        if (ids.has(pageBlocks[i].id)) pageBlocks.splice(i, 1);
      }
    });
    selectedIds = [];
    activeBlockId = "";
    inlineEditBlockId = "";
    inlineEditText = "";
    inlineEditOriginalText = "";
  }

  function startInlineEdit(blockId) {
    const target = getPageBlocks().find((item) => item.id === blockId);
    if (!target) return;
    activeBlockId = blockId;
    if (!selectedIds.includes(blockId)) {
      selectedIds = [blockId];
    }
    inlineEditBlockId = blockId;
    inlineEditText = `${target.text || ""}`;
    inlineEditOriginalText = `${target.text || ""}`;
    tick().then(() => {
      inlineEditorEl?.focus();
      inlineEditorEl?.select();
    });
  }

  function onInlineEditInput(value) {
    if (!inlineEditBlockId) return;
    inlineEditText = `${value || ""}`;
    updateBlock(inlineEditBlockId, { text: inlineEditText });
  }

  function commitInlineEdit() {
    if (!inlineEditBlockId) return;
    const id = inlineEditBlockId;
    updateBlock(id, { text: `${inlineEditText || ""}` });
    inlineEditBlockId = "";
    inlineEditText = "";
    inlineEditOriginalText = "";
  }

  function cancelInlineEdit() {
    if (inlineEditBlockId) {
      updateBlock(inlineEditBlockId, { text: `${inlineEditOriginalText || ""}` });
    }
    inlineEditBlockId = "";
    inlineEditText = "";
    inlineEditOriginalText = "";
  }

  async function loadPreview(pageNum = currentPage) {
    if (!fileEntry) return;
    previewLoading = true;
    try {
      const result = await renderPdfPreviewPage(fileEntry, { page: pageNum, scale: 1.35 });
      previewUrl = result.dataUrl;
    } catch (e) {
      error = e?.message || "Could not render PDF preview.";
    } finally {
      previewLoading = false;
    }
  }

  async function extractNow() {
    if (!fileEntry || loading) return;
    loading = true;
    error = "";
    status = "Extracting editable text layer...";
    try {
      const result = await extractPdfTextBlocks(fileEntry, { maxPerPage: 420 });
      totalPages = result.totalPages;
      blocksByPage = result.blocksByPage || {};
      historyPast = [];
      historyFuture = [];
      currentPage = 1;
      activeBlockId = "";
      selectedIds = [];
      status = `Extracted ${totalPages} page${totalPages === 1 ? "" : "s"}. You can now edit directly on the PDF canvas.`;
      await loadPreview(1);
      bindKeyboard();
    } catch (e) {
      error = e?.message || "Text extraction failed.";
    } finally {
      loading = false;
    }
  }

  async function enableDirectSave() {
    if (typeof window === "undefined" || typeof window.showSaveFilePicker !== "function") {
      error = "Direct file save is not supported in this browser. Use Save to create output files.";
      return;
    }

    const suggested = `${(fileEntry?.name || "document").replace(/\.pdf$/i, "")}-edited.pdf`;
    directFileHandle = await window.showSaveFilePicker({
      suggestedName: suggested,
      types: [{ description: "PDF documents", accept: { "application/pdf": [".pdf"] } }]
    });
    status = "Direct save enabled.";
    error = "";
  }

  async function saveNow() {
    if (!fileEntry || saving) return;
    saving = true;
    error = "";
    status = "Saving edited PDF...";

    try {
      const annotationsByPage = {};
      for (const [pageNum, blocks] of Object.entries(blocksByPage)) {
        const texts = (blocks || [])
          .map((block) => ({
            text: `${block.text || ""}`.trim(),
            x: clamp(Number.parseFloat(block.x), 0, 1),
            y: clamp(Number.parseFloat(block.y), 0, 1),
            size: clamp(Number.parseFloat(block.size), 8, 72),
            colorHex: block.colorHex || "#111827",
            opacity: clamp(Number.parseFloat(block.opacity ?? 1), 0, 1)
          }))
          .filter((item) => !!item.text);
        if (texts.length > 0) {
          annotationsByPage[pageNum] = { texts };
        }
      }

      const blob = await addPdfAnnotations(fileEntry, { selection: "", annotationsByPage });
      const fileName = `${fileEntry.name.replace(/\.pdf$/i, "")}-edited.pdf`;

      if (directFileHandle) {
        const stream = await directFileHandle.createWritable();
        await stream.write(blob);
        await stream.close();
        status = "Saved directly to selected file.";
      } else {
        const file = new File([blob], fileName, { type: "application/pdf" });
        dispatch("filesreceived", [file]);
        status = "Saved. Updated file was added to your workspace.";
      }
    } catch (e) {
      error = e?.message || "Save failed.";
    } finally {
      saving = false;
    }
  }

  function gotoPage(pageNum) {
    const next = Math.max(1, Math.min(totalPages || 1, Number.parseInt(pageNum, 10) || 1));
    if (next === currentPage) return;
    currentPage = next;
    activeBlockId = "";
    selectedIds = [];
    inlineEditBlockId = "";
    inlineEditText = "";
    inlineEditOriginalText = "";
    void loadPreview(next);
  }

  function updateActiveField(field, raw) {
    const active = getActiveBlock();
    if (!active) return;
    if (field === "text") {
      updateBlock(active.id, { text: `${raw || ""}` });
      return;
    }
    if (field === "colorHex") {
      updateBlock(active.id, { colorHex: `${raw || "#111827"}` });
      return;
    }

    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return;
    if (field === "x" || field === "y") {
      updateBlock(active.id, { [field]: snapNorm(parsed / 100) });
    } else if (field === "size") {
      updateBlock(active.id, { size: clamp(parsed, 8, 72) });
    } else if (field === "opacity") {
      updateBlock(active.id, { opacity: clamp(parsed / 100, 0, 1) });
    }
  }

  function closeEditor() {
    endDrag();
    unbindKeyboard();
    dispatch("close");
  }

  function blockStyle(block, { editing = false } = {}) {
    const isVisible = editing || block.id === activeBlockId || selectedIds.includes(block.id);
    return `left:${block.x * 100}%;top:${block.y * 100}%;font-size:${block.size}px;opacity:${block.opacity};color:${isVisible ? block.colorHex : "transparent"};`;
  }

  onMount(() => {
    void extractNow();
    return () => {
      endDrag();
      unbindKeyboard();
    };
  });

  $: inspectorActiveBlock = getActiveBlock();
</script>

<section class="pdf-direct-editor" aria-label="Direct PDF editor workspace">
  <header class="editor-topbar">
    <div class="editor-title-wrap">
      <h2>Direct PDF Editor</h2>
      <p>{fileEntry?.name || "No file"}</p>
    </div>
    <div class="editor-actions">
      <div class="editor-zoom" role="group" aria-label="Canvas zoom">
        <button class="secondary" type="button" on:click={() => (zoom = clamp(zoom - 0.1, 0.75, 2.25))}>-</button>
        <input id="pdf-editor-zoom" type="range" min="0.75" max="2.25" step="0.05" bind:value={zoom} />
        <span>{Math.round(zoom * 100)}%</span>
        <button class="secondary" type="button" on:click={() => (zoom = clamp(zoom + 0.1, 0.75, 2.25))}>+</button>
      </div>
      <button class="secondary" type="button" on:click={undoChange} disabled={!canUndo() || loading || saving}>Undo</button>
      <button class="secondary" type="button" on:click={redoChange} disabled={!canRedo() || loading || saving}>Redo</button>
      <button class="secondary" type="button" on:click={extractNow} disabled={loading || saving}>
        {loading ? "Extracting..." : "Re-extract text"}
      </button>
      <button class="secondary" type="button" on:click={enableDirectSave} disabled={loading || saving}>
        Enable Direct Save
      </button>
      <button type="button" on:click={saveNow} disabled={loading || saving}>
        {saving ? "Saving..." : "Save"}
      </button>
      <button class="secondary" type="button" on:click={closeEditor}>Close</button>
    </div>
  </header>

  <div class="editor-body">
    <aside class="page-rail" aria-label="Page navigator">
      <h3>Pages</h3>
      {#if totalPages > 0}
        <ul>
          {#each Array.from({ length: totalPages }, (_, i) => i + 1) as pageNum (pageNum)}
            <li>
              <button class="secondary" class:is-active={pageNum === currentPage} type="button" on:click={() => gotoPage(pageNum)}>
                Page {pageNum}
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted">No pages loaded</p>
      {/if}
    </aside>

    <section class="canvas-stage-wrap" aria-label="Editable PDF page">
      {#if previewLoading}
        <p class="muted">Rendering page...</p>
      {:else if previewUrl}
        <div class="canvas-scale" style={`--editor-zoom:${zoom};`}>
          <div class="canvas-stage" bind:this={stageEl}>
            <img src={previewUrl} alt={`Editable preview page ${currentPage}`} />
            <div class="text-overlay">
              {#each getPageBlocks() as block (block.id)}
                {#if inlineEditBlockId === block.id}
                  <textarea
                    class="text-block text-block-editor"
                    style={blockStyle(block, { editing: true })}
                    bind:value={inlineEditText}
                    bind:this={inlineEditorEl}
                    rows="3"
                    on:blur={commitInlineEdit}
                    on:input={(event) => onInlineEditInput(event.currentTarget.value)}
                    on:keydown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        commitInlineEdit();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelInlineEdit();
                      }
                    }}
                  ></textarea>
                {:else}
                  <button
                    type="button"
                    class="text-block"
                    class:is-active={block.id === activeBlockId}
                    class:is-selected={selectedIds.includes(block.id)}
                    style={blockStyle(block)}
                    on:pointerdown={(event) => beginDrag(event, block.id)}
                    on:click={(event) => selectBlock(event, block.id)}
                    on:dblclick={() => startInlineEdit(block.id)}
                    title={block.text}
                  >
                    {block.text}
                  </button>
                {/if}
              {/each}
            </div>
          </div>
        </div>
      {:else}
        <p class="muted">Extract text to begin editing.</p>
      {/if}
    </section>

    <aside class="inspector" aria-label="Selected text block inspector">
      <h3>Inspector</h3>
      <label class="checkline">
        <input type="checkbox" bind:checked={snapEnabled} />
        <span>Snap to grid</span>
      </label>
      <label for="grid-step">Grid step (%)</label>
      <input id="grid-step" type="number" min="0.1" max="10" step="0.1" bind:value={snapStep} disabled={!snapEnabled} />

      <small>Selected: {getSelectedIds().length} block(s)</small>
      <small>Text stays hidden until selected · Double click to edit · Shift+Click multi-select · Arrow keys nudge</small>

      {#if inspectorActiveBlock}
        <label for="block-text">Text</label>
        <input id="block-text" type="text" value={inspectorActiveBlock.text} on:input={(event) => updateActiveField("text", event.currentTarget.value)} />

        <label for="block-x">X (%)</label>
        <input id="block-x" type="number" min="0" max="100" step="0.1" value={Math.round(inspectorActiveBlock.x * 1000) / 10} on:input={(event) => updateActiveField("x", event.currentTarget.value)} />

        <label for="block-y">Y (%)</label>
        <input id="block-y" type="number" min="0" max="100" step="0.1" value={Math.round(inspectorActiveBlock.y * 1000) / 10} on:input={(event) => updateActiveField("y", event.currentTarget.value)} />

        <label for="block-size">Size</label>
        <input id="block-size" type="number" min="8" max="72" step="1" value={inspectorActiveBlock.size} on:input={(event) => updateActiveField("size", event.currentTarget.value)} />

        <label for="block-opacity">Opacity (%)</label>
        <input id="block-opacity" type="number" min="0" max="100" step="1" value={Math.round(inspectorActiveBlock.opacity * 100)} on:input={(event) => updateActiveField("opacity", event.currentTarget.value)} />

        <label for="block-color">Color</label>
        <input id="block-color" type="color" value={inspectorActiveBlock.colorHex} on:input={(event) => updateActiveField("colorHex", event.currentTarget.value)} />

        <div class="inspector-actions">
          <button class="secondary" type="button" on:click={removeSelected}>Delete selection</button>
        </div>
      {:else}
        <p class="muted">Select a text block on the page.</p>
      {/if}
    </aside>
  </div>

  <footer class="editor-footer" aria-live="polite">
    {#if error}
      <p class="error">{error}</p>
    {:else if status}
      <p>{status}</p>
    {:else}
      <p>Load a PDF to start direct editing.</p>
    {/if}
  </footer>
</section>

<style>
  .pdf-direct-editor {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: radial-gradient(circle at top left, #f4f8ff 0%, #eef2f7 42%, #e5ebf3 100%);
    color: #111827;
    display: grid;
    grid-template-rows: auto 1fr auto;
  }

  .editor-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.9rem;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #d3dce8;
    background: linear-gradient(110deg, #ffffff 0%, #edf2fb 100%);
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.04);
  }

  .editor-title-wrap h2 {
    margin: 0;
    font-size: 1.02rem;
    letter-spacing: 0.01em;
  }

  .editor-title-wrap p {
    margin: 0.12rem 0 0;
    color: #4b5563;
    font-size: 0.8rem;
  }

  .editor-actions {
    display: flex;
    gap: 0.45rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .editor-zoom {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-width: 220px;
    margin-right: 0.15rem;
  }

  .editor-zoom input {
    width: 110px;
  }

  .editor-zoom span {
    font-size: 0.74rem;
    color: #475569;
    min-width: 3.2rem;
    text-align: center;
    font-weight: 600;
  }

  .editor-body {
    min-height: 0;
    display: grid;
    grid-template-columns: 190px minmax(0, 1fr) 280px;
    gap: 0.75rem;
    padding: 0.75rem;
  }

  .page-rail,
  .inspector {
    border: 1px solid #d3dce8;
    border-radius: 12px;
    background: #ffffff;
    padding: 0.65rem;
    overflow: auto;
  }

  .page-rail h3,
  .inspector h3 {
    margin: 0 0 0.5rem;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #64748b;
  }

  .page-rail ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.35rem;
  }

  .page-rail button {
    width: 100%;
    justify-content: flex-start;
  }

  .page-rail button.is-active {
    background: #dbeafe;
    color: #1e40af;
    border-color: #93c5fd;
  }

  .canvas-stage-wrap {
    border: 1px solid #d3dce8;
    border-radius: 12px;
    background: linear-gradient(180deg, #f8fbff 0%, #eef3fa 100%);
    padding: 0.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
    align-content: start;
  }

  .canvas-scale {
    transform: scale(var(--editor-zoom));
    transform-origin: top center;
  }

  .canvas-stage {
    position: relative;
    width: min(100%, 980px);
  }

  .canvas-stage img {
    width: 100%;
    display: block;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    box-shadow: 0 18px 45px rgba(15, 23, 42, 0.12);
    user-select: none;
    pointer-events: none;
  }

  .text-overlay {
    position: absolute;
    inset: 0;
  }

  .text-block {
    position: absolute;
    transform: translate(-2%, -92%);
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: transparent;
    padding: 0.08rem 0.28rem;
    cursor: text;
    line-height: 1.15;
    text-align: left;
    max-width: min(42ch, 52vw);
    white-space: pre-wrap;
    min-width: 1.8ch;
  }

  .text-block:hover {
    border-color: rgba(59, 130, 246, 0.28);
    background: rgba(219, 234, 254, 0.2);
  }

  .text-block-editor {
    resize: both;
    min-width: 12ch;
    min-height: 2.4em;
    border-style: solid;
    background: rgba(255, 255, 255, 0.96);
    box-shadow: 0 0 0 1px #2563eb;
  }

  .text-block.is-selected {
    background: rgba(255, 255, 255, 0.94);
    border-color: #7c3aed;
    color: #0f172a;
    cursor: move;
  }

  .text-block.is-active {
    border-style: solid;
    box-shadow: 0 0 0 1px #2563eb;
    color: #0f172a;
  }

  .inspector {
    display: grid;
    gap: 0.35rem;
    align-content: start;
  }

  .inspector label {
    font-size: 0.74rem;
    color: #475569;
    font-weight: 600;
  }

  .checkline {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }

  .inspector input {
    width: 100%;
    border: 1px solid #cbd5e1;
    border-radius: 10px;
    padding: 0.42rem 0.52rem;
    background: #ffffff;
    box-sizing: border-box;
  }

  .inspector-actions {
    margin-top: 0.25rem;
  }

  .editor-footer {
    border-top: 1px solid #d3dce8;
    padding: 0.5rem 1rem;
    background: #f8fafc;
    min-height: 2.3rem;
    display: flex;
    align-items: center;
  }

  .editor-footer p {
    margin: 0;
    font-size: 0.82rem;
    color: #334155;
  }

  .editor-footer .error {
    color: #b91c1c;
  }

  .muted {
    margin: 0;
    color: #64748b;
    font-size: 0.8rem;
  }

  @media (max-width: 1080px) {
    .editor-body {
      grid-template-columns: 150px minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) auto;
    }

    .inspector {
      grid-column: 1 / -1;
      max-height: 32vh;
    }
  }
</style>
