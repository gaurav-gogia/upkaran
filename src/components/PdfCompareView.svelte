<script>
  import { onMount } from "svelte";
  import { renderPdfPreviewPage } from "../js/pdf-tools.js";
  import { measureAsync } from "../js/perf-profile.js";

  export let files = [];

  let page = 1;
  let scale = 1.1;
  let maxPages = 1;
  let loading = false;
  let error = "";
  let leftPreview = null;
  let rightPreview = null;
  let loadToken = 0;
  let leftTotalPages = 0;
  let rightTotalPages = 0;
  let lastRenderDurationMs = 0;

  const SCALE_OPTIONS = [0.8, 1.0, 1.1, 1.25, 1.4];

  function clampPage(next) {
    return Math.max(1, Math.min(maxPages, next));
  }

  async function loadPreviews() {
    if (!Array.isArray(files) || files.length !== 2) return;

    const token = ++loadToken;
    loading = true;
    error = "";

    try {
      const { result, durationMs } = await measureAsync("compare.pdf.preview_pair", () =>
        Promise.all([
          renderPdfPreviewPage(files[0], { page, scale }),
          renderPdfPreviewPage(files[1], { page, scale }),
        ]), {
          page,
          scale,
        }
      );

      const [left, right] = result;
      lastRenderDurationMs = Math.round(durationMs);

      if (token !== loadToken) return;

      leftTotalPages = left.totalPages;
      rightTotalPages = right.totalPages;
      maxPages = Math.max(1, Math.min(left.totalPages, right.totalPages));
      const boundedPage = clampPage(page);
      if (boundedPage !== page) {
        page = boundedPage;
        return;
      }

      leftPreview = left;
      rightPreview = right;
    } catch (e) {
      if (token !== loadToken) return;
      error = e?.message || "Unable to render PDF comparison preview.";
      leftPreview = null;
      rightPreview = null;
    } finally {
      if (token === loadToken) loading = false;
    }
  }

  onMount(loadPreviews);

  $: if (files.length === 2) {
    loadPreviews();
  }

  function movePage(delta) {
    page = clampPage(page + delta);
  }
</script>

<section class="panel pdf-compare">
  <header class="controls">
    <h4>PDF Side-by-Side Compare</h4>
    <div class="control-row">
      <button class="secondary" type="button" on:click={() => movePage(-1)} disabled={loading || page <= 1}>Prev</button>
      <span>Page {page} / {maxPages}</span>
      <button class="secondary" type="button" on:click={() => movePage(1)} disabled={loading || page >= maxPages}>Next</button>
      <label for="pdf-compare-scale">Zoom</label>
      <select id="pdf-compare-scale" bind:value={scale}>
        {#each SCALE_OPTIONS as option}
          <option value={option}>{Math.round(option * 100)}%</option>
        {/each}
      </select>
    </div>
  </header>

  {#if loading}
    <p class="state">Rendering pages...</p>
  {:else if files.length !== 2}
    <p class="state">Select exactly two PDF files to compare.</p>
  {:else if error}
    <p class="state error">{error}</p>
  {:else if leftPreview && rightPreview}
    {#if lastRenderDurationMs > 0}
      <p class="state note">Last render time: {lastRenderDurationMs} ms</p>
    {/if}
    {#if leftTotalPages !== rightTotalPages}
      <p class="state note">
        Files have different page counts (left: {leftTotalPages}, right: {rightTotalPages}).
        Showing comparable range up to page {maxPages}.
      </p>
    {/if}
    <div class="grid">
      <article>
        <h5 title={files[0]?.name}>{files[0]?.name}</h5>
        <img src={leftPreview.dataUrl} alt={`Preview page ${page} for ${files[0]?.name || "left PDF"}`} loading="lazy" />
      </article>
      <article>
        <h5 title={files[1]?.name}>{files[1]?.name}</h5>
        <img src={rightPreview.dataUrl} alt={`Preview page ${page} for ${files[1]?.name || "right PDF"}`} loading="lazy" />
      </article>
    </div>
  {/if}
</section>

<style>
  .pdf-compare {
    padding: 0.9rem;
    display: grid;
    gap: 0.6rem;
  }

  h4 {
    margin: 0;
    font-size: 0.95rem;
  }

  .controls {
    display: grid;
    gap: 0.45rem;
  }

  .control-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.82rem;
  }

  select {
    border-radius: 8px;
    border: 1px solid var(--md-sys-color-outline-variant);
    padding: 0.24rem 0.4rem;
    background: var(--md-sys-color-surface);
  }

  .state {
    margin: 0;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.86rem;
  }

  .state.error {
    color: var(--md-sys-color-error);
  }

  .state.note {
    border: 1px dashed var(--md-sys-color-outline-variant);
    border-radius: 10px;
    padding: 0.4rem 0.55rem;
    background: var(--md-sys-color-surface-container-low);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.7rem;
  }

  article {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 10px;
    padding: 0.5rem;
    background: var(--md-sys-color-surface-container-low);
    min-width: 0;
  }

  h5 {
    margin: 0 0 0.45rem;
    font-size: 0.8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  img {
    width: 100%;
    height: auto;
    display: block;
    border-radius: 6px;
    border: 1px solid var(--md-sys-color-outline-variant);
    background: #fff;
  }

  @media (max-width: 860px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
