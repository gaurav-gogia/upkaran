<script>
  import { createEventDispatcher, onDestroy } from "svelte";
  import katex from "katex";
  import "katex/dist/katex.min.css";
  import { elementToPngBlob, pngBlobToPdf } from "../js/workspace-pdf.js";

  const dispatch = createEventDispatcher();

  const DEFAULT_SOURCE = [
    "Hello, World!",
    "",
    "Euler's identity:  $e^{i\\pi} + 1 = 0$",
    "",
    "$$\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}$$",
    "",
    "The quadratic formula:",
    "",
    "$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$"
  ].join("\n");

  let source = DEFAULT_SOURCE;
  let rendered = "";
  let error = "";
  let exporting = false;
  let previewEl;
  let debounceTimer;

  // ---------------------------------------------------------------------------
  // Renderer: split text into plain-text / inline-math / display-math segments
  // ---------------------------------------------------------------------------
  function renderLatex(text) {
    try {
      // Match $$...$$ (display) and $...$ (inline); display must come first
      const re = /\$\$([\s\S]*?)\$\$|\$([^$\n]+?)\$/g;
      const parts = [];
      let lastIndex = 0;
      let match;

      while ((match = re.exec(text)) !== null) {
        if (match.index > lastIndex) {
          parts.push({ type: "text", content: text.slice(lastIndex, match.index) });
        }
        if (match[1] !== undefined) {
          parts.push({ type: "display", content: match[1] });
        } else {
          parts.push({ type: "inline", content: match[2] });
        }
        lastIndex = re.lastIndex;
      }
      if (lastIndex < text.length) {
        parts.push({ type: "text", content: text.slice(lastIndex) });
      }

      let html = "";
      for (const part of parts) {
        if (part.type === "text") {
          html += part.content
            .split("\n")
            .map((line) =>
              line.trim()
                ? `<p class="latex-text">${escapeHtml(line)}</p>`
                : `<p class="latex-blank"></p>`
            )
            .join("");
        } else {
          html += katex.renderToString(part.content.trim(), {
            displayMode: part.type === "display",
            throwOnError: false,
            output: "html"
          });
        }
      }
      rendered = html;
      error = "";
    } catch (e) {
      error = e.message;
    }
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // Debounced live preview
  $: {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => renderLatex(source), 150);
  }

  onDestroy(() => clearTimeout(debounceTimer));

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  function handleNew() {
    source = "";
    rendered = "";
    error = "";
  }

  function handleReset() {
    source = DEFAULT_SOURCE;
    renderLatex(DEFAULT_SOURCE);
  }

  async function handleExport() {
    if (exporting || !previewEl) return;
    exporting = true;
    error = "";
    try {
      const pngBlob = await elementToPngBlob(previewEl);
      const pdfBlob = await pngBlobToPdf(pngBlob);
      const file = new File([pdfBlob], "latex-output.pdf", { type: "application/pdf" });
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
    <span class="material-symbols-outlined ws-icon">functions</span>
    <h2>LaTeX → PDF</h2>
    <div class="ws-actions">
      <button class="secondary" type="button" on:click={handleNew}>New</button>
      <button class="secondary" type="button" on:click={handleReset}>Reset</button>
      <button type="button" disabled={exporting || !rendered} on:click={handleExport}>
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
        placeholder="Type LaTeX here. Use $...$ for inline math, $$...$$ for display math."
        spellcheck="false"
        autocorrect="off"
        autocapitalize="off"
      ></textarea>
    </div>

    <!-- Preview -->
    <div class="preview-pane">
      <div class="pane-label">Preview</div>
      <div class="preview-scroll">
        <div class="preview-content" bind:this={previewEl}>
          {#if rendered}
            {@html rendered}
          {:else}
            <p class="hint">Preview will appear here…</p>
          {/if}
        </div>
      </div>
    </div>
  </div>

  <!-- Status -->
  {#if error}
    <p class="ws-error">{error}</p>
  {/if}
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
    height: 540px;
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
    overflow-y: auto;
    background: white;
  }

  .preview-content {
    padding: 1.5rem 2rem;
    font-family: "Noto Sans", "Segoe UI", sans-serif;
    font-size: 1rem;
    line-height: 1.75;
    min-height: 100%;
    color: #1a1b20;
  }

  /* these classes are injected via {@html} */
  :global(.latex-text) {
    margin: 0.5em 0;
  }
  :global(.latex-blank) {
    margin: 0;
    height: 0.6em;
  }

  .hint {
    color: var(--md-sys-color-on-surface-variant);
    font-style: italic;
  }

  .ws-error {
    margin: 0;
    padding: 0.55rem 1rem;
    font-size: 0.82rem;
    color: var(--md-sys-color-error);
    background: color-mix(in srgb, var(--md-sys-color-error) 8%, white);
    border-top: 1px solid var(--md-sys-color-outline-variant);
  }
</style>
