<script>
  import { createEventDispatcher, onDestroy } from "svelte";
  import { fileToHtml, getExtension } from "../js/document-tools.js";
  import { htmlStringToMultiPagePdf } from "../js/workspace-pdf.js";
  import { formatBytes, kindLabel } from "../js/detect.js";

  export let files = [];
  export let busy = false;

  const dispatch = createEventDispatcher();

  let converting = false;
  let error = "";
  let previewEl;
  let previewHtml = "";
  let previewLoading = false;
  let previewFile = null;
  let previewDebounce;

  // ── File-type metadata ───────────────────────────────────────────────────

  const KIND_ICON = {
    document: "description",
    data: "table_chart",
    code: "code"
  };

  const EXT_UNSUPPORTED_MSG = {
    // Office formats that require complex rendering
    doc: "Legacy .doc (Word 97) is not yet supported. Save as .docx first.",
    ppt: "Legacy .ppt (PowerPoint 97) is not yet supported. Save as .pptx first.",
    xls: "Legacy .xls (Excel 97) is not yet supported. Save as .xlsx first.",
    odt: "LibreOffice .odt is not yet supported.",
    odp: "LibreOffice .odp is not yet supported.",
    ods: "LibreOffice .ods is not yet supported."
  };

  function getUnsupportedMsg(name) {
    const ext = getExtension(name);
    return EXT_UNSUPPORTED_MSG[ext] ?? null;
  }

  $: primaryFile = files[0] ?? null;
  $: primaryExt = primaryFile ? getExtension(primaryFile.name) : "";
  $: unsupportedMsg = primaryFile ? getUnsupportedMsg(primaryFile.name) : null;

  // ── Preview (debounced) ──────────────────────────────────────────────────

  $: if (primaryFile && primaryFile !== previewFile && !unsupportedMsg) {
    clearTimeout(previewDebounce);
    previewDebounce = setTimeout(() => loadPreview(primaryFile), 80);
  }

  $: if (!primaryFile) {
    previewHtml = "";
    previewFile = null;
    error = "";
  }

  onDestroy(() => clearTimeout(previewDebounce));

  async function loadPreview(entry) {
    if (previewLoading) return;
    previewLoading = true;
    error = "";
    previewFile = entry;
    try {
      previewHtml = await fileToHtml(entry);
    } catch (e) {
      error = `Preview error: ${e.message}`;
      previewHtml = "";
    } finally {
      previewLoading = false;
    }
  }

  // ── Export ───────────────────────────────────────────────────────────────

  async function convertAll() {
    if (converting || !files.length || busy) return;
    converting = true;
    error = "";
    dispatch("processing", true);
    dispatch("progress", 5);

    try {
      const outputs = [];

      for (let i = 0; i < files.length; i++) {
        const entry = files[i];
        if (getUnsupportedMsg(entry.name)) continue;

        const html = await fileToHtml(entry);
        const pdfBlob = await htmlStringToMultiPagePdf(html);
        const baseName = entry.name.replace(/\.[^.]+$/, "");
        outputs.push({ name: `${baseName}.pdf`, blob: pdfBlob });

        dispatch("progress", Math.round(5 + ((i + 1) / files.length) * 90));
      }

      if (outputs.length) {
        dispatch("output", outputs);
        dispatch("progress", 100);
      } else {
        error = "No supported files to convert.";
      }
    } catch (e) {
      error = e.message || "Conversion failed.";
      dispatch("error", error);
    } finally {
      converting = false;
      dispatch("processing", false);
    }
  }
</script>

