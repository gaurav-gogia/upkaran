<script>
  import { createEventDispatcher } from "svelte";
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
    getPdfPageCount,
    summarizeCustomSplitSelection,
    buildAllPagesSelection,
    unlockPdf
  } from "../js/pdf-tools.js";
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

  const dispatch = createEventDispatcher();

  // ── PDF Unlock state ────────────────────────────────────────────────────
  let unlockPassword = "";
  let unlockNeedsPassword = false;
  let unlockError = "";
  let unlockSuccess = "";
  let unlocking = false;

  $: if (files.length > 0) {
    unlockNeedsPassword = false;
    unlockError = "";
    unlockSuccess = "";
    unlockPassword = "";
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
  <h3>PDF Tooling</h3>
  <p>Split, merge, compress, or render pages to images directly in browser memory.</p>

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

  <label for="pdf-img-format">Image output format</label>
  <select id="pdf-img-format" bind:value={imageFormat}>
    <option value="png">PNG</option>
    <option value="jpeg">JPEG</option>
    <option value="webp">WebP</option>
  </select>

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

  <div class="actions">
    <button on:click={() => run("split")} disabled={busy || files.length < 1}>Split PDF</button>
    <button on:click={() => run("merge")} disabled={busy || files.length < 2}>Merge PDFs</button>
    <button on:click={() => run("compress")} disabled={busy || files.length < 1}>Compress PDF</button>
    <button on:click={() => run("to-images")} disabled={busy || files.length < 1}>PDF to Images</button>
  </div>

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
        on:keydown={(e) => e.key === 'Enter' && runUnlock()}
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
        {unlocking ? "Unlocking…" : "Unlock PDF"}
      </button>
    </div>
  </section>
</section>

<style>
  .tool {
    padding: 1rem;
  }

  h3 {
    margin: 0 0 0.4rem;
  }

  p {
    margin: 0 0 1rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  label {
    display: block;
    margin-bottom: 0.3rem;
    font-size: 0.85rem;
  }

  select {
    width: 100%;
    margin-bottom: 0.9rem;
    border-radius: 10px;
    border: 1px solid var(--md-sys-color-outline);
    padding: 0.45rem 0.55rem;
    background: #fff;
  }

  input {
    width: 100%;
    margin-bottom: 0.35rem;
    border-radius: 10px;
    border: 1px solid var(--md-sys-color-outline);
    padding: 0.45rem 0.55rem;
    background: #fff;
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
    border-radius: 10px;
    padding: 0.7rem;
    background: var(--md-sys-color-surface-container-low);
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
    border-radius: 8px;
    background: #fff;
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
    border-radius: 10px;
    padding: 0.75rem;
    background: var(--md-sys-color-surface-container-low);
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
    font-size: 0.78rem;
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
    border-radius: 10px;
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
    border-radius: 10px;
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

    .number-grid {
      grid-template-columns: 1fr;
    }
  }

  /* Unlock section */
  .unlock-section {
    margin-top: 0.5rem;
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
    border-radius: 8px;
  }

  .unlock-msg--error {
    color: var(--md-sys-color-error);
    background: color-mix(in srgb, var(--md-sys-color-error) 8%, white);
    border: 1px solid color-mix(in srgb, var(--md-sys-color-error) 25%, white);
  }

  .unlock-msg--success {
    color: #1a6b2f;
    background: #edfaf1;
    border: 1px solid #a3d9b5;
  }
</style>
