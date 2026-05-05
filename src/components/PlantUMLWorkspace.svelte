<script>
  import { createEventDispatcher, onDestroy } from "svelte";
  import { renderPlantUML } from "../js/plantuml.js";
  import { svgToPngBlob, pngBlobToPdf, parseSvgDimensions } from "../js/workspace-pdf.js";

  const dispatch = createEventDispatcher();

  const DEFAULT_SOURCE = `@startuml
actor User
participant "Browser" as B
participant "PDF Engine" as P

User -> B : Open PlantUML workspace
B -> B   : Encode diagram
B -> P   : Fetch SVG
P --> B  : Return SVG
User -> B : Click "Export as PDF"
B -> B   : SVG → PNG → PDF
B --> User : Download PDF
@enduml`;

  let source = DEFAULT_SOURCE;
  /** @type {string} SVG markup of the last successful render */
  let svgContent = "";
  let error = "";
  let exporting = false;
  let rendering = false;
  let debounceTimer;

  async function renderDiagram(text) {
    if (!text.trim()) {
      svgContent = "";
      error = "";
      return;
    }
    rendering = true;
    error = "";
    try {
      svgContent = await renderPlantUML(text);
    } catch (e) {
      error = navigator.onLine
        ? `Render failed: ${e.message}`
        : "PlantUML preview requires an internet connection. Your last rendered diagram is shown.";
    } finally {
      rendering = false;
    }
  }

  // Debounced live preview
  $: {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => renderDiagram(source), 500);
  }

  onDestroy(() => clearTimeout(debounceTimer));

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  function handleNew() {
    source = "";
    svgContent = "";
    error = "";
  }

  function handleReset() {
    source = DEFAULT_SOURCE;
    renderDiagram(DEFAULT_SOURCE);
  }

  async function handleExport() {
    if (exporting || !svgContent) return;
    exporting = true;
    error = "";
    try {
      const { width, height } = parseSvgDimensions(svgContent);
      const pngBlob = await svgToPngBlob(svgContent, width, height);
      const pdfBlob = await pngBlobToPdf(pngBlob);
      const file = new File([pdfBlob], "plantuml-diagram.pdf", { type: "application/pdf" });
      dispatch("filesreceived", [file]);
    } catch (e) {
      error = `Export failed: ${e.message}`;
    } finally {
      exporting = false;
    }
  }
</script>

<section class="panel workspace">
  <!-- Toolbar -->
  <header class="ws-toolbar">
    <span class="material-symbols-outlined ws-icon">schema</span>
    <h2>PlantUML → PDF</h2>
    <div class="ws-actions">
      <button class="secondary" type="button" on:click={handleNew}>New</button>
      <button class="secondary" type="button" on:click={handleReset}>Reset</button>
      <button type="button" disabled={exporting || !svgContent} on:click={handleExport}>
        {exporting ? "Exporting…" : "Export as PDF"}
      </button>
      <button
        class="secondary icon-btn"
        type="button"
        title="Close editor"
        on:click={() => dispatch("close")}
      >
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
  </header>

  <!-- Split pane -->
  <div class="ws-body">
    <!-- Editor -->
    <div class="editor-pane">
      <div class="pane-label">Source</div>
      <textarea
        bind:value={source}
        placeholder="Enter PlantUML code here…"
        spellcheck="false"
        autocorrect="off"
        autocapitalize="off"
      ></textarea>
    </div>

    <!-- Preview -->
    <div class="preview-pane">
      <div class="pane-label">
        Preview
        {#if rendering}<span class="loading-dot">…</span>{/if}
      </div>
      <div class="preview-scroll">
        {#if svgContent}
          <div class="diagram-wrap">
            {@html svgContent}
          </div>
        {:else if !rendering && !error}
          <p class="hint">Diagram will appear here…</p>
        {/if}
        {#if error}
          <p class="render-error">{error}</p>
        {/if}
        {#if rendering && !svgContent}
          <p class="hint">Rendering…</p>
        {/if}
      </div>
    </div>
  </div>

  <!-- Connectivity notice -->
  <p class="ws-notice">
    <span class="material-symbols-outlined" style="font-size:0.9rem;vertical-align:-3px">info</span>
    PlantUML preview fetches from <strong>plantuml.com</strong> — requires internet. Export uses the last fetched SVG.
  </p>
</section>

<style>
  .workspace {
    padding: 0;
    overflow: hidden;
  }

  .ws-toolbar {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.65rem 1rem;
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
    flex-wrap: wrap;
    background: var(--md-sys-color-surface-container-low);
  }

  .ws-icon {
    color: var(--md-sys-color-primary);
    font-size: 1.3rem;
  }

  h2 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    flex: 1;
    min-width: 0;
  }

  .ws-actions {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }

  .icon-btn {
    padding: 0.4rem;
    display: flex;
    align-items: center;
  }

  .icon-btn .material-symbols-outlined {
    font-size: 1.1rem;
  }

  .ws-body {
    display: grid;
    grid-template-columns: 1fr 1fr;
    height: 520px;
  }

  .pane-label {
    padding: 0.3rem 0.75rem;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--md-sys-color-on-surface-variant);
    background: var(--md-sys-color-surface-container-highest);
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .loading-dot {
    color: var(--md-sys-color-primary);
    font-style: italic;
    font-size: 0.9rem;
  }

  .editor-pane {
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--md-sys-color-outline-variant);
  }

  textarea {
    flex: 1;
    resize: none;
    border: none;
    padding: 1rem;
    font-family: "Cascadia Code", "Fira Code", "Consolas", monospace;
    font-size: 0.83rem;
    line-height: 1.65;
    background: var(--md-sys-color-surface);
    color: var(--md-sys-color-on-surface);
    outline: none;
  }

  .preview-pane {
    display: flex;
    flex-direction: column;
  }

  .preview-scroll {
    flex: 1;
    overflow: auto;
    background: white;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .diagram-wrap {
    padding: 1.5rem;
    max-width: 100%;
  }

  :global(.diagram-wrap svg) {
    max-width: 100%;
    height: auto;
  }

  .hint {
    color: var(--md-sys-color-on-surface-variant);
    font-style: italic;
  }

  .render-error {
    padding: 1rem;
    color: var(--md-sys-color-error);
    font-size: 0.85rem;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .ws-notice {
    margin: 0;
    padding: 0.45rem 1rem;
    font-size: 0.78rem;
    color: var(--md-sys-color-on-surface-variant);
    background: var(--md-sys-color-surface-container-low);
    border-top: 1px solid var(--md-sys-color-outline-variant);
  }
</style>
