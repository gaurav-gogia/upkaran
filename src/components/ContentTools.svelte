<script>
  import { createEventDispatcher, onDestroy } from "svelte";
  import { fileToHtml, getExtension, urlToHtml } from "../js/document-tools.js";
  import { summarizeOfficeOutcomes } from "../js/office-reliability.js";
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
  let previewRequestId = 0;
  let sourceUrl = "";
  let urlPreviewHtml = "";
  let urlPreviewLoading = false;
  let urlPreviewError = "";
  let urlPreviewSource = "";
  let urlPreviewDebounce;
  let urlPreviewRequestId = 0;
  let conversionSummary = { total: 0, success: 0, unsupported: 0, error: 0, passRate: 0 };
  let conversionOutcomes = [];

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
    previewHtml = "";
    previewDebounce = setTimeout(() => loadPreview(primaryFile), 80);
  }

  $: if (!primaryFile) {
    previewHtml = "";
    previewFile = null;
    error = "";
  }

  $: if (!sourceUrl.trim()) {
    clearTimeout(urlPreviewDebounce);
    urlPreviewHtml = "";
    urlPreviewError = "";
    urlPreviewLoading = false;
    urlPreviewSource = "";
  } else if (sourceUrl.trim() !== urlPreviewSource) {
    urlPreviewHtml = "";
    urlPreviewError = "";
  }

  onDestroy(() => clearTimeout(previewDebounce));
  onDestroy(() => clearTimeout(urlPreviewDebounce));

  async function loadPreview(entry) {
    const requestId = ++previewRequestId;
    previewLoading = true;
    error = "";
    previewFile = entry;
    try {
      const html = await fileToHtml(entry);
      if (requestId !== previewRequestId) return;
      previewHtml = html;
    } catch (e) {
      if (requestId !== previewRequestId) return;
      error = `Preview error: ${e.message}`;
      previewHtml = "";
    } finally {
      if (requestId === previewRequestId) {
        previewLoading = false;
      }
    }
  }

  async function loadUrlPreview() {
    const rawUrl = sourceUrl.trim();
    if (!rawUrl) {
      urlPreviewError = "Enter a URL before previewing.";
      urlPreviewHtml = "";
      return;
    }

    const requestId = ++urlPreviewRequestId;
    urlPreviewLoading = true;
    urlPreviewError = "";

    try {
      const html = await urlToHtml(rawUrl);
      if (requestId !== urlPreviewRequestId) return;
      urlPreviewHtml = html;
      urlPreviewSource = rawUrl;
    } catch (e) {
      if (requestId !== urlPreviewRequestId) return;
      urlPreviewError = `URL preview error: ${e.message}`;
      urlPreviewHtml = "";
      urlPreviewSource = "";
    } finally {
      if (requestId === urlPreviewRequestId) {
        urlPreviewLoading = false;
      }
    }
  }

  async function convertUrlToPdf() {
    if (converting || busy) return;

    const rawUrl = sourceUrl.trim();
    if (!rawUrl) {
      error = "Enter a URL before converting.";
      return;
    }

    converting = true;
    error = "";
    dispatch("processing", true);
    dispatch("progress", 5);

    try {
      const html = urlPreviewHtml && !urlPreviewError && urlPreviewSource === rawUrl
        ? urlPreviewHtml
        : await urlToHtml(rawUrl);
      const pdfBlob = await htmlStringToMultiPagePdf(html);
      dispatch("output", [{ name: `${makeUrlBaseName(rawUrl)}.pdf`, blob: pdfBlob }]);
      dispatch("progress", 100);
    } catch (e) {
      error = e.message || "URL conversion failed.";
      dispatch("error", error);
    } finally {
      converting = false;
      dispatch("processing", false);
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
      const outcomes = [];

      for (let i = 0; i < files.length; i++) {
        const entry = files[i];
        const unsupported = getUnsupportedMsg(entry.name);
        if (unsupported) {
          outcomes.push({ fileName: entry.name, status: "unsupported", reason: unsupported });
          dispatch("progress", Math.round(5 + ((i + 1) / files.length) * 90));
          continue;
        }

        try {
          const html = await fileToHtml(entry);
          const pdfBlob = await htmlStringToMultiPagePdf(html);
          const baseName = entry.name.replace(/\.[^.]+$/, "");
          outputs.push({ name: `${baseName}.pdf`, blob: pdfBlob });
          outcomes.push({ fileName: entry.name, status: "success" });
        } catch (convertError) {
          outcomes.push({
            fileName: entry.name,
            status: "error",
            reason: convertError?.message || "Conversion failed"
          });
        }

        dispatch("progress", Math.round(5 + ((i + 1) / files.length) * 90));
      }

      conversionOutcomes = outcomes;
      conversionSummary = summarizeOfficeOutcomes(outcomes);

      if (outputs.length) {
        dispatch("output", outputs);
        dispatch("progress", 100);
      }

      if (conversionSummary.error > 0) {
        error = `${conversionSummary.error} file${conversionSummary.error === 1 ? "" : "s"} failed to convert.`;
      } else if (outputs.length < 1) {
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

  function makeUrlBaseName(urlInput) {
    try {
      const normalized = /^https?:\/\//i.test(urlInput) ? urlInput : `https://${urlInput}`;
      const resolved = new URL(normalized);
      const pathParts = resolved.pathname.split("/").filter(Boolean);
      const leaf = pathParts[pathParts.length - 1] || resolved.hostname;
      const cleaned = `${leaf}`
        .replace(/\.[^.]+$/, "")
        .replace(/[^a-z0-9_-]+/gi, "-")
        .replace(/^-+|-+$/g, "");
      return cleaned || resolved.hostname || "webpage";
    } catch {
      return "webpage";
    }
  }
</script>

<section class="panel tool">
  <header class="tool-header">
    <div>
      <h3>Content Command Center</h3>
      <p>Convert documents, datasets, and source files to PDF with local rendering and review before export.</p>
    </div>
  </header>

  <div class="tool-meta" aria-label="Content workspace summary">
    <span class="meta-chip">Files loaded <strong>{files.length}</strong></span>
    <span class="meta-chip">Primary file <strong>{primaryFile?.name ?? "No file selected"}</strong></span>
    <span class="meta-chip">Status <strong>{files.every((f) => !!getUnsupportedMsg(f.name)) && files.length > 0 ? "Needs supported format" : "Ready"}</strong></span>
  </div>

  <section class="compact-section url-section">
    <div class="section-title">Import from URL</div>
    <p class="url-note">Fetch a public http or https page, inspect a static snapshot, then convert it to PDF. Sites that block cross-origin requests may refuse to load here.</p>

    <label for="content-url">Webpage URL</label>
    <input
      id="content-url"
      type="url"
      bind:value={sourceUrl}
      placeholder="https://example.com/article"
      autocomplete="off"
      spellcheck="false"
      disabled={busy || converting}
      on:keydown={(e) => e.key === "Enter" && loadUrlPreview()}
    />

    <div class="actions url-actions">
      <button class="secondary" type="button" on:click={loadUrlPreview} disabled={busy || converting || !sourceUrl.trim()}>
        {urlPreviewLoading ? "Loading preview…" : "Preview URL"}
      </button>
      <button type="button" on:click={convertUrlToPdf} disabled={busy || converting || !sourceUrl.trim()}>
        {converting ? "Converting…" : "Convert URL to PDF"}
      </button>
    </div>

    {#if urlPreviewError}
      <p class="tool-error">{urlPreviewError}</p>
    {/if}

    {#if urlPreviewHtml}
      <div class="preview-wrap url-preview-wrap">
        <div class="preview-label">
          <span>URL preview — {sourceUrl}</span>
          {#if urlPreviewLoading}<span class="loading-text">Rendering…</span>{/if}
        </div>
        <iframe
          class="preview-frame"
          srcdoc={urlPreviewHtml}
          title="URL preview"
          sandbox="allow-same-origin"
        ></iframe>
      </div>
    {/if}
  </section>

  <!-- File list summary -->
  {#if files.length > 0}
    <details class="compact-section" open={files.length <= 3}>
      <summary>Input files ({files.length})</summary>
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
    </details>
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

  {#if conversionSummary.total > 0}
    <div class="conversion-summary" role="status" aria-live="polite">
      <span class="meta-chip">Converted <strong>{conversionSummary.success}</strong></span>
      <span class="meta-chip">Unsupported <strong>{conversionSummary.unsupported}</strong></span>
      <span class="meta-chip">Failed <strong>{conversionSummary.error}</strong></span>
      <span class="meta-chip">Pass rate <strong>{Math.round(conversionSummary.passRate * 100)}%</strong></span>
    </div>
  {/if}

  <!-- Actions -->
  <div class="actions ops-primary">
    <button
      on:click={convertAll}
      disabled={busy || converting || !files.length || files.every((f) => !!getUnsupportedMsg(f.name))}
    >
      {converting ? "Converting…" : files.length === 1 ? "Convert to PDF" : `Convert ${files.length} files to PDF`}
    </button>
  </div>

  <details class="compact-section">
    <summary>Supported formats</summary>
    <p class="tool-note">
      Supported: TXT, RTF, MD, DOCX, PPTX, XLSX, CSV, TSV, JSON, YAML, XML, and common source code files.
      Conversion runs entirely in your browser.
    </p>
  </details>
</section>

<style>
  .tool {
    padding: 1.2rem;
    display: grid;
    gap: 0.8rem;
  }

  .tool-header {
    margin-bottom: 0;
  }

  h3 {
    margin: 0 0 0.32rem;
    letter-spacing: 0.01em;
    font-size: clamp(1.08rem, 1.5vw, 1.35rem);
  }

  p {
    margin: 0;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.9rem;
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
    max-width: 18rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .compact-section {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: var(--app-radius-sm, 12px);
    background: var(--md-sys-color-surface-container-low);
    padding: 0.5rem 0.65rem;
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

  /* File list */
  .file-list {
    list-style: none;
    margin: 0.55rem 0 0;
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
    border-radius: var(--app-radius-sm, 12px);
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
    background: color-mix(in srgb, var(--app-state-success, #1a6b2f) 12%, var(--md-sys-color-surface));
    color: var(--app-state-success, #1a6b2f);
    border: 1px solid color-mix(in srgb, var(--app-state-success, #1a6b2f) 32%, var(--md-sys-color-outline-variant));
    border-radius: 999px;
    padding: 0.15rem 0.55rem;
    white-space: nowrap;
  }

  .badge-warn {
    font-size: 0.72rem;
    background: color-mix(in srgb, var(--md-sys-color-error) 10%, var(--md-sys-color-surface));
    color: var(--md-sys-color-error);
    border: 1px solid color-mix(in srgb, var(--md-sys-color-error) 30%, var(--md-sys-color-outline-variant));
    border-radius: 999px;
    padding: 0.15rem 0.55rem;
    white-space: nowrap;
  }

  /* Preview */
  .preview-wrap {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: var(--app-radius-md, 18px);
    overflow: hidden;
    margin-bottom: 0.2rem;
    background: var(--md-sys-color-surface);
    box-shadow: var(--elevation-1);
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
    background: var(--md-sys-color-surface);
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
    background: color-mix(in srgb, var(--md-sys-color-error) 10%, var(--md-sys-color-surface));
    border: 1px solid color-mix(in srgb, var(--md-sys-color-error) 26%, var(--md-sys-color-outline-variant));
    border-radius: var(--app-radius-sm, 12px);
    margin-bottom: 0.2rem;
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
    margin: 0;
    padding: 0.55rem 0.75rem;
    background: color-mix(in srgb, var(--md-sys-color-error) 12%, var(--md-sys-color-surface));
    border: 1px solid color-mix(in srgb, var(--md-sys-color-error) 30%, var(--md-sys-color-outline-variant));
    border-radius: var(--app-radius-sm, 12px);
    color: var(--md-sys-color-error);
    font-size: 0.83rem;
  }

  /* Actions */
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-bottom: 0.2rem;
  }

  .url-section {
    display: grid;
    gap: 0.55rem;
  }

  .section-title {
    font-size: 0.77rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--md-sys-color-on-surface-variant);
  }

  .url-note {
    margin: 0;
    color: var(--md-sys-color-on-surface-variant);
    line-height: 1.4;
  }

  .url-actions {
    margin-top: 0.15rem;
  }

  input[type="url"] {
    width: 100%;
    border-radius: var(--app-radius-sm, 12px);
    border: 1px solid var(--md-sys-color-outline);
    padding: 0.5rem 0.65rem;
    background: var(--md-sys-color-surface);
  }

  .url-preview-wrap {
    margin-top: 0.2rem;
  }

  .ops-primary {
    padding: 0.25rem;
    border: 1px solid color-mix(in srgb, var(--md-sys-color-primary) 20%, var(--md-sys-color-outline-variant));
    border-radius: var(--app-radius-sm, 12px);
    background: color-mix(in srgb, var(--md-sys-color-primary) 8%, var(--md-sys-color-surface));
  }

  .tool-note {
    font-size: 0.75rem;
    color: var(--md-sys-color-on-surface-variant);
    margin-top: 0.45rem !important;
  }

  .conversion-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    margin: -0.1rem 0 0.15rem;
  }
</style>
