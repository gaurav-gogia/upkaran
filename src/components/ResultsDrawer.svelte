<script>
  import { fade, fly, scale } from "svelte/transition";
  import { results, removeResult, clearResults } from "../js/results-store.js";
  import { saveBlob } from "../js/download.js";
  import { formatBytes } from "../js/detect.js";

  export let newBatch = 0;

  let pulsing = false;
  let prevBatch = 0;

  $: if (newBatch !== prevBatch && newBatch > 0) {
    prevBatch = newBatch;
    pulsing = true;
    setTimeout(() => (pulsing = false), 900);
  }

  function mimeLabel(mimeType = "") {
    if (mimeType.startsWith("image/")) return mimeType.split("/")[1].toUpperCase();
    if (mimeType === "application/pdf") return "PDF";
    if (mimeType === "application/zip") return "ZIP";
    if (mimeType === "application/x-tar") return "TAR";
    if (mimeType === "application/gzip" || mimeType === "application/x-gzip") return "GZ";
    return "FILE";
  }

  function mimeIcon(mimeType = "") {
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType === "application/pdf") return "picture_as_pdf";
    if (mimeType === "application/zip" || mimeType === "application/x-tar") return "folder_zip";
    if (mimeType === "application/gzip" || mimeType === "application/x-gzip") return "compress";
    return "description";
  }

  function mimeColor(mimeType = "") {
    if (mimeType.startsWith("image/")) return "#7b5ea7";
    if (mimeType === "application/pdf") return "#c0392b";
    if (mimeType === "application/zip" || mimeType === "application/x-tar") return "#e67e22";
    return "#355ca8";
  }

  function download(entry) {
    saveBlob(entry.blob, entry.name);
  }

  function downloadAll() {
    for (const entry of $results) {
      saveBlob(entry.blob, entry.name);
    }
  }
</script>

{#if $results.length > 0}
  <section
    id="results-section"
    class="drawer panel"
    class:pulsing
    transition:fly={{ y: 16, duration: 300 }}
  >
    <header class="drawer-header">
      <div class="title-row">
        <span class="material-symbols-outlined header-icon">download_done</span>
        <h3>Results</h3>
        <span class="badge" class:badge--new={pulsing}>{$results.length}</span>
      </div>
      <div class="header-actions">
        <button on:click={downloadAll}>
          <span class="material-symbols-outlined btn-icon">download_for_offline</span>
          Download all
        </button>
        <button class="secondary" on:click={clearResults}>Clear</button>
      </div>
    </header>

    <div class="cards">
      {#each $results as entry, i (entry.id)}
        <article
          class="card panel"
          transition:fly={{ y: 18, duration: 260, delay: Math.min(i * 45, 200) }}
        >
          <div class="preview-wrap" style="--accent: {mimeColor(entry.mimeType)}">
            {#if entry.previewUrl}
              <img src={entry.previewUrl} alt={entry.name} class="thumb" />
            {:else}
              <div class="type-icon-wrap">
                <span class="material-symbols-outlined type-icon">{mimeIcon(entry.mimeType)}</span>
                <span class="type-label">{mimeLabel(entry.mimeType)}</span>
              </div>
            {/if}
          </div>

          <div class="card-meta">
            <strong class="card-name" title={entry.name}>{entry.name}</strong>
            <small>{formatBytes(entry.size)}</small>
          </div>

          <div class="card-actions">
            <button class="download-btn" on:click={() => download(entry)}>
              <span class="material-symbols-outlined btn-icon">download</span>
              Download
            </button>
            <button
              class="secondary icon-only"
              aria-label="Remove {entry.name}"
              title="Remove"
              on:click={() => removeResult(entry.id)}
            >
              <span class="material-symbols-outlined" style="font-size:1rem">close</span>
            </button>
          </div>
        </article>
      {/each}
    </div>
  </section>
{/if}

<style>
  .drawer {
    padding: 1rem;
    transition: box-shadow 0.4s ease, outline-color 0.4s ease;
    outline: 2px solid transparent;
    outline-offset: 2px;
  }

  .drawer.pulsing {
    animation: drawer-pulse 0.7s ease;
  }

  @keyframes drawer-pulse {
    0%   { box-shadow: 0 0 0 0 rgba(53, 92, 168, 0.45); }
    50%  { box-shadow: 0 0 0 8px rgba(53, 92, 168, 0.12); }
    100% { box-shadow: 0 0 0 0 rgba(53, 92, 168, 0); }
  }

  .drawer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-bottom: 0.9rem;
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .header-icon {
    font-size: 1.25rem;
    color: var(--md-sys-color-primary);
  }

  h3 {
    margin: 0;
    font-size: 1rem;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.5rem;
    height: 1.5rem;
    padding: 0 0.45rem;
    border-radius: 999px;
    background: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
    font-size: 0.75rem;
    font-weight: 700;
    line-height: 1;
    transition: transform 0.2s, background 0.2s;
  }

  .badge--new {
    animation: badge-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
    background: #1e8a4a;
  }

  @keyframes badge-pop {
    0%   { transform: scale(1); }
    50%  { transform: scale(1.45); }
    100% { transform: scale(1); }
  }

  .header-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .btn-icon {
    font-size: 1rem;
    line-height: 1;
    vertical-align: middle;
  }

  /* Cards grid */
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 0.75rem;
  }

  .card {
    display: flex;
    flex-direction: column;
    padding: 0.75rem;
    gap: 0.6rem;
    overflow: hidden;
    transition: box-shadow 0.2s, transform 0.15s;
  }

  .card:hover {
    box-shadow: 0 4px 14px rgba(0,0,0,0.11);
    transform: translateY(-2px);
  }

  /* Preview */
  .preview-wrap {
    width: 100%;
    aspect-ratio: 16 / 9;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--accent, var(--md-sys-color-primary)) 10%, var(--md-sys-color-surface-variant));
    border-radius: var(--radius-sm);
    overflow: hidden;
    position: relative;
  }

  .thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .type-icon-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
  }

  .type-icon {
    font-size: 2rem;
    color: var(--accent, var(--md-sys-color-primary));
    font-variation-settings: 'FILL' 1, 'wght' 300, 'GRAD' 0, 'opsz' 24;
  }

  .type-label {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--accent, var(--md-sys-color-primary));
    opacity: 0.8;
  }

  /* Meta */
  .card-meta {
    display: grid;
    gap: 0.15rem;
    min-width: 0;
  }

  .card-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 0.85rem;
  }

  small {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.78rem;
  }

  /* Actions */
  .card-actions {
    display: flex;
    gap: 0.4rem;
    flex-wrap: nowrap;
    margin-top: auto;
  }

  .download-btn {
    flex: 1;
    padding: 0.45rem 0.6rem;
    font-size: 0.8rem;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
  }

  .icon-only {
    padding: 0.45rem 0.55rem;
    flex-shrink: 0;
    line-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