<section class="panel tool">
  <header class="tool-header">
    <div>
      <h3>Content Tools</h3>
      <p>Convert documents, data files, and source code to PDF.</p>
    </div>
  </header>

  <!-- File list summary -->
  {#if files.length > 0}
    <ul class="file-list">
      {#each files as f (f.id)}
        <li class="file-item">
          <span class="material-symbols-outlined file-icon">{KIND_ICON[f.kind] ?? "insert_drive_file"}</span>
          <div class="file-info">
            <strong class="file-name" title={f.name}>{f.name}</strong>
            <small>{kindLabel(f.kind)} · {formatBytes(f.size)}</small>
          </div>
          {#if getUnsupportedMsg(f.name)}
            <span class="badge-warn">Not supported</span>
          {:else}
            <span class="badge-ok">Ready</span>
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="empty-hint">No content files selected.</p>
  {/if}

  <!-- Preview panel -->
  {#if primaryFile && !unsupportedMsg}
    <div class="preview-wrap">
      <div class="preview-label">
        <span>Preview — {primaryFile.name}</span>
        {#if previewLoading}<span class="loading-text">Rendering…</span>{/if}
      </div>
      {#if previewHtml}
        <iframe
          class="preview-frame"
          srcdoc={previewHtml}
          title="Document preview"
          sandbox="allow-same-origin"
        ></iframe>
      {:else if !previewLoading}
        <p class="preview-empty">No preview available.</p>
      {/if}
    </div>
  {/if}

  <!-- Unsupported notice -->
  {#if unsupportedMsg}
    <div class="unsupported-notice">
      <span class="material-symbols-outlined">info</span>
      <p>{unsupportedMsg}</p>
    </div>
  {/if}

  <!-- Error -->
  {#if error}
    <p class="tool-error">{error}</p>
  {/if}

  <!-- Actions -->
  <div class="actions">
    <button
      on:click={convertAll}
      disabled={busy || converting || !files.length || files.every((f) => !!getUnsupportedMsg(f.name))}
    >
      {converting ? "Converting…" : files.length === 1 ? "Convert to PDF" : `Convert ${files.length} files to PDF`}
    </button>
  </div>

  <p class="tool-note">
    Supported: TXT, RTF, MD, DOCX, PPTX, XLSX, CSV, TSV, JSON, YAML, XML, and common source code files.
    Conversion runs entirely in your browser.
  </p>
</section>

<style>
  .tool {
    padding: 1rem;
  }

  .tool-header {
    margin-bottom: 0.75rem;
  }

  h3 {
    margin: 0 0 0.25rem;
  }

  p {
    margin: 0;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.88rem;
  }

  /* File list */
  .file-list {
    list-style: none;
    margin: 0 0 0.9rem;
    padding: 0;
    display: grid;
    gap: 0.4rem;
  }

  .file-item {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.5rem;
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 10px;
    padding: 0.5rem 0.7rem;
    background: var(--md-sys-color-surface-container-low);
  }

  .file-icon {
    font-size: 1.1rem;
    color: var(--md-sys-color-primary);
  }

  .file-info {
    min-width: 0;
  }

  .file-name {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.88rem;
  }

  .file-info small {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.76rem;
  }

  .badge-ok {
    font-size: 0.72rem;
    background: #edfaf1;
    color: #1a6b2f;
    border: 1px solid #a3d9b5;
    border-radius: 999px;
    padding: 0.15rem 0.55rem;
    white-space: nowrap;
  }

  .badge-warn {
    font-size: 0.72rem;
    background: color-mix(in srgb, var(--md-sys-color-error) 8%, white);
    color: var(--md-sys-color-error);
    border: 1px solid color-mix(in srgb, var(--md-sys-color-error) 30%, white);
    border-radius: 999px;
    padding: 0.15rem 0.55rem;
    white-space: nowrap;
  }

  /* Preview */
  .preview-wrap {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 10px;
    overflow: hidden;
    margin-bottom: 0.9rem;
    background: white;
  }

  .preview-label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.3rem 0.75rem;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--md-sys-color-on-surface-variant);
    background: var(--md-sys-color-surface-container-highest);
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
  }

  .loading-text {
    font-style: italic;
    font-weight: 400;
    letter-spacing: 0;
    text-transform: none;
    color: var(--md-sys-color-primary);
  }

  .preview-frame {
    width: 100%;
    height: 360px;
    border: none;
    display: block;
    background: white;
  }

  .preview-empty {
    padding: 1.5rem;
    text-align: center;
  }

  .empty-hint {
    margin-bottom: 0.9rem !important;
  }

  /* Unsupported */
  .unsupported-notice {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.7rem 0.85rem;
    background: color-mix(in srgb, var(--md-sys-color-error) 6%, white);
    border: 1px solid color-mix(in srgb, var(--md-sys-color-error) 20%, white);
    border-radius: 10px;
    margin-bottom: 0.9rem;
    color: var(--md-sys-color-error);
    font-size: 0.85rem;
  }

  .unsupported-notice .material-symbols-outlined {
    font-size: 1.1rem;
    flex-shrink: 0;
    margin-top: 0.05rem;
  }

  .unsupported-notice p {
    margin: 0;
    color: inherit;
  }

  /* Error */
  .tool-error {
    margin: 0 0 0.75rem;
    padding: 0.55rem 0.75rem;
    background: color-mix(in srgb, var(--md-sys-color-error) 8%, white);
    border: 1px solid color-mix(in srgb, var(--md-sys-color-error) 25%, white);
    border-radius: 8px;
    color: var(--md-sys-color-error);
    font-size: 0.83rem;
  }

  /* Actions */
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-bottom: 0.75rem;
  }

  .tool-note {
    font-size: 0.75rem;
    color: var(--md-sys-color-on-surface-variant);
    margin-top: 0.4rem !important;
  }
</style>
